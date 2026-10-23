"""Roast examples (examples.json) are checked like rules' quotes (2026-10-16): the coach's quote must be in the
call, in a coach's turn, and make its point; the verdict is good, mixed or bad.

The shipped examples' quotes are checked against the owner's course (not in the repository): that test
runs only where `--course-dir` / `GRATOVO_COURSE_DIR` names it. The rest runs against the invented course in
`course_fixture/`.
"""

# ruff: noqa: E501 - the docstrings keep the old tests' wording and line breaks

import os
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from gratovo_pipeline.comms import course, playbook, verify

FIXTURE = Path(__file__).parent / "course_fixture"
ENV_COURSE = os.environ.get(course.COURSE_DIR_ENV)
ENV_VIDEO = os.environ.get(course.VIDEO_DIR_ENV)
needs_course = pytest.mark.skipif(
    not course.available(), reason="needs the owner's course (--course-dir / GRATOVO_COURSE_DIR)"
)
ROSTER = {"Coach Nadia": "Nadia", "Coach Idris": "Idris"}
CALL = "call:test-call-1"


@pytest.fixture(autouse=True)
def no_course(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.delenv(course.COURSE_DIR_ENV, raising=False)
    monkeypatch.delenv(course.VIDEO_DIR_ENV, raising=False)
    course.configure(None, None)
    yield
    course.configure(None, None)


@pytest.fixture
def fixture_course() -> None:
    course.configure(FIXTURE / "course", FIXTURE / "videos")


@pytest.fixture
def owners_course() -> None:
    course.configure(
        Path(ENV_COURSE) if ENV_COURSE else None, Path(ENV_VIDEO) if ENV_VIDEO else None
    )


def example(**extra: Any) -> dict[str, Any]:
    """An example whose quote is in the invented call, in a coach's turn."""
    base: dict[str, Any] = {
        "id": "EX-T0",
        "side": "influencer",
        "stage": "first_contact",
        "verdict": "good",
        "student_email": "Hi Sam, your video on the new AI editor made me write.",
        "quote": {"doc": CALL, "quote": "Then ask one question and stop there."},
    }
    return {**base, **extra}


@needs_course
def test_the_shipped_examples_pass(owners_course: None) -> None:
    assert verify.example_problems(playbook.examples(), playbook.coaches()) == []


def test_the_shipped_examples_are_well_formed_without_the_course() -> None:
    # Everything except the quote lookup (which needs the course) holds on the repository's data alone.
    problems = verify.example_problems(playbook.examples(), playbook.coaches())
    assert [p for p in problems if "coach quote not found" not in p] == []


def test_a_good_example_passes_against_the_invented_call(fixture_course: None) -> None:
    assert verify.example_problems([example()], ROSTER) == []


def test_a_broken_example_is_reported() -> None:
    good = playbook.examples()[0]
    roster = playbook.coaches()
    wrong_verdict = dict(good, id="EX-T1", verdict="great")
    no_quote = dict(
        good,
        id="EX-T2",
        quote={
            "doc": good["quote"]["doc"],
            "quote": "words the coach never said on that call at all",
        },
    )
    no_email = dict(good, id="EX-T3", student_email=" ")
    problems = verify.example_problems([wrong_verdict, no_quote, no_email], roster)
    assert any("EX-T1" in p and "verdict" in p for p in problems)
    assert any("EX-T2" in p and "not found" in p for p in problems)
    assert any("EX-T3" in p and "student email" in p for p in problems)


def test_a_students_words_a_repeated_id_and_an_unknown_stage_are_reported(
    fixture_course: None,
) -> None:
    student = example(
        id="EX-T4",
        quote={
            "doc": CALL,
            "quote": "Hi, I loved your video about Wispr Flow and I run an agency.",
        },
    )
    twice = example(id="EX-T4")
    unknown_stage = example(id="EX-T5", stage="nowhere")
    problems = verify.example_problems([student, twice, unknown_stage], ROSTER)
    assert any("EX-T4" in p and "not in a coach's turn" in p for p in problems)
    assert any("EX-T4" in p and "repeated id" in p for p in problems)
    assert any("EX-T5" in p and "unknown side/stage" in p for p in problems)


def test_a_quote_that_stops_before_its_point_is_reported() -> None:
    assert verify.stops_short("Run through all six before you press send:")
    assert not verify.stops_short("Then ask one question and stop there.")
