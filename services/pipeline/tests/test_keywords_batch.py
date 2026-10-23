"""Tests for `action.generate_keywords` with `chats > 1` (gemini/keywords_batch.py).

Gemini is a scripted stand-in here -- the batch only needs `send`, `open_gem` and `server.running`
-- so what is pinned is the batch's own logic: how the count is split, what each chat is told (its
angle, everything found so far), how replies are merged and deduplicated, and what a failing chat
does to the rest.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast

import pytest

from gratovo_pipeline import paths
from gratovo_pipeline.gemini import actions, keywords_batch
from gratovo_pipeline.gemini.client import Gemini
from gratovo_pipeline.gemini.errors import GeminiError
from gratovo_pipeline.gemini.keywords_batch import near_key

KEYWORDS_STUB = "# KEYWORD GENERATOR STUB\n"


@pytest.fixture(autouse=True)
def skills(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    folder = tmp_path / "gemini-skills"
    folder.mkdir()
    (folder / "keyword generator skill.md").write_text(KEYWORDS_STUB, encoding="utf-8")
    monkeypatch.setattr(paths, "GEMINI_SKILLS_DIR", folder)
    return folder


class ScriptedGemini:
    """Answers each `send` with the next scripted reply: a string, or a GeminiError to raise."""

    def __init__(
        self,
        replies: list[str | GeminiError],
        on_send: Callable[[ScriptedGemini, int], None] | None = None,
    ) -> None:
        self.replies = list(replies)
        self.prompts: list[str] = []
        self.new_chats: list[bool] = []
        self.gems: list[str] = []
        self.server = SimpleNamespace(running=True)
        self.on_send = on_send

    def open_gem(self, gem: str) -> None:
        self.gems.append(gem)

    def send(
        self,
        prompt: str,
        wait: bool = True,
        new_chat: bool = True,
        model: str | None = None,
        timeout: float | None = None,
    ) -> dict[str, Any]:
        del wait, model, timeout
        self.prompts.append(prompt)
        self.new_chats.append(new_chat)
        if self.on_send is not None:
            self.on_send(self, len(self.prompts))
        if not self.replies:
            raise AssertionError("more sends than scripted replies")
        reply = self.replies.pop(0)
        if isinstance(reply, GeminiError):
            raise reply
        return {"text": reply, "model": "2.5 Pro"}


def as_gemini(scripted: ScriptedGemini) -> Gemini:
    return cast("Gemini", scripted)


def lines(*keywords: str) -> str:
    return "\n".join(keywords)


def collect() -> tuple[list[tuple[str, dict[str, Any]]], Callable[[str, dict[str, Any]], None]]:
    events: list[tuple[str, dict[str, Any]]] = []
    return events, lambda event, data: events.append((event, data))


# --- near_key ----------------------------------------------------------------------


def test_near_key_folds_order_filler_words_and_plurals() -> None:
    assert near_key("best AI tools for writers") == near_key("Writer AI Tool best")
    assert near_key("the AI tools") == near_key("AI tool")
    # Short words and double-s endings are not "plurals".
    assert near_key("class notes") != near_key("clas notes")
    assert near_key("gas") == "gas"
    assert near_key("AI vs ChatGPT") != near_key("AI vs Claude")


# --- routing -----------------------------------------------------------------------


def test_one_chat_is_the_plain_action_and_never_the_batch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    called: list[int] = []

    def fake_generate(*args: object, **kwargs: object) -> dict[str, Any]:
        del args, kwargs
        called.append(1)
        return {}

    monkeypatch.setattr(keywords_batch, "generate", fake_generate)
    gemini = ScriptedGemini([lines("ai tools for writers")])
    result = actions.generate_keywords(as_gemini(gemini), {"topic": "AI", "chats": 1})
    assert called == []
    assert result["keywords"] == ["ai tools for writers"]


def test_a_batch_needs_a_topic() -> None:
    with pytest.raises(GeminiError) as caught:
        keywords_batch.generate(as_gemini(ScriptedGemini([])), {"chats": 3})
    assert caught.value.code == "BAD_PARAMS"


# --- the happy path ----------------------------------------------------------------


def test_chats_are_merged_deduped_and_reported() -> None:
    gemini = ScriptedGemini(
        [
            lines("ai tools for writers", "chatgpt vs claude for coding", "old keyword"),
            # exact dup (case/space), near dup (order + plural), and a new one
            lines("AI  Tools for Writers", "writer ai tool", "free ai image generator"),
            lines("ai agents for small business", "chatgpt vs claude for coding"),
        ]
    )
    events, emit = collect()
    result = keywords_batch.generate(
        as_gemini(gemini),
        {"topic": "AI", "chats": 3, "count": 30, "avoid": ["Old Keyword"]},
        emit=emit,
    )

    assert result["keywords"] == [
        "ai tools for writers",
        "chatgpt vs claude for coding",
        "free ai image generator",
        "ai agents for small business",
    ]
    assert result["dropped"] == 4  # old keyword, 2 dups in chat 2, 1 dup in chat 3
    assert result["partial"] is False
    assert result["model"] == "2.5 Pro"
    assert [c["received"] for c in result["chats"]] == [2, 1, 1]
    assert all(c["ok"] for c in result["chats"])
    assert [c["requested"] for c in result["chats"]] == [10, 10, 10]
    assert gemini.new_chats == [True, True, True]

    progress = [data for event, data in events if event == "progress"]
    assert [(p["done"], p["total"], p["keywords"]) for p in progress] == [
        (1, 3, 2),
        (2, 3, 3),
        (3, 3, 4),
    ]
    assert progress[-1]["action"] == "generate_keywords"
    assert progress[1]["message"] == "chat 2 of 3 done"


def test_each_chat_gets_its_own_angle_and_everything_found_so_far() -> None:
    gemini = ScriptedGemini([lines("first chat keyword"), lines("second chat keyword")])
    keywords_batch.generate(
        as_gemini(gemini),
        {
            "topic": "AI",
            "chats": 2,
            "count": 10,
            "avoid": ["searched before"],
            "angles": ["ANGLE ONE", "ANGLE TWO"],
        },
    )
    first, second = gemini.prompts
    assert first.startswith(KEYWORDS_STUB.strip())
    assert "chat 1 of 2" in first
    assert "ANGLE ONE" in first
    assert "ANGLE TWO" not in first
    assert "chat 2 of 2" in second
    assert "ANGLE TWO" in second
    assert "- searched before" in first
    assert "- first chat keyword" not in first
    assert "- searched before" in second
    assert "- first chat keyword" in second


def test_angles_rotate_when_there_are_more_chats_than_angles() -> None:
    gemini = ScriptedGemini([lines(f"keyword number {i}") for i in range(3)])
    keywords_batch.generate(
        as_gemini(gemini),
        {"topic": "AI", "chats": 3, "count": 30, "angles": ["ANGLE A", "ANGLE B"]},
    )
    assert "ANGLE A" in gemini.prompts[2]


def test_a_gem_is_opened_for_every_chat() -> None:
    gemini = ScriptedGemini([lines("kw one"), lines("kw two")])
    keywords_batch.generate(
        as_gemini(gemini),
        {"topic": "AI", "chats": 2, "count": 10, "gem": "https://gemini.google.com/gem/kw"},
    )
    assert gemini.gems == ["https://gemini.google.com/gem/kw"] * 2
    # The gem is the doctrine: the skill file is not prepended.
    assert not gemini.prompts[0].startswith(KEYWORDS_STUB.strip())


# --- how the count is split --------------------------------------------------------


@pytest.mark.parametrize(
    ("params", "per_chat", "chats"),
    [
        ({"count": 10, "chats": 3}, 4, 3),
        ({"perChat": 7, "chats": 2}, 7, 2),
        ({"count": 9, "perChat": 2, "chats": 3}, 2, 3),
        ({"chats": 4}, 25, 4),
        ({"count": 80, "chats": 99}, 10, keywords_batch.MAX_CHATS),
    ],
)
def test_count_and_per_chat(params: dict[str, Any], per_chat: int, chats: int) -> None:
    gemini = ScriptedGemini([lines(f"unique keyword {i}") for i in range(chats)])
    result = keywords_batch.generate(as_gemini(gemini), {"topic": "AI", **params})
    assert len(result["chats"]) == chats
    assert result["chats"][0]["requested"] == per_chat
    assert f"Generate {per_chat} long-tail" in gemini.prompts[0]


def test_the_result_is_trimmed_to_count_and_later_chats_are_skipped() -> None:
    gemini = ScriptedGemini([lines(*(f"keyword {w}" for w in "abcdef"))])
    result = keywords_batch.generate(as_gemini(gemini), {"topic": "AI", "chats": 3, "count": 4})
    assert result["keywords"] == ["keyword a", "keyword b", "keyword c", "keyword d"]
    assert len(gemini.prompts) == 1
    assert [c.get("skipped", False) for c in result["chats"]] == [False, True, True]
    assert result["partial"] is False


# --- failures ----------------------------------------------------------------------


def test_a_failed_chat_is_retried_once_in_a_fresh_chat() -> None:
    gemini = ScriptedGemini(
        [
            GeminiError("TIMEOUT", "no reply"),
            lines("keyword after retry"),
            lines("second chat keyword"),
        ]
    )
    result = keywords_batch.generate(as_gemini(gemini), {"topic": "AI", "chats": 2, "count": 10})
    assert result["keywords"] == ["keyword after retry", "second chat keyword"]
    assert result["partial"] is False
    assert len(gemini.prompts) == 3
    assert gemini.prompts[0] == gemini.prompts[1]
    assert gemini.new_chats[1] is True


def test_an_empty_reply_counts_as_a_failure_and_is_retried() -> None:
    gemini = ScriptedGemini(["", lines("found on retry")])
    result = keywords_batch.generate(as_gemini(gemini), {"topic": "AI", "chats": 2, "count": 1})
    assert result["keywords"] == ["found on retry"]


def test_a_chat_that_fails_twice_makes_the_result_partial() -> None:
    gemini = ScriptedGemini(
        [
            lines("first chat keyword"),
            GeminiError("TIMEOUT", "no reply"),
            GeminiError("TIMEOUT", "still no reply"),
            lines("third chat keyword"),
        ]
    )
    events, emit = collect()
    result = keywords_batch.generate(
        as_gemini(gemini), {"topic": "AI", "chats": 3, "count": 30}, emit=emit
    )
    assert result["keywords"] == ["first chat keyword", "third chat keyword"]
    assert result["partial"] is True
    failed = result["chats"][1]
    assert failed["ok"] is False
    assert failed["received"] == 0
    assert failed["error"] == {"code": "TIMEOUT", "message": "still no reply"}
    assert events[1][1]["message"] == "chat 2 of 3 failed: still no reply"


def test_a_fatal_error_stops_the_batch_without_retrying() -> None:
    gemini = ScriptedGemini(
        [lines("first chat keyword"), GeminiError("SIGNED_OUT", "the Gemini tab is signed out")]
    )
    result = keywords_batch.generate(as_gemini(gemini), {"topic": "AI", "chats": 4, "count": 40})
    assert len(gemini.prompts) == 2
    assert result["keywords"] == ["first chat keyword"]
    assert result["partial"] is True
    assert [c["ok"] for c in result["chats"]] == [True, False, False, False]
    assert all(c["error"]["code"] == "SIGNED_OUT" for c in result["chats"][1:])
    assert all(c.get("skipped") for c in result["chats"][2:])


def test_when_every_chat_fails_the_last_error_is_raised() -> None:
    gemini = ScriptedGemini([GeminiError("EXTENSION_NOT_CONNECTED", "no extension")])
    with pytest.raises(GeminiError) as caught:
        keywords_batch.generate(as_gemini(gemini), {"topic": "AI", "chats": 3})
    assert caught.value.code == "EXTENSION_NOT_CONNECTED"
    assert len(gemini.prompts) == 1


def test_a_bridge_shut_down_between_chats_stops_the_batch() -> None:
    def stop_after_first(gemini: ScriptedGemini, sent: int) -> None:
        if sent == 1:
            gemini.server.running = False

    gemini = ScriptedGemini([lines("first chat keyword")], on_send=stop_after_first)
    result = keywords_batch.generate(as_gemini(gemini), {"topic": "AI", "chats": 3, "count": 30})
    assert len(gemini.prompts) == 1
    assert result["keywords"] == ["first chat keyword"]
    assert result["partial"] is True
    assert result["chats"][1]["skipped"] is True


def test_the_prompt_carries_only_the_most_recent_avoid_entries_but_dedupes_against_all() -> None:
    avoid = [f"old keyword {i}" for i in range(actions.AVOID_IN_PROMPT + 50)]
    gemini = ScriptedGemini([lines("old keyword 0", "fresh keyword"), lines("another fresh one")])
    result = keywords_batch.generate(
        as_gemini(gemini), {"topic": "AI", "chats": 2, "count": 10, "avoid": avoid}
    )
    assert "- old keyword 0\n" not in gemini.prompts[0]
    assert f"- old keyword {len(avoid) - 1}" in gemini.prompts[0]
    assert result["keywords"] == ["fresh keyword", "another fresh one"]
    assert result["dropped"] == 1
