"""Tests for the outreach mailbox: the follow-up queue and reply detection.

Run with:  python tests/test_mailbox.py    (from pipeline/)

No network. Gmail is a hand-written fake here rather than a mocking library,
for the same reason test_archive.py runs against a real temporary SQLite file:
the behaviour under test is almost entirely the interaction between what Gmail
said and what the database then refuses to do, and a fake that only records
calls would be testing the fake.

WHAT IS ACTUALLY BEING PINNED
-----------------------------
One thing above all others: **a follow-up must never reach somebody who has
already replied.** That is the promise the whole sequence feature rests on, and
breaking it means emailing "just checking you saw this!" to a person who
answered two days ago. It is enforced in one place -- the join in
`mailbox.due_steps` -- and `test_reply_stops_the_sequence` is what stops that
join from being quietly simplified away.

The rest follows from the same concern: a reply reported twice becomes a
duplicate in the CRM, a step retried forever becomes a mailbox that will not
stop, and a lost thread id becomes a follow-up that starts a new conversation
instead of continuing one.
"""

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gratovo import gmail, mailbox  # noqa: E402

ACCOUNT = "outreach@gratovo.test"
KEY = "thread-abc"


def sent_result(message_id="m1", thread_id="t1", rfc="<rfc-1@mail>"):
    """What `GmailClient.send` returns, shaped exactly as the real one is."""
    return {
        "messageId": message_id,
        "threadId": thread_id,
        "rfcMessageId": rfc,
        "labelId": "Label_1",
    }


def reply(message_id="r1", sender="creator@example.com", at=1_700_000_000_000):
    return {
        "messageId": message_id,
        "from": sender,
        "fromName": "A Creator",
        "subject": "Re: Collaboration",
        "at": at,
        "body": "Sounds interesting, tell me more.",
        "snippet": "Sounds interesting",
    }


class MailboxTestCase(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.conn = mailbox.open_db(Path(self.dir.name) / "mailbox.db")
        self.addCleanup(self.conn.close)

    def open_conversation(self, *, key=KEY, recipient="creator@example.com"):
        mailbox.upsert_conversation(
            self.conn,
            conversation_key=key,
            account=ACCOUNT,
            recipient=recipient,
            subject="Collaboration",
            label="Gratovo Outreach",
            channel_id="UC123",
        )
        mailbox.record_send(
            self.conn,
            conversation_key=key,
            account=ACCOUNT,
            result=sent_result(),
            recipient=recipient,
            subject="Collaboration",
            body="Hello there.",
        )

    def queue(self, *, due="2000-01-01T00:00:00Z", key=KEY, count=1):
        return mailbox.queue_steps(
            self.conn,
            conversation_key=key,
            account=ACCOUNT,
            steps=[
                {"dueAt": due, "body": f"Follow-up {i + 1}"}
                for i in range(count)
            ],
            base_step_no=mailbox.highest_step_no(self.conn, key, ACCOUNT),
        )


class SequenceTest(MailboxTestCase):
    def test_reply_stops_the_sequence(self):
        """The one that matters: a due step vanishes the moment a reply lands."""
        self.open_conversation()
        self.queue(count=2)

        self.assertEqual(len(mailbox.due_steps(self.conn, ACCOUNT)), 2)

        mailbox.record_replies(self.conn, KEY, ACCOUNT, [reply()])

        self.assertEqual(
            mailbox.due_steps(self.conn, ACCOUNT), [],
            "a conversation with a reply must never yield a due follow-up",
        )

    def test_reply_stops_the_sequence_before_cancel_runs(self):
        """`reply_seen_at` alone is enough -- cancelling is only bookkeeping.

        Pinned separately because the two are easy to conflate: if the join in
        `due_steps` were dropped on the grounds that `cancel_steps` handles it,
        a crash between recording a reply and cancelling would leave live steps
        on a replied conversation.
        """
        self.open_conversation()
        self.queue(count=2)
        mailbox.record_replies(self.conn, KEY, ACCOUNT, [reply()])

        still_pending = mailbox.pending_steps(self.conn, ACCOUNT)
        self.assertEqual(len(still_pending), 2, "not cancelled yet")
        self.assertEqual(mailbox.due_steps(self.conn, ACCOUNT), [],
                         "but already unreachable")

    def test_cancel_reports_how_many_it_stopped(self):
        self.open_conversation()
        self.queue(count=3)
        self.assertEqual(mailbox.cancel_steps(self.conn, KEY, ACCOUNT), 3)
        self.assertEqual(mailbox.cancel_steps(self.conn, KEY, ACCOUNT), 0,
                         "cancelling twice must not double-count")

    def test_future_steps_are_not_due(self):
        self.open_conversation()
        self.queue(due="2999-01-01T00:00:00Z")
        self.assertEqual(mailbox.due_steps(self.conn, ACCOUNT), [])

    def test_step_numbers_continue_across_sequences(self):
        """A second sequence must not reuse the first one's step numbers."""
        self.open_conversation()
        self.queue(count=2)
        second = self.queue(count=2)
        self.assertEqual([row["step_no"] for row in second], [3, 4])

    def test_steps_are_scoped_to_their_conversation(self):
        self.open_conversation()
        self.open_conversation(key="thread-other", recipient="b@example.com")
        self.queue(count=1)
        self.queue(key="thread-other", count=1)

        mailbox.record_replies(self.conn, KEY, ACCOUNT, [reply()])

        due = mailbox.due_steps(self.conn, ACCOUNT)
        self.assertEqual(len(due), 1)
        self.assertEqual(due[0]["conversation_key"], "thread-other")

    def test_a_step_gives_up_after_repeated_failure(self):
        self.open_conversation()
        step = self.queue()[0]

        self.assertFalse(mailbox.mark_step_failed(self.conn, step["id"], "boom"))
        self.assertEqual(len(mailbox.due_steps(self.conn, ACCOUNT)), 1,
                         "a transient failure leaves the step retryable")

        mailbox.mark_step_failed(self.conn, step["id"], "boom")
        exhausted = mailbox.mark_step_failed(self.conn, step["id"], "boom")

        self.assertTrue(exhausted)
        self.assertEqual(mailbox.due_steps(self.conn, ACCOUNT), [],
                         "a step that gave up must stop being retried")

    def test_empty_step_bodies_are_dropped(self):
        self.open_conversation()
        queued = mailbox.queue_steps(
            self.conn, conversation_key=KEY, account=ACCOUNT,
            steps=[{"body": "   "}, {"body": "real"}],
        )
        self.assertEqual(len(queued), 1)


class ThreadingTest(MailboxTestCase):
    def test_a_send_records_what_the_next_one_needs(self):
        self.open_conversation()
        row = mailbox.get_conversation(self.conn, KEY, ACCOUNT)
        self.assertEqual(row["gmail_thread_id"], "t1")
        self.assertEqual(row["last_rfc_id"], "<rfc-1@mail>")
        self.assertEqual(row["channel_id"], "UC123")

    def test_a_second_send_advances_the_message_id(self):
        """The follow-up quotes the LAST message, not the first."""
        self.open_conversation()
        mailbox.record_send(
            self.conn, conversation_key=KEY, account=ACCOUNT,
            result=sent_result("m2", "t1", "<rfc-2@mail>"),
            recipient="creator@example.com", subject="Re: Collaboration",
            body="Just checking in.", step_no=1,
        )
        row = mailbox.get_conversation(self.conn, KEY, ACCOUNT)
        self.assertEqual(row["last_rfc_id"], "<rfc-2@mail>")
        self.assertEqual(row["gmail_thread_id"], "t1", "same thread throughout")

    def test_preparing_a_send_cannot_erase_the_thread(self):
        """`upsert_conversation` runs before every send, including follow-ups."""
        self.open_conversation()
        mailbox.upsert_conversation(
            self.conn, conversation_key=KEY, account=ACCOUNT,
            recipient="creator@example.com",
        )
        row = mailbox.get_conversation(self.conn, KEY, ACCOUNT)
        self.assertEqual(row["gmail_thread_id"], "t1")
        self.assertEqual(row["last_rfc_id"], "<rfc-1@mail>")

    def test_the_same_key_in_two_mailboxes_is_two_conversations(self):
        self.open_conversation()
        mailbox.upsert_conversation(
            self.conn, conversation_key=KEY, account="other@gratovo.test",
            recipient="creator@example.com",
        )
        self.assertIsNone(
            mailbox.get_conversation(self.conn, KEY, "other@gratovo.test")
            ["gmail_thread_id"],
            "a thread id from one mailbox means nothing in another",
        )


class ReplyReportingTest(MailboxTestCase):
    def test_a_reply_is_reported_once(self):
        self.open_conversation()
        mailbox.record_replies(self.conn, KEY, ACCOUNT, [reply()])

        first = mailbox.unreported_replies(self.conn, ACCOUNT)
        self.assertEqual(len(first), 1)

        mailbox.mark_reported(self.conn, [first[0]["gmail_message_id"]])
        self.assertEqual(mailbox.unreported_replies(self.conn, ACCOUNT), [])

    def test_seeing_the_same_reply_again_reports_nothing_new(self):
        """Sweeps overlap; Gmail returns the whole thread every time."""
        self.open_conversation()
        mailbox.record_replies(self.conn, KEY, ACCOUNT, [reply()])
        mailbox.mark_reported(self.conn, ["r1"])

        fresh = mailbox.record_replies(self.conn, KEY, ACCOUNT, [reply()])

        self.assertEqual(fresh, [], "already-seen replies are not re-reported")
        self.assertEqual(mailbox.unreported_replies(self.conn, ACCOUNT), [])

    def test_an_unacknowledged_reply_survives_to_the_next_sweep(self):
        """The app crashed mid-apply; the reply must still be waiting."""
        self.open_conversation()
        mailbox.record_replies(self.conn, KEY, ACCOUNT, [reply()])
        mailbox.record_replies(self.conn, KEY, ACCOUNT, [reply()])
        self.assertEqual(len(mailbox.unreported_replies(self.conn, ACCOUNT)), 1)

    def test_the_first_reply_stamps_the_conversation_once(self):
        self.open_conversation()
        mailbox.record_replies(self.conn, KEY, ACCOUNT, [reply()])
        first_stamp = mailbox.get_conversation(
            self.conn, KEY, ACCOUNT)["reply_seen_at"]

        mailbox.record_replies(self.conn, KEY, ACCOUNT,
                               [reply("r2", at=1_700_000_100_000)])
        row = mailbox.get_conversation(self.conn, KEY, ACCOUNT)

        self.assertEqual(row["reply_seen_at"], first_stamp,
                         "the stamp marks the FIRST reply, not the latest")
        self.assertEqual(row["replied_from"], "creator@example.com")

    def test_our_own_sends_are_excluded_from_a_thread_read(self):
        self.open_conversation()
        self.assertEqual(
            mailbox.sent_message_ids(self.conn, KEY, ACCOUNT), {"m1"})

    def test_a_replied_conversation_stops_being_swept(self):
        self.open_conversation()
        self.assertEqual(len(mailbox.open_conversations(self.conn, ACCOUNT)), 1)
        mailbox.record_replies(self.conn, KEY, ACCOUNT, [reply()])
        self.assertEqual(mailbox.open_conversations(self.conn, ACCOUNT), [])


class CountersTest(MailboxTestCase):
    def test_counters_describe_the_mailbox(self):
        self.open_conversation()
        self.queue(count=2)
        counts = mailbox.counters(self.conn, ACCOUNT)
        self.assertEqual(counts["sent"], 1)
        self.assertEqual(counts["awaitingReply"], 1)
        self.assertEqual(counts["pendingSteps"], 2)
        self.assertEqual(counts["dueSteps"], 2)
        self.assertEqual(counts["replied"], 0)

        mailbox.record_replies(self.conn, KEY, ACCOUNT, [reply()])
        counts = mailbox.counters(self.conn, ACCOUNT)
        self.assertEqual(counts["replied"], 1)
        self.assertEqual(counts["awaitingReply"], 0)
        self.assertEqual(counts["dueSteps"], 0)
        self.assertEqual(counts["unreportedReplies"], 1)


class MessageParsingTest(unittest.TestCase):
    """`gratovo.gmail`'s pure half -- no credentials, no network."""

    def test_plain_text_is_found_however_deeply_nested(self):
        import base64

        def part(mime, text=None, parts=None):
            node = {"mimeType": mime}
            if text is not None:
                node["body"] = {
                    "data": base64.urlsafe_b64encode(
                        text.encode("utf-8")).decode("ascii").rstrip("=")
                }
            if parts:
                node["parts"] = parts
            return node

        payload = part("multipart/mixed", parts=[
            part("multipart/alternative", parts=[
                part("text/plain", "the actual reply"),
                part("text/html", "<p>the actual reply</p>"),
            ]),
        ])
        self.assertEqual(gmail._plain_text(payload), "the actual reply")

    def test_an_html_only_reply_still_produces_text(self):
        import base64
        html = "<p>Hi there</p><br><p>Sounds good</p>"
        payload = {
            "mimeType": "text/html",
            "body": {"data": base64.urlsafe_b64encode(
                html.encode("utf-8")).decode("ascii").rstrip("=")},
        }
        text = gmail._plain_text(payload)
        self.assertIn("Hi there", text)
        self.assertNotIn("<p>", text)

    def test_re_is_not_stacked(self):
        from tools import email_send

        self.assertEqual(email_send._reply_subject("Hello"), "Re: Hello")
        self.assertEqual(email_send._reply_subject("Re: Hello"), "Re: Hello")
        self.assertEqual(email_send._reply_subject("RE: Hello"), "RE: Hello")

    def test_addresses_are_validated_before_the_api_call(self):
        self.assertTrue(gmail._looks_like_address("a@b.co"))
        self.assertTrue(gmail._looks_like_address("A Name <a@b.co>"))
        self.assertFalse(gmail._looks_like_address("not-an-address"))
        self.assertFalse(gmail._looks_like_address("a@b"))
        self.assertFalse(gmail._looks_like_address(""))

    def test_a_follow_up_quotes_what_came_before(self):
        quoted = gmail.quoted_reply_body(
            "Just checking in.",
            previous_body="Hello there.\nWe loved your channel.",
            previous_from="us@gratovo.test",
        )
        self.assertTrue(quoted.startswith("Just checking in."))
        self.assertIn("> Hello there.", quoted)
        self.assertIn("> We loved your channel.", quoted)

    def test_a_first_message_is_not_quoted(self):
        self.assertEqual(gmail.quoted_reply_body("Hello."), "Hello.")


class FakeGmailClient:
    """Just enough Gmail to drive `email_send`'s two halves.

    Records what it was asked to send and answers thread reads from a script.
    """

    def __init__(self, *, address=ACCOUNT, thread_replies=None):
        self.address = address
        self.thread_replies = thread_replies or {}
        self.sends = []
        self._counter = 0

    def send(self, *, to, subject, body, label=None, labels=None,
             thread_id=None, in_reply_to=None, references=None, reply_to=None,
             html=None):
        self._counter += 1
        self.sends.append({
            "to": to, "subject": subject, "body": body,
            "threadId": thread_id, "inReplyTo": in_reply_to,
            "label": label, "labels": labels,
        })
        return sent_result(
            f"m{self._counter + 1}", thread_id or "t1",
            f"<rfc-{self._counter + 1}@mail>",
        )

    def replies(self, thread_id, *, exclude_ids=()):
        return [r for r in self.thread_replies.get(thread_id, [])
                if r["messageId"] not in exclude_ids]


class ToolSweepTest(MailboxTestCase):
    """`email_send`'s sweep-then-send, against a fake mailbox."""

    def setUp(self):
        super().setUp()
        from tools import email_send

        self.tool = email_send
        self.cfg = type("Cfg", (), {"outreach_label": "Gratovo Outreach"})()

    def test_a_reply_arriving_first_cancels_the_due_follow_up(self):
        """The ordering guarantee, end to end.

        A follow-up is due right now AND a reply is sitting in the thread. The
        sweep cancels it, and nothing is sent (the tool never sends a queued
        follow-up any more: see test_email_send_no_auto_send.py).
        """
        self.open_conversation()
        self.queue(count=2)
        client = FakeGmailClient(thread_replies={"t1": [reply()]})

        replies, checked = self.tool._sweep_replies(client, self.conn, ACCOUNT)

        self.assertEqual(checked, 1)
        self.assertEqual(len(replies), 1)
        self.assertEqual(replies[0]["cancelledFollowUps"], 2)
        self.assertTrue(replies[0]["isFirstReply"])
        self.assertEqual(replies[0]["channelId"], "UC123")
        self.assertEqual(client.sends, [])

    def test_a_second_reply_is_not_a_first_reply(self):
        self.open_conversation()
        client = FakeGmailClient(thread_replies={"t1": [reply()]})
        self.tool._sweep_replies(client, self.conn, ACCOUNT)
        mailbox.mark_reported(self.conn, ["r1"])

        # The conversation is closed after a reply, so a later message in it is
        # found by asking about that conversation directly -- which is what the
        # app does when somebody opens the thread.
        client.thread_replies["t1"].append(reply("r2", at=1_700_000_500_000))
        replies, _ = self.tool._sweep_replies(
            client, self.conn, ACCOUNT, conversation_key=KEY)

        self.assertEqual(len(replies), 1)
        self.assertEqual(replies[0]["messageId"], "r2")
        self.assertFalse(replies[0]["isFirstReply"],
                         "only the first reply may flip the channel to interested")

    def test_one_broken_thread_does_not_stop_the_sweep(self):
        self.open_conversation()
        self.open_conversation(key="thread-two", recipient="b@example.com")

        class Picky(FakeGmailClient):
            def replies(self, thread_id, *, exclude_ids=()):
                if not self.sends:
                    self.sends.append("first call raised")
                    raise gmail.GmailApiError("thread not found", status=404)
                return [reply("r9")]

        replies, checked = self.tool._sweep_replies(
            Picky(), self.conn, ACCOUNT)

        self.assertEqual(checked, 2)
        self.assertEqual(len(replies), 1, "the second conversation still swept")


class SendKeyTest(MailboxTestCase):
    """A scheduled send retried with its key never reaches the inbox twice."""

    def setUp(self):
        super().setUp()
        from tools import email_send

        self.tool = email_send
        self.cfg = type("Cfg", (), {"outreach_label": "Gratovo Outreach"})()

    def request(self, send_key="sk-1", **extra):
        return {
            "conversationKey": KEY,
            "to": "creator@example.com",
            "subject": "Collaboration",
            "body": "Hello there.",
            "sendKey": send_key,
            "followUps": [{"delayDays": 3, "body": "Chasing."}],
            **extra,
        }

    def send(self, client, request):
        return self.tool._send_request(
            self.cfg, client, self.conn, ACCOUNT, request)

    def test_a_retried_key_answers_with_the_first_send(self):
        client = FakeGmailClient()
        first = self.send(client, self.request())
        again = self.send(client, self.request())

        self.assertEqual(len(client.sends), 1, "nothing is sent twice")
        self.assertTrue(again["duplicate"])
        self.assertNotIn("duplicate", first)
        self.assertEqual(again["messageId"], first["messageId"])
        self.assertEqual(again["threadId"], first["threadId"])
        self.assertEqual(again["followUps"], [], "nothing is queued behind a send")
        self.assertEqual(mailbox.pending_steps(self.conn, ACCOUNT), [])

    def test_a_different_key_is_a_different_message(self):
        client = FakeGmailClient()
        self.send(client, self.request("sk-1"))
        self.send(client, self.request("sk-2"))
        self.assertEqual(len(client.sends), 2)

    def test_no_key_keeps_the_old_behaviour(self):
        client = FakeGmailClient()
        self.send(client, self.request(None))
        self.send(client, self.request(None))
        self.assertEqual(len(client.sends), 2)

    def test_a_refused_send_can_be_retried_with_the_same_key(self):
        class Failing(FakeGmailClient):
            def send(self, **kwargs):
                raise gmail.GmailApiError("Gmail is unavailable", status=503)

        with self.assertRaises(gmail.GmailApiError):
            self.send(Failing(), self.request())

        client = FakeGmailClient()
        result = self.send(client, self.request())
        self.assertEqual(len(client.sends), 1)
        self.assertNotIn("duplicate", result)

    def test_an_attempt_that_never_reported_back_is_refused(self):
        # What a process killed inside the Gmail call leaves behind.
        mailbox.claim_send_key(
            self.conn, "sk-1", account=ACCOUNT, conversation_key=KEY)
        client = FakeGmailClient()

        with self.assertRaises(self.tool.ToolError) as caught:
            self.send(client, self.request())

        self.assertEqual(caught.exception.code, "send_uncertain")
        self.assertEqual(client.sends, [])

    def test_a_dry_run_claims_nothing(self):
        client = FakeGmailClient()
        self.tool._send_request(self.cfg, client, self.conn, ACCOUNT,
                                self.request(), dry_run=True)
        self.send(client, self.request())
        self.assertEqual(len(client.sends), 1)



class DailyCapTest(MailboxTestCase):
    """HC-02: each mailbox sends at most its daily cap of cold email -- 35 by
    default, set per mailbox between 10 and 50 in the app (this machine's
    settings.local.json). A reply to somebody who has written back is never
    held: the cap is about cold email, and an interested creator waiting on an
    answer is the opposite of cold."""

    def setUp(self):
        super().setUp()
        from tools import email_send

        self.tool = email_send

    def cfg(self, mailboxes=None):
        settings = {"mailboxes": mailboxes} if mailboxes is not None else {}
        return type("Cfg", (), {"outreach_label": "Gratovo Outreach",
                                "settings": settings})()

    def first_email(self, cfg, client, n):
        return self.tool._send_request(cfg, client, self.conn, ACCOUNT, {
            "conversationKey": f"conv-{n}",
            "to": f"creator{n}@example.com",
            "subject": "Collaboration",
            "body": "Hello there.",
            "sendKey": f"sk-{n}",
        })

    def test_the_cap_comes_from_this_machines_settings(self):
        cfg = self.cfg({ACCOUNT: {"daily_cap": 10}})
        client = FakeGmailClient()
        for n in range(10):
            self.first_email(cfg, client, n)

        with self.assertRaises(self.tool.ToolError) as caught:
            self.first_email(cfg, client, 10)

        self.assertEqual(caught.exception.code, "daily_cap_reached")
        self.assertIn("10", caught.exception.message)
        self.assertEqual(len(client.sends), 10, "the eleventh never left")
        # The refused key is free again: tomorrow, or after the cap is raised,
        # the same scheduled send goes out instead of reading as uncertain.
        raised = self.cfg({ACCOUNT: {"daily_cap": 11}})
        self.first_email(raised, client, 10)
        self.assertEqual(len(client.sends), 11)

    def test_35_by_default_and_never_outside_10_to_50(self):
        limits = self.tool.mailbox_limits
        self.assertEqual(limits(self.cfg(), ACCOUNT)["dailyCap"], 35)
        self.assertEqual(limits(self.cfg({ACCOUNT: {"daily_cap": 400}}), ACCOUNT)["dailyCap"], 50)
        self.assertEqual(limits(self.cfg({ACCOUNT: {"daily_cap": 2}}), ACCOUNT)["dailyCap"], 10)
        self.assertEqual(limits(self.cfg({ACCOUNT: {"daily_cap": "x"}}), ACCOUNT)["dailyCap"], 35)
        # Addresses are matched without regard to case, as Gmail does.
        self.assertEqual(limits(self.cfg({ACCOUNT.upper(): {"daily_cap": 20}}), ACCOUNT)["dailyCap"], 20)

    def test_a_reply_to_someone_who_wrote_back_is_never_held(self):
        cfg = self.cfg({ACCOUNT: {"daily_cap": 10}})
        client = FakeGmailClient()
        self.open_conversation()
        # What the reply sweep records when they answer.
        self.conn.execute(
            "UPDATE conversations SET reply_seen_at = ? WHERE conversation_key = ?",
            (mailbox.now(), KEY))
        self.conn.commit()
        for n in range(10):
            self.first_email(cfg, client, n)

        self.tool._send_request(cfg, client, self.conn, ACCOUNT, {
            "conversationKey": KEY, "to": "creator@example.com",
            "subject": "", "body": "Great, here are the details."})

        self.assertEqual(client.sends[-1]["body"].splitlines()[0], "Great, here are the details.")

    def test_yesterdays_email_does_not_count(self):
        cfg = self.cfg({ACCOUNT: {"daily_cap": 10}})
        for n in range(10):
            self.conn.execute(
                "INSERT INTO sent_messages (gmail_message_id, conversation_key, account, step_no, recipient, sent_at) "
                "VALUES (?, ?, ?, 0, ?, ?)", (f"old{n}", f"old-{n}", ACCOUNT, "x@y.z", "2000-01-01T09:00:00Z"))
        self.conn.commit()
        client = FakeGmailClient()
        self.first_email(cfg, client, 1)
        self.assertEqual(len(client.sends), 1)

    def test_status_reports_what_is_left_today_and_the_warm_up(self):
        cfg = self.cfg({ACCOUNT: {"daily_cap": 12, "warmup_started_on": "2026-10-01"}})
        client = FakeGmailClient()
        for n in range(3):
            self.first_email(cfg, client, n)

        limits = self.tool.cap_status(cfg, self.conn, ACCOUNT)

        self.assertEqual(limits["dailyCap"], 12)
        self.assertEqual(limits["sentToday"], 3)
        self.assertEqual(limits["leftToday"], 9)
        self.assertEqual(limits["warmupStartedOn"], "2026-10-01")


if __name__ == "__main__":
    unittest.main(verbosity=2)
