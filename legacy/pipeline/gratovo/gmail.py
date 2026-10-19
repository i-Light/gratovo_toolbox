"""The team's Gmail mailbox, as the pipeline sees it.

Outreach is sent from a real mailbox rather than through a transactional mail
service, and that is a deliberate choice rather than a shortcut. A cold email
to a creator has to arrive in a personal inbox, be replyable in the ordinary
way, and leave a thread the sender can open in Gmail and read like any other
conversation. A "no-reply@" sender does none of that, and lands in Promotions
besides.

WHAT THIS MODULE IS RESPONSIBLE FOR
-----------------------------------
Exactly one thing: talking to Gmail. It holds no state, decides no policy, and
knows nothing about outreach threads, channels or follow-ups. Which message to
send, when, and what to do about a reply is `tools/email_send.py`'s job, and
what a reply *means* is the app's. Keeping that line sharp is what makes the
send path testable without a mailbox: everything above this module deals in
plain dicts.

CREDENTIALS
-----------
One OAuth client, shared by every mailbox this machine connects, from
`data/.env.local` (see `config.Config`):

    GOOGLE_CLIENT_ID       the OAuth client, from Google Cloud Console
    GOOGLE_CLIENT_SECRET   its secret

...and one refresh token per connected mailbox, in
`data/gmail_accounts.local.json` (see `config.load_gmail_accounts` /
`Config.google_accounts`) -- a machine can send outreach from more than one
address, and each gets its own long-lived grant. `find_account` below is
where "which mailbox" gets resolved: by an explicit address, or automatically
when there is only one connected.

A refresh token is the whole of the login. There is no interactive prompt in
the send path and there must not be one: sending runs behind a button in the
app and, on `--run-due`, behind no human at all. `tools/email_send.py
--authorize` is the one place a browser opens, and it exists to produce that
token once per mailbox.

    A NOTE THAT MUST NOT BE LOST, carried over from the original script:
    while the Google Cloud project is still in "Testing" mode, a refresh token
    issued to a test user EXPIRES AFTER SEVEN DAYS. Either re-run
    `--authorize` weekly or publish the app to Production. `--status` reports
    the failure in the terms this actually presents as, because "invalid_grant"
    on a Monday morning is otherwise a genuinely baffling thing to be told.

SCOPES
------
`gmail.send` alone cannot label a sent message or read a thread back, and both
are load-bearing here: the label is what keeps outreach separable inside a
personal mailbox, and reading the thread is the entire reply-detection
mechanism. `gmail.modify` covers both without granting delete.
"""

from __future__ import annotations

import base64
import random
import re
import time
from email.message import EmailMessage
from email.utils import formataddr, parseaddr

SCOPES = [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.send",
]

TOKEN_URI = "https://oauth2.googleapis.com/token"
AUTH_URI = "https://accounts.google.com/o/oauth2/auth"

# Retried, with a pause between attempts. 429 is Gmail's per-user rate limit
# (a real possibility when `--run-due` sends a batch of follow-ups at once) and
# the 5xx family is Google having a bad moment. Everything else -- 400, 401,
# 403 -- is a fact about the request or the grant, and asking again cannot
# change it.
_RETRY_STATUSES = frozenset({429, 500, 502, 503, 504})
_MAX_ATTEMPTS = 4
_BASE_BACKOFF_SECONDS = 1.0

# Gmail's own limit is far higher, but a message this size is a mistake rather
# than an outreach email, and finding that out before the API call gives a
# usable error instead of a 400.
MAX_BODY_BYTES = 1_000_000


class GmailError(Exception):
    """Anything that stopped a mailbox operation.

    [code] is a stable machine-readable slug. The Flutter app switches on it to
    decide what to *offer* -- "reconnect the mailbox" for an expired grant,
    "install the dependencies" for a bare interpreter -- so these strings are
    part of the tool's contract with the app, not just log text.
    """

    code = "gmail_error"

    def __init__(self, message, *, detail=None):
        super().__init__(message)
        self.message = message
        self.detail = detail

    def as_dict(self):
        payload = {"code": self.code, "message": self.message}
        if self.detail:
            payload["detail"] = self.detail
        return payload


class GmailNotConfigured(GmailError):
    """No credentials in the .env files. Not a failure -- an unset-up machine."""

    code = "not_configured"


class GmailDependencyMissing(GmailError):
    """The google-api-python-client stack is not installed on this interpreter.

    Its own category because the fix is `pip install -r requirements.txt` and
    nothing else, and because `--status` has to be able to say so on a machine
    that has deliberately installed nothing (see requirements.txt on why the
    sync-only paths import nothing heavy).
    """

    code = "dependency_missing"


class GmailAuthError(GmailError):
    """The credentials exist but Google refused them."""

    code = "auth_failed"


class GmailAmbiguousAccount(GmailError):
    """More than one mailbox is connected and the caller did not say which."""

    code = "ambiguous_account"


class GmailApiError(GmailError):
    """Gmail accepted the request and answered with an error."""

    code = "api_error"

    def __init__(self, message, *, status=None, detail=None):
        super().__init__(message, detail=detail)
        self.status = status

    def as_dict(self):
        payload = super().as_dict()
        if self.status is not None:
            payload["status"] = self.status
        return payload


# ==========================================
# CREDENTIALS
# ==========================================

def _import_google():
    """The google libraries, or [GmailDependencyMissing].

    Imported here rather than at module scope for the reason the rest of the
    pipeline defers its heavy imports: `search.py --status` and
    `email_send.py --status` are expected to work on a machine with nothing
    installed, and an ImportError at the top of this file would take both of
    them down with a traceback instead of a sentence.
    """
    try:
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build
        from googleapiclient.errors import HttpError
    except ImportError as exc:
        raise GmailDependencyMissing(
            "The Gmail libraries are not installed on this Python. Run "
            "`pip install -r requirements.txt` in pipeline/.",
            detail=str(exc),
        ) from exc
    return Request, Credentials, build, HttpError


def credentials_present(cfg):
    """Whether this machine has an OAuth client and at least one connected
    mailbox. No network, no imports."""
    return bool(cfg.google_client_id
                and cfg.google_client_secret
                and cfg.google_accounts)


def find_account(cfg, account=None):
    """The stored credential entry for [account] (an email address), or the
    sole entry when there is exactly one and none was named.

    Every command that needs to reach ONE particular mailbox goes through
    this, so "nothing connected", "nothing connected AS x" and "more than one
    connected and you didn't say which" are always told apart the same way
    and in the same words, instead of each call site inventing its own.
    """
    accounts = cfg.google_accounts
    if not accounts:
        raise GmailNotConfigured(
            "No mailbox is connected on this machine. Run "
            "`python tools/email_send.py --authorize --save`."
        )
    if account:
        for entry in accounts:
            if entry.get("account") == account:
                return entry
        raise GmailNotConfigured(
            f"No mailbox connected as {account} on this machine."
        )
    if len(accounts) == 1:
        return accounts[0]
    raise GmailAmbiguousAccount(
        "This machine has more than one mailbox connected -- pass "
        "--account ADDRESS to say which one."
    )


def _describe_auth_failure(exc):
    """Google's refusal, in the terms it actually presents as.

    `invalid_grant` is the one that matters and the one nobody guesses: it is
    what a seven-day test-user token looks like the moment it lapses, and the
    raw message ("Bad Request") says nothing at all about mailboxes.
    """
    text = str(exc)
    if "invalid_grant" in text:
        return (
            "Google rejected the saved refresh token. While the OAuth app is "
            "in Testing mode a token lasts seven days -- run "
            "`python tools/email_send.py --authorize --save` to reconnect the "
            "mailbox, or publish the OAuth app to Production."
        )
    if "invalid_client" in text or "unauthorized_client" in text:
        return ("Google rejected the OAuth client. Check GOOGLE_CLIENT_ID and "
                "GOOGLE_CLIENT_SECRET.")
    return f"Could not refresh the Gmail credentials: {text}"


def build_credentials(cfg, account=None):
    """Refreshed, ready-to-use credentials for one connected mailbox, plus the
    stored entry they came from.

    The entry is handed back (not just the credentials) because its
    `"account"` may still be `None` -- the legacy single-token fallback
    `Config.google_accounts` returns before anything has resolved its address
    -- and `connect` below needs that to know whether to adopt it into the
    real accounts store.
    """
    if not cfg.google_client_id or not cfg.google_client_secret:
        raise GmailNotConfigured(
            "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set before a "
            "mailbox can be connected. See data/.env.example."
        )
    entry = find_account(cfg, account)

    Request, Credentials, _build, _HttpError = _import_google()
    creds = Credentials(
        # No access token on purpose: one is minted by the refresh below every
        # time. Caching it would mean caching an expiry to reason about, for a
        # process that lives seconds.
        token=None,
        refresh_token=entry["refreshToken"],
        token_uri=TOKEN_URI,
        client_id=cfg.google_client_id,
        client_secret=cfg.google_client_secret,
        scopes=SCOPES,
    )
    try:
        creds.refresh(Request())
    except Exception as exc:  # google.auth.exceptions.RefreshError and kin
        raise GmailAuthError(_describe_auth_failure(exc), detail=str(exc)) from exc
    return creds, entry


def connect(cfg, account=None):
    """A live [GmailClient] for one connected mailbox, plus the stored entry
    it came from.

    [account] picks which mailbox when this machine has more than one; leave
    it unset when there is only one, or to reach the legacy single-token
    fallback. Callers that don't care about the second return value (most of
    them) can ignore it; `tools/email_send.py`'s `_connect` uses it to decide
    whether this was that legacy fallback and, if so, adopt it into the real
    accounts store now that Gmail has confirmed its address.
    """
    creds, entry = build_credentials(cfg, account=account)
    _Request, _Credentials, build, _HttpError = _import_google()
    # cache_discovery=False: the default file cache writes into the user's
    # home directory and warns loudly when it cannot, which on a locked-down
    # machine is a stderr full of noise before every single send.
    service = build("gmail", "v1", credentials=creds, cache_discovery=False)
    return GmailClient(service, sender_name=cfg.sender_name), entry


def run_authorization_flow(cfg):
    """Opens a browser once and returns a fresh refresh token.

    The only interactive path in this module, and the only one that needs
    `google_auth_oauthlib`. Everything else runs unattended.
    """
    if not cfg.google_client_id or not cfg.google_client_secret:
        raise GmailNotConfigured(
            "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set before a "
            "mailbox can be connected. See data/.env.example."
        )
    try:
        from google_auth_oauthlib.flow import InstalledAppFlow
    except ImportError as exc:
        raise GmailDependencyMissing(
            "google-auth-oauthlib is not installed. Run "
            "`pip install -r requirements.txt` in pipeline/.",
            detail=str(exc),
        ) from exc

    flow = InstalledAppFlow.from_client_config(
        {
            "installed": {
                "client_id": cfg.google_client_id,
                "client_secret": cfg.google_client_secret,
                "auth_uri": AUTH_URI,
                "token_uri": TOKEN_URI,
            }
        },
        SCOPES,
    )
    # access_type=offline + prompt=consent is what makes Google issue a REFRESH
    # token rather than only an access token. Without the explicit consent
    # prompt a re-authorization of an already-granted account returns no
    # refresh token at all, which is the failure mode where someone reconnects
    # a lapsed mailbox and ends up with nothing to save.
    creds = flow.run_local_server(
        port=0,
        access_type="offline",
        prompt="consent",
        authorization_prompt_message=(
            "Opening a browser to connect the outreach mailbox. Sign in as the "
            "address outreach should be sent FROM.\n"
        ),
        success_message=(
            "Mailbox connected. You can close this tab and return to the "
            "terminal."
        ),
    )
    if not creds.refresh_token:
        raise GmailAuthError(
            "Google returned no refresh token. Remove this app's access at "
            "https://myaccount.google.com/permissions and authorize again."
        )
    return creds


# ==========================================
# THE CLIENT
# ==========================================

class GmailClient:
    """One authenticated mailbox.

    Cheap to hold and cheap to reuse within a process: the profile lookup and
    every label id are fetched at most once each, which matters for `--run-due`
    where a single invocation may touch dozens of conversations.
    """

    def __init__(self, service, *, sender_name=None):
        self._service = service
        self._sender_name = (sender_name or "").strip() or None
        self._address = None
        self._label_ids = {}

    # ---- identity ----

    @property
    def address(self):
        """The address this mailbox sends as. One API call, then cached."""
        if self._address is None:
            profile = self._call(
                self._service.users().getProfile(userId="me")
            )
            self._address = (profile.get("emailAddress") or "").strip()
        return self._address

    # ---- labels ----

    def ensure_label(self, name):
        """The id of [name], creating the label if the mailbox has no such one.

        Outreach shares a personal inbox with everything else that inbox is
        for. The label is what makes "show me what the pipeline sent" a filter
        rather than a memory exercise, and it is what a Gmail filter can hang
        off if someone wants these out of the main inbox view.
        """
        key = (name or "").strip()
        if not key:
            return None
        cached = self._label_ids.get(key.lower())
        if cached:
            return cached

        listing = self._call(self._service.users().labels().list(userId="me"))
        for label in listing.get("labels", []):
            self._label_ids[label["name"].lower()] = label["id"]
        cached = self._label_ids.get(key.lower())
        if cached:
            return cached

        created = self._call(
            self._service.users().labels().create(
                userId="me",
                body={
                    "name": key,
                    "labelListVisibility": "labelShow",
                    "messageListVisibility": "show",
                },
            )
        )
        self._label_ids[key.lower()] = created["id"]
        return created["id"]

    # ---- sending ----

    def send(
        self,
        *,
        to,
        subject,
        body,
        label=None,
        labels=None,
        thread_id=None,
        in_reply_to=None,
        references=None,
        reply_to=None,
        html=None,
    ):
        """Sends one message and returns what is needed to continue the thread.

        [thread_id] and [in_reply_to] are what make a follow-up land *inside*
        the conversation the first message started rather than beside it in the
        inbox. Both are required for that, and they are required together:
        `threadId` alone gets Gmail to file it in the right thread on the
        sender's side, while `In-Reply-To`/`References` are what every other
        mail client in the world -- including the recipient's -- actually reads.
        Passing one without the other produces a thread that looks correct to
        the person who sent it and broken to the person who received it, which
        is the worst of the available outcomes.

        [label] is a single label name; [labels] is a list of them, and either
        or both may be given -- they are merged, de-duplicated, each one
        created if the mailbox has no such label, and all added to the sent
        message in one call. Nested names ("Gratovo Outreach/Influencers") are
        ordinary label names to Gmail; it renders the hierarchy from the "/".

        Returns a dict: `messageId`, `threadId`, `rfcMessageId`, `labelId`.
        `labelId` is the first label applied (or None), kept for callers that
        only need "was it filed at all". `rfcMessageId` is the header value the
        NEXT message in this thread must quote, and it is read back from the
        sent message because Gmail assigns it -- it is not knowable before the
        send.
        """
        recipient = (to or "").strip()
        if not recipient or not _looks_like_address(recipient):
            raise GmailError(
                f"{recipient or '(blank)'} is not a usable email address.",
                detail="recipient",
            )
        text = body or ""
        if len(text.encode("utf-8")) > MAX_BODY_BYTES:
            raise GmailError(
                "The message body is too large to send "
                f"({len(text.encode('utf-8'))} bytes)."
            )

        message = EmailMessage()
        message["To"] = recipient
        message["Subject"] = subject or ""
        if self._sender_name:
            # The address half is still whatever the mailbox is; Gmail
            # overwrites any attempt to send as a different address, and a
            # display name is the only part of From worth setting here.
            message["From"] = formataddr((self._sender_name, self.address))
        if reply_to:
            message["Reply-To"] = reply_to
        if in_reply_to:
            message["In-Reply-To"] = in_reply_to
            # References is the whole ancestry, not just the parent. Threading
            # in most clients walks this chain, so a follow-up appends to it
            # rather than replacing it.
            chain = list(references or [])
            if in_reply_to not in chain:
                chain.append(in_reply_to)
            message["References"] = " ".join(chain)

        message.set_content(text)
        if html:
            message.add_alternative(html, subtype="html")

        payload = {
            "raw": base64.urlsafe_b64encode(message.as_bytes()).decode("ascii")
        }
        if thread_id:
            payload["threadId"] = thread_id

        sent = self._call(
            self._service.users().messages().send(userId="me", body=payload)
        )

        names = []
        for name in [label, *(labels or [])]:
            name = (name or "").strip()
            if name and name not in names:
                names.append(name)
        label_id = None
        if names:
            try:
                ids = [lid for lid in (self.ensure_label(n) for n in names) if lid]
                if ids:
                    self._call(
                        self._service.users().messages().modify(
                            userId="me",
                            id=sent["id"],
                            body={"addLabelIds": ids},
                        )
                    )
                    label_id = ids[0]
            except GmailError:
                # The message is already gone. Failing the send now would tell
                # the caller nothing was sent, and the caller would send it
                # again -- a duplicate cold email is a far worse outcome than
                # an unlabelled one.
                label_id = None

        return {
            "messageId": sent["id"],
            "threadId": sent.get("threadId"),
            "rfcMessageId": self._rfc_message_id(sent["id"]),
            "labelId": label_id,
        }

    def _rfc_message_id(self, message_id):
        """The `Message-ID` header Gmail assigned, for the next reply to quote."""
        meta = self._call(
            self._service.users().messages().get(
                userId="me",
                id=message_id,
                format="metadata",
                metadataHeaders=["Message-ID"],
            )
        )
        return _header(meta.get("payload", {}), "message-id")

    # ---- reading replies ----

    def replies(self, thread_id, *, exclude_ids=()):
        """Every message in [thread_id] that this mailbox did not send.

        The test is the sender, not the label or the read state: a thread
        contains our own sends too, and "did somebody answer" is exactly the
        question of whether any message in it came from an address that is not
        ours. [exclude_ids] drops messages already reported, so a caller polling
        this repeatedly reports each reply once.

        Returns a list of dicts, oldest first: `messageId`, `from`, `fromName`,
        `subject`, `at` (epoch milliseconds, as Gmail gives it), `body`,
        `snippet`.
        """
        mine = self.address.lower()
        thread = self._call(
            self._service.users().threads().get(
                userId="me", id=thread_id, format="full"
            )
        )

        found = []
        for message in thread.get("messages", []):
            if message.get("id") in exclude_ids:
                continue
            payload = message.get("payload", {})
            sender = _header(payload, "from") or ""
            _name, sender_address = parseaddr(sender)
            if not sender_address or sender_address.lower() == mine:
                continue
            found.append({
                "messageId": message.get("id"),
                "from": sender_address,
                "fromName": (_name or "").strip() or None,
                "subject": _header(payload, "subject") or "",
                "at": _epoch_millis(message.get("internalDate")),
                "body": _plain_text(payload) or (message.get("snippet") or ""),
                "snippet": message.get("snippet") or "",
            })
        found.sort(key=lambda item: item["at"] or 0)
        return found

    def has_reply(self, thread_id):
        """Whether anyone but this mailbox has posted in [thread_id]."""
        return bool(self.replies(thread_id))

    # ---- transport ----

    def _call(self, request):
        """Executes [request], retrying the failures that retrying can fix.

        Backoff is exponential with jitter. The jitter is not decoration:
        `--run-due` can fire a dozen sends in a burst, and a fixed backoff
        makes every one of them retry at the same instant, reproducing the
        rate-limit that caused the retry.
        """
        _Request, _Credentials, _build, HttpError = _import_google()

        last = None
        for attempt in range(_MAX_ATTEMPTS):
            try:
                return request.execute()
            except HttpError as exc:
                status = getattr(getattr(exc, "resp", None), "status", None)
                last = exc
                if status not in _RETRY_STATUSES or attempt == _MAX_ATTEMPTS - 1:
                    raise GmailApiError(
                        _describe_http_error(exc, status),
                        status=status,
                        detail=str(exc),
                    ) from exc
                time.sleep(
                    _BASE_BACKOFF_SECONDS * (2 ** attempt)
                    + random.uniform(0, 0.4)
                )
            except GmailError:
                raise
            except Exception as exc:
                # A socket that died mid-call is worth one more try; anything
                # structural fails the same way twice and stops here.
                last = exc
                if attempt == _MAX_ATTEMPTS - 1:
                    raise GmailApiError(
                        f"Could not reach Gmail: {exc}", detail=str(exc)
                    ) from exc
                time.sleep(_BASE_BACKOFF_SECONDS * (2 ** attempt))
        raise GmailApiError(f"Could not reach Gmail: {last}")


def _describe_http_error(exc, status):
    if status == 401:
        return ("Gmail rejected the credentials. Reconnect the mailbox with "
                "`python tools/email_send.py --authorize --save`.")
    if status == 403:
        return ("Gmail refused the request. The mailbox may be over its daily "
                "sending limit, or the grant may be missing the gmail.modify "
                "scope -- reconnecting the mailbox re-requests it.")
    if status == 429:
        return "Gmail is rate limiting this mailbox. Try again shortly."
    if status and 500 <= status < 600:
        return "Gmail is unavailable right now. Try again shortly."
    return f"Gmail returned an error ({status}): {exc}"


# ==========================================
# MESSAGE PARSING
# ==========================================

_ADDRESS_RE = re.compile(r"^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$")


def _looks_like_address(value):
    _name, address = parseaddr(value)
    return bool(_ADDRESS_RE.match(address or ""))


def _header(payload, name):
    for header in payload.get("headers", []) or []:
        if (header.get("name") or "").lower() == name:
            return header.get("value")
    return None


def _epoch_millis(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _plain_text(payload):
    """The text/plain body of a Gmail payload, however deeply it is nested.

    Real replies are `multipart/alternative` inside `multipart/mixed` as often
    as they are a flat body, and a reply whose text arrives as an empty string
    reads in the app as a reply with no content -- so this walks the tree
    rather than checking the top level and giving up. HTML is the fallback,
    stripped, because a message with no plain part at all is still worth
    showing.
    """
    text = _walk_for_mime(payload, "text/plain")
    if text:
        return text
    html = _walk_for_mime(payload, "text/html")
    return _strip_html(html) if html else None


def _walk_for_mime(part, mime):
    if (part.get("mimeType") or "") == mime:
        decoded = _decode_body(part.get("body", {}))
        if decoded:
            return decoded
    for child in part.get("parts", []) or []:
        found = _walk_for_mime(child, mime)
        if found:
            return found
    return None


def _decode_body(body):
    data = body.get("data")
    if not data:
        return None
    try:
        raw = base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))
    except (ValueError, TypeError):
        return None
    return raw.decode("utf-8", errors="replace")


_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"[ \t]*\n[ \t]*")


def _strip_html(html):
    text = re.sub(r"(?is)<(script|style).*?</\1>", " ", html)
    text = re.sub(r"(?i)<br\s*/?>", "\n", text)
    text = re.sub(r"(?i)</p\s*>", "\n\n", text)
    text = _TAG_RE.sub("", text)
    text = (text.replace("&nbsp;", " ").replace("&amp;", "&")
                .replace("&lt;", "<").replace("&gt;", ">")
                .replace("&quot;", '"').replace("&#39;", "'"))
    return _WS_RE.sub("\n", text).strip()


def quoted_reply_body(body, *, previous_body=None, previous_from=None):
    """[body] with the previous message quoted underneath, mail-client style.

    A follow-up that arrives with no context reads as a form letter. Quoting
    what was sent before is what every mail client does when you hit reply, and
    it costs nothing here.
    """
    text = (body or "").rstrip()
    if not previous_body:
        return text
    quoted = "\n".join(
        f"> {line}" for line in previous_body.strip().splitlines()
    )
    attribution = f"On an earlier message, {previous_from or 'we'} wrote:"
    return f"{text}\n\n{attribution}\n{quoted}\n"
