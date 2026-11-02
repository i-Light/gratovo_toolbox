"""The live source: channels found by reading YouTube's search pages (no quota), their recent
uploads read from their channel pages (no quota), and their details from the Data API (quota, 50
a call).

Error messages here name the kind of error only. A scraper error can carry the URL it was
fetching, and a proxy URL can carry a login.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Mapping, Sequence
from typing import Any, Final, Literal

from gratovo_pipeline import net
from gratovo_pipeline.config import Config
from gratovo_pipeline.protocol import LogLevel
from gratovo_pipeline.scrapetube import scrapetube
from gratovo_pipeline.search.context import (
    RECENT_VIDEOS,
    ChannelUnreadableError,
    Found,
    SearchBlockedError,
)
from gratovo_pipeline.search.pacing import Pacer
from gratovo_pipeline.youtube import ChannelInfo, VideoInfo, YouTubeApi

_PROGRESS_EVERY: Final = 20


def _dict(value: object) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}  # pyright: ignore[reportUnknownVariableType]


_CHANNEL_ID: Final = re.compile(r"^UC[A-Za-z0-9_-]{22}$")


def _handle_and_id(browse: Mapping[str, Any], channel_id: object) -> tuple[str, str] | None:
    if not (isinstance(channel_id, str) and _CHANNEL_ID.match(channel_id)):
        return None
    url = browse.get("canonicalBaseUrl")
    if isinstance(url, str) and "@" in url:
        return url.strip("/").split("/")[-1], channel_id
    # No handle: the channel id stands in for it (`channels.handle` is NOT NULL); the details
    # read fills the real handle in from the channel's customUrl.
    return channel_id, channel_id


def channel_from_item(
    item: Mapping[str, Any], results_type: Literal["video", "channel"]
) -> tuple[str, str] | None:
    """(handle, channel_id) from one search result, or None. A video result names its uploader
    in its byline; a channel result names itself. The id comes free with the result, which is
    what lets the details be asked for 50 at a time (a handle lookup takes one per call)."""
    if results_type == "channel":
        browse = _dict(_dict(item.get("navigationEndpoint")).get("browseEndpoint"))
        return _handle_and_id(browse, item.get("channelId") or browse.get("browseId"))
    runs = _dict(item.get("shortBylineText")).get("runs") or _dict(item.get("ownerText")).get(
        "runs"
    )
    if not isinstance(runs, list) or not runs:
        return None
    first = _dict(runs[0])  # pyright: ignore[reportUnknownArgumentType]
    browse = _dict(_dict(first.get("navigationEndpoint")).get("browseEndpoint"))
    return _handle_and_id(browse, browse.get("browseId"))


class LiveSweep:
    def __init__(
        self,
        pacer: Pacer,
        log: Callable[[LogLevel, str], None],
        *,
        end_on_block: bool = False,
    ) -> None:
        self._session = scrapetube.get_session()
        self._end_on_block = end_on_block
        self._pacer = pacer
        self._log = log

    def recent_video_ids(self, channel_id: str, *, limit: int = RECENT_VIDEOS) -> list[str]:
        ids: list[str] = []
        try:
            for video in scrapetube.get_channel(
                channel_url=f"https://www.youtube.com/channel/{channel_id}",
                limit=limit,
                sleep=self._pacer.range("human_scroll_delay"),
                session=self._session,
            ):
                video_id = video.get("videoId")
                if isinstance(video_id, str):
                    ids.append(video_id)
        except net.HostNotAllowedError:
            raise
        except Exception as error:  # a failed page (PageFailedError) ends this channel, not the run
            self._log(
                "warn", f"Couldn't read the uploads of {channel_id} ({type(error).__name__})."
            )
            # Not "no uploads": that would stamp the channel as read and drop it from the backlog
            # for good (the old app's way to lose a channel's videos on one bad page). The ids an
            # earlier page gave go with it, for the backfill job.
            if (
                self._end_on_block
                and isinstance(error, scrapetube.PageFailedError)
                and error.all_blocked
            ):
                raise SearchBlockedError("YouTube stopped answering this machine") from error
            raise ChannelUnreadableError(channel_id, partial=ids) from error
        return ids

    def close(self) -> None:
        self._session.close()


class LiveSource:
    def __init__(
        self, cfg: Config, api: YouTubeApi, pacer: Pacer, *, log: Callable[[LogLevel, str], None]
    ) -> None:
        self._cfg = cfg
        self._api = api
        self._pacer = pacer
        self._log = log

    def find_channels(self, keyword: str, *, limit: int) -> Found:
        by_id: dict[str, str] = {}  # channel id -> handle (an @ handle beats the placeholder)
        complete = True
        positions: dict[str, int] = {}  # channel id -> place of its first hit (1-based)
        scanned = 0
        try:
            for item in scrapetube.get_search(
                keyword,
                limit=limit,
                sleep=self._pacer.range("jitter_delay"),
                sort_by=self._cfg.sort_by,
                results_type=self._cfg.results_type,
            ):
                scanned += 1
                pair = channel_from_item(item, self._cfg.results_type)
                if pair:
                    positions.setdefault(pair[1], scanned)
                if pair and (pair[1] not in by_id or "@" in pair[0]):
                    by_id[pair[1]] = pair[0]
                # Paginating a deep search is the longest quiet stretch of a run.
                if scanned % _PROGRESS_EVERY == 0:
                    self._log(
                        "info",
                        f"Scanned {scanned} search results, {len(by_id)} channel(s) so far.",
                    )
        except net.HostNotAllowedError:
            raise
        except Exception as error:  # a page failed on every route: keep what the pages gave
            self._log("warn", f"The search stopped early ({type(error).__name__}).")
            complete = False
        return Found({handle: cid for cid, handle in by_id.items()}, complete, positions)

    def sweep(self, *, end_on_block: bool = False) -> LiveSweep:
        return LiveSweep(self._pacer, self._log, end_on_block=end_on_block)

    def channels(self, batch: Mapping[str, str]) -> dict[str, ChannelInfo]:
        return self._api.channels(batch)

    def videos(self, video_ids: Sequence[str]) -> dict[str, VideoInfo]:
        return self._api.videos(video_ids)
