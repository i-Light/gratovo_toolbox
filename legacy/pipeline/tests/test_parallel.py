"""Tests for parallel search (`gratovo/parallel.py`) and the pacing rule that
goes with it (`config.Config`: parallel on means the Normal profile).

Run with:  python tests/test_parallel.py    (from pipeline/)

No network and no real database: the workers run plain functions, and
`Config` is fed its settings through patched loaders (no file under data/ is
read -- in particular no .env).
"""

import io
import sys
import threading
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gratovo import config, parallel, run_control  # noqa: E402


class WorkerCountTests(unittest.TestCase):
    def test_off_unless_enabled(self):
        self.assertEqual(parallel.worker_count(None, 5), 1)
        self.assertEqual(parallel.worker_count({}, 5), 1)
        self.assertEqual(parallel.worker_count({"enabled": False}, 5), 1)

    def test_one_worker_per_rotating_connection(self):
        self.assertEqual(parallel.worker_count({"enabled": True}, 0), 1)
        self.assertEqual(parallel.worker_count({"enabled": True}, 1), 1)
        self.assertEqual(parallel.worker_count({"enabled": True}, 3), 3)

    def test_capped_by_max_workers(self):
        self.assertEqual(parallel.worker_count({"enabled": True}, 20),
                         parallel.DEFAULT_MAX_WORKERS)
        self.assertEqual(
            parallel.worker_count({"enabled": True, "max_workers": 2}, 5), 2)
        self.assertEqual(
            parallel.worker_count({"enabled": True, "max_workers": 99}, 50),
            parallel.MAX_WORKERS)
        self.assertEqual(
            parallel.worker_count({"enabled": True, "max_workers": "lots"}, 20),
            parallel.DEFAULT_MAX_WORKERS)
        self.assertEqual(
            parallel.worker_count({"enabled": True, "max_workers": True}, 20),
            parallel.DEFAULT_MAX_WORKERS)


class LineWriterTests(unittest.TestCase):
    def test_lines_from_many_threads_arrive_whole(self):
        # `print` writes the text and the newline separately; without the
        # writer two threads glue their lines together.
        out = io.StringIO()
        writer = parallel.LineWriter(out)

        def talk(name):
            for i in range(300):
                writer.write("[step] {} {}".format(name, i))
                writer.write("\n")

        threads = [threading.Thread(target=talk, args=("w{}".format(n),))
                   for n in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        lines = out.getvalue().splitlines()
        self.assertEqual(len(lines), 1200)
        for line in lines:
            self.assertRegex(line, r"^\[step\] w\d \d+$")

    def test_drain_writes_an_unfinished_line(self):
        out = io.StringIO()
        writer = parallel.LineWriter(out)
        writer.write("no newline yet")
        self.assertEqual(out.getvalue(), "")
        writer.drain()
        self.assertEqual(out.getvalue(), "no newline yet\n")


class _Conn:
    def __init__(self):
        self.closed = False
        self.thread = threading.current_thread()

    def close(self):
        self.closed = True


class RunKeywordsTests(unittest.TestCase):
    def tearDown(self):
        run_control.clear_stop()

    def test_every_keyword_once_on_its_own_connection_in_parallel(self):
        conns = []
        lock = threading.Lock()

        def connect():
            conn = _Conn()
            with lock:
                conns.append(conn)
            return conn

        # All three workers must be inside `work` at the same moment, or the
        # barrier times out: proof they really run side by side.
        barrier = threading.Barrier(3, timeout=5)
        worked = []
        done_on = []

        def work(conn, position, keyword):
            self.assertIs(conn.thread, threading.current_thread())
            self.assertIsNotNone(run_control.current_worker())
            if position <= 3:
                barrier.wait()
            with lock:
                worked.append(keyword)

        def on_done(position, keyword):
            done_on.append((keyword, threading.current_thread()))

        items = [(i, "kw{}".format(i)) for i in range(1, 10)]
        finished = parallel.run_keywords(items, 3, work, on_done, connect=connect)

        self.assertEqual(finished, 9)
        self.assertEqual(sorted(worked), sorted(k for _, k in items))
        self.assertEqual(len(conns), 3)
        self.assertTrue(all(c.closed for c in conns))
        self.assertEqual({t for _, t in done_on}, {threading.main_thread()})
        self.assertEqual(sorted(k for k, _ in done_on), sorted(worked))

    def test_a_failure_stops_the_others_and_is_what_is_raised(self):
        class Blocked(RuntimeError):
            pass

        started = []
        lock = threading.Lock()

        def work(conn, position, keyword):
            with lock:
                started.append(keyword)
            if keyword == "kw2":
                raise Blocked("youtube stopped answering")
            # The others are mid-keyword, waiting the way a real one waits.
            for _ in range(100):
                run_control.sleep(0.01)

        items = [(i, "kw{}".format(i)) for i in range(1, 40)]
        with self.assertRaises(Blocked):
            parallel.run_keywords(items, 3, work, lambda *_: None,
                                  connect=_Conn)
        # Stopped early: nowhere near all 39 keywords were started.
        self.assertLess(len(started), 10)

    def test_single_worker_runs_in_order(self):
        order = []
        parallel.run_keywords([(1, "a"), (2, "b"), (3, "c")], 1,
                              lambda conn, p, k: order.append(k),
                              lambda *_: None, connect=_Conn)
        self.assertEqual(order, ["a", "b", "c"])


class ParallelPacingTests(unittest.TestCase):
    """The owner's rule: with parallel search on, the Normal speed."""

    def _cfg(self, settings, gateways):
        def load_json(path, default=None):
            if path == config.SETTINGS_PATH:
                return settings
            return default

        with mock.patch.object(config, "load_json_file", side_effect=load_json), \
                mock.patch.object(config, "load_env_file", return_value={}), \
                mock.patch.object(config, "load_aws_gateways", return_value=gateways):
            return config.Config()

    def test_rotation_without_parallel_is_fast(self):
        cfg = self._cfg({}, ["https://g1", "https://g2"])
        self.assertEqual(cfg.rotating_connections, 2)
        self.assertEqual(cfg.parallel_workers, 1)
        self.assertEqual(cfg.pacing_profile, "fast")

    def test_parallel_on_uses_normal(self):
        cfg = self._cfg({"parallel_search": {"enabled": True}},
                        ["https://g1", "https://g2"])
        self.assertEqual(cfg.parallel_workers, 2)
        self.assertEqual(cfg.pacing_profile, "normal")

    def test_parallel_on_with_one_connection_is_just_rotation(self):
        # Nothing to run side by side, so it is a rotating single worker --
        # and keeps the Fast pace rotation earns.
        cfg = self._cfg({"parallel_search": {"enabled": True}}, ["https://g1"])
        self.assertEqual(cfg.parallel_workers, 1)
        self.assertEqual(cfg.pacing_profile, "fast")

    def test_no_rotation_is_normal(self):
        cfg = self._cfg({"parallel_search": {"enabled": True}}, [])
        self.assertEqual(cfg.rotating_connections, 0)
        self.assertEqual(cfg.parallel_workers, 1)
        self.assertEqual(cfg.pacing_profile, "normal")

    def test_proxies_count_like_the_pool_does(self):
        cfg = self._cfg({
            "parallel_search": {"enabled": True},
            "proxies": {"enabled": True, "list": [
                {"host": "1.1.1.1"}, {"host": ""}, {"host": "2.2.2.2", "enabled": False},
                {"host": "3.3.3.3"},
            ]},
        }, ["https://g1"])
        self.assertEqual(cfg.rotating_connections, 3)
        self.assertEqual(cfg.parallel_workers, 3)


if __name__ == "__main__":
    unittest.main(verbosity=2)
