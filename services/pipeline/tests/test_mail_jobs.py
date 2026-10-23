"""The mail jobs (plan D17), ported from the old `tools/email_send.py` tests (ToolSweepTest,
SendKeyTest, DailyCapTest) and driven through `jobs.mail.run` as the app drives them.

No network and no real mailbox: Gmail is a hand-written fake (as the old `FakeGmailClient`), and the
store is a real `mailbox.db` in a temporary folder, because the behaviour under test is mostly
what Gmail said and what the store then refuses to do. Every line a job writes is checked against
`protocol.schema.json`.
"""

import copy
import io
import json
from collections.abc import Callable, Collection, Iterator, Mapping, Sequence
from pathlib import Path
from typing import Any

import pytest
from helpers import START

from gratovo_pipeline.jobs import mail as mail_job
from gratovo_pipeline.mail import gmail, mailbox
from gratovo_pipeline.protocol import Emitter, Settings, Start, parse_start

Check = Callable[[str], dict[str, Any]]

ACCOUNT = "outreach@gratovo.test"
OTHER = "deals@gratovo.test"
KEY = "thread-abc"
CLIENT_ID = "1234-fake.apps.googleusercontent.com"
CLIENT_SECRET = "GOCSPX-client-secret-NOT-REAL-7f3a"  # noqa: S105 - a fake
ACCESS_TOKEN = "ya29.access-token-NOT-REAL-91c2"  # noqa: S105 - a fake
REFRESH_TOKENS = {
    ACCOUNT: "1//refresh-token-NOT-REAL-outreach",
    OTHER: "1//refresh-token-NOT-REAL-deals",
}
SECRETS = (CLIENT_SECRET, ACCESS_TOKEN, *REFRESH_TOKENS.values())


# --- the fakes ---


def sent_result(
    message_id: str = "m1", thread_id: str = "t1", rfc: str = "<rfc-1@mail>"
) -> gmail.SendResult:
    """What `GmailClient.send` returns, shaped exactly as the real one is."""
    return {
        "messageId": message_id,
        "threadId": thread_id,
        "rfcMessageId": rfc,
        "labelId": "Label_1",
    }


def reply(
    message_id: str = "r1",
    sender: str = "creator@example.com",
    at: int = 1_700_000_000_000,
    body: str = "Sounds interesting, which AI tools would the video cover?",
) -> gmail.Reply:
    return {
        "messageId": message_id,
        "from": sender,
        "fromName": "A Creator",
        "subject": "Re: Collaboration",
        "at": at,
        "body": body,
        "snippet": body[:40],
    }


class FakeGmailClient:
    """Just enough Gmail for the jobs: records what it was asked to send and answers thread reads
    from a script. It holds a fake access token, as the real client does, so a test can prove
    the token never reaches a line."""

    def __init__(
        self,
        *,
        address: str = ACCOUNT,
        thread_replies: dict[str, list[gmail.Reply]] | None = None,
        send_error: Exception | None = None,
    ) -> None:
        self.address = address
        self.thread_replies = thread_replies or {}
        self.send_error = send_error
        self.sends: list[dict[str, Any]] = []
        self.thread_reads: list[str] = []
        self.token = ACCESS_TOKEN
        self._counter = 0

    def send(
        self,
        *,
        to: str,
        subject: str,
        body: str,
        labels: Sequence[str] = (),
        thread_id: str | None = None,
        in_reply_to: str | None = None,
        references: Sequence[str] | None = None,
    ) -> gmail.SendResult:
        if self.send_error is not None:
            raise self.send_error
        self._counter += 1
        n = self._counter + 1
        self.sends.append(
            {
                "to": to,
                "subject": subject,
                "body": body,
                "labels": list(labels),
                "threadId": thread_id,
                "inReplyTo": in_reply_to,
                "references": references,
            }
        )
        return {
            "messageId": f"m{n}",
            "threadId": thread_id or f"t{n}",
            "rfcMessageId": f"<rfc-{n}@mail>",
            "labelId": "Label_1" if labels else None,
        }

    def replies(self, thread_id: str, *, exclude_ids: Collection[str] = ()) -> list[gmail.Reply]:
        self.thread_reads.append(thread_id)
        return [
            r for r in self.thread_replies.get(thread_id, []) if r["messageId"] not in exclude_ids
        ]


class FakeConnect:
    """`gmail.connect`'s shape: the client (or the error) for each refresh token."""

    def __init__(self, answers: Mapping[str, FakeGmailClient | Exception] | None = None) -> None:
        self.answers = dict(answers or {})
        self.calls: list[dict[str, Any]] = []

    def __call__(
        self,
        *,
        client_id: str,
        client_secret: str,
        refresh_token: str,
        sender_name: str | None = None,
    ) -> FakeGmailClient:
        self.calls.append(
            {"clientId": client_id, "refreshToken": refresh_token, "senderName": sender_name}
        )
        answer = self.answers.get(refresh_token)
        if answer is None:
            answer = FakeGmailClient(
                address=next(a for a, t in REFRESH_TOKENS.items() if t == refresh_token)
            )
            self.answers[refresh_token] = answer
        if isinstance(answer, Exception):
            raise answer
        return answer


def connect_to(client: FakeGmailClient, account: str = ACCOUNT) -> FakeConnect:
    return FakeConnect({REFRESH_TOKENS[account]: client})


class Refuse:
    """A `connect` that fails the test when called: the store-only jobs make no request."""

    def __init__(self) -> None:
        self.called = False

    def __call__(
        self,
        *,
        client_id: str,
        client_secret: str,
        refresh_token: str,
        sender_name: str | None = None,
    ) -> FakeGmailClient:
        self.called = True
        raise AssertionError("this job must make no request")


# --- running a job ---


class Ran:
    """What one job wrote, every line checked against the schema."""

    def __init__(self, lines: list[dict[str, Any]], text: str) -> None:
        self.lines = lines
        self.text = text
        assert lines, "a job always writes an end line"
        assert lines[-1]["type"] == "end"
        results = [line for line in lines if line["type"] == "result"]
        assert len(results) <= 1, "a result at most once"
        if results:
            assert lines[-2] is results[0], "the result comes right before end"
            assert lines[-1]["state"] == "done", "never a result on failed"

    @property
    def end(self) -> dict[str, Any]:
        return self.lines[-1]

    @property
    def state(self) -> str:
        return str(self.end["state"])

    @property
    def code(self) -> str | None:
        error = self.end.get("error")
        return None if error is None else str(error["code"])

    @property
    def message(self) -> str:
        return str(self.end["error"]["message"])

    @property
    def data(self) -> dict[str, Any]:
        (result,) = (line for line in self.lines if line["type"] == "result")
        return result["data"]

    @property
    def replies(self) -> list[dict[str, Any]]:
        return [line for line in self.lines if line["type"] == "reply"]

    @property
    def logs(self) -> list[dict[str, Any]]:
        return [line for line in self.lines if line["type"] == "log"]


class Mailroom:
    """A data folder with its mailbox.db, and a way to run a job on it."""

    def __init__(self, data_dir: Path, check: Check) -> None:
        self.data_dir = data_dir
        self.check = check
        self.conn = mailbox.open_db(data_dir / "mailbox.db")
        self.out = ""

    def start(
        self,
        job: dict[str, Any],
        *,
        mailboxes: Sequence[str] | None = (ACCOUNT,),
        caps: Mapping[str, int] | None = None,
        warmups: Mapping[str, str] | None = None,
        label: str | None = None,
        sender_name: str | None = None,
    ) -> Start:
        message: dict[str, Any] = copy.deepcopy(START)
        message["source"] = "live"
        message["dataDir"] = str(self.data_dir)
        message["job"] = job
        settings: dict[str, Any] = {}
        secrets: dict[str, Any] = {"youtubeKey": None, "proxyUrls": [], "gatewayUrls": []}
        message["settings"] = settings
        message["secrets"] = secrets
        if caps is not None or label is not None or sender_name is not None:
            settings["mail"] = {
                "label": label or "Gratovo Outreach",
                "senderName": sender_name,
                "mailboxes": [
                    {
                        "address": address,
                        "dailyCap": cap,
                        "warmupStartedOn": (warmups or {}).get(address),
                    }
                    for address, cap in (caps or {}).items()
                ],
            }
        if mailboxes is not None:
            secrets["mail"] = {
                "client": {"id": CLIENT_ID, "secret": CLIENT_SECRET},
                "mailboxes": [
                    {"address": address, "refreshToken": REFRESH_TOKENS[address.lower()]}
                    for address in mailboxes
                ],
            }
        return parse_start(json.dumps(message))

    def run(
        self,
        job: dict[str, Any],
        connect: mail_job.Connect | None = None,
        *,
        today_start: str | None = None,
        **start: Any,
    ) -> Ran:
        out = io.StringIO()
        mail_job.run(
            self.start(job, **start),
            Emitter(out),
            connect=connect or FakeConnect(),
            today_start=today_start,
        )
        text = out.getvalue()
        self.out += text
        return Ran([self.check(line) for line in text.splitlines(keepends=True)], text)

    def send(
        self,
        connect: mail_job.Connect,
        send_key: str = "sk-00001",
        **message: Any,
    ) -> Ran:
        body: dict[str, Any] = {
            "conversationKey": KEY,
            "to": "creator@example.com",
            "subject": "Collaboration",
            "body": "Hello there.",
            "sendKey": send_key,
            "approvedBy": "Mona",
        }
        start = {
            name: message.pop(name)
            for name in ("mailboxes", "caps", "warmups", "label", "sender_name")
            if name in message
        }
        body.update(message)
        return self.run({"kind": "mail.send", "message": body}, connect, **start)

    def sweep(self, connect: mail_job.Connect, **job: Any) -> Ran:
        return self.run({"kind": "mail.replies", **job}, connect)

    # The store, as the old tests set it up.

    def open_conversation(
        self,
        *,
        key: str = KEY,
        recipient: str = "creator@example.com",
        thread: str = "t1",
        message_id: str = "m1",
        account: str = ACCOUNT,
    ) -> None:
        mailbox.upsert_conversation(
            self.conn,
            conversation_key=key,
            account=account,
            recipient=recipient,
            subject="Collaboration",
            label="Gratovo Outreach",
            channel_id="UC123",
        )
        mailbox.record_send(
            self.conn,
            conversation_key=key,
            account=account,
            result=sent_result(message_id, thread),
            recipient=recipient,
            subject="Collaboration",
            body="Hello there.",
        )

    def queue(self, *, key: str = KEY, count: int = 1) -> None:
        mailbox.queue_steps(
            self.conn,
            conversation_key=key,
            account=ACCOUNT,
            steps=[
                {"dueAt": "2000-01-01T00:00:00Z", "body": f"Follow-up {i + 1}"}
                for i in range(count)
            ],
            base_step_no=mailbox.highest_step_no(self.conn, key, ACCOUNT),
        )


@pytest.fixture
def room(tmp_path: Path, check_from_pipeline: Check) -> Iterator[Mailroom]:
    mailroom = Mailroom(tmp_path / "mail", check_from_pipeline)
    yield mailroom
    mailroom.conn.close()


# --- the reply sweep (the old ToolSweepTest) ---


def test_a_reply_arriving_first_cancels_the_due_follow_up(room: Mailroom) -> None:
    """A follow-up is due right now AND a reply is in the thread: the sweep cancels it and
    nothing is sent."""
    room.open_conversation()
    room.queue(count=2)
    client = FakeGmailClient(thread_replies={"t1": [reply()]})

    ran = room.sweep(connect_to(client))

    assert ran.state == "done"
    assert ran.data == {
        "accounts": [
            {"account": ACCOUNT, "checked": 1, "replies": 1, "cancelledQueued": 0, "error": None}
        ]
    }
    (line,) = ran.replies
    assert line["cancelledFollowUps"] == 2
    assert line["isFirstReply"] is True
    assert line["channelId"] == "UC123"
    assert line["conversationKey"] == KEY
    assert line["account"] == ACCOUNT
    assert line["from"] == "creator@example.com"
    assert line["fromName"] == "A Creator"
    assert line["receivedAt"] == "2023-11-14T22:13:20Z"
    assert line["bodyCut"] is False
    assert client.sends == []
    assert mailbox.pending_steps(room.conn, ACCOUNT) == []


def test_a_second_reply_is_not_a_first_reply(room: Mailroom) -> None:
    room.open_conversation()
    client = FakeGmailClient(thread_replies={"t1": [reply()]})
    room.sweep(connect_to(client))
    assert room.run({"kind": "mail.ack", "messageIds": ["r1"]}).data == {"acknowledged": 1}

    # The conversation is closed after a reply, so a later message in it is found by asking
    # about that conversation directly, as the app does when somebody opens the thread.
    client.thread_replies["t1"].append(reply("r2", at=1_700_000_500_000))
    ran = room.sweep(connect_to(client), conversationKey=KEY)

    (line,) = ran.replies
    assert line["messageId"] == "r2"
    assert line["isFirstReply"] is False, "only the first reply may flip the channel"


def test_one_broken_thread_does_not_stop_the_sweep(room: Mailroom) -> None:
    room.open_conversation()
    room.open_conversation(
        key="thread-two", recipient="b@example.com", thread="t2", message_id="m9"
    )

    class Picky(FakeGmailClient):
        def replies(
            self, thread_id: str, *, exclude_ids: Collection[str] = ()
        ) -> list[gmail.Reply]:
            self.thread_reads.append(thread_id)
            if len(self.thread_reads) == 1:
                raise gmail.MailApiError("Gmail returned an error (HTTP 404).", status=404)
            return [reply("r9")]

    ran = room.sweep(connect_to(Picky()))

    assert ran.data["accounts"][0]["checked"] == 2
    assert len(ran.replies) == 1, "the second conversation still swept"
    assert [log["level"] for log in ran.logs] == ["warn"]


def test_an_unacknowledged_reply_is_reported_again(room: Mailroom) -> None:
    """Replies stay unreported until mail.ack: an app that died mid-apply sees them again."""
    room.open_conversation()
    client = FakeGmailClient(thread_replies={"t1": [reply()]})
    room.sweep(connect_to(client))

    again = room.sweep(connect_to(client))

    (line,) = again.replies
    assert line["messageId"] == "r1"
    assert line["isFirstReply"] is True, "still the first reply, still not handled"
    assert line["cancelledFollowUps"] == 0
    room.run({"kind": "mail.ack", "messageIds": ["r1"]})
    assert room.sweep(connect_to(client)).replies == []


def test_the_sweep_stops_at_its_limit_oldest_first(room: Mailroom) -> None:
    room.open_conversation()
    room.open_conversation(
        key="thread-two", recipient="b@example.com", thread="t2", message_id="m9"
    )
    client = FakeGmailClient()

    ran = room.sweep(connect_to(client), limit=1)

    assert ran.data["accounts"][0]["checked"] == 1
    assert client.thread_reads == ["t1"]


def test_a_reply_body_longer_than_16000_characters_arrives_cut(room: Mailroom) -> None:
    room.open_conversation()
    client = FakeGmailClient(thread_replies={"t1": [reply(body="AI tools. " * 2_000)]})

    (line,) = room.sweep(connect_to(client)).replies

    assert line["bodyCut"] is True
    assert len(line["body"]) == 16_000


def test_the_sweep_stamps_each_mailbox_and_status_reads_it(room: Mailroom) -> None:
    connect = FakeConnect()
    room.run({"kind": "mail.replies"}, connect, mailboxes=[ACCOUNT, OTHER])

    status = room.run({"kind": "mail.status"}, connect, mailboxes=[ACCOUNT, OTHER])

    stamps = [entry["lastSweepAt"] for entry in status.data["accounts"]]
    assert all(isinstance(stamp, str) for stamp in stamps)
    assert mailbox.get_state(room.conn, mail_job.sweep_state_key(OTHER)) == stamps[1]


def test_every_mailbox_is_swept_and_a_failing_one_is_reported_in_its_entry(
    room: Mailroom,
) -> None:
    room.open_conversation()
    connect = FakeConnect(
        {
            REFRESH_TOKENS[ACCOUNT]: FakeGmailClient(thread_replies={"t1": [reply()]}),
            REFRESH_TOKENS[OTHER]: gmail.MailNetworkError("Couldn't reach Gmail."),
        }
    )

    ran = room.run({"kind": "mail.replies"}, connect, mailboxes=[OTHER, ACCOUNT])

    assert ran.state == "done"
    assert ran.data["accounts"] == [
        {
            "account": OTHER,
            "checked": 0,
            "replies": 0,
            "cancelledQueued": 0,
            "error": {"code": "network", "message": "Couldn't reach Gmail."},
        },
        {"account": ACCOUNT, "checked": 1, "replies": 1, "cancelledQueued": 0, "error": None},
    ]
    assert len(ran.replies) == 1


def test_a_named_sweep_asks_only_that_mailbox(room: Mailroom) -> None:
    connect = FakeConnect()

    ran = room.run(
        {"kind": "mail.replies", "mailbox": "Deals@Gratovo.test"},
        connect,
        mailboxes=[ACCOUNT, OTHER],
    )

    assert [entry["account"] for entry in ran.data["accounts"]] == [OTHER]
    assert [call["refreshToken"] for call in connect.calls] == [REFRESH_TOKENS[OTHER]]


# --- one send per key (the old SendKeyTest, at the job's level) ---


def test_a_retried_key_answers_with_the_first_send(room: Mailroom) -> None:
    client = FakeGmailClient()
    first = room.send(connect_to(client))
    again = room.send(connect_to(client))

    assert len(client.sends) == 1, "nothing is sent twice"
    assert first.data["duplicate"] is False
    assert again.data["duplicate"] is True
    assert again.data["messageId"] == first.data["messageId"]
    assert again.data["threadId"] == first.data["threadId"]
    assert again.data["rfcMessageId"] == first.data["rfcMessageId"]
    assert again.data["conversationKey"] == KEY
    assert again.data["sentAt"] == first.data["sentAt"]
    assert mailbox.pending_steps(room.conn, ACCOUNT) == [], "nothing is queued behind a send"


def test_a_different_key_is_a_different_message(room: Mailroom) -> None:
    client = FakeGmailClient()
    room.send(connect_to(client), "sk-00001")
    room.send(connect_to(client), "sk-00002")
    assert len(client.sends) == 2


def test_a_refused_send_can_be_retried_with_the_same_key(room: Mailroom) -> None:
    refused = FakeGmailClient(send_error=gmail.MailApiError("Gmail is unavailable.", status=503))
    failed = room.send(connect_to(refused))
    assert (failed.state, failed.code) == ("failed", "mail_api")

    client = FakeGmailClient()
    ran = room.send(connect_to(client))

    assert len(client.sends) == 1
    assert ran.data["duplicate"] is False


def test_a_claim_never_confirmed_is_refused_as_uncertain(room: Mailroom) -> None:
    # What a process killed inside the Gmail call leaves behind.
    mailbox.claim_send_key(room.conn, "sk-00001", account=ACCOUNT, conversation_key=KEY)
    client = FakeGmailClient()

    ran = room.send(connect_to(client))

    assert (ran.state, ran.code) == ("failed", "send_uncertain")
    assert "Sent folder" in ran.message
    assert client.sends == []


def test_a_send_that_lost_the_network_keeps_its_claim(room: Mailroom) -> None:
    """Gmail may have the message: a retry must not send it again."""
    lost = FakeGmailClient(send_error=gmail.MailNetworkError("Couldn't reach Gmail."))
    assert room.send(connect_to(lost)).code == "network"

    client = FakeGmailClient()
    assert room.send(connect_to(client)).code == "send_uncertain"
    assert client.sends == []


def test_who_approved_the_send_is_stored_with_the_claim_and_the_message(room: Mailroom) -> None:
    ran = room.send(connect_to(FakeGmailClient()), approvedBy="Mona Saleh")

    sent = mailbox.sent_message(room.conn, ran.data["messageId"])
    key = room.conn.execute("SELECT * FROM send_keys WHERE send_key = ?", ("sk-00001",)).fetchone()
    assert sent is not None
    assert sent["approved_by"] == "Mona Saleh"
    assert key["approved_by"] == "Mona Saleh"
    assert key["state"] == mailbox.SEND_KEY_SENT


def test_a_send_answers_with_what_the_next_message_needs(room: Mailroom) -> None:
    client = FakeGmailClient()

    ran = room.send(connect_to(client), labels=["Influencers", "/Stage/Contacted/", "Influencers"])

    assert ran.data == {
        "duplicate": False,
        "account": ACCOUNT,
        "conversationKey": KEY,
        "messageId": "m2",
        "threadId": "t2",
        "rfcMessageId": "<rfc-2@mail>",
        "labelled": True,
        "threaded": False,
        "to": "creator@example.com",
        "subject": "Collaboration",
        "sentAt": ran.data["sentAt"],
    }
    assert client.sends[0]["labels"] == [
        "Gratovo Outreach",
        "Gratovo Outreach/Influencers",
        "Gratovo Outreach/Stage/Contacted",
    ]


def test_a_second_message_continues_the_thread_unless_told_not_to(room: Mailroom) -> None:
    client = FakeGmailClient()
    room.send(connect_to(client), "sk-00001")

    threaded = room.send(connect_to(client), "sk-00002", subject="")
    fresh = room.send(connect_to(client), "sk-00003", newThread=True, subject="A new idea")

    assert threaded.data["threaded"] is True
    assert client.sends[1]["threadId"] == "t2"
    assert client.sends[1]["inReplyTo"] == "<rfc-2@mail>"
    assert client.sends[1]["subject"] == "Re: Collaboration"
    assert fresh.data["threaded"] is False
    assert client.sends[2]["threadId"] is None
    conversation = mailbox.get_conversation(room.conn, KEY, ACCOUNT)
    assert conversation is not None
    assert conversation["last_rfc_id"] == "<rfc-4@mail>", "kept for the next message"


def test_a_send_without_a_conversation_gets_its_own_key(room: Mailroom) -> None:
    ran = room.run(
        {
            "kind": "mail.send",
            "message": {
                "to": "creator@example.com",
                "subject": "Collaboration",
                "body": "Hello there.",
                "sendKey": "sk-00001",
                "approvedBy": "Mona",
            },
        },
        connect_to(FakeGmailClient()),
    )
    assert ran.data["conversationKey"].startswith("adhoc-")


def test_a_blank_body_is_refused_before_any_request(room: Mailroom) -> None:
    refuse = Refuse()
    ran = room.send(refuse, body="   \n ")
    assert (ran.state, ran.code) == ("failed", "bad_start")
    assert not refuse.called


def test_a_bad_address_from_gmail_ends_bad_start(room: Mailroom) -> None:
    client = FakeGmailClient(send_error=gmail.BadAddressError("x is not a usable email address."))
    assert room.send(connect_to(client)).code == "bad_start"


# --- the daily cap (the old DailyCapTest) ---


def first_email(room: Mailroom, client: FakeGmailClient, n: int, **start: Any) -> Ran:
    return room.send(
        connect_to(client),
        f"sk-{n:05d}",
        conversationKey=f"conv-{n}",
        to=f"creator{n}@example.com",
        **start,
    )


def test_the_cap_comes_from_the_settings(room: Mailroom) -> None:
    client = FakeGmailClient()
    for n in range(10):
        assert first_email(room, client, n, caps={ACCOUNT: 10}).state == "done"

    refused = first_email(room, client, 10, caps={ACCOUNT: 10})

    assert refused.code == "daily_cap_reached"
    assert "10" in refused.message
    assert len(client.sends) == 10, "the eleventh never left"
    # The refused key is free again: after the cap is raised (or tomorrow) the same send goes.
    assert first_email(room, client, 10, caps={ACCOUNT: 11}).state == "done"
    assert len(client.sends) == 11


@pytest.mark.parametrize(
    ("mailboxes", "cap"),
    [
        (None, 35),
        ([], 35),
        ([{"address": OTHER, "dailyCap": 20, "warmupStartedOn": None}], 35),
        ([{"address": ACCOUNT, "dailyCap": 400, "warmupStartedOn": None}], 50),
        ([{"address": ACCOUNT, "dailyCap": 2, "warmupStartedOn": None}], 10),
        # Addresses are matched without regard to case, as Gmail does.
        ([{"address": ACCOUNT.upper(), "dailyCap": 20, "warmupStartedOn": "2026-10-01"}], 20),
    ],
)
def test_35_by_default_and_never_outside_10_to_50(mailboxes: list[Any] | None, cap: int) -> None:
    settings: Settings = {}
    if mailboxes is not None:
        settings["mail"] = {"label": "Gratovo Outreach", "senderName": None, "mailboxes": mailboxes}
    assert mail_job.mailbox_limits(settings, ACCOUNT)[0] == cap


def test_a_reply_to_someone_who_wrote_back_is_never_held(room: Mailroom) -> None:
    client = FakeGmailClient()
    room.open_conversation()
    # What the reply sweep records when they answer.
    room.conn.execute(
        "UPDATE conversations SET reply_seen_at = ? WHERE conversation_key = ?",
        (mailbox.now(), KEY),
    )
    room.conn.commit()
    for n in range(10):
        first_email(room, client, n, caps={ACCOUNT: 10})

    ran = room.send(
        connect_to(client),
        "sk-99999",
        subject="",
        body="Great, here are the details.",
        caps={ACCOUNT: 10},
    )

    assert ran.state == "done"
    assert client.sends[-1]["body"].splitlines()[0] == "Great, here are the details."
    assert client.sends[-1]["subject"] == "Re: Collaboration"


def test_yesterdays_email_does_not_count(room: Mailroom) -> None:
    for n in range(10):
        room.conn.execute(
            "INSERT INTO sent_messages "
            " (gmail_message_id, conversation_key, account, step_no, recipient, sent_at) "
            "VALUES (?, ?, ?, 0, ?, ?)",
            (f"old{n}", f"old-{n}", ACCOUNT, "x@y.z", "2000-01-01T09:00:00Z"),
        )
    room.conn.commit()
    client = FakeGmailClient()
    assert first_email(room, client, 1, caps={ACCOUNT: 10}).state == "done"
    assert len(client.sends) == 1


def test_the_day_starts_where_the_job_says(room: Mailroom) -> None:
    client = FakeGmailClient()
    for n in range(10):
        first_email(room, client, n, caps={ACCOUNT: 10})
    ran = room.run(
        {"kind": "mail.status"},
        connect_to(client),
        today_start="2999-01-01T00:00:00Z",
        caps={ACCOUNT: 10},
    )
    assert ran.data["accounts"][0]["limits"]["sentToday"] == 0


def test_status_reports_what_is_left_today_and_the_warm_up(room: Mailroom) -> None:
    client = FakeGmailClient()
    caps: dict[str, Any] = {"caps": {ACCOUNT: 12}, "warmups": {ACCOUNT: "2026-10-01"}}
    for n in range(3):
        first_email(room, client, n, **caps)

    ran = room.run({"kind": "mail.status"}, connect_to(client), **caps)

    assert ran.data["accounts"][0]["limits"] == {
        "dailyCap": 12,
        "warmupStartedOn": "2026-10-01",
        "sentToday": 3,
        "leftToday": 9,
    }


# --- mail.status ---


def test_status_with_no_mailbox_is_not_configured(room: Mailroom) -> None:
    refuse = Refuse()
    ran = room.run({"kind": "mail.status"}, refuse, mailboxes=None)
    assert ran.state == "done"
    assert ran.data == {
        "configured": False,
        "label": "Gratovo Outreach",
        "senderName": None,
        "accounts": [],
    }
    assert not refuse.called


def test_status_with_an_empty_mailbox_list_is_not_configured(room: Mailroom) -> None:
    ran = room.run({"kind": "mail.status"}, Refuse(), mailboxes=[])
    assert ran.data["configured"] is False


def test_status_shows_the_counters_and_limits_of_each_mailbox(room: Mailroom) -> None:
    room.open_conversation()
    room.queue(count=2)
    connect = FakeConnect()

    ran = room.run(
        {"kind": "mail.status"}, connect, label="AI Creators", sender_name="Mona at Gratovo"
    )

    assert ran.data == {
        "configured": True,
        "label": "AI Creators",
        "senderName": "Mona at Gratovo",
        "accounts": [
            {
                "account": ACCOUNT,
                "connected": True,
                "counters": {
                    "conversations": 1,
                    "sent": 1,
                    "awaitingReply": 1,
                    "replied": 0,
                    "pendingSteps": 2,
                    "dueSteps": 2,
                    "failedSteps": 0,
                    "unreportedReplies": 0,
                },
                "limits": {
                    "dailyCap": 35,
                    "warmupStartedOn": None,
                    "sentToday": 1,
                    "leftToday": 34,
                },
                "lastSweepAt": None,
                "error": None,
            }
        ],
    }
    assert connect.calls == [
        {
            "clientId": CLIENT_ID,
            "refreshToken": REFRESH_TOKENS[ACCOUNT],
            "senderName": "Mona at Gratovo",
        }
    ]


def test_one_failing_mailbox_does_not_stop_the_others(room: Mailroom) -> None:
    expired = "Google rejected the saved refresh token. Reconnect the mailbox in Settings."
    connect = FakeConnect({REFRESH_TOKENS[ACCOUNT]: gmail.MailAuthError(expired)})

    ran = room.run({"kind": "mail.status"}, connect, mailboxes=[ACCOUNT, OTHER])

    failing, working = ran.data["accounts"]
    assert failing == {
        "account": ACCOUNT,
        "connected": False,
        "counters": None,
        "limits": None,
        "lastSweepAt": None,
        "error": {"code": "mail_auth", "message": expired},
    }
    assert working["account"] == OTHER
    assert working["connected"] is True
    assert working["error"] is None


def test_an_unexpected_failure_in_status_names_only_its_kind(room: Mailroom) -> None:
    connect = FakeConnect({REFRESH_TOKENS[ACCOUNT]: RuntimeError(f"boom {ACCESS_TOKEN}")})
    ran = room.run({"kind": "mail.status"}, connect)
    error = ran.data["accounts"][0]["error"]
    assert error["code"] == "mail_api"
    assert "RuntimeError" in error["message"]
    assert ACCESS_TOKEN not in ran.text


# --- which mailbox ---


def test_a_named_mailbox_is_matched_without_regard_to_case(room: Mailroom) -> None:
    connect = FakeConnect()
    ran = room.send(connect, mailbox="DEALS@gratovo.test", mailboxes=[ACCOUNT, OTHER])
    assert ran.data["account"] == OTHER
    assert [call["refreshToken"] for call in connect.calls] == [REFRESH_TOKENS[OTHER]]


def test_with_one_mailbox_none_needs_naming(room: Mailroom) -> None:
    ran = room.send(FakeConnect(), mailboxes=[OTHER])
    assert ran.data["account"] == OTHER


def test_with_two_mailboxes_a_send_must_name_one(room: Mailroom) -> None:
    refuse = Refuse()
    ran = room.send(refuse, mailboxes=[ACCOUNT, OTHER])
    assert (ran.state, ran.code) == ("failed", "bad_start")
    assert not refuse.called


def test_an_unknown_mailbox_is_not_connected(room: Mailroom) -> None:
    refuse = Refuse()
    ran = room.send(refuse, mailbox="nobody@gratovo.test")
    assert (ran.state, ran.code) == ("failed", "mail_not_connected")
    assert not refuse.called


@pytest.mark.parametrize("kind", ["mail.send", "mail.replies"])
def test_no_mailbox_at_all_is_not_connected(room: Mailroom, kind: str) -> None:
    refuse = Refuse()
    if kind == "mail.send":
        ran = room.send(refuse, mailboxes=None)
    else:
        ran = room.run({"kind": kind}, refuse, mailboxes=None)
    assert (ran.state, ran.code) == ("failed", "mail_not_connected")
    assert not refuse.called


def test_gmail_reporting_another_address_is_an_auth_failure(room: Mailroom) -> None:
    client = FakeGmailClient(address="someone-else@gratovo.test")

    ran = room.send(connect_to(client))

    assert (ran.state, ran.code) == ("failed", "mail_auth")
    assert ran.message == (
        "The saved login belongs to another address. Reconnect the mailbox in Settings."
    )
    assert client.sends == []


def test_the_store_key_is_the_listed_address_lower_cased(room: Mailroom) -> None:
    connect = FakeConnect({REFRESH_TOKENS[ACCOUNT]: FakeGmailClient(address=ACCOUNT.upper())})
    ran = room.send(connect, mailboxes=[ACCOUNT.title()])
    assert ran.data["account"] == ACCOUNT
    assert mailbox.get_conversation(room.conn, KEY, ACCOUNT) is not None


def test_a_token_google_refuses_ends_mail_auth(room: Mailroom) -> None:
    connect = FakeConnect(
        {REFRESH_TOKENS[ACCOUNT]: gmail.MailAuthError("Google rejected the OAuth client.")}
    )
    ran = room.send(connect)
    assert (ran.code, ran.message) == ("mail_auth", "Google rejected the OAuth client.")


# --- mail.ack and mail.cancel ---


def test_ack_marks_replies_reported_without_a_request(room: Mailroom) -> None:
    room.open_conversation()
    mailbox.record_replies(room.conn, KEY, ACCOUNT, [reply(), reply("r2")])
    refuse = Refuse()

    ran = room.run({"kind": "mail.ack", "messageIds": ["r1", "r2", "r404"]}, refuse, mailboxes=None)

    assert ran.data == {"acknowledged": 2}
    assert mailbox.unreported_replies(room.conn, ACCOUNT) == []
    assert not refuse.called


def test_cancel_stops_the_conversation_in_every_mailbox_without_a_request(
    room: Mailroom,
) -> None:
    room.open_conversation()
    room.queue(count=2)
    room.open_conversation(account=OTHER, message_id="m7")
    refuse = Refuse()

    ran = room.run({"kind": "mail.cancel", "conversationKey": KEY}, refuse, mailboxes=None)

    assert ran.data == {"cancelled": 2, "closed": True}
    for account in (ACCOUNT, OTHER):
        conversation = mailbox.get_conversation(room.conn, KEY, account)
        assert conversation is not None
        assert conversation["closed_at"] is not None
    assert not refuse.called


def test_cancelling_an_unknown_conversation_closes_nothing(room: Mailroom) -> None:
    ran = room.run({"kind": "mail.cancel", "conversationKey": "nope"}, Refuse())
    assert ran.data == {"cancelled": 0, "closed": False}


# --- failures ---


def test_a_mailbox_db_from_a_newer_app_ends_crash(room: Mailroom) -> None:
    room.conn.execute(f"PRAGMA user_version={mailbox.SCHEMA_VERSION + 1}")
    room.conn.commit()

    ran = room.run({"kind": "mail.ack", "messageIds": ["r1"]})

    assert (ran.state, ran.code) == ("failed", "crash")
    assert ran.message == "mailbox.db was written by a newer version of the app."


def test_no_line_and_no_stderr_carries_a_secret(
    room: Mailroom, capsys: pytest.CaptureFixture[str]
) -> None:
    room.open_conversation()
    leaky = f"boom {ACCESS_TOKEN} {CLIENT_SECRET} {REFRESH_TOKENS[ACCOUNT]}"
    healthy = FakeGmailClient(thread_replies={"t1": [reply()]})
    room.run({"kind": "mail.status"}, connect_to(healthy))
    room.sweep(connect_to(healthy))
    room.send(connect_to(healthy))
    room.run({"kind": "mail.ack", "messageIds": ["r1"]})
    room.run({"kind": "mail.cancel", "conversationKey": KEY})
    # An unexpected error whose text holds every secret, in each job that connects.
    crashing = FakeConnect({REFRESH_TOKENS[ACCOUNT]: RuntimeError(leaky)})
    room.run({"kind": "mail.status"}, crashing)
    room.sweep(crashing)
    crashed = room.send(crashing, "sk-00002")
    assert (crashed.code, crashed.message) == (
        "crash",
        "The mail job stopped on an unexpected error (RuntimeError).",
    )
    room.send(connect_to(FakeGmailClient(send_error=RuntimeError(leaky))), "sk-00003")

    stderr = capsys.readouterr().err
    for secret in SECRETS:
        assert secret not in room.out
        assert secret not in stderr
    assert "RuntimeError" in stderr


def test_no_log_line_carries_a_body(room: Mailroom) -> None:
    room.open_conversation()
    room.open_conversation(
        key="thread-two", recipient="b@example.com", thread="t2", message_id="m9"
    )

    class Picky(FakeGmailClient):
        def replies(
            self, thread_id: str, *, exclude_ids: Collection[str] = ()
        ) -> list[gmail.Reply]:
            if thread_id == "t1":
                raise gmail.MailApiError("Gmail returned an error (HTTP 404).", status=404)
            return [reply("r9", body="A reply body that must stay out of the log.")]

    ran = room.sweep(connect_to(Picky()))
    room.send(connect_to(FakeGmailClient()), body="An outgoing body that must stay out too.")

    for line in ran.lines:
        if line["type"] == "log":
            assert "must stay out" not in line["text"]
    assert "must stay out too" not in room.out
