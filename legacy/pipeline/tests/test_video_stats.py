"""tools/video_stats.py: one video's views for the 30-day report (plan step 7).

No network: the YouTube client is a fake that answers like `videos().list`.
"""

import io
import json
import sys
from contextlib import redirect_stdout
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

import video_stats  # noqa: E402


class _Request:
    def __init__(self, response=None, error=None):
        self._response = response
        self._error = error

    def execute(self):
        if self._error:
            raise self._error
        return self._response


class _Videos:
    def __init__(self, owner):
        self._owner = owner

    def list(self, **kwargs):
        self._owner.asked.append(kwargs)
        return _Request(self._owner.response, self._owner.error)


class FakeYouTube:
    def __init__(self, response=None, error=None):
        self.response = response
        self.error = error
        self.asked = []

    def videos(self):
        return _Videos(self)


@pytest.mark.parametrize("text", [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?feature=share&v=dQw4w9WgXcQ&t=42s",
    "https://youtu.be/dQw4w9WgXcQ?si=abc",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube.com/live/dQw4w9WgXcQ",
    "https://m.youtube.com/embed/dQw4w9WgXcQ",
    "dQw4w9WgXcQ",
    "  https://www.youtube.com/watch?v=dQw4w9WgXcQ  ",
])
def test_the_video_id_is_read_from_any_youtube_link(text):
    assert video_stats.video_id_from(text) == "dQw4w9WgXcQ"


@pytest.mark.parametrize("text", [
    "",
    "https://vimeo.com/123456",
    "https://www.youtube.com/@somechannel",
    "not a link",
])
def test_anything_else_has_no_video_id(text):
    assert video_stats.video_id_from(text) is None


def test_the_views_come_from_the_statistics():
    youtube = FakeYouTube({"items": [
        {"id": "dQw4w9WgXcQ", "statistics": {"viewCount": "61234"}}]})

    assert video_stats.views_of("dQw4w9WgXcQ", youtube) == 61234
    assert youtube.asked == [{"part": "statistics", "id": "dQw4w9WgXcQ"}]


def test_a_video_youtube_does_not_know_has_no_views():
    assert video_stats.views_of("dQw4w9WgXcQ", FakeYouTube({"items": []})) is None


def _run(argv, youtube):
    out = io.StringIO()
    with redirect_stdout(out):
        code = video_stats.main(argv, youtube=youtube)
    return code, json.loads(out.getvalue())


def test_json_output_names_the_video_its_views_and_when():
    youtube = FakeYouTube({"items": [
        {"id": "dQw4w9WgXcQ", "statistics": {"viewCount": "61234"}}]})

    code, payload = _run(
        ["--video", "https://youtu.be/dQw4w9WgXcQ", "--json"], youtube)

    assert code == 0
    assert payload["ok"] is True
    assert payload["videoId"] == "dQw4w9WgXcQ"
    assert payload["views"] == 61234
    assert payload["fetchedAt"].endswith("Z")


def test_a_link_with_no_video_is_refused_without_asking_youtube():
    youtube = FakeYouTube({"items": []})

    code, payload = _run(["--video", "https://vimeo.com/1", "--json"], youtube)

    assert code == 1
    assert payload == {"ok": False, "error": {
        "code": "not_a_video", "message": "That is not a YouTube video link."}}
    assert youtube.asked == []


def test_a_missing_video_says_so():
    code, payload = _run(["--video", "dQw4w9WgXcQ", "--json"],
                         FakeYouTube({"items": []}))

    assert code == 1
    assert payload["error"]["code"] == "not_found"


def test_an_api_failure_is_json_not_a_traceback():
    code, payload = _run(["--video", "dQw4w9WgXcQ", "--json"],
                         FakeYouTube(error=RuntimeError("quotaExceeded")))

    assert code == 1
    assert payload["error"]["code"] == "youtube_error"
    assert "quotaExceeded" in payload["error"]["message"]


def test_an_api_failure_never_carries_the_api_key():
    # googleapiclient's HttpError prints the request URL, and the URL carries
    # `key=<the API key>`; the app shows this message on screen.
    error = RuntimeError(
        '<HttpError 403 when requesting https://youtube.googleapis.com/youtube/'
        'v3/videos?part=statistics&id=dQw4w9WgXcQ&key=AIzaSyFAKEKEY_123-abc'
        '&alt=json returned "quotaExceeded">')
    code, payload = _run(["--video", "dQw4w9WgXcQ", "--json"],
                         FakeYouTube(error=error))

    assert code == 1
    message = payload["error"]["message"]
    assert "AIzaSyFAKEKEY_123-abc" not in message
    assert "key=[hidden]" in message
    assert "quotaExceeded" in message
