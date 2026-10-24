"""One keyword, end to end: find channels, drop the known and archived ones, read the details of
the rest, apply the auto-clean gate, read the uploads of what is left in the run's countries, and
tell the app what was kept, swept and delayed.

Everything it writes is committed as it goes. A stop or a block mid-sweep keeps what was read
(saved, stamped and announced); the keyword isn't marked done, so a resume runs it again and
finds those channels as known.
"""

from __future__ import annotations

import dataclasses
from collections.abc import Mapping

from gratovo_pipeline import store
from gratovo_pipeline.protocol import Outcome
from gratovo_pipeline.search import auto_clean, backfill
from gratovo_pipeline.search.context import Search
from gratovo_pipeline.search.uploads import UploadCollector
from gratovo_pipeline.youtube import BATCH_SIZE, ChannelInfo


@dataclasses.dataclass(frozen=True)
class KeywordResult:
    found: int  # every live channel the keyword surfaced, known ones included
    kept: int  # new channels read in full
    swept: int
    delayed: int


def process_keyword(search: Search, keyword: str) -> KeywordResult:
    cfg, conn = search.cfg, search.conn
    search.info(
        f'Searching YouTube for "{keyword}": up to {cfg.handles_limit} {cfg.results_type} '
        f"results, by {cfg.sort_by.replace('_', ' ')}."
    )
    discovered = search.source.find_channels(keyword, limit=cfg.handles_limit)
    search.info(f"Found {len(discovered)} channel(s).")
    search.pacer.pause("found_channels_delay", reason="reading the results")

    # What this keyword won't touch is decided here, before a single detail is fetched:
    # - archived: the team already rejected it; re-adding it spends quota and asks someone to
    #   vet it twice. The keyword is still noted on its tombstone, so it scores the keyword.
    # - known: already held; nothing below can learn anything new about it. It gets the link
    #   saying this keyword found it too. Refreshing a stale channel is a separate job.
    fresh, known, archived = store.partition_discovered(conn, discovered)
    store.record_keyword_links(conn, known, keyword)
    store.record_archive_keyword_links(conn, archived, keyword, cfg.handles_limit)
    for handle, channel_id in fresh.items():
        store.record_channel_discovery(conn, handle, channel_id, keyword)
    if known or archived:
        search.info(
            f"Skipped {len(known)} known and {len(archived)} archived channel(s); {len(fresh)} new."
        )
    # A question about the keyword: it doesn't shrink because another run got there first, or
    # because the gate archived some of what it found.
    found = len(fresh) + len(known)

    info = _read_details(search, store.get_channels_to_fetch(conn, fresh))

    gate = auto_clean.apply_gate(
        conn, cfg.auto_clean, fresh, info, keyword=keyword, handles_limit=cfg.handles_limit
    )
    for swept in gate.swept:
        details = info.get(swept.handle)
        search.events.channel(
            keyword=keyword,
            channel_id=swept.channel_id,
            handle=swept.handle,
            name=(details or {}).get("Name") or swept.handle,
            subscribers=swept.subscribers,
            median_views=None,
            country=(details or {}).get("Country"),
            outcome="swept",
        )
    for handle in gate.delayed:
        _announce(search, keyword, fresh[handle], "delayed")
    if gate.swept or gate.delayed or gate.unknown:
        search.info(
            f"Auto-clean: {len(gate.swept)} archived, {len(gate.delayed)} left for the backlog, "
            f"{gate.unknown} left alone (subscriber count unknown)."
        )

    needing = store.get_channels_needing_videos(conn, fresh)
    for handle in gate.delayed:
        needing.pop(handle, None)
    reading = {h: cid for h, cid in needing.items() if _in_countries(search, info.get(h), cid)}
    kept, signal_swept = _read_uploads(search, keyword, reading)

    store.mark_keyword_done(conn, keyword, channels_found=found)
    outside = len(needing) - len(reading)
    search.info(
        f'"{keyword}" done: {found} found, {len(kept)} kept'
        + (f", {outside} outside the countries." if outside else ".")
    )
    return KeywordResult(
        found=found,
        kept=len(kept),
        swept=len(gate.swept) + len(signal_swept),
        delayed=len(gate.delayed),
    )


def after_keyword(search: Search) -> None:
    """Between keywords: a slice of the backlog, then sometimes a longer rest. Separate from the
    keyword so the app hears it is done as soon as it is saved."""
    backfill.take_turn(search)
    search.pacer.cooldown()


def _read_details(search: Search, to_fetch: Mapping[str, str]) -> dict[str, ChannelInfo]:
    found: dict[str, ChannelInfo] = {}
    items = list(to_fetch.items())
    for start in range(0, len(items), BATCH_SIZE):
        batch = dict(items[start : start + BATCH_SIZE])
        search.info(f"Reading channel details {start + len(batch)} of {len(items)}.")
        fetched = search.source.channels(batch)
        store.save_channels(search.conn, fetched, batch)
        store.update_run_progress(search.conn, search.run_id, channels_delta=len(batch))
        found.update(fetched)
    return found


def _in_countries(search: Search, details: ChannelInfo | None, channel_id: str) -> bool:
    """No country rule: every channel. With one, a channel whose owner set no country never
    matches (there is nothing to compare)."""
    countries = search.cfg.country_filter
    if not countries:
        return True
    if details is not None:
        country = details["Country"]
    else:
        row = store.get_channel_row(search.conn, channel_id)
        country = row["country"] if row else None
    return (country or "").upper() in countries


def _read_uploads(
    search: Search, keyword: str, reading: Mapping[str, str]
) -> tuple[list[str], list[auto_clean.SignalSwept]]:
    """Reads each channel's recent uploads on one session, with breaks in a long sweep. Returns
    the channels read in full and kept (announced as kept), and those archived for falling below
    the median-views or uploads bound (announced as swept, and not counted as kept)."""
    if not reading:
        return [], []
    swept: list[auto_clean.SignalSwept] = []
    kept: list[str] = []
    search.info(f"Reading recent uploads from {len(reading)} channel(s).")
    every = search.pacer.every()
    collector = UploadCollector(search)
    sweep = search.source.sweep()
    try:
        for position, (handle, channel_id) in enumerate(reading.items(), 1):
            if every and position > 1 and (position - 1) % every == 0:
                search.pacer.sweep_break(position - 1)
            video_ids = sweep.recent_video_ids(handle)
            search.pacer.pause("recent_videos_delay")
            collector.add(channel_id, video_ids)
    finally:
        try:
            collector.finish()
        finally:
            sweep.close()
            # The bounds apply whether or not the subscriber band is on. Judged here, with the
            # signals just derived, so a stop mid-sweep still judges what was stamped.
            swept = auto_clean.sweep_by_signals(
                search.conn,
                search.cfg.signal_bounds,
                collector.stamped,
                keyword=keyword,
                handles_limit=search.cfg.handles_limit,
            )
            gone = {s.channel_id for s in swept}
            for s in swept:
                search.events.channel(
                    keyword=keyword,
                    channel_id=s.channel_id,
                    handle=s.handle,
                    name=s.name,
                    subscribers=s.subscribers,
                    median_views=s.median_views,
                    country=s.country,
                    outcome="swept",
                )
            kept = [cid for cid in collector.stamped if cid not in gone]
            for channel_id in kept:
                _announce(search, keyword, channel_id, "kept")
    return kept, swept


def _announce(search: Search, keyword: str, channel_id: str, outcome: Outcome) -> None:
    row = store.get_channel_row(search.conn, channel_id)
    if row is None:
        return
    search.events.channel(
        keyword=keyword,
        channel_id=channel_id,
        handle=row["handle"],
        name=row["name"] or row["handle"] or channel_id,
        subscribers=auto_clean.parse_subscribers(row["subscribers"]),
        median_views=row["median_views_last_30"],
        country=row["country"],
        outcome=outcome,
    )
