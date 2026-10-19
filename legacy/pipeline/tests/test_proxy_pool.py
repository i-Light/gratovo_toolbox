"""Tests for the proxy rotation pool.

Run with:  python tests/test_proxy_pool.py    (from pipeline/)

Plain unittest, no network, no real waiting -- the pool takes its clock,
sleep and random source as parameters, so the rotation guarantees are proved
on a fake clock rather than sampled for.
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gratovo import run_control  # noqa: E402
from gratovo.scrapetube import proxy_pool  # noqa: E402
from gratovo.scrapetube.proxy_pool import DIRECT_ID, ProxyPool  # noqa: E402


class _FakeClock:
    def __init__(self, start=1000.0):
        self.now = start

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


class FromSettingsTests(unittest.TestCase):
    def test_disabled_is_direct_only(self):
        pool = ProxyPool.from_settings({"enabled": False, "list": [
            {"host": "1.2.3.4", "port": 8080},
        ]})
        self.assertEqual([c.id for c in pool._candidates], [DIRECT_ID])

    def test_empty_list_is_direct_only(self):
        pool = ProxyPool.from_settings({"enabled": True, "list": []})
        self.assertEqual([c.id for c in pool._candidates], [DIRECT_ID])

    def test_missing_settings_is_direct_only(self):
        pool = ProxyPool.from_settings({})
        self.assertEqual([c.id for c in pool._candidates], [DIRECT_ID])

    def test_enabled_list_included_with_direct_by_default(self):
        pool = ProxyPool.from_settings({"enabled": True, "list": [
            {"id": "p1", "host": "1.2.3.4", "port": 8080},
        ]})
        ids = {c.id for c in pool._candidates}
        self.assertEqual(ids, {"p1", DIRECT_ID})

    def test_include_direct_false_excludes_direct(self):
        pool = ProxyPool.from_settings({
            "enabled": True,
            "include_direct": False,
            "list": [{"id": "p1", "host": "1.2.3.4", "port": 8080}],
        })
        ids = {c.id for c in pool._candidates}
        self.assertEqual(ids, {"p1"})

    def test_disabled_entries_and_blank_hosts_are_skipped(self):
        pool = ProxyPool.from_settings({
            "enabled": True,
            "include_direct": False,
            "list": [
                {"id": "off", "host": "1.2.3.4", "port": 1, "enabled": False},
                {"id": "blank", "host": "", "port": 1},
                {"id": "ok", "host": "5.6.7.8", "port": 2},
            ],
        })
        self.assertEqual([c.id for c in pool._candidates], ["ok"])

    def test_include_direct_false_with_no_usable_entries_still_has_direct(self):
        # Never construct an empty pool, even if the settings say to exclude
        # direct and every entry is unusable.
        pool = ProxyPool.from_settings({
            "enabled": True,
            "include_direct": False,
            "list": [{"id": "off", "host": "1.2.3.4", "port": 1, "enabled": False}],
        })
        self.assertEqual([c.id for c in pool._candidates], [DIRECT_ID])

    def test_gateway_urls_added_alongside_direct(self):
        pool = ProxyPool.from_settings({}, gateway_urls=[
            "https://abc.execute-api.us-east-1.amazonaws.com/prod",
        ])
        ids = {c.id for c in pool._candidates}
        self.assertEqual(ids, {"gateway-0", DIRECT_ID})
        gateway = next(c for c in pool._candidates if c.id == "gateway-0")
        self.assertEqual(gateway.base_url, "https://abc.execute-api.us-east-1.amazonaws.com/prod")
        self.assertEqual(gateway.proxies, {})

    def test_gateway_urls_combine_with_http_proxy_list(self):
        pool = ProxyPool.from_settings(
            {"enabled": True, "include_direct": False,
             "list": [{"id": "p1", "host": "1.2.3.4", "port": 1}]},
            gateway_urls=["https://abc.execute-api.us-east-1.amazonaws.com/prod"],
        )
        ids = {c.id for c in pool._candidates}
        self.assertEqual(ids, {"p1", "gateway-0"})

    def test_trailing_slash_stripped_from_gateway_url(self):
        pool = ProxyPool.from_settings(
            {}, gateway_urls=["https://abc.execute-api.us-east-1.amazonaws.com/prod/"])
        gateway = next(c for c in pool._candidates if c.id == "gateway-0")
        self.assertEqual(gateway.base_url, "https://abc.execute-api.us-east-1.amazonaws.com/prod")

    def test_blank_gateway_urls_skipped(self):
        pool = ProxyPool.from_settings({}, gateway_urls=["", "   "])
        self.assertEqual([c.id for c in pool._candidates], [DIRECT_ID])


class _FakeRng:
    """`uniform` always answers its low end: jitter off, so gaps are exact."""

    def uniform(self, low, high):
        return low


def _pool(entries, *, gateways=(), include_direct=True, gap=6.0, clock=None,
          sleeps=None):
    """A pool on a fake clock whose `sleep` advances that clock (and records
    how long it was asked to sleep)."""
    clock = clock or _FakeClock()

    def sleep(seconds):
        if sleeps is not None:
            sleeps.append(seconds)
        clock.advance(seconds)

    return ProxyPool.from_settings(
        {"enabled": bool(entries), "include_direct": include_direct,
         "min_gap_seconds": gap, "min_gap_jitter": 0,
         "list": [{"id": e, "host": "10.0.0.{}".format(i + 1), "port": 8000}
                  for i, e in enumerate(entries)]},
        gateway_urls=list(gateways), clock=clock, sleep=sleep, rng=_FakeRng()), clock


def _use(pool, seconds=0.0, clock=None):
    """One request: acquire, hold it [seconds], release. Returns the id."""
    lease = pool.acquire()
    if clock is not None:
        clock.advance(seconds)
    lease.release()
    return lease.candidate.id


class AcquireTests(unittest.TestCase):
    def tearDown(self):
        run_control.clear_stop()

    def test_direct_only_never_waits(self):
        # The default install: rotation off, one candidate. Behaviour must be
        # exactly what it was before the pool had rules -- no gap, no wait.
        sleeps = []
        pool, _ = _pool([], sleeps=sleeps)
        self.assertEqual([_use(pool) for _ in range(5)], [DIRECT_ID] * 5)
        self.assertEqual(sleeps, [])

    def test_least_recently_used_goes_next(self):
        pool, _ = _pool(["p1", "p2", "p3"], include_direct=False, gap=0)
        seen = [_use(pool) for _ in range(6)]
        self.assertEqual(seen, seen[:3] * 2)
        self.assertEqual(set(seen), {"p1", "p2", "p3"})

    def test_never_the_same_candidate_twice_in_a_row(self):
        # p2 cools down and recovers mid-run: an index into "whoever is healthy
        # right now" could then hand out the same candidate twice running.
        pool, clock = _pool(["p1", "p2", "p3"], include_direct=False, gap=0)
        seen = []
        for i in range(30):
            if i == 4:
                pool.report_connection_failure(
                    next(c for c in pool._candidates if c.id == "p2"))
            if i == 12:
                clock.advance(10_000)
            seen.append(_use(pool))
        for a, b in zip(seen, seen[1:]):
            self.assertNotEqual(a, b, seen)

    def test_the_only_healthy_candidate_is_reused(self):
        pool, _ = _pool(["p1"], include_direct=False, gap=0)
        self.assertEqual([_use(pool) for _ in range(3)], ["p1"] * 3)

    def test_a_gateway_is_not_used_again_within_its_gap(self):
        sleeps = []
        pool, clock = _pool(
            [], gateways=["https://a.execute-api.eu-west-1.amazonaws.com/p"],
            include_direct=False, gap=6.0, sleeps=sleeps)
        _use(pool)
        start = clock.now
        _use(pool)
        self.assertGreaterEqual(clock.now - start, 6.0)
        self.assertTrue(sleeps)

    def test_with_direct_the_gateway_still_keeps_its_gap(self):
        # Gateway, direct, gateway... -- and the gateway's next turn waits for
        # its gap rather than letting direct go twice in a row.
        pool, clock = _pool(
            [], gateways=["https://a.execute-api.us-east-1.amazonaws.com/p"],
            gap=6.0)
        times = {}
        order = []
        for _ in range(6):
            lease = pool.acquire()
            order.append(lease.candidate.id)
            times.setdefault(lease.candidate.id, []).append(clock.now)
            clock.advance(0.5)
            lease.release()
        for a, b in zip(order, order[1:]):
            self.assertNotEqual(a, b, order)
        uses = times["gateway-0"]
        self.assertEqual(len(uses), 3)
        for a, b in zip(uses, uses[1:]):
            self.assertGreaterEqual(b - a, 6.0)

    def test_gap_is_a_floor_jitter_only_lengthens(self):
        clock = _FakeClock()
        pool = ProxyPool.from_settings(
            {"min_gap_seconds": 5.0, "min_gap_jitter": 0.5, "include_direct": False},
            gateway_urls=["https://g"], clock=clock, sleep=clock.advance)
        gateway = pool._candidates[0]
        for _ in range(50):
            lease = pool.acquire()
            released = clock.now
            lease.release()
            self.assertGreaterEqual(gateway.ready_at - released, 5.0)
            self.assertLessEqual(gateway.ready_at - released, 7.5)
            clock.advance(10)

    def test_a_candidate_serves_one_request_at_a_time(self):
        pool, _ = _pool(["p1", "p2"], include_direct=False, gap=0)
        first = pool.acquire()
        second = pool.acquire()
        self.assertIsNot(first.candidate, second.candidate)
        first.release()
        second.release()

    def test_a_busy_candidate_is_waited_for_not_shared(self):
        # p1 is mid-request on one worker; p2 just served another. The next
        # request may not repeat p2 and may not share p1 -- it waits for p1.
        pool, _ = _pool(["p1", "p2"], include_direct=False, gap=0)
        on_p1 = pool.acquire()
        pool.acquire().release()
        waits = []

        def p1_finishes(info):
            waits.append(info.reason)
            on_p1.release()

        lease = pool.acquire(on_wait=p1_finishes)
        self.assertEqual(lease.candidate.id, "p1")
        self.assertEqual(waits, [proxy_pool.WAIT_BUSY])

    def test_every_candidate_cooling_waits_for_the_soonest(self):
        sleeps = []
        pool, clock = _pool(["p1", "p2"], include_direct=False, gap=0,
                            sleeps=sleeps)
        p1, p2 = pool._candidates
        pool.report_blocked(p1)
        clock.advance(1.0)
        pool.report_connection_failure(p2)
        # p1 got the longer (block) cooldown, p2 the shorter
        # (connection-failure) one -- p2 recovers first even though it
        # failed later.
        lease = pool.acquire()
        self.assertIs(lease.candidate, p2)
        self.assertGreaterEqual(clock.now, p2.cooldown_until)
        self.assertTrue(sleeps)
        self.assertTrue(all(s <= proxy_pool.WAIT_TICK for s in sleeps))

    def test_try_again_now_ends_a_cooldown_wait(self):
        pool, clock = _pool(["p1"], include_direct=False, gap=0)
        pool.report_blocked(pool._candidates[0])
        start = clock.now
        lease = pool.acquire(skip_requested=lambda: True)
        self.assertLess(clock.now - start, 1.0)
        self.assertEqual(lease.candidate.id, "p1")

    def test_try_again_now_does_not_cut_a_gap(self):
        pool, clock = _pool(
            [], gateways=["https://g"], include_direct=False, gap=6.0)
        _use(pool)
        start = clock.now
        pool.acquire(skip_requested=lambda: True)
        self.assertGreaterEqual(clock.now - start, 6.0)

    def test_waits_are_announced_with_their_reason(self):
        pool, _ = _pool(["p1"], include_direct=False, gap=0)
        pool.report_blocked(pool._candidates[0])
        seen = []
        pool.acquire(on_wait=seen.append)
        self.assertTrue(seen)
        self.assertEqual({w.reason for w in seen}, {proxy_pool.WAIT_COOLDOWN})
        self.assertEqual(seen[0].label, "10.0.0.1")
        self.assertGreaterEqual(seen[0].total, seen[-1].remaining)

    def test_a_stop_ends_a_wait(self):
        pool, _ = _pool(["p1"], include_direct=False, gap=0)
        pool.report_blocked(pool._candidates[0])

        def stop_during_wait(info):
            run_control.request_stop()

        with self.assertRaises(run_control.RunAborted):
            pool.acquire(on_wait=stop_during_wait)

    def test_release_is_idempotent_and_a_context_manager(self):
        pool, _ = _pool(["p1"], include_direct=False, gap=0)
        with pool.acquire() as lease:
            self.assertTrue(lease.candidate.busy)
        self.assertFalse(lease.candidate.busy)
        lease.release()
        self.assertFalse(lease.candidate.busy)


class RouteReportTests(unittest.TestCase):
    def test_route_line_counts_kinds_and_names_the_last(self):
        pool, _ = _pool(
            ["p1"], gateways=["https://abc.execute-api.eu-west-1.amazonaws.com/p"],
            gap=0)
        self.assertIsNone(pool.route_line())
        ids = [_use(pool) for _ in range(3)]
        self.assertEqual(sum(pool.route_counts().values()), 3)
        line = pool.route_line(force=True)
        self.assertRegex(
            line, r"^\[route\] use aws=\d+ proxy=\d+ direct=\d+ last=\w+ label=")
        label = next(c.label for c in pool._candidates if c.id == ids[-1])
        self.assertTrue(line.endswith("label=" + label), line)

    def test_route_line_is_due_on_a_new_kind_and_every_n_requests(self):
        pool, _ = _pool([], gateways=["https://g1", "https://g2"],
                        include_direct=False, gap=0)
        _use(pool)
        self.assertIsNotNone(pool.route_line())  # first use of "aws"
        for _ in range(proxy_pool.ROUTE_REPORT_EVERY_REQUESTS - 1):
            _use(pool)
            self.assertIsNone(pool.route_line())
        _use(pool)
        self.assertIsNotNone(pool.route_line())

    def test_gateway_label_carries_the_region(self):
        self.assertEqual(
            proxy_pool.gateway_label(
                1, "https://x.execute-api.EU-WEST-1.amazonaws.com/p"),
            "AWS Gateway 2 (eu-west-1)")
        self.assertEqual(proxy_pool.gateway_label(0, "https://elsewhere"),
                         "AWS Gateway 1")

    def test_pool_line(self):
        self.assertEqual(
            proxy_pool.format_route_pool(gateways=3, proxies=0, direct=True, gap=6,
                                         workers=3, parallel=True, pacing="normal"),
            "[route] pool gateways=3 proxies=0 direct=1 gap=6 workers=3 "
            "parallel=1 pacing=normal")

    def test_describe_and_non_direct_count(self):
        pool, _ = _pool(["p1", "p2"], gateways=["https://g"], gap=4)
        self.assertEqual(pool.non_direct_count, 3)
        self.assertEqual(pool.describe(),
                         {"gateways": 1, "proxies": 2, "direct": True, "min_gap": 4.0})

    def test_min_gap_setting_is_clamped_and_zero_switches_it_off(self):
        pool = ProxyPool.from_settings({"min_gap_seconds": -3},
                                       gateway_urls=["https://g"])
        self.assertEqual(pool._candidates[0].min_gap, 0.0)
        pool = ProxyPool.from_settings({"min_gap_seconds": "fast"},
                                       gateway_urls=["https://g"])
        self.assertEqual(pool._candidates[0].min_gap,
                         proxy_pool.DEFAULT_MIN_GAP_SECONDS)
        pool = ProxyPool.from_settings({"min_gap_seconds": 10_000},
                                       gateway_urls=["https://g"])
        self.assertEqual(pool._candidates[0].min_gap,
                         proxy_pool.MAX_MIN_GAP_SECONDS)


class ReportTests(unittest.TestCase):
    def setUp(self):
        self.clock = _FakeClock()
        self._orig = proxy_pool.time.monotonic
        proxy_pool.time.monotonic = self.clock
        self.pool = ProxyPool.from_settings({
            "enabled": True,
            "include_direct": False,
            "list": [{"id": "p1", "host": "1.2.3.4", "port": 1}],
        })
        self.candidate = self.pool._candidates[0]

    def tearDown(self):
        proxy_pool.time.monotonic = self._orig

    def test_success_clears_cooldown_and_failure_count(self):
        self.pool.report_connection_failure(self.candidate)
        self.pool.report_success(self.candidate)
        self.assertEqual(self.candidate.consecutive_failures, 0)
        self.assertEqual(self.candidate.cooldown_until, 0.0)

    def test_connection_failure_cooldown_escalates(self):
        self.pool.report_connection_failure(self.candidate)
        first_wait = self.candidate.cooldown_until - self.clock.now
        self.candidate.cooldown_until = self.clock.now  # clear for a clean second read
        self.pool.report_connection_failure(self.candidate)
        second_wait = self.candidate.cooldown_until - self.clock.now
        self.assertGreater(second_wait, first_wait)

    def test_connection_failure_cooldown_is_capped(self):
        for _ in range(20):
            self.pool.report_connection_failure(self.candidate)
        wait = self.candidate.cooldown_until - self.clock.now
        self.assertLessEqual(wait, proxy_pool.CONNECTION_COOLDOWN_MAX * 1.4)

    def test_blocked_cooldown_is_longer_than_connection_failure(self):
        self.pool.report_blocked(self.candidate)
        blocked_wait = self.candidate.cooldown_until - self.clock.now
        self.candidate.cooldown_until = self.clock.now
        self.candidate.consecutive_failures = 0
        self.pool.report_connection_failure(self.candidate)
        connection_wait = self.candidate.cooldown_until - self.clock.now
        self.assertGreater(blocked_wait, connection_wait)


if __name__ == "__main__":
    unittest.main(verbosity=2)
