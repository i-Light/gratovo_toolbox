"""One run's configuration, built from the start line (ADR 0013).

The old pipeline read `data/.env`, `settings.json`, `run_config.json`, `keywords.json` and
`aws_gateways.json`. Now the app sends everything on stdin and nothing is read from disk. The
defaults below are the owner's committed `legacy/data/settings.json` (2026-10-21).
"""

from __future__ import annotations

import dataclasses
from pathlib import Path
from typing import Final, Literal
from urllib.parse import urlsplit

from gratovo_pipeline import parallel
from gratovo_pipeline.protocol import AutoClean, AutoCleanAction, Start

type DelayKey = Literal[
    "human_scroll_delay",
    "jitter_delay",
    "recent_videos_delay",
    "fast_sub_count_check_delay",
    "found_channels_delay",
    "ip_cooldown",
    "catchup_videos_delay",
    "channel_sweep_break",
]
type Pacing = Literal["normal", "fast"]
type AutoCleanLabel = Literal["haramStuff", "irrelevant", "inactive"]


@dataclasses.dataclass(frozen=True)
class Delay:
    """A random wait between low and high seconds. `chance` (percent) makes it happen only
    sometimes (`ip_cooldown`); `every` makes it a break after that many channels."""

    low: float
    high: float
    chance: int | None = None
    every: int | None = None


# Normal unless rotation spreads one worker's requests over several addresses (see `pacing`).
NORMAL_PACING: Final[dict[DelayKey, Delay]] = {
    "human_scroll_delay": Delay(1.5, 3.5),
    "jitter_delay": Delay(2.5, 6.0),
    "recent_videos_delay": Delay(1.5, 4.0),
    "fast_sub_count_check_delay": Delay(0.5, 1.0),
    "found_channels_delay": Delay(4.0, 9.0),
    "ip_cooldown": Delay(30.0, 70.5, chance=50),
}
FAST_PACING: Final[dict[DelayKey, Delay]] = {
    "human_scroll_delay": Delay(0.3, 0.8),
    "jitter_delay": Delay(0.5, 1.5),
    "recent_videos_delay": Delay(0.3, 1.0),
    "fast_sub_count_check_delay": Delay(0.1, 0.3),
    "found_channels_delay": Delay(0.5, 1.5),
    "ip_cooldown": Delay(5.0, 15.0, chance=10),
}
# The same at both speeds.
OTHER_DELAYS: Final[dict[DelayKey, Delay]] = {
    "catchup_videos_delay": Delay(0.8, 2.0),
    "channel_sweep_break": Delay(40.0, 100.0, every=30),
}

BACKFILL_BATCH_SIZE: Final = 25
# A search's rules come from its start line. A job other than `search` has none, so it gets these:
# the owner's 200 channels a keyword, sorted by upload date, from videos, in any country.
HANDLES_LIMIT: Final = 200
SORT_BY: Final = "upload_date"
RESULTS_TYPE: Final = "video"
_LABELS: Final[tuple[AutoCleanLabel, ...]] = ("haramStuff", "irrelevant", "inactive")


@dataclasses.dataclass(frozen=True)
class AutoCleanRule:
    """The standing "Auto-clean results" rule's subscriber band, applied during the run so a
    channel the rule would throw away never costs a video scrape. Its views and uploads bounds
    need data this point doesn't have; they stay with the app's sweep after the run."""

    min_subscribers: int
    max_subscribers: int
    below_min: AutoCleanAction
    above_max: AutoCleanAction
    label: AutoCleanLabel


def _label(value: str) -> AutoCleanLabel:
    """One of the three labels the app knows; anything else is "irrelevant", as before."""
    for label in _LABELS:
        if label == value:
            return label
    return "irrelevant"


def _auto_clean(clean: AutoClean | None) -> AutoCleanRule | None:
    if clean is None or not clean["enabled"]:
        return None
    return AutoCleanRule(
        min_subscribers=clean["minSubscribers"],
        max_subscribers=clean["maxSubscribers"],
        below_min=clean["belowMin"],
        above_max=clean["aboveMax"],
        label=_label(clean["label"]),
    )


@dataclasses.dataclass(frozen=True)
class _SearchFields:
    """What only a search sets; the defaults are what every other job gets."""

    keywords: tuple[str, ...] = ()
    start_at: int = 0
    handles_limit: int = HANDLES_LIMIT
    sort_by: Literal["relevance", "upload_date", "view_count", "rating"] = SORT_BY
    results_type: Literal["video", "channel"] = RESULTS_TYPE
    country_filter: frozenset[str] | None = None
    auto_clean: AutoCleanRule | None = None


def _usable(urls: list[str]) -> tuple[str, ...]:
    return tuple(url.strip() for url in urls if url.strip())


@dataclasses.dataclass(frozen=True)
class Config:
    source: Literal["live", "example"]
    data_dir: Path
    worker: str
    keywords: tuple[str, ...]
    start_at: int
    handles_limit: int
    sort_by: Literal["relevance", "upload_date", "view_count", "rating"]
    results_type: Literal["video", "channel"]
    country_filter: frozenset[str] | None
    auto_clean: AutoCleanRule | None
    youtube_key: str | None
    proxies_enabled: bool
    include_direct: bool
    proxy_urls: tuple[str, ...]
    gateway_urls: tuple[str, ...]
    rotating_connections: int
    parallel_workers: int
    pacing: Pacing
    backfill_batch_size: int = BACKFILL_BATCH_SIZE

    @classmethod
    def from_start(cls, start: Start) -> Config:
        """The configuration of any job (plan D15). The routes, pacing and key are every job's;
        the search fields are neutral unless the job is a search, and a refetch brings its own
        auto-clean rule."""
        job, settings, secrets = start["job"], start["settings"], start["secrets"]
        proxy_urls = _usable(secrets["proxyUrls"])
        gateway_urls = _usable(secrets["gatewayUrls"])
        # No switch sent means the app set proxies up and wants them used.
        proxies = settings.get("proxies", {"enabled": bool(proxy_urls), "includeDirect": True})
        rotating = (len(proxy_urls) if proxies["enabled"] else 0) + len(gateway_urls)
        parallel_setting = settings.get(
            "parallel", {"enabled": False, "maxWorkers": parallel.DEFAULT_MAX_WORKERS}
        )
        workers = parallel.worker_count(
            enabled=parallel_setting["enabled"],
            max_workers=parallel_setting["maxWorkers"],
            rotating_connections=rotating,
        )
        # Fast only while rotation spreads ONE worker's requests over several addresses. Several
        # workers over the same addresses put each back at one worker's traffic, so they keep the
        # Normal beat: the owner's rule, parallel on means normal speed.
        pacing: Pacing = settings.get(
            "pacing", "fast" if rotating > 0 and workers < 2 else "normal"
        )

        if job["kind"] == "search":
            rules = job["rules"]
            search = _SearchFields(
                keywords=tuple(job["keywords"]),
                start_at=job["startAt"],
                handles_limit=rules["perKeyword"],
                sort_by=rules["sortBy"],
                results_type=rules["resultsType"],
                country_filter=frozenset(rules["countries"]) or None,
                auto_clean=_auto_clean(rules["autoClean"]),
            )
        else:
            clean = job["autoClean"] if job["kind"] == "refetch" else None
            search = _SearchFields(auto_clean=_auto_clean(clean))
        return cls(
            source=start["source"],
            data_dir=Path(start["dataDir"]),
            worker=start["worker"],
            keywords=search.keywords,
            start_at=search.start_at,
            handles_limit=search.handles_limit,
            sort_by=search.sort_by,
            results_type=search.results_type,
            country_filter=search.country_filter,
            auto_clean=search.auto_clean,
            youtube_key=secrets["youtubeKey"],
            proxies_enabled=proxies["enabled"],
            include_direct=proxies["includeDirect"],
            proxy_urls=proxy_urls,
            gateway_urls=gateway_urls,
            rotating_connections=rotating,
            parallel_workers=workers,
            pacing=pacing,
        )

    def delay(self, key: DelayKey) -> Delay:
        if key in OTHER_DELAYS:
            return OTHER_DELAYS[key]
        return (FAST_PACING if self.pacing == "fast" else NORMAL_PACING)[key]

    def describe(self) -> str:
        """Where the run points, for the log. Never a secret: no key, no URL, no address."""
        gateways = len(self.gateway_urls)
        proxies = len(self.proxy_urls) if self.proxies_enabled else 0
        return (
            f"source: {self.source}; youtube key: {'set' if self.youtube_key else 'missing'}; "
            f"routes: {gateways} gateway(s), {proxies} proxy(ies), "
            f"direct {'on' if self.include_direct or not (gateways or proxies) else 'off'}; "
            f"workers: {self.parallel_workers}; pacing: {self.pacing}"
        )


def proxy_label(url: str) -> str:
    """The host of a proxy URL, for the log: never its user name or password."""
    return urlsplit(url).hostname or "proxy"
