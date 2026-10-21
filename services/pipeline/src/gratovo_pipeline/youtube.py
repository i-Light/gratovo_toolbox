"""The YouTube Data API v3: `channels.list` and `videos.list`, up to 50 ids a call.

Over the standard library (ADR 0013): two GET calls don't need google-api-python-client. Finding
channels and their recent uploads costs no quota (that is scrapetube, reading pages); only these
two calls spend it, at one unit per call of 50.

The key travels in the `X-Goog-Api-Key` header, never the URL, and as an unredirected header on an
opener that follows no redirects, so it reaches Google and nowhere else. No message this module
writes carries it, or any text Google sent back beyond a plain reason word.

A failure is named for what the run should do about it:
- `quota`: the day's quota is spent; the run ends.
- `no_youtube_key`: Google refused the key (wrong, expired, restricted, API not enabled); the run
  ends.
- `network`: Google stayed unreachable or kept failing after the retries; the run ends.
- any other refusal fails just that batch: the store marks its channels or videos failed and the
  run moves on, as before.
"""

from __future__ import annotations

import json
import re
import urllib.request
from collections.abc import Callable, Mapping, Sequence
from typing import Any, Final, Literal, NoReturn, Protocol, TypedDict, cast
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode

from gratovo_pipeline import net, run_control
from gratovo_pipeline.protocol import LogLevel

API: Final = "https://www.googleapis.com/youtube/v3"
BATCH_SIZE: Final = 50
TIMEOUT: Final = 30.0
RETRY_WAITS: Final = (2.0, 8.0)  # seconds before the 2nd and 3rd attempts
MAX_BODY: Final = 16 * 1024 * 1024

QUOTA_REASONS: Final = frozenset({"quotaExceeded", "dailyLimitExceeded"})
RATE_REASONS: Final = frozenset(
    {"rateLimitExceeded", "userRateLimitExceeded", "RATE_LIMIT_EXCEEDED"}
)
KEY_REASONS: Final = frozenset(
    {
        "keyInvalid",
        "keyExpired",
        "ipRefererBlocked",
        "accessNotConfigured",
        "API_KEY_INVALID",
        "API_KEY_EXPIRED",
        "API_KEY_SERVICE_BLOCKED",
        "API_KEY_IP_ADDRESS_BLOCKED",
        "API_KEY_HTTP_REFERRER_BLOCKED",
        "SERVICE_DISABLED",
    }
)
_SAFE_REASON: Final = re.compile(r"[a-z][A-Za-z]{0,39}|[A-Z][A-Z_]{0,39}")

type ErrorCode = Literal["quota", "no_youtube_key", "network"]
type Call = Literal["channels", "videos"]
type LogSink = Callable[[LogLevel, str], None]


# The store's shapes, keyed as the old pipeline keyed them.
class ChannelInfo(TypedDict):
    Name: str | None
    Handle: str
    Link: str
    Channel_ID: str
    Description: str | None
    Subscribers: str  # a plain number, or "Hidden"
    Profile_Picture: str | None
    Banner: str | None
    Country: str | None  # ISO 3166 alpha-2, when the owner set one


class VideoInfo(TypedDict):
    id: str
    Title: str | None
    Description: str | None
    Thumbnail: str | None
    Tags: list[str]
    PublishedAt: str | None
    ViewCount: str | None


class YouTubeError(RuntimeError):
    """A failure that ends the run. `code` is the protocol's end error code."""

    def __init__(self, code: ErrorCode, message: str) -> None:
        super().__init__(message)
        self.code: ErrorCode = code


class Body(Protocol):
    def read(self, size: int = -1, /) -> bytes: ...
    def close(self) -> None: ...


type Opener = Callable[[urllib.request.Request, float], Body]


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Google's API doesn't redirect; one that tries is refused rather than followed."""

    def redirect_request(self, *_args: Any, **_kwargs: Any) -> None:
        return None


_OPENER: Final = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())


def _open(request: urllib.request.Request, timeout: float) -> Body:
    return cast("Body", _OPENER.open(request, timeout=timeout))


_UNREACHABLE: Final = "Couldn't reach YouTube's API."
_TOO_FAST: Final = "YouTube's API kept refusing calls for coming too fast."


def _quiet(_level: LogLevel, _text: str) -> None:
    pass


class _Retry(Exception):  # noqa: N818 - a signal inside this module, not an error
    """Worth another attempt; `code` and `message` name the failure if none is left."""

    def __init__(self, why: str, code: ErrorCode, message: str) -> None:
        super().__init__(why)
        self.why = why
        self.code: ErrorCode = code
        self.message = message


class _BatchFailed(Exception):  # noqa: N818 - as above
    pass


class YouTubeApi:
    """One key's client. Safe to share across worker threads: each call opens its own
    connection."""

    def __init__(
        self,
        key: str,
        *,
        opener: Opener = _open,
        sleep: Callable[[float], None] = run_control.sleep,
        log: LogSink = _quiet,
    ) -> None:
        if not key.strip():
            raise YouTubeError("no_youtube_key", "There is no YouTube API key.")
        self._key = key.strip()
        self._opener = opener
        self._sleep = sleep
        self._log = log

    def channels(self, batch: Mapping[str, str]) -> dict[str, ChannelInfo]:
        """{handle: info} for a {handle: channel_id} batch. A channel the API didn't return is
        left out (the store marks it failed)."""
        handle_by_id = {channel_id: handle for handle, channel_id in batch.items()}
        items = self._list("channels", list(handle_by_id), "snippet,statistics,brandingSettings")
        found: dict[str, ChannelInfo] = {}
        for item in items:
            channel_id = _str(item.get("id"))
            handle = handle_by_id.get(channel_id or "")
            if channel_id and handle:
                found[handle] = _channel_info(item, handle, channel_id)
        return found

    def videos(self, video_ids: Sequence[str]) -> dict[str, VideoInfo]:
        """{video_id: info}. A video the API didn't return is left out."""
        found: dict[str, VideoInfo] = {}
        for item in self._list("videos", list(video_ids), "snippet,statistics"):
            video_id = _str(item.get("id"))
            if video_id:
                found[video_id] = _video_info(item, video_id)
        return found

    # --- the call ---

    def _list(self, call: Call, ids: list[str], part: str) -> list[dict[str, Any]]:
        if not ids:
            return []
        if len(ids) > BATCH_SIZE:
            raise ValueError(f"at most {BATCH_SIZE} ids a call, got {len(ids)}")
        url = f"{API}/{call}?{urlencode({'id': ','.join(ids), 'part': part})}"
        net.check_url(url)
        try:
            answer = self._get_with_retries(call, url)
        except _BatchFailed:
            return []
        items = _dict(answer).get("items")
        if not isinstance(items, list):
            return []
        return [
            cast("dict[str, Any]", i) for i in cast("list[object]", items) if isinstance(i, dict)
        ]

    def _get_with_retries(self, call: Call, url: str) -> object:
        for attempt in range(len(RETRY_WAITS) + 1):
            try:
                return self._get(call, url)
            except _Retry as retry:
                if attempt == len(RETRY_WAITS):
                    raise YouTubeError(retry.code, retry.message) from None
                wait = RETRY_WAITS[attempt]
                self._log(
                    "warn",
                    f"YouTube API: {call} call failed ({retry.why}), trying again in {wait:g} s",
                )
                self._sleep(wait)
        raise AssertionError("unreachable")  # pragma: no cover

    def _get(self, call: Call, url: str) -> object:
        request = urllib.request.Request(url, headers={"Accept": "application/json"})  # noqa: S310 - check_url allowed it
        request.add_unredirected_header("X-Goog-Api-Key", self._key)
        try:
            body = self._opener(request, TIMEOUT)
        except HTTPError as error:
            self._raise_for_status(call, error)
        except (URLError, TimeoutError, ConnectionError) as error:
            raise _Retry("network", "network", _UNREACHABLE) from error
        try:
            raw = body.read(MAX_BODY)
        except (TimeoutError, ConnectionError, OSError) as error:
            raise _Retry("network", "network", _UNREACHABLE) from error
        finally:
            body.close()
        try:
            return json.loads(raw)
        except ValueError:
            self._log("warn", f"YouTube API: {call} answer was not JSON")
            raise _BatchFailed from None

    def _raise_for_status(self, call: Call, error: HTTPError) -> NoReturn:
        reasons = _reasons(error)
        if reasons & QUOTA_REASONS:
            raise YouTubeError("quota", "The YouTube API quota for today is spent.")
        if reasons & KEY_REASONS:
            raise YouTubeError("no_youtube_key", "Google refused the YouTube API key.")
        if reasons & RATE_REASONS or error.code == 429:
            raise _Retry(f"HTTP {error.code}, going too fast", "quota", _TOO_FAST)
        if error.code >= 500:
            raise _Retry(f"HTTP {error.code}", "network", _UNREACHABLE)
        safe = sorted(r for r in reasons if _SAFE_REASON.fullmatch(r) and self._key not in r)
        named = f", {', '.join(safe)}" if safe else ""
        self._log("warn", f"YouTube API: {call} call failed (HTTP {error.code}{named})")
        raise _BatchFailed


# --- reading Google's answers ---


def _reasons(error: HTTPError) -> set[str]:
    """The reason words in a Google error body: `error.errors[].reason` and the newer
    `error.details[].reason`."""
    try:
        data: object = json.loads(error.read(64 * 1024) or b"null")
    except ValueError, OSError:
        return set()
    body = _dict(_dict(data).get("error"))
    reasons: set[str] = set()
    for key in ("errors", "details"):
        entries = body.get(key)
        if isinstance(entries, list):
            for entry in cast("list[object]", entries):
                reason = _str(_dict(entry).get("reason"))
                if reason:
                    reasons.add(reason)
    return reasons


def _dict(value: object) -> dict[str, Any]:
    return cast("dict[str, Any]", value) if isinstance(value, dict) else {}


def _str(value: object) -> str | None:
    return value if isinstance(value, str) else None


def _thumbnail(snippet: Mapping[str, Any], *sizes: str) -> str | None:
    thumbnails = _dict(snippet.get("thumbnails"))
    for size in sizes:
        url = _str(_dict(thumbnails.get(size)).get("url"))
        if url:
            return url
    return None


def _channel_info(item: Mapping[str, Any], handle: str, channel_id: str) -> ChannelInfo:
    snippet = _dict(item.get("snippet"))
    stats = _dict(item.get("statistics"))
    image = _dict(_dict(item.get("brandingSettings")).get("image"))
    return {
        "Name": _str(snippet.get("title")),
        "Handle": handle,
        "Link": f"https://www.youtube.com/{handle}",
        "Channel_ID": channel_id,
        "Description": _str(snippet.get("description")),
        "Subscribers": _str(stats.get("subscriberCount")) or "Hidden",
        "Profile_Picture": _thumbnail(snippet, "high"),
        "Banner": _str(image.get("bannerExternalUrl")),
        "Country": _str(snippet.get("country")),
    }


def _video_info(item: Mapping[str, Any], video_id: str) -> VideoInfo:
    snippet = _dict(item.get("snippet"))
    stats = _dict(item.get("statistics"))
    tags = snippet.get("tags")
    return {
        "id": video_id,
        "Title": _str(snippet.get("title")),
        "Description": _str(snippet.get("description")),
        "Thumbnail": _thumbnail(snippet, "maxres", "high"),
        "Tags": [t for t in cast("list[object]", tags) if isinstance(t, str)]
        if isinstance(tags, list)
        else [],
        "PublishedAt": _str(snippet.get("publishedAt")),
        "ViewCount": _str(stats.get("viewCount")),
    }
