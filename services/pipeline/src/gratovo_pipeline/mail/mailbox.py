"""The outreach mailbox's own memory: `<dataDir>/mailbox.db` (ported from legacy `mailbox.py`).

WHY THIS IS A SEPARATE DATABASE FROM pipeline.db
------------------------------------------------
`pipeline.db` is the local half of *shared* state: a channel one person found is a channel the
whole team has found. Nothing in this file is like that. A Gmail thread id is meaningful only
inside the one mailbox that holds it, and so is the RFC Message-ID a follow-up has to quote. So
this is per-mailbox state on the machine that sends, and it stays there.

WHY IT EXISTS AT ALL
--------------------
Three questions, none of which Gmail can answer on its own:

  * Where does the next message in this conversation go? That needs the Gmail thread id and the
    last Message-ID header, and neither is derivable from the app's outreach thread id.
  * What is still owed? A follow-up is a promise that has to outlive the process that made it, so
    it is a row, not a timer. (Nothing queues follow-ups any more, D17; an old file may still hold
    some, and the reply sweep cancels them. They are never sent.)
  * What has already been reported? Reply detection polls; without a record of which inbound
    messages were handed to the app, every poll would re-report every reply.

CONVERSATION KEYS
-----------------
Rows are keyed by `(conversation_key, account)`. The key is the app's outreach thread id;
`account` is the sending mailbox, so switching accounts starts a separate set of conversations.

COMPATIBILITY
-------------
The tables and columns are the old app's, so a `mailbox.db` it wrote opens unchanged (D17). Two
additions: `PRAGMA user_version` 1, and `approved_by` on `sent_messages` and `send_keys` (who
approved the send), added by a guarded `ALTER TABLE` when the column is missing.
"""

from __future__ import annotations

import sqlite3
import time
import uuid
from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import Any, Final

SCHEMA_VERSION: Final = 1

# A second writer waits this long instead of failing at once with "database is locked".
BUSY_TIMEOUT_MS: Final = 15000

SCHEMA: Final = """
-- One row per (outreach thread, sending mailbox). Holds everything needed to
-- continue the conversation and everything known about how it is going.
CREATE TABLE IF NOT EXISTS conversations (
    conversation_key TEXT NOT NULL,
    account          TEXT NOT NULL,
    gmail_thread_id  TEXT,
    channel_id       TEXT,
    recipient        TEXT NOT NULL,
    subject          TEXT,
    label            TEXT,
    -- The Message-ID of the last thing WE sent. The next follow-up quotes it
    -- in In-Reply-To/References; without it a follow-up starts a new thread.
    last_rfc_id      TEXT,
    first_sent_at    TEXT,
    last_sent_at     TEXT,
    -- Set the moment a reply is detected. This is what makes the sequence
    -- stop: `due_steps` will not return a step for a conversation that has
    -- one, so a reply cancels the chase without anything having to race to
    -- delete rows.
    reply_seen_at    TEXT,
    replied_from     TEXT,
    -- Set when the sequence is finished or cancelled, so `open_conversations`
    -- stops polling Gmail about a conversation nobody is waiting on.
    closed_at        TEXT,
    PRIMARY KEY (conversation_key, account)
);

-- Every message actually handed to Gmail. An append-only log: this is the
-- answer to "did we already send step 2", and the reason a crash between the
-- API call and the follow-up bookkeeping cannot produce a second send.
CREATE TABLE IF NOT EXISTS sent_messages (
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
CREATE INDEX IF NOT EXISTS idx_sent_conversation
    ON sent_messages(conversation_key, account);

-- The queued follow-ups. `state` is one of: pending, sent, cancelled, failed.
CREATE TABLE IF NOT EXISTS sequence_steps (
    id               TEXT PRIMARY KEY,
    conversation_key TEXT NOT NULL,
    account          TEXT NOT NULL,
    step_no          INTEGER NOT NULL,
    due_at           TEXT NOT NULL,
    subject          TEXT,
    body             TEXT NOT NULL,
    state            TEXT NOT NULL DEFAULT 'pending',
    gmail_message_id TEXT,
    attempts         INTEGER NOT NULL DEFAULT 0,
    last_error       TEXT,
    created_at       TEXT NOT NULL,
    resolved_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_steps_due
    ON sequence_steps(state, due_at);
CREATE INDEX IF NOT EXISTS idx_steps_conversation
    ON sequence_steps(conversation_key, account);

-- Replies, as seen. `reported_at` is the app's read cursor: a row with NULL
-- has never been handed over, and reporting it is what sets the stamp. That is
-- what stops a poll every few minutes from re-logging the same reply into the
-- CRM every few minutes.
CREATE TABLE IF NOT EXISTS inbound_messages (
    gmail_message_id TEXT PRIMARY KEY,
    conversation_key TEXT NOT NULL,
    account          TEXT NOT NULL,
    from_address     TEXT,
    from_name        TEXT,
    subject          TEXT,
    body             TEXT,
    received_at      TEXT,
    seen_at          TEXT NOT NULL,
    reported_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_inbound_unreported
    ON inbound_messages(account, reported_at);

-- One row per caller-chosen send key: the app hands the same key with every
-- attempt at one message. `claimed` is written before Gmail is asked and
-- becomes `sent` in the same commit that files the message, so a retried
-- request can tell "already went out" (answered with the original send;
-- nothing goes twice) from "an earlier attempt died inside the API call"
-- (refused: only a person looking at Gmail's Sent folder can settle that).
CREATE TABLE IF NOT EXISTS send_keys (
    send_key         TEXT PRIMARY KEY,
    account          TEXT NOT NULL,
    conversation_key TEXT NOT NULL,
    state            TEXT NOT NULL,
    gmail_message_id TEXT,
    claimed_at       TEXT NOT NULL,
    sent_at          TEXT
);

-- Small key/value scratch for cursors that belong to no conversation, e.g.
-- when the last full reply sweep ran.
CREATE TABLE IF NOT EXISTS mailbox_state (
    key   TEXT PRIMARY KEY,
    value TEXT
);
"""

# Columns added after the old app's schema: (table, column). Added only when missing.
_ADDED_COLUMNS: Final = (
    ("sent_messages", "approved_by"),
    ("send_keys", "approved_by"),
)

LAST_SWEEP_KEY: Final = "last_reply_sweep_at"

STATE_PENDING: Final = "pending"
STATE_SENT: Final = "sent"
STATE_CANCELLED: Final = "cancelled"
STATE_FAILED: Final = "failed"

SEND_KEY_CLAIMED: Final = "claimed"
SEND_KEY_SENT: Final = "sent"

# A step that has failed this many times stops being retried. A follow-up that
# cannot be delivered is a problem to look at, not a thing to keep attempting
# every few minutes for a fortnight.
MAX_STEP_ATTEMPTS: Final = 3

type Params = list[Any]


class MailboxTooNewError(RuntimeError):
    """The file was written by a newer pipeline than this one."""


def now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def get_connection(db_path: Path | str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path, check_same_thread=True)
    # WAL so the app can read this file while a job writes it, and neither blocks the other.
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute(f"PRAGMA busy_timeout={BUSY_TIMEOUT_MS}")
    conn.row_factory = sqlite3.Row
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    # Additive changes only: a new `CREATE TABLE IF NOT EXISTS` or a guarded
    # `ALTER TABLE ... ADD COLUMN` self-heals an existing mailbox.db.
    version: int = conn.execute("PRAGMA user_version").fetchone()[0]
    if version > SCHEMA_VERSION:
        raise MailboxTooNewError(
            f"mailbox.db is version {version}; this pipeline knows {SCHEMA_VERSION}"
        )
    conn.executescript(SCHEMA)
    for table, column in _ADDED_COLUMNS:
        existing = {str(row["name"]) for row in conn.execute(f"PRAGMA table_info({table})")}
        if column not in existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} TEXT")
    conn.execute(f"PRAGMA user_version={SCHEMA_VERSION}")
    conn.commit()


def open_db(db_path: Path | str) -> sqlite3.Connection:
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    conn = get_connection(db_path)
    try:
        init_db(conn)
    except BaseException:
        conn.close()
        raise
    return conn


def new_conversation_key() -> str:
    """A key for a send made outside the app, which has no outreach thread id."""
    return f"adhoc-{uuid.uuid4().hex[:16]}"


# ==========================================
# CONVERSATIONS
# ==========================================


def get_conversation(
    conn: sqlite3.Connection, conversation_key: str, account: str
) -> sqlite3.Row | None:
    row: sqlite3.Row | None = conn.execute(
        "SELECT * FROM conversations WHERE conversation_key = ? AND account = ?",
        (conversation_key, account),
    ).fetchone()
    return row


def upsert_conversation(
    conn: sqlite3.Connection,
    *,
    conversation_key: str,
    account: str,
    recipient: str,
    subject: str | None = None,
    label: str | None = None,
    channel_id: str | None = None,
) -> sqlite3.Row | None:
    """Creates the conversation row, or refreshes the fields a new send changes.

    Deliberately does NOT touch `gmail_thread_id`, `last_rfc_id` or
    `reply_seen_at`: those are owned by [record_send] and [record_replies], and
    a caller preparing to send must not be able to erase the thread it is about
    to reply into.
    """
    conn.execute(
        """
        INSERT INTO conversations
            (conversation_key, account, recipient, subject, label, channel_id,
             first_sent_at)
        VALUES (?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(conversation_key, account) DO UPDATE SET
            recipient  = excluded.recipient,
            subject    = COALESCE(excluded.subject, conversations.subject),
            label      = COALESCE(excluded.label, conversations.label),
            channel_id = COALESCE(excluded.channel_id, conversations.channel_id)
        """,
        (conversation_key, account, recipient, subject, label, channel_id),
    )
    conn.commit()
    return get_conversation(conn, conversation_key, account)


def record_send(
    conn: sqlite3.Connection,
    *,
    conversation_key: str,
    account: str,
    result: Mapping[str, Any],
    recipient: str,
    subject: str | None,
    body: str | None,
    step_no: int = 0,
    send_key: str | None = None,
    approved_by: str | None = None,
) -> str:
    """Files a sent message and advances the conversation's threading state.

    [result] is what `GmailClient.send` returned. One transaction, because a
    sent message whose thread id did not get recorded is a message the next
    follow-up cannot reply to -- and, with [send_key], because a key left
    `claimed` after its message was filed would make a retry of a message that
    went out look like one that might not have.
    """
    stamp = now()
    if send_key:
        conn.execute(
            "UPDATE send_keys SET state = ?, gmail_message_id = ?, sent_at = ?  WHERE send_key = ?",
            (SEND_KEY_SENT, result.get("messageId"), stamp, send_key),
        )
    conn.execute(
        """
        INSERT OR REPLACE INTO sent_messages
            (gmail_message_id, conversation_key, account, gmail_thread_id,
             rfc_message_id, step_no, recipient, subject, body, sent_at,
             approved_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            result.get("messageId"),
            conversation_key,
            account,
            result.get("threadId"),
            result.get("rfcMessageId"),
            step_no,
            recipient,
            subject,
            body,
            stamp,
            approved_by,
        ),
    )
    conn.execute(
        """
        UPDATE conversations
           SET gmail_thread_id = COALESCE(?, gmail_thread_id),
               last_rfc_id     = COALESCE(?, last_rfc_id),
               subject         = COALESCE(subject, ?),
               first_sent_at   = COALESCE(first_sent_at, ?),
               last_sent_at    = ?
         WHERE conversation_key = ? AND account = ?
        """,
        (
            result.get("threadId"),
            result.get("rfcMessageId"),
            subject,
            stamp,
            stamp,
            conversation_key,
            account,
        ),
    )
    conn.commit()
    return stamp


# ==========================================
# SEND KEYS (the same message never goes twice)
# ==========================================


def claim_send_key(
    conn: sqlite3.Connection,
    send_key: str,
    *,
    account: str,
    conversation_key: str,
    approved_by: str | None = None,
) -> sqlite3.Row | None:
    """Claims [send_key] for a send about to happen.

    Returns None when the claim is new -- go ahead and send. Otherwise returns
    the existing row: state "sent" means the message already went out (its
    `gmail_message_id` says which), "claimed" means an earlier attempt never
    reported back and nobody knows whether Gmail got it.
    """
    cursor = conn.execute(
        "INSERT OR IGNORE INTO send_keys "
        "    (send_key, account, conversation_key, state, claimed_at, approved_by) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (send_key, account, conversation_key, SEND_KEY_CLAIMED, now(), approved_by),
    )
    conn.commit()
    if cursor.rowcount == 1:
        return None
    row: sqlite3.Row | None = conn.execute(
        "SELECT * FROM send_keys WHERE send_key = ?", (send_key,)
    ).fetchone()
    return row


def release_send_key(conn: sqlite3.Connection, send_key: str) -> None:
    """Gives a claim back after Gmail refused the send outright, so a retry
    with the same key is allowed. A key that reached "sent" is never released.
    """
    conn.execute(
        "DELETE FROM send_keys WHERE send_key = ? AND state = ?",
        (send_key, SEND_KEY_CLAIMED),
    )
    conn.commit()


def sent_message(conn: sqlite3.Connection, gmail_message_id: str) -> sqlite3.Row | None:
    row: sqlite3.Row | None = conn.execute(
        "SELECT * FROM sent_messages WHERE gmail_message_id = ?",
        (gmail_message_id,),
    ).fetchone()
    return row


def close_conversation(conn: sqlite3.Connection, conversation_key: str, account: str) -> None:
    conn.execute(
        "UPDATE conversations SET closed_at = ? "
        " WHERE conversation_key = ? AND account = ? AND closed_at IS NULL",
        (now(), conversation_key, account),
    )
    conn.commit()


def open_conversations(
    conn: sqlite3.Connection, account: str, *, limit: int | None = None
) -> list[sqlite3.Row]:
    """Conversations worth asking Gmail about.

    A conversation drops out of this list once a reply has been seen or it has
    been closed -- polling a finished conversation costs an API call per sweep
    and can only ever return what it returned last time.
    """
    sql = (
        "SELECT * FROM conversations "
        " WHERE account = ? AND gmail_thread_id IS NOT NULL "
        "   AND reply_seen_at IS NULL AND closed_at IS NULL "
        " ORDER BY last_sent_at ASC"
    )
    params: Params = [account]
    if limit:
        sql += " LIMIT ?"
        params.append(int(limit))
    return conn.execute(sql, params).fetchall()


def sent_message_ids(conn: sqlite3.Connection, conversation_key: str, account: str) -> set[str]:
    """Our own message ids in this conversation, so replies exclude them.

    Belt and braces next to `GmailClient.replies`, which already filters by
    sender address. This catches the case that filter cannot: a message sent
    from this mailbox by an ALIAS, whose From is a different address and which
    would otherwise be reported to the app as a reply from the influencer.
    """
    rows = conn.execute(
        "SELECT gmail_message_id FROM sent_messages WHERE conversation_key = ? AND account = ?",
        (conversation_key, account),
    ).fetchall()
    return {str(row["gmail_message_id"]) for row in rows}


def last_sent(conn: sqlite3.Connection, conversation_key: str, account: str) -> sqlite3.Row | None:
    """The most recent outbound message, for quoting in a follow-up."""
    row: sqlite3.Row | None = conn.execute(
        "SELECT * FROM sent_messages "
        " WHERE conversation_key = ? AND account = ? "
        " ORDER BY sent_at DESC, step_no DESC LIMIT 1",
        (conversation_key, account),
    ).fetchone()
    return row


# ==========================================
# THE FOLLOW-UP SEQUENCE (only an old file holds any; the sweep cancels them)
# ==========================================


def queue_steps(
    conn: sqlite3.Connection,
    *,
    conversation_key: str,
    account: str,
    steps: Iterable[Mapping[str, Any]],
    base_step_no: int = 0,
) -> list[sqlite3.Row]:
    """Queues follow-ups. [steps] is `[{"dueAt": iso, "subject": s, "body": b}]`.

    Returns the queued rows. Step numbers continue from whatever the
    conversation already has, so arming a second sequence on a conversation
    that already sent one does not collide with it.
    """
    created: list[str] = []
    stamp = now()
    step_no = base_step_no
    for step in steps:
        body = (step.get("body") or "").strip()
        if not body:
            continue
        step_no += 1
        row_id = uuid.uuid4().hex
        conn.execute(
            """
            INSERT INTO sequence_steps
                (id, conversation_key, account, step_no, due_at, subject, body,
                 state, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                row_id,
                conversation_key,
                account,
                step_no,
                step.get("dueAt") or stamp,
                step.get("subject"),
                body,
                STATE_PENDING,
                stamp,
            ),
        )
        created.append(row_id)
    conn.commit()
    if not created:
        return []
    placeholders = ",".join("?" for _ in created)
    return conn.execute(
        f"SELECT * FROM sequence_steps WHERE id IN ({placeholders}) ORDER BY step_no",  # noqa: S608 (only "?" placeholders)
        created,
    ).fetchall()


def highest_step_no(conn: sqlite3.Connection, conversation_key: str, account: str) -> int:
    row = conn.execute(
        "SELECT MAX(step_no) AS n FROM sequence_steps WHERE conversation_key = ? AND account = ?",
        (conversation_key, account),
    ).fetchone()
    return int(row["n"] or 0)


def due_steps(
    conn: sqlite3.Connection,
    account: str,
    *,
    at: str | None = None,
    limit: int | None = None,
) -> list[sqlite3.Row]:
    """Pending steps that are due, on conversations that have not replied.

    The reply check is a join rather than something the caller remembers to do,
    because this query is the only route by which a follow-up is ever sent. A
    conversation with `reply_seen_at` set can therefore never produce another
    send -- which is the interrupt, expressed as the one thing it has to be
    true of.
    """
    sql = (
        "SELECT s.* FROM sequence_steps s "
        "  JOIN conversations c "
        "    ON c.conversation_key = s.conversation_key "
        "   AND c.account = s.account "
        " WHERE s.account = ? AND s.state = ? AND s.due_at <= ? "
        "   AND c.reply_seen_at IS NULL AND c.closed_at IS NULL "
        " ORDER BY s.due_at ASC, s.step_no ASC"
    )
    params: Params = [account, STATE_PENDING, at or now()]
    if limit:
        sql += " LIMIT ?"
        params.append(int(limit))
    return conn.execute(sql, params).fetchall()


def pending_steps(
    conn: sqlite3.Connection, account: str, *, conversation_key: str | None = None
) -> list[sqlite3.Row]:
    sql = "SELECT * FROM sequence_steps WHERE account = ? AND state = ?"
    params: Params = [account, STATE_PENDING]
    if conversation_key:
        sql += " AND conversation_key = ?"
        params.append(conversation_key)
    sql += " ORDER BY due_at ASC, step_no ASC"
    return conn.execute(sql, params).fetchall()


def mark_step_sent(conn: sqlite3.Connection, step_id: str, gmail_message_id: str) -> None:
    conn.execute(
        "UPDATE sequence_steps "
        "   SET state = ?, gmail_message_id = ?, resolved_at = ?, "
        "       last_error = NULL "
        " WHERE id = ?",
        (STATE_SENT, gmail_message_id, now(), step_id),
    )
    conn.commit()


def mark_step_failed(conn: sqlite3.Connection, step_id: str, error: object) -> bool:
    """Records an attempt, and gives up permanently at [MAX_STEP_ATTEMPTS].

    A transient failure leaves the step pending; a step that has exhausted its
    attempts is marked failed and reported once, rather than retried forever in
    silence.
    """
    row = conn.execute("SELECT attempts FROM sequence_steps WHERE id = ?", (step_id,)).fetchone()
    attempts = int(row["attempts"] if row else 0) + 1
    exhausted = attempts >= MAX_STEP_ATTEMPTS
    conn.execute(
        "UPDATE sequence_steps "
        "   SET attempts = ?, last_error = ?, state = ?, resolved_at = ? "
        " WHERE id = ?",
        (
            attempts,
            str(error)[:500],
            STATE_FAILED if exhausted else STATE_PENDING,
            now() if exhausted else None,
            step_id,
        ),
    )
    conn.commit()
    return exhausted


def cancel_steps(
    conn: sqlite3.Connection, conversation_key: str, account: str, *, reason: str = "replied"
) -> int:
    """Cancels every pending step on a conversation. Returns how many.

    Called when a reply lands. [due_steps] already refuses to return steps on a
    replied conversation, so this is not what makes the interrupt correct -- it
    is what makes it *visible*, so the app can say "2 follow-ups cancelled"
    rather than leaving rows that look pending forever.
    """
    cursor = conn.execute(
        "UPDATE sequence_steps "
        "   SET state = ?, resolved_at = ?, last_error = ? "
        " WHERE conversation_key = ? AND account = ? AND state = ?",
        (STATE_CANCELLED, now(), reason, conversation_key, account, STATE_PENDING),
    )
    conn.commit()
    return cursor.rowcount or 0


# ==========================================
# REPLIES
# ==========================================


def record_replies(
    conn: sqlite3.Connection,
    conversation_key: str,
    account: str,
    replies: list[Mapping[str, Any]],
) -> list[sqlite3.Row]:
    """Stores newly seen replies and stamps the conversation as replied.

    Returns the rows that were genuinely new. `INSERT OR IGNORE` on the Gmail
    message id is what makes this idempotent: a sweep that runs twice against
    the same thread reports the reply once, because the second insert does
    nothing and the row already carries a `reported_at`.
    """
    fresh: list[str] = []
    stamp = now()
    for reply in replies:
        message_id = reply.get("messageId")
        if not message_id:
            continue
        cursor = conn.execute(
            """
            INSERT OR IGNORE INTO inbound_messages
                (gmail_message_id, conversation_key, account, from_address,
                 from_name, subject, body, received_at, seen_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                message_id,
                conversation_key,
                account,
                reply.get("from"),
                reply.get("fromName"),
                reply.get("subject"),
                reply.get("body"),
                _iso_from_millis(reply.get("at")),
                stamp,
            ),
        )
        if cursor.rowcount:
            fresh.append(str(message_id))

    if replies:
        first = replies[0]
        conn.execute(
            "UPDATE conversations "
            "   SET reply_seen_at = COALESCE(reply_seen_at, ?), "
            "       replied_from  = COALESCE(replied_from, ?) "
            " WHERE conversation_key = ? AND account = ?",
            (stamp, first.get("from"), conversation_key, account),
        )
    conn.commit()

    if not fresh:
        return []
    placeholders = ",".join("?" for _ in fresh)
    return conn.execute(
        f"SELECT * FROM inbound_messages WHERE gmail_message_id IN ({placeholders})"  # noqa: S608
        " ORDER BY received_at",
        fresh,
    ).fetchall()


def unreported_replies(
    conn: sqlite3.Connection, account: str, *, conversation_key: str | None = None
) -> list[sqlite3.Row]:
    sql = "SELECT * FROM inbound_messages WHERE account = ? AND reported_at IS NULL"
    params: Params = [account]
    if conversation_key:
        sql += " AND conversation_key = ?"
        params.append(conversation_key)
    sql += " ORDER BY received_at ASC"
    return conn.execute(sql, params).fetchall()


def mark_reported(conn: sqlite3.Connection, message_ids: Iterable[str | None]) -> int:
    """Advances the app's read cursor over [message_ids].

    Separate from [record_replies] on purpose. The app has to *act* on a reply
    -- log it in the CRM, move the channel to interested -- and if that fails
    halfway the reply must still be waiting on the next poll. So the stamp is
    set only after the reply was handed over (`mail.ack`).
    """
    ids = [i for i in message_ids if i]
    if not ids:
        return 0
    placeholders = ",".join("?" for _ in ids)
    cursor = conn.execute(
        f"UPDATE inbound_messages SET reported_at = ? "  # noqa: S608
        f" WHERE gmail_message_id IN ({placeholders}) AND reported_at IS NULL",
        [now(), *ids],
    )
    conn.commit()
    return cursor.rowcount or 0


def reply_count(conn: sqlite3.Connection, conversation_key: str, account: str) -> int:
    row = conn.execute(
        "SELECT COUNT(*) AS n FROM inbound_messages WHERE conversation_key = ? AND account = ?",
        (conversation_key, account),
    ).fetchone()
    return int(row["n"] or 0)


# ==========================================
# REPORTING
# ==========================================


def cold_sent_since(conn: sqlite3.Connection, account: str, since: str) -> int:
    """How many messages [account] has sent since [since] to people who had not
    written back -- first emails and follow-ups, the cold email a daily cap is
    about (house choice HC-02). A message sent after the other side answered is
    a reply, and replies are never counted.

    Timestamps are compared as text, which works because every stamp here is
    `now()`'s fixed-width UTC ISO form.
    """
    row = conn.execute(
        """
        SELECT COUNT(*) FROM sent_messages s
          LEFT JOIN conversations c
            ON c.conversation_key = s.conversation_key AND c.account = s.account
         WHERE s.account = ? AND s.sent_at >= ?
           AND (c.reply_seen_at IS NULL OR s.sent_at < c.reply_seen_at)
        """,
        (account, since),
    ).fetchone()
    return int(row[0] or 0)


def counters(conn: sqlite3.Connection, account: str) -> dict[str, int]:
    """The numbers `mail.status` shows."""

    def scalar(sql: str, params: tuple[Any, ...] = ()) -> int:
        row = conn.execute(sql, params).fetchone()
        return int(row[0] or 0)

    return {
        "conversations": scalar("SELECT COUNT(*) FROM conversations WHERE account = ?", (account,)),
        "sent": scalar("SELECT COUNT(*) FROM sent_messages WHERE account = ?", (account,)),
        "awaitingReply": scalar(
            "SELECT COUNT(*) FROM conversations "
            " WHERE account = ? AND reply_seen_at IS NULL AND closed_at IS NULL "
            "   AND gmail_thread_id IS NOT NULL",
            (account,),
        ),
        "replied": scalar(
            "SELECT COUNT(*) FROM conversations WHERE account = ? AND reply_seen_at IS NOT NULL",
            (account,),
        ),
        "pendingSteps": scalar(
            "SELECT COUNT(*) FROM sequence_steps WHERE account = ? AND state = ?",
            (account, STATE_PENDING),
        ),
        "dueSteps": len(due_steps(conn, account)),
        "failedSteps": scalar(
            "SELECT COUNT(*) FROM sequence_steps WHERE account = ? AND state = ?",
            (account, STATE_FAILED),
        ),
        "unreportedReplies": scalar(
            "SELECT COUNT(*) FROM inbound_messages WHERE account = ? AND reported_at IS NULL",
            (account,),
        ),
    }


def get_state(conn: sqlite3.Connection, key: str, default: str | None = None) -> str | None:
    row = conn.execute("SELECT value FROM mailbox_state WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def set_state(conn: sqlite3.Connection, key: str, value: str | None) -> None:
    conn.execute(
        "INSERT INTO mailbox_state (key, value) VALUES (?, ?) "
        " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )
    conn.commit()


def _iso_from_millis(millis: object) -> str | None:
    if not millis:
        return None
    try:
        return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(int(millis) / 1000.0))  # type: ignore[arg-type]
    except TypeError, ValueError, OSError, OverflowError:
        return None
