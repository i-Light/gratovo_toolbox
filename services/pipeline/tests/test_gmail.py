"""The Gmail client over a fake opener: what it sends, what it reads back, and the name each
failure gets. No test reaches the network."""

import base64
import http.client
import io
import json
from collections.abc import Iterator
from email import message_from_bytes, policy
from email.message import Message
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlsplit
from urllib.request import Request

import pytest

from gratovo_pipeline import net
from gratovo_pipeline.mail import gmail
from gratovo_pipeline.mail.gmail import (
    BadAddressError,
    GmailClient,
    MailApiError,
    MailAuthError,
    MailError,
    MailNetworkError,
)

CLIENT_ID = "client-id-123.apps.example"
CLIENT_SECRET = "client-secret-SECRET-xyz"  # noqa: S105 - a fake
REFRESH = "refresh-token-SECRET-abc"
ACCESS = "access-token-SECRET-def"
SECRETS = (CLIENT_SECRET, REFRESH, ACCESS)
ME = "outreach@gratovo.example"

type Answer = object  # a JSON-able body, or an exception to raise


class FakeOpener:
    def __init__(self, *answers: Answer) -> None:
        self.answers = list(answers)
        self.requests: list[Request] = []
        self.timeouts: list[float] = []

    def __call__(self, request: Request, timeout: float) -> io.BytesIO:
        self.requests.append(request)
        self.timeouts.append(timeout)
        answer = self.answers.pop(0)
        if isinstance(answer, BaseException):
            raise answer
        return io.BytesIO(json.dumps(answer).encode())

    def path(self, index: int) -> str:
        return urlsplit(self.requests[index].full_url).path

    def json_body(self, index: int) -> dict[str, Any]:
        data = self.requests[index].data
        assert isinstance(data, bytes)
        return json.loads(data)


class Sleeper:
    def __init__(self) -> None:
        self.waits: list[float] = []

    def __call__(self, seconds: float) -> None:
        self.waits.append(seconds)


def http_error(code: int, body: object = None) -> HTTPError:
    raw = io.BytesIO(json.dumps(body).encode()) if body is not None else io.BytesIO(b"")
    return HTTPError("https://gmail.googleapis.com/x", code, "error", Message(), raw)


def client(opener: FakeOpener, sleeper: Sleeper | None = None) -> GmailClient:
    return GmailClient(
        ACCESS, sender_name="Sam at Gratovo", open_url=opener, sleep=sleeper or Sleeper()
    )


def refresh(opener: FakeOpener, sleeper: Sleeper | None = None) -> str:
    return gmail.refresh_access_token(
        client_id=CLIENT_ID,
        client_secret=CLIENT_SECRET,
        refresh_token=REFRESH,
        open_url=opener,
        sleep=sleeper or Sleeper(),
    )


@pytest.fixture(autouse=True)
def mail_hosts() -> Iterator[None]:
    net.allow_job_hosts("mail.send")
    yield
    net.allow_job_hosts("search")


PROFILE = {"emailAddress": ME}


def b64(text: str) -> str:
    return base64.urlsafe_b64encode(text.encode()).decode("ascii").rstrip("=")


def sent_mime(opener: FakeOpener, index: int) -> Message:
    raw = opener.json_body(index)["raw"]
    return message_from_bytes(base64.urlsafe_b64decode(raw), policy=policy.default)


# --- the token ---


def test_refresh_sends_the_form_and_returns_the_token() -> None:
    opener = FakeOpener({"access_token": ACCESS, "expires_in": 3599})
    assert refresh(opener) == ACCESS
    request = opener.requests[0]
    assert request.get_method() == "POST"
    assert request.full_url == "https://oauth2.googleapis.com/token"
    assert request.get_header("Content-type") == "application/x-www-form-urlencoded"
    assert isinstance(request.data, bytes)
    form = parse_qs(request.data.decode())
    assert form == {
        "grant_type": ["refresh_token"],
        "client_id": [CLIENT_ID],
        "client_secret": [CLIENT_SECRET],
        "refresh_token": [REFRESH],
    }
    assert opener.timeouts == [30.0]


def test_refresh_never_puts_a_secret_in_the_url() -> None:
    opener = FakeOpener({"access_token": ACCESS})
    refresh(opener)
    url = opener.requests[0].full_url
    assert not any(secret in url for secret in SECRETS)
    assert "Authorization" not in opener.requests[0].headers


@pytest.mark.parametrize(
    ("answer", "error", "code"),
    [
        (http_error(400, {"error": "invalid_grant"}), MailAuthError, "mail_auth"),
        (http_error(401, {"error": "invalid_client"}), MailAuthError, "mail_auth"),
        (http_error(400, {"error": "unauthorized_client"}), MailAuthError, "mail_auth"),
        (http_error(400, {"error": "invalid_request"}), MailApiError, "mail_api"),
        (http_error(400, {"error": "Some Text, with SECRET"}), MailApiError, "mail_api"),
        (http_error(403, None), MailApiError, "mail_api"),
        (URLError("down"), MailNetworkError, "network"),
        (TimeoutError("slow"), MailNetworkError, "network"),
    ],
)
def test_each_token_refusal_has_its_error_and_code(
    answer: BaseException, error: type[MailError], code: str
) -> None:
    attempts = 4 if isinstance(answer, URLError | TimeoutError) else 1
    opener = FakeOpener(*[answer] * attempts)
    with pytest.raises(error) as raised:
        refresh(opener)
    assert raised.value.code == code
    assert not any(secret in str(raised.value) for secret in SECRETS)


def test_invalid_grant_explains_the_seven_day_rule() -> None:
    opener = FakeOpener(http_error(400, {"error": "invalid_grant"}))
    with pytest.raises(MailAuthError, match="seven days") as raised:
        refresh(opener)
    assert "Settings" in str(raised.value)


def test_a_token_answer_without_a_token_is_an_api_error() -> None:
    with pytest.raises(MailApiError):
        refresh(FakeOpener({"expires_in": 5}))


def test_connect_refreshes_then_uses_the_token_in_the_header() -> None:
    opener = FakeOpener({"access_token": ACCESS}, PROFILE)
    mail = gmail.connect(
        client_id=CLIENT_ID,
        client_secret=CLIENT_SECRET,
        refresh_token=REFRESH,
        sender_name="Sam",
        open_url=opener,
    )
    assert mail.address == ME
    assert opener.requests[1].get_header("Authorization") == f"Bearer {ACCESS}"


# --- the transport ---


def test_the_access_token_is_in_the_header_only() -> None:
    opener = FakeOpener(PROFILE)
    assert client(opener).address == ME
    request = opener.requests[0]
    assert request.get_header("Authorization") == f"Bearer {ACCESS}"
    assert ACCESS not in request.full_url
    assert request.full_url == "https://gmail.googleapis.com/gmail/v1/users/me/profile"


def test_the_address_is_asked_for_once() -> None:
    opener = FakeOpener(PROFILE)
    mail = client(opener)
    assert mail.address == mail.address == ME
    assert len(opener.requests) == 1


def test_a_429_then_a_200_retries_with_backoff() -> None:
    sleeper = Sleeper()
    opener = FakeOpener(http_error(429), http_error(503), PROFILE)
    assert client(opener, sleeper).address == ME
    assert len(opener.requests) == 3
    assert len(sleeper.waits) == 2
    assert 1.0 <= sleeper.waits[0] <= 1.4
    assert 2.0 <= sleeper.waits[1] <= 2.4


def test_four_failed_attempts_give_up() -> None:
    sleeper = Sleeper()
    opener = FakeOpener(*[http_error(503)] * 4)
    with pytest.raises(MailApiError) as raised:
        client(opener, sleeper).address  # noqa: B018 - the property makes the call
    assert raised.value.status == 503
    assert len(opener.requests) == 4
    assert len(sleeper.waits) == 3


def test_a_connection_error_is_retried_then_named_network() -> None:
    sleeper = Sleeper()
    opener = FakeOpener(*[ConnectionResetError("reset")] * 4)
    with pytest.raises(MailNetworkError) as raised:
        client(opener, sleeper).address  # noqa: B018 - the property makes the call
    assert raised.value.code == "network"
    assert len(sleeper.waits) == 3


def test_a_401_is_an_auth_error_and_not_retried() -> None:
    opener = FakeOpener(http_error(401))
    with pytest.raises(MailAuthError, match="Settings") as raised:
        client(opener).address  # noqa: B018 - the property makes the call
    assert raised.value.code == "mail_auth"
    assert len(opener.requests) == 1


def test_a_403_is_an_api_error_with_the_old_words() -> None:
    opener = FakeOpener(http_error(403, {"error": {"message": "a raw body SECRET"}}))
    with pytest.raises(MailApiError, match="daily sending limit") as raised:
        client(opener).address  # noqa: B018 - the property makes the call
    assert raised.value.status == 403
    assert "SECRET" not in str(raised.value)


def test_a_host_outside_the_rule_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    opener = FakeOpener(PROFILE)
    monkeypatch.setattr(gmail, "API", "https://evil.example/gmail/v1/users/me")
    with pytest.raises(net.HostNotAllowedError):
        client(opener).address  # noqa: B018 - the property makes the call
    assert opener.requests == []


def test_gmail_is_refused_when_the_job_is_not_a_mail_job() -> None:
    net.allow_job_hosts("search")
    opener = FakeOpener(PROFILE)
    with pytest.raises(net.HostNotAllowedError):
        client(opener).address  # noqa: B018 - the property makes the call
    with pytest.raises(net.HostNotAllowedError):
        refresh(FakeOpener({"access_token": ACCESS}))


def test_an_answer_that_is_not_json_is_an_api_error() -> None:
    class Garbage(FakeOpener):
        def __call__(self, request: Request, timeout: float) -> io.BytesIO:
            self.requests.append(request)
            return io.BytesIO(b"<html>oops</html>")

    with pytest.raises(MailApiError):
        client(Garbage()).address  # noqa: B018 - the property makes the call


# --- labels ---


def test_a_label_is_listed_then_created_once_and_cached() -> None:
    opener = FakeOpener({"labels": [{"id": "L1", "name": "Other"}]}, {"id": "L9"})
    mail = client(opener)
    assert mail.ensure_label("Gratovo Outreach") == "L9"
    assert mail.ensure_label("gratovo outreach") == "L9"
    assert [opener.path(i) for i in range(2)] == [
        "/gmail/v1/users/me/labels",
        "/gmail/v1/users/me/labels",
    ]
    assert opener.requests[0].get_method() == "GET"
    assert opener.json_body(1)["name"] == "Gratovo Outreach"
    assert len(opener.requests) == 2


def test_an_existing_label_is_found_without_creating() -> None:
    opener = FakeOpener({"labels": [{"id": "L1", "name": "Gratovo Outreach"}]})
    assert client(opener).ensure_label("Gratovo Outreach") == "L1"
    assert len(opener.requests) == 1


def test_a_blank_label_is_nothing() -> None:
    opener = FakeOpener()
    assert client(opener).ensure_label("  ") is None
    assert opener.requests == []


# --- sending ---


def test_a_first_send_builds_the_message_and_labels_it() -> None:
    opener = FakeOpener(
        PROFILE,  # the From address
        {"id": "m1", "threadId": "t1"},  # send
        {"labels": []},  # label list
        {"id": "L7"},  # label create
        {},  # modify
        {"payload": {"headers": [{"name": "Message-ID", "value": "<abc@mail.gmail.com>"}]}},
    )
    result = client(opener).send(
        to="creator@aitoolsweekly.example",
        subject="Your video on AI agents",
        body="Hi, we loved your video.",
        labels=["Gratovo Outreach", "Gratovo Outreach", " "],
    )
    assert result == {
        "messageId": "m1",
        "threadId": "t1",
        "rfcMessageId": "<abc@mail.gmail.com>",
        "labelId": "L7",
    }
    assert opener.path(1) == "/gmail/v1/users/me/messages/send"
    body = opener.json_body(1)
    assert "threadId" not in body
    mime = sent_mime(opener, 1)
    assert mime["To"] == "creator@aitoolsweekly.example"
    assert mime["Subject"] == "Your video on AI agents"
    assert mime["From"] == f"Sam at Gratovo <{ME}>"
    assert mime["In-Reply-To"] is None
    assert opener.path(4) == "/gmail/v1/users/me/messages/m1/modify"
    assert opener.json_body(4) == {"addLabelIds": ["L7"]}
    query = parse_qs(urlsplit(opener.requests[5].full_url).query)
    assert query == {"format": ["metadata"], "metadataHeaders": ["Message-ID"]}
    assert all(r.get_header("Authorization") == f"Bearer {ACCESS}" for r in opener.requests)


def _send(mail: GmailClient, subject: str = "Hi") -> gmail.SendResult:
    return mail.send(to="creator@aitoolsweekly.example", subject=subject, body="Hello")


@pytest.mark.parametrize(
    ("answer", "kind"),
    [
        (TimeoutError("slow"), MailNetworkError),
        (ConnectionResetError("reset"), MailNetworkError),
        (http_error(503), MailApiError),
        (http_error(500), MailApiError),
    ],
)
def test_a_send_is_posted_once_when_its_answer_is_lost(answer: Answer, kind: type) -> None:
    """Gmail may have the message: a second POST would send it twice."""
    sleeper = Sleeper()
    opener = FakeOpener(PROFILE, answer, {"id": "m2", "threadId": "t2"})
    with pytest.raises(kind, match="Sent folder"):
        _send(client(opener, sleeper))
    sends = [r for r in opener.requests if r.full_url.endswith("/messages/send")]
    assert len(sends) == 1
    assert sleeper.waits == []


def test_a_send_that_never_went_out_is_retried() -> None:
    sleeper = Sleeper()
    refused = URLError(ConnectionRefusedError("refused"))
    opener = FakeOpener(PROFILE, refused, {"id": "m1", "threadId": "t1"}, {"payload": {}})
    assert _send(client(opener, sleeper))["messageId"] == "m1"
    assert len(sleeper.waits) == 1


def test_a_send_that_could_never_go_out_says_nothing_was_sent() -> None:
    opener = FakeOpener(PROFILE, *[URLError(ConnectionRefusedError("refused"))] * 4)
    with pytest.raises(gmail.MailUnreachableError, match="nothing was sent") as raised:
        _send(client(opener, Sleeper()))
    assert raised.value.code == "network"


def test_a_cut_off_answer_to_a_send_may_have_gone_out() -> None:
    opener = FakeOpener(PROFILE, http.client.IncompleteRead(b"{"), {"id": "m2"})
    with pytest.raises(MailNetworkError, match="Sent folder") as raised:
        _send(client(opener, Sleeper()))
    assert not isinstance(raised.value, gmail.MailUnreachableError)
    assert [r.full_url.endswith("/messages/send") for r in opener.requests].count(True) == 1


def test_a_rate_limited_send_is_retried() -> None:
    sleeper = Sleeper()
    opener = FakeOpener(PROFILE, http_error(429), {"id": "m1", "threadId": "t1"}, {"payload": {}})
    assert _send(client(opener, sleeper))["messageId"] == "m1"
    assert [r.full_url.endswith("/messages/send") for r in opener.requests].count(True) == 2
    assert len(sleeper.waits) == 1


@pytest.mark.parametrize("subject", ["Hi\nBcc: someone@example.com", "Hi\r\nthere"])
def test_a_subject_with_a_line_break_is_refused_before_any_send(subject: str) -> None:
    opener = FakeOpener(PROFILE)
    with pytest.raises(gmail.BadHeaderError) as raised:
        _send(client(opener), subject)
    assert raised.value.code == "bad_start"
    assert not any(r.full_url.endswith("/messages/send") for r in opener.requests)


def test_a_threaded_send_carries_the_thread_and_the_chain() -> None:
    opener = FakeOpener(PROFILE, {"id": "m2", "threadId": "t1"}, {"payload": {}})
    result = client(opener).send(
        to="creator@aitoolsweekly.example",
        subject="Re: Your video",
        body="Following up.",
        thread_id="t1",
        in_reply_to="<second@x>",
        references=["<first@x>", "<second@x>"],
    )
    assert result["threadId"] == "t1"
    assert result["rfcMessageId"] is None
    assert result["labelId"] is None
    assert opener.json_body(1)["threadId"] == "t1"
    mime = sent_mime(opener, 1)
    assert mime["In-Reply-To"] == "<second@x>"
    assert mime["References"] == "<first@x> <second@x>"


def test_the_parent_is_added_to_the_chain_when_missing() -> None:
    opener = FakeOpener(PROFILE, {"id": "m2", "threadId": "t1"}, {})
    client(opener).send(
        to="creator@aitoolsweekly.example",
        subject="Re: x",
        body="Hi",
        thread_id="t1",
        in_reply_to="<b@x>",
        references=["<a@x>"],
    )
    assert sent_mime(opener, 1)["References"] == "<a@x> <b@x>"


def test_a_label_failure_after_the_send_still_returns_the_result() -> None:
    opener = FakeOpener(
        PROFILE,
        {"id": "m1", "threadId": "t1"},
        http_error(403),  # the label list
        {"payload": {"headers": [{"name": "message-id", "value": "<id@x>"}]}},
    )
    result = client(opener).send(
        to="creator@aitoolsweekly.example", subject="Hi", body="Hello", labels=["Outreach"]
    )
    assert result["messageId"] == "m1"
    assert result["labelId"] is None
    assert result["rfcMessageId"] == "<id@x>"


def test_a_bad_address_is_refused_before_any_call() -> None:
    opener = FakeOpener()
    with pytest.raises(BadAddressError) as raised:
        client(opener).send(to="not-an-address", subject="Hi", body="Hello")
    assert raised.value.code == "bad_start"
    assert opener.requests == []


def test_a_huge_body_is_refused_before_any_call() -> None:
    opener = FakeOpener()
    with pytest.raises(MailError) as raised:
        client(opener).send(
            to="creator@aitoolsweekly.example",
            subject="Hi",
            body="x" * (gmail.MAX_BODY_BYTES + 1),
        )
    assert raised.value.code == "bad_start"
    assert opener.requests == []


# --- replies ---


def message(
    message_id: str, sender: str, at: int, text: str = "the reply", subject: str = "Re: Hi"
) -> dict[str, Any]:
    return {
        "id": message_id,
        "internalDate": str(at),
        "snippet": text[:20],
        "payload": {
            "mimeType": "text/plain",
            "headers": [
                {"name": "From", "value": sender},
                {"name": "Subject", "value": subject},
            ],
            "body": {"data": b64(text)},
        },
    }


def test_replies_drop_our_own_and_excluded_messages_and_come_oldest_first() -> None:
    thread = {
        "messages": [
            message("m4", "Creator <creator@aitoolsweekly.example>", 4000, "latest"),
            message("m1", f"Sam <{ME.upper()}>", 1000, "our first"),
            message("m3", "Brand Rep <rep@acmeai.example>", 3000, "middle"),
            message("m2", "creator@aitoolsweekly.example", 2000, "already reported"),
            message("m5", "", 5000, "no sender"),
        ]
    }
    opener = FakeOpener(PROFILE, thread)
    found = client(opener).replies("t1", exclude_ids={"m2"})
    assert [r["messageId"] for r in found] == ["m3", "m4"]
    assert found[0]["from"] == "rep@acmeai.example"
    assert found[0]["fromName"] == "Brand Rep"
    assert found[0]["body"] == "middle"
    assert found[0]["at"] == 3000
    assert found[0]["subject"] == "Re: Hi"
    assert opener.path(1) == "/gmail/v1/users/me/threads/t1"
    assert parse_qs(urlsplit(opener.requests[1].full_url).query) == {"format": ["full"]}


def test_a_reply_without_a_body_falls_back_to_its_snippet() -> None:
    reply = message("m2", "creator@aitoolsweekly.example", 1000)
    reply["payload"] = {
        "headers": [{"name": "From", "value": "creator@aitoolsweekly.example"}],
        "body": {},
    }
    reply["snippet"] = "just the snippet"
    found = client(FakeOpener(PROFILE, {"messages": [reply]})).replies("t1")
    assert found[0]["body"] == "just the snippet"
    assert found[0]["fromName"] is None


# --- no message carries a secret ---


def _use(action: str, mail: GmailClient) -> object:
    if action == "address":
        return mail.address
    if action == "send":
        return mail.send(to="creator@aitoolsweekly.example", subject="Hi", body="Hello")
    return mail.replies("t1")


@pytest.mark.parametrize("action", ["address", "send", "replies"])
@pytest.mark.parametrize("status", [400, 401, 403, 404, 429, 500])
def test_no_error_message_carries_a_secret(status: int, action: str) -> None:
    leak = {"error": {"message": f"{ACCESS} {REFRESH} {CLIENT_SECRET}"}}
    opener = FakeOpener(*[http_error(status, leak)] * 8)
    with pytest.raises(MailError) as raised:
        _use(action, client(opener))
    text = str(raised.value) + raised.value.message
    assert not any(secret in text for secret in SECRETS)


# --- parsing (ported from the old MessageParsingTest) ---


def part(
    mime: str, text: str | None = None, parts: list[dict[str, Any]] | None = None
) -> dict[str, Any]:
    node: dict[str, Any] = {"mimeType": mime}
    if text is not None:
        node["body"] = {"data": b64(text)}
    if parts:
        node["parts"] = parts
    return node


def test_plain_text_is_found_however_deeply_nested() -> None:
    payload = part(
        "multipart/mixed",
        parts=[
            part(
                "multipart/alternative",
                parts=[
                    part("text/plain", "the actual reply"),
                    part("text/html", "<p>the actual reply</p>"),
                ],
            )
        ],
    )
    assert gmail.plain_text(payload) == "the actual reply"


def test_an_html_only_reply_still_produces_text() -> None:
    text = gmail.plain_text(part("text/html", "<p>Hi there</p><br><p>Sounds good</p>"))
    assert text is not None
    assert "Hi there" in text
    assert "<p>" not in text


def test_a_payload_with_no_text_gives_none() -> None:
    assert gmail.plain_text({"mimeType": "image/png"}) is None


def test_re_is_not_stacked() -> None:
    assert gmail.reply_subject("Hello") == "Re: Hello"
    assert gmail.reply_subject("Re: Hello") == "Re: Hello"
    assert gmail.reply_subject("RE: Hello") == "RE: Hello"
    assert gmail.reply_subject("  ") == ""


def test_addresses_are_validated_before_the_api_call() -> None:
    assert gmail.looks_like_address("a@b.co")
    assert gmail.looks_like_address("A Name <a@b.co>")
    assert not gmail.looks_like_address("not-an-address")
    assert not gmail.looks_like_address("a@b")
    assert not gmail.looks_like_address("")


def test_a_follow_up_quotes_what_came_before() -> None:
    quoted = gmail.quoted_reply_body(
        "Just checking in.",
        previous_body="Hello there.\nWe loved your channel.",
        previous_from="us@gratovo.example",
    )
    assert quoted.startswith("Just checking in.")
    assert "> Hello there." in quoted
    assert "> We loved your channel." in quoted


def test_a_first_message_is_not_quoted() -> None:
    assert gmail.quoted_reply_body("Hello.") == "Hello."


def test_header_lookup_is_case_insensitive() -> None:
    payload = {"headers": [{"name": "Message-ID", "value": "<a@x>"}]}
    assert gmail.header(payload, "message-id") == "<a@x>"
    assert gmail.header(payload, "subject") is None
