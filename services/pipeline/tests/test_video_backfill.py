"""The video backlog query and how the catalog treats its stamp (ported from the old
test_video_backfill; its stamping-per-channel cases are in test_backfill_job.py, with the code
they test).

A channel that missed its video turn (the run crashed, was blocked, ran out of time) is `known` on
every later run and never reconsidered by the per-keyword check. The backlog query has to find it
by scanning the whole store, and must leave out everything that doesn't belong, so it can never
turn into a re-fetch-everything sweep.
"""

import sqlite3

from gratovo_pipeline import store

OLD = "2020-01-01T00:00:00Z"


def channel(
    conn: sqlite3.Connection,
    channel_id: str,
    handle: str,
    first_seen_at: str = "2026-01-01T00:00:00Z",
    videos_fetched_at: str | None = None,
    force_refetch: int = 0,
    country: str | None = None,
) -> None:
    conn.execute(
        "INSERT INTO channels "
        "(channel_id, handle, first_seen_at, videos_fetched_at, force_refetch, country) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (channel_id, handle, first_seen_at, videos_fetched_at, force_refetch, country),
    )
    conn.commit()


# --- who belongs in the backlog ---


def test_a_channel_whose_videos_were_never_fetched_is_in_the_backlog(
    conn: sqlite3.Connection,
) -> None:
    channel(conn, "UC_a", "@a")
    assert store.get_video_backfill_candidates(conn, limit=10) == {"@a": "UC_a"}


def test_a_channel_with_videos_already_fetched_is_not(conn: sqlite3.Connection) -> None:
    channel(conn, "UC_a", "@a", videos_fetched_at="2026-01-02T00:00:00Z")
    assert store.get_video_backfill_candidates(conn, limit=10) == {}


def test_a_forced_refetch_is_in_the_backlog_even_with_videos_fetched(
    conn: sqlite3.Connection,
) -> None:
    channel(conn, "UC_a", "@a", videos_fetched_at="2026-01-02T00:00:00Z", force_refetch=1)
    assert store.get_video_backfill_candidates(conn, limit=10) == {"@a": "UC_a"}


def test_marking_videos_fetched_clears_a_forced_refetch(conn: sqlite3.Connection) -> None:
    # The old bug: the stamp was set but force_refetch stayed 1, so the catch-up re-fetched the
    # same channels every launch and never finished.
    channel(conn, "UC_a", "@a", force_refetch=1)
    store.mark_channels_videos_fetched(conn, ["UC_a"])
    assert store.get_video_backfill_candidates(conn, limit=10) == {}
    assert store.count_channels_needing_videos(conn) == 0
    row = conn.execute(
        "SELECT force_refetch, videos_fetched_at FROM channels WHERE channel_id='UC_a'"
    ).fetchone()
    assert row["force_refetch"] == 0
    assert row["videos_fetched_at"] is not None


def test_an_empty_store_asks_for_nothing(conn: sqlite3.Connection) -> None:
    assert store.get_video_backfill_candidates(conn, limit=10) == {}
    assert store.count_channels_needing_videos(conn) == 0


def test_a_channel_waiting_for_a_teammate_s_copy_is_left_out(conn: sqlite3.Connection) -> None:
    channel(conn, "UC_a", "@a")
    store.clear_video_stamps(conn, ["UC_a"])
    conn.commit()
    assert store.get_video_backfill_candidates(conn, limit=10) == {}
    assert store.count_channels_awaiting_peers(conn) == 1


def test_it_rejoins_the_backlog_when_the_wait_runs_out(conn: sqlite3.Connection) -> None:
    channel(conn, "UC_a", "@a")
    store.clear_video_stamps(conn, ["UC_a"])
    conn.commit()
    later = 1e10  # far past AWAITING_PEER_DAYS
    assert store.count_channels_needing_videos(conn, now=later) == 1
    assert store.count_channels_awaiting_peers(conn, now=later) == 0


# --- order and limit ---


def test_the_oldest_discovered_channel_comes_first(conn: sqlite3.Connection) -> None:
    channel(conn, "UC_new", "@new", first_seen_at="2026-03-01T00:00:00Z")
    channel(conn, "UC_old", "@old", first_seen_at="2026-01-01T00:00:00Z")
    channel(conn, "UC_mid", "@mid", first_seen_at="2026-02-01T00:00:00Z")
    assert list(store.get_video_backfill_candidates(conn, limit=10)) == ["@old", "@mid", "@new"]


def test_the_limit_takes_only_the_oldest_slice(conn: sqlite3.Connection) -> None:
    for i in range(5):
        channel(conn, f"UC_{i}", f"@{i}", first_seen_at=f"2026-01-0{i + 1}T00:00:00Z")
    assert set(store.get_video_backfill_candidates(conn, limit=2)) == {"@0", "@1"}


# --- country ---


def test_a_country_narrows_the_backlog(conn: sqlite3.Connection) -> None:
    channel(conn, "UC_us", "@us", country="US")
    channel(conn, "UC_gb", "@gb", country="GB")
    channel(conn, "UC_none", "@none")
    assert store.get_video_backfill_candidates(conn, limit=10, country="US") == {"@us": "UC_us"}
    assert store.count_channels_needing_videos(conn, country="US") == 1


def test_no_country_sees_every_country(conn: sqlite3.Connection) -> None:
    channel(conn, "UC_us", "@us", country="US")
    channel(conn, "UC_gb", "@gb", country="GB")
    assert set(store.get_video_backfill_candidates(conn, limit=10)) == {"@us", "@gb"}


def test_the_count_matches_the_candidates(conn: sqlite3.Connection) -> None:
    channel(conn, "UC_a", "@a")
    channel(conn, "UC_b", "@b", videos_fetched_at="2026-01-02T00:00:00Z")
    channel(conn, "UC_c", "@c", videos_fetched_at="2026-01-02T00:00:00Z", force_refetch=1)
    assert store.count_channels_needing_videos(conn) == 2
    assert len(store.get_video_backfill_candidates(conn, limit=100)) == 2


# --- the stamp and the catalog ---


def test_stamping_videos_fetched_makes_the_channel_due_for_upload(conn: sqlite3.Connection) -> None:
    channel(conn, "UC_a", "@a", first_seen_at=OLD)
    assert store.get_blob_upload_candidates(conn) == []
    store.mark_channels_videos_fetched(conn, ["UC_a"])
    assert [r["channel_id"] for r in store.get_blob_upload_candidates(conn)] == ["UC_a"]


def test_a_pull_does_not_wipe_a_local_videos_fetched_stamp(conn: sqlite3.Connection) -> None:
    channel(conn, "UC_a", "@a", first_seen_at=OLD, videos_fetched_at="2026-09-01T00:00:00Z")
    store.apply_catalog_channel(
        conn,
        {
            "channel_id": "UC_a",
            "handle": "@a",
            "first_seen_at": OLD,
            "videos_fetched_at": None,
            "blob_version": None,
        },
        store._now(),  # pyright: ignore[reportPrivateUsage]
    )
    conn.commit()
    row = conn.execute("SELECT videos_fetched_at FROM channels WHERE channel_id='UC_a'").fetchone()
    assert row["videos_fetched_at"] == "2026-09-01T00:00:00Z"
    assert store.get_video_backfill_candidates(conn, limit=10) == {}


def test_an_unarchive_reopens_a_stamped_channel(conn: sqlite3.Connection) -> None:
    channel(conn, "UC_a", "@a", first_seen_at=OLD, videos_fetched_at="2026-09-01T00:00:00Z")
    store.apply_catalog_unarchived(conn, "UC_a", "@a")
    conn.commit()
    assert set(store.get_video_backfill_candidates(conn, limit=10)) == {"@a"}


# --- the rollups ---


def test_the_rollups_count_the_last_30_days_from_the_read_not_from_now(
    conn: sqlite3.Connection,
) -> None:
    channel(conn, "UC_a", "@a", videos_fetched_at="2026-06-30T00:00:00Z")
    rows = [
        ("v1", "2026-06-25T00:00:00Z", "100"),
        ("v2", "2026-06-20T00:00:00Z", "300"),
        ("v3", "2026-06-15T00:00:00Z", None),  # in the window, but no count
        ("v4", "2026-04-01T00:00:00Z", "9999"),  # outside it
    ]
    conn.executemany(
        "INSERT INTO videos (video_id, channel_id, published_at, view_count) "
        "VALUES (?, 'UC_a', ?, ?)",
        rows,
    )
    store.compute_channel_rollups(conn, ["UC_a"])
    row = conn.execute(
        "SELECT videos_last_30, median_views_last_30, latest_upload_at FROM channels"
    ).fetchone()
    assert (row["videos_last_30"], row["median_views_last_30"], row["latest_upload_at"]) == (
        3,
        200,
        "2026-06-25T00:00:00Z",
    )
