"""SigV4 signing against AWS's published examples, then the rules the gateway job relies on: header
and query normalisation, the body hash, and secrets kept out of `repr` and every error."""

import hashlib
import re
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta, timezone

import pytest

from gratovo_pipeline.aws_sign import Credentials, SigningError, sign, signing_key

# AWS's documentation keys (not real).
ACCESS_KEY = "AKIDEXAMPLE"
SECRET = "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY"  # noqa: S105 - AWS docs key
CREDS = Credentials(ACCESS_KEY, SECRET)
EXAMPLE_TIME = datetime(2015, 8, 30, 12, 36, 0, tzinfo=UTC)  # 20150830T123600Z

_AUTH = re.compile(
    r"AWS4-HMAC-SHA256 Credential=(?P<cred>[^,]+), "
    r"SignedHeaders=(?P<signed>[^,]+), Signature=(?P<sig>[0-9a-f]{64})"
)


def _auth(headers: Mapping[str, str]) -> dict[str, str]:
    match = _AUTH.fullmatch(headers["Authorization"])
    assert match is not None
    return match.groupdict()


def _suite_sign(
    method: str, target: str, headers: Mapping[str, str] | None = None, body: bytes = b""
) -> dict[str, str]:
    """A request from AWS's SigV4 test suite: host example.amazonaws.com, service `service`."""
    return sign(
        method=method,
        url=f"https://example.amazonaws.com{target}",
        headers=headers or {},
        body=body,
        region="us-east-1",
        service="service",
        credentials=CREDS,
        now=EXAMPLE_TIME,
    )


def _apigw_sign(
    body: bytes = b'{"name":"gw","protocolType":"HTTP"}',
    headers: Mapping[str, str] | None = None,
    url: str = "https://apigateway.us-east-1.amazonaws.com/v2/apis",
    *,
    content_sha256_header: bool = False,
) -> dict[str, str]:
    return sign(
        method="POST",
        url=url,
        headers=headers if headers is not None else {"Content-Type": "application/json"},
        body=body,
        region="us-east-1",
        service="apigateway",
        credentials=CREDS,
        now=datetime(2026, 10, 23, 9, 5, 7, tzinfo=UTC),
        content_sha256_header=content_sha256_header,
    )


# --- AWS's published examples ---------------------------------------------------------------


def test_iam_list_users_example() -> None:
    # "Create a signed AWS API request" (IAM user guide): GET ListUsers.
    headers = sign(
        method="GET",
        url="https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08",
        headers={"content-type": "application/x-www-form-urlencoded; charset=utf-8"},
        body=b"",
        region="us-east-1",
        service="iam",
        credentials=CREDS,
        now=EXAMPLE_TIME,
    )
    assert headers["Authorization"] == (
        "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, "
        "SignedHeaders=content-type;host;x-amz-date, "
        "Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7"
    )
    assert headers["X-Amz-Date"] == "20150830T123600Z"
    assert headers["Host"] == "iam.amazonaws.com"
    assert headers["content-type"] == "application/x-www-form-urlencoded; charset=utf-8"


def test_iam_example_signing_key() -> None:
    key = signing_key(SECRET, "20150830", "us-east-1", "iam")
    assert key.hex() == "c4afb1cc5771d871763a393e44b703571b55cc28424d1a5e86da6ed3c154a4b9"


@pytest.mark.parametrize(
    ("method", "target", "headers", "body", "signed", "signature"),
    [
        pytest.param(
            "GET",
            "/",
            {},
            b"",
            "host;x-amz-date",
            "5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
            id="get-vanilla",
        ),
        pytest.param(
            "POST",
            "/",
            {},
            b"",
            "host;x-amz-date",
            "5da7c1a2acd57cee7505fc6676e4e544621c30862966e37dddb68e92efbe5d6b",
            id="post-vanilla",
        ),
        pytest.param(
            "GET",
            "/?Param2=value2&Param1=value1",
            {},
            b"",
            "host;x-amz-date",
            "b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500",
            id="get-vanilla-query-order-key-case",
        ),
        pytest.param(
            "POST",
            "/",
            {"Content-Type": "application/x-www-form-urlencoded"},
            b"Param1=value1",
            "content-type;host;x-amz-date",
            "ff11897932ad3f4e8b18135d722051e5ac45fc38421b1da7b9d196a0fe09473a",
            id="post-x-www-form-urlencoded",
        ),
    ],
)
def test_sigv4_test_suite(
    method: str, target: str, headers: dict[str, str], body: bytes, signed: str, signature: str
) -> None:
    auth = _auth(_suite_sign(method, target, headers, body))
    assert auth["cred"] == "AKIDEXAMPLE/20150830/us-east-1/service/aws4_request"
    assert auth["signed"] == signed
    assert auth["sig"] == signature


# --- API Gateway, the job's own case --------------------------------------------------------


def test_apigateway_post_json() -> None:
    body = b'{"name":"gratovo-us-east-1","protocolType":"HTTP"}'
    headers = _apigw_sign(body, content_sha256_header=True)
    auth = _auth(headers)
    assert auth["cred"] == "AKIDEXAMPLE/20261023/us-east-1/apigateway/aws4_request"
    assert auth["signed"] == "content-type;host;x-amz-content-sha256;x-amz-date"
    assert headers["X-Amz-Content-Sha256"] == hashlib.sha256(body).hexdigest()
    assert headers["X-Amz-Date"] == "20261023T090507Z"
    assert headers["Host"] == "apigateway.us-east-1.amazonaws.com"
    assert headers["Content-Type"] == "application/json"


def test_apigateway_without_body_hash_header() -> None:
    headers = _apigw_sign()
    assert "X-Amz-Content-Sha256" not in headers
    assert _auth(headers)["signed"] == "content-type;host;x-amz-date"


def test_body_is_signed() -> None:
    first = _auth(_apigw_sign(b'{"name":"a"}'))["sig"]
    second = _auth(_apigw_sign(b'{"name":"b"}'))["sig"]
    assert first != second


def test_empty_body_hash() -> None:
    headers = _apigw_sign(b"", content_sha256_header=True)
    assert headers["X-Amz-Content-Sha256"] == (
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    )


def test_signing_is_deterministic() -> None:
    assert _apigw_sign() == _apigw_sign()


# --- Normalisation --------------------------------------------------------------------------


def test_header_case_and_whitespace_do_not_change_the_signature() -> None:
    plain = _auth(_apigw_sign(headers={"content-type": "application/json; charset=utf-8"}))
    messy = _auth(_apigw_sign(headers={"Content-TYPE": "  application/json;   charset=utf-8  "}))
    assert plain == messy


def test_headers_are_signed_in_sorted_order() -> None:
    headers = {"X-Zeta": "1", "Accept": "application/json", "content-type": "application/json"}
    auth = _auth(_apigw_sign(headers=headers))
    assert auth["signed"] == "accept;content-type;host;x-amz-date;x-zeta"


def test_header_value_is_signed() -> None:
    first = _auth(_apigw_sign(headers={"Content-Type": "application/json"}))["sig"]
    second = _auth(_apigw_sign(headers={"Content-Type": "text/plain"}))["sig"]
    assert first != second


def test_query_order_does_not_change_the_signature() -> None:
    one = _auth(_suite_sign("GET", "/?b=2&a=1&a=0"))
    two = _auth(_suite_sign("GET", "/?a=0&a=1&b=2"))
    assert one == two


def test_query_encoding_is_normalised() -> None:
    # `~` and `%7E` are the same unreserved character; a lower-case escape equals an upper-case one.
    assert _auth(_suite_sign("GET", "/?k=a~b%2fc")) == _auth(_suite_sign("GET", "/?k=a%7Eb%2Fc"))


def test_empty_path_is_root() -> None:
    assert _auth(_suite_sign("GET", "")) == _auth(_suite_sign("GET", "/"))


def test_dot_segments_are_removed() -> None:
    assert _auth(_suite_sign("GET", "/a/./b/../c")) == _auth(_suite_sign("GET", "/a/c"))


def test_path_segments_are_encoded() -> None:
    # A segment with an encoded space signs differently from one without (it isn't dropped).
    assert _auth(_suite_sign("GET", "/a%20b")) != _auth(_suite_sign("GET", "/ab"))


def test_apigateway_route_path() -> None:
    url = "https://apigateway.eu-west-1.amazonaws.com/v2/apis/abc123/routes"
    auth = _auth(
        sign(
            method="get",
            url=url,
            headers={},
            body=b"",
            region="eu-west-1",
            service="apigateway",
            credentials=CREDS,
            now=EXAMPLE_TIME,
        )
    )
    assert auth["cred"] == "AKIDEXAMPLE/20150830/eu-west-1/apigateway/aws4_request"


def test_non_default_port_is_in_host() -> None:
    headers = sign(
        method="GET",
        url="https://Example.AmazonAWS.com:8443/",
        headers={},
        body=b"",
        region="us-east-1",
        service="service",
        credentials=CREDS,
        now=EXAMPLE_TIME,
    )
    assert headers["Host"] == "example.amazonaws.com:8443"


def test_aware_time_in_another_zone_is_converted() -> None:
    cairo = timezone(timedelta(hours=3))
    local = EXAMPLE_TIME.astimezone(cairo)
    assert _auth(_suite_sign("GET", "/")) == _auth(
        sign(
            method="GET",
            url="https://example.amazonaws.com/",
            headers={},
            body=b"",
            region="us-east-1",
            service="service",
            credentials=CREDS,
            now=local,
        )
    )


def test_now_defaults_to_the_clock() -> None:
    before = datetime.now(UTC).strftime("%Y%m%d")
    headers = sign(
        method="DELETE",
        url="https://apigateway.us-east-1.amazonaws.com/v2/apis/abc123",
        headers={},
        body=b"",
        region="us-east-1",
        service="apigateway",
        credentials=CREDS,
    )
    assert re.fullmatch(r"\d{8}T\d{6}Z", headers["X-Amz-Date"])
    assert headers["X-Amz-Date"][:8] >= before


# --- Secrets and refusals -------------------------------------------------------------------


def test_repr_hides_both_keys() -> None:
    for text in (repr(CREDS), str(CREDS)):
        assert SECRET not in text
        assert ACCESS_KEY not in text


def test_naive_time_is_refused() -> None:
    with pytest.raises(SigningError, match="timezone-aware"):
        sign(
            method="GET",
            url="https://example.amazonaws.com/",
            headers={},
            body=b"",
            region="us-east-1",
            service="service",
            credentials=CREDS,
            now=datetime(2015, 8, 30, 12, 36),  # naive, on purpose
        )


_BAD_CALLS: list[tuple[str, dict[str, object]]] = [
    ("naive time", {"now": datetime(2015, 8, 30, 12, 36)}),
    ("http", {"url": "http://example.amazonaws.com/"}),
    ("login in url", {"url": f"https://{ACCESS_KEY}:{SECRET}@example.amazonaws.com/"}),
    ("no host", {"url": "https:///path"}),
    ("bad port", {"url": "https://example.amazonaws.com:99999/"}),
    ("bad method", {"method": "GET /x"}),
    ("bad region", {"region": "us-east-1/x"}),
    ("bad service", {"service": ""}),
    ("reserved header", {"headers": {"Authorization": f"AWS4 {ACCESS_KEY} {SECRET}"}}),
    ("reserved host", {"headers": {"Host": "evil.example"}}),
    ("duplicate header", {"headers": {"Accept": "a", "accept": "b"}}),
    ("line break", {"headers": {"X-Note": f"{SECRET}\r\nX-Evil: 1"}}),
    ("bad name", {"headers": {"Bad Name": "x"}}),
]


@pytest.mark.parametrize(("label", "change"), _BAD_CALLS, ids=[label for label, _ in _BAD_CALLS])
def test_errors_never_carry_a_secret(label: str, change: dict[str, object]) -> None:
    del label
    call: dict[str, object] = {
        "method": "GET",
        "url": "https://example.amazonaws.com/",
        "headers": {},
        "body": b"",
        "region": "us-east-1",
        "service": "service",
        "credentials": CREDS,
        "now": EXAMPLE_TIME,
    }
    call.update(change)
    with pytest.raises(SigningError) as caught:
        sign(**call)  # pyright: ignore[reportArgumentType]
    good = sign(
        method="GET",
        url="https://example.amazonaws.com/",
        headers={},
        body=b"",
        region="us-east-1",
        service="service",
        credentials=CREDS,
        now=EXAMPLE_TIME,
    )
    signature = _auth(good)["sig"]
    for text in (str(caught.value), repr(caught.value)):
        assert SECRET not in text
        assert ACCESS_KEY not in text
        assert signature not in text
    assert caught.value.__cause__ is None


@pytest.mark.parametrize(
    ("access_key", "secret"), [("", SECRET), (ACCESS_KEY, ""), ("  ", SECRET), (ACCESS_KEY, " ")]
)
def test_incomplete_credentials_are_refused(access_key: str, secret: str) -> None:
    with pytest.raises(SigningError) as caught:
        Credentials(access_key, secret)
    message = str(caught.value)
    assert SECRET not in message
    assert ACCESS_KEY not in message
