"""Parallel search and the stop flag (ported from the old test_parallel). No network, no database:
the workers run plain functions."""

import threading
import time
from collections.abc import Iterator

import pytest

from gratovo_pipeline import parallel, run_control


@pytest.fixture(autouse=True)
def clear_stop() -> Iterator[None]:
    run_control.clear_stop()
    yield
    run_control.clear_stop()


# --- worker_count ---


def test_one_worker_unless_parallel_is_on() -> None:
    assert parallel.worker_count(enabled=False, max_workers=4, rotating_connections=5) == 1


def test_one_worker_per_rotating_connection() -> None:
    assert parallel.worker_count(enabled=True, max_workers=4, rotating_connections=0) == 1
    assert parallel.worker_count(enabled=True, max_workers=4, rotating_connections=1) == 1
    assert parallel.worker_count(enabled=True, max_workers=4, rotating_connections=3) == 3


def test_capped_by_max_workers_and_the_hard_limit() -> None:
    assert parallel.worker_count(enabled=True, max_workers=2, rotating_connections=5) == 2
    assert (
        parallel.worker_count(enabled=True, max_workers=99, rotating_connections=50)
        == parallel.MAX_WORKERS
    )


# --- run_control ---


def test_sleep_ends_early_on_stop() -> None:
    threading.Timer(0.05, run_control.request_stop).start()
    started = time.monotonic()
    with pytest.raises(run_control.RunAborted):
        run_control.sleep(30)
    assert time.monotonic() - started < 2


def test_a_stopped_run_is_a_keyboard_interrupt() -> None:
    # Everything above the workers treats KeyboardInterrupt as "stopped: keep what is saved".
    assert issubclass(run_control.RunAborted, KeyboardInterrupt)


def test_check_stop_raises_only_after_a_stop() -> None:
    run_control.check_stop()
    run_control.request_stop()
    with pytest.raises(run_control.RunAborted):
        run_control.check_stop()


# --- run_keywords ---


def nothing(_position: int, _keyword: str) -> None:
    """An on_done that does nothing."""


class Conn:
    def __init__(self) -> None:
        self.closed = False
        self.thread = threading.current_thread()

    def close(self) -> None:
        self.closed = True


def test_every_keyword_once_on_its_own_connection_in_parallel() -> None:
    conns: list[Conn] = []
    lock = threading.Lock()

    def connect() -> Conn:
        conn = Conn()
        with lock:
            conns.append(conn)
        return conn

    # All three workers must be inside `work` at once, or the barrier times out.
    barrier = threading.Barrier(3, timeout=5)
    worked: list[str] = []
    done_on: list[tuple[str, threading.Thread]] = []

    def work(conn: Conn, position: int, keyword: str) -> None:
        assert conn.thread is threading.current_thread()
        assert run_control.current_worker() is not None
        if position <= 3:
            barrier.wait()
        with lock:
            worked.append(keyword)

    def on_done(_position: int, keyword: str) -> None:
        done_on.append((keyword, threading.current_thread()))

    items = [(i, f"kw{i}") for i in range(1, 10)]
    finished = parallel.run_keywords(items, 3, work, on_done, connect=connect)

    assert finished == 9
    assert sorted(worked) == sorted(k for _, k in items)
    assert len(conns) == 3
    assert all(c.closed for c in conns)
    assert {t for _, t in done_on} == {threading.main_thread()}
    assert sorted(k for k, _ in done_on) == sorted(worked)


def test_a_failure_stops_the_others_and_is_what_is_raised() -> None:
    class BlockedError(RuntimeError):
        pass

    started: list[str] = []
    lock = threading.Lock()

    def work(_conn: Conn, _position: int, keyword: str) -> None:
        with lock:
            started.append(keyword)
        if keyword == "kw2":
            raise BlockedError("youtube stopped answering")
        for _ in range(100):
            run_control.sleep(0.01)

    items = [(i, f"kw{i}") for i in range(1, 40)]
    with pytest.raises(BlockedError):
        parallel.run_keywords(items, 3, work, nothing, connect=Conn)
    assert len(started) < 10


def test_a_single_worker_runs_in_order() -> None:
    order: list[str] = []
    parallel.run_keywords(
        [(1, "a"), (2, "b"), (3, "c")],
        1,
        lambda _conn, _p, k: order.append(k),
        nothing,
        connect=Conn,
    )
    assert order == ["a", "b", "c"]


def test_a_stop_ends_the_run_between_keywords() -> None:
    order: list[str] = []

    def work(_conn: Conn, _position: int, keyword: str) -> None:
        order.append(keyword)
        run_control.request_stop()

    finished = parallel.run_keywords([(1, "a"), (2, "b")], 1, work, nothing, connect=Conn)
    assert order == ["a"]
    assert finished == 1
