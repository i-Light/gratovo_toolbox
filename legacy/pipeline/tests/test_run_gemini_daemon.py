"""The daemon launcher under the conditions of the installed app.

Run with:  python -m pytest -q tests/test_run_gemini_daemon.py    (from pipeline/)

The installed app runs the bundled embeddable CPython, whose `._pth` file puts
it in isolated mode: no working directory, no PYTHONPATH and no script folder
on `sys.path`. `python -I` is the same switch on any interpreter, so these
tests run the launcher that way -- from a working directory that is NOT
pipeline/, as the app's own could be -- and drive the daemon over its
stdin/stdout the way the app does.

The first test is the control: it shows the old `-m gemini_bridge` launch
fails under `-I` on this interpreter. Without it, the others could pass on an
interpreter that simply is not isolated and prove nothing.
"""

from __future__ import annotations

import json
import queue
import subprocess
import sys
import threading
from pathlib import Path
from typing import Optional

PIPELINE_DIR = Path(__file__).resolve().parents[1]
LAUNCHER = PIPELINE_DIR / "run_gemini_daemon.py"


def _isolated(args: list[str], cwd: Path, **kwargs) -> subprocess.Popen:
    return subprocess.Popen([sys.executable, "-I", "-u", *args], cwd=str(cwd),
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, **kwargs)


def test_module_launch_fails_in_isolated_mode():
    proc = _isolated(["-m", "gemini_bridge", "--help"], cwd=PIPELINE_DIR)
    _, err = proc.communicate(timeout=60)
    assert proc.returncode != 0
    assert b"No module named gemini_bridge" in err


def test_launcher_runs_the_cli_in_isolated_mode(tmp_path: Path):
    proc = _isolated([str(LAUNCHER), "--version"], cwd=tmp_path)
    out, err = proc.communicate(timeout=60)
    assert proc.returncode == 0, err.decode("utf-8", "replace")
    assert out.strip(), "the version goes to stdout"


class _Lines:
    """The daemon's stdout as parsed JSON lines, readable with a timeout."""

    def __init__(self, proc: subprocess.Popen):
        self._queue: "queue.Queue[Optional[dict]]" = queue.Queue()
        self.seen: list[dict] = []
        thread = threading.Thread(target=self._read, args=(proc,), daemon=True)
        thread.start()

    def _read(self, proc: subprocess.Popen) -> None:
        assert proc.stdout is not None
        for raw in proc.stdout:
            self._queue.put(json.loads(raw.decode("utf-8")))
        self._queue.put(None)

    def next(self, timeout: float = 30.0) -> Optional[dict]:
        line = self._queue.get(timeout=timeout)
        if line is not None:
            self.seen.append(line)
        return line

    def response(self, request_id: str, timeout: float = 30.0) -> dict:
        while True:
            line = self.next(timeout)
            assert line is not None, f"stdout closed before response {request_id!r}; seen {self.seen}"
            if line.get("type") == "response" and line.get("id") == request_id:
                return line


def _send(proc: subprocess.Popen, request: dict) -> None:
    assert proc.stdin is not None
    proc.stdin.write((json.dumps(request) + "\n").encode("utf-8"))
    proc.stdin.flush()


def test_launcher_serves_the_daemon_protocol_in_isolated_mode(tmp_path: Path):
    """What the app does on start-up, end to end, on an isolated interpreter."""
    proc = _isolated([str(LAUNCHER), "daemon", "--port", "0", "--data-dir", str(tmp_path)],
                     cwd=tmp_path)
    lines = _Lines(proc)
    try:
        first = lines.next()
        assert first is not None, proc.stderr.read().decode("utf-8", "replace") if proc.stderr else ""
        assert first["event"] == "daemon" and first["data"]["state"] == "listening", first
        assert first["data"]["port"] > 0

        _send(proc, {"id": "s", "method": "bridge.status"})
        status = lines.response("s")
        assert status["ok"] is True
        assert status["result"]["listening"] is True
        assert status["result"]["extensionConnected"] is False

        # An action the daemon does not know is a normal BAD_PARAMS response, never a crash -- the
        # old drafting actions (lint_email among them) went with decision old-files.
        _send(proc, {"id": "l", "method": "action.lint_email", "params": {}})
        gone = lines.response("l")
        assert gone["ok"] is False, gone
        assert gone["error"]["code"] == "BAD_PARAMS"

        _send(proc, {"id": "bye", "method": "bridge.shutdown"})
        assert lines.response("bye")["ok"] is True
        assert proc.wait(timeout=30) == 0
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait(10)
        for stream in (proc.stdin, proc.stdout, proc.stderr):
            if stream is not None:
                stream.close()
