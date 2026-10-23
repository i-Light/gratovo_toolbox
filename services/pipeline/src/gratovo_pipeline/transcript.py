"""Fetch a YouTube video's transcript for outreach personalization (ported from legacy
`tools/transcript.py`).

Free: yt-dlp reads the caption tracks YouTube already publishes. No API key,
no Data API quota, no third-party service, no per-call cost. What it gets is
exactly what YouTube itself has, so there is no quality loss relative to any
paid transcription of the same audio track.

Deliberately NOT wired into the search pipeline. Transcripts are fetched for
one channel at a time, at the moment you decide to reach out to it, for the
last video or a video you picked by hand. Fetching them for every discovered
channel would be a large amount of work for videos you will never write about.

    python -m gratovo_pipeline.transcript https://www.youtube.com/watch?v=VruF9Z6WrGg
    python -m gratovo_pipeline.transcript VruF9Z6WrGg --json

yt-dlp makes its own requests, which `net.py` can't check (the exception plan D12 records). So it
is only ever given a watch URL built here from a checked 11-character video id, and it runs as a
module of this Python (`-I`: no user site, no `PYTHON*` variables) with no config files, no
plugins and no cache, in the environment the bridge was started with. It needs Deno for YouTube's
player code; without one, `fetch` says `no_deno` and runs nothing (Deno is packaged in step 3h).
The old `--latest` (a channel's newest upload) is gone: it handed yt-dlp a channel URL, and moments
takes the latest video from pipeline.db instead.

A CAVEAT THAT MATTERS FOR THE EMAIL: auto-generated captions are speech-to-
text. They mangle proper nouns badly. The channel "n8n" comes back as "NAN"
throughout its own video. Manually-uploaded captions (`is_asr: false` in the
JSON output) do not have this problem. The drafter prompt is told never to
spell a proper noun from a transcript, but the `is_asr` flag is there so a
caller can weight the transcript accordingly.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Final
from urllib.parse import parse_qs, urlsplit

# Manually-written captions first: a human wrote those, so proper nouns are
# spelled correctly. Only fall back to the ASR track when there is no
# human-authored one.
_MANUAL_LANGS: Final = ["en", "en-US", "en-GB", "en-orig"]
_AUTO_LANGS: Final = ["en", "en-US", "en-GB"]

_YT_ID: Final = re.compile(r"[A-Za-z0-9_-]{11}")

# This Python's yt-dlp, isolated: no `yt-dlp` from PATH, no user config, no plugins, no cache.
_YT_DLP: Final = [
    sys.executable,
    "-I",
    "-m",
    "yt_dlp",
    "--ignore-config",
    "--no-cache-dir",
    "--no-plugin-dirs",
]


def watch_url(video_id: str) -> str:
    """The only URL yt-dlp is ever given. Raises ValueError for anything but a video id."""
    if not _YT_ID.fullmatch(video_id):
        raise ValueError("not an 11-character video id")
    return f"https://www.youtube.com/watch?v={video_id}"


def _video_id(target: str) -> str:
    """The command line's target: a bare 11-character video id, or a watch URL (youtube.com/watch?v=
    or youtu.be/) to take the id from."""
    if _YT_ID.fullmatch(target):
        return target
    parts = urlsplit(target)
    host = (parts.hostname or "").lower()
    found = ""
    if host in {"www.youtube.com", "youtube.com", "m.youtube.com"} and parts.path == "/watch":
        found = (parse_qs(parts.query).get("v") or [""])[0]
    elif host == "youtu.be":
        found = parts.path.strip("/")
    if _YT_ID.fullmatch(found):
        return found
    raise SystemExit(f"Not a video URL or an 11-character video id: {target!r}")


# One yt-dlp call may take this long. A hung one would hold the bridge's action (and the page lock)
# forever; past this it counts as a passing failure ("timed out"), so the next draft tries again.
YT_DLP_TIMEOUT_S = 120


def _run_ytdlp(args: list[str]) -> subprocess.CompletedProcess[str]:
    argv = [*_YT_DLP, *args]
    try:
        return subprocess.run(  # noqa: S603 - fixed argv: this Python, yt-dlp's flags, a checked URL
            argv,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
            timeout=YT_DLP_TIMEOUT_S,
        )
    except subprocess.TimeoutExpired:
        return subprocess.CompletedProcess(argv, -1, "", "ERROR: yt-dlp timed out")


def _events(payload: dict[str, Any]) -> list[dict[str, Any]]:
    events: object = payload.get("events")
    if not isinstance(events, list):
        return []
    return [e for e in events if isinstance(e, dict)]  # pyright: ignore[reportUnknownVariableType]


def _event_text(event: dict[str, Any]) -> str | None:
    segs: object = event.get("segs")
    if not segs or not isinstance(segs, list):
        return None
    return "".join(
        str(seg.get("utf8", ""))  # pyright: ignore[reportUnknownMemberType, reportUnknownArgumentType]
        for seg in segs  # pyright: ignore[reportUnknownVariableType]
        if isinstance(seg, dict)
    )


def _segments_to_text(payload: dict[str, Any]) -> str:
    """json3 caption format -> one flat string.

    Every segment is concatenated, including the `aAppend` events. Those hold
    the "\\n" that separates one on-screen caption line from the next, and
    dropping them welds the last word of each line onto the first word of the
    following one ("and in" + "this video" -> "and inthis video"). Since the
    whole point of a transcript here is that the model can quote it back
    accurately, a corrupted word is worse than a long string.

    json3 is chosen over VTT precisely because it does not carry the rolling
    duplicates that make scrolling auto-captions repeat themselves, so no
    de-duplication is needed on this path.

    Segments WITHIN one event are concatenated directly, because the two
    caption flavours split them differently and both already carry their own
    spacing: an ASR track emits one word per segment with a leading space
    ("Hey", " there,"), while a human-authored track puts a whole two-line
    block in a single segment. Events are then joined WITH a space, because
    nothing separates one caption block from the next -- a manual track whose
    events run "...what each" then "of these..." welds into "eachof" if you
    concatenate straight through.
    """
    events: list[str] = []
    for event in _events(payload):
        text = _event_text(event)
        if text is None:
            continue
        events.append(text)
    text = " ".join(events).replace("\n", " ")
    return " ".join(text.split())


def _clock(ms: int) -> str:
    seconds = int(ms // 1000)
    hours, rest = divmod(seconds, 3600)
    minutes, seconds = divmod(rest, 60)
    return f"{hours}:{minutes:02d}:{seconds:02d}" if hours else f"{minutes}:{seconds:02d}"


def _segments_to_timed_text(payload: dict[str, Any], every_ms: int = 30_000) -> str:
    """The same flat text as `_segments_to_text`, with a [m:ss] mark at the
    start and then before the first caption at least `every_ms` after the last
    mark -- so a moment worth quoting can be given with where it is in the
    video ("at 7:40"), without a mark on every line."""
    parts: list[str] = []
    last_mark: int | None = None
    for event in _events(payload):
        raw = _event_text(event)
        if raw is None:
            continue
        text = raw.replace("\n", " ")
        if not text.strip():
            continue
        start = int(event.get("tStartMs") or 0)
        if last_mark is None or start - last_mark >= every_ms:
            parts.append(f"[{_clock(start)}]")
            last_mark = start
        parts.append(text)
    return " ".join(" ".join(parts).split())


def fetch(video_id: str) -> dict[str, Any]:
    """Returns {video_id, title, description, is_asr, transcript, word_count}.

    `transcript` is None when the video has no caption track at all, which is
    the signal to fall back to letting the model watch the video itself. Raises
    ValueError, before anything runs, for anything but an 11-character video id.
    """
    url = watch_url(video_id)
    if shutil.which("deno") is None:
        # yt-dlp can't read YouTube's player code without it (plan D12; packaged in step 3h).
        return {
            "video_id": video_id,
            "title": None,
            "is_asr": None,
            "transcript": None,
            "word_count": 0,
            "error": "no_deno",
        }
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "sub"

        meta = _run_ytdlp(["--skip-download", "--print", "%(id)s\t%(title)s", "--no-warnings", url])
        found_id, _, title = meta.stdout.strip().partition("\t")

        # Two passes rather than one: --write-subs and --write-auto-subs in the
        # same call gives no way to tell which track landed on disk, and that
        # distinction is the whole point of `is_asr`.
        is_asr = False
        result = _run_ytdlp(
            [
                "--skip-download",
                "--write-subs",
                "--sub-langs",
                ",".join(_MANUAL_LANGS),
                "--sub-format",
                "json3",
                "--no-warnings",
                "-o",
                str(out.with_suffix("")) + ".%(ext)s",
                url,
            ]
        )
        found = sorted(Path(tmp).glob("*.json3"))
        if not found:
            is_asr = True
            result = _run_ytdlp(
                [
                    "--skip-download",
                    "--write-auto-subs",
                    "--sub-langs",
                    ",".join(_AUTO_LANGS),
                    "--sub-format",
                    "json3",
                    "--no-warnings",
                    "-o",
                    str(out.with_suffix("")) + ".%(ext)s",
                    url,
                ]
            )
            found = sorted(Path(tmp).glob("*.json3"))

        if not found:
            stderr = result.stderr.strip()
            reason = stderr.splitlines()[-1] if stderr else "captions disabled"
            return {
                "video_id": found_id or None,
                "title": title or None,
                "is_asr": None,
                "transcript": None,
                "word_count": 0,
                "error": f"no caption track available ({reason})",
            }

        loaded: object = json.loads(found[0].read_text(encoding="utf-8"))
        payload: dict[str, Any] = loaded if isinstance(loaded, dict) else {}  # pyright: ignore[reportUnknownVariableType]
        text = _segments_to_text(payload)
        return {
            "video_id": found_id or None,
            "title": title or None,
            "is_asr": is_asr,
            "transcript": text,
            "timed_transcript": _segments_to_timed_text(payload),
            "word_count": len(text.split()),
        }


def trim(text: str, max_words: int) -> str:
    """Head plus tail, because a video's thesis is stated at the top and its
    conclusions at the bottom; the middle is where the filler lives."""
    words = text.split()
    if len(words) <= max_words:
        return text
    head = int(max_words * 0.7)
    tail = max_words - head
    return " ".join(words[:head]) + " [...] " + " ".join(words[-tail:])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", help="video URL or 11-char video id")
    parser.add_argument("--json", action="store_true", help="emit the full object as JSON")
    parser.add_argument(
        "--max-words",
        type=int,
        default=0,
        help="trim the transcript to roughly this many words (0 = no trim)",
    )
    args = parser.parse_args()

    data = fetch(_video_id(args.target))
    if args.max_words and data.get("transcript"):
        data["transcript"] = trim(data["transcript"], args.max_words)
        data["trimmed"] = True

    if args.json:
        print(json.dumps(data, ensure_ascii=False, indent=2))
        return 0 if data.get("transcript") else 1

    if not data.get("transcript"):
        print(f"No transcript: {data.get('error')}", file=sys.stderr)
        return 1
    print(data["transcript"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
