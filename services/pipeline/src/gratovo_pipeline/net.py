"""The pipeline's own network rule (ADR 0013).

Main's allowlist governs main's requests only; the pipeline is a separate process that makes its
own. So every request the pipeline builds is checked here first: HTTPS, and a host that is
YouTube's, Google's API (the Data API) or an AWS API Gateway endpoint (the owner's rotating
gateways, which forward to YouTube). A proxy is not a destination: it carries a request to one of
these hosts, and its address comes from the owner's own settings.

A few jobs need more, and only those jobs get it (plan D20). The entry point calls
`allow_job_hosts` once, with the job's kind, before the job runs: the mail jobs add Gmail's API
and Google's token endpoint, the gateway jobs add AWS's API Gateway control plane (where gateways
are made and deleted), and the leak test (`gateways.leak`, step S5 P0) alone also adds
`checkip.amazonaws.com`, to read this computer's public address. A search adds
`api.proxyscrape.com` (the free proxy list, step S5 P3) only when "Find free proxies" is on. A
search can't reach the other hosts, and it never holds a mailbox token or an AWS key, so a bug in
it can't write to a mailbox or an AWS account. (Google's general API host,
which the Data API needs, also serves Gmail; without a token that does nothing.)

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
MAIL_HOSTS: Final = frozenset({"gmail.googleapis.com", "oauth2.googleapis.com"})
LEAK_HOSTS: Final = frozenset({"checkip.amazonaws.com"})
FREE_PROXY_HOSTS: Final = frozenset({"api.proxyscrape.com"})
_GATEWAY_HOST: Final = re.compile(r"[a-z0-9]+\.execute-api\.[a-z]{2}(-[a-z]+)+-\d\.amazonaws\.com")
# `[0-9]`, not `\d`: Python's `\d` also takes other scripts' digits.
_CONTROL_PLANE_HOST: Final = re.compile(r"apigateway\.[a-z]{2}(-[a-z]+)+-[0-9]\.amazonaws\.com")

# What this process's job added to the base rule (set once, by allow_job_hosts).
_job_hosts: frozenset[str] = frozenset()
_job_patterns: tuple[re.Pattern[str], ...] = ()


class HostNotAllowedError(ValueError):
    """A request to a host outside the rule. The message names the host, never the URL (a query
    string can carry a key)."""


def allow_job_hosts(kind: str, *, free_proxies: bool = False) -> None:
    """Adds the hosts the job of this kind needs: `mail.*` Gmail's, `gateways.*` AWS's API
    Gateway control plane (`gateways.leak` checkip too), `search` the free proxy list's host when
    `free_proxies` is on; other kinds nothing. It replaces what an earlier call added, so a
    second call never widens the rule beyond one job's needs."""
    global _job_hosts, _job_patterns  # one job per process: set once, at the start
    if kind == "search" and free_proxies:
        _job_hosts, _job_patterns = FREE_PROXY_HOSTS, ()
    elif kind.startswith("mail."):
        _job_hosts, _job_patterns = MAIL_HOSTS, ()
    elif kind == "gateways.leak":
        _job_hosts, _job_patterns = LEAK_HOSTS, (_CONTROL_PLANE_HOST,)
    elif kind.startswith("gateways."):
        _job_hosts, _job_patterns = frozenset(), (_CONTROL_PLANE_HOST,)
    else:
        _job_hosts, _job_patterns = frozenset(), ()


def check_url(url: str) -> None:
    """Raises HostNotAllowedError unless url is HTTPS to an allowed host, with no login in it."""
    try:
        parts = urlsplit(url)
        host = (parts.hostname or "").lower()
    except ValueError:
        raise HostNotAllowedError("not a URL") from None
    if parts.scheme != "https" or parts.username is not None or parts.password is not None:
        raise HostNotAllowedError(f"only plain HTTPS is allowed (host {host or 'none'})")
    if host in ALLOWED_HOSTS or _GATEWAY_HOST.fullmatch(host) or host in _job_hosts:
        return
    if any(pattern.fullmatch(host) for pattern in _job_patterns):
        return
    raise HostNotAllowedError(f"the pipeline may not reach {host or 'that address'}")
