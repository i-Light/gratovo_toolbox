#!/usr/bin/env python3
"""Sends outreach email, chases it, and notices when somebody answers.

    python tools/email_send.py --status
    python tools/email_send.py --authorize --save
    python tools/email_send.py --sign-out
    python tools/email_send.py --send --payload send.json
    python tools/email_send.py --send --to a@b.com --subject Hi --body-file draft.txt
    python tools/email_send.py --run-due
    python tools/email_send.py --check-replies
    python tools/email_send.py --pending
    python tools/email_send.py --cancel --conversation <thread id>
    python tools/email_send.py --test-send --to me@example.com
    python tools/email_send.py --send --account a@b.com --payload send.json
    python tools/email_send.py --sign-out --account a@b.com

WHAT THIS IS FOR
----------------
The app's Outreach page used to end at a `mailto:` link and a "Mark as sent"
button: the message left through whatever mail client the machine happened to
have, and the CRM recorded that a human said they had sent something. That is
fine for one email and hopeless for a hundred -- nothing threads, nothing
chases, and a reply is only noticed if somebody happens to look.

This sends from the team's real Gmail mailbox when a person clicks Send, keeps
each conversation in one thread, and reports replies back to the app. It never
sends by itself: a follow-up is a message a person sends from the app, like
any other (owner decision, plan step 1). `gratovo/gmail.py` does the talking
to Gmail; `gratovo/mailbox.py` holds what has to survive the process; this file
is the policy in between and the JSON contract the Flutter app reads.

THE THINGS THAT HAVE TO BE TRUE
-------------------------------
**Nothing goes out without a click.** `--send` sends the one message it is
given and queues nothing behind it. `--run-due` only looks for replies; a
follow-up an older build queued in `mailbox.db` is cancelled there, never sent.

**Nothing is sent twice.** A message carrying a `sendKey` (the app always
passes one) is sent once across attempts: a retry of a key that already went
out is answered with the original send, `"duplicate": true`, and nothing is sent; a
key whose earlier attempt never reported back is refused as `send_uncertain`.

**A reply is reported until the app says it landed.** `--run-due` hands over
replies it has not been told were handled; the app calls `--ack` once each one
is recorded in the CRM. An app that dies mid-apply sees the reply again on the
next sweep rather than losing it.

THE DAILY CAP
-------------
Each mailbox sends at most its cap of cold email a day (house choice HC-02: 35
unless this machine's settings.local.json sets it, always within 10-50). Cold
means a first email or a follow-up to somebody who has not written back; a
reply to somebody who has is never held. A cold email over the cap is refused
as `daily_cap_reached`.

OUTPUT
------
With `--json` (which the app always passes) every command prints exactly one
JSON object on stdout and nothing else. Failures are `{"ok": false, "error":
{"code": ..., "message": ...}}` with a non-zero exit, EXCEPT `--status`, which
reports a broken or unconfigured mailbox as data and still exits 0 -- the app
asks it precisely in order to find that out, and an exit code cannot carry the
reason.

RUNNING IT WITHOUT THE APP
--------------------------
`--run-due` (and `--check-replies`) can run on a schedule to keep the reply
check current while nobody has the app open; it sends nothing. The app runs
the same check itself while it is open (see `outreach_inbox_controller.dart`).
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

# tools/ sits beside gratovo/, so the package is one level up.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# Same reasoning as search.py: Windows encodes print() with the machine's ANSI
# code page when stdout is a pipe, and the Flutter app reads exactly that pipe.
# A JSON document is worse than useless if a single character of it arrives
# undecodable.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    except (AttributeError, ValueError):
        pass

from gratovo import config, gmail, mailbox  # noqa: E402

# `--run-due` polls Gmail once per open conversation. On a mailbox with a few
# hundred live conversations that is a few hundred API calls per sweep, which
# is both slow and rude. The cap makes a sweep bounded work; conversations are
# swept oldest-first, so nothing starves.
DEFAULT_SWEEP_LIMIT = 60

# House choice HC-02: 35 cold emails a day per mailbox unless this machine's
# settings.local.json says otherwise (`mailboxes` -> address -> `daily_cap`),
# and never outside 10-50 whatever it says. The app's mailbox card writes it.
DEFAULT_DAILY_CAP = 35
DAILY_CAP_MIN = 10
DAILY_CAP_MAX = 50


class ToolError(Exception):
    """A usage or environment problem, reported in the same shape as a Gmail one."""

    def __init__(self, message, *, code="tool_error"):
        super().__init__(message)
        self.message = message
        self.code = code

    def as_dict(self):
        return {"code": self.code, "message": self.message}


# ==========================================
# OUTPUT
# ==========================================

class Reporter:
    """Prints either one JSON object or readable lines, never a mix of both."""

    def __init__(self, as_json):
        self.as_json = as_json

    def emit(self, payload, *, lines=()):
        if self.as_json:
            print(json.dumps(payload, ensure_ascii=False, default=str))
        else:
            for line in lines:
                print(line)
        return 0

    def fail(self, error, *, exit_code=1):
        payload = {"ok": False, "error": error}
        if self.as_json:
            print(json.dumps(payload, ensure_ascii=False, default=str))
        else:
            print(f"error: {error.get('message')}", file=sys.stderr)
        return exit_code


def _error_dict(exc):
    if isinstance(exc, (gmail.GmailError, ToolError)):
        return exc.as_dict()
    return {"code": "unexpected", "message": str(exc)}


# ==========================================
# SHARED SETUP
# ==========================================

def _open_mailbox(cfg):
    db_path = config.MAILBOX_DB_PATH
    db_path.parent.mkdir(parents=True, exist_ok=True)
    return mailbox.open_db(db_path)


def _connect(cfg, account=None):
    """A live client plus the mailbox db, or raises.

    Both together because every command that needs one needs the other, and
    because the account address -- which only the live client knows for
    certain -- is half of every primary key in the store.

    [account] picks which connected mailbox when this machine has more than
    one; omitted, it resolves the same way `gmail.find_account` always does
    (the sole one, or an error). The entry `gmail.connect` hands back is
    consulted for exactly one thing: whether it came from the legacy
    single-token fallback (`entry["account"] is None`), in which case this is
    the first time that mailbox has actually been used, and it gets adopted
    into the real accounts store now that Gmail has confirmed its address.
    """
    client, entry = gmail.connect(cfg, account=account)
    resolved = client.address
    if not resolved:
        raise gmail.GmailAuthError(
            "Gmail did not report an address for this mailbox."
        )
    if entry.get("account") is None:
        _migrate_legacy_account(entry["refreshToken"], resolved)
    return client, _open_mailbox(cfg), resolved


def _migrate_legacy_account(refresh_token, resolved_account):
    """Moves a pre-multi-account `GOOGLE_REFRESH_TOKEN` into the real
    accounts store the first time it is actually used, now that Gmail has
    said which address it belongs to.

    One-time and silent: from the next call onward `Config.google_accounts`
    reads the real store (now non-empty) and its legacy fallback never fires
    again, so this never re-runs for the same mailbox.
    """
    accounts = config.load_gmail_accounts()
    if not any(a.get("account") == resolved_account for a in accounts):
        accounts.append({
            "account": resolved_account,
            "refreshToken": refresh_token,
            "connectedAt": mailbox.now(),
        })
        config.save_gmail_accounts(accounts)
    _clear_env_values(config.LOCAL_ENV_PATH, ["GOOGLE_REFRESH_TOKEN"])


def mailbox_limits(cfg, account):
    """This machine's limits for one mailbox: the daily cap (HC-02) and when
    its warm-up started (HC-03; the warm-up itself runs in Instantly, so this
    is only a date the app counts days from)."""
    mailboxes = (getattr(cfg, "settings", None) or {}).get("mailboxes") or {}
    wanted = (account or "").strip().lower()
    entry = next((v for k, v in mailboxes.items()
                  if str(k).strip().lower() == wanted and isinstance(v, dict)), {})
    try:
        cap = int(entry.get("daily_cap", DEFAULT_DAILY_CAP))
    except (TypeError, ValueError):
        cap = DEFAULT_DAILY_CAP
    return {
        "dailyCap": max(DAILY_CAP_MIN, min(DAILY_CAP_MAX, cap)),
        "warmupStartedOn": entry.get("warmup_started_on") or None,
    }


def _local_day_start():
    """This machine's midnight, as the UTC stamp `mailbox.now()` writes -- "a
    day" for the cap is the sender's day, not Greenwich's."""
    midnight = time.mktime(time.localtime()[:3] + (0, 0, 0, 0, 0, -1))
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(midnight))


def cap_status(cfg, conn, account):
    """What `--status` reports about the cap: the limit, how much of it today
    has used, what is left, and the warm-up start."""
    limits = mailbox_limits(cfg, account)
    sent = mailbox.cold_sent_since(conn, account, _local_day_start())
    return {
        **limits,
        "sentToday": sent,
        "leftToday": max(0, limits["dailyCap"] - sent),
    }


def _check_cap(cfg, conn, account, conversation_key):
    """Refuses a cold message once today's cap is used. A conversation whose
    other side has already written back is never held."""
    conversation = mailbox.get_conversation(conn, conversation_key, account)
    if conversation is not None and conversation["reply_seen_at"]:
        return
    status = cap_status(cfg, conn, account)
    if status["leftToday"] <= 0:
        raise ToolError(
            f"{account} has sent its {status['dailyCap']} cold emails for today "
            "(the daily cap set in Settings). It can send again tomorrow, or "
            "raise the cap there (10-50).",
            code="daily_cap_reached",
        )


def _reply_subject(subject):
    """`Re: x`, without stacking a second `Re:` onto one that has it."""
    text = (subject or "").strip()
    if not text:
        return ""
    return text if text[:3].lower() == "re:" else f"Re: {text}"


# ==========================================
# --status
# ==========================================

def _sweep_state_key(account):
    """This account's own `last swept` stamp -- scoped per mailbox so one
    machine's several accounts don't each overwrite a single shared value."""
    return f"{mailbox.LAST_SWEEP_KEY}:{account}"


def _account_status(cfg, entry, conn):
    """One connected mailbox's status: a live Gmail check plus its counters
    from `mailbox.db`. Never raises -- a lapsed token on account #2 must not
    stop account #1 (or #3) from reporting, so the failure is captured as
    data on this one entry exactly the way the old single-mailbox `--status`
    captured it for the whole machine.
    """
    result = {
        "account": entry.get("account"),
        "connected": False,
        "counters": {},
        "lastSweepAt": None,
        "error": None,
    }
    try:
        client, resolved_entry = gmail.connect(cfg, account=entry.get("account"))
        account = client.address
        if not account:
            raise gmail.GmailAuthError(
                "Gmail did not report an address for this mailbox."
            )
        if resolved_entry.get("account") is None:
            _migrate_legacy_account(resolved_entry["refreshToken"], account)
        result["account"] = account
        result["connected"] = True
        result["counters"] = mailbox.counters(conn, account)
        result["limits"] = cap_status(cfg, conn, account)
        result["lastSweepAt"] = mailbox.get_state(conn, _sweep_state_key(account))
    except Exception as exc:  # noqa: BLE001 - reported as data, see docstring
        result["error"] = _error_dict(exc)
    return result


def cmd_status(cfg, reporter):
    """Every mailbox connected on this machine, and whether each still works.

    Exits 0 whatever it finds. "Not configured", "one of several has a lapsed
    token" and so on are the answers this command exists to give, and the app
    needs to tell them apart from "the tool would not run", which is what a
    non-zero exit means here.
    """
    payload = {
        "ok": True,
        "command": "status",
        "configured": gmail.credentials_present(cfg),
        "label": cfg.outreach_label,
        "senderName": cfg.sender_name or None,
        "mailboxDb": str(config.MAILBOX_DB_PATH),
        "accounts": [],
    }

    if not payload["configured"]:
        payload["error"] = {
            "code": "not_configured",
            "message": ("No mailbox is connected on this machine. Run "
                        "`python tools/email_send.py --authorize --save`."),
        }
        return reporter.emit(payload, lines=[
            "mailbox : not connected",
            "fix     : python tools/email_send.py --authorize --save",
        ])

    conn = _open_mailbox(cfg)
    try:
        payload["accounts"] = [
            _account_status(cfg, entry, conn) for entry in cfg.google_accounts
        ]
    finally:
        conn.close()

    lines = [f"label   : {payload['label']}"]
    for result in payload["accounts"]:
        counters = result.get("counters") or {}
        error = result.get("error")
        lines.append(f"mailbox : {result['account'] or 'unresolved'}")
        if error:
            lines.append(f"  error   : {error['message']}")
            continue
        lines += [
            f"  sent    : {counters.get('sent', 0)}",
            f"  waiting : {counters.get('awaitingReply', 0)} awaiting a reply",
            f"  queued  : {counters.get('pendingSteps', 0)} follow-ups "
            f"({counters.get('dueSteps', 0)} due now)",
            f"  replies : {counters.get('unreportedReplies', 0)} not yet in the app",
        ]
    return reporter.emit(payload, lines=lines)


# ==========================================
# --authorize
# ==========================================

def cmd_authorize(cfg, reporter, *, save):
    """Opens a browser once and connects one more mailbox on this machine.

    Adding a SECOND mailbox is authorized exactly the same way as the first
    -- there is no "which slot" to pick beforehand. Whichever Google account
    the browser signs into is the one that gets added (or, if it is already
    connected, the one whose token gets refreshed in place).
    """
    creds = gmail.run_authorization_flow(cfg)

    # Confirm against Gmail rather than trusting the flow: a token that cannot
    # actually read the mailbox is not a connected mailbox, and finding that
    # out now is much cheaper than finding it out on the first send. It also
    # doubles as the key: `data/gmail_accounts.local.json` is keyed by
    # address, so this is what tells a fresh connect from a reconnect of one
    # already in the list.
    account = None
    try:
        _Request, _Credentials, build, _HttpError = gmail._import_google()
        service = build("gmail", "v1", credentials=creds, cache_discovery=False)
        account = gmail.GmailClient(service).address
    except Exception:  # the token is saved either way; this is confirmation
        pass

    saved_to = None
    if save:
        if not account:
            raise ToolError(
                "Could not confirm the connected mailbox's address, so it "
                "was not saved. Try again.",
                code="auth_failed",
            )
        saved_to = str(config.GMAIL_ACCOUNTS_PATH)
        accounts = [
            a for a in config.load_gmail_accounts() if a.get("account") != account
        ]
        accounts.append({
            "account": account,
            "refreshToken": creds.refresh_token,
            "connectedAt": mailbox.now(),
        })
        config.save_gmail_accounts(accounts)
        # A machine still carrying the pre-multi-account token should not go
        # on reporting it as a second, unresolved mailbox once a real list
        # exists -- whatever it pointed at, this authorize just connected it
        # (or connected something else, in which case the old token was
        # stale and worth dropping anyway; `--authorize` again reconnects it
        # under its own address if it's still wanted).
        _clear_env_values(config.LOCAL_ENV_PATH, ["GOOGLE_REFRESH_TOKEN"])

    payload = {
        "ok": True,
        "command": "authorize",
        "account": account,
        "savedTo": saved_to,
        # Only echoed when it was NOT saved -- otherwise a live mailbox
        # credential ends up in a terminal scrollback and a log file for no
        # reason, since the file it belongs in already has it.
        "refreshToken": None if save else creds.refresh_token,
    }
    lines = [f"connected: {account or 'authorized'}"]
    if save:
        lines.append(f"saved to : {saved_to}")
    else:
        lines += [
            "",
            "This mailbox was not saved (pass --save). Its refresh token:",
            f"GOOGLE_REFRESH_TOKEN={creds.refresh_token}",
        ]
    lines += [
        "",
        "While the OAuth app is in Testing mode this token expires after seven",
        "days. Re-run this command, or publish the app to Production.",
    ]
    return reporter.emit(payload, lines=lines)


def _write_env_values(path, values):
    """Sets each key in a .env file, replacing any line that already sets it.

    Rewrites in place rather than appending, because appending a second
    `GOOGLE_REFRESH_TOKEN=` line leaves a file where the answer depends on
    which line the parser happens to read last -- and `config.load_env_file`
    keeps the last, so a stale token above a fresh one would silently work
    while looking wrong.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    existing = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    if not existing:
        existing = [
            "# Written by tools/email_send.py --authorize --save.",
            "#",
            "# This file is gitignored and holds live credentials. It is read",
            "# AFTER data/.env, so anything set here wins.",
            "",
        ]

    remaining = dict(values)
    out = []
    for line in existing:
        key = line.split("=", 1)[0].strip() if "=" in line else None
        if key in remaining:
            out.append(f"{key}={remaining.pop(key)}")
        else:
            out.append(line)
    for key, value in remaining.items():
        out.append(f"{key}={value}")
    path.write_text("\n".join(out).rstrip() + "\n", encoding="utf-8")


def _clear_env_values(path, keys):
    """Removes any line in a .env file that assigns one of [keys].

    Returns True if the file changed. Leaves everything else -- comments,
    blank lines, other keys -- exactly as it was, because this file is also
    where GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET may live and signing out of
    a mailbox is not a reason to forget the OAuth app they describe.
    """
    if not path.exists():
        return False
    wanted = {k.strip() for k in keys}
    lines = path.read_text(encoding="utf-8").splitlines()
    kept = [
        line for line in lines
        if "=" not in line or line.split("=", 1)[0].strip() not in wanted
    ]
    if len(kept) == len(lines):
        return False
    path.write_text("\n".join(kept).rstrip() + "\n", encoding="utf-8")
    return True


# ==========================================
# --sign-out
# ==========================================

def cmd_sign_out(cfg, reporter, args):
    """Forgets one of this machine's mailboxes.

    [args.account] says which; it can be left out only when there is at most
    one connected, the same "unambiguous or say which" rule every other
    account-aware command follows (see `gmail.find_account`). Only removes
    the entry from `data/gmail_accounts.local.json` (or clears the legacy
    `GOOGLE_REFRESH_TOKEN`, if that is all this machine still has) -- the
    grant itself stays live at Google until revoked from
    https://myaccount.google.com/permissions, deliberately not something a
    local command does on its own.
    """
    accounts = config.load_gmail_accounts()
    target = args.account

    if not target:
        if len(accounts) == 1:
            target = accounts[0].get("account")
        elif len(accounts) > 1:
            raise ToolError(
                "More than one mailbox is connected -- pass "
                "--account ADDRESS to say which one.",
                code="bad_usage",
            )
        # else: no stored accounts. Falls through to the legacy-token check
        # below with target still unset.

    removed = False
    if target:
        remaining = [a for a in accounts if a.get("account") != target]
        removed = len(remaining) != len(accounts)
        if removed:
            config.save_gmail_accounts(remaining)

    # The legacy single token is worth clearing whenever this call is
    # signing out the machine's only mailbox (named or not) and nothing in
    # the real store already matched it above.
    cleared_legacy = False
    if not removed and (not target or not accounts) and cfg.google_refresh_token:
        cleared_legacy = _clear_env_values(
            config.LOCAL_ENV_PATH, ["GOOGLE_REFRESH_TOKEN"])

    signed_out = removed or cleared_legacy
    return reporter.emit({
        "ok": True,
        "command": "sign-out",
        "account": target,
    }, lines=[
        f"mailbox : signed out of {target}" if signed_out and target
        else "mailbox : signed out" if signed_out
        else "mailbox : nothing to sign out of",
    ])


# ==========================================
# --send
# ==========================================

def _load_payload(args):
    """The send request, from `--payload FILE` or the individual flags.

    The app always uses the file. A message body has newlines, quotes and
    non-ASCII in it, and a Windows command line is the wrong place for all
    three -- the file is the only form of this that is not one escaping bug
    away from sending a mangled email to a stranger.
    """
    if args.payload:
        path = Path(args.payload)
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            raise ToolError(f"No payload file at {path}", code="bad_payload")
        except ValueError as exc:
            raise ToolError(f"{path} is not valid JSON: {exc}", code="bad_payload")
        if not isinstance(data, dict):
            raise ToolError("The payload must be a JSON object.", code="bad_payload")
        return data

    body = args.body
    if args.body_file:
        try:
            body = Path(args.body_file).read_text(encoding="utf-8")
        except OSError as exc:
            raise ToolError(f"Could not read {args.body_file}: {exc}",
                            code="bad_payload")
    return {
        "to": args.to,
        "subject": args.subject,
        "body": body,
        "conversationKey": args.conversation,
        "newThread": args.new_thread,
        "account": args.account,
    }


def _compose_labels(request, cfg):
    """The full Gmail label set for a send: the parent, then one nested label
    per relative path the app supplied.

    The app sends semantic fragments -- `["Influencers", "Stage/Contacted"]` --
    and the configured parent (`cfg.outreach_label`, or a per-send `label`
    override) is prepended here so the parent stays defined in exactly one
    place. A legacy caller that sends only `label` and no `labels` still gets
    exactly `[parent]`, unchanged.
    """
    base = (request.get("label") or cfg.outreach_label or "").strip()
    labels = [base] if base else []
    for raw in request.get("labels") or []:
        if not isinstance(raw, str):
            continue
        path = raw.strip().strip("/")
        if path and base:
            labels.append(f"{base}/{path}")
    # Dedupe, keep order.
    seen = set()
    return [x for x in labels if not (x in seen or seen.add(x))]


def _split_labels(value):
    """The stored comma-joined label set back into a list."""
    return [part for part in (value or "").split(",") if part.strip()]


def cmd_send(cfg, reporter, args):
    request = _load_payload(args)

    recipient = (request.get("to") or "").strip()
    body = request.get("body") or ""
    if not recipient:
        raise ToolError("No recipient given.", code="bad_payload")
    if not body.strip():
        raise ToolError("The message body is empty.", code="bad_payload")

    client, conn, account = _connect(
        cfg, account=request.get("account") or args.account)
    try:
        payload = _send_request(
            cfg, client, conn, account, request, dry_run=args.dry_run)
    finally:
        conn.close()

    if payload.get("dryRun"):
        lines = [f"would send to {recipient} as {account} (dry run)"]
    elif payload.get("duplicate"):
        lines = [f"already sent to {recipient} as {account}; not sent again"]
    else:
        lines = [
            f"sent to {recipient} as {account}",
            f"thread : {payload.get('threadId')}",
        ]
    return reporter.emit(payload, lines=lines)


def _send_request(cfg, client, conn, account, request, *, dry_run=False):
    """Sends one validated request through [client]; returns the JSON payload.

    With a `sendKey`, the key is claimed before Gmail is asked and marked sent
    in the same commit that files the message (see `mailbox.claim_send_key`).
    A key that already went out is answered from what was recorded then, with
    `"duplicate": true` -- the retry the app makes after a crash, or after a
    send whose answer it never saw, must not put a second copy in somebody's
    inbox.
    """
    recipient = (request.get("to") or "").strip()
    body = request.get("body") or ""
    key = (request.get("conversationKey")
           or mailbox.new_conversation_key())
    send_key = (request.get("sendKey") or "").strip() or None

    if send_key and not dry_run:
        claimed = mailbox.claim_send_key(
            conn, send_key, account=account, conversation_key=key)
        if claimed is not None:
            return _already_sent(conn, claimed, account=account,
                                 recipient=recipient)

    if not dry_run:
        try:
            _check_cap(cfg, conn, account, key)
        except ToolError:
            # Nothing went out, so the key is free for the same message to go
            # tomorrow rather than reading as uncertain forever.
            if send_key:
                mailbox.release_send_key(conn, send_key)
            raise

    # Stored comma-joined so a follow-up sent days later (which only ever
    # happens when there was no reply) files under the same labels the
    # first message got.
    labels = _compose_labels(request, cfg)
    label = ",".join(labels) or cfg.outreach_label

    mailbox.upsert_conversation(
        conn,
        conversation_key=key,
        account=account,
        recipient=recipient,
        subject=request.get("subject"),
        label=label,
        channel_id=request.get("channelId"),
    )
    conversation = mailbox.get_conversation(conn, key, account)

    # Continue the existing thread unless explicitly told to start a new
    # one. This is what makes a second message to the same channel land in
    # the conversation rather than beside it.
    thread_id = None
    in_reply_to = None
    subject = request.get("subject") or ""
    if not request.get("newThread") and conversation["gmail_thread_id"]:
        thread_id = conversation["gmail_thread_id"]
        in_reply_to = conversation["last_rfc_id"]
        subject = subject or _reply_subject(conversation["subject"])

    if dry_run:
        return {
            "ok": True,
            "command": "send",
            "dryRun": True,
            "account": account,
            "conversationKey": key,
            "to": recipient,
            "subject": subject,
            "threaded": bool(thread_id),
            "labels": labels,
            "followUps": [],
        }

    try:
        result = client.send(
            to=recipient,
            subject=subject,
            body=body,
            labels=labels,
            thread_id=thread_id,
            in_reply_to=in_reply_to,
            reply_to=request.get("replyTo"),
        )
    except Exception:
        # Gmail answered with a refusal: nothing went out, so the same key
        # may try again. (A process killed inside this call never gets here,
        # and its claim stays -- which is exactly the unknown case.)
        if send_key:
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
    )

    # A `followUps` list from an older app is ignored: nothing is queued
    # behind a send, because nothing leaves without a person's click.

    return {
        "ok": True,
        "command": "send",
        "account": account,
        "conversationKey": key,
        "messageId": result["messageId"],
        "threadId": result.get("threadId"),
        "rfcMessageId": result.get("rfcMessageId"),
        "labelled": bool(result.get("labelId")),
        "threaded": bool(thread_id),
        "to": recipient,
        "subject": subject,
        "sentAt": sent_at,
        "followUps": [],
    }


def _already_sent(conn, claimed, *, account, recipient):
    """The answer to a send key that was claimed before: the original send, or
    a refusal when nobody knows whether it went out."""
    if claimed["state"] != mailbox.SEND_KEY_SENT:
        raise ToolError(
            "An earlier attempt to send this message stopped before Gmail "
            "answered, so it may already have gone out. Check the Sent folder "
            "before sending it again.",
            code="send_uncertain",
        )
    key = claimed["conversation_key"]
    sent = mailbox.sent_message(conn, claimed["gmail_message_id"])
    return {
        "ok": True,
        "command": "send",
        "duplicate": True,
        "account": account,
        "conversationKey": key,
        "messageId": claimed["gmail_message_id"],
        "threadId": sent["gmail_thread_id"] if sent else None,
        "to": (sent["recipient"] if sent else None) or recipient,
        "subject": sent["subject"] if sent else None,
        "sentAt": claimed["sent_at"],
        "followUps": [],
    }


def cmd_test_send(cfg, reporter, args):
    """Sends a plain message to prove the mailbox works, logging nothing.

    Behind the Settings card's "Send a test email". Deliberately does not touch
    `mailbox.db`: a test is not a conversation, and it must not appear in the
    reply sweep or acquire follow-ups.
    """
    recipient = (args.to or "").strip()
    client, conn, account = _connect(cfg, account=args.account)
    conn.close()
    recipient = recipient or account
    result = client.send(
        to=recipient,
        subject="Gratovo outreach — test message",
        body=(
            "This is a test from the Gratovo IMA ToolBox.\n\n"
            f"Sent from {account} at {mailbox.now()}.\n"
            "If you are reading this in the inbox you meant to send from, the "
            "outreach mailbox is connected correctly."
        ),
        labels=[cfg.outreach_label],
    )
    return reporter.emit({
        "ok": True,
        "command": "test-send",
        "account": account,
        "to": recipient,
        "messageId": result["messageId"],
        "threadId": result.get("threadId"),
    }, lines=[f"test message sent to {recipient} from {account}"])


# ==========================================
# --run-due / --check-replies
# ==========================================

def cmd_run_due(cfg, reporter, args):
    """One sweep: notice replies. It sends nothing.

    A follow-up goes out only when a person sends it from the app (owner
    decision, plan step 1). Follow-ups an older build queued behind a send are
    cancelled here, so a scheduled run of this command can never send them.
    """
    client, conn, account = _connect(cfg, account=args.account)
    try:
        replies = []
        checked = 0
        if not args.no_check:
            replies, checked = _sweep_replies(
                client, conn, account,
                conversation_key=args.conversation,
                limit=args.limit or DEFAULT_SWEEP_LIMIT,
            )

        cancelled = _cancel_queued(conn, account)

        mailbox.set_state(conn, _sweep_state_key(account), mailbox.now())

        # Replies are handed over but NOT marked reported: the app calls
        # --ack once each one is recorded in the CRM, so a crash mid-apply
        # sees the reply again rather than losing it. `--ack-now` is for a
        # run with no app behind it, where nothing will ever acknowledge.
        if args.ack_now:
            mailbox.mark_reported(
                conn, [item["messageId"] for item in replies])

        payload = {
            "ok": True,
            "command": "run-due",
            "account": account,
            "checked": checked,
            "replies": replies,
            "sent": [],
            "failed": [],
            "cancelledQueued": cancelled,
            "counters": mailbox.counters(conn, account),
        }
        return reporter.emit(payload, lines=[
            f"swept   : {checked} conversation(s)",
            f"replies : {len(replies)} new",
            *([f"cancelled: {cancelled} queued follow-up(s) from an older build"]
              if cancelled else []),
        ])
    finally:
        conn.close()


def _sweep_replies(client, conn, account, *, conversation_key=None, limit=None):
    """Asks Gmail about each open conversation and files anything new.

    Returns `(replies, conversations_checked)`. A conversation whose thread
    lookup fails is skipped rather than fatal: one deleted thread must not stop
    the sweep that would have found four replies after it.
    """
    if conversation_key:
        row = mailbox.get_conversation(conn, conversation_key, account)
        rows = [row] if row and row["gmail_thread_id"] else []
    else:
        rows = mailbox.open_conversations(conn, account, limit=limit)

    found_replies = []
    checked = 0
    for conversation in rows:
        checked += 1
        key = conversation["conversation_key"]
        try:
            incoming = client.replies(
                conversation["gmail_thread_id"],
                exclude_ids=mailbox.sent_message_ids(conn, key, account),
            )
        except gmail.GmailError:
            continue
        if not incoming:
            continue

        # Read BEFORE recording: `record_replies` is what sets the stamp, so
        # afterwards every reply looks like a later one and the first-reply
        # signal the app needs would never fire.
        is_first = not conversation["reply_seen_at"]
        mailbox.record_replies(conn, key, account, incoming)
        # Cancelling is bookkeeping, not enforcement -- `due_steps` already
        # refuses this conversation now that it has a reply stamp. This is what
        # makes the cancellation visible, so the app can say what it stopped.
        cancelled = mailbox.cancel_steps(conn, key, account, reason="replied")
        mailbox.close_conversation(conn, key, account)

        for row in mailbox.unreported_replies(conn, account,
                                              conversation_key=key):
            found_replies.append({
                "conversationKey": key,
                "channelId": conversation["channel_id"],
                "messageId": row["gmail_message_id"],
                "from": row["from_address"],
                "fromName": row["from_name"],
                "subject": row["subject"],
                "body": row["body"],
                "receivedAt": row["received_at"] or row["seen_at"],
                # The app turns the FIRST reply into "interested" on the
                # channel; a later one must not re-run that. Only the first
                # row of the first sweep that saw a reply carries the flag.
                "isFirstReply": is_first,
                "cancelledFollowUps": cancelled,
            })
            is_first = False
            cancelled = 0

    return found_replies, checked


def _cancel_queued(conn, account):
    """Cancels every follow-up an older build queued behind a send; returns
    how many. Nothing is sent: a follow-up leaves only on a person's click."""
    rows = conn.execute(
        "SELECT DISTINCT conversation_key FROM sequence_steps "
        " WHERE account = ? AND state = ?",
        (account, mailbox.STATE_PENDING),
    ).fetchall()
    return sum(
        mailbox.cancel_steps(conn, row["conversation_key"], account,
                             reason="automatic follow-ups removed")
        for row in rows
    )


# ==========================================
# --ack / --pending / --cancel
# ==========================================

def cmd_ack(cfg, reporter, args):
    """Marks replies as handled, so the next sweep stops offering them."""
    ids = [i.strip() for i in (args.messages or "").split(",") if i.strip()]
    if not ids:
        raise ToolError("--ack needs --messages id[,id...]", code="bad_usage")
    client, conn, account = _connect(cfg)
    try:
        marked = mailbox.mark_reported(conn, ids)
        return reporter.emit(
            {"ok": True, "command": "ack", "account": account,
             "acknowledged": marked},
            lines=[f"acknowledged {marked} repl(ies)"],
        )
    finally:
        conn.close()


def cmd_pending(cfg, reporter, args):
    """What is queued and what is waiting, without touching Gmail at all.

    Reads only `mailbox.db`, so it answers on a machine with no network and
    costs no API quota -- which is what makes it safe for the app to call
    whenever the Outreach page is opened.
    """
    if not gmail.credentials_present(cfg):
        raise gmail.GmailNotConfigured("No mailbox is connected on this machine.")
    conn = _open_mailbox(cfg)
    try:
        # The account is needed as a key and asking Gmail for it costs a round
        # trip, so a single-mailbox machine's rows are found by their own
        # account value instead.
        accounts = [
            row["account"] for row in conn.execute(
                "SELECT DISTINCT account FROM conversations").fetchall()
        ]
        account = args.account or (accounts[0] if accounts else "")
        steps = [
            {
                "id": row["id"],
                "conversationKey": row["conversation_key"],
                "stepNo": row["step_no"],
                "dueAt": row["due_at"],
                "subject": row["subject"],
                "body": row["body"],
            }
            for row in mailbox.pending_steps(
                conn, account, conversation_key=args.conversation)
        ]
        return reporter.emit({
            "ok": True,
            "command": "pending",
            "account": account,
            "steps": steps,
            "counters": mailbox.counters(conn, account) if account else {},
        }, lines=[
            f"{len(steps)} follow-up(s) queued",
            *[f"  step {s['stepNo']} due {s['dueAt']}  {s['conversationKey']}"
              for s in steps],
        ])
    finally:
        conn.close()


def cmd_cancel(cfg, reporter, args):
    """Drops the queued follow-ups for one conversation.

    The manual half of the interrupt: somebody who has spoken to a creator on
    the phone should be able to stop the emails without waiting for a reply
    that is never going to come by email.
    """
    if not args.conversation:
        raise ToolError("--cancel needs --conversation KEY", code="bad_usage")
    conn = _open_mailbox(cfg)
    try:
        rows = conn.execute(
            "SELECT DISTINCT account FROM conversations WHERE conversation_key = ?",
            (args.conversation,),
        ).fetchall()
        cancelled = 0
        for row in rows:
            cancelled += mailbox.cancel_steps(
                conn, args.conversation, row["account"], reason="cancelled")
            mailbox.close_conversation(conn, args.conversation, row["account"])
        return reporter.emit({
            "ok": True,
            "command": "cancel",
            "conversationKey": args.conversation,
            "cancelled": cancelled,
        }, lines=[f"cancelled {cancelled} queued follow-up(s)"])
    finally:
        conn.close()


# ==========================================
# ENTRY POINT
# ==========================================

def build_parser():
    parser = argparse.ArgumentParser(
        description=__doc__.split("\n")[0],
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--status", action="store_true",
                      help="what mailbox is connected, and what is queued")
    mode.add_argument("--authorize", action="store_true",
                      help="connect a mailbox (opens a browser once)")
    mode.add_argument("--sign-out", action="store_true",
                      help="forget this machine's mailbox (clears the token)")
    mode.add_argument("--send", action="store_true",
                      help="send one message (nothing is queued behind it)")
    mode.add_argument("--test-send", action="store_true",
                      help="send a test message and log nothing")
    mode.add_argument("--run-due", action="store_true",
                      help="sweep for replies; sends nothing, cancels follow-ups an "
                           "older build queued")
    mode.add_argument("--check-replies", action="store_true",
                      help="sweep for replies only, sending nothing")
    mode.add_argument("--ack", action="store_true",
                      help="mark replies as recorded in the app")
    mode.add_argument("--pending", action="store_true",
                      help="list queued follow-ups (no network)")
    mode.add_argument("--cancel", action="store_true",
                      help="drop the queued follow-ups for one conversation")

    parser.add_argument("--json", action="store_true",
                        help="print one JSON object instead of readable lines")
    parser.add_argument("--save", action="store_true",
                        help="--authorize: write the token to data/.env.local")

    parser.add_argument("--payload", metavar="FILE",
                        help="--send: a JSON file holding the whole request")
    parser.add_argument("--to", metavar="ADDRESS")
    parser.add_argument("--subject", default="")
    parser.add_argument("--body", default="")
    parser.add_argument("--body-file", metavar="FILE")
    parser.add_argument("--conversation", metavar="KEY",
                        help="the app's outreach thread id")
    parser.add_argument("--channel-id", metavar="ID")
    parser.add_argument("--account", metavar="ADDRESS",
                        help="which connected mailbox to use -- required if "
                             "more than one is connected and the command "
                             "needs exactly one (--send, --test-send, "
                             "--run-due, --check-replies, --sign-out, "
                             "--pending); omitted when there is only one")
    parser.add_argument("--messages", metavar="IDS",
                        help="--ack: comma-separated Gmail message ids")
    parser.add_argument("--new-thread", action="store_true",
                        help="--send: start a new thread even if one exists")
    parser.add_argument("--dry-run", action="store_true",
                        help="--send: resolve everything, send nothing")
    parser.add_argument("--limit", type=int, metavar="N",
                        help="cap how many conversations/steps one run touches")
    parser.add_argument("--ack-now", action="store_true",
                        help="--run-due: acknowledge replies in the same call")
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    reporter = Reporter(args.json)
    cfg = config.load()

    # `--check-replies` and `--run-due` both only sweep now; `no_send` is
    # kept for callers that still pass it.
    args.no_send = bool(args.check_replies)
    args.no_check = False

    try:
        if args.authorize:
            return cmd_authorize(cfg, reporter, save=args.save)
        if args.sign_out:
            return cmd_sign_out(cfg, reporter, args)
        if args.send:
            return cmd_send(cfg, reporter, args)
        if args.test_send:
            return cmd_test_send(cfg, reporter, args)
        if args.run_due or args.check_replies:
            return cmd_run_due(cfg, reporter, args)
        if args.ack:
            return cmd_ack(cfg, reporter, args)
        if args.pending:
            return cmd_pending(cfg, reporter, args)
        if args.cancel:
            return cmd_cancel(cfg, reporter, args)
        return cmd_status(cfg, reporter)
    except (gmail.GmailError, ToolError) as exc:
        return reporter.fail(_error_dict(exc))
    except KeyboardInterrupt:
        return reporter.fail({"code": "interrupted", "message": "Interrupted."},
                             exit_code=130)
    except Exception as exc:  # noqa: BLE001 - the app needs JSON, not a traceback
        return reporter.fail(_error_dict(exc))


if __name__ == "__main__":
    sys.exit(main())
