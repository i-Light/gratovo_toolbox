"""A rotating pool of connection candidates for `scrapetube._request`.

Every candidate -- an AWS API Gateway endpoint, a real proxy, or `DIRECT_ID`
standing in for this machine's own connection -- carries its own cooldown, so a
free proxy dying or a specific IP getting flagged by YouTube only takes that one
identity out of rotation for a while rather than stalling the run or dragging
every other candidate down with it.

Rotation is a guarantee, not a tendency. The pool hands out a candidate with
[ProxyPool.acquire] and the rules below hold for every request, whatever the
candidate list looks like at that moment:

  least recently used     the healthy candidate that has waited longest goes
                          next. This replaced an index into "whoever is healthy
                          right now", which changes length whenever a candidate
                          cools down or recovers and so could hand the same one
                          out twice running.

  never twice in a row    the candidate that served the previous request is left
                          out while any other healthy candidate exists. (If it
                          is the only healthy one it is used again -- there is
                          nothing to rotate to.)

  a minimum gap           after a request to an AWS gateway or a proxy ends, that
                          one candidate is not used again for `min_gap_seconds`
                          (plus jitter, so the beat is never the same twice). The
                          direct connection has no gap of its own: it stays
                          governed by the pacing delays the pipeline already
                          applies (`data/settings.json`).

  one request at a time   a candidate serves one request at a time. It is what
                          lets parallel search run workers side by side without
                          two of them ever sharing an IP.

  wait, never spin        when every candidate is inside its gap, busy or cooling
                          down, `acquire` waits for the soonest one -- sleeping
                          in short ticks that a Stop cuts short -- rather than
                          picking something it should not.

Two failure signals feed cooldown, deliberately not more:

  connection failure   this specific candidate is unreachable or broken --
                        a dead free proxy, bad credentials, a proxy that
                        breaks TLS. Retryable almost immediately, just not
                        on the same candidate.

  blocked               YouTube itself refused -- 429/403, a captcha
                        interstitial, or a redirect loop. Plausibly
                        IP-reputation-specific, so it cools down longer.

A bare 5xx or a JSON-parse hiccup deliberately does *not* touch pool health
here -- that is far more likely YouTube having a bad moment than this
candidate's fault, and cooling down a perfectly good proxy (or direct) for
YouTube's own outage would be a correctness bug, not resilience. See
`scrapetube._request` for where that line is drawn.

A candidate can also be an AWS API Gateway endpoint (`tools/aws_gateway_setup.py`
deploys these -- an HTTP-proxy integration that forwards to youtube.com from
that region's own egress IPs) rather than a traditional host:port proxy. It
carries a `base_url` instead of a `proxies` dict; `scrapetube._request` checks
which one is set and routes accordingly. Same rotation, gap and cooldown logic
either way -- this pool doesn't care which kind of candidate it is holding.

The clock, the sleep and the random source are all injectable so the tests can
drive the whole thing on a fake clock and prove the guarantees above instead of
sampling for them.
"""

import collections
import dataclasses
import random
import re
import threading
import time

from gratovo import run_control

CONNECTION_COOLDOWN_BASE = 30.0    # seconds; doubles per consecutive failure
CONNECTION_COOLDOWN_MAX = 1200.0   # 20 min cap
BLOCK_COOLDOWN_BASE = 120.0        # seconds; doubles per consecutive block
BLOCK_COOLDOWN_MAX = 1800.0        # 30 min cap
DIRECT_ID = "direct"

KIND_AWS = "aws"
KIND_PROXY = "proxy"
KIND_DIRECT = "direct"

# The floor between two requests to the same AWS gateway or proxy. About what a
# person browsing produces (a page every several seconds), and above the pace
# the Normal pacing profile already keeps one machine to -- so on a pool with
# several candidates it never binds, and on a pool with one or two it is what
# stops a gateway being hit in quick succession. `data/settings.json`
# `proxies.min_gap_seconds` overrides it; 0 switches the floor off.
DEFAULT_MIN_GAP_SECONDS = 6.0
# The gap is sampled in [gap, gap * (1 + jitter)]: jitter only ever lengthens
# it, so the configured floor is a floor.
DEFAULT_MIN_GAP_JITTER = 0.5
MAX_MIN_GAP_SECONDS = 600.0

# Longest a wait sleeps before it re-checks for a Stop, a skip signal or a
# candidate another worker just released.
WAIT_TICK = 0.5
MIN_TICK = 0.02

# Why `acquire` is waiting -- what the caller announces to the person watching.
WAIT_GAP = "gap"            # every usable candidate was used moments ago
WAIT_BUSY = "busy"          # every usable candidate is serving another worker
WAIT_COOLDOWN = "cooldown"  # nothing is healthy; the soonest comes back at...

# A `[route] use` progress line is emitted when a kind is used for the first
# time, every this many requests, or -- while requests are still flowing --
# this often. Low volume on purpose: the app parses them into a status chip, it
# does not need one per request.
ROUTE_REPORT_EVERY_REQUESTS = 10
ROUTE_REPORT_EVERY_SECONDS = 20.0

_GATEWAY_REGION = re.compile(r"\.execute-api\.([a-z0-9-]+)\.amazonaws\.com", re.I)

WaitInfo = collections.namedtuple("WaitInfo", "reason total remaining label")


@dataclasses.dataclass(eq=False)
class _Candidate:
    """One outbound identity. Compared by identity (`eq=False`): the pool asks
    "is this the one that served the last request", and two candidates with the
    same fields are still two connections."""

    id: str
    proxies: dict             # {} for direct/gateway; else {"http": url, "https": url}
    label: str = ""
    base_url: str = ""        # non-empty => an AWS API Gateway invoke URL; see module doc
    min_gap: float = 0.0      # 0 for the direct connection: pacing governs it
    cooldown_until: float = 0.0
    consecutive_failures: int = 0
    # Earliest moment the gap after the previous request allows another one.
    ready_at: float = 0.0
    # A request is in flight on it right now.
    busy: bool = False
    # Ticks up on every pick, so "least recently used" is a sort on this and
    # never a comparison of clock readings that could tie.
    last_used_seq: int = 0
    uses: int = 0

    @property
    def kind(self) -> str:
        if self.base_url:
            return KIND_AWS
        if self.proxies:
            return KIND_PROXY
        return KIND_DIRECT


def _proxy_url(entry: dict) -> str:
    host = entry.get("host", "")
    port = entry.get("port")
    auth = ""
    username = entry.get("username") or ""
    password = entry.get("password") or ""
    if username:
        auth = "{}:{}@".format(username, password) if password else "{}@".format(username)
    netloc = "{}{}".format(auth, host)
    if port:
        netloc = "{}:{}".format(netloc, port)
    return "http://{}".format(netloc)


def _number(value, default, low, high):
    """[value] as a float clamped to [low, high]; [default] for anything that
    is not a plain number (a hand-edited settings.json is not to be trusted)."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return default
    return max(low, min(high, float(value)))


def gateway_label(index: int, url: str) -> str:
    """"AWS Gateway 2 (eu-west-1)" -- the region is what tells one gateway from
    another to a person reading the progress panel, and it is in the invoke
    URL already."""
    match = _GATEWAY_REGION.search(url or "")
    if match:
        return "AWS Gateway {} ({})".format(index + 1, match.group(1).lower())
    return "AWS Gateway {}".format(index + 1)


class Lease:
    """The right to make one request through [candidate]. Release it when the
    request is over -- however it ended -- so the candidate's gap starts and the
    next worker can have it. A context manager, and safe to release twice."""

    def __init__(self, pool, candidate):
        self._pool = pool
        self.candidate = candidate
        self._released = False

    def release(self) -> None:
        if not self._released:
            self._released = True
            self._pool._release(self.candidate)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.release()
        return False


class ProxyPool:
    """Rotates over its candidates under the guarantees in the module doc.
    Never raises for lack of a healthy candidate -- it waits for one, and the
    wait can be ended by a Stop or, for a cooldown, by the person asking to try
    again now."""

    def __init__(self, candidates, *, clock=None, sleep=None, rng=None,
                 min_gap_jitter=DEFAULT_MIN_GAP_JITTER):
        if not candidates:
            candidates = [_Candidate(id=DIRECT_ID, proxies={}, label="This machine")]
        self._candidates = list(candidates)
        self._lock = threading.Lock()
        self._clock = clock or time.monotonic
        self._sleep = sleep or time.sleep
        self._rng = rng or random.Random()
        self._jitter = max(0.0, float(min_gap_jitter))
        self._seq = 0
        self._last = None
        # What the progress panel shows ("AWS in use, 3 gateways, last ...").
        self._requests = {KIND_AWS: 0, KIND_PROXY: 0, KIND_DIRECT: 0}
        self._last_kind = None
        self._last_label = ""
        self._reported_total = 0
        self._reported_at = None
        self._reported_kinds = set()

    @classmethod
    def from_settings(cls, proxies_setting: dict, gateway_urls=None, *,
                      clock=None, sleep=None, rng=None) -> "ProxyPool":
        """Builds a pool from settings.json's `proxies` key, plus optionally
        the AWS API Gateway invoke URLs from `config.load_aws_gateways()`.
        Disabled, or an empty/all-disabled list, yields a pool with only the
        direct candidate -- so a stock/off configuration behaves exactly like
        the scraper did before this pool existed.

        [gateway_urls] is a separate parameter rather than folded into
        [proxies_setting] because it comes from its own file, not
        settings.json -- see `config.load_aws_gateways`'s doc comment. The
        `min_gap_seconds` / `min_gap_jitter` in [proxies_setting] apply to both
        kinds all the same: a gateway is not a proxy, but it is one more
        address YouTube can see."""
        proxies_setting = proxies_setting or {}
        enabled = bool(proxies_setting.get("enabled"))
        include_direct = proxies_setting.get("include_direct", True)
        raw_list = proxies_setting.get("list") or []
        min_gap = _number(proxies_setting.get("min_gap_seconds"),
                          DEFAULT_MIN_GAP_SECONDS, 0.0, MAX_MIN_GAP_SECONDS)
        jitter = _number(proxies_setting.get("min_gap_jitter"),
                         DEFAULT_MIN_GAP_JITTER, 0.0, 2.0)

        candidates = []
        if enabled:
            for entry in raw_list:
                if not isinstance(entry, dict) or not entry.get("enabled", True):
                    continue
                host = (entry.get("host") or "").strip()
                if not host:
                    continue
                url = _proxy_url(entry)
                candidates.append(_Candidate(
                    id=entry.get("id") or host,
                    proxies={"http": url, "https": url},
                    label=entry.get("label") or host,
                    min_gap=min_gap,
                ))

        for i, url in enumerate(gateway_urls or []):
            url = (url or "").strip().rstrip("/")
            if not url:
                continue
            candidates.append(_Candidate(
                id="gateway-{}".format(i),
                proxies={},
                base_url=url,
                label=gateway_label(i, url),
                min_gap=min_gap,
            ))

        if include_direct or not candidates:
            candidates.append(_Candidate(id=DIRECT_ID, proxies={}, label="This machine"))

        return cls(candidates, clock=clock, sleep=sleep, rng=rng, min_gap_jitter=jitter)

    # ---- what the pool holds -------------------------------------------

    @property
    def non_direct_count(self) -> int:
        """AWS gateways plus proxies -- the candidates parallel search runs one
        worker per."""
        return sum(1 for c in self._candidates if c.kind != KIND_DIRECT)

    def describe(self) -> dict:
        """The pool's composition, for the `[route] pool` line and the tests."""
        kinds = [c.kind for c in self._candidates]
        gaps = [c.min_gap for c in self._candidates if c.min_gap > 0]
        return {
            "gateways": kinds.count(KIND_AWS),
            "proxies": kinds.count(KIND_PROXY),
            "direct": KIND_DIRECT in kinds,
            "min_gap": min(gaps) if gaps else 0.0,
        }

    # ---- handing candidates out ---------------------------------------

    def _choose(self, now):
        """Under the lock: `(candidate, 0, None)` if one may be used right now,
        else `(None, seconds_until_something_changes, why)`."""
        candidates = self._candidates
        healthy = [c for c in candidates if c.cooldown_until <= now]
        # Never the request-before's candidate while another healthy one exists
        # -- even if that other one is still inside its gap or busy, in which
        # case this waits for it rather than repeating.
        options = [c for c in healthy if c is not self._last] or healthy
        ready = [c for c in options if not c.busy and c.ready_at <= now]
        if ready:
            return min(ready, key=lambda c: c.last_used_seq), 0.0, None
        if options:
            gaps = [c.ready_at - now for c in options if not c.busy]
            if gaps:
                return None, max(min(gaps), 0.0), WAIT_GAP
            return None, WAIT_TICK, WAIT_BUSY
        soonest = min(candidates, key=lambda c: max(c.cooldown_until, c.ready_at))
        return (None, max(max(soonest.cooldown_until, soonest.ready_at) - now, 0.0),
                WAIT_COOLDOWN)

    def _soonest(self):
        return min(self._candidates,
                   key=lambda c: max(c.cooldown_until, c.ready_at))

    def acquire(self, *, skip_requested=None, on_wait=None) -> Lease:
        """Blocks until a candidate may be used, then returns a [Lease] on it.

        [skip_requested] is polled during a *cooldown* wait only (nothing is
        healthy): when it answers True the soonest candidate's cooldown is
        cleared and it is tried now -- the Search screen's "Try again now". It
        is deliberately not consulted while waiting out a gap. The gap exists
        so one gateway is never hit in quick succession, and a button that
        could cut it short would be a way to do exactly that.

        [on_wait] is called with a [WaitInfo] on every tick of a wait, for the
        caller to announce; it is never called when a candidate is free.

        Raises `run_control.RunAborted` if a stop is requested while waiting.
        """
        first_remaining = None
        while True:
            run_control.check_stop()
            with self._lock:
                now = self._clock()
                chosen, wait, why = self._choose(now)
                if chosen is not None:
                    self._take(chosen)
                    return Lease(self, chosen)
                label = self._soonest().label if why == WAIT_COOLDOWN else ""
            if first_remaining is None or wait > first_remaining:
                first_remaining = wait
            if on_wait is not None:
                on_wait(WaitInfo(why, first_remaining, wait, label))
            self._sleep(min(max(wait, MIN_TICK), WAIT_TICK))
            if why == WAIT_COOLDOWN and skip_requested is not None and skip_requested():
                with self._lock:
                    self._soonest().cooldown_until = 0.0

    def _take(self, candidate):
        self._seq += 1
        candidate.busy = True
        candidate.last_used_seq = self._seq
        candidate.uses += 1
        self._last = candidate
        kind = candidate.kind
        self._requests[kind] += 1
        self._last_kind = kind
        self._last_label = candidate.label

    def _release(self, candidate):
        with self._lock:
            candidate.busy = False
            if candidate.min_gap > 0:
                candidate.ready_at = self._clock() + candidate.min_gap * (
                    1.0 + self._rng.uniform(0.0, self._jitter))

    # ---- health ---------------------------------------------------------

    def report_success(self, candidate) -> None:
        with self._lock:
            candidate.consecutive_failures = 0
            candidate.cooldown_until = 0.0

    def report_connection_failure(self, candidate) -> None:
        with self._lock:
            candidate.consecutive_failures += 1
            wait = min(
                CONNECTION_COOLDOWN_BASE * (2 ** (candidate.consecutive_failures - 1)),
                CONNECTION_COOLDOWN_MAX,
            )
            candidate.cooldown_until = self._clock() + self._rng.uniform(wait, wait * 1.4)

    def report_blocked(self, candidate) -> None:
        with self._lock:
            candidate.consecutive_failures += 1
            wait = min(
                BLOCK_COOLDOWN_BASE * (2 ** (candidate.consecutive_failures - 1)),
                BLOCK_COOLDOWN_MAX,
            )
            candidate.cooldown_until = self._clock() + self._rng.uniform(wait, wait * 1.4)

    # ---- what the run reports -------------------------------------------

    def route_counts(self) -> dict:
        with self._lock:
            return dict(self._requests)

    def route_line(self, force=False):
        """The `[route] use ...` progress line if one is due, else None.

        Cumulative counts per kind since the pool was built, plus the candidate
        that served the latest request -- what `search_progress_parser.dart`
        turns into "AWS: in use, last ..." rather than just "AWS: connected".
        A line is due the first time a kind is used, every
        [ROUTE_REPORT_EVERY_REQUESTS] requests, and every
        [ROUTE_REPORT_EVERY_SECONDS] while requests are still coming in.
        [force] emits it regardless (the end-of-run summary)."""
        with self._lock:
            total = sum(self._requests.values())
            if total == 0:
                return None
            now = self._clock()
            fresh_kind = any(count and kind not in self._reported_kinds
                             for kind, count in self._requests.items())
            due = (
                force
                or fresh_kind
                or total - self._reported_total >= ROUTE_REPORT_EVERY_REQUESTS
                or (total > self._reported_total
                    and self._reported_at is not None
                    and now - self._reported_at >= ROUTE_REPORT_EVERY_SECONDS)
            )
            if not due:
                return None
            self._reported_total = total
            self._reported_at = now
            self._reported_kinds = {k for k, count in self._requests.items() if count}
            return format_route_use(self._requests, self._last_kind, self._last_label)


def format_route_use(counts, last_kind, last_label) -> str:
    """`[route] use aws=12 proxy=0 direct=3 last=aws label=AWS Gateway 2 (...)`.

    key=value pairs, the free-text label last and to the end of the line (the
    same shape as `[backoff] ... reason=...`), so a label may contain anything
    but a newline."""
    return "[route] use aws={} proxy={} direct={} last={} label={}".format(
        counts.get(KIND_AWS, 0), counts.get(KIND_PROXY, 0),
        counts.get(KIND_DIRECT, 0), last_kind or "",
        " ".join(str(last_label or "").split()))


def format_route_pool(*, gateways, proxies, direct, gap, workers, parallel, pacing) -> str:
    """`[route] pool gateways=3 proxies=0 direct=1 gap=6 workers=3 parallel=1 pacing=normal`
    -- what this run has available and how it will use it, printed once at the
    start. `gap` is the per-candidate minimum in seconds (0 = none)."""
    return ("[route] pool gateways={} proxies={} direct={} gap={:g} workers={} "
            "parallel={} pacing={}").format(
        gateways, proxies, 1 if direct else 0, gap, workers,
        1 if parallel else 0, pacing)
