"""Tests for the Gemini bridge's Python half: the server and the `Gemini` facade.

No browser and no network beyond 127.0.0.1. The extension is played by `FakeExtension`
(`fake_extension.py`), which dials the bridge exactly the way the real one does (`websockets`
client, `hello` on connect, answers pings) and answers requests from a script:
`{method: result | WireError | callable}`.

WHAT IS BEING PINNED
--------------------
The bridge's promises to the program that drives it, not the extension's DOM work (that is the
extension's own test problem):

  * a `call()` returns the matching response and nothing else, even with several in flight --
    the request-id correlation;
  * every failure surfaces as the right `GeminiError` subclass with the wire `details` intact,
    including the ones that never cross the wire (no extension, disconnect mid-call, RPC
    timeout);
  * `wait()` finishes a job whether the extension announces it or not -- the polling fallback
    exists because the extension keeps working while Python is away and the event for that job is
    never sent;
  * `ensure_account` visits `/u/0`, `/u/1`, ... and STOPS on Google's redirect, reporting which
    accounts it did see;
  * a reloaded extension (a second connection) replaces the first cleanly.

Every fixture tears its threads down and the autouse check below fails a test that leaves one
behind. The old file also tested `cli.py`; the CLI is not ported (plan D13), so those three tests
are gone.
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from collections.abc import Iterator
from typing import Any

import pytest
from fake_extension import (
    NO_REPLY,
    THREAD_PREFIXES,
    Harness,
    Scripted,
    WireError,
    wait_until,
)

from gratovo_pipeline.gemini.client import Gemini, Job
from gratovo_pipeline.gemini.errors import (
    AccountNotFound,
    BadParams,
    BridgeTimeout,
    ElementNotFound,
    ExtensionNotConnected,
    GeminiError,
    JobFailed,
    ModelNotFound,
    error_from_payload,
)

# Every test here talks to a fake extension on 127.0.0.1 (conftest.py, the `loopback` fixture).
pytestmark = pytest.mark.usefixtures("loopback")


@pytest.fixture
def harness() -> Iterator[Harness]:
    h = Harness()
    try:
        yield h
    finally:
        h.close()


@pytest.fixture(autouse=True)
def no_threads_left_behind() -> Iterator[None]:
    yield
    # Give the joins a moment; then anything of ours still alive is a leak.
    deadline = time.monotonic() + 2
    ours: list[str] = []
    while time.monotonic() < deadline:
        ours = [t.name for t in threading.enumerate() if t.name.startswith(THREAD_PREFIXES)]
        if not ours:
            return
        time.sleep(0.05)
    raise AssertionError(f"threads left behind: {ours}")


STATUS: dict[str, Any] = {
    "url": "https://gemini.google.com/u/0/app",
    "accountIndex": 0,
    "account": {"name": "Alice", "email": "alice@example.com"},
    "model": {"name": "2.5 Pro"},
    "generating": False,
    "signedOut": False,
    "pageError": None,
    "elements": {"textarea": {"found": True, "strategy": "css#1"}},
    "queue": {"length": 0, "paused": False, "running": None},
    "ready": True,
}


# --- connection ------------------------------------------------------------------


def test_connect_hello_and_connected(harness: Harness) -> None:
    g = harness.gemini
    assert g.port != 0
    assert not g.connected
    fake = harness.attach({"status": STATUS})
    assert g.connected
    assert g.server.hello is not None
    assert g.server.hello["extensionVersion"] == "0.0-test"
    assert g.status() == STATUS
    assert fake.calls("status") == [{}]


def test_not_connected_raises(harness: Harness) -> None:
    with pytest.raises(ExtensionNotConnected) as info:
        harness.gemini.status()
    assert info.value.code == "EXTENSION_NOT_CONNECTED"
    assert "popup" in info.value.message


def test_context_manager_gives_up_when_nothing_connects() -> None:
    g = Gemini(port=0, connect_timeout=0.3, auto_open=False)
    with pytest.raises(ExtensionNotConnected) as info, g:
        pass
    assert "0.3s" in info.value.message
    assert not g.server.running


def test_newest_connection_wins(harness: Harness) -> None:
    first = harness.attach({"status": {"who": "first"}})
    second = harness.attach({"status": {"who": "second"}})
    assert first.closed.wait(5)
    assert (first.close_code, first.close_reason) == (1000, "replaced")
    assert harness.gemini.connected
    assert harness.gemini.status() == {"who": "second"}
    assert first.calls("status") == []
    assert second.calls("status") == [{}]


def test_disconnect_fails_the_calls_in_flight(harness: Harness) -> None:
    fake = harness.attach({"hang": lambda _p: NO_REPLY})
    outcome: dict[str, GeminiError] = {}

    def run() -> None:
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


def test_answers_the_extensions_ping(harness: Harness) -> None:
    fake = harness.attach({"probe": {"ok": 1}})
    fake.send_raw({"type": "ping"})
    wait_until(lambda: fake.pongs == 1, what="the pong")
    # ...and the socket is still healthy afterwards.
    assert harness.gemini.call("probe") == {"ok": 1}


# --- requests --------------------------------------------------------------------


def test_two_concurrent_calls_are_correlated(harness: Harness) -> None:
    async def slow(params: dict[str, Any]) -> dict[str, Any]:
        await asyncio.sleep(0.4)
        return {"which": "slow", "n": params["n"]}

    harness.attach({"slow": slow, "fast": lambda p: {"which": "fast", "n": p["n"]}})
    g = harness.gemini
    results: dict[str, tuple[Any, float]] = {}

    def call_slow() -> None:
        results["slow"] = (g.call("slow", {"n": 1}), time.monotonic())

    worker = threading.Thread(target=call_slow)
    worker.start()
    time.sleep(0.05)  # make sure `slow` is already in flight
    results["fast"] = (g.call("fast", {"n": 2}), time.monotonic())
    worker.join(5)
    assert results["slow"][0] == {"which": "slow", "n": 1}
    assert results["fast"][0] == {"which": "fast", "n": 2}
    assert results["fast"][1] < results["slow"][1], "fast should not wait behind slow"


def test_wire_error_becomes_the_right_subclass(harness: Harness) -> None:
    details: dict[str, Any] = {
        "element": "newChat",
        "tried": [{"strategy": "css#1", "matched": 0, "visible": 0}],
        "candidates": [],
    }
    harness.attach(
        {
            "new_chat": WireError("ELEMENT_NOT_FOUND", "no New chat button", details),
            "set_model": WireError(
                "MODEL_NOT_FOUND", "nope", {"wanted": "Ultra", "available": ["Pro"]}
            ),
            "weird": WireError("SOMETHING_NEW", "from the future"),
        }
    )
    g = harness.gemini
    with pytest.raises(ElementNotFound) as info:
        g.new_chat()
    assert info.value.code == "ELEMENT_NOT_FOUND"
    assert info.value.message == "no New chat button"
    assert info.value.details == details
    assert str(info.value) == "ELEMENT_NOT_FOUND: no New chat button"

    with pytest.raises(ModelNotFound) as model_info:
        g.set_model("Ultra")
    assert model_info.value.details["available"] == ["Pro"]

    # An unknown code is mapped to UNKNOWN, with the original kept in the details, so every
    # error the bridge writes is one main knows (errors.py).
    with pytest.raises(GeminiError) as weird_info:
        g.call("weird")
    assert type(weird_info.value) is GeminiError
    assert weird_info.value.code == "UNKNOWN"
    assert weird_info.value.details["code"] == "SOMETHING_NEW"

    with pytest.raises(BadParams):
        g.call("not_a_method")


def test_error_from_payload_is_tolerant() -> None:
    assert type(error_from_payload({"code": "BUSY"})).__name__ == "Busy"
    unknown = error_from_payload({"code": "NEW_CODE", "message": "m", "details": None})
    assert type(unknown) is GeminiError
    assert unknown.details == {"code": "NEW_CODE"}
    assert error_from_payload("garbage").code == "UNKNOWN"


def test_rpc_timeout(harness: Harness) -> None:
    harness.attach({"hang": lambda _p: NO_REPLY})
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


def test_call_refuses_the_loop_thread(harness: Harness) -> None:
    harness.attach({})
    server = harness.gemini.server
    caught: dict[str, Any] = {}

    def on_loop() -> None:
        try:
            server.call("status")
        except RuntimeError as error:
            caught["error"] = error
        finally:
            caught["done"] = True

    loop = server._loop  # pyright: ignore[reportPrivateUsage]
    assert loop is not None
    loop.call_soon_threadsafe(on_loop)
    wait_until(lambda: caught.get("done"), what="the loop-thread probe")
    assert "event-loop thread" in str(caught["error"])


# --- events ----------------------------------------------------------------------


def test_events_reach_listeners_and_can_call_back(harness: Harness) -> None:
    fake = harness.attach({"status": STATUS})
    g = harness.gemini
    seen: list[dict[str, Any]] = []
    from_callback: dict[str, Any] = {}

    def on_job(data: dict[str, Any]) -> None:
        seen.append(data)

    def on_status(_data: dict[str, Any]) -> None:
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


def test_a_crashing_listener_does_not_break_delivery(harness: Harness) -> None:
    fake = harness.attach({})
    g = harness.gemini
    seen: list[dict[str, Any]] = []

    def bad(_data: dict[str, Any]) -> None:
        raise ValueError("boom")

    g.on("job", bad)
    g.on("job", seen.append)
    fake.send_event("job", {"id": "job_1", "status": "done"})
    wait_until(lambda: seen, what="delivery after a crashing listener")


def test_log_events_go_to_logging(harness: Harness, caplog: pytest.LogCaptureFixture) -> None:
    fake = harness.attach({})
    logger_name = "gratovo_pipeline.gemini.extension"

    def ours() -> list[logging.LogRecord]:
        return [r for r in caplog.records if r.name == logger_name]

    with caplog.at_level(logging.DEBUG, logger=logger_name):
        fake.send_event(
            "log", {"level": "warn", "message": "send button moved", "context": {"tabId": 3}}
        )
        wait_until(ours, what="the log record")
    record = ours()[0]
    assert record.levelno == logging.WARNING
    assert "send button moved" in record.getMessage()
    assert '"tabId": 3' in record.getMessage()


# --- the facade ------------------------------------------------------------------


def test_ask_maps_to_send(harness: Harness) -> None:
    fake = harness.attach(
        {
            "send": lambda _p: {
                "index": 0,
                "text": "the answer",
                "html": "<p>",
                "durationMs": 10,
                "model": "2.5 Pro",
            }
        }
    )
    assert harness.gemini.ask("hi", new_chat=True, model="Pro", timeout=42) == "the answer"
    assert fake.calls("send") == [
        {"wait": True, "text": "hi", "newChat": True, "model": "Pro", "timeoutMs": 42000}
    ]


def test_send_without_wait(harness: Harness) -> None:
    fake = harness.attach({"send": {"sent": True}})
    assert harness.gemini.send("hi", wait=False) == {"sent": True}
    assert fake.calls("send")[0]["wait"] is False


def test_queue_returns_a_job(harness: Harness) -> None:
    raw: dict[str, Any] = {
        "id": "job_7",
        "prompt": "hi",
        "status": "queued",
        "meta": {"channel_id": 12},
        "result": None,
        "error": None,
    }
    fake = harness.attach({"queue_add": raw})
    job = harness.gemini.queue("hi", new_chat=True, model="Flash", meta={"channel_id": 12})
    assert isinstance(job, Job)
    assert (job.id, job.status, job.text, job.result, job.error) == (
        "job_7",
        "queued",
        None,
        None,
        None,
    )
    assert job.meta == {"channel_id": 12}
    assert job.raw == raw
    assert fake.calls("queue_add") == [
        {"prompt": "hi", "newChat": True, "model": "Flash", "meta": {"channel_id": 12}}
    ]


def test_wait_resolves_via_event(harness: Harness) -> None:
    running: dict[str, Any] = {"id": "job_7", "status": "running", "result": None, "error": None}
    fake = harness.attach({"queue_get": running})
    done: dict[str, Any] = {
        "id": "job_7",
        "status": "done",
        "result": {"index": 1, "text": "42"},
        "error": None,
    }
    timer = threading.Timer(0.2, fake.send_event, args=("job", done))
    timer.start()
    # `poll=5` is longer than the test, so only the event can finish this.
    assert harness.gemini.wait(Job(running), timeout=5, poll=5) == "42"
    timer.join()
    assert fake.calls("queue_get") == []


def test_wait_resolves_via_polling_when_no_event_comes(harness: Harness) -> None:
    polls = {"n": 0}

    def queue_get(params: dict[str, Any]) -> dict[str, Any]:
        assert params == {"jobId": "job_7"}
        polls["n"] += 1
        if polls["n"] < 3:
            return {"id": "job_7", "status": "running"}
        return {"id": "job_7", "status": "done", "result": {"text": "polled"}}

    harness.attach({"queue_get": queue_get})
    assert harness.gemini.wait("job_7", timeout=5, poll=0.1) == "polled"
    assert polls["n"] == 3


def test_wait_survives_a_reconnect(harness: Harness) -> None:
    first = harness.attach({"queue_get": {"id": "job_7", "status": "running"}})
    outcome: dict[str, Any] = {}

    def run() -> None:
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


def test_wait_raises_job_failed(harness: Harness) -> None:
    failed: dict[str, Any] = {
        "id": "job_7",
        "status": "error",
        "result": None,
        "error": {
            "code": "GEMINI_ERROR",
            "message": "limit reached",
            "details": {"signal": "toast"},
        },
    }
    harness.attach({"queue_get": failed})
    with pytest.raises(JobFailed) as info:
        harness.gemini.wait("job_7", timeout=5, poll=0.05)
    assert info.value.code == "GEMINI_ERROR"
    assert info.value.message == "limit reached"
    assert info.value.details["signal"] == "toast"
    assert info.value.details["job"] == failed
    assert info.value.job == failed

    harness.fakes[0].handlers["queue_get"] = {"id": "job_8", "status": "cancelled", "error": None}
    with pytest.raises(JobFailed) as cancelled:
        harness.gemini.wait("job_8", timeout=5, poll=0.05)
    assert cancelled.value.code == "CANCELLED"


def test_wait_times_out(harness: Harness) -> None:
    harness.attach({"queue_get": {"id": "job_7", "status": "running"}})
    with pytest.raises(BridgeTimeout) as info:
        harness.gemini.wait("job_7", timeout=0.3, poll=0.1)
    assert info.value.details == {"phase": "job", "jobId": "job_7", "timeoutMs": 300}


# --- ensure_account ----------------------------------------------------------------

ALICE: dict[str, Any] = {"name": "Alice Example", "email": "alice@example.com", "index": 0}
BOB: dict[str, Any] = {"name": "Bob Example", "email": "bob@example.com", "index": 1}


def account_script() -> dict[str, Scripted]:
    """Two accounts signed in; `/u/2` and up redirect to `/u/0` like Google does."""
    accounts = {0: ALICE, 1: BOB}
    state = {"index": 0}

    def switch_account(params: dict[str, Any]) -> dict[str, Any]:
        wanted: int = params["index"]
        landed = wanted if wanted in accounts else 0
        state["index"] = landed
        return {
            "requested": wanted,
            "landedIndex": landed,
            "url": f"https://gemini.google.com/u/{landed}/app",
            "redirected": landed != wanted,
            "account": accounts[landed],
        }

    return {"get_account": lambda _p: accounts[state["index"]], "switch_account": switch_account}


def test_ensure_account_returns_the_current_one_without_switching(harness: Harness) -> None:
    fake = harness.attach(account_script())
    assert harness.gemini.ensure_account("ALICE") == ALICE
    assert fake.calls("switch_account") == []


def test_ensure_account_switches_to_bob(harness: Harness) -> None:
    fake = harness.attach(account_script())
    assert harness.gemini.ensure_account("bob@") == BOB
    assert [p["index"] for p in fake.calls("switch_account")] == [0, 1]


def test_ensure_account_stops_at_the_redirect_and_lists_what_it_saw(harness: Harness) -> None:
    fake = harness.attach(account_script())
    with pytest.raises(AccountNotFound) as info:
        harness.gemini.ensure_account("carol")
    assert info.value.tried == [(0, ALICE), (1, BOB)]
    assert [p["index"] for p in fake.calls("switch_account")] == [0, 1, 2]
    assert "alice@example.com" in info.value.message
    assert "bob@example.com" in info.value.message
    assert info.value.details["tried"][1] == {"index": 1, "account": BOB}


def test_ensure_account_stops_on_a_url_without_u(harness: Harness) -> None:
    script = account_script()
    script["switch_account"] = lambda p: {
        "requested": p["index"],
        "landedIndex": 0,
        "url": "https://gemini.google.com/app",
        "redirected": True,
        "account": ALICE,
    }
    fake = harness.attach(script)
    with pytest.raises(AccountNotFound) as info:
        harness.gemini.ensure_account("bob")
    assert info.value.tried == []
    assert len(fake.calls("switch_account")) == 1


# --- healing ---------------------------------------------------------------------


def test_heal_prepends_the_picked_suggestion(harness: Harness) -> None:
    fix = {"type": "css", "value": "button.my-fix"}
    other = {"type": "attr", "attr": "aria-label", "match": "^new chat"}
    old = {"type": "css", "value": "button.old-fix"}
    diag: dict[str, Any] = {
        "url": "https://gemini.google.com/app",
        "elements": {
            "newChat": {
                "found": False,
                "strategy": None,
                "tried": [],
                "candidates": [],
                "suggestions": [{"strategy": fix, "reason": "aria matches"}, other],
            },
            "textarea": {"found": True, "strategy": "css#1", "tried": []},
        },
        "overrides": {"newChat": [old], "textarea": [{"type": "css", "value": ".keep"}]},
    }
    fake = harness.attach({"diagnostics": diag, "set_selectors": lambda p: p})
    g = harness.gemini
    assert g.heal("newChat") == fix
    assert fake.calls("set_selectors") == [
        {
            "overrides": {
                "newChat": [fix, old],
                "textarea": [{"type": "css", "value": ".keep"}],
            }
        }
    ]

    assert g.heal("newChat", pick=1) == other
    with pytest.raises(GeminiError) as info:
        g.heal("newChat", pick=2)
    assert info.value.code == "NO_SUGGESTION"
    with pytest.raises(GeminiError) as no_suggestion:
        g.heal("textarea")
    assert no_suggestion.value.code == "NO_SUGGESTION"
    with pytest.raises(BadParams):
        g.heal("nope")


def test_text_from_the_extension_never_breaks_a_log_line() -> None:
    from gratovo_pipeline.gemini.server import _one_line  # pyright: ignore[reportPrivateUsage]

    forged = "ok\n2026-10-23 INFO gratovo_pipeline.gemini: extension connected\r\n"
    line = _one_line(forged)
    assert "\n" not in line
    assert "\r" not in line
    assert line.startswith(r"ok\n2026-10-23")
    assert _one_line({"id": 3}) == "{'id': 3}"
    assert len(_one_line("x" * 5000)) == 2000
