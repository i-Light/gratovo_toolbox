"""What one search runs with. A worker thread has its own `Search` (its own connection); the
source, pacing and events are shared."""

from __future__ import annotations

import dataclasses
import sqlite3
from collections.abc import Mapping, Sequence
from typing import Final, Protocol

from gratovo_pipeline.config import Config
from gratovo_pipeline.protocol import LogLevel, Outcome
from gratovo_pipeline.search.pacing import Pacer
from gratovo_pipeline.youtube import ChannelInfo, VideoInfo

# The uploads window read per channel unless a job asks for more. It stays at 15 for a search
# (the owner's note on the old code); widening that is the on-hold gap search-1.
RECENT_VIDEOS: Final = 15


class SearchBlockedError(RuntimeError):
    """YouTube has stopped answering this machine and waiting didn't help. The only right answer
    is to stop making requests: a run that carries on lengthens the block."""


class ChannelUnreadableError(RuntimeError):
    """One channel's uploads could not be read (its page failed, not a block). The channel is
    not "read, zero uploads": the caller leaves it unstamped, so a later slice tries again.

    `partial` holds the ids read before a later page failed. A search must not take them as a
    read (the window may be short); the backfill job, which only adds older uploads, uses them."""

    def __init__(self, handle: str, *, partial: Sequence[str] = ()) -> None:
        super().__init__(handle)
        self.partial: list[str] = list(partial)


class Sweep(Protocol):
    """Reads channels' recent uploads one after another, on one session (a browser opens the
    connection once and keeps it)."""

    def recent_video_ids(self, handle: str, *, limit: int = RECENT_VIDEOS) -> list[str]:
        """At most `limit` of the channel's newest upload ids (15 unless a job asks for more).
        Raises ChannelUnreadableError when the read failed; an empty list means no uploads."""
        ...

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
    # Never-contact channel ids (the job's `skip`): a search leaves them exactly as they are.
    skip: frozenset[str] = frozenset()

    def info(self, text: str) -> None:
        self.events.log("info", text)

    def warn(self, text: str) -> None:
        self.events.log("warn", text)
