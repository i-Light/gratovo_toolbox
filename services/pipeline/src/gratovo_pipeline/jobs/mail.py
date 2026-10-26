"""The mail jobs: mail.status, mail.send, mail.replies, mail.ack, mail.cancel and mail.import.

The policy between Gmail (`mail/gmail.py`) and the mailbox's own memory (`mail/mailbox.py`),
ported from the old `tools/email_send.py`. What has to stay true:

- **Nothing goes out without a person's click.** Only `mail.send` ever sends, one message, and it
  carries `approvedBy` (who pressed Send). `mail.replies` only looks for replies; a follow-up an
  old file still has queued is cancelled there, never sent.
- **Nothing is sent twice.** The `sendKey` is claimed before Gmail is asked and marked sent in the
  same commit that files the message. A retried key that went out is answered with the original
  send (`duplicate`); one whose earlier attempt never reported back is refused (`send_uncertain`):
  only a person looking at the Sent folder can settle that.
- **A reply is reported until the app says it landed.** Every reply not yet acknowledged goes out
  as a `reply` line on each sweep, until `mail.ack` names it.
- **The daily cap** (house choice HC-02): each mailbox sends at most its cap of cold email a day
  (35 unless Settings says otherwise, always 10 to 50). A message to somebody who has written back
  is never held.
- **An old mailbox comes in quiet** (`mail.import`, step 6e, D19). The old app's mailbox.db is
  merged in read-only, its rows never replacing ours. Its queued follow-ups are left out, and the
  conversations it adds are stamped checked (and closed when nothing came back in 60 days), so the
  sweep never stalls on them.

How a job ends: `done` after its `result`; a mail error ends `failed` with its code (plan "Mail
error mapping"); anything else ends `failed` with `crash`, naming the error's kind only, since an
error's text can carry an address or a token. No line carries a token or the client secret, and no
`log` line carries a message's or a reply's body. A stop line is not watched: each job is a few
calls, and a send is one that must not be cut in half.
"""

from __future__ import annotations

import sqlite3
import sys
import time
from collections.abc import Collection, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Final, Protocol

from gratovo_pipeline.mail import gmail, mailbox
from gratovo_pipeline.protocol import (
    REPLIES_LIMIT,
    Emitter,
    EndErrorCode,
    MailAccountStatus,
    MailAccountSweep,
    MailCancelData,
    MailImportData,
    MailRepliesJob,
    MailSecrets,
    MailSendData,
    MailStatusData,
    OutgoingMail,
    Settings,
    Start,
)
from gratovo_pipeline.protocol import MailError as MailErrorData

DB_NAME: Final = "mailbox.db"
DEFAULT_LABEL: Final = "Gratovo Outreach"
DEFAULT_DAILY_CAP: Final = 35
DAILY_CAP_MIN: Final = 10
DAILY_CAP_MAX: Final = 50

_ANOTHER_ADDRESS: Final = (
    "The saved login belongs to another address. Reconnect the mailbox in Settings."
)
_GMAIL_ID_CHARS: Final = frozenset(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"
)


class MailClient(Protocol):
    """What the jobs use of `gmail.GmailClient`."""

    @property
    def address(self) -> str: ...

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
    ) -> gmail.SendResult: ...

    def replies(
        self, thread_id: str, *, exclude_ids: Collection[str] = ()
    ) -> list[gmail.Reply]: ...


class Connect(Protocol):
    """`gmail.connect`'s shape: a live client for one mailbox."""

    def __call__(
        self,
        *,
        client_id: str,
        client_secret: str,
        refresh_token: str,
        sender_name: str | None = None,
    ) -> MailClient: ...


class _EndError(Exception):
    def __init__(self, code: EndErrorCode, message: str) -> None:
        super().__init__(message)
        self.code: EndErrorCode = code
        self.message = message


class _Mail:
    """One job's mail context: the settings, the secrets and how to connect."""

    def __init__(self, start: Start, connect: Connect, today_start: str | None) -> None:
        self.settings: Settings = start["settings"]
        mail = self.settings.get("mail")
        self.label = (mail["label"] if mail else "").strip() or DEFAULT_LABEL
        self.sender_name = ((mail["senderName"] if mail else None) or "").strip() or None
        self.secrets: MailSecrets | None = start["secrets"].get("mail")
        self.db_path = Path(start["dataDir"]) / DB_NAME
        self._connect = connect
        self._today_start = today_start

    @property
    def configured(self) -> bool:
        return bool(self._connected())

    def _connected(self) -> list[str]:
        """The connected mailboxes, lower-cased, in the order the settings list them. The
        address a line reports is never read out of the secrets (ADR 0015 §8); `parse_start`
        makes sure every connected mailbox is listed in the settings."""
        mail = self.settings.get("mail")
        listed = [e["address"].strip().lower() for e in mail["mailboxes"]] if mail else []
        return [a for a in dict.fromkeys(listed) if self._refresh_token(a) is not None]

    def _refresh_token(self, account: str) -> str | None:
        for box in self.secrets["mailboxes"] if self.secrets else []:
            if box["address"].strip().lower() == account:
                return box["refreshToken"]
        return None

    def mailboxes(self) -> list[str]:
        """The connected mailboxes' accounts: the key their rows have in the store."""
        accounts = self._connected()
        if not accounts:
            raise _EndError(
                "mail_not_connected", "No mailbox is connected. Connect one in Settings."
            )
        return accounts

    def named(self, wanted: str) -> str:
        """The mailbox `wanted` names, matched without regard to case as Gmail does."""
        for account in self.mailboxes():
            if account == wanted.strip().lower():
                return account
        raise _EndError(
            "mail_not_connected", "That mailbox isn't connected. Connect it in Settings."
        )

    def connect(self, account: str) -> MailClient:
        """A live client for `account`, checked to be the address it was saved as."""
        secrets = self.secrets
        token = self._refresh_token(account)
        if secrets is None or token is None:
            raise _EndError(
                "mail_not_connected", "That mailbox isn't connected. Connect it in Settings."
            )
        client = self._connect(
            client_id=secrets["client"]["id"],
            client_secret=secrets["client"]["secret"],
            refresh_token=token,
            sender_name=self.sender_name,
        )
        if client.address.strip().lower() != account:
            raise gmail.MailAuthError(_ANOTHER_ADDRESS)
        return client

    def cap_status(self, conn: sqlite3.Connection, account: str) -> tuple[int, str | None, int]:
        """The cap, the warm-up start and how many cold emails today has sent."""
        cap, warmup = mailbox_limits(self.settings, account)
        day = self._today_start or local_day_start()
        return cap, warmup, mailbox.cold_sent_since(conn, account, day)


def mailbox_limits(settings: Settings, account: str) -> tuple[int, str | None]:
    """A mailbox's daily cap (35 unless Settings says otherwise, always 10 to 50) and the day its
    warm-up started. Addresses match without regard to case, as Gmail's do."""
    mail = settings.get("mail")
    for entry in mail["mailboxes"] if mail else []:
        if entry["address"].strip().lower() == account.strip().lower():
            cap = max(DAILY_CAP_MIN, min(DAILY_CAP_MAX, entry["dailyCap"]))
            return cap, entry["warmupStartedOn"]
    return DEFAULT_DAILY_CAP, None


def local_day_start() -> str:
    """This machine's midnight as the UTC stamp `mailbox.now()` writes: "a day" for the cap is
    the sender's day, not Greenwich's."""
    midnight = datetime.now().astimezone().replace(hour=0, minute=0, second=0, microsecond=0)
    return midnight.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def sweep_state_key(account: str) -> str:
    """This mailbox's own `last swept` stamp, so several mailboxes don't share one."""
    return f"{mailbox.LAST_SWEEP_KEY}:{account}"


def compose_labels(base_label: str, labels: Sequence[str]) -> list[str]:
    """The Gmail labels for a send: the parent, then one nested label per path the app sent
    (`["Influencers", "Stage/Contacted"]`), so the parent is defined in one place."""
    base = base_label.strip()
    found = [base] if base else []
    for raw in labels:
        path = raw.strip().strip("/")
        if path and base:
            found.append(f"{base}/{path}")
    return list(dict.fromkeys(found))


def _open(path: Path) -> sqlite3.Connection:
    try:
        return mailbox.open_db(path)
    except mailbox.MailboxTooNewError:
        raise _EndError("crash", "mailbox.db was written by a newer version of the app.") from None


def _error_data(error: BaseException) -> MailErrorData:
    """An account's failure as data. Anything not a mail error is named by its kind only."""
    if isinstance(error, gmail.MailError):
        if error.code == "mail_auth":
            return {"code": "mail_auth", "message": error.message}
        if error.code == "network":
            return {"code": "network", "message": error.message}
        return {"code": "mail_api", "message": error.message}
    print(f"mail account check failed: {type(error).__name__}", file=sys.stderr, flush=True)
    return {
        "code": "mail_api",
        "message": f"The check stopped on an unexpected error ({type(error).__name__}).",
    }


# --- mail.status ---


def _status(mail: _Mail, emitter: Emitter) -> None:
    data: MailStatusData = {
        "configured": mail.configured,
        "label": mail.label,
        "senderName": mail.sender_name,
        "accounts": [],
    }
    if mail.configured:
        conn = _open(mail.db_path)
        try:
            data["accounts"] = [_account_status(mail, conn, a) for a in mail.mailboxes()]
        finally:
            conn.close()
    emitter.result("mail.status", data)


def _account_status(mail: _Mail, conn: sqlite3.Connection, account: str) -> MailAccountStatus:
    """One mailbox: a live check plus its numbers. Never raises: a lapsed token on one mailbox
    must not stop the others from reporting, so the failure is this entry's `error`."""
    entry: MailAccountStatus = {
        "account": account,
        "connected": False,
        "counters": None,
        "limits": None,
        "lastSweepAt": None,
        "error": None,
    }
    try:
        mail.connect(account)
        counters = mailbox.counters(conn, account)
        cap, warmup, sent = mail.cap_status(conn, account)
        entry["connected"] = True
        entry["counters"] = {
            "conversations": counters["conversations"],
            "sent": counters["sent"],
            "awaitingReply": counters["awaitingReply"],
            "replied": counters["replied"],
            "pendingSteps": counters["pendingSteps"],
            "dueSteps": counters["dueSteps"],
            "failedSteps": counters["failedSteps"],
            "unreportedReplies": counters["unreportedReplies"],
        }
        entry["limits"] = {
            "dailyCap": cap,
            "warmupStartedOn": warmup,
            "sentToday": sent,
            "leftToday": max(0, cap - sent),
        }
        entry["lastSweepAt"] = mailbox.get_state(conn, sweep_state_key(account))
    except Exception as error:  # reported as data, see the docstring
        entry["error"] = _error_data(error)
    return entry


# --- mail.send ---


def _send(mail: _Mail, message: OutgoingMail, emitter: Emitter) -> None:
    if not message["body"].strip():
        raise _EndError("bad_start", "The message body is empty.")
    wanted = message.get("mailbox")
    if wanted is not None:
        account = mail.named(wanted)
    else:
        accounts = mail.mailboxes()
        if len(accounts) > 1:
            raise _EndError(
                "bad_start", "More than one mailbox is connected: say which one sends this message."
            )
        account = accounts[0]
    conn = _open(mail.db_path)
    try:
        client = mail.connect(account)
        data = _send_request(mail, client, conn, account, message)
    finally:
        conn.close()
    emitter.result("mail.send", data)


def _send_request(
    mail: _Mail,
    client: MailClient,
    conn: sqlite3.Connection,
    account: str,
    message: OutgoingMail,
) -> MailSendData:
    """Sends one approved message through `client` (the old `_send_request`)."""
    recipient = message["to"].strip()
    body = message["body"]
    key = message.get("conversationKey") or mailbox.new_conversation_key()
    send_key = message["sendKey"]
    approved_by = message["approvedBy"]

    claimed = mailbox.claim_send_key(
        conn, send_key, account=account, conversation_key=key, approved_by=approved_by
    )
    if claimed is not None:
        return _already_sent(conn, claimed, recipient=recipient)

    try:
        _check_cap(mail, conn, account, key)
    except _EndError:
        # Nothing went out, so the key is free for the same message to go tomorrow rather than
        # reading as uncertain forever.
        mailbox.release_send_key(conn, send_key)
        raise

    # Stored comma-joined so a later message in the conversation files under the same labels.
    labels = compose_labels(mail.label, message.get("labels", []))
    mailbox.upsert_conversation(
        conn,
        conversation_key=key,
        account=account,
        recipient=recipient,
        subject=message["subject"] or None,
        label=",".join(labels) or mail.label,
        channel_id=message.get("channelId"),
    )
    conversation = mailbox.get_conversation(conn, key, account)

    # Continue the existing thread unless told to start a new one: a second message to the same
    # channel lands in the conversation rather than beside it.
    thread_id: str | None = None
    in_reply_to: str | None = None
    subject = message["subject"]
    if (
        not message.get("newThread", False)
        and conversation is not None
        and conversation["gmail_thread_id"]
    ):
        thread_id = str(conversation["gmail_thread_id"])
        in_reply_to = conversation["last_rfc_id"]
        subject = subject or gmail.reply_subject(conversation["subject"] or "")

    try:
        result = client.send(
            to=recipient,
            subject=subject,
            body=body,
            labels=labels,
            thread_id=thread_id,
            in_reply_to=in_reply_to,
        )
    except gmail.MailError as error:
        # Gmail refused: nothing went out, so the same key may try again. When Google couldn't
        # be reached, failed with a 5xx, or answered without a readable id, the message may
        # have gone: the claim
        # stays, and a retry is refused as uncertain. (So does a process killed in the call.)
        if _refused(error):
            mailbox.release_send_key(conn, send_key)
        raise
    step_no = 0 if not thread_id else mailbox.highest_step_no(conn, key, account)
    sent_at = mailbox.record_send(
        conn,
        conversation_key=key,
        account=account,
        result=result,
        recipient=recipient,
        subject=subject,
        body=body,
        step_no=step_no,
        send_key=send_key,
        approved_by=approved_by,
    )
    # Nothing is queued behind a send: nothing leaves without a person's click.
    return {
        "duplicate": False,
        "account": account,
        "conversationKey": key,
        "messageId": result["messageId"],
        "threadId": result["threadId"],
        "rfcMessageId": result["rfcMessageId"],
        "labelled": bool(result["labelId"]),
        "threaded": bool(thread_id),
        "to": recipient,
        "subject": subject,
        "sentAt": sent_at,
    }


def _refused(error: gmail.MailError) -> bool:
    """Whether Gmail said no outright, or was never reached, so the message certainly didn't go."""
    if isinstance(error, gmail.MailUnreachableError):
        return True
    if isinstance(error, gmail.MailNetworkError):
        return False
    if isinstance(error, gmail.MailApiError):
        # No status: Gmail answered, but not readably. A 5xx: Gmail may have taken the message
        # before it failed.
        return error.status is not None and error.status < 500
    return True


def _check_cap(mail: _Mail, conn: sqlite3.Connection, account: str, key: str) -> None:
    """Refuses a cold message once today's cap is used. A conversation whose other side has
    written back is never held."""
    conversation = mailbox.get_conversation(conn, key, account)
    if conversation is not None and conversation["reply_seen_at"]:
        return
    cap, _warmup, sent = mail.cap_status(conn, account)
    if cap - sent <= 0:
        raise _EndError(
            "daily_cap_reached",
            f"{account} has sent its {cap} cold emails for today (the daily cap set in "
            "Settings). It can send again tomorrow, or raise the cap there (10-50).",
        )


def _already_sent(
    conn: sqlite3.Connection, claimed: sqlite3.Row, *, recipient: str
) -> MailSendData:
    """The answer to a key claimed before: the original send, or a refusal when nobody knows
    whether it went out."""
    if claimed["state"] != mailbox.SEND_KEY_SENT or not claimed["gmail_message_id"]:
        raise _EndError(
            "send_uncertain",
            "An earlier attempt to send this message stopped before Gmail answered, so it may "
            "already have gone out. Check the Sent folder before sending it again.",
        )
    message_id = str(claimed["gmail_message_id"])
    sent = mailbox.sent_message(conn, message_id)
    return {
        "duplicate": True,
        "account": str(claimed["account"]),
        "conversationKey": str(claimed["conversation_key"]),
        "messageId": message_id,
        "threadId": sent["gmail_thread_id"] if sent else None,
        "rfcMessageId": sent["rfc_message_id"] if sent else None,
        # Not recorded at the time; the original send's answer said.
        "labelled": False,
        "threaded": False,
        "to": (sent["recipient"] if sent else None) or recipient,
        "subject": sent["subject"] if sent else None,
        "sentAt": str(claimed["sent_at"] or (sent["sent_at"] if sent else "")),
    }


# --- mail.replies ---


def _replies(mail: _Mail, job: MailRepliesJob, emitter: Emitter) -> None:
    wanted = job.get("mailbox")
    accounts = mail.mailboxes() if wanted is None else [mail.named(wanted)]
    limit = job.get("limit", REPLIES_LIMIT)
    conn = _open(mail.db_path)
    try:
        accounts = [
            _sweep_account(mail, conn, account, job.get("conversationKey"), limit, emitter)
            for account in accounts
        ]
    finally:
        conn.close()
    emitter.result("mail.replies", {"accounts": accounts})


def _sweep_account(
    mail: _Mail,
    conn: sqlite3.Connection,
    account: str,
    conversation_key: str | None,
    limit: int,
    emitter: Emitter,
) -> MailAccountSweep:
    """One mailbox's sweep (the old `cmd_run_due`). Never raises: one failing mailbox is
    reported in its entry and the others go on."""
    entry: MailAccountSweep = {
        "account": account,
        "checked": 0,
        "replies": 0,
        "cancelledQueued": 0,
        "error": None,
    }
    try:
        client = mail.connect(account)
        cancelled, entry["checked"] = _sweep_replies(
            client, conn, account, conversation_key=conversation_key, limit=limit, emitter=emitter
        )
        entry["cancelledQueued"] = _cancel_queued(conn, account)
        mailbox.set_state(conn, sweep_state_key(account), mailbox.now())
        # Handed over but not marked reported: the app acknowledges each one with mail.ack once it
        # is recorded, so an app that dies mid-apply sees the reply again.
        entry["replies"] = _report_unacknowledged(
            conn, account, conversation_key=conversation_key, cancelled=cancelled, emitter=emitter
        )
    except Exception as error:  # reported as data, see the docstring
        entry["error"] = _error_data(error)
    return entry


def _sweep_replies(
    client: MailClient,
    conn: sqlite3.Connection,
    account: str,
    *,
    conversation_key: str | None = None,
    limit: int = REPLIES_LIMIT,
    emitter: Emitter | None = None,
) -> tuple[dict[str, int], int]:
    """Asks Gmail about each open conversation and files anything new (the old
    `_sweep_replies`). Returns the follow-ups cancelled per conversation that had a reply, and
    how many conversations were checked. A thread lookup that fails is skipped: one deleted
    thread must not stop the sweep that would have found four replies after it."""
    if conversation_key:
        row = mailbox.get_conversation(conn, conversation_key, account)
        rows = [row] if row is not None and row["gmail_thread_id"] else []
    else:
        rows = mailbox.open_conversations(conn, account, limit=limit)

    cancelled: dict[str, int] = {}
    checked = 0
    for conversation in rows:
        checked += 1
        key = str(conversation["conversation_key"])
        mailbox.mark_checked(conn, key, account)
        try:
            incoming = client.replies(
                str(conversation["gmail_thread_id"]),
                exclude_ids=mailbox.sent_message_ids(conn, key, account),
            )
        except gmail.MailError as error:
            if emitter is not None:
                emitter.log("warn", f"A conversation's thread couldn't be read ({error.code}).")
            continue
        if not incoming:
            continue
        mailbox.record_replies(conn, key, account, list(incoming))
        # Bookkeeping, not enforcement: `due_steps` already refuses a replied conversation. This
        # makes the cancellation visible, so the app can say what it stopped.
        cancelled[key] = mailbox.cancel_steps(conn, key, account, reason="replied")
        # Not closed: the conversation leaves the sweep until the team writes again, and then the
        # creator's next answer is found too.
    return cancelled, checked


def _report_unacknowledged(
    conn: sqlite3.Connection,
    account: str,
    *,
    conversation_key: str | None,
    cancelled: dict[str, int],
    emitter: Emitter,
) -> int:
    """Writes a `reply` line for each reply not yet acknowledged; returns how many."""
    first_ids: dict[str, str | None] = {}
    channels: dict[str, str | None] = {}
    reported = 0
    for row in mailbox.unreported_replies(conn, account, conversation_key=conversation_key):
        message_id = str(row["gmail_message_id"])
        if not (1 <= len(message_id) <= 64 and set(message_id) <= _GMAIL_ID_CHARS):
            continue  # not a Gmail id: nothing could acknowledge it
        key = str(row["conversation_key"])
        if key not in first_ids:
            first_ids[key] = _first_reply_id(conn, key, account)
            conversation = mailbox.get_conversation(conn, key, account)
            channels[key] = conversation["channel_id"] if conversation is not None else None
        emitter.reply(
            account=account,
            conversation_key=key,
            channel_id=channels[key],
            message_id=message_id,
            sender=row["from_address"] or "",
            sender_name=row["from_name"],
            subject=row["subject"] or "",
            body=row["body"] or "",
            received_at=row["received_at"] or row["seen_at"],
            # The app turns the FIRST reply into "interested" on the channel; a later one must
            # not re-run that.
            is_first_reply=message_id == first_ids[key],
            # The follow-ups this sweep stopped, on the conversation's first line only.
            cancelled_follow_ups=cancelled.pop(key, 0),
        )
        reported += 1
    return reported


def _first_reply_id(conn: sqlite3.Connection, key: str, account: str) -> str | None:
    """The conversation's earliest reply."""
    row = conn.execute(
        "SELECT gmail_message_id FROM inbound_messages "
        " WHERE conversation_key = ? AND account = ? "
        " ORDER BY COALESCE(received_at, seen_at), seen_at, gmail_message_id LIMIT 1",
        (key, account),
    ).fetchone()
    return str(row["gmail_message_id"]) if row is not None else None


def _cancel_queued(conn: sqlite3.Connection, account: str) -> int:
    """Cancels every follow-up an old file still has queued; returns how many. Nothing is
    sent: a follow-up leaves only on a person's click."""
    rows = conn.execute(
        "SELECT DISTINCT conversation_key FROM sequence_steps WHERE account = ? AND state = ?",
        (account, mailbox.STATE_PENDING),
    ).fetchall()
    return sum(
        mailbox.cancel_steps(
            conn, str(row["conversation_key"]), account, reason="automatic follow-ups removed"
        )
        for row in rows
    )


# --- mail.ack and mail.cancel: the store only, no secrets and no request ---


def _ack(mail: _Mail, message_ids: list[str], emitter: Emitter) -> None:
    conn = _open(mail.db_path)
    try:
        acknowledged = mailbox.mark_reported(conn, message_ids)
    finally:
        conn.close()
    emitter.result("mail.ack", {"acknowledged": acknowledged})


def _cancel(mail: _Mail, conversation_key: str, emitter: Emitter) -> None:
    """Stops one conversation in every mailbox that has it: somebody who has spoken to a creator
    another way can stop the emails without waiting for a reply that won't come by email."""
    conn = _open(mail.db_path)
    try:
        rows = conn.execute(
            "SELECT DISTINCT account FROM conversations WHERE conversation_key = ?",
            (conversation_key,),
        ).fetchall()
        data: MailCancelData = {"cancelled": 0, "closed": bool(rows)}
        for row in rows:
            account = str(row["account"])
            data["cancelled"] += mailbox.cancel_steps(
                conn, conversation_key, account, reason="cancelled"
            )
            mailbox.close_conversation(conn, conversation_key, account)
    finally:
        conn.close()
    emitter.result("mail.cancel", data)


# --- mail.import: the old app's mailbox.db merged in (step 6e, D19); no secrets, no request ---

# The tables merged. `sequence_steps` is left out: nothing old may ever be sent, and a follow-up
# that isn't there can't be. `mailbox_state` is this mailbox's own bookkeeping (when it last swept).
IMPORTED_TABLES: Final = ("conversations", "sent_messages", "inbound_messages", "send_keys")
# A conversation the merge adds is closed when nothing came back and its last email is older than
# this: nobody is waiting on it, so the sweep shouldn't spend its 60 a run asking Gmail about it.
STALE_AFTER_DAYS: Final = 60


def _q(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _open_for_import(path: Path) -> sqlite3.Connection:
    """mailbox.db as `_open` gives it, on a connection that reads URIs (so the old file can be
    attached read-only and immutable) and leaves the transaction to the caller."""
    path.parent.mkdir(parents=True, exist_ok=True)
    # With uri=True a plain path still opens as a path; only a `file:` name is read as a URI.
    conn = sqlite3.connect(path, uri=True, isolation_level=None)
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute(f"PRAGMA busy_timeout={mailbox.BUSY_TIMEOUT_MS}")
        conn.row_factory = sqlite3.Row
        mailbox.init_db(conn)
    except mailbox.MailboxTooNewError:
        conn.close()
        raise _EndError("crash", "mailbox.db was written by a newer version of the app.") from None
    except BaseException:
        conn.close()
        raise
    return conn


def _columns(conn: sqlite3.Connection, schema: str, table: str) -> list[tuple[str, int]]:
    """(name, primary-key position) of each column; empty when there is no such table."""
    rows = conn.execute(f"PRAGMA {schema}.table_info({_q(table)})").fetchall()
    return [(str(row[1]), int(row[5])) for row in rows]


def _merge_table(conn: sqlite3.Connection, table: str) -> int:
    """Adds the old file's rows of `table` that this one hasn't got, column by column for the
    columns both have; a row already here wins. Returns how many were added."""
    old = {name for name, _ in _columns(conn, "old", table)}
    mine = _columns(conn, "main", table)
    keys = [name for name, position in mine if position]
    # Without its whole key a row can't be told from one already here, so it can't come in once.
    if not old or not set(keys) <= old:
        return 0
    shared = ", ".join(_q(name) for name, _ in mine if name in old)
    # SQLite lets a TEXT primary key be NULL: such a row would come in again on every run.
    present = " AND ".join(f"{_q(key)} IS NOT NULL" for key in keys)
    cursor = conn.execute(
        f"INSERT OR IGNORE INTO main.{_q(table)} ({shared}) "  # noqa: S608 - names quoted, from PRAGMA
        f"SELECT {shared} FROM old.{_q(table)} WHERE {present}"
    )
    return max(cursor.rowcount, 0)


def _import(mail: _Mail, source: str, emitter: Emitter) -> None:
    """Merges the old app's mailbox.db into this one in one transaction. The old file is opened
    read-only and immutable, so it is never written and gets no -wal or -shm beside it."""
    # The import's own checks of an old file (`import.legacy`), so both refuse the same files.
    from gratovo_pipeline.jobs import import_legacy as legacy  # only this job needs it

    try:
        old_file = legacy._check_source(Path(source), mail.db_path.parent)  # pyright: ignore[reportPrivateUsage]
    except legacy._EndError as error:  # pyright: ignore[reportPrivateUsage]
        raise _EndError(error.code, error.message) from None
    conn = _open_for_import(mail.db_path)
    try:
        try:
            old_uri = legacy._old_uri(old_file)  # pyright: ignore[reportPrivateUsage]
            conn.execute("ATTACH DATABASE ? AS old", (old_uri,))
            tables = {
                str(row[0])
                for row in conn.execute("SELECT name FROM old.sqlite_master WHERE type = 'table'")
            }
            version = int(conn.execute("PRAGMA old.user_version").fetchone()[0])
        except sqlite3.DatabaseError:
            raise _EndError("not_sqlite", "That file isn't a SQLite database.") from None
        if "conversations" not in tables:
            raise _EndError(
                "no_conversations_table", "That file isn't a mailbox: it has no conversations."
            )
        if version > mailbox.SCHEMA_VERSION:
            raise _EndError(
                "source_too_new", "The old mailbox.db was written by a newer version of the app."
            )
        data = _merge(conn)
    finally:
        conn.close()
    emitter.result("mail.import", data)


def _merge(conn: sqlite3.Connection) -> MailImportData:
    stamp = mailbox.now()
    cutoff = time.strftime(
        "%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - STALE_AFTER_DAYS * 86_400)
    )
    conn.execute("BEGIN IMMEDIATE")
    try:
        # A new row's rowid is past every old one's, so this tells the rows the merge adds.
        before = int(
            conn.execute("SELECT COALESCE(MAX(rowid), 0) FROM conversations").fetchone()[0]
        )
        added = {table: _merge_table(conn, table) for table in IMPORTED_TABLES}
        # The sweep asks about never-checked conversations first: without a stamp, hundreds of old
        # ones would hold the front of the queue for days.
        conn.execute("UPDATE conversations SET checked_at = ? WHERE rowid > ?", (stamp, before))
        closed = conn.execute(
            "UPDATE conversations SET closed_at = ? "
            " WHERE rowid > ? AND closed_at IS NULL AND reply_seen_at IS NULL "
            "   AND (last_sent_at IS NULL OR last_sent_at < ?)",
            (stamp, before, cutoff),
        ).rowcount
        conn.execute("COMMIT")
    except BaseException:
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        raise
    return {
        "conversations": added["conversations"],
        "sent": added["sent_messages"],
        "inbound": added["inbound_messages"],
        "closed": max(closed, 0),
    }


# --- the job ---


def _fail(emitter: Emitter, code: EndErrorCode, message: str) -> None:
    emitter.end(state="failed", at=0, found=0, kept=0, error=(code, message))


def run(
    start: Start,
    emitter: Emitter,
    *,
    connect: Connect | None = None,
    today_start: str | None = None,
) -> None:
    """Runs the mail job and always ends with an `end` line. `connect` replaces `gmail.connect`
    and `today_start` the local midnight the cap counts from (both for tests)."""
    job = start["job"]
    mail = _Mail(start, connect or gmail.connect, today_start)
    try:
        if job["kind"] == "mail.status":
            _status(mail, emitter)
        elif job["kind"] == "mail.send":
            _send(mail, job["message"], emitter)
        elif job["kind"] == "mail.replies":
            _replies(mail, job, emitter)
        elif job["kind"] == "mail.ack":
            _ack(mail, job["messageIds"], emitter)
        elif job["kind"] == "mail.cancel":
            _cancel(mail, job["conversationKey"], emitter)
        elif job["kind"] == "mail.import":
            _import(mail, job["source"], emitter)
        else:
            raise _EndError("crash", "This is not a mail job.")
    except _EndError as error:
        _fail(emitter, error.code, error.message)
        return
    except gmail.MailError as error:
        _fail(emitter, error.code, error.message)
        return
    except Exception as error:  # every way out ends with `end`
        # The kind only: an error's text can carry an address or a token.
        print(f"mail job crashed: {type(error).__name__}", file=sys.stderr, flush=True)
        _fail(
            emitter,
            "crash",
            f"The mail job stopped on an unexpected error ({type(error).__name__}).",
        )
        return
    emitter.end(state="done", at=0, found=0, kept=0)
