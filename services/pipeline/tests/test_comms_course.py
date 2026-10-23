"""Where the course comes from (comms/course.py, plan D8): the owner's own folder, given at start.

The course text is the owner's purchased content and lives only on the owner's PC. The app passes
its folders in (`configure`); a tool run by hand may use `GRATOVO_COURSE_DIR` and
`GRATOVO_VIDEO_DIR`. Without them nothing raises: the course is just empty. These tests use the
invented course in `tests/course_fixture/`.
"""

from collections.abc import Iterator
from pathlib import Path

import pytest

from gratovo_pipeline.comms import course

FIXTURE = Path(__file__).parent / "course_fixture"
LESSON = "module 2 influencers/2.1 Messaging AI creators - Coach Nadia"


@pytest.fixture(autouse=True)
def no_course(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.delenv("GRATOVO_COURSE_DIR", raising=False)
    monkeypatch.delenv("GRATOVO_VIDEO_DIR", raising=False)
    course.configure(None, None)
    yield
    course.configure(None, None)


@pytest.fixture
def fixture_course() -> None:
    course.configure(FIXTURE / "course", FIXTURE / "videos")


def test_no_course_is_empty_and_never_raises() -> None:
    assert not course.available()
    assert course.course_dir() is None
    assert course.video_dir() is None
    assert course.lessons() == {}
    assert course.calls() == {}
    assert course.videos() == {}
    assert course.source(LESSON) is None
    assert course.source("call:test-call-1") is None
    assert not course.contains(LESSON, "a real person watched the whole video")
    assert course.context(LESSON, "anything") is None
    assert list(course.search("creator", kinds=("lesson", "call", "video"))) == []


def test_a_folder_that_does_not_exist_is_no_course(tmp_path: Path) -> None:
    course.configure(tmp_path / "gone", tmp_path / "gone too")
    assert not course.available()
    assert course.lessons() == {}
    assert course.calls() == {}
    assert course.videos() == {}


def test_a_course_folder_without_its_parts_is_empty_not_an_error(tmp_path: Path) -> None:
    course.configure(tmp_path, None)
    assert course.available()
    assert course.lessons() == {}
    assert course.calls() == {}


def test_the_configured_course_is_read(fixture_course: None) -> None:
    assert course.available()
    lessons = course.lessons()
    assert set(lessons) == {
        LESSON,
        "module 2 influencers/2.2 Following up with AI creators",
        "module 3 brands/3.1 Pitching AI tool brands",
    }  # module 7's call summaries are never sources
    assert lessons[LESSON].coach == "Coach Nadia"
    assert lessons[LESSON].kind == "lesson"
    assert lessons["module 3 brands/3.1 Pitching AI tool brands"].coach is None


def test_calls_are_read_by_share_id_with_their_speakers(fixture_course: None) -> None:
    calls = course.calls()
    assert set(calls) == {"call:test-call-1", "call:test-call-2"}  # an empty transcript is skipped
    call = calls["call:test-call-1"]
    assert [s.speaker for s in call.segments] == [
        "Coach Nadia",  # "(nadia@example.com)" dropped
        "Student Omar",
        "Coach Nadia",
        "Coach Nadia",
    ]
    assert [t.speaker for t in call.turns] == ["Coach Nadia", "Student Omar", "Coach Nadia"]
    assert calls["call:test-call-2"].segments[0].at == "1:02:10"


def test_a_call_quote_may_run_across_a_timestamp_inside_one_turn(fixture_course: None) -> None:
    across = "made you write. Then ask one question"
    assert course.contains("call:test-call-1", across)
    seg = course.speaker_of("call:test-call-1", across)
    assert seg is not None
    assert seg.speaker == "Coach Nadia"
    assert seg.at == "0:30"
    assert not course.contains("call:test-call-1", "run an agency. Drop the compliment")
    assert course.context("call:test-call-1", across) is not None


def test_quotes_match_after_norm(fixture_course: None) -> None:
    assert course.contains(
        LESSON, "The creator should feel that a REAL person watched the whole video"
    )
    assert (
        course.contains(LESSON, "talk about their channel first \u2014 and the brand second")
        is False
    )
    assert course.norm("It\u2019s  \u201cfine\u201d \u2014 **really**") == 'it\'s "fine" - really'


def test_videos_are_read_from_the_video_folder(fixture_course: None) -> None:
    video_id = f"video:{LESSON}"
    assert list(course.videos()) == [video_id]  # the partial transcript is not a source
    video = course.videos()[video_id]
    assert video.duration == 90.0
    assert len(video.pieces) == 2
    assert video.kind == "video"
    span = course.video_span(video_id, "every week. Mention the tool they showed last")
    assert span is not None
    start, end, first, last = span
    assert 0.0 < start < 45.0 < end <= 90.0
    assert (first, last) == (0.0, 90.0)
    assert course.clock(start).startswith("0:")
    assert course.clock(3725) == "1:02:05"


def test_the_course_without_a_video_folder_has_lessons_but_no_videos() -> None:
    course.configure(FIXTURE / "course", None)
    assert course.available()
    assert course.lessons()
    assert course.videos() == {}


def test_configure_clears_what_was_read_before(fixture_course: None) -> None:
    assert course.lessons()
    course.configure(None, None)
    assert course.lessons() == {}
    assert course.videos() == {}


def test_a_tool_run_by_hand_may_name_the_folders_in_the_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GRATOVO_COURSE_DIR", str(FIXTURE / "course"))
    monkeypatch.setenv("GRATOVO_VIDEO_DIR", str(FIXTURE / "videos"))
    course.configure(None, None)
    assert course.available()
    assert LESSON in course.lessons()
    assert course.videos()


def test_the_configured_folder_wins_over_the_environment(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("GRATOVO_COURSE_DIR", str(tmp_path))
    course.configure(FIXTURE / "course", None)
    assert course.course_dir() == FIXTURE / "course"


def test_search_finds_text_in_the_chosen_kinds(fixture_course: None) -> None:
    lessons_only = list(course.search(r"wispr flow"))
    assert lessons_only == []
    found = list(course.search(r"wispr flow", kinds=("call",)))
    assert [doc for doc, _ in found] == ["call:test-call-1"]
    assert len(list(course.search(r"creator", kinds=("lesson", "video"), limit=2))) == 2
