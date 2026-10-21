"""What one search runs with. A worker thread has its own `Search` (its own connection); the
source, pacing and events are shared."""

from __future__ import annotations

import dataclasses
import sqlite3
from collections.abc import Mapping, Sequence
from typing import Protocol

from gratovo_pipeline.config import Config
from gratovo_pipeline.protocol import LogLevel, Outcome
from gratovo_pipeline.search.pacing import Pacer
from gratovo_pipeline.youtube import ChannelInfo, VideoInfo


class SearchBlockedError(RuntimeError):
    """YouTube has stopped answering this machine and waiting didn't help. The only right answer
    is to stop making requests: a run that carries on lengthens the block."""


class Sweep(Protocol):
    """Reads channels' recent uploads one after another, on one session (a browser opens the
    connection once and keeps it)."""

    def recent_video_ids(self, handle: str) -> list[str]: ...
    def close(self) -> None: ...


class Source(Protocol):
    """Where a search reads YouTube from: the live site and API, or the example fixture."""

    def find_channels(self, keyword: str, *, limit: int) -> dict[str, str]:
        """{handle: channel_id} for a keyword's results."""
        ...

    def sweep(self) -> Sweep: ...
    def channels(self, batch: Mapping[str, str]) -> dict[str, ChannelInfo]: ...
    def videos(self, video_ids: Sequence[str]) -> dict[str, VideoInfo]: ...


class Events(Protocol):
    """What the app is told (the protocol's `Emitter` is one)."""

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
    ) -> None: ...

    def log(self, level: LogLevel, text: str) -> None: ...


@dataclasses.dataclass(frozen=True)
class Search:
    conn: sqlite3.Connection
    run_id: int
    cfg: Config
    source: Source
    pacer: Pacer
    events: Events

    def info(self, text: str) -> None:
        self.events.log("info", text)

    def warn(self, text: str) -> None:
        self.events.log("warn", text)
