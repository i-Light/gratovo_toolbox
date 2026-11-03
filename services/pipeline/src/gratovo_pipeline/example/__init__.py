"""The example source (`source: "example"`): searches, channel details and uploads come from
`channels.json`, a made-up set of AI creators, and nothing touches the network. The Electron tests
run the real process on it, and a person can try Find without a key.

A keyword outside the fixture still finds three to six of its channels, the same ones every time,
so any keyword a person types gives a result.
"""

from __future__ import annotations

import dataclasses
import hashlib
import json
import time
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime, timedelta
from importlib import resources
from pathlib import Path
from typing import Any, Final

from gratovo_pipeline import run_control
from gratovo_pipeline.protocol import WaitReason, WaitSink, utc_iso
from gratovo_pipeline.search.context import Found
from gratovo_pipeline.youtube import ChannelInfo, VideoInfo

# A short pause per channel read, so a person (or a test) can watch the run and press Stop. Tests
# that don't need it set it to 0.
READ_PAUSE = 0.15

_DAY: Final = 86400


@dataclasses.dataclass(frozen=True)
class ExampleChannel:
    index: int
    channel_id: str
    handle: str
    name: str
    subscribers: int
    country: str
    description: str
    uploads: int
    views: int
    sponsor: str | None


def _load() -> tuple[dict[str, tuple[str, ...]], tuple[ExampleChannel, ...]]:
    text = resources.files(__package__).joinpath("channels.json").read_text(encoding="utf-8")
    data: dict[str, Any] = json.loads(text)
    channels = tuple(
        ExampleChannel(
            index=i,
            channel_id=f"UCexampleAiCreator{i:06d}",
            handle=c["handle"],
            name=c["name"],
            subscribers=c["subscribers"],
            country=c["country"],
            description=c["description"],
            uploads=min(15, c["uploads"]),
            views=c["views"],
            sponsor=c["sponsor"],
        )
        for i, c in enumerate(data["channels"])
    )
    keywords = {k: tuple(v) for k, v in data["keywords"].items()}
    return keywords, channels


# Made-up facts for the new fields (step S3): mostly English, a few other languages.
_OTHER_LANGUAGES: Final = {4: "es", 13: "pt", 22: "hi", 27: "es"}
_REGIONS: Final = {"en": "en-US", "es": "es-MX", "pt": "pt-BR", "hi": "hi-IN"}
_TOPICS: Final = ("Technology", "Knowledge", "Software", "Society", "Entertainment")


def _language(channel: ExampleChannel) -> str:
    return _OTHER_LANGUAGES.get(channel.index, "en")


def _topics(channel: ExampleChannel) -> list[str]:
    first = _TOPICS[channel.index % 3]  # Technology, Knowledge or Software
    return [first] if channel.index % 4 else [first, _TOPICS[3 + channel.index % 2]]


_RESULTS, CHANNELS = _load()
KEYWORDS: Final = tuple(_RESULTS)
_BY_HANDLE: Final = {c.handle: c for c in CHANNELS}
_BY_ID: Final = {c.channel_id: c for c in CHANNELS}


def _video_id(channel: ExampleChannel, n: int) -> str:
    return f"exv{channel.index:03d}{n:02d}"


def _video(channel: ExampleChannel, n: int, now: float) -> VideoInfo:
    sponsored = channel.sponsor is not None and n % 3 == 0
    code = channel.name.replace(" ", "").upper()[:10]
    description = (
        f"Sponsored by {channel.sponsor}. Use code {code} for 20% off."
        if sponsored
        else f"{channel.name}: what changed in AI this week."
    )
    views = str(channel.views * (70 + (n * 37 + channel.index * 11) % 60) // 100)
    published = time.strftime("%Y-%m-%dT15:00:00Z", time.gmtime(now - (n * 2 + 1) * _DAY))
    language = _language(channel)
    short = (n + channel.index) % 5 == 0
    return {
        "id": _video_id(channel, n),
        "Title": f"{channel.name} #{channel.uploads - n}: AI tools, tested",
        "Description": description,
        "Thumbnail": None,
        "Tags": ["ai"],
        "PublishedAt": published,
        "ViewCount": views,
        # Most videos name their audio language; every sixth leaves it out
        "AudioLanguage": None if (n + channel.index) % 6 == 0 else _REGIONS[language],
        "DefaultLanguage": language,
        "CategoryId": "28" if channel.index % 3 else "27",  # Science & Technology, Education
        "LiveContent": "none",
        "LikeCount": None if channel.index % 10 == 9 else str(int(views) // 25 + n),
        "CommentCount": None if channel.index % 10 == 9 else str(int(views) // 400 + n),
        "DurationS": 40 + n if short else 360 + (n * 97 + channel.index * 13) % 1200,
        "HasCaptions": int(n % 4 != 3),
        "MadeForKids": 0,
        "Topics": _topics(channel),
        "PaidPlacement": int(sponsored),
    }


class ExampleSweep:
    def recent_video_ids(self, channel_id: str, *, limit: int = 15) -> list[str]:
        run_control.sleep(READ_PAUSE)
        channel = _BY_ID.get(channel_id)
        if channel is None:
            return []
        return [_video_id(channel, n) for n in range(channel.uploads)][:limit]

    def close(self) -> None:
        pass


WAITS_ENV: Final = "GRATOVO_EXAMPLE_WAITS"


def test_waits(environ: Mapping[str, str]) -> dict[str, tuple[WaitReason, float]]:
    """The waits an end-to-end test asked for, as `{keyword: (reason, seconds)}`.

    `GRATOVO_EXAMPLE_WAITS` is `{"<keyword>": ["routes" | "quota" | "api", seconds], ...}`. The app
    puts it in the pipeline's environment only when unpackaged (`pipelineEnv`), and only the example
    source reads it, so a real run, a live source and an installed app never see it. Anything
    unreadable means no waits."""
    raw = environ.get(WAITS_ENV, "")
    if not raw:
        return {}
    try:
        data = json.loads(raw)
        waits: dict[str, tuple[WaitReason, float]] = {}
        for k, v in data.items():
            if v[0] == "routes" or v[0] == "quota" or v[0] == "api":
                waits[str(k).strip().lower()] = (v[0], float(v[1]))
        return waits
    except ValueError, TypeError, AttributeError, IndexError, KeyError:
        return {}


class ExampleSource:
    def __init__(
        self,
        waits: Mapping[str, tuple[WaitReason, float]] | None = None,
        sink: WaitSink | None = None,
        spent: Path | None = None,
    ) -> None:
        # `spent` lists the keywords that already rested, so a resumed run (a new process) goes on.
        used: set[str] = set()
        if spent is not None and spent.exists():
            used = set(spent.read_text(encoding="utf-8").splitlines())
        self._waits = {k: v for k, v in (waits or {}).items() if k not in used}
        self._spent = spent
        self._sink = sink

    def _rest(self, keyword: str) -> None:
        """Rests once for a keyword a test scripted: told as a wait, then a resume."""
        entry = self._waits.pop(keyword.strip().lower(), None)
        if entry is None or self._sink is None:
            return
        reason, seconds = entry
        if self._spent is not None:
            with self._spent.open("a", encoding="utf-8") as f:
                f.write(keyword.strip().lower() + chr(10))
        until = utc_iso(datetime.now(UTC) + timedelta(seconds=seconds))
        self._sink.wait(reason, until)
        try:
            run_control.sleep(seconds)
        finally:
            self._sink.resume(reason)

    def find_channels(self, keyword: str, *, limit: int) -> Found:
        self._rest(keyword)
        handles = _RESULTS.get(keyword.strip().lower()) or self._pick(keyword)
        shown = handles[:limit]
        return Found(
            {h: _BY_HANDLE[h].channel_id for h in shown},
            True,
            {_BY_HANDLE[h].channel_id: place for place, h in enumerate(shown, 1)},
        )

    def sweep(self, *, end_on_block: bool = False) -> ExampleSweep:
        return ExampleSweep()

    def channels(self, batch: Mapping[str, str]) -> dict[str, ChannelInfo]:
        found: dict[str, ChannelInfo] = {}
        for handle, channel_id in batch.items():
            channel = _BY_ID.get(channel_id)
            if channel is None:
                continue
            found[handle] = {
                "Name": channel.name,
                "Handle": handle,
                "Link": f"https://www.youtube.com/{handle}",
                "Channel_ID": channel_id,
                "Description": channel.description,
                "Subscribers": str(channel.subscribers),
                "Profile_Picture": None,
                "Banner": None,
                "Country": channel.country,
                "Total_Views": channel.views * channel.uploads * 4,
                "Video_Count": channel.uploads * 7 + channel.index,
                "Subscribers_Hidden": 0,
                "Started_At": f"{2016 + channel.index % 8}-0{1 + channel.index % 9}-15T10:00:00Z",
                "Default_Language": _language(channel),
                "Topics": _topics(channel),
                "Uploads_Playlist": "UU" + channel.channel_id[2:],
                "Made_For_Kids": 0,
            }
        return found

    def videos(self, video_ids: Sequence[str]) -> dict[str, VideoInfo]:
        now = time.time()
        found: dict[str, VideoInfo] = {}
        for video_id in video_ids:
            if len(video_id) != 8 or not video_id.startswith("exv"):
                continue
            index, n = int(video_id[3:6]), int(video_id[6:8])
            if index < len(CHANNELS) and n < CHANNELS[index].uploads:
                found[video_id] = _video(CHANNELS[index], n, now)
        return found

    @staticmethod
    def _pick(keyword: str) -> tuple[str, ...]:
        digest = hashlib.sha256(keyword.strip().lower().encode()).digest()
        count = 3 + digest[0] % 4
        picked: list[str] = []
        for byte in digest[1:]:
            handle = CHANNELS[byte % len(CHANNELS)].handle
            if handle not in picked:
                picked.append(handle)
            if len(picked) == count:
                break
        return tuple(picked)
