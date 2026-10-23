"""The comms workflow never keeps a Gemini answer made without a confirmed thinking level.

Argon's level resets to the lowest on every new tab and reload; a whole batch once ran on "low"
unnoticed (2026-10-14). Every send asks for the level and the answer must carry the level confirmed.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import pytest

from gratovo_pipeline.comms import course, engine, mine_calls
from gratovo_pipeline.gemini.errors import ThinkingNotSet


class FakeGemini:
    def __init__(self, replies: list[dict[str, Any]]) -> None:
        self.replies = list(replies)
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def call(
        self, method: str, params: dict[str, Any] | None = None, timeout: float | None = None
    ) -> Any:
        if method == "get_conversation":  # the tab shows the last prompt sent, then its answer
            text = [p for m, p in self.calls if m == "send"][-1]["text"]
            return [{"role": "user", "text": text}, {"role": "model", "text": "answer"}]
        self.calls.append((method, dict(params or {})))
        return self.replies.pop(0)


ANSWER = json.dumps(
    {
        "situation": {
            "side": "brand",
            "stage": "replied",
            "reply_type": "brd.no",
            "summary": "s",
        },
        "decision": {"action": "close_lost", "why": "w", "rules": []},
        "message": None,
        "needs_human": [],
        "follow_up": None,
        "facts_used": [],
    }
)
CASE = {
    "side": "brand",
    "stage": "replied",
    "thread": [
        {"from": "us", "body": "Hi"},
        {"from": "them", "body": "We will think about it."},
    ],
}


def test_engine_asks_for_high_and_records_the_level() -> None:
    g = FakeGemini(
        [{"textRaw": "```json\n" + ANSWER + "\n```", "thinking": "مرتفع", "model": "4 Argon"}]
    )
    out = engine.propose(g, CASE)
    method, params = g.calls[0]
    assert method == "send"
    assert params["thinking"] == "high"
    assert params["newChat"] is True
    assert out["thinking"] == "مرتفع"
    assert out["model"] == "4 Argon"
    assert out["status"] == "no_message"


def test_engine_refuses_an_answer_without_a_confirmed_level() -> None:
    g = FakeGemini([{"textRaw": "```json\n" + ANSWER + "\n```", "thinking": None}])
    with pytest.raises(ThinkingNotSet):
        engine.propose(g, CASE)


def test_mine_calls_verify_ignores_answers_not_made_on_confirmed_high(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    call = course.Call(id="call:abc", title="Roast", date="2026-01-01", text="")
    monkeypatch.setattr(mine_calls, "selected_calls", lambda: [call])
    monkeypatch.setattr(mine_calls.playbook, "coaches", lambda: dict[str, str]())
    (tmp_path / "answers").mkdir()
    body = '```json\n{"items": [{"kind": "roast", "student_email": "Hi there", "quotes": []}]}\n```'
    answer = tmp_path / "answers" / "abc.json"
    answer.write_text(json.dumps({"key": "abc", "text": body}), encoding="utf-8")
    args = argparse.Namespace(out=tmp_path)
    mine_calls.cmd_verify(args)
    stats = json.loads((tmp_path / "verified.json").read_text(encoding="utf-8"))["stats"]
    assert stats["not_high"] == 1
    assert stats["items_kept"] == 0
    answer.write_text(
        json.dumps({"key": "abc", "text": body, "thinking": "مرتفع", "thinkingRequested": "high"}),
        encoding="utf-8",
    )
    mine_calls.cmd_verify(args)
    data = json.loads((tmp_path / "verified.json").read_text(encoding="utf-8"))
    assert data["stats"]["not_high"] == 0
    assert data["stats"]["items_kept"] == 1
    assert data["items"][0]["thinking"] == "مرتفع"
