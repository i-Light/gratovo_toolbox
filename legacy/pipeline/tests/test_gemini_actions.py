"""Tests for the bridge's `action.*` methods (gemini_bridge/actions.py).

Run with:  python -m pytest -q tests/test_gemini_actions.py    (from pipeline/)

No browser, no network beyond 127.0.0.1: Gemini's replies are scripted on
the `FakeExtension` from test_gemini_bridge.py, so what is pinned here is
the half of an action that is ours -- the prompt it builds (skill file
prepended, `avoid` list trimmed), and how it reads a reply that arrives
fenced, bare, wrapped in chatter, or as garbage. The old drafting actions
(draft / QA / lint / reply) are gone (decision old-files); the Comms queue's
actions are pinned in tests/test_comms_*.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from test_gemini_bridge import Harness, harness, no_threads_left_behind  # noqa: E402,F401

from gemini_bridge import GeminiError, actions  # noqa: E402

KEYWORDS_STUB = "# KEYWORD GENERATOR STUB\n"
CLASSIFIER_STUB = "# CHANNEL CLASSIFIER STUB\n"


@pytest.fixture
def skills(tmp_path: Path) -> Path:
    folder = tmp_path / "gemini skills"
    folder.mkdir()
    (folder / "keyword generator skill.md").write_text(KEYWORDS_STUB, encoding="utf-8")
    (folder / "channel classifier skill.md").write_text(CLASSIFIER_STUB, encoding="utf-8")
    return tmp_path


def send_reply(text: str, model: str = "2.5 Pro"):
    """A scripted `send` handler answering with `text`."""
    return lambda params: {"index": 0, "text": text, "html": "", "durationMs": 5, "model": model}

# --- JSON extraction -----------------------------------------------------------------

def test_extract_json_fence_bare_and_chatter():
    assert actions.extract_json('Sure!\n```json\n{"a": 1}\n```\nDone.') == {"a": 1}
    assert actions.extract_json('{"a": {"b": "}"}}') == {"a": {"b": "}"}}
    assert actions.extract_json('Here you go: {"a": 1} and {"b": 2}') == {"a": 1}
    assert actions.extract_json('escaped: {"s": "say \\"hi\\" {"}') == {"s": 'say "hi" {'}
    assert actions.extract_json("no json here {oops") is None
    assert actions.extract_json("") is None


# --- gems ------------------------------------------------------------------------------

def test_open_gem_accepts_a_full_url_and_rewrites_the_account(harness: Harness):
    fake = harness.attach({
        "get_url": {"url": "https://gemini.google.com/u/1/app", "accountIndex": 1},
        "navigate": lambda p: {"tabId": 3, "url": p["url"], "redirected": False, "requestedUrl": p["url"]},
    })
    out = harness.gemini.open_gem("https://gemini.google.com/u/0/gem/xyz")
    assert out == {"url": "https://gemini.google.com/u/1/gem/xyz", "tabId": 3}
    harness.gemini.open_gem("https://gemini.google.com/gem/xyz")
    assert fake.calls("navigate")[1]["url"] == "https://gemini.google.com/u/1/gem/xyz"


# --- generate_keywords -----------------------------------------------------------------

def test_generate_keywords_dedupes_and_trims_the_avoid_list(harness: Harness, skills: Path):
    harness.gemini.data_dir = skills
    reply = "\n".join([
        "Here are your keywords:",
        "1. AI coding assistant review",
        "2. ai coding assistant review",     # duplicate, case-insensitive
        "- cursor vs copilot",
        '"best AI IDE 2025"',
        "Existing Keyword",                   # in avoid
        "",
        "vibe coding tutorial",
    ])
    fake = harness.attach({"send": send_reply(reply)})
    avoid = [f"old keyword {i}" for i in range(400)] + ["existing keyword"]
    result = harness.gemini.generate_keywords("AI coding tools", count=5, avoid=avoid,
                                              exclusions=["music"], language="English")
    assert result["keywords"] == ["AI coding assistant review", "cursor vs copilot",
                                  "best AI IDE 2025", "vibe coding tutorial"]
    assert result["dropped"] == 2
    prompt = fake.calls("send")[0]["text"]
    assert prompt.startswith(KEYWORDS_STUB.strip())
    assert "Generate 5 long-tail YouTube search phrases" in prompt
    assert "music" in prompt
    assert "old keyword 399" in prompt and "existing keyword" in prompt
    assert "old keyword 100" not in prompt, "only the last 300 avoid entries go into the prompt"
    assert "old keyword 101" in prompt


def test_generate_keywords_empty_reply_is_parse_failed(harness: Harness, skills: Path):
    harness.gemini.data_dir = skills
    harness.attach({"send": send_reply("Sorry:")})
    with pytest.raises(GeminiError) as info:
        harness.gemini.generate_keywords("anything")
    assert info.value.code == "ACTION_PARSE_FAILED"


# --- classify_channel ------------------------------------------------------------------

def test_classify_channel_parses_and_clamps(harness: Harness, skills: Path):
    harness.gemini.data_dir = skills
    reply = json.dumps({"niche": "AI dev tools", "audience": "developers", "language": "English",
                        "brandFit": 9, "reasons": ["reviews AI IDEs"], "redFlags": []})
    fake = harness.attach({"send": send_reply(reply)})
    result = harness.gemini.classify_channel({"handle": "@techlead", "title": "TechLead"},
                                             "AI tools", criteria=["English-speaking"])
    assert result["brandFit"] == 5
    assert result["niche"] == "AI dev tools" and result["reasons"] == ["reviews AI IDEs"]
    prompt = fake.calls("send")[0]["text"]
    assert prompt.startswith(CLASSIFIER_STUB.strip())
    assert "@techlead" in prompt and "English-speaking" in prompt


def test_a_missing_skill_file_is_skill_file_missing_and_nothing_is_sent(harness: Harness, tmp_path: Path):
    harness.gemini.data_dir = tmp_path
    fake = harness.attach({"send": send_reply("{}")})
    with pytest.raises(GeminiError) as info:
        harness.gemini.classify_channel({"handle": "@techlead"}, "AI tools")
    assert info.value.code == "SKILL_FILE_MISSING"
    assert info.value.details["path"].endswith("channel classifier skill.md")
    assert fake.calls("send") == [], "nothing must be sent without the doctrine"


def test_a_garbage_reply_is_action_parse_failed(harness: Harness, skills: Path):
    harness.gemini.data_dir = skills
    harness.attach({"send": send_reply("I cannot help with that, sorry about it.")})
    with pytest.raises(GeminiError) as info:
        harness.gemini.classify_channel({"handle": "@techlead"}, "AI tools")
    assert info.value.code == "ACTION_PARSE_FAILED"
    assert info.value.details["raw"] == "I cannot help with that, sorry about it."


def test_run_action_dispatch(harness: Harness):
    harness.attach({})
    with pytest.raises(GeminiError) as info:
        harness.gemini.action("action.nope", {})
    assert info.value.code == "BAD_PARAMS"
