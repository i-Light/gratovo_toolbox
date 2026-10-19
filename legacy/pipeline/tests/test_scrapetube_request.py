"""Tests for `scrapetube._request`'s redirect-loop handling.

Run with:  python tests/test_scrapetube_request.py    (from pipeline/)

Everything network- and time-related is stubbed: `_get_pool` returns a fake
pool (handing out one candidate through the same lease shape as the real one) so no real settings file or candidate rotation is involved, and
`_interruptible_wait` is a no-op so a bounded-retry test doesn't actually
sleep out the (jittered, minutes-long) backoff between attempts.
"""

import sys
import unittest
from pathlib import Path
from unittest import mock

import curl_cffi.requests as requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gratovo.scrapetube import scrapetube  # noqa: E402


class _FakeCandidate:
    def __init__(self):
        self.base_url = ""
        self.proxies = {}
        self.label = "This machine"


class _FakePool:
    """Records whether a candidate was ever blamed (`report_blocked`) for a
    failure -- the thing a redirect loop must NOT do, since it isn't the
    candidate's fault (see `RedirectLoopError`'s doc comment)."""

    def __init__(self):
        self.candidate = _FakeCandidate()
        self.blocked_calls = 0
        self.connection_failure_calls = 0
        self.acquired = 0
        self.released = 0
        self.route_lines = []

    def acquire(self, *, skip_requested=None, on_wait=None):
        self.acquired += 1
        pool = self

        class _Lease:
            candidate = pool.candidate

            def release(self):
                pool.released += 1

        return _Lease()

    def route_line(self, force=False):
        line = "[route] use aws=0 proxy=0 direct=1 last=direct label=This machine"
        self.route_lines.append(line)
        return line

    def report_success(self, candidate):
        pass

    def report_blocked(self, candidate):
        self.blocked_calls += 1

    def report_connection_failure(self, candidate):
        self.connection_failure_calls += 1


class RedirectLoopTests(unittest.TestCase):
    def setUp(self):
        self.pool = _FakePool()
        self._pool_patch = mock.patch.object(
            scrapetube, "_get_pool", lambda: self.pool)
        self._wait_patch = mock.patch.object(
            scrapetube, "_interruptible_wait", lambda total, reason: None)
        self._pool_patch.start()
        self._wait_patch.start()
        self.addCleanup(self._pool_patch.stop)
        self.addCleanup(self._wait_patch.stop)

    def test_gives_up_after_bounded_attempts_without_hanging(self):
        session = mock.Mock()
        session.request.side_effect = requests.exceptions.TooManyRedirects(
            "Exceeded 30 redirects.")

        with self.assertRaises(scrapetube.RedirectLoopError):
            scrapetube._request(session, "GET", "https://www.youtube.com/@x/videos")

        self.assertEqual(
            session.request.call_count, scrapetube.MAX_REDIRECT_LOOP_ATTEMPTS)

    def test_does_not_blame_the_candidate(self):
        # Confirmed by direct reproduction (see the exception's doc comment)
        # that this failure is YouTube's own routing, not a candidate being
        # refused -- cooling one down for it would be blaming the wrong
        # thing and would not help the next attempt either.
        session = mock.Mock()
        session.request.side_effect = requests.exceptions.TooManyRedirects(
            "Exceeded 30 redirects.")

        with self.assertRaises(scrapetube.RedirectLoopError):
            scrapetube._request(session, "GET", "https://www.youtube.com/@x/videos")

        self.assertEqual(self.pool.blocked_calls, 0)
        self.assertEqual(self.pool.connection_failure_calls, 0)

    def test_redirect_loop_error_is_not_a_blocked_error(self):
        # `pipeline.discover_handles`/`get_recent_video_ids` re-raise
        # `BlockedError` as `SearchBlocked`, ending the whole run -- the
        # wrong reaction to one broken channel page. `RedirectLoopError`
        # must fall through their generic `except Exception` instead.
        self.assertFalse(issubclass(scrapetube.RedirectLoopError, scrapetube.BlockedError))

    def test_succeeds_if_a_later_attempt_gets_through(self):
        session = mock.Mock()
        ok_response = mock.Mock(status_code=200, url="https://www.youtube.com/@x/videos")
        ok_response.headers = {"Content-Type": "text/html"}
        ok_response.text = "<html>fine</html>"
        session.request.side_effect = [
            requests.exceptions.TooManyRedirects("Exceeded 30 redirects."),
            ok_response,
        ]

        result = scrapetube._request(session, "GET", "https://www.youtube.com/@x/videos")

        self.assertIs(result, ok_response)
        self.assertEqual(session.request.call_count, 2)


class LeaseTests(unittest.TestCase):
    """Every attempt gives its candidate back, however it ended -- a lease that
    leaked would leave that candidate "busy" and the pool waiting on it for
    the rest of the run."""

    def setUp(self):
        self.pool = _FakePool()
        for patch in (
            mock.patch.object(scrapetube, "_get_pool", lambda: self.pool),
            mock.patch.object(scrapetube, "_interruptible_wait",
                              lambda total, reason: None),
        ):
            patch.start()
            self.addCleanup(patch.stop)

    def test_released_after_success_and_route_reported(self):
        session = mock.Mock()
        session.request.return_value = mock.Mock(
            status_code=200, url="https://www.youtube.com/x",
            headers={"Content-Type": "application/json"}, text="{}")
        with mock.patch("builtins.print") as printed:
            scrapetube._request(session, "GET", "https://www.youtube.com/x")
        self.assertEqual((self.pool.acquired, self.pool.released), (1, 1))
        self.assertIn(mock.call(self.pool.route_lines[0], flush=True),
                      printed.call_args_list)

    def test_released_after_every_failed_attempt(self):
        session = mock.Mock()
        ok = mock.Mock(status_code=200, url="https://www.youtube.com/x",
                       headers={}, text="")
        session.request.side_effect = [
            requests.exceptions.ConnectionError("refused"),
            mock.Mock(status_code=429, url="https://www.youtube.com/x",
                      headers={}, text=""),
            requests.exceptions.TooManyRedirects("loop"),
            ok,
        ]
        with mock.patch("builtins.print"):
            scrapetube._request(session, "GET", "https://www.youtube.com/x")
        self.assertEqual(self.pool.acquired, 4)
        self.assertEqual(self.pool.released, 4)

    def test_a_gateway_candidate_rewrites_the_url(self):
        self.pool.candidate.base_url = "https://g.execute-api.eu-west-1.amazonaws.com/p"
        session = mock.Mock()
        session.request.return_value = mock.Mock(
            status_code=200, url="https://g/x", headers={}, text="")
        with mock.patch("builtins.print"):
            scrapetube._request(session, "GET",
                                "https://www.youtube.com/results?q=a")
        self.assertEqual(
            session.request.call_args[0][1],
            "https://g.execute-api.eu-west-1.amazonaws.com/p/results?q=a")
        self.assertEqual(session.proxies, {})


if __name__ == "__main__":
    unittest.main(verbosity=2)
