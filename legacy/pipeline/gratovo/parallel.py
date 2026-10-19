"""Parallel search: several keywords at once, one worker per rotating
connection.

Off unless `data/settings.json` says `"parallel_search": {"enabled": true}` AND
the run has at least two connections other than this machine's own (AWS
gateways and/or proxies). With one, or none, there is nothing to spread the
work over: two workers would take turns on the same address, which is a
sequential run with extra overhead.

What keeps it safe is the proxy pool, not this module (`proxy_pool.py`): every
request, whichever worker makes it, goes through the same pool, so the
rotation rules hold across workers -- a gateway serves one request at a time,
is never used twice in a row, and keeps its minimum gap. Workers therefore
never exceed the number of rotating connections: a third worker on two
gateways would only ever wait.

Pacing is the Normal profile whenever more than one worker runs (see
`config.Config.pacing_profile`). Fast pacing is safe on one worker because its
requests are spread across several addresses; several workers spread over the
same addresses put each one back at roughly one worker's worth of traffic, so
each worker keeps the gentler beat.

Each worker has its own SQLite connection (a connection belongs to the thread
that made it) and its own YouTube API client (`pipeline._youtube`). What the
team sees -- sharing to the bucket after each keyword -- stays on the calling
thread, in [run_keywords]'s `on_done`.
"""

from __future__ import annotations

import queue
import threading

from gratovo import run_control

DEFAULT_MAX_WORKERS = 4
MAX_WORKERS = 8


def worker_count(parallel_setting, rotating_connections: int) -> int:
    """How many keywords this run works at once: 1 unless parallel search is
    on, then one per rotating connection, capped by `max_workers`."""
    if not isinstance(parallel_setting, dict) or not parallel_setting.get("enabled"):
        return 1
    cap = parallel_setting.get("max_workers", DEFAULT_MAX_WORKERS)
    if isinstance(cap, bool) or not isinstance(cap, (int, float)):
        cap = DEFAULT_MAX_WORKERS
    cap = max(1, min(MAX_WORKERS, int(cap)))
    return max(1, min(cap, int(rotating_connections or 0)))


class LineWriter:
    """Makes every line written to the wrapped stream arrive whole.

    `print` writes its text and its newline as two separate writes, so two
    threads printing at once can produce `[step] a[step] b\\n\\n` -- and the app
    parses stdout line by line (`search_progress_parser.dart`), where a glued
    line is a lost progress event. Each thread's text is held until it
    completes a line, and whole lines are written under one lock.
    """

    def __init__(self, stream):
        self._stream = stream
        self._lock = threading.Lock()
        self._local = threading.local()

    def write(self, text):
        pending = getattr(self._local, "pending", "") + text
        head, sep, rest = pending.rpartition("\n")
        self._local.pending = rest
        if sep:
            with self._lock:
                self._stream.write(head + sep)
        return len(text)

    def flush(self):
        with self._lock:
            self._stream.flush()

    def drain(self):
        """Writes whatever the calling thread left without a newline."""
        pending = getattr(self._local, "pending", "")
        if pending:
            self._local.pending = ""
            with self._lock:
                self._stream.write(pending + "\n")
                self._stream.flush()

    def __getattr__(self, name):
        return getattr(self._stream, name)


def run_keywords(items, workers, work, on_done, *, connect, writer=None):
    """Works [items] -- `(position, keyword)` pairs, in order of hand-out -- on
    [workers] threads.

    [work] `(conn, position, keyword)` runs on a worker with that worker's own
    connection from [connect]. [on_done] `(position, keyword)` runs on the
    calling thread after each keyword finishes, in the order they finish.

    The first failure on any worker (a `SearchBlocked`, a crash) stops the
    others at their next wait or keyword boundary and is raised here once
    they have all come back; a `KeyboardInterrupt` here does the same. Returns
    the number of keywords finished.
    """
    todo = queue.Queue()
    for item in items:
        todo.put(item)
    results = queue.Queue()

    def worker(number):
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
                except BaseException as exc:  # noqa: BLE001 - reported to the caller
                    results.put(("failed", position, keyword, exc))
                    run_control.request_stop()
                    return
                results.put(("done", position, keyword, None))
        finally:
            try:
                conn.close()
            finally:
                if writer is not None:
                    writer.drain()
                run_control.set_worker(None)

    threads = [
        threading.Thread(target=worker, args=(n,), name="search-worker-{}".format(n),
                         daemon=True)
        for n in range(1, workers + 1)
    ]
    for thread in threads:
        thread.start()

    done = 0
    failure = None
    try:
        while any(t.is_alive() for t in threads) or not results.empty():
            try:
                kind, position, keyword, exc = results.get(timeout=0.5)
            except queue.Empty:
                continue
            if kind == "done":
                done += 1
                on_done(position, keyword)
            elif failure is None or (isinstance(failure, run_control.RunAborted)
                                     and not isinstance(exc, run_control.RunAborted)):
                # The failure that started the wind-down, not the RunAborted
                # the other workers raise because of it.
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
