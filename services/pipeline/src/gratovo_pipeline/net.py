"""The pipeline's own network rule (ADR 0013).

Main's allowlist governs main's requests only; the pipeline is a separate process that makes its
own. So every request the pipeline builds is checked here first: HTTPS, and a host that is
YouTube's, Google's API (the Data API) or an AWS API Gateway endpoint (the owner's rotating
gateways, which forward to YouTube). A proxy is not a destination: it carries a request to one of
these hosts, and its address comes from the owner's own settings.

Redirects a server sends are followed by the HTTP library and aren't checked here: the request
was already one the rule allows, and YouTube's own redirects stay on YouTube's hosts.
"""

from __future__ import annotations

import re
from typing import Final
from urllib.parse import urlsplit

ALLOWED_HOSTS: Final = frozenset(
    {"www.youtube.com", "youtube.com", "www.googleapis.com", "youtube.googleapis.com"}
)
_GATEWAY_HOST: Final = re.compile(r"[a-z0-9]+\.execute-api\.[a-z]{2}(-[a-z]+)+-\d\.amazonaws\.com")


class HostNotAllowedError(ValueError):
    """A request to a host outside the rule. The message names the host, never the URL (a query
    string can carry a key)."""


def check_url(url: str) -> None:
    """Raises HostNotAllowedError unless url is HTTPS to an allowed host, with no login in it."""
    try:
        parts = urlsplit(url)
        host = (parts.hostname or "").lower()
    except ValueError:
        raise HostNotAllowedError("not a URL") from None
    if parts.scheme != "https" or parts.username is not None or parts.password is not None:
        raise HostNotAllowedError(f"only plain HTTPS is allowed (host {host or 'none'})")
    if host in ALLOWED_HOSTS or _GATEWAY_HOST.fullmatch(host):
        return
    raise HostNotAllowedError(f"the pipeline may not reach {host or 'that address'}")
