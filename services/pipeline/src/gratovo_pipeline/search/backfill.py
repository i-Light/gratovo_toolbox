"""The backlog: channels anywhere in the store still missing their recent uploads.

A keyword only reads uploads for its own fresh finds, so a channel that missed its turn (a crash,
a block, a stop, the auto-clean delay) is "known" to every later keyword and never read again.
The backlog finds it by scanning the whole store, oldest first, a slice after every keyword: a run
of one keyword makes as much progress on it per keyword as a run of a hundred.

Not limited to the run's countries, on purpose. The country rule was the reason most of these
channels had no uploads, and scoping the backlog the same way left them unmeasured for good (the
team's store had 5,059 channels no run could reach). Without uploads there is no median views, and
without that the auto-clean rule can't judge a channel's size. Which countries to look for is a
question for the search; which channels found are worth measuring is not.
"""

from __future__ import annotations

import threading

from gratovo_pipeline import store
from gratovo_pipeline.search.context import ChannelUnreadableError, Search
from gratovo_pipeline.search.uploads import UploadCollector

# One worker at a time: the backlog is one shared list, and two workers taking a slice at once
# would read the same channels.
BACKLOG_LOCK = threading.Lock()


def take_turn(search: Search) -> bool:
    """Works a slice unless another worker is; returns whether this one did."""
    if not BACKLOG_LOCK.acquire(blocking=False):
        search.info("Another worker is catching up the video backlog.")
        return False
    try:
        backfill_missing_videos(search)
    finally:
        BACKLOG_LOCK.release()
    return True


def backfill_missing_videos(search: Search, limit: int | None = None) -> int:
    """Reads uploads for up to `limit` backlog channels (the run's slice size by default), each
    stamped as it finishes. Returns how many channels it read."""
    size = search.cfg.backfill_batch_size if limit is None else limit
    if size <= 0:
        return 0
    conn = search.conn
    backlog = store.get_video_backfill_candidates(conn, size)
    if not backlog:
        return 0
    before = store.count_channels_needing_videos(conn)
    search.info(f"Reading uploads for {len(backlog)} older channel(s) (backlog: {before}).")

    collector = UploadCollector(search)
    sweep = search.source.sweep()
    try:
        for handle, channel_id in backlog.items():
            try:
                video_ids = sweep.recent_video_ids(handle)
            except ChannelUnreadableError:
                # Not stamped: it steps aside for longer each failure, and leaves the backlog
                # after store.READ_GIVE_UP of them in a row.
                store.defer_unreadable_channel(conn, channel_id)
                search.pacer.pause("recent_videos_delay")
                continue
            search.pacer.pause("recent_videos_delay")
            collector.add(channel_id, video_ids)
            # Persist what is complete now: the loop may not come back from the next read.
            collector.stamp_finished()
    finally:
        try:
            collector.finish()
        finally:
            sweep.close()
    search.info(
        f"Backlog: read {collector.touched} channel(s); {max(0, before - collector.touched)} left."
    )
    return collector.touched
