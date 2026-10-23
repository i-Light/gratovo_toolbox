"""The bridge's entry point under the conditions main starts it in.

Main runs `<python> -I -u -m gratovo_pipeline.gemini ...` (gemini-service.ts, `bridgeArgs`).
`-I` is isolated mode: no working directory, no PYTHONPATH and no script folder on `sys.path`,
and no PYTHON* variables (so not PYTHONIOENCODING either: the entry point sets its streams to
UTF-8 itself). These tests run it exactly that way, with this repository's interpreter, from a
working directory that is NOT services/pipeline, and drive it over stdin and stdout the way main
does.

The old file tested `run_gemini_daemon.py`, a launcher the old app needed because its bundled
interpreter could not find `gemini_bridge` with `-m`. The package is installed now, so `-m`
finds it from anywhere; the launcher is gone, and so is the CLI it also ran (plan D13).

The first test is the control: it shows this interpreter really is isolated under `-I`.
Without it, the others could pass on an interpreter that simply is not isolated and prove
nothing.
"""

from __future__ import annotations

import json
import queue
import subprocess
import sys
import threading
from pathlib import Path
from typing import IO, Any, cast

from fake_extension import free_port
from test_gemini_daemon import gemini_problems


def _isolated(args: list[str], cwd: Path) -> subprocess.Popen[bytes]:
    # Our own interpreter, the module main starts.
    return subprocess.Popen(  # noqa: S603 - our own interpreter
        [sys.executable, "-I", "-u", *args],
        cwd=cwd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def test_the_interpreter_is_isolated_under_dash_i(tmp_path: Path) -> None:
    proc = _isolated(
        [
            "-c",
            "import os, sys; print(sys.flags.isolated, '' in sys.path or os.getcwd() in sys.path)",
        ],
        cwd=tmp_path,
    )
    out, err = proc.communicate(timeout=60)
    assert proc.returncode == 0, err.decode("utf-8", "replace")
    assert out.decode("utf-8").split() == ["1", "False"]


def test_the_module_runs_in_isolated_mode_from_another_folder(tmp_path: Path) -> None:
    proc = _isolated(["-m", "gratovo_pipeline.gemini", "--help"], cwd=tmp_path)
    out, err = proc.communicate(timeout=60)
    assert proc.returncode == 0, err.decode("utf-8", "replace")
    assert b"--profile-dir" in out, "the usage goes to stdout"


class _Lines:
    """The daemon's stdout as parsed JSON lines, readable with a timeout, each one checked
    against main's schemas."""

    def __init__(self, stream: IO[bytes], schema: dict[str, Any]) -> None:
        self._queue: queue.Queue[str | None] = queue.Queue()
        self._schema = schema
        self.methods: dict[str, str] = {}
        self.seen: list[dict[str, Any]] = []
        thread = threading.Thread(target=self._read, args=(stream,), daemon=True)
        thread.start()

    def _read(self, stream: IO[bytes]) -> None:
        for raw in stream:
            self._queue.put(raw.decode("utf-8"))
        self._queue.put(None)

    def next(self, timeout: float = 30.0) -> dict[str, Any] | None:
        line = self._queue.get(timeout=timeout)
        if line is None:
            return None
        assert line.endswith("\n"), repr(line)
        assert not line.endswith("\r\n"), repr(line)
        message = cast("dict[str, Any]", json.loads(line))
        request_id = message.get("id")
        method = self.methods.get(request_id) if isinstance(request_id, str) else None
        problems = gemini_problems(self._schema, message, method)
        assert problems == [], (problems, message)
        self.seen.append(message)
        return message

    def response(self, request_id: str, timeout: float = 30.0) -> dict[str, Any]:
        while True:
            line = self.next(timeout)
            assert line is not None, f"stdout closed before response {request_id!r}; {self.seen}"
            if line.get("type") == "response" and line.get("id") == request_id:
                return line


def _send(proc: subprocess.Popen[bytes], lines: _Lines, request: dict[str, Any]) -> None:
    assert proc.stdin is not None
    lines.methods[str(request["id"])] = str(request["method"])
    proc.stdin.write((json.dumps(request) + "\n").encode("utf-8"))
    proc.stdin.flush()


def test_the_module_serves_the_daemon_protocol_in_isolated_mode(
    tmp_path: Path, gemini_schema: dict[str, Any]
) -> None:
    """What main does on start-up, end to end, on an isolated interpreter."""
    port = free_port()  # never 8765: a real bridge may hold it
    proc = _isolated(
        [
            "-m",
            "gratovo_pipeline.gemini",
            "--port",
            str(port),
            "--data-dir",
            str(tmp_path / "example-pipeline"),
            "--profile-dir",
            str(tmp_path / "gemini-profile"),
            "--extension-dir",
            str(tmp_path / "no-extension-yet"),
        ],
        cwd=tmp_path,
    )
    assert proc.stdout is not None
    assert proc.stderr is not None
    lines = _Lines(proc.stdout, gemini_schema)
    try:
        first = lines.next()
        assert first is not None, proc.stderr.read().decode("utf-8", "replace")
        assert first["event"] == "daemon", first
        assert first["data"]["state"] == "listening", first
        assert first["data"]["port"] == port

        _send(proc, lines, {"id": "s", "method": "bridge.status", "params": {}})
        status = lines.response("s")
        assert status["ok"] is True
        assert status["result"]["listening"] is True
        assert status["result"]["extensionConnected"] is False

        # An action the daemon does not know is a normal BAD_PARAMS response, never a crash --
        # the old drafting actions (lint_email among them) went with decision old-files.
        _send(proc, lines, {"id": "l", "method": "action.lint_email", "params": {}})
        gone = lines.response("l")
        assert gone["ok"] is False, gone
        assert gone["error"]["code"] == "BAD_PARAMS"

        # EOF on stdin is how main's going away looks: the daemon stops and exits 0.
        assert proc.stdin is not None
        proc.stdin.close()
        assert proc.wait(timeout=30) == 0
        last: dict[str, Any] | None = None
        while (line := lines.next()) is not None:
            last = line
        assert last == {"type": "event", "event": "daemon", "data": {"state": "stopped"}}
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait(10)
        for stream in (proc.stdin, proc.stdout, proc.stderr):
            if stream is not None:
                stream.close()
