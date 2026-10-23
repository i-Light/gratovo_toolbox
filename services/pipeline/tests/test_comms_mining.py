"""Checking mined call quotes (comms/course.py, comms/mine_calls.py), from the 2026-10-15 quality
audit.

  * a verbatim quote may run across a timestamp line inside one speaker's turn, never across two
    speakers;
  * when the transcript gives the start of a quote to a student (speaker turns change late), only
    the whole sentences inside the coach's turn are kept;
  * Gemini's broken JSON (bare quotes inside a string, an answer that restarts) is still read;
  * Fawaz Central sessions are not mined.

The calls here are invented (AI creators and AI tool brands), not the course's.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest

from gratovo_pipeline.comms import course, example_bank, mine_calls

TRANSCRIPT = """@0:10 - Ammar Halilovic (Imaccelerator)
First of all, I'm not advising you to send a bunch of emails, even if they ask.
@0:25 - Ammar Halilovic (Imaccelerator)
Always go two, three, which you can make nice.
@0:40 - Student Sam
Should I ask him for his bank details? The brand is asking for bank details so they can pay you, not him.
@0:55 - Younes Jilani (Imaccelerator)
Okay, so it's your bank details they need, not his. The brand pays you, and you pay the creator.
"""  # noqa: E501
ROSTER = {
    "Ammar Halilovic (Imaccelerator)": "Ammar Halilovic",
    "Younes Jilani (Imaccelerator)": "Younes Jilani",
}


@pytest.fixture
def one_call(monkeypatch: pytest.MonkeyPatch) -> Iterator[course.Call]:
    call = course.Call(
        id="call:t1",
        title="Roast my email",
        date="2025-09-01",
        text=TRANSCRIPT,
        segments=course._segments(TRANSCRIPT),  # pyright: ignore[reportPrivateUsage]
    )
    monkeypatch.setattr(course, "calls", lambda: {"call:t1": call})

    def source(doc_id: str) -> course.Call | None:
        return call if doc_id == "call:t1" else None

    monkeypatch.setattr(course, "source", source)
    course._normed.cache_clear()  # pyright: ignore[reportPrivateUsage]
    course._normed_turns.cache_clear()  # pyright: ignore[reportPrivateUsage]
    yield call
    course._normed.cache_clear()  # pyright: ignore[reportPrivateUsage]
    course._normed_turns.cache_clear()  # pyright: ignore[reportPrivateUsage]


def test_a_quote_across_a_timestamp_line_of_the_same_speaker_counts(one_call: course.Call) -> None:
    q = "even if they ask. Always go two, three"
    assert course.contains("call:t1", q)
    seg = course.speaker_of("call:t1", q)
    assert seg is not None
    assert seg.speaker == "Ammar Halilovic (Imaccelerator)"


def test_never_across_two_speakers(one_call: course.Call) -> None:
    assert not course.contains("call:t1", "not him. Okay, so it's your bank details")


def test_only_the_coachs_sentences_are_kept_when_the_turn_changes_late(
    one_call: course.Call,
) -> None:
    quote = (
        "The brand is asking for bank details so they can pay you, not him. "
        "Okay, so it's your bank details they need, not his."
    )
    part = mine_calls.coach_part("call:t1", quote, ROSTER)
    assert part is not None
    text, seg = part
    assert text == "Okay, so it's your bank details they need, not his."
    assert seg.speaker == "Younes Jilani (Imaccelerator)"
    assert (
        mine_calls.coach_part(
            "call:t1", "Should I ask him for his bank details? Nothing else here.", ROSTER
        )
        is None
    )


def test_broken_json_from_gemini_is_still_read() -> None:
    bare = (
        'JSON\n{"items": [{"kind": "advice", "situation": "the CTA ("Are you open to brand '
        'deals?") at the end", "quotes": []}]}'
    )
    parsed = mine_calls.parse_answer(bare)
    assert parsed is not None
    assert parsed["items"][0]["situation"].startswith("the CTA (")
    restarted = (
        '```json\n{"items": [{"kind": "advice", "advice": "cut off mid-way ```json\n'
        '{"items": [{"kind": "roast", "advice": "complete", "quotes": []}]}\n```'
    )
    again = mine_calls.parse_answer(restarted)
    assert again is not None
    assert again["items"] == [{"kind": "roast", "advice": "complete", "quotes": []}]


def test_fawaz_led_sessions_are_recognised() -> None:
    seg = course.Segment
    fawaz = course.Call(
        id="call:f",
        title="2026-01-02",
        date="2026-01-02",
        text="",
        segments=[
            seg("0:01", "Fawaz Ishola (Fawaz Central)", "habits " * 200),
            seg("0:30", "Student", "ok"),
        ],
    )
    coach = course.Call(
        id="call:c",
        title="Roast",
        date="2026-01-03",
        text="",
        segments=[
            seg("0:01", "Fawaz Ishola", "hi"),
            seg("0:30", "Osama Lakehal", "subject lines " * 50),
        ],
    )
    assert mine_calls.fawaz_led(fawaz)
    assert not mine_calls.fawaz_led(coach)


def test_the_command_line_stops_with_one_line_when_the_course_is_missing(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    monkeypatch.delenv(course.COURSE_DIR_ENV, raising=False)
    monkeypatch.delenv(course.VIDEO_DIR_ENV, raising=False)
    course.configure(None, None)
    assert mine_calls.main(["verify", "--out", str(tmp_path)]) == 2
    err = capsys.readouterr().err.strip().splitlines()
    assert len(err) == 1
    assert "--course-dir" in err[0]
    assert course.COURSE_DIR_ENV in err[0]


def test_the_command_line_stops_with_one_line_when_there_is_no_output_folder(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    monkeypatch.delenv(example_bank.MINED_DIR_ENV, raising=False)
    monkeypatch.setenv(course.COURSE_DIR_ENV, str(tmp_path))
    course.configure(None, None)
    try:
        assert mine_calls.main(["stats"]) == 2
    finally:
        course.configure(None, None)
    err = capsys.readouterr().err.strip().splitlines()
    assert len(err) == 1
    assert "--out" in err[0]
    assert example_bank.MINED_DIR_ENV in err[0]
