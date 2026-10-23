"""Lesson videos as playbook sources (comms/course.py, comms/video_check.py, comms/verify.py), 2026-10-15.

  * a Parakeet transcript is a source `video:<lesson id>`; a quote may run across two timed pieces and its
    place gives back an estimated time;
  * Whisper's words are compared after normalising casual speech and numbers; a missing content word fails,
    a missing filler does not;
  * who may be quoted depends on videos.json: the presenter of a one-coach lesson, a named coach in a live
    session, a student's story only for a `tip`.

None of this needs Whisper, ffmpeg or the real videos: the model is replaced by a stub where a test needs it.
"""

# ruff: noqa: E501 - the docstrings keep the old tests' wording and line breaks

import json
import subprocess
import sys
from collections.abc import Iterator
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from gratovo_pipeline.comms import course, playbook, verify, video_check

LESSON = "module 9 test/9.1. Talking to brands"
FIXTURE = Path(__file__).parent / "course_fixture"


@pytest.fixture(autouse=True)
def no_course(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Iterator[None]:
    monkeypatch.delenv(course.COURSE_DIR_ENV, raising=False)
    monkeypatch.delenv(course.VIDEO_DIR_ENV, raising=False)
    # the Whisper cache and the rules are the temporary playbook's, never the shipped one
    monkeypatch.setenv(playbook.PLAYBOOK_DIR_ENV, str(tmp_path / "playbook"))
    (tmp_path / "playbook" / "rules").mkdir(parents=True)
    course.configure(None, None)
    yield
    course.configure(None, None)


@pytest.fixture
def one_video(tmp_path: Path) -> str:
    folder = tmp_path / "videos" / "Module 9"
    folder.mkdir(parents=True)
    (folder / "9.1. Talking to brands.mp4.json").write_text(
        json.dumps(
            {
                "video": "Module 9/9.1. Talking to brands.mp4",
                "lesson": LESSON,
                "duration": 120.0,
                "segments": [
                    {
                        "start": 0.0,
                        "end": 60.0,
                        "text": "Today we talk about brands. When a brand says no, you never argue with them.",
                    },
                    {
                        "start": 60.0,
                        "end": 120.0,
                        "text": "You ask what would make it a yes. Then you wait two days before you follow up.",
                    },
                ],
            }
        ),
        encoding="utf-8",
    )
    (folder / "9.1. Talking to brands.mp4.partial.jsonl").write_text("{}", encoding="utf-8")
    course.configure(tmp_path, tmp_path / "videos")
    return f"video:{LESSON}"


def test_a_transcript_is_a_source_and_partials_are_not(one_video: str) -> None:
    assert list(course.videos()) == [one_video]
    video = course.source(one_video)
    assert isinstance(video, course.Video)
    assert video.duration == 120.0


def test_a_quote_may_cross_two_pieces_and_has_a_time(one_video: str) -> None:
    q = "you never argue with them. You ask what would make it a yes"
    assert course.contains(one_video, q)
    span = course.video_span(one_video, q)
    assert span is not None
    start, end, p0, p1 = span
    assert 30 < start < 60 < end < 90
    assert (p0, p1) == (0.0, 120.0)
    assert course.clock(start).startswith("0:")
    assert not course.contains(one_video, "you always argue with them")


def test_casual_speech_and_numbers_are_the_same_words() -> None:
    assert video_check.compare(
        "we're gonna send 50,000 emails", "We're going to send 50000 emails."
    )["ok"]
    assert video_check.compare("about 20% of them", "about 20 percent of them")["ok"]
    assert video_check.compare("they spend twenty seconds on it", "They spend 20 seconds on it.")[
        "ok"
    ]


def test_thousands_written_with_a_k_are_numbers() -> None:
    assert video_check.words("a channel with 50k subscribers") == [
        "a",
        "channel",
        "with",
        "50000",
        "subscribers",
    ]


def test_a_missing_content_word_fails_and_a_filler_does_not() -> None:
    bad = video_check.compare(
        "never send the price in the first email", "ever send the price in the first email"
    )
    assert not bad["ok"]
    assert bad["missing"] == ["never"]
    assert video_check.compare("so you know, ask them first", "ask them first")["match"] < 1
    long = "so when the creator asks for your rates you ask them first what they usually charge for one video"
    assert video_check.compare(long, long.replace("so when", "when"))["ok"]


def _heard_fine(doc: str, quote: str) -> dict[str, Any] | None:
    return {"ok": True, "match": 1.0}


def _never_checked(doc: str, quote: str) -> dict[str, Any] | None:
    return None


def _heard_differently(doc: str, quote: str) -> dict[str, Any] | None:
    return {"ok": False, "missing": ["never"]}


def _rule(level: str = "should") -> SimpleNamespace:
    return SimpleNamespace(level=level)


def _src(speaker: str | None = None) -> playbook.Source:
    return playbook.Source(
        doc=f"video:{LESSON}", quote="you never argue with them", speaker=speaker
    )


@pytest.mark.parametrize(
    ("info", "speaker", "level", "complaint"),
    [
        ({"speakers": "single", "presenter": "Ammar Halilovic"}, None, "should", None),
        (
            {"speakers": "single", "presenter": "Ammar Halilovic"},
            "Younes Jilani",
            "should",
            "presented by",
        ),
        ({"speakers": "multi", "presenter": "Abu Lahya"}, None, "should", "name the coach"),
        ({"speakers": "multi", "presenter": "Abu Lahya"}, "Abu Lahya", "should", None),
        (
            {"speakers": "multi", "presenter": "Abu Lahya"},
            "Abu Lahya|Ammar Halilovic",
            "should",
            None,
        ),
        (
            {"speakers": "multi", "presenter": "Abu Lahya"},
            "Abu Lahya|a student",
            "should",
            "name the coach",
        ),
        ({"speakers": "student", "presenter": "student"}, "student", "should", "tip"),
        ({"speakers": "student", "presenter": "student"}, "student", "tip", None),
    ],
)
def test_who_may_be_quoted(
    monkeypatch: pytest.MonkeyPatch,
    info: dict[str, Any],
    speaker: str | None,
    level: str,
    complaint: str | None,
) -> None:
    monkeypatch.setattr(video_check, "cached", _heard_fine)
    out = verify.video_problems(
        "x",
        _rule(level),
        _src(speaker),
        {LESSON: info},
        {"Ammar Halilovic", "Younes Jilani", "Abu Lahya"},
    )
    if complaint is None:
        assert out == []
    else:
        assert any(complaint in p for p in out)


def test_an_unchecked_or_misheard_quote_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    info: dict[str, dict[str, Any]] = {LESSON: {"speakers": "single", "presenter": "Abu Lahya"}}
    monkeypatch.setattr(video_check, "cached", _never_checked)
    assert any(
        "not checked" in p for p in verify.video_problems("x", _rule(), _src(), info, {"Abu Lahya"})
    )
    monkeypatch.setattr(video_check, "cached", _heard_differently)
    assert any(
        "missing: never" in p
        for p in verify.video_problems("x", _rule(), _src(), info, {"Abu Lahya"})
    )


def test_an_inflection_is_the_same_word_but_a_short_or_different_word_is_not() -> None:
    q = "you want to go to a small influencer that is super niche down on that industry"
    assert video_check.compare(q, q.replace("niche down", "niched down"))["ok"]
    assert not video_check.compare(
        "they can not afford the full integration price",
        "they can afford the full integration price",
    )["ok"]
    assert not video_check.compare(
        "the creator charges fifteen hundred per video here",
        "the creator charges fifty hundred per video here",
    )["ok"]


def test_long_words_one_letter_apart_match_but_short_ones_do_not() -> None:
    q = "if a brand has been working with like half of those influences focus on that brand"
    assert video_check.compare(q, q.replace("influences", "influencers"))["ok"]
    assert not video_check.compare(
        "we can not send the price in the email", "we can send the rice in the email"
    )["ok"]


def test_importing_the_tool_loads_neither_whisper_nor_the_pool() -> None:
    code = (
        "import sys, gratovo_pipeline.comms.video_check as v;"
        "bad = [m for m in ('faster_whisper', 'numpy', 'gratovo_pipeline.comms.pool') if m in sys.modules];"
        "print(bad)"
    )
    done = subprocess.run(  # noqa: S603 - this Python, a fixed one-line program
        [sys.executable, "-c", code], capture_output=True, text=True, check=True
    )
    assert done.stdout.strip() == "[]"


def test_the_cache_is_the_playbooks_and_a_result_is_scored_again(tmp_path: Path) -> None:
    assert video_check.cache_path() == tmp_path / "playbook" / "whisper_checks.json"
    assert video_check.cached("video:x", "never send the price") is None
    heard = {"doc": "video:x", "quote": "never send the price", "heard": "ever send the price"}
    video_check.save_cache({"checks": {video_check.key("video:x", "never send the price"): heard}})
    result = video_check.cached("video:x", "Never send the price")  # the key ignores case
    assert result is not None
    assert not result["ok"]
    assert result["missing"] == ["never"]
    assert b"\r" not in video_check.cache_path().read_bytes()


def test_the_videos_are_read_from_the_course_folder(one_video: str, tmp_path: Path) -> None:
    assert video_check.videos_root() == tmp_path / "course videos"
    course.configure(None, None)
    assert video_check.videos_root() is None


class StubChecker(video_check.Checker):
    """A checker whose ears are a list of answers, one per window tried (no Whisper, no ffmpeg)."""

    def __init__(self, answers: list[str]) -> None:
        self.answers = answers
        self.windows: list[tuple[float, float]] = []

    def hear(self, path: Path, start: float, end: float) -> str:
        self.windows.append((start, end))
        return self.answers.pop(0)


def test_a_check_widens_its_window_until_whisper_hears_the_quote(one_video: str) -> None:
    quote = "you never argue with them"
    checker = StubChecker(["you ever argue with them", quote])
    result = checker.check(one_video, quote)
    assert result["ok"]
    assert result["model"] == video_check.MODEL
    assert len(checker.windows) == 2
    assert checker.windows[1][0] <= checker.windows[0][0]
    assert checker.windows[1][1] >= checker.windows[0][1]


def test_a_quote_that_is_not_in_the_transcript_is_not_heard_at_all(one_video: str) -> None:
    checker = StubChecker([])
    result = checker.check(one_video, "words nobody said in this lesson at all")
    assert not result["ok"]
    assert result["error"] == "quote not in the Parakeet transcript"
    assert checker.windows == []


def test_the_report_and_record_need_no_course(
    capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    rules_dir = tmp_path / "playbook" / "rules"
    quote = "you never argue with them"
    (rules_dir / "brand.rules.json").write_text(
        json.dumps({"rules": [{"id": "R1", "src": [{"doc": f"video:{LESSON}", "quote": quote}]}]}),
        encoding="utf-8",
    )
    heard = {"doc": f"video:{LESSON}", "quote": quote, "heard": quote, "window": "0:00-0:30"}
    video_check.save_cache({"checks": {video_check.key(f"video:{LESSON}", quote): heard}})
    assert video_check.main(["record"]) == 0
    recorded = json.loads((rules_dir / "brand.rules.json").read_text(encoding="utf-8"))
    assert recorded["rules"][0]["src"][0]["whisper"]["ok"] is True
    assert video_check.main(["report", "--all"]) == 0
    assert "ok 1.00" in capsys.readouterr().out


@pytest.mark.parametrize("command", [["rules"], ["watch"], ["file", "q.json"]])
def test_a_check_without_the_course_stops_with_code_2(
    command: list[str], capsys: pytest.CaptureFixture[str]
) -> None:
    assert video_check.main(command) == 2
    out = capsys.readouterr()
    assert out.out == ""  # no "every quote failed"
    [line] = out.err.splitlines()
    assert "--course-dir" in line
    assert "GRATOVO_COURSE_DIR" in line
