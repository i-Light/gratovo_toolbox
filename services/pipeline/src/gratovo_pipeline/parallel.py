"""Parallel search: several keywords at once, one worker per rotating connection.

Off unless the app turns it on AND the run has at least two connections other than this machine's
own (AWS gateways and proxies). With one or none there is nothing to spread the work over: two
workers would take turns on one address, a sequential run with extra overhead.

What keeps it safe is the proxy pool (`scrapetube/proxy_pool.py`): every request, whichever worker
makes it, goes through the same pool, so a gateway serves one request at a time, is never used
twice in a row, and keeps its minimum gap. Workers never outnumber the rotating connections.

Pacing is Normal whenever more than one worker runs (`config.Config.pacing`). Each worker has its
own SQLite connection, since a connection belongs to the thread that made it. Lines to the app
stay whole without help here: the Emitter writes each message under a lock.
"""

from __future__ import annotations

import queue
import threading
from collections.abc import Callable, Iterable
from typing import Literal, Protocol

from gratovo_pipeline import run_control

DEFAULT_MAX_WORKERS = 4
MAX_WORKERS = 8


def worker_count(*, enabled: bool, max_workers: int, rotating_connections: int) -> int:
    """How many keywords a run works at once: 1 unless parallel search is on, then one per
    rotating connection, capped by max_workers and MAX_WORKERS."""
    if not enabled:
        return 1
    cap = max(1, min(MAX_WORKERS, max_workers))
    return max(1, min(cap, rotating_connections))


class Closeable(Protocol):
    def close(self) -> None: ...


type _Result = tuple[Literal["done", "failed"], int, str, BaseException | None]


def run_keywords[C: Closeable](
    items: Iterable[tuple[int, str]],
    workers: int,
    work: Callable[[C, int, str], None],
    on_done: Callable[[int, str], None],
    *,
    connect: Callable[[], C],
) -> int:
    """Works `items`, `(position, keyword)` pairs in hand-out order, on `workers` threads.

    `work(conn, position, keyword)` runs on a worker with that worker's own connection from
    `connect`. `on_done(position, keyword)` runs on the calling thread after each keyword, in the
    order they finish. The first failure on any worker stops the others at their next wait or
    keyword and is raised here once they have all come back; a KeyboardInterrupt here does the
    same. Returns how many keywords finished.
    """
    todo: queue.Queue[tuple[int, str]] = queue.Queue()
    for item in items:
        todo.put(item)
    results: queue.Queue[_Result] = queue.Queue()

    def worker(number: int) -> None:
        run_control.set_worker(number)
        conn = connect()
        try:
            while not run_control.stop_requested():
                try:
                    position, keyword = todo.get_nowait()
                except queue.Empty:
                    return
                try:
                    work(conn, position, keyword)
                except BaseException as exc:
                    results.put(("failed", position, keyword, exc))
                    run_control.request_stop()
                    return
                results.put(("done", position, keyword, None))
        finally:
            try:
                conn.close()
            finally:
                run_control.set_worker(None)

    threads = [
        threading.Thread(target=worker, args=(n,), name=f"search-worker-{n}", daemon=True)
        for n in range(1, workers + 1)
    ]
    for thread in threads:
        thread.start()

    done = 0
    failure: BaseException | None = None
    try:
        while any(t.is_alive() for t in threads) or not results.empty():
            try:
                kind, position, keyword, exc = results.get(timeout=0.5)
            except queue.Empty:
                continue
            if kind == "done":
                done += 1
                on_done(position, keyword)
            elif failure is None or (
                isinstance(failure, run_control.RunAborted)
                and not isinstance(exc, run_control.RunAborted)
            ):
                # The failure that started the wind-down, not the RunAborted the others raise.
                failure = exc
    except BaseException:
        run_control.request_stop()
        for thread in threads:
            thread.join()
        raise
    for thread in threads:
        thread.join()
    if failure is not None:
        raise failure
    return done
