"""The local WebSocket server the browser extension connects to.

Python is the server and the extension is the client (PROTOCOL.md, top):
the extension's service worker dials `ws://127.0.0.1:<port>` and reconnects
with backoff whenever the socket drops, so nothing here ever has to find
the browser -- it only has to be listening.

Threads
-------
Three of them, and knowing which is which explains most of the code:

  * the caller's thread   -- runs `call()`, `wait_for_extension()`, `stop()`.
                             Blocks on futures, never on the socket.
  * the loop thread       -- a private asyncio loop that owns the socket, the
                             pending-request table and the ping timer. Nothing
                             on this thread ever blocks; `call()` refuses to
                             run here so a deadlock is impossible.
  * the dispatcher thread -- delivers `event` frames to listeners from a
                             `queue.Queue`, so a slow or crashing callback
                             can never stall the receive loop. Listeners are
                             therefore free to `call()` back into the bridge.

Keepalive
---------
Two independent mechanisms, on purpose, with ONE timeout between them:

  * JSON `{"type": "ping"}` every 15 s (PROTOCOL.md §1). Its only job is to
    keep Chrome's MV3 service worker alive -- Chrome extends a worker's
    lifetime on WebSocket *messages*, and protocol-level ping frames never
    reach JavaScript. This ping has no timeout of its own.
  * websockets' built-in ping/pong (20 s interval, 20 s timeout) is left ON
    and is the sole judge of a dead connection: a laptop that slept or a
    browser that vanished is noticed within ~40 s, the socket is closed,
    every pending request fails with `ExtensionNotConnected`, and the
    extension reconnects when it can.

Only the most recent extension connection is kept. A new one replaces the
old, which is closed with code 1000 / reason "replaced" -- that is what the
extension expects after being reloaded (PROTOCOL.md, top).

With a browser set (`set_browser`, the browser chosen in Settings), only that
browser's extension is accepted: a newcomer is admitted once its `hello`
names that browser, and until then it does not replace the connection there
is. Any other browser's extension is closed with code 4003
(`WRONG_BROWSER_CODE`) -- so an extension still loaded in, say, Edge cannot
take the bridge away from the Firefox the app manages, and the two do not
keep replacing each other.

The per-launch token (plan D13)
-------------------------------
Main makes a fresh random token for every bridge start and hands it over in the environment
(`daemon.read_bridge_token`). The bridge writes it into the Firefox copy of the add-on it builds
(`bridge-token.js`), and the add-on sends it back in its `hello`. With a token set, a Firefox
extension -- one whose `hello` says `firefox`, or whose handshake comes from a `moz-extension://`
origin -- is admitted only when its `hello` carries exactly that token (compared in constant
time); a wrong or missing one is closed with code 4001 (`WRONG_TOKEN_CODE`). Chrome and Edge load
the add-on's source folder unpacked, which cannot carry a per-launch value, so for them the
origin check (`_refuse_web_pages`) and the browser admission above stay the guard. The token is
dropped from the stored and forwarded `hello`, so it never reaches main, a log or a status.
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import contextlib
import hmac
import json
import logging
import queue
import threading
import time
import uuid
from collections.abc import Callable
from http import HTTPStatus
from types import TracebackType
from typing import Any, Self, cast

from websockets.asyncio.server import Server, ServerConnection, serve
from websockets.exceptions import ConnectionClosed
from websockets.http11 import Request, Response
from websockets.protocol import State

from .errors import BridgeTimeout, ExtensionNotConnected, error_from_payload

DEFAULT_PORT = 8765
#: Close code for an extension running in a browser other than the selected one.
WRONG_BROWSER_CODE = 4003
#: Close code for a Firefox extension whose `hello` lacks this launch's token (plan D13).
WRONG_TOKEN_CODE = 4001
#: How long a newcomer has to say `hello` when a browser is required.
ADMIT_TIMEOUT_S = 10.0
DEFAULT_HOST = "127.0.0.1"
# The JSON keepalive cadence from PROTOCOL.md §1.
PING_INTERVAL = 15.0
# EADDRINUSE on POSIX (98 / 48 on macOS) and WSAEADDRINUSE on Windows.
_EADDRINUSE = {48, 98, 10048}
# A `get_conversation` on a long chat carries every answer's HTML; the
# library's 1 MiB default is too small for that and the failure mode (the
# extension gets disconnected with 1009 mid-answer) is baffling from Python.
MAX_FRAME_BYTES = 32 * 1024 * 1024

# Wire log levels (PROTOCOL.md §1, the `log` event) -> `logging` levels.
_LOG_LEVELS = {
    "debug": logging.DEBUG,
    "info": logging.INFO,
    "warn": logging.WARNING,
    "warning": logging.WARNING,
    "error": logging.ERROR,
}

NOT_CONNECTED_MESSAGE = (
    "the Gemini extension is not connected. With Firefox (the default) the app "
    "opens its own Gemini window and adds the extension itself; with Edge or "
    "Chrome, load the unpacked extension from services/gemini-extension/ and "
    "check in its popup that the port matches this server's."
)

type Listener = Callable[[dict[str, Any]], Any]


class BridgeServer:
    """Runs the WebSocket server on its own thread and exposes a synchronous `call()`."""

    def __init__(
        self,
        port: int = DEFAULT_PORT,
        host: str = DEFAULT_HOST,
        ping_interval: float = PING_INTERVAL,
        logger: logging.Logger | None = None,
    ) -> None:
        self._requested_port = int(port)
        self._host = host
        self._ping_interval = float(ping_interval)
        self._log = logger or logging.getLogger(f"{__name__}")
        # The extension's own `log` events land here, at the level it chose.
        self._ext_log = logging.getLogger(f"{__package__}.extension")

        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._server: Server | None = None
        self._bound_port: int | None = None
        self._started = threading.Event()
        self._start_error: BaseException | None = None
        self._stop_event: asyncio.Event | None = None

        # Loop-thread state. `_ws` is only ever assigned on the loop thread;
        # other threads read it, which is safe for a plain reference.
        self._ws: ServerConnection | None = None
        self._pending: dict[str, tuple[asyncio.Future[Any], ServerConnection]] = {}
        self._connected = threading.Event()
        # Strong references to fire-and-forget tasks, so they are not collected mid-run.
        self._background: set[asyncio.Future[None]] = set()

        # Event delivery.
        self._listeners: dict[str, list[Listener]] = {}
        self._listeners_lock = threading.Lock()
        self._events: queue.Queue[tuple[str, dict[str, Any]] | None] = queue.Queue()
        self._dispatcher: threading.Thread | None = None

        #: `data` of the most recent `hello` event, or None before the first.
        self.hello: dict[str, Any] | None = None
        # The only browser whose extension is accepted; None accepts any.
        self._browser: str | None = None
        # This launch's token (plan D13), or None when main gave none. Never logged.
        self._token: str | None = None

    # --- lifecycle -----------------------------------------------------------

    def start(self, bind_timeout: float = 8.0) -> None:
        """Starts the server thread; returns once it is listening. Idempotent.

        A port that is busy is retried for `bind_timeout` seconds before the
        `OSError` is raised: another process or the extension watcher holds
        it for a second or two at a time, and a caller should not fail on
        that. The daemon passes 0 so a genuinely taken port is reported at
        once."""
        deadline = time.monotonic() + max(0.0, bind_timeout)
        while True:
            try:
                self._start_once()
            except OSError as error:
                if error.errno not in _EADDRINUSE or time.monotonic() >= deadline:
                    raise
                self._log.debug("port %s busy, retrying: %s", self._requested_port, error)
                time.sleep(0.25)
            else:
                return

    def _start_once(self) -> None:
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return
            self._started.clear()
            self._start_error = None
            self._connected.clear()
            self.hello = None
            self._loop = asyncio.new_event_loop()
            self._thread = threading.Thread(
                target=self._run_loop, name="gemini-bridge-loop", daemon=True
            )
            self._thread.start()
            self._started.wait()
            if self._start_error is not None:
                self._thread.join()
                self._thread = None
                self._loop = None
                error, self._start_error = self._start_error, None
                raise error
            self._dispatcher = threading.Thread(
                target=self._dispatch_forever, name="gemini-bridge-events", daemon=True
            )
            self._dispatcher.start()
            self._log.info("listening on ws://%s:%s", self._host, self._bound_port)

    def stop(self, timeout: float = 10.0) -> None:
        """Closes the extension's socket, stops the loop and joins the threads. Idempotent."""
        with self._lock:
            thread, self._thread = self._thread, None
            if thread is None:
                return
            loop = self._loop
            if thread.is_alive() and loop is not None:
                # The loop may already have closed on its own (it crashed); the thread is
                # finishing regardless.
                with contextlib.suppress(RuntimeError):
                    loop.call_soon_threadsafe(self._signal_stop)
                thread.join(timeout)
            dispatcher, self._dispatcher = self._dispatcher, None
            if dispatcher is not None:
                self._events.put(None)
                dispatcher.join(timeout)
            self._loop = None
            self._server = None
            self._bound_port = None
            self._ws = None
            self._connected.clear()
            self._log.info("stopped")

    def __enter__(self) -> Self:
        self.start()
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        self.stop()

    @property
    def port(self) -> int:
        """The port actually bound (meaningful after `start()`; with `port=0` it is OS-assigned)."""
        return self._bound_port if self._bound_port is not None else self._requested_port

    @property
    def running(self) -> bool:
        """True while the server thread is alive."""
        thread = self._thread
        return thread is not None and thread.is_alive()

    @property
    def connected(self) -> bool:
        """True while an extension socket is open."""
        ws = self._ws
        return ws is not None and ws.state is State.OPEN

    def wait_for_extension(self, timeout: float | None = None) -> bool:
        """Blocks until an extension connects (or `timeout` seconds pass); True if it did."""
        return self._connected.wait(timeout)

    # --- requests ------------------------------------------------------------

    def call(
        self, method: str, params: dict[str, Any] | None = None, timeout: float | None = 30.0
    ) -> Any:
        """Sends one request and returns its `result`; raises the mapped `GeminiError` on a wire
        error."""
        thread = self._thread
        loop = self._loop
        if thread is None or loop is None or not thread.is_alive():
            raise ExtensionNotConnected(
                message="the bridge server is not running; call start() first"
            )
        if threading.current_thread() is thread:
            # Blocking the loop thread on a future the loop must resolve is a
            # guaranteed deadlock; make it a loud error instead of a hang.
            raise RuntimeError(
                "BridgeServer.call() must not be used from the server's event-loop thread"
            )
        if not self.connected:
            raise ExtensionNotConnected(message=NOT_CONNECTED_MESSAGE)
        if params is None:
            params = {}
        future = asyncio.run_coroutine_threadsafe(self._request(method, params, timeout), loop)
        try:
            # The coroutine enforces `timeout` itself; this outer wait is only
            # a backstop for a loop that stopped turning.
            return future.result(None if timeout is None else timeout + 5.0)
        except TimeoutError:
            future.cancel()
            raise BridgeTimeout(
                message=f"no answer to {method!r} within {timeout}s (bridge loop unresponsive)",
                details={"phase": "rpc", "method": method},
            ) from None
        except concurrent.futures.CancelledError:
            # `stop()` tore the loop down under this request.
            raise ExtensionNotConnected(
                message="the bridge server stopped while the request was in flight"
            ) from None

    async def _request(self, method: str, params: dict[str, Any], timeout: float | None) -> Any:
        ws = self._ws
        if ws is None or ws.state is not State.OPEN:
            raise ExtensionNotConnected(message=NOT_CONNECTED_MESSAGE)
        request_id = uuid.uuid4().hex
        future: asyncio.Future[Any] = asyncio.get_running_loop().create_future()
        self._pending[request_id] = (future, ws)
        frame = {"type": "request", "id": request_id, "method": method, "params": params}
        try:
            try:
                await ws.send(json.dumps(frame, ensure_ascii=False))
            except ConnectionClosed:
                raise ExtensionNotConnected(
                    message="the extension disconnected before the request was sent"
                ) from None
            try:
                return await asyncio.wait_for(future, timeout)
            except TimeoutError:
                raise BridgeTimeout(
                    message=f"no answer to {method!r} within {timeout}s",
                    details={
                        "phase": "rpc",
                        "method": method,
                        "timeoutMs": None if timeout is None else int(timeout * 1000),
                    },
                ) from None
        finally:
            self._pending.pop(request_id, None)

    # --- events --------------------------------------------------------------

    def on(self, event: str, callback: Listener) -> None:
        """Registers `callback(data)` for an event name; it runs on the dispatcher thread."""
        with self._listeners_lock:
            listeners = self._listeners.setdefault(event, [])
            if callback not in listeners:
                listeners.append(callback)

    def off(self, event: str, callback: Listener) -> None:
        """Removes a listener registered with `on()`; unknown listeners are ignored."""
        with self._listeners_lock:
            listeners = self._listeners.get(event)
            if listeners and callback in listeners:
                listeners.remove(callback)

    def _listeners_for(self, event: str) -> list[Listener]:
        with self._listeners_lock:
            return list(self._listeners.get(event, ()))

    def _dispatch_forever(self) -> None:
        while True:
            item = self._events.get()
            if item is None:
                return
            event, data = item
            for callback in self._listeners_for(event):
                try:
                    callback(data)
                except Exception:  # a listener must never take the dispatcher down
                    self._log.exception("listener for %r event raised", event)

    def _emit(self, event: str, data: dict[str, Any]) -> None:
        self._events.put((event, data))

    # --- the loop thread -----------------------------------------------------

    def _run_loop(self) -> None:
        loop = self._loop
        if loop is None:
            raise RuntimeError("the bridge loop is missing")
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(self._serve())
        except BaseException as error:  # reported to start() or logged
            if not self._started.is_set():
                self._start_error = error
            else:
                self._log.exception("bridge server crashed")
        finally:
            # Cancel whatever is left (a connection mid-close, a straggling
            # ping) so `loop.close()` is quiet instead of complaining about
            # destroyed pending tasks.
            try:
                leftovers = [t for t in asyncio.all_tasks(loop) if not t.done()]
                for task in leftovers:
                    task.cancel()
                if leftovers:
                    loop.run_until_complete(asyncio.gather(*leftovers, return_exceptions=True))
                loop.run_until_complete(loop.shutdown_asyncgens())
            except Exception:
                self._log.debug("loop teardown raised", exc_info=True)
            finally:
                asyncio.set_event_loop(None)
                loop.close()
            if not self._started.is_set():
                self._started.set()

    async def _serve(self) -> None:
        self._stop_event = asyncio.Event()
        async with serve(
            self._handler,
            self._host,
            self._requested_port,
            # Origins are checked in `_refuse_web_pages` instead: the add-on's id differs per
            # install, so there is no fixed list to give here.
            origins=None,
            process_request=_refuse_web_pages,
            ping_interval=20,
            ping_timeout=20,
            max_size=MAX_FRAME_BYTES,
            logger=logging.getLogger(f"{__package__}.websockets"),
        ) as server:
            self._server = server
            self._bound_port = server.sockets[0].getsockname()[1]
            self._started.set()
            pinger = asyncio.ensure_future(self._ping_forever())
            try:
                await self._stop_event.wait()
            finally:
                pinger.cancel()
                # `async with` closes the listening socket and every
                # connection (code 1001) and waits for them on the way out.

    def _signal_stop(self) -> None:
        if self._stop_event is not None:
            self._stop_event.set()

    async def _ping_forever(self) -> None:
        while True:
            await asyncio.sleep(self._ping_interval)
            ws = self._ws
            if ws is None or ws.state is not State.OPEN:
                continue
            with contextlib.suppress(ConnectionClosed):
                await ws.send('{"type": "ping"}')

    # --- which browser -------------------------------------------------------

    @property
    def browser(self) -> str | None:
        """The only browser whose extension is accepted, or None for any."""
        return self._browser

    def set_browser(self, browser: str | None) -> None:
        """Accept only `browser`'s extension from now on (`None`, `""` or `system`: any).

        A connected extension of another browser is closed at once, so the
        caller sees "not connected" and can open the right browser.
        """
        wanted = (browser or "").strip().lower() or None
        if wanted == "system":
            wanted = None
        self._browser = wanted
        ws, loop = self._ws, self._loop
        if wanted is None or ws is None or loop is None:
            return
        current = _hello_browser(self.hello)
        if current is not None and current != wanted:
            self._log.info(
                "the connected extension runs in %s, not %s; closing it", current, wanted
            )
            asyncio.run_coroutine_threadsafe(
                self._close_quietly(
                    ws, WRONG_BROWSER_CODE, f"only the {wanted} extension is accepted"
                ),
                loop,
            )

    def set_token(self, token: str | None) -> None:
        """Require `token` in a Firefox extension's `hello` from now on (None: no token)."""
        self._token = token or None

    @property
    def requires_token(self) -> bool:
        """True when a Firefox extension must show this launch's token."""
        return self._token is not None

    def _needs_token(self, ws: ServerConnection, browser: str | None) -> bool:
        """Whether this newcomer is the bridge-built Firefox copy, which must carry the token.

        Chrome and Edge load the source folder unpacked, which cannot hold a per-launch value, so
        they are not asked for it (plan D13): the origin check and the browser admission guard
        them. A `moz-extension://` origin is Firefox whatever its `hello` claims.
        """
        if self._token is None:
            return False
        if browser == "firefox":
            return True
        request = ws.request
        origin = request.headers.get("Origin") if request is not None else None
        return origin is not None and origin.partition("://")[0].lower() == "moz-extension"

    async def _admit(self, ws: ServerConnection) -> str | bytes | None:
        """Waits for the newcomer's `hello`; returns that frame when its browser is the required
        one (and, for Firefox with a token set, it carries the token), else None."""
        wanted = self._browser
        deadline = time.monotonic() + ADMIT_TIMEOUT_S
        try:
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError
                raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
                text = raw.decode("utf-8", "replace") if isinstance(raw, bytes) else raw
                try:
                    frame: object = json.loads(text)
                except ValueError:
                    continue
                if not isinstance(frame, dict):
                    continue
                message: dict[str, Any] = frame  # pyright: ignore[reportUnknownVariableType]
                if message.get("type") == "ping":
                    await ws.send('{"type": "pong"}')
                    continue
                if message.get("type") == "event" and message.get("event") == "hello":
                    data: object = message.get("data")
                    got = _hello_browser(data)
                    if wanted is not None and got != wanted:
                        self._log.info(
                            "refusing the %s extension (%s): only %s is accepted",
                            got or "unknown",
                            _describe_peer(ws),
                            wanted,
                        )
                        await self._close_quietly(
                            ws, WRONG_BROWSER_CODE, f"only the {wanted} extension is accepted"
                        )
                        return None
                    if self._needs_token(ws, got) and not _token_matches(data, self._token):
                        # Never the token itself, nor what was sent in its place.
                        self._log.info(
                            "refusing the %s extension (%s): wrong token",
                            got or "unknown",
                            _describe_peer(ws),
                        )
                        await self._close_quietly(ws, WRONG_TOKEN_CODE, "wrong token")
                        return None
                    return raw
        except ConnectionClosed, TimeoutError:
            await self._close_quietly(ws, WRONG_BROWSER_CODE, "no hello")
            return None

    async def _handler(self, ws: ServerConnection) -> None:
        first_frame: str | bytes | None = None
        if self._browser is not None or self._token is not None:
            first_frame = await self._admit(ws)
            if first_frame is None:
                return
        previous, self._ws = self._ws, ws
        self._connected.set()
        if previous is not None:
            self._log.info("a newer extension connection arrived; closing the previous one")
            # Not awaited: `close()` waits for the closing handshake, and the
            # old side may be gone already. Its own handler cleans up.
            closing = asyncio.ensure_future(self._close_quietly(previous, 1000, "replaced"))
            self._background.add(closing)
            closing.add_done_callback(self._background.discard)
        self._log.info("extension connected from %s", _describe_peer(ws))
        self._emit("connected", {"peer": _describe_peer(ws)})
        try:
            if first_frame is not None:
                await self._on_frame(ws, first_frame)
            async for raw in ws:
                await self._on_frame(ws, raw)
        except ConnectionClosed:
            pass
        except Exception:
            self._log.exception("connection handler failed")
        finally:
            self._fail_pending(ws, "the extension disconnected while the request was in flight")
            if self._ws is ws:
                self._ws = None
                self._connected.clear()
                self._log.info(
                    "extension disconnected (code=%s reason=%r)", ws.close_code, ws.close_reason
                )
                self._emit("disconnected", {"code": ws.close_code, "reason": ws.close_reason})

    @staticmethod
    async def _close_quietly(ws: ServerConnection, code: int, reason: str) -> None:
        # Already gone is fine: nothing to do.
        with contextlib.suppress(Exception):
            await ws.close(code, reason)

    def _fail_pending(self, ws: ServerConnection, message: str) -> None:
        for request_id, (future, owner) in list(self._pending.items()):
            if owner is not ws:
                continue
            self._pending.pop(request_id, None)
            if not future.done():
                future.set_exception(ExtensionNotConnected(message=message))

    async def _on_frame(self, ws: ServerConnection, raw: str | bytes) -> None:
        text = raw.decode("utf-8", "replace") if isinstance(raw, bytes) else raw
        try:
            parsed: object = json.loads(text)
        except ValueError:
            # Only its length: a frame can carry a prompt or an answer (creators, threads).
            self._log.warning("ignoring a frame that is not JSON (%d characters)", len(text))
            return
        if not isinstance(parsed, dict):
            self._log.warning(
                "ignoring a frame that is not an object (%s, %d characters)",
                type(parsed).__name__,
                len(text),
            )
            return
        frame: dict[str, Any] = parsed  # pyright: ignore[reportUnknownVariableType]
        kind = frame.get("type")
        if kind == "response":
            self._on_response(frame)
        elif kind == "event":
            self._on_event(frame)
        elif kind == "ping":
            await ws.send('{"type": "pong"}')
        elif kind == "pong":
            pass
        else:
            self._log.warning("ignoring a frame of unknown type %s", _one_line(kind))

    def _on_response(self, frame: dict[str, Any]) -> None:
        entry = self._pending.pop(str(frame.get("id")), None)
        if entry is None:
            # A late answer to a request that already timed out; harmless.
            self._log.debug("response for unknown request id %s", _one_line(frame.get("id")))
            return
        future, _owner = entry
        if future.done():
            return
        if frame.get("ok"):
            future.set_result(frame.get("result"))
        else:
            future.set_exception(error_from_payload(frame.get("error")))

    def _on_event(self, frame: dict[str, Any]) -> None:
        event = frame.get("event")
        raw_data: Any = frame.get("data")
        if not isinstance(event, str):
            # Not the frame itself: its data can carry a prompt or an answer.
            self._log.warning(
                "ignoring an event without a name (keys: %s)", _one_line(sorted(frame))
            )
            return
        data: dict[str, Any] = (
            cast("dict[str, Any]", raw_data) if isinstance(raw_data, dict) else {"value": raw_data}
        )
        if event == "hello":
            # The token has done its job in `_admit`; it is kept out of everything from here on
            # (the stored hello, `bridge.status`, the forwarded event, main's log).
            data = {key: value for key, value in data.items() if key != "token"}
            self.hello = data
            self._log.info(
                "extension hello: version %s, port %s",
                _one_line(data.get("extensionVersion")),
                _one_line(data.get("port")),
            )
        elif event == "log":
            level = _LOG_LEVELS.get(str(data.get("level", "info")).lower(), logging.INFO)
            context = data.get("context")
            if context:
                self._ext_log.log(
                    level,
                    "%s -- %s",
                    _one_line(data.get("message", "")),
                    _one_line(json.dumps(context, ensure_ascii=False, default=str)),
                )
            else:
                self._ext_log.log(level, "%s", _one_line(data.get("message", "")))
        self._emit(event, data)


# Where a browser add-on's WebSocket comes from: Firefox, and Chrome or Edge.
EXTENSION_ORIGIN_SCHEMES = frozenset({"moz-extension", "chrome-extension"})


def _refuse_web_pages(connection: ServerConnection, request: Request) -> Response | None:
    """Lets in the add-on, and programs on this computer; refuses every web page.

    Listening on 127.0.0.1 keeps other computers out, but not the pages open in the person's
    browser: any of them may open `ws://127.0.0.1:8765`, say `hello`, and would then read every
    prompt (creators, brands, threads) and answer it. A browser always names a page's origin
    (`https://…`, or `null` for a file); an add-on's is `moz-extension://…` or
    `chrome-extension://…`. A program that isn't a browser sends no Origin; it is let in, as
    anything running on this computer could reach the bridge anyway (the tests' fake extension).
    """
    origin = request.headers.get("Origin")
    if origin is None:
        return None
    scheme = origin.partition("://")[0].lower()
    if scheme in EXTENSION_ORIGIN_SCHEMES:
        return None
    logging.getLogger(__name__).warning(
        "refused a connection from a web page (%s)", _one_line(origin, 200)
    )
    return connection.respond(
        HTTPStatus.FORBIDDEN, "Only the Gratovo browser add-on may connect.\n"
    )


def _one_line(value: object, limit: int = 2000) -> str:
    r"""Text from the extension made safe for one log line: line breaks shown as `\n`, never
    written, so nothing the page sends can forge a line in main's log; cut at `limit`."""
    text = value if isinstance(value, str) else repr(value)
    return text[:limit].replace("\r", "\\r").replace("\n", "\\n")


def _hello_browser(hello: object) -> str | None:
    """The browser a `hello` names (`firefox`, `edge`, ...), lower-case, or None."""
    if not isinstance(hello, dict):
        return None
    browser: object = hello.get("browser")  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]
    return browser.strip().lower() if isinstance(browser, str) and browser.strip() else None


def _token_matches(hello: object, token: str | None) -> bool:
    """Whether a `hello`'s `token` is exactly `token`, compared in constant time."""
    if token is None or not isinstance(hello, dict):
        return False
    given: object = hello.get("token")  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]
    if not isinstance(given, str):
        return False
    return hmac.compare_digest(given.encode("utf-8"), token.encode("utf-8"))


def _describe_peer(ws: ServerConnection) -> str:
    try:
        host, port = ws.remote_address[:2]
        return f"{host}:{port}"
    except Exception:  # only for a log line
        return "?"
