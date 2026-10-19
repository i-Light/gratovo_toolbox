#!/usr/bin/env python3
"""
Fills in what the search pipeline did not collect, and retries what it failed
to collect. Read-only by default: it tells you what it would do before it
spends a single unit of YouTube quota.

WHY THIS IS NOT PART OF search.py
---------------------------------
`search.py` discovers channels. It only ever fetches a channel or a video it
has never seen. That is the right behaviour for discovery -- re-asking YouTube
about rows you already have would burn the daily quota on nothing -- but it
means a row written before a field was being collected keeps its blank forever,
and a row whose fetch failed at the time stays failed forever. This tool is the
deliberate, separately-budgeted second pass over exactly those rows.

THREE JOBS, KEPT SEPARATE ON PURPOSE
------------------------------------
  channels   Re-fetch channel metadata (country, subscribers, name, ...) for
             channels missing it.
  videos     Re-fetch video metadata (view count, publish date, title) for
             videos missing it or whose fetch was recorded as failed.
  backfill   Reach further back than the 15 recent uploads discovery stores, so
             the CRM calculator has a wide enough basis to average over. This
             is the only job that adds NEW rows rather than filling existing
             ones.

STALE vs GENUINELY ABSENT
-------------------------
A blank field has two very different causes, and treating them the same wastes
quota. For each field the tool finds the earliest fetch at which that field was
ever actually recorded -- the coverage watermark -- and splits the blanks:

  * fetched before the watermark  -> the pipeline was not collecting the field
                                     yet. A re-fetch will almost certainly fill
                                     it in. THESE are what the tool targets.
  * fetched at or after it        -> a fetch that WAS collecting the field
                                     still came back empty, so YouTube does not
                                     expose it for that row. Skipped, unless
                                     you pass --include-absent.

USAGE
-----
    python tools/enrich.py                       # report only, spends nothing
    python tools/enrich.py --apply               # do the work
    python tools/enrich.py --apply --only videos
    python tools/enrich.py --apply --handle @someone --handle @another
    python tools/enrich.py --apply --months 3    # widen the backfill window
    python tools/enrich.py --apply --max-api-calls 40
    python tools/enrich.py --apply --include-absent
    python tools/enrich.py --apply --no-sync     # keep it local

Everything is written to the local store first, exactly like a search run, and
pushed to Supabase afterwards unless --no-sync. Interrupting it loses at most
the batch in flight.
"""

from __future__ import annotations

import argparse
import math
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

# tools/ sits beside gratovo/, so the package is one level up.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gratovo import config, r2, store, sync  # noqa: E402

JOBS = ("channels", "videos", "backfill")

# Which fields each job tries to fill. Ordered so the report reads in the same
# order every time rather than in dict-iteration order.
CHANNEL_FIELDS = ("country", "subscribers", "name")
VIDEO_FIELDS = ("view_count", "published_at", "title")

# channels().list and videos().list both accept 50 ids per call and cost one
# quota unit per call regardless of how many ids are in it.
PER_CALL = config.BATCH_SIZE

# A backfill asks scrapetube (free, no quota) for ids and only then spends
# quota on their metadata. This caps how many ids it will pull for one channel
# so a daily uploader cannot swallow the whole budget on its own.
MAX_BACKFILL_IDS = 200


# --------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------
def _parse_iso(text):
    """Tolerant enough for both what YouTube returns and what store.py writes."""
    if not text:
        return None
    cleaned = str(text).strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(cleaned)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def calls_for(n):
    return math.ceil(n / PER_CALL) if n else 0


def plural(n, word):
    return f"{n:,} {word}{'' if n == 1 else 's'}"


class Budget:
    """A hard ceiling on API calls, checked before every batch.

    The YouTube quota is a daily allowance shared with the search runs, so an
    enrichment pass that quietly drains it breaks tomorrow's discovery. Running
    out is reported as a normal, resumable stopping point -- everything already
    fetched is already committed, and the next run picks up where this one
    stopped, because the rows it filled no longer match the queries.
    """

    def __init__(self, limit):
        self.limit = limit
        self.used = 0

    def take(self):
        if self.limit is not None and self.used >= self.limit:
            return False
        self.used += 1
        return True

    @property
    def exhausted(self):
        return self.limit is not None and self.used >= self.limit


# --------------------------------------------------------------------------
# Planning -- the same queries the report and the apply path both use
# --------------------------------------------------------------------------
def plan_channels(conn, handles, include_absent, limit=None):
    """{handle: channel_id} for every channel worth re-fetching.

    A channel whose fetch is recorded as failed is included regardless of the
    watermark, for the same reason a failed video is: a failure says nothing
    about what YouTube holds.
    """
    targets = {}
    for field in CHANNEL_FIELDS:
        watermark = None if include_absent else store.field_coverage_watermark(
            conn, "channels", field)
        targets.update(store.get_channels_missing(
            conn, [field], handles=handles, before=watermark))
    for handle, channel_id in store.get_channels_failed(conn, handles).items():
        targets.setdefault(handle, channel_id)
    if limit:
        targets = dict(list(targets.items())[:limit])
    return targets


def plan_videos(conn, handles, include_absent, limit=None):
    """[(video_id, channel_id), ...] for every video worth re-fetching."""
    seen, targets = set(), []
    for field in VIDEO_FIELDS:
        watermark = None if include_absent else store.field_coverage_watermark(
            conn, "videos", field)
        for video_id, channel_id in store.get_videos_needing_refetch(
                conn, [field], handles=handles, before=watermark):
            if video_id in seen:
                continue
            seen.add(video_id)
            targets.append((video_id, channel_id))
    return targets[:limit] if limit else targets


# --------------------------------------------------------------------------
# Report
# --------------------------------------------------------------------------
def survey(conn, handles, include_absent):
    """What is missing, split into 'worth re-fetching' and 'YouTube has none'.

    Returns the same structure the apply path works from, so the report can
    never disagree with what actually happens next.
    """
    result = {"channels": {}, "videos": {}, "watermarks": {}}

    for field in CHANNEL_FIELDS:
        watermark = store.field_coverage_watermark(conn, "channels", field)
        result["watermarks"]["channels." + field] = watermark
        total, stale = store.count_missing(
            conn, "channels", field, None if include_absent else watermark)
        result["channels"][field] = {"total": total, "targeted": stale}

    for field in VIDEO_FIELDS:
        watermark = store.field_coverage_watermark(conn, "videos", field)
        result["watermarks"]["videos." + field] = watermark
        total, stale = store.count_missing(
            conn, "videos", field, None if include_absent else watermark)
        result["videos"][field] = {"total": total, "targeted": stale}

    result["channels_failed"] = store.count_failed(conn, "channels")
    result["videos_failed"] = store.count_failed(conn, "videos")
    result["channel_total"] = store.count_channels(conn)
    result["video_total"] = store.count_videos(conn)

    # The actual work sets, so the estimate below is a count of real rows.
    result["channel_targets"] = plan_channels(conn, handles, include_absent)
    result["video_targets"] = plan_videos(conn, handles, include_absent)
    return result


def _print_field_line(field, counts, watermark, include_absent):
    total, targeted = counts["total"], counts["targeted"]
    line = "    {:<16} {:>6,} blank".format(field, total)
    if total and not include_absent and watermark:
        absent = total - targeted
        line += "   {:,} stale (re-fetchable), {:,} absent on YouTube".format(
            targeted, absent)
    print(line)


def print_report(data, handles, include_absent, months):
    scope = "{} channel(s)".format(len(handles)) if handles else "every channel"
    print("\nSurveying {} ({}, {} stored)\n".format(
        scope, plural(data["channel_total"], "channel"),
        plural(data["video_total"], "video")))

    print("  CHANNELS")
    for field in CHANNEL_FIELDS:
        _print_field_line(field, data["channels"][field],
                          data["watermarks"]["channels." + field], include_absent)
    if data["channels_failed"]:
        print("    {:<16} {:>6,}   <- the fetch never succeeded, retry".format(
            "fetch failed", data["channels_failed"]))

    print("\n  VIDEOS")
    for field in VIDEO_FIELDS:
        _print_field_line(field, data["videos"][field],
                          data["watermarks"]["videos." + field], include_absent)
    if data["videos_failed"]:
        print("    {:<16} {:>6,}   <- the fetch never succeeded, retry".format(
            "fetch failed", data["videos_failed"]))

    channels = len(data["channel_targets"])
    videos = len(data["video_targets"])
    print("\n  WOULD RE-FETCH  {} and {}  ({} API call(s))".format(
        plural(channels, "channel"), plural(videos, "video"),
        calls_for(channels) + calls_for(videos)))
    print("  BACKFILL        would widen every in-scope channel to {} month(s) of\n"
          "                  uploads; its cost depends on how much is already stored,\n"
          "                  so it is counted as it runs rather than guessed here."
          .format(months))
    if not include_absent:
        print("\n  Rows YouTube genuinely has no value for are excluded. "
              "Pass --include-absent\n  to retry them anyway.")


# --------------------------------------------------------------------------
# Jobs
# --------------------------------------------------------------------------
def enrich_channels(conn, pipeline, targets, budget):
    """Re-fetches channel metadata in batches of PER_CALL."""
    if not targets:
        print("  channels : nothing to re-fetch")
        return 0

    items = list(targets.items())
    filled = 0
    for start in range(0, len(items), PER_CALL):
        if not budget.take():
            print("  channels : stopped at the API-call budget "
                  "({:,} left for next time)".format(len(items) - start))
            break
        batch = dict(items[start:start + PER_CALL])
        fetched = pipeline.get_channels_data(batch)
        # save_channels marks anything requested but not returned as failed,
        # rather than leaving it looking untouched -- so a channel that has
        # been deleted stops being retried on every future run.
        store.save_channels(conn, fetched, batch)
        filled += len(fetched)
        print("  channels : {:,}/{:,} returned ({:,}/{:,} done)".format(
            len(fetched), len(batch), start + len(batch), len(items)))
    return filled


def enrich_videos(conn, pipeline, targets, budget):
    """Re-fetches video metadata in batches of PER_CALL."""
    if not targets:
        print("  videos   : nothing to re-fetch")
        return 0

    video_to_channel = {vid: cid for vid, cid in targets}
    ids = [vid for vid, _ in targets]
    filled = 0
    for start in range(0, len(ids), PER_CALL):
        if not budget.take():
            print("  videos   : stopped at the API-call budget "
                  "({:,} left for next time)".format(len(ids) - start))
            break
        batch = ids[start:start + PER_CALL]
        fetched = pipeline.get_videos_data(batch)
        store.save_videos(conn, fetched, batch, video_to_channel)
        # A repaired video changes what the channel's shared object should
        # hold, and the object's version is the channel's stamp -- so the
        # stamp moves, which is what makes the next share re-upload it (and
        # recomputes the rollups here in the same step).
        store.mark_channels_videos_fetched(
            conn, {video_to_channel[vid] for vid in batch if vid in fetched})
        filled += len(fetched)
        print("  videos   : {:,}/{:,} returned ({:,}/{:,} done)".format(
            len(fetched), len(batch), start + len(batch), len(ids)))
    return filled


def _ids_needed_for_window(stored_count, oldest, months):
    """How many ids to ask scrapetube for to reach `months` back.

    Estimated from this channel's own observed upload rate rather than a fixed
    number, because "one more month" is a wildly different amount of video for
    a daily uploader than for a monthly one. Scraping ids costs no quota, so
    over-asking is cheap; the metadata fetch afterwards is what is budgeted,
    and that only ever runs on ids not already stored.
    """
    target_days = months * 30
    oldest_dt = _parse_iso(oldest)
    if not oldest_dt or stored_count < 2:
        return MAX_BACKFILL_IDS

    covered_days = max((datetime.now(timezone.utc) - oldest_dt).days, 1)
    if covered_days >= target_days:
        return 0

    per_day = stored_count / covered_days
    # 1.4x headroom: uploads are bursty, and an under-ask leaves the window
    # silently short rather than obviously so.
    wanted = int(per_day * target_days * 1.4) + 5
    return min(max(wanted, stored_count + 5), MAX_BACKFILL_IDS)


def backfill_videos(conn, pipeline, channels, months, budget):
    """Widens each channel's stored uploads to cover `months` of history.

    Two stages, and only the second costs quota: scrapetube lists ids for free,
    and only the ids not already stored are sent to videos().list.
    """
    if not channels:
        print("  backfill : no channels in scope")
        return 0

    cutoff = datetime.now(timezone.utc) - timedelta(days=months * 30)
    pending, video_to_channel = [], {}
    widened = 0

    for handle, channel_id in channels.items():
        stored_count, oldest, _ = store.get_channel_video_span(conn, channel_id)
        wanted = _ids_needed_for_window(stored_count, oldest, months)
        if wanted == 0:
            continue

        known = store.get_existing_video_ids(conn, channel_id)
        try:
            scraped = pipeline.get_recent_video_ids(handle, limit=wanted)
        except pipeline.SearchBlocked:
            # Distinct from "this one channel would not parse": YouTube has
            # stopped answering us at all, and every further channel in this
            # loop would be another request against a throttled IP. Let it out.
            raise
        except Exception as exc:                      # scrapetube is HTML-shaped
            print("  backfill : could not list uploads for {} ({})".format(handle, exc))
            continue

        fresh = [vid for vid in scraped if vid not in known]
        if not fresh:
            continue
        widened += 1
        for vid in fresh:
            video_to_channel[vid] = channel_id
            pending.append(vid)
        print("  backfill : {} -> {} (had {:,} back to {})".format(
            handle, plural(len(fresh), "new upload"), stored_count,
            (oldest or "nothing")[:10]))
        # Same pacing the search run uses: these are HTML requests, and a burst
        # of them from one IP is the thing that gets a machine blocked.
        pipeline.paced_delay(pipeline.CFG.delay("recent_videos_delay"))

    if not pending:
        print("  backfill : every in-scope channel already covers the window")
        return 0

    saved = 0
    for start in range(0, len(pending), PER_CALL):
        if not budget.take():
            print("  backfill : stopped at the API-call budget "
                  "({:,} new video(s) left for next time)".format(len(pending) - start))
            break
        batch = pending[start:start + PER_CALL]
        fetched = pipeline.get_videos_data(batch)
        store.save_videos(conn, fetched, batch, video_to_channel)
        saved += len(fetched)

    # The channels touched now have videos on record, so mark them fetched --
    # otherwise a later search run would treat them as never having had any.
    store.mark_channels_videos_fetched(conn, set(video_to_channel.values()))
    print("  backfill : saved {} across {} (cutoff {})".format(
        plural(saved, "video"), plural(widened, "channel"),
        cutoff.strftime("%Y-%m-%d")))
    return saved


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------
def _fail(message):
    print(message, file=sys.stderr)
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true",
                        help="actually fetch and save. Without this, nothing is written "
                             "and no quota is spent.")
    parser.add_argument("--only", action="append", default=[], choices=JOBS,
                        metavar="JOB",
                        help="run just one job ({}); repeatable".format(", ".join(JOBS)))
    parser.add_argument("--handle", action="append", default=[], metavar="HANDLE",
                        help="restrict to specific channel handle(s); repeatable")
    parser.add_argument("--include-absent", action="store_true",
                        help="also retry fields a completed fetch already came back "
                             "empty for (YouTube most likely has no value)")
    parser.add_argument("--months", type=int, default=2, metavar="N",
                        help="how far back the backfill job should reach (default 2)")
    parser.add_argument("--limit", type=int, default=None, metavar="N",
                        help="cap how many rows each re-fetch job touches")
    parser.add_argument("--max-api-calls", type=int, default=100, metavar="N",
                        help="hard ceiling on YouTube API calls, shared across jobs "
                             "(default 100; 0 means no ceiling)")
    parser.add_argument("--no-sync", action="store_true",
                        help="do not push the results to Supabase")
    args = parser.parse_args()

    jobs = tuple(args.only) if args.only else JOBS
    handles = ["@" + h.lstrip("@") for h in args.handle] or None
    if args.months < 1:
        return _fail("--months must be at least 1.")

    cfg = config.load()
    conn = store.get_connection(str(config.DB_PATH))
    store.init_db(conn)

    try:
        if handles:
            known = store.get_channels(conn, handles)
            unknown = [h for h in handles if h not in known]
            if unknown:
                print("Not in the local store, ignoring: " + ", ".join(unknown))
            if not known:
                return _fail("None of the given handles are in the local store. "
                             "Run a search for them first.")
            handles = list(known)

        before = survey(conn, handles, args.include_absent)
        print_report(before, handles, args.include_absent, args.months)

        if not args.apply:
            print("\nReport only -- nothing was written and no quota was spent.")
            print("Re-run with --apply to do the work.")
            return 0

        # Importing the pipeline is what pulls in googleapiclient and
        # scrapetube, so a report on a machine with neither still works.
        from gratovo import pipeline
        pipeline.configure(cfg)

        budget = Budget(args.max_api_calls or None)
        started = time.time()
        print("\nApplying (ceiling: {})".format(
            "no limit" if budget.limit is None
            else "{} API calls".format(budget.limit)))

        if "channels" in jobs:
            enrich_channels(
                conn, pipeline,
                plan_channels(conn, handles, args.include_absent, args.limit),
                budget)
        if "videos" in jobs:
            enrich_videos(
                conn, pipeline,
                plan_videos(conn, handles, args.include_absent, args.limit),
                budget)
        if "backfill" in jobs:
            backfill_videos(
                conn, pipeline, store.get_channels(conn, handles),
                args.months, budget)

        print("\nUsed {} in {:.0f}s.".format(
            plural(budget.used, "API call"), time.time() - started))
        if budget.exhausted:
            print("Budget reached -- re-run tomorrow to continue where this stopped.")

        if args.no_sync:
            print("Local only (--no-sync). Run `python search.py --push-only` to share.")
        else:
            client = r2.connect(cfg)
            if client:
                try:
                    uploaded, _ = sync.push_blobs(conn, client)
                    ops = sync.write_segment(conn, client, cfg.worker_id)
                    print("Shared: {} object(s) uploaded, {} catalog op(s).".format(
                        uploaded, ops))
                except sync.R2Error as exc:
                    print("[sync] share failed ({}); everything is safe locally. "
                          "Run `python search.py --push-only` when back online."
                          .format(exc))
            else:
                print("R2 not configured -- results are local only.")

        # A second survey, so the run ends by showing what it actually changed
        # rather than only what it intended to.
        after = survey(conn, handles, args.include_absent)
        print("\nAfter")
        for label, (table, name) in (
                ("channel country", ("channels", "country")),
                ("video view counts", ("videos", "view_count")),
                ("video publish dates", ("videos", "published_at"))):
            was = before[table][name]["total"]
            now = after[table][name]["total"]
            print("  {:<20} {:,} blank -> {:,} blank ({:+,})".format(
                label, was, now, now - was))
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
