"""Reading channels out of YouTube's search results, and the live source around the scraper."""

from collections.abc import Generator, Iterator
from typing import Any

import pytest
from helpers import start_with

from gratovo_pipeline import net
from gratovo_pipeline.config import Config
from gratovo_pipeline.protocol import LogLevel
from gratovo_pipeline.scrapetube import scrapetube
from gratovo_pipeline.search import discover
from gratovo_pipeline.search.context import SearchBlockedError
from gratovo_pipeline.search.pacing import Pacer
from gratovo_pipeline.youtube import YouTubeApi


def video_item(handle: str, channel_id: str, *, short_byline: bool = True) -> dict[str, Any]:
    runs = [
        {
            "text": handle,
            "navigationEndpoint": {
                "browseEndpoint": {"browseId": channel_id, "canonicalBaseUrl": f"/{handle}"}
            },
        }
    ]
    key = "shortBylineText" if short_byline else "ownerText"
    return {"videoId": "v", key: {"runs": runs}}


def channel_item(handle: str, channel_id: str) -> dict[str, Any]:
    return {
        "channelId": channel_id,
        "navigationEndpoint": {"browseEndpoint": {"canonicalBaseUrl": f"/{handle}"}},
    }


# --- items ---


def test_a_video_result_names_its_uploader() -> None:
    assert discover.channel_from_item(video_item("@ai-tools-weekly", "UC1"), "video") == (
        "@ai-tools-weekly",
        "UC1",
    )
    assert discover.channel_from_item(
        video_item("@ai-tools-weekly", "UC1", short_byline=False), "video"
    ) == ("@ai-tools-weekly", "UC1")


def test_a_channel_result_names_itself() -> None:
    assert discover.channel_from_item(channel_item("@llm-explained", "UC2"), "channel") == (
        "@llm-explained",
        "UC2",
    )


@pytest.mark.parametrize(
    "item",
    [
        {},
        {"shortBylineText": {"runs": []}},
        # A legacy /channel/ URL has no handle to key on.
        video_item("channel/UC9", "UC9"),
        {"shortBylineText": {"runs": ["junk"]}},
    ],
)
def test_an_item_without_a_handle_and_id_is_skipped(item: dict[str, Any]) -> None:
    assert discover.channel_from_item(item, "video") is None


# --- the live source ---


class Recorder:
    def __init__(self) -> None:
        self.lines: list[tuple[LogLevel, str]] = []

    def log(self, level: LogLevel, text: str) -> None:
        self.lines.append((level, text))


@pytest.fixture
def rec() -> Recorder:
    return Recorder()


def live(rec: Recorder) -> discover.LiveSource:
    cfg = Config.from_start(start_with(source="live"))
    return discover.LiveSource(cfg, YouTubeApi("example-key"), Pacer.off(), log=rec.log)


class FakeSearch:
    """Stands in for scrapetube.get_search: yields items, then raises `then` if given."""

    def __init__(self, *items: dict[str, Any], then: BaseException | None = None) -> None:
        self.items = items
        self.then = then
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def __call__(self, query: str, **kwargs: Any) -> Generator[dict[str, Any]]:
        self.calls.append((query, kwargs))
        yield from self.items
        if self.then:
            raise self.then


def test_finding_channels_dedupes_by_handle_and_passes_the_rules(
    monkeypatch: pytest.MonkeyPatch, rec: Recorder
) -> None:
    fake = FakeSearch(
        video_item("@ai-tools-weekly", "UC1"),
        video_item("@ai-tools-weekly", "UC1"),
        video_item("@llm-explained", "UC2"),
    )
    monkeypatch.setattr(scrapetube, "get_search", fake)

    found = live(rec).find_channels("claude code tutorial", limit=50)

    assert found == {"@ai-tools-weekly": "UC1", "@llm-explained": "UC2"}
    ((query, kwargs),) = fake.calls
    assert query == "claude code tutorial"
    assert (kwargs["limit"], kwargs["sort_by"], kwargs["results_type"]) == (
        50,
        "upload_date",
        "video",
    )


def test_progress_is_told_every_twenty_results(
    monkeypatch: pytest.MonkeyPatch, rec: Recorder
) -> None:
    items = [video_item(f"@ai-creator-{i}", f"UC{i}") for i in range(41)]
    monkeypatch.setattr(scrapetube, "get_search", FakeSearch(*items))
    live(rec).find_channels("ai agents", limit=100)
    assert [text for _, text in rec.lines] == [
        "Scanned 20 search results, 20 channel(s) so far.",
        "Scanned 40 search results, 40 channel(s) so far.",
    ]


def test_a_block_ends_the_search_as_blocked(monkeypatch: pytest.MonkeyPatch, rec: Recorder) -> None:
    then = scrapetube.BlockedError("YouTube is refusing requests")
    monkeypatch.setattr(scrapetube, "get_search", FakeSearch(then=then))
    with pytest.raises(SearchBlockedError):
        live(rec).find_channels("ai agents", limit=10)


def test_a_host_outside_the_rule_is_never_swallowed(
    monkeypatch: pytest.MonkeyPatch, rec: Recorder
) -> None:
    then = net.HostNotAllowedError("the pipeline may not reach elsewhere.example")
    monkeypatch.setattr(scrapetube, "get_search", FakeSearch(then=then))
    with pytest.raises(net.HostNotAllowedError):
        live(rec).find_channels("ai agents", limit=10)


def test_another_error_keeps_what_was_found_and_names_only_its_kind(
    monkeypatch: pytest.MonkeyPatch, rec: Recorder
) -> None:
    then = RuntimeError("proxy https://user:secret@proxy.example:8080 refused")
    fake = FakeSearch(video_item("@ai-tools-weekly", "UC1"), then=then)
    monkeypatch.setattr(scrapetube, "get_search", fake)

    assert live(rec).find_channels("ai agents", limit=10) == {"@ai-tools-weekly": "UC1"}
    assert rec.lines == [("warn", "The search stopped early (RuntimeError).")]


class FakeSession:
    def __init__(self) -> None:
        self.closed = False

    def close(self) -> None:
        self.closed = True


def test_a_sweep_reads_uploads_on_one_session(
    monkeypatch: pytest.MonkeyPatch, rec: Recorder
) -> None:
    session = FakeSession()
    seen: list[tuple[str, Any]] = []

    def fake_channel(**kwargs: Any) -> Iterator[dict[str, Any]]:
        seen.append((kwargs["channel_url"], kwargs["session"]))
        assert kwargs["limit"] == 15  # the 15-video window stays (the on-hold gap search-1)
        return iter([{"videoId": "a"}, {"videoId": "b"}, {"noId": 1}])

    monkeypatch.setattr(scrapetube, "get_session", lambda: session)
    monkeypatch.setattr(scrapetube, "get_channel", fake_channel)

    sweep = live(rec).sweep()
    assert sweep.recent_video_ids("@ai-tools-weekly") == ["a", "b"]
    assert sweep.recent_video_ids("@llm-explained") == ["a", "b"]
    sweep.close()

    assert [url for url, _ in seen] == [
        "https://www.youtube.com/@ai-tools-weekly",
        "https://www.youtube.com/@llm-explained",
    ]
    assert all(s is session for _, s in seen)
    assert session.closed


def test_a_sweep_read_that_fails_is_an_empty_list_unless_blocked(
    monkeypatch: pytest.MonkeyPatch, rec: Recorder
) -> None:
    monkeypatch.setattr(scrapetube, "get_session", FakeSession)

    def broken(**_kwargs: Any) -> Iterator[dict[str, Any]]:
        raise ValueError("bad page")

    monkeypatch.setattr(scrapetube, "get_channel", broken)
    assert live(rec).sweep().recent_video_ids("@ai-tools-weekly") == []
    assert rec.lines == [("warn", "Couldn't read @ai-tools-weekly's uploads (ValueError).")]

    def blocked(**_kwargs: Any) -> Iterator[dict[str, Any]]:
        raise scrapetube.BlockedError("blocked")

    monkeypatch.setattr(scrapetube, "get_channel", blocked)
    with pytest.raises(SearchBlockedError):
        live(rec).sweep().recent_video_ids("@ai-tools-weekly")
