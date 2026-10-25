"""The owner's Gemini pacing, kept by the bridge itself (plan D6a; docs/product/owner-rules.md).

At least 60 s between two prompts of one bridge process, one prompt per fresh chat, and a breaker:
a refusal, or the third page error within 15 minutes, holds every prompt back for 30 minutes
(`PAUSED`, with `details.until`) while the methods that send none keep working.

No browser and no socket: the client's WebSocket server is swapped for `FakeServer`, and time is a
fake clock that `sleep` moves on, so the 60 s and the 30 minutes pass at once.
"""

from __future__ import annotations

import io
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, cast

import pytest
from helpers import schema_errors
from test_comms_actions import REPLY, facts

from gratovo_pipeline.gemini import actions, pause
from gratovo_pipeline.gemini.browser.manager import BrowserPaths
from gratovo_pipeline.gemini.client import Gemini, SendGap
from gratovo_pipeline.gemini.daemon import Daemon, Out
from gratovo_pipeline.gemini.errors import (
    ActionRefused,
    BridgeTimeout,
    GeminiError,
    GeminiPageError,
    Paused,
)
from gratovo_pipeline.gemini.server import BridgeServer

#: The fake clock's wall time at its start: a refusal now pauses until 14:32 UTC.
START = datetime(2026, 10, 25, 14, 2, tzinfo=UTC)
T0 = 1000.0

Answer = dict[str, Any] | GeminiError


class Clock:
    """Monotonic seconds that only `sleep` (or a test) moves on, and the UTC time that goes
    with them."""

    def __init__(self) -> None:
        self.t = T0
        self.slept: list[float] = []

    def __call__(self) -> float:
        return self.t

    def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.t += seconds

    def wall(self) -> datetime:
        return START + timedelta(seconds=self.t - T0)


def answer(text: str = "Five keywords about AI video tools") -> dict[str, Any]:
    return {"index": 0, "text": text, "textRaw": text, "model": "Pro", "thinking": "High"}


class FakeServer:
    """Stands in for the WebSocket server: answers each prompt with the next scripted answer (or
    raises it), and records every call with the fake time it was made."""

    def __init__(self, clock: Clock, answers: list[Answer] | None = None) -> None:
        self.clock = clock
        self.answers: list[Answer] = list(answers or [])
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.prompted_at: list[float] = []
        self.connected = False
        self.running = True
        self.hello: dict[str, Any] | None = None
        self.port = 0

    def call(
        self, method: str, params: dict[str, Any] | None = None, timeout: float | None = 30.0
    ) -> Any:
        given = dict(params or {})
        self.calls.append((method, given))
        if method in ("send", "queue_add"):
            self.prompted_at.append(self.clock())
            reply = self.answers.pop(0) if self.answers else answer()
            if isinstance(reply, GeminiError):
                raise reply
            return reply
        if method == "get_url":
            return {"url": "https://gemini.google.com/u/0/app", "accountIndex": 0}
        if method == "navigate":
            return {"url": given.get("url"), "tabId": 1}
        return {}

    def prompts(self) -> list[dict[str, Any]]:
        return [params for method, params in self.calls if method in ("send", "queue_add")]


def paced(
    clock: Clock, answers: list[Answer] | None = None, data_dir: Path | None = None
) -> tuple[Gemini, FakeServer]:
    """A client with the owner's real numbers on the fake clock, and the fake behind it."""
    gemini = Gemini(
        port=0,
        auto_open=False,
        data_dir=data_dir,
        send_gap=SendGap(60.0, clock=clock, sleep=clock.sleep),
        breaker=pause.Breaker(clock=clock, now=clock.wall),
    )
    fake = FakeServer(clock, answers)
    gemini.server = cast("BridgeServer", fake)
    return gemini, fake


# --- the 60 s gap ------------------------------------------------------------------------------


def test_a_second_prompt_waits_until_60_s_after_the_first() -> None:
    clock = Clock()
    gemini, fake = paced(clock)
    gemini.ask("first")
    clock.t += 20
    gemini.ask("second")
    assert clock.slept == [40.0]
    assert fake.prompted_at == [T0, T0 + 60]


def test_a_prompt_more_than_60_s_after_the_last_goes_at_once() -> None:
    clock = Clock()
    gemini, _fake = paced(clock)
    gemini.ask("first")
    clock.t += 75
    gemini.ask("second")
    assert clock.slept == []


def test_the_gap_holds_whichever_way_a_prompt_comes_in() -> None:
    # `send`, the engine's `call("send", ...)`, main's proxied `send` and the queue: one gap
    clock = Clock()
    gemini, fake = paced(clock)
    gemini.send("by send")
    gemini.call("send", {"text": "by call", "wait": True})
    gemini.queue("by the queue")
    assert fake.prompted_at == [T0, T0 + 60, T0 + 120]


def test_methods_that_send_no_prompt_never_wait() -> None:
    clock = Clock()
    gemini, _fake = paced(clock)
    gemini.ask("first")
    gemini.status()
    gemini.conversation()
    gemini.call("get_conversation")
    assert clock.slept == []


@pytest.mark.usefixtures("real_send_gap")
def test_the_owners_numbers() -> None:
    assert SendGap().gap_s == 60.0
    assert Gemini(port=0, auto_open=False).send_gap.gap_s == 60.0
    assert pause.WINDOW_S == 15 * 60
    assert pause.ERRORS_TO_TRIP == 3
    assert pause.PAUSE_S == 30 * 60


# --- one prompt per fresh chat -----------------------------------------------------------------


def test_every_prompt_opens_a_new_chat_whatever_the_caller_asked() -> None:
    gemini, fake = paced(Clock())
    gemini.send("one", new_chat=False)
    gemini.ask("two")
    gemini.call("send", {"text": "three", "newChat": False})
    gemini.queue("four", new_chat=False)
    assert [p["newChat"] for p in fake.prompts()] == [True, True, True, True]


def test_a_gems_page_is_the_new_chat_so_the_prompt_after_it_goes_there() -> None:
    gemini, fake = paced(Clock())
    gemini.open_gem("abc123")
    gemini.send("in the gem")
    gemini.send("next")
    assert [p["newChat"] for p in fake.prompts()] == [False, True]


def test_an_action_with_a_gem_sends_into_the_gem() -> None:
    gemini, fake = paced(Clock())
    raw, model = actions._ask(gemini, {"gem": "abc123"}, "AI agents keywords")  # pyright: ignore[reportPrivateUsage]
    assert (raw, model) == ("Five keywords about AI video tools", "Pro")
    assert [m for m, _ in fake.calls] == ["get_url", "navigate", "send"]
    assert fake.prompts()[0]["newChat"] is False


# --- the breaker -------------------------------------------------------------------------------


def breaker(clock: Clock) -> pause.Breaker:
    return pause.Breaker(clock=clock, now=clock.wall)


def test_a_refusal_pauses_for_30_minutes_then_reopens() -> None:
    clock = Clock()
    b = breaker(clock)
    b.refusal()
    assert b.paused_until() == "2026-10-25T14:32:00Z"
    with pytest.raises(Paused) as caught:
        b.check()
    assert caught.value.code == "PAUSED"
    assert caught.value.details == {"until": "2026-10-25T14:32:00Z"}
    clock.t += 30 * 60 - 1
    assert b.paused_until() == "2026-10-25T14:32:00Z"
    clock.t += 1
    assert b.paused_until() is None
    b.check()


def test_two_page_errors_do_not_pause_and_the_third_in_15_minutes_does() -> None:
    clock = Clock()
    b = breaker(clock)
    b.page_error()
    clock.t += 5 * 60
    b.page_error()
    assert b.paused_until() is None
    clock.t += 9 * 60
    b.page_error()
    assert b.paused_until() == "2026-10-25T14:46:00Z"  # 14 minutes in, plus 30


def test_page_errors_older_than_15_minutes_age_out() -> None:
    clock = Clock()
    b = breaker(clock)
    b.page_error()  # 0 min
    clock.t += 10 * 60
    b.page_error()  # 10 min
    clock.t += 6 * 60
    b.page_error()  # 16 min: the first is gone, so two in the window
    assert b.paused_until() is None
    clock.t += 60
    b.page_error()  # 17 min: 10, 16 and 17 are within 15 minutes
    assert b.paused_until() is not None


def test_a_pause_that_ran_out_starts_counting_again() -> None:
    clock = Clock()
    b = breaker(clock)
    for _ in range(3):
        b.page_error()
    clock.t += 30 * 60
    assert b.paused_until() is None
    b.page_error()
    b.page_error()
    assert b.paused_until() is None


@pytest.mark.parametrize(
    ("error", "pauses"),
    [
        (ActionRefused(message="Gemini refused the prompt"), True),
        (GeminiPageError(message="toast", details={"refused": True}), True),
        (GeminiPageError(message="Something went wrong"), False),  # one of three
        (BridgeTimeout(message="no answer"), False),
        (GeminiError("SIGNED_OUT", "signed out"), False),
    ],
)
def test_what_counts_as_a_refusal(error: GeminiError, pauses: bool) -> None:
    b = breaker(Clock())
    b.note(error)
    assert (b.paused_until() is not None) is pauses


def test_a_refusal_given_as_the_answer_pauses() -> None:
    assert pause.is_refusal("I'm having a hard time fulfilling your request.")
    assert not pause.is_refusal("Here are five keywords: " + "AI agents " * 60)
    b = breaker(Clock())
    b.note_answer("Here are five keywords about AI agents.")
    assert b.paused_until() is None
    b.note_answer("I'm having a hard time fulfilling your request.")
    assert b.paused_until() is not None


@pytest.mark.parametrize(
    "text",
    [
        "I'm having a hard time fulfilling your request.",
        "Sorry, I can't help with that.",
        "I'm unable to assist with that.",
    ],
)
def test_a_true_refusal_is_not_a_generic_error(text: str) -> None:
    assert pause.is_refusal(text)
    assert not pause.is_generic_error(text)


@pytest.mark.parametrize(
    "text",
    [
        "Sorry, something went wrong. Please try your request again.",
        "Please try again later.",
        "An error occurred.",
        "حدث خطأ",
    ],
)
def test_the_pages_generic_error_is_one_of_three_not_a_refusal(text: str) -> None:
    # the owner's rule: "a refusal toast, or three generic errors in 15 minutes"
    assert pause.is_generic_error(text)
    assert not pause.is_refusal(text)
    clock = Clock()
    b = breaker(clock)
    b.note_answer(text)
    b.note_answer(text)
    assert b.paused_until() is None
    b.note_answer(text)
    assert b.paused_until() == "2026-10-25T14:32:00Z"


def test_three_generic_error_answers_pause_the_client_and_two_do_not() -> None:
    went_wrong = answer("Sorry, something went wrong.")
    gemini, fake = paced(Clock(), [went_wrong, went_wrong, went_wrong])
    gemini.ask("AI news keywords")
    gemini.ask("AI news keywords")
    assert gemini.breaker.paused_until() is None
    gemini.ask("AI news keywords")
    with pytest.raises(Paused):
        gemini.ask("AI news keywords")
    assert len(fake.prompts()) == 3


def test_an_action_raises_a_generic_error_answer_as_a_page_error() -> None:
    gemini, _fake = paced(Clock(), [answer("Sorry, something went wrong.")])
    with pytest.raises(GeminiPageError):
        actions._ask(gemini, {}, "AI agents keywords")  # pyright: ignore[reportPrivateUsage]
    assert gemini.breaker.paused_until() is None  # one of three
    actions._ask(gemini, {}, "AI agents keywords")  # pyright: ignore[reportPrivateUsage]


def test_the_engine_raises_a_refusal_answer_as_a_refusal() -> None:
    from gratovo_pipeline.comms import engine

    gemini, fake = paced(Clock(), [answer("I'm having a hard time fulfilling your request.")])
    with pytest.raises(ActionRefused):
        engine._send(  # pyright: ignore[reportPrivateUsage]
            gemini, "the case", new_chat=True, skill=None, mode="", tab_id=None, timeout_s=60
        )
    assert gemini.breaker.paused_until() is not None
    assert len(fake.prompts()) == 1


# --- the breaker on the client: nothing reaches the page while it is open ----------------------


def test_a_refused_answer_pauses_and_the_next_prompt_never_reaches_the_page() -> None:
    clock = Clock()
    gemini, fake = paced(clock, [answer("I'm having a hard time fulfilling your request.")])
    gemini.ask("first")
    with pytest.raises(Paused) as caught:
        gemini.ask("second")
    assert caught.value.details["until"] == "2026-10-25T14:32:00Z"
    assert len(fake.prompts()) == 1
    assert clock.slept == []  # failed at once, without waiting out the gap


def test_three_page_errors_pause_the_client() -> None:
    clock = Clock()
    error = GeminiPageError(message="Something went wrong")
    gemini, fake = paced(clock, [error, error, error])
    for _ in range(3):
        with pytest.raises(GeminiPageError):
            gemini.ask("AI news keywords")
    with pytest.raises(Paused):
        gemini.ask("AI news keywords")
    assert len(fake.prompts()) == 3


def test_an_action_refused_once_is_not_sent_again() -> None:
    # the old `_ask` sent a refused prompt again at once; now it raises and the bridge pauses
    gemini, fake = paced(Clock(), [answer("I'm having a hard time fulfilling your request.")])
    with pytest.raises(ActionRefused):
        actions._ask(gemini, {}, "AI agents keywords")  # pyright: ignore[reportPrivateUsage]
    with pytest.raises(Paused):
        actions._ask(gemini, {}, "AI agents keywords")  # pyright: ignore[reportPrivateUsage]
    assert len(fake.prompts()) == 1


# --- the breaker in the daemon: per method -----------------------------------------------------


def daemon_with(gemini: Gemini, tmp_path: Path) -> tuple[Daemon, io.StringIO]:
    stdout = io.StringIO()
    daemon = Daemon(
        0,
        tmp_path,
        Out(stdout),
        BrowserPaths(profile_dir=tmp_path / "profile", extension_dir=tmp_path / "extension"),
    )
    daemon.gemini = gemini
    return daemon, stdout


def test_the_prompt_methods_are_listed_once() -> None:
    expected = {
        "send",
        "queue_add",
        "bridge.ask",
        "action.generate_keywords",
        "action.classify_channel",
        "action.comms_propose",
    }
    assert expected == pause.PROMPT_METHODS
    for method in ("bridge.status", "action.comms_check", "action.skills_list", "status"):
        assert not pause.sends_prompt(method)


@pytest.mark.parametrize(
    ("method", "params"),
    [
        ("bridge.ask", {"prompt": "AI agents keywords"}),
        ("send", {"text": "AI agents keywords", "wait": True}),
        ("queue_add", {"prompt": "AI agents keywords"}),
        ("action.generate_keywords", {"topic": "AI agents"}),
        ("action.classify_channel", {"channel": {"handle": "@promptlab"}, "niche": "AI tools"}),
        ("action.comms_propose", {"request": REPLY, "facts": facts()}),
    ],
)
def test_while_paused_every_prompt_method_fails_at_once(
    tmp_path: Path, method: str, params: dict[str, Any]
) -> None:
    clock = Clock()
    gemini, fake = paced(clock, data_dir=tmp_path)
    gemini.breaker.refusal()
    daemon, _out = daemon_with(gemini, tmp_path)
    with pytest.raises(Paused):
        daemon.dispatch(method, params)
    assert fake.calls == []


def test_while_paused_the_methods_that_send_no_prompt_still_work(tmp_path: Path) -> None:
    gemini, fake = paced(Clock(), data_dir=tmp_path)
    gemini.breaker.refusal()
    daemon, _out = daemon_with(gemini, tmp_path)
    status = daemon.dispatch("bridge.status", {})
    assert status["pausedUntil"] == "2026-10-25T14:32:00Z"
    checked = daemon.dispatch(
        "action.comms_check",
        {"request": REPLY, "facts": facts(), "subject": "Re: hi", "body": "Hi Sam, thanks."},
    )
    assert "blocking" in checked
    daemon.dispatch("get_conversation", {})
    assert [m for m, _ in fake.calls] == ["get_conversation"]


def test_a_paused_answer_on_the_wire_names_when_it_ends(
    tmp_path: Path, gemini_schema: dict[str, Any]
) -> None:
    gemini, _fake = paced(Clock(), data_dir=tmp_path)
    gemini.breaker.refusal()
    daemon, out = daemon_with(gemini, tmp_path)
    daemon.handle({"id": "p1", "method": "bridge.ask", "params": {"prompt": "hi"}})
    line = json.loads(out.getvalue())
    assert line["ok"] is False
    assert line["error"]["code"] == "PAUSED"
    assert line["error"]["details"] == {"until": "2026-10-25T14:32:00Z"}
    assert schema_errors(gemini_schema["fromGemini"], line) == []


def test_status_says_when_the_pause_ends_and_null_when_there_is_none(
    tmp_path: Path, gemini_schema: dict[str, Any]
) -> None:
    clock = Clock()
    gemini, _fake = paced(clock, data_dir=tmp_path)
    daemon, _out = daemon_with(gemini, tmp_path)
    result = gemini_schema["results"]["bridge.status"]
    open_status = daemon.dispatch("bridge.status", {})
    assert open_status["pausedUntil"] is None
    assert schema_errors(result, open_status) == []
    gemini.breaker.refusal()
    paused_status = daemon.dispatch("bridge.status", {})
    assert paused_status["pausedUntil"] == "2026-10-25T14:32:00Z"
    assert schema_errors(result, paused_status) == []
    clock.t += 30 * 60
    assert daemon.dispatch("bridge.status", {})["pausedUntil"] is None


def test_the_daemon_counts_an_actions_own_page_errors(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # the engine reads "something went wrong" in an answer and raises it itself, past the client
    gemini, _fake = paced(Clock(), data_dir=tmp_path)
    daemon, _out = daemon_with(gemini, tmp_path)

    def page_error(_method: str, _params: dict[str, Any]) -> Any:
        raise GeminiPageError(message="Sorry, something went wrong")

    monkeypatch.setattr(daemon, "route", page_error)
    for _ in range(3):
        with pytest.raises(GeminiPageError):
            daemon.dispatch("action.comms_propose", {})
    with pytest.raises(Paused):
        daemon.dispatch("action.comms_propose", {})


def test_an_error_the_client_counted_is_not_counted_again(tmp_path: Path) -> None:
    error = GeminiPageError(message="Something went wrong")
    gemini, _fake = paced(Clock(), [error, error], data_dir=tmp_path)
    daemon, _out = daemon_with(gemini, tmp_path)
    for _ in range(2):
        with pytest.raises(GeminiPageError):
            daemon.dispatch("bridge.ask", {"prompt": "AI news keywords"})
    # two page errors, each counted once: still open (four counts would have paused it)
    assert gemini.breaker.paused_until() is None
