"""A fake browser extension for the Gemini bridge's tests (no browser, nothing beyond 127.0.0.1).

`FakeExtension` dials the bridge exactly the way the real one does (a `websockets` client, a
`hello` on connect, answers to pings) and answers requests from a script:
`{method: result | WireError | callable}`. `Harness` is a started `Gemini` on an OS-assigned
port plus the fakes attached to it. Tests that use either ask for the `loopback` fixture
(`conftest.py`), so the socket guard lets 127.0.0.1 through and nothing else.
"""

from __future__ import annotations

import asyncio
import contextlib
import inspect
import json
import socket
import threading
import time
from collections.abc import Callable
from typing import Any

from websockets.asyncio.client import ClientConnection, connect
from websockets.exceptions import ConnectionClosed

from gratovo_pipeline.gemini.client import Gemini

#: What a script may answer a method with: a result, a `WireError`, or a callable (possibly async)
#: taking the params. Spelled as a union with `object` so a lambda's parameter is typed.
type Scripted = Callable[[dict[str, Any]], object] | object

#: A handler returns this to leave the request unanswered (for timeout tests).
NO_REPLY = object()
_MISSING = object()

#: Thread-name prefixes the bridge and the fake start; a test must leave none running.
THREAD_PREFIXES = ("gemini-bridge", "fake-extension")


class WireError(Exception):
    """Raised by a scripted handler to answer with `{ok: false, error: {...}}`."""

    def __init__(self, code: str, message: str = "", details: dict[str, Any] | None = None) -> None:
        super().__init__(code, message)
        self.code, self.message, self.details = code, message, details or {}


class FakeExtension:
    """Plays the extension: connects, says hello, answers pings and scripted requests."""

    _counter = 0

    def __init__(
        self,
        port: int,
        handlers: dict[str, Scripted] | None = None,
        hello: bool = True,
        version: str = "0.0-test",
        connect_for: float = 5.0,
        browser: str | None = None,
    ) -> None:
        FakeExtension._counter += 1
        self.fake_id = FakeExtension._counter
        self._port = port
        self._hello = hello
        self._version = version
        self._connect_for = connect_for
        self._browser = browser
        self.handlers: dict[str, Scripted] = dict(handlers or {})
        #: every `(method, params)` received, in order
        self.requests: list[tuple[str, dict[str, Any]]] = []
        self.pings = 0
        self.pongs = 0
        self.connected = threading.Event()
        self.closed = threading.Event()
        self.close_code: int | None = None
        self.close_reason: str | None = None
        self.error: BaseException | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._thread: threading.Thread | None = None
        self._ws: ClientConnection | None = None
        self._stop: asyncio.Event | None = None
        self._tasks: set[asyncio.Future[None]] = set()

    def start(self, timeout: float = 5.0) -> FakeExtension:
        self._thread = threading.Thread(target=self._run, name="fake-extension", daemon=True)
        self._thread.start()
        if not self.connected.wait(timeout) or self.error is not None:
            raise AssertionError(f"fake extension did not connect: {self.error!r}")
        return self

    def stop(self) -> None:
        thread = self._thread
        if thread is None:
            return
        if thread.is_alive() and self._loop is not None and self._stop is not None:
            with contextlib.suppress(RuntimeError):
                self._loop.call_soon_threadsafe(self._stop.set)
        thread.join(5)
        assert not thread.is_alive(), "fake extension thread did not stop"
        self._thread = None

    def send_event(self, event: str, data: dict[str, Any]) -> None:
        """Sends an unsolicited event frame, from any thread."""
        self.send_raw({"type": "event", "event": event, "data": data})

    def send_raw(self, frame: dict[str, Any]) -> None:
        assert self._loop is not None
        assert self._ws is not None
        asyncio.run_coroutine_threadsafe(self._ws.send(json.dumps(frame)), self._loop).result(5)

    def _run(self) -> None:
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        try:
            self._loop.run_until_complete(self._main())
        finally:
            self._loop.close()
            self.connected.set()  # never leave start() hanging
            self.closed.set()

    async def _connect(self) -> ClientConnection:
        # Like the real extension, keep dialling until the server is up.
        deadline = time.monotonic() + self._connect_for
        while True:
            try:
                return await connect(f"ws://127.0.0.1:{self._port}", open_timeout=2)
            except OSError:
                if time.monotonic() >= deadline:
                    raise
                await asyncio.sleep(0.05)

    async def _main(self) -> None:
        self._stop = asyncio.Event()
        try:
            ws = await self._connect()
        except BaseException as error:
            self.error = error
            return
        self._ws = ws
        try:
            if self._hello:
                data: dict[str, Any] = {
                    "extensionVersion": self._version,
                    "port": self._port,
                    "fake": self.fake_id,
                }
                if self._browser:
                    data["browser"] = self._browser
                await ws.send(json.dumps({"type": "event", "event": "hello", "data": data}))
            self.connected.set()
            reader = asyncio.create_task(self._read(ws))
            stopper = asyncio.create_task(self._wait_stop())
            _done, pending = await asyncio.wait(
                {reader, stopper}, return_when=asyncio.FIRST_COMPLETED
            )
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
        finally:
            await ws.close()
            self.close_code, self.close_reason = ws.close_code, ws.close_reason

    async def _wait_stop(self) -> None:
        assert self._stop is not None
        await self._stop.wait()

    async def _read(self, ws: ClientConnection) -> None:
        try:
            async for raw in ws:
                frame: dict[str, Any] = json.loads(raw)
                kind = frame.get("type")
                if kind == "ping":
                    self.pings += 1
                    await ws.send('{"type": "pong"}')
                elif kind == "pong":
                    self.pongs += 1
                elif kind == "request":
                    task = asyncio.ensure_future(self._answer(ws, frame))
                    self._tasks.add(task)
                    task.add_done_callback(self._tasks.discard)
        except ConnectionClosed:
            pass

    async def _answer(self, ws: ClientConnection, frame: dict[str, Any]) -> None:
        method: str = frame["method"]
        params: dict[str, Any] = frame.get("params") or {}
        self.requests.append((method, params))
        handler = self.handlers.get(method, _MISSING)
        try:
            if handler is _MISSING:
                raise WireError("BAD_PARAMS", f"unknown method {method!r}")
            if isinstance(handler, WireError):
                raise handler
            result = handler(params) if callable(handler) else handler
            if inspect.isawaitable(result):
                result = await result
            if result is NO_REPLY:
                return
            response: dict[str, Any] = {
                "type": "response",
                "id": frame["id"],
                "ok": True,
                "result": result,
            }
        except WireError as error:
            response = {
                "type": "response",
                "id": frame["id"],
                "ok": False,
                "error": {"code": error.code, "message": error.message, "details": error.details},
            }
        with contextlib.suppress(ConnectionClosed):
            await ws.send(json.dumps(response))

    def calls(self, method: str) -> list[dict[str, Any]]:
        """The params of every request for `method`, in order."""
        return [p for m, p in self.requests if m == method]


def wait_until(predicate: Callable[[], Any], timeout: float = 5.0, what: str = "condition") -> Any:
    deadline = time.monotonic() + timeout
    while True:
        value = predicate()
        if value:
            return value
        if time.monotonic() >= deadline:
            raise AssertionError(f"timed out waiting for {what}")
        time.sleep(0.02)


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


class Harness:
    """A started `Gemini` on an OS-assigned port plus the fakes attached to it."""

    def __init__(self) -> None:
        self.gemini = Gemini(port=0, connect_timeout=5, call_timeout=2, auto_open=False)
        self.gemini.server.start()
        self.fakes: list[FakeExtension] = []

    @property
    def port(self) -> int:
        return self.gemini.port

    def attach(self, handlers: dict[str, Scripted] | None = None, **kw: Any) -> FakeExtension:
        fake = FakeExtension(self.port, handlers, **kw).start()
        self.fakes.append(fake)
        # `hello` is the first frame the fake sends, so once the server has
        # recorded THIS fake's hello its handler is the live one -- no race
        # with a request going to a connection the server has not adopted.
        wait_until(
            lambda: (self.gemini.server.hello or {}).get("fake") == fake.fake_id,
            what="the server to see the fake's hello",
        )
        return fake

    def close(self) -> None:
        for fake in self.fakes:
            fake.stop()
        self.gemini.close()
