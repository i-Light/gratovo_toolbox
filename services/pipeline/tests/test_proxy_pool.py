"""The proxy rotation pool (ported from the old test_proxy_pool). No network, no real waiting: the
pool takes its clock, sleep and random source as parameters, so its guarantees are proved on a
fake clock rather than sampled for."""

import itertools
from collections.abc import Iterator

import pytest

from gratovo_pipeline import run_control
from gratovo_pipeline.scrapetube import proxy_pool
from gratovo_pipeline.scrapetube.proxy_pool import DIRECT_ID, Lease, ProxyPool, WaitInfo

GATEWAY = "https://abc.execute-api.us-east-1.amazonaws.com/prod"


@pytest.fixture(autouse=True)
def clear_stop() -> Iterator[None]:
    yield
    run_control.clear_stop()


class FakeClock:
    def __init__(self, start: float = 1000.0) -> None:
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


class LowRng:
    """`uniform` always answers its low end: jitter off, so gaps are exact."""

    def uniform(self, a: float, b: float) -> float:
        return a


def ids(pool: ProxyPool) -> list[str]:
    return [c.id for c in pool.candidates]


def make_pool(
    proxies: int = 0,
    *,
    gateways: tuple[str, ...] = (),
    include_direct: bool = True,
    gap: float = 6.0,
    clock: FakeClock | None = None,
    sleeps: list[float] | None = None,
) -> tuple[ProxyPool, FakeClock]:
    """A pool on a fake clock whose sleep advances that clock (and records how long)."""
    fake = clock or FakeClock()

    def sleep(seconds: float) -> None:
        if sleeps is not None:
            sleeps.append(seconds)
        fake.advance(seconds)

    pool = ProxyPool.from_routes(
        proxy_urls=[f"http://10.0.0.{i + 1}:8000" for i in range(proxies)],
        gateway_urls=gateways,
        include_direct=include_direct,
        min_gap_seconds=gap,
        min_gap_jitter=0,
        clock=fake,
        sleep=sleep,
        rng=LowRng(),
    )
    return pool, fake


def use(pool: ProxyPool) -> str:
    """One request: acquire, release. Returns the candidate's id."""
    lease = pool.acquire()
    lease.release()
    return lease.candidate.id


# --- building the pool ---


def test_no_routes_is_direct_only() -> None:
    assert ids(ProxyPool.from_routes()) == [DIRECT_ID]


def test_proxies_switched_off_are_left_out() -> None:
    pool = ProxyPool.from_routes(proxy_urls=["http://1.2.3.4:8080"], proxies_enabled=False)
    assert ids(pool) == [DIRECT_ID]


def test_proxies_come_with_direct_by_default() -> None:
    pool = ProxyPool.from_routes(proxy_urls=["http://1.2.3.4:8080"])
    assert set(ids(pool)) == {"1.2.3.4:8080", DIRECT_ID}


def test_include_direct_false_leaves_direct_out() -> None:
    pool = ProxyPool.from_routes(proxy_urls=["http://1.2.3.4:8080"], include_direct=False)
    assert ids(pool) == ["1.2.3.4:8080"]


def test_a_proxy_without_a_scheme_is_http() -> None:
    pool = ProxyPool.from_routes(proxy_urls=["1.2.3.4:8080"], include_direct=False)
    assert pool.candidates[0].proxies == {
        "http": "http://1.2.3.4:8080",
        "https": "http://1.2.3.4:8080",
    }


def test_a_proxy_s_label_never_carries_its_login() -> None:
    pool = ProxyPool.from_routes(
        proxy_urls=["http://user:hunter2@5.6.7.8:3128"], include_direct=False
    )
    assert pool.candidates[0].label == "5.6.7.8"
    assert "hunter2" not in pool.candidates[0].id


def test_blank_and_hostless_urls_are_skipped() -> None:
    pool = ProxyPool.from_routes(
        proxy_urls=["", "  ", "http://", "http://5.6.7.8:2"], include_direct=False
    )
    assert ids(pool) == ["5.6.7.8:2"]


def test_with_nothing_usable_direct_is_kept_even_when_excluded() -> None:
    # Never an empty pool.
    assert ids(ProxyPool.from_routes(proxy_urls=[""], include_direct=False)) == [DIRECT_ID]


def test_gateways_come_alongside_direct() -> None:
    pool = ProxyPool.from_routes(gateway_urls=[GATEWAY])
    assert set(ids(pool)) == {"gateway-0", DIRECT_ID}
    gateway = next(c for c in pool.candidates if c.id == "gateway-0")
    assert gateway.base_url == GATEWAY
    assert gateway.proxies == {}


def test_gateways_combine_with_proxies() -> None:
    pool = ProxyPool.from_routes(
        proxy_urls=["http://1.2.3.4:1"], gateway_urls=[GATEWAY], include_direct=False
    )
    assert set(ids(pool)) == {"1.2.3.4:1", "gateway-0"}


def test_a_gateway_s_trailing_slash_is_dropped() -> None:
    pool = ProxyPool.from_routes(gateway_urls=[GATEWAY + "/"])
    assert next(c for c in pool.candidates if c.id == "gateway-0").base_url == GATEWAY


def test_blank_gateways_are_skipped() -> None:
    assert ids(ProxyPool.from_routes(gateway_urls=["", "   "])) == [DIRECT_ID]


def test_the_gap_is_clamped_and_zero_switches_it_off() -> None:
    assert (
        ProxyPool.from_routes(gateway_urls=["https://g"], min_gap_seconds=-3).candidates[0].min_gap
        == 0.0
    )
    assert (
        ProxyPool.from_routes(gateway_urls=["https://g"], min_gap_seconds=10_000)
        .candidates[0]
        .min_gap
        == proxy_pool.MAX_MIN_GAP_SECONDS
    )


# --- handing candidates out ---


def test_direct_only_never_waits() -> None:
    # The default: rotation off, one candidate, no gap, no wait.
    sleeps: list[float] = []
    pool, _ = make_pool(sleeps=sleeps)
    assert [use(pool) for _ in range(5)] == [DIRECT_ID] * 5
    assert sleeps == []


def test_the_least_recently_used_goes_next() -> None:
    pool, _ = make_pool(3, include_direct=False, gap=0)
    seen = [use(pool) for _ in range(6)]
    assert seen == seen[:3] * 2
    assert len(set(seen)) == 3


def test_never_the_same_candidate_twice_in_a_row() -> None:
    # One cools down and recovers mid-run: an index into "whoever is healthy now" could then
    # hand the same one out twice running.
    pool, clock = make_pool(3, include_direct=False, gap=0)
    seen: list[str] = []
    for i in range(30):
        if i == 4:
            pool.report_connection_failure(pool.candidates[1])
        if i == 12:
            clock.advance(10_000)
        seen.append(use(pool))
    assert all(a != b for a, b in itertools.pairwise(seen)), seen


def test_the_only_healthy_candidate_is_reused() -> None:
    pool, _ = make_pool(1, include_direct=False, gap=0)
    assert len({use(pool) for _ in range(3)}) == 1


def test_a_gateway_is_not_used_again_within_its_gap() -> None:
    sleeps: list[float] = []
    pool, clock = make_pool(
        gateways=("https://a.execute-api.eu-west-1.amazonaws.com/p",),
        include_direct=False,
        sleeps=sleeps,
    )
    use(pool)
    start = clock.now
    use(pool)
    assert clock.now - start >= 6.0
    assert sleeps


def test_with_direct_the_gateway_still_keeps_its_gap() -> None:
    pool, clock = make_pool(gateways=("https://a.execute-api.us-east-1.amazonaws.com/p",))
    times: dict[str, list[float]] = {}
    order: list[str] = []
    for _ in range(6):
        lease = pool.acquire()
        order.append(lease.candidate.id)
        times.setdefault(lease.candidate.id, []).append(clock.now)
        clock.advance(0.5)
        lease.release()
    assert all(a != b for a, b in itertools.pairwise(order)), order
    uses = times["gateway-0"]
    assert len(uses) == 3
    assert all(b - a >= 6.0 for a, b in itertools.pairwise(uses))


def test_the_gap_is_a_floor_jitter_only_lengthens_it() -> None:
    clock = FakeClock()
    pool = ProxyPool.from_routes(
        gateway_urls=["https://g"],
        include_direct=False,
        min_gap_seconds=5.0,
        min_gap_jitter=0.5,
        clock=clock,
        sleep=clock.advance,
    )
    gateway = pool.candidates[0]
    for _ in range(50):
        lease = pool.acquire()
        released = clock.now
        lease.release()
        assert 5.0 <= gateway.ready_at - released <= 7.5
        clock.advance(10)


def test_a_candidate_serves_one_request_at_a_time() -> None:
    pool, _ = make_pool(2, include_direct=False, gap=0)
    first, second = pool.acquire(), pool.acquire()
    assert first.candidate is not second.candidate
    first.release()
    second.release()


def test_a_busy_candidate_is_waited_for_not_shared() -> None:
    pool, _ = make_pool(2, include_direct=False, gap=0)
    on_first = pool.acquire()
    pool.acquire().release()
    waits: list[str] = []

    def first_finishes(info: WaitInfo) -> None:
        waits.append(info.reason)
        on_first.release()

    lease = pool.acquire(on_wait=first_finishes)
    assert lease.candidate is on_first.candidate
    assert waits == [proxy_pool.WAIT_BUSY]


def test_every_candidate_cooling_waits_for_the_soonest() -> None:
    sleeps: list[float] = []
    pool, clock = make_pool(2, include_direct=False, gap=0, sleeps=sleeps)
    p1, p2 = pool.candidates
    pool.report_blocked(p1)
    clock.advance(1.0)
    pool.report_connection_failure(p2)  # the shorter cooldown: p2 is back first
    lease = pool.acquire()
    assert lease.candidate is p2
    assert clock.now >= p2.cooldown_until
    assert sleeps
    assert all(s <= proxy_pool.WAIT_TICK for s in sleeps)


def test_try_again_now_ends_a_cooldown_wait() -> None:
    pool, clock = make_pool(1, include_direct=False, gap=0)
    pool.report_blocked(pool.candidates[0])
    start = clock.now
    lease = pool.acquire(skip_requested=lambda: True)
    assert clock.now - start < 1.0
    assert lease.candidate is pool.candidates[0]


def test_try_again_now_never_cuts_a_gap() -> None:
    pool, clock = make_pool(gateways=("https://g",), include_direct=False)
    use(pool)
    start = clock.now
    pool.acquire(skip_requested=lambda: True)
    assert clock.now - start >= 6.0


def test_waits_are_announced_with_their_reason() -> None:
    pool, _ = make_pool(1, include_direct=False, gap=0)
    pool.report_blocked(pool.candidates[0])
    seen: list[WaitInfo] = []
    pool.acquire(on_wait=seen.append)
    assert seen
    assert {w.reason for w in seen} == {proxy_pool.WAIT_COOLDOWN}
    assert seen[0].label == "10.0.0.1"
    assert seen[0].total >= seen[-1].remaining


def test_a_stop_ends_a_wait() -> None:
    pool, _ = make_pool(1, include_direct=False, gap=0)
    pool.report_blocked(pool.candidates[0])

    def stop_during_wait(_info: WaitInfo) -> None:
        run_control.request_stop()

    with pytest.raises(run_control.RunAborted):
        pool.acquire(on_wait=stop_during_wait)


def test_release_is_idempotent_and_a_context_manager() -> None:
    pool, _ = make_pool(1, include_direct=False, gap=0)
    lease: Lease
    with pool.acquire() as lease:
        assert lease.candidate.busy
    assert not lease.candidate.busy
    lease.release()
    assert not lease.candidate.busy


# --- what the run reports ---


def test_the_route_summary_counts_kinds_and_names_the_last() -> None:
    pool, _ = make_pool(1, gateways=("https://abc.execute-api.eu-west-1.amazonaws.com/p",), gap=0)
    assert pool.route_summary() is None
    seen = [use(pool) for _ in range(3)]
    assert sum(pool.route_counts().values()) == 3
    summary = pool.route_summary(force=True)
    assert summary is not None
    assert summary.startswith("Routes used: ")
    label = next(c.label for c in pool.candidates if c.id == seen[-1])
    assert summary.endswith(f"last: {label}")


def test_the_route_summary_is_due_on_a_new_kind_and_every_n_requests() -> None:
    pool, _ = make_pool(gateways=("https://g1", "https://g2"), include_direct=False, gap=0)
    use(pool)
    assert pool.route_summary() is not None  # the first use of a gateway
    for _ in range(proxy_pool.ROUTE_REPORT_EVERY_REQUESTS - 1):
        use(pool)
        assert pool.route_summary() is None
    use(pool)
    assert pool.route_summary() is not None


def test_a_gateway_s_label_carries_its_region() -> None:
    assert (
        proxy_pool.gateway_label(1, "https://x.execute-api.EU-WEST-1.amazonaws.com/p")
        == "AWS Gateway 2 (eu-west-1)"
    )
    assert proxy_pool.gateway_label(0, "https://elsewhere") == "AWS Gateway 1"


def test_describe_and_the_non_direct_count() -> None:
    pool, _ = make_pool(2, gateways=("https://g",), gap=4)
    assert pool.non_direct_count == 3
    assert pool.describe() == {"gateways": 1, "proxies": 2, "direct": True, "min_gap": 4.0}


# --- health ---


def test_success_clears_cooldown_and_the_failure_count() -> None:
    pool, _ = make_pool(1, include_direct=False)
    candidate = pool.candidates[0]
    pool.report_connection_failure(candidate)
    pool.report_success(candidate)
    assert (candidate.consecutive_failures, candidate.cooldown_until) == (0, 0.0)


def test_a_connection_failure_s_cooldown_escalates_and_is_capped() -> None:
    pool, clock = make_pool(1, include_direct=False)
    candidate = pool.candidates[0]
    pool.report_connection_failure(candidate)
    first = candidate.cooldown_until - clock.now
    pool.report_connection_failure(candidate)
    assert candidate.cooldown_until - clock.now > first
    for _ in range(20):
        pool.report_connection_failure(candidate)
    assert candidate.cooldown_until - clock.now <= proxy_pool.CONNECTION_COOLDOWN_MAX * 1.4


def test_a_block_cools_down_longer_than_a_connection_failure() -> None:
    pool, clock = make_pool(2, include_direct=False)
    blocked, failed = pool.candidates
    pool.report_blocked(blocked)
    pool.report_connection_failure(failed)
    assert blocked.cooldown_until - clock.now > failed.cooldown_until - clock.now
