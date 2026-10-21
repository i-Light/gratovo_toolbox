"""A rotating pool of connection candidates for `scrapetube.request` (ported from legacy).

Every candidate (an AWS API Gateway endpoint, a proxy, or `DIRECT_ID` for this machine's own
connection) carries its own cooldown, so one dead proxy or one flagged address leaves rotation for
a while instead of stalling the run.

Rotation is a guarantee, not a tendency. For every request:

  least recently used    the healthy candidate that has waited longest goes next.
  never twice in a row   the previous request's candidate is left out while another healthy one
                         exists.
  a minimum gap          after a request through a gateway or proxy ends, that candidate rests
                         for `min_gap_seconds` (plus jitter, which only lengthens it). The direct
                         connection has no gap: the pipeline's pacing governs it.
  one at a time          a candidate serves one request at a time, so parallel workers never
                         share an address.
  wait, never spin       when every candidate is resting, busy or cooling down, `acquire` waits
                         for the soonest, in short ticks a Stop cuts short.

Two failure signals feed cooldown, deliberately no more: a connection failure (this candidate is
unreachable or broken; retry soon, elsewhere) and a block (YouTube refused: 429/403, a captcha;
cools down longer). A bare 5xx doesn't touch health: that is YouTube's bad moment, not the
candidate's fault.

A gateway candidate carries a `base_url` instead of `proxies`; `scrapetube.request` routes by
rewriting the URL. The clock, sleep and random source are injectable, so the tests prove the
guarantees on a fake clock.
"""

from __future__ import annotations

import dataclasses
import random
import re
import threading
import time
from collections.abc import Callable, Sequence
from types import TracebackType
from typing import Final, Literal, NamedTuple, Protocol, Self, TypedDict
from urllib.parse import urlsplit

from gratovo_pipeline import run_control

CONNECTION_COOLDOWN_BASE: Final = 30.0  # seconds; doubles per consecutive failure
CONNECTION_COOLDOWN_MAX: Final = 1200.0
BLOCK_COOLDOWN_BASE: Final = 120.0  # seconds; doubles per consecutive block
BLOCK_COOLDOWN_MAX: Final = 1800.0
DIRECT_ID: Final = "direct"

type Kind = Literal["aws", "proxy", "direct"]
KIND_AWS: Final = "aws"
KIND_PROXY: Final = "proxy"
KIND_DIRECT: Final = "direct"

# About a page every several seconds, what a person browsing produces. With several candidates it
# never binds; with one or two it stops a gateway being hit in quick succession. 0 switches it off.
DEFAULT_MIN_GAP_SECONDS: Final = 6.0
DEFAULT_MIN_GAP_JITTER: Final = 0.5  # the gap is sampled in [gap, gap * (1 + jitter)]
MAX_MIN_GAP_SECONDS: Final = 600.0

WAIT_TICK: Final = 0.5  # longest a wait sleeps before it re-checks for a Stop or a release
MIN_TICK: Final = 0.02

type WaitReason = Literal["gap", "busy", "cooldown"]
WAIT_GAP: Final = "gap"  # every usable candidate was used moments ago
WAIT_BUSY: Final = "busy"  # every usable candidate is serving another worker
WAIT_COOLDOWN: Final = "cooldown"  # nothing is healthy

# A route summary is due when a kind is used for the first time, every this many requests, or
# this often while requests flow.
ROUTE_REPORT_EVERY_REQUESTS: Final = 10
ROUTE_REPORT_EVERY_SECONDS: Final = 20.0

_GATEWAY_REGION: Final = re.compile(r"\.execute-api\.([a-z0-9-]+)\.amazonaws\.com", re.IGNORECASE)


class WaitInfo(NamedTuple):
    reason: WaitReason
    total: float
    remaining: float
    label: str


class Rng(Protocol):
    def uniform(self, a: float, b: float, /) -> float: ...


@dataclasses.dataclass(eq=False)
class Candidate:
    """One outbound identity. Compared by identity: two candidates with the same fields are still
    two connections."""

    id: str
    proxies: dict[str, str]  # {} for direct or a gateway; else {"http": url, "https": url}
    label: str = ""
    base_url: str = ""  # set: an AWS API Gateway invoke URL
    min_gap: float = 0.0
    cooldown_until: float = 0.0
    consecutive_failures: int = 0
    ready_at: float = 0.0  # earliest moment the gap allows another request
    busy: bool = False
    last_used_seq: int = 0  # least recently used is a sort on this, never on clock readings
    uses: int = 0

    @property
    def kind(self) -> Kind:
        if self.base_url:
            return KIND_AWS
        if self.proxies:
            return KIND_PROXY
        return KIND_DIRECT


def gateway_label(index: int, url: str) -> str:
    """ "AWS Gateway 2 (eu-west-1)": the region tells one gateway from another in the log."""
    match = _GATEWAY_REGION.search(url)
    if match:
        return f"AWS Gateway {index + 1} ({match.group(1).lower()})"
    return f"AWS Gateway {index + 1}"


def _proxy_candidate(url: str, min_gap: float) -> Candidate | None:
    text = url.strip()
    if not text:
        return None
    if "://" not in text:
        text = "http://" + text
    try:
        parts = urlsplit(text)
        host, port = parts.hostname, parts.port
    except ValueError:
        return None
    if not host:
        return None
    # The id and label name the host only: never the login a proxy URL may carry.
    ident = f"{host}:{port}" if port else host
    return Candidate(id=ident, proxies={"http": text, "https": text}, label=host, min_gap=min_gap)


class PoolDescription(TypedDict):
    gateways: int
    proxies: int
    direct: bool
    min_gap: float


class Lease:
    """The right to make one request through `candidate`. Release it however the request ended,
    so the gap starts and the next worker can have it. A context manager; release is idempotent."""

    def __init__(self, pool: ProxyPool, candidate: Candidate) -> None:
        self._pool = pool
        self.candidate = candidate
        self._released = False

    def release(self) -> None:
        if not self._released:
            self._released = True
            self._pool._release(self.candidate)  # pyright: ignore[reportPrivateUsage]

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self.release()


class ProxyPool:
    """Rotates over its candidates under the guarantees in the module doc. Never raises for lack
    of a healthy candidate: it waits for one."""

    def __init__(
        self,
        candidates: Sequence[Candidate],
        *,
        clock: Callable[[], float] | None = None,
        sleep: Callable[[float], None] | None = None,
        rng: Rng | None = None,
        min_gap_jitter: float = DEFAULT_MIN_GAP_JITTER,
    ) -> None:
        self.candidates: list[Candidate] = list(candidates) or [
            Candidate(id=DIRECT_ID, proxies={}, label="This machine")
        ]
        self._lock = threading.Lock()
        self._clock = clock or time.monotonic
        self._sleep = sleep or time.sleep
        self._rng: Rng = rng or random.Random()  # noqa: S311 - jitter, not security
        self._jitter = max(0.0, min_gap_jitter)
        self._seq = 0
        self._last: Candidate | None = None
        self._requests: dict[Kind, int] = {KIND_AWS: 0, KIND_PROXY: 0, KIND_DIRECT: 0}
        self._last_label = ""
        self._reported_total = 0
        self._reported_at: float | None = None
        self._reported_kinds: set[Kind] = set()

    @classmethod
    def from_routes(
        cls,
        *,
        proxy_urls: Sequence[str] = (),
        gateway_urls: Sequence[str] = (),
        proxies_enabled: bool = True,
        include_direct: bool = True,
        min_gap_seconds: float = DEFAULT_MIN_GAP_SECONDS,
        min_gap_jitter: float = DEFAULT_MIN_GAP_JITTER,
        clock: Callable[[], float] | None = None,
        sleep: Callable[[float], None] | None = None,
        rng: Rng | None = None,
    ) -> ProxyPool:
        """A pool from the run's routes. No usable route (or proxies off and no gateway) gives the
        direct candidate alone, so the default behaves as the scraper did before the pool."""
        gap = max(0.0, min(MAX_MIN_GAP_SECONDS, min_gap_seconds))
        candidates: list[Candidate] = []
        if proxies_enabled:
            for url in proxy_urls:
                candidate = _proxy_candidate(url, gap)
                if candidate is not None:
                    candidates.append(candidate)
        for i, raw in enumerate(gateway_urls):
            url = raw.strip().rstrip("/")
            if url:
                candidates.append(
                    Candidate(
                        id=f"gateway-{i}",
                        proxies={},
                        base_url=url,
                        label=gateway_label(i, url),
                        min_gap=gap,
                    )
                )
        if include_direct or not candidates:
            candidates.append(Candidate(id=DIRECT_ID, proxies={}, label="This machine"))
        return cls(candidates, clock=clock, sleep=sleep, rng=rng, min_gap_jitter=min_gap_jitter)

    # --- what the pool holds ---

    @property
    def non_direct_count(self) -> int:
        """Gateways plus proxies: parallel search runs one worker per."""
        return sum(1 for c in self.candidates if c.kind != KIND_DIRECT)

    def describe(self) -> PoolDescription:
        kinds = [c.kind for c in self.candidates]
        gaps = [c.min_gap for c in self.candidates if c.min_gap > 0]
        return {
            "gateways": kinds.count(KIND_AWS),
            "proxies": kinds.count(KIND_PROXY),
            "direct": KIND_DIRECT in kinds,
            "min_gap": min(gaps) if gaps else 0.0,
        }

    # --- handing candidates out ---

    def _choose(self, now: float) -> tuple[Candidate | None, float, WaitReason | None]:
        """Under the lock: `(candidate, 0, None)` if one may be used now, else `(None, seconds
        until something changes, why)`."""
        healthy = [c for c in self.candidates if c.cooldown_until <= now]
        # Never the previous request's candidate while another healthy one exists, even one still
        # resting or busy: wait for it rather than repeat.
        options = [c for c in healthy if c is not self._last] or healthy
        ready = [c for c in options if not c.busy and c.ready_at <= now]
        if ready:
            return min(ready, key=lambda c: c.last_used_seq), 0.0, None
        if options:
            gaps = [c.ready_at - now for c in options if not c.busy]
            if gaps:
                return None, max(min(gaps), 0.0), WAIT_GAP
            return None, WAIT_TICK, WAIT_BUSY
        soonest = self._soonest()
        return None, max(max(soonest.cooldown_until, soonest.ready_at) - now, 0.0), WAIT_COOLDOWN

    def _soonest(self) -> Candidate:
        return min(self.candidates, key=lambda c: max(c.cooldown_until, c.ready_at))

    def acquire(
        self,
        *,
        skip_requested: Callable[[], bool] | None = None,
        on_wait: Callable[[WaitInfo], None] | None = None,
    ) -> Lease:
        """Blocks until a candidate may be used, then returns a Lease on it.

        `skip_requested` is polled during a cooldown wait only: when it answers True the soonest
        candidate's cooldown is cleared ("Try again now"). Never during a gap: the gap exists so a
        gateway is never hit in quick succession, and cutting it short would do exactly that.
        `on_wait` gets a WaitInfo on every tick of a wait. Raises RunAborted on a stop.
        """
        first_remaining: float | None = None
        while True:
            run_control.check_stop()
            with self._lock:
                chosen, wait, why = self._choose(self._clock())
                if chosen is not None:
                    self._take(chosen)
                    return Lease(self, chosen)
                label = self._soonest().label if why == WAIT_COOLDOWN else ""
            if first_remaining is None or wait > first_remaining:
                first_remaining = wait
            if on_wait is not None and why is not None:
                on_wait(WaitInfo(why, first_remaining, wait, label))
            self._sleep(min(max(wait, MIN_TICK), WAIT_TICK))
            if why == WAIT_COOLDOWN and skip_requested is not None and skip_requested():
                with self._lock:
                    self._soonest().cooldown_until = 0.0

    def _take(self, candidate: Candidate) -> None:
        self._seq += 1
        candidate.busy = True
        candidate.last_used_seq = self._seq
        candidate.uses += 1
        self._last = candidate
        self._requests[candidate.kind] += 1
        self._last_label = candidate.label

    def _release(self, candidate: Candidate) -> None:
        with self._lock:
            candidate.busy = False
            if candidate.min_gap > 0:
                candidate.ready_at = self._clock() + candidate.min_gap * (
                    1.0 + self._rng.uniform(0.0, self._jitter)
                )

    # --- health ---

    def report_success(self, candidate: Candidate) -> None:
        with self._lock:
            candidate.consecutive_failures = 0
            candidate.cooldown_until = 0.0

    def _cool(self, candidate: Candidate, base: float, cap: float) -> None:
        with self._lock:
            candidate.consecutive_failures += 1
            wait = min(base * (2 ** (candidate.consecutive_failures - 1)), cap)
            candidate.cooldown_until = self._clock() + self._rng.uniform(wait, wait * 1.4)

    def report_connection_failure(self, candidate: Candidate) -> None:
        self._cool(candidate, CONNECTION_COOLDOWN_BASE, CONNECTION_COOLDOWN_MAX)

    def report_blocked(self, candidate: Candidate) -> None:
        self._cool(candidate, BLOCK_COOLDOWN_BASE, BLOCK_COOLDOWN_MAX)

    # --- what the run reports ---

    def route_counts(self) -> dict[Kind, int]:
        with self._lock:
            return dict(self._requests)

    def route_summary(self, *, force: bool = False) -> str | None:
        """ "Routes used: 12 AWS, 0 proxy, 3 direct; last: AWS Gateway 2 (eu-west-1)" when one is
        due (a kind's first use, every ROUTE_REPORT_EVERY_REQUESTS, or every
        ROUTE_REPORT_EVERY_SECONDS while requests flow), else None. `force` is the run's end."""
        with self._lock:
            total = sum(self._requests.values())
            if total == 0:
                return None
            now = self._clock()
            fresh_kind = any(
                n and kind not in self._reported_kinds for kind, n in self._requests.items()
            )
            due = (
                force
                or fresh_kind
                or total - self._reported_total >= ROUTE_REPORT_EVERY_REQUESTS
                or (
                    total > self._reported_total
                    and self._reported_at is not None
                    and now - self._reported_at >= ROUTE_REPORT_EVERY_SECONDS
                )
            )
            if not due:
                return None
            self._reported_total = total
            self._reported_at = now
            self._reported_kinds = {kind for kind, n in self._requests.items() if n}
            counts = self._requests
            label = " ".join(self._last_label.split())
            return (
                f"Routes used: {counts[KIND_AWS]} AWS, {counts[KIND_PROXY]} proxy, "
                f"{counts[KIND_DIRECT]} direct; last: {label}"
            )
