"""Lesson videos as playbook sources (comms/course.py, comms/video_check.py, comms/verify.py), 2026-10-15.

  * a Parakeet transcript is a source `video:<lesson id>`; a quote may run across two timed pieces and its
    place gives back an estimated time;
  * Whisper's words are compared after normalising casual speech and numbers; a missing content word fails,
    a missing filler does not;
  * who may be quoted depends on videos.json: the presenter of a one-coach lesson, a named coach in a live
    session, a student's story only for a `tip`.
"""

import json
from types import SimpleNamespace

import pytest

from comms import course, playbook, verify, video_check

LESSON = "module 9 test/9.1. Talking to brands"


@pytest.fixture
def one_video(tmp_path, monkeypatch):
    folder = tmp_path / "Module 9"
    folder.mkdir()
    (folder / "9.1. Talking to brands.mp4.json").write_text(json.dumps({
        "video": "Module 9/9.1. Talking to brands.mp4", "lesson": LESSON, "duration": 120.0,
        "segments": [
            {"start": 0.0, "end": 60.0, "text": "Today we talk about brands. When a brand says no, you never argue with them."},
            {"start": 60.0, "end": 120.0, "text": "You ask what would make it a yes. Then you wait two days before you follow up."},
        ]}), encoding="utf-8")
    (folder / "9.1. Talking to brands.mp4.partial.jsonl").write_text("{}", encoding="utf-8")
    monkeypatch.setenv("GRATOVO_VIDEO_DIR", str(tmp_path))
    for fn in (course.videos, course._video_index, course._normed):
        fn.cache_clear()
    yield f"video:{LESSON}"
    for fn in (course.videos, course._video_index, course._normed):
        fn.cache_clear()


def test_a_transcript_is_a_source_and_partials_are_not(one_video):
    assert list(course.videos()) == [one_video]
    assert course.source(one_video).duration == 120.0


def test_a_quote_may_cross_two_pieces_and_has_a_time(one_video):
    q = "you never argue with them. You ask what would make it a yes"
    assert course.contains(one_video, q)
    start, end, p0, p1 = course.video_span(one_video, q)
    assert 30 < start < 60 < end < 90
    assert (p0, p1) == (0.0, 120.0)
    assert course.clock(start).startswith("0:")
    assert not course.contains(one_video, "you always argue with them")


def test_casual_speech_and_numbers_are_the_same_words():
    assert video_check.compare("we're gonna send 50,000 emails", "We're going to send 50000 emails.")["ok"]
    assert video_check.compare("about 20% of them", "about 20 percent of them")["ok"]
    assert video_check.compare("they spend twenty seconds on it", "They spend 20 seconds on it.")["ok"]


def test_a_missing_content_word_fails_and_a_filler_does_not():
    bad = video_check.compare("never send the price in the first email", "ever send the price in the first email")
    assert not bad["ok"] and bad["missing"] == ["never"]
    assert video_check.compare("so you know, ask them first", "ask them first")["match"] < 1
    long = "so when the creator asks for your rates you ask them first what they usually charge for one video"
    assert video_check.compare(long, long.replace("so when", "when"))["ok"]


def _rule(level="should"):
    return SimpleNamespace(level=level)


def _src(speaker=None):
    return playbook.Source(doc=f"video:{LESSON}", quote="you never argue with them", speaker=speaker)


@pytest.mark.parametrize("info, speaker, level, complaint", [
    ({"speakers": "single", "presenter": "Ammar Halilovic"}, None, "should", None),
    ({"speakers": "single", "presenter": "Ammar Halilovic"}, "Younes Jilani", "should", "presented by"),
    ({"speakers": "multi", "presenter": "Abu Lahya"}, None, "should", "name the coach"),
    ({"speakers": "multi", "presenter": "Abu Lahya"}, "Abu Lahya", "should", None),
    ({"speakers": "multi", "presenter": "Abu Lahya"}, "Abu Lahya|Ammar Halilovic", "should", None),
    ({"speakers": "multi", "presenter": "Abu Lahya"}, "Abu Lahya|a student", "should", "name the coach"),
    ({"speakers": "student", "presenter": "student"}, "student", "should", "tip"),
    ({"speakers": "student", "presenter": "student"}, "student", "tip", None),
])
def test_who_may_be_quoted(monkeypatch, info, speaker, level, complaint):
    monkeypatch.setattr(video_check, "cached", lambda doc, quote: {"ok": True, "match": 1.0})
    out = verify.video_problems("x", _rule(level), _src(speaker), {LESSON: info}, {"Ammar Halilovic", "Younes Jilani", "Abu Lahya"})
    if complaint is None:
        assert out == []
    else:
        assert any(complaint in p for p in out)


def test_an_unchecked_or_misheard_quote_fails(monkeypatch):
    info = {LESSON: {"speakers": "single", "presenter": "Abu Lahya"}}
    monkeypatch.setattr(video_check, "cached", lambda doc, quote: None)
    assert any("not checked" in p for p in verify.video_problems("x", _rule(), _src(), info, {"Abu Lahya"}))
    monkeypatch.setattr(video_check, "cached", lambda doc, quote: {"ok": False, "missing": ["never"]})
    assert any("missing: never" in p for p in verify.video_problems("x", _rule(), _src(), info, {"Abu Lahya"}))


def test_an_inflection_is_the_same_word_but_a_short_or_different_word_is_not():
    q = "you want to go to a small influencer that is super niche down on that industry"
    assert video_check.compare(q, q.replace("niche down", "niched down"))["ok"]
    assert not video_check.compare("they can not afford the full integration price", "they can afford the full integration price")["ok"]
    assert not video_check.compare("the creator charges fifteen hundred per video here", "the creator charges fifty hundred per video here")["ok"]


def test_long_words_one_letter_apart_match_but_short_ones_do_not():
    q = "if a brand has been working with like half of those influences focus on that brand"
    assert video_check.compare(q, q.replace("influences", "influencers"))["ok"]
    assert not video_check.compare("we can not send the price in the email", "we can send the rice in the email")["ok"]
