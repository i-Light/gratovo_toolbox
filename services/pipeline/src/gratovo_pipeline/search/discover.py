"""The live source: channels found by reading YouTube's search pages (no quota), their recent
uploads read from their channel pages (no quota), and their details from the Data API (quota, 50
a call).

Error messages here name the kind of error only. A scraper error can carry the URL it was
fetching, and a proxy URL can carry a login.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from typing import Any, Final, Literal

from gratovo_pipeline import net
from gratovo_pipeline.config import Config
from gratovo_pipeline.protocol import LogLevel
from gratovo_pipeline.scrapetube import scrapetube
from gratovo_pipeline.search.context import SearchBlockedError
from gratovo_pipeline.search.pacing import Pacer
from gratovo_pipeline.youtube import ChannelInfo, VideoInfo, YouTubeApi

# The uploads window read per channel. It stays at 15 (the owner's note on the old code: enough
# to span about a month); widening it is the on-hold gap first-1.
RECENT_VIDEOS: Final = 15
_PROGRESS_EVERY: Final = 20


def _dict(value: object) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}  # pyright: ignore[reportUnknownVariableType]


def _handle_and_id(browse: Mapping[str, Any], channel_id: object) -> tuple[str, str] | None:
    url = browse.get("canonicalBaseUrl")
    if not (isinstance(url, str) and "@" in url and isinstance(channel_id, str) and channel_id):
        return None
    return url.strip("/").split("/")[-1], channel_id


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
    def __init__(self, pacer: Pacer, log: Callable[[LogLevel, str], None]) -> None:
        self._session = scrapetube.get_session()
        self._pacer = pacer
        self._log = log

    def recent_video_ids(self, handle: str) -> list[str]:
        ids: list[str] = []
        try:
            for video in scrapetube.get_channel(
                channel_url=f"https://www.youtube.com/{handle}",
                limit=RECENT_VIDEOS,
                sleep=self._pacer.range("human_scroll_delay"),
                session=self._session,
            ):
                video_id = video.get("videoId")
                if isinstance(video_id, str):
                    ids.append(video_id)
        except scrapetube.BlockedError as error:
            raise SearchBlockedError(str(error)) from error
        except net.HostNotAllowedError:
            raise
        except Exception as error:  # one channel's page must not end the run
            self._log("warn", f"Couldn't read {handle}'s uploads ({type(error).__name__}).")
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

    def find_channels(self, keyword: str, *, limit: int) -> dict[str, str]:
        found: dict[str, str] = {}
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
                    found[pair[0]] = pair[1]
                # Paginating a deep search is the longest quiet stretch of a run.
                if scanned % _PROGRESS_EVERY == 0:
                    self._log(
                        "info",
                        f"Scanned {scanned} search results, {len(found)} channel(s) so far.",
                    )
        except scrapetube.BlockedError as error:
            # Not "this keyword found nothing": everything after it is more requests to an
            # address YouTube has stopped answering.
            raise SearchBlockedError(str(error)) from error
        except net.HostNotAllowedError:
            raise
        except Exception as error:  # keep what the pages already gave
            self._log("warn", f"The search stopped early ({type(error).__name__}).")
        return found

    def sweep(self) -> LiveSweep:
        return LiveSweep(self._pacer, self._log)

    def channels(self, batch: Mapping[str, str]) -> dict[str, ChannelInfo]:
        return self._api.channels(batch)

    def videos(self, video_ids: Sequence[str]) -> dict[str, VideoInfo]:
        return self._api.videos(video_ids)
