"""`python -I -u -m gratovo_pipeline.gemini` -- the long-lived process main talks to (plan D2).

JSON lines in on stdin, JSON lines out on stdout, exactly as DAEMON.md describes and
`gemini-protocol.ts` types. stdout carries protocol lines and nothing else: every log line goes to
stderr, because one stray `print` on stdout would be a line main cannot parse.

Threads
-------
  * a reader thread   -- blocks on stdin and hands each line to the main thread through a queue;
                         it is the only thing that ever touches stdin, and EOF is delivered as
                         None.
  * the main thread   -- parses lines, submits requests to the pool, and waits for either EOF or
                         `bridge.shutdown`.
  * a pool of 4       -- runs requests concurrently, so a three-minute `bridge.ask` never delays
                         a `bridge.status`. Responses are written as each finishes, hence out of
                         order, hence the `id`.
  * the bridge's own  -- the WebSocket loop and the event dispatcher (server.py).

All writes to stdout go through one lock and end with a flush, so a response from a pool thread
and an event from the dispatcher never interleave and main never waits on a buffered line.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import io
import json
import logging
import os
import queue
import re
import sys
import threading
import traceback
from collections.abc import Callable, MutableMapping
from pathlib import Path
from typing import Any, TextIO

from . import __version__, actions, pause
from .browser import manager as browser_manager
from .browser.manager import BrowserPaths
from .client import Gemini, SendGap
from .errors import ExtensionNotConnected, GeminiError
from .pacing_state import PACING_FILE, PacingStore
from .server import DEFAULT_PORT

WORKERS = 4
# How long a proxied call may take before the daemon gives up on it, when the request carries no
# `timeoutMs` of its own. `send` waits for a whole answer; everything else is a page interaction.
PROXY_DEFAULT_S = {"send": 180.0}
PROXY_OTHER_S = 45.0
PROXY_GRACE_S = 15.0
FORWARDED_EVENTS = ("hello", "job", "status", "log")
# What main's schema allows (gemini-protocol.ts): a request id, and an error's message.
MAX_ID_LENGTH = 100
MAX_MESSAGE_LENGTH = 4000

#: The variable main passes this launch's bridge token in (plan D13); never argv, never logged.
TOKEN_ENV = "GRATOVO_BRIDGE_TOKEN"  # noqa: S105 - the variable's name, not a token
_TOKEN_RE = re.compile(r"^[0-9a-f]{64}$")

log = logging.getLogger(__name__)


class BadBridgeTokenError(ValueError):
    """`GRATOVO_BRIDGE_TOKEN` is set but is not 64 lowercase hex characters."""


def read_bridge_token(environ: MutableMapping[str, str] | None = None) -> str | None:
    """This launch's token from the environment, removed from it at once (plan D13).

    Removed so nothing this process starts (Firefox, Edge, yt-dlp) inherits it. Absent or empty is
    no token, as before main sent one. Anything else that is not 64 lowercase hex characters is
    refused: a bridge that quietly ran without the token main thinks it set would let any Firefox
    extension in. The message never holds the value.
    """
    env = os.environ if environ is None else environ
    value = env.pop(TOKEN_ENV, None)
    if not value:
        return None
    if not _TOKEN_RE.fullmatch(value):
        raise BadBridgeTokenError(f"{TOKEN_ENV} must be 64 lowercase hex characters")
    return value


def _request_id(value: object) -> str | None:
    """The id to answer with: the request's own, or None for one main could not have sent."""
    if isinstance(value, str) and 1 <= len(value) <= MAX_ID_LENGTH:
        return value
    return None


class Out:
    """The one writer of protocol lines: serialised, `\\n`-terminated, flushed."""

    def __init__(self, stream: TextIO) -> None:
        self._stream = stream
        self._lock = threading.Lock()

    def line(self, obj: dict[str, Any]) -> None:
        text = json.dumps(obj, ensure_ascii=False, default=str, separators=(",", ":"))
        with self._lock:
            try:
                self._stream.write(text + "\n")
                self._stream.flush()
            except OSError, ValueError:
                # Main is gone (broken pipe / closed stream); the reader will see EOF and the
                # process exits on its own.
                pass

    def response(self, request_id: str | None, result: Any) -> None:
        self.line({"type": "response", "id": request_id, "ok": True, "result": result})

    def error(
        self,
        request_id: str | None,
        code: str,
        message: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        if len(message) > MAX_MESSAGE_LENGTH:
            message = message[: MAX_MESSAGE_LENGTH - 1] + "…"
        self.line(
            {
                "type": "response",
                "id": request_id,
                "ok": False,
                "error": {"code": code, "message": message, "details": details or {}},
            }
        )

    def event(self, event: str, data: dict[str, Any]) -> None:
        self.line({"type": "event", "event": event, "data": data})


def _configure_streams() -> None:
    """UTF-8 both ways and `\\n` line endings on stdout, whatever the platform default.

    `-I` ignores PYTHONIOENCODING, and a pipe on Windows defaults to the system code page and
    `\\r\\n`: a channel name with an emoji would break the line.
    """
    for stream, newline in ((sys.stdout, "\n"), (sys.stdin, None), (sys.stderr, None)):
        if isinstance(stream, io.TextIOWrapper):
            try:
                if newline is None:
                    stream.reconfigure(encoding="utf-8", errors="replace")
                else:
                    stream.reconfigure(encoding="utf-8", errors="replace", newline=newline)
            except ValueError, OSError:
                pass


def configure_course(course_dir: Path | None, video_dir: Path | None) -> None:
    """Tells the comms course where the course and its videos are on this computer (plan D8).

    Imported here, lazily, so the bridge starts whether or not comms imports: a comms package
    that fails to import is logged and the bridge carries on (its comms actions will say so).
    Neither folder given is the course's own default, so nothing is imported for it.
    """
    if course_dir is None and video_dir is None:
        return
    try:
        import gratovo_pipeline.comms.course as course
    except Exception:  # anything a half-written comms package raises on import
        log.warning(
            "the comms course could not be imported; its folders are ignored", exc_info=True
        )
        return
    course.configure(course_dir, video_dir)


class Daemon:
    """One daemon: a `Gemini` plus the stdin/stdout protocol around it."""

    def __init__(self, port: int, data_dir: Path | None, out: Out, paths: BrowserPaths) -> None:
        self.port = port
        self.out = out
        self.paths = paths
        # The owner's pacing outlives this process (plan D6a): the pause, the page errors that
        # count towards one and the last send are saved beside the browser profile, the Gemini
        # account's own folder, and read back here, so a crash or a Stop then Start in Settings
        # cannot cut a pause or the 60 s gap short.
        pacing = PacingStore(paths.profile_dir / PACING_FILE)
        self.gemini = Gemini(
            port=port,
            auto_open=False,
            data_dir=data_dir,
            logger=logging.getLogger("gratovo_pipeline.gemini"),
            send_gap=SendGap(store=pacing),
            breaker=pause.Breaker(store=pacing),
        )
        # The token the Firefox add-on must show (plan D13); the browser manager builds it in.
        self.gemini.server.set_token(paths.token)
        self.stop_requested = threading.Event()

    # --- wiring ------------------------------------------------------------

    def start(self) -> bool:
        """Starts the server; writes the `daemon` event and returns whether it is listening."""
        try:
            self.gemini.server.start(bind_timeout=0)
        except OSError as error:
            log.error("cannot listen on port %s: %s", self.port, error)
            self.out.event(
                "daemon",
                {
                    "state": "failed",
                    "reason": "port_in_use",
                    "port": self.port,
                    "message": str(error),
                },
            )
            return False
        # The daemon's own state change goes out before the verbatim `hello` that caused it, so
        # main flips to "connected" first.
        self.gemini.on(
            "hello",
            lambda data: self.out.event("daemon", {"state": "extension_connected", "hello": data}),
        )
        self.gemini.on(
            "disconnected",
            lambda data: self.out.event("daemon", {"state": "extension_disconnected", **data}),
        )
        for name in FORWARDED_EVENTS:
            self.gemini.on(name, self._forwarder(name))
        self.out.event(
            "daemon",
            {
                "state": "listening",
                "port": self.gemini.port,
                "pid": os.getpid(),
                "version": __version__,
            },
        )
        return True

    def _forwarder(self, name: str) -> Callable[[dict[str, Any]], None]:
        return lambda data: self.out.event(name, data)

    def emit(self, event: str, data: dict[str, Any]) -> None:
        """What a long action or a browser step calls to report: one `event` line on stdout.

        Handed to `actions.run_action` and the browser manager as their `emit` (DAEMON.md,
        "progress events"); the same single writer as every other line.
        """
        self.out.event(event, data)

    def stop(self) -> None:
        # Stopping the server fails every in-flight call with ExtensionNotConnected, which is
        # what lets a pool thread stuck in a long `send` return promptly instead of holding the
        # exit.
        self.gemini.close()

    # --- one request ---------------------------------------------------------

    def handle(self, request: dict[str, Any]) -> None:
        request_id = _request_id(request.get("id"))
        method: object = request.get("method")
        params: object = request.get("params")
        if not isinstance(method, str) or not method:
            self.out.error(request_id, "BAD_PARAMS", "request needs a string `method`")
            return
        if params is None:
            params = {}
        if not isinstance(params, dict):
            self.out.error(request_id, "BAD_PARAMS", "`params` must be an object")
            return
        given: dict[str, Any] = params  # pyright: ignore[reportUnknownVariableType]
        try:
            result = self.dispatch(method, given)
        except GeminiError as error:
            self.out.error(request_id, error.code, error.message, self._details(error, method))
            return
        except NotImplementedError:
            # A method registered whose body nobody has written yet: a plain answer, not a crash.
            log.warning("request %r (%s) is not implemented yet", request_id, method)
            self.out.error(request_id, "NOT_IMPLEMENTED", "not implemented yet", {"method": method})
            return
        except Exception as error:  # must become a response, never a crash
            log.exception("request %r (%s) crashed", request_id, method)
            self.out.error(
                request_id,
                "INTERNAL",
                f"{type(error).__name__}: {error}",
                {"stack": traceback.format_exc()},
            )
            return
        self.out.response(request_id, result)

    def _details(self, error: GeminiError, method: str) -> dict[str, Any]:
        details = dict(error.details)
        if isinstance(error, ExtensionNotConnected):
            details.setdefault("port", self.gemini.port)
        if error.code == "NOT_IMPLEMENTED":
            # DAEMON.md §2: `{method}`, whether the body raised NotImplementedError or the
            # bridge's own NotImplementedYet.
            details.setdefault("method", method)
        return details

    def dispatch(self, method: str, params: dict[str, Any]) -> Any:
        if pause.sends_prompt(method):
            return self.prompting(method, params)
        return self.route(method, params)

    def prompting(self, method: str, params: dict[str, Any]) -> Any:
        """A method that sends a prompt, under the breaker (pause.py, plan D6a).

        While it is open the method fails at once with `PAUSED`, before anything reaches the page.
        A refusal or a page error the method raises is counted, unless the client already counted
        it on the send it came from (the breaker's `recorded` moved).
        """
        breaker = self.gemini.breaker
        breaker.check()
        before = breaker.recorded
        try:
            return self.route(method, params)
        except GeminiError as error:
            if breaker.recorded == before:
                breaker.note(error)
            raise

    def route(self, method: str, params: dict[str, Any]) -> Any:
        if method.startswith("bridge."):
            return self.bridge_method(method[len("bridge.") :], params)
        if method.startswith("action."):
            return actions.run_action(self.gemini, method, params, emit=self.emit)
        return self.proxy(method, params)

    def proxy(self, method: str, params: dict[str, Any]) -> Any:
        wait_ms = params.get("timeoutMs")
        if isinstance(wait_ms, int | float) and wait_ms > 0:
            timeout = wait_ms / 1000.0 + PROXY_GRACE_S
        else:
            timeout = PROXY_DEFAULT_S.get(method, PROXY_OTHER_S) + PROXY_GRACE_S
        return self.gemini.call(method, params, timeout=timeout)

    def bridge_method(self, name: str, params: dict[str, Any]) -> Any:
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
            # `heal` returns the strategy alone; the daemon reports the suggestions too.
            strategy, suggestions = g._heal(element, int(pick or 0))  # pyright: ignore[reportPrivateUsage]
            return {"element": element, "strategy": strategy, "suggestions": suggestions}
        if name == "open_gem":
            gem = params.get("gem")
            if not isinstance(gem, str) or not gem.strip():
                raise GeminiError("BAD_PARAMS", "bridge.open_gem needs `gem`")
            return g.open_gem(gem)
        if name == "ask":
            return self.bridge_ask(params)
        if name == "wait":
            job_id = params.get("jobId")
            if not isinstance(job_id, str) or not job_id:
                raise GeminiError("BAD_PARAMS", "bridge.wait needs `jobId`")
            timeout = params.get("timeoutS")
            return g.wait_job(job_id, timeout=300.0 if timeout is None else float(timeout)).raw
        if name in ("browser_info", "ensure_window", "install_addon") and params.get("browser"):
            # Settings' browser travels with every browser call; from then on only that
            # browser's extension may hold the bridge.
            g.server.set_browser(str(params["browser"]))
        if name == "browser_info":
            return browser_manager.browser_info(params, paths=self.paths, data_dir=g.data_dir)
        if name == "ensure_window":
            return browser_manager.ensure_window(g, params, paths=self.paths, emit=self.emit)
        if name == "install_addon":
            return browser_manager.install_addon(
                params, paths=self.paths, data_dir=g.data_dir, emit=self.emit
            )
        if name == "shutdown":
            self.stop_requested.set()
            return {"ok": True}
        raise GeminiError("BAD_PARAMS", f"unknown method 'bridge.{name}'")

    def bridge_ask(self, params: dict[str, Any]) -> dict[str, Any]:
        g = self.gemini
        prompt = params.get("prompt")
        if not isinstance(prompt, str) or not prompt:
            raise GeminiError("BAD_PARAMS", "bridge.ask needs `prompt`")
        new_chat_given = params.get("newChat")
        new_chat = True if new_chat_given is None else bool(new_chat_given)
        timeout_given = params.get("timeoutS")
        timeout = 240.0 if timeout_given is None else float(timeout_given)
        gem = params.get("gem")
        if gem:
            g.open_gem(str(gem))
            new_chat = False  # the gem's page is already a fresh chat
        result = g.send(
            prompt,
            wait=True,
            new_chat=new_chat,
            model=params.get("model") or None,
            interrupt=bool(params.get("interrupt")),
            timeout=timeout,
        )
        return {
            "text": result.get("text", ""),
            "html": result.get("html", ""),
            "model": result.get("model"),
            "durationMs": result.get("durationMs"),
        }

    def bridge_status(self) -> dict[str, Any]:
        """The daemon's own view; never throws, the extension's status is best-effort."""
        g = self.gemini
        result: dict[str, Any] = {
            "listening": g.server.running,
            "port": g.port,
            "extensionConnected": g.connected,
            "hello": g.server.hello,
            "status": None,
            # When the breaker's pause ends (ISO 8601 UTC), or None while prompts may go.
            "pausedUntil": g.breaker.paused_until(),
        }
        if not g.connected:
            result["statusError"] = {
                "code": "EXTENSION_NOT_CONNECTED",
                "message": "no extension is connected",
            }
            return result
        try:
            result["status"] = g.status()
        except GeminiError as error:
            result["statusError"] = {"code": error.code, "message": error.message}
        except Exception as error:  # "never throws" is the contract
            result["statusError"] = {
                "code": "INTERNAL",
                "message": f"{type(error).__name__}: {error}",
            }
        return result


def _read_lines(stream: TextIO, lines: queue.Queue[str | None]) -> None:
    try:
        for line in stream:
            lines.put(line)
    except OSError, ValueError:
        pass
    finally:
        lines.put(None)


def serve(
    *,
    paths: BrowserPaths,
    port: int = DEFAULT_PORT,
    data_dir: Path | None = None,
    stdin: TextIO | None = None,
    stdout: TextIO | None = None,
) -> int:
    """Runs the daemon until EOF on stdin or `bridge.shutdown`; returns the exit code."""
    stdin = stdin or sys.stdin
    out = Out(stdout or sys.stdout)
    daemon = Daemon(port, data_dir, out, paths)
    if not daemon.start():
        return 2

    lines: queue.Queue[str | None] = queue.Queue()
    reader = threading.Thread(
        target=_read_lines, args=(stdin, lines), name="gemini-daemon-stdin", daemon=True
    )
    reader.start()
    pool = concurrent.futures.ThreadPoolExecutor(
        max_workers=WORKERS, thread_name_prefix="gemini-daemon-worker"
    )
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
                request: object = json.loads(line)
            except ValueError as error:
                out.error(None, "BAD_PARAMS", f"line is not valid JSON: {error}")
                continue
            if not isinstance(request, dict):
                out.error(None, "BAD_PARAMS", "a request must be a JSON object")
                continue
            pool.submit(daemon.handle, request)  # pyright: ignore[reportUnknownArgumentType]
    finally:
        daemon.stop()
        pool.shutdown(wait=True, cancel_futures=True)
        out.event("daemon", {"state": "stopped"})
    return 0


def build_parser() -> argparse.ArgumentParser:
    """The argv main sends (`gemini-service.ts`, `bridgeArgs`)."""
    parser = argparse.ArgumentParser(
        prog="python -I -u -m gratovo_pipeline.gemini",
        description="The Gemini bridge: JSON lines on stdin and stdout for the app (DAEMON.md).",
    )
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument(
        "--data-dir", type=Path, default=None, help="the data source's pipeline folder"
    )
    parser.add_argument(
        "--profile-dir", type=Path, required=True, help="the managed Firefox profile"
    )
    parser.add_argument(
        "--extension-dir", type=Path, required=True, help="the browser extension's source folder"
    )
    parser.add_argument("--course-dir", type=Path, default=None, help="the course's lessons")
    parser.add_argument("--video-dir", type=Path, default=None, help="the course's videos")
    parser.add_argument("-v", "--verbose", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    _configure_streams()
    # First, before anything can start a child process that would inherit it.
    try:
        token = read_bridge_token()
        token_error: BadBridgeTokenError | None = None
    except BadBridgeTokenError as error:
        token, token_error = None, error
    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        stream=sys.stderr,
        format="%(asctime)s %(name)s %(levelname)s: %(message)s",
    )
    if token_error is not None:
        log.error("refusing to start: %s", token_error)
        Out(sys.stdout).event(
            "daemon", {"state": "failed", "reason": "bad_token", "message": str(token_error)}
        )
        return 2
    configure_course(args.course_dir, args.video_dir)
    paths = BrowserPaths(
        profile_dir=args.profile_dir, extension_dir=args.extension_dir, token=token
    )
    return serve(paths=paths, port=args.port, data_dir=args.data_dir)
