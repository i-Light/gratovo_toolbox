"""The YouTube Data API client over a fake opener: what it sends, what it reads back, and the
name each failure gets."""

import io
import json
from email.message import Message
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlsplit
from urllib.request import Request

import pytest

from gratovo_pipeline import youtube
from gratovo_pipeline.protocol import LogLevel
from gratovo_pipeline.youtube import YouTubeApi, YouTubeError

KEY = "example-key-not-real"

type Answer = object  # a JSON-able body, or an exception to raise


class FakeOpener:
    def __init__(self, *answers: Answer) -> None:
        self.answers = list(answers)
        self.requests: list[Request] = []
        self.timeouts: list[float] = []

    def __call__(self, request: Request, timeout: float) -> io.BytesIO:
        self.requests.append(request)
        self.timeouts.append(timeout)
        answer = self.answers.pop(0)
        if isinstance(answer, BaseException):
            raise answer
        return io.BytesIO(json.dumps(answer).encode())

    def query(self, index: int = 0) -> dict[str, list[str]]:
        return parse_qs(urlsplit(self.requests[index].full_url).query)


def http_error(code: int, *reasons: str, detail: str | None = None) -> HTTPError:
    error: dict[str, object] = {
        "code": code,
        "message": "a message from Google",
        "errors": [{"reason": r, "domain": "youtube.quota"} for r in reasons],
    }
    if detail:
        error["details"] = [{"@type": "type.googleapis.com/google.rpc.ErrorInfo", "reason": detail}]
    body = io.BytesIO(json.dumps({"error": error}).encode())
    return HTTPError("https://www.googleapis.com/youtube/v3/x", code, "error", Message(), body)


CHANNEL = {
    "id": "UCaitools00000000000000a",
    "snippet": {
        "title": "AI Tools Weekly",
        "description": "Reviews of AI agents. Business: hello@aitoolsweekly.example",
        "country": "US",
        "thumbnails": {"high": {"url": "https://yt3.example/ai.jpg"}},
    },
    "statistics": {"subscriberCount": "48200"},
    "brandingSettings": {"image": {"bannerExternalUrl": "https://yt3.example/banner.jpg"}},
}

VIDEO = {
    "id": "vid00000001",
    "snippet": {
        "title": "I tested 5 AI coding agents",
        "description": "Sponsored by AgentForge. Use code AITOOLS",
        "tags": ["ai agents", "coding"],
        "publishedAt": "2026-10-01T12:00:00Z",
        "thumbnails": {
            "high": {"url": "https://i.ytimg.example/high.jpg"},
            "maxres": {"url": "https://i.ytimg.example/maxres.jpg"},
        },
    },
    "statistics": {"viewCount": "120345"},
}


class Recorder:
    def __init__(self) -> None:
        self.lines: list[tuple[LogLevel, str]] = []
        self.waits: list[float] = []

    def log(self, level: LogLevel, text: str) -> None:
        self.lines.append((level, text))

    def sleep(self, seconds: float) -> None:
        self.waits.append(seconds)


@pytest.fixture
def rec() -> Recorder:
    return Recorder()


def api(opener: FakeOpener, rec: Recorder) -> YouTubeApi:
    return YouTubeApi(KEY, opener=opener, sleep=rec.sleep, log=rec.log)


# --- what it sends ---


def test_the_key_goes_in_a_header_never_the_url(rec: Recorder) -> None:
    opener = FakeOpener({"items": []})
    api(opener, rec).channels({"@aitools": "UCaitools00000000000000a"})
    request = opener.requests[0]
    assert KEY not in request.full_url
    assert "key" not in opener.query()
    # Unredirected: urllib would copy an ordinary header onto a redirect to another host.
    assert request.unredirected_hdrs.get("X-goog-api-key") == KEY
    assert "X-goog-api-key" not in request.headers


def test_channels_are_asked_for_in_one_batched_call(rec: Recorder) -> None:
    opener = FakeOpener({"items": []})
    api(opener, rec).channels({"@a": "UCa", "@b": "UCb"})
    url = urlsplit(opener.requests[0].full_url)
    assert (url.scheme, url.netloc, url.path) == (
        "https",
        "www.googleapis.com",
        "/youtube/v3/channels",
    )
    assert opener.query() == {"id": ["UCa,UCb"], "part": ["snippet,statistics,brandingSettings"]}
    assert opener.timeouts == [youtube.TIMEOUT]


def test_videos_are_asked_for_in_one_batched_call(rec: Recorder) -> None:
    opener = FakeOpener({"items": []})
    api(opener, rec).videos(["v1", "v2"])
    assert urlsplit(opener.requests[0].full_url).path == "/youtube/v3/videos"
    assert opener.query() == {"id": ["v1,v2"], "part": ["snippet,statistics"]}


def test_more_than_fifty_ids_is_a_caller_bug(rec: Recorder) -> None:
    opener = FakeOpener()
    with pytest.raises(ValueError, match="50"):
        api(opener, rec).videos([f"v{i}" for i in range(51)])
    assert opener.requests == []


def test_no_ids_makes_no_call(rec: Recorder) -> None:
    opener = FakeOpener()
    assert api(opener, rec).videos([]) == {}
    assert api(opener, rec).channels({}) == {}
    assert opener.requests == []


def test_an_empty_key_is_refused_up_front() -> None:
    with pytest.raises(YouTubeError) as caught:
        YouTubeApi("  ", opener=FakeOpener())
    assert caught.value.code == "no_youtube_key"


# --- what it reads ---


def test_a_channel_is_read_into_the_store_shape(rec: Recorder) -> None:
    opener = FakeOpener({"items": [CHANNEL]})
    found = api(opener, rec).channels({"@aitoolsweekly": "UCaitools00000000000000a"})
    assert found == {
        "@aitoolsweekly": {
            "Name": "AI Tools Weekly",
            "Handle": "@aitoolsweekly",
            "Link": "https://www.youtube.com/@aitoolsweekly",
            "Channel_ID": "UCaitools00000000000000a",
            "Description": "Reviews of AI agents. Business: hello@aitoolsweekly.example",
            "Subscribers": "48200",
            "Profile_Picture": "https://yt3.example/ai.jpg",
            "Banner": "https://yt3.example/banner.jpg",
            "Country": "US",
        }
    }


def test_a_hidden_count_and_missing_parts_read_as_hidden_and_none(rec: Recorder) -> None:
    bare = {"id": "UCa", "snippet": {"title": "AI News Daily"}, "statistics": {}}
    found = api(FakeOpener({"items": [bare]}), rec).channels({"@ainews": "UCa"})
    info = found["@ainews"]
    assert info["Subscribers"] == "Hidden"
    assert info["Banner"] is None
    assert info["Profile_Picture"] is None
    assert info["Country"] is None


def test_a_channel_the_api_did_not_return_is_left_out(rec: Recorder) -> None:
    found = api(FakeOpener({"items": [CHANNEL]}), rec).channels(
        {"@aitoolsweekly": "UCaitools00000000000000a", "@gone": "UCgone"}
    )
    assert list(found) == ["@aitoolsweekly"]


def test_a_malformed_item_is_skipped_not_fatal(rec: Recorder) -> None:
    items: list[object] = [{"snippet": {}}, "junk", CHANNEL]
    found = api(FakeOpener({"items": items}), rec).channels(
        {"@aitoolsweekly": "UCaitools00000000000000a"}
    )
    assert list(found) == ["@aitoolsweekly"]


def test_a_video_is_read_into_the_store_shape(rec: Recorder) -> None:
    found = api(FakeOpener({"items": [VIDEO]}), rec).videos(["vid00000001"])
    assert found == {
        "vid00000001": {
            "id": "vid00000001",
            "Title": "I tested 5 AI coding agents",
            "Description": "Sponsored by AgentForge. Use code AITOOLS",
            "Thumbnail": "https://i.ytimg.example/maxres.jpg",
            "Tags": ["ai agents", "coding"],
            "PublishedAt": "2026-10-01T12:00:00Z",
            "ViewCount": "120345",
        }
    }


def test_a_video_without_maxres_falls_back_to_high_and_no_tags_to_empty(rec: Recorder) -> None:
    bare = {"id": "v2", "snippet": {"thumbnails": {"high": {"url": "h.jpg"}}}}
    info = api(FakeOpener({"items": [bare]}), rec).videos(["v2"])["v2"]
    assert info["Thumbnail"] == "h.jpg"
    assert info["Tags"] == []
    assert info["ViewCount"] is None


# --- how failures are named ---


@pytest.mark.parametrize("reason", ["quotaExceeded", "dailyLimitExceeded"])
def test_a_spent_quota_ends_the_run_as_quota(rec: Recorder, reason: str) -> None:
    opener = FakeOpener(http_error(403, reason))
    with pytest.raises(YouTubeError) as caught:
        api(opener, rec).videos(["v1"])
    assert caught.value.code == "quota"
    assert len(opener.requests) == 1


@pytest.mark.parametrize(
    ("status", "reason", "detail"),
    [
        (400, "keyInvalid", None),
        (400, "badRequest", "API_KEY_INVALID"),
        (403, "ipRefererBlocked", None),
        (403, "accessNotConfigured", "SERVICE_DISABLED"),
        (403, "forbidden", "API_KEY_SERVICE_BLOCKED"),
    ],
)
def test_a_rejected_key_ends_the_run_as_no_youtube_key(
    rec: Recorder, status: int, reason: str, detail: str | None
) -> None:
    with pytest.raises(YouTubeError) as caught:
        api(FakeOpener(http_error(status, reason, detail=detail)), rec).videos(["v1"])
    assert caught.value.code == "no_youtube_key"


def test_a_server_error_is_retried_then_succeeds(rec: Recorder) -> None:
    opener = FakeOpener(http_error(503), URLError("reset"), {"items": [VIDEO]})
    assert list(api(opener, rec).videos(["vid00000001"])) == ["vid00000001"]
    assert rec.waits == list(youtube.RETRY_WAITS)
    assert [level for level, _ in rec.lines] == ["warn", "warn"]


def test_a_rate_limit_is_retried_like_a_server_error(rec: Recorder) -> None:
    opener = FakeOpener(http_error(403, "rateLimitExceeded"), {"items": []})
    assert api(opener, rec).videos(["v1"]) == {}
    assert len(opener.requests) == 2


def test_a_network_that_stays_down_ends_the_run_as_network(rec: Recorder) -> None:
    opener = FakeOpener(URLError("down"), TimeoutError(), http_error(502))
    with pytest.raises(YouTubeError) as caught:
        api(opener, rec).videos(["v1"])
    assert caught.value.code == "network"
    assert len(opener.requests) == 1 + len(youtube.RETRY_WAITS)


def test_another_client_error_fails_only_the_batch(rec: Recorder) -> None:
    opener = FakeOpener(http_error(404, "notFound"))
    assert api(opener, rec).videos(["v1"]) == {}
    assert rec.lines == [("warn", "YouTube API: videos call failed (HTTP 404, notFound)")]


def test_an_answer_that_is_not_json_fails_only_the_batch(rec: Recorder) -> None:
    class NotJson(FakeOpener):
        def __call__(self, request: Request, timeout: float) -> io.BytesIO:
            super().__call__(request, timeout)
            return io.BytesIO(b"<html>")

    assert api(NotJson({}), rec).channels({"@a": "UCa"}) == {}
    assert rec.lines == [("warn", "YouTube API: channels answer was not JSON")]


def test_no_message_carries_the_key(rec: Recorder) -> None:
    opener = FakeOpener(http_error(503), http_error(404, KEY))
    api(opener, rec).videos(["v1"])
    assert all(KEY not in text for _, text in rec.lines)
    with pytest.raises(YouTubeError) as caught:
        api(FakeOpener(http_error(403, "quotaExceeded")), rec).videos(["v1"])
    assert KEY not in str(caught.value)


def test_the_real_opener_follows_no_redirect() -> None:
    request = Request("https://www.googleapis.com/youtube/v3/videos")
    handler = youtube._NoRedirect()  # pyright: ignore[reportPrivateUsage]
    elsewhere = "https://elsewhere.example/"
    assert handler.redirect_request(request, None, 302, "Found", Message(), elsewhere) is None
