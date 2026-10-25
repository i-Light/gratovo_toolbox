"""Tests for the bridge's `action.*` methods (gemini/actions.py).

No browser, no network beyond 127.0.0.1: Gemini's replies are scripted on the `FakeExtension`, so
what is pinned here is the half of an action that is ours -- the prompt it builds (skill file
prepended, `avoid` list trimmed), and how it reads a reply that arrives fenced, bare, wrapped in
chatter, or as garbage. The old drafting actions (draft / QA / lint / reply) are gone (decision
old-files). The Comms queue's actions are pinned in tests/test_comms_actions.py.
"""

from __future__ import annotations

import json
import threading
import time
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from fake_extension import THREAD_PREFIXES, Harness

from gratovo_pipeline import paths
from gratovo_pipeline.gemini import actions
from gratovo_pipeline.gemini.errors import GeminiError

KEYWORDS_STUB = "# KEYWORD GENERATOR STUB\n"
CLASSIFIER_STUB = "# CHANNEL CLASSIFIER STUB\n"


@pytest.fixture
def harness(loopback: None) -> Iterator[Harness]:
    h = Harness()
    try:
        yield h
    finally:
        h.close()


@pytest.fixture(autouse=True)
def no_threads_left_behind() -> Iterator[None]:
    yield
    # Give the joins a moment; then anything of ours still alive is a leak.
    deadline = time.monotonic() + 2
    ours: list[str] = []
    while time.monotonic() < deadline:
        ours = [t.name for t in threading.enumerate() if t.name.startswith(THREAD_PREFIXES)]
        if not ours:
            return
        time.sleep(0.05)
    raise AssertionError(f"threads left behind: {ours}")


@pytest.fixture
def skills(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A skills folder with stub files, which the actions read in place of the real one."""
    folder = tmp_path / "gemini-skills"
    folder.mkdir()
    (folder / "keyword generator skill.md").write_text(KEYWORDS_STUB, encoding="utf-8")
    (folder / "channel classifier skill.md").write_text(CLASSIFIER_STUB, encoding="utf-8")
    monkeypatch.setattr(paths, "GEMINI_SKILLS_DIR", folder)
    return folder


def send_reply(text: str, model: str = "2.5 Pro") -> Callable[[dict[str, Any]], object]:
    """A scripted `send` handler answering with `text`."""
    return lambda params: {"index": 0, "text": text, "html": "", "durationMs": 5, "model": model}


# --- skill files -------------------------------------------------------------------


def test_the_real_skill_files_are_where_the_default_points() -> None:
    for name in (actions.KEYWORDS_SKILL, actions.CLASSIFIER_SKILL):
        assert actions.skill_path(name).parent == paths.GEMINI_SKILLS_DIR
        assert actions.load_skill(name)


def test_skill_path_takes_a_folder_for_tests(tmp_path: Path) -> None:
    (tmp_path / "x.md").write_bytes(b"\xef\xbb\xbfone\r\ntwo\r\n")
    assert actions.load_skill("x.md", tmp_path) == "one\ntwo"
    assert actions.skill_path("x.md", tmp_path) == tmp_path / "x.md"


# --- JSON extraction -----------------------------------------------------------------


def test_extract_json_fence_bare_and_chatter() -> None:
    assert actions.extract_json('Sure!\n```json\n{"a": 1}\n```\nDone.') == {"a": 1}
    assert actions.extract_json('{"a": {"b": "}"}}') == {"a": {"b": "}"}}
    assert actions.extract_json('Here you go: {"a": 1} and {"b": 2}') == {"a": 1}
    assert actions.extract_json('escaped: {"s": "say \\"hi\\" {"}') == {"s": 'say "hi" {'}
    assert actions.extract_json("no json here {oops") is None
    assert actions.extract_json("") is None


# --- gems ------------------------------------------------------------------------------


def test_open_gem_accepts_a_full_url_and_rewrites_the_account(harness: Harness) -> None:
    fake = harness.attach(
        {
            "get_url": {"url": "https://gemini.google.com/u/1/app", "accountIndex": 1},
            "navigate": lambda p: {
                "tabId": 3,
                "url": p["url"],
                "redirected": False,
                "requestedUrl": p["url"],
            },
        }
    )
    out = harness.gemini.open_gem("https://gemini.google.com/u/0/gem/xyz")
    assert out == {"url": "https://gemini.google.com/u/1/gem/xyz", "tabId": 3}
    harness.gemini.open_gem("https://gemini.google.com/gem/xyz")
    assert fake.calls("navigate")[1]["url"] == "https://gemini.google.com/u/1/gem/xyz"


# --- generate_keywords -----------------------------------------------------------------


@pytest.mark.usefixtures("skills")
def test_generate_keywords_dedupes_and_trims_the_avoid_list(harness: Harness) -> None:
    reply = "\n".join(
        [
            "Here are your keywords:",
            "1. AI coding assistant review",
            "2. ai coding assistant review",  # duplicate, case-insensitive
            "- cursor vs copilot",
            '"best AI IDE 2025"',
            "Existing Keyword",  # in avoid
            "",
            "vibe coding tutorial",
        ]
    )
    fake = harness.attach({"send": send_reply(reply)})
    avoid = [f"old keyword {i}" for i in range(400)] + ["existing keyword"]
    result = harness.gemini.generate_keywords(
        "AI coding tools", count=5, avoid=avoid, exclusions=["music"], language="English"
    )
    assert result["keywords"] == [
        "AI coding assistant review",
        "cursor vs copilot",
        "best AI IDE 2025",
        "vibe coding tutorial",
    ]
    assert result["dropped"] == 2
    prompt = fake.calls("send")[0]["text"]
    assert prompt.startswith(KEYWORDS_STUB.strip())
    assert "Generate 5 long-tail YouTube search phrases" in prompt
    assert "music" in prompt
    assert "old keyword 399" in prompt
    assert "existing keyword" in prompt
    assert "old keyword 100" not in prompt, "only the last 300 avoid entries go into the prompt"
    assert "old keyword 101" in prompt


@pytest.mark.usefixtures("skills")
def test_generate_keywords_empty_reply_is_parse_failed(harness: Harness) -> None:
    harness.attach({"send": send_reply("Sorry:")})
    with pytest.raises(GeminiError) as info:
        harness.gemini.generate_keywords("anything")
    assert info.value.code == "ACTION_PARSE_FAILED"


# --- classify_channel ------------------------------------------------------------------


@pytest.mark.usefixtures("skills")
def test_classify_channel_parses_and_clamps(harness: Harness) -> None:
    reply = json.dumps(
        {
            "niche": "AI dev tools",
            "audience": "developers",
            "language": "English",
            "brandFit": 9,
            "reasons": ["reviews AI IDEs"],
            "redFlags": [],
        }
    )
    fake = harness.attach({"send": send_reply(reply)})
    result = harness.gemini.classify_channel(
        {"handle": "@techlead", "title": "TechLead"}, "AI tools", criteria=["English-speaking"]
    )
    assert result["brandFit"] == 5
    assert result["niche"] == "AI dev tools"
    assert result["reasons"] == ["reviews AI IDEs"]
    prompt = fake.calls("send")[0]["text"]
    assert prompt.startswith(CLASSIFIER_STUB.strip())
    assert "@techlead" in prompt
    assert "English-speaking" in prompt


def test_a_missing_skill_file_is_skill_file_missing_and_nothing_is_sent(
    harness: Harness, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(paths, "GEMINI_SKILLS_DIR", tmp_path / "no-skills-here")
    fake = harness.attach({"send": send_reply("{}")})
    with pytest.raises(GeminiError) as info:
        harness.gemini.classify_channel({"handle": "@techlead"}, "AI tools")
    assert info.value.code == "SKILL_FILE_MISSING"
    assert info.value.details["path"].endswith("channel classifier skill.md")
    assert fake.calls("send") == [], "nothing must be sent without the doctrine"


@pytest.mark.usefixtures("skills")
def test_a_garbage_reply_is_action_parse_failed(harness: Harness) -> None:
    harness.attach({"send": send_reply("I cannot help with that, sorry about it.")})
    with pytest.raises(GeminiError) as info:
        harness.gemini.classify_channel({"handle": "@techlead"}, "AI tools")
    assert info.value.code == "ACTION_PARSE_FAILED"
    assert info.value.details["raw"] == "I cannot help with that, sorry about it."


@pytest.mark.usefixtures("skills")
def test_a_refusal_is_raised_at_once_and_pauses_the_bridge(harness: Harness) -> None:
    # The owner's rule (plan D6a): a refusal means pause, never send again at once.
    fake = harness.attach({"send": send_reply("I'm having a hard time fulfilling your request.")})
    with pytest.raises(GeminiError) as info:
        harness.gemini.generate_keywords("AI agents")
    assert info.value.code == "ACTION_REFUSED"
    assert len(fake.calls("send")) == 1
    with pytest.raises(GeminiError) as paused:
        harness.gemini.generate_keywords("AI agents")
    assert paused.value.code == "PAUSED"
    assert len(fake.calls("send")) == 1, "nothing reaches the page while paused"


# --- dispatch --------------------------------------------------------------------------


def test_run_action_dispatch(harness: Harness) -> None:
    harness.attach({})
    with pytest.raises(GeminiError) as info:
        harness.gemini.action("action.nope", {})
    assert info.value.code == "BAD_PARAMS"
