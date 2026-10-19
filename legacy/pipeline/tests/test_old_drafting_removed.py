"""The old drafting path is gone (decision old-files, 2026-10-18).

Drafting runs in the Comms queue on the course-built skill (`comms_propose`,
`comms_check`); the drafter / QA / reply skill files, the outreach cards and
their lint went with the actions below. What the app still calls stays.
"""

import importlib.util

from gemini_bridge import actions

OLD_ACTIONS = {
    "draft_email", "qa_email", "lint_email", "draft_reply",
    "parse_draft", "draft_rules", "outreach_knobs", "outreach_preview",
}

KEPT_ACTIONS = {
    "generate_keywords", "classify_channel",
    "gem_create", "gem_update", "gem_read",
    "skills_list", "skill_read", "skill_set_active", "skill_delete", "skill_deploy",
    "comms_propose", "comms_check",
}


def test_the_old_drafting_actions_are_not_offered():
    assert OLD_ACTIONS.isdisjoint(actions.ACTIONS)


def test_what_the_app_still_calls_is_offered():
    assert KEPT_ACTIONS <= set(actions.ACTIONS)


def test_asking_for_an_old_action_is_bad_params():
    try:
        actions.run_action(object(), "action.draft_email", {})
    except actions.GeminiError as error:
        assert error.code == "BAD_PARAMS"
        assert "unknown action" in str(error)
    else:  # pragma: no cover - the assertion is the point
        raise AssertionError("action.draft_email still runs")


def test_the_old_modules_are_gone():
    for name in ("gemini_bridge.outreach_cards", "gemini_bridge.outreach_review",
                 "gemini_bridge.drafting_rules"):
        assert importlib.util.find_spec(name) is None, name
