"""What every wait during a run agrees on: has somebody said stop, and which worker am I?

With parallel search a run is several threads, and Python delivers a KeyboardInterrupt only to the
main one, so a worker asleep in a pacing delay would carry on for minutes after Stop. Every place
that waits (`sleep` here, the scraper's backoff, the proxy pool) checks one shared event instead,
and a worker that sees it set raises RunAborted.

The stop arrives as a `stop` line on stdin (`protocol.listen_for_stop`). Nothing here touches the
network or the database, so every other module may import it.
"""

from __future__ import annotations

import threading
import time

# How long a sleep runs before it looks at the stop event again: Stop feels immediate, and a run
# parked in a two-minute pacing break isn't waking up dozens of times a second.
STOP_TICK = 0.5

_STOP = threading.Event()
_LOCAL = threading.local()


class RunAborted(KeyboardInterrupt):
    """The run is winding down: somebody pressed Stop, or another worker hit something fatal and
    the rest must not carry on making requests behind it.

    A KeyboardInterrupt on purpose: everything above the workers treats that as "stopped, keep
    what is committed", so a stop from a worker and one from the app land in the same place."""


def request_stop() -> None:
    _STOP.set()


def clear_stop() -> None:
    _STOP.clear()


def stop_requested() -> bool:
    return _STOP.is_set()


def check_stop() -> None:
    if _STOP.is_set():
        raise RunAborted("the run was stopped")


def set_worker(worker_id: int | None) -> None:
    """Names the calling thread as worker `worker_id` (1-based), or None for none."""
    _LOCAL.worker = worker_id


def current_worker() -> int | None:
    worker: int | None = getattr(_LOCAL, "worker", None)
    return worker


def sleep(seconds: float) -> None:
    """`time.sleep` that a stop cuts short (by raising RunAborted)."""
    end = time.monotonic() + max(0.0, seconds)
    while True:
        check_stop()
        remaining = end - time.monotonic()
        if remaining <= 0:
            return
        time.sleep(min(remaining, STOP_TICK))
