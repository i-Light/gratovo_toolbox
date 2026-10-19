"""
SQLite persistence layer — the pipeline's local, always-available store.

Why SQLite: stdlib (no new dependency), handles large datasets without loading
everything into memory, and commits are incremental so a crash mid-run loses at
most the current batch instead of the whole run. Every table is keyed by the
YouTube-assigned natural id (channel_id, video_id, keyword text) rather than a
local autoincrement id, so that if/when multiple team members each run their own
instance against a slice of keywords, their .db files can be merged later without
id collisions -- the sync mechanism itself isn't solved here, this just avoids
closing that door.

WAL mode is enabled so another process (a future dashboard, a Flutter app, etc.)
can read the database at any time -- including mid-run -- without waiting for
this script to finish or blocking the writer. That is what lets the Flutter
app read live run progress off the same file while a search is running.

This is the LOCAL half of the storage story; `gratovo/sync.py` is what shares
it through Cloudflare R2 (one object per channel, plus an append-only catalog
log) and applies what other machines shared. Local first, always: a search
works with no network at all, and sharing is a separate step that can fail
without losing anything. This file is also the ONE database the Flutter app
reads and writes -- it keeps its own tables (channel_state, deals, outreach,
...) in the same file, and both sides open it in WAL mode with a busy timeout.

CHANGING THIS SCHEMA: every teammate already has a `gratovo.db` on disk, and
`CREATE TABLE IF NOT EXISTS` above will not touch it. An additive change (a new
column added as a guarded `ALTER TABLE` in `init_db`, a new table, a new index)
self-heals -- old and new builds keep reading the same file. A change that makes
an existing file wrong (a column retyped or dropped, a table restructured, rows
that must be recomputed) does NOT: add an action naming `database/gratovo.db` to
`data/reset_manifest.json`, and every teammate's app sets its stale copy aside on
the next launch and re-pulls a fresh one from R2. See that file's own notes for
the full decision.
"""

import json
import os
import sqlite3
import sys
import time

SCHEMA = """
CREATE TABLE IF NOT EXISTS keywords (
    keyword TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'pending',  -- pending | in_progress | done
    added_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    channels_found INTEGER NOT NULL DEFAULT 0,
    claimed_by TEXT,        -- worker/device identifier currently (or last) working this keyword
    search_settings TEXT,   -- JSON snapshot of the tunables (limits/thresholds) used for this claim
    source TEXT NOT NULL DEFAULT 'local',  -- see channel_keywords.source
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
    country TEXT,             -- ISO-3166 alpha-2, from channels().list's snippet.country
                               -- when the channel owner set one; NULL otherwise
    first_seen_at TEXT NOT NULL,
    last_fetched_at TEXT,
    last_fetch_status TEXT,   -- success | failed
    videos_fetched_at TEXT,
    force_refetch INTEGER NOT NULL DEFAULT 0,
    -- 30-day rollups, recomputed here from `videos` whenever a channel's
    -- video pass finishes or a blob is applied (compute_channel_rollups).
    -- Derived, so never shared: every machine works them out for itself.
    videos_last_30 INTEGER NOT NULL DEFAULT 0,
    median_views_last_30 INTEGER,
    latest_upload_at TEXT,
    -- R2 bookkeeping, all ISO stamps that equal a `videos_fetched_at`:
    --   blob_uploaded_at      the version THIS machine last uploaded
    --   blob_version          the newest version the catalog says exists
    --   blob_applied_version  the version this machine last downloaded and applied
    --   blob_announced_version the uploaded version the catalog already names
    --   announced_at          when this machine wrote a `found` op for it
    --                         (set on apply for channels learned from the log,
    --                         so they are never announced twice)
    blob_uploaded_at TEXT,
    blob_version TEXT,
    blob_applied_version TEXT,
    blob_announced_version TEXT,
    announced_at TEXT,
    -- Sponsorship-detection signals, recomputed by
    -- `gratovo.pipeline.compute_channel_sponsorship` from this channel's
    -- stored video descriptions wherever `mark_channels_videos_fetched` is
    -- (a channel's video set changed) -- see that function for the pass
    -- itself. Derived, so never shared: every machine works it out for
    -- itself, the same as the rollups above.
    sponsored_ratio REAL,     -- fraction of stored videos matching a
                               -- sponsorship signal; NULL with zero stored videos
    seen_brands TEXT,         -- JSON-encoded list, confident extractions only
    -- Addresses the creator publishes in the About text and the stored video
    -- descriptions, spelled-out forms included (`gratovo.found_emails`).
    -- Derived the same way as the two columns above, in the same pass
    -- (`gratovo.pipeline.derive_channel_signals`). JSON-encoded list.
    found_emails TEXT
);
CREATE INDEX IF NOT EXISTS idx_channels_handle ON channels(handle);

CREATE TABLE IF NOT EXISTS channel_keywords (
    channel_id TEXT NOT NULL REFERENCES channels(channel_id),
    keyword TEXT NOT NULL,
    discovered_at TEXT NOT NULL,
    -- 'local' (this machine's own discovery, to be announced in the catalog
    -- log) or 'remote' (learned from another machine's segment).
    source TEXT NOT NULL DEFAULT 'local',
    -- 0 until this machine has written the link into a catalog segment.
    -- A flag per row rather than a "since" cursor: cursors are whole seconds,
    -- and a row written in the same second as the previous segment would
    -- either be missed forever or repeated -- a flag is exact.
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
    tags TEXT,           -- JSON-encoded list
    published_at TEXT,
    view_count TEXT,     -- from videos().list's statistics.viewCount
    last_fetched_at TEXT,
    last_fetch_status TEXT  -- success | failed
);
CREATE INDEX IF NOT EXISTS idx_videos_channel_id ON videos(channel_id);

CREATE TABLE IF NOT EXISTS channel_archive (
    channel_id TEXT PRIMARY KEY,
    handle TEXT,
    label TEXT,
    archived_at TEXT,
    subscribers TEXT,   -- the count as YouTube returned it. Written by BOTH the
                        -- auto-clean gate (so its tombstone can carry it up
                        -- without the deleted channels row) and by a pull (so a
                        -- re-push of that row never blanks the Supabase value)
    found_at TEXT,      -- the channel's first_seen_at, copied at archive time
    found_via TEXT,     -- JSON: [{"keyword", "limit", "discovered_at"}, ...]
    source TEXT,        -- 'local' (this machine's decision) or 'remote' (learned
                        -- from another machine's segment). Only 'local' rows
                        -- are announced -- see get_unannounced_archives.
    announced INTEGER NOT NULL DEFAULT 0,
    median_views_last_30 INTEGER, -- the median view count, frozen at archive
                                  -- time: its videos are deleted by the same
                                  -- sweep, so this is a derived number that
                                  -- cannot be recomputed later. The app's
                                  -- keyword evaluation reads it. See
                                  -- `measure_archive_numbers` for how the
                                  -- three columns below are worked out, and
                                  -- `merge_archive_numbers` for why a write
                                  -- can only ever improve them.
    median_basis TEXT,            -- which set the median was taken over:
                                  -- 'window30' (the trailing-30-day rollup,
                                  -- the same number the influencer list
                                  -- shows) or 'lifetime' (every stored video,
                                  -- used when the window held nothing). NULL
                                  -- when there is no median.
    videos_found_count INTEGER    -- how many videos were stored for it when it
                                  -- was archived; frozen for the same reason.
                                  -- NULL, not 0, when no machine had the
                                  -- channel's videos to count -- the
                                  -- auto-clean gate archives before the video
                                  -- pass, and 0 must keep meaning "we looked
                                  -- and there were none".
);

CREATE TABLE IF NOT EXISTS sync_state (
    collection TEXT PRIMARY KEY,
    last_pushed_at TEXT NOT NULL
);

-- Every catalog segment this machine has applied, by key. The pull lists the
-- bucket and applies whatever is not in here; a key is only recorded once its
-- whole segment has been applied and committed.
CREATE TABLE IF NOT EXISTS _applied_segments (
    key TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
);

-- News, kept locally by tools/news.py (it used to write these to Supabase).
-- Public feeds, nothing to share: every machine fetches its own.
CREATE TABLE IF NOT EXISTS news_sources (
    id TEXT PRIMARY KEY,
    feed_url TEXT NOT NULL UNIQUE,
    title TEXT,
    niche TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    added_at TEXT NOT NULL,
    last_fetched_at TEXT,
    last_fetch_status TEXT,
    last_fetch_error TEXT
);

CREATE TABLE IF NOT EXISTS news_items (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES news_sources(id) ON DELETE CASCADE,
    guid TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    link TEXT,
    summary TEXT,
    author TEXT,
    image_url TEXT,
    published_at TEXT,
    fetched_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_news_items_published ON news_items(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_items_source ON news_items(source_id);

-- One row per (archived channel, keyword) that a search re-found but did NOT
-- re-add. The keyword is appended to the tombstone's `found_via` locally right
-- away; this queue is what still owes Supabase that same note, drained by
-- `sync.push_archive_keyword_notes` through the `archive_note_keyword` RPC.
--
-- A queue rather than a "dirty" flag on `channel_archive`: the archive's sync
-- cursor is `archived_at`, which a keyword note must not move (it would rewrite
-- when the channel was archived and re-sort the Archive list), so the pending
-- write needs somewhere of its own to wait. Rows are deleted once the RPC
-- confirms; a push that fails leaves them for the next one.
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
    status TEXT NOT NULL DEFAULT 'running',  -- running | done | interrupted
    keywords_total INTEGER NOT NULL DEFAULT 0,
    keywords_done INTEGER NOT NULL DEFAULT 0,
    channels_upserted INTEGER NOT NULL DEFAULT 0,
    videos_upserted INTEGER NOT NULL DEFAULT 0,
    -- OS process id of the run that wrote this row, so `reconcile_stale_runs`
    -- can tell a run that is still going from one whose process was killed.
    pid INTEGER,
    -- What kind of job wrote this row: 'search' (a keyword run), 'catch-up'
    -- (the background video backlog sweep) or 're-enrich' (tools/
    -- unarchive_and_enrich.py). Every one of them used to look identical here,
    -- and the app reads the newest row to show "what is running" -- so an
    -- hour-long maintenance sweep was rendered as a search that had found
    -- nothing but videos, with nothing anywhere saying otherwise.
    kind TEXT NOT NULL DEFAULT 'search'
);

-- One video's subtitles, fetched only when a first email to its creator is
-- drafted (decision `subtitles`), and the usable moments the gratovo-moments
-- skill read from them -- kept so a redo or a later draft reuses both. Local
-- to this machine, like the videos themselves.
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


def _now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


# How long a writer waits for another writer to let go before giving up.
#
# WAL mode lets readers and one writer work at the same time, but it does NOT
# make two writers queue: without this pragma SQLite's busy handler is off and
# the second writer fails *immediately* with "database is locked". That is not
# theoretical -- the app runs `search.py --pull-only` in the background as it
# launches and can auto-resume an interrupted run in the same second, and the
# resumed run died on its first write:
#
#     sqlite3.OperationalError: database is locked
#
# Both processes want the same rows for a second or two, which is exactly the
# case a busy timeout exists for. Fifteen seconds is far longer than any single
# statement here takes and still short enough to surface a genuine deadlock
# rather than hang a run forever.
BUSY_TIMEOUT_MS = 15000


def get_connection(db_path):
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute(f"PRAGMA busy_timeout={BUSY_TIMEOUT_MS}")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.row_factory = sqlite3.Row
    return conn


def init_db(conn):
    conn.executescript(SCHEMA)
    # Additive, self-healing migrations only. Each `ALTER TABLE ... ADD COLUMN`
    # below lets an already-created gratovo.db pick up a column that
    # `CREATE TABLE IF NOT EXISTS` above cannot add to an existing table.
    # Guarded because SQLite has no "ADD COLUMN IF NOT EXISTS" -- it errors on a
    # column that's already there, which is what happens on every run after the
    # first (including brand-new databases, where SCHEMA above just created it).
    #
    # A migration that CANNOT be expressed as an additive ADD COLUMN -- a retype,
    # a rename, a table restructure, a backfill that must recompute existing rows
    # -- does not belong here: an old gratovo.db would be left half-wrong. Ship a
    # `database/gratovo.db` action in `data/reset_manifest.json` instead; the
    # Flutter app then sets each teammate's stale file aside on the next launch
    # and re-pulls a fresh one.
    try:
        conn.execute("ALTER TABLE channels ADD COLUMN country TEXT")
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("ALTER TABLE videos ADD COLUMN view_count TEXT")
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("ALTER TABLE runs ADD COLUMN pid INTEGER")
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute(
            "ALTER TABLE runs ADD COLUMN kind TEXT NOT NULL DEFAULT 'search'")
    except sqlite3.OperationalError:
        pass
    # `channel_archive` predates the auto-clean gate writing its own tombstones;
    # these two columns let one carry the subscriber count and discovery time up
    # to Supabase after the channels row they'd otherwise come from is deleted.
    try:
        conn.execute("ALTER TABLE channel_archive ADD COLUMN subscribers TEXT")
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("ALTER TABLE channel_archive ADD COLUMN found_at TEXT")
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("ALTER TABLE channel_archive ADD COLUMN found_via TEXT")
    except sqlite3.OperationalError:
        pass
    # Tells a locally-written tombstone (the auto-clean gate) apart from one that
    # arrived by pull, so only the former is pushed back up. Pre-migration rows
    # are left NULL and treated as local -- a re-push of one is now harmless
    # anyway, since apply_remote_archive fills subscribers and found_at.
    try:
        conn.execute("ALTER TABLE channel_archive ADD COLUMN source TEXT")
    except sqlite3.OperationalError:
        pass
    # The R2 era: rollups computed locally, blob/catalog bookkeeping, and an
    # origin marker on the two tables whose rows are announced in the log.
    for statement in (
        "ALTER TABLE channels ADD COLUMN videos_last_30 INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE channels ADD COLUMN median_views_last_30 INTEGER",
        "ALTER TABLE channels ADD COLUMN latest_upload_at TEXT",
        "ALTER TABLE channels ADD COLUMN blob_uploaded_at TEXT",
        "ALTER TABLE channels ADD COLUMN blob_version TEXT",
        "ALTER TABLE channels ADD COLUMN blob_applied_version TEXT",
        "ALTER TABLE channels ADD COLUMN blob_announced_version TEXT",
        "ALTER TABLE channels ADD COLUMN announced_at TEXT",
        "ALTER TABLE channel_keywords ADD COLUMN source TEXT NOT NULL DEFAULT 'local'",
        "ALTER TABLE channel_keywords ADD COLUMN announced INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE keywords ADD COLUMN source TEXT NOT NULL DEFAULT 'local'",
        "ALTER TABLE keywords ADD COLUMN dirty INTEGER NOT NULL DEFAULT 1",
        "ALTER TABLE channel_archive ADD COLUMN announced INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE channel_archive ADD COLUMN median_views_last_30 INTEGER",
        "ALTER TABLE channel_archive ADD COLUMN videos_found_count INTEGER",
        "ALTER TABLE channels ADD COLUMN awaiting_peer_since TEXT",
        # Which set the frozen median was taken over. Pre-migration rows are
        # left NULL, which reads as "unstated" rather than as a claim: they
        # were all written by the old window-only path, but a row whose
        # median is NULL had no basis either way.
        "ALTER TABLE channel_archive ADD COLUMN median_basis TEXT",
        # Sponsorship detection (see the `channels` table comment above).
        "ALTER TABLE channels ADD COLUMN sponsored_ratio REAL",
        "ALTER TABLE channels ADD COLUMN seen_brands TEXT",
        # Found emails (fix #11). The app's mirror v4 carries the same ALTER:
        # whichever program opens the file first adds it.
        "ALTER TABLE channels ADD COLUMN found_emails TEXT",
    ):
        try:
            conn.execute(statement)
        except sqlite3.OperationalError:
            pass
    conn.execute("CREATE INDEX IF NOT EXISTS idx_channels_blob_pending "
                 "ON channels(blob_version) WHERE blob_version IS NOT NULL")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_channels_unannounced "
                 "ON channels(announced_at) WHERE announced_at IS NULL")
    # The app's reads of these tables: every sort the influencer list and the
    # archive page offer, and the per-channel video lookups. The app applies
    # the identical list on its own open (`kPipelineIndexesDdl` in
    # lib/core/sync/mirror_schema.dart) -- keep the two the same, statement
    # for statement. The expression indexes match the exact ORDER BY text the
    # app's queries use, which is the only way SQLite will walk them.
    for statement in (
        "CREATE INDEX IF NOT EXISTS idx_channels_subscribers_num "
        "ON channels (CAST(NULLIF(REPLACE(subscribers, ',', ''), '') AS INTEGER) DESC, channel_id)",
        "CREATE INDEX IF NOT EXISTS idx_channels_median_views "
        "ON channels (median_views_last_30 DESC, channel_id)",
        "CREATE INDEX IF NOT EXISTS idx_channels_videos_last_30 "
        "ON channels (COALESCE(videos_last_30, 0) DESC, channel_id)",
        "CREATE INDEX IF NOT EXISTS idx_channels_latest_upload "
        "ON channels (latest_upload_at DESC, channel_id)",
        "CREATE INDEX IF NOT EXISTS idx_channels_first_seen "
        "ON channels (first_seen_at DESC, channel_id)",
        "CREATE INDEX IF NOT EXISTS idx_videos_channel_published "
        "ON videos (channel_id, published_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_channel_archive_archived_at "
        "ON channel_archive (archived_at DESC, channel_id)",
        "CREATE INDEX IF NOT EXISTS idx_channel_archive_label_archived_at "
        "ON channel_archive (label, archived_at DESC, channel_id)",
        "CREATE INDEX IF NOT EXISTS idx_channel_archive_handle "
        "ON channel_archive (handle DESC, channel_id)",
        "CREATE INDEX IF NOT EXISTS idx_channel_archive_subscribers_num "
        "ON channel_archive (CAST(NULLIF(REPLACE(subscribers, ',', ''), '') AS INTEGER) DESC, channel_id)",
        "CREATE INDEX IF NOT EXISTS idx_channel_archive_median_views "
        "ON channel_archive (median_views_last_30 DESC, channel_id)",
        "CREATE INDEX IF NOT EXISTS idx_channel_archive_videos_found "
        "ON channel_archive (videos_found_count DESC, channel_id)",
    ):
        conn.execute(statement)
    conn.commit()


# ==========================================
# KEYWORDS
# ==========================================

def seed_keywords(conn, keywords):
    """Idempotent: re-running with an overlapping list never resets a keyword's status."""
    now = _now()
    conn.executemany(
        "INSERT OR IGNORE INTO keywords (keyword, status, added_at, dirty) VALUES (?, 'pending', ?, 1)",
        [(kw, now) for kw in keywords],
    )
    conn.commit()


def get_queued_keywords(conn):
    """pending + in_progress, oldest first -- the whole standing queue.

    No longer what a run processes. A run works the list it was handed
    (`data/keywords.json`, written fresh by whoever starts it), so that the
    person who typed five keywords gets a run of exactly those five and a
    progress counter that means something. This stays because `--status` and
    anything else wanting to know what is still outstanding across every list
    ever queued needs a way to ask.
    """
    rows = conn.execute(
        "SELECT keyword FROM keywords WHERE status IN ('pending', 'in_progress') ORDER BY added_at"
    ).fetchall()
    return [r["keyword"] for r in rows]


def mark_keyword_started(conn, keyword, worker_id, search_settings):
    """Records that this machine has started working `keyword`, right now.

    This used to be a *claim*: a conditional UPDATE that failed when another
    worker held the keyword, and a caller that skipped the keyword when it
    did. That mechanic is gone by decision -- nobody holds a keyword hostage,
    everyone runs whatever list they typed, and a stale row from a crashed run
    can no longer make a keyword unrunnable for two hours. What is left is a
    plain record of who last touched it and with which settings, which is worth
    keeping for the same reason `completed_at` is: it explains the row.
    """
    conn.execute(
        """UPDATE keywords SET status='in_progress', started_at=?, claimed_by=?,
                               search_settings=?, source='local', dirty=1
           WHERE keyword=?""",
        (_now(), worker_id, json.dumps(search_settings), keyword),
    )
    conn.commit()


def mark_keyword_done(conn, keyword, channels_found):
    conn.execute(
        "UPDATE keywords SET status='done', completed_at=?, channels_found=?, "
        "  source='local', dirty=1 WHERE keyword=?",
        (_now(), channels_found, keyword),
    )
    conn.commit()


# ==========================================
# CHANNELS
# ==========================================

def is_archived(conn, channel_id):
    """Whether this channel was rejected and archived by the team.

    `channel_archive` is a tombstone, learned from the catalog by sync.pull_catalog.
    A channel gets there 7 days after somebody tags it haram or irrelevant,
    at which point its videos and everything else about it are deleted.
    """
    row = conn.execute(
        "SELECT 1 FROM channel_archive WHERE channel_id=?", (channel_id,)
    ).fetchone()
    return row is not None


def unarchive(conn, channel_id):
    """Drops the local tombstone so this channel can be discovered again.

    Local only. The Supabase row is removed by the app when somebody re-adds
    the channel by hand; this keeps a manual refetch on this machine from being
    blocked in the meantime.
    """
    conn.execute("DELETE FROM channel_archive WHERE channel_id=?", (channel_id,))
    conn.commit()


# ==========================================
# THE ARCHIVE'S FROZEN NUMBERS
# ==========================================
# `median_views_last_30` and `videos_found_count` are the only derived facts
# the archive keeps, and the only ones it CANNOT recover: the sweep that
# writes them deletes the videos they came from, here and in the bucket. Every
# path that deletes a channel's videos goes through `measure_archive_numbers`
# first and `merge_archive_numbers` second, and the pair is what makes the
# archive trustworthy across machines:
#
#   measure   works the numbers out from the videos THIS machine holds, right
#             before they go. Says "unknown" (None) rather than zero when this
#             machine never had them, so a blank is never mistaken for a count.
#   merge     writes them so that a known number can never be replaced by an
#             unknown one, whoever is writing and in whatever order.
#
# Together they mean it no longer matters which machine's sweep tick fires
# first. The machine holding the videos contributes the numbers whenever it
# gets there -- before the deletion if it swept, or while applying somebody
# else's tombstone if it did not -- and nothing that arrives later can undo it.


def measure_archive_numbers(conn, channel_id):
    """The numbers to freeze onto [channel_id]'s tombstone, from the videos
    this machine holds right now: `(median, basis, count)`.

    `count` is every stored video, `median` is the trailing-30-day rollup
    `compute_channel_rollups` maintains -- and when that window is empty but
    videos are stored, the median over all of them, with `basis` saying which.
    A channel with 15 uploads and none in the last 30 days used to freeze as
    "15 videos, median unknown", which is exactly the shape of an inactive
    channel and so exactly the row the archive was losing the number on.

    All three are None when this machine cannot see the channel's videos: it
    pulled the row from the catalog and never applied the blob, or the
    auto-clean gate is archiving before any video pass. That is not zero, and
    `merge_archive_numbers` will not let it overwrite a real count.

    Zero is only claimed on the evidence that this machine ran the video pass
    itself (it uploaded the object) or applied somebody else's (it downloaded
    one). One case reads as unknown that really is zero -- a channel scraped
    here, genuinely holding no uploads, archived in the window before its
    object went up. That is the same ambiguity `get_inherited_video_stamps`
    names, and it is left leaning this way on purpose: an unknown is a number
    the merge can still fill in from any machine that knows better, and a
    wrong zero is a claim on the page that nothing will ever correct.
    """
    row = conn.execute(
        "SELECT median_views_last_30, videos_fetched_at, blob_applied_version, "
        "       blob_uploaded_at "
        "FROM channels WHERE channel_id=?", (channel_id,)).fetchone()
    counts = [
        _int_or_none(r["view_count"]) for r in conn.execute(
            "SELECT view_count FROM videos WHERE channel_id=?", (channel_id,)
        ).fetchall()
    ]
    stored = len(counts)
    if stored == 0:
        # No rows is either "no videos" or "not this machine's copy". Only a
        # machine that ran the pass itself (it uploaded the object) or applied
        # somebody else's (it downloaded one) is entitled to say zero.
        held = bool(row) and row["videos_fetched_at"] and (
            row["blob_applied_version"] or row["blob_uploaded_at"])
        return (None, None, 0 if held else None)
    window = row["median_views_last_30"] if row else None
    if window is not None:
        return (window, "window30", stored)
    lifetime = _median([c for c in counts if c is not None])
    return (lifetime, "lifetime" if lifetime is not None else None, stored)


def _median(values):
    """The 50th percentile of [values], or None when there are none. Even
    lengths take the mean of the middle pair, as the rollup does."""
    if not values:
        return None
    values = sorted(values)
    mid = len(values) // 2
    if len(values) % 2:
        return values[mid]
    return (values[mid - 1] + values[mid]) // 2


def merge_archive_numbers(conn, channel_id, median, basis, count, announce=True):
    """Folds one machine's measurement into [channel_id]'s tombstone without
    ever making it say less than it already did. Returns whether anything
    changed.

    The rule is that `videos_found_count` ranks the observations: a machine
    that counted 15 videos knows more about this channel than one that counted
    none, and more still than one that could not count at all. The larger count
    wins, and the median travels with the count it was computed from rather
    than being merged independently -- a median over 15 videos paired with a
    count of 3 would be a number describing a set the row does not claim.

    Called with whatever `measure_archive_numbers` returned, including all
    Nones: that case is a no-op by construction, which is the point. Every
    archive write in the program goes through here, so "the archive lost a
    number" cannot be reached from any of them.

    [announce] marks an improved row to go back out in the next segment, and
    is how a number reaches the machines that never had the videos: the one
    that did contributes it whenever it gets there, including while applying
    somebody else's tombstone. It flips `source` to 'local' to do that, since
    only local rows are announced -- this machine does have something of its
    own to say about the row. Pass False when merely applying what arrived,
    so the two sides do not announce the same numbers back and forth; a merge
    that changes nothing never announces either way, which is what stops the
    exchange after one round.
    """
    if median is None and count is None:
        return False
    row = conn.execute(
        "SELECT median_views_last_30, median_basis, videos_found_count "
        "FROM channel_archive WHERE channel_id=?", (channel_id,)).fetchone()
    if row is None:
        return False
    old_median, old_basis, old_count = (
        row["median_views_last_30"], row["median_basis"], row["videos_found_count"])
    # -1 sorts "never counted" below "counted zero", so a real zero still beats
    # a blank and neither beats a real count.
    if (count if count is not None else -1) >= (old_count if old_count is not None else -1):
        new_count = count if count is not None else old_count
        new_median, new_basis = (median, basis) if median is not None else (old_median, old_basis)
    else:
        new_count = old_count
        new_median, new_basis = (old_median, old_basis) if old_median is not None else (median, basis)
    if (new_median, new_basis, new_count) == (old_median, old_basis, old_count):
        return False
    conn.execute(
        "UPDATE channel_archive SET median_views_last_30=?, median_basis=?, "
        "  videos_found_count=?" + (", source='local', announced=0" if announce else "") +
        " WHERE channel_id=?",
        (new_median, new_basis, new_count, channel_id))
    return True


def archive_channel_locally(conn, channel_id, handle, label, subscribers=None,
                            found_at=None, found_via=None):
    """Tombstones a channel this machine has decided to reject, right now.

    The write side of the auto-clean gate (`pipeline.process_keyword`): a
    channel whose subscriber count falls outside the standing rule's range is
    archived here before a single one of its videos is fetched. Shaped exactly
    like `apply_remote_archive` -- INSERT the tombstone, then delete the
    channel's videos, keyword links and its own row -- so re-discovery routes it
    to the `archived` bucket in `partition_discovered` and nothing fetches it
    again.

    The one difference from `apply_remote_archive`: it records `subscribers`,
    `found_at` and `found_via` on the tombstone. `apply_remote_archive` does not
    need them (they live on the Supabase row it is mirroring), but a tombstone
    written *here* has to carry them itself -- `_archive_out` reads them
    straight back off this table to push up, and by then the channels row (and,
    for `found_via`, the `channel_keywords` row) they came from is gone.

    `found_via`: a list of `{"keyword", "limit", "discovered_at"}` dicts -- the
    keyword(s) that found this channel and the handles-search limit in effect
    for each. The caller supplies this rather than it being read back off
    `channel_keywords` here, because by the time the auto-clean gate archives a
    fresh discovery it is this run's own keyword and limit, already in scope --
    no query needed for the one case this path exists to serve.
    """
    now = _now()
    if found_at is None:
        row = conn.execute(
            "SELECT first_seen_at FROM channels WHERE channel_id=?",
            (channel_id,),
        ).fetchone()
        found_at = row["first_seen_at"] if row else now
    if subscribers is None:
        row = conn.execute(
            "SELECT subscribers FROM channels WHERE channel_id=?",
            (channel_id,),
        ).fetchone()
        subscribers = row["subscribers"] if row else None
    # Measured before the row is written and long before the videos are
    # deleted. From the auto-clean gate this is (None, None, None) -- the gate
    # archives before the video pass, so nothing was ever fetched to count,
    # and the tombstone says so rather than claiming zero videos.
    median, basis, videos_found = measure_archive_numbers(conn, channel_id)
    conn.execute(
        "INSERT OR REPLACE INTO channel_archive "
        "(channel_id, handle, label, archived_at, subscribers, found_at, "
        " found_via, source, median_views_last_30, median_basis, "
        " videos_found_count) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, 'local', ?, ?, ?)",
        (channel_id, handle, label, now,
         str(subscribers) if subscribers is not None else None, found_at,
         json.dumps(found_via or []), median, basis, videos_found),
    )
    conn.execute("DELETE FROM videos WHERE channel_id=?", (channel_id,))
    conn.execute("DELETE FROM channel_keywords WHERE channel_id=?", (channel_id,))
    conn.execute("DELETE FROM channels WHERE channel_id=?", (channel_id,))
    conn.commit()


def record_channel_discovery(conn, handle, channel_id, keyword):
    """Always called for every discovered handle, even ones already known, so the
    channel<->keyword association accumulates across hundreds of keyword runs.

    Returns False without recording anything when the channel is archived.

    That check is the whole point of keeping a tombstone rather than just
    deleting the row. Without it, the next search for the same keyword finds the
    channel again, adds it back as brand new, spends quota fetching its videos,
    and puts it in front of somebody to vet a second time -- undoing both the
    storage saving and the decision.
    """
    if is_archived(conn, channel_id):
        return False

    now = _now()
    conn.execute(
        "INSERT OR IGNORE INTO channels (channel_id, handle, first_seen_at) VALUES (?, ?, ?)",
        (channel_id, handle, now),
    )
    conn.execute(
        "INSERT OR IGNORE INTO channel_keywords (channel_id, keyword, discovered_at) VALUES (?, ?, ?)",
        (channel_id, keyword, now),
    )
    conn.commit()
    return True


def partition_discovered(conn, discovered):
    """Splits a keyword's freshly discovered {handle: channel_id} three ways.

    Returns `(fresh, known, archived)`:

      * `fresh`    {handle: channel_id} this database has never seen. The only
                   group anything is fetched for.
      * `known`    {handle: channel_id} already sitting in `channels`.
      * `archived` {handle: channel_id} carrying a tombstone in
                   `channel_archive`.

    Discovery is the last point at which a channel can be dropped for free.
    Everything after it costs something: `get_channels_data` and
    `get_videos_data` each spend YouTube API quota, and `get_recent_video_ids`
    spends a scrape (and the pacing delay that goes with it, which is most of a
    run's wall clock). So both "we already have this" and "we already rejected
    this" are answered HERE, in two indexed lookups against the local store,
    rather than being discovered further down by a fetch that has already been
    paid for.

    `force_refetch` is the one thing that puts a known channel back in `fresh`.
    It is set by `--refetch` and by the app's refresh action, and it means a
    person has deliberately asked for current data about a channel this
    function would otherwise be skipping — the whole point of the flag.

    A channel in BOTH tables counts as archived: `apply_remote_archive` deletes
    the local channel row when it applies a tombstone, so the overlap only
    exists in the window between a teammate archiving a channel and this
    machine's next pull, and the archive is the newer decision.
    """
    if not discovered:
        return {}, {}, {}

    ids = list(discovered.values())
    placeholders = ",".join("?" * len(ids))

    archived_ids = {
        r["channel_id"]
        for r in conn.execute(
            f"SELECT channel_id FROM channel_archive WHERE channel_id IN ({placeholders})",
            ids,
        ).fetchall()
    }
    known_ids = {
        r["channel_id"]
        for r in conn.execute(
            f"SELECT channel_id FROM channels WHERE channel_id IN ({placeholders}) "
            f"AND force_refetch=0",
            ids,
        ).fetchall()
    } - archived_ids

    fresh, known, archived = {}, {}, {}
    for handle, channel_id in discovered.items():
        if channel_id in archived_ids:
            archived[handle] = channel_id
        elif channel_id in known_ids:
            known[handle] = channel_id
        else:
            fresh[handle] = channel_id
    return fresh, known, archived


def record_keyword_links(conn, discovered, keyword):
    """Associates already-known channels with the keyword that just re-found them.

    The one thing still worth recording about a channel `partition_discovered`
    sent to `known`. A channel legitimately surfaces under several keywords, and
    `Influencer.sourceKeywords` is the accumulated list of all of them — dropping
    the link would make a keyword's results look narrower than they are and would
    quietly lose the attribution that says *why* a channel is in the database.

    It is also free, which is the whole reason it survives the skip: this is one
    local INSERT OR IGNORE per channel and no network and no API call. Nothing
    here fetches anything.
    """
    if not discovered:
        return
    now = _now()
    conn.executemany(
        "INSERT OR IGNORE INTO channel_keywords (channel_id, keyword, discovered_at) "
        "VALUES (?, ?, ?)",
        [(channel_id, keyword, now) for channel_id in discovered.values()],
    )
    conn.commit()


def record_archive_keyword_links(conn, discovered, keyword, handles_limit=None):
    """The `record_keyword_links` of the `archived` bucket: attach this keyword to
    the channels it re-found that the team has already rejected.

    Same reason as the live case — a search term is judged on everything it
    surfaces, and a keyword that keeps dragging in channels the team archives is
    exactly what the Keyword Evaluation card exists to show. But an archived
    channel has no `channels` row, and `channel_keywords.channel_id` is a foreign
    key to it, so the link cannot live there. The archive keeps its keyword
    attribution in the `found_via` JSON on the tombstone instead
    (`[{"keyword", "limit", "discovered_at"}, ...]`), and this appends to it.

    Two writes, both local and both cheap:
      * the tombstone's own `found_via`, deduped by keyword, so a machine reading
        its local store (or running `--no-sync`) is right immediately. NOT
        `archived_at` — moving that would rewrite when the channel was archived.
      * a row in `archive_keyword_pending`, which is what still owes Supabase the
        note. `sync.push_archive_keyword_notes` drains it.

    Returns the number of (channel, keyword) notes actually added — a keyword
    already on a tombstone is skipped and not re-queued.
    """
    if not discovered:
        return 0
    now = _now()
    added = 0
    for channel_id in discovered.values():
        row = conn.execute(
            "SELECT found_via FROM channel_archive WHERE channel_id=?",
            (channel_id,),
        ).fetchone()
        if row is None:
            # Not actually archived here (a race with a concurrent un-archive) —
            # nothing to attach a keyword to.
            continue
        try:
            entries = json.loads(row["found_via"]) if row["found_via"] else []
            if not isinstance(entries, list):
                entries = []
        except (TypeError, ValueError):
            entries = []
        if any(isinstance(e, dict) and e.get("keyword") == keyword for e in entries):
            continue
        entries.append({
            "keyword": keyword,
            "limit": handles_limit,
            "discovered_at": now,
        })
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


def get_archive_keyword_pending(conn):
    """The archive-keyword notes still owed to Supabase — see
    `record_archive_keyword_links`. Rows are cleared by
    `clear_archive_keyword_pending` once the RPC has taken each one."""
    rows = conn.execute("SELECT * FROM archive_keyword_pending").fetchall()
    return [dict(r) for r in rows]


def clear_archive_keyword_pending(conn, channel_id, keyword):
    conn.execute(
        "DELETE FROM archive_keyword_pending WHERE channel_id=? AND keyword=?",
        (channel_id, keyword),
    )
    conn.commit()


def get_channels_to_fetch(conn, discovered):
    """discovered: {handle: channel_id}. Returns the subset never fetched before,
    or explicitly flagged via a manual force_refetch."""
    if not discovered:
        return {}
    ids = list(discovered.values())
    placeholders = ",".join("?" * len(ids))
    rows = conn.execute(
        f"SELECT channel_id FROM channels WHERE channel_id IN ({placeholders}) "
        f"AND last_fetched_at IS NOT NULL AND force_refetch=0",
        ids,
    ).fetchall()
    already_fresh = {r["channel_id"] for r in rows}
    return {h: cid for h, cid in discovered.items() if cid not in already_fresh}


def save_channels(conn, channel_info_by_handle, channel_batch):
    """channel_batch: {handle: channel_id} that was requested from the API.
    channel_info_by_handle: {handle: data} for the ones the API actually returned --
    anything requested but missing from the response is marked last_fetch_status='failed'
    rather than silently dropped."""
    now = _now()
    for handle, channel_id in channel_batch.items():
        info = channel_info_by_handle.get(handle)
        if info:
            conn.execute(
                """UPDATE channels SET
                       handle=?, name=?, description=?, subscribers=?, profile_picture=?,
                       banner=?, link=?, country=?, last_fetched_at=?, last_fetch_status='success',
                       force_refetch=0
                   WHERE channel_id=?""",
                (handle, info.get("Name"), info.get("Description"), info.get("Subscribers"),
                 info.get("Profile_Picture"), info.get("Banner"), info.get("Link"),
                 info.get("Country"), now, channel_id),
            )
        else:
            conn.execute(
                """UPDATE channels SET last_fetched_at=?, last_fetch_status='failed', force_refetch=0
                   WHERE channel_id=?""",
                (now, channel_id),
            )
    conn.commit()


def get_channel_row(conn, channel_id):
    row = conn.execute("SELECT * FROM channels WHERE channel_id=?", (channel_id,)).fetchone()
    return dict(row) if row else None


def get_channels_needing_videos(conn, discovered):
    """discovered: {handle: channel_id}. Returns the subset whose videos were never
    fetched, or are flagged for a manual force_refetch."""
    if not discovered:
        return {}
    ids = list(discovered.values())
    placeholders = ",".join("?" * len(ids))
    rows = conn.execute(
        f"SELECT channel_id FROM channels WHERE channel_id IN ({placeholders}) "
        f"AND videos_fetched_at IS NOT NULL AND force_refetch=0",
        ids,
    ).fetchall()
    already_have_videos = {r["channel_id"] for r in rows}
    return {h: cid for h, cid in discovered.items() if cid not in already_have_videos}


# How long a channel that a teammate read stays out of the backlog while
# its object has not arrived. Long enough for every machine to bootstrap;
# short enough that a channel nobody actually holds is not lost for good.
AWAITING_PEER_DAYS = 30


def _awaiting_peer_cutoff(now=None):
    stamp = now or time.time()
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(stamp - AWAITING_PEER_DAYS * 86400))


def _video_backlog_where(country_filter, now=None):
    """The predicate `get_video_backfill_candidates` and
    `count_channels_needing_videos` share, so the count a run reports and the
    slice it actually works are never answering two different questions.

    A channel waiting for a teammate's copy (`awaiting_peer_since`, set by
    the bootstrap for a channel somebody else read -- see
    `get_inherited_video_stamps`) is not in the backlog: reading it here
    would spend YouTube quota on videos that are about to arrive in the
    next pull. It rejoins the backlog only if nothing arrives within
    [AWAITING_PEER_DAYS].
    """
    where = ("((videos_fetched_at IS NULL "
             "  AND (awaiting_peer_since IS NULL OR awaiting_peer_since < ?)) "
             " OR force_refetch = 1)")
    params = [_awaiting_peer_cutoff(now)]
    if country_filter:
        where += " AND country = ?"
        params.append(country_filter)
    return where, params


def count_channels_awaiting_peers(conn, now=None):
    """Channels kept out of the backlog because a teammate is expected to
    supply their object -- reported next to the backlog so "0 missing" with
    thousands waiting is never read as "all done"."""
    row = conn.execute(
        "SELECT COUNT(*) AS n FROM channels WHERE videos_fetched_at IS NULL "
        "  AND force_refetch = 0 AND awaiting_peer_since >= ?",
        (_awaiting_peer_cutoff(now),)).fetchone()
    return row["n"] if row else 0


def get_video_backfill_candidates(conn, limit, country_filter=None):
    """Channels ANYWHERE in the local store still missing their recent
    uploads -- not only the ones the current keyword just found.

    `get_channels_needing_videos` above only ever looks at `discovered`, this
    run's own results, because `process_keyword` drops every already-`known`
    channel before it ever reaches that check (see `partition_discovered`).
    That means a channel whose video-fetch turn never came -- the run that
    found it crashed, hit `SearchBlocked`, or simply had more discovered
    channels than its time budget covered -- has no other path back: nothing
    ever revisits a channel once it stops being new. This is that path,
    worked oldest-first so the longest-waiting backlog does not get starved by
    an ever-growing front of newer discoveries.
    """
    where, params = _video_backlog_where(country_filter)
    params.append(limit)
    rows = conn.execute(
        f"SELECT channel_id, handle FROM channels WHERE {where} "
        f"ORDER BY first_seen_at ASC LIMIT ?",
        params,
    ).fetchall()
    return {r["handle"]: r["channel_id"] for r in rows}


def count_channels_needing_videos(conn, country_filter=None, now=None):
    """The size of the backlog `get_video_backfill_candidates` draws from --
    reported alongside it so a run's log shows whether the backlog is actually
    shrinking, not just that a batch of it happened to run."""
    where, params = _video_backlog_where(country_filter, now=now)
    row = conn.execute(
        f"SELECT COUNT(*) AS n FROM channels WHERE {where}", params
    ).fetchone()
    return row["n"] if row else 0


def mark_channels_videos_fetched(conn, channel_ids):
    """Stamps `videos_fetched_at` and clears `force_refetch` for every channel
    whose recent uploads were just read -- the terminal step of the video
    backfill, the way `save_channels` is for the channel-info fetch.

    Clearing `force_refetch` here is what stops a manual force-refetch (or a
    bulk one from `tools/prune_no_median.py` / `tools/unarchive_and_enrich.py`)
    from becoming permanent: `get_video_backfill_candidates` keeps a
    `force_refetch=1` row in the backlog even once it has a `videos_fetched_at`
    stamp, so a flag left set means `backfill_missing_videos` re-fetches that
    channel on every keyword and `search.py --catch-up-videos` never sees the
    backlog reach zero -- the sweep restarts from scratch every app launch and
    never finishes."""
    channel_ids = list(channel_ids)
    if not channel_ids:
        return
    now = _now()
    placeholders = ",".join("?" * len(channel_ids))
    conn.execute(
        f"UPDATE channels SET videos_fetched_at=?, force_refetch=0, "
        f"  awaiting_peer_since=NULL WHERE channel_id IN ({placeholders})",
        [now, *channel_ids],
    )
    # The stamp is what anchors the 30-day window, so the rollups are
    # recomputed in the same commit -- a channel is never left with numbers
    # from before the videos it now has.
    compute_channel_rollups(conn, channel_ids)
    conn.commit()


def force_refetch_by_handle(conn, handle):
    """Flags an already-known channel for a full refresh on its next fetch. Returns its
    channel_id, or None if this handle has never been discovered before (caller should
    resolve it directly via the API in that case)."""
    conn.execute(
        "UPDATE channels SET force_refetch=1, videos_fetched_at=NULL WHERE handle=?",
        (handle,),
    )
    conn.commit()
    row = conn.execute("SELECT channel_id FROM channels WHERE handle=?", (handle,)).fetchone()
    return row["channel_id"] if row else None


# ==========================================
# VIDEOS
# ==========================================

def save_videos(conn, video_info_by_id, video_batch, video_id_to_channel_id):
    """video_batch: the list of video_ids requested. video_info_by_id: {video_id: data}
    for the ones the API actually returned -- missing ones are marked failed."""
    now = _now()
    for vid in video_batch:
        info = video_info_by_id.get(vid)
        channel_id = video_id_to_channel_id.get(vid)
        if info:
            conn.execute(
                """INSERT INTO videos (video_id, channel_id, title, description, thumbnail, tags,
                                        published_at, view_count, last_fetched_at, last_fetch_status)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'success')
                   ON CONFLICT(video_id) DO UPDATE SET
                       title=excluded.title, description=excluded.description,
                       thumbnail=excluded.thumbnail, tags=excluded.tags,
                       published_at=excluded.published_at, view_count=excluded.view_count,
                       last_fetched_at=excluded.last_fetched_at, last_fetch_status='success'""",
                (vid, channel_id, info.get("Title"), info.get("Description"), info.get("Thumbnail"),
                 json.dumps(info.get("Tags", [])), info.get("PublishedAt"), info.get("ViewCount"), now),
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


# ==========================================
# RUN PROGRESS (what other systems poll instead of waiting for the whole run)
# ==========================================

def start_run(conn, keywords_total, kind="search"):
    """Opens a `runs` row. [kind] says which job this is -- see the column's
    own comment in SCHEMA: the app shows the newest row as "what the pipeline
    is doing", and only a 'search' should be reported as one."""
    cur = conn.execute(
        "INSERT INTO runs (started_at, keywords_total, pid, kind) "
        "VALUES (?, ?, ?, ?)",
        (_now(), keywords_total, os.getpid(), kind),
    )
    conn.commit()
    return cur.lastrowid


def _process_alive(pid):
    """Whether a process with this id is still running on this machine.

    A recycled pid reads as alive, which is the safe way to be wrong here:
    `reconcile_stale_runs` then leaves a row alone that it could have closed,
    rather than declaring a live run dead.
    """
    if not pid or pid <= 0:
        return False
    if sys.platform == "win32":
        import ctypes
        # PROCESS_QUERY_LIMITED_INFORMATION -- granted for our own processes
        # without elevation, unlike PROCESS_QUERY_INFORMATION.
        handle = ctypes.windll.kernel32.OpenProcess(0x1000, False, int(pid))
        if not handle:
            return False
        ctypes.windll.kernel32.CloseHandle(handle)
        return True
    try:
        os.kill(int(pid), 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        # Alive, just not ours to signal.
        return True
    except OSError:
        return False
    return True


def reconcile_stale_runs(conn):
    """Closes out `runs` rows left saying `running` by a process that is gone.

    `finish_run` is the only thing that ever moves a row off `running`, and it
    runs inside the interpreter -- so a run whose process is *killed* (the app
    closed mid-run, the machine shut down, Stop on Windows, which terminates
    rather than delivering a real console interrupt) leaves its row claiming to
    be running forever. Nothing else ever writes that row again.

    That is not a cosmetic leftover. The Flutter app falls back to this table
    whenever it has no live process of its own -- every app launch -- and a row
    still marked `running` is rendered as a live run with no keyword yet, i.e.
    "Starting the pipeline...", with a spinner, indefinitely, on a machine
    where nothing is running at all. It cannot clear itself.

    So every `search.py` startup (including the background `--pull-only` the
    app fires as it opens) sweeps them here, which is what makes the fix
    self-healing rather than something a person has to notice.

    Rows are only closed when their process is provably gone -- see
    [_process_alive]. A run genuinely in flight in another interpreter, or one
    somebody started by hand, is left exactly as it is. Rows written before
    `pid` existed have nothing to check and are treated as stale, which they
    are: they predate this process by at least one release.

    Returns how many rows were closed.
    """
    try:
        rows = conn.execute(
            "SELECT run_id, pid FROM runs WHERE status='running'"
        ).fetchall()
    except sqlite3.OperationalError:
        # A database written before the `pid` column existed and not yet
        # migrated. Nothing to do rather than a failed startup.
        return 0

    mine = os.getpid()
    stale = [
        row["run_id"]
        for row in rows
        if row["pid"] != mine and not _process_alive(row["pid"])
    ]
    for run_id in stale:
        finish_run(conn, run_id, status="interrupted")
    return len(stale)


def update_run_progress(conn, run_id, keywords_done=None, channels_delta=0, videos_delta=0):
    conn.execute(
        """UPDATE runs SET
               keywords_done = COALESCE(?, keywords_done),
               channels_upserted = channels_upserted + ?,
               videos_upserted = videos_upserted + ?
           WHERE run_id=?""",
        (keywords_done, channels_delta, videos_delta, run_id),
    )
    conn.commit()


def finish_run(conn, run_id, status="done"):
    conn.execute(
        "UPDATE runs SET status=?, finished_at=? WHERE run_id=?",
        (status, _now(), run_id),
    )
    conn.commit()


def get_run(conn, run_id):
    """One run's current row. Read by the app off this file (WAL mode) to
    show live progress; never shared -- a run is a fact about this machine."""
    row = conn.execute("SELECT * FROM runs WHERE run_id=?", (run_id,)).fetchone()
    return dict(row) if row else None


def get_progress(conn):
    """One-stop snapshot for any external process to poll -- safe to call while a run
    is in progress thanks to WAL mode."""
    keyword_counts = {
        r["status"]: r["n"]
        for r in conn.execute("SELECT status, COUNT(*) as n FROM keywords GROUP BY status").fetchall()
    }
    channels_total = conn.execute("SELECT COUNT(*) as n FROM channels").fetchone()["n"]
    videos_total = conn.execute("SELECT COUNT(*) as n FROM videos").fetchone()["n"]
    current_run = conn.execute("SELECT * FROM runs ORDER BY run_id DESC LIMIT 1").fetchone()
    return {
        "keywords": keyword_counts,
        "channels_total": channels_total,
        "videos_total": videos_total,
        "current_run": dict(current_run) if current_run else None,
    }


# ==========================================
# SYNC SUPPORT (push local changes to / pull shared state from a PocketBase backend
# via sync.py -- kept here so all raw SQL stays in one module)
# ==========================================

EPOCH = "0000-00-00T00:00:00Z"  # ISO strings sort correctly, so this always compares "before everything"


# The `sync_state` row that records when `sync.pull_catalog` last finished
# (the freshness window). Named with a prefix no real table can have so it can
# never collide with one. What this machine still has to ANNOUNCE is not a
# cursor at all: every announceable row carries its own flag (see
# `channel_keywords.announced`).
PULL_CURSOR = "__pull_all"
# Set once `sync.bootstrap` has run to completion on this store. Until it
# has, the app's background pull runs the bootstrap instead of a plain pull
# -- so a teammate who only ever installs the build still contributes the
# channels their machine read.
BOOTSTRAP_CURSOR = "__r2_bootstrapped"


def get_sync_cursor(conn, collection):
    row = conn.execute("SELECT last_pushed_at FROM sync_state WHERE collection=?", (collection,)).fetchone()
    return row["last_pushed_at"] if row else EPOCH


def is_bootstrapped(conn):
    """Whether `sync.bootstrap` has run to completion on this store.

    Its own function because the cursor reads as [EPOCH], not None, when it
    was never set -- and a check written as `is None` is what let every
    store skip the bootstrap the app was supposed to run for it.
    """
    return get_sync_cursor(conn, BOOTSTRAP_CURSOR) not in (None, EPOCH, "")


def set_sync_cursor(conn, collection, ts):
    conn.execute(
        "INSERT INTO sync_state (collection, last_pushed_at) VALUES (?, ?) "
        "ON CONFLICT(collection) DO UPDATE SET last_pushed_at=excluded.last_pushed_at",
        (collection, ts),
    )
    conn.commit()


def get_keyword(conn, keyword):
    row = conn.execute("SELECT * FROM keywords WHERE keyword=?", (keyword,)).fetchone()
    return dict(row) if row else None


def get_unannounced_archives(conn):
    """Tombstones this machine decided on (the auto-clean gate, the app's
    sweep) that no catalog segment has named yet. Pre-migration rows have a
    NULL `source` and count as local."""
    rows = conn.execute(
        "SELECT * FROM channel_archive WHERE announced=0 AND source IS NOT 'remote'"
    ).fetchall()
    return [dict(r) for r in rows]


def mark_archives_announced(conn, channel_ids):
    channel_ids = list(channel_ids)
    if channel_ids:
        placeholders = ",".join("?" * len(channel_ids))
        conn.execute(
            f"UPDATE channel_archive SET announced=1 WHERE channel_id IN ({placeholders})",
            channel_ids)


def apply_remote_keyword(conn, rec):
    """Merges one remote `keywords` record into the local DB (pull side).
    Last-write-wins by design -- see sync.py's module docstring for what that
    does and doesn't guarantee for the keyword-claim race."""
    settings_val = rec.get("search_settings")
    if isinstance(settings_val, (dict, list)):
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
           -- A keyword this machine is working right now, or finished after the
           -- remote row was written, keeps its own state: the remote row is
           -- older news.
           WHERE COALESCE(keywords.completed_at, keywords.started_at, '')
                 <= COALESCE(excluded.completed_at, excluded.started_at, '')""",
        (rec["keyword"], rec.get("status", "pending"), rec.get("added_at", _now()),
         rec.get("started_at"), rec.get("completed_at"), rec.get("channels_found", 0),
         rec.get("claimed_by"), settings_val),
    )


def apply_remote_archive(conn, rec):
    """Mirrors one Supabase `channel_archive` row locally.

    Also removes the channel itself if this machine still holds it: the sweep
    deleted it centrally, and a local copy that survived would keep being pushed
    back up on the next sync. Deleting the videos with it is the point -- that
    is where the storage the archive exists to reclaim actually sits.

    `subscribers` and `found_at` are copied across even though nothing local
    reads them off a mirrored row: `get_unannounced_archives` already keeps
    these rows out of the push, but if one ever does go back up (a machine that
    pulled a teammate's fresh archive before its own next push) `_archive_out`
    would otherwise send them as NULL and blank the real values on Supabase.
    """
    found_via = rec.get("found_via")
    if isinstance(found_via, (dict, list)):
        found_via = json.dumps(found_via)
    subscribers = rec.get("subscribers")
    median = rec.get("median_views_last_30")
    videos_found = rec.get("videos_found_count")
    channel_id = rec.get("channel_id")
    # What THIS machine can see, read before the deletes below take it away.
    # The sweep runs on whichever machine's tick comes round first, and that is
    # often one that pulled the channel from the catalog and never downloaded
    # its videos -- so the tombstone arriving here may carry nothing while this
    # machine is holding the very rows it was supposed to have been measured
    # from. Measuring now is the last moment anyone can.
    mine = measure_archive_numbers(conn, channel_id)
    conn.execute(
        "INSERT INTO channel_archive "
        "(channel_id, handle, label, archived_at, subscribers, found_at, "
        " found_via, source, announced, median_views_last_30, median_basis, "
        " videos_found_count) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, 'remote', 1, ?, ?, ?) "
        # The identity of the row -- who it is and what was decided about it --
        # is the sender's to state. Its numbers are not: they belong to
        # whichever machine held the videos, and this was an INSERT OR REPLACE
        # that blanked them every time a tombstone written without them came
        # round. They go through the merge instead, which cannot lose one.
        "ON CONFLICT(channel_id) DO UPDATE SET "
        "  handle=excluded.handle, label=excluded.label, "
        "  archived_at=excluded.archived_at, subscribers=excluded.subscribers, "
        "  found_at=excluded.found_at, found_via=excluded.found_via, "
        "  source='remote', announced=1",
        (channel_id, rec.get("handle"), rec.get("label"),
         rec.get("archived_at"),
         str(subscribers) if subscribers is not None else None,
         rec.get("found_at"), found_via,
         int(median) if isinstance(median, (int, float)) else None,
         rec.get("median_basis"),
         int(videos_found) if isinstance(videos_found, (int, float)) else None),
    )
    merge_archive_numbers(
        conn, channel_id,
        int(median) if isinstance(median, (int, float)) else None,
        rec.get("median_basis"),
        int(videos_found) if isinstance(videos_found, (int, float)) else None,
        announce=False)
    # Only now, and only if this machine turned out to know more, is there
    # anything of our own to say back.
    merge_archive_numbers(conn, channel_id, *mine)
    conn.execute("DELETE FROM videos WHERE channel_id=?", (channel_id,))
    conn.execute("DELETE FROM channel_keywords WHERE channel_id=?", (channel_id,))
    conn.execute("DELETE FROM channels WHERE channel_id=?", (channel_id,))


def apply_remote_channel_keyword(conn, rec):
    """A keyword link learned from another machine's segment. Skipped when the
    channel is not here (archived, or not yet applied): the link's foreign key
    needs the row, and a link to an archived channel lives on its tombstone's
    `found_via` instead."""
    conn.execute(
        "INSERT OR IGNORE INTO channel_keywords (channel_id, keyword, discovered_at, source, announced) "
        "SELECT ?, ?, ?, 'remote', 1 WHERE EXISTS (SELECT 1 FROM channels WHERE channel_id=?)",
        (rec["channel_id"], rec["keyword"], rec.get("discovered_at") or _now(),
         rec["channel_id"]),
    )



# ==========================================
# ROLLUPS (derived here, on every machine, never shared)
# ==========================================

ROLLUP_WINDOW_DAYS = 30


def compute_channel_rollups(conn, channel_ids=None):
    """Recomputes `videos_last_30`, `median_views_last_30` and
    `latest_upload_at` from the local `videos` rows -- for [channel_ids], or
    for every channel when None.

    A port of the Postgres `refresh_channel_video_rollups` that used to run as
    a trigger on the shared database. The window is measured back from
    `COALESCE(videos_fetched_at, last_fetched_at)`, not from now(): a channel
    nobody refetches holds the numbers it had when we last looked, rather than
    sliding to zero and reading as abandoned. The median is the 50th
    percentile of per-video view counts over that window, nulls excluded (a
    video with no count is not a video with zero views); the count includes
    every video in the window, counted or not. Does not commit -- callers
    already hold a transaction they are about to commit.
    """
    if channel_ids is not None:
        channel_ids = list(channel_ids)
        if not channel_ids:
            return 0
        placeholders = ",".join("?" * len(channel_ids))
        where, params = f"WHERE channel_id IN ({placeholders})", channel_ids
    else:
        where, params = "", []
    rows = conn.execute(
        f"SELECT channel_id, COALESCE(videos_fetched_at, last_fetched_at) AS anchor "
        f"FROM channels {where}", params,
    ).fetchall()

    written = 0
    for row in rows:
        anchor = row["anchor"]
        count, median, latest = 0, None, None
        if anchor:
            # ISO-8601 strings compare correctly as text, so the window is a
            # plain string comparison; `datetime(anchor, '-30 days')` gives the
            # start in the same `YYYY-MM-DDTHH:MM:SS` shape the rows carry.
            videos = conn.execute(
                "SELECT view_count, published_at FROM videos "
                "WHERE channel_id=? AND published_at IS NOT NULL AND published_at <> '' "
                "  AND published_at > strftime('%Y-%m-%dT%H:%M:%SZ', datetime(?, ?))",
                (row["channel_id"], anchor, f"-{ROLLUP_WINDOW_DAYS} days"),
            ).fetchall()
            count = len(videos)
            counted = sorted(
                v for v in (_int_or_none(x["view_count"]) for x in videos)
                if v is not None)
            if counted:
                mid = len(counted) // 2
                median = (counted[mid] if len(counted) % 2
                          else (counted[mid - 1] + counted[mid]) // 2)
            latest = max((x["published_at"] for x in videos), default=None)
        cur = conn.execute(
            "UPDATE channels SET videos_last_30=?, median_views_last_30=?, latest_upload_at=? "
            "WHERE channel_id=? AND (videos_last_30 IS NOT ? OR median_views_last_30 IS NOT ? "
            "                         OR latest_upload_at IS NOT ?)",
            (count, median, latest, row["channel_id"], count, median, latest),
        )
        written += cur.rowcount
    return written


def get_channel_video_descriptions(conn, channel_ids):
    """{channel_id: [description, ...]} for every stored video row -- failed
    fetches included, as `None`, since a row with no description is still a
    stored video and belongs in the denominator. What
    `gratovo.pipeline.compute_channel_sponsorship` scans for sponsorship
    signals; kept here rather than in pipeline.py because it is a plain read
    of this table, the same split `compute_channel_rollups` above draws.
    """
    channel_ids = list(channel_ids)
    if not channel_ids:
        return {}
    placeholders = ",".join("?" * len(channel_ids))
    rows = conn.execute(
        f"SELECT channel_id, description FROM videos WHERE channel_id IN ({placeholders})",
        channel_ids,
    ).fetchall()
    result = {cid: [] for cid in channel_ids}
    for row in rows:
        result.setdefault(row["channel_id"], []).append(row["description"])
    return result


def latest_video(conn, channel_id):
    """The channel's newest stored video (id, title, published_at), or None."""
    return conn.execute(
        "SELECT video_id, title, published_at FROM videos WHERE channel_id = ? "
        "AND video_id IS NOT NULL ORDER BY published_at DESC LIMIT 1",
        (channel_id,),
    ).fetchone()


def get_video_transcript(conn, video_id):
    return conn.execute(
        "SELECT * FROM video_transcripts WHERE video_id = ?", (video_id,)).fetchone()


def save_video_transcript(conn, video_id, channel_id, fetched):
    """Keeps what `tools/transcript.fetch` returned for [video_id] -- the
    subtitles, or why there were none. Commits."""
    asr = fetched.get("is_asr")
    conn.execute(
        "INSERT OR REPLACE INTO video_transcripts (video_id, channel_id, fetched_at, "
        "is_asr, transcript, timed_transcript, error) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (video_id, channel_id, _now(), None if asr is None else int(bool(asr)),
         fetched.get("transcript"), fetched.get("timed_transcript"), fetched.get("error")),
    )
    conn.commit()


def save_video_moments(conn, video_id, moments):
    """Keeps the moments read from [video_id]'s subtitles. Commits."""
    conn.execute(
        "UPDATE video_transcripts SET moments = ?, moments_at = ? WHERE video_id = ?",
        (json.dumps(list(moments), ensure_ascii=False), _now(), video_id),
    )
    conn.commit()


def get_channel_about_texts(conn, channel_ids):
    """{channel_id: About text (or None)} -- the other half of what
    `gratovo.pipeline.derive_channel_signals` reads for found emails."""
    channel_ids = list(channel_ids)
    if not channel_ids:
        return {}
    placeholders = ",".join("?" * len(channel_ids))
    rows = conn.execute(
        f"SELECT channel_id, description FROM channels WHERE channel_id IN ({placeholders})",
        channel_ids,
    ).fetchall()
    return {row["channel_id"]: row["description"] for row in rows}


def update_channel_found_emails(conn, channel_id, emails):
    """Writes `channels.found_emails` for one channel, JSON-encoded. Does not
    commit, like `update_channel_sponsorship`."""
    conn.execute(
        "UPDATE channels SET found_emails=? WHERE channel_id=?",
        (json.dumps(list(emails or [])), channel_id),
    )


def all_channel_ids(conn):
    """Every channel this machine holds, oldest first -- for the one-off
    backfill of derived columns."""
    return [row["channel_id"] for row in
            conn.execute("SELECT channel_id FROM channels ORDER BY first_seen_at, channel_id")]


def update_channel_sponsorship(conn, channel_id, sponsored_ratio, seen_brands):
    """Writes the two sponsorship-detection columns for one channel.
    [seen_brands] is a plain list, JSON-encoded here the same way
    `videos.tags` is. Does not commit -- callers already hold a transaction
    they are about to commit (mirrors `compute_channel_rollups`)."""
    conn.execute(
        "UPDATE channels SET sponsored_ratio=?, seen_brands=? WHERE channel_id=?",
        (sponsored_ratio, json.dumps(list(seen_brands or [])), channel_id),
    )


def _int_or_none(value):
    if value is None:
        return None
    text = str(value).replace(",", "").strip()
    if not text:
        return None
    try:
        return int(float(text))
    except ValueError:
        return None


# ==========================================
# R2: the per-channel blob
# ==========================================
# One object per channel, `channels/<channel_id>.json.zst`, holding the channel's
# scraped details and every one of its stored videos. Written by whichever
# machine finished the channel's video pass, read by every machine that has
# not. Nothing derived and nothing typed-in goes in it -- see sync.py.

BLOB_SCHEMA = 1


def get_blob_upload_candidates(conn, limit=None):
    """Channels this machine has fully read (a stamped video pass) and whose
    current version has not been uploaded yet -- or was uploaded before the
    stamp last moved. A version this machine merely downloaded and applied is
    not a candidate: it is already in the bucket."""
    sql = ("SELECT channel_id, handle, videos_fetched_at FROM channels "
           "WHERE videos_fetched_at IS NOT NULL "
           "  AND (blob_uploaded_at IS NULL OR blob_uploaded_at < videos_fetched_at) "
           "  AND (blob_applied_version IS NULL OR blob_applied_version < videos_fetched_at) "
           "ORDER BY videos_fetched_at")
    params = []
    if limit:
        sql += " LIMIT ?"
        params.append(limit)
    return [dict(r) for r in conn.execute(sql, params).fetchall()]


def build_channel_blob(conn, channel_id):
    """The object body for one channel, as a plain dict (the caller encodes
    and compresses it). None if the channel is not here."""
    row = conn.execute("SELECT * FROM channels WHERE channel_id=?", (channel_id,)).fetchone()
    if row is None:
        return None
    channel = {k: row[k] for k in (
        "channel_id", "handle", "name", "description", "subscribers",
        "profile_picture", "banner", "link", "country", "first_seen_at",
        "last_fetched_at", "videos_fetched_at")}
    videos, failed = [], []
    for v in conn.execute(
            "SELECT * FROM videos WHERE channel_id=? ORDER BY published_at DESC, video_id",
            (channel_id,)).fetchall():
        if v["last_fetch_status"] == "failed":
            failed.append(v["video_id"])
            continue
        tags = v["tags"]
        try:
            tags = json.loads(tags) if isinstance(tags, str) and tags else (tags or [])
        except ValueError:
            tags = []
        videos.append({
            "video_id": v["video_id"], "title": v["title"],
            "description": v["description"], "thumbnail": v["thumbnail"],
            "tags": tags, "published_at": v["published_at"],
            "view_count": v["view_count"], "last_fetched_at": v["last_fetched_at"],
        })
    return {"v": BLOB_SCHEMA, "channel": channel, "videos": videos,
            "failed_video_ids": failed}


def mark_blob_uploaded(conn, channel_id, version):
    conn.execute(
        "UPDATE channels SET blob_uploaded_at=?, "
        "  blob_version=MAX(COALESCE(blob_version, ''), ?) WHERE channel_id=?",
        (version, version, channel_id),
    )
    conn.commit()


def get_blob_download_candidates(conn, limit=None):
    """Channels the catalog says have a newer object than anything this
    machine has applied or uploaded itself."""
    sql = ("SELECT channel_id, blob_version FROM channels "
           "WHERE blob_version IS NOT NULL "
           "  AND blob_version > COALESCE(blob_applied_version, blob_uploaded_at, '') "
           "ORDER BY first_seen_at")
    params = []
    if limit:
        sql += " LIMIT ?"
        params.append(limit)
    return [dict(r) for r in conn.execute(sql, params).fetchall()]


def apply_channel_blob(conn, blob, version):
    """Writes one downloaded object into the local store: the channel's
    details, its full video set (replacing whatever was here), and the
    rollups. Commits.

    Skipped, returning False, when this machine's own scrape of the channel
    is at least as fresh -- the object is then older news than what is here.

    "At least as fresh" is strict for a normal object and inclusive for an
    empty one: an object carrying no videos at the very same stamp as the
    videos held here is not a newer read, it is the same read seen from a
    machine that never had the videos (the old shared database stamped
    every machine; the videos stayed where they were read). Replacing rows
    with nothing on the strength of it is how a store loses what only it
    had. A genuinely newer empty read -- the channel took everything down
    -- has a later stamp and replaces as before.
    """
    channel = blob.get("channel") or {}
    channel_id = channel.get("channel_id")
    if not channel_id:
        return False
    row = conn.execute(
        "SELECT videos_fetched_at, first_seen_at, "
        "  EXISTS (SELECT 1 FROM videos v WHERE v.channel_id = channels.channel_id) AS has_videos "
        "FROM channels WHERE channel_id=?",
        (channel_id,)).fetchone()
    local_stamp = row["videos_fetched_at"] if row else None
    remote_stamp = channel.get("videos_fetched_at") or ""
    has_videos = bool(row and row["has_videos"])
    object_is_empty = not (blob.get("videos") or blob.get("failed_video_ids"))
    if local_stamp and (local_stamp > remote_stamp
                        or (object_is_empty and has_videos and local_stamp == remote_stamp)):
        conn.execute("UPDATE channels SET blob_applied_version=? WHERE channel_id=?",
                     (version, channel_id))
        conn.commit()
        return False

    first_seen = channel.get("first_seen_at") or _now()
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
        (channel_id, channel.get("handle") or "", channel.get("name"),
         channel.get("description"), channel.get("subscribers"),
         channel.get("profile_picture"), channel.get("banner"), channel.get("link"),
         channel.get("country"), first_seen, channel.get("last_fetched_at"),
         channel.get("videos_fetched_at"), version, version, _now()),
    )
    conn.execute("DELETE FROM videos WHERE channel_id=?", (channel_id,))
    now = _now()
    conn.executemany(
        """INSERT OR REPLACE INTO videos (video_id, channel_id, title, description, thumbnail,
                                          tags, published_at, view_count, last_fetched_at,
                                          last_fetch_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'success')""",
        [(v.get("video_id"), channel_id, v.get("title"), v.get("description"),
          v.get("thumbnail"), json.dumps(v.get("tags") or []), v.get("published_at"),
          v.get("view_count"), v.get("last_fetched_at") or now)
         for v in blob.get("videos") or [] if v.get("video_id")],
    )
    conn.executemany(
        """INSERT OR REPLACE INTO videos (video_id, channel_id, last_fetched_at, last_fetch_status)
           VALUES (?, ?, ?, 'failed')""",
        [(vid, channel_id, now) for vid in blob.get("failed_video_ids") or []],
    )
    compute_channel_rollups(conn, [channel_id])
    conn.commit()
    return True


# ==========================================
# R2: the catalog log
# ==========================================
# What this machine still has to announce (the write side), and how another
# machine's announcements are applied (the read side). Every op is idempotent:
# applying a segment twice is harmless, which is what makes a crash between
# "applied" and "recorded as applied" safe.

def get_applied_segments(conn):
    return {r["key"] for r in conn.execute("SELECT key FROM _applied_segments").fetchall()}


def mark_segment_applied(conn, key):
    conn.execute("INSERT OR IGNORE INTO _applied_segments (key, applied_at) VALUES (?, ?)",
                 (key, _now()))


def get_unannounced_channels(conn, limit=None):
    """Channels this machine found (its own scrape: `last_fetched_at` set)
    that no catalog segment has named yet. The thin shape the `found` op
    carries -- no description, no banner, nothing derived."""
    sql = ("SELECT channel_id, handle, name, profile_picture, subscribers, country, "
           "       first_seen_at, videos_fetched_at, blob_uploaded_at "
           "FROM channels WHERE announced_at IS NULL AND last_fetched_at IS NOT NULL "
           "ORDER BY first_seen_at")
    params = []
    if limit:
        sql += " LIMIT ?"
        params.append(limit)
    return [dict(r) for r in conn.execute(sql, params).fetchall()]


def mark_channels_announced(conn, channel_ids, stamp):
    channel_ids = list(channel_ids)
    if not channel_ids:
        return
    placeholders = ",".join("?" * len(channel_ids))
    conn.execute(
        f"UPDATE channels SET announced_at=? WHERE channel_id IN ({placeholders})",
        [stamp, *channel_ids])


def get_unannounced_blobs(conn):
    """Channels already announced whose object this machine has since
    uploaded at a version the catalog does not name yet -- a re-fetch, a
    backfill, a repaired video -- so other machines learn there is a newer
    version to download."""
    rows = conn.execute(
        "SELECT channel_id, blob_uploaded_at FROM channels "
        "WHERE announced_at IS NOT NULL AND blob_uploaded_at IS NOT NULL "
        "  AND blob_uploaded_at > COALESCE(blob_announced_version, '')").fetchall()
    return [dict(r) for r in rows]


def mark_blobs_announced(conn, versions):
    """[versions]: {channel_id: version} just written to a segment."""
    conn.executemany(
        "UPDATE channels SET blob_announced_version=? WHERE channel_id=?",
        [(v, cid) for cid, v in versions.items()])


def get_unannounced_links(conn):
    rows = conn.execute(
        "SELECT channel_id, keyword, discovered_at FROM channel_keywords "
        "WHERE source='local' AND announced=0").fetchall()
    return [dict(r) for r in rows]


def mark_links_announced(conn, links):
    """[links]: iterable of (channel_id, keyword)."""
    conn.executemany(
        "UPDATE channel_keywords SET announced=1 WHERE channel_id=? AND keyword=?",
        [(cid, kw) for cid, kw in links])


def get_dirty_keywords(conn):
    rows = conn.execute(
        "SELECT * FROM keywords WHERE source='local' AND dirty=1").fetchall()
    return [dict(r) for r in rows]


def mark_keywords_announced(conn, keywords):
    conn.executemany("UPDATE keywords SET dirty=0 WHERE keyword=?",
                     [(kw,) for kw in keywords])


def reclaim_pre_catalog_rows(conn):
    """The one-time hand-over from the old shared database to the catalog.

    Rows this machine pulled from Supabase in the old days are marked
    `source='remote'` -- and, because the `announced` flags came later, are
    also unannounced. That combination can mean only one thing now that the
    shared table is gone: nobody speaks for these rows in the catalog. So
    this machine does. Rows the catalog itself delivered are always applied
    as announced (`apply_remote_archive`, `apply_remote_channel_keyword`,
    `apply_remote_keyword`), so none of those is touched.

    Returns {table: rows reclaimed}.
    """
    counts = {}
    cur = conn.execute(
        "UPDATE channel_archive SET source='local' WHERE source='remote' AND announced=0")
    counts["channel_archive"] = cur.rowcount
    cur = conn.execute(
        "UPDATE channel_keywords SET source='local' WHERE source='remote' AND announced=0")
    counts["channel_keywords"] = cur.rowcount
    cur = conn.execute(
        "UPDATE keywords SET source='local' WHERE source='remote' AND dirty=1")
    counts["keywords"] = cur.rowcount
    return counts


def get_inherited_video_stamps(conn):
    """Channels stamped as read whose videos are not here: `videos_fetched_at`
    set, no object ever applied from the catalog, and not one row in
    `videos`. The stamp is inherited -- the old shared `channels` table
    carried it, the videos behind it were only ever pulled on request -- and
    the machine that read the channel is another one. Returns
    [{channel_id, blob_uploaded_at}].

    A channel that really has no uploads looks the same after a pass, which
    is why this is only consulted by the bootstrap: for those few the cost
    is one more read, for the many the alternative is an empty object in
    the bucket stamped with the real read time, which the machine holding
    the videos would then leave alone as "already current".
    """
    rows = conn.execute(
        "SELECT channel_id, blob_uploaded_at FROM channels "
        "WHERE videos_fetched_at IS NOT NULL AND blob_applied_version IS NULL "
        "  AND NOT EXISTS (SELECT 1 FROM videos v WHERE v.channel_id = channels.channel_id)"
    ).fetchall()
    return [dict(r) for r in rows]


def clear_video_stamps(conn, channel_ids):
    """Takes the inherited stamp off: no stamp, no object bookkeeping, no
    rollups. The row itself, its links and its announcement stay --
    teammates still know the channel exists. The channel is NOT put in the
    backlog: `awaiting_peer_since` keeps it out until the machine that read
    it shares its object (`apply_channel_blob` clears the wait) or
    `AWAITING_PEER_DAYS` pass with nothing arriving."""
    channel_ids = list(channel_ids)
    now = _now()
    for start in range(0, len(channel_ids), 500):
        chunk = channel_ids[start:start + 500]
        placeholders = ",".join("?" * len(chunk))
        conn.execute(
            f"UPDATE channels SET videos_fetched_at=NULL, blob_uploaded_at=NULL, "
            f"  blob_version=NULL, blob_announced_version=NULL, videos_last_30=0, "
            f"  median_views_last_30=NULL, latest_upload_at=NULL, "
            f"  awaiting_peer_since=? "
            f"WHERE channel_id IN ({placeholders})",
            [now, *chunk])


def forget_blob_version(conn, channel_id, version):
    """The catalog named [version] but the bucket has no such object. Forget
    the version rather than pretend it was applied: the next op that names
    the channel -- at that same version, once whoever holds the videos
    uploads it -- must count as news again."""
    conn.execute(
        "UPDATE channels SET blob_version=NULL WHERE channel_id=? AND blob_version=?",
        (channel_id, version))


def apply_catalog_channel(conn, ch, stamp):
    """A `found` op: a channel another machine scraped. Creates the thin row,
    or fills in the thin columns on a row this machine only ever *discovered*
    (no scrape of its own). A row this machine scraped itself keeps its own
    values; only the R2 version number is taken, so the newer object gets
    downloaded if theirs is fresher. Refused, returning False, if the channel
    is archived here -- the archive is the newer decision."""
    channel_id = ch.get("channel_id")
    if not channel_id or is_archived(conn, channel_id):
        return False
    conn.execute(
        """INSERT INTO channels (channel_id, handle, name, profile_picture, subscribers,
                                  country, first_seen_at, videos_fetched_at, blob_version,
                                  announced_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(channel_id) DO UPDATE SET
               handle=CASE WHEN channels.last_fetched_at IS NULL THEN excluded.handle ELSE channels.handle END,
               name=CASE WHEN channels.last_fetched_at IS NULL THEN excluded.name ELSE channels.name END,
               profile_picture=CASE WHEN channels.last_fetched_at IS NULL THEN excluded.profile_picture ELSE channels.profile_picture END,
               subscribers=CASE WHEN channels.last_fetched_at IS NULL THEN excluded.subscribers ELSE channels.subscribers END,
               country=CASE WHEN channels.last_fetched_at IS NULL THEN excluded.country ELSE channels.country END,
               first_seen_at=MIN(channels.first_seen_at, excluded.first_seen_at),
               videos_fetched_at=CASE WHEN channels.videos_fetched_at IS NULL
                                      THEN excluded.videos_fetched_at ELSE channels.videos_fetched_at END,
               blob_version=MAX(COALESCE(channels.blob_version, ''), COALESCE(excluded.blob_version, '')),
               announced_at=COALESCE(channels.announced_at, excluded.announced_at)""",
        (channel_id, ch.get("handle") or "", ch.get("name"), ch.get("profile_picture"),
         ch.get("subscribers"), ch.get("country"), ch.get("first_seen_at") or stamp,
         ch.get("videos_fetched_at") if ch.get("blob_version") else None,
         ch.get("blob_version") or None, stamp),
    )
    # MAX(...) with '' above can leave an empty string where both were null.
    conn.execute("UPDATE channels SET blob_version=NULL WHERE channel_id=? AND blob_version=''",
                 (channel_id,))
    return True


def apply_catalog_blob(conn, channel_id, version):
    conn.execute(
        "UPDATE channels SET blob_version=MAX(COALESCE(blob_version, ''), ?) WHERE channel_id=?",
        (version, channel_id))


def apply_catalog_archive_link(conn, channel_id, keyword, handles_limit, discovered_at):
    """An `archive_link` op: a keyword re-found a channel that was already
    archived. Appends to the local tombstone's `found_via`, deduped."""
    row = conn.execute("SELECT found_via FROM channel_archive WHERE channel_id=?",
                       (channel_id,)).fetchone()
    if row is None:
        return
    try:
        entries = json.loads(row["found_via"]) if row["found_via"] else []
        if not isinstance(entries, list):
            entries = []
    except (TypeError, ValueError):
        entries = []
    if any(isinstance(e, dict) and e.get("keyword") == keyword for e in entries):
        return
    entries.append({"keyword": keyword, "limit": handles_limit,
                    "discovered_at": discovered_at})
    conn.execute("UPDATE channel_archive SET found_via=? WHERE channel_id=?",
                 (json.dumps(entries), channel_id))


def apply_catalog_unarchived(conn, channel_id, handle):
    """An `unarchived` op. The tombstone goes; the channel comes back as a bare
    row flagged for a full re-fetch, because its object was deleted from the
    bucket when it was archived and nothing but a scrape can rebuild it."""
    conn.execute("DELETE FROM channel_archive WHERE channel_id=?", (channel_id,))
    conn.execute(
        "INSERT INTO channels (channel_id, handle, first_seen_at, force_refetch, announced_at) "
        "VALUES (?, ?, ?, 1, ?) ON CONFLICT(channel_id) DO UPDATE SET force_refetch=1",
        (channel_id, handle or channel_id, _now(), _now()))


def unarchive_locally(conn, channel_ids):
    """The write side of `apply_catalog_unarchived`, for this machine's own
    decision. Returns [(channel_id, handle)] for the segment."""
    out = []
    for channel_id in channel_ids:
        row = conn.execute("SELECT handle FROM channel_archive WHERE channel_id=?",
                           (channel_id,)).fetchone()
        handle = row["handle"] if row else channel_id
        apply_catalog_unarchived(conn, channel_id, handle)
        out.append((channel_id, handle))
    conn.commit()
    return out

# ==========================================
# ENRICHMENT SUPPORT (tools/enrich.py)
# ==========================================
# These are read-only surveys of what is missing. The enrichment tool needs to
# report before it acts, and "report" here means real counts off the real rows
# rather than an estimate -- so the queries live beside the rest of the SQL
# instead of being assembled by the tool.

# Which local column each enrichable field lives in, and what counts as
# "missing" for it. Empty string is treated as missing alongside NULL because
# the importer writes '' for some fields where the API returned nothing.
_CHANNEL_FIELDS = {
    "country": "country",
    "subscribers": "subscribers",
    "name": "name",
    "description": "description",
}
_VIDEO_FIELDS = {
    "view_count": "view_count",
    "published_at": "published_at",
    "title": "title",
}


def _missing_sql(column):
    return f"({column} IS NULL OR {column} = '')"


def field_coverage_watermark(conn, table, field):
    """The earliest fetch time at which this field was ever actually recorded.

    This is what separates the two very different reasons a field is blank:

      * fetched BEFORE the watermark -- the pipeline was not collecting this
        field yet, so the value almost certainly exists on YouTube and a
        re-fetch will fill it in.
      * fetched AT or AFTER the watermark -- a fetch that *was* collecting this
        field still came back without it, so YouTube genuinely does not expose
        it for that row and re-fetching will spend quota for nothing.

    Returns None when the field has never been populated at all (in which case
    nothing can be inferred and every blank row is treated as worth trying).
    """
    column = (_CHANNEL_FIELDS if table == "channels" else _VIDEO_FIELDS).get(field)
    if not column:
        raise ValueError(f"unknown {table} field: {field}")
    row = conn.execute(
        f"SELECT MIN(last_fetched_at) AS w FROM {table} "
        f"WHERE last_fetched_at IS NOT NULL AND NOT {_missing_sql(column)}"
    ).fetchone()
    return row["w"] if row and row["w"] else None


def _handle_clause(handles, alias="channels"):
    if not handles:
        return "", []
    placeholders = ",".join("?" * len(handles))
    return f" AND {alias}.handle IN ({placeholders})", list(handles)


def get_channels_missing(conn, fields, handles=None, before=None, limit=None):
    """Channels blank in ANY of `fields`, as {handle: channel_id}.

    `before` restricts to rows last fetched before that timestamp -- pass a
    watermark from [field_coverage_watermark] to skip the rows a re-fetch
    cannot help. A channel never fetched at all always qualifies.
    """
    columns = [_CHANNEL_FIELDS[f] for f in fields if f in _CHANNEL_FIELDS]
    if not columns:
        return {}
    missing = " OR ".join(_missing_sql(c) for c in columns)
    sql = f"SELECT handle, channel_id FROM channels WHERE ({missing})"
    params = []
    if before:
        sql += " AND (last_fetched_at IS NULL OR last_fetched_at < ?)"
        params.append(before)
    clause, handle_params = _handle_clause(handles)
    sql += clause
    params.extend(handle_params)
    sql += " ORDER BY first_seen_at"
    if limit:
        sql += " LIMIT ?"
        params.append(limit)
    return {r["handle"]: r["channel_id"] for r in conn.execute(sql, params).fetchall()}


def get_videos_needing_refetch(conn, fields, handles=None, before=None,
                               include_failed=True, limit=None):
    """Videos blank in any of `fields`, as [(video_id, channel_id), ...].

    `include_failed` additionally sweeps in every video whose last fetch was
    recorded as failed, regardless of `before`: a failure is not evidence about
    what YouTube holds, it is evidence the question was never answered.
    """
    columns = [_VIDEO_FIELDS[f] for f in fields if f in _VIDEO_FIELDS]
    conditions, params = [], []
    if columns:
        missing = " OR ".join(_missing_sql(c) for c in columns)
        if before:
            conditions.append(
                f"(({missing}) AND (v.last_fetched_at IS NULL OR v.last_fetched_at < ?))")
            params.append(before)
        else:
            conditions.append(f"({missing})")
    if include_failed:
        conditions.append("v.last_fetch_status = 'failed'")
    if not conditions:
        return []

    sql = ("SELECT v.video_id, v.channel_id FROM videos v "
           "JOIN channels c ON c.channel_id = v.channel_id "
           f"WHERE ({' OR '.join(conditions)})")
    clause, handle_params = _handle_clause(handles, alias="c")
    sql += clause
    params.extend(handle_params)
    sql += " ORDER BY v.channel_id, v.video_id"
    if limit:
        sql += " LIMIT ?"
        params.append(limit)
    return [(r["video_id"], r["channel_id"]) for r in conn.execute(sql, params).fetchall()]


def get_channel_video_span(conn, channel_id):
    """How much history is stored for one channel: (count, oldest, newest).

    Only videos with a publish date count towards the span -- a video whose
    fetch failed has no date, so including it would make the stored window
    look wider than it is and stop a backfill that is genuinely needed.
    """
    row = conn.execute(
        "SELECT COUNT(*) AS n, MIN(published_at) AS oldest, MAX(published_at) AS newest "
        "FROM videos WHERE channel_id=? AND published_at IS NOT NULL AND published_at <> ''",
        (channel_id,),
    ).fetchone()
    return (row["n"] or 0, row["oldest"], row["newest"])


def get_existing_video_ids(conn, channel_id):
    rows = conn.execute(
        "SELECT video_id FROM videos WHERE channel_id=?", (channel_id,)
    ).fetchall()
    return {r["video_id"] for r in rows}


def get_channels(conn, handles=None):
    """{handle: channel_id} for the given handles, or for every channel."""
    sql = "SELECT handle, channel_id FROM channels WHERE 1=1"
    clause, params = _handle_clause(handles)
    return {
        r["handle"]: r["channel_id"]
        for r in conn.execute(sql + clause + " ORDER BY first_seen_at", params).fetchall()
    }


def count_channels(conn):
    return conn.execute("SELECT COUNT(*) AS n FROM channels").fetchone()["n"]


def count_videos(conn):
    return conn.execute("SELECT COUNT(*) AS n FROM videos").fetchone()["n"]


def count_missing(conn, table, field, before=None):
    """(total blank, blank-and-worth-retrying) for one field.

    A row counts as worth retrying when it was fetched before the watermark,
    was never fetched, OR its last fetch is recorded as failed. That last
    clause matters: a failed fetch is not evidence that YouTube has no value,
    it is evidence the question was never answered — so those rows must never
    be reported as "absent on YouTube" when the tool is in fact going to retry
    them. Without it the report contradicts what the run then does.
    """
    column = (_CHANNEL_FIELDS if table == "channels" else _VIDEO_FIELDS)[field]
    total = conn.execute(
        f"SELECT COUNT(*) AS n FROM {table} WHERE {_missing_sql(column)}"
    ).fetchone()["n"]
    if not before:
        return total, total
    stale = conn.execute(
        f"SELECT COUNT(*) AS n FROM {table} WHERE {_missing_sql(column)} "
        f"AND (last_fetched_at IS NULL OR last_fetched_at < ? "
        f"     OR last_fetch_status = 'failed')",
        (before,),
    ).fetchone()["n"]
    return total, stale


def count_failed(conn, table):
    return conn.execute(
        f"SELECT COUNT(*) AS n FROM {table} WHERE last_fetch_status='failed'"
    ).fetchone()["n"]


def get_channels_failed(conn, handles=None):
    """{handle: channel_id} for channels whose last fetch was recorded failed.

    Kept separate from [get_channels_missing] because a failure is not evidence
    about what YouTube holds — it means the question was never answered — so
    these are always worth retrying, whatever the coverage watermark says.
    """
    sql = "SELECT handle, channel_id FROM channels WHERE last_fetch_status='failed'"
    clause, params = _handle_clause(handles)
    return {
        r["handle"]: r["channel_id"]
        for r in conn.execute(sql + clause, params).fetchall()
    }
