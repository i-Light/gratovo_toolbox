"""Usable moments in a creator's latest video, for the personal line of a first email
(INF-FIRST-02, INF-FIRST-26).

    from gratovo_pipeline.comms import moments
    found = moments.for_latest_video(conn, gemini, channel_id)

Decision `subtitles` (2026-10-18): the subtitles are fetched only when a first email is drafted,
and kept per video in `video_transcripts` (pipeline.db, schema version 2, plan D7) so a redo or a
later draft reuses them. The reading is the `gratovo-moments` skill's
(data/comms/skill/gratovo-moments/SKILL.md); its instructions travel with the transcript, so the
step works whether or not the skill has been deployed to Gemini yet. A reading that fails is not
kept: the next draft asks again.
"""

from __future__ import annotations

import json
import re
import sqlite3
import uuid
from collections.abc import Callable
from typing import Any, Final, cast

from gratovo_pipeline import paths, store
from gratovo_pipeline.comms import engine

type Fetch = Callable[[str], dict[str, Any]]

SKILL_PATH: Final = paths.COMMS_SKILL_DIR / "gratovo-moments" / "SKILL.md"
MAX_WORDS: Final = 6000

PROMPT: Final = """{skill}

---

VIDEO
Title: {title}
Uploaded: {uploaded}
Subtitles: {kind}

TRANSCRIPT
{transcript}

Answer ONLY with the JSON described above."""


def _skill_text() -> str:
    text = SKILL_PATH.read_text(encoding="utf-8")
    # The front matter is for Gemini's skill list, not for the reader of the prompt.
    return re.sub(r"\A---\n.*?\n---\n", "", text, flags=re.S).strip()


def _parse(text: str) -> list[dict[str, Any]] | None:
    match = re.search(r"\{.*\}", text or "", re.S)
    if not match:
        return None
    try:
        data: object = json.loads(match.group(0))
    except ValueError:
        return None
    items: object = cast("dict[str, Any]", data).get("moments") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return None
    return [
        cast("dict[str, Any]", m)
        for m in cast("list[object]", items)
        if isinstance(m, dict) and m.get("at") and m.get("quote")  # pyright: ignore[reportUnknownMemberType]
    ]


def _trim(text: str) -> str:
    from gratovo_pipeline import (
        transcript,
    )  # late: yt-dlp's wrapper is only needed when a video is read

    return transcript.trim(text, MAX_WORDS)


# yt-dlp's last error line when the subtitles could not be fetched just now (rate limit, server
# error, network) -- not "this video has none", so it is never cached (final review I8). A video
# with no caption track gives no error line at all ("captions disabled").
_PASSING: Final = re.compile(
    # no_deno: no Deno on this computer yet (step 3h packages it); read again once it is there.
    r"HTTP Error (?:429|5\d\d)|timed? ?out|temporar|urlopen error|connection|no_deno",
    re.I,
)


def _passing_failure(cached: store.Row | None) -> bool:
    """A cache row an older build kept for a passing failure: fetched again rather than trusted."""
    if cached is None or cached["timed_transcript"] or cached["transcript"]:
        return False
    return bool(_PASSING.search(str(cached["error"] or "")))


def for_latest_video(
    conn: sqlite3.Connection,
    gemini: engine.GeminiCaller,
    channel_id: str,
    *,
    fetch: Fetch | None = None,
    timeout_s: int = 300,
) -> dict[str, Any] | None:
    """{video_id, title, published, auto_subtitles, moments, note?} for the channel's newest stored
    video, or None when the channel has no stored video. `moments` is empty when the video has no
    subtitles or the reading failed; `note` says which. `fetch` takes a video id
    (`transcript.fetch`, faked in tests)."""
    video = store.latest_video(conn, channel_id)
    if video is None:
        return None
    video_id: str = video["video_id"]
    published = str(video["published_at"] or "")[:10]
    cached = store.get_video_transcript(conn, video_id)
    if cached is None or _passing_failure(cached):
        if fetch is None:
            from gratovo_pipeline import transcript

            fetch = transcript.fetch
        fetched = fetch(video_id)
        if not fetched.get("transcript") and _PASSING.search(str(fetched.get("error") or "")):
            return {
                "video_id": video_id,
                "title": video["title"],
                "published": published,
                "auto_subtitles": None,
                "moments": [],
                "note": f"the subtitles could not be fetched just now ({fetched.get('error')}); "
                "the next draft tries again",
            }
        store.save_video_transcript(conn, video_id, channel_id, fetched)
        cached = store.get_video_transcript(conn, video_id)
        assert cached is not None  # noqa: S101 - just written
    result: dict[str, Any] = {
        "video_id": video_id,
        "title": video["title"],
        "published": published,
        "auto_subtitles": None if cached["is_asr"] is None else bool(cached["is_asr"]),
        "moments": [],
    }
    text = cached["timed_transcript"] or cached["transcript"]
    if not text:
        result["note"] = cached["error"] or "no caption track available"
        return result
    if cached["moments"] is not None:
        result["moments"] = json.loads(cached["moments"])
        return result
    prompt = PROMPT.format(
        skill=_skill_text(),
        title=video["title"] or "",
        uploaded=published,
        kind="automatic" if result["auto_subtitles"] else "written by the creator",
        transcript=_trim(text),
    )
    answer = engine._send(  # pyright: ignore[reportPrivateUsage]
        gemini,
        prompt,
        new_chat=True,
        skill=None,
        mode="",
        tab_id=None,
        timeout_s=timeout_s,
        thinking="high",
        ref=uuid.uuid4().hex[:10],
    )
    found = _parse(str(answer.get("textRaw") or answer.get("text") or ""))
    if found is None:
        result["note"] = (
            "the moments could not be read from Gemini's answer; the next draft asks again"
        )
        return result
    store.save_video_moments(conn, video_id, found)
    result["moments"] = found
    return result
