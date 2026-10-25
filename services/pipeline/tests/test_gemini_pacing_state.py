"""The owner's Gemini pacing survives a restart of the bridge (plan D6a; pacing_state.py).

A crash, or a person's Stop then Start in Settings, must not end a 30-minute pause early or let a
prompt go sooner than 60 s after the last one. The bridge saves the pause's end, the last send and
the page errors in the window beside the browser profile, and reads them back when it starts.

No browser and no socket: time is the fake clock of test_gemini_pacing.py, and a "restart" is a
new store, breaker and send gap (or a new `Daemon`) over the same file.
"""

from __future__ import annotations

import io
import json
import logging
from collections.abc import Coroutine
from datetime import timedelta
from pathlib import Path
from typing import Any, cast

import pytest
from test_comms_actions import REPLY, facts
from test_gemini_pacing import START, T0, Clock, FakeServer, answer

from gratovo_pipeline.gemini import actions, pause
from gratovo_pipeline.gemini.browser.manager import BrowserPaths
from gratovo_pipeline.gemini.client import Gemini, SendGap
from gratovo_pipeline.gemini.daemon import Daemon, Out
from gratovo_pipeline.gemini.errors import ActionRefused, GeminiPageError, Paused
from gratovo_pipeline.gemini.pacing_state import PACING_FILE, PacingStore
from gratovo_pipeline.gemini.server import BridgeServer

#: Text standing in for a prompt or an answer: it must never reach a log line.
PRIVATE = "Sam from Prompt Lab reviews AI agents"


def store(path: Path, clock: Clock) -> PacingStore:
    return PacingStore(path, now=clock.wall)


def breaker(path: Path, clock: Clock) -> pause.Breaker:
    """A bridge's breaker as it starts: it reads what the last one saved."""
    return pause.Breaker(clock=clock, now=clock.wall, store=store(path, clock))


def gap(path: Path, clock: Clock) -> SendGap:
    """A bridge's send gap as it starts, with the owner's 60 s."""
    return SendGap(60.0, clock=clock, sleep=clock.sleep, store=store(path, clock))


def saved(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


# --- the pause --------------------------------------------------------------------------------


def test_a_restart_within_the_pause_stays_paused_until_the_same_time(tmp_path: Path) -> None:
    path = tmp_path / PACING_FILE
    clock = Clock()
    breaker(path, clock).refusal()
    assert saved(path)["pausedUntil"] == "2026-10-25T14:32:00+00:00"
    clock.t += 10 * 60  # the bridge crashes and starts again 10 minutes later
    restarted = breaker(path, clock)
    assert restarted.paused_until() == "2026-10-25T14:32:00Z"
    with pytest.raises(Paused) as caught:
        restarted.check()
    assert caught.value.details == {"until": "2026-10-25T14:32:00Z"}
    clock.t += 20 * 60
    assert restarted.paused_until() is None


def test_a_restart_after_the_pause_ran_out_is_open(tmp_path: Path) -> None:
    path = tmp_path / PACING_FILE
    clock = Clock()
    breaker(path, clock).refusal()
    clock.t += 30 * 60
    assert breaker(path, clock).paused_until() is None


def test_a_restarted_daemon_refuses_every_prompt_method_while_paused(tmp_path: Path) -> None:
    # The daemon's own wiring: the store sits beside the browser profile, real clocks.
    paths = BrowserPaths(profile_dir=tmp_path / "profile", extension_dir=tmp_path / "extension")
    first = Daemon(0, tmp_path / "data", Out(io.StringIO()), paths)
    first.gemini.breaker.refusal()
    until = first.gemini.breaker.paused_until()
    assert until is not None
    assert (tmp_path / "profile" / PACING_FILE).is_file()

    # Stop, then Start in Settings: a new process, so a new daemon over the same profile.
    second = Daemon(0, tmp_path / "data", Out(io.StringIO()), paths)
    fake = FakeServer(Clock())
    second.gemini.server = cast("BridgeServer", fake)
    assert second.dispatch("bridge.status", {})["pausedUntil"] == until
    for method, params in [
        ("bridge.ask", {"prompt": "AI agents keywords"}),
        ("send", {"text": "AI agents keywords", "wait": True}),
        ("queue_add", {"prompt": "AI agents keywords"}),
        ("action.generate_keywords", {"topic": "AI agents"}),
        ("action.classify_channel", {"channel": {"handle": "@promptlab"}, "niche": "AI tools"}),
        ("action.comms_propose", {"request": REPLY, "facts": facts()}),
    ]:
        with pytest.raises(Paused) as caught:
            second.dispatch(method, params)
        assert caught.value.code == "PAUSED"
    assert [m for m, _ in fake.calls] == []


def test_two_page_errors_before_a_restart_and_one_after_pause(tmp_path: Path) -> None:
    path = tmp_path / PACING_FILE
    clock = Clock()
    first = breaker(path, clock)
    first.page_error()
    clock.t += 60
    first.page_error()
    assert len(saved(path)["pageErrors"]) == 2
    clock.t += 60  # Stop, then Start, hoping to wipe the count
    restarted = breaker(path, clock)
    assert restarted.paused_until() is None
    restarted.page_error()
    assert restarted.paused_until() == "2026-10-25T14:34:00Z"
    assert saved(path)["pageErrors"] == []


def test_saved_page_errors_older_than_15_minutes_are_dropped(tmp_path: Path) -> None:
    path = tmp_path / PACING_FILE
    clock = Clock()
    first = breaker(path, clock)
    first.page_error()
    first.page_error()
    clock.t += 16 * 60
    restarted = breaker(path, clock)
    restarted.page_error()
    restarted.page_error()
    assert restarted.paused_until() is None


# --- the 60 s gap -----------------------------------------------------------------------------


def test_a_restart_within_60_s_of_the_last_send_waits_out_the_rest(tmp_path: Path) -> None:
    path = tmp_path / PACING_FILE
    clock = Clock()
    gap(path, clock).wait()
    assert saved(path)["lastSend"] == "2026-10-25T14:02:00+00:00"
    clock.t += 20
    restarted = gap(path, clock)
    assert restarted.wait() == 40.0
    assert clock.slept == [40.0]


def test_a_restart_more_than_60_s_after_the_last_send_goes_at_once(tmp_path: Path) -> None:
    path = tmp_path / PACING_FILE
    clock = Clock()
    gap(path, clock).wait()
    clock.t += 75
    assert gap(path, clock).wait() == 0.0
    assert clock.slept == []


def test_a_restarted_client_waits_before_its_first_prompt(tmp_path: Path) -> None:
    path = tmp_path / PACING_FILE
    clock = Clock()

    def client() -> tuple[Gemini, FakeServer]:
        gemini = Gemini(
            port=0,
            auto_open=False,
            send_gap=gap(path, clock),
            breaker=breaker(path, clock),
        )
        fake = FakeServer(clock)
        gemini.server = cast("BridgeServer", fake)
        return gemini, fake

    first, _ = client()
    first.ask("first")
    clock.t += 5
    second, fake = client()
    second.ask("second")
    assert fake.prompted_at == [T0 + 60]


# --- a file that cannot be trusted ------------------------------------------------------------


@pytest.mark.parametrize(
    "content",
    [
        "{not json",
        "",
        "[]",
        '"paused"',
        json.dumps({"pausedUntil": "half past two", "lastSend": 5, "pageErrors": "many"}),
        # a time without its zone is not trusted either
        json.dumps({"pausedUntil": "2026-10-25T14:20:00", "lastSend": "2026-10-25T14:01:50"}),
    ],
)
def test_a_malformed_file_reads_as_no_pause_and_no_previous_send(
    tmp_path: Path, content: str
) -> None:
    path = tmp_path / PACING_FILE
    path.write_text(content, encoding="utf-8")
    clock = Clock()
    b = breaker(path, clock)
    assert b.paused_until() is None
    b.page_error()
    b.page_error()
    assert b.paused_until() is None  # no page errors came from the file either
    assert gap(path, clock).wait() == 0.0
    # the next change writes a whole, valid file over it
    assert saved(path)["lastSend"] == "2026-10-25T14:02:00+00:00"


def test_a_missing_file_reads_as_nothing_saved(tmp_path: Path) -> None:
    clock = Clock()
    path = tmp_path / "not-yet" / PACING_FILE
    assert breaker(path, clock).paused_until() is None
    assert gap(path, clock).wait() == 0.0
    assert path.is_file()  # its folder is made on the first write


def test_a_pause_beyond_the_longest_pause_is_clamped(tmp_path: Path) -> None:
    # the computer's clock moved back after the pause began: never more than 30 minutes from now
    path = tmp_path / PACING_FILE
    path.write_text(
        json.dumps({"pausedUntil": (START + timedelta(hours=5)).isoformat()}), encoding="utf-8"
    )
    clock = Clock()
    b = breaker(path, clock)
    assert b.paused_until() == "2026-10-25T14:32:00Z"
    clock.t += 30 * 60
    assert b.paused_until() is None


def test_a_last_send_in_the_future_waits_the_full_gap(tmp_path: Path) -> None:
    path = tmp_path / PACING_FILE
    path.write_text(
        json.dumps({"lastSend": (START + timedelta(hours=2)).isoformat()}), encoding="utf-8"
    )
    clock = Clock()
    assert gap(path, clock).wait() == 60.0


def test_page_errors_in_the_future_count_as_now(tmp_path: Path) -> None:
    path = tmp_path / PACING_FILE
    later = (START + timedelta(hours=3)).isoformat()
    path.write_text(json.dumps({"pageErrors": [later, later]}), encoding="utf-8")
    clock = Clock()
    b = breaker(path, clock)
    b.page_error()
    assert b.paused_until() is not None


def test_the_file_is_replaced_whole_and_no_temporary_file_is_left(tmp_path: Path) -> None:
    path = tmp_path / PACING_FILE
    clock = Clock()
    s = store(path, clock)
    for _ in range(3):
        s.save_send()
        clock.t += 1
    s.save_pause(30 * 60)
    assert sorted(p.name for p in tmp_path.iterdir()) == [PACING_FILE]
    assert saved(path) == {
        "version": 1,
        "pausedUntil": "2026-10-25T14:32:03+00:00",
        "lastSend": "2026-10-25T14:02:02+00:00",
        "pageErrors": [],
    }


def test_a_write_that_fails_is_logged_and_the_rule_still_holds_in_memory(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    blocker = tmp_path / "a-file"
    blocker.write_text("", encoding="utf-8")
    path = blocker / PACING_FILE  # its folder is a file: every write fails
    clock = Clock()
    b = breaker(path, clock)
    with caplog.at_level(logging.WARNING):
        b.refusal()
    assert "could not save the Gemini pacing state" in caplog.text
    assert b.paused_until() == "2026-10-25T14:32:00Z"


# --- no prompt or answer text in a log line ----------------------------------------------------


def test_a_refusal_logs_its_length_not_its_text(caplog: pytest.LogCaptureFixture) -> None:
    clock = Clock()
    gemini = Gemini(
        port=0,
        auto_open=False,
        send_gap=SendGap(60.0, clock=clock, sleep=clock.sleep),
        breaker=pause.Breaker(clock=clock, now=clock.wall),
    )
    refusal = f"I'm having a hard time fulfilling your request about {PRIVATE}."
    gemini.server = cast("BridgeServer", FakeServer(clock, [answer(refusal)]))
    with caplog.at_level(logging.DEBUG), pytest.raises(ActionRefused):
        actions._ask(gemini, {}, PRIVATE)  # pyright: ignore[reportPrivateUsage]
    assert "Gemini refused the prompt" in caplog.text
    assert f"{len(refusal)} characters" in caplog.text
    assert PRIVATE not in caplog.text
    assert "hard time" not in caplog.text


def run_now(step: Coroutine[Any, Any, None]) -> None:
    """Runs a coroutine that never awaits (an ignored frame returns at once), with no event loop:
    on Windows a loop opens a socket pair, which the tests' network guard refuses."""
    try:
        step.send(None)
    except StopIteration:
        return
    raise AssertionError("the frame handler awaited something")


def test_a_frame_the_bridge_ignores_is_logged_without_its_text(
    caplog: pytest.LogCaptureFixture,
) -> None:
    server = BridgeServer(port=0, logger=logging.getLogger("test.bridge"))
    no_name = {"type": "event", "data": {"prompt": PRIVATE, "text": PRIVATE}}
    with caplog.at_level(logging.DEBUG):
        run_now(server._on_frame(cast("Any", None), f"{PRIVATE} {{"))  # pyright: ignore[reportPrivateUsage]
        run_now(server._on_frame(cast("Any", None), json.dumps([PRIVATE])))  # pyright: ignore[reportPrivateUsage]
        server._on_event(no_name)  # pyright: ignore[reportPrivateUsage]
    assert "not JSON" in caplog.text
    assert "not an object" in caplog.text
    assert "without a name" in caplog.text
    assert PRIVATE not in caplog.text


def test_a_page_error_answer_is_raised_not_logged(caplog: pytest.LogCaptureFixture) -> None:
    clock = Clock()
    gemini = Gemini(
        port=0,
        auto_open=False,
        send_gap=SendGap(60.0, clock=clock, sleep=clock.sleep),
        breaker=pause.Breaker(clock=clock, now=clock.wall),
    )
    went_wrong = f"Sorry, something went wrong with {PRIVATE}."
    gemini.server = cast("BridgeServer", FakeServer(clock, [answer(went_wrong)]))
    with caplog.at_level(logging.DEBUG), pytest.raises(GeminiPageError):
        actions._ask(gemini, {}, PRIVATE)  # pyright: ignore[reportPrivateUsage]
    assert PRIVATE not in caplog.text
