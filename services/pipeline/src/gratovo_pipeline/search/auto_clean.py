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
from gratovo_pipeline.config import AutoCleanRule


@dataclasses.dataclass(frozen=True)
class Swept:
    handle: str
    channel_id: str
    subscribers: int


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
