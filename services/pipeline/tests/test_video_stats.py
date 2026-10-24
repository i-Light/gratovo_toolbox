"""The video_stats job: one video's views for the 30-day report. No network: the YouTube API is a
fake that answers like `YouTubeApi.videos`, and every line is checked against the schema."""

import io
import json
from collections.abc import Callable, Sequence
from typing import Any

import pytest
from helpers import start_with

from gratovo_pipeline.jobs import video_stats
from gratovo_pipeline.protocol import Emitter
from gratovo_pipeline.youtube import VideoInfo, YouTubeError

Check = Callable[[str], dict[str, Any]]
VIDEO = "dQw4w9WgXcQ"
KEY = "AIzaSyFAKEKEY_123-abc"


def info(video_id: str, views: str | None) -> VideoInfo:
    return {
        "id": video_id,
        "Title": None,
        "Description": None,
        "Thumbnail": None,
        "Tags": [],
        "PublishedAt": None,
        "ViewCount": views,
    }


class FakeApi:
    def __init__(self, answer: dict[str, VideoInfo] | None = None, error: Exception | None = None):
        self.answer = answer or {}
        self.error = error
        self.asked: list[list[str]] = []

    def videos(self, video_ids: Sequence[str]) -> dict[str, VideoInfo]:
        self.asked.append(list(video_ids))
        if self.error:
            raise self.error
        return self.answer


def run_job(
    api: FakeApi, check: Check, url: str = f"https://youtu.be/{VIDEO}", **changes: object
) -> list[dict[str, Any]]:
    out = io.StringIO()
    start = start_with(job={"kind": "video_stats", "videoUrl": url}, source="live", **changes)
    video_stats.run(start, Emitter(out), api=api)
    return [check(line + "\n") for line in out.getvalue().splitlines()]


@pytest.mark.parametrize(
    "text",
    [
        f"https://www.youtube.com/watch?v={VIDEO}",
        f"https://www.youtube.com/watch?feature=share&v={VIDEO}&t=42s",
        f"https://youtu.be/{VIDEO}?si=abc",
        f"https://www.youtube.com/shorts/{VIDEO}",
        f"https://www.youtube.com/live/{VIDEO}",
        f"https://m.youtube.com/embed/{VIDEO}",
        VIDEO,
        f"  https://www.youtube.com/watch?v={VIDEO}  ",
    ],
)
def test_the_video_id_is_read_from_any_youtube_link(text: str) -> None:
    assert video_stats.video_id_from(text) == VIDEO


@pytest.mark.parametrize(
    "text",
    ["", "https://vimeo.com/123456", "https://www.youtube.com/@somechannel", "not a link"],
)
def test_anything_else_has_no_video_id(text: str) -> None:
    assert video_stats.video_id_from(text) is None


def test_the_result_names_the_video_its_views_and_when(check_from_pipeline: Check) -> None:
    api = FakeApi({VIDEO: info(VIDEO, "61234")})

    lines = run_job(api, check_from_pipeline)

    assert api.asked == [[VIDEO]]
    assert [line["type"] for line in lines] == ["result", "end"]
    result = lines[0]
    assert result["kind"] == "video_stats"
    assert result["data"]["videoId"] == VIDEO
    assert result["data"]["views"] == 61234
    assert result["data"]["fetchedAt"].endswith("Z")
    assert len(result["data"]["fetchedAt"]) == 20
    assert lines[1]["state"] == "done"
    assert (lines[1]["at"], lines[1]["found"], lines[1]["kept"]) == (0, 0, 0)
    assert "error" not in lines[1]


def test_a_link_with_no_video_is_refused_without_asking_youtube(check_from_pipeline: Check) -> None:
    api = FakeApi({})

    lines = run_job(api, check_from_pipeline, url="https://vimeo.com/1")

    assert api.asked == []
    assert [line["type"] for line in lines] == ["end"]
    assert lines[0]["state"] == "failed"
    assert lines[0]["error"] == {
        "code": "not_a_video",
        "message": "That is not a YouTube video link.",
    }


@pytest.mark.parametrize("answer", [{}, {VIDEO: info(VIDEO, None)}])
def test_a_missing_video_says_so(answer: dict[str, VideoInfo], check_from_pipeline: Check) -> None:
    lines = run_job(FakeApi(answer), check_from_pipeline)

    assert [line["type"] for line in lines] == ["end"]
    assert lines[0]["state"] == "failed"
    assert lines[0]["error"]["code"] == "not_found"


def test_no_key_ends_with_no_youtube_key(check_from_pipeline: Check) -> None:
    out = io.StringIO()
    start = start_with(
        job={"kind": "video_stats", "videoUrl": VIDEO},
        source="live",
        secrets__youtubeKey=None,
    )

    video_stats.run(start, Emitter(out))

    lines = [check_from_pipeline(line + "\n") for line in out.getvalue().splitlines()]
    assert [line["type"] for line in lines] == ["end"]
    assert lines[0]["error"]["code"] == "no_youtube_key"


def test_a_youtube_error_keeps_its_code_and_message(check_from_pipeline: Check) -> None:
    api = FakeApi(error=YouTubeError("quota", "YouTube's daily limit is used up."))

    lines = run_job(api, check_from_pipeline)

    assert [line["type"] for line in lines] == ["end"]
    assert lines[0]["state"] == "failed"
    assert lines[0]["error"] == {"code": "quota", "message": "YouTube's daily limit is used up."}


def test_any_other_failure_is_a_crash_that_names_only_its_kind(
    check_from_pipeline: Check, capsys: pytest.CaptureFixture[str]
) -> None:
    error = RuntimeError(f"GET https://youtube.googleapis.com/youtube/v3/videos?key={KEY} failed")

    lines = run_job(FakeApi(error=error), check_from_pipeline, secrets__youtubeKey=KEY)

    assert lines[0]["error"]["code"] == "crash"
    assert "RuntimeError" in lines[0]["error"]["message"]
    seen = json.dumps(lines) + capsys.readouterr().err
    assert KEY not in seen
    assert "googleapis" not in seen


def test_no_message_ever_contains_the_key(check_from_pipeline: Check) -> None:
    ok = run_job(FakeApi({VIDEO: info(VIDEO, "5")}), check_from_pipeline, secrets__youtubeKey=KEY)
    bad = run_job(
        FakeApi(error=YouTubeError("network", "YouTube can't be reached.")),
        check_from_pipeline,
        secrets__youtubeKey=KEY,
    )

    assert KEY not in json.dumps(ok + bad)
