#!/usr/bin/env python3
"""Gratovo sourcing pipeline — the entry point.

    python search.py                     process the queued keywords
    python search.py --refetch @handle   refresh specific channels and exit
    python search.py --status            print where everything is pointing
    python search.py --push-only         share what is already stored locally
    python search.py --pull-only         apply the catalog + download objects (background job)
    python search.py --pull-blobs        download only the objects already known to be missing
    python search.py --archive-ids F     archive the channels listed in a JSON file
    python search.py --unarchive-ids F   bring them back
    python search.py --bootstrap-r2      one-time: move this machine's store into the bucket
    python search.py --export-supabase   one-time: save the old shared tables for the bootstrap
    python search.py --no-pull           search without checking for shared state

Local first, shared second. Every result is written to `data/database/gratovo.db` before
anything is sent anywhere, so a run with no connection produces exactly the same
data — it just is not shared until the next push. Nothing here fails because
the bucket is unreachable.
"""

from __future__ import annotations

import argparse
import calendar
import datetime
import os
import pathlib
import sys
import time
import traceback

# Allow `python search.py` from inside pipeline/ without installing anything.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Say what we mean, in the encoding we mean it in. Python on Windows writes
# `print()` output using the machine's legacy ANSI code page (cp1252 and
# friends) rather than UTF-8, which mangles every em dash and arrow in the
# messages below -- and, when stdout is a pipe rather than a console, emits
# bytes that are not valid UTF-8 at all. The Flutter app reads exactly that
# pipe, so this is not cosmetic: an undecodable byte used to take down the
# whole search it had just started. `errors="replace"` keeps a genuinely
# unencodable character from raising mid-print on a terminal that cannot show
# it -- a lost glyph is always better than a lost run.
for _stream in (sys.stdout, sys.stderr):
    try:
        # line_buffering is the other half of this, and the half the Flutter
        # app depends on: Python block-buffers stdout when it is a pipe rather
        # than a console, so up to 8 KB of progress accumulated invisibly and
        # the app showed nothing until the buffer filled or the run ended. A
        # run that prints steadily now reaches whoever is watching it as it
        # prints. (The app also launches this with `-u`; either alone is
        # enough, and a teammate running the script by hand gets it from here.)
        _stream.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    except (AttributeError, ValueError):
        # Not a TextIOWrapper (redirected to something custom, or already
        # detached). Nothing to reconfigure; the app-side decoder is lenient.
        pass

from gratovo import config, parallel, pipeline, r2, store, sync  # noqa: E402


# ----------------------------------------------------------------------------
# Run log
# ----------------------------------------------------------------------------
#
# Every run also writes its whole console output to a file under
# `data/logs/`, so a crash that scrolls off the terminal (or a run the app
# started and then closed the window on) can still be read afterwards. The
# traceback in particular: an uncaught exception is written to `sys.stderr`,
# and `_Tee` puts `sys.stderr` on both the real stream *and* the file, so the
# full traceback lands in the log even though the process is on its way out.
#
# This does not replace the live stream the Flutter app reads — the real
# stdout/stderr still get every byte, in order. The file is a carbon copy.

# Keep this many of the most recent log files; delete older ones on each run
# so `data/logs/` cannot grow without bound. Small text files, so this is
# generous.
LOG_RETENTION = 40


class _Tee:
    """A write-through stream: everything written is sent to the real
    stream and appended to the log file. Anything else (`encoding`,
    `isatty`, `fileno`, `reconfigure`, ...) is delegated to the real stream
    so libraries that inspect stdout still see a normal one."""

    def __init__(self, stream, log_handle):
        self._stream = stream
        self._log = log_handle

    def write(self, text):
        n = self._stream.write(text)
        try:
            self._log.write(text)
        except (ValueError, OSError):
            # The log file went away (disk full, handle closed on shutdown).
            # The real stream already has the text; that is the one that
            # matters.
            pass
        return n

    def flush(self):
        self._stream.flush()
        try:
            self._log.flush()
        except (ValueError, OSError):
            pass

    def __getattr__(self, name):
        return getattr(self._stream, name)


def _prune_old_logs(log_dir):
    try:
        logs = sorted(log_dir.glob("search-*.log"))
    except OSError:
        return
    for stale in logs[:-LOG_RETENTION]:
        try:
            stale.unlink()
        except OSError:
            pass


def setup_run_log(mode):
    """Point `sys.stdout`/`sys.stderr` at both the console and a new
    timestamped file under `data/logs/`. Returns the file's path, or None
    if the log directory could not be written (a read-only install, say) —
    in which case the run carries on with console output only.
    """
    log_dir = config.DATA_DIR / "logs"
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    log_path = log_dir / f"search-{stamp}-{mode}.log"
    try:
        log_dir.mkdir(parents=True, exist_ok=True)
        handle = open(log_path, "w", encoding="utf-8",
                      errors="replace", buffering=1)
    except OSError as exc:
        print(f"[log] could not open a run log ({exc}); "
              f"console output only.", flush=True)
        return None

    header = (f"# gratovo search run — {mode}\n"
              f"# started {datetime.datetime.now().isoformat(timespec='seconds')}\n"
              f"# argv: {sys.argv}\n\n")
    handle.write(header)

    sys.stdout = _Tee(sys.stdout, handle)
    sys.stderr = _Tee(sys.stderr, handle)
    _prune_old_logs(log_dir)
    return log_path


# How many channels `--catch-up-videos` asks `backfill_missing_videos` for per
# pass. Larger than `CFG.backfill_batch_size` (25, tuned for "one slice per
# keyword without turning a keyword into an unplanned hour") because this mode
# has nothing else to interleave with -- the whole point is to work through
# the backlog directly rather than a slice at a time between keywords.
#
# Was 200. Smaller now because `backfill_missing_videos` stamps each channel
# as it finishes rather than only in its `finally`, so a big batch no longer
# buys crash-safety -- and the outer loop's `[catchup] done=` line (the panel's
# authoritative position, see `video_catchup_controller.dart`) plus the
# backlog re-count and the Supabase push now land every few minutes instead of
# once an hour.
_CATCH_UP_BATCH_SIZE = 50


# How old a completed pull may be before another one is worth doing.
#
# A pull is one LIST of the catalog prefix plus a GET per unseen segment plus
# a GET per missing object -- seconds when nothing changed, and never anything
# a search has to wait for: the app runs `--pull-only` in the background while
# nobody is waiting, so a run usually finds one already done and starts
# searching immediately. A pull inside this window is skipped.
DEFAULT_PULL_MAX_AGE_SECONDS = 900


def _seconds_since(stamp):
    """Age in seconds of an ISO stamp written by `store._now`, or None."""
    if not stamp or stamp == store.EPOCH:
        return None
    try:
        parsed = time.strptime(stamp, "%Y-%m-%dT%H:%M:%SZ")
    except (TypeError, ValueError):
        return None
    return max(0.0, time.time() - calendar.timegm(parsed))


def pull_shared_state(conn, client, worker_id, max_age_seconds=0, force=False):
    """Apply every catalog segment this machine has not seen, then download
    the objects they named, unless that just happened.

    Returns True if a pull actually ran. A failure is reported and swallowed:
    the pipeline is local-first, and a run with stale shared state finds the
    same channels -- it just re-scrapes a few somebody else already had.
    """
    age = None if force else _seconds_since(
        store.get_sync_cursor(conn, store.PULL_CURSOR))
    if age is not None and age < max_age_seconds:
        print(f"Shared state was pulled {int(age)}s ago — skipping the pull.",
              flush=True)
        return False

    print(f"Connected to R2 ({client.bucket}) — pulling the catalog...", flush=True)
    try:
        segments, counts = sync.pull_catalog(conn, client)
        print(f"Catalog: {segments} new segment(s) {counts or ''}", flush=True)
        applied, missing, failed = sync.pull_blobs(conn, client)
        print(f"Objects: {applied} applied, {missing} not in the bucket yet, "
              f"{failed} failed.", flush=True)
    except sync.R2Error as exc:
        print(f"[sync] pull failed ({exc}); continuing with local data.", flush=True)
        return False
    # Only a pull that finished counts as one, so a failure above leaves the
    # next run (or the next prewarm) to try again rather than skipping on the
    # strength of a pull that did not land.
    store.set_sync_cursor(conn, store.PULL_CURSOR, store._now())
    return True


def share_local_changes(conn, client, worker_id, label="Shared"):
    """Upload every finished channel's object, then announce everything that
    changed in one catalog segment. Never raises: results are safe locally
    and the next call says it all again."""
    try:
        uploaded, current = sync.push_blobs(conn, client)
        ops = sync.write_segment(conn, client, worker_id)
        print(f"{label}: {uploaded} object(s) uploaded"
              f"{f', {current} already current' if current else ''}, "
              f"{ops} catalog op(s).", flush=True)
        return True
    except sync.R2Error as exc:
        print(f"[sync] share failed ({exc}); results are safe locally and will "
              f"be shared on the next attempt.", flush=True)
        return False


def load_keywords_file(path):
    """The list this run works, in order — nothing more.

    `data/keywords.json` is a run manifest, rewritten by whoever starts the
    run, so the person who typed five keywords gets a run of exactly those
    five and a progress counter that means something.
    """
    data = config.load_json_file(path)
    if data is None:
        print(f"No keywords file at {path} — nothing to run.")
        return []
    if not isinstance(data, list):
        return []
    seen = set()
    keywords = []
    for raw in data:
        if not isinstance(raw, str):
            continue
        trimmed = raw.strip()
        if trimmed and trimmed not in seen:
            seen.add(trimmed)
            keywords.append(trimmed)
    return keywords


def _load_ids_file(path):
    """`--archive-ids` / `--unarchive-ids` take a JSON file: either a list of
    channel ids, or a list of {"channel_id", "label"} objects."""
    data = config.load_json_file(pathlib.Path(path))
    if not isinstance(data, list):
        return []
    entries = []
    for item in data:
        if isinstance(item, str) and item.strip():
            entries.append({"channel_id": item.strip()})
        elif isinstance(item, dict) and item.get("channel_id"):
            entries.append(item)
    return entries


def main() -> int:
    parser = argparse.ArgumentParser(
        description="YouTube influencer discovery pipeline")
    parser.add_argument("--refetch", nargs="+", metavar="HANDLE",
                        help="Force-refresh specific channel(s) by handle now, then exit.")
    parser.add_argument("--status", action="store_true",
                        help="Print resolved paths and connection state, then exit.")
    parser.add_argument("--push-only", action="store_true",
                        help="Share what is already stored locally (upload finished "
                             "channels' objects, write a catalog segment) without searching.")
    parser.add_argument("--pull-only", "--pull-catalog", dest="pull_only", action="store_true",
                        help="Apply the catalog and download missing objects, then exit. "
                             "This is what the app runs in the background so a search "
                             "does not have to wait for it.")
    parser.add_argument("--pull-blobs", action="store_true",
                        help="Download and apply only the objects the local catalog already "
                             "names as newer than this machine's copy, then exit.")
    parser.add_argument("--no-pull", action="store_true",
                        help="Search without pulling shared state at all. The pull is "
                             "only what lets this run skip channels a teammate already "
                             "found; without it they are scraped again.")
    parser.add_argument("--force-pull", action="store_true",
                        help="Pull even if one finished inside the freshness window.")
    parser.add_argument("--pull-max-age", type=int, metavar="SECONDS",
                        default=DEFAULT_PULL_MAX_AGE_SECONDS,
                        help="Skip the pull if one finished less than this many seconds "
                             f"ago (default {DEFAULT_PULL_MAX_AGE_SECONDS}). "
                             "0 always pulls.")
    parser.add_argument("--no-sync", action="store_true",
                        help="Stay entirely local even if R2 is configured.")
    parser.add_argument("--archive-ids", metavar="FILE",
                        help="Archive the channels listed in this JSON file (ids, or "
                             "{channel_id, label} objects): tombstone them locally, delete "
                             "their objects, announce it. The app's sweep calls this.")
    parser.add_argument("--unarchive-ids", metavar="FILE",
                        help="Bring the channels listed in this JSON file back from the "
                             "archive, flagged for a fresh scrape, and announce it.")
    parser.add_argument("--bootstrap-r2", action="store_true",
                        help="One-time: upload every finished channel in this machine's "
                             "store and announce its whole history in the catalog. Also "
                             "imports data/migration/*.jsonl if present. Re-runnable.")
    parser.add_argument("--export-supabase", action="store_true",
                        help="One-time: save channel_archive, keywords and channel_keywords "
                             "from the old shared database to data/migration/*.jsonl, "
                             "before migrate_v2.sql drops them. Needs SUPABASE_URL and "
                             "SUPABASE_SERVICE_KEY in data/.env.local.")
    parser.add_argument("--catch-up-videos", action="store_true",
                        help="Fetch the normal ~15-video recent-uploads window for "
                             "every channel in the WHOLE local store that has never "
                             "had it (or was flagged with --force-refetch), not just "
                             "this run's own finds. Works through the backlog directly, "
                             "in large batches, until it is empty or --catch-up-limit "
                             "is reached. Exits when done; does not process keywords.")
    parser.add_argument("--catch-up-limit", type=int, default=3000, metavar="N",
                        help="Cap on how many channels one --catch-up-videos run "
                             "will touch (default 3000; 0 means no cap).")
    args = parser.parse_args()

    # Name the log after what this invocation is doing, so a folder full of
    # them is still readable.
    if args.refetch:
        mode = "refetch"
    elif args.push_only:
        mode = "push-only"
    elif args.pull_only:
        mode = "pull-only"
    elif args.pull_blobs:
        mode = "pull-blobs"
    elif args.status:
        mode = "status"
    elif args.catch_up_videos:
        mode = "catch-up"
    elif args.archive_ids:
        mode = "archive"
    elif args.unarchive_ids:
        mode = "unarchive"
    elif args.bootstrap_r2:
        mode = "bootstrap"
    elif args.export_supabase:
        mode = "export"
    else:
        mode = "run"
    log_path = setup_run_log(mode)
    if log_path is not None:
        print(f"Logging this run to {log_path}", flush=True)

    cfg = config.load()

    if args.status:
        print(cfg.describe())
        client = None if args.no_sync else r2.connect(cfg)
        print(f"connection    : {'OK' if client else 'local-only'}")
        return 0

    if args.export_supabase:
        try:
            counts = sync.export_supabase(cfg, config.MIGRATION_DIR)
        except (sync.SyncError, OSError) as exc:
            print(f"Export failed: {exc}")
            return 1
        print(f"Exported: {counts} -> {config.MIGRATION_DIR}")
        return 0

    conn = store.get_connection(str(config.DB_PATH))
    store.init_db(conn)

    # Before anything else, and in every mode -- including the background
    # `--pull-only` the app fires as it opens, which is what makes this
    # self-healing. See `store.reconcile_stale_runs`.
    closed = store.reconcile_stale_runs(conn)
    if closed:
        print(f"[runs] closed {closed} run(s) left open by a killed process.",
              flush=True)

    client = None if args.no_sync else r2.connect(cfg)
    if not client and not args.no_sync:
        print(f"R2 is not configured — running local-only.\n"
              f"  Add R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and "
              f"R2_BUCKET to {config.ENV_PATH} to share results with the team.")
    elif args.no_sync:
        print("Running local-only (--no-sync).")

    # A store that has never been bootstrapped into the bucket gets that
    # first, whatever this invocation was asked to do -- before a share can
    # upload what the old shared database only stamped, before a pull can
    # be skipped as "recent", before a search can start. On a teammate's
    # first launch after the upgrade this is the several-minute wait the
    # app shows as the first sync; once through, it never runs again.
    if client and not args.bootstrap_r2:
        try:
            first = sync.ensure_bootstrapped(conn, client, cfg.worker_id,
                                             migration_dir=config.MIGRATION_DIR)
            if first is not None:
                # The two lines the app reads to know whether anything changed.
                print(f"Catalog: {first['segments']} new segment(s)", flush=True)
                print(f"Objects: {first['applied']} applied, {first['uploaded']} uploaded, "
                      f"{first['ops']} op(s) announced.", flush=True)
        except sync.R2Error as exc:
            print(f"[sync] first sync failed ({exc}); will resume next time.", flush=True)
            if args.pull_only or args.push_only:
                return 1

    try:
        # ---- sync-only modes --------------------------------------------
        if args.pull_only:
            if not client:
                print("Nothing to pull from.")
                return 1 if args.force_pull else 0
            pulled = pull_shared_state(conn, client, cfg.worker_id,
                                       max_age_seconds=args.pull_max_age,
                                       force=args.force_pull)
            # A forced pull that did not run can only mean it failed, which the
            # app's sync button wants to tell apart from "pulled".
            return 0 if pulled or not args.force_pull else 1

        if args.pull_blobs:
            if not client:
                print("Nothing to pull from.")
                return 1
            try:
                applied, missing, failed = sync.pull_blobs(conn, client)
            except sync.R2Error as exc:
                print(f"[sync] pull failed ({exc}).")
                return 1
            print(f"Objects: {applied} applied, {missing} not in the bucket yet, "
                  f"{failed} failed.", flush=True)
            return 0 if not failed else 1

        if args.push_only:
            if not client:
                print("Nothing to share to — R2 is not configured.")
                return 1
            return 0 if share_local_changes(conn, client, cfg.worker_id) else 1

        if args.archive_ids:
            entries = _load_ids_file(args.archive_ids)
            n = sync.archive_channels(conn, client, cfg.worker_id, entries)
            print(f"Archived {n} channel(s)"
                  f"{'' if client else ' locally (R2 not configured)'}.", flush=True)
            return 0

        if args.unarchive_ids:
            ids = [e["channel_id"] for e in _load_ids_file(args.unarchive_ids)]
            n = sync.unarchive_channels(conn, client, cfg.worker_id, ids)
            print(f"Restored {n} channel(s) from the archive; they will be "
                  f"re-fetched on the next backfill.", flush=True)
            return 0

        if args.bootstrap_r2:
            if not client:
                print("R2 is not configured — nothing to bootstrap into.")
                return 1
            try:
                # Re-runnable by hand, so straight to `bootstrap` rather than
                # `ensure_bootstrapped`; the same lock keeps the app's own
                # launches out of the way meanwhile.
                with sync.bootstrap_lock(conn):
                    sync.bootstrap(conn, client, cfg.worker_id,
                                   migration_dir=config.MIGRATION_DIR)
                    store.set_sync_cursor(conn, store.BOOTSTRAP_CURSOR, store._now())
            except sync.R2Error as exc:
                print(f"[bootstrap] failed ({exc}); re-run to continue where it left off.")
                return 1
            return 0

        # ---- everything below scrapes ------------------------------------
        if client and args.no_pull:
            print("Not pulling (--no-pull); channels a teammate already found "
                  "may be scraped again.")
        elif client:
            pull_shared_state(conn, client, cfg.worker_id,
                              max_age_seconds=args.pull_max_age,
                              force=args.force_pull)

        if args.refetch:
            pipeline.configure(cfg)
            pipeline.run_manual_refetch(conn, args.refetch)
            if client:
                share_local_changes(conn, client, cfg.worker_id)
            return 0

        if args.catch_up_videos:
            pipeline.configure(cfg)
            cap = args.catch_up_limit or None
            run_id = store.start_run(conn, 0, kind="catch-up")
            remaining = store.count_channels_needing_videos(conn)
            print(f"{remaining} channel(s) missing their recent uploads.", flush=True)
            waiting = store.count_channels_awaiting_peers(conn)
            if waiting:
                print(f"{waiting} channel(s) were read on a teammate's machine and are "
                      f"waiting for their copy to arrive -- not read here.", flush=True)
            done = 0
            # The machine-readable half of the line above -- see
            # `catchUpProgress` in `video_catchup_controller.dart`.
            print(f"[catchup] done=0 total={remaining}", flush=True)
            try:
                while remaining > 0 and (cap is None or done < cap):
                    batch = min(_CATCH_UP_BATCH_SIZE, remaining)
                    if cap is not None:
                        batch = min(batch, cap - done)
                    pipeline.backfill_missing_videos(conn, run_id, limit=batch,
                                                    emit_io=True)
                    after = store.count_channels_needing_videos(conn)
                    processed = remaining - after
                    done += processed
                    remaining = after
                    print(f"[catchup] done={done} total={done + remaining}",
                          flush=True)
                    # Usually the batch just finished, in seconds. Not always:
                    # the first share after an upgrade that reset the upload
                    # stamps is every channel this machine ever finished --
                    # thousands, tens of minutes -- and `push_blobs` reports
                    # its position (`[sync-io]`) so the app can show that
                    # phase for what it is.
                    if client:
                        share_local_changes(conn, client, cfg.worker_id)
                    if processed <= 0:
                        print("\nNo progress on the backlog this pass — stopping "
                              "to avoid spinning.", flush=True)
                        break
                if cap is not None and done >= cap and remaining > 0:
                    print(f"\nReached the {cap}-channel cap for this run "
                          f"({remaining} still left for next time).", flush=True)
                store.finish_run(conn, run_id, status="done")
                print(f"\nCatch-up complete — {done} channel(s) fetched.", flush=True)
            except KeyboardInterrupt:
                print("\nInterrupted — everything up to the last commit is already "
                      "saved.", flush=True)
                store.finish_run(conn, run_id, status="interrupted")
            except pipeline.SearchBlocked as exc:
                print(f"\nStopped: {exc}\n"
                      f"  Nothing is lost — every channel finished so far is saved.",
                      flush=True)
                store.finish_run(conn, run_id, status="interrupted")
            finally:
                if client:
                    share_local_changes(conn, client, cfg.worker_id, label="Final share")
            return 0

        pipeline.configure(cfg)
        # The run works exactly the list it was handed, in the order it was
        # handed it. Two people running the same keyword at the same time is
        # fine — it costs a little duplicate scraping and lands on the same
        # rows.
        queued = load_keywords_file(config.KEYWORDS_PATH)
        store.seed_keywords(conn, queued)
        total = len(queued)
        print(f"{total} keyword(s) to run.")

        # An explicit manual start point (Search screen's "Start at #"),
        # separate from the app's own completed-keyword resume tracking --
        # this is a one-off "skip straight to here", not a record of anything
        # being done. 1-based, same as the `[keyword i/n]` protocol below.
        start_at = cfg.run_config.get("start_at_index")
        try:
            start_at = max(1, min(int(start_at), total)) if start_at else 1
        except (TypeError, ValueError):
            start_at = 1
        working = queued[start_at - 1:]
        if start_at > 1:
            print(f"Starting at keyword {start_at}/{total} "
                  f"(skipping the first {start_at - 1}).", flush=True)

        run_id = store.start_run(conn, total)

        # What this run has to rotate through and how it will use it, once, up
        # front -- the app's "AWS / proxies" line starts from this.
        pool = pipeline.scrapetube.get_pool()
        workers = min(cfg.parallel_workers, max(1, pool.non_direct_count))
        described = pool.describe()
        print(pipeline.scrapetube.proxy_pool.format_route_pool(
            gateways=described["gateways"], proxies=described["proxies"],
            direct=described["direct"], gap=described["min_gap"],
            workers=workers, parallel=workers > 1, pacing=cfg.pacing_profile),
            flush=True)

        done = 0
        exit_code = 0

        def start_keyword(keyword_conn, position, keyword):
            # The app's only way to know which keyword is in flight.
            # Parsed by `search_progress_parser.dart` — keep the shape.
            print(f"[keyword {position}/{total}] started: {keyword}", flush=True)
            store.mark_keyword_started(
                keyword_conn, keyword, cfg.worker_id, cfg.search_settings_snapshot())

        def finish_keyword(position, keyword):
            nonlocal done
            done += 1
            store.update_run_progress(conn, run_id, keywords_done=done)
            print(f"[keyword {position}/{total}] done: {keyword}", flush=True)
            # Share after every keyword, not only at the end: a teammate's
            # list fills in as the run goes, and an interrupted run has
            # already shared everything up to the last keyword.
            if client:
                share_local_changes(conn, client, cfg.worker_id)

        try:
            if workers > 1:
                print(f"Parallel search: {workers} keyword(s) at a time, one per "
                      f"rotating connection, at the Normal pace.", flush=True)

                def work(worker_conn, position, keyword):
                    start_keyword(worker_conn, position, keyword)
                    pipeline.process_keyword(worker_conn, run_id, keyword)

                writer = parallel.LineWriter(sys.stdout)
                real_stdout, sys.stdout = sys.stdout, writer
                try:
                    parallel.run_keywords(
                        list(enumerate(working, start_at)), workers, work,
                        finish_keyword,
                        connect=lambda: store.get_connection(str(config.DB_PATH)),
                        writer=writer)
                finally:
                    writer.drain()
                    sys.stdout = real_stdout
            else:
                for position, keyword in enumerate(working, start_at):
                    start_keyword(conn, position, keyword)
                    pipeline.process_keyword(conn, run_id, keyword)
                    finish_keyword(position, keyword)

            store.finish_run(conn, run_id, status="done")
            print("\nRun complete.", flush=True)
        except KeyboardInterrupt:
            print("\nInterrupted — everything up to the last commit is already saved.",
                  flush=True)
            store.finish_run(conn, run_id, status="interrupted")
        except pipeline.SearchBlocked as exc:
            # A response `_request`'s own indefinite retry can't recover from
            # (see scrapetube.BlockedError's doc comment) rather than an
            # ordinary rate limit -- those are retried forever now and never
            # reach here. Still rare enough, and different enough from a
            # deliberate Stop, that it gets its own non-zero exit code: the
            # app reads `runs.status` for what to show, but it decides whether
            # to treat the run as a clean finish (and throw away this
            # session's progress markers) from the exit code, and a 0 here
            # would read as "nothing left to resume."
            exit_code = 2
            print(f"\nStopped: {exc}\n"
                  f"  Nothing is lost — every keyword finished so far is saved.\n"
                  f"  Leave it an hour or so before starting another run, and\n"
                  f"  consider widening the delay ranges in data/settings.json\n"
                  f"  (or lowering the handle limit) if this keeps happening.",
                  flush=True)
            store.finish_run(conn, run_id, status="interrupted")
        finally:
            summary = pipeline.scrapetube.get_pool().route_line(force=True)
            if summary:
                print(summary, flush=True)
            if client:
                share_local_changes(conn, client, cfg.worker_id, label="Final share")
        return exit_code
    finally:
        conn.close()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except BaseException:
        # Anything that got out of main() uncaught. Write it here first so it
        # is flushed into the run log with a marker.
        print("\n[crash] the run stopped on an uncaught exception:", flush=True)
        traceback.print_exc()
        sys.stdout.flush()
        sys.stderr.flush()
        raise SystemExit(1)
