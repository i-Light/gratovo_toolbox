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


def test_a_new_file_is_created_at_version_3(conn: sqlite3.Connection) -> None:
    assert store.SCHEMA_VERSION == 3
    assert _version(conn) == 3
    assert "video_transcripts" in _tables(conn)


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


def test_a_file_newer_than_version_3_is_refused(tmp_path: Path) -> None:
    path = tmp_path / "pipeline.db"
    conn = store.get_connection(path)
    conn.execute("PRAGMA user_version=4")
    with pytest.raises(store.SchemaTooNewError):
        store.init_db(conn)
    assert _version(conn) == 4, "the newer file is left as it was"
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

    assert _version(conn) == 3
    row = conn.execute(
        "SELECT found_emails, found_email_sources FROM channels WHERE channel_id='UC_a'"
    ).fetchone()
    assert row["found_emails"] == '["hi@aitoolsweekly.example"]'
    assert row["found_email_sources"] is None
    conn.close()


def test_a_version_2_file_that_already_has_the_column_opens_and_ends_at_version_3(
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

    assert _version(conn) == 3
    row = conn.execute(
        "SELECT found_email_sources FROM channels WHERE channel_id='UC_a'"
    ).fetchone()
    assert row["found_email_sources"] == "[]"
    conn.close()
