"""pipeline.db's schema versions (plan D7): version 2 adds `video_transcripts` and nothing else; a
version-1 file keeps every row, a new file starts at 2, and a newer file is refused."""

import sqlite3
from pathlib import Path

import pytest

from gratovo_pipeline import store


def _tables(conn: sqlite3.Connection) -> set[str]:
    rows = conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    return {r["name"] for r in rows}


def _version(conn: sqlite3.Connection) -> int:
    return conn.execute("PRAGMA user_version").fetchone()[0]


def _count(conn: sqlite3.Connection, table: str) -> int:
    return conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]  # noqa: S608 - a name from sqlite_master


def _version_1_file(path: Path) -> None:
    """A file as a version-1 pipeline left it: today's tables but `video_transcripts`, with rows."""
    conn = store.get_connection(path)
    store.init_db(conn)
    conn.execute("DROP TABLE video_transcripts")
    conn.execute("ALTER TABLE channels DROP COLUMN found_email_sources")
    conn.execute("PRAGMA user_version=1")
    store.seed_keywords(conn, ["ai agents tutorial", "claude code review"])
    conn.execute(
        "INSERT INTO channels (channel_id, handle, first_seen_at) VALUES ('UC_a', '@aitools', 'T')"
    )
    conn.execute(
        "INSERT INTO videos (video_id, channel_id, title, published_at) "
        "VALUES ('abcdefghijk', 'UC_a', 'Cursor vs Claude Code', '2026-10-10T00:00:00Z')"
    )
    conn.commit()
    conn.close()


def test_a_new_file_is_created_at_version_10(conn: sqlite3.Connection) -> None:
    assert store.SCHEMA_VERSION == 10
    assert _version(conn) == store.SCHEMA_VERSION
    assert {"video_transcripts", "archived_videos"} <= _tables(conn)


def test_a_version_1_file_gains_video_transcripts_and_keeps_every_row(tmp_path: Path) -> None:
    path = tmp_path / "pipeline.db"
    _version_1_file(path)
    before = store.get_connection(path)
    tables_before = _tables(before)
    counts_before = {t: _count(before, t) for t in tables_before}
    before.close()
    assert "video_transcripts" not in tables_before

    conn = store.get_connection(path)
    store.init_db(conn)

    assert _version(conn) == store.SCHEMA_VERSION
    assert _tables(conn) == tables_before | {"video_transcripts"}, "version 2 adds one table only"
    for table, count in counts_before.items():
        assert _count(conn, table) == count, table
    assert store.latest_video(conn, "UC_a") == {
        "video_id": "abcdefghijk",
        "title": "Cursor vs Claude Code",
        "published_at": "2026-10-10T00:00:00Z",
    }
    assert counts_before["keywords"] == 2
    conn.close()


def test_a_file_newer_than_version_10_is_refused(tmp_path: Path) -> None:
    path = tmp_path / "pipeline.db"
    conn = store.get_connection(path)
    conn.execute("PRAGMA user_version=11")
    with pytest.raises(store.SchemaTooNewError):
        store.init_db(conn)
    assert _version(conn) == 11, "the newer file is left as it was"
    assert "video_transcripts" not in _tables(conn)
    conn.close()


def test_a_transcript_is_kept_and_its_moments_added(conn: sqlite3.Connection) -> None:
    store.save_video_transcript(
        conn,
        "abcdefghijk",
        "UC_a",
        {"transcript": "t", "timed_transcript": "[0:00] t", "is_asr": True},
    )
    store.save_video_moments(conn, "abcdefghijk", [{"at": "0:00", "quote": "t"}])

    row = store.get_video_transcript(conn, "abcdefghijk")

    assert row is not None
    assert row["is_asr"] == 1
    assert row["error"] is None
    assert row["moments"] == '[{"at": "0:00", "quote": "t"}]'
    assert row["moments_at"] is not None
    assert store.get_video_transcript(conn, "zzzzzzzzzzz") is None


def test_a_version_2_file_gains_found_email_sources_and_keeps_its_data(tmp_path: Path) -> None:
    path = tmp_path / "pipeline.db"
    conn = store.get_connection(path)
    store.init_db(conn)
    conn.execute("ALTER TABLE channels DROP COLUMN found_email_sources")
    conn.execute("PRAGMA user_version=2")
    conn.execute(
        "INSERT INTO channels (channel_id, handle, first_seen_at, found_emails) "
        "VALUES ('UC_a', '@aitools', 'T', '[\"hi@aitoolsweekly.example\"]')"
    )
    conn.commit()
    conn.close()

    conn = store.get_connection(path)
    store.init_db(conn)

    assert _version(conn) == store.SCHEMA_VERSION
    row = conn.execute(
        "SELECT found_emails, found_email_sources FROM channels WHERE channel_id='UC_a'"
    ).fetchone()
    assert row["found_emails"] == '["hi@aitoolsweekly.example"]'
    assert row["found_email_sources"] is None
    conn.close()


def test_a_version_2_file_that_already_has_the_column_opens_and_ends_at_the_current_version(
    tmp_path: Path,
) -> None:
    """A crash between the column and the version, or two openers at once, leaves the column in
    a version-2 file; opening it again must not fail on "duplicate column name"."""
    path = tmp_path / "pipeline.db"
    conn = store.get_connection(path)
    store.init_db(conn)
    conn.execute("PRAGMA user_version=2")
    conn.execute(
        "INSERT INTO channels (channel_id, handle, first_seen_at, found_email_sources) "
        "VALUES ('UC_a', '@aitools', 'T', '[]')"
    )
    conn.commit()
    conn.close()

    conn = store.get_connection(path)
    store.init_db(conn)
    store.init_db(conn)

    assert _version(conn) == store.SCHEMA_VERSION
    row = conn.execute(
        "SELECT found_email_sources FROM channels WHERE channel_id='UC_a'"
    ).fetchone()
    assert row["found_email_sources"] == "[]"
    conn.close()


def _version_3_file(path: Path) -> None:
    """A file as a version-3 pipeline left it: tombstones without the version-4 facts."""
    conn = store.get_connection(path)
    store.init_db(conn)
    conn.execute("ALTER TABLE channels DROP COLUMN videos_known")
    conn.execute("ALTER TABLE channels DROP COLUMN unreadable_until")
    conn.execute(
        "INSERT INTO channels (channel_id, handle, first_seen_at) VALUES ('UC_a', '@aitools', 'T')"
    )
    conn.execute("DROP TABLE channel_archive")
    conn.execute(
        "CREATE TABLE channel_archive (channel_id TEXT PRIMARY KEY, handle TEXT, label TEXT, "
        " archived_at TEXT, subscribers TEXT, found_at TEXT, found_via TEXT, source TEXT, "
        " announced INTEGER NOT NULL DEFAULT 0, median_views_last_30 INTEGER, "
        " median_basis TEXT, videos_found_count INTEGER)"
    )
    conn.execute("PRAGMA user_version=3")
    conn.execute(
        "INSERT INTO channel_archive (channel_id, handle, label, archived_at, subscribers, "
        " found_at, found_via, source, announced, median_views_last_30, median_basis, "
        " videos_found_count) "
        "VALUES ('UC_old', '@oldaichannel', 'rejected', '2026-06-01T00:00:00Z', '3100', "
        " '2026-01-01T00:00:00Z', "
        ' \'[{"keyword": "ai agents", "limit": 25, "discovered_at": "2026-01-01T00:00:00Z"}]\', '
        " 'local', 1, 800, 'window30', 12)"
    )
    conn.execute(
        "INSERT INTO channel_archive (channel_id, handle, label, archived_at) "
        "VALUES ('UC_bare', NULL, 'rejected', NULL)"
    )
    conn.commit()
    conn.close()


def test_a_version_3_file_gains_the_tombstone_facts_and_loses_nothing(tmp_path: Path) -> None:
    path = tmp_path / "pipeline.db"
    _version_3_file(path)
    before = store.get_connection(path)
    old_rows = [dict(r) for r in before.execute("SELECT * FROM channel_archive ORDER BY 1")]
    before.close()

    conn = store.get_connection(path)
    store.init_db(conn)
    store.init_db(conn)  # a second open runs nothing again

    assert _version(conn) == store.SCHEMA_VERSION
    rows = [dict(r) for r in conn.execute("SELECT * FROM channel_archive ORDER BY 1")]
    assert len(rows) == len(old_rows)
    for old, new in zip(old_rows, rows, strict=True):
        assert {k: new[k] for k in old} == old, "every old value as it was"
        assert all(new[name] is None for name, _ in store.ARCHIVE_FACTS), "unknown, not zero"
    row = conn.execute("SELECT handle, videos_known FROM channels").fetchone()
    assert (row["handle"], row["videos_known"]) == ("@aitools", None)
    assert conn.execute("SELECT unreadable_until FROM channels").fetchone()[0] is None
    conn.close()


def test_a_version_4_file_from_before_the_read_columns_gains_them(tmp_path: Path) -> None:
    """Version 4 grew while unreleased: a development file already at 4 can lack its newest
    columns, and gets them on the next open, its rows as they were."""
    path = tmp_path / "pipeline.db"
    conn = store.get_connection(path)
    store.init_db(conn)
    for column in ("read_failures", "median_known", "median_known_basis", "videos_last_30_known"):
        conn.execute(f"ALTER TABLE channels DROP COLUMN {column}")
    conn.execute(
        "INSERT INTO channels (channel_id, handle, first_seen_at) VALUES ('UC_a', '@aitools', 'T')"
    )
    conn.execute("PRAGMA user_version=3")
    conn.commit()
    conn.close()

    conn = store.get_connection(path)
    store.init_db(conn)

    assert _version(conn) == store.SCHEMA_VERSION
    columns = {r[1] for r in conn.execute("PRAGMA table_info(channels)").fetchall()}
    assert {"read_failures", "median_known", "median_known_basis", "videos_last_30_known"} <= (
        columns
    )
    row = conn.execute("SELECT * FROM channels").fetchone()
    assert (row["handle"], row["read_failures"], row["median_known"]) == ("@aitools", 0, None)
    conn.close()


def test_a_version_3_file_that_already_has_some_facts_opens(tmp_path: Path) -> None:
    """A crash part way through the version-4 columns leaves some in a version-3 file."""
    path = tmp_path / "pipeline.db"
    conn = store.get_connection(path)
    store.init_db(conn)
    conn.execute("ALTER TABLE channel_archive DROP COLUMN found_emails")
    conn.execute("PRAGMA user_version=3")
    conn.commit()
    conn.close()

    conn = store.get_connection(path)
    store.init_db(conn)

    assert _version(conn) == store.SCHEMA_VERSION
    columns = {r[1] for r in conn.execute("PRAGMA table_info(channel_archive)").fetchall()}
    assert {name for name, _ in store.ARCHIVE_FACTS} <= columns
    conn.close()


def test_a_version_4_file_gains_the_keyword_failures_column(tmp_path: Path) -> None:
    path = tmp_path / "pipeline.db"
    conn = store.get_connection(path)
    store.init_db(conn)
    store.seed_keywords(conn, ["ai agents tutorial"])
    conn.execute("ALTER TABLE keywords DROP COLUMN failures")
    conn.execute("PRAGMA user_version=4")
    conn.commit()
    conn.close()

    conn = store.get_connection(path)
    store.init_db(conn)
    store.init_db(conn)  # a second open runs nothing again

    assert _version(conn) == store.SCHEMA_VERSION
    row = conn.execute("SELECT * FROM keywords").fetchone()
    assert (row["keyword"], row["status"], row["failures"]) == ("ai agents tutorial", "pending", 0)
    conn.close()


def test_a_version_5_file_gains_the_run_bytes_column_and_keeps_its_runs(tmp_path: Path) -> None:
    path = tmp_path / "pipeline.db"
    conn = store.get_connection(path)
    store.init_db(conn)
    run_id = store.start_run(conn, 3)
    conn.execute("ALTER TABLE runs DROP COLUMN bytes_downloaded")
    conn.execute("PRAGMA user_version=5")
    conn.commit()
    conn.close()

    conn = store.get_connection(path)
    store.init_db(conn)
    store.init_db(conn)  # a second open runs nothing again

    assert _version(conn) == store.SCHEMA_VERSION
    run = store.get_run(conn, run_id)
    assert run is not None
    assert (run["keywords_total"], run["bytes_downloaded"]) == (3, 0)
    store.update_run_progress(conn, run_id, bytes_downloaded=1234)
    run = store.get_run(conn, run_id)
    assert run is not None
    assert run["bytes_downloaded"] == 1234
    conn.close()


def test_a_failed_keyword_from_a_teammate_applies_without_error(conn: sqlite3.Connection) -> None:
    store.apply_remote_keyword(
        conn, {"keyword": "claude code review", "status": "failed", "completed_at": None}
    )
    row = store.get_keyword(conn, "claude code review")
    assert row is not None
    assert (row["status"], row["failures"], row["source"]) == ("failed", 0, "remote")
    assert store.get_dirty_keywords(conn) == []


# --- version 8 (step S4): the tombstone's new facts and archived_videos ---

V8_FACTS = [name for name, _ in store._ARCHIVE_FACTS_V8]  # pyright: ignore[reportPrivateUsage]


# The tables a version-7 pipeline created: its SCHEMA and VIDEO_TRANSCRIPTS as of aea931c (step S3,
# the last version 7), comments left out. A new version-7 file ran these and then steps 2 to 7.
V7_SCHEMA = """
CREATE TABLE IF NOT EXISTS keywords (
    keyword TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'pending',
    added_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    channels_found INTEGER NOT NULL DEFAULT 0,
    claimed_by TEXT,
    search_settings TEXT,
    source TEXT NOT NULL DEFAULT 'local',
    dirty INTEGER NOT NULL DEFAULT 1,
    failures INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS channels (
    channel_id TEXT PRIMARY KEY,
    handle TEXT NOT NULL,
    name TEXT,
    description TEXT,
    subscribers TEXT,
    profile_picture TEXT,
    banner TEXT,
    link TEXT,
    country TEXT,
    first_seen_at TEXT NOT NULL,
    last_fetched_at TEXT,
    last_fetch_status TEXT,
    videos_fetched_at TEXT,
    force_refetch INTEGER NOT NULL DEFAULT 0,
    videos_last_30 INTEGER NOT NULL DEFAULT 0,
    median_views_last_30 INTEGER,
    latest_upload_at TEXT,
    videos_known INTEGER,
    unreadable_until TEXT,
    read_failures INTEGER NOT NULL DEFAULT 0,
    median_known INTEGER,
    median_known_basis TEXT,
    videos_last_30_known INTEGER,
    blob_uploaded_at TEXT,
    blob_version TEXT,
    blob_applied_version TEXT,
    blob_announced_version TEXT,
    announced_at TEXT,
    awaiting_peer_since TEXT,
    sponsored_ratio REAL,
    seen_brands TEXT,
    found_emails TEXT,
    total_views INTEGER,
    video_count INTEGER,
    subscribers_hidden INTEGER,
    started_at TEXT,
    default_language TEXT,
    topics TEXT,
    uploads_playlist TEXT,
    made_for_kids INTEGER,
    main_language TEXT,
    main_language_basis TEXT,
    topic_counts TEXT,
    median_likes INTEGER,
    median_comments INTEGER,
    engagement_rate REAL,
    median_duration_s INTEGER,
    shorts_share REAL,
    paid_share REAL
);
CREATE INDEX IF NOT EXISTS idx_channels_handle ON channels(handle);
CREATE INDEX IF NOT EXISTS idx_channels_blob_pending
    ON channels(blob_version) WHERE blob_version IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_channels_unannounced
    ON channels(announced_at) WHERE announced_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_channels_first_seen ON channels (first_seen_at DESC, channel_id);
CREATE TABLE IF NOT EXISTS channel_keywords (
    channel_id TEXT NOT NULL REFERENCES channels(channel_id),
    keyword TEXT NOT NULL,
    discovered_at TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'local',
    announced INTEGER NOT NULL DEFAULT 0,
    position INTEGER,
    PRIMARY KEY (channel_id, keyword)
);
CREATE INDEX IF NOT EXISTS idx_channel_keywords_keyword ON channel_keywords(keyword);
CREATE TABLE IF NOT EXISTS videos (
    video_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL REFERENCES channels(channel_id),
    title TEXT,
    description TEXT,
    thumbnail TEXT,
    tags TEXT,
    published_at TEXT,
    view_count TEXT,
    last_fetched_at TEXT,
    last_fetch_status TEXT,
    audio_language TEXT,
    default_language TEXT,
    category_id TEXT,
    live_content TEXT,
    like_count TEXT,
    comment_count TEXT,
    duration_s INTEGER,
    has_captions INTEGER,
    made_for_kids INTEGER,
    topics TEXT,
    paid_placement INTEGER
);
CREATE INDEX IF NOT EXISTS idx_videos_channel_published ON videos (channel_id, published_at DESC);
CREATE TABLE IF NOT EXISTS channel_archive (
    channel_id TEXT PRIMARY KEY,
    handle TEXT,
    label TEXT,
    archived_at TEXT,
    subscribers TEXT,
    found_at TEXT,
    found_via TEXT,
    source TEXT,
    announced INTEGER NOT NULL DEFAULT 0,
    median_views_last_30 INTEGER,
    median_basis TEXT,
    videos_found_count INTEGER,
    name TEXT,
    country TEXT,
    videos_last_30 INTEGER,
    latest_upload_at TEXT,
    seen_brands TEXT,
    found_emails TEXT,
    found_email_sources TEXT
);
CREATE INDEX IF NOT EXISTS idx_channel_archive_archived_at
    ON channel_archive (archived_at DESC, channel_id);
CREATE TABLE IF NOT EXISTS sync_state (
    collection TEXT PRIMARY KEY,
    last_pushed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS _applied_segments (
    key TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS archive_keyword_pending (
    channel_id TEXT NOT NULL,
    keyword TEXT NOT NULL,
    handles_limit INTEGER,
    discovered_at TEXT NOT NULL,
    PRIMARY KEY (channel_id, keyword)
);
CREATE TABLE IF NOT EXISTS runs (
    run_id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    keywords_total INTEGER NOT NULL DEFAULT 0,
    keywords_done INTEGER NOT NULL DEFAULT 0,
    channels_upserted INTEGER NOT NULL DEFAULT 0,
    videos_upserted INTEGER NOT NULL DEFAULT 0,
    pid INTEGER,
    kind TEXT NOT NULL DEFAULT 'search',
    bytes_downloaded INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS video_transcripts (
    video_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    is_asr INTEGER,
    transcript TEXT,
    timed_transcript TEXT,
    error TEXT,
    moments TEXT,
    moments_at TEXT
);
"""


def _v7_tables(path: Path) -> sqlite3.Connection:
    """A new file as a version-7 pipeline made it: its own CREATE text, then steps 2 to 7."""
    conn = store.get_connection(path)
    conn.executescript(V7_SCHEMA)
    for step in range(2, 8):
        store.MIGRATIONS[step](conn)
    conn.execute("PRAGMA user_version=7")
    return conn


def _version_7_file(path: Path) -> None:
    """A file as a version-7 pipeline left it: no archived_videos, no version 8 columns, with a
    tombstone, a channel and its videos."""
    conn = _v7_tables(path)
    conn.execute(
        "INSERT INTO channel_archive (channel_id, handle, label, archived_at, name, country, "
        " videos_last_30, median_views_last_30, median_basis, videos_found_count) "
        "VALUES ('UC_old', '@promptweekly', 'rejected', '2026-06-01T00:00:00Z', 'Prompt Weekly', "
        " 'GB', 4, 2300, 'window30', 40)"
    )
    conn.execute(
        "INSERT INTO channels (channel_id, handle, first_seen_at, videos_fetched_at) "
        "VALUES ('UC_a', '@aitools', '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z')"
    )
    conn.execute(
        "INSERT INTO videos (video_id, channel_id, title, view_count, last_fetch_status) "
        "VALUES ('abcdefghijk', 'UC_a', 'Cursor vs Claude Code', '5100', 'success')"
    )
    conn.commit()
    conn.close()


def test_a_version_7_file_migrates_to_8_and_loses_nothing(tmp_path: Path) -> None:
    path = tmp_path / "pipeline.db"
    _version_7_file(path)
    before = store.get_connection(path)
    assert "archived_videos" not in _tables(before)
    old_tomb = dict(before.execute("SELECT * FROM channel_archive").fetchone())
    old_channel = dict(before.execute("SELECT * FROM channels").fetchone())
    before.close()

    conn = store.get_connection(path)
    store.init_db(conn)
    store.init_db(conn)  # safe to run twice

    assert _version(conn) == store.SCHEMA_VERSION
    assert "archived_videos" in _tables(conn)
    tomb = dict(conn.execute("SELECT * FROM channel_archive").fetchone())
    assert {k: tomb[k] for k in old_tomb} == old_tomb, "every old value as it was"
    assert all(tomb[name] is None for name in V8_FACTS), "unknown, not zero"
    channel = dict(conn.execute("SELECT * FROM channels").fetchone())
    assert {k: channel[k] for k in old_channel} == old_channel
    assert (channel["videos_fetched_known"], channel["last_fetched_known"]) == (None, None)

    # And the migrated file archives with its videos and brings them back.
    store.archive_channel_locally(conn, "UC_a", "@aitools", "rejected")
    assert _count(conn, "archived_videos") == 1
    store.restore_channel_locally(conn, "UC_a")
    row = conn.execute("SELECT title, last_fetch_status FROM videos").fetchone()
    assert (row["title"], row["last_fetch_status"]) == ("Cursor vs Claude Code", "archived")
    # An old tombstone with no videos comes back as before.
    assert store.restore_channel_locally(conn, "UC_old") == "@promptweekly"
    conn.close()


def test_a_version_7_file_that_already_has_some_v8_columns_opens(tmp_path: Path) -> None:
    """A crash part way through version 8 leaves some of its columns, and maybe the table."""
    path = tmp_path / "pipeline.db"
    conn = _v7_tables(path)
    conn.executescript(store.ARCHIVED_VIDEOS)
    conn.execute("ALTER TABLE channel_archive ADD COLUMN description TEXT")
    conn.execute("ALTER TABLE channels ADD COLUMN videos_fetched_known TEXT")
    conn.commit()
    conn.close()

    conn = store.get_connection(path)
    store.init_db(conn)

    assert _version(conn) == store.SCHEMA_VERSION
    columns = {r[1] for r in conn.execute("PRAGMA table_info(channel_archive)").fetchall()}
    assert {name for name, _ in store.ARCHIVE_FACTS} <= columns
    columns = {r[1] for r in conn.execute("PRAGMA table_info(channels)").fetchall()}
    assert {"videos_fetched_known", "last_fetched_known"} <= columns
    conn.close()


def test_a_migrated_version_7_file_has_every_column_a_new_file_has(tmp_path: Path) -> None:
    old = _v7_tables(tmp_path / "old.db")
    old.commit()
    store.init_db(old)
    new = store.get_connection(tmp_path / "new.db")
    store.init_db(new)
    for table in _tables(new):
        assert set(_column_names(old, table)) == set(_column_names(new, table)), table
    old.close()
    new.close()


def _column_names(conn: sqlite3.Connection, table: str) -> list[str]:
    return [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]


def test_a_version_8_file_gains_run_routes_and_keeps_its_runs(tmp_path: Path) -> None:
    path = tmp_path / "pipeline.db"
    conn = store.get_connection(path)
    store.init_db(conn)
    run_id = store.start_run(conn, 1)
    conn.execute("DROP TABLE run_routes")
    conn.execute("PRAGMA user_version=8")
    conn.commit()
    conn.close()

    conn = store.get_connection(path)
    store.init_db(conn)
    assert _version(conn) == store.SCHEMA_VERSION
    assert _count(conn, "runs") == 1
    assert _count(conn, "run_routes") == 0
    assert [c[1] for c in conn.execute("PRAGMA table_info(run_routes)")] == [
        "run_id", "kind", "label", "requests", "successes", "blocks", "connection_failures",
        "bytes", "keywords_finished", "channels_found", "in_range_found", "seconds_used",
        "seconds_resting",
    ]  # fmt: skip
    assert run_id == 1
    conn.close()


def test_a_version_9_file_gains_keyword_yield_and_init_twice_is_safe(tmp_path: Path) -> None:
    path = tmp_path / "pipeline.db"
    conn = store.get_connection(path)
    store.init_db(conn)
    store.seed_keywords(conn, ["claude code tutorial"])
    store.mark_keyword_done(conn, "claude code tutorial", 5)
    conn.executescript("ALTER TABLE keywords DROP COLUMN new_found;")
    conn.executescript("ALTER TABLE keywords DROP COLUMN in_range_found;")
    conn.execute("PRAGMA user_version=9")
    conn.commit()
    conn.close()

    for _ in range(2):
        conn = store.get_connection(path)
        store.init_db(conn)
        assert _version(conn) == store.SCHEMA_VERSION
        row = store.get_keyword(conn, "claude code tutorial")
        assert row is not None
        assert (row["status"], row["new_found"], row["in_range_found"]) == ("done", None, None)
        conn.close()


def test_done_stores_the_yield_and_incomplete_leaves_it(conn: sqlite3.Connection) -> None:
    store.seed_keywords(conn, ["ai video editor"])
    store.mark_keyword_done(conn, "ai video editor", 9, new_found=6, in_range_found=2)
    store.mark_keyword_incomplete(conn, "ai video editor", 9)
    row = store.get_keyword(conn, "ai video editor")
    assert row is not None
    assert (row["new_found"], row["in_range_found"]) == (6, 2)
