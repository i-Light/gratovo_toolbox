"""Usable moments from a creator's latest video (decision `subtitles`, ported from the old
test_comms_moments): the subtitles are fetched only when a first email is drafted, kept per video
in pipeline.db so a redo or a later draft reuses them, and read by the gratovo-moments skill."""

import json
import sqlite3
from collections.abc import Callable
from typing import Any

import pytest

from gratovo_pipeline import store
from gratovo_pipeline.comms import moments

type Fetch = Callable[[str], dict[str, Any]]

ANSWER = """```json
{"moments": [
 {"at": "7:40", "quote": "it took 41 minutes to build the app",
  "point": "the build took 41 minutes", "kind": "result",
  "why_usable": "a number from their own test", "bridge": "41 minutes for a whole app is wild"}
], "auto_subtitles": true}
```"""


class FakeGemini:
    def __init__(self, *texts: str) -> None:
        self.texts: list[str] = list(texts)
        self.sent: list[dict[str, Any]] = []

    def call(
        self, method: str, params: dict[str, Any] | None = None, timeout: float | None = None
    ) -> Any:
        if method == "get_conversation":
            return [
                {"role": "user", "text": self.sent[-1]["text"]},
                {"role": "model", "text": "answer"},
            ]
        self.sent.append(params or {})
        return {"textRaw": self.texts.pop(0), "thinking": "High", "model": "Argon"}


@pytest.fixture
def db(conn: sqlite3.Connection) -> sqlite3.Connection:
    """conftest's fresh pipeline.db with one AI creator and two of their videos."""
    conn.execute(
        "INSERT INTO channels (channel_id, handle, first_seen_at) VALUES ('UC_a', '@a', 'T')"
    )
    conn.executemany(
        "INSERT INTO videos (video_id, channel_id, title, published_at) VALUES (?, 'UC_a', ?, ?)",
        [
            ("old11111111", "Old one", "2026-09-01T00:00:00Z"),
            ("new22222222", "I built an app", "2026-10-10T00:00:00Z"),
        ],
    )
    conn.commit()
    return conn


def fetcher(
    calls: list[str],
    timed: str | None = "[0:00] intro [7:40] it took 41 minutes to build the app",
    asr: bool = True,
) -> Fetch:
    def fetch(video_id: str) -> dict[str, Any]:
        calls.append(video_id)
        if timed is None:
            return {
                "video_id": video_id,
                "transcript": None,
                "is_asr": None,
                "error": "no caption track available",
            }
        return {
            "video_id": video_id,
            "title": "I built an app",
            "transcript": "intro it took 41 minutes",
            "timed_transcript": timed,
            "is_asr": asr,
            "word_count": 5,
        }

    return fetch


def _read(db: sqlite3.Connection, gemini: FakeGemini, fetch: Fetch) -> dict[str, Any]:
    result = moments.for_latest_video(db, gemini, "UC_a", fetch=fetch)
    assert result is not None
    return result


def test_the_latest_video_is_read_once_and_kept(db: sqlite3.Connection) -> None:
    calls: list[str] = []
    gemini = FakeGemini(ANSWER)

    first = _read(db, gemini, fetcher(calls))
    again = _read(db, gemini, fetcher(calls))

    assert first["video_id"] == "new22222222"
    assert first["moments"][0]["at"] == "7:40"
    assert first["moments"][0]["quote"] == "it took 41 minutes to build the app"
    assert again == first
    assert calls == ["new22222222"], "the subtitles are fetched once per video"
    assert len(gemini.sent) == 1, "the moments are read once per video"
    prompt = gemini.sent[0]["text"]
    assert "Usable moments in a creator's video" in prompt, (
        "the skill's instructions travel with the transcript"
    )
    assert "name: gratovo-moments" not in prompt, "the skill's front matter is left out"
    assert "[7:40] it took 41 minutes" in prompt
    assert gemini.sent[0]["thinking"] == "high"


def test_a_video_without_subtitles_has_no_moments_and_is_not_fetched_again(
    db: sqlite3.Connection,
) -> None:
    calls: list[str] = []
    gemini = FakeGemini()

    result = _read(db, gemini, fetcher(calls, timed=None))
    _read(db, gemini, fetcher(calls, timed=None))

    assert result["moments"] == []
    assert "no caption" in result["note"]
    assert len(calls) == 1
    assert gemini.sent == []


RATE_LIMITED: dict[str, Any] = {
    "video_id": "new22222222",
    "transcript": None,
    "is_asr": None,
    "error": "no caption track available (ERROR: Unable to download video subtitles for 'en': "
    "HTTP Error 429: Too Many Requests)",
}


def test_a_rate_limited_fetch_is_not_kept_and_the_next_draft_tries_again(
    db: sqlite3.Connection,
) -> None:
    # Final review I8: YouTube saying "too many requests" is not "this video has no subtitles".
    calls: list[str] = []
    gemini = FakeGemini(ANSWER)

    def limited(video_id: str) -> dict[str, Any]:
        calls.append(video_id)
        return dict(RATE_LIMITED)

    first = _read(db, gemini, limited)
    assert first["moments"] == []
    assert "429" in first["note"]
    assert "tries again" in first["note"]
    assert store.get_video_transcript(db, "new22222222") is None, "a passing failure is not cached"

    second = _read(db, gemini, fetcher(calls))
    assert second["moments"][0]["at"] == "7:40"
    assert len(calls) == 2


def test_a_rate_limit_already_in_the_cache_is_fetched_again(db: sqlite3.Connection) -> None:
    # What an older build left on the owner's database.
    store.save_video_transcript(db, "new22222222", "UC_a", dict(RATE_LIMITED))
    calls: list[str] = []
    gemini = FakeGemini(ANSWER)

    result = _read(db, gemini, fetcher(calls))

    assert len(calls) == 1
    assert result["moments"][0]["at"] == "7:40"


def test_an_unreadable_answer_is_not_kept(db: sqlite3.Connection) -> None:
    calls: list[str] = []
    gemini = FakeGemini("sorry, I cannot", ANSWER)

    first = _read(db, gemini, fetcher(calls))
    second = _read(db, gemini, fetcher(calls))

    assert first["moments"] == []
    assert second["moments"][0]["at"] == "7:40", "a failed reading is asked again next time"
    assert len(calls) == 1, "but the subtitles themselves were kept"


def test_a_channel_with_no_stored_video_has_nothing_to_read(db: sqlite3.Connection) -> None:
    assert moments.for_latest_video(db, FakeGemini(), "UC_none", fetch=fetcher([])) is None


def test_the_cache_lives_in_the_pipeline_database(db: sqlite3.Connection) -> None:
    _read(db, FakeGemini(ANSWER), fetcher([]))
    row = db.execute("SELECT video_id, is_asr, moments FROM video_transcripts").fetchone()
    assert row["video_id"] == "new22222222"
    assert row["is_asr"] == 1
    assert json.loads(row["moments"])[0]["kind"] == "result"


def test_without_deno_the_draft_goes_on_without_moments(db: sqlite3.Connection) -> None:
    # Plan D12: until Deno is packaged (3h), yt-dlp can't read YouTube's player code.
    gemini = FakeGemini()

    def no_deno(video_id: str) -> dict[str, Any]:
        return {"video_id": video_id, "transcript": None, "is_asr": None, "error": "no_deno"}

    result = _read(db, gemini, no_deno)

    assert result["moments"] == []
    assert "no_deno" in result["note"]
    assert "tries again" in result["note"]
    assert result["auto_subtitles"] is None
    assert gemini.sent == []
    assert store.get_video_transcript(db, "new22222222") is None, "read again once Deno is there"
