"""The daemon's Comms actions (plan step 6): `comms_propose` builds the live case from gratovo.db and asks the
engine; `comms_check` re-checks text a person edited before it goes, without Gemini.

Run with:  python -m pytest tests/test_comms_actions.py    (from pipeline/)
"""

import json
import sys
import tempfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gemini_bridge import actions  # noqa: E402
from gratovo import store  # noqa: E402

from tests.test_comms_live_case import APP_DDL  # noqa: E402

GOOD = """```json
{"situation": {"side": "influencer", "stage": "replied", "reply_type": "inf.asks_price_from_us", "summary": "s"},
 "decision": {"action": "send_message", "why": "They asked what we pay; we ask their rate first.", "rules": ["INF-PRICE-09"]},
 "message": {"channel": "email", "subject": "Re: hi", "body": "Hi Sam,\\n\\nWhat do you usually charge for a sponsored segment?\\n\\nMoustafa"},
 "needs_human": [], "follow_up": {"in_working_days": 2, "note": null}, "facts_used": []}
```"""


class FakeGemini:
    def __init__(self, *texts):
        self.texts, self.sent = list(texts), []

    def call(self, method, params, timeout=None):
        if method == "get_conversation":
            return [{"role": "user", "text": self.sent[-1]["text"]}, {"role": "model", "text": "answer"}]
        self.sent.append(params)
        return {"textRaw": self.texts.pop(0), "thinking": "High", "model": "Argon"}


@pytest.fixture
def db():
    with tempfile.TemporaryDirectory() as tmp:
        path = str(Path(tmp) / "g.db")
        c = store.get_connection(path)
        store.init_db(c)
        c.executescript(APP_DDL)
        c.execute("INSERT INTO channels (channel_id, handle, name, first_seen_at) VALUES ('UC_a', '@sam', 'Sam', 'T')")
        c.execute("INSERT INTO outreach_threads (id, channel_id, status) VALUES ('t1', 'UC_a', 'replied')")
        c.execute("INSERT INTO outreach_messages VALUES ('m1', 't1', 'outbound', 'hi', 'Hi Sam, saw your test.', '2026-10-14')")
        c.execute("INSERT INTO outreach_messages VALUES ('m2', 't1', 'inbound', 'Re: hi', 'What do you pay?', '2026-10-16')")
        c.commit()
        c.close()
        yield path


def test_a_reply_is_proposed_from_the_thread(db):
    gemini = FakeGemini(GOOD)

    result = actions.run_action(gemini, "comms_propose",
                                {"dbPath": db, "request": {"kind": "reply", "threadId": "t1"}})

    assert result["status"] == "ready"
    assert result["proposal"]["message"]["body"].startswith("Hi Sam")
    assert result["case"] == {"side": "influencer", "stage": "replied",
                              "goal": "Decide the next step after their latest message and draft our reply if one is needed."}
    assert "What do you pay?" in gemini.sent[0]["text"], "the thread reached the prompt"


def test_an_out_of_scope_creator_is_refused_without_gemini(db):
    import sqlite3
    c = sqlite3.connect(db)
    c.execute("INSERT INTO channel_state (channel_id, handle, creator_gender) VALUES ('UC_a', '@sam', 'female')")
    c.commit()
    c.close()
    gemini = FakeGemini()

    result = actions.run_action(gemini, "comms_propose",
                                {"dbPath": db, "request": {"kind": "reply", "threadId": "t1"}})

    assert result["status"] == "blocked"
    assert result["findings"][0]["code"] == "HC08_OUT_OF_SCOPE"
    assert gemini.sent == []


def test_edited_text_is_checked_again_before_it_goes(db):
    result = actions.run_action(None, "comms_check", {
        "dbPath": db, "request": {"kind": "reply", "threadId": "t1"},
        "subject": "Re: hi", "body": "Hi Sam,\n\nWe can pay you $500 for one video.\n\nMoustafa"})

    assert result["blocking"] is False
    assert any(g["what"] == "price" for g in result["gates"]), "a price in the text waits for a person"


def test_a_check_finds_what_blocks(db):
    result = actions.run_action(None, "comms_check", {
        "dbPath": db, "request": {"kind": "reply", "threadId": "t1"},
        "subject": "Re: hi", "body": "Hi Sam,\n\nThis is a guaranteed, risk-free, 100% free opportunity!!!\n\nMoustafa"})

    assert result["blocking"] is True
    assert result["findings"]


@pytest.mark.parametrize("left_in", ["[Your name]", "[First name]", "[Agency]", "{creator_name}", "<Brand>"])
def test_an_unfilled_placeholder_blocks_the_send(db, left_in):
    # The engine leaves a placeholder when a fact is missing and asks a person
    # to fill it; confirming that gate must not send the placeholder itself.
    result = actions.run_action(None, "comms_check", {
        "dbPath": db, "request": {"kind": "reply", "threadId": "t1"},
        "subject": "Re: hi", "body": f"Hi Sam,\n\nHappy to talk rates on a call.\n\n{left_in}"})

    assert result["blocking"] is True
    assert any(f["code"] == "PLACEHOLDER" and f["severity"] == "block" for f in result["findings"])


def test_square_brackets_that_are_not_a_placeholder_pass(db):
    result = actions.run_action(None, "comms_check", {
        "dbPath": db, "request": {"kind": "reply", "threadId": "t1"},
        "subject": "Re: hi", "body": "Hi Sam,\n\nHappy to talk rates on a call [2 min].\n\nMoustafa"})

    assert not any(f["code"] == "PLACEHOLDER" for f in result["findings"])


def test_comms_check_needs_no_gemini_page():
    assert "comms_check" in actions._OFF_PAGE_ACTIONS
    assert "comms_propose" not in actions._OFF_PAGE_ACTIONS
