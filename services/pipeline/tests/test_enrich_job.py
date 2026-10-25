"""The backfill job: refetching blanks and failures, the call ceiling, widening a channel's
uploads, the video backlog, and how each way of ending reads on the wire."""

import io
import sqlite3
from collections.abc import Callable, Iterator, Sequence
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from fakes import FakeSource, channel_info
from helpers import start_with

from gratovo_pipeline import run_control, store
from gratovo_pipeline.config import DelayKey
from gratovo_pipeline.jobs import backfill as backfill_job
from gratovo_pipeline.protocol import Emitter, Start
from gratovo_pipeline.search.context import ChannelUnreadableError, SearchBlockedError
from gratovo_pipeline.search.pacing import Pacer
from gratovo_pipeline.youtube import ChannelInfo, YouTubeError


@pytest.fixture(autouse=True)
def fresh_stop() -> Iterator[None]:
    run_control.clear_stop()
    yield
    run_control.clear_stop()


class Run:
    def __init__(self, check: Callable[[str], dict[str, Any]]) -> None:
        self.out = io.StringIO()
        self.check = check

    def messages(self) -> list[dict[str, Any]]:
        return [self.check(line) for line in self.out.getvalue().splitlines(keepends=True)]

    def of(self, kind: str) -> list[dict[str, Any]]:
        return [m for m in self.messages() if m["type"] == kind]

    def end(self) -> dict[str, Any]:
        last = self.messages()[-1]
        assert last["type"] == "end"
        return last

    def result(self) -> dict[str, Any]:
        (result,) = self.of("result")
        assert result["kind"] == "backfill"
        return result["data"]

    def warnings(self) -> list[str]:
        return [m["text"] for m in self.of("log") if m["level"] == "warn"]


@pytest.fixture
def run(check_from_pipeline: Callable[[str], dict[str, Any]]) -> Run:
    return Run(check_from_pipeline)


def start_for(tmp_path: Path, only: list[str], **job: object) -> Start:
    return start_with(
        source="live",
        dataDir=str(tmp_path),
        settings={},
        job={"kind": "backfill", "only": only, **job},
    )


def go(run: Run, start: Start, source: object = None) -> None:
    backfill_job.run(start, Emitter(run.out), source=source)  # pyright: ignore[reportArgumentType]


@pytest.fixture
def db(tmp_path: Path) -> Iterator[sqlite3.Connection]:
    """The store the job opens, seeded before it runs."""
    connection = store.get_connection(tmp_path / backfill_job.DB_NAME)
    store.init_db(connection)
    yield connection
    connection.close()


def add_channel(
    conn: sqlite3.Connection,
    name: str,
    *,
    country: str | None = "US",
    fetched_at: str | None = "2026-06-01T00:00:00Z",
    status: str | None = "success",
    videos_fetched_at: str | None = "2026-06-01T00:00:00Z",
    seen: int = 1,
) -> str:
    channel_id = f"UC_{name}"
    conn.execute(
        "INSERT INTO channels (channel_id, handle, name, subscribers, country, first_seen_at,"
        " last_fetched_at, last_fetch_status, videos_fetched_at)"
        " VALUES (?, ?, ?, '1000', ?, ?, ?, ?, ?)",
        (
            channel_id,
            f"@{name}",
            name.title(),
            country,
            f"2026-01-{seen:02d}T00:00:00Z",
            fetched_at,
            status,
            videos_fetched_at,
        ),
    )
    conn.commit()
    return channel_id


def add_video(
    conn: sqlite3.Connection,
    video_id: str,
    channel_id: str,
    *,
    published_at: str | None,
    status: str = "success",
) -> None:
    conn.execute(
        "INSERT INTO videos (video_id, channel_id, title, published_at, view_count,"
        " last_fetched_at, last_fetch_status) VALUES (?, ?, 'AI news', ?, '10',"
        " '2026-06-01T00:00:00Z', ?)",
        (video_id, channel_id, published_at, status),
    )
    conn.commit()


def days_ago(days: int) -> str:
    return (datetime.now(UTC) - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")


def source_for(conn: sqlite3.Connection) -> FakeSource:
    """A source that has details for every channel in the store."""
    details: list[ChannelInfo] = [
        channel_info(r["handle"], r["channel_id"]) for r in conn.execute("SELECT * FROM channels")
    ]
    return FakeSource(details=details)


def run_kinds(conn: sqlite3.Connection) -> list[str]:
    return [r["kind"] for r in conn.execute("SELECT kind FROM runs ORDER BY run_id")]


# --- channels and videos ---


def test_the_watermark_splits_stale_blanks_from_absent_ones(
    tmp_path: Path, db: sqlite3.Connection, run: Run
) -> None:
    # The country was first recorded on 06-01. @stale was fetched before that (the pipeline did
    # not collect it yet); @absent after it (YouTube has none).
    add_channel(db, "known", country="US", fetched_at="2026-06-01T00:00:00Z", seen=1)
    add_channel(db, "stale", country=None, fetched_at="2026-05-01T00:00:00Z", seen=2)
    add_channel(db, "absent", country="", fetched_at="2026-07-01T00:00:00Z", seen=3)
    source = source_for(db)

    go(run, start_for(tmp_path, ["channels"]), source)

    assert source.channel_calls == [["@stale"]]
    assert run.result()["channels"] == {"targets": 1, "filled": 1}
    assert run.end()["state"] == "done"


def test_include_absent_retries_both(tmp_path: Path, db: sqlite3.Connection, run: Run) -> None:
    add_channel(db, "known", country="US", seen=1)
    add_channel(db, "stale", country=None, fetched_at="2026-05-01T00:00:00Z", seen=2)
    add_channel(db, "absent", country="", fetched_at="2026-07-01T00:00:00Z", seen=3)
    source = source_for(db)

    go(run, start_for(tmp_path, ["channels"], includeAbsent=True), source)

    assert source.channel_calls == [["@stale", "@absent"]]
    assert run.result()["channels"] == {"targets": 2, "filled": 2}
    country = db.execute("SELECT country FROM channels WHERE handle='@stale'").fetchone()[0]
    assert country == "US"


def test_failed_fetches_are_always_retried(
    tmp_path: Path, db: sqlite3.Connection, run: Run
) -> None:
    # Nothing is blank, and the fetch is long after the watermark: only the failure marks them.
    add_channel(db, "fine", seen=1)
    failed = add_channel(db, "failed", status="failed", fetched_at="2026-08-01T00:00:00Z", seen=2)
    add_video(db, "v_ok", failed, published_at=days_ago(3))
    add_video(db, "v_failed", failed, published_at=days_ago(2), status="failed")
    source = source_for(db)

    go(run, start_for(tmp_path, ["channels", "videos"]), source)

    data = run.result()
    assert source.channel_calls == [["@failed"]]
    assert source.video_calls == [["v_failed"]]
    assert data["channels"] == {"targets": 1, "filled": 1}
    assert data["videos"] == {"targets": 1, "filled": 1}
    assert (
        db.execute("SELECT last_fetch_status FROM channels WHERE handle='@failed'").fetchone()[0]
        == "success"
    )
    assert (
        db.execute("SELECT last_fetch_status FROM videos WHERE video_id='v_failed'").fetchone()[0]
        == "success"
    )


def test_a_limit_caps_what_each_part_touches(
    tmp_path: Path, db: sqlite3.Connection, run: Run
) -> None:
    for i in range(5):
        add_channel(db, f"c{i}", status="failed", seen=i + 1)
    source = source_for(db)

    go(run, start_for(tmp_path, ["channels"], limit=2), source)

    assert source.channel_calls == [["@c0", "@c1"]]


def many_failed(db: sqlite3.Connection, count: int) -> None:
    for i in range(count):
        add_channel(db, f"c{i:03d}", status="failed", seen=1 + i % 28)


def test_the_budget_stops_at_the_ceiling(tmp_path: Path, db: sqlite3.Connection, run: Run) -> None:
    many_failed(db, 120)
    source = source_for(db)

    go(run, start_for(tmp_path, ["channels"], maxApiCalls=2), source)

    data = run.result()
    assert [len(c) for c in source.channel_calls] == [50, 50]
    assert data["channels"] == {"targets": 120, "filled": 100}
    assert (data["apiCalls"], data["budgetReached"]) == (2, True)
    end = run.end()
    assert (end["state"], end["at"], end["found"], end["kept"]) == ("done", 0, 0, 0)
    # The rest waits: the 100 filled are no longer failed.
    left = db.execute("SELECT COUNT(*) FROM channels WHERE last_fetch_status='failed'").fetchone()
    assert left[0] == 20


def test_a_ceiling_of_zero_means_none(tmp_path: Path, db: sqlite3.Connection, run: Run) -> None:
    many_failed(db, 120)
    source = source_for(db)

    go(run, start_for(tmp_path, ["channels"], maxApiCalls=0), source)

    data = run.result()
    assert len(source.channel_calls) == 3
    assert (data["apiCalls"], data["budgetReached"]) == (3, False)


def test_the_ceiling_is_shared_between_parts(
    tmp_path: Path, db: sqlite3.Connection, run: Run
) -> None:
    channel_id = add_channel(db, "failed", status="failed")
    add_video(db, "v1", channel_id, published_at=days_ago(2), status="failed")
    source = source_for(db)

    go(run, start_for(tmp_path, ["channels", "videos"], maxApiCalls=1), source)

    data = run.result()
    assert data["channels"] == {"targets": 1, "filled": 1}
    assert data["videos"] == {"targets": 1, "filled": 0}
    assert (data["apiCalls"], data["budgetReached"]) == (1, True)
    assert source.video_calls == []


# --- backfill ---


def test_backfill_asks_only_for_new_ids_and_stops_at_the_window(
    tmp_path: Path, db: sqlite3.Connection, run: Run
) -> None:
    short = add_channel(db, "short", seen=1)  # two uploads in the last week: the window is open
    add_video(db, "s_old", short, published_at=days_ago(7))
    add_video(db, "s_new", short, published_at=days_ago(1))
    deep = add_channel(db, "deep", seen=2)  # already reaches back 100 days: nothing to do
    add_video(db, "d_old", deep, published_at=days_ago(100))
    add_video(db, "d_new", deep, published_at=days_ago(1))
    source = FakeSource(
        uploads={
            "@short": ["s_new", "s_old", "s_x1", "s_x2", "s_x3"],
            "@deep": ["d_new", "d_old", "d_x1"],
        }
    )

    go(run, start_for(tmp_path, ["backfill"], months=1), source)

    assert source.read == ["@short"]
    assert source.video_calls == [["s_x1", "s_x2", "s_x3"]]
    assert run.result()["backfill"] == {"channels": 1, "saved": 3}
    assert db.execute("SELECT COUNT(*) FROM videos WHERE channel_id=?", (short,)).fetchone()[0] == 5
    assert source.sweeps[0].closed


def test_backfill_asks_for_more_than_fifteen_ids_when_the_window_needs_them(
    tmp_path: Path, db: sqlite3.Connection, run: Run
) -> None:
    # Two uploads in three days: two months back needs far more than the search's 15.
    busy = add_channel(db, "busy")
    add_video(db, "b_old", busy, published_at=days_ago(3))
    add_video(db, "b_new", busy, published_at=days_ago(1))
    add_channel(db, "unknown", seen=2)  # nothing stored: the most it may ask for
    source = FakeSource(uploads={"@busy": [f"b{i}" for i in range(40)]})

    go(run, start_for(tmp_path, ["backfill"]), source)

    assert source.read == ["@busy", "@unknown"]
    assert source.limits[0] is not None
    assert 15 < source.limits[0] < 200
    assert source.limits[1] == backfill_job.MAX_BACKFILL_IDS
    assert run.result()["backfill"] == {"channels": 1, "saved": min(40, source.limits[0])}


def test_backfill_with_nothing_new_spends_no_calls(
    tmp_path: Path, db: sqlite3.Connection, run: Run
) -> None:
    channel_id = add_channel(db, "same")
    add_video(db, "v1", channel_id, published_at=days_ago(7))
    add_video(db, "v2", channel_id, published_at=days_ago(1))
    source = FakeSource(uploads={"@same": ["v1", "v2"]})

    go(run, start_for(tmp_path, ["backfill"], months=1), source)

    assert source.video_calls == []
    data = run.result()
    assert (data["backfill"], data["apiCalls"]) == ({"channels": 0, "saved": 0}, 0)


def test_backfill_is_limited_to_the_named_handles(
    tmp_path: Path, db: sqlite3.Connection, run: Run
) -> None:
    add_channel(db, "one", seen=1)
    add_channel(db, "two", seen=2)
    source = FakeSource(uploads={"@one": ["o1"], "@two": ["t1"]})

    go(run, start_for(tmp_path, ["backfill"], handles=["@two"]), source)

    assert source.read == ["@two"]
    assert source.video_calls == [["t1"]]


class CountingPacer(Pacer):
    """No waits; remembers each pause asked for."""

    def __init__(self) -> None:
        super().__init__(None)
        self.pauses: list[str] = []

    def pause(self, key: DelayKey, reason: str | None = None) -> None:
        self.pauses.append(key)


def test_backfill_pauses_after_a_failed_read_as_after_one_that_works(
    tmp_path: Path, db: sqlite3.Connection, run: Run, monkeypatch: pytest.MonkeyPatch
) -> None:
    add_channel(db, "one", seen=1)
    add_channel(db, "two", seen=2)
    add_channel(db, "three", seen=3)
    pacer = CountingPacer()
    monkeypatch.setattr(backfill_job.Pacer, "off", lambda: pacer)
    source = FakeSource(uploads={"@one": ["o1"], "@three": ["t1"]})

    def two_fails(handle: str) -> None:
        if handle == "@two":
            raise ChannelUnreadableError(handle)

    source.on_read = two_fails

    go(run, start_for(tmp_path, ["backfill"]), source)

    assert source.read == ["@one", "@three"]  # @two raised before it was recorded
    # One page request each, failed or not: a run of failures is still a burst of requests.
    assert pacer.pauses == ["recent_videos_delay"] * 3


def test_backfill_keeps_the_ids_read_before_a_later_page_failed(
    tmp_path: Path, db: sqlite3.Connection, run: Run
) -> None:
    channel_id = add_channel(db, "partial")
    source = FakeSource()

    def later_page_fails(handle: str) -> None:
        raise ChannelUnreadableError(handle, partial=["p1", "p2"])

    source.on_read = later_page_fails

    go(run, start_for(tmp_path, ["backfill"]), source)

    assert run.end()["state"] == "done"
    assert source.video_calls == [["p1", "p2"]]
    assert run.result()["backfill"] == {"channels": 1, "saved": 2}
    stored = db.execute("SELECT COUNT(*) FROM videos WHERE channel_id=?", (channel_id,))
    assert stored.fetchone()[0] == 2


# --- handles ---


def test_unknown_handles_are_ignored_and_counted(
    tmp_path: Path, db: sqlite3.Connection, run: Run
) -> None:
    add_channel(db, "known", status="failed")
    source = source_for(db)

    go(run, start_for(tmp_path, ["channels"], handles=["@known", "@nobody", "@nothing"]), source)

    assert run.warnings() == ["2 of those channel(s) aren't on this computer yet."]
    assert source.channel_calls == [["@known"]]
    assert run.end()["state"] == "done"


def test_no_known_handle_ends_not_found(tmp_path: Path, db: sqlite3.Connection, run: Run) -> None:
    add_channel(db, "known", status="failed")
    source = source_for(db)

    go(run, start_for(tmp_path, ["channels"], handles=["@nobody"]), source)

    end = run.end()
    assert end["state"] == "failed"
    assert end["error"] == {
        "code": "not_found",
        "message": "None of those channels are on this computer yet. Search for them first.",
    }
    assert run.of("result") == []
    assert source.channel_calls == []


# --- order, stop, failure ---


class Calls(FakeSource):
    """A source that records which kind of call came when."""

    def __init__(self, calls: list[str], **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self.calls = calls
        self.on_read = lambda _handle: calls.append("read")
        self.on_videos = lambda _ids: calls.append("videos")

    def channels(self, batch: Any) -> dict[str, ChannelInfo]:
        self.calls.append("channels")
        return super().channels(batch)


def test_the_parts_run_in_a_fixed_order(tmp_path: Path, db: sqlite3.Connection, run: Run) -> None:
    add_channel(db, "chan", status="failed", seen=1)
    video_owner = add_channel(db, "vid", seen=2)
    add_video(db, "v_failed", video_owner, published_at=days_ago(2), status="failed")
    add_channel(db, "late", videos_fetched_at=None, seen=3)
    calls: list[str] = []
    details = [channel_info("@chan", "UC_chan")]
    source = Calls(calls, details=details, uploads={"@late": ["late_v1"]})

    go(run, start_for(tmp_path, ["backlog", "videos", "channels"]), source)

    assert calls == ["channels", "videos", "read", "videos"]
    data = run.result()
    assert data["backfill"] is None
    assert data["backlog"] == {"stamped": 1}


def test_parts_not_asked_for_are_null(tmp_path: Path, db: sqlite3.Connection, run: Run) -> None:
    go(run, start_for(tmp_path, ["videos"]), FakeSource())

    data = run.result()
    assert data["videos"] == {"targets": 0, "filled": 0}
    assert (data["channels"], data["backfill"], data["backlog"]) == (None, None, None)
    assert (data["apiCalls"], data["budgetReached"]) == (0, False)


def test_a_stop_gives_a_partial_result(tmp_path: Path, db: sqlite3.Connection, run: Run) -> None:
    many_failed(db, 120)
    add_channel(db, "late", videos_fetched_at=None, seen=1)
    source = source_for(db)
    source.on_read = lambda _handle: pytest.fail("stopped before the backlog")
    plain = source.channels

    def stop_after_first(batch: Any) -> dict[str, ChannelInfo]:
        found = plain(batch)
        run_control.request_stop()
        return found

    source.channels = stop_after_first  # pyright: ignore[reportAttributeAccessIssue]

    go(run, start_for(tmp_path, ["channels", "backlog"]), source)

    data = run.result()
    assert data["channels"] == {"targets": 120, "filled": 50}
    assert data["backlog"] == {"stamped": 0}
    assert data["apiCalls"] == 1
    end = run.end()
    assert (end["state"], end["at"]) == ("stopped", 0)
    assert "error" not in end or end["error"] is None
    assert run.messages()[-2]["type"] == "result"


def test_blocked_ends_failed_with_no_result(
    tmp_path: Path, db: sqlite3.Connection, run: Run
) -> None:
    add_channel(db, "one", status="failed")  # no stored uploads, so the window is open
    source = source_for(db)
    source.uploads = {"@one": ["o1"]}

    def blocked(_handle: str) -> None:
        raise SearchBlockedError("blocked at https://user:secret@proxy.example")

    source.on_read = blocked

    go(run, start_for(tmp_path, ["channels", "backfill"]), source)

    end = run.end()
    assert end["state"] == "failed"
    assert end["error"]["code"] == "blocked"
    assert "secret" not in run.out.getvalue()
    assert run.of("result") == []
    assert db.execute("SELECT status FROM runs").fetchone()[0] == "interrupted"


def test_a_refused_quota_ends_failed_with_that_code(
    tmp_path: Path, db: sqlite3.Connection, run: Run
) -> None:
    add_channel(db, "one", status="failed")
    source = source_for(db)

    def spent(_ids: Sequence[str]) -> None:
        raise YouTubeError("quota", "The YouTube API quota for today is spent.")

    source.on_videos = spent
    channel_id = "UC_one"
    add_video(db, "v1", channel_id, published_at=days_ago(1), status="failed")

    go(run, start_for(tmp_path, ["videos"]), source)

    end = run.end()
    assert (end["state"], end["error"]["code"]) == ("failed", "quota")
    assert run.of("result") == []


def test_no_key_ends_failed(tmp_path: Path, run: Run) -> None:
    start = start_with(
        source="live",
        dataDir=str(tmp_path),
        settings={},
        secrets__youtubeKey=None,
        job={"kind": "backfill", "only": ["channels"]},
    )

    go(run, start)

    end = run.end()
    assert (end["state"], end["error"]["code"]) == ("failed", "no_youtube_key")
    assert run.of("result") == []


# --- backlog ---


def test_backlog_stamps_channels_missing_uploads(
    tmp_path: Path, db: sqlite3.Connection, run: Run
) -> None:
    for i, name in enumerate("abcde"):
        add_channel(db, name, videos_fetched_at=None, seen=i + 1)
    add_channel(db, "done", seen=9)
    source = FakeSource(uploads={"@a": ["a1", "a2"], "@c": ["c1"]})

    go(run, start_for(tmp_path, ["backlog"]), source)

    assert run.result()["backlog"] == {"stamped": 5}
    assert source.read == ["@a", "@b", "@c", "@d", "@e"]
    assert store.count_channels_needing_videos(db) == 0
    assert db.execute("SELECT COUNT(*) FROM videos").fetchone()[0] == 3
    # The slices are the search's own size (25): a short store takes one, and the last one is empty.
    assert run.end()["state"] == "done"
    assert run_kinds(db) == ["catch-up"]


def test_other_parts_record_a_re_enrich_run(
    tmp_path: Path, db: sqlite3.Connection, run: Run
) -> None:
    go(run, start_for(tmp_path, ["channels", "videos"]), FakeSource())

    assert run_kinds(db) == ["re-enrich"]
    assert db.execute("SELECT status FROM runs").fetchone()[0] == "done"
