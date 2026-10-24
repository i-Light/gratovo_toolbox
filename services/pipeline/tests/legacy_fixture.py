"""Builds old-app gratovo.db files for the import tests, from the legacy DDL
(legacy/pipeline/gratovo/store.py and legacy/lib/core/sync/mirror_schema.dart), trimmed of
comments. AI-niche rows only."""

import sqlite3
from pathlib import Path

CHANNELS_COLUMNS = """
    channel_id TEXT PRIMARY KEY, handle TEXT NOT NULL, name TEXT, description TEXT,
    subscribers TEXT, profile_picture TEXT, banner TEXT, link TEXT, country TEXT,
    first_seen_at TEXT NOT NULL, last_fetched_at TEXT, last_fetch_status TEXT,
    videos_fetched_at TEXT, force_refetch INTEGER NOT NULL DEFAULT 0,
    videos_last_30 INTEGER NOT NULL DEFAULT 0, median_views_last_30 INTEGER,
    latest_upload_at TEXT, blob_uploaded_at TEXT, blob_version TEXT, blob_applied_version TEXT,
    blob_announced_version TEXT, announced_at TEXT, sponsored_ratio REAL, seen_brands TEXT
"""

PIPELINE_DDL = """
CREATE TABLE keywords (
    keyword TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'pending', added_at TEXT NOT NULL,
    started_at TEXT, completed_at TEXT, channels_found INTEGER NOT NULL DEFAULT 0,
    claimed_by TEXT, search_settings TEXT, source TEXT NOT NULL DEFAULT 'local',
    dirty INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE channel_keywords (
    channel_id TEXT NOT NULL REFERENCES channels(channel_id), keyword TEXT NOT NULL,
    discovered_at TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'local',
    announced INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (channel_id, keyword)
);
CREATE TABLE videos (
    video_id TEXT PRIMARY KEY, channel_id TEXT NOT NULL REFERENCES channels(channel_id),
    title TEXT, description TEXT, thumbnail TEXT, tags TEXT, published_at TEXT, view_count TEXT,
    last_fetched_at TEXT, last_fetch_status TEXT
);
CREATE TABLE channel_archive (
    channel_id TEXT PRIMARY KEY, handle TEXT, label TEXT, archived_at TEXT, subscribers TEXT,
    found_at TEXT, found_via TEXT, source TEXT, announced INTEGER NOT NULL DEFAULT 0,
    median_views_last_30 INTEGER, median_basis TEXT, videos_found_count INTEGER
);
CREATE TABLE sync_state (collection TEXT PRIMARY KEY, last_pushed_at TEXT NOT NULL);
CREATE TABLE _applied_segments (key TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE archive_keyword_pending (
    channel_id TEXT NOT NULL, keyword TEXT NOT NULL, handles_limit INTEGER,
    discovered_at TEXT NOT NULL, PRIMARY KEY (channel_id, keyword)
);
CREATE TABLE news_sources (
    id TEXT PRIMARY KEY, feed_url TEXT NOT NULL UNIQUE, title TEXT, niche TEXT,
    enabled INTEGER NOT NULL DEFAULT 1, added_at TEXT NOT NULL
);
CREATE TABLE runs (
    run_id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL, finished_at TEXT,
    status TEXT NOT NULL DEFAULT 'running', keywords_total INTEGER NOT NULL DEFAULT 0,
    keywords_done INTEGER NOT NULL DEFAULT 0, channels_upserted INTEGER NOT NULL DEFAULT 0,
    videos_upserted INTEGER NOT NULL DEFAULT 0, pid INTEGER,
    kind TEXT NOT NULL DEFAULT 'search'
);
CREATE TABLE video_transcripts (
    video_id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, fetched_at TEXT NOT NULL,
    is_asr INTEGER, transcript TEXT, timed_transcript TEXT, error TEXT, moments TEXT,
    moments_at TEXT
);
"""

APP_DDL = """
CREATE TABLE channel_state (
    channel_id TEXT PRIMARY KEY, handle TEXT, vetting_status TEXT, notes TEXT, updated_at TEXT
);
CREATE TABLE brands (
    id TEXT PRIMARY KEY, name TEXT, contact_name TEXT, contact_email TEXT, website TEXT,
    budget REAL, notes TEXT, created_at TEXT, updated_at TEXT
);
CREATE TABLE activity_log (
    id TEXT PRIMARY KEY, at TEXT, actor_id TEXT, actor_name TEXT, action TEXT, entity_type TEXT,
    entity_id TEXT, detail TEXT, synced INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE _sync_meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE _outbox (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, payload TEXT NOT NULL,
    created_at TEXT NOT NULL
);
"""

SEEN = "2026-09-01T10:00:00Z"


def build(
    path: Path,
    *,
    found_emails: bool = True,
    app_tables: bool = True,
    pipeline_tables: bool = True,
) -> Path:
    """An old database at path with two AI channels, links, videos, one archive row, one run,
    one transcript, and (optionally) app mirror rows with unsent work."""
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    try:
        columns = CHANNELS_COLUMNS + (", found_emails TEXT" if found_emails else "")
        conn.execute(f"CREATE TABLE channels ({columns})")
        if pipeline_tables:
            conn.executescript(PIPELINE_DDL)
        if app_tables:
            conn.executescript(APP_DDL)
        conn.executemany(
            "INSERT INTO channels (channel_id, handle, name, subscribers, first_seen_at)"
            " VALUES (?, ?, ?, ?, ?)",
            [
                ("UCai0001", "@aitoolsweekly", "AI Tools Weekly", "120000", SEEN),
                ("UCai0002", "@claudecodedaily", "Claude Code Daily", "54000", SEEN),
            ],
        )
        if found_emails:
            conn.execute(
                "UPDATE channels SET found_emails = '[\"hi@aitoolsweekly.example\"]'"
                " WHERE channel_id = 'UCai0001'"
            )
        if pipeline_tables:
            conn.executemany(
                "INSERT INTO keywords (keyword, added_at) VALUES (?, ?)",
                [("best ai video editor 2026", SEEN), ("claude code tutorial", SEEN)],
            )
            conn.executemany(
                "INSERT INTO channel_keywords (channel_id, keyword, discovered_at) VALUES (?,?,?)",
                [
                    ("UCai0001", "best ai video editor 2026", SEEN),
                    ("UCai0002", "claude code tutorial", SEEN),
                ],
            )
            conn.executemany(
                "INSERT INTO videos (video_id, channel_id, title, view_count) VALUES (?,?,?,?)",
                [
                    ("vid00000001", "UCai0001", "I tested 7 AI video editors", "88000"),
                    ("vid00000002", "UCai0001", "AI news this week", "41000"),
                    ("vid00000003", "UCai0002", "Claude Code in a real repo", "30500"),
                ],
            )
            conn.execute(
                "INSERT INTO channel_archive (channel_id, handle, label, archived_at)"
                " VALUES ('UCai0009', '@oldaichannel', 'inactive', ?)",
                (SEEN,),
            )
            conn.execute("INSERT INTO runs (started_at, status) VALUES (?, 'done')", (SEEN,))
            conn.execute(
                "INSERT INTO video_transcripts (video_id, channel_id, fetched_at, transcript)"
                " VALUES ('vid00000001', 'UCai0001', ?, 'Today we compare AI video editors.')",
                (SEEN,),
            )
            conn.execute(
                "INSERT INTO news_sources (id, feed_url, added_at) VALUES"
                " ('n1', 'https://news.example/ai.xml', ?)",
                (SEEN,),
            )
        if app_tables:
            conn.execute(
                "INSERT INTO channel_state (channel_id, handle, vetting_status) VALUES"
                " ('UCai0001', '@aitoolsweekly', 'good')"
            )
            conn.execute("INSERT INTO brands (id, name) VALUES ('b1', 'PromptForge')")
            conn.executemany(
                "INSERT INTO activity_log (id, at, action, synced) VALUES (?, ?, 'edit', ?)",
                [("a1", SEEN, 0), ("a2", SEEN, 0), ("a3", SEEN, 1)],
            )
            conn.execute(
                "INSERT INTO _outbox (kind, payload, created_at) VALUES ('note', '{}', ?)",
                (SEEN,),
            )
        conn.commit()
    finally:
        conn.close()
    return path
