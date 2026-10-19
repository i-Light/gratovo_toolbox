"""Tests for `python -m gemini_bridge daemon` -- the process the Flutter app runs.

Run with:  python -m pytest -q tests/test_gemini_daemon.py    (from pipeline/)

The daemon is started as a real subprocess and driven over its stdin/stdout,
because that is the only interface the app has: what is pinned is
DAEMON.md's contract as observed from outside -- the first line names the
port, every response carries its request's id even when they come back out
of order, extension events are forwarded, and the process exits cleanly on
`bridge.shutdown`, on EOF, and with code 2 when the port is taken.

The extension is the `FakeExtension` from test_gemini_bridge.py, dialling
the port the daemon printed.
"""

from __future__ import annotations

import asyncio
import json
import queue
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any, Callable, Optional

import pytest

PIPELINE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PIPELINE_DIR))

from test_gemini_bridge import STATUS, FakeExtension, no_threads_left_behind, wait_until  # noqa: E402,F401


class DaemonProcess:
    """A running daemon: `send()` requests, `next_line()` / `wait_for()` its output."""

    def __init__(self, port: int = 0, extra: Optional[list[str]] = None):
        self.proc = subprocess.Popen(
            [sys.executable, "-m", "gemini_bridge", "daemon", "--port", str(port)] + (extra or []),
            cwd=str(PIPELINE_DIR), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE)
        self.lines: "queue.Queue[Optional[dict]]" = queue.Queue()
        self.seen: list[dict] = []
        self._reader = threading.Thread(target=self._read, name="daemon-stdout", daemon=True)
        self._reader.start()

    def _read(self) -> None:
        assert self.proc.stdout is not None
        for raw in self.proc.stdout:
            line = raw.decode("utf-8")
            assert line.endswith("\n") and not line.endswith("\r\n"), repr(line)
            self.lines.put(json.loads(line))
        self.lines.put(None)

    def send(self, obj: Any) -> None:
        assert self.proc.stdin is not None
        text = obj if isinstance(obj, str) else json.dumps(obj, ensure_ascii=False)
        self.proc.stdin.write((text + "\n").encode("utf-8"))
        self.proc.stdin.flush()

    def next_line(self, timeout: float = 10.0) -> Optional[dict]:
        try:
            line = self.lines.get(timeout=timeout)
        except queue.Empty:
            raise AssertionError(f"daemon printed nothing for {timeout:.1f}s; seen: {self.seen}") from None
        if line is not None:
            self.seen.append(line)
        return line

    def wait_for(self, predicate: Callable[[dict], bool], timeout: float = 10.0) -> dict:
        deadline = time.monotonic() + timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise AssertionError(f"daemon never printed the expected line; seen: {self.seen}")
            line = self.next_line(remaining)
            if line is None:
                raise AssertionError(f"daemon stdout closed; seen: {self.seen}")
            if predicate(line):
                return line

    def response(self, request_id: str, timeout: float = 10.0) -> dict:
        return self.wait_for(lambda l: l.get("type") == "response" and l.get("id") == request_id, timeout)

    def close(self, timeout: float = 10.0) -> int:
        if self.proc.stdin and not self.proc.stdin.closed:
            try:
                self.proc.stdin.close()
            except OSError:
                pass
        try:
            code = self.proc.wait(timeout)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            code = self.proc.wait(5)
            raise AssertionError("daemon did not exit; killed")
        finally:
            self._reader.join(5)
            # Whatever the daemon printed on its way out.
            while True:
                try:
                    line = self.lines.get_nowait()
                except queue.Empty:
                    break
                if line is not None:
                    self.seen.append(line)
            if self.proc.stderr:
                self.stderr = self.proc.stderr.read().decode("utf-8", "replace")
                self.proc.stderr.close()
        return code


@pytest.fixture
def daemon():
    d = DaemonProcess()
    fakes: list[FakeExtension] = []
    d.attach = lambda handlers=None: fakes.append(FakeExtension(d.port, handlers).start()) or fakes[-1]  # type: ignore[attr-defined]
    first = d.next_line()
    assert first["event"] == "daemon" and first["data"]["state"] == "listening", first
    d.port = first["data"]["port"]  # type: ignore[attr-defined]
    try:
        yield d
    finally:
        for fake in fakes:
            fake.stop()
        if d.proc.poll() is None:
            d.close()


def test_daemon_round_trip(daemon: DaemonProcess):
    assert daemon.port != 0
    assert daemon.seen[0]["data"]["version"]

    daemon.send({"id": "s0", "method": "bridge.status", "params": {}})
    before = daemon.response("s0")["result"]
    assert before["listening"] is True and before["port"] == daemon.port
    assert before["extensionConnected"] is False and before["status"] is None
    assert before["statusError"]["code"] == "EXTENSION_NOT_CONNECTED"

    daemon.send({"id": "p0", "method": "status"})
    error = daemon.response("p0")["error"]
    assert error["code"] == "EXTENSION_NOT_CONNECTED" and error["details"]["port"] == daemon.port

    async def slow_send(params):
        await asyncio.sleep(0.6)
        return {"index": 0, "text": "slow answer", "html": "", "durationMs": 600, "model": "2.5 Pro"}

    fake = daemon.attach({"status": STATUS, "send": slow_send})
    connected = daemon.wait_for(lambda l: l.get("event") == "daemon"
                                and l["data"].get("state") == "extension_connected")
    assert connected["data"]["hello"]["extensionVersion"] == "0.0-test"
    daemon.wait_for(lambda l: l.get("event") == "hello")  # forwarded verbatim too

    daemon.send({"id": "s1", "method": "bridge.status"})
    after = daemon.response("s1")["result"]
    assert after["extensionConnected"] is True and after["status"] == STATUS
    assert after["hello"]["extensionVersion"] == "0.0-test" and "statusError" not in after

    daemon.send({"id": "p1", "method": "status"})
    assert daemon.response("p1") == {"type": "response", "id": "p1", "ok": True, "result": STATUS}
    assert fake.calls("status")

    # Out of order: a slow `send` then a fast `status`; the fast one answers first.
    daemon.send({"id": "slow", "method": "bridge.ask", "params": {"prompt": "hi", "newChat": False}})
    wait_until(lambda: fake.calls("send"), what="the send to reach the fake")
    daemon.send({"id": "fast", "method": "status"})
    first = daemon.wait_for(lambda l: l.get("type") == "response" and l.get("id") in ("slow", "fast"))
    assert first["id"] == "fast"
    slow = daemon.response("slow")
    assert slow["result"]["text"] == "slow answer" and slow["result"]["model"] == "2.5 Pro"
    assert fake.calls("send")[0]["text"] == "hi" and fake.calls("send")[0]["timeoutMs"] == 240000

    # Events from the extension are forwarded verbatim.
    fake.send_event("job", {"id": "job_1", "status": "done", "result": {"text": "x"}})
    job = daemon.wait_for(lambda l: l.get("event") == "job")
    assert job["data"]["id"] == "job_1"

    # Unicode survives both directions.
    fake.handlers["get_text"] = {"text": "café — ünïcode"}
    daemon.send({"id": "u", "method": "get_text", "params": {}})
    assert daemon.response("u")["result"]["text"] == "café — ünïcode"

    daemon.send("not json")
    bad = daemon.wait_for(lambda l: l.get("type") == "response" and l.get("id") is None)
    assert bad["error"]["code"] == "BAD_PARAMS"

    daemon.send({"id": "x", "method": "bridge.shutdown"})
    assert daemon.response("x")["result"] == {"ok": True}
    assert daemon.close() == 0
    assert daemon.seen[-1] == {"type": "event", "event": "daemon", "data": {"state": "stopped"}}
    assert daemon.seen[-2]["data"]["state"] == "extension_disconnected"


def test_daemon_exits_on_eof(daemon: DaemonProcess):
    daemon.send({"id": "1", "method": "bridge.status"})
    assert daemon.response("1")["ok"] is True
    assert daemon.close() == 0


def test_daemon_shutdown_unblocks_a_long_call(daemon: DaemonProcess):
    fake = daemon.attach({"send": lambda p: __import__("test_gemini_bridge").NO_REPLY})
    daemon.wait_for(lambda l: l.get("event") == "hello")
    daemon.send({"id": "hang", "method": "bridge.ask", "params": {"prompt": "hi", "timeoutS": 120}})
    wait_until(lambda: fake.calls("send"), what="the send to reach the fake")
    started = time.monotonic()
    daemon.send({"id": "bye", "method": "bridge.shutdown"})
    assert daemon.response("bye")["ok"] is True
    assert daemon.close() == 0
    assert time.monotonic() - started < 10, "shutdown must not wait for the 120 s ask"
    hang = [l for l in daemon.seen if l.get("id") == "hang"]
    assert hang and hang[0]["error"]["code"] == "EXTENSION_NOT_CONNECTED"


def test_daemon_reports_a_taken_port():
    with socket.socket() as blocker:
        blocker.bind(("127.0.0.1", 0))
        blocker.listen(1)
        port = blocker.getsockname()[1]
        d = DaemonProcess(port=port)
        first = d.next_line()
        assert first["event"] == "daemon"
        assert first["data"]["state"] == "failed" and first["data"]["reason"] == "port_in_use"
        assert first["data"]["port"] == port
        assert d.close() == 2
