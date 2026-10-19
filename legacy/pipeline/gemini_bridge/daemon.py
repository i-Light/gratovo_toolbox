"""`python -m gemini_bridge daemon` -- the long-lived process the Flutter app talks to.

JSON lines in on stdin, JSON lines out on stdout, exactly as DAEMON.md
describes. stdout carries protocol lines and nothing else: every log line
goes to stderr, because one stray `print` on stdout would be a line the app
cannot parse.

Threads
-------
  * a reader thread   -- blocks on stdin and hands each line to the main
                         thread through a queue; it is the only thing that
                         ever touches stdin, and EOF is delivered as None.
  * the main thread   -- parses lines, submits requests to the pool, and
                         waits for either EOF or `bridge.shutdown`.
  * a pool of 4       -- runs requests concurrently, so a three-minute
                         `bridge.ask` never delays a `bridge.status`.
                         Responses are written as each finishes, hence out
                         of order, hence the `id`.
  * the bridge's own  -- the WebSocket loop and the event dispatcher (server.py).

All writes to stdout go through one lock and end with a flush, so a response
from a pool thread and an event from the dispatcher never interleave and
the app never waits on a buffered line.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import logging
import os
import queue
import sys
import threading
import traceback
from pathlib import Path
from typing import Any, Optional, TextIO

from . import __version__, actions, browser_manager
from .client import Gemini
from .errors import ExtensionNotConnected, GeminiError
from .server import DEFAULT_PORT

WORKERS = 4
# How long a proxied call may take before the daemon gives up on it, when
# the request carries no `timeoutMs` of its own. `send` waits for a whole
# answer; everything else is a page interaction.
PROXY_DEFAULT_S = {"send": 180.0}
PROXY_OTHER_S = 45.0
PROXY_GRACE_S = 15.0
FORWARDED_EVENTS = ("hello", "job", "status", "log")

log = logging.getLogger("gemini_bridge.daemon")


class _Out:
    """The one writer of protocol lines: serialised, `\\n`-terminated, flushed."""

    def __init__(self, stream: TextIO):
        self._stream = stream
        self._lock = threading.Lock()

    def line(self, obj: dict) -> None:
        text = json.dumps(obj, ensure_ascii=False, default=str, separators=(",", ":"))
        with self._lock:
            try:
                self._stream.write(text + "\n")
                self._stream.flush()
            except (OSError, ValueError):
                # The app is gone (broken pipe / closed stream); the reader
                # will see EOF and the process exits on its own.
                pass

    def response(self, request_id: Any, result: Any) -> None:
        self.line({"type": "response", "id": request_id, "ok": True, "result": result})

    def error(self, request_id: Any, code: str, message: str, details: Optional[dict] = None) -> None:
        self.line({"type": "response", "id": request_id, "ok": False,
                   "error": {"code": code, "message": message, "details": details or {}}})

    def event(self, event: str, data: Any) -> None:
        self.line({"type": "event", "event": event, "data": data})


def _configure_streams() -> None:
    """UTF-8 both ways and `\\n` line endings on stdout, whatever the platform default."""
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace", newline="\n")
        except (ValueError, OSError):
            pass
    if hasattr(sys.stdin, "reconfigure"):
        try:
            sys.stdin.reconfigure(encoding="utf-8", errors="replace")
        except (ValueError, OSError):
            pass
    if hasattr(sys.stderr, "reconfigure"):
        try:
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
        except (ValueError, OSError):
            pass


class Daemon:
    """One daemon: a `Gemini` plus the stdin/stdout protocol around it."""

    def __init__(self, port: int, data_dir: Optional[Path], out: _Out):
        self.port = port
        self.out = out
        self.gemini = Gemini(port=port, auto_open=False, data_dir=data_dir,
                             logger=logging.getLogger("gemini_bridge"))
        self.stop_requested = threading.Event()

    # --- wiring ------------------------------------------------------------

    def start(self) -> bool:
        """Starts the server; writes the `daemon` event and returns whether it is listening."""
        try:
            self.gemini.server.start(bind_timeout=0)
        except OSError as error:
            log.error("cannot listen on port %s: %s", self.port, error)
            self.out.event("daemon", {"state": "failed", "reason": "port_in_use",
                                      "port": self.port, "message": str(error)})
            return False
        # The daemon's own state change goes out before the verbatim `hello`
        # that caused it, so the app flips to "connected" first.
        self.gemini.on("hello", lambda data: self.out.event(
            "daemon", {"state": "extension_connected", "hello": data}))
        self.gemini.on("disconnected", lambda data: self.out.event(
            "daemon", {"state": "extension_disconnected", **data}))
        for name in FORWARDED_EVENTS:
            self.gemini.on(name, self._forwarder(name))
        self.out.event("daemon", {"state": "listening", "port": self.gemini.port,
                                  "pid": os.getpid(), "version": __version__})
        return True

    def _forwarder(self, name: str):
        return lambda data: self.out.event(name, data)

    def emit(self, event: str, data: Any) -> None:
        """What a long action or a browser step calls to report: one `event` line on stdout.

        Handed to `actions.run_action` and `browser_manager` as their `emit`
        (DAEMON.md, "progress events"); the same single writer as every other line.
        """
        self.out.event(event, data)

    def stop(self) -> None:
        # Stopping the server fails every in-flight call with
        # ExtensionNotConnected, which is what lets a pool thread stuck in a
        # long `send` return promptly instead of holding the exit.
        self.gemini.close()

    # --- one request ---------------------------------------------------------

    def handle(self, request: dict) -> None:
        request_id = request.get("id")
        method = request.get("method")
        params = request.get("params")
        if not isinstance(method, str) or not method:
            self.out.error(request_id, "BAD_PARAMS", "request needs a string `method`")
            return
        if params is None:
            params = {}
        if not isinstance(params, dict):
            self.out.error(request_id, "BAD_PARAMS", "`params` must be an object")
            return
        try:
            result = self.dispatch(method, params)
        except GeminiError as error:
            self.out.error(request_id, error.code, error.message, self._details(error))
            return
        except NotImplementedError:
            # A method the contract registered whose body nobody has written yet
            # (CONTRACT_GEMINI.md section 6): a plain answer, not a crash.
            log.warning("request %r (%s) is not implemented yet", request_id, method)
            self.out.error(request_id, "NOT_IMPLEMENTED", "not implemented yet", {"method": method})
            return
        except Exception as error:  # noqa: BLE001 - must become a response, never a crash
            log.exception("request %r (%s) crashed", request_id, method)
            self.out.error(request_id, "INTERNAL", f"{type(error).__name__}: {error}",
                           {"stack": traceback.format_exc()})
            return
        self.out.response(request_id, result)

    def _details(self, error: GeminiError) -> dict:
        details = dict(error.details)
        if isinstance(error, ExtensionNotConnected):
            details.setdefault("port", self.gemini.port)
        return details

    def dispatch(self, method: str, params: dict) -> Any:
        if method.startswith("bridge."):
            return self.bridge_method(method[len("bridge."):], params)
        if method.startswith("action."):
            return actions.run_action(self.gemini, method, params, emit=self.emit)
        return self.proxy(method, params)

    def proxy(self, method: str, params: dict) -> Any:
        wait_ms = params.get("timeoutMs")
        if isinstance(wait_ms, (int, float)) and wait_ms > 0:
            timeout = wait_ms / 1000.0 + PROXY_GRACE_S
        else:
            timeout = PROXY_DEFAULT_S.get(method, PROXY_OTHER_S) + PROXY_GRACE_S
        return self.gemini.call(method, params, timeout=timeout)

    def bridge_method(self, name: str, params: dict) -> Any:
        g = self.gemini
        if name == "status":
            return self.bridge_status()
        if name == "ensure_account":
            match = params.get("match")
            if not isinstance(match, str) or not match.strip():
                raise GeminiError("BAD_PARAMS", "bridge.ensure_account needs `match`")
            return g.ensure_account(match)
        if name == "heal":
            element = params.get("element")
            if not isinstance(element, str) or not element:
                raise GeminiError("BAD_PARAMS", "bridge.heal needs `element`")
            pick = params.get("pick", 0)
            strategy, suggestions = g._heal(element, int(pick or 0))  # noqa: SLF001
            return {"element": element, "strategy": strategy, "suggestions": suggestions}
        if name == "open_gem":
            gem = params.get("gem")
            if not isinstance(gem, str) or not gem.strip():
                raise GeminiError("BAD_PARAMS", "bridge.open_gem needs `gem`")
            return g.open_gem(gem)
        if name == "ask":
            prompt = params.get("prompt")
            if not isinstance(prompt, str) or not prompt:
                raise GeminiError("BAD_PARAMS", "bridge.ask needs `prompt`")
            new_chat = params.get("newChat")
            new_chat = True if new_chat is None else bool(new_chat)
            timeout = params.get("timeoutS")
            timeout = 240.0 if timeout is None else float(timeout)
            gem = params.get("gem")
            if gem:
                g.open_gem(str(gem))
                new_chat = False  # the gem's page is already a fresh chat
            result = g.send(prompt, wait=True, new_chat=new_chat, model=params.get("model") or None,
                            interrupt=bool(params.get("interrupt")), timeout=timeout)
            return {"text": result.get("text", ""), "html": result.get("html", ""),
                    "model": result.get("model"), "durationMs": result.get("durationMs")}
        if name == "wait":
            job_id = params.get("jobId")
            if not isinstance(job_id, str) or not job_id:
                raise GeminiError("BAD_PARAMS", "bridge.wait needs `jobId`")
            timeout = params.get("timeoutS")
            timeout = 300.0 if timeout is None else float(timeout)
            return g.wait_job(job_id, timeout=timeout).raw
        if name in ("browser_info", "ensure_window", "install_addon") and params.get("browser"):
            # Settings' browser travels with every browser call; from then on
            # only that browser's extension may hold the bridge.
            g.server.set_browser(str(params["browser"]))
        if name == "browser_info":
            return browser_manager.browser_info(params, data_dir=g.data_dir)
        if name == "ensure_window":
            return browser_manager.ensure_window(g, params, emit=self.emit)
        if name == "install_addon":
            return browser_manager.install_addon(params, data_dir=g.data_dir, emit=self.emit)
        if name == "shutdown":
            self.stop_requested.set()
            return {"ok": True}
        raise GeminiError("BAD_PARAMS", f"unknown method 'bridge.{name}'")

    def bridge_status(self) -> dict:
        """The daemon's own view; never throws, the extension's status is best-effort."""
        g = self.gemini
        result: dict = {"listening": g.server.running, "port": g.port,
                        "extensionConnected": g.connected, "hello": g.server.hello,
                        "status": None}
        if not g.connected:
            result["statusError"] = {"code": "EXTENSION_NOT_CONNECTED",
                                     "message": "no extension is connected"}
            return result
        try:
            result["status"] = g.status()
        except GeminiError as error:
            result["statusError"] = {"code": error.code, "message": error.message}
        except Exception as error:  # noqa: BLE001 - "never throws" is the contract
            result["statusError"] = {"code": "INTERNAL", "message": f"{type(error).__name__}: {error}"}
        return result


def _read_lines(stream: TextIO, lines: "queue.Queue[Optional[str]]") -> None:
    try:
        for line in stream:
            lines.put(line)
    except (OSError, ValueError):
        pass
    finally:
        lines.put(None)


def serve(port: int = DEFAULT_PORT, data_dir: Optional[Path] = None,
          stdin: Optional[TextIO] = None, stdout: Optional[TextIO] = None) -> int:
    """Runs the daemon until EOF on stdin or `bridge.shutdown`; returns the exit code."""
    stdin = stdin or sys.stdin
    out = _Out(stdout or sys.stdout)
    daemon = Daemon(port, data_dir, out)
    if not daemon.start():
        return 2

    lines: "queue.Queue[Optional[str]]" = queue.Queue()
    reader = threading.Thread(target=_read_lines, args=(stdin, lines),
                              name="gemini-daemon-stdin", daemon=True)
    reader.start()
    pool = concurrent.futures.ThreadPoolExecutor(
        max_workers=WORKERS, thread_name_prefix="gemini-daemon-worker")
    try:
        while not daemon.stop_requested.is_set():
            try:
                line = lines.get(timeout=0.25)
            except queue.Empty:
                continue
            if line is None:
                log.info("stdin closed; shutting down")
                break
            line = line.strip()
            if not line:
                continue
            try:
                request = json.loads(line)
            except ValueError as error:
                out.error(None, "BAD_PARAMS", f"line is not valid JSON: {error}")
                continue
            if not isinstance(request, dict):
                out.error(None, "BAD_PARAMS", "a request must be a JSON object")
                continue
            pool.submit(daemon.handle, request)
    finally:
        daemon.stop()
        pool.shutdown(wait=True, cancel_futures=True)
        out.event("daemon", {"state": "stopped"})
    return 0


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m gemini_bridge daemon",
        description="JSON lines on stdin/stdout for the app; see DAEMON.md.")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--data-dir", type=Path, default=None,
                        help="where `gemini skills/` lives (default: the repo's data/)")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(argv)
    _configure_streams()
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        stream=sys.stderr, format="%(asctime)s %(name)s %(levelname)s: %(message)s")
    return serve(port=args.port, data_dir=args.data_dir)


if __name__ == "__main__":
    sys.exit(main())
