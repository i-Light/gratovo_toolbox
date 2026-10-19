#!/usr/bin/env python3
"""One YouTube video's view count, for the 30-day report (plan step 7).

    python tools/video_stats.py --video "https://youtu.be/<id>" --json

The app runs this when a person builds a deliverable's 30-day report. It
reads one number from the YouTube Data API (`videos.list`, part statistics:
one unit of quota) and prints it; it stores nothing. The app keeps the number
as the report's snapshot.

OUTPUT
------
With `--json` (which the app always passes) it prints exactly one JSON
object: `{"ok": true, "videoId": ..., "views": n, "fetchedAt": "...Z"}`, or
`{"ok": false, "error": {"code": ..., "message": ...}}` with exit code 1.
Codes: `not_a_video` (the text is not a YouTube video link), `not_found`
(YouTube does not know the video, or it is private), `no_key` (no YouTube
key is configured), `youtube_error` (the API refused or failed).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
_PATH_PREFIXES = ("shorts", "live", "embed", "v")
# googleapiclient's errors print the request URL, which carries the API key.
_KEY_PARAM = re.compile(r"([?&]key=)[^&\s\"'>]+")


def video_id_from(text: str) -> str | None:
    """The 11-character video id in a YouTube link, or a bare id; None for
    anything else (a channel link, another site, plain text)."""
    text = (text or "").strip()
    if _ID.match(text):
        return text
    try:
        url = urlparse(text if "://" in text else f"https://{text}")
    except ValueError:
        return None
    host = (url.hostname or "").lower()
    if host.startswith("www.") or host.startswith("m."):
        host = host.split(".", 1)[1]
    candidate = None
    if host == "youtu.be":
        candidate = url.path.strip("/").split("/")[0]
    elif host in ("youtube.com", "youtube-nocookie.com"):
        parts = [p for p in url.path.split("/") if p]
        if parts[:1] == ["watch"]:
            candidate = (parse_qs(url.query).get("v") or [None])[0]
        elif len(parts) >= 2 and parts[0] in _PATH_PREFIXES:
            candidate = parts[1]
    return candidate if candidate and _ID.match(candidate) else None


def views_of(video_id: str, youtube) -> int | None:
    """The video's current view count, or None when YouTube does not return
    the video. API failures are raised, not swallowed."""
    response = youtube.videos().list(part="statistics", id=video_id).execute()
    for item in response.get("items", []):
        if item.get("id") == video_id:
            count = (item.get("statistics") or {}).get("viewCount")
            return int(count) if count is not None else None
    return None


def _client():
    from googleapiclient.discovery import build

    from gratovo import config

    key = config.load().youtube_api_key
    if not key:
        raise _Failure("no_key", "No YouTube API key is configured.")
    return build("youtube", "v3", developerKey=key, cache_discovery=False)


class _Failure(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def _emit(as_json: bool, payload: dict, line: str) -> None:
    print(json.dumps(payload, ensure_ascii=False) if as_json else line)


def main(argv=None, youtube=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--video", required=True,
                        help="a YouTube video link or its 11-character id")
    parser.add_argument("--json", action="store_true",
                        help="print one JSON object (the app always passes it)")
    args = parser.parse_args(argv)
    try:
        video_id = video_id_from(args.video)
        if video_id is None:
            raise _Failure("not_a_video", "That is not a YouTube video link.")
        try:
            views = views_of(video_id, youtube or _client())
        except _Failure:
            raise
        except Exception as exc:  # noqa: BLE001 - the app needs JSON, not a traceback
            detail = _KEY_PARAM.sub(r"\1[hidden]", str(exc))
            raise _Failure("youtube_error", f"YouTube did not answer: {detail}") from exc
        if views is None:
            raise _Failure("not_found",
                           "YouTube does not show that video (removed or private).")
    except _Failure as failure:
        _emit(args.json,
              {"ok": False, "error": {"code": failure.code, "message": failure.message}},
              f"error: {failure.message}")
        return 1
    fetched_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    _emit(args.json,
          {"ok": True, "videoId": video_id, "views": views, "fetchedAt": fetched_at},
          f"{video_id}: {views} views at {fetched_at}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
