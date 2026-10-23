"""A YouTube that lives in memory, and a recorder for what a search announces. Example data is
about AI creators."""

import sqlite3
from collections.abc import Callable, Mapping, Sequence
from typing import Any

from helpers import start_with

from gratovo_pipeline import store
from gratovo_pipeline.config import Config
from gratovo_pipeline.protocol import LogLevel, Outcome
from gratovo_pipeline.search.context import Search
from gratovo_pipeline.search.pacing import Pacer
from gratovo_pipeline.youtube import ChannelInfo, VideoInfo


def channel_info(
    handle: str, channel_id: str, subscribers: str = "250000", country: str | None = "US"
) -> ChannelInfo:
    return {
        "Name": handle.lstrip("@").replace("-", " ").title(),
        "Handle": handle,
        "Link": f"https://www.youtube.com/{handle}",
        "Channel_ID": channel_id,
        "Description": f"{handle} covers AI tools and AI news.",
        "Subscribers": subscribers,
        "Profile_Picture": None,
        "Banner": None,
        "Country": country,
    }


def video_info(video_id: str, views: int = 1000) -> VideoInfo:
    return {
        "id": video_id,
        "Title": f"AI agents, part {video_id}",
        "Description": "Testing new AI tools this week.",
        "Thumbnail": None,
        "Tags": ["ai"],
        "PublishedAt": store.utc_now(),
        "ViewCount": str(views),
    }


class FakeSweep:
    def __init__(self, source: FakeSource) -> None:
        self.source = source
        self.closed = False

    def recent_video_ids(self, handle: str, *, limit: int | None = None) -> list[str]:
        if self.source.on_read:
            self.source.on_read(handle)
        self.source.read.append(handle)
        self.source.limits.append(limit)
        return list(self.source.uploads.get(handle, []))[:limit]

    def close(self) -> None:
        self.closed = True


class FakeSource:
    """Search results per keyword, channel details per id, uploads per handle. A video is
    always found unless listed in `missing_videos`."""

    def __init__(
        self,
        *,
        results: Mapping[str, Mapping[str, str]] | None = None,
        details: Sequence[ChannelInfo] = (),
        uploads: Mapping[str, Sequence[str]] | None = None,
    ) -> None:
        self.results = {k: dict(v) for k, v in (results or {}).items()}
        self.details = {info["Channel_ID"]: info for info in details}
        self.uploads = {k: list(v) for k, v in (uploads or {}).items()}
        self.missing_videos: set[str] = set()
        self.read: list[str] = []
        self.limits: list[int | None] = []  # the `limit` each read asked for (None: no limit)
        self.channel_calls: list[list[str]] = []
        self.video_calls: list[list[str]] = []
        self.sweeps: list[FakeSweep] = []
        self.on_read: Callable[[str], None] | None = None
        self.on_videos: Callable[[Sequence[str]], None] | None = None

    def find_channels(self, keyword: str, *, limit: int) -> dict[str, str]:
        return dict(list(self.results.get(keyword, {}).items())[:limit])

    def sweep(self) -> FakeSweep:
        sweep = FakeSweep(self)
        self.sweeps.append(sweep)
        return sweep

    def channels(self, batch: Mapping[str, str]) -> dict[str, ChannelInfo]:
        self.channel_calls.append(list(batch))
        return {h: self.details[cid] for h, cid in batch.items() if cid in self.details}

    def videos(self, video_ids: Sequence[str]) -> dict[str, VideoInfo]:
        if self.on_videos:
            self.on_videos(video_ids)
        self.video_calls.append(list(video_ids))
        return {v: video_info(v) for v in video_ids if v not in self.missing_videos}


class Events:
    def __init__(self) -> None:
        self.channels: list[dict[str, Any]] = []
        self.lines: list[tuple[LogLevel, str]] = []

    def channel(
        self,
        *,
        keyword: str,
        channel_id: str,
        handle: str | None,
        name: str,
        subscribers: int | None,
        median_views: int | None,
        country: str | None,
        outcome: Outcome,
    ) -> None:
        self.channels.append(
            {
                "keyword": keyword,
                "channel_id": channel_id,
                "handle": handle,
                "name": name,
                "subscribers": subscribers,
                "median_views": median_views,
                "country": country,
                "outcome": outcome,
            }
        )

    def log(self, level: LogLevel, text: str) -> None:
        self.lines.append((level, text))

    def outcomes(self) -> dict[str, Outcome]:
        return {c["handle"]: c["outcome"] for c in self.channels}


def make_search(
    conn: sqlite3.Connection,
    source: FakeSource,
    events: Any = None,
    **changes: object,
) -> Search:
    """A search over source, with the example start's rules changed by `changes` (as
    `start_with` takes them). No pacing."""
    cfg = Config.from_start(start_with(**changes))
    store.seed_keywords(conn, cfg.keywords)
    return Search(
        conn=conn,
        run_id=store.start_run(conn, len(cfg.keywords)),
        cfg=cfg,
        source=source,
        pacer=Pacer.off(),
        events=events if events is not None else Events(),
    )
