"""The skill build (comms/skill_build.py), 2026-10-16: the build id covers SKILL.md too, so a change to the
procedure alone shows as a new build and the deploy probe can tell an old skill from the new one."""

from comms import playbook, skill_build


def test_a_change_to_skill_md_alone_changes_the_build_id(tmp_path, monkeypatch):
    first = skill_build.build(tmp_path / "a")["build_id"]
    assert first == skill_build.build(tmp_path / "b")["build_id"]          # same input, same id
    monkeypatch.setattr(skill_build, "SKILL_MD", skill_build.SKILL_MD + "\nOne more line.\n")
    assert skill_build.build(tmp_path / "c")["build_id"] != first


def test_the_skill_has_the_coach_review_mode_and_the_case_reading_notes():
    text = skill_build.SKILL_MD
    assert "## Coach review mode" in text and '"verdict": "good|mixed|bad"' in text
    assert "recent_messages" in text and "median_views_last_30_days" in text


def test_every_house_choice_is_picked_and_the_owners_rules_reach_the_skill():
    # 2026-10-18: the owner answered all 34 on the workflow map; a note they wrote is applied as "Owner's rule"
    text = skill_build.render_choices(playbook.playbook_dir())
    assert "the owner has not picked yet" not in text
    assert "Owner's rule: Do not contact or pitch female creators or couple channels" in text      # HC-08
    assert "at most three follow-ups" in text                                                      # HC-01 / HC-17
