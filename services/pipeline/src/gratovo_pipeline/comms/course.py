"""The course, read-only: the lesson pages and the coach-call transcripts the playbook is built
from.

The course lives outside the repository (it is the owner's purchased content, plan D8): only on the
owner's PC, in the scraping toolkit's `course content` folder. The app passes its folders in at
start (`configure`, from the bridge's `--course-dir` and `--video-dir`); a tool a person runs by
hand may name them in `GRATOVO_COURSE_DIR` and `GRATOVO_VIDEO_DIR` instead. On a computer without
them the course is empty: `lessons()`, `calls()` and `videos()` return `{}`, `available()` is False,
and nothing raises. Three kinds of source:

  * lessons -- `pages clean text/<module>/<lesson>.txt`, the course's own written lessons. A
    lesson's id is its path under `pages clean text` without `.txt`, e.g. `module 2
    influencers/2.How to Message Influencers - Coach Ammar`.
  * calls -- `transcripts.json`, the Fathom transcripts of the coaching calls: segments that start
    with `@m:ss - Speaker Name`. A call's id is `call:<share_id>`. Module 7's pages are Fathom's AI
    summaries of the same calls; they index topics but are never quoted (they are not anybody's
    words).
  * videos -- the lesson videos (and the two 2026 Q&A recordings), transcribed with Parakeet TDT
    0.6B v2 (the video folder): timed pieces of up to 60 s (the first 45 files: longer). A video's
    id is `video:<lesson id>`, the lesson page it belongs to. Parakeet mishears the odd word, so a
    video quote also needs Whisper to hear the same words in that passage (comms/video_check.py);
    who says it is in playbook/videos.json.

Quotes are matched after `norm()`: case, curly quotes, dashes and whitespace do not count, so a
quote can be copied from the text as printed. Everything else must match."""

from __future__ import annotations

import json
import os
import re
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

LESSONS_DIRNAME = "pages clean text"
CALL_SUMMARIES_MODULE = "module 7 Call recordings"
COURSE_DIR_ENV = "GRATOVO_COURSE_DIR"
VIDEO_DIR_ENV = "GRATOVO_VIDEO_DIR"

_configured_course: Path | None = None
_configured_video: Path | None = None


def configure(course_dir: Path | None, video_dir: Path | None) -> None:
    """Where the course and its video transcripts are on this computer (None for not here).

    A folder given here wins over the environment; None falls back to it. Everything read from the
    old folders is forgotten.
    """
    global _configured_course, _configured_video
    _configured_course = Path(course_dir) if course_dir is not None else None
    _configured_video = Path(video_dir) if video_dir is not None else None
    clear_caches()


def clear_caches() -> None:
    for fn in (lessons, calls, videos, _video_index, _normed, _normed_turns):
        fn.cache_clear()


def _from_env(name: str) -> Path | None:
    value = os.environ.get(name)
    return Path(value) if value else None


def course_dir() -> Path | None:
    return _configured_course or _from_env(COURSE_DIR_ENV)


def video_dir() -> Path | None:
    return _configured_video or _from_env(VIDEO_DIR_ENV)


def available() -> bool:
    """Whether the course folder is on this computer (the lessons and calls can be read)."""
    root = course_dir()
    return root is not None and root.is_dir()


_QUOTES = str.maketrans(
    {
        "\u2018": "'",
        "\u2019": "'",
        "\u201a": "'",
        "\u201b": "'",
        "\u2032": "'",
        "\u201c": '"',
        "\u201d": '"',
        "\u201e": '"',
        "\u2033": '"',
        "\u2013": "-",
        "\u2014": "-",
        "\u2212": "-",
        "\u00a0": " ",
        "\u2026": "...",
    }
)


def norm(text: str) -> str:
    """Lowercase, straight quotes, plain dashes, one space; bidi marks and markdown emphasis
    dropped."""
    text = str(text or "").translate(_QUOTES)
    text = re.sub(r"[‎‏‪-‮⁦-⁩]", "", text)
    text = re.sub(r"[*_`#>]+", " ", text)
    return re.sub(r"\s+", " ", text).strip().lower()


@dataclass
class Lesson:
    id: str
    module: str
    title: str
    path: Path
    text: str
    coach: str | None = None  # "Coach Ammar" when the title names one

    @property
    def kind(self) -> str:
        return "lesson"


@dataclass
class Segment:
    at: str  # "12:40"
    speaker: str  # as Fathom labelled it (unreliable: verify against the coach roster)
    text: str


@dataclass
class Call:
    id: str
    title: str
    date: str
    text: str
    segments: list[Segment] = field(default_factory=list[Segment])

    @property
    def kind(self) -> str:
        return "call"

    @property
    def turns(self) -> list[Segment]:
        """Consecutive segments of the same speaker joined into one turn. Fathom starts a new
        timestamp line in the middle of one person's speech, and a verbatim quote can run across it
        (mined calls, 2026-10-15: most quotes "not found" were exactly that)."""
        out: list[Segment] = []
        for seg in self.segments:
            if out and out[-1].speaker == seg.speaker:
                out[-1] = Segment(
                    at=out[-1].at, speaker=seg.speaker, text=out[-1].text + " " + seg.text
                )
            else:
                out.append(Segment(at=seg.at, speaker=seg.speaker, text=seg.text))
        return out


@dataclass
class Piece:
    start: float  # seconds
    end: float
    text: str


@dataclass
class Video:
    id: str  # "video:<lesson id>"
    lesson: str  # the lesson page id (module 7 for the Q&A recordings, which have no lesson page)
    title: str
    file: str  # the video, relative to the course's `course videos` folder
    duration: float
    pieces: list[Piece] = field(default_factory=list[Piece])

    @property
    def kind(self) -> str:
        return "video"

    @property
    def text(self) -> str:
        return "\n".join(p.text for p in self.pieces)


type Doc = Lesson | Call | Video


def clock(seconds: float) -> str:
    """12:05, or 1:02:05 past an hour."""
    s = int(max(0.0, seconds))
    return (
        f"{s // 3600}:{s % 3600 // 60:02d}:{s % 60:02d}" if s >= 3600 else f"{s // 60}:{s % 60:02d}"
    )


_COACH_IN_TITLE = re.compile(r"(?:-|\u2013)\s*(Coach\s+[\w ]+?)\s*$")


@lru_cache(maxsize=1)
def lessons() -> dict[str, Lesson]:
    """Every lesson page except module 7's call summaries, by id ({} without the course)."""
    base = course_dir()
    out: dict[str, Lesson] = {}
    root = base / LESSONS_DIRNAME if base is not None else None
    if root is None or not root.is_dir():
        return out
    for module_dir in sorted(p for p in root.iterdir() if p.is_dir()):
        if module_dir.name == CALL_SUMMARIES_MODULE:
            continue
        for path in sorted(module_dir.glob("*.txt")):
            lesson_id = f"{module_dir.name}/{path.stem}"
            match = _COACH_IN_TITLE.search(path.stem)
            out[lesson_id] = Lesson(
                id=lesson_id,
                module=module_dir.name,
                title=path.stem,
                path=path,
                text=path.read_text(encoding="utf-8"),
                coach=match.group(1) if match else None,
            )
    return out


_SEGMENT = re.compile(r"^@(\d+:\d{2}(?::\d{2})?) - (.+?)\s*$", re.M)


def _segments(text: str) -> list[Segment]:
    marks = list(_SEGMENT.finditer(text))
    out: list[Segment] = []
    for i, m in enumerate(marks):
        end = marks[i + 1].start() if i + 1 < len(marks) else len(text)
        speaker = re.sub(r"\s*\([^)]*@[^)]*\)\s*$", "", m.group(2)).strip()  # drop "(email@…)"
        out.append(Segment(at=m.group(1), speaker=speaker, text=text[m.end() : end].strip()))
    return out


@lru_cache(maxsize=1)
def calls() -> dict[str, Call]:
    """Every call transcript, by `call:<share_id>` (34 MB of text: loaded once, on first use; {}
    without the course)."""
    base = course_dir()
    out: dict[str, Call] = {}
    path = base / "transcripts.json" if base is not None else None
    if path is None or not path.is_file():
        return out
    data: Any = json.loads(path.read_text(encoding="utf-8"))
    entries: dict[str, Any] = data.get("calls") or {}
    for key, entry in entries.items():
        text = entry.get("transcript") or ""
        if not text:
            continue
        share = entry.get("share_id") or key
        out[f"call:{share}"] = Call(
            id=f"call:{share}",
            title=entry.get("title") or "",
            date=entry.get("date") or "",
            text=text,
            segments=_segments(text),
        )
    return out


@lru_cache(maxsize=1)
def videos() -> dict[str, Video]:
    """Every transcribed video, by `video:<lesson id>`. Partial transcripts (`.partial.*`) are not
    sources. {} without the video folder."""
    out: dict[str, Video] = {}
    root = video_dir()
    if root is None or not root.is_dir():
        return out
    for path in sorted(root.rglob("*.mp4.json")):
        data: Any = json.loads(path.read_text(encoding="utf-8"))
        lesson = data.get("lesson")
        if not lesson:
            continue
        segments: list[Any] = data.get("segments") or []
        pieces = [
            Piece(float(s["start"]), float(s["end"]), str(s.get("text") or "").strip())
            for s in segments
        ]
        pieces = [p for p in pieces if p.text]
        out[f"video:{lesson}"] = Video(
            id=f"video:{lesson}",
            lesson=lesson,
            title=lesson.split("/", 1)[-1],
            file=str(data.get("video") or ""),
            duration=float(data.get("duration") or 0),
            pieces=pieces,
        )
    return out


def source(doc_id: str) -> Doc | None:
    """A lesson, a call or a video by id, or None."""
    if doc_id.startswith("call:"):
        return calls().get(doc_id)
    if doc_id.startswith("video:"):
        return videos().get(doc_id)
    return lessons().get(doc_id)


type _PieceIndex = tuple[tuple[int, int, Piece], ...]


@lru_cache(maxsize=256)
def _video_index(video_id: str) -> tuple[str, _PieceIndex]:
    """(normed text, [(char offset, length, piece)]): the pieces normed one by one and joined by a
    space, so a quote may run across two pieces and its place gives back a time."""
    video = videos().get(video_id)
    if not video:
        return "", ()
    parts: list[str] = []
    index: list[tuple[int, int, Piece]] = []
    pos = 0
    for piece in video.pieces:
        t = norm(piece.text)
        index.append((pos, len(t), piece))
        parts.append(t)
        pos += len(t) + 1
    return " ".join(parts), tuple(index)


@lru_cache(maxsize=4096)
def _normed(doc_id: str) -> str:
    if doc_id.startswith("video:"):
        return _video_index(doc_id)[0]
    doc = source(doc_id)
    return norm(doc.text) if doc else ""


def video_span(video_id: str, quote: str) -> tuple[float, float, float, float] | None:
    """(start, end, pieces_start, pieces_end) in seconds: where `quote` is said, estimated by its
    place inside the timed pieces (speech rate taken as even inside a piece), and the bounds of the
    pieces it lies in."""
    hay, index = _video_index(video_id)
    q = norm(quote)
    pos = hay.find(q) if q else -1
    if pos < 0:
        return None

    def at(c: int) -> tuple[float, Piece]:
        for off, n, piece in index:
            if off <= c <= off + n:
                return piece.start + (piece.end - piece.start) * ((c - off) / max(1, n)), piece
        _off, _n, piece = index[-1]
        return piece.end, piece

    t0, first = at(pos)
    t1, last = at(pos + len(q))
    return t0, t1, first.start, last.end


@lru_cache(maxsize=1024)
def _normed_turns(call_id: str) -> tuple[tuple[Segment, str], ...]:
    call = calls().get(call_id)
    return tuple((t, norm(t.text)) for t in call.turns) if call else ()


def contains(doc_id: str, quote: str) -> bool:
    """Whether `quote` is in the source (after `norm`); in a call it may also run across a timestamp
    line inside one speaker's turn (never across two speakers)."""
    q = norm(quote)
    if not q:
        return False
    if q in _normed(doc_id):
        return True
    return doc_id.startswith("call:") and any(q in text for _, text in _normed_turns(doc_id))


def context(doc_id: str, quote: str, chars: int = 600) -> str | None:
    """The source text around `quote` -- read it before building a rule on a quote."""
    doc = source(doc_id)
    if not doc:
        return None
    hay = _normed(doc_id)
    pos = hay.find(norm(quote))
    if pos < 0 and doc_id.startswith("call:"):  # a quote across a timestamp line: show its turn
        hay = next((text for _, text in _normed_turns(doc_id) if norm(quote) in text), "")
        pos = hay.find(norm(quote)) if hay else -1
    if pos < 0:
        return None
    return hay[max(0, pos - chars) : pos + len(norm(quote)) + chars]


def speaker_of(call_id: str, quote: str) -> Segment | None:
    """The transcript segment a call quote comes from (who said it, and when)."""
    call = calls().get(call_id)
    if not call:
        return None
    q = norm(quote)
    for seg in call.segments:
        if q in norm(seg.text):
            return seg
    for turn, text in _normed_turns(call_id):
        if q in text:
            return turn
    return None


def search(
    pattern: str, kinds: tuple[str, ...] = ("lesson",), limit: int = 50
) -> Iterator[tuple[str, str]]:
    """`(doc_id, snippet)` for every regex match (case-insensitive) in the chosen kinds of
    source."""
    rx = re.compile(pattern, re.I)
    n = 0
    pools: list[Iterable[Doc]] = []
    if "lesson" in kinds:
        pools.append(lessons().values())
    if "call" in kinds:
        pools.append(calls().values())
    if "video" in kinds:
        pools.append(videos().values())
    for pool in pools:
        for doc in pool:
            for m in rx.finditer(doc.text):
                yield doc.id, doc.text[max(0, m.start() - 160) : m.end() + 160].replace("\n", " ")
                n += 1
                if n >= limit:
                    return
