"""Parallel search: several keywords at once, one worker per rotating connection.

Off unless the app turns it on AND the run has at least two connections other than this machine's
own (AWS gateways and proxies). With one or none there is nothing to spread the work over: two
workers would take turns on one address, a sequential run with extra overhead.

What keeps it safe is the proxy pool (`scrapetube/proxy_pool.py`): every request, whichever worker
makes it, goes through the same pool, so a gateway serves one request at a time, is never used
twice in a row, and keeps its minimum gap. Workers never outnumber the rotating connections.

Pacing is Normal unless the app sends Fast (`config.Config.pacing`). Each worker has its
own SQLite connection, since a connection belongs to the thread that made it. Lines to the app
stay whole without help here: the Emitter writes each message under a lock.

Only a fatal exception stops the other workers (`is_fatal`): a stop, a missing YouTube key, the
quota, or anything that is not a scraper error (a bug). A scraper error that escaped a worker
costs that keyword only: it is reported to `on_failed` and the worker takes the next keyword.
"""

from __future__ import annotations

import queue
import threading
from collections.abc import Callable, Iterable
from typing import Literal, Protocol

from gratovo_pipeline import run_control
from gratovo_pipeline.scrapetube.scrapetube import ScrapetubeError
from gratovo_pipeline.youtube import YouTubeError

DEFAULT_MAX_WORKERS = 4
MAX_WORKERS = 8


def worker_count(*, enabled: bool, max_workers: int, rotating_connections: int) -> int:
    """How many keywords a run works at once: 1 unless parallel search is on, then one per
    rotating connection, capped by max_workers and MAX_WORKERS."""
    if not enabled:
        return 1
    cap = max(1, min(MAX_WORKERS, max_workers))
    return max(1, min(cap, rotating_connections))


def is_fatal(error: BaseException, *, quota_fatal: bool = True) -> bool:
    """True when the other workers must stop too: a stop, a missing key, the quota (unless
    `quota_fatal` is off: continuous mode waits for the reset inside the API client), and
    anything that is not a scraper error (a bug). Only a scraper error that escaped a worker is
    not fatal."""
    if isinstance(error, run_control.RunAborted):
        return True
    if isinstance(error, YouTubeError) and error.code == "quota":
        return quota_fatal
    return not isinstance(error, ScrapetubeError)


class Closeable(Protocol):
    def close(self) -> None: ...


type _Result = tuple[Literal["done", "failed", "skipped"], int, str, BaseException | None]


def run_keywords[C: Closeable](
    items: Iterable[tuple[int, str]],
    workers: int,
    work: Callable[[C, int, str], None],
    on_done: Callable[[int, str], None],
    *,
    connect: Callable[[], C],
    on_failed: Callable[[int, str, BaseException], None] | None = None,
    quota_fatal: bool = True,
) -> int:
    """Works `items`, `(position, keyword)` pairs in hand-out order, on `workers` threads.

    `work(conn, position, keyword)` runs on a worker with that worker's own connection from
    `connect`. `on_done(position, keyword)` runs on the calling thread after each keyword, in the
    order they finish. The first fatal failure on any worker stops the others at their next wait or
    keyword and is raised here once they have all come back; a KeyboardInterrupt here does the
    same. A non-fatal one (see `is_fatal`) goes to `on_failed(position, keyword, error)` on the
    calling thread and the worker carries on. Returns how many keywords finished.
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
                    if not is_fatal(exc, quota_fatal=quota_fatal):
                        results.put(("skipped", position, keyword, exc))
                        continue
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
            elif kind == "skipped":
                if on_failed is not None and exc is not None:
                    on_failed(position, keyword, exc)
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
