"""The waits between scraped pages. The Data API calls aren't paced: they are keyed and counted,
and not what YouTube blocks on.

Three things shape the run's request budget, because they are what YouTube looks at:
- the gap between requests: never a constant, every wait is sampled from a range;
- the length of a burst: a person doesn't read two hundred channel pages without stopping, so a
  long sweep takes a real break every `every` channels;
- what happens when told no: the scraper backs off and finally raises, and the run ends.

The ranges are unhurried on purpose. A keyword that takes six minutes instead of ninety seconds
costs six minutes; an address that has to sit out a day costs the team a day.
"""

from __future__ import annotations

import random
from collections.abc import Callable
from typing import Protocol

from gratovo_pipeline import run_control
from gratovo_pipeline.config import Delay, DelayKey
from gratovo_pipeline.protocol import LogLevel


class Rng(Protocol):
    def uniform(self, a: float, b: float, /) -> float: ...
    def randint(self, a: int, b: int, /) -> int: ...


def _quiet(_level: LogLevel, _text: str) -> None:
    pass


class Pacer:
    def __init__(
        self,
        delays: Callable[[DelayKey], Delay] | None,
        *,
        log: Callable[[LogLevel, str], None] = _quiet,
        sleep: Callable[[float], None] = run_control.sleep,
        rng: Rng | None = None,
    ) -> None:
        self._delays = delays
        self._log = log
        self._sleep = sleep
        self._rng: Rng = rng or random.Random()  # noqa: S311 - jitter, not a secret

    @classmethod
    def off(cls) -> Pacer:
        """No waits at all: the example source reads no network."""
        return cls(None)

    def range(self, key: DelayKey) -> tuple[float, float]:
        """The (low, high) range the scraper samples between its own page requests."""
        if self._delays is None:
            return (0.0, 0.0)
        delay = self._delays(key)
        return (delay.low, delay.high)

    def pause(self, key: DelayKey, reason: str | None = None) -> None:
        if self._delays is None:
            return
        wait = self._sample(self._delays(key))
        # Announced only when long enough to look like a stall: under a second, saying so is
        # noisier than the pause.
        if wait >= 1.0:
            self._log("info", f"Pacing {wait:.1f} s{f' before {reason}' if reason else ''}.")
        self._sleep(wait)

    def cooldown(self) -> None:
        """Sometimes, after a keyword, a longer rest."""
        if self._delays is None:
            return
        delay = self._delays("ip_cooldown")
        if self._rng.randint(1, 100) > (delay.chance or 0):
            return
        wait = self._sample(delay)
        self._log("info", f"Cooling down for {wait:.1f} s.")
        self._sleep(wait)

    def every(self) -> int:
        """Channels between sweep breaks; 0 for none."""
        if self._delays is None:
            return 0
        return max(0, self._delays("channel_sweep_break").every or 0)

    def sweep_break(self, done: int) -> None:
        """The coffee break partway through a long sweep: jitter alone doesn't hide two hundred
        requests in ten unbroken minutes; the unbroken part is what stands out."""
        if self._delays is None:
            return
        wait = self._sample(self._delays("channel_sweep_break"))
        self._log(
            "info", f"Pausing {wait:.0f} s after {done} channel(s) so YouTube keeps answering."
        )
        self._sleep(wait)

    def _sample(self, delay: Delay) -> float:
        return self._rng.uniform(delay.low, delay.high)
