"""Tests for `python -I -u -m gratovo_pipeline.gemini`: the process main runs (plan D2).

The daemon is started as a real subprocess and driven over its stdin/stdout, because that is the
only interface main has: what is pinned is DAEMON.md's contract as observed from outside -- the
first line names the port, every response carries its request's id even when they come back out
of order, extension events are forwarded, and the process exits cleanly on `bridge.shutdown`, on
EOF, and with code 2 when the port is taken.

The extension is the `FakeExtension` (fake_extension.py), dialling the port the daemon printed.
Every line the daemon writes is checked against `gemini.schema.json` (`fromGemini`, and the
`daemon` and `progress` events' data), and every answer to a typed method against its result
schema (`results`), so main and the bridge cannot drift apart unnoticed.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import queue
import socket
import subprocess
import sys
import threading
import time
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any, cast

import pytest
from fake_extension import NO_REPLY, THREAD_PREFIXES, FakeExtension, Scripted, wait_until
from helpers import schema_errors
from test_gemini_bridge import STATUS


def gemini_problems(
    schema: dict[str, Any], message: dict[str, Any], method: str | None = None
) -> list[str]:
    """What main's schemas find wrong with one line the bridge wrote; empty when it fits.

    The envelope (`fromGemini`), the data of a `daemon` or `progress` event, and, when the
    request's `method` is one main types, the result of a successful response.
    """
    problems = schema_errors(schema["fromGemini"], message)
    events: dict[str, Any] = schema["events"]
    if message.get("type") == "event" and message.get("event") in events:
        problems += schema_errors(events[message["event"]], message.get("data"))
    results: dict[str, Any] = schema["results"]
    if message.get("type") == "response" and message.get("ok") is True and method in results:
        problems += [f"{method}: {p}" for p in schema_errors(results[method], message["result"])]
    return problems


class DaemonProcess:
    """A running daemon: `send()` requests, `next_line()` / `wait_for()` its output.

    Every line read is checked against main's schemas (`gemini_problems`); a line that does not
    fit fails the test right where it is read.
    """

    def __init__(
        self,
        folder: Path,
        schema: dict[str, Any],
        port: int = 0,
        extra: list[str] | None = None,
    ) -> None:
        self.schema = schema
        self.port = port
        self.stderr = ""
        args = [
            sys.executable,
            "-I",
            "-u",
            "-m",
            "gratovo_pipeline.gemini",
            "--port",
            str(port),
            "--data-dir",
            str(folder / "example-pipeline"),
            "--profile-dir",
            str(folder / "gemini-profile"),
            "--extension-dir",
            str(folder / "no-extension-yet"),
            *(extra or []),
        ]
        # Our own interpreter and module, from a folder that is not services/pipeline.
        self.proc = subprocess.Popen(  # noqa: S603 - our own interpreter and module
            args,
            cwd=folder,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self.lines: queue.Queue[str | None] = queue.Queue()
        self.seen: list[dict[str, Any]] = []
        self.methods: dict[str, str] = {}
        self._stderr: list[bytes] = []
        self._reader = threading.Thread(target=self._read, name="daemon-stdout", daemon=True)
        self._reader.start()
        # Drained all along, so a chatty daemon can never block on a full stderr pipe.
        self._err_reader = threading.Thread(target=self._read_err, name="daemon-err", daemon=True)
        self._err_reader.start()

    def _read(self) -> None:
        assert self.proc.stdout is not None
        for raw in self.proc.stdout:
            self.lines.put(raw.decode("utf-8"))
        self.lines.put(None)

    def _read_err(self) -> None:
        assert self.proc.stderr is not None
        for raw in self.proc.stderr:
            self._stderr.append(raw)

    def _parse(self, line: str) -> dict[str, Any]:
        assert line.endswith("\n"), repr(line)
        assert not line.endswith("\r\n"), repr(line)
        message = cast("dict[str, Any]", json.loads(line))
        request_id = message.get("id")
        method = self.methods.get(request_id) if isinstance(request_id, str) else None
        problems = gemini_problems(self.schema, message, method)
        assert problems == [], (problems, message)
        self.seen.append(message)
        return message

    def send(self, obj: dict[str, Any] | str) -> None:
        assert self.proc.stdin is not None
        if isinstance(obj, dict) and isinstance(obj.get("id"), str):
            self.methods[obj["id"]] = str(obj.get("method"))
        text = obj if isinstance(obj, str) else json.dumps(obj, ensure_ascii=False)
        self.proc.stdin.write((text + "\n").encode("utf-8"))
        self.proc.stdin.flush()

    def next_line(self, timeout: float = 10.0) -> dict[str, Any] | None:
        try:
            line = self.lines.get(timeout=timeout)
        except queue.Empty:
            raise AssertionError(
                f"daemon printed nothing for {timeout:.1f}s; seen: {self.seen}"
            ) from None
        return None if line is None else self._parse(line)

    def wait_for(
        self, predicate: Callable[[dict[str, Any]], bool], timeout: float = 10.0
    ) -> dict[str, Any]:
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

    def response(self, request_id: str, timeout: float = 10.0) -> dict[str, Any]:
        return self.wait_for(
            lambda line: line.get("type") == "response" and line.get("id") == request_id, timeout
        )

    def first(self) -> dict[str, Any]:
        """The first line, which names the port; remembers the port the daemon listens on."""
        first = self.next_line()
        assert first is not None, self.stderr
        if first["data"]["state"] == "listening":
            self.port = int(first["data"]["port"])
        return first

    def close(self, timeout: float = 10.0) -> int:
        if self.proc.stdin and not self.proc.stdin.closed:
            with contextlib.suppress(OSError):
                self.proc.stdin.close()
        try:
            code = self.proc.wait(timeout)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            self.proc.wait(5)
            raise AssertionError("daemon did not exit; killed") from None
        finally:
            self._reader.join(5)
            self._err_reader.join(5)
            # Whatever the daemon printed on its way out.
            while True:
                try:
                    line = self.lines.get_nowait()
                except queue.Empty:
                    break
                if line is not None:
                    self._parse(line)
            self.stderr = b"".join(self._stderr).decode("utf-8", "replace")
            for stream in (self.proc.stdout, self.proc.stderr):
                if stream is not None:
                    stream.close()
        return code


class Running:
    """A started daemon plus the fakes attached to it."""

    def __init__(self, process: DaemonProcess) -> None:
        self.process = process
        self.fakes: list[FakeExtension] = []

    def attach(self, handlers: dict[str, Scripted] | None = None) -> FakeExtension:
        fake = FakeExtension(self.process.port, handlers).start()
        self.fakes.append(fake)
        return fake


@pytest.fixture(autouse=True)
def no_threads_left_behind() -> Iterator[None]:
    yield
    deadline = time.monotonic() + 2
    ours: list[str] = []
    while time.monotonic() < deadline:
        ours = [t.name for t in threading.enumerate() if t.name.startswith(THREAD_PREFIXES)]
        if not ours:
            return
        time.sleep(0.05)
    raise AssertionError(f"threads left behind: {ours}")


@pytest.fixture
def running(tmp_path: Path, gemini_schema: dict[str, Any], loopback: None) -> Iterator[Running]:
    process = DaemonProcess(tmp_path, gemini_schema)
    first = process.first()
    assert first["event"] == "daemon", first
    assert first["data"]["state"] == "listening", first
    run = Running(process)
    try:
        yield run
    finally:
        for fake in run.fakes:
            fake.stop()
        if process.proc.poll() is None:
            process.close()


def test_daemon_round_trip(running: Running) -> None:
    daemon = running.process
    assert daemon.port != 0
    assert daemon.seen[0]["data"]["version"]

    daemon.send({"id": "s0", "method": "bridge.status", "params": {}})
    before = daemon.response("s0")["result"]
    assert before["listening"] is True
    assert before["port"] == daemon.port
    assert before["extensionConnected"] is False
    assert before["status"] is None
    assert before["statusError"]["code"] == "EXTENSION_NOT_CONNECTED"

    daemon.send({"id": "p0", "method": "status"})
    error = daemon.response("p0")["error"]
    assert error["code"] == "EXTENSION_NOT_CONNECTED"
    assert error["details"]["port"] == daemon.port

    async def slow_send(_params: dict[str, Any]) -> dict[str, Any]:
        await asyncio.sleep(0.6)
        return {
            "index": 0,
            "text": "slow answer",
            "html": "",
            "durationMs": 600,
            "model": "2.5 Pro",
        }

    fake = running.attach({"status": STATUS, "send": slow_send})
    connected = daemon.wait_for(
        lambda line: (
            line.get("event") == "daemon" and line["data"].get("state") == "extension_connected"
        )
    )
    assert connected["data"]["hello"]["extensionVersion"] == "0.0-test"
    daemon.wait_for(lambda line: line.get("event") == "hello")  # forwarded verbatim too

    daemon.send({"id": "s1", "method": "bridge.status"})
    after = daemon.response("s1")["result"]
    assert after["extensionConnected"] is True
    assert after["status"] == STATUS
    assert after["hello"]["extensionVersion"] == "0.0-test"
    assert "statusError" not in after

    daemon.send({"id": "p1", "method": "status"})
    assert daemon.response("p1") == {"type": "response", "id": "p1", "ok": True, "result": STATUS}
    assert fake.calls("status")

    # Out of order: a slow `send` then a fast `status`; the fast one answers first.
    daemon.send(
        {"id": "slow", "method": "bridge.ask", "params": {"prompt": "hi", "newChat": False}}
    )
    wait_until(lambda: fake.calls("send"), what="the send to reach the fake")
    daemon.send({"id": "fast", "method": "status"})
    first = daemon.wait_for(
        lambda line: line.get("type") == "response" and line.get("id") in ("slow", "fast")
    )
    assert first["id"] == "fast"
    slow = daemon.response("slow")
    assert slow["result"]["text"] == "slow answer"
    assert slow["result"]["model"] == "2.5 Pro"
    assert fake.calls("send")[0]["text"] == "hi"
    assert fake.calls("send")[0]["timeoutMs"] == 240000

    # Events from the extension are forwarded verbatim.
    fake.send_event("job", {"id": "job_1", "status": "done", "result": {"text": "x"}})
    job = daemon.wait_for(lambda line: line.get("event") == "job")
    assert job["data"]["id"] == "job_1"

    # Unicode survives both directions.
    fake.handlers["get_text"] = {"text": "café — ünïcode"}
    daemon.send({"id": "u", "method": "get_text", "params": {}})
    assert daemon.response("u")["result"]["text"] == "café — ünïcode"

    daemon.send("not json")
    bad = daemon.wait_for(lambda line: line.get("type") == "response" and line.get("id") is None)
    assert bad["error"]["code"] == "BAD_PARAMS"

    daemon.send({"id": "x", "method": "bridge.shutdown"})
    assert daemon.response("x")["result"] == {"ok": True}
    assert daemon.close() == 0
    assert daemon.seen[-1] == {"type": "event", "event": "daemon", "data": {"state": "stopped"}}
    assert daemon.seen[-2]["data"]["state"] == "extension_disconnected"


def test_daemon_exits_on_eof(running: Running) -> None:
    daemon = running.process
    daemon.send({"id": "1", "method": "bridge.status"})
    assert daemon.response("1")["ok"] is True
    assert daemon.close() == 0


def test_daemon_shutdown_unblocks_a_long_call(running: Running) -> None:
    daemon = running.process
    fake = running.attach({"send": lambda _p: NO_REPLY})
    daemon.wait_for(lambda line: line.get("event") == "hello")
    daemon.send({"id": "hang", "method": "bridge.ask", "params": {"prompt": "hi", "timeoutS": 120}})
    wait_until(lambda: fake.calls("send"), what="the send to reach the fake")
    started = time.monotonic()
    daemon.send({"id": "bye", "method": "bridge.shutdown"})
    assert daemon.response("bye")["ok"] is True
    assert daemon.close() == 0
    assert time.monotonic() - started < 10, "shutdown must not wait for the 120 s ask"
    hang = [line for line in daemon.seen if line.get("id") == "hang"]
    assert hang
    assert hang[0]["error"]["code"] == "EXTENSION_NOT_CONNECTED"


def test_daemon_reports_a_taken_port(tmp_path: Path, gemini_schema: dict[str, Any]) -> None:
    with socket.socket() as blocker:
        blocker.bind(("127.0.0.1", 0))
        blocker.listen(1)
        port = int(blocker.getsockname()[1])
        d = DaemonProcess(tmp_path, gemini_schema, port=port)
        first = d.first()
        assert first["event"] == "daemon"
        assert first["data"]["state"] == "failed"
        assert first["data"]["reason"] == "port_in_use"
        assert first["data"]["port"] == port
        assert d.close() == 2
