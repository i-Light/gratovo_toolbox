"""The video backlog: channels anywhere in the store still missing their recent uploads, worked a
slice at a time and stamped one by one, so a stop or a kill costs only the channel in flight."""

import sqlite3
from collections.abc import Sequence

import pytest
from fakes import Events, FakeSource, make_search

from gratovo_pipeline import store
from gratovo_pipeline.search import backfill
from gratovo_pipeline.youtube import YouTubeError


def add_channels(conn: sqlite3.Connection, names: str) -> None:
    for i, name in enumerate(names):
        conn.execute(
            "INSERT INTO channels (channel_id, handle, first_seen_at) VALUES (?, ?, ?)",
            (f"UC_{name}", f"@{name}", f"2026-01-0{i + 1}T00:00:00Z"),
        )
    conn.commit()


def stamped(conn: sqlite3.Connection) -> int:
    return conn.execute(
        "SELECT COUNT(*) FROM channels WHERE videos_fetched_at IS NOT NULL"
    ).fetchone()[0]


def test_each_channel_is_saved_before_the_next_one_is_read(conn: sqlite3.Connection) -> None:
    add_channels(conn, "abcde")
    source = FakeSource()
    stamped_when_read: dict[str, int] = {}
    source.on_read = lambda handle: stamped_when_read.__setitem__(handle, stamped(conn))

    assert backfill.backfill_missing_videos(make_search(conn, source), limit=10) == 5

    # Oldest first, and each one stamped before the next one's uploads are read.
    assert stamped_when_read == {"@a": 0, "@b": 1, "@c": 2, "@d": 3, "@e": 4}
    assert store.count_channels_needing_videos(conn) == 0


def test_a_stop_partway_keeps_every_channel_already_finished(conn: sqlite3.Connection) -> None:
    add_channels(conn, "abcde")
    source = FakeSource()

    def killed_at_c(handle: str) -> None:
        if handle == "@c":
            assert stamped(conn) == 2
            raise KeyboardInterrupt

    source.on_read = killed_at_c

    with pytest.raises(KeyboardInterrupt):
        backfill.backfill_missing_videos(make_search(conn, source), limit=10)

    assert set(store.get_video_backfill_candidates(conn, limit=10)) == {"@c", "@d", "@e"}


def test_channels_with_uploads_are_stamped_once_their_details_land(
    conn: sqlite3.Connection,
) -> None:
    add_channels(conn, "abcd")
    source = FakeSource(uploads={f"@{n}": [f"{n}_v1", f"{n}_v2"] for n in "abcd"})

    backfill.backfill_missing_videos(make_search(conn, source), limit=10)

    assert stamped(conn) == 4
    assert conn.execute("SELECT COUNT(*) FROM videos").fetchone()[0] == 8
    assert store.count_channels_needing_videos(conn) == 0


def test_a_channel_waits_for_its_batch_before_it_is_stamped(conn: sqlite3.Connection) -> None:
    # 30 uploads each: @a's land with @b's in the first call of 50; @b's last ten wait.
    add_channels(conn, "abc")
    source = FakeSource(uploads={f"@{n}": [f"{n}_{i}" for i in range(30)] for n in "abc"})
    stamped_when_read: dict[str, int] = {}
    source.on_read = lambda handle: stamped_when_read.__setitem__(handle, stamped(conn))

    backfill.backfill_missing_videos(make_search(conn, source), limit=10)

    assert stamped_when_read == {"@a": 0, "@b": 0, "@c": 1}
    assert [len(c) for c in source.video_calls] == [50, 40]
    assert stamped(conn) == 3


def test_an_api_failure_leaves_the_unsaved_channels_in_the_backlog(
    conn: sqlite3.Connection,
) -> None:
    add_channels(conn, "ab")
    source = FakeSource(uploads={"@a": ["a_v1"], "@b": [f"b_{i}" for i in range(60)]})

    def quota_on_the_first_full_batch(ids: Sequence[str]) -> None:
        if len(ids) == 50:
            raise YouTubeError("quota", "The YouTube API quota for today is spent.")

    source.on_videos = quota_on_the_first_full_batch

    with pytest.raises(YouTubeError):
        backfill.backfill_missing_videos(make_search(conn, source), limit=10)

    assert set(store.get_video_backfill_candidates(conn, limit=10)) == {"@a", "@b"}
    assert source.video_calls == []


def test_an_empty_backlog_does_nothing(conn: sqlite3.Connection) -> None:
    source = FakeSource()
    assert backfill.backfill_missing_videos(make_search(conn, source), limit=10) == 0
    assert source.sweeps == []


def test_one_worker_at_a_time_works_the_backlog(conn: sqlite3.Connection) -> None:
    add_channels(conn, "a")
    source = FakeSource()
    search = make_search(conn, source)
    with backfill.BACKLOG_LOCK:
        assert backfill.take_turn(search) is False
    assert source.read == []
    events = search.events
    assert isinstance(events, Events)
    assert events.lines[-1] == ("info", "Another worker is catching up the video backlog.")

    assert backfill.take_turn(search) is True
    assert source.read == ["@a"]
