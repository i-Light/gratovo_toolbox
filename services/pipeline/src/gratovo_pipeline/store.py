"""The pipeline's local store: `pipeline.db`, SQLite (ported from legacy `gratovo/store.py`).

Every table is keyed by YouTube's own ids (channel_id, video_id, the keyword text), never a local
counter, so two machines' rows never collide when they are shared through R2 (`sync.py`, step T).
WAL mode lets the app read the file while a run writes it; the app only ever reads (ADR 0013).

Local first: a search works with no network, and sharing is a separate step that can fail without
losing anything. The old store shared one file with the Flutter app; this one is the pipeline's
alone, so its schema started clean at version 1 with every column the old migrations added.
Version 2 (3e-3, plan D7) adds `video_transcripts`, the subtitles and moments a first email reads.
Version 4 (5d-2, plan D42) gives a tombstone the rest of the channel's facts, so archiving never
makes us know less.
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
import time
from collections.abc import Callable, Generator, Iterable, Mapping
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Final, Literal, cast

from gratovo_pipeline.protocol import REFETCH_KEYWORD

type Discovered = dict[str, str]  # {handle: channel_id}
type Row = dict[str, Any]
type RunKind = Literal["search", "catch-up", "re-enrich"]

SCHEMA_VERSION: Final = 4

SCHEMA: Final = """
CREATE TABLE IF NOT EXISTS keywords (
    keyword TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'pending',  -- pending | in_progress | done
    added_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    channels_found INTEGER NOT NULL DEFAULT 0,
    claimed_by TEXT,        -- the worker (user id) who last worked this keyword
    search_settings TEXT,   -- JSON: the rules this keyword was last run with
    source TEXT NOT NULL DEFAULT 'local',  -- 'local' or 'remote' (from another machine's catalog)
    dirty INTEGER NOT NULL DEFAULT 1       -- 1 = changed here since last announced
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
    country TEXT,             -- ISO 3166 alpha-2 when the owner set one, else NULL
    first_seen_at TEXT NOT NULL,
    last_fetched_at TEXT,
    last_fetch_status TEXT,   -- success | failed
    videos_fetched_at TEXT,
    force_refetch INTEGER NOT NULL DEFAULT 0,
    -- 30-day rollups, recomputed from `videos` (compute_channel_rollups). Derived: never shared.
    videos_last_30 INTEGER NOT NULL DEFAULT 0,
    median_views_last_30 INTEGER,
    latest_upload_at TEXT,
    -- Version 4: how many videos we had when it came back from a tombstone (its rows were
    -- deleted when it was archived). NULL otherwise. See measure_archive_numbers.
    videos_known INTEGER,
    -- Version 4: a failed read of its uploads steps the channel out of the backlog until then.
    unreadable_until TEXT,
    -- R2 bookkeeping; each stamp equals a `videos_fetched_at`:
    --   blob_uploaded_at        the version THIS machine last uploaded
    --   blob_version            the newest version the catalog says exists
    --   blob_applied_version    the version this machine last downloaded and applied
    --   blob_announced_version  the uploaded version the catalog already names
    --   announced_at            when this machine wrote a `found` op for it
    blob_uploaded_at TEXT,
    blob_version TEXT,
    blob_applied_version TEXT,
    blob_announced_version TEXT,
    announced_at TEXT,
    awaiting_peer_since TEXT,  -- a teammate read it; wait for their object (AWAITING_PEER_DAYS)
    -- Derived from the stored descriptions (search/signals.py). Never shared.
    sponsored_ratio REAL,      -- share of stored videos with a sponsorship signal
    seen_brands TEXT,          -- JSON list
    found_emails TEXT          -- JSON list, from the About text and descriptions
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
    source TEXT NOT NULL DEFAULT 'local',  -- 'local' (found here) or 'remote'
    -- 0 until written into a catalog segment. A flag, not a cursor: cursors are whole seconds,
    -- and a row written in the same second as the last segment would be missed or repeated.
    announced INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (channel_id, keyword)
);
CREATE INDEX IF NOT EXISTS idx_channel_keywords_keyword ON channel_keywords(keyword);

CREATE TABLE IF NOT EXISTS videos (
    video_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL REFERENCES channels(channel_id),
    title TEXT,
    description TEXT,
    thumbnail TEXT,
    tags TEXT,           -- JSON list
    published_at TEXT,
    view_count TEXT,
    last_fetched_at TEXT,
    last_fetch_status TEXT  -- success | failed
);
CREATE INDEX IF NOT EXISTS idx_videos_channel_published ON videos (channel_id, published_at DESC);

CREATE TABLE IF NOT EXISTS channel_archive (
    channel_id TEXT PRIMARY KEY,
    handle TEXT,
    label TEXT,
    archived_at TEXT,
    subscribers TEXT,
    found_at TEXT,      -- the channel's first_seen_at, copied at archive time
    found_via TEXT,     -- JSON: [{"keyword", "limit", "discovered_at"}, ...]
    source TEXT,        -- 'local' (decided here) or 'remote'; only local rows are announced
    announced INTEGER NOT NULL DEFAULT 0,
    -- Frozen at archive time: the sweep deletes the videos they came from, so they can't be
    -- recomputed. See measure_archive_numbers and merge_archive_numbers.
    median_views_last_30 INTEGER,
    median_basis TEXT,            -- 'window30' or 'lifetime'; NULL when there is no median
    videos_found_count INTEGER,   -- NULL, not 0, when no machine could count them
    -- Version 4: the rest of the channel row, copied for the same reason. NULL = never known.
    name TEXT,
    country TEXT,
    videos_last_30 INTEGER,       -- NULL when its uploads were never read, not 0
    latest_upload_at TEXT,
    seen_brands TEXT,             -- JSON list
    found_emails TEXT,            -- JSON list
    found_email_sources TEXT      -- JSON list
);
CREATE INDEX IF NOT EXISTS idx_channel_archive_archived_at
    ON channel_archive (archived_at DESC, channel_id);

CREATE TABLE IF NOT EXISTS sync_state (
    collection TEXT PRIMARY KEY,
    last_pushed_at TEXT NOT NULL
);

-- Every catalog segment this machine has applied, by key, recorded once the whole segment is in.
CREATE TABLE IF NOT EXISTS _applied_segments (
    key TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
);

-- An archived channel a search re-found but did not re-add: the keyword is on the tombstone's
-- `found_via` at once, and this queue holds what the next share still owes the team.
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
    status TEXT NOT NULL DEFAULT 'running',  -- running | done | stopped (paused) | interrupted
    keywords_total INTEGER NOT NULL DEFAULT 0,
    keywords_done INTEGER NOT NULL DEFAULT 0,
    channels_upserted INTEGER NOT NULL DEFAULT 0,
    videos_upserted INTEGER NOT NULL DEFAULT 0,
    pid INTEGER,  -- so reconcile_stale_runs can tell a live run from a killed one
    kind TEXT NOT NULL DEFAULT 'search'      -- search | catch-up | re-enrich
);
"""

# Version 2. One video's subtitles, fetched only when a first email to its creator is drafted
# (decision `subtitles`), and the usable moments the gratovo-moments skill read from them -- kept so
# a redo or a later draft reuses both. Local to this machine, like the videos themselves.
VIDEO_TRANSCRIPTS: Final = """
CREATE TABLE IF NOT EXISTS video_transcripts (
    video_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    is_asr INTEGER,
    transcript TEXT,
    timed_transcript TEXT,
    error TEXT,
    moments TEXT,       -- JSON list; NULL until read
    moments_at TEXT
);
"""


def _add_found_email_sources(conn: sqlite3.Connection) -> None:
    """Version 3. Where each found address came from (found_emails.Source, as a JSON list), next to
    the plain list in `found_emails`. NULL on a row not yet derived, or imported from an older file.

    SQLite has no ADD COLUMN IF NOT EXISTS, and the column can already be there in a version-2
    file: a crash between the ALTER and the version, or two openers at once. Adding it again would
    fail every later open, so it is added only when missing."""
    columns = {row[1] for row in conn.execute("PRAGMA table_info(channels)").fetchall()}
    if "found_email_sources" not in columns:
        conn.execute("ALTER TABLE channels ADD COLUMN found_email_sources TEXT")


# Version 4: the channel facts a tombstone keeps beside its numbers (plan D42), all nullable.
ARCHIVE_FACTS: Final = (
    ("name", "TEXT"),
    ("country", "TEXT"),
    ("videos_last_30", "INTEGER"),
    ("latest_upload_at", "TEXT"),
    ("seen_brands", "TEXT"),
    ("found_emails", "TEXT"),
    ("found_email_sources", "TEXT"),
)


def _add_archive_facts(conn: sqlite3.Connection) -> None:
    """Version 4. Each missing fact column on `channel_archive`, and `channels.videos_known`; an
    old row reads NULL ("never known") in each. Only missing ones are added, as version 3 does,
    so a crash between the columns and the version can't make the next open fail."""
    columns = {row[1] for row in conn.execute("PRAGMA table_info(channel_archive)").fetchall()}
    for name, kind in ARCHIVE_FACTS:
        if name not in columns:
            conn.execute(f"ALTER TABLE channel_archive ADD COLUMN {name} {kind}")
    columns = {row[1] for row in conn.execute("PRAGMA table_info(channels)").fetchall()}
    if "videos_known" not in columns:
        conn.execute("ALTER TABLE channels ADD COLUMN videos_known INTEGER")
    if "unreadable_until" not in columns:
        conn.execute("ALTER TABLE channels ADD COLUMN unreadable_until TEXT")


# What each version adds to the one before it, run in order on a file older than it. Version 1 is
# SCHEMA itself; a new file runs SCHEMA and then every step. Each step is safe to run twice.
MIGRATIONS: Final[dict[int, Callable[[sqlite3.Connection], object]]] = {
    2: lambda conn: conn.executescript(VIDEO_TRANSCRIPTS),
    3: _add_found_email_sources,
    4: _add_archive_facts,
}

# A second writer waits this long instead of failing at once with "database is locked". Far
# longer than any statement here takes; short enough to surface a real deadlock.
BUSY_TIMEOUT_MS: Final = 15000

EPOCH: Final = "0000-00-00T00:00:00Z"  # ISO strings sort as text, so this is before everything
# `sync_state` rows, named so no real collection can collide with them.
PULL_CURSOR: Final = "__pull_all"  # when the catalog pull last finished
BOOTSTRAP_CURSOR: Final = "__r2_bootstrapped"  # set once this store's first share has run

# How long a channel a teammate read stays out of the backlog while its object hasn't arrived.
AWAITING_PEER_DAYS: Final = 30
# How long a channel whose uploads failed to read steps aside before the backlog tries again.
READ_RETRY_DAYS: Final = 1
ROLLUP_WINDOW_DAYS: Final = 30
BLOB_SCHEMA: Final = 1


def utc_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _placeholders(values: list[Any]) -> str:
    return ",".join("?" * len(values))


def _int_or_none(value: object) -> int | None:
    if value is None:
        return None
    text = str(value).replace(",", "").strip()
    if not text:
        return None
    try:
        return int(float(text))
    except ValueError:
        return None


def _json_list(text: object) -> list[Any]:
    """A stored JSON list, or [] for anything else (NULL, damaged, not a list)."""
    if not isinstance(text, str) or not text:
        return []
    try:
        value: object = json.loads(text)
    except ValueError:
        return []
    return list(value) if isinstance(value, list) else []  # pyright: ignore[reportUnknownArgumentType]


# --- the connection ---


def get_connection(db_path: Path | str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path, check_same_thread=True)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute(f"PRAGMA busy_timeout={BUSY_TIMEOUT_MS}")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.row_factory = sqlite3.Row
    return conn


class SchemaTooNewError(RuntimeError):
    """The file was written by a newer pipeline than this one."""


def init_db(conn: sqlite3.Connection) -> None:
    version: int = conn.execute("PRAGMA user_version").fetchone()[0]
    if version > SCHEMA_VERSION:
        raise SchemaTooNewError(
            f"pipeline.db is version {version}; this pipeline knows {SCHEMA_VERSION}"
        )
    conn.executescript(SCHEMA)
    for step in range(max(version, 1) + 1, SCHEMA_VERSION + 1):
        MIGRATIONS[step](conn)
    conn.execute(f"PRAGMA user_version={SCHEMA_VERSION}")
    conn.commit()


# --- keywords ---


def seed_keywords(conn: sqlite3.Connection, keywords: Iterable[str]) -> None:
    """Idempotent: an overlapping list never resets a keyword's status."""
    now = utc_now()
    conn.executemany(
        "INSERT OR IGNORE INTO keywords (keyword, status, added_at, dirty) "
        "VALUES (?, 'pending', ?, 1)",
        [(kw, now) for kw in keywords],
    )
    conn.commit()


def mark_keyword_started(
    conn: sqlite3.Connection, keyword: str, worker_id: str, search_settings: Mapping[str, object]
) -> None:
    """Records who last worked the keyword and with which rules. Not a claim: nobody holds a
    keyword hostage, everyone runs the list they typed."""
    conn.execute(
        """UPDATE keywords SET status='in_progress', started_at=?, claimed_by=?,
                               search_settings=?, source='local', dirty=1
           WHERE keyword=?""",
        (utc_now(), worker_id, json.dumps(search_settings), keyword),
    )
    conn.commit()


def mark_keyword_done(conn: sqlite3.Connection, keyword: str, channels_found: int) -> None:
    conn.execute(
        "UPDATE keywords SET status='done', completed_at=?, channels_found=?, "
        "  source='local', dirty=1 WHERE keyword=?",
        (utc_now(), channels_found, keyword),
    )
    conn.commit()


def get_keyword(conn: sqlite3.Connection, keyword: str) -> Row | None:
    row = conn.execute("SELECT * FROM keywords WHERE keyword=?", (keyword,)).fetchone()
    return dict(row) if row else None


# --- channels ---


def is_archived(conn: sqlite3.Connection, channel_id: str) -> bool:
    """Whether the team rejected and archived this channel (a tombstone in channel_archive)."""
    row = conn.execute("SELECT 1 FROM channel_archive WHERE channel_id=?", (channel_id,)).fetchone()
    return row is not None


def unarchive(conn: sqlite3.Connection, channel_id: str) -> None:
    """Drops the local tombstone so the channel can be found again (a manual refetch)."""
    conn.execute("DELETE FROM channel_archive WHERE channel_id=?", (channel_id,))
    conn.commit()


def record_channel_discovery(
    conn: sqlite3.Connection, handle: str, channel_id: str, keyword: str
) -> bool:
    """Records a discovered channel and the keyword that found it. Returns False, recording
    nothing, when the channel is archived: without that, the next search would add a rejected
    channel back as new, spend quota on it, and put it in front of someone to vet again."""
    if is_archived(conn, channel_id):
        return False
    now = utc_now()
    conn.execute(
        "INSERT OR IGNORE INTO channels (channel_id, handle, first_seen_at) VALUES (?, ?, ?)",
        (channel_id, handle, now),
    )
    conn.execute(
        "INSERT OR IGNORE INTO channel_keywords (channel_id, keyword, discovered_at) "
        "VALUES (?, ?, ?)",
        (channel_id, keyword, now),
    )
    conn.commit()
    return True


def partition_discovered(
    conn: sqlite3.Connection, discovered: Discovered
) -> tuple[Discovered, Discovered, Discovered]:
    """Splits a keyword's discovered {handle: channel_id} into `(fresh, known, archived)`.

    Discovery is the last point a channel can be dropped for free: everything after it spends
    quota or a scrape. So "we have it" and "we rejected it" are answered here. `force_refetch`
    (a person asked for current data) puts a known channel back in `fresh`. A channel in both
    tables counts as archived: the archive is the newer decision.
    """
    if not discovered:
        return {}, {}, {}
    ids = list(discovered.values())
    marks = _placeholders(ids)
    archived_ids = {
        r["channel_id"]
        for r in conn.execute(
            f"SELECT channel_id FROM channel_archive WHERE channel_id IN ({marks})",
            ids,
        )
    }
    known_ids = {
        r["channel_id"]
        for r in conn.execute(
            f"SELECT channel_id FROM channels WHERE channel_id IN ({marks}) AND force_refetch=0",
            ids,
        )
    } - archived_ids
    fresh: Discovered = {}
    known: Discovered = {}
    archived: Discovered = {}
    for handle, channel_id in discovered.items():
        if channel_id in archived_ids:
            archived[handle] = channel_id
        elif channel_id in known_ids:
            known[handle] = channel_id
        else:
            fresh[handle] = channel_id
    return fresh, known, archived


def record_keyword_links(conn: sqlite3.Connection, discovered: Discovered, keyword: str) -> None:
    """Links already-known channels to the keyword that re-found them. Free (one local insert
    each), and it keeps a keyword's results and a channel's "found by" honest."""
    if not discovered:
        return
    now = utc_now()
    conn.executemany(
        "INSERT OR IGNORE INTO channel_keywords (channel_id, keyword, discovered_at) "
        "VALUES (?, ?, ?)",
        [(channel_id, keyword, now) for channel_id in discovered.values()],
    )
    conn.commit()


def _add_found_via(entries: list[Any], keyword: str, handles_limit: int | None, at: str) -> bool:
    if any(
        isinstance(e, dict) and cast("dict[str, object]", e).get("keyword") == keyword
        for e in entries
    ):
        return False
    entries.append({"keyword": keyword, "limit": handles_limit, "discovered_at": at})
    return True


def record_archive_keyword_links(
    conn: sqlite3.Connection, discovered: Discovered, keyword: str, handles_limit: int | None = None
) -> int:
    """Attaches the keyword to archived channels it re-found: on the tombstone's `found_via` at
    once (archived_at untouched), and queued in archive_keyword_pending for the team. A keyword
    already on a tombstone is skipped. Returns how many notes were added."""
    if not discovered:
        return 0
    now = utc_now()
    added = 0
    for channel_id in discovered.values():
        row = conn.execute(
            "SELECT found_via FROM channel_archive WHERE channel_id=?", (channel_id,)
        ).fetchone()
        if row is None:
            continue  # un-archived meanwhile: nothing to attach to
        entries = _json_list(row["found_via"])
        if not _add_found_via(entries, keyword, handles_limit, now):
            continue
        conn.execute(
            "UPDATE channel_archive SET found_via=? WHERE channel_id=?",
            (json.dumps(entries), channel_id),
        )
        conn.execute(
            "INSERT OR IGNORE INTO archive_keyword_pending "
            "(channel_id, keyword, handles_limit, discovered_at) VALUES (?, ?, ?, ?)",
            (channel_id, keyword, handles_limit, now),
        )
        added += 1
    conn.commit()
    return added


def get_archive_keyword_pending(conn: sqlite3.Connection) -> list[Row]:
    return [dict(r) for r in conn.execute("SELECT * FROM archive_keyword_pending")]


def clear_archive_keyword_pending(conn: sqlite3.Connection, channel_id: str, keyword: str) -> None:
    conn.execute(
        "DELETE FROM archive_keyword_pending WHERE channel_id=? AND keyword=?",
        (channel_id, keyword),
    )
    conn.commit()


def get_channels_to_fetch(conn: sqlite3.Connection, discovered: Discovered) -> Discovered:
    """The subset never fetched before, or flagged for a manual refetch."""
    if not discovered:
        return {}
    ids = list(discovered.values())
    rows = conn.execute(
        f"SELECT channel_id FROM channels WHERE channel_id IN ({_placeholders(ids)}) "
        "AND last_fetched_at IS NOT NULL AND force_refetch=0",
        ids,
    )
    already_fresh = {r["channel_id"] for r in rows}
    return {h: cid for h, cid in discovered.items() if cid not in already_fresh}


def save_channels(
    conn: sqlite3.Connection,
    channel_info_by_handle: Mapping[str, Mapping[str, Any]],
    channel_batch: Discovered,
) -> None:
    """Writes what the API returned for each requested channel; one it didn't return is marked
    failed rather than silently dropped."""
    now = utc_now()
    for handle, channel_id in channel_batch.items():
        info = channel_info_by_handle.get(handle)
        if info:
            conn.execute(
                """UPDATE channels SET
                       handle=?, name=?, description=?, subscribers=?, profile_picture=?,
                       banner=?, link=?, country=?, last_fetched_at=?, last_fetch_status='success',
                       force_refetch=0
                   WHERE channel_id=?""",
                (
                    handle,
                    info.get("Name"),
                    info.get("Description"),
                    info.get("Subscribers"),
                    info.get("Profile_Picture"),
                    info.get("Banner"),
                    info.get("Link"),
                    info.get("Country"),
                    now,
                    channel_id,
                ),
            )
        else:
            conn.execute(
                "UPDATE channels SET last_fetched_at=?, last_fetch_status='failed', "
                "  force_refetch=0 "
                "WHERE channel_id=?",
                (now, channel_id),
            )
    conn.commit()


def get_channel_row(conn: sqlite3.Connection, channel_id: str) -> Row | None:
    row = conn.execute("SELECT * FROM channels WHERE channel_id=?", (channel_id,)).fetchone()
    return dict(row) if row else None


def get_channels_needing_videos(conn: sqlite3.Connection, discovered: Discovered) -> Discovered:
    """The subset whose videos were never fetched, or are flagged for a refetch."""
    if not discovered:
        return {}
    ids = list(discovered.values())
    rows = conn.execute(
        f"SELECT channel_id FROM channels WHERE channel_id IN ({_placeholders(ids)}) "
        "AND videos_fetched_at IS NOT NULL AND force_refetch=0",
        ids,
    )
    have_videos = {r["channel_id"] for r in rows}
    return {h: cid for h, cid in discovered.items() if cid not in have_videos}


def force_refetch_by_handle(conn: sqlite3.Connection, handle: str) -> str | None:
    """Flags a known channel for a full refresh. Returns its id, or None if never discovered."""
    conn.execute(
        "UPDATE channels SET force_refetch=1, videos_fetched_at=NULL WHERE handle=?", (handle,)
    )
    conn.commit()
    row = conn.execute("SELECT channel_id FROM channels WHERE handle=?", (handle,)).fetchone()
    return row["channel_id"] if row else None


def all_channel_ids(conn: sqlite3.Connection) -> list[str]:
    return [
        r["channel_id"]
        for r in conn.execute("SELECT channel_id FROM channels ORDER BY first_seen_at, channel_id")
    ]


# --- the video backlog ---


def _iso(now: float | None = None) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now if now is not None else time.time()))


def _awaiting_peer_cutoff(now: float | None = None) -> str:
    stamp = now if now is not None else time.time()
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(stamp - AWAITING_PEER_DAYS * 86400))


def _video_backlog_where(country: str | None, now: float | None = None) -> tuple[str, list[Any]]:
    """The predicate the backlog query and its count share, so the number a run reports and the
    slice it works never answer different questions. A channel waiting for a teammate's object,
    or backed off after a failed read (`defer_unreadable_channel`), is left out until its wait
    passes."""
    where = (
        "(((videos_fetched_at IS NULL "
        "   AND (awaiting_peer_since IS NULL OR awaiting_peer_since < ?)) "
        "  OR force_refetch = 1) "
        " AND (unreadable_until IS NULL OR unreadable_until < ?))"
    )
    params: list[Any] = [_awaiting_peer_cutoff(now), _iso(now)]
    if country:
        where += " AND country = ?"
        params.append(country)
    return where, params


def count_channels_awaiting_peers(conn: sqlite3.Connection, now: float | None = None) -> int:
    row = conn.execute(
        "SELECT COUNT(*) AS n FROM channels WHERE videos_fetched_at IS NULL "
        "  AND force_refetch = 0 AND awaiting_peer_since >= ?",
        (_awaiting_peer_cutoff(now),),
    ).fetchone()
    return int(row["n"])


def defer_unreadable_channel(conn: sqlite3.Connection, channel_id: str) -> None:
    """A channel whose uploads could not be read stays unstamped and in the backlog, but steps
    aside for READ_RETRY_DAYS (`unreadable_until`), so a channel that always fails can't fill
    every slice and starve the ones behind it. A successful read clears it."""
    until = _iso(time.time() + READ_RETRY_DAYS * 86400)
    conn.execute("UPDATE channels SET unreadable_until=? WHERE channel_id=?", (until, channel_id))
    conn.commit()


def get_video_backfill_candidates(
    conn: sqlite3.Connection,
    limit: int,
    country: str | None = None,
    now: float | None = None,
) -> Discovered:
    """Channels anywhere in the store still missing their recent uploads, oldest first, so a
    channel whose turn never came (a crash, a block, a short run) gets one."""
    where, params = _video_backlog_where(country, now=now)
    params.append(limit)
    rows = conn.execute(
        f"SELECT channel_id, handle FROM channels WHERE {where} ORDER BY first_seen_at ASC LIMIT ?",
        params,
    )
    return {r["handle"]: r["channel_id"] for r in rows}


def count_channels_needing_videos(
    conn: sqlite3.Connection, country: str | None = None, now: float | None = None
) -> int:
    where, params = _video_backlog_where(country, now=now)
    row = conn.execute(f"SELECT COUNT(*) AS n FROM channels WHERE {where}", params).fetchone()
    return int(row["n"])


def mark_channels_videos_fetched(conn: sqlite3.Connection, channel_ids: Iterable[str]) -> None:
    """Stamps `videos_fetched_at`, clears `force_refetch` (or a manual refetch would repeat on
    every keyword and the catch-up would never finish) and recomputes the rollups."""
    ids = list(channel_ids)
    if not ids:
        return
    conn.execute(
        "UPDATE channels SET videos_fetched_at=?, force_refetch=0, awaiting_peer_since=NULL, "
        f"unreadable_until=NULL WHERE channel_id IN ({_placeholders(ids)})",
        [utc_now(), *ids],
    )
    compute_channel_rollups(conn, ids)
    conn.commit()


# --- videos ---


def save_videos(
    conn: sqlite3.Connection,
    video_info_by_id: Mapping[str, Mapping[str, Any]],
    video_batch: Iterable[str],
    video_id_to_channel_id: Mapping[str, str],
) -> None:
    """Writes what the API returned for each requested video; a missing one is marked failed."""
    now = utc_now()
    for vid in video_batch:
        info = video_info_by_id.get(vid)
        channel_id = video_id_to_channel_id.get(vid)
        if info:
            conn.execute(
                """INSERT INTO videos (video_id, channel_id, title, description, thumbnail, tags,
                                        published_at, view_count, last_fetched_at,
                                        last_fetch_status)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'success')
                   ON CONFLICT(video_id) DO UPDATE SET
                       title=excluded.title, description=excluded.description,
                       thumbnail=excluded.thumbnail, tags=excluded.tags,
                       published_at=excluded.published_at, view_count=excluded.view_count,
                       last_fetched_at=excluded.last_fetched_at, last_fetch_status='success'""",
                (
                    vid,
                    channel_id,
                    info.get("Title"),
                    info.get("Description"),
                    info.get("Thumbnail"),
                    json.dumps(info.get("Tags", [])),
                    info.get("PublishedAt"),
                    info.get("ViewCount"),
                    now,
                ),
            )
        else:
            conn.execute(
                """INSERT INTO videos (video_id, channel_id, last_fetched_at, last_fetch_status)
                   VALUES (?, ?, ?, 'failed')
                   ON CONFLICT(video_id) DO UPDATE SET
                       last_fetched_at=excluded.last_fetched_at, last_fetch_status='failed'""",
                (vid, channel_id, now),
            )
    conn.commit()


def get_channel_video_descriptions(
    conn: sqlite3.Connection, channel_ids: Iterable[str]
) -> dict[str, list[str | None]]:
    """{channel_id: [description, ...]} for every stored video, failed ones as None: a video
    without a description still counts in the sponsorship denominator."""
    ids = list(channel_ids)
    if not ids:
        return {}
    result: dict[str, list[str | None]] = {cid: [] for cid in ids}
    for row in conn.execute(
        f"SELECT channel_id, description FROM videos WHERE channel_id IN ({_placeholders(ids)})",
        ids,
    ):
        result.setdefault(row["channel_id"], []).append(row["description"])
    return result


def latest_video(conn: sqlite3.Connection, channel_id: str) -> Row | None:
    """The channel's newest stored video (video_id, title, published_at), or None."""
    row = conn.execute(
        "SELECT video_id, title, published_at FROM videos WHERE channel_id = ? "
        "AND video_id IS NOT NULL ORDER BY published_at DESC LIMIT 1",
        (channel_id,),
    ).fetchone()
    return dict(row) if row else None


def get_video_transcript(conn: sqlite3.Connection, video_id: str) -> Row | None:
    row = conn.execute("SELECT * FROM video_transcripts WHERE video_id = ?", (video_id,)).fetchone()
    return dict(row) if row else None


def save_video_transcript(
    conn: sqlite3.Connection, video_id: str, channel_id: str, fetched: Mapping[str, Any]
) -> None:
    """Keeps what `transcript.fetch` returned for [video_id] -- the subtitles, or why there were
    none. Commits."""
    asr = fetched.get("is_asr")
    conn.execute(
        "INSERT OR REPLACE INTO video_transcripts (video_id, channel_id, fetched_at, "
        "is_asr, transcript, timed_transcript, error) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            video_id,
            channel_id,
            utc_now(),
            None if asr is None else int(bool(asr)),
            fetched.get("transcript"),
            fetched.get("timed_transcript"),
            fetched.get("error"),
        ),
    )
    conn.commit()


def save_video_moments(
    conn: sqlite3.Connection, video_id: str, moments: Iterable[Mapping[str, Any]]
) -> None:
    """Keeps the moments read from [video_id]'s subtitles. Commits."""
    conn.execute(
        "UPDATE video_transcripts SET moments = ?, moments_at = ? WHERE video_id = ?",
        (json.dumps([dict(m) for m in moments], ensure_ascii=False), utc_now(), video_id),
    )
    conn.commit()


def get_channel_about_texts(
    conn: sqlite3.Connection, channel_ids: Iterable[str]
) -> dict[str, str | None]:
    ids = list(channel_ids)
    if not ids:
        return {}
    rows = conn.execute(
        f"SELECT channel_id, description FROM channels WHERE channel_id IN ({_placeholders(ids)})",
        ids,
    )
    return {r["channel_id"]: r["description"] for r in rows}


def update_channel_found_emails(
    conn: sqlite3.Connection,
    channel_id: str,
    emails: Iterable[str],
    sources: Iterable[Mapping[str, object]] | None = None,
) -> None:
    """Writes the plain list and where each address came from. Doesn't commit: callers hold a
    transaction they are about to commit."""
    conn.execute(
        "UPDATE channels SET found_emails=?, found_email_sources=? WHERE channel_id=?",
        (
            json.dumps(list(emails)),
            None if sources is None else json.dumps(list(sources)),
            channel_id,
        ),
    )


def update_channel_sponsorship(
    conn: sqlite3.Connection,
    channel_id: str,
    sponsored_ratio: float | None,
    seen_brands: Iterable[str],
) -> None:
    """Doesn't commit, like compute_channel_rollups."""
    conn.execute(
        "UPDATE channels SET sponsored_ratio=?, seen_brands=? WHERE channel_id=?",
        (sponsored_ratio, json.dumps(list(seen_brands)), channel_id),
    )


# --- rollups (derived on every machine, never shared) ---


def _median(values: list[int]) -> int | None:
    """The 50th percentile, or None; an even count takes the mean of the middle pair."""
    if not values:
        return None
    ordered = sorted(values)
    mid = len(ordered) // 2
    return ordered[mid] if len(ordered) % 2 else (ordered[mid - 1] + ordered[mid]) // 2


def compute_channel_rollups(
    conn: sqlite3.Connection, channel_ids: Iterable[str] | None = None
) -> int:
    """Recomputes `videos_last_30`, `median_views_last_30` and `latest_upload_at` from the local
    videos, for channel_ids or every channel.

    The window runs back from `COALESCE(videos_fetched_at, last_fetched_at)`, not from now: a
    channel nobody refetches keeps the numbers it had, rather than sliding to zero and reading as
    abandoned. The median skips videos with no count (not zero views); the count includes them.
    Doesn't commit. Returns how many rows changed.
    """
    if channel_ids is not None:
        ids = list(channel_ids)
        if not ids:
            return 0
        where, params = f"WHERE channel_id IN ({_placeholders(ids)})", ids
    else:
        where, params = "", []
    rows = conn.execute(
        "SELECT channel_id, COALESCE(videos_fetched_at, last_fetched_at) AS anchor "
        f"FROM channels {where}",
        params,
    ).fetchall()
    written = 0
    for row in rows:
        anchor = row["anchor"]
        count: int = 0
        median: int | None = None
        latest: str | None = None
        if anchor:
            videos = conn.execute(
                "SELECT view_count, published_at FROM videos "
                "WHERE channel_id=? AND published_at IS NOT NULL AND published_at <> '' "
                "  AND published_at > strftime('%Y-%m-%dT%H:%M:%SZ', datetime(?, ?))",
                (row["channel_id"], anchor, f"-{ROLLUP_WINDOW_DAYS} days"),
            ).fetchall()
            count = len(videos)
            median = _median(
                [v for v in (_int_or_none(x["view_count"]) for x in videos) if v is not None]
            )
            latest = max((x["published_at"] for x in videos), default=None)
        cur = conn.execute(
            "UPDATE channels SET videos_last_30=?, median_views_last_30=?, latest_upload_at=? "
            "WHERE channel_id=? AND (videos_last_30 IS NOT ? OR median_views_last_30 IS NOT ? "
            "                         OR latest_upload_at IS NOT ?)",
            (count, median, latest, row["channel_id"], count, median, latest),
        )
        written += cur.rowcount
    return written


# --- the archive's frozen numbers ---
# `median_views_last_30` and `videos_found_count` are the only facts the archive can't recover:
# the sweep that writes them deletes the videos they came from. `measure` works them out from
# the videos this machine holds right before they go, saying "unknown" (None) rather than zero
# when it never had them; `merge` writes them so a known number is never replaced by an unknown
# one, whoever writes and in whatever order.

type ArchiveNumbers = tuple[int | None, str | None, int | None]  # (median, basis, count)


def measure_archive_numbers(conn: sqlite3.Connection, channel_id: str) -> ArchiveNumbers:
    """`(median, basis, count)` from the videos held here. The median is the 30-day rollup, or
    the median over every stored video (`lifetime`) when the window is empty. All None when this
    machine can't see the videos; zero only when it ran or applied the video pass itself. The
    count is the larger of the rows held and `videos_known` (what a channel brought back from
    the archive had before its rows were deleted), so a restore never lowers it and a real read
    that finds more takes over."""
    row = conn.execute(
        "SELECT median_views_last_30, videos_fetched_at, blob_applied_version, blob_uploaded_at, "
        "       videos_known "
        "FROM channels WHERE channel_id=?",
        (channel_id,),
    ).fetchone()
    known: int | None = row["videos_known"] if row else None
    counts = [
        _int_or_none(r["view_count"])
        for r in conn.execute("SELECT view_count FROM videos WHERE channel_id=?", (channel_id,))
    ]
    stored = len(counts)
    if stored == 0:
        held = (
            bool(row)
            and bool(row["videos_fetched_at"])
            and bool(row["blob_applied_version"] or row["blob_uploaded_at"])
        )
        if known is not None:
            return (None, None, known)
        return (None, None, 0 if held else None)
    count = max(stored, known or 0)
    window: int | None = row["median_views_last_30"] if row else None
    if window is not None:
        return (window, "window30", count)
    lifetime = _median([c for c in counts if c is not None])
    return (lifetime, "lifetime" if lifetime is not None else None, count)


def merge_archive_numbers(
    conn: sqlite3.Connection,
    channel_id: str,
    median: int | None,
    basis: str | None,
    count: int | None,
    *,
    announce: bool = True,
) -> bool:
    """Folds one measurement into the tombstone without ever making it say less. The larger count
    wins and the median travels with its count. `announce` marks an improved row to go out again
    (only local rows are announced); pass False when only applying what arrived. Returns whether
    anything changed."""
    if median is None and count is None:
        return False
    row = conn.execute(
        "SELECT median_views_last_30, median_basis, videos_found_count "
        "FROM channel_archive WHERE channel_id=?",
        (channel_id,),
    ).fetchone()
    if row is None:
        return False
    old: ArchiveNumbers = (
        row["median_views_last_30"],
        row["median_basis"],
        row["videos_found_count"],
    )
    old_median, old_basis, old_count = old
    # -1 sorts "never counted" below "counted zero".
    if (count if count is not None else -1) >= (old_count if old_count is not None else -1):
        new_count = count if count is not None else old_count
        new_median, new_basis = (median, basis) if median is not None else (old_median, old_basis)
    else:
        new_count = old_count
        new_median, new_basis = (
            (old_median, old_basis) if old_median is not None else (median, basis)
        )
    if (new_median, new_basis, new_count) == old:
        return False
    conn.execute(
        "UPDATE channel_archive SET median_views_last_30=?, median_basis=?, videos_found_count=?"
        + (", source='local', announced=0" if announce else "")
        + " WHERE channel_id=?",
        (new_median, new_basis, new_count, channel_id),
    )
    return True


# --- the tombstone: one helper for every path that archives (plan D42 to D44) ---
# Archiving never makes us know less. The tombstone is built here from the channel row and every
# keyword link it has, never from what a caller happens to have in hand: the old app took
# `found_via` from its caller, so the 7-day sweep (which had none) wrote an empty list and the
# rules' sweep kept only the keyword it was running. And it was an INSERT OR REPLACE, so a second
# archiving blanked whatever the first had kept. Here a second archiving merges into the first.


@contextmanager
def _atomic(conn: sqlite3.Connection) -> Generator[None]:
    """All or nothing, whether the connection runs Python's implicit transactions or autocommit
    (the import's): a stop or a crash half way leaves the rows as they were."""
    conn.execute("SAVEPOINT tombstone")
    try:
        yield
    except BaseException:
        conn.execute("ROLLBACK TO tombstone")
        conn.execute("RELEASE tombstone")
        raise
    conn.execute("RELEASE tombstone")


def _merge_found_via(*sources: Iterable[object]) -> list[Any]:
    """The `found_via` lists as one, in order of first sight: one entry per keyword, with the
    earliest known `discovered_at` and a known `limit` kept over an unknown one. An entry it
    can't read is kept as it is, never dropped."""
    out: list[Any] = []
    by_keyword: dict[str, dict[str, object]] = {}
    for entries in sources:
        for entry in entries:
            if not isinstance(entry, dict):
                out.append(entry)
                continue
            item = cast("dict[str, object]", entry)
            keyword = item.get("keyword")
            if not isinstance(keyword, str):
                out.append(item)
                continue
            known = by_keyword.get(keyword)
            if known is None:
                fresh: dict[str, object] = {"limit": None, "discovered_at": None, **item}
                by_keyword[keyword] = fresh
                out.append(fresh)
                continue
            at, known_at = item.get("discovered_at"), known.get("discovered_at")
            if isinstance(at, str) and at and (not isinstance(known_at, str) or at < known_at):
                known["discovered_at"] = at
            if known.get("limit") is None and item.get("limit") is not None:
                known["limit"] = item["limit"]
    return out


def _channel_links(conn: sqlite3.Connection, channel_id: str) -> list[dict[str, object]]:
    """Every keyword that found the channel here, as `found_via` entries, oldest first."""
    return [
        {"keyword": r["keyword"], "limit": None, "discovered_at": r["discovered_at"]}
        for r in conn.execute(
            "SELECT keyword, discovered_at FROM channel_keywords WHERE channel_id=? "
            "ORDER BY discovered_at, keyword",
            (channel_id,),
        )
    ]


def _union_json(old: object, new: object) -> str | None:
    """Two stored JSON lists as one, old items first, each once; NULL only when neither is
    known. The old text is kept as it is when the new list adds nothing."""
    if new is None:
        return old if isinstance(old, str) or old is None else json.dumps(_json_list(old))
    if old is None:
        return new if isinstance(new, str) else json.dumps(_json_list(new))
    before = _json_list(old)
    merged: list[Any] = []
    seen: set[str] = set()
    for item in (*before, *_json_list(new)):
        key = json.dumps(item, sort_keys=True)
        if key not in seen:
            seen.add(key)
            merged.append(item)
    return old if isinstance(old, str) and merged == before else json.dumps(merged)


def _row_facts(conn: sqlite3.Connection, row: sqlite3.Row | None) -> dict[str, Any]:
    """The facts a tombstone keeps from the channel row; all None without a row. The 30-day
    count is 0 by default on a row whose uploads were never read, so a 0 is kept only when they
    were: a NULL on the tombstone means "never known", never "zero". (A row brought back from the
    archive holds its old count before it is read again, and keeps it.)"""
    if row is None:
        return {name: None for name, _ in ARCHIVE_FACTS}
    read = row["videos_fetched_at"] is not None or (
        conn.execute(
            "SELECT 1 FROM videos WHERE channel_id=? LIMIT 1", (row["channel_id"],)
        ).fetchone()
        is not None
    )
    facts: dict[str, Any] = {name: row[name] for name, _ in ARCHIVE_FACTS}
    if not read and not facts["videos_last_30"]:
        facts["videos_last_30"] = None
    return facts


def _merge_facts(old: Mapping[str, Any], new: Mapping[str, Any]) -> dict[str, Any]:
    """D43 for the facts: a known value is never replaced by NULL. When both are known the new
    one (read from the row being archived now) is the fresher, except the latest upload, which
    keeps the later time, and the lists, which keep everything either one held."""
    out: dict[str, Any] = {}
    for name, _ in ARCHIVE_FACTS:
        before, after = old.get(name), new.get(name)
        if name in ("seen_brands", "found_emails", "found_email_sources"):
            out[name] = _union_json(before, after)
        elif name == "latest_upload_at" and before is not None and after is not None:
            out[name] = max(str(before), str(after))
        else:
            out[name] = after if after is not None else before
    return out


def _write_tombstone(
    conn: sqlite3.Connection,
    channel_id: str,
    handle: str | None,
    label: str | None,
    subscribers: int | str | None,
    found_at: str | None,
    found_via: list[Mapping[str, Any]] | None,
    *,
    announce: bool,
) -> bool:
    """Builds the tombstone from the channel row and its links (plus the caller's `found_via`) and
    writes it, merging into one already there (D43): keywords a union with the earliest time,
    the numbers through merge_archive_numbers, a known fact kept over NULL, the first label and
    archiving time kept. Deletes nothing and doesn't commit. Returns whether it was new."""
    now = utc_now()
    row = conn.execute("SELECT * FROM channels WHERE channel_id=?", (channel_id,)).fetchone()
    old = conn.execute("SELECT * FROM channel_archive WHERE channel_id=?", (channel_id,)).fetchone()
    if subscribers is None and row is not None:
        subscribers = row["subscribers"]
    if found_at is None and row is not None:
        found_at = row["first_seen_at"]
    if not handle and row is not None:
        handle = row["handle"]
    links = _channel_links(conn, channel_id)
    facts = _row_facts(conn, row)
    median, basis, count = measure_archive_numbers(conn, channel_id)
    if median is None and row is not None and row["median_views_last_30"] is not None:
        # No videos held, yet a 30-day median on the row: a channel brought back from the archive
        # (D44) and not read since. Its count comes from `videos_known`; its median from here.
        median, basis = row["median_views_last_30"], "window30"
    subs = str(subscribers) if subscribers is not None else None
    fact_names = [name for name, _ in ARCHIVE_FACTS]
    if old is None:
        conn.execute(
            "INSERT INTO channel_archive "
            "(channel_id, handle, label, archived_at, subscribers, found_at, found_via, source, "
            " announced, median_views_last_30, median_basis, videos_found_count, "
            + ", ".join(fact_names)
            + ") VALUES (?, ?, ?, ?, ?, ?, ?, 'local', 0, ?, ?, ?, "
            + _placeholders(fact_names)
            + ")",
            (
                channel_id,
                handle,
                label,
                now,
                subs,
                found_at or now,
                json.dumps(_merge_found_via(links, found_via or [])),
                median,
                basis,
                count,
                *(facts[name] for name in fact_names),
            ),
        )
        return True
    known_at = [t for t in (old["found_at"], found_at) if t]
    entries = _merge_found_via(_json_list(old["found_via"]), links, found_via or [])
    merged: dict[str, Any] = {
        "handle": handle or old["handle"],
        "label": old["label"] if old["label"] is not None else label,
        "archived_at": old["archived_at"] or now,
        "subscribers": subs if subs is not None else old["subscribers"],
        "found_at": min(known_at) if known_at else None,
        **_merge_facts(dict(old), facts),
    }
    changed = {k: v for k, v in merged.items() if v != old[k]}
    # Compared as lists: the same entries written out again aren't a change.
    if entries != _json_list(old["found_via"]):
        changed["found_via"] = json.dumps(entries)
    if changed:
        conn.execute(
            "UPDATE channel_archive SET "
            + ", ".join(f"{k}=?" for k in changed)
            + (", source='local', announced=0" if announce else "")
            + " WHERE channel_id=?",
            (*changed.values(), channel_id),
        )
    merge_archive_numbers(conn, channel_id, median, basis, count, announce=announce)
    return False


def archive_channel_locally(
    conn: sqlite3.Connection,
    channel_id: str,
    handle: str,
    label: str,
    subscribers: int | str | None = None,
    found_at: str | None = None,
    found_via: list[Mapping[str, Any]] | None = None,
) -> bool:
    """Tombstones a channel this machine rejected (the auto-clean gate, the 7-day sweep, the
    refetch's rule): the tombstone first, carrying every fact and every keyword link itself
    since the rows they come from are about to go, then the channel, its links and its videos
    are deleted, in one transaction. A channel already archived is merged into, never blanked.
    Returns whether the tombstone is new. Commits."""
    with _atomic(conn):
        new = _write_tombstone(
            conn, channel_id, handle, label, subscribers, found_at, found_via, announce=True
        )
        _delete_channel(conn, channel_id)
    conn.commit()
    return new


def fill_archive_from_channels(conn: sqlite3.Connection) -> int:
    """Folds a channel row that sits beside its own tombstone (an imported old file can hold
    both) into the tombstone, without deleting the row or announcing anything: the import adds
    rows, it never removes them. Returns how many tombstones were looked at. Commits."""
    ids: list[str] = [
        r[0]
        for r in conn.execute(
            "SELECT a.channel_id FROM main.channel_archive a "
            "JOIN main.channels c ON c.channel_id = a.channel_id"
        ).fetchall()
    ]
    factory = conn.row_factory  # the import's connection reads plain tuples
    conn.row_factory = sqlite3.Row
    try:
        with _atomic(conn):
            for channel_id in ids:
                _write_tombstone(conn, channel_id, None, None, None, None, None, announce=False)
        conn.commit()
    finally:
        conn.row_factory = factory
    return len(ids)


def restore_channel_locally(conn: sqlite3.Connection, channel_id: str) -> str | None:
    """Bring back (D44): the channel row comes back from the tombstone with its last known facts,
    flagged so the next read refreshes it and the backlog picks it up; its keyword links come
    back with their original times (a manual refetch is not a keyword that found it); and the
    tombstone goes, in one transaction. A channel row already there only has its blanks filled
    and its missing links added. Returns the tombstone's handle ('' when it had none), or None
    when there is no tombstone. Commits."""
    tomb = conn.execute(
        "SELECT * FROM channel_archive WHERE channel_id=?", (channel_id,)
    ).fetchone()
    if tomb is None:
        return None
    handle = str(tomb["handle"] or "").strip()
    first_seen: str = tomb["found_at"] or utc_now()
    median = tomb["median_views_last_30"] if tomb["median_basis"] == "window30" else None
    with _atomic(conn):
        conn.execute(
            """INSERT INTO channels (channel_id, handle, name, subscribers, country,
                                      first_seen_at, videos_last_30, median_views_last_30,
                                      latest_upload_at, seen_brands, found_emails,
                                      found_email_sources, videos_known, videos_fetched_at,
                                      force_refetch)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1)
               ON CONFLICT(channel_id) DO UPDATE SET
                   name=COALESCE(channels.name, excluded.name),
                   subscribers=COALESCE(channels.subscribers, excluded.subscribers),
                   country=COALESCE(channels.country, excluded.country),
                   median_views_last_30=COALESCE(channels.median_views_last_30,
                                                 excluded.median_views_last_30),
                   latest_upload_at=COALESCE(channels.latest_upload_at, excluded.latest_upload_at),
                   seen_brands=COALESCE(channels.seen_brands, excluded.seen_brands),
                   found_emails=COALESCE(channels.found_emails, excluded.found_emails),
                   found_email_sources=COALESCE(channels.found_email_sources,
                                                excluded.found_email_sources),
                   videos_known=MAX(COALESCE(channels.videos_known, -1),
                                    COALESCE(excluded.videos_known, -1))""",
            (
                channel_id,
                handle or channel_id,  # the column can't be empty; as the `unarchived` op does
                tomb["name"],
                tomb["subscribers"],
                tomb["country"],
                first_seen,
                tomb["videos_last_30"] or 0,  # with videos_fetched_at NULL this reads "not read"
                median,
                tomb["latest_upload_at"],
                tomb["seen_brands"],
                tomb["found_emails"],
                tomb["found_email_sources"],
                tomb["videos_found_count"],  # how many videos we had (measure reads it back)
            ),
        )
        # MAX(..., -1) above leaves -1 where neither knew.
        conn.execute(
            "UPDATE channels SET videos_known=NULL WHERE channel_id=? AND videos_known=-1",
            (channel_id,),
        )
        for entry in _merge_found_via(_json_list(tomb["found_via"])):
            if not isinstance(entry, dict):
                continue
            item = cast("dict[str, object]", entry)
            keyword = item.get("keyword")
            if not isinstance(keyword, str) or not keyword or keyword == REFETCH_KEYWORD:
                continue
            at = item.get("discovered_at")
            conn.execute(
                "INSERT OR IGNORE INTO channel_keywords (channel_id, keyword, discovered_at) "
                "VALUES (?, ?, ?)",
                (channel_id, keyword, at if isinstance(at, str) and at else first_seen),
            )
        conn.execute("DELETE FROM channel_archive WHERE channel_id=?", (channel_id,))
    conn.commit()
    return handle


def _delete_channel(conn: sqlite3.Connection, channel_id: str) -> None:
    conn.execute("DELETE FROM videos WHERE channel_id=?", (channel_id,))
    conn.execute("DELETE FROM channel_keywords WHERE channel_id=?", (channel_id,))
    conn.execute("DELETE FROM channels WHERE channel_id=?", (channel_id,))


def _number(value: object) -> int | None:
    return int(value) if isinstance(value, int | float) and not isinstance(value, bool) else None


def apply_remote_archive(conn: sqlite3.Connection, rec: Mapping[str, Any]) -> None:
    """Applies another machine's tombstone: the archive row (its numbers through the merge, which
    can't lose one), then the channel and its videos go. What this machine can see is measured
    first: it may hold the very videos the sender never had. Doesn't commit."""
    channel_id: str = rec["channel_id"]
    found_via = rec.get("found_via")
    if isinstance(found_via, dict | list):
        found_via = json.dumps(found_via)
    subscribers = rec.get("subscribers")
    median, count = _number(rec.get("median_views_last_30")), _number(rec.get("videos_found_count"))
    mine = measure_archive_numbers(conn, channel_id)
    conn.execute(
        "INSERT INTO channel_archive "
        "(channel_id, handle, label, archived_at, subscribers, found_at, found_via, source, "
        " announced, "
        " median_views_last_30, median_basis, videos_found_count) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, 'remote', 1, ?, ?, ?) "
        "ON CONFLICT(channel_id) DO UPDATE SET "
        "  handle=excluded.handle, label=excluded.label, archived_at=excluded.archived_at, "
        "  subscribers=excluded.subscribers, found_at=excluded.found_at, "
        "  found_via=excluded.found_via, source='remote', announced=1",
        (
            channel_id,
            rec.get("handle"),
            rec.get("label"),
            rec.get("archived_at"),
            str(subscribers) if subscribers is not None else None,
            rec.get("found_at"),
            found_via,
            median,
            rec.get("median_basis"),
            count,
        ),
    )
    merge_archive_numbers(conn, channel_id, median, rec.get("median_basis"), count, announce=False)
    merge_archive_numbers(conn, channel_id, *mine)
    _keep_row_facts(conn, channel_id)
    _delete_channel(conn, channel_id)


def _keep_row_facts(conn: sqlite3.Connection, channel_id: str) -> None:
    """Copies the channel row's facts onto a teammate's tombstone before the row goes (D42). They
    are this machine's own and never shared, so the sender's identity and keywords stay as sent."""
    row = conn.execute("SELECT * FROM channels WHERE channel_id=?", (channel_id,)).fetchone()
    old = conn.execute("SELECT * FROM channel_archive WHERE channel_id=?", (channel_id,)).fetchone()
    if row is None or old is None:
        return
    facts = _merge_facts(dict(old), _row_facts(conn, row))
    conn.execute(
        "UPDATE channel_archive SET "
        + ", ".join(f"{name}=?" for name in facts)
        + " WHERE channel_id=?",
        (*facts.values(), channel_id),
    )


def get_unannounced_archives(conn: sqlite3.Connection) -> list[Row]:
    """Tombstones decided here that no catalog segment has named yet."""
    return [
        dict(r)
        for r in conn.execute(
            "SELECT * FROM channel_archive WHERE announced=0 AND source IS NOT 'remote'"
        )
    ]


def mark_archives_announced(conn: sqlite3.Connection, channel_ids: Iterable[str]) -> None:
    ids = list(channel_ids)
    if ids:
        conn.execute(
            f"UPDATE channel_archive SET announced=1 WHERE channel_id IN ({_placeholders(ids)})",
            ids,
        )


# --- enrichment: blanks to refill and failed fetches to retry (the backfill job) ---

# The columns a blank is looked for in, by the name the job uses.
_ENRICH_CHANNEL_FIELDS: Final = {
    "country": "country",
    "subscribers": "subscribers",
    "name": "name",
    "description": "description",
}
_ENRICH_VIDEO_FIELDS: Final = {
    "view_count": "view_count",
    "published_at": "published_at",
    "title": "title",
}


def _missing_sql(column: str) -> str:
    return f"({column} IS NULL OR {column} = '')"


def _handle_clause(handles: Iterable[str] | None, alias: str = "channels") -> tuple[str, list[str]]:
    wanted = list(handles or ())
    if not wanted:
        return "", []
    return f" AND {alias}.handle IN ({_placeholders(wanted)})", wanted


def field_coverage_watermark(
    conn: sqlite3.Connection, table: Literal["channels", "videos"], field: str
) -> str | None:
    """The earliest fetch time at which this field was ever recorded. A row fetched before it
    was fetched when the pipeline did not collect the field yet, so a refetch will likely fill
    it; one fetched at or after it came back blank from a fetch that did collect it, so YouTube
    has no value. None when the field was never recorded (nothing can be inferred)."""
    fields = _ENRICH_CHANNEL_FIELDS if table == "channels" else _ENRICH_VIDEO_FIELDS
    column = fields.get(field)
    if not column:
        raise ValueError(f"unknown {table} field: {field}")
    row = conn.execute(
        f"SELECT MIN(last_fetched_at) AS w FROM {table} "
        f"WHERE last_fetched_at IS NOT NULL AND NOT {_missing_sql(column)}"
    ).fetchone()
    return str(row["w"]) if row and row["w"] else None


def get_channels_missing(
    conn: sqlite3.Connection,
    fields: Iterable[str],
    handles: Iterable[str] | None = None,
    before: str | None = None,
) -> Discovered:
    """Channels blank in ANY of `fields`, oldest first. `before` keeps only rows last fetched
    before that time (a watermark); a channel never fetched always qualifies."""
    columns = [_ENRICH_CHANNEL_FIELDS[f] for f in fields if f in _ENRICH_CHANNEL_FIELDS]
    if not columns:
        return {}
    missing = " OR ".join(_missing_sql(c) for c in columns)
    sql = f"SELECT handle, channel_id FROM channels WHERE ({missing})"
    params: list[Any] = []
    if before:
        sql += " AND (last_fetched_at IS NULL OR last_fetched_at < ?)"
        params.append(before)
    clause, handle_params = _handle_clause(handles)
    params.extend(handle_params)
    rows = conn.execute(f"{sql}{clause} ORDER BY first_seen_at", params)
    return {r["handle"]: r["channel_id"] for r in rows}


def get_channels_failed(
    conn: sqlite3.Connection, handles: Iterable[str] | None = None
) -> Discovered:
    """Channels whose last fetch failed. Always worth retrying: a failure says nothing about
    what YouTube holds, only that the question was never answered."""
    clause, params = _handle_clause(handles)
    rows = conn.execute(
        f"SELECT handle, channel_id FROM channels WHERE last_fetch_status='failed'{clause} "
        "ORDER BY first_seen_at",
        params,
    )
    return {r["handle"]: r["channel_id"] for r in rows}


def get_videos_needing_refetch(
    conn: sqlite3.Connection,
    fields: Iterable[str],
    handles: Iterable[str] | None = None,
    before: str | None = None,
) -> list[tuple[str, str]]:
    """[(video_id, channel_id)] for videos blank in any of `fields` (and fetched before `before`,
    when given) plus every video whose last fetch failed, whatever `before` says."""
    columns = [_ENRICH_VIDEO_FIELDS[f] for f in fields if f in _ENRICH_VIDEO_FIELDS]
    conditions: list[str] = []
    params: list[Any] = []
    if columns:
        missing = " OR ".join(_missing_sql(c) for c in columns)
        if before:
            conditions.append(
                f"(({missing}) AND (v.last_fetched_at IS NULL OR v.last_fetched_at < ?))"
            )
            params.append(before)
        else:
            conditions.append(f"({missing})")
    conditions.append("v.last_fetch_status = 'failed'")
    clause, handle_params = _handle_clause(handles, alias="c")
    params.extend(handle_params)
    rows = conn.execute(
        "SELECT v.video_id, v.channel_id FROM videos v "
        "JOIN channels c ON c.channel_id = v.channel_id "
        f"WHERE ({' OR '.join(conditions)}){clause} ORDER BY v.channel_id, v.video_id",
        params,
    )
    return [(r["video_id"], r["channel_id"]) for r in rows]


def get_channel_video_span(
    conn: sqlite3.Connection, channel_id: str
) -> tuple[int, str | None, str | None]:
    """How much history one channel has stored: (count, oldest, newest). Only videos with a
    publish date count, so a failed fetch can't make the window look wider than it is."""
    row = conn.execute(
        "SELECT COUNT(*) AS n, MIN(published_at) AS oldest, MAX(published_at) AS newest "
        "FROM videos WHERE channel_id=? AND published_at IS NOT NULL AND published_at <> ''",
        (channel_id,),
    ).fetchone()
    return (int(row["n"] or 0), row["oldest"], row["newest"])


def get_existing_video_ids(conn: sqlite3.Connection, channel_id: str) -> set[str]:
    rows = conn.execute("SELECT video_id FROM videos WHERE channel_id=?", (channel_id,))
    return {r["video_id"] for r in rows}


def get_channels(conn: sqlite3.Connection, handles: Iterable[str] | None = None) -> Discovered:
    """{handle: channel_id} for the given handles that are stored, or for every channel."""
    clause, params = _handle_clause(handles)
    rows = conn.execute(
        f"SELECT handle, channel_id FROM channels WHERE 1=1{clause} ORDER BY first_seen_at", params
    )
    return {r["handle"]: r["channel_id"] for r in rows}


# --- runs (one machine's facts, never shared) ---


def start_run(conn: sqlite3.Connection, keywords_total: int, kind: RunKind = "search") -> int:
    cur = conn.execute(
        "INSERT INTO runs (started_at, keywords_total, pid, kind) VALUES (?, ?, ?, ?)",
        (utc_now(), keywords_total, os.getpid(), kind),
    )
    conn.commit()
    run_id = cur.lastrowid
    assert run_id is not None  # noqa: S101 - an INSERT always sets it
    return run_id


def set_run_kind(conn: sqlite3.Connection, run_id: int, kind: RunKind) -> None:
    conn.execute("UPDATE runs SET kind=? WHERE run_id=?", (kind, run_id))
    conn.commit()


def _process_alive(pid: int | None) -> bool:
    """Whether a process with this id runs on this machine. A recycled pid reads as alive, the
    safe way to be wrong: a row is left open rather than a live run declared dead."""
    if not pid or pid <= 0:
        return False
    if sys.platform == "win32":
        import ctypes

        # PROCESS_QUERY_LIMITED_INFORMATION: granted for our own processes without elevation.
        handle = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)
        if not handle:
            return False
        ctypes.windll.kernel32.CloseHandle(handle)
        return True
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True  # alive, just not ours to signal
    except OSError:
        return False
    return True


def reconcile_stale_runs(conn: sqlite3.Connection) -> int:
    """Closes `runs` rows left saying running by a process that is gone (killed, or the machine
    shut down): only `finish_run` moves a row off running, and it can't run in a dead process.
    A row whose process is alive is left alone. Returns how many rows were closed."""
    rows = conn.execute("SELECT run_id, pid FROM runs WHERE status='running'").fetchall()
    mine = os.getpid()
    stale: list[int] = [
        r["run_id"] for r in rows if r["pid"] != mine and not _process_alive(r["pid"])
    ]
    for run_id in stale:
        finish_run(conn, run_id, status="interrupted")
    return len(stale)


def update_run_progress(
    conn: sqlite3.Connection,
    run_id: int,
    keywords_done: int | None = None,
    channels_delta: int = 0,
    videos_delta: int = 0,
) -> None:
    conn.execute(
        """UPDATE runs SET
               keywords_done = COALESCE(?, keywords_done),
               channels_upserted = channels_upserted + ?,
               videos_upserted = videos_upserted + ?
           WHERE run_id=?""",
        (keywords_done, channels_delta, videos_delta, run_id),
    )
    conn.commit()


def finish_run(
    conn: sqlite3.Connection,
    run_id: int,
    status: Literal["done", "stopped", "interrupted"] = "done",
) -> None:
    conn.execute(
        "UPDATE runs SET status=?, finished_at=? WHERE run_id=?", (status, utc_now(), run_id)
    )
    conn.commit()


def get_run(conn: sqlite3.Connection, run_id: int) -> Row | None:
    row = conn.execute("SELECT * FROM runs WHERE run_id=?", (run_id,)).fetchone()
    return dict(row) if row else None


# --- sync cursors ---


def get_sync_cursor(conn: sqlite3.Connection, collection: str) -> str:
    row = conn.execute(
        "SELECT last_pushed_at FROM sync_state WHERE collection=?", (collection,)
    ).fetchone()
    return row["last_pushed_at"] if row else EPOCH


def is_bootstrapped(conn: sqlite3.Connection) -> bool:
    """Whether the first share ran to completion. Its own function because an unset cursor reads
    as EPOCH, not None."""
    return get_sync_cursor(conn, BOOTSTRAP_CURSOR) not in (EPOCH, "")


def set_sync_cursor(conn: sqlite3.Connection, collection: str, ts: str) -> None:
    conn.execute(
        "INSERT INTO sync_state (collection, last_pushed_at) VALUES (?, ?) "
        "ON CONFLICT(collection) DO UPDATE SET last_pushed_at=excluded.last_pushed_at",
        (collection, ts),
    )
    conn.commit()


# --- R2: the per-channel object ---
# `channels/<channel_id>.json.zst`: the channel's scraped details and every stored video. Written
# by whichever machine finished the video pass, read by every machine that hasn't. Nothing
# derived and nothing typed in by a person goes in it.

_BLOB_CHANNEL_FIELDS: Final = (
    "channel_id",
    "handle",
    "name",
    "description",
    "subscribers",
    "profile_picture",
    "banner",
    "link",
    "country",
    "first_seen_at",
    "last_fetched_at",
    "videos_fetched_at",
)


def get_blob_upload_candidates(conn: sqlite3.Connection, limit: int | None = None) -> list[Row]:
    """Channels fully read here whose current version isn't uploaded yet. One merely downloaded
    and applied is already in the bucket."""
    sql = (
        "SELECT channel_id, handle, videos_fetched_at FROM channels "
        "WHERE videos_fetched_at IS NOT NULL "
        "  AND (blob_uploaded_at IS NULL OR blob_uploaded_at < videos_fetched_at) "
        "  AND (blob_applied_version IS NULL OR blob_applied_version < videos_fetched_at) "
        "ORDER BY videos_fetched_at"
    )
    params: list[Any] = []
    if limit:
        sql += " LIMIT ?"
        params.append(limit)
    return [dict(r) for r in conn.execute(sql, params)]


def build_channel_blob(conn: sqlite3.Connection, channel_id: str) -> Row | None:
    """The object body for one channel, as a dict (the caller encodes and compresses it)."""
    row = conn.execute("SELECT * FROM channels WHERE channel_id=?", (channel_id,)).fetchone()
    if row is None:
        return None
    channel = {k: row[k] for k in _BLOB_CHANNEL_FIELDS}
    videos: list[Row] = []
    failed: list[str] = []
    for v in conn.execute(
        "SELECT * FROM videos WHERE channel_id=? ORDER BY published_at DESC, video_id",
        (channel_id,),
    ):
        if v["last_fetch_status"] == "failed":
            failed.append(v["video_id"])
            continue
        videos.append(
            {
                "video_id": v["video_id"],
                "title": v["title"],
                "description": v["description"],
                "thumbnail": v["thumbnail"],
                "tags": _json_list(v["tags"]),
                "published_at": v["published_at"],
                "view_count": v["view_count"],
                "last_fetched_at": v["last_fetched_at"],
            }
        )
    return {"v": BLOB_SCHEMA, "channel": channel, "videos": videos, "failed_video_ids": failed}


def mark_blob_uploaded(conn: sqlite3.Connection, channel_id: str, version: str) -> None:
    conn.execute(
        "UPDATE channels SET blob_uploaded_at=?, blob_version=MAX(COALESCE(blob_version, ''), ?) "
        "WHERE channel_id=?",
        (version, version, channel_id),
    )
    conn.commit()


def get_blob_download_candidates(conn: sqlite3.Connection, limit: int | None = None) -> list[Row]:
    """Channels the catalog says have a newer object than anything applied or uploaded here."""
    sql = (
        "SELECT channel_id, blob_version FROM channels "
        "WHERE blob_version IS NOT NULL "
        "  AND blob_version > COALESCE(blob_applied_version, blob_uploaded_at, '') "
        "ORDER BY first_seen_at"
    )
    params: list[Any] = []
    if limit:
        sql += " LIMIT ?"
        params.append(limit)
    return [dict(r) for r in conn.execute(sql, params)]


def apply_channel_blob(conn: sqlite3.Connection, blob: Mapping[str, Any], version: str) -> bool:
    """Writes one downloaded object: the details, the full video set (replacing what was here)
    and the rollups. Commits.

    Skipped, returning False, when this machine's own read is at least as fresh. "At least" is
    inclusive for an empty object at the same stamp as videos held here: that is the same read
    seen from a machine that never had the videos, and replacing rows with nothing on its
    strength is how a store loses what only it had."""
    channel: Mapping[str, Any] = blob.get("channel") or {}
    channel_id = channel.get("channel_id")
    if not channel_id:
        return False
    row = conn.execute(
        "SELECT videos_fetched_at, first_seen_at, "
        "  EXISTS (SELECT 1 FROM videos v WHERE v.channel_id = channels.channel_id) AS has_videos "
        "FROM channels WHERE channel_id=?",
        (channel_id,),
    ).fetchone()
    local_stamp = row["videos_fetched_at"] if row else None
    remote_stamp = channel.get("videos_fetched_at") or ""
    has_videos = bool(row and row["has_videos"])
    object_is_empty = not (blob.get("videos") or blob.get("failed_video_ids"))
    if local_stamp and (
        local_stamp > remote_stamp
        or (object_is_empty and has_videos and local_stamp == remote_stamp)
    ):
        conn.execute(
            "UPDATE channels SET blob_applied_version=? WHERE channel_id=?", (version, channel_id)
        )
        conn.commit()
        return False

    first_seen = channel.get("first_seen_at") or utc_now()
    if row and row["first_seen_at"] and row["first_seen_at"] < first_seen:
        first_seen = row["first_seen_at"]
    conn.execute(
        """INSERT INTO channels (channel_id, handle, name, description, subscribers,
                                  profile_picture, banner, link, country, first_seen_at,
                                  last_fetched_at, last_fetch_status, videos_fetched_at,
                                  force_refetch, blob_version, blob_applied_version, announced_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'success', ?, 0, ?, ?, ?)
           ON CONFLICT(channel_id) DO UPDATE SET
               handle=excluded.handle, name=excluded.name, description=excluded.description,
               subscribers=excluded.subscribers, profile_picture=excluded.profile_picture,
               banner=excluded.banner, link=excluded.link, country=excluded.country,
               first_seen_at=excluded.first_seen_at,
               last_fetched_at=excluded.last_fetched_at, last_fetch_status='success',
               videos_fetched_at=excluded.videos_fetched_at, force_refetch=0,
               blob_version=MAX(COALESCE(channels.blob_version, ''), excluded.blob_version),
               blob_applied_version=excluded.blob_applied_version,
               announced_at=COALESCE(channels.announced_at, excluded.announced_at),
               awaiting_peer_since=NULL""",
        (
            channel_id,
            channel.get("handle") or "",
            channel.get("name"),
            channel.get("description"),
            channel.get("subscribers"),
            channel.get("profile_picture"),
            channel.get("banner"),
            channel.get("link"),
            channel.get("country"),
            first_seen,
            channel.get("last_fetched_at"),
            channel.get("videos_fetched_at"),
            version,
            version,
            utc_now(),
        ),
    )
    conn.execute("DELETE FROM videos WHERE channel_id=?", (channel_id,))
    now = utc_now()
    videos: list[Mapping[str, Any]] = blob.get("videos") or []
    conn.executemany(
        """INSERT OR REPLACE INTO videos (video_id, channel_id, title, description, thumbnail,
                                          tags, published_at, view_count, last_fetched_at,
                                          last_fetch_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'success')""",
        [
            (
                v.get("video_id"),
                channel_id,
                v.get("title"),
                v.get("description"),
                v.get("thumbnail"),
                json.dumps(v.get("tags") or []),
                v.get("published_at"),
                v.get("view_count"),
                v.get("last_fetched_at") or now,
            )
            for v in videos
            if v.get("video_id")
        ],
    )
    failed: list[str] = blob.get("failed_video_ids") or []
    conn.executemany(
        "INSERT OR REPLACE INTO videos (video_id, channel_id, last_fetched_at, last_fetch_status) "
        "VALUES (?, ?, ?, 'failed')",
        [(vid, channel_id, now) for vid in failed],
    )
    compute_channel_rollups(conn, [channel_id])
    conn.commit()
    return True


# --- R2: the catalog log ---
# What this machine still has to announce, and how others' announcements are applied. Every op
# is idempotent: applying a segment twice is harmless, so a crash between "applied" and "recorded
# as applied" is safe.


def get_applied_segments(conn: sqlite3.Connection) -> set[str]:
    return {r["key"] for r in conn.execute("SELECT key FROM _applied_segments")}


def mark_segment_applied(conn: sqlite3.Connection, key: str) -> None:
    conn.execute(
        "INSERT OR IGNORE INTO _applied_segments (key, applied_at) VALUES (?, ?)", (key, utc_now())
    )


def get_unannounced_channels(conn: sqlite3.Connection, limit: int | None = None) -> list[Row]:
    """Channels scraped here that no segment has named yet, in the thin shape a `found` op
    carries."""
    sql = (
        "SELECT channel_id, handle, name, profile_picture, subscribers, country, "
        "       first_seen_at, videos_fetched_at, blob_uploaded_at "
        "FROM channels WHERE announced_at IS NULL AND last_fetched_at IS NOT NULL "
        "ORDER BY first_seen_at"
    )
    params: list[Any] = []
    if limit:
        sql += " LIMIT ?"
        params.append(limit)
    return [dict(r) for r in conn.execute(sql, params)]


def mark_channels_announced(
    conn: sqlite3.Connection, channel_ids: Iterable[str], stamp: str
) -> None:
    ids = list(channel_ids)
    if ids:
        conn.execute(
            f"UPDATE channels SET announced_at=? WHERE channel_id IN ({_placeholders(ids)})",
            [stamp, *ids],
        )


def get_unannounced_blobs(conn: sqlite3.Connection) -> list[Row]:
    """Announced channels whose object was since uploaded at a version the catalog doesn't name."""
    return [
        dict(r)
        for r in conn.execute(
            "SELECT channel_id, blob_uploaded_at FROM channels "
            "WHERE announced_at IS NOT NULL AND blob_uploaded_at IS NOT NULL "
            "  AND blob_uploaded_at > COALESCE(blob_announced_version, '')"
        )
    ]


def mark_blobs_announced(conn: sqlite3.Connection, versions: Mapping[str, str]) -> None:
    conn.executemany(
        "UPDATE channels SET blob_announced_version=? WHERE channel_id=?",
        [(v, cid) for cid, v in versions.items()],
    )


def get_unannounced_links(conn: sqlite3.Connection) -> list[Row]:
    return [
        dict(r)
        for r in conn.execute(
            "SELECT channel_id, keyword, discovered_at FROM channel_keywords "
            "WHERE source='local' AND announced=0"
        )
    ]


def mark_links_announced(conn: sqlite3.Connection, links: Iterable[tuple[str, str]]) -> None:
    conn.executemany(
        "UPDATE channel_keywords SET announced=1 WHERE channel_id=? AND keyword=?", list(links)
    )


def get_dirty_keywords(conn: sqlite3.Connection) -> list[Row]:
    return [
        dict(r) for r in conn.execute("SELECT * FROM keywords WHERE source='local' AND dirty=1")
    ]


def mark_keywords_announced(conn: sqlite3.Connection, keywords: Iterable[str]) -> None:
    conn.executemany("UPDATE keywords SET dirty=0 WHERE keyword=?", [(kw,) for kw in keywords])


def apply_remote_keyword(conn: sqlite3.Connection, rec: Mapping[str, Any]) -> None:
    """Merges another machine's keyword row. A keyword worked here more recently keeps its own
    state: the remote row is older news."""
    settings_val = rec.get("search_settings")
    if isinstance(settings_val, dict | list):
        settings_val = json.dumps(settings_val)
    conn.execute(
        """INSERT INTO keywords (keyword, status, added_at, started_at, completed_at,
                                  channels_found, claimed_by, search_settings, source, dirty)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'remote', 0)
           ON CONFLICT(keyword) DO UPDATE SET
               status=excluded.status, added_at=excluded.added_at, started_at=excluded.started_at,
               completed_at=excluded.completed_at, channels_found=excluded.channels_found,
               claimed_by=excluded.claimed_by, search_settings=excluded.search_settings,
               source='remote', dirty=0
           WHERE COALESCE(keywords.completed_at, keywords.started_at, '')
                 <= COALESCE(excluded.completed_at, excluded.started_at, '')""",
        (
            rec["keyword"],
            rec.get("status", "pending"),
            rec.get("added_at", utc_now()),
            rec.get("started_at"),
            rec.get("completed_at"),
            rec.get("channels_found", 0),
            rec.get("claimed_by"),
            settings_val,
        ),
    )


def apply_remote_channel_keyword(conn: sqlite3.Connection, rec: Mapping[str, Any]) -> None:
    """A keyword link from another machine; skipped when the channel isn't here (the foreign key
    needs it, and an archived channel's links live on its tombstone)."""
    conn.execute(
        "INSERT OR IGNORE INTO channel_keywords "
        "(channel_id, keyword, discovered_at, source, announced) "
        "SELECT ?, ?, ?, 'remote', 1 WHERE EXISTS (SELECT 1 FROM channels WHERE channel_id=?)",
        (
            rec["channel_id"],
            rec["keyword"],
            rec.get("discovered_at") or utc_now(),
            rec["channel_id"],
        ),
    )


def get_inherited_video_stamps(conn: sqlite3.Connection) -> list[Row]:
    """Channels stamped as read with no videos here and no object ever applied: the stamp came
    from another machine's read. Only the first share consults this."""
    return [
        dict(r)
        for r in conn.execute(
            "SELECT channel_id, blob_uploaded_at FROM channels "
            "WHERE videos_fetched_at IS NOT NULL AND blob_applied_version IS NULL "
            "  AND NOT EXISTS (SELECT 1 FROM videos v WHERE v.channel_id = channels.channel_id)"
        )
    ]


def clear_video_stamps(conn: sqlite3.Connection, channel_ids: Iterable[str]) -> None:
    """Takes an inherited stamp off and waits for the reader's object (awaiting_peer_since),
    rather than putting the channel in the backlog."""
    ids = list(channel_ids)
    now = utc_now()
    for start in range(0, len(ids), 500):
        chunk = ids[start : start + 500]
        conn.execute(
            "UPDATE channels SET videos_fetched_at=NULL, blob_uploaded_at=NULL, "
            "  blob_version=NULL, blob_announced_version=NULL, videos_last_30=0, "
            "  median_views_last_30=NULL, latest_upload_at=NULL, awaiting_peer_since=? "
            f"WHERE channel_id IN ({_placeholders(chunk)})",
            [now, *chunk],
        )


def forget_blob_version(conn: sqlite3.Connection, channel_id: str, version: str) -> None:
    """The catalog named a version the bucket doesn't have: forget it, so the next op naming it
    counts as news again."""
    conn.execute(
        "UPDATE channels SET blob_version=NULL WHERE channel_id=? AND blob_version=?",
        (channel_id, version),
    )


def apply_catalog_channel(conn: sqlite3.Connection, ch: Mapping[str, Any], stamp: str) -> bool:
    """A `found` op: creates the thin row, or fills the thin columns on a row only discovered
    here. A row scraped here keeps its values and takes only the newer version. Refused (False)
    when the channel is archived here."""
    channel_id = ch.get("channel_id")
    if not channel_id or is_archived(conn, channel_id):
        return False
    conn.execute(
        """INSERT INTO channels (channel_id, handle, name, profile_picture, subscribers,
                                  country, first_seen_at, videos_fetched_at, blob_version,
                                  announced_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(channel_id) DO UPDATE SET
               handle=CASE WHEN channels.last_fetched_at IS NULL
                           THEN excluded.handle ELSE channels.handle END,
               name=CASE WHEN channels.last_fetched_at IS NULL
                         THEN excluded.name ELSE channels.name END,
               profile_picture=CASE WHEN channels.last_fetched_at IS NULL
                                    THEN excluded.profile_picture ELSE channels.profile_picture END,
               subscribers=CASE WHEN channels.last_fetched_at IS NULL
                                THEN excluded.subscribers ELSE channels.subscribers END,
               country=CASE WHEN channels.last_fetched_at IS NULL
                            THEN excluded.country ELSE channels.country END,
               first_seen_at=MIN(channels.first_seen_at, excluded.first_seen_at),
               videos_fetched_at=CASE WHEN channels.videos_fetched_at IS NULL
                                      THEN excluded.videos_fetched_at
                                      ELSE channels.videos_fetched_at END,
               blob_version=MAX(COALESCE(channels.blob_version, ''),
                                COALESCE(excluded.blob_version, '')),
               announced_at=COALESCE(channels.announced_at, excluded.announced_at)""",
        (
            channel_id,
            ch.get("handle") or "",
            ch.get("name"),
            ch.get("profile_picture"),
            ch.get("subscribers"),
            ch.get("country"),
            ch.get("first_seen_at") or stamp,
            ch.get("videos_fetched_at") if ch.get("blob_version") else None,
            ch.get("blob_version") or None,
            stamp,
        ),
    )
    # MAX(..., '') above can leave '' where both were NULL.
    conn.execute(
        "UPDATE channels SET blob_version=NULL WHERE channel_id=? AND blob_version=''",
        (channel_id,),
    )
    return True


def apply_catalog_blob(conn: sqlite3.Connection, channel_id: str, version: str) -> None:
    conn.execute(
        "UPDATE channels SET blob_version=MAX(COALESCE(blob_version, ''), ?) WHERE channel_id=?",
        (version, channel_id),
    )


def apply_catalog_archive_link(
    conn: sqlite3.Connection,
    channel_id: str,
    keyword: str,
    handles_limit: int | None,
    discovered_at: str,
) -> None:
    """An `archive_link` op: appends the keyword to the tombstone's found_via, deduped."""
    row = conn.execute(
        "SELECT found_via FROM channel_archive WHERE channel_id=?", (channel_id,)
    ).fetchone()
    if row is None:
        return
    entries = _json_list(row["found_via"])
    if _add_found_via(entries, keyword, handles_limit, discovered_at):
        conn.execute(
            "UPDATE channel_archive SET found_via=? WHERE channel_id=?",
            (json.dumps(entries), channel_id),
        )


def apply_catalog_unarchived(conn: sqlite3.Connection, channel_id: str, handle: str | None) -> None:
    """An `unarchived` op: the tombstone goes, and the channel returns as a bare row flagged for a
    full re-fetch (its object was deleted when it was archived)."""
    conn.execute("DELETE FROM channel_archive WHERE channel_id=?", (channel_id,))
    conn.execute(
        "INSERT INTO channels (channel_id, handle, first_seen_at, force_refetch, announced_at) "
        "VALUES (?, ?, ?, 1, ?) ON CONFLICT(channel_id) DO UPDATE SET force_refetch=1",
        (channel_id, handle or channel_id, utc_now(), utc_now()),
    )


def unarchive_locally(
    conn: sqlite3.Connection, channel_ids: Iterable[str]
) -> list[tuple[str, str]]:
    """This machine's own un-archive. Returns [(channel_id, handle)] for the segment. Commits."""
    out: list[tuple[str, str]] = []
    for channel_id in channel_ids:
        row = conn.execute(
            "SELECT handle FROM channel_archive WHERE channel_id=?", (channel_id,)
        ).fetchone()
        handle: str = row["handle"] if row and row["handle"] else channel_id
        apply_catalog_unarchived(conn, channel_id, handle)
        out.append((channel_id, handle))
    conn.commit()
    return out
