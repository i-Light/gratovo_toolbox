"""The old drafting path is gone (decision old-files, 2026-10-18).

Drafting runs in the Comms queue on the course-built skill (`comms_propose`, `comms_check`); the
drafter / QA / reply skill files, the outreach cards and their lint went with the actions below.
What the app still calls stays.

Dropped from the old test: `test_the_old_modules_are_gone` looked for the old repository's modules
`outreach_cards`, `outreach_review` and `drafting_rules`; this package never had them.
"""

from __future__ import annotations

from typing import Any, cast

import pytest

from gratovo_pipeline.gemini import actions
from gratovo_pipeline.gemini.errors import GeminiError

OLD_ACTIONS = {
    "draft_email",
    "qa_email",
    "lint_email",
    "draft_reply",
    "parse_draft",
    "draft_rules",
    "outreach_knobs",
    "outreach_preview",
}

KEPT_ACTIONS = {
    "generate_keywords",
    "classify_channel",
    "gem_create",
    "gem_update",
    "gem_read",
    "skills_list",
    "skill_read",
    "skill_set_active",
    "skill_delete",
    "skill_deploy",
    "comms_propose",
    "comms_check",
}


def test_the_old_drafting_actions_are_not_offered() -> None:
    assert OLD_ACTIONS.isdisjoint(actions.ACTIONS)


def test_what_the_app_still_calls_is_offered() -> None:
    assert set(actions.ACTIONS) >= KEPT_ACTIONS


def test_asking_for_an_old_action_is_bad_params() -> None:
    with pytest.raises(GeminiError) as info:
        actions.run_action(cast("Any", object()), "action.draft_email", {})
    assert info.value.code == "BAD_PARAMS"
    assert "unknown action" in str(info.value)
