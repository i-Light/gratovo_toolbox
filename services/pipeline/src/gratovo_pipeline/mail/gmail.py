"""The team's Gmail mailbox, over Gmail's REST API.

Outreach is sent from a real mailbox rather than a transactional mail service, on purpose: a cold
email to a creator has to arrive in a personal inbox, be replyable the ordinary way, and leave a
thread the sender can open in Gmail. This module does exactly one thing, talk to Gmail. It keeps
no state, decides no policy and knows nothing about outreach conversations.

Standard library only (ADR 0013 section 7): a token refresh and a handful of JSON calls don't need
Google's client libraries. What the caller supplies is the OAuth client id and secret and one
refresh token per mailbox, from the secret store; this module never reads a file.

The access token is minted by `refresh_access_token`, lives in memory, and travels only in the
`Authorization` header, as an unredirected header on an opener that follows no redirects and uses
no proxy, so it reaches Google and nowhere else. No message here carries a token, the client
secret, or any text Google sent back beyond a short reason word.

A note that must not be lost: while the Google Cloud project is in "Testing" mode, a refresh token
issued to a test user expires after seven days. `invalid_grant` is how that presents, so the
message for it says so.

Scopes the mailbox grant needs: `gmail.modify` (label a sent message, read a thread back) and
`gmail.send`. Granting them is main's job (step 6); this module only uses the resulting token.
"""

from __future__ import annotations

import base64
import http.client
import json
import random
import re
import time
import urllib.request
from collections.abc import Callable, Collection, Mapping, Sequence
from email.message import EmailMessage
from email.utils import formataddr, parseaddr
from typing import Any, Final, Literal, NoReturn, Protocol, TypedDict, cast
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode

from gratovo_pipeline import net

TOKEN_URL: Final = "https://oauth2.googleapis.com/token"  # noqa: S105 - an address, not a secret
API: Final = "https://gmail.googleapis.com/gmail/v1/users/me"
TIMEOUT: Final = 30.0

# Retried with a pause: 429 is Gmail's per-user rate limit and the 5xx family is Google having a
# bad moment. Anything else (400, 401, 403) is a fact about the request or the grant. A send is
# retried on 429 alone: after a 5xx or a lost answer Gmail may have the message, and a second
# POST would send it twice.
RETRY_STATUSES: Final = frozenset({429, 500, 502, 503, 504})
SEND_RETRY_STATUSES: Final = frozenset({429})
MAX_ATTEMPTS: Final = 4
BASE_BACKOFF_SECONDS: Final = 1.0

# A message this size is a mistake, not outreach; saying so before the call beats a 400.
MAX_BODY_BYTES: Final = 1_000_000
MAX_ANSWER: Final = 16 * 1024 * 1024

_RECONNECT: Final = "Reconnect the mailbox in Settings."
_MAYBE_SENT: Final = (
    "Gmail didn't confirm the send, so the message may have gone out. Check the Sent folder "
    "before sending it again."
)
_SAFE_REASON: Final = re.compile(r"[a-z][a-z_]{0,39}")
_UNSENT: Final = "unsent"  # a _Failure's reason when the request never went out

type ErrorCode = Literal["mail_not_connected", "mail_auth", "mail_api", "network", "bad_start"]


class MailError(Exception):
    """Anything that stopped a mailbox operation. `code` is the protocol's end error code."""

    code: ErrorCode = "mail_api"

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class MailNotConnectedError(MailError):
    """No client, or no such mailbox, in what the app supplied."""

    code: ErrorCode = "mail_not_connected"


class MailAuthError(MailError):
    """Google refused the credentials."""

    code: ErrorCode = "mail_auth"


class MailApiError(MailError):
    """Gmail answered, and the answer was an error."""

    code: ErrorCode = "mail_api"

    def __init__(self, message: str, *, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


class MailNetworkError(MailError):
    """Google stayed unreachable after the retries."""

    code: ErrorCode = "network"


class MailUnreachableError(MailNetworkError):
    """Google couldn't be reached at all: the request never went out, so nothing was sent."""


class BadAddressError(MailError):
    """The recipient isn't a usable email address."""

    code: ErrorCode = "bad_start"


class MessageTooLargeError(MailError):
    """The body is too large to be outreach."""

    code: ErrorCode = "bad_start"


class BadHeaderError(MailError):
    """A subject or sender name that can't go in a header (a line break, say)."""

    code: ErrorCode = "bad_start"


class SendResult(TypedDict):
    messageId: str
    threadId: str | None
    rfcMessageId: str | None  # the header the next message in the thread must quote
    labelId: str | None  # the first label applied, or None


Reply = TypedDict(
    "Reply",
    {
        "messageId": str,
        "from": str,
        "fromName": str | None,
        "subject": str,
        "at": int | None,  # epoch milliseconds, as Gmail gives it
        "body": str,
        "snippet": str,
    },
)


class Body(Protocol):
    def read(self, size: int = -1, /) -> bytes: ...
    def close(self) -> None: ...


type Opener = Callable[[urllib.request.Request, float], Body]


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Google's APIs don't redirect; one that tries is refused rather than followed."""

    def redirect_request(self, *_args: Any, **_kwargs: Any) -> None:
        return None


_OPENER: Final = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())


def _open(request: urllib.request.Request, timeout: float) -> Body:
    return cast("Body", _OPENER.open(request, timeout=timeout))


class _Failure(Exception):  # noqa: N818 - a signal inside this module, not an error
    """The last refusal after the retries: an HTTP status and a safe reason word, or neither
    (status 0) when the host could not be reached."""

    def __init__(self, status: int, reason: str | None) -> None:
        super().__init__(status)
        self.status = status
        self.reason = reason


def _dict(value: object) -> dict[str, Any]:
    return cast("dict[str, Any]", value) if isinstance(value, dict) else {}


def _list(value: object) -> list[object]:
    return cast("list[object]", value) if isinstance(value, list) else []


def _str(value: object) -> str | None:
    return value if isinstance(value, str) else None


def _reason(error: HTTPError) -> str | None:
    """The OAuth `error` word in a token refusal, when it is a plain lowercase word."""
    try:
        data: object = json.loads(error.read(64 * 1024) or b"null")
    except ValueError, OSError:
        return None
    word = _str(_dict(data).get("error"))
    return word if word and _SAFE_REASON.fullmatch(word) else None


def _request(
    open_url: Opener,
    sleep: Callable[[float], None],
    url: str,
    *,
    method: str = "GET",
    headers: Mapping[str, str] | None = None,
    unredirected: Mapping[str, str] | None = None,
    data: bytes | None = None,
    idempotent: bool = True,
) -> object:
    """One call with the retries. Returns the parsed JSON answer; raises `_Failure` for a
    refusal or an unreachable host, MailApiError for an answer that isn't JSON. A call that
    isn't `idempotent` is retried only on 429, never after a lost answer or a 5xx."""
    retry_statuses = RETRY_STATUSES if idempotent else SEND_RETRY_STATUSES
    net.check_url(url)
    for attempt in range(MAX_ATTEMPTS):
        request = urllib.request.Request(  # noqa: S310 - check_url allowed it
            url, data=data, method=method, headers=dict(headers or {})
        )
        for name, value in (unredirected or {}).items():
            request.add_unredirected_header(name, value)
        last = attempt == MAX_ATTEMPTS - 1
        try:
            body = open_url(request, TIMEOUT)
            try:
                raw = body.read(MAX_ANSWER)
            finally:
                body.close()
        except HTTPError as error:
            if error.code in retry_statuses and not last:
                _pause(sleep, attempt)
                continue
            raise _Failure(error.code, _reason(error)) from None
        except URLError:
            # urllib wraps only a request that never went out (connect, DNS, TLS, writing it):
            # Gmail has nothing, so even a send may try again.
            if not last:
                _pause(sleep, attempt)
                continue
            raise _Failure(0, _UNSENT) from None
        except TimeoutError, ConnectionError, OSError, http.client.HTTPException:
            # The request went out and the answer was lost: Gmail may have acted on it.
            if idempotent and not last:
                _pause(sleep, attempt)
                continue
            raise _Failure(0, None) from None
        if not raw.strip():
            return {}
        try:
            return json.loads(raw)
        except ValueError:
            raise MailApiError("Gmail sent an answer that could not be read.") from None
    raise AssertionError("unreachable")  # pragma: no cover


def _pause(sleep: Callable[[float], None], attempt: int) -> None:
    # Jitter, so a burst of sends that hit the rate limit together don't retry together.
    sleep(BASE_BACKOFF_SECONDS * 2**attempt + random.uniform(0, 0.4))  # noqa: S311 - jitter, not security


# --- the token ---


def refresh_access_token(
    *,
    client_id: str,
    client_secret: str,
    refresh_token: str,
    open_url: Opener = _open,
    sleep: Callable[[float], None] = time.sleep,
) -> str:
    """A fresh access token for one mailbox. It is never cached: a job lives seconds."""
    form = urlencode(
        {
            "grant_type": "refresh_token",
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
        }
    ).encode()
    try:
        answer = _request(
            open_url,
            sleep,
            TOKEN_URL,
            method="POST",
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json",
            },
            data=form,
        )
    except _Failure as failure:
        _raise_token_failure(failure)
    token = _str(_dict(answer).get("access_token"))
    if not token:
        raise MailApiError("Google answered the sign-in without an access token.")
    return token


def _raise_token_failure(failure: _Failure) -> NoReturn:
    if failure.status == 0:
        raise MailNetworkError("Couldn't reach Google to sign in to the mailbox.") from None
    if failure.reason == "invalid_grant":
        raise MailAuthError(
            "Google rejected the saved refresh token. While the OAuth app is in Testing mode a "
            "token lasts seven days. Reconnect the mailbox in Settings, or publish the OAuth app "
            "to Production."
        ) from None
    if failure.reason in ("invalid_client", "unauthorized_client"):
        raise MailAuthError(
            "Google rejected the OAuth client. Check the client id and secret in Settings."
        ) from None
    named = f", {failure.reason}" if failure.reason else ""
    raise MailApiError(
        f"Google refused to sign in to the mailbox (HTTP {failure.status}{named}).",
        status=failure.status,
    ) from None


# --- the client ---


class GmailClient:
    """One authenticated mailbox. The profile and every label id are fetched at most once."""

    def __init__(
        self,
        access_token: str,
        *,
        sender_name: str | None = None,
        open_url: Opener = _open,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._token = access_token
        self._sender_name = (sender_name or "").strip() or None
        self._open = open_url
        self._sleep = sleep
        self._address: str | None = None
        self._label_ids: dict[str, str] = {}

    @property
    def address(self) -> str:
        """The address this mailbox sends as. One call, then cached."""
        if self._address is None:
            profile = self._call("/profile")
            address = (_str(profile.get("emailAddress")) or "").strip()
            if not address:
                raise MailApiError("Gmail didn't say which address this mailbox is.")
            self._address = address
        return self._address

    def ensure_label(self, name: str) -> str | None:
        """The id of the label `name`, creating it when the mailbox has none. Nested names
        ("Gratovo Outreach/Influencers") are ordinary names to Gmail."""
        key = name.strip()
        if not key:
            return None
        cached = self._label_ids.get(key.lower())
        if cached:
            return cached
        for label in _list(self._call("/labels").get("labels")):
            entry = _dict(label)
            label_name, label_id = _str(entry.get("name")), _str(entry.get("id"))
            if label_name and label_id:
                self._label_ids[label_name.lower()] = label_id
        cached = self._label_ids.get(key.lower())
        if cached:
            return cached
        created = self._call(
            "/labels",
            body={
                "name": key,
                "labelListVisibility": "labelShow",
                "messageListVisibility": "show",
            },
        )
        label_id = _str(created.get("id"))
        if not label_id:
            raise MailApiError("Gmail created the label without saying its id.")
        self._label_ids[key.lower()] = label_id
        return label_id

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
    ) -> SendResult:
        """Sends one message and returns what is needed to continue the thread.

        `thread_id` and `in_reply_to` are what land a follow-up inside the conversation the
        first message started, and they go together: `threadId` files it right on the sender's
        side, `In-Reply-To` and `References` are what every other mail client reads. A label
        failure never fails the send: the message is already gone, and a caller told "not sent"
        would send it twice.
        """
        recipient = to.strip()
        if not recipient or not looks_like_address(recipient):
            raise BadAddressError(f"{recipient or '(blank)'} is not a usable email address.")
        size = len(body.encode("utf-8"))
        if size > MAX_BODY_BYTES:
            raise MessageTooLargeError(f"The message body is too large to send ({size} bytes).")

        message = EmailMessage()
        message["To"] = recipient
        try:
            message["Subject"] = subject
            if self._sender_name:
                # Gmail overwrites any attempt to send as another address; the display name is
                # the only part of From worth setting.
                message["From"] = formataddr((self._sender_name, self.address))
        except ValueError:
            raise BadHeaderError(
                "The subject or the sender name has a line break, so it can't be sent."
            ) from None
        if in_reply_to:
            message["In-Reply-To"] = in_reply_to
            # The whole ancestry, not only the parent: clients walk this chain.
            chain = list(references or [])
            if in_reply_to not in chain:
                chain.append(in_reply_to)
            message["References"] = " ".join(chain)
        message.set_content(body)

        payload: dict[str, object] = {
            "raw": base64.urlsafe_b64encode(message.as_bytes()).decode("ascii")
        }
        if thread_id:
            payload["threadId"] = thread_id
        try:
            sent = self._call("/messages/send", body=payload, idempotent=False)
        except MailUnreachableError:
            raise MailUnreachableError(
                "Couldn't reach Gmail, so nothing was sent. Try again once the connection is back."
            ) from None
        except MailNetworkError:
            raise MailNetworkError(_MAYBE_SENT) from None
        except MailApiError as error:
            if error.status is not None and error.status >= 500:
                raise MailApiError(_MAYBE_SENT, status=error.status) from None
            raise
        message_id = _str(sent.get("id"))
        if not message_id:
            raise MailApiError("Gmail sent the message without saying its id.")

        label_id = self._apply_labels(message_id, labels)
        return {
            "messageId": message_id,
            "threadId": _str(sent.get("threadId")),
            "rfcMessageId": self._rfc_message_id(message_id),
            "labelId": label_id,
        }

    def _apply_labels(self, message_id: str, labels: Sequence[str]) -> str | None:
        names: list[str] = []
        for name in labels:
            clean = name.strip()
            if clean and clean not in names:
                names.append(clean)
        if not names:
            return None
        try:
            ids = [i for i in (self.ensure_label(n) for n in names) if i]
            if not ids:
                return None
            self._call(f"/messages/{quote(message_id, safe='')}/modify", body={"addLabelIds": ids})
        except MailError:
            return None
        return ids[0]

    def _rfc_message_id(self, message_id: str) -> str | None:
        """The `Message-ID` Gmail assigned, for the next reply to quote. Not knowable before
        the send, and not worth failing a sent message over."""
        query = urlencode({"format": "metadata", "metadataHeaders": "Message-ID"})
        try:
            meta = self._call(f"/messages/{quote(message_id, safe='')}?{query}")
        except MailError:
            return None
        return header(_dict(meta.get("payload")), "message-id")

    def replies(self, thread_id: str, *, exclude_ids: Collection[str] = ()) -> list[Reply]:
        """Every message in the thread that this mailbox did not send, oldest first.

        The test is the sender, not the label or the read state. `exclude_ids` drops messages
        already reported, so polling reports each reply once."""
        mine = self.address.lower()
        thread = self._call(f"/threads/{quote(thread_id, safe='')}?format=full")
        found: list[Reply] = []
        for raw in _list(thread.get("messages")):
            message = _dict(raw)
            message_id = _str(message.get("id"))
            if not message_id or message_id in exclude_ids:
                continue
            payload = _dict(message.get("payload"))
            name, sender = parseaddr(header(payload, "from") or "")
            if not sender or sender.lower() == mine:
                continue
            snippet = _str(message.get("snippet")) or ""
            found.append(
                {
                    "messageId": message_id,
                    "from": sender,
                    "fromName": name.strip() or None,
                    "subject": header(payload, "subject") or "",
                    "at": _epoch_millis(message.get("internalDate")),
                    "body": plain_text(payload) or snippet,
                    "snippet": snippet,
                }
            )
        found.sort(key=lambda item: item["at"] or 0)
        return found

    # --- the call ---

    def _call(
        self, path: str, *, body: Mapping[str, object] | None = None, idempotent: bool = True
    ) -> dict[str, Any]:
        url = f"{API}{path}"
        data = json.dumps(body).encode() if body is not None else None
        try:
            answer = _request(
                self._open,
                self._sleep,
                url,
                method="POST" if body is not None else "GET",
                headers={"Accept": "application/json"}
                | ({"Content-Type": "application/json"} if body is not None else {}),
                unredirected={"Authorization": f"Bearer {self._token}"},
                data=data,
                idempotent=idempotent,
            )
        except _Failure as failure:
            _raise_api_failure(failure)
        return _dict(answer)


def _raise_api_failure(failure: _Failure) -> NoReturn:
    status = failure.status
    if status == 0:
        if failure.reason == _UNSENT:
            raise MailUnreachableError("Couldn't reach Gmail.") from None
        raise MailNetworkError("Couldn't reach Gmail.") from None
    if status == 401:
        raise MailAuthError(f"Gmail rejected the credentials. {_RECONNECT}") from None
    if status == 403:
        raise MailApiError(
            "Gmail refused the request. The mailbox may be over its daily sending limit, or the "
            "grant may be missing the gmail.modify scope; reconnecting the mailbox in Settings "
            "asks for it again.",
            status=status,
        ) from None
    if status == 429:
        raise MailApiError(
            "Gmail is rate limiting this mailbox. Try again shortly.", status=status
        ) from None
    if status >= 500:
        raise MailApiError(
            "Gmail is unavailable right now. Try again shortly.", status=status
        ) from None
    raise MailApiError(f"Gmail returned an error (HTTP {status}).", status=status) from None


def connect(
    *,
    client_id: str,
    client_secret: str,
    refresh_token: str,
    sender_name: str | None = None,
    open_url: Opener = _open,
    sleep: Callable[[float], None] = time.sleep,
) -> GmailClient:
    """A live client for one mailbox: refreshes the token, then wraps it."""
    token = refresh_access_token(
        client_id=client_id,
        client_secret=client_secret,
        refresh_token=refresh_token,
        open_url=open_url,
        sleep=sleep,
    )
    return GmailClient(token, sender_name=sender_name, open_url=open_url, sleep=sleep)


# --- message parsing ---

_ADDRESS_RE: Final = re.compile(r"^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$")
_TAG_RE: Final = re.compile(r"<[^>]+>")
_WS_RE: Final = re.compile(r"[ \t]*\n[ \t]*")


def looks_like_address(value: str) -> bool:
    _name, address = parseaddr(value)
    return bool(_ADDRESS_RE.match(address))


def header(payload: Mapping[str, Any], name: str) -> str | None:
    """The value of the header `name` (lowercase) in a Gmail payload."""
    for entry in _list(payload.get("headers")):
        item = _dict(entry)
        if (_str(item.get("name")) or "").lower() == name:
            return _str(item.get("value"))
    return None


def _epoch_millis(value: object) -> int | None:
    try:
        return int(cast("str | int", value))
    except TypeError, ValueError:
        return None


def plain_text(payload: Mapping[str, Any]) -> str | None:
    """The text/plain body of a Gmail payload, however deeply it is nested. Real replies are
    multipart/alternative inside multipart/mixed as often as a flat body. HTML is the fallback,
    stripped: a message with no plain part is still worth showing."""
    text = _walk_for_mime(payload, "text/plain")
    if text:
        return text
    html = _walk_for_mime(payload, "text/html")
    return _strip_html(html) if html else None


def _walk_for_mime(part: Mapping[str, Any], mime: str) -> str | None:
    if (_str(part.get("mimeType")) or "") == mime:
        decoded = _decode_body(_dict(part.get("body")))
        if decoded:
            return decoded
    for child in _list(part.get("parts")):
        found = _walk_for_mime(_dict(child), mime)
        if found:
            return found
    return None


def _decode_body(body: Mapping[str, Any]) -> str | None:
    data = _str(body.get("data"))
    if not data:
        return None
    try:
        raw = base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))
    except ValueError:
        return None
    return raw.decode("utf-8", errors="replace")


def _strip_html(html: str) -> str:
    text = re.sub(r"(?is)<(script|style).*?</\1>", " ", html)
    text = re.sub(r"(?i)<br\s*/?>", "\n", text)
    text = re.sub(r"(?i)</p\s*>", "\n\n", text)
    text = _TAG_RE.sub("", text)
    text = (
        text.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&#39;", "'")
    )
    return _WS_RE.sub("\n", text).strip()


def reply_subject(subject: str) -> str:
    """`Re: x`, without stacking a second `Re:` onto one that has it."""
    text = subject.strip()
    if not text:
        return ""
    return text if text[:3].lower() == "re:" else f"Re: {text}"


def quoted_reply_body(
    body: str, *, previous_body: str | None = None, previous_from: str | None = None
) -> str:
    """The body with the previous message quoted underneath, mail-client style. A follow-up with
    no context reads as a form letter."""
    text = body.rstrip()
    if not previous_body:
        return text
    quoted = "\n".join(f"> {line}" for line in previous_body.strip().splitlines())
    attribution = f"On an earlier message, {previous_from or 'we'} wrote:"
    return f"{text}\n\n{attribution}\n{quoted}\n"
