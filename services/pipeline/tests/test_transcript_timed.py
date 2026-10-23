"""A transcript with time marks, so a usable moment can be quoted with where it is ("at 7:40")
(ported from the old test_transcript_timed), and how yt-dlp is called: only with a watch URL built
from a checked video id, never without Deno, and never for real in a test."""

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

from gratovo_pipeline import transcript


def _event(ms: int, *words: str) -> dict[str, Any]:
    return {"tStartMs": ms, "segs": [{"utf8": w} for w in words]}


def test_marks_open_the_text_and_follow_every_thirty_seconds() -> None:
    payload = {
        "events": [
            _event(0, "Today", " we", " test"),
            _event(4_000, " Claude"),
            _event(31_000, "and", " it", " failed"),
            _event(35_000, " twice."),
            _event(95_500, "Here", " is", " why."),
        ]
    }

    text = transcript._segments_to_timed_text(payload)  # pyright: ignore[reportPrivateUsage]

    assert text == "[0:00] Today we test Claude [0:31] and it failed twice. [1:35] Here is why."


def test_an_hour_long_video_shows_hours() -> None:
    payload = {"events": [_event(3_725_000, "Wrapping", " up.")]}
    assert transcript._segments_to_timed_text(payload) == "[1:02:05] Wrapping up."  # pyright: ignore[reportPrivateUsage]


def test_line_breaks_and_empty_events_are_not_text() -> None:
    payload = {
        "events": [
            _event(0, "One"),
            {"tStartMs": 500, "segs": [{"utf8": "\n"}]},
            {"tStartMs": 900},
            _event(1_000, "two"),
        ]
    }
    assert transcript._segments_to_timed_text(payload) == "[0:00] One two"  # pyright: ignore[reportPrivateUsage]


# --- fetch: how yt-dlp is called (plan D12) ---

VIDEO_ID = "VruF9Z6WrGg"
CAPTIONS = {
    "events": [_event(0, "Today", " we", " test", " Cursor"), _event(31_000, "It", " won.")]
}


class FakeYtDlp:
    """Stands in for subprocess.run: records each argv, prints the id and title, and writes a
    json3 track for the pass named in `writes` ("--write-subs" or "--write-auto-subs")."""

    def __init__(self, writes: str | None = "--write-subs", stderr: str = "") -> None:
        self.writes, self.stderr = writes, stderr
        self.calls: list[list[str]] = []
        self.kwargs: list[dict[str, Any]] = []

    def __call__(self, args: list[str], **kwargs: Any) -> subprocess.CompletedProcess[str]:
        self.calls.append(args)
        self.kwargs.append(kwargs)
        if "--print" in args:
            return subprocess.CompletedProcess(args, 0, f"{VIDEO_ID}\tI tested Cursor\n", "")
        if self.writes in args:
            template = args[args.index("-o") + 1]
            Path(template.replace("%(ext)s", "en.json3")).write_text(
                json.dumps(CAPTIONS), encoding="utf-8"
            )
        return subprocess.CompletedProcess(args, 0, "", self.stderr)


def _found_deno(name: str) -> str:
    return f"C:\\deno\\{name}.exe"


def _no_deno(_name: str) -> None:
    return None


@pytest.fixture
def deno(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(transcript.shutil, "which", _found_deno)


def _fake(monkeypatch: pytest.MonkeyPatch, fake: FakeYtDlp) -> FakeYtDlp:
    monkeypatch.setattr(transcript.subprocess, "run", fake)
    return fake


@pytest.mark.usefixtures("deno")
def test_yt_dlp_runs_as_a_module_of_this_python_with_no_config_and_no_cache(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake = _fake(monkeypatch, FakeYtDlp())

    data = transcript.fetch(VIDEO_ID)

    assert data["transcript"] == "Today we test Cursor It won."
    assert data["timed_transcript"] == "[0:00] Today we test Cursor [0:31] It won."
    assert data["is_asr"] is False
    assert data["video_id"] == VIDEO_ID
    assert data["title"] == "I tested Cursor"
    assert data["word_count"] == 6
    for args, kwargs in zip(fake.calls, fake.kwargs, strict=True):
        assert args[:7] == [
            sys.executable,
            "-I",
            "-m",
            "yt_dlp",
            "--ignore-config",
            "--no-cache-dir",
            "--no-plugin-dirs",
        ]
        assert args[-1] == f"https://www.youtube.com/watch?v={VIDEO_ID}"
        assert "env" not in kwargs, "the bridge's own (bare) environment is passed through"
    assert len(fake.calls) == 2, "the written subtitles were found, so no automatic pass"


@pytest.mark.usefixtures("deno")
def test_automatic_subtitles_are_the_fallback_and_say_so(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _fake(monkeypatch, FakeYtDlp(writes="--write-auto-subs"))

    data = transcript.fetch(VIDEO_ID)

    assert data["is_asr"] is True
    assert data["transcript"] == "Today we test Cursor It won."
    assert len(fake.calls) == 3


@pytest.mark.usefixtures("deno")
def test_no_track_gives_the_failure_shape_with_yt_dlps_last_error_line(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stderr = "WARNING: x\nERROR: Unable to download video subtitles for 'en': HTTP Error 429\n"
    _fake(monkeypatch, FakeYtDlp(writes=None, stderr=stderr))

    data = transcript.fetch(VIDEO_ID)

    assert data["transcript"] is None
    assert data["is_asr"] is None
    assert data["word_count"] == 0
    assert data["error"] == (
        "no caption track available "
        "(ERROR: Unable to download video subtitles for 'en': HTTP Error 429)"
    )


@pytest.mark.parametrize(
    "target",
    [
        "https://www.youtube.com/watch?v=VruF9Z6WrGg",
        "https://evil.example/VruF9Z6WrGg",
        "VruF9Z6WrG",
        "VruF9Z6WrGgX",
        "--exec=calc",
        "VruF9Z6Wr g",
        "",
    ],
)
@pytest.mark.usefixtures("deno")
def test_anything_but_an_11_character_video_id_is_refused_before_yt_dlp_runs(
    monkeypatch: pytest.MonkeyPatch, target: str
) -> None:
    fake = _fake(monkeypatch, FakeYtDlp())

    with pytest.raises(ValueError, match="11-character video id"):
        transcript.fetch(target)
    with pytest.raises(ValueError, match="11-character video id"):
        transcript.watch_url(target)
    assert fake.calls == []


def test_without_deno_yt_dlp_does_not_run(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _fake(monkeypatch, FakeYtDlp())
    monkeypatch.setattr(transcript.shutil, "which", _no_deno)

    data = transcript.fetch(VIDEO_ID)

    assert data == {
        "video_id": VIDEO_ID,
        "title": None,
        "is_asr": None,
        "transcript": None,
        "word_count": 0,
        "error": "no_deno",
    }
    assert fake.calls == []


@pytest.mark.parametrize(
    ("target", "video_id"),
    [
        ("VruF9Z6WrGg", "VruF9Z6WrGg"),
        ("https://www.youtube.com/watch?v=VruF9Z6WrGg", "VruF9Z6WrGg"),
        ("https://youtube.com/watch?v=VruF9Z6WrGg&t=40", "VruF9Z6WrGg"),
        ("https://youtu.be/VruF9Z6WrGg", "VruF9Z6WrGg"),
    ],
)
def test_the_command_line_takes_a_watch_url_or_an_id(target: str, video_id: str) -> None:
    assert transcript._video_id(target) == video_id  # pyright: ignore[reportPrivateUsage]


def test_the_command_line_refuses_anything_else() -> None:
    with pytest.raises(SystemExit):
        transcript._video_id("https://www.youtube.com/@somehandle")  # pyright: ignore[reportPrivateUsage]


def test_trim_keeps_the_head_and_the_tail() -> None:
    text = " ".join(f"w{i}" for i in range(100))
    assert transcript.trim(text, 200) == text
    assert transcript.trim(text, 10) == "w0 w1 w2 w3 w4 w5 w6 [...] w97 w98 w99"


@pytest.mark.usefixtures("deno")
def test_a_hung_yt_dlp_is_stopped_and_counts_as_a_passing_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: list[float] = []

    def hangs(args: list[str], **kwargs: Any) -> subprocess.CompletedProcess[str]:
        seen.append(kwargs["timeout"])
        raise subprocess.TimeoutExpired(args, kwargs["timeout"])

    monkeypatch.setattr(transcript.subprocess, "run", hangs)

    data = transcript.fetch(VIDEO_ID)

    assert seen
    assert all(t == transcript.YT_DLP_TIMEOUT_S for t in seen)
    assert data["transcript"] is None
    assert "timed out" in str(data["error"])
