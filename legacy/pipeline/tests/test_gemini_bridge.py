"""Tests for the Gemini bridge's Python half: server, `Gemini` facade, CLI.

Run with:  python -m pytest -q tests/test_gemini_bridge.py    (from pipeline/)

No browser and no network beyond 127.0.0.1. The extension is played by
`FakeExtension`, which dials the bridge exactly the way the real one does
(`websockets` client, `hello` on connect, answers pings) and answers
requests from a script: `{method: result | WireError | callable}`.

WHAT IS BEING PINNED
--------------------
The bridge's promises to the program that drives it, not the extension's
DOM work (that is the extension's own test problem):

  * a `call()` returns the matching response and nothing else, even with
    several in flight -- the request-id correlation;
  * every failure surfaces as the right `GeminiError` subclass with the
    wire `details` intact, including the ones that never cross the wire
    (no extension, disconnect mid-call, RPC timeout);
  * `wait()` finishes a job whether the extension announces it or not --
    the polling fallback exists because the extension keeps working while
    Python is away and the event for that job is never sent;
  * `ensure_account` visits `/u/0`, `/u/1`, ... and STOPS on Google's
    redirect, reporting which accounts it did see;
  * a reloaded extension (a second connection) replaces the first cleanly.

Every fixture tears its threads down and the autouse check at the bottom
fails a test that leaves one behind.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import logging
import socket
import sys
import threading
import time
from pathlib import Path
from typing import Any, Callable, Optional

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from websockets.asyncio.client import connect  # noqa: E402
from websockets.exceptions import ConnectionClosed  # noqa: E402

from gemini_bridge import (  # noqa: E402
    AccountNotFound,
    BadParams,
    BridgeServer,
    BridgeTimeout,
    ElementNotFound,
    ExtensionNotConnected,
    Gemini,
    GeminiError,
    Job,
    JobFailed,
    ModelNotFound,
    cli,
    error_from_payload,
)

# --- the fake extension --------------------------------------------------------

#: A handler returns this to leave the request unanswered (for timeout tests).
NO_REPLY = object()
_MISSING = object()


class WireError(Exception):
    """Raised by a scripted handler to answer with `{ok: false, error: {...}}`."""

    def __init__(self, code: str, message: str = "", details: Optional[dict] = None):
        super().__init__(code, message)
        self.code, self.message, self.details = code, message, details or {}


class FakeExtension:
    """Plays the extension: connects, says hello, answers pings and scripted requests."""

    _counter = 0

    def __init__(self, port: int, handlers: Optional[dict] = None, hello: bool = True,
                 version: str = "0.0-test", connect_for: float = 5.0, browser: Optional[str] = None):
        FakeExtension._counter += 1
        self.fake_id = FakeExtension._counter
        self._port = port
        self._hello = hello
        self._version = version
        self._connect_for = connect_for
        self._browser = browser
        self.handlers: dict = dict(handlers or {})
        #: every `(method, params)` received, in order
        self.requests: list[tuple[str, dict]] = []
        self.pings = 0
        self.pongs = 0
        self.connected = threading.Event()
        self.closed = threading.Event()
        self.close_code: Optional[int] = None
        self.close_reason: Optional[str] = None
        self.error: Optional[BaseException] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._thread: Optional[threading.Thread] = None
        self._ws = None
        self._stop: Optional[asyncio.Event] = None

    def start(self, timeout: float = 5.0) -> "FakeExtension":
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
            try:
                self._loop.call_soon_threadsafe(self._stop.set)
            except RuntimeError:
                pass
        thread.join(5)
        assert not thread.is_alive(), "fake extension thread did not stop"
        self._thread = None

    def send_event(self, event: str, data: dict) -> None:
        """Sends an unsolicited event frame, from any thread."""
        self.send_raw({"type": "event", "event": event, "data": data})

    def send_raw(self, frame: dict) -> None:
        assert self._loop is not None and self._ws is not None
        asyncio.run_coroutine_threadsafe(
            self._ws.send(json.dumps(frame)), self._loop).result(5)

    def _run(self) -> None:
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        try:
            self._loop.run_until_complete(self._main())
        finally:
            self._loop.close()
            self.connected.set()  # never leave start() hanging
            self.closed.set()

    async def _connect(self):
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
        except BaseException as error:  # noqa: BLE001
            self.error = error
            return
        self._ws = ws
        try:
            if self._hello:
                await ws.send(json.dumps({
                    "type": "event", "event": "hello",
                    "data": {"extensionVersion": self._version, "port": self._port,
                             "fake": self.fake_id,
                             **({"browser": self._browser} if self._browser else {})}}))
            self.connected.set()
            reader = asyncio.ensure_future(self._read(ws))
            stopper = asyncio.ensure_future(self._stop.wait())
            done, pending = await asyncio.wait({reader, stopper}, return_when=asyncio.FIRST_COMPLETED)
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
        finally:
            await ws.close()
            self.close_code, self.close_reason = ws.close_code, ws.close_reason

    async def _read(self, ws) -> None:
        try:
            async for raw in ws:
                frame = json.loads(raw)
                kind = frame.get("type")
                if kind == "ping":
                    self.pings += 1
                    await ws.send('{"type": "pong"}')
                elif kind == "pong":
                    self.pongs += 1
                elif kind == "request":
                    asyncio.ensure_future(self._answer(ws, frame))
        except ConnectionClosed:
            pass

    async def _answer(self, ws, frame: dict) -> None:
        method, params = frame["method"], frame.get("params") or {}
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
            response = {"type": "response", "id": frame["id"], "ok": True, "result": result}
        except WireError as error:
            response = {"type": "response", "id": frame["id"], "ok": False,
                        "error": {"code": error.code, "message": error.message,
                                  "details": error.details}}
        try:
            await ws.send(json.dumps(response))
        except ConnectionClosed:
            pass

    def calls(self, method: str) -> list[dict]:
        """The params of every request for `method`, in order."""
        return [p for m, p in self.requests if m == method]


# --- fixtures --------------------------------------------------------------------

def wait_until(predicate: Callable[[], Any], timeout: float = 5.0, what: str = "condition"):
    deadline = time.monotonic() + timeout
    while True:
        value = predicate()
        if value:
            return value
        if time.monotonic() >= deadline:
            raise AssertionError(f"timed out waiting for {what}")
        time.sleep(0.02)


class Harness:
    """A started `Gemini` on an OS-assigned port plus the fakes attached to it."""

    def __init__(self):
        self.gemini = Gemini(port=0, connect_timeout=5, call_timeout=2, auto_open=False)
        self.gemini.server.start()
        self.fakes: list[FakeExtension] = []

    @property
    def port(self) -> int:
        return self.gemini.port

    def attach(self, handlers: Optional[dict] = None, **kw) -> FakeExtension:
        fake = FakeExtension(self.port, handlers, **kw).start()
        self.fakes.append(fake)
        # `hello` is the first frame the fake sends, so once the server has
        # recorded THIS fake's hello its handler is the live one -- no race
        # with a request going to a connection the server has not adopted.
        wait_until(lambda: (self.gemini.server.hello or {}).get("fake") == fake.fake_id,
                   what="the server to see the fake's hello")
        return fake

    def close(self) -> None:
        for fake in self.fakes:
            fake.stop()
        self.gemini.close()


@pytest.fixture
def harness():
    h = Harness()
    try:
        yield h
    finally:
        h.close()


@pytest.fixture(autouse=True)
def no_threads_left_behind():
    yield
    # Give the joins a moment; then anything of ours still alive is a leak.
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        ours = [t.name for t in threading.enumerate()
                if t.name.startswith(("gemini-bridge", "fake-extension"))]
        if not ours:
            return
        time.sleep(0.05)
    raise AssertionError(f"threads left behind: {ours}")


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


STATUS = {
    "url": "https://gemini.google.com/u/0/app", "accountIndex": 0,
    "account": {"name": "Alice", "email": "alice@example.com"},
    "model": {"name": "2.5 Pro"}, "generating": False, "signedOut": False, "pageError": None,
    "elements": {"textarea": {"found": True, "strategy": "css#1"}},
    "queue": {"length": 0, "paused": False, "running": None}, "ready": True,
}


# --- connection ------------------------------------------------------------------

def test_connect_hello_and_connected(harness):
    g = harness.gemini
    assert g.port != 0
    assert not g.connected
    fake = harness.attach({"status": STATUS})
    assert g.connected
    assert g.server.hello["extensionVersion"] == "0.0-test"
    assert g.status() == STATUS
    assert fake.calls("status") == [{}]


def test_not_connected_raises(harness):
    with pytest.raises(ExtensionNotConnected) as info:
        harness.gemini.status()
    assert info.value.code == "EXTENSION_NOT_CONNECTED"
    assert "popup" in info.value.message


def test_context_manager_gives_up_when_nothing_connects():
    g = Gemini(port=0, connect_timeout=0.3, auto_open=False)
    with pytest.raises(ExtensionNotConnected) as info:
        with g:
            pass
    assert "0.3s" in info.value.message
    assert not g.server.running


def test_newest_connection_wins(harness):
    first = harness.attach({"status": {"who": "first"}})
    second = harness.attach({"status": {"who": "second"}})
    assert first.closed.wait(5)
    assert (first.close_code, first.close_reason) == (1000, "replaced")
    assert harness.gemini.connected
    assert harness.gemini.status() == {"who": "second"}
    assert first.calls("status") == []
    assert second.calls("status") == [{}]


def test_disconnect_fails_the_calls_in_flight(harness):
    fake = harness.attach({"hang": lambda p: NO_REPLY})
    outcome: dict = {}

    def run():
        try:
            harness.gemini.call("hang", timeout=10)
        except GeminiError as error:
            outcome["error"] = error

    worker = threading.Thread(target=run)
    worker.start()
    wait_until(lambda: fake.calls("hang"), what="the request to reach the fake")
    fake.stop()
    worker.join(5)
    assert isinstance(outcome.get("error"), ExtensionNotConnected)
    assert not harness.gemini.connected


def test_answers_the_extensions_ping(harness):
    fake = harness.attach({"probe": {"ok": 1}})
    fake.send_raw({"type": "ping"})
    wait_until(lambda: fake.pongs == 1, what="the pong")
    # ...and the socket is still healthy afterwards.
    assert harness.gemini.call("probe") == {"ok": 1}


# --- requests --------------------------------------------------------------------

def test_two_concurrent_calls_are_correlated(harness):
    async def slow(params):
        await asyncio.sleep(0.4)
        return {"which": "slow", "n": params["n"]}

    harness.attach({"slow": slow, "fast": lambda p: {"which": "fast", "n": p["n"]}})
    g = harness.gemini
    results: dict = {}

    def call_slow():
        results["slow"] = (g.call("slow", {"n": 1}), time.monotonic())

    worker = threading.Thread(target=call_slow)
    worker.start()
    time.sleep(0.05)  # make sure `slow` is already in flight
    results["fast"] = (g.call("fast", {"n": 2}), time.monotonic())
    worker.join(5)
    assert results["slow"][0] == {"which": "slow", "n": 1}
    assert results["fast"][0] == {"which": "fast", "n": 2}
    assert results["fast"][1] < results["slow"][1], "fast should not wait behind slow"


def test_wire_error_becomes_the_right_subclass(harness):
    details = {"element": "newChat", "tried": [{"strategy": "css#1", "matched": 0, "visible": 0}],
               "candidates": []}
    harness.attach({
        "new_chat": WireError("ELEMENT_NOT_FOUND", "no New chat button", details),
        "set_model": WireError("MODEL_NOT_FOUND", "nope", {"wanted": "Ultra", "available": ["Pro"]}),
        "weird": WireError("SOMETHING_NEW", "from the future"),
    })
    g = harness.gemini
    with pytest.raises(ElementNotFound) as info:
        g.new_chat()
    assert info.value.code == "ELEMENT_NOT_FOUND"
    assert info.value.message == "no New chat button"
    assert info.value.details == details
    assert str(info.value) == "ELEMENT_NOT_FOUND: no New chat button"

    with pytest.raises(ModelNotFound) as info:
        g.set_model("Ultra")
    assert info.value.details["available"] == ["Pro"]

    with pytest.raises(GeminiError) as info:
        g.call("weird")
    assert type(info.value) is GeminiError
    assert info.value.code == "SOMETHING_NEW"

    with pytest.raises(BadParams):
        g.call("not_a_method")


def test_error_from_payload_is_tolerant():
    assert type(error_from_payload({"code": "BUSY"})).__name__ == "Busy"
    unknown = error_from_payload({"code": "NEW_CODE", "message": "m", "details": None})
    assert type(unknown) is GeminiError and unknown.details == {}
    assert error_from_payload("garbage").code == "UNKNOWN"


def test_rpc_timeout(harness):
    harness.attach({"hang": lambda p: NO_REPLY})
    started = time.monotonic()
    with pytest.raises(BridgeTimeout) as info:
        harness.gemini.call("hang", timeout=0.3)
    assert time.monotonic() - started < 3
    assert info.value.code == "TIMEOUT"
    assert info.value.details["phase"] == "rpc"
    assert info.value.details["method"] == "hang"
    # ...and the bridge is still usable afterwards.
    harness.fakes[0].handlers["ok"] = {"fine": True}
    assert harness.gemini.call("ok") == {"fine": True}


def test_call_refuses_the_loop_thread(harness):
    harness.attach({})
    server = harness.gemini.server
    caught: dict = {}

    def on_loop():
        try:
            server.call("status")
        except RuntimeError as error:
            caught["error"] = error
        finally:
            caught["done"] = True

    server._loop.call_soon_threadsafe(on_loop)  # noqa: SLF001
    wait_until(lambda: caught.get("done"), what="the loop-thread probe")
    assert "event-loop thread" in str(caught["error"])


# --- events ----------------------------------------------------------------------

def test_events_reach_listeners_and_can_call_back(harness):
    fake = harness.attach({"status": STATUS})
    g = harness.gemini
    seen: list = []
    from_callback: dict = {}

    def on_job(data):
        seen.append(data)

    def on_status(data):
        # Listeners run on the dispatcher thread, so calling back in is fine.
        from_callback["status"] = g.status()
        from_callback["thread"] = threading.current_thread().name

    g.on("job", on_job)
    g.on("status", on_status)
    fake.send_event("job", {"id": "job_1", "status": "running"})
    fake.send_event("status", {"generating": True})
    wait_until(lambda: seen and from_callback.get("status"), what="both events")
    assert seen == [{"id": "job_1", "status": "running"}]
    assert from_callback["status"] == STATUS
    assert from_callback["thread"] == "gemini-bridge-events"

    g.off("job", on_job)
    fake.send_event("job", {"id": "job_2", "status": "queued"})
    fake.send_event("status", {"generating": False})
    wait_until(lambda: len(from_callback) and seen, what="the second status")
    time.sleep(0.1)
    assert len(seen) == 1, "a removed listener must not be called"


def test_a_crashing_listener_does_not_break_delivery(harness):
    fake = harness.attach({})
    g = harness.gemini
    seen: list = []

    def bad(data):
        raise ValueError("boom")

    g.on("job", bad)
    g.on("job", seen.append)
    fake.send_event("job", {"id": "job_1", "status": "done"})
    wait_until(lambda: seen, what="delivery after a crashing listener")


def test_log_events_go_to_logging(harness, caplog):
    fake = harness.attach({})
    with caplog.at_level(logging.DEBUG, logger="gemini_bridge.extension"):
        fake.send_event("log", {"level": "warn", "message": "send button moved",
                                "context": {"tabId": 3}})
        wait_until(lambda: [r for r in caplog.records if r.name == "gemini_bridge.extension"],
                   what="the log record")
    record = [r for r in caplog.records if r.name == "gemini_bridge.extension"][0]
    assert record.levelno == logging.WARNING
    assert "send button moved" in record.getMessage()
    assert '"tabId": 3' in record.getMessage()


# --- the facade ------------------------------------------------------------------

def test_ask_maps_to_send(harness):
    fake = harness.attach({"send": lambda p: {"index": 0, "text": "the answer", "html": "<p>",
                                              "durationMs": 10, "model": "2.5 Pro"}})
    assert harness.gemini.ask("hi", new_chat=True, model="Pro", timeout=42) == "the answer"
    assert fake.calls("send") == [
        {"wait": True, "text": "hi", "newChat": True, "model": "Pro", "timeoutMs": 42000}]


def test_send_without_wait(harness):
    fake = harness.attach({"send": {"sent": True}})
    assert harness.gemini.send("hi", wait=False) == {"sent": True}
    assert fake.calls("send")[0]["wait"] is False


def test_queue_returns_a_job(harness):
    raw = {"id": "job_7", "prompt": "hi", "status": "queued", "meta": {"channel_id": 12},
           "result": None, "error": None}
    fake = harness.attach({"queue_add": raw})
    job = harness.gemini.queue("hi", new_chat=True, model="Flash", meta={"channel_id": 12})
    assert isinstance(job, Job)
    assert (job.id, job.status, job.text, job.result, job.error) == ("job_7", "queued", None, None, None)
    assert job.meta == {"channel_id": 12} and job.raw is raw or job.raw == raw
    assert fake.calls("queue_add") == [
        {"prompt": "hi", "newChat": True, "model": "Flash", "meta": {"channel_id": 12}}]


def test_wait_resolves_via_event(harness):
    running = {"id": "job_7", "status": "running", "result": None, "error": None}
    fake = harness.attach({"queue_get": running})
    done = {"id": "job_7", "status": "done", "result": {"index": 1, "text": "42"}, "error": None}
    threading.Timer(0.2, fake.send_event, args=("job", done)).start()
    # `poll=5` is longer than the test, so only the event can finish this.
    assert harness.gemini.wait(Job(running), timeout=5, poll=5) == "42"
    assert fake.calls("queue_get") == []


def test_wait_resolves_via_polling_when_no_event_comes(harness):
    polls = {"n": 0}

    def queue_get(params):
        assert params == {"jobId": "job_7"}
        polls["n"] += 1
        if polls["n"] < 3:
            return {"id": "job_7", "status": "running"}
        return {"id": "job_7", "status": "done", "result": {"text": "polled"}}

    harness.attach({"queue_get": queue_get})
    assert harness.gemini.wait("job_7", timeout=5, poll=0.1) == "polled"
    assert polls["n"] == 3


def test_wait_survives_a_reconnect(harness):
    first = harness.attach({"queue_get": {"id": "job_7", "status": "running"}})
    outcome: dict = {}

    def run():
        try:
            outcome["text"] = harness.gemini.wait("job_7", timeout=5, poll=0.1)
        except GeminiError as error:
            outcome["error"] = error

    worker = threading.Thread(target=run)
    worker.start()
    wait_until(lambda: first.calls("queue_get"), what="the first poll")
    first.stop()
    time.sleep(0.3)  # a few polls fail with ExtensionNotConnected meanwhile
    harness.attach({"queue_get": {"id": "job_7", "status": "done", "result": {"text": "later"}}})
    worker.join(5)
    assert outcome == {"text": "later"}


def test_wait_raises_job_failed(harness):
    failed = {"id": "job_7", "status": "error", "result": None,
              "error": {"code": "GEMINI_ERROR", "message": "limit reached", "details": {"signal": "toast"}}}
    harness.attach({"queue_get": failed})
    with pytest.raises(JobFailed) as info:
        harness.gemini.wait("job_7", timeout=5, poll=0.05)
    assert info.value.code == "GEMINI_ERROR"
    assert info.value.message == "limit reached"
    assert info.value.details["signal"] == "toast"
    assert info.value.details["job"] == failed
    assert info.value.job == failed

    harness.fakes[0].handlers["queue_get"] = {"id": "job_8", "status": "cancelled", "error": None}
    with pytest.raises(JobFailed) as info:
        harness.gemini.wait("job_8", timeout=5, poll=0.05)
    assert info.value.code == "CANCELLED"


def test_wait_times_out(harness):
    harness.attach({"queue_get": {"id": "job_7", "status": "running"}})
    with pytest.raises(BridgeTimeout) as info:
        harness.gemini.wait("job_7", timeout=0.3, poll=0.1)
    assert info.value.details == {"phase": "job", "jobId": "job_7", "timeoutMs": 300}


# --- ensure_account ----------------------------------------------------------------

ALICE = {"name": "Alice Example", "email": "alice@example.com", "index": 0}
BOB = {"name": "Bob Example", "email": "bob@example.com", "index": 1}


def account_script() -> dict:
    """Two accounts signed in; `/u/2` and up redirect to `/u/0` like Google does."""
    accounts = {0: ALICE, 1: BOB}
    state = {"index": 0}

    def switch_account(params):
        wanted = params["index"]
        landed = wanted if wanted in accounts else 0
        state["index"] = landed
        return {"requested": wanted, "landedIndex": landed,
                "url": f"https://gemini.google.com/u/{landed}/app",
                "redirected": landed != wanted, "account": accounts[landed]}

    return {"get_account": lambda p: accounts[state["index"]], "switch_account": switch_account}


def test_ensure_account_returns_the_current_one_without_switching(harness):
    fake = harness.attach(account_script())
    assert harness.gemini.ensure_account("ALICE") == ALICE
    assert fake.calls("switch_account") == []


def test_ensure_account_switches_to_bob(harness):
    fake = harness.attach(account_script())
    assert harness.gemini.ensure_account("bob@") == BOB
    assert [p["index"] for p in fake.calls("switch_account")] == [0, 1]


def test_ensure_account_stops_at_the_redirect_and_lists_what_it_saw(harness):
    fake = harness.attach(account_script())
    with pytest.raises(AccountNotFound) as info:
        harness.gemini.ensure_account("carol")
    assert info.value.tried == [(0, ALICE), (1, BOB)]
    assert [p["index"] for p in fake.calls("switch_account")] == [0, 1, 2]
    assert "alice@example.com" in info.value.message and "bob@example.com" in info.value.message
    assert info.value.details["tried"][1] == {"index": 1, "account": BOB}


def test_ensure_account_stops_on_a_url_without_u(harness):
    script = account_script()
    script["switch_account"] = lambda p: {
        "requested": p["index"], "landedIndex": 0, "url": "https://gemini.google.com/app",
        "redirected": True, "account": ALICE}
    fake = harness.attach(script)
    with pytest.raises(AccountNotFound) as info:
        harness.gemini.ensure_account("bob")
    assert info.value.tried == []
    assert len(fake.calls("switch_account")) == 1


# --- healing ---------------------------------------------------------------------

def test_heal_prepends_the_picked_suggestion(harness):
    fix = {"type": "css", "value": "button.my-fix"}
    other = {"type": "attr", "attr": "aria-label", "match": "^new chat"}
    old = {"type": "css", "value": "button.old-fix"}
    diag = {
        "url": "https://gemini.google.com/app",
        "elements": {
            "newChat": {"found": False, "strategy": None, "tried": [], "candidates": [],
                        "suggestions": [{"strategy": fix, "reason": "aria matches"}, other]},
            "textarea": {"found": True, "strategy": "css#1", "tried": []},
        },
        "overrides": {"newChat": [old], "textarea": [{"type": "css", "value": ".keep"}]},
    }
    fake = harness.attach({"diagnostics": diag, "set_selectors": lambda p: p})
    g = harness.gemini
    assert g.heal("newChat") == fix
    assert fake.calls("set_selectors") == [{"overrides": {
        "newChat": [fix, old], "textarea": [{"type": "css", "value": ".keep"}]}}]

    assert g.heal("newChat", pick=1) == other
    with pytest.raises(GeminiError) as info:
        g.heal("newChat", pick=2)
    assert info.value.code == "NO_SUGGESTION"
    with pytest.raises(GeminiError) as info:
        g.heal("textarea")
    assert info.value.code == "NO_SUGGESTION"
    with pytest.raises(BadParams):
        g.heal("nope")


# --- the CLI ---------------------------------------------------------------------

def test_cli_status_json(capsys):
    port = free_port()
    outcome: dict = {}

    def run():
        outcome["code"] = cli.main(["--port", str(port), "--timeout", "5", "status", "--json"])

    worker = threading.Thread(target=run, name="cli")
    worker.start()
    # The CLI is bringing its own server up; the fake dials until it answers.
    fake = FakeExtension(port, {"status": STATUS}).start()
    worker.join(10)
    fake.stop()
    assert outcome == {"code": 0}
    assert json.loads(capsys.readouterr().out) == STATUS


def test_cli_reports_gemini_errors_on_stderr(capsys):
    port = free_port()
    code = cli.main(["--port", str(port), "--timeout", "0.2", "status"])
    captured = capsys.readouterr()
    assert code == 1
    assert captured.out == ""
    assert captured.err.startswith("EXTENSION_NOT_CONNECTED: ")


def test_cli_describe_strategy():
    assert cli.describe_strategy({"type": "css", "value": "button.x"}) == "css 'button.x'"
    assert cli.describe_strategy({"type": "attr", "attr": "aria-label", "match": "^new chat",
                                  "tags": ["button", "a"], "name": "mine"}) \
        == "[mine] attr aria-label ~ /^new chat/ on button, a"
    assert cli.describe_strategy({"type": "icon", "match": "^add$", "climb": "button",
                                  "within": "nav"}) == "icon ~ /^add$/ climb 'button' within 'nav'"
