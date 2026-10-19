"""Fetch a YouTube video's transcript for outreach personalization.

Free: yt-dlp reads the caption tracks YouTube already publishes. No API key,
no Data API quota, no third-party service, no per-call cost. What it gets is
exactly what YouTube itself has, so there is no quality loss relative to any
paid transcription of the same audio track.

Deliberately NOT wired into the search pipeline. Transcripts are fetched for
one channel at a time, at the moment you decide to reach out to it, for the
last video or a video you picked by hand. Fetching them for every discovered
channel would be a large amount of work for videos you will never write about.

    python tools/transcript.py https://www.youtube.com/watch?v=VruF9Z6WrGg
    python tools/transcript.py VruF9Z6WrGg --json
    python tools/transcript.py @somehandle --latest

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
import subprocess
import sys
import tempfile
from pathlib import Path

# Manually-written captions first: a human wrote those, so proper nouns are
# spelled correctly. Only fall back to the ASR track when there is no
# human-authored one.
_MANUAL_LANGS = ["en", "en-US", "en-GB", "en-orig"]
_AUTO_LANGS = ["en", "en-US", "en-GB"]

_YT_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")


def _video_url(target: str) -> str:
    """Accepts a full URL, a bare 11-character video id, or a watch id."""
    if target.startswith(("http://", "https://")):
        return target
    if _YT_ID.match(target):
        return f"https://www.youtube.com/watch?v={target}"
    raise SystemExit(
        f"Not a video URL or an 11-character video id: {target!r}\n"
        "For a channel handle, pass --latest with the channel URL."
    )


def _run_ytdlp(args: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["yt-dlp", *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def latest_video_url(channel_url: str) -> str | None:
    """The most recent upload on a channel, without downloading anything."""
    if not channel_url.startswith("http"):
        channel_url = f"https://www.youtube.com/{channel_url.lstrip('/')}"
    if not channel_url.rstrip("/").endswith("/videos"):
        channel_url = channel_url.rstrip("/") + "/videos"

    result = _run_ytdlp(
        [
            "--flat-playlist",
            "--playlist-end", "1",
            "--print", "%(id)s",
            "--no-warnings",
            channel_url,
        ]
    )
    for line in result.stdout.splitlines():
        line = line.strip()
        if _YT_ID.match(line):
            return f"https://www.youtube.com/watch?v={line}"
    return None


def _segments_to_text(payload: dict) -> str:
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
    for event in payload.get("events", []):
        segs = event.get("segs")
        if not segs:
            continue
        events.append("".join(seg.get("utf8", "") for seg in segs))
    text = " ".join(events).replace("\n", " ")
    return " ".join(text.split())


def _clock(ms: int) -> str:
    seconds = int(ms // 1000)
    hours, rest = divmod(seconds, 3600)
    minutes, seconds = divmod(rest, 60)
    return f"{hours}:{minutes:02d}:{seconds:02d}" if hours else f"{minutes}:{seconds:02d}"


def _segments_to_timed_text(payload: dict, every_ms: int = 30_000) -> str:
    """The same flat text as `_segments_to_text`, with a [m:ss] mark at the
    start and then before the first caption at least `every_ms` after the last
    mark -- so a moment worth quoting can be given with where it is in the
    video ("at 7:40"), without a mark on every line."""
    parts: list[str] = []
    last_mark = None
    for event in payload.get("events", []):
        segs = event.get("segs")
        if not segs:
            continue
        text = "".join(seg.get("utf8", "") for seg in segs).replace("\n", " ")
        if not text.strip():
            continue
        start = int(event.get("tStartMs") or 0)
        if last_mark is None or start - last_mark >= every_ms:
            parts.append(f"[{_clock(start)}]")
            last_mark = start
        parts.append(text)
    return " ".join(" ".join(parts).split())


def fetch(url: str) -> dict:
    """Returns {video_id, title, description, is_asr, transcript, word_count}.

    `transcript` is None when the video has no caption track at all, which is
    the signal to fall back to letting the model watch the video itself.
    """
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "sub"

        meta = _run_ytdlp(
            ["--skip-download", "--print", "%(id)s\t%(title)s", "--no-warnings", url]
        )
        video_id, _, title = (meta.stdout.strip().partition("\t"))

        # Two passes rather than one: --write-subs and --write-auto-subs in the
        # same call gives no way to tell which track landed on disk, and that
        # distinction is the whole point of `is_asr`.
        is_asr = False
        result = _run_ytdlp(
            [
                "--skip-download", "--write-subs",
                "--sub-langs", ",".join(_MANUAL_LANGS),
                "--sub-format", "json3",
                "--no-warnings",
                "-o", str(out.with_suffix("")) + ".%(ext)s",
                url,
            ]
        )
        found = sorted(Path(tmp).glob("*.json3"))
        if not found:
            is_asr = True
            result = _run_ytdlp(
                [
                    "--skip-download", "--write-auto-subs",
                    "--sub-langs", ",".join(_AUTO_LANGS),
                    "--sub-format", "json3",
                    "--no-warnings",
                    "-o", str(out.with_suffix("")) + ".%(ext)s",
                    url,
                ]
            )
            found = sorted(Path(tmp).glob("*.json3"))

        if not found:
            return {
                "video_id": video_id or None,
                "title": title or None,
                "is_asr": None,
                "transcript": None,
                "word_count": 0,
                "error": "no caption track available "
                         f"({result.stderr.strip().splitlines()[-1] if result.stderr.strip() else 'captions disabled'})",
            }

        payload = json.loads(found[0].read_text(encoding="utf-8"))
        text = _segments_to_text(payload)
        return {
            "video_id": video_id or None,
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
    parser.add_argument("target", help="video URL, 11-char video id, or channel URL with --latest")
    parser.add_argument("--latest", action="store_true",
                        help="treat target as a channel and take its most recent upload")
    parser.add_argument("--json", action="store_true", help="emit the full object as JSON")
    parser.add_argument("--max-words", type=int, default=0,
                        help="trim the transcript to roughly this many words (0 = no trim)")
    args = parser.parse_args()

    if args.latest:
        url = latest_video_url(args.target)
        if not url:
            print("Could not resolve a latest video for that channel.", file=sys.stderr)
            return 1
    else:
        url = _video_url(args.target)

    data = fetch(url)
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
