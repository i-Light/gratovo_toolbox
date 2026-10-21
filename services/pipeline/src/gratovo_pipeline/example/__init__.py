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
from importlib import resources
from typing import Any, Final

from gratovo_pipeline import run_control
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
    published = time.strftime("%Y-%m-%dT15:00:00Z", time.gmtime(now - (n * 2 + 1) * _DAY))
    return {
        "id": _video_id(channel, n),
        "Title": f"{channel.name} #{channel.uploads - n}: AI tools, tested",
        "Description": description,
        "Thumbnail": None,
        "Tags": ["ai"],
        "PublishedAt": published,
        "ViewCount": str(channel.views * (70 + (n * 37 + channel.index * 11) % 60) // 100),
    }


class ExampleSweep:
    def recent_video_ids(self, handle: str) -> list[str]:
        run_control.sleep(READ_PAUSE)
        channel = _BY_HANDLE.get(handle)
        if channel is None:
            return []
        return [_video_id(channel, n) for n in range(channel.uploads)]

    def close(self) -> None:
        pass


class ExampleSource:
    def find_channels(self, keyword: str, *, limit: int) -> dict[str, str]:
        handles = _RESULTS.get(keyword.strip().lower()) or self._pick(keyword)
        return {h: _BY_HANDLE[h].channel_id for h in handles[:limit]}

    def sweep(self) -> ExampleSweep:
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
