"""Nothing leaves the mailbox without a person's click (owner decision, plan step 1; D17).

Older builds armed follow-ups behind every Gmail send and swept them out on a schedule. Now
`mail.replies` only looks for replies: a follow-up still queued in an old `mailbox.db` is
cancelled, never sent, and `mail.send` queues none. The last test spies on every mail job and
proves that only `mail.send` ever asks Gmail to send, and then exactly once.
"""

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from test_mail_jobs import (
    ACCOUNT,
    KEY,
    REFRESH_TOKENS,
    Check,
    FakeConnect,
    FakeGmailClient,
    Mailroom,
    connect_to,
    reply,
)

from gratovo_pipeline.mail import mailbox


@pytest.fixture
def room(tmp_path: Path, check_from_pipeline: Check) -> Iterator[Mailroom]:
    mailroom = Mailroom(tmp_path / "mail", check_from_pipeline)
    yield mailroom
    mailroom.conn.close()


def test_the_sweep_never_sends_a_queued_follow_up(room: Mailroom) -> None:
    room.open_conversation()
    room.queue(count=2)  # due long ago, no reply: older builds sent these
    client = FakeGmailClient()

    ran = room.sweep(connect_to(client))

    assert ran.state == "done"
    assert client.sends == [], "nothing is sent without a click"
    assert ran.data["accounts"][0]["cancelledQueued"] == 2
    assert mailbox.pending_steps(room.conn, ACCOUNT) == []
    states = room.conn.execute("SELECT DISTINCT state FROM sequence_steps").fetchall()
    assert [row["state"] for row in states] == [mailbox.STATE_CANCELLED]


def test_the_sweep_still_reports_replies(room: Mailroom) -> None:
    room.open_conversation()
    client = FakeGmailClient(thread_replies={"t1": [reply()]})

    ran = room.sweep(connect_to(client))

    (line,) = ran.replies
    assert line["conversationKey"] == KEY
    assert client.sends == []


def test_a_send_queues_no_follow_ups(room: Mailroom) -> None:
    client = FakeGmailClient()

    ran = room.send(connect_to(client))

    assert ran.state == "done"
    assert len(client.sends) == 1
    assert mailbox.pending_steps(room.conn, ACCOUNT) == []
    assert room.conn.execute("SELECT COUNT(*) FROM sequence_steps").fetchone()[0] == 0


class Spy(FakeConnect):
    """Hands out one client and counts every connection made."""

    def __init__(self, client: FakeGmailClient) -> None:
        super().__init__({REFRESH_TOKENS[ACCOUNT]: client})


JOBS: list[dict[str, Any]] = [
    {"kind": "mail.status"},
    {"kind": "mail.replies"},
    {"kind": "mail.ack", "messageIds": ["r1"]},
    {"kind": "mail.cancel", "conversationKey": "thread-other"},
    {
        "kind": "mail.send",
        "message": {
            "conversationKey": "thread-new",
            "to": "creator@example.com",
            "subject": "Collaboration",
            "body": "Hello there.",
            "sendKey": "sk-00001",
            "approvedBy": "Mona",
        },
    },
]


def test_only_mail_send_ever_sends_and_only_once(room: Mailroom) -> None:
    # A store with everything an older build could leave: a conversation with a reply waiting,
    # one with follow-ups due long ago, and another conversation to cancel.
    room.open_conversation()
    room.open_conversation(
        key="thread-due", recipient="b@example.com", thread="t2", message_id="m9"
    )
    room.queue(key="thread-due", count=3)
    room.open_conversation(
        key="thread-other", recipient="c@example.com", thread="t3", message_id="m8"
    )
    room.queue(key="thread-other", count=1)

    sends: dict[str, int] = {}
    connections: dict[str, int] = {}
    for job in JOBS:
        client = FakeGmailClient(thread_replies={"t1": [reply()]})
        spy = Spy(client)
        ran = room.run(job, spy)
        assert ran.state == "done", job["kind"]
        sends[job["kind"]] = len(client.sends)
        connections[job["kind"]] = len(spy.calls)

    assert sends == {
        "mail.status": 0,
        "mail.replies": 0,
        "mail.ack": 0,
        "mail.cancel": 0,
        "mail.send": 1,
    }
    assert connections["mail.ack"] == 0, "the store-only jobs make no request"
    assert connections["mail.cancel"] == 0
    assert mailbox.pending_steps(room.conn, ACCOUNT) == []
