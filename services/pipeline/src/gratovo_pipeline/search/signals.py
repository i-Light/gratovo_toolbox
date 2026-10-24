"""What is derived from a channel's About text and stored videos: the sponsorship signals and the
emails it publishes. No network. `derive` runs wherever a channel's videos change (a keyword, the
backlog, a downloaded object), so no path can leave them stale.
"""

from __future__ import annotations

import re
import sqlite3
from collections.abc import Callable, Iterable
from typing import Final

from gratovo_pipeline import store
from gratovo_pipeline.found_emails import find_emails_with_sources

# Phrases a sponsorship disclosure reliably uses. Plain substring checks on the lowercased
# description: a disclosure worded some other way is missed, and that's fine; the point is never
# to guess.
SPONSOR_SIGNAL_PHRASES: Final = (
    "sponsored",
    "#ad",
    "use code",
    "affiliate link",
    "paid partnership",
    "in partnership with",
    "promo code",
    "discount code",
)

# Brands only from these patterns, never "some capitalised word nearby": one to three capitalised
# words right after a disclosure phrase, or the code after "use/enter/apply code" (a creator's
# code is often the brand's or their own name). `(?i:...)` keeps the phrase case-insensitive and
# the brand capitalised. No "." in a word, so a sentence's full stop ends the brand.
_BRAND_NAME: Final = r"[A-Z][A-Za-z0-9&'-]*(?:\s+[A-Z][A-Za-z0-9&'-]*){0,2}"
BRAND_PATTERNS: Final = (
    re.compile(rf"(?i:sponsored\s+by)[:\s]+({_BRAND_NAME})"),
    re.compile(rf"(?i:in\s+partnership\s+with)[:\s]+({_BRAND_NAME})"),
    re.compile(r"(?i:(?:use|enter|apply)\s+code)[:\s]+([A-Z][A-Z0-9]{1,15})\b"),
)
_BRAND_STRIP: Final = " .,!:;\"'" + chr(0x2019)  # and the curly apostrophe


def detect_sponsorship(description: str | None) -> tuple[bool, list[str]]:
    """(is_sponsored, brands) for one video description."""
    if not description:
        return False, []
    is_sponsored = any(phrase in description.lower() for phrase in SPONSOR_SIGNAL_PHRASES)
    brands: list[str] = []
    for pattern in BRAND_PATTERNS:
        for match in pattern.finditer(description):
            brand = match.group(1).strip(_BRAND_STRIP)
            if brand and brand not in brands:
                brands.append(brand)
    return is_sponsored, brands


def compute_sponsorship(conn: sqlite3.Connection, channel_ids: Iterable[str]) -> None:
    """`sponsored_ratio` and `seen_brands` from the stored descriptions. The ratio is over every
    stored video (a failed fetch counts, as a video without a signal); no stored videos is a
    null ratio, not zero. Commits."""
    ids = list(dict.fromkeys(channel_ids))
    if not ids:
        return
    descriptions_by_channel = store.get_channel_video_descriptions(conn, ids)
    for channel_id in ids:
        descriptions = descriptions_by_channel.get(channel_id, [])
        if not descriptions:
            store.update_channel_sponsorship(conn, channel_id, None, [])
            continue
        matched = 0
        brands: list[str] = []
        for description in descriptions:
            is_sponsored, found = detect_sponsorship(description)
            matched += is_sponsored
            brands.extend(b for b in found if b not in brands)
        store.update_channel_sponsorship(conn, channel_id, matched / len(descriptions), brands)
    conn.commit()


def compute_found_emails(conn: sqlite3.Connection, channel_ids: Iterable[str]) -> None:
    """`found_emails` and `found_email_sources` from the About text first, then the stored
    descriptions. Commits."""
    ids = list(dict.fromkeys(channel_ids))
    if not ids:
        return
    about = store.get_channel_about_texts(conn, ids)
    descriptions = store.get_channel_video_descriptions(conn, ids)
    for channel_id in ids:
        if channel_id in about:
            sources = find_emails_with_sources(about[channel_id], descriptions.get(channel_id, []))
            emails = [source["email"] for source in sources]
            store.update_channel_found_emails(conn, channel_id, emails, sources)
    conn.commit()


def derive(conn: sqlite3.Connection, channel_ids: Iterable[str]) -> None:
    ids = list(dict.fromkeys(channel_ids))
    compute_sponsorship(conn, ids)
    compute_found_emails(conn, ids)


def derive_all(
    conn: sqlite3.Connection, batch: int = 500, log: Callable[[str], None] | None = None
) -> int:
    """`derive` over every channel held, `batch` at a time. Returns how many it covered."""
    ids = store.all_channel_ids(conn)
    for start in range(0, len(ids), batch):
        derive(conn, ids[start : start + batch])
        if log:
            log(f"Signals: {min(start + batch, len(ids))} of {len(ids)} channel(s)")
    return len(ids)
