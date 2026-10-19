"""Tests for `action.gem_create|gem_update|gem_read` (gemini_bridge/gems.py).

Run with:  python -m pytest -q tests/test_gems.py    (from pipeline/)

The extension is the scripted `FakeExtension`; what is pinned is Python's half:
which editor page is opened under which account, what the extension is asked,
what comes back, and a gem that does not open being reported as such.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from test_gemini_bridge import Harness, WireError, harness, no_threads_left_behind  # noqa: E402,F401

from gemini_bridge import GeminiError, actions, gems  # noqa: E402


def navigate_to(landing=None):
    return lambda p: {"tabId": 7, "url": landing or p["url"], "redirected": landing is not None,
                      "requestedUrl": p["url"]}


def editor(fake_handlers: dict, account: int = 2, landing=None) -> dict:
    return {"get_url": {"url": f"https://gemini.google.com/u/{account}/app", "accountIndex": account},
            "navigate": navigate_to(landing), **fake_handlers}


@pytest.mark.parametrize("given, expected", [
    ("abc123def", "abc123def"),
    ("https://gemini.google.com/gem/abc123def", "abc123def"),
    ("https://gemini.google.com/u/3/gem/abc123def?usp=sharing", "abc123def"),
    ("https://gemini.google.com/gems/edit/abc123def", "abc123def"),
])
def test_gem_id_accepts_urls_and_bare_ids(given, expected):
    assert gems.gem_id(given) == expected


@pytest.mark.parametrize("given", ["", None, "https://gemini.google.com/gems/create", "a b", "abc"])
def test_gem_id_rejects_anything_else(given):
    with pytest.raises(GeminiError) as info:
        gems.gem_id(given)
    assert info.value.code == "BAD_PARAMS"


def test_create_opens_the_create_page_on_the_current_account_and_fills_it(harness: Harness):
    fake = harness.attach(editor({"gem_create": lambda p: {
        "url": "https://gemini.google.com/gem/newgem123", "gemId": "newgem123", "name": p["name"]}}))
    events = []
    result = actions.run_action(harness.gemini, "action.gem_create",
                                {"name": "Drafter", "description": "Writes emails", "instructions": "Be brief."},
                                emit=lambda event, data: events.append(data))
    assert fake.calls("navigate")[0]["url"] == "https://gemini.google.com/u/2/gems/create"
    sent = fake.calls("gem_create")[0]
    assert {k: sent[k] for k in ("name", "description", "instructions")} == {
        "name": "Drafter", "description": "Writes emails", "instructions": "Be brief."}
    assert sent["timeoutMs"] == 180000
    assert result == {"url": "https://gemini.google.com/gem/newgem123", "gemId": "newgem123", "name": "Drafter"}
    assert [(e["done"], e["total"]) for e in events] == [(0, 2), (1, 2), (2, 2)]


def test_create_needs_a_name_and_sends_nothing_without_one(harness: Harness):
    fake = harness.attach(editor({}))
    with pytest.raises(GeminiError) as info:
        gems.gem_create(harness.gemini, {"name": "  "})
    assert info.value.code == "BAD_PARAMS"
    assert fake.calls("navigate") == []


def test_update_sends_only_the_given_fields_to_the_gems_edit_page(harness: Harness):
    fake = harness.attach(editor({"gem_update": lambda p: {
        "url": "https://gemini.google.com/gem/abc123def", "gemId": "abc123def", "name": "Drafter",
        "changed": ["instructions"]}}, account=0))
    result = gems.gem_update(harness.gemini, {"gem": "https://gemini.google.com/gem/abc123def",
                                              "instructions": "New rules", "timeoutS": 30})
    assert fake.calls("navigate")[0]["url"] == "https://gemini.google.com/u/0/gems/edit/abc123def"
    sent = fake.calls("gem_update")[0]
    assert sent == {"instructions": "New rules", "timeoutMs": 30000}
    assert result["changed"] == ["instructions"] and result["gemId"] == "abc123def"


def test_read_returns_the_fields_verbatim(harness: Harness):
    instructions = "Line one\n\n  indented line\nلغة عربية"
    harness.attach(editor({"gem_read": {"url": "https://gemini.google.com/gem/abc123def", "gemId": "abc123def",
                                        "name": "Drafter", "description": "", "instructions": instructions}}))
    result = gems.gem_read(harness.gemini, {"gem": "abc123def"})
    assert result == {"url": "https://gemini.google.com/gem/abc123def", "gemId": "abc123def", "name": "Drafter",
                      "description": "", "instructions": instructions}


def test_a_gem_that_does_not_open_is_reported_before_the_extension_is_asked(harness: Harness):
    fake = harness.attach(editor({"gem_read": {}}, landing="https://gemini.google.com/u/2/gems/view"))
    with pytest.raises(GeminiError) as info:
        gems.gem_read(harness.gemini, {"gem": "missing123"})
    assert info.value.code == "GEM_UI_NOT_FOUND"
    assert info.value.details["url"] == "https://gemini.google.com/u/2/gems/view"
    assert fake.calls("gem_read") == []


def test_extension_errors_pass_through_with_their_code(harness: Harness):
    refused = WireError("GEM_SAVE_FAILED", "refused", {"reason": "field errors", "fieldErrors": ["Name is required"]})
    harness.attach(editor({"gem_create": refused}))
    with pytest.raises(GeminiError) as info:
        gems.gem_create(harness.gemini, {"name": "X"})
    assert info.value.code == "GEM_SAVE_FAILED"
    assert info.value.details["fieldErrors"] == ["Name is required"]
