"""The waits between scraped pages: sampled from the run's pacing, announced when long enough to
look like a stall, and switched off entirely for example data."""

from helpers import start_with

from gratovo_pipeline.config import Config
from gratovo_pipeline.protocol import LogLevel
from gratovo_pipeline.search.pacing import Pacer


class Rng:
    def __init__(self, uniform: float = 5.0, roll: int = 30) -> None:
        self.value = uniform
        self.roll = roll
        self.asked: list[tuple[float, float]] = []

    def uniform(self, a: float, b: float, /) -> float:
        self.asked.append((a, b))
        return self.value

    def randint(self, a: int, b: int, /) -> int:
        return self.roll


class Recorder:
    def __init__(self) -> None:
        self.waits: list[float] = []
        self.lines: list[tuple[LogLevel, str]] = []

    def sleep(self, seconds: float) -> None:
        self.waits.append(seconds)

    def log(self, level: LogLevel, text: str) -> None:
        self.lines.append((level, text))


NORMAL = Config.from_start(start_with(settings__pacing="normal"))


def pacer(rec: Recorder, rng: Rng) -> Pacer:
    return Pacer(NORMAL.delay, log=rec.log, sleep=rec.sleep, rng=rng)


def test_a_pause_samples_the_range_and_names_the_wait() -> None:
    rec, rng = Recorder(), Rng(uniform=5.04)
    pacer(rec, rng).pause("found_channels_delay", reason="reading the results")
    assert rng.asked == [(4.0, 9.0)]
    assert rec.waits == [5.04]
    assert rec.lines == [("info", "Pacing 5.0 s before reading the results.")]


def test_a_short_pause_is_not_announced() -> None:
    rec = Recorder()
    pacer(rec, Rng(uniform=0.6)).pause("recent_videos_delay")
    assert rec.waits == [0.6]
    assert rec.lines == []


def test_the_cooldown_happens_only_by_chance() -> None:
    taken, skipped = Recorder(), Recorder()
    pacer(taken, Rng(uniform=40.0, roll=50)).cooldown()  # chance is 50 in 100
    pacer(skipped, Rng(roll=51)).cooldown()
    assert taken.waits == [40.0]
    assert taken.lines == [("info", "Cooling down for 40.0 s.")]
    assert skipped.waits == []


def test_a_long_sweep_takes_a_break_every_thirty_channels() -> None:
    rec = Recorder()
    paced = pacer(rec, Rng(uniform=61.0))
    assert paced.every() == 30
    paced.sweep_break(30)
    assert rec.waits == [61.0]
    assert rec.lines == [("info", "Pausing 61 s after 30 channel(s) so YouTube keeps answering.")]


def test_the_scraper_gets_the_range_itself() -> None:
    assert pacer(Recorder(), Rng()).range("jitter_delay") == (2.5, 6.0)


def test_off_never_waits() -> None:
    off = Pacer.off()
    off.pause("found_channels_delay", reason="x")
    off.cooldown()
    off.sweep_break(30)
    assert off.range("jitter_delay") == (0.0, 0.0)
    assert off.every() == 0
