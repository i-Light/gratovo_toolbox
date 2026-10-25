"""The owner's Gemini pacing, kept on disk so a restart cannot cut it short (plan D6a).

The breaker (`pause.py`) and the send gap (`client.SendGap`) run on the monotonic clock, which
starts again with every process. Without this file a crash, or a person's Stop then Start in
Settings, would clear a 30-minute pause and the 60 s gap, and prompts could go again at once. So
the bridge writes, each time one of them changes:

  * `pausedUntil`: when the breaker's pause ends;
  * `lastSend`: when the last prompt was sent;
  * `pageErrors`: the page errors counted in the last 15 minutes (the third pauses). They are kept
    too, so stopping the bridge after two errors does not wipe the count the third would trip.

All three are UTC wall-clock times (ISO 8601), the only clock that survives a restart. The file is
read once, when the bridge starts, and turned back into time left on the monotonic clock:

  * a missing or malformed file, or a malformed field, reads as nothing saved: no pause, no
    previous send, no page errors;
  * a pause that would end further away than the longest pause (the computer's clock moved back)
    is clamped to the longest pause;
  * a send or a page error in the future (the same) counts as just now: the full gap is waited
    out, and the error stays in the window for its full 15 minutes.

The file sits in the managed browser profile's folder (`--profile-dir`), not the data source's
pipeline folder: the pause belongs to the Gemini account signed in there, the profile is the same
whichever data source is open, and `--data-dir` may be missing. Written atomically (a temporary
file, then a replace), so a crash mid-write leaves the previous file whole. A write that fails is
logged and the bridge carries on: the in-memory rule still holds for this process.
"""

from __future__ import annotations

import contextlib
import json
import logging
import os
import tempfile
import threading
from collections.abc import Callable, Iterable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

#: The file's name in the browser profile's folder.
PACING_FILE = "gemini-pacing.json"
VERSION = 1


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _parse(value: object) -> datetime | None:
    """An ISO 8601 time with its zone, or None for anything else."""
    if not isinstance(value, str):
        return None
    try:
        moment = datetime.fromisoformat(value)
    except ValueError:
        return None
    if moment.tzinfo is None:
        return None
    return moment.astimezone(UTC)


def _format(moment: datetime) -> str:
    return moment.astimezone(UTC).isoformat()


class PacingStore:
    """The saved pacing state of one bridge: read at start, rewritten on every change.

    `now` (UTC) is injectable so the tests can restart a bridge at any moment they like.
    Thread-safe: the send gap and the breaker write from the daemon's worker threads.
    """

    def __init__(self, path: Path, *, now: Callable[[], datetime] = _utc_now) -> None:
        self.path = Path(path)
        self._now = now
        self._lock = threading.Lock()
        self._paused_until: datetime | None = None
        self._last_send: datetime | None = None
        self._page_errors: list[datetime] = []
        self._load()

    # --- reading, once at start ----------------------------------------------

    def _load(self) -> None:
        try:
            parsed: object = json.loads(self.path.read_text(encoding="utf-8"))
        except OSError, ValueError:
            return
        if not isinstance(parsed, dict):
            return
        saved: dict[str, Any] = parsed  # pyright: ignore[reportUnknownVariableType]
        self._paused_until = _parse(saved.get("pausedUntil"))
        self._last_send = _parse(saved.get("lastSend"))
        errors: object = saved.get("pageErrors")
        if isinstance(errors, list):
            listed: list[object] = errors  # pyright: ignore[reportUnknownVariableType]
            self._page_errors = [m for m in (_parse(e) for e in listed) if m is not None]

    def pause_left(self, max_s: float) -> float:
        """Seconds left of the saved pause, at most `max_s`; 0 when there is none."""
        with self._lock:
            if self._paused_until is None:
                return 0.0
            left = (self._paused_until - self._now()).total_seconds()
        return min(max(left, 0.0), max_s)

    def since_last_send(self) -> float | None:
        """Seconds since the saved last send (a send in the future counts as now), or None."""
        with self._lock:
            if self._last_send is None:
                return None
            since = (self._now() - self._last_send).total_seconds()
        return max(since, 0.0)

    def page_error_ages(self, window_s: float) -> list[float]:
        """How long ago each saved page error was, oldest first, keeping those within
        `window_s` (one in the future counts as now)."""
        with self._lock:
            now = self._now()
            ages = [max((now - moment).total_seconds(), 0.0) for moment in self._page_errors]
        return sorted((age for age in ages if age <= window_s), reverse=True)

    # --- writing, on every change --------------------------------------------

    def save_pause(self, seconds: float, error_ages: Iterable[float] = ()) -> None:
        """The breaker tripped: a pause of `seconds` from now. `error_ages` are the page errors
        still counted (none after a trip)."""
        with self._lock:
            now = self._now()
            self._paused_until = now + timedelta(seconds=seconds)
            self._page_errors = [now - timedelta(seconds=age) for age in error_ages]
            self._write()

    def save_page_errors(self, error_ages: Iterable[float]) -> None:
        """The page errors counted in the window, as seconds ago."""
        with self._lock:
            now = self._now()
            self._page_errors = [now - timedelta(seconds=age) for age in error_ages]
            self._write()

    def save_send(self) -> None:
        """A prompt was sent just now."""
        with self._lock:
            self._last_send = self._now()
            self._write()

    def _write(self) -> None:
        # Called with the lock held.
        state = {
            "version": VERSION,
            "pausedUntil": _format(self._paused_until) if self._paused_until else None,
            "lastSend": _format(self._last_send) if self._last_send else None,
            "pageErrors": [_format(moment) for moment in self._page_errors],
        }
        temp: Path | None = None
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            handle, name = tempfile.mkstemp(
                prefix=self.path.name + ".", suffix=".tmp", dir=self.path.parent
            )
            temp = Path(name)
            with os.fdopen(handle, "w", encoding="utf-8") as out:
                json.dump(state, out)
                out.flush()
                os.fsync(out.fileno())
            temp.replace(self.path)
            temp = None
        except OSError as error:
            log.warning("could not save the Gemini pacing state to %s: %s", self.path, error)
        finally:
            if temp is not None:
                with contextlib.suppress(OSError):
                    temp.unlink()
