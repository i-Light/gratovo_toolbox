"""A transcript with time marks, so a usable moment can be quoted with where it is ("at 7:40").

Run with:  python -m pytest tests/test_transcript_timed.py    (from pipeline/)
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools import transcript  # noqa: E402


def _event(ms, *words):
    return {"tStartMs": ms, "segs": [{"utf8": w} for w in words]}


def test_marks_open_the_text_and_follow_every_thirty_seconds():
    payload = {"events": [
        _event(0, "Today", " we", " test"),
        _event(4_000, " Claude"),
        _event(31_000, "and", " it", " failed"),
        _event(35_000, " twice."),
        _event(95_500, "Here", " is", " why."),
    ]}

    text = transcript._segments_to_timed_text(payload)

    assert text == "[0:00] Today we test Claude [0:31] and it failed twice. [1:35] Here is why."


def test_an_hour_long_video_shows_hours():
    payload = {"events": [_event(3_725_000, "Wrapping", " up.")]}
    assert transcript._segments_to_timed_text(payload) == "[1:02:05] Wrapping up."


def test_line_breaks_and_empty_events_are_not_text():
    payload = {"events": [_event(0, "One"), {"tStartMs": 500, "segs": [{"utf8": "\n"}]},
                          {"tStartMs": 900}, _event(1_000, "two")]}
    assert transcript._segments_to_timed_text(payload) == "[0:00] One two"
