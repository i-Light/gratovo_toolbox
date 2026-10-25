"""The breaker: the owner's rule that a refusal, or three page errors in 15 minutes, pause Gemini.

The rule (docs/product/owner-rules.md, "Gemini"; plan D6a): a refusal toast, or three generic errors
in 15 minutes, means pause for 30 minutes or more. Drafting runs unattended, so the bridge enforces
it itself rather than trusting every caller to: while the breaker is open, every method that sends
a prompt fails at once with `PAUSED` (`details.until`, ISO 8601 UTC), and nothing reaches the page.
The methods that only look at the page or the browser (`bridge.status`, `action.comms_check`, the
skills list, ...) keep working, so the app can still show what is going on.

What trips it:

  * a refusal: `ActionRefused`, a page error the add-on marks `refused` (the toast it sees when a
    prompt is put back in the box), or an answer that is only Gemini's refusal text (`REFUSAL`);
  * the third page error within `WINDOW_S`: a `GeminiPageError`, or an answer that is only the
    page's generic error (`GENERIC_ERROR`, "something went wrong"). Older ones age out.

One breaker per bridge process, held by the `Gemini` client: the client counts what it sees on
every send, and the daemon counts what an action raises without passing through a send (the
engine reads a "something went wrong" answer as a page error itself).

The daemon gives it a `PacingStore` (`pacing_state.py`): the pause's end and the page errors in
the window are saved on every change and read back at start, so a crash or a Stop then Start in
Settings neither ends a pause early nor forgets the errors that count towards the next one.
"""

from __future__ import annotations

import re
import threading
import time
from collections import deque
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

from .errors import ActionRefused, GeminiError, GeminiPageError, Paused
from .pacing_state import PacingStore

#: The owner's numbers: three page errors within 15 minutes, or one refusal, pause for 30 minutes.
WINDOW_S = 15 * 60.0
PAUSE_S = 30 * 60.0
ERRORS_TO_TRIP = 3

#: Gemini refusing the prompt, given as the whole answer. An answer this short that matches is the
#: page balking at the prompt, not an answer (`actions._ask` raises `ActionRefused` on it). A
#: refusal pauses at once.
REFUSAL = re.compile(
    r"having a hard time fulfilling|can.?t help with that|unable to (help|assist) with that",
    re.I,
)
REFUSAL_MAX_LENGTH = 400

#: The page's generic error, given as the whole answer (2026-10-16: "Sorry, something went wrong";
#: the Arabic page says "حدث خطأ"). It is not a refusal: it counts as one of the three page errors
#: in 15 minutes, as the owner's rule says.
GENERIC_ERROR = re.compile(
    r"something went wrong|try again later|an error occurred|حدث خطأ",
    re.I,
)
GENERIC_ERROR_MAX_LENGTH = 300

#: Every method that sends a prompt to the Gemini page, in one place. The breaker holds these
#: back; every other method (the bridge's status, browser and add-on methods, `ensure_account`,
#: `heal`, `open_gem`, `wait`, the gem and skill pages, `comms_check`, and the extension's
#: read-only methods) never sends a prompt and works while the breaker is open. `send` and
#: `queue_add` are the extension's own two ways in; the rest reach them through the client.
PROMPT_METHODS: frozenset[str] = frozenset(
    {
        "send",
        "queue_add",
        "bridge.ask",
        "action.generate_keywords",
        "action.classify_channel",
        "action.comms_propose",
    }
)


def sends_prompt(method: str) -> bool:
    """Whether `method` sends a prompt to the Gemini page (and so waits out a pause)."""
    return method in PROMPT_METHODS


def is_refusal(answer: str) -> bool:
    """Whether an answer is only Gemini's refusal text."""
    text = answer.strip()
    return len(text) < REFUSAL_MAX_LENGTH and REFUSAL.search(text) is not None


def is_generic_error(answer: str) -> bool:
    """Whether an answer is only the page's generic error (and not a refusal)."""
    text = answer.strip()
    return (
        len(text) < GENERIC_ERROR_MAX_LENGTH
        and GENERIC_ERROR.search(text) is not None
        and not is_refusal(text)
    )


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _iso(moment: datetime) -> str:
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


class Breaker:
    """Counts refusals and page errors; while open, `check()` raises `Paused`.

    Time runs on `clock` (monotonic seconds), so a change to the computer's clock cannot shorten a
    pause; `now` (UTC) only turns the end of a pause into the ISO time the app shows. Both are
    injectable so the tests run without waiting. Thread-safe: the daemon runs requests on a pool.

    With a `store`, a pause and the page errors saved by an earlier bridge process carry on here
    (what is left of them, by the wall clock), and every change is saved for the next one.
    """

    def __init__(
        self,
        *,
        clock: Callable[[], float] = time.monotonic,
        now: Callable[[], datetime] = _utc_now,
        window_s: float = WINDOW_S,
        pause_s: float = PAUSE_S,
        errors_to_trip: int = ERRORS_TO_TRIP,
        store: PacingStore | None = None,
    ) -> None:
        self._clock = clock
        self._now = now
        self._window_s = window_s
        self._pause_s = pause_s
        self._errors_to_trip = errors_to_trip
        self._lock = threading.Lock()
        self._errors: deque[float] = deque()
        self._until: float | None = None
        self._until_iso: str | None = None
        #: How many refusals and page errors have been counted so far. The daemon compares it
        #: before and after a call, so an error the client already counted is not counted twice.
        self.recorded = 0
        self._store = store
        if store is not None:
            started = clock()
            left = store.pause_left(pause_s)
            if left > 0:
                self._until = started + left
                self._until_iso = _iso(now() + timedelta(seconds=left))
            for age in store.page_error_ages(window_s):
                self._errors.append(started - age)

    # --- reading -------------------------------------------------------------

    def paused_until(self) -> str | None:
        """When the pause ends (ISO 8601 UTC), or None when prompts may be sent."""
        with self._lock:
            return self._open_until()

    def check(self) -> None:
        """Raises `Paused` while the breaker is open; returns at once otherwise."""
        with self._lock:
            until = self._open_until()
        if until is not None:
            raise Paused(
                message=f"Gemini is paused until {until} after a refusal or repeated page errors",
                details={"until": until},
            )

    def _open_until(self) -> str | None:
        # Called with the lock held. A pause that has run out closes here, and the page errors
        # that tripped it are gone with it.
        if self._until is None:
            return None
        if self._clock() >= self._until:
            self._until = None
            self._until_iso = None
            return None
        return self._until_iso

    # --- counting ------------------------------------------------------------

    def refusal(self) -> None:
        """Gemini refused: pause at once."""
        with self._lock:
            self.recorded += 1
            self._trip()

    def page_error(self) -> None:
        """The page showed an error: the third within the window pauses."""
        with self._lock:
            self.recorded += 1
            moment = self._clock()
            self._errors.append(moment)
            while self._errors and moment - self._errors[0] > self._window_s:
                self._errors.popleft()
            if len(self._errors) >= self._errors_to_trip:
                self._trip()
            elif self._store is not None:
                self._store.save_page_errors(moment - t for t in self._errors)

    def note(self, error: BaseException) -> None:
        """Counts `error` when it is a refusal or a page error; anything else is not Gemini's
        doing (a timeout, a missing add-on, a bad request) and is left alone."""
        if isinstance(error, ActionRefused) or (
            isinstance(error, GeminiPageError) and _refused(error)
        ):
            self.refusal()
        elif isinstance(error, GeminiPageError):
            self.page_error()

    def note_answer(self, answer: str) -> None:
        """Counts an answer that is only the refusal text (pauses at once), or only the page's
        generic error (one of three)."""
        if is_refusal(answer):
            self.refusal()
        elif is_generic_error(answer):
            self.page_error()

    def _trip(self) -> None:
        # Called with the lock held. A trip while paused starts the 30 minutes again: the page
        # is still refusing, so the pause is "30 minutes or more" from the last sign of it.
        self._errors.clear()
        self._until = self._clock() + self._pause_s
        self._until_iso = _iso(self._now() + timedelta(seconds=self._pause_s))
        if self._store is not None:
            self._store.save_pause(self._pause_s)


def _refused(error: GeminiError) -> bool:
    """The add-on marks the toast of a refused prompt (`details.refused`, content.js)."""
    details: dict[str, Any] = error.details
    return details.get("refused") is True
