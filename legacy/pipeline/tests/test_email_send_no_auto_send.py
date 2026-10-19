"""Nothing leaves the mailbox without a person's click (owner decision, step 1).

Older builds armed follow-ups behind every Gmail send and `--run-due` sent
them on a schedule. Now `--run-due` only looks for replies: a follow-up still
queued from an older build is cancelled, never sent, and `--send` queues none.
"""

import argparse
import contextlib
import io
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from gratovo import mailbox  # noqa: E402
from test_mailbox import ACCOUNT, KEY, FakeGmailClient, MailboxTestCase, reply  # noqa: E402


class _KeepOpen:
    """The test's connection, which `cmd_run_due` closes when it is done."""

    def __init__(self, conn):
        self._conn = conn

    def close(self):
        pass

    def __getattr__(self, name):
        return getattr(self._conn, name)


class NoAutomaticSendTest(MailboxTestCase):
    def setUp(self):
        super().setUp()
        from tools import email_send

        self.tool = email_send
        self.cfg = type("Cfg", (), {"outreach_label": "Gratovo Outreach"})()

    def run_due(self, client, **flags):
        self.tool._connect = lambda cfg, account=None: (client, _KeepOpen(self.conn), ACCOUNT)
        args = argparse.Namespace(account=None, no_check=False, no_send=False,
                                  conversation=None, limit=None, ack_now=False)
        for name, value in flags.items():
            setattr(args, name, value)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = self.tool.cmd_run_due(self.cfg, self.tool.Reporter(True), args)
        return code, json.loads(out.getvalue())

    def tearDown(self):
        import importlib
        importlib.reload(self.tool)  # undo the patched _connect
        super().tearDown()

    def test_run_due_never_sends_a_queued_follow_up(self):
        self.open_conversation()
        self.queue(count=2)  # due long ago, no reply: older builds sent these
        client = FakeGmailClient()

        code, payload = self.run_due(client)

        self.assertEqual(code, 0)
        self.assertEqual(client.sends, [], "nothing is sent without a click")
        self.assertEqual(payload["sent"], [])
        self.assertEqual(payload["cancelledQueued"], 2)
        self.assertEqual(mailbox.pending_steps(self.conn, ACCOUNT), [])

    def test_run_due_still_reports_replies(self):
        self.open_conversation()
        client = FakeGmailClient(thread_replies={"t1": [reply()]})

        _, payload = self.run_due(client)

        self.assertEqual(len(payload["replies"]), 1)
        self.assertEqual(payload["replies"][0]["conversationKey"], KEY)
        self.assertEqual(client.sends, [])

    def test_a_send_queues_no_follow_ups(self):
        client = FakeGmailClient()
        result = self.tool._send_request(self.cfg, client, self.conn, ACCOUNT, {
            "conversationKey": KEY,
            "to": "creator@example.com",
            "subject": "Collaboration",
            "body": "Hello there.",
            "followUps": [{"delayDays": 3, "body": "Chasing."}],
        })

        self.assertEqual(len(client.sends), 1)
        self.assertEqual(result["followUps"], [])
        self.assertEqual(mailbox.pending_steps(self.conn, ACCOUNT), [])
