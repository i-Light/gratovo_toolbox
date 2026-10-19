"""The comms workflow never keeps a Gemini answer made without a confirmed thinking level.

Argon's level resets to the lowest on every new tab and reload; a whole batch once ran on "low"
unnoticed (2026-10-14). Every send asks for the level and the answer must carry the level confirmed.
"""

import json
from types import SimpleNamespace

import pytest

from comms import engine, mine_calls
from gemini_bridge.errors import ThinkingNotSet


class FakeGemini:
    def __init__(self, replies):
        self.replies = list(replies)
        self.calls = []

    def call(self, method, params, timeout=None):
        if method == "get_conversation":   # the tab shows the last prompt sent, then its answer
            text = [p for m, p in self.calls if m == "send"][-1]["text"]
            return [{"role": "user", "text": text}, {"role": "model", "text": "answer"}]
        self.calls.append((method, dict(params)))
        return self.replies.pop(0)


ANSWER = json.dumps({"situation": {"side": "brand", "stage": "replied", "reply_type": "brd.no", "summary": "s"},
                     "decision": {"action": "close_lost", "why": "w", "rules": []}, "message": None,
                     "needs_human": [], "follow_up": None, "facts_used": []})
CASE = {"side": "brand", "stage": "replied", "thread": [{"from": "us", "body": "Hi"}, {"from": "them", "body": "We will think about it."}]}


def test_engine_asks_for_high_and_records_the_level():
    g = FakeGemini([{"textRaw": "```json\n" + ANSWER + "\n```", "thinking": "مرتفع", "model": "4 Argon"}])
    out = engine.propose(g, CASE)
    method, params = g.calls[0]
    assert method == "send" and params["thinking"] == "high" and params["newChat"] is True
    assert out["thinking"] == "مرتفع" and out["model"] == "4 Argon"
    assert out["status"] == "no_message"


def test_engine_refuses_an_answer_without_a_confirmed_level():
    g = FakeGemini([{"textRaw": "```json\n" + ANSWER + "\n```", "thinking": None}])
    with pytest.raises(ThinkingNotSet):
        engine.propose(g, CASE)


def test_mine_calls_verify_ignores_answers_not_made_on_confirmed_high(tmp_path, monkeypatch):
    call = SimpleNamespace(id="call:abc", title="Roast", date="2026-01-01", text="")
    monkeypatch.setattr(mine_calls, "OUT", tmp_path)
    monkeypatch.setattr(mine_calls, "selected_calls", lambda: [call])
    monkeypatch.setattr(mine_calls.playbook, "coaches", lambda: {})
    (tmp_path / "answers").mkdir()
    body = '```json\n{"items": [{"kind": "roast", "student_email": "Hi there", "quotes": []}]}\n```'
    (tmp_path / "answers" / "abc.json").write_text(json.dumps({"key": "abc", "text": body}), encoding="utf-8")
    mine_calls.cmd_verify(None)
    stats = json.loads((tmp_path / "verified.json").read_text(encoding="utf-8"))["stats"]
    assert stats["not_high"] == 1 and stats["items_kept"] == 0
    (tmp_path / "answers" / "abc.json").write_text(
        json.dumps({"key": "abc", "text": body, "thinking": "مرتفع", "thinkingRequested": "high"}), encoding="utf-8")
    mine_calls.cmd_verify(None)
    data = json.loads((tmp_path / "verified.json").read_text(encoding="utf-8"))
    assert data["stats"]["not_high"] == 0 and data["stats"]["items_kept"] == 1
    assert data["items"][0]["thinking"] == "مرتفع"
