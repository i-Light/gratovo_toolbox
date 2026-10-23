"""The video_stats job: one video's views, for Deliver's 30-day report.

One `videos.list` call (one unit of quota). The answer is a `result` line, then `end` `done`; the
job stores nothing, the app keeps the number as the report's snapshot. How it can fail:
- the text is not a YouTube video link: `not_a_video`, without asking YouTube;
- no team key: `no_youtube_key`;
- YouTube refuses or can't be reached: that error's code and message;
- YouTube doesn't know the video (removed or private): `not_found`;
- anything else: `crash`, naming only the error's kind (its text can carry a URL).
"""

from __future__ import annotations

import re
import sys
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Protocol
from urllib.parse import parse_qs, urlparse

from gratovo_pipeline.protocol import Emitter, EndErrorCode, Start
from gratovo_pipeline.youtube import VideoInfo, YouTubeApi, YouTubeError

_ID = re.compile(r"[A-Za-z0-9_-]{11}")
_PATH_PREFIXES = ("shorts", "live", "embed", "v")


class VideoApi(Protocol):
    def videos(self, video_ids: Sequence[str]) -> dict[str, VideoInfo]: ...


def video_id_from(text: str) -> str | None:
    """The 11-character video id in a YouTube link, or a bare id; None for anything else (a
    channel link, another site, plain text)."""
    text = text.strip()
    if _ID.fullmatch(text):
        return text
    try:
        url = urlparse(text if "://" in text else f"https://{text}")
        host = (url.hostname or "").lower()
    except ValueError:
        return None
    if host.startswith(("www.", "m.")):
        host = host.split(".", 1)[1]
    candidate: str | None = None
    if host == "youtu.be":
        candidate = url.path.strip("/").split("/")[0]
    elif host in ("youtube.com", "youtube-nocookie.com"):
        parts = [p for p in url.path.split("/") if p]
        if parts[:1] == ["watch"]:
            candidate = (parse_qs(url.query).get("v") or [None])[0]
        elif len(parts) >= 2 and parts[0] in _PATH_PREFIXES:
            candidate = parts[1]
    return candidate if candidate and _ID.fullmatch(candidate) else None


def _fail(emitter: Emitter, code: EndErrorCode, message: str) -> None:
    emitter.end(state="failed", at=0, found=0, kept=0, error=(code, message))


def run(start: Start, emitter: Emitter, *, api: VideoApi | None = None) -> None:
    """Runs the job and always ends with an `end` line. `api` replaces the live one (tests)."""
    job = start["job"]
    if job["kind"] != "video_stats":
        _fail(emitter, "crash", "This is not a video_stats job.")
        return
    video_id = video_id_from(job["videoUrl"])
    if video_id is None:
        _fail(emitter, "not_a_video", "That is not a YouTube video link.")
        return
    try:
        if api is None:
            key = start["secrets"]["youtubeKey"]
            if not key:
                _fail(emitter, "no_youtube_key", "There is no YouTube API key for the team yet.")
                return
            api = YouTubeApi(key, log=emitter.log)
        info = api.videos([video_id]).get(video_id)
        views = info["ViewCount"] if info else None
        if views is None or not views.isdecimal():
            _fail(emitter, "not_found", "YouTube does not show that video (removed or private).")
            return
        fetched_at = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
        emitter.result(
            "video_stats", {"videoId": video_id, "views": int(views), "fetchedAt": fetched_at}
        )
        emitter.end(state="done", at=0, found=0, kept=0)
    except YouTubeError as error:
        _fail(emitter, error.code, str(error))
    except Exception as error:  # every way out ends with `end`
        # The kind only: the message can carry a URL with the key in it.
        print(f"video_stats crashed: {type(error).__name__}", file=sys.stderr, flush=True)
        _fail(
            emitter, "crash", f"The lookup stopped on an unexpected error ({type(error).__name__})."
        )
