"""What is derived from a channel's About text and stored videos: the sponsorship signals and the
emails it publishes. No network. `derive` runs wherever a channel's videos change (a keyword, the
backlog, a downloaded object), so no path can leave them stale.
"""

from __future__ import annotations

import json
import re
import sqlite3
from collections.abc import Callable, Iterable, Mapping
from typing import Final, cast

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


# A disclosure said in the negative isn't one: "not affiliated with or sponsored by Anthropic",
# "this video isn't sponsored", "unsponsored". The negative has to be in the same sentence.
_NEGATIVE: Final = re.compile(
    r"(?:\b(?:not|never|in no way)\b|n['\u2019]t\b)[^.!?;\n]{0,60}$|\b(?:un|non-?)$|\bno\s+$",
    re.IGNORECASE,
)


def _negated(text: str, at: int) -> bool:
    return _NEGATIVE.search(text[max(0, at - 80) : at]) is not None


def detect_sponsorship(description: str | None) -> tuple[bool, list[str]]:
    """(is_sponsored, brands) for one video description."""
    if not description:
        return False, []
    lowered = description.lower()
    is_sponsored = any(
        not _negated(lowered, match.start())
        for phrase in SPONSOR_SIGNAL_PHRASES
        for match in re.finditer(re.escape(phrase), lowered)
    )
    brands: list[str] = []
    for pattern in BRAND_PATTERNS:
        for match in pattern.finditer(description):
            if _negated(description, match.start()):
                continue
            brand = match.group(1).strip(_BRAND_STRIP)
            if brand and brand not in brands:
                brands.append(brand)
    return is_sponsored, brands


def _stored_list(text: object) -> list[object]:
    """A stored JSON list, or [] for NULL or anything unreadable."""
    if not isinstance(text, str) or not text:
        return []
    try:
        value: object = json.loads(text)
    except ValueError:
        return []
    return list(cast("list[object]", value)) if isinstance(value, list) else []


def compute_sponsorship(conn: sqlite3.Connection, channel_ids: Iterable[str]) -> None:
    """`sponsored_ratio` and `seen_brands` from the stored descriptions. The ratio is over every
    stored video (a failed fetch counts, as a video without a signal); no stored videos is a
    null ratio, not zero. A channel brought back from the archive keeps the brands its old
    videos showed (their descriptions were dropped on purpose), and its ratio until it has
    videos of its own again. Commits."""
    ids = list(dict.fromkeys(channel_ids))
    if not ids:
        return
    descriptions_by_channel = store.get_channel_video_descriptions(conn, ids)
    brought_back = store.get_derived_facts_of_brought_back(conn, ids)
    for channel_id in ids:
        descriptions = descriptions_by_channel.get(channel_id, [])
        kept = brought_back.get(channel_id)
        if not descriptions:
            if kept is None:
                store.update_channel_sponsorship(conn, channel_id, None, [])
            continue
        matched = 0
        brands: list[str] = []
        for description in descriptions:
            is_sponsored, found = detect_sponsorship(description)
            matched += is_sponsored
            brands.extend(b for b in found if b not in brands)
        if kept is not None:
            old = [b for b in _stored_list(kept["seen_brands"]) if isinstance(b, str)]
            brands.extend(b for b in old if b not in brands)
        store.update_channel_sponsorship(conn, channel_id, matched / len(descriptions), brands)
    conn.commit()


def compute_found_emails(conn: sqlite3.Connection, channel_ids: Iterable[str]) -> None:
    """`found_emails` and `found_email_sources` from the About text first, then the stored
    descriptions. A channel brought back from the archive also keeps the addresses found before
    (in descriptions dropped on purpose), after the ones found now. Commits."""
    ids = list(dict.fromkeys(channel_ids))
    if not ids:
        return
    about = store.get_channel_about_texts(conn, ids)
    descriptions = store.get_channel_video_descriptions(conn, ids)
    brought_back = store.get_derived_facts_of_brought_back(conn, ids)
    for channel_id in ids:
        if channel_id in about:
            sources: list[Mapping[str, object]] = list(
                find_emails_with_sources(about[channel_id], descriptions.get(channel_id, []))
            )
            emails = [str(source["email"]) for source in sources]
            kept = brought_back.get(channel_id)
            if kept is not None:
                for item in _stored_list(kept["found_email_sources"]):
                    old = cast("dict[str, object]", item) if isinstance(item, dict) else {}
                    email = old.get("email")
                    if isinstance(email, str) and email not in emails:
                        sources.append(old)
                        emails.append(email)
                for email in _stored_list(kept["found_emails"]):
                    if isinstance(email, str) and email not in emails:
                        emails.append(email)
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
