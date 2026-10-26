"""mail.import (plan step 6e, D19): the old app's mailbox.db merged into this one's.

The old file is a real SQLite file made with the old app's tables and columns (no `approved_by`,
no `checked_at`, `user_version` 0), in a folder of its own outside the app's data folder. The job
is driven through `jobs.mail.run` as the app drives it, every line checked against the schema,
with a `connect` that fails the test if the job ever asks for Gmail.
"""

import sqlite3
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from test_mail_jobs import ACCOUNT, Check, Mailroom, Ran, Refuse, sent_result

from gratovo_pipeline.mail import mailbox

OLD_RECIPIENT = "creator@aitoolsweekly.example"
OLD_BODY = "An old body about our AI note-taking tool that must stay out of every line."


def ago(days: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - days * 86_400))


# --- the old file ---


def old_schema() -> str:
    """The old app's tables: today's schema is theirs, less the columns added since."""
    return mailbox.SCHEMA


class OldMailbox:
    """The old app's mailbox.db, filled row by row as it would have been."""

    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self.conn = sqlite3.connect(path)
        self.conn.executescript(old_schema())

    def conversation(
        self,
        key: str,
        *,
        last_sent: str | None,
        reply_seen: str | None = None,
        closed: str | None = None,
        subject: str = "Your AI tools roundup",
    ) -> None:
        self.conn.execute(
            "INSERT INTO conversations (conversation_key, account, gmail_thread_id, channel_id,"
            " recipient, subject, label, last_rfc_id, first_sent_at, last_sent_at, reply_seen_at,"
            " replied_from, closed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                key,
                ACCOUNT,
                f"t-{key}",
                "UC123",
                OLD_RECIPIENT,
                subject,
                "Gratovo Outreach",
                f"<rfc-{key}@mail>",
                last_sent,
                last_sent,
                reply_seen,
                OLD_RECIPIENT if reply_seen else None,
                closed,
            ),
        )

    def sent(self, message_id: str, key: str, *, body: str = OLD_BODY) -> None:
        self.conn.execute(
            "INSERT INTO sent_messages (gmail_message_id, conversation_key, account,"
            " gmail_thread_id, rfc_message_id, step_no, recipient, subject, body, sent_at)"
            " VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)",
            (
                message_id,
                key,
                ACCOUNT,
                f"t-{key}",
                "<rfc@mail>",
                OLD_RECIPIENT,
                "Hi",
                body,
                ago(90),
            ),
        )

    def inbound(self, message_id: str, key: str, *, reported: str | None) -> None:
        self.conn.execute(
            "INSERT INTO inbound_messages (gmail_message_id, conversation_key, account,"
            " from_address, from_name, subject, body, received_at, seen_at, reported_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                message_id,
                key,
                ACCOUNT,
                OLD_RECIPIENT,
                "A Creator",
                "Re: Hi",
                OLD_BODY,
                ago(80),
                ago(80),
                reported,
            ),
        )

    def send_key(self, send_key: str, key: str, message_id: str) -> None:
        self.conn.execute(
            "INSERT INTO send_keys (send_key, account, conversation_key, state, gmail_message_id,"
            " claimed_at, sent_at) VALUES (?, ?, ?, 'sent', ?, ?, ?)",
            (send_key, ACCOUNT, key, message_id, ago(90), ago(90)),
        )

    def follow_up(self, step_id: str, key: str) -> None:
        self.conn.execute(
            "INSERT INTO sequence_steps (id, conversation_key, account, step_no, due_at, subject,"
            " body, state, created_at) VALUES (?, ?, ?, 1, ?, 'Hi', ?, 'pending', ?)",
            (step_id, key, ACCOUNT, ago(80), OLD_BODY, ago(90)),
        )

    def close(self) -> None:
        self.conn.commit()
        self.conn.close()


def filled(path: Path) -> Path:
    """An old file with one conversation of each kind the rules tell apart:

    - `recent`: last email 10 days ago, no reply: stays open.
    - `stale`: last email 90 days ago, no reply: closed.
    - `replied`: last email 90 days ago, with a reply: stays open (the sweep's own rules skip it).
    - `never`: never sent: closed.
    - `done`: already closed in the old app: left as it was, not counted.
    """
    old = OldMailbox(path)
    old.conversation("recent", last_sent=ago(10))
    old.conversation("stale", last_sent=ago(90))
    old.conversation("replied", last_sent=ago(90), reply_seen=ago(80))
    old.conversation("never", last_sent=None)
    old.conversation("done", last_sent=ago(200), closed=ago(150))
    for n, key in enumerate(("recent", "stale", "replied", "done"), start=1):
        old.sent(f"m{n}", key)
    old.inbound("r-new", "replied", reported=None)
    old.inbound("r-old", "replied", reported=ago(79))
    old.send_key("sk-old-00001", "recent", "m1")
    old.follow_up("step-1", "stale")
    old.follow_up("step-2", "recent")
    old.close()
    return path


# --- running it ---


class ImportRoom(Mailroom):
    """A data folder inside the app's own (as main gives it) and a separate old app's folder."""

    def __init__(self, tmp_path: Path, check: Check) -> None:
        super().__init__(tmp_path / "userData" / "data", check)
        self.old_dir = tmp_path / "old app" / "data"
        self.old_path = self.old_dir / "mailbox.db"
        self.refuse = Refuse()

    def merge(self, source: Path | None = None) -> Ran:
        job = {"kind": "mail.import", "source": str(source or self.old_path)}
        ran = self.run(job, self.refuse, mailboxes=None)
        assert not self.refuse.called, "the import makes no request"
        return ran

    def column(self, sql: str, *params: Any) -> list[Any]:
        return [row[0] for row in self.conn.execute(sql, params).fetchall()]

    def conversation(self, key: str) -> sqlite3.Row:
        row = mailbox.get_conversation(self.conn, key, ACCOUNT)
        assert row is not None
        return row


@pytest.fixture
def room(tmp_path: Path, check_from_pipeline: Check) -> Iterator[ImportRoom]:
    mailroom = ImportRoom(tmp_path, check_from_pipeline)
    yield mailroom
    mailroom.conn.close()


# --- the merge ---


def test_an_old_mailbox_merges_into_an_empty_one(room: ImportRoom) -> None:
    filled(room.old_path)

    ran = room.merge()

    assert ran.state == "done"
    assert ran.data == {"conversations": 5, "sent": 4, "inbound": 2, "closed": 2}
    assert room.column("SELECT COUNT(*) FROM send_keys") == [1]
    # The added columns come in empty: the old app didn't have them.
    assert room.column("SELECT DISTINCT approved_by FROM sent_messages") == [None]
    assert room.conversation("recent")["recipient"] == OLD_RECIPIENT
    assert room.conversation("recent")["gmail_thread_id"] == "t-recent"


def test_every_added_conversation_is_checked_and_the_quiet_old_ones_are_closed(
    room: ImportRoom,
) -> None:
    filled(room.old_path)
    before = mailbox.now()

    room.merge()

    for key in ("recent", "stale", "replied", "never", "done"):
        assert room.conversation(key)["checked_at"] >= before, key
    for key in ("stale", "never"):
        assert room.conversation(key)["closed_at"] >= before, key
    for key in ("recent", "replied"):
        assert room.conversation(key)["closed_at"] is None, key
    # Closed in the old app: its own stamp is kept.
    assert room.conversation("done")["closed_at"] < before


def test_old_follow_ups_never_come_in(room: ImportRoom) -> None:
    filled(room.old_path)

    room.merge()

    assert room.column("SELECT COUNT(*) FROM sequence_steps") == [0]
    assert mailbox.pending_steps(room.conn, ACCOUNT) == []
    assert mailbox.due_steps(room.conn, ACCOUNT) == []


def test_replies_keep_their_reported_stamp(room: ImportRoom) -> None:
    filled(room.old_path)

    room.merge()

    unreported = mailbox.unreported_replies(room.conn, ACCOUNT)
    assert [row["gmail_message_id"] for row in unreported] == ["r-new"]
    assert room.column(
        "SELECT reported_at IS NOT NULL FROM inbound_messages WHERE gmail_message_id = 'r-old'"
    ) == [1]


def test_rows_already_here_win(room: ImportRoom) -> None:
    # This app already talks to `recent`, with message m1 of its own.
    mailbox.upsert_conversation(
        room.conn,
        conversation_key="recent",
        account=ACCOUNT,
        recipient="new@aitoolsweekly.example",
        subject="Our own subject",
    )
    mailbox.record_send(
        room.conn,
        conversation_key="recent",
        account=ACCOUNT,
        result=sent_result("m1", "t-ours"),
        recipient="new@aitoolsweekly.example",
        subject="Our own subject",
        body="Our own body.",
        approved_by="Mona",
    )
    ours = dict(room.conversation("recent"))
    filled(room.old_path)

    ran = room.merge()

    assert ran.data == {"conversations": 4, "sent": 3, "inbound": 2, "closed": 2}
    assert dict(room.conversation("recent")) == ours, "a conversation already here is unchanged"
    assert room.column("SELECT body FROM sent_messages WHERE gmail_message_id = 'm1'") == [
        "Our own body."
    ]


def test_a_second_run_adds_nothing(room: ImportRoom) -> None:
    filled(room.old_path)
    room.merge()
    counts = room.column(
        "SELECT (SELECT COUNT(*) FROM conversations) + (SELECT COUNT(*) FROM sent_messages)"
        " + (SELECT COUNT(*) FROM inbound_messages) + (SELECT COUNT(*) FROM send_keys)"
    )

    again = room.merge()

    assert again.data == {"conversations": 0, "sent": 0, "inbound": 0, "closed": 0}
    assert (
        room.column(
            "SELECT (SELECT COUNT(*) FROM conversations) + (SELECT COUNT(*) FROM sent_messages)"
            " + (SELECT COUNT(*) FROM inbound_messages) + (SELECT COUNT(*) FROM send_keys)"
        )
        == counts
    )


def test_the_sweep_still_asks_about_this_app_s_conversations_first(room: ImportRoom) -> None:
    """A review finding: never-checked conversations go first, 60 a sweep, so a few hundred old
    ones without a stamp would hold the front of the queue for days."""
    old = OldMailbox(room.old_path)
    for n in range(100):
        old.conversation(f"old-{n:03d}", last_sent=ago(5))
    old.close()
    mailbox.upsert_conversation(
        room.conn, conversation_key="ours", account=ACCOUNT, recipient="new@aitoolsweekly.example"
    )
    mailbox.record_send(
        room.conn,
        conversation_key="ours",
        account=ACCOUNT,
        result=sent_result("m-ours", "t-ours"),
        recipient="new@aitoolsweekly.example",
        subject="Hi",
        body="Hello.",
    )

    room.merge()

    first = mailbox.open_conversations(room.conn, ACCOUNT, limit=60)
    assert first[0]["conversation_key"] == "ours"


def test_an_old_file_without_the_other_tables_brings_its_conversations(room: ImportRoom) -> None:
    room.old_dir.mkdir(parents=True)
    conn = sqlite3.connect(room.old_path)
    conn.execute(
        "CREATE TABLE conversations (conversation_key TEXT NOT NULL, account TEXT NOT NULL,"
        " recipient TEXT, last_sent_at TEXT, PRIMARY KEY (conversation_key, account))"
    )
    conn.execute(
        "INSERT INTO conversations VALUES ('a', ?, ?, ?), ('b', ?, NULL, ?)",
        (ACCOUNT, OLD_RECIPIENT, ago(3), ACCOUNT, ago(3)),
    )
    conn.commit()
    conn.close()

    ran = room.merge()

    # `b` has no recipient, which this table requires: it is left out, not a failure.
    assert ran.data == {"conversations": 1, "sent": 0, "inbound": 0, "closed": 0}


# --- the old file is never touched ---


def test_the_old_file_is_unchanged_and_gets_nothing_beside_it(room: ImportRoom) -> None:
    filled(room.old_path)
    before = room.old_path.read_bytes()

    room.merge()

    assert room.old_path.read_bytes() == before
    assert sorted(p.name for p in room.old_dir.iterdir()) == ["mailbox.db"]


def test_no_line_carries_an_address_or_a_body(room: ImportRoom) -> None:
    filled(room.old_path)

    room.merge()
    room.merge()

    assert OLD_RECIPIENT not in room.out
    assert OLD_BODY not in room.out


# --- refusals ---


def test_a_file_that_is_not_sqlite_is_refused(room: ImportRoom) -> None:
    room.old_dir.mkdir(parents=True)
    room.old_path.write_text("not a database at all, just some notes about AI tools")

    ran = room.merge()

    assert (ran.state, ran.code) == ("failed", "not_sqlite")


def test_a_database_without_conversations_is_refused(room: ImportRoom) -> None:
    room.old_dir.mkdir(parents=True)
    conn = sqlite3.connect(room.old_path)
    conn.execute("CREATE TABLE channels (channel_id TEXT PRIMARY KEY)")
    conn.commit()
    conn.close()

    ran = room.merge()

    assert (ran.state, ran.code) == ("failed", "no_conversations_table")
    assert room.column("SELECT COUNT(*) FROM conversations") == [0]


def test_a_mailbox_from_a_newer_app_is_refused(room: ImportRoom) -> None:
    filled(room.old_path)
    conn = sqlite3.connect(room.old_path)
    conn.execute(f"PRAGMA user_version={mailbox.SCHEMA_VERSION + 1}")
    conn.commit()
    conn.close()

    ran = room.merge()

    assert (ran.state, ran.code) == ("failed", "source_too_new")
    assert room.column("SELECT COUNT(*) FROM conversations") == [0]


def test_a_missing_file_is_unreadable(room: ImportRoom) -> None:
    ran = room.merge(room.old_dir / "nowhere.db")

    assert (ran.state, ran.code) == ("failed", "source_unreadable")


def test_a_file_inside_the_app_s_data_folder_is_refused(room: ImportRoom) -> None:
    # This app's own mailbox.db is the obvious one: merging it into itself.
    ran = room.merge(room.data_dir / "mailbox.db")

    assert (ran.state, ran.code) == ("failed", "source_in_data_dir")


def test_an_old_file_with_unfinished_writes_beside_it_is_refused(room: ImportRoom) -> None:
    filled(room.old_path)
    (room.old_dir / "mailbox.db-wal").write_bytes(b"\x00" * 32)

    ran = room.merge()

    assert (ran.state, ran.code) == ("failed", "old_app_open")
