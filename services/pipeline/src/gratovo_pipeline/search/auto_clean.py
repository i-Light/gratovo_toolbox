"""The auto-clean rule's subscriber gate, applied to a keyword's fresh finds before any of their
uploads are read: a channel the rule would throw away never costs a video scrape.

- sweep: archived locally (the tombstone is shared on the next push) and dropped from the run;
- delay: kept as it is, with its uploads left to the backlog;
- inside the range, a band switched off, or an unknown count: left alone. Nothing is archived on
  a number the run doesn't have (the same call the Supabase sweep makes: `skipped_unknown`).
"""

from __future__ import annotations

import dataclasses
import sqlite3
from collections.abc import Mapping
from typing import Any, Literal

from gratovo_pipeline import store
from gratovo_pipeline.config import AutoCleanRule, SignalBounds


@dataclasses.dataclass(frozen=True)
class Swept:
    handle: str
    channel_id: str
    subscribers: int


@dataclasses.dataclass(frozen=True)
class SignalSwept:
    """A channel archived for its signals, with what the run announces about it (the row is gone
    once archived)."""

    handle: str
    channel_id: str
    name: str
    subscribers: int | None
    median_views: int | None
    country: str | None


@dataclasses.dataclass
class GateResult:
    swept: list[Swept] = dataclasses.field(default_factory=list[Swept])
    delayed: set[str] = dataclasses.field(default_factory=set[str])
    unknown: int = 0


def parse_subscribers(value: object) -> int | None:
    """The count as an int, or None when it is missing, hidden or not a plain number ("Hidden",
    "", "1.2M")."""
    if value is None:
        return None
    text = str(value).replace(",", "").strip()
    return int(text) if text.isdigit() else None


def action_for(
    rule: AutoCleanRule | None, subscribers: int | None
) -> Literal["sweep", "delay"] | None:
    """The rule's verdict for one count. The bounds are inside the range."""
    if rule is None or subscribers is None:
        return None
    if subscribers < rule.min_subscribers:
        action = rule.below_min
    elif subscribers > rule.max_subscribers:
        action = rule.above_max
    else:
        return None
    return action if action != "off" else None


def signals_verdict(bounds: SignalBounds | None, median: int | None, uploads: int | None) -> bool:
    """True when a channel whose videos were read falls below a bound. A bound of None is off;
    a channel exactly on a bound is kept. A missing median or count reads as 0, as the old sweep
    did (`COALESCE(..., 0)`)."""
    if bounds is None:
        return False
    if bounds.min_median_views is not None and (median or 0) < bounds.min_median_views:
        return True
    return bounds.min_uploads_30 is not None and (uploads or 0) < bounds.min_uploads_30


def sweep_by_signals(
    conn: sqlite3.Connection,
    bounds: SignalBounds | None,
    channel_ids: list[str],
    *,
    keyword: str,
    handles_limit: int,
) -> list[SignalSwept]:
    """Archives, as the subscriber gate does, each channel (videos read and signals derived)
    that falls below a bound, and returns them. A channel whose videos all failed to fetch has no
    data to judge, so it is left for a later fetch; one with no videos at all was fetched fine
    and reads as 0."""
    swept: list[SignalSwept] = []
    if bounds is None:
        return swept
    for channel_id in channel_ids:
        row = store.get_channel_row(conn, channel_id)
        if row is None:
            continue
        statuses = [
            r[0]
            for r in conn.execute(
                "SELECT last_fetch_status FROM videos WHERE channel_id=?", (channel_id,)
            )
        ]
        if statuses and "success" not in statuses:
            continue
        if not signals_verdict(bounds, row["median_views_last_30"], row["videos_last_30"]):
            continue
        subscribers = parse_subscribers(row["subscribers"])
        found_via = {"keyword": keyword, "limit": handles_limit, "discovered_at": store.utc_now()}
        store.archive_channel_locally(
            conn,
            channel_id,
            row["handle"],
            bounds.label,
            subscribers=subscribers,
            found_via=[found_via],
        )
        swept.append(
            SignalSwept(
                row["handle"],
                channel_id,
                row["name"] or row["handle"] or channel_id,
                subscribers,
                row["median_views_last_30"],
                row["country"],
            )
        )
    return swept


def apply_gate(
    conn: sqlite3.Connection,
    rule: AutoCleanRule | None,
    discovered: dict[str, str],
    info_by_handle: Mapping[str, Mapping[str, Any]],
    *,
    keyword: str,
    handles_limit: int,
) -> GateResult:
    """Sweeps and delays a keyword's fresh finds. A swept channel is archived and removed from
    `discovered` in place; a delayed one stays in it and is returned, so the caller keeps its
    sweep off it."""
    result = GateResult()
    if rule is None:
        return result
    for handle, channel_id in list(discovered.items()):
        subscribers = parse_subscribers((info_by_handle.get(handle) or {}).get("Subscribers"))
        if subscribers is None:
            row = store.get_channel_row(conn, channel_id)
            subscribers = parse_subscribers(row["subscribers"]) if row else None
        if subscribers is None:
            result.unknown += 1
            continue
        match action_for(rule, subscribers):
            case "sweep":
                found_via = {
                    "keyword": keyword,
                    "limit": handles_limit,
                    "discovered_at": store.utc_now(),
                }
                store.archive_channel_locally(
                    conn,
                    channel_id,
                    handle,
                    rule.label,
                    subscribers=subscribers,
                    found_via=[found_via],
                )
                del discovered[handle]
                result.swept.append(Swept(handle, channel_id, subscribers))
            case "delay":
                result.delayed.add(handle)
            case None:
                pass
    return result
