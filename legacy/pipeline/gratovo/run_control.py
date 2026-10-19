"""What every wait during a run has to agree on: has somebody said stop, and
which worker am I?

A run used to be one thread, and "stop" was a `KeyboardInterrupt` landing in
whatever that thread happened to be doing. With parallel search a run is
several threads, and Python only ever delivers a `KeyboardInterrupt` to the
main one -- a worker asleep in a pacing delay or in `_request`'s backoff would
carry on for minutes after the run was told to end. So every place that waits
(`sleep` here, `_interruptible_wait` and the proxy pool's waits in scrapetube)
checks one shared event, and a worker that sees it set raises [RunAborted].

[RunAborted] is a `KeyboardInterrupt` on purpose: everything above the workers
already treats that as "the run was stopped, commit what is committed and go",
so a stop that started in a worker and one that started at the keyboard land in
the same place.

Nothing here touches the network or the database, which is what lets
`proxy_pool.py`, `scrapetube.py` and `pipeline.py` all import it.
"""

from __future__ import annotations

import threading
import time

# How long a sleep runs before it looks at the stop event again. Short enough
# that Stop feels immediate, long enough that a run parked in a two-minute
# pacing break is not waking up dozens of times a second.
STOP_TICK = 0.5

_STOP = threading.Event()
_LOCAL = threading.local()


class RunAborted(KeyboardInterrupt):
    """The run is being wound down -- somebody pressed Stop, or another worker
    hit something fatal (`SearchBlocked`) and the rest must not carry on making
    requests behind it."""


def request_stop() -> None:
    _STOP.set()


def clear_stop() -> None:
    _STOP.clear()


def stop_requested() -> bool:
    return _STOP.is_set()


def check_stop() -> None:
    if _STOP.is_set():
        raise RunAborted("the run was stopped")


def set_worker(worker_id) -> None:
    """Names the calling thread as worker [worker_id] (1-based), or None to go
    back to being anonymous. What `parallel.WorkerLines` reads to tag a line."""
    _LOCAL.worker = worker_id


def current_worker():
    return getattr(_LOCAL, "worker", None)


def sleep(seconds: float) -> None:
    """`time.sleep` that a stop can cut short.

    In the main thread a `KeyboardInterrupt` still interrupts the underlying
    sleep the way it always did; the event is for the threads that never
    receive one.
    """
    end = time.monotonic() + max(0.0, float(seconds or 0.0))
    while True:
        check_stop()
        remaining = end - time.monotonic()
        if remaining <= 0:
            return
        time.sleep(min(remaining, STOP_TICK))
