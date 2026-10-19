"""Tests for `store.reconcile_stale_runs` — closing out run rows whose
process is gone.

Run with:  python tests/test_run_reconcile.py    (from pipeline/)

WHAT IS ACTUALLY BEING PINNED
-----------------------------
`finish_run` is the only thing that ever moves a `runs` row off `running`, and
it runs inside the interpreter. A run whose process is *killed* — the app
closed mid-run, the machine shut down, or Stop pressed on Windows, where the
app terminates the process rather than delivering a real console interrupt —
therefore leaves its row saying `running` with nothing that will ever write it
again.

That is not a cosmetic leftover. The Flutter app falls back to this table on
every launch when it has no live process of its own
(`local_search_repository.dart`), and a row still marked `running` renders as a
live run with no keyword yet — "Starting the pipeline…", with a spinner,
indefinitely, on a machine where nothing is running.

The two halves that matter, and both are here: a row whose process is gone gets
closed, and a row whose process is *alive* does not. Getting the second half
wrong would mean a background `--pull-only` (which the app fires on every
launch, and which is what makes this self-healing) declaring a genuinely
running search dead.
"""

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gratovo import store  # noqa: E402

# A pid that is not in use. Windows and Linux both cap pids well below this.
DEAD_PID = 4_000_000_000


class ReconcileStaleRunsTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.conn = store.get_connection(str(Path(self.dir.name) / "test.db"))
        self.addCleanup(self.conn.close)
        store.init_db(self.conn)

    def _status(self, run_id):
        row = self.conn.execute(
            "SELECT status, finished_at FROM runs WHERE run_id=?", (run_id,)
        ).fetchone()
        return row["status"], row["finished_at"]

    def _set_pid(self, run_id, pid):
        self.conn.execute("UPDATE runs SET pid=? WHERE run_id=?", (pid, run_id))
        self.conn.commit()

    # ---- the rows that should be closed --------------------------------

    def test_row_from_a_dead_process_is_marked_interrupted(self):
        run_id = store.start_run(self.conn, 5)
        self._set_pid(run_id, DEAD_PID)

        self.assertEqual(store.reconcile_stale_runs(self.conn), 1)
        status, finished_at = self._status(run_id)
        self.assertEqual(status, "interrupted")
        self.assertIsNotNone(finished_at)

    def test_row_written_before_pid_existed_is_treated_as_stale(self):
        """A NULL pid predates this column, so it predates this process."""
        run_id = store.start_run(self.conn, 5)
        self._set_pid(run_id, None)

        self.assertEqual(store.reconcile_stale_runs(self.conn), 1)
        self.assertEqual(self._status(run_id)[0], "interrupted")

    def test_several_stale_rows_are_all_closed(self):
        ids = [store.start_run(self.conn, 1) for _ in range(3)]
        for run_id in ids:
            self._set_pid(run_id, DEAD_PID)

        self.assertEqual(store.reconcile_stale_runs(self.conn), 3)
        for run_id in ids:
            self.assertEqual(self._status(run_id)[0], "interrupted")

    # ---- the rows that must be left alone ------------------------------

    def test_this_process_own_run_is_left_running(self):
        """The sweep runs at the start of every search.py, including the one
        that is about to do the searching."""
        run_id = store.start_run(self.conn, 5)
        self.assertEqual(self.conn.execute(
            "SELECT pid FROM runs WHERE run_id=?", (run_id,)
        ).fetchone()["pid"], os.getpid())

        self.assertEqual(store.reconcile_stale_runs(self.conn), 0)
        self.assertEqual(self._status(run_id)[0], "running")

    def test_a_run_in_another_live_process_is_left_running(self):
        """The case that matters most: a hand-run `python search.py`, or the
        app's own run while the background `--pull-only` sweeps underneath it.
        A different pid, but a live one, so it is not this sweep's to close.

        Stood in for by the parent process, which is alive by definition (it is
        waiting on this one) and is not our own pid — so this exercises the
        liveness check rather than the `pid == mine` shortcut."""
        run_id = store.start_run(self.conn, 5)
        parent = os.getppid()
        self.assertNotEqual(parent, os.getpid())
        self._set_pid(run_id, parent)
        self.assertTrue(store._process_alive(parent))

        self.assertEqual(store.reconcile_stale_runs(self.conn), 0)
        self.assertEqual(self._status(run_id)[0], "running")

    def test_already_finished_rows_are_not_touched(self):
        run_id = store.start_run(self.conn, 5)
        store.finish_run(self.conn, run_id, status="done")
        self._set_pid(run_id, DEAD_PID)

        self.assertEqual(store.reconcile_stale_runs(self.conn), 0)
        self.assertEqual(self._status(run_id)[0], "done")

    def test_reconciling_an_empty_table_does_nothing(self):
        self.assertEqual(store.reconcile_stale_runs(self.conn), 0)

    # ---- the pragma that stops two writers from killing each other -----

    def test_connections_wait_for_a_busy_database(self):
        """Without this, a second writer fails immediately with "database is
        locked" — which is what killed a run that the app's background pull
        happened to start against in the same second."""
        timeout = self.conn.execute("PRAGMA busy_timeout").fetchone()[0]
        self.assertEqual(timeout, store.BUSY_TIMEOUT_MS)
        self.assertGreater(timeout, 0)


if __name__ == "__main__":
    unittest.main()
