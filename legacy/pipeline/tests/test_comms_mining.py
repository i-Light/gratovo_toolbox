"""Checking mined call quotes (comms/course.py, comms/mine_calls.py), from the 2026-10-15 quality audit.

  * a verbatim quote may run across a timestamp line inside one speaker's turn, never across two speakers;
  * when the transcript gives the start of a quote to a student (speaker turns change late), only the whole
    sentences inside the coach's turn are kept;
  * Gemini's broken JSON (bare quotes inside a string, an answer that restarts) is still read;
  * Fawaz Central sessions are not mined.
"""

from types import SimpleNamespace

import pytest

from comms import course, mine_calls

TRANSCRIPT = """@0:10 - Ammar Halilovic (Imaccelerator)
First of all, I'm not advising you to send a bunch of emails, even if they ask.
@0:25 - Ammar Halilovic (Imaccelerator)
Always go two, three, which you can make nice.
@0:40 - Student Sam
Should I ask him for his bank details? The brand is asking for bank details so they can pay you, not him.
@0:55 - Younes Jilani (Imaccelerator)
Okay, so it's your bank details they need, not his. The brand pays you, and you pay the creator.
"""
ROSTER = {"Ammar Halilovic (Imaccelerator)": "Ammar Halilovic", "Younes Jilani (Imaccelerator)": "Younes Jilani"}


@pytest.fixture
def one_call(monkeypatch):
    call = course.Call(id="call:t1", title="Roast my email", date="2025-09-01", text=TRANSCRIPT,
                       segments=course._segments(TRANSCRIPT))
    monkeypatch.setattr(course, "calls", lambda: {"call:t1": call})
    monkeypatch.setattr(course, "source", lambda doc_id: call if doc_id == "call:t1" else None)
    course._normed.cache_clear()
    course._normed_turns.cache_clear()
    yield call
    course._normed.cache_clear()
    course._normed_turns.cache_clear()


def test_a_quote_across_a_timestamp_line_of_the_same_speaker_counts(one_call):
    q = "even if they ask. Always go two, three"
    assert course.contains("call:t1", q)
    assert course.speaker_of("call:t1", q).speaker == "Ammar Halilovic (Imaccelerator)"


def test_never_across_two_speakers(one_call):
    assert not course.contains("call:t1", "not him. Okay, so it's your bank details")


def test_only_the_coachs_sentences_are_kept_when_the_turn_changes_late(one_call):
    quote = "The brand is asking for bank details so they can pay you, not him. Okay, so it's your bank details they need, not his."
    text, seg = mine_calls.coach_part("call:t1", quote, ROSTER)
    assert text == "Okay, so it's your bank details they need, not his."
    assert seg.speaker == "Younes Jilani (Imaccelerator)"
    assert mine_calls.coach_part("call:t1", "Should I ask him for his bank details? Nothing else here.", ROSTER) is None


def test_broken_json_from_gemini_is_still_read():
    bare = 'JSON\n{"items": [{"kind": "advice", "situation": "the CTA ("Are you open to brand deals?") at the end", "quotes": []}]}'
    assert mine_calls.parse_answer(bare)["items"][0]["situation"].startswith("the CTA (")
    restarted = ('```json\n{"items": [{"kind": "advice", "advice": "cut off mid-way ```json\n'
                 '{"items": [{"kind": "roast", "advice": "complete", "quotes": []}]}\n```')
    assert mine_calls.parse_answer(restarted)["items"] == [{"kind": "roast", "advice": "complete", "quotes": []}]


def test_fawaz_led_sessions_are_recognised():
    seg = course.Segment
    fawaz = SimpleNamespace(segments=[seg("0:01", "Fawaz Ishola (Fawaz Central)", "habits " * 200), seg("0:30", "Student", "ok")])
    coach = SimpleNamespace(segments=[seg("0:01", "Fawaz Ishola", "hi"), seg("0:30", "Osama Lakehal", "subject lines " * 50)])
    assert mine_calls.fawaz_led(fawaz) and not mine_calls.fawaz_led(coach)
