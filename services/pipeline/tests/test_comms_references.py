"""Cross-references inside the playbook (comms/verify.py), 2026-10-15.

A rule may point at another rule ("see FND-CALL-06") or at an owner decision ("house choice HC-15"); each
house choice lists the rules behind its options. A reference to something that does not exist fails.

`verify` also needs the owner's course: without it the tool stops with exit code 2 and says how to name it.
"""

# ruff: noqa: E501 - the docstrings keep the old tests' wording and line breaks

import argparse
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from gratovo_pipeline.comms import course, playbook, review_claims, verify

FIXTURE = Path(__file__).parent / "course_fixture"


@pytest.fixture(autouse=True)
def no_course(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.delenv(course.COURSE_DIR_ENV, raising=False)
    monkeypatch.delenv(course.VIDEO_DIR_ENV, raising=False)
    course.configure(None, None)
    yield
    course.configure(None, None)


def rule(rid: str, text: str, dont: list[str] | None = None) -> playbook.Rule:
    return playbook.Rule(
        id=rid,
        area="brand",
        stage="offer",
        title="t",
        rule=text,
        level="should",
        src=[],
        file="brand.rules.json",
        dont=dont or [],
    )


def choice(
    cid: str,
    default: str = "a",
    pick: str | None = None,
    sources: tuple[str, ...] = ("BRD-OFFER-01",),
) -> dict[str, Any]:
    return {
        "id": cid,
        "options": [{"key": "a", "sources": list(sources)}, {"key": "b", "sources": []}],
        "default": default,
        "pick": pick,
    }


def test_existing_references_pass() -> None:
    rules = [
        rule("BRD-OFFER-01", "Offer it."),
        rule("BRD-OFFER-02", "Like BRD-OFFER-01; house choice HC-01."),
    ]
    assert verify.reference_problems(rules, [choice("HC-01")]) == []


def test_a_missing_rule_or_choice_fails_also_in_the_lists() -> None:
    rules = [rule("BRD-OFFER-01", "See BRD-OFFER-09.", dont=["Ignore HC-07"])]
    problems = verify.reference_problems(rules, [])
    assert any("BRD-OFFER-09" in p for p in problems)
    assert any("HC-07" in p for p in problems)


def test_a_choice_needs_a_real_default_pick_and_sources() -> None:
    rules = [rule("BRD-OFFER-01", "Offer it.")]
    problems = verify.reference_problems(
        rules, [choice("HC-01", default="z", pick="y", sources=("INF-NEG-99",))]
    )
    assert len(problems) == 3


def test_the_shipped_playbook_refers_only_to_what_exists() -> None:
    # The part of verify that needs only the repository's data: it runs everywhere.
    assert verify.reference_problems(playbook.rules(), playbook.house_choices()) == []


def test_verify_without_the_course_stops_with_code_2_and_one_line(
    capsys: pytest.CaptureFixture[str],
) -> None:
    assert verify.main([]) == 2
    out = capsys.readouterr()
    assert out.out == ""  # not one rule is reported as failing
    [line] = out.err.splitlines()
    assert "--course-dir" in line
    assert "GRATOVO_COURSE_DIR" in line


def test_verify_with_a_course_but_no_videos_names_the_video_flag(
    capsys: pytest.CaptureFixture[str],
) -> None:
    assert verify.main(["--course-dir", str(FIXTURE / "course")]) == 2
    [line] = capsys.readouterr().err.splitlines()
    assert "--video-dir" in line
    assert "GRATOVO_VIDEO_DIR" in line


def test_the_environment_names_the_course_as_well_as_the_flags(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(course.COURSE_DIR_ENV, str(FIXTURE / "course"))
    monkeypatch.setenv(course.VIDEO_DIR_ENV, str(FIXTURE / "videos"))
    args = argparse.Namespace(course_dir=None, video_dir=None)
    assert review_claims.require_course(args) is None


def test_the_flags_win_over_the_environment(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv(course.COURSE_DIR_ENV, str(tmp_path))
    args = argparse.Namespace(course_dir=FIXTURE / "course", video_dir=FIXTURE / "videos")
    assert review_claims.require_course(args) is None
    assert course.course_dir() == FIXTURE / "course"
