"""AWS Signature Version 4, over the standard library.

The gateway job (D19) makes a handful of API Gateway v2 calls (create an API, its integration,
route and stage; delete it). boto3 would bring a heavy client library for that (ADR 0013 §7), so
the requests go through `urllib` and are signed here instead, by AWS's published algorithm:
https://docs.aws.amazon.com/IAM/latest/UserGuide/create-signed-request.html

`sign` returns the headers to send. It doesn't send anything, so it is tested offline against
AWS's own examples.

Secrets stay out of every message: no error this module raises names the secret key, the access
key id or a signature, and `Credentials` hides both keys from `repr`.
"""

from __future__ import annotations

import hashlib
import hmac
import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Final
from urllib.parse import quote, unquote, urlsplit

ALGORITHM: Final = "AWS4-HMAC-SHA256"
_UNRESERVED: Final = "-_.~"  # RFC 3986; letters and digits are always left alone by `quote`
_HEADER_NAME: Final = re.compile(r"[!#$%&'*+\-.^_`|~0-9A-Za-z]+")  # an RFC 9110 token
_SCOPE_PART: Final = re.compile(r"[a-z0-9][a-z0-9-]{0,62}")
_METHOD: Final = re.compile(r"[A-Z]{1,16}")
# Set by `sign` itself: a caller's own copy would be sent but disagree with the signature.
_RESERVED: Final = frozenset({"host", "x-amz-date", "x-amz-content-sha256", "authorization"})


class SigningError(ValueError):
    """A request that can't be signed as given. The message says what is wrong in plain words and
    never carries a key or a signature."""


@dataclass(frozen=True)
class Credentials:
    """An IAM user's long-lived key pair. Both halves stay out of `repr`, so a log line or a
    traceback that prints the object shows neither."""

    access_key_id: str = field(repr=False)
    secret_access_key: str = field(repr=False)

    def __post_init__(self) -> None:
        if not self.access_key_id.strip() or not self.secret_access_key.strip():
            raise SigningError("the AWS access key id and secret key must both be set")


def sign(
    *,
    method: str,
    url: str,
    headers: Mapping[str, str],
    body: bytes,
    region: str,
    service: str,
    credentials: Credentials,
    now: datetime | None = None,
    content_sha256_header: bool = False,
) -> dict[str, str]:
    """The headers to send: the given ones plus `Host`, `X-Amz-Date`, `Authorization` and, when
    `content_sha256_header` is set, `X-Amz-Content-Sha256` (S3 needs it; API Gateway doesn't).

    Every given header is signed. The URL must be HTTPS, with each path segment and query value
    percent-encoded once (RFC 3986), as it will go on the wire; a space is `%20`, not `+`.
    `now` defaults to the clock and must be timezone-aware (it is converted to UTC).
    """
    verb = method.upper()
    if not _METHOD.fullmatch(verb):
        raise SigningError("the HTTP method must be a plain word such as GET or POST")
    _check_scope_part(region, "region")
    _check_scope_part(service, "service")
    when = _utc(now)
    amz_date = when.strftime("%Y%m%dT%H%M%SZ")
    date = amz_date[:8]

    host, path, query = _split_url(url)
    payload_hash = hashlib.sha256(body).hexdigest()

    canonical_headers = _canonical_headers(headers)
    canonical_headers["host"] = host
    canonical_headers["x-amz-date"] = amz_date
    if content_sha256_header:
        canonical_headers["x-amz-content-sha256"] = payload_hash
    names = sorted(canonical_headers)
    signed_headers = ";".join(names)

    canonical_request = "\n".join(
        [
            verb,
            _canonical_uri(path),
            _canonical_query(query),
            "".join(f"{name}:{canonical_headers[name]}\n" for name in names),
            signed_headers,
            payload_hash,
        ]
    )
    scope = f"{date}/{region}/{service}/aws4_request"
    string_to_sign = "\n".join(
        [ALGORITHM, amz_date, scope, hashlib.sha256(canonical_request.encode()).hexdigest()]
    )
    key = signing_key(credentials.secret_access_key, date, region, service)
    signature = hmac.new(key, string_to_sign.encode(), hashlib.sha256).hexdigest()

    result = dict(headers)
    result["Host"] = host
    result["X-Amz-Date"] = amz_date
    if content_sha256_header:
        result["X-Amz-Content-Sha256"] = payload_hash
    result["Authorization"] = (
        f"{ALGORITHM} Credential={credentials.access_key_id}/{scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )
    return result


def signing_key(secret_access_key: str, date: str, region: str, service: str) -> bytes:
    """The day's key for one region and service: `kDate → kRegion → kService → kSigning`. `date`
    is `YYYYMMDD`."""
    k_date = _hmac(f"AWS4{secret_access_key}".encode(), date)
    k_region = _hmac(k_date, region)
    k_service = _hmac(k_region, service)
    return _hmac(k_service, "aws4_request")


def _hmac(key: bytes, message: str) -> bytes:
    return hmac.new(key, message.encode(), hashlib.sha256).digest()


def _utc(now: datetime | None) -> datetime:
    """A naive time is refused: guessing its zone would sign for the wrong moment, and AWS rejects
    a request more than five minutes off."""
    if now is None:
        return datetime.now(UTC)
    if now.tzinfo is None or now.utcoffset() is None:
        raise SigningError("the signing time must be timezone-aware (UTC)")
    return now.astimezone(UTC)


def _check_scope_part(value: str, what: str) -> None:
    # Region and service go into the credential scope, which is `/`-separated.
    if not _SCOPE_PART.fullmatch(value):
        raise SigningError(f"the {what} must be lower-case letters, digits and dashes")


def _split_url(url: str) -> tuple[str, str, str]:
    """The `Host` value, the path and the raw query of an HTTPS URL."""
    try:
        parts = urlsplit(url)
        hostname = parts.hostname
        port = parts.port
    except ValueError:
        raise SigningError("the URL can't be read") from None
    if parts.scheme != "https":
        raise SigningError("only HTTPS requests are signed")
    if not hostname or parts.username is not None or parts.password is not None:
        raise SigningError("the URL needs a plain host, with no login in it")
    host = hostname.lower()
    if port is not None and port != 443:
        host = f"{host}:{port}"
    return host, parts.path, parts.query


def _canonical_uri(path: str) -> str:
    """The path with dot segments removed and each segment URI-encoded twice, as AWS requires for
    every service but S3. The wire form is encoded once; signing encodes that again."""
    segments: list[str] = []
    for segment in (path or "/").split("/")[1:]:
        if segment == ".":
            continue
        if segment == "..":
            if segments:
                segments.pop()
            continue
        segments.append(segment)
    if path.endswith(("/.", "/..")):
        segments.append("")  # `/a/.` names the folder `/a/`
    encoded = (_encode(_encode(unquote(segment))) for segment in segments)
    return "/" + "/".join(encoded)


def _canonical_query(query: str) -> str:
    """Each name and value decoded, then encoded once, sorted by name then value."""
    pairs: list[tuple[str, str]] = []
    for item in query.split("&"):
        if not item:
            continue
        name, _, value = item.partition("=")
        pairs.append((_encode(unquote(name)), _encode(unquote(value))))
    return "&".join(f"{name}={value}" for name, value in sorted(pairs))


def _canonical_headers(headers: Mapping[str, str]) -> dict[str, str]:
    """Names lower-cased, values trimmed with inner runs of white space collapsed to one space."""
    result: dict[str, str] = {}
    for name, value in headers.items():
        if not _HEADER_NAME.fullmatch(name):
            raise SigningError("a header name isn't a plain HTTP token")
        lower = name.lower()
        if lower in _RESERVED:
            raise SigningError(f"don't pass the {lower} header: signing sets it")
        if lower in result:
            raise SigningError(f"the {lower} header is given twice")
        if "\r" in value or "\n" in value or "\0" in value:
            raise SigningError(f"the {lower} header has a line break in its value")
        result[lower] = " ".join(value.split())
    return result


def _encode(text: str) -> str:
    return quote(text, safe=_UNRESERVED)
