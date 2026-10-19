"""Shares the local store through Cloudflare R2, and applies what others shared.

Model: **every write goes to the local database first.** A search never blocks
on the network, and a machine with no connection produces exactly the same
results, just unshared. Sharing is a separate, explicit step called at
convenient moments (after each keyword, at the end of a run, when the app asks).

Two kinds of object, both written only by the pipeline and never by the app:

  channels/<channel_id>.json.zst
      One object per channel: its scraped details and every stored video.
      Written once the channel's video pass has finished (`videos_fetched_at`
      is stamped), and rewritten whenever that stamp moves -- a re-fetch, a
      backfill, a repaired video. The object's `fetched-at` metadata IS the
      version; a HEAD tells another machine whether its copy is current.

  catalog/<worker>/<stamp>-<seq>.jsonl.zst
      An append-only log. Each machine writes segments under its OWN prefix,
      so two machines never touch the same key and nothing needs a lock.
      One JSON object per line:
        found         a channel this machine scraped (thin: no description,
                      no banner, nothing derived) and which version of its
                      object is in the bucket, if any
        blob          a newer object was uploaded for an already-announced channel
        link          which keyword found which channel, and when
        keyword       a keyword's status as this machine last left it
        archived      a channel this machine archived (its object is deleted)
        archive_link  a keyword re-found an already-archived channel
        unarchived    a channel brought back (it needs a fresh scrape)
      A reader lists the prefix, applies every segment it has not applied
      (`_applied_segments`), then downloads the objects the segments named.

Why not the shared Postgres: the scraped data is bulk. At the scale this
pipeline is meant to reach it does not fit a free database, every pull of it
is egress, and every change to a replicated row is a realtime message. R2
charges nothing for egress and an object store is what "write once, read by
whoever is missing it" wants. Supabase keeps only what a person typed in, and
only the app talks to it.

Conflict handling is "newest version wins" per channel, which suits this data:
two people who re-fetch the same channel converge on the same real-world
answer. Nothing typed by a person is in any object -- notes, tags, contacts
live in Supabase `channel_state` and can never be clobbered by a scrape.
"""

from __future__ import annotations

import json
import os
import re
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor

from gratovo import store
from gratovo.r2 import R2Error, compress, decompress

CATALOG_PREFIX = "catalog/"
CHANNEL_PREFIX = "channels/"
# Ops per segment before a new key is started. A normal keyword writes a few
# hundred; the one-time bootstrap writes every channel this machine has.
SEGMENT_MAX_OPS = 5000
# Parallel object downloads / uploads. R2 is happy with far more; this is
# about not hammering a home connection while a search may be running
# alongside.
DOWNLOAD_WORKERS = 6
UPLOAD_WORKERS = 6
# How many objects `push_blobs` / `pull_blobs` handle between `[sync-io]`
# progress lines. Small enough that a move of thousands (a machine's first
# sync) reports every few seconds; large enough that the ordinary
# between-keyword share of a few dozen prints only its first and last line.
# The lines are the progress protocol the app reads -- see
# `search_progress_parser.dart` -- so their shape is fixed:
#     [sync-io] shared=K of=N      objects uploaded so far
#     [sync-io] pulled=K of=N      objects downloaded and applied so far
#     [sync-io] catalog=K of=N     catalog segments applied so far
PUSH_PROGRESS_EVERY = 25


class SyncError(RuntimeError):
    pass


# ==========================================================================
# Keys
# ==========================================================================

def channel_key(channel_id):
    return f"{CHANNEL_PREFIX}{channel_id}.json.zst"


def _safe_worker(worker_id):
    """A worker name as a key path segment: letters, digits, `-_.` only."""
    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "-", worker_id or "").strip("-.")
    return cleaned or "unknown"


def segment_key(worker_id, stamp, seq):
    return f"{CATALOG_PREFIX}{_safe_worker(worker_id)}/{stamp}-{seq:03d}.jsonl.zst"


def _stamp_now():
    """Compact UTC with microseconds plus a random tail, sortable as text
    and safe in a key: 20260912T141530.123456Z-a1b2. Two segments written by
    one machine in the same second must not share a key -- the second would
    silently replace the first in the bucket, and a reader that had already
    applied that key would never see it."""
    now = time.time()
    return (time.strftime("%Y%m%dT%H%M%S", time.gmtime(now))
            + f".{int((now % 1) * 1_000_000):06d}Z-{os.urandom(2).hex()}")


def _segment_stamp(key):
    """The `<stamp>-<seq>` part of a segment key, for global ordering."""
    return key.rsplit("/", 1)[-1]


# ==========================================================================
# Encoding
# ==========================================================================

def encode_blob(blob):
    return compress(json.dumps(blob, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def decode_blob(data):
    return json.loads(decompress(data).decode("utf-8"))


def encode_segment(ops):
    lines = "\n".join(json.dumps(op, ensure_ascii=False, separators=(",", ":")) for op in ops)
    return compress((lines + "\n").encode("utf-8"))


def decode_segment(data):
    text = decompress(data).decode("utf-8")
    ops = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            ops.append(json.loads(line))
        except ValueError:
            # One bad line must not sink the segment; the rest still applies.
            continue
    return ops


# ==========================================================================
# Objects: upload what this machine finished, download what it is missing
# ==========================================================================

def push_blobs(conn, client, limit=None, log=print, workers=UPLOAD_WORKERS):
    """Uploads an object for every channel whose video pass finished since its
    object was last uploaded. Returns (uploaded, skipped_current).

    HEAD first: if the bucket already holds a version at least as new (another
    machine finished the same channel, or this one already uploaded it before
    a crash cleared the local stamp), the PUT is skipped and only the local
    bookkeeping is brought up to date.

    The network half runs in a small pool, the same shape as `pull_blobs`:
    each object is built from the store on the calling thread, HEAD+PUT
    happen in the pool, and the stamp is written back on the calling thread
    as results come in -- so a kill halfway leaves every finished object
    stamped and nothing else. Latency, not bandwidth, is the cost of a
    per-channel object, and a first upload of thousands of channels is the
    difference between an hour and a few minutes.

    Objects are built and submitted a window at a time, not all up front:
    `ThreadPoolExecutor.map` evaluates its whole input before the first task
    runs, which for a push of thousands meant thousands of blobs read from
    the store and held in memory, in silence, before a single byte moved.

    Prints a `[sync-io] shared=K of=N` line as it goes (see
    `PUSH_PROGRESS_EVERY`), because a push has no other output until it is
    over. The app's catch-up panel reads that line (`video_catchup_controller.dart`)
    so a share of thousands of objects between two backlog batches shows as
    exactly that, rather than as a sweep frozen on its last channel for
    twenty minutes -- which is what it looked like.
    """
    candidates = store.get_blob_upload_candidates(conn, limit=limit)
    if not candidates:
        return 0, 0
    total = len(candidates)
    uploaded = skipped = handled = 0

    def upload(row):
        channel_id, version = row["channel_id"], row["videos_fetched_at"]
        key = channel_key(channel_id)
        try:
            meta = client.head(key)
            if meta and (meta.get("fetched-at") or "") >= version:
                return row, "current", None
            blob = row["_blob"]
            if blob is None:
                return row, "gone", None
            client.put(key, encode_blob(blob),
                       metadata={"fetched-at": version, "schema": str(store.BLOB_SCHEMA)},
                       content_type="application/zstd")
            return row, "uploaded", None
        except R2Error as exc:
            return row, "failed", exc

    def with_blob(row):
        # Read on this thread; the connection is not shared with the pool.
        row = dict(row)
        row["_blob"] = store.build_channel_blob(conn, row["channel_id"])
        return row

    def report():
        log(f"[sync-io] shared={handled} of={total}")

    def take(future):
        """Bookkeeping for one finished upload -- on the calling thread, in
        submission order, so the stamps land in the same order the
        candidates were listed."""
        nonlocal uploaded, skipped, handled
        row, outcome, error = future.result()
        handled += 1
        if outcome == "failed":
            log(f"[sync] upload of {row['channel_id']} failed ({error}); will retry.")
        elif outcome != "gone":
            if outcome == "uploaded":
                uploaded += 1
            else:
                skipped += 1
            store.mark_blob_uploaded(conn, row["channel_id"], row["videos_fetched_at"])
        if handled == total or handled % PUSH_PROGRESS_EVERY == 0:
            report()

    report()
    with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="r2-put") as pool:
        in_flight = deque()
        for row in candidates:
            in_flight.append(pool.submit(upload, with_blob(row)))
            # Keep the pool fed a little past its width, and no further: the
            # oldest result is taken (and its stamp written) before the next
            # blob is built.
            if len(in_flight) >= workers * 2:
                take(in_flight.popleft())
        while in_flight:
            take(in_flight.popleft())
    return uploaded, skipped


def pull_blobs(conn, client, limit=None, log=print, workers=DOWNLOAD_WORKERS):
    """Downloads and applies every object the catalog says is newer than what
    this machine holds. Downloads run in a small pool; every database write
    happens on the calling thread. Returns (applied, missing, failed).

    A missing object (the catalog named a version nobody has uploaded yet, or
    the channel was archived meanwhile) is forgotten rather than retried on
    every tick: the channel's `blob_version` is cleared, and the next
    `found`/`blob` op that names it -- even at the very same version, once
    the machine holding the videos has uploaded -- makes it a candidate
    again.
    """
    candidates = store.get_blob_download_candidates(conn, limit=limit)
    if not candidates:
        return 0, 0, 0
    total = len(candidates)
    applied = missing = failed = handled = 0
    landed = []
    log(f"[sync-io] pulled=0 of={total}")

    def fetch(row):
        try:
            return row, client.get(channel_key(row["channel_id"])), None
        except R2Error as exc:
            return row, None, exc

    with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="r2-get") as pool:
        for row, result, error in pool.map(fetch, candidates):
            channel_id, version = row["channel_id"], row["blob_version"]
            handled += 1
            if handled == total or handled % PUSH_PROGRESS_EVERY == 0:
                log(f"[sync-io] pulled={handled} of={total}")
            if error is not None:
                failed += 1
                log(f"[sync] download of {channel_id} failed ({error}); will retry.")
                continue
            if result is None:
                missing += 1
                store.forget_blob_version(conn, channel_id, version)
                conn.commit()
                continue
            data, meta = result
            try:
                blob = decode_blob(data)
            except (ValueError, OSError) as exc:
                failed += 1
                log(f"[sync] object for {channel_id} is unreadable ({exc}); skipped.")
                continue
            actual = meta.get("fetched-at") or (blob.get("channel") or {}).get("videos_fetched_at") or version
            if store.apply_channel_blob(conn, blob, max(actual, version)):
                landed.append(channel_id)
            applied += 1
    if landed:
        # Sponsorship and found emails are derived here from what arrived, the
        # same as the rollups apply_channel_blob already recomputed. Imported
        # here: pipeline is the fetching half and sync must not need it to load.
        from gratovo import pipeline
        pipeline.derive_channel_signals(conn, landed)
    return applied, missing, failed


# ==========================================================================
# The catalog: write this machine's segment, apply everyone else's
# ==========================================================================

def _thin_channel(row):
    return {
        "channel_id": row["channel_id"],
        "handle": row.get("handle") or "",
        "name": row.get("name"),
        "profile_picture": row.get("profile_picture"),
        "subscribers": row.get("subscribers"),
        "country": row.get("country"),
        "first_seen_at": row.get("first_seen_at"),
        "videos_fetched_at": row.get("videos_fetched_at"),
        "blob_version": row.get("blob_uploaded_at"),
    }


def _json_or_none(value):
    if value in (None, ""):
        return None
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return None


def collect_ops(conn, extra_ops=()):
    """Everything this machine has yet to announce, as a list of ops, plus a
    `done` record of what to flag as announced once the segment is in the
    bucket: {"found": [ids], "blobs": {id: version}, "links": [(id, kw)],
    "keywords": [kw], "archives": [ids]}."""
    ops = list(extra_ops)
    done = {"found": [], "blobs": {}, "links": [], "keywords": [], "archives": []}
    found_ids = done["found"]
    blob_versions = done["blobs"]
    for row in store.get_unannounced_channels(conn):
        ops.append({"op": "found", "channel": _thin_channel(row)})
        found_ids.append(row["channel_id"])
        if row.get("blob_uploaded_at"):
            blob_versions[row["channel_id"]] = row["blob_uploaded_at"]
    for row in store.get_unannounced_blobs(conn):
        ops.append({"op": "blob", "channel_id": row["channel_id"],
                    "blob_version": row["blob_uploaded_at"]})
        blob_versions[row["channel_id"]] = row["blob_uploaded_at"]
    for row in store.get_unannounced_links(conn):
        ops.append({"op": "link", "channel_id": row["channel_id"],
                    "keyword": row["keyword"], "discovered_at": row["discovered_at"]})
        done["links"].append((row["channel_id"], row["keyword"]))
    for row in store.get_dirty_keywords(conn):
        done["keywords"].append(row["keyword"])
        ops.append({"op": "keyword", "keyword": row["keyword"],
                    "status": row.get("status") or "pending",
                    "added_at": row.get("added_at"),
                    "started_at": row.get("started_at") or None,
                    "completed_at": row.get("completed_at") or None,
                    "channels_found": row.get("channels_found") or 0,
                    "worker": row.get("claimed_by"),
                    "search_settings": _json_or_none(row.get("search_settings"))})
    for row in store.get_unannounced_archives(conn):
        done["archives"].append(row["channel_id"])
        ops.append({"op": "archived", "channel_id": row["channel_id"],
                    "handle": row.get("handle") or "",
                    "label": row.get("label") or "irrelevant",
                    "subscribers": row.get("subscribers"),
                    "found_at": row.get("found_at") or None,
                    "found_via": _json_or_none(row.get("found_via")) or [],
                    "archived_at": row.get("archived_at"),
                    "median_views_last_30": row.get("median_views_last_30"),
                    "median_basis": row.get("median_basis"),
                    "videos_found_count": row.get("videos_found_count")})
    for row in store.get_archive_keyword_pending(conn):
        ops.append({"op": "archive_link", "channel_id": row["channel_id"],
                    "keyword": row["keyword"], "limit": row.get("handles_limit"),
                    "discovered_at": row["discovered_at"]})
    return ops, done


# How long a second sharer waits for the first before going ahead anyway.
SHARE_LOCK_WAIT = 300


class _ShareLock:
    """One announcer per store at a time, across processes.

    Everything in a segment is "what is local and not yet announced", and the
    flags that say "announced" move only after the segment is in the bucket.
    Two processes that collect in that window -- a search finishing its
    keyword while the app's sync tick shares, or a bootstrap started twice --
    would both write the same ops under two keys, and every other machine
    would apply them twice. Harmless, but the bootstrap-sized case is tens of
    thousands of ops. So the second one waits here until the first is done,
    then finds nothing left to say.

    A lock file next to the database, held for the duration of one
    `write_segment`. The OS drops it with the process, so a killed sharer
    never wedges the next. Given up after [SHARE_LOCK_WAIT] seconds: at that
    point the other process is alive but stuck, and one duplicate segment
    beats never sharing.

    The bootstrap holds a second lock of the same kind (`.bootstrap-lock`)
    for its whole run, with no deadline: the app launches `search.py` from
    several places at once on a first start (its background pull, its sync
    button, the search itself), and every one of them would otherwise begin
    the same multi-minute bootstrap into the same file. The ones that lose
    the lock wait -- saying so, since a wait this long looks like a hang --
    and find the work done when they get it. [waited] says whether that
    happened.
    """

    def __init__(self, conn, suffix=".share-lock", wait=SHARE_LOCK_WAIT, log=None,
                 waiting_message=None):
        self._handle = None
        self._path = None
        self._wait = wait
        self._log = log
        self._waiting_message = waiting_message
        self.waited = False
        for _, name, path in conn.execute("PRAGMA database_list").fetchall():
            if name == "main" and path:
                self._path = path + suffix

    def __enter__(self):
        if self._path is None:
            return self
        try:
            self._handle = open(self._path, "a+b")
        except OSError:
            return self
        started = time.monotonic()
        deadline = None if self._wait is None else started + self._wait
        last_word = started
        while not self._try_lock():
            now = time.monotonic()
            if deadline is not None and now >= deadline:
                break
            self.waited = True
            if self._log and self._waiting_message and now - last_word >= 30:
                self._log(self._waiting_message)
                last_word = now
            time.sleep(0.25)
        return self

    def __exit__(self, *_):
        if self._handle is None:
            return
        try:
            self._unlock()
        finally:
            self._handle.close()
            self._handle = None

    def _try_lock(self):
        try:
            if os.name == "nt":
                import msvcrt
                self._handle.seek(0)
                msvcrt.locking(self._handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self._handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except OSError:
            return False

    def _unlock(self):
        try:
            if os.name == "nt":
                import msvcrt
                self._handle.seek(0)
                msvcrt.locking(self._handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(self._handle.fileno(), fcntl.LOCK_UN)
        except OSError:
            pass



def write_segment(conn, client, worker_id, extra_ops=(), log=print):
    """Writes one or more catalog segments holding everything local that has
    not been announced yet. Returns the number of ops written (0 when there
    was nothing to say, in which case no object is created).

    The "announced" flags move only after every segment is in the bucket, so
    a failure leaves the next call to say it all again. One sharer per store
    at a time -- see `_ShareLock`.
    """
    with _ShareLock(conn):
        return _write_segment_locked(conn, client, worker_id, extra_ops, log)


def _write_segment_locked(conn, client, worker_id, extra_ops, log):
    ops, done = collect_ops(conn, extra_ops)
    if not ops:
        return 0
    stamp = _stamp_now()
    now = store._now()
    for seq, start in enumerate(range(0, len(ops), SEGMENT_MAX_OPS)):
        chunk = ops[start:start + SEGMENT_MAX_OPS]
        key = segment_key(worker_id, stamp, seq)
        client.put(key, encode_segment(chunk), content_type="application/zstd")
        # Our own segment: applied by definition. Recording it keeps the next
        # pull from downloading what this machine just wrote.
        store.mark_segment_applied(conn, key)
    store.mark_channels_announced(conn, done["found"], now)
    store.mark_blobs_announced(conn, done["blobs"])
    store.mark_links_announced(conn, done["links"])
    store.mark_keywords_announced(conn, done["keywords"])
    store.mark_archives_announced(conn, done["archives"])
    for row in store.get_archive_keyword_pending(conn):
        store.clear_archive_keyword_pending(conn, row["channel_id"], row["keyword"])
    conn.commit()
    return len(ops)


def apply_ops(conn, ops, stamp):
    """Applies one segment's ops to the local store. Does not commit."""
    counts = {}
    for op in ops:
        kind = op.get("op")
        counts[kind] = counts.get(kind, 0) + 1
        if kind == "found":
            store.apply_catalog_channel(conn, op.get("channel") or {}, stamp)
        elif kind == "blob":
            if op.get("channel_id") and op.get("blob_version"):
                store.apply_catalog_blob(conn, op["channel_id"], op["blob_version"])
        elif kind == "link":
            if op.get("channel_id") and op.get("keyword"):
                store.apply_remote_channel_keyword(conn, op)
        elif kind == "keyword":
            if op.get("keyword"):
                store.apply_remote_keyword(conn, {
                    "keyword": op["keyword"], "status": op.get("status") or "pending",
                    "added_at": op.get("added_at") or stamp,
                    "started_at": op.get("started_at"),
                    "completed_at": op.get("completed_at"),
                    "channels_found": op.get("channels_found") or 0,
                    "claimed_by": op.get("worker"),
                    "search_settings": op.get("search_settings"),
                })
        elif kind == "archived":
            if op.get("channel_id"):
                store.apply_remote_archive(conn, op)
        elif kind == "archive_link":
            if op.get("channel_id") and op.get("keyword"):
                store.apply_catalog_archive_link(
                    conn, op["channel_id"], op["keyword"], op.get("limit"),
                    op.get("discovered_at") or stamp)
        elif kind == "unarchived":
            if op.get("channel_id"):
                store.apply_catalog_unarchived(conn, op["channel_id"], op.get("handle"))
    return counts


def pull_catalog(conn, client, log=print):
    """Lists the catalog and applies every segment this machine has not seen,
    oldest first across all writers. Returns (segments_applied, op_counts).

    Each segment is one transaction: applied fully and recorded, or not at
    all. An unreadable segment is skipped and reported, and comes round again
    next time.
    """
    keys = client.list(CATALOG_PREFIX)
    applied_keys = store.get_applied_segments(conn)
    todo = sorted((k for k in keys if k not in applied_keys and k.endswith(".jsonl.zst")),
                  key=_segment_stamp)
    totals = {}
    applied = 0
    for index, key in enumerate(todo):
        if index == 0 or index % PUSH_PROGRESS_EVERY == 0:
            log(f"[sync-io] catalog={index} of={len(todo)}")
        try:
            result = client.get(key)
            if result is None:
                continue
            ops = decode_segment(result[0])
        except (R2Error, ValueError, OSError) as exc:
            log(f"[sync] segment {key} could not be read ({exc}); will retry.")
            continue
        stamp = store._now()
        try:
            counts = apply_ops(conn, ops, stamp)
            store.mark_segment_applied(conn, key)
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        for k, v in counts.items():
            totals[k] = totals.get(k, 0) + v
        applied += 1
    if todo:
        log(f"[sync-io] catalog={len(todo)} of={len(todo)}")
    return applied, totals


# ==========================================================================
# Archive ops the app asks for
# ==========================================================================

def archive_channels(conn, client, worker_id, entries, log=print):
    """Archives channels on this machine's behalf -- the app's sweep and its
    bulk tools call this through `search.py --archive-ids`.

    [entries] is a list of {"channel_id", "label"} (label defaults to
    'irrelevant'). Each channel is tombstoned locally (which deletes its row
    and videos), its object is deleted from the bucket, and one segment
    announces all of it. Returns the number archived.
    """
    done = 0
    for entry in entries:
        channel_id = entry.get("channel_id")
        if not channel_id:
            continue
        label = entry.get("label") or "irrelevant"
        if store.is_archived(conn, channel_id):
            # The app tombstones locally before it asks for the R2 side, and a
            # relabel from the Archive page arrives the same way -- so the row
            # is usually already here, carrying the subscriber count and the
            # keywords that only the deleted channels row could have supplied.
            # Correct the label and re-announce; never rebuild the row from a
            # channels row that is gone.
            conn.execute(
                "UPDATE channel_archive SET label=?, source='local', announced=0 "
                "WHERE channel_id=?", (label, channel_id))
            # The app tombstoned this locally from its own copy of the store,
            # which is the same file -- but a relabel also lands here, and so
            # does a tombstone this machine pulled before the videos it was
            # measured from arrived. Measure and fold in before the delete
            # below, since after it there is nothing left to measure.
            store.merge_archive_numbers(
                conn, channel_id, *store.measure_archive_numbers(conn, channel_id))
            conn.execute("DELETE FROM videos WHERE channel_id=?", (channel_id,))
            conn.execute("DELETE FROM channel_keywords WHERE channel_id=?", (channel_id,))
            conn.execute("DELETE FROM channels WHERE channel_id=?", (channel_id,))
            conn.commit()
        else:
            row = store.get_channel_row(conn, channel_id)
            handle = (row or {}).get("handle") or entry.get("handle") or channel_id
            found_via = [
                {"keyword": r["keyword"], "limit": None,
                 "discovered_at": r["discovered_at"]}
                for r in conn.execute(
                    "SELECT keyword, discovered_at FROM channel_keywords "
                    "WHERE channel_id=? ORDER BY discovered_at",
                    (channel_id,)).fetchall()
            ]
            store.archive_channel_locally(
                conn, channel_id, handle, label,
                subscribers=(row or {}).get("subscribers"),
                found_at=(row or {}).get("first_seen_at"), found_via=found_via)
        if client is not None:
            try:
                client.delete(channel_key(channel_id))
            except R2Error as exc:
                log(f"[sync] could not delete the object for {channel_id} ({exc}).")
        done += 1
    if client is not None and done:
        write_segment(conn, client, worker_id, log=log)
    return done


def unarchive_channels(conn, client, worker_id, channel_ids, log=print):
    """Brings archived channels back: the tombstone goes, a bare row flagged
    for re-fetch takes its place, and one segment tells everyone."""
    restored = store.unarchive_locally(conn, channel_ids)
    if client is not None and restored:
        ops = [{"op": "unarchived", "channel_id": cid, "handle": handle}
               for cid, handle in restored]
        write_segment(conn, client, worker_id, extra_ops=ops, log=log)
    return len(restored)


# ==========================================================================
# One-time: the move from the live-first database
# ==========================================================================

def export_supabase(config, out_dir, log=print):
    """Pulls the three small tables the old shared database held that the
    catalog now carries -- `channel_archive`, `keywords`, `channel_keywords`
    -- and writes them as JSONL under [out_dir]. Run once, from one machine,
    with the service key in data/.env, BEFORE migrate_v2.sql drops them.

    A minimal PostgREST client lives here and nowhere else in the pipeline.
    """
    import urllib.parse
    import urllib.request

    url, key = config.supabase_url, config.supabase_key
    if not (url and key):
        raise SyncError("SUPABASE_URL and SUPABASE_SERVICE_KEY are needed for the export.")
    out_dir.mkdir(parents=True, exist_ok=True)

    def page(table, offset, limit=1000):
        query = urllib.parse.urlencode({"select": "*", "limit": limit, "offset": offset})
        request = urllib.request.Request(
            f"{url}/rest/v1/{table}?{query}",
            headers={"apikey": key, "Authorization": f"Bearer {key}"})
        with urllib.request.urlopen(request, timeout=120) as response:
            return json.loads(response.read() or b"[]")

    counts = {}
    for table in ("channel_archive", "keywords", "channel_keywords"):
        path = out_dir / f"{table}.jsonl"
        n, offset = 0, 0
        with open(path, "w", encoding="utf-8") as handle:
            while True:
                rows = page(table, offset)
                for row in rows:
                    handle.write(json.dumps(row, ensure_ascii=False) + "\n")
                n += len(rows)
                if len(rows) < 1000:
                    break
                offset += 1000
        counts[table] = n
        log(f"[export] {table}: {n} rows -> {path}")
    return counts


def import_migration(conn, migration_dir, log=print):
    """Loads the files `export_supabase` wrote into the local store as LOCAL
    rows, so the next segment announces them. Idempotent."""
    counts = {}
    archive_path = migration_dir / "channel_archive.jsonl"
    if archive_path.exists():
        n = 0
        for line in open(archive_path, encoding="utf-8"):
            if not line.strip():
                continue
            rec = json.loads(line)
            found_via = rec.get("found_via")
            # An upsert, and always as an unannounced LOCAL row: most of these
            # are already here as `remote` rows from the old Supabase pull,
            # and a remote row is one the catalog is assumed to carry -- which
            # it does not, yet. The export is the authority on what the team
            # had archived; this machine is the one that announces it.
            median = rec.get("median_views_last_30")
            # The old table also carried the list of video ids; only the
            # count survives -- it is the number the Archive page shows.
            videos_found = rec.get("videos_found_count")
            conn.execute(
                "INSERT INTO channel_archive "
                "(channel_id, handle, label, archived_at, subscribers, found_at, found_via, "
                " median_views_last_30, videos_found_count, source, announced) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'local', 0) "
                "ON CONFLICT(channel_id) DO UPDATE SET "
                "  handle=excluded.handle, label=excluded.label, "
                "  archived_at=excluded.archived_at, subscribers=excluded.subscribers, "
                "  found_at=excluded.found_at, found_via=excluded.found_via, "
                # COALESCE, not assignment: the export is the authority on
                # what was archived, not on numbers it may never have carried.
                # A row already holding a real median must not lose it to an
                # exported NULL.
                "  median_views_last_30=COALESCE(excluded.median_views_last_30, "
                "                                channel_archive.median_views_last_30), "
                "  videos_found_count=COALESCE(excluded.videos_found_count, "
                "                              channel_archive.videos_found_count), "
                "  source='local', "
                # Re-running the import must not re-announce 27k rows: a row
                # that already says exactly this keeps its flag.
                "  announced=CASE WHEN channel_archive.source='local' "
                "    AND channel_archive.label IS excluded.label "
                "    AND channel_archive.subscribers IS excluded.subscribers "
                "    AND channel_archive.found_via IS excluded.found_via "
                "    AND channel_archive.median_views_last_30 IS excluded.median_views_last_30 "
                "    AND channel_archive.videos_found_count IS excluded.videos_found_count "
                "    THEN channel_archive.announced ELSE 0 END",
                (rec.get("channel_id"), rec.get("handle") or "", rec.get("label") or "irrelevant",
                 rec.get("archived_at") or store._now(),
                 str(rec["subscribers"]) if rec.get("subscribers") is not None else None,
                 rec.get("found_at"),
                 json.dumps(found_via) if isinstance(found_via, (list, dict)) else (found_via or "[]"),
                 int(median) if isinstance(median, (int, float)) else None,
                 int(videos_found) if isinstance(videos_found, (int, float)) else None))
            cid = rec.get("channel_id")
            store.merge_archive_numbers(
                conn, cid, *store.measure_archive_numbers(conn, cid), announce=False)
            conn.execute("DELETE FROM videos WHERE channel_id=?", (cid,))
            conn.execute("DELETE FROM channel_keywords WHERE channel_id=?", (cid,))
            conn.execute("DELETE FROM channels WHERE channel_id=?", (cid,))
            n += 1
        counts["channel_archive"] = n
    keywords_path = migration_dir / "keywords.jsonl"
    if keywords_path.exists():
        n = 0
        for line in open(keywords_path, encoding="utf-8"):
            if not line.strip():
                continue
            rec = json.loads(line)
            settings = rec.get("search_settings")
            conn.execute(
                "INSERT OR IGNORE INTO keywords (keyword, status, added_at, started_at, "
                " completed_at, channels_found, claimed_by, search_settings, source) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'local')",
                (rec["keyword"], rec.get("status") or "pending",
                 rec.get("added_at") or store._now(), rec.get("started_at"),
                 rec.get("completed_at"), rec.get("channels_found") or 0,
                 rec.get("claimed_by"),
                 json.dumps(settings) if isinstance(settings, (dict, list)) else settings))
            n += 1
        counts["keywords"] = n
    links_path = migration_dir / "channel_keywords.jsonl"
    if links_path.exists():
        n = 0
        for line in open(links_path, encoding="utf-8"):
            if not line.strip():
                continue
            rec = json.loads(line)
            conn.execute(
                "INSERT OR IGNORE INTO channel_keywords (channel_id, keyword, discovered_at, source) "
                "SELECT ?, ?, ?, 'local' WHERE EXISTS (SELECT 1 FROM channels WHERE channel_id=?)",
                (rec["channel_id"], rec["keyword"], rec.get("discovered_at") or store._now(),
                 rec["channel_id"]))
            n += 1
        counts["channel_keywords"] = n
    conn.commit()
    for table, n in counts.items():
        log(f"[bootstrap] imported {n} {table} rows from {migration_dir}")
    return counts


def ensure_bootstrapped(conn, client, worker_id, migration_dir=None, log=print):
    """Runs the bootstrap if this store has never had one, and returns its
    result when it ran here (None otherwise). Every mode of `search.py` that touches the bucket
    goes through this first -- a share from a store that never bootstrapped
    uploads an object for every channel the old shared database merely
    stamped as read, videos or not, and an empty object with the real
    read's stamp blocks the machine holding the videos from ever uploading
    them (see `store.get_inherited_video_stamps`).

    One process at a time, across the app's several launchers: the others
    wait on the lock, then find the cursor set and return without running.
    """
    if store.is_bootstrapped(conn):
        return None
    with _ShareLock(conn, suffix=".bootstrap-lock", wait=None, log=log,
                    waiting_message="[step] Waiting for the first sync already running "
                                    "on this machine...") as lock:
        if lock.waited:
            # The store may have moved under us; the cursor is the truth.
            if store.is_bootstrapped(conn):
                log("[bootstrap] finished by another process while this one waited.")
                return None
        log(f"[step] First sync of this machine: moving its store into the shared "
            f"bucket (once; can take several minutes)...")
        result = bootstrap(conn, client, worker_id, migration_dir=migration_dir, log=log)
        store.set_sync_cursor(conn, store.BOOTSTRAP_CURSOR, store._now())
        store.set_sync_cursor(conn, store.PULL_CURSOR, store._now())
    return result


def bootstrap_lock(conn, log=print):
    """The lock `ensure_bootstrapped` holds, for a caller running `bootstrap`
    by hand."""
    return _ShareLock(conn, suffix=".bootstrap-lock", wait=None, log=log,
                      waiting_message="[step] Waiting for the first sync already running "
                                      "on this machine...")


def bootstrap(conn, client, worker_id, migration_dir=None, log=print):
    """The one-time move of this machine's store into the bucket. In order:

    1. import the exported Supabase tables if they are here;
    2. apply whatever is already in the catalog, so a machine that
       bootstraps second does not announce what the first one already has;
    3. reclaim the rows the old shared database left as `remote` -- the
       archive, mostly -- since the catalog holds nothing for them yet;
    4. drop the video-pass stamps this machine inherited without the videos
       (see `store.get_inherited_video_stamps`), deleting the empty object
       an earlier bootstrap may have uploaded for them;
    5. upload every finished channel's object and announce everything.

    Re-runnable -- a second run finds nothing left to upload or announce.
    Callers that want "once" go through `ensure_bootstrapped`.
    """
    if migration_dir is not None and migration_dir.exists():
        import_migration(conn, migration_dir, log=log)

    log("[step] First sync: applying the team's catalog...")
    applied = 0
    segments, _ = pull_catalog(conn, client, log=log)
    if segments:
        log("[step] First sync: downloading the team's channels...")
        applied, _, _ = pull_blobs(conn, client, log=log)
        log(f"[bootstrap] catalog: {segments} segment(s) from other machines applied, "
            f"{applied} object(s) downloaded.")

    reclaimed = store.reclaim_pre_catalog_rows(conn)
    conn.commit()
    reclaimed_total = sum(reclaimed.values())
    if reclaimed_total:
        log(f"[bootstrap] reclaimed {reclaimed_total} row(s) the old shared database "
            f"left unannounced: " + ", ".join(f"{n} {t}" for t, n in reclaimed.items() if n))

    inherited = store.get_inherited_video_stamps(conn)
    if inherited:
        deleted = client.delete_many(
            channel_key(r["channel_id"]) for r in inherited if r.get("blob_uploaded_at"))
        store.clear_video_stamps(conn, [r["channel_id"] for r in inherited])
        conn.commit()
        log(f"[bootstrap] {len(inherited)} channel(s) were stamped as read but hold no "
            f"videos here -- waiting for the machine that read them to share "
            f"(not read again here for {store.AWAITING_PEER_DAYS} days)"
            + (f"; {deleted} empty object(s) removed from the bucket." if deleted else "."))

    unfinished = conn.execute(
        "SELECT COUNT(*) AS n FROM channels WHERE videos_fetched_at IS NULL").fetchone()["n"]
    log("[step] First sync: uploading this machine's channels...")
    uploaded, skipped = push_blobs(conn, client, log=log)
    log(f"[bootstrap] objects: {uploaded} uploaded, {skipped} already current, "
        f"{unfinished} channel(s) have no finished video pass and stay in the backlog.")
    log("[step] First sync: announcing this machine's history to the team...")
    ops = write_segment(conn, client, worker_id, log=log)
    log(f"[bootstrap] catalog: {ops} op(s) announced.")
    return {"uploaded": uploaded, "skipped": skipped, "unfinished": unfinished, "ops": ops,
            "reclaimed": reclaimed, "inherited": len(inherited), "segments": segments,
            "applied": applied}
