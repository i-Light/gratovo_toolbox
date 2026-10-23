"""Tests for the outreach mailbox store: the follow-up queue, threading, reply reporting, send keys.

No network. Everything runs against a real SQLite file in `tmp_path`.

One thing above all others: a follow-up must never reach somebody who has already replied. It is
enforced in one place, the join in `mailbox.due_steps`, and `test_reply_stops_the_sequence` is what
stops that join from being quietly simplified away. (Follow-ups are no longer queued, D17; an old
file may hold some, and the reply sweep cancels them.)
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from gratovo_pipeline.mail import mailbox

ACCOUNT = "outreach@gratovo.test"
KEY = "thread-abc"


def sent_result(
    message_id: str = "m1", thread_id: str = "t1", rfc: str = "<rfc-1@mail>"
) -> dict[str, str]:
    """What `GmailClient.send` returns, shaped as the real one is."""
    return {
        "messageId": message_id,
        "threadId": thread_id,
        "rfcMessageId": rfc,
        "labelId": "Label_1",
    }


def reply(
    message_id: str = "r1", sender: str = "creator@example.com", at: int = 1_700_000_000_000
) -> dict[str, Any]:
    return {
        "messageId": message_id,
        "from": sender,
        "fromName": "A Creator",
        "subject": "Re: Collaboration",
        "at": at,
        "body": "Sounds interesting, tell me more.",
        "snippet": "Sounds interesting",
    }


@pytest.fixture
def conn(tmp_path: Path) -> Iterator[sqlite3.Connection]:
    connection = mailbox.open_db(tmp_path / "mailbox.db")
    yield connection
    connection.close()


def open_conversation(
    conn: sqlite3.Connection, *, key: str = KEY, recipient: str = "creator@example.com"
) -> None:
    mailbox.upsert_conversation(
        conn,
        conversation_key=key,
        account=ACCOUNT,
        recipient=recipient,
        subject="Collaboration",
        label="Gratovo Outreach",
        channel_id="UC123",
    )
    mailbox.record_send(
        conn,
        conversation_key=key,
        account=ACCOUNT,
        result=sent_result(),
        recipient=recipient,
        subject="Collaboration",
        body="Hello there.",
    )


def queue(
    conn: sqlite3.Connection, *, due: str = "2000-01-01T00:00:00Z", key: str = KEY, count: int = 1
) -> list[sqlite3.Row]:
    return mailbox.queue_steps(
        conn,
        conversation_key=key,
        account=ACCOUNT,
        steps=[{"dueAt": due, "body": f"Follow-up {i + 1}"} for i in range(count)],
        base_step_no=mailbox.highest_step_no(conn, key, ACCOUNT),
    )


# --- SequenceTest ---


def test_reply_stops_the_sequence(conn: sqlite3.Connection) -> None:
    """The one that matters: a due step vanishes the moment a reply lands."""
    open_conversation(conn)
    queue(conn, count=2)
    assert len(mailbox.due_steps(conn, ACCOUNT)) == 2

    mailbox.record_replies(conn, KEY, ACCOUNT, [reply()])

    assert mailbox.due_steps(conn, ACCOUNT) == [], "a replied conversation never yields a step"


def test_reply_stops_the_sequence_before_cancel_runs(conn: sqlite3.Connection) -> None:
    """`reply_seen_at` alone is enough; cancelling is only bookkeeping."""
    open_conversation(conn)
    queue(conn, count=2)
    mailbox.record_replies(conn, KEY, ACCOUNT, [reply()])

    assert len(mailbox.pending_steps(conn, ACCOUNT)) == 2, "not cancelled yet"
    assert mailbox.due_steps(conn, ACCOUNT) == [], "but already unreachable"


def test_cancel_reports_how_many_it_stopped(conn: sqlite3.Connection) -> None:
    open_conversation(conn)
    queue(conn, count=3)
    assert mailbox.cancel_steps(conn, KEY, ACCOUNT) == 3
    assert mailbox.cancel_steps(conn, KEY, ACCOUNT) == 0, "cancelling twice must not double-count"


def test_future_steps_are_not_due(conn: sqlite3.Connection) -> None:
    open_conversation(conn)
    queue(conn, due="2999-01-01T00:00:00Z")
    assert mailbox.due_steps(conn, ACCOUNT) == []


def test_step_numbers_continue_across_sequences(conn: sqlite3.Connection) -> None:
    open_conversation(conn)
    queue(conn, count=2)
    second = queue(conn, count=2)
    assert [row["step_no"] for row in second] == [3, 4]


def test_steps_are_scoped_to_their_conversation(conn: sqlite3.Connection) -> None:
    open_conversation(conn)
    open_conversation(conn, key="thread-other", recipient="b@example.com")
    queue(conn, count=1)
    queue(conn, key="thread-other", count=1)

    mailbox.record_replies(conn, KEY, ACCOUNT, [reply()])

    due = mailbox.due_steps(conn, ACCOUNT)
    assert len(due) == 1
    assert due[0]["conversation_key"] == "thread-other"


def test_a_step_gives_up_after_repeated_failure(conn: sqlite3.Connection) -> None:
    open_conversation(conn)
    step = queue(conn)[0]

    assert mailbox.mark_step_failed(conn, step["id"], "boom") is False
    assert len(mailbox.due_steps(conn, ACCOUNT)) == 1, "a transient failure leaves it retryable"

    mailbox.mark_step_failed(conn, step["id"], "boom")
    exhausted = mailbox.mark_step_failed(conn, step["id"], "boom")

    assert exhausted is True
    assert mailbox.due_steps(conn, ACCOUNT) == [], "a step that gave up stops being retried"


def test_empty_step_bodies_are_dropped(conn: sqlite3.Connection) -> None:
    open_conversation(conn)
    queued = mailbox.queue_steps(
        conn,
        conversation_key=KEY,
        account=ACCOUNT,
        steps=[{"body": "   "}, {"body": "real"}],
    )
    assert len(queued) == 1


# --- ThreadingTest ---


def test_a_send_records_what_the_next_one_needs(conn: sqlite3.Connection) -> None:
    open_conversation(conn)
    row = mailbox.get_conversation(conn, KEY, ACCOUNT)
    assert row is not None
    assert row["gmail_thread_id"] == "t1"
    assert row["last_rfc_id"] == "<rfc-1@mail>"
    assert row["channel_id"] == "UC123"


def test_a_second_send_advances_the_message_id(conn: sqlite3.Connection) -> None:
    """The next message quotes the LAST one, not the first."""
    open_conversation(conn)
    mailbox.record_send(
        conn,
        conversation_key=KEY,
        account=ACCOUNT,
        result=sent_result("m2", "t1", "<rfc-2@mail>"),
        recipient="creator@example.com",
        subject="Re: Collaboration",
        body="Just checking in.",
        step_no=1,
    )
    row = mailbox.get_conversation(conn, KEY, ACCOUNT)
    assert row is not None
    assert row["last_rfc_id"] == "<rfc-2@mail>"
    assert row["gmail_thread_id"] == "t1", "same thread throughout"


def test_preparing_a_send_cannot_erase_the_thread(conn: sqlite3.Connection) -> None:
    open_conversation(conn)
    mailbox.upsert_conversation(
        conn, conversation_key=KEY, account=ACCOUNT, recipient="creator@example.com"
    )
    row = mailbox.get_conversation(conn, KEY, ACCOUNT)
    assert row is not None
    assert row["gmail_thread_id"] == "t1"
    assert row["last_rfc_id"] == "<rfc-1@mail>"


def test_the_same_key_in_two_mailboxes_is_two_conversations(conn: sqlite3.Connection) -> None:
    open_conversation(conn)
    mailbox.upsert_conversation(
        conn, conversation_key=KEY, account="other@gratovo.test", recipient="creator@example.com"
    )
    other = mailbox.get_conversation(conn, KEY, "other@gratovo.test")
    assert other is not None
    assert other["gmail_thread_id"] is None, "a thread id from one mailbox means nothing in another"


# --- ReplyReportingTest ---


def test_a_reply_is_reported_once(conn: sqlite3.Connection) -> None:
    open_conversation(conn)
    mailbox.record_replies(conn, KEY, ACCOUNT, [reply()])

    first = mailbox.unreported_replies(conn, ACCOUNT)
    assert len(first) == 1

    mailbox.mark_reported(conn, [first[0]["gmail_message_id"]])
    assert mailbox.unreported_replies(conn, ACCOUNT) == []


def test_seeing_the_same_reply_again_reports_nothing_new(conn: sqlite3.Connection) -> None:
    """Sweeps overlap; Gmail returns the whole thread every time."""
    open_conversation(conn)
    mailbox.record_replies(conn, KEY, ACCOUNT, [reply()])
    mailbox.mark_reported(conn, ["r1"])

    fresh = mailbox.record_replies(conn, KEY, ACCOUNT, [reply()])

    assert fresh == [], "already-seen replies are not re-reported"
    assert mailbox.unreported_replies(conn, ACCOUNT) == []


def test_an_unacknowledged_reply_survives_to_the_next_sweep(conn: sqlite3.Connection) -> None:
    """The app crashed mid-apply; the reply must still be waiting."""
    open_conversation(conn)
    mailbox.record_replies(conn, KEY, ACCOUNT, [reply()])
    mailbox.record_replies(conn, KEY, ACCOUNT, [reply()])
    assert len(mailbox.unreported_replies(conn, ACCOUNT)) == 1


def test_the_first_reply_stamps_the_conversation_once(conn: sqlite3.Connection) -> None:
    open_conversation(conn)
    mailbox.record_replies(conn, KEY, ACCOUNT, [reply()])
    first = mailbox.get_conversation(conn, KEY, ACCOUNT)
    assert first is not None
    first_stamp = first["reply_seen_at"]

    mailbox.record_replies(conn, KEY, ACCOUNT, [reply("r2", at=1_700_000_100_000)])
    row = mailbox.get_conversation(conn, KEY, ACCOUNT)

    assert row is not None
    assert row["reply_seen_at"] == first_stamp, "the stamp marks the FIRST reply, not the latest"
    assert row["replied_from"] == "creator@example.com"


def test_our_own_sends_are_excluded_from_a_thread_read(conn: sqlite3.Connection) -> None:
    open_conversation(conn)
    assert mailbox.sent_message_ids(conn, KEY, ACCOUNT) == {"m1"}


def test_a_replied_conversation_stops_being_swept(conn: sqlite3.Connection) -> None:
    open_conversation(conn)
    assert len(mailbox.open_conversations(conn, ACCOUNT)) == 1
    mailbox.record_replies(conn, KEY, ACCOUNT, [reply()])
    assert mailbox.open_conversations(conn, ACCOUNT) == []


# --- CountersTest ---


def test_counters_describe_the_mailbox(conn: sqlite3.Connection) -> None:
    open_conversation(conn)
    queue(conn, count=2)
    counts = mailbox.counters(conn, ACCOUNT)
    assert set(counts) == {
        "conversations",
        "sent",
        "awaitingReply",
        "replied",
        "pendingSteps",
        "dueSteps",
        "failedSteps",
        "unreportedReplies",
    }
    assert counts["sent"] == 1
    assert counts["awaitingReply"] == 1
    assert counts["pendingSteps"] == 2
    assert counts["dueSteps"] == 2
    assert counts["replied"] == 0

    mailbox.record_replies(conn, KEY, ACCOUNT, [reply()])
    counts = mailbox.counters(conn, ACCOUNT)
    assert counts["replied"] == 1
    assert counts["awaitingReply"] == 0
    assert counts["dueSteps"] == 0
    assert counts["unreportedReplies"] == 1


# --- SendKeyTest (store level) ---


def test_a_claimed_key_is_new_once_then_returns_its_row(conn: sqlite3.Connection) -> None:
    assert mailbox.claim_send_key(conn, "sk-1", account=ACCOUNT, conversation_key=KEY) is None
    again = mailbox.claim_send_key(conn, "sk-1", account=ACCOUNT, conversation_key=KEY)
    assert again is not None
    assert again["state"] == mailbox.SEND_KEY_CLAIMED, "an attempt that never reported back"


def test_a_sent_key_answers_with_the_original_message(conn: sqlite3.Connection) -> None:
    open_conversation(conn)
    mailbox.claim_send_key(conn, "sk-1", account=ACCOUNT, conversation_key=KEY)
    mailbox.record_send(
        conn,
        conversation_key=KEY,
        account=ACCOUNT,
        result=sent_result("m9"),
        recipient="creator@example.com",
        subject="Collaboration",
        body="Hello there.",
        send_key="sk-1",
    )
    again = mailbox.claim_send_key(conn, "sk-1", account=ACCOUNT, conversation_key=KEY)
    assert again is not None
    assert again["state"] == mailbox.SEND_KEY_SENT
    assert again["gmail_message_id"] == "m9"


def test_a_released_claim_can_be_retried_but_a_sent_key_cannot(conn: sqlite3.Connection) -> None:
    mailbox.claim_send_key(conn, "sk-1", account=ACCOUNT, conversation_key=KEY)
    mailbox.release_send_key(conn, "sk-1")
    assert mailbox.claim_send_key(conn, "sk-1", account=ACCOUNT, conversation_key=KEY) is None

    conn.execute(
        "UPDATE send_keys SET state = ? WHERE send_key = ?", (mailbox.SEND_KEY_SENT, "sk-1")
    )
    conn.commit()
    mailbox.release_send_key(conn, "sk-1")
    kept = mailbox.claim_send_key(conn, "sk-1", account=ACCOUNT, conversation_key=KEY)
    assert kept is not None, "a key that reached sent is never released"


def test_a_different_key_is_a_different_claim(conn: sqlite3.Connection) -> None:
    assert mailbox.claim_send_key(conn, "sk-1", account=ACCOUNT, conversation_key=KEY) is None
    assert mailbox.claim_send_key(conn, "sk-2", account=ACCOUNT, conversation_key=KEY) is None


# --- cold_sent_since ---


def test_cold_sent_since_ignores_old_and_replied_sends(conn: sqlite3.Connection) -> None:
    open_conversation(conn)
    assert mailbox.cold_sent_since(conn, ACCOUNT, "2000-01-01T00:00:00Z") == 1
    assert mailbox.cold_sent_since(conn, ACCOUNT, "2999-01-01T00:00:00Z") == 0
    conn.execute("UPDATE conversations SET reply_seen_at = '2000-01-01T00:00:00Z'")
    conn.commit()
    assert mailbox.cold_sent_since(conn, ACCOUNT, "2000-01-01T00:00:00Z") == 0


# --- new in 3e-3b: versioning, migration, approved_by ---

OLD_TABLES = """
CREATE TABLE sent_messages (
    gmail_message_id TEXT PRIMARY KEY,
    conversation_key TEXT NOT NULL,
    account          TEXT NOT NULL,
    gmail_thread_id  TEXT,
    rfc_message_id   TEXT,
    step_no          INTEGER NOT NULL DEFAULT 0,
    recipient        TEXT,
    subject          TEXT,
    body             TEXT,
    sent_at          TEXT NOT NULL
);
CREATE TABLE send_keys (
    send_key         TEXT PRIMARY KEY,
    account          TEXT NOT NULL,
    conversation_key TEXT NOT NULL,
    state            TEXT NOT NULL,
    gmail_message_id TEXT,
    claimed_at       TEXT NOT NULL,
    sent_at          TEXT
);
INSERT INTO sent_messages (gmail_message_id, conversation_key, account, sent_at)
VALUES ('old-m', 'old-k', 'a@x.test', '2026-01-01T00:00:00Z');
INSERT INTO send_keys (send_key, account, conversation_key, state, claimed_at)
VALUES ('old-sk', 'a@x.test', 'old-k', 'sent', '2026-01-01T00:00:00Z');
"""


def columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {str(row["name"]) for row in conn.execute(f"PRAGMA table_info({table})")}


def test_an_old_file_opens_gains_the_columns_and_keeps_its_rows(tmp_path: Path) -> None:
    path = tmp_path / "mailbox.db"
    old = sqlite3.connect(path)
    old.executescript(OLD_TABLES)
    old.commit()
    old.close()

    conn = mailbox.open_db(path)
    try:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 1
        assert "approved_by" in columns(conn, "sent_messages")
        assert "approved_by" in columns(conn, "send_keys")
        sent = mailbox.sent_message(conn, "old-m")
        assert sent is not None
        assert sent["approved_by"] is None
        key = mailbox.claim_send_key(conn, "old-sk", account="a@x.test", conversation_key="old-k")
        assert key is not None
        assert key["state"] == mailbox.SEND_KEY_SENT
    finally:
        conn.close()

    # Opening it again changes nothing and does not try to add the columns twice.
    again = mailbox.open_db(path)
    again.close()


def test_a_newer_file_is_refused(tmp_path: Path) -> None:
    path = tmp_path / "mailbox.db"
    newer = sqlite3.connect(path)
    newer.execute("PRAGMA user_version=2")
    newer.commit()
    newer.close()

    with pytest.raises(mailbox.MailboxTooNewError):
        mailbox.open_db(path)


def test_open_db_creates_the_parent_folder(tmp_path: Path) -> None:
    conn = mailbox.open_db(tmp_path / "mail" / "deeper" / "mailbox.db")
    conn.close()
    assert (tmp_path / "mail" / "deeper" / "mailbox.db").exists()


def test_approved_by_is_stored_by_claim_and_by_send(conn: sqlite3.Connection) -> None:
    open_conversation(conn)
    assert (
        mailbox.claim_send_key(
            conn, "sk-1", account=ACCOUNT, conversation_key=KEY, approved_by="user-1"
        )
        is None
    )
    claimed = conn.execute("SELECT approved_by FROM send_keys WHERE send_key = 'sk-1'").fetchone()
    assert claimed["approved_by"] == "user-1"

    mailbox.record_send(
        conn,
        conversation_key=KEY,
        account=ACCOUNT,
        result=sent_result("m5"),
        recipient="creator@example.com",
        subject="Collaboration",
        body="Hello there.",
        send_key="sk-1",
        approved_by="user-1",
    )
    sent = mailbox.sent_message(conn, "m5")
    assert sent is not None
    assert sent["approved_by"] == "user-1"
