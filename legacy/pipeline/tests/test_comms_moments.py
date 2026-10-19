"""Usable moments from a creator's latest video (decision `subtitles`): the subtitles are fetched only when a
first email is drafted, kept per video so a redo or a later draft reuses them, and read by the gratovo-moments
skill.

Run with:  python -m pytest tests/test_comms_moments.py    (from pipeline/)
"""

import json
import sys
import tempfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from comms import moments  # noqa: E402
from gratovo import store  # noqa: E402

ANSWER = """```json
{"moments": [
 {"at": "7:40", "quote": "it took 41 minutes to build the app", "point": "the build took 41 minutes",
  "kind": "result", "why_usable": "a number from their own test", "bridge": "41 minutes for a whole app is wild"}
], "auto_subtitles": true}
```"""


class FakeGemini:
    def __init__(self, *texts):
        self.texts, self.sent = list(texts), []

    def call(self, method, params, timeout=None):
        if method == "get_conversation":
            return [{"role": "user", "text": self.sent[-1]["text"]}, {"role": "model", "text": "answer"}]
        self.sent.append(params)
        return {"textRaw": self.texts.pop(0), "thinking": "High", "model": "Argon"}


@pytest.fixture
def conn():
    with tempfile.TemporaryDirectory() as tmp:
        c = store.get_connection(str(Path(tmp) / "t.db"))
        store.init_db(c)
        c.execute("INSERT INTO channels (channel_id, handle, first_seen_at) VALUES ('UC_a', '@a', 'T')")
        c.executemany(
            "INSERT INTO videos (video_id, channel_id, title, published_at) VALUES (?, 'UC_a', ?, ?)",
            [("old11111111", "Old one", "2026-09-01T00:00:00Z"), ("new22222222", "I built an app", "2026-10-10T00:00:00Z")])
        c.commit()
        yield c
        c.close()


def fetcher(calls, timed="[0:00] intro [7:40] it took 41 minutes to build the app", asr=True):
    def fetch(url):
        calls.append(url)
        if timed is None:
            return {"video_id": url[-11:], "transcript": None, "is_asr": None, "error": "no caption track available"}
        return {"video_id": url[-11:], "title": "I built an app", "transcript": "intro it took 41 minutes",
                "timed_transcript": timed, "is_asr": asr, "word_count": 5}
    return fetch


def test_the_latest_video_is_read_once_and_kept(conn):
    calls, gemini = [], FakeGemini(ANSWER)

    first = moments.for_latest_video(conn, gemini, "UC_a", fetch=fetcher(calls))
    again = moments.for_latest_video(conn, gemini, "UC_a", fetch=fetcher(calls))

    assert first["video_id"] == "new22222222"
    assert first["moments"][0]["at"] == "7:40"
    assert first["moments"][0]["quote"] == "it took 41 minutes to build the app"
    assert again == first
    assert len(calls) == 1, "the subtitles are fetched once per video"
    assert len(gemini.sent) == 1, "the moments are read once per video"
    prompt = gemini.sent[0]["text"]
    assert "Usable moments in a creator's video" in prompt, "the skill's instructions travel with the transcript"
    assert "[7:40] it took 41 minutes" in prompt
    assert gemini.sent[0]["thinking"] == "high"


def test_a_video_without_subtitles_has_no_moments_and_is_not_fetched_again(conn):
    calls, gemini = [], FakeGemini()

    result = moments.for_latest_video(conn, gemini, "UC_a", fetch=fetcher(calls, timed=None))
    moments.for_latest_video(conn, gemini, "UC_a", fetch=fetcher(calls, timed=None))

    assert result["moments"] == []
    assert "no caption" in result["note"]
    assert len(calls) == 1
    assert gemini.sent == []


RATE_LIMITED = {"video_id": "new22222222", "transcript": None, "is_asr": None,
                "error": "no caption track available (ERROR: Unable to download video subtitles for 'en': "
                         "HTTP Error 429: Too Many Requests)"}


def test_a_rate_limited_fetch_is_not_kept_and_the_next_draft_tries_again(conn):
    # Final review I8: YouTube saying "too many requests" is not "this video has no subtitles".
    calls, gemini = [], FakeGemini(ANSWER)

    def limited(url):
        calls.append(url)
        return dict(RATE_LIMITED)

    first = moments.for_latest_video(conn, gemini, "UC_a", fetch=limited)
    assert first["moments"] == []
    assert "429" in first["note"] and "tries again" in first["note"]
    assert store.get_video_transcript(conn, "new22222222") is None, "a passing failure is not cached"

    second = moments.for_latest_video(conn, gemini, "UC_a", fetch=fetcher(calls))
    assert second["moments"][0]["at"] == "7:40"
    assert len(calls) == 2


def test_a_rate_limit_already_in_the_cache_is_fetched_again(conn):
    # What an older build left on the owner's database.
    store.save_video_transcript(conn, "new22222222", "UC_a", dict(RATE_LIMITED))
    calls, gemini = [], FakeGemini(ANSWER)

    result = moments.for_latest_video(conn, gemini, "UC_a", fetch=fetcher(calls))

    assert len(calls) == 1
    assert result["moments"][0]["at"] == "7:40"


def test_an_unreadable_answer_is_not_kept(conn):
    calls, gemini = [], FakeGemini("sorry, I cannot", ANSWER)

    first = moments.for_latest_video(conn, gemini, "UC_a", fetch=fetcher(calls))
    second = moments.for_latest_video(conn, gemini, "UC_a", fetch=fetcher(calls))

    assert first["moments"] == []
    assert second["moments"][0]["at"] == "7:40", "a failed reading is asked again next time"
    assert len(calls) == 1, "but the subtitles themselves were kept"


def test_a_channel_with_no_stored_video_has_nothing_to_read(conn):
    assert moments.for_latest_video(conn, FakeGemini(), "UC_none", fetch=fetcher([])) is None


def test_the_cache_lives_in_the_pipeline_database(conn):
    moments.for_latest_video(conn, FakeGemini(ANSWER), "UC_a", fetch=fetcher([]))
    row = conn.execute("SELECT video_id, is_asr, moments FROM video_transcripts").fetchone()
    assert row["video_id"] == "new22222222"
    assert row["is_asr"] == 1
    assert json.loads(row["moments"])[0]["kind"] == "result"
