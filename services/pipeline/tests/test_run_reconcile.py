"""Closing run rows whose process is gone (ported from the old test_run_reconcile), and the store's
schema version.

Only finish_run moves a row off `running`, inside the process. A killed run (the app closed, the
machine shut down) leaves its row running forever unless the next start closes it. The other half
matters as much: a row whose process is alive must be left alone.
"""

import os
import sqlite3
from pathlib import Path

import pytest

from gratovo_pipeline import store

# A pid nothing uses: Windows and Linux both cap pids far below this.
DEAD_PID = 4_000_000_000


def status(conn: sqlite3.Connection, run_id: int) -> tuple[str, str | None]:
    row = conn.execute("SELECT status, finished_at FROM runs WHERE run_id=?", (run_id,)).fetchone()
    return row["status"], row["finished_at"]


def set_pid(conn: sqlite3.Connection, run_id: int, pid: int | None) -> None:
    conn.execute("UPDATE runs SET pid=? WHERE run_id=?", (pid, run_id))
    conn.commit()


def test_a_row_from_a_dead_process_is_marked_interrupted(conn: sqlite3.Connection) -> None:
    run_id = store.start_run(conn, 5)
    set_pid(conn, run_id, DEAD_PID)
    assert store.reconcile_stale_runs(conn) == 1
    state, finished_at = status(conn, run_id)
    assert state == "interrupted"
    assert finished_at is not None


def test_a_row_without_a_pid_is_treated_as_stale(conn: sqlite3.Connection) -> None:
    run_id = store.start_run(conn, 5)
    set_pid(conn, run_id, None)
    assert store.reconcile_stale_runs(conn) == 1
    assert status(conn, run_id)[0] == "interrupted"


def test_several_stale_rows_are_all_closed(conn: sqlite3.Connection) -> None:
    ids = [store.start_run(conn, 1) for _ in range(3)]
    for run_id in ids:
        set_pid(conn, run_id, DEAD_PID)
    assert store.reconcile_stale_runs(conn) == 3
    assert all(status(conn, run_id)[0] == "interrupted" for run_id in ids)


def test_this_process_s_own_run_is_left_running(conn: sqlite3.Connection) -> None:
    run_id = store.start_run(conn, 5)
    assert (
        conn.execute("SELECT pid FROM runs WHERE run_id=?", (run_id,)).fetchone()["pid"]
        == os.getpid()
    )
    assert store.reconcile_stale_runs(conn) == 0
    assert status(conn, run_id)[0] == "running"


def test_a_run_in_another_live_process_is_left_running(conn: sqlite3.Connection) -> None:
    # The parent process is alive by definition (it is waiting on this one) and isn't our pid,
    # so this exercises the liveness check, not the own-pid shortcut.
    run_id = store.start_run(conn, 5)
    parent = os.getppid()
    assert parent != os.getpid()
    set_pid(conn, run_id, parent)
    assert store._process_alive(parent)  # pyright: ignore[reportPrivateUsage]
    assert store.reconcile_stale_runs(conn) == 0
    assert status(conn, run_id)[0] == "running"


def test_already_finished_rows_are_not_touched(conn: sqlite3.Connection) -> None:
    run_id = store.start_run(conn, 5)
    store.finish_run(conn, run_id, status="done")
    set_pid(conn, run_id, DEAD_PID)
    assert store.reconcile_stale_runs(conn) == 0
    assert status(conn, run_id)[0] == "done"


def test_reconciling_an_empty_table_does_nothing(conn: sqlite3.Connection) -> None:
    assert store.reconcile_stale_runs(conn) == 0


def test_connections_wait_for_a_busy_database(conn: sqlite3.Connection) -> None:
    # Without it a second writer fails at once with "database is locked".
    assert conn.execute("PRAGMA busy_timeout").fetchone()[0] == store.BUSY_TIMEOUT_MS


def test_the_store_runs_in_wal_mode(conn: sqlite3.Connection) -> None:
    # So the app can read the file while a run writes it.
    assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"


def test_the_schema_carries_its_version_and_opening_twice_is_harmless(tmp_path: Path) -> None:
    path = tmp_path / "pipeline.db"
    for _ in range(2):
        connection = store.get_connection(path)
        store.init_db(connection)
        assert connection.execute("PRAGMA user_version").fetchone()[0] == store.SCHEMA_VERSION
        connection.close()


def test_a_newer_file_is_refused_rather_than_damaged(tmp_path: Path) -> None:
    path = tmp_path / "pipeline.db"
    connection = store.get_connection(path)
    connection.execute(f"PRAGMA user_version={store.SCHEMA_VERSION + 1}")
    with pytest.raises(store.SchemaTooNewError):
        store.init_db(connection)
    connection.close()
