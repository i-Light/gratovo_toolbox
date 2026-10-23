"""The skill build (comms/skill_build.py), 2026-10-16: the build id covers SKILL.md too, so a change to the
procedure alone shows as a new build and the deploy probe can tell an old skill from the new one.

The build reads the owner's course for the glossary and the sources' titles, so these tests run against
the invented course in `course_fixture/`. (The shipped skill folder is not compared with a fresh build: it is
rebuilt by hand, `python -m gratovo_pipeline.comms.skill_build`, after the playbook changes.)
"""

# ruff: noqa: E501 - the docstrings keep the old tests' wording and line breaks

from collections.abc import Iterator
from pathlib import Path

import pytest

from gratovo_pipeline import paths
from gratovo_pipeline.comms import course, playbook, skill_build

FIXTURE = Path(__file__).parent / "course_fixture"


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


def test_a_change_to_skill_md_alone_changes_the_build_id(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, fixture_course: None
) -> None:
    first = skill_build.build(tmp_path / "a")["build_id"]
    assert first == skill_build.build(tmp_path / "b")["build_id"]  # same input, same id
    monkeypatch.setattr(skill_build, "SKILL_MD", skill_build.SKILL_MD + "\nOne more line.\n")
    assert skill_build.build(tmp_path / "c")["build_id"] != first


def test_the_skill_has_the_coach_review_mode_and_the_case_reading_notes() -> None:
    text = skill_build.SKILL_MD
    assert "## Coach review mode" in text
    assert '"verdict": "good|mixed|bad"' in text
    assert "recent_messages" in text
    assert "median_views_last_30_days" in text


def test_every_house_choice_is_picked_and_the_owners_rules_reach_the_skill() -> None:
    # 2026-10-18: the owner answered all 34 on the workflow map; a note they wrote is applied as "Owner's rule"
    text = skill_build.render_choices(playbook.playbook_dir())
    assert "the owner has not picked yet" not in text
    assert (
        "Owner's rule: Do not contact or pitch female creators or couple channels" in text
    )  # HC-08
    assert "at most three follow-ups" in text  # HC-01 / HC-17


def test_the_build_writes_the_same_bytes_on_every_system(
    tmp_path: Path, fixture_course: None
) -> None:
    # Files are written with LF, so the shipped skill (committed with LF) is the same on any checkout.
    info = skill_build.build(tmp_path)
    folder = Path(info["folder"])
    names = {p.relative_to(folder).as_posix() for p in folder.rglob("*") if p.is_file()}
    assert names == set(info["files"]) | {"references/build.md"}
    for name in names:
        assert b"\r" not in (folder / name).read_bytes(), name
    assert f"Build id: {info['build_id']}\n" in (folder / "references/build.md").read_text(
        encoding="utf-8"
    )


def test_the_build_renders_the_rules_with_their_sources_from_the_invented_course(
    tmp_path: Path, fixture_course: None
) -> None:
    info = skill_build.build(tmp_path)
    folder = Path(info["folder"])
    assert (folder / "SKILL.md").read_text(encoding="utf-8") == skill_build.SKILL_MD
    assert info["rules"] == len(playbook.rules())
    foundations = (folder / "references/foundations.md").read_text(encoding="utf-8")
    assert foundations.startswith("# Foundations (always apply)")
    assert "references/index.md" in info["files"]


def test_a_rebuild_replaces_the_old_folder(tmp_path: Path, fixture_course: None) -> None:
    stale = tmp_path / skill_build.SKILL_NAME / "references" / "gone.md"
    stale.parent.mkdir(parents=True)
    stale.write_text("old", encoding="utf-8")
    skill_build.build(tmp_path)
    assert not stale.exists()


def test_the_default_output_is_the_shipped_skill_folder() -> None:
    assert skill_build.DEFAULT_OUT == paths.COMMS_SKILL_DIR


def test_the_build_without_the_course_stops_with_code_2(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert skill_build.main(["--out", str(tmp_path)]) == 2
    out = capsys.readouterr()
    assert out.out == ""
    [line] = out.err.splitlines()
    assert "--course-dir" in line
    assert "GRATOVO_COURSE_DIR" in line
    assert list(tmp_path.iterdir()) == []  # nothing was written


def test_the_build_runs_from_the_command_line_with_the_flags(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    code = skill_build.main(["--out", str(tmp_path), "--course-dir", str(FIXTURE / "course")])
    assert code == 0
    assert '"build_id": "comms-' in capsys.readouterr().out
    assert (tmp_path / skill_build.SKILL_NAME / "SKILL.md").is_file()
