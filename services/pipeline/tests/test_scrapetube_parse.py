"""Reading YouTube's pages: a search on canned HTML through a fake session, and the item shapes
YouTube mixes (`lockupViewModel` and the older `videoRenderer`)."""

import json
from collections.abc import Mapping
from typing import Any

import pytest

from gratovo_pipeline.protocol import LogLevel
from gratovo_pipeline.scrapetube import scrapetube

INITIAL_DATA: dict[str, Any] = {
    "contents": {
        "sectionListRenderer": {
            "contents": [
                {
                    "videoRenderer": {
                        "videoId": "v1",
                        "ownerText": {"runs": [{"text": "AI Tools Weekly"}]},
                    }
                },
                {
                    "lockupViewModel": {
                        "contentId": "v2",
                        "contentType": "LOCKUP_CONTENT_TYPE_VIDEO",
                    }
                },
                {
                    "lockupViewModel": {
                        "contentId": "PL9",
                        "contentType": "LOCKUP_CONTENT_TYPE_PLAYLIST",
                    }
                },
            ]
        }
    }
}

PAGE = (
    '<html><script>ytcfg.set({"INNERTUBE_CONTEXT": {"client": {"clientName": "WEB", '
    '"clientVersion": "2.20261001"}},"x":1});"innertubeApiKey":"page-key","a":1;'
    f"var ytInitialData = {json.dumps(INITIAL_DATA)};</script></html>"
)


class PageResponse:
    def __init__(self, url: str) -> None:
        self.status_code = 200
        self.url = url
        self.headers: Mapping[str, str] = {"content-type": "text/html"}
        self.text = PAGE

    def json(self) -> Any:
        return {}


class PageSession:
    def __init__(self) -> None:
        self.urls: list[str] = []
        self.proxies: dict[str, str] = {}
        self.headers: dict[str, str] = {}
        self.closed = False

    def request(self, _method: str, url: str, **_kwargs: Any) -> PageResponse:
        self.urls.append(url)
        return PageResponse(url)

    def close(self) -> None:
        self.closed = True


def quiet(_level: LogLevel, _text: str) -> None:
    pass


@pytest.fixture
def session(monkeypatch: pytest.MonkeyPatch) -> PageSession:
    monkeypatch.setattr(scrapetube, "_log", quiet)
    return PageSession()


def test_a_search_reads_the_videos_from_the_first_page(session: PageSession) -> None:
    items = list(
        scrapetube.get_search(
            "ai agents", limit=10, sleep=(0, 0), sort_by="upload_date", session=session
        )
    )
    # lockupViewModel items first (a playlist lockup has no videoId), then videoRenderer ones.
    assert [item.get("videoId") for item in items] == ["v2", None, "v1"]
    assert session.urls == ["https://www.youtube.com/results?search_query=ai+agents&sp=CAISAhAB"]
    assert session.headers["X-YouTube-Client-Version"] == "2.20261001"


def test_the_limit_stops_the_search(session: PageSession) -> None:
    assert len(list(scrapetube.get_search("ai", limit=1, sleep=(0, 0), session=session))) == 1


def test_a_search_query_is_url_encoded(session: PageSession) -> None:
    list(scrapetube.get_search("claude & gpt?", limit=1, sleep=(0, 0), session=session))
    assert session.urls[0].startswith(
        "https://www.youtube.com/results?search_query=claude+%26+gpt%3F&sp="
    )


def test_a_session_the_caller_passed_is_left_open(session: PageSession) -> None:
    list(scrapetube.get_search("ai", limit=1, sleep=(0, 0), session=session))
    assert not session.closed


def test_a_lockup_item_gains_a_video_id_only_when_it_is_a_video() -> None:
    video = scrapetube.normalize_item(
        {"contentId": "v2", "contentType": "LOCKUP_CONTENT_TYPE_VIDEO"}
    )
    playlist = scrapetube.normalize_item(
        {"contentId": "PL9", "contentType": "LOCKUP_CONTENT_TYPE_PLAYLIST"}
    )
    assert video["videoId"] == "v2"
    assert "videoId" not in playlist


def test_search_dict_finds_a_key_at_any_depth_breadth_first() -> None:
    data = {"a": [{"x": {"target": 2}}], "target": 1}
    assert list(scrapetube.search_dict(data, "target")) == [1, 2]


def test_the_next_page_comes_from_the_continuation() -> None:
    data = {
        "continuationEndpoint": {"continuationCommand": {"token": "T"}, "clickTrackingParams": "C"}
    }
    assert scrapetube.get_next_data(data) == {
        "token": "T",
        "click_params": {"clickTrackingParams": "C"},
    }
    assert scrapetube.get_next_data({}) is None
