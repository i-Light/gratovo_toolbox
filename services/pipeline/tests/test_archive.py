"""The pipeline's half of archiving, and the handle-level gate (ported from the old test_archive).

What matters is the tombstone: without it, the next search for the same keyword would find a
rejected channel again, add it back as new, spend quota on its videos and hand it to somebody to
vet a second time.
"""

import json
import sqlite3
import threading
import time
from pathlib import Path

import pytest

from gratovo_pipeline import store
from gratovo_pipeline.comms import live_case
from gratovo_pipeline.protocol import REFETCH_KEYWORD
from gratovo_pipeline.search import signals


def archive(
    conn: sqlite3.Connection, channel_id: str, handle: str = "@x", label: str = "irrelevant"
) -> None:
    store.apply_remote_archive(
        conn,
        {
            "channel_id": channel_id,
            "handle": handle,
            "label": label,
            "archived_at": "2026-08-01T00:00:00Z",
        },
    )
    conn.commit()


def count(conn: sqlite3.Connection, sql: str) -> int:
    return int(conn.execute(sql).fetchone()[0])


def found_via(conn: sqlite3.Connection, channel_id: str) -> list[dict[str, object]]:
    row = conn.execute(
        "SELECT found_via FROM channel_archive WHERE channel_id=?", (channel_id,)
    ).fetchone()
    entries: list[dict[str, object]] = json.loads(row["found_via"])
    return entries


# --- the tombstone ---


def test_a_new_channel_is_recorded(conn: sqlite3.Connection) -> None:
    assert store.record_channel_discovery(conn, "@a", "UC_a", "k1")
    assert store.get_channel_row(conn, "UC_a") is not None


def test_pulling_an_archive_row_deletes_the_local_channel(conn: sqlite3.Connection) -> None:
    store.record_channel_discovery(conn, "@a", "UC_a", "k1")
    archive(conn, "UC_a", "@a")
    assert store.get_channel_row(conn, "UC_a") is None
    assert store.is_archived(conn, "UC_a")


def test_pulling_an_archive_row_deletes_the_local_videos(conn: sqlite3.Connection) -> None:
    # The videos are the storage the archive exists to reclaim.
    store.record_channel_discovery(conn, "@b", "UC_b", "k1")
    conn.execute("INSERT INTO videos (video_id, channel_id) VALUES ('v1','UC_b')")
    conn.commit()
    archive(conn, "UC_b", "@b", "haramStuff")
    assert count(conn, "SELECT count(*) FROM videos WHERE channel_id='UC_b'") == 0


def test_a_rediscovered_archived_channel_is_skipped(conn: sqlite3.Connection) -> None:
    archive(conn, "UC_a", "@a")
    assert not store.record_channel_discovery(conn, "@a", "UC_a", "k2")
    assert store.get_channel_row(conn, "UC_a") is None


def test_a_skipped_channel_records_no_keyword_link_either(conn: sqlite3.Connection) -> None:
    archive(conn, "UC_a", "@a")
    store.record_channel_discovery(conn, "@a", "UC_a", "k2")
    assert count(conn, "SELECT count(*) FROM channel_keywords WHERE channel_id='UC_a'") == 0


def test_archiving_locally_tombstones_and_clears_the_channel(conn: sqlite3.Connection) -> None:
    # The auto-clean gate's write: it carries the subscriber count on the tombstone itself.
    store.record_channel_discovery(conn, "@a", "UC_a", "k1")
    conn.execute("INSERT INTO videos (video_id, channel_id) VALUES ('v1','UC_a')")
    conn.commit()

    store.archive_channel_locally(conn, "UC_a", "@a", "irrelevant", subscribers=1234)

    assert store.is_archived(conn, "UC_a")
    assert store.get_channel_row(conn, "UC_a") is None
    assert count(conn, "SELECT count(*) FROM videos WHERE channel_id='UC_a'") == 0
    row = conn.execute(
        "SELECT subscribers, found_at FROM channel_archive WHERE channel_id='UC_a'"
    ).fetchone()
    assert row["subscribers"] == "1234"
    assert row["found_at"] is not None


def test_unarchiving_lets_it_be_discovered_again(conn: sqlite3.Connection) -> None:
    archive(conn, "UC_a", "@a")
    store.unarchive(conn, "UC_a")
    assert not store.is_archived(conn, "UC_a")
    assert store.record_channel_discovery(conn, "@a", "UC_a", "k3")
    assert store.get_channel_row(conn, "UC_a") is not None


# --- keyword notes on a tombstone ---


def test_a_rediscovered_archived_channel_gets_the_keyword_on_its_tombstone(
    conn: sqlite3.Connection,
) -> None:
    archive(conn, "UC_a", "@a")
    added = store.record_archive_keyword_links(
        conn, {"@a": "UC_a"}, "ai news today", handles_limit=25
    )
    assert added == 1
    entries = found_via(conn, "UC_a")
    assert [e["keyword"] for e in entries] == ["ai news today"]
    assert entries[0]["limit"] == 25


def test_a_keyword_note_is_queued_for_the_team(conn: sqlite3.Connection) -> None:
    archive(conn, "UC_a", "@a")
    store.record_archive_keyword_links(conn, {"@a": "UC_a"}, "k1", 10)
    pending = store.get_archive_keyword_pending(conn)
    assert [(p["channel_id"], p["keyword"], p["handles_limit"]) for p in pending] == [
        ("UC_a", "k1", 10)
    ]
    store.clear_archive_keyword_pending(conn, "UC_a", "k1")
    assert store.get_archive_keyword_pending(conn) == []


def test_the_same_keyword_twice_on_a_tombstone_is_a_no_op(conn: sqlite3.Connection) -> None:
    archive(conn, "UC_a", "@a")
    store.record_archive_keyword_links(conn, {"@a": "UC_a"}, "k1")
    assert store.record_archive_keyword_links(conn, {"@a": "UC_a"}, "k1") == 0
    assert len(found_via(conn, "UC_a")) == 1


def test_a_second_keyword_accumulates_on_the_tombstone(conn: sqlite3.Connection) -> None:
    archive(conn, "UC_a", "@a")
    store.record_archive_keyword_links(conn, {"@a": "UC_a"}, "k1")
    store.record_archive_keyword_links(conn, {"@a": "UC_a"}, "k2")
    assert [e["keyword"] for e in found_via(conn, "UC_a")] == ["k1", "k2"]


def test_a_keyword_note_does_not_move_archived_at(conn: sqlite3.Connection) -> None:
    archive(conn, "UC_a", "@a")
    store.record_archive_keyword_links(conn, {"@a": "UC_a"}, "k1")
    row = conn.execute("SELECT archived_at FROM channel_archive WHERE channel_id='UC_a'").fetchone()
    assert row["archived_at"] == "2026-08-01T00:00:00Z"


def test_a_keyword_note_for_a_channel_that_is_not_archived_is_ignored(
    conn: sqlite3.Connection,
) -> None:
    assert store.record_archive_keyword_links(conn, {"@a": "UC_a"}, "k1") == 0
    assert store.get_archive_keyword_pending(conn) == []


# --- what goes back out ---


def test_a_pulled_archive_row_is_not_announced_back(conn: sqlite3.Connection) -> None:
    store.apply_remote_archive(
        conn,
        {
            "channel_id": "UC_a",
            "handle": "@a",
            "label": "irrelevant",
            "archived_at": "2026-08-01T00:00:00Z",
            "subscribers": 4321,
            "found_at": "2026-01-01T00:00:00Z",
        },
    )
    conn.commit()
    assert store.get_unannounced_archives(conn) == []
    row = conn.execute(
        "SELECT subscribers, found_at, source FROM channel_archive WHERE channel_id='UC_a'"
    ).fetchone()
    assert (row["subscribers"], row["found_at"], row["source"]) == (
        "4321",
        "2026-01-01T00:00:00Z",
        "remote",
    )


def test_a_locally_archived_row_is_announced_once(conn: sqlite3.Connection) -> None:
    store.archive_channel_locally(conn, "UC_a", "@a", "irrelevant", subscribers=1234)
    assert [r["channel_id"] for r in store.get_unannounced_archives(conn)] == ["UC_a"]
    store.mark_archives_announced(conn, ["UC_a"])
    assert store.get_unannounced_archives(conn) == []


# --- the frozen numbers ---


def test_archiving_a_channel_with_videos_freezes_their_numbers(conn: sqlite3.Connection) -> None:
    store.record_channel_discovery(conn, "@a", "UC_a", "k1")
    for i, views in enumerate((100, 300, 200)):
        conn.execute(
            "INSERT INTO videos (video_id, channel_id, view_count) VALUES (?, 'UC_a', ?)",
            (f"v{i}", str(views)),
        )
    conn.commit()
    store.archive_channel_locally(conn, "UC_a", "@a", "inactive")
    row = conn.execute(
        "SELECT median_views_last_30, median_basis, videos_found_count FROM channel_archive"
    ).fetchone()
    assert (row["median_views_last_30"], row["median_basis"], row["videos_found_count"]) == (
        200,
        "lifetime",
        3,
    )


def test_the_gate_archiving_before_any_videos_says_unknown_not_zero(
    conn: sqlite3.Connection,
) -> None:
    store.record_channel_discovery(conn, "@a", "UC_a", "k1")
    store.archive_channel_locally(conn, "UC_a", "@a", "inactive")
    row = conn.execute("SELECT videos_found_count FROM channel_archive").fetchone()
    assert row["videos_found_count"] is None


def test_a_tombstone_without_numbers_never_blanks_known_ones(conn: sqlite3.Connection) -> None:
    store.record_channel_discovery(conn, "@a", "UC_a", "k1")
    conn.execute(
        "INSERT INTO videos (video_id, channel_id, view_count) VALUES ('v1', 'UC_a', '500')"
    )
    conn.commit()
    store.archive_channel_locally(conn, "UC_a", "@a", "inactive")
    archive(conn, "UC_a", "@a")  # a teammate's tombstone that carries no numbers
    row = conn.execute(
        "SELECT median_views_last_30, videos_found_count FROM channel_archive"
    ).fetchone()
    assert (row["median_views_last_30"], row["videos_found_count"]) == (500, 1)


# --- the handle-level gate: which handles reach the fetching code at all ---


def test_an_unseen_channel_is_fresh(conn: sqlite3.Connection) -> None:
    assert store.partition_discovered(conn, {"@a": "UC_a"}) == ({"@a": "UC_a"}, {}, {})


def test_a_channel_already_in_the_database_is_not_fetched_again(conn: sqlite3.Connection) -> None:
    store.record_channel_discovery(conn, "@a", "UC_a", "k1")
    assert store.partition_discovered(conn, {"@a": "UC_a"}) == ({}, {"@a": "UC_a"}, {})


def test_an_archived_channel_is_not_fetched_again(conn: sqlite3.Connection) -> None:
    archive(conn, "UC_a", "@a")
    assert store.partition_discovered(conn, {"@a": "UC_a"}) == ({}, {}, {"@a": "UC_a"})


def test_a_forced_refetch_overrides_the_known_skip(conn: sqlite3.Connection) -> None:
    store.record_channel_discovery(conn, "@a", "UC_a", "k1")
    store.force_refetch_by_handle(conn, "@a")
    fresh, known, _ = store.partition_discovered(conn, {"@a": "UC_a"})
    assert (fresh, known) == ({"@a": "UC_a"}, {})


def test_the_archive_wins_over_a_local_row_that_has_not_caught_up(conn: sqlite3.Connection) -> None:
    store.record_channel_discovery(conn, "@a", "UC_a", "k1")
    conn.execute(
        "INSERT INTO channel_archive (channel_id, handle, label, archived_at) "
        "VALUES ('UC_a', '@a', 'irrelevant', '2026-08-01T00:00:00Z')"
    )
    conn.commit()
    assert store.partition_discovered(conn, {"@a": "UC_a"}) == ({}, {}, {"@a": "UC_a"})


def test_a_mixed_batch_is_split_three_ways(conn: sqlite3.Connection) -> None:
    store.record_channel_discovery(conn, "@known", "UC_known", "k1")
    archive(conn, "UC_arch", "@arch", "haramStuff")
    fresh, known, archived = store.partition_discovered(
        conn, {"@new": "UC_new", "@known": "UC_known", "@arch": "UC_arch"}
    )
    assert fresh == {"@new": "UC_new"}
    assert known == {"@known": "UC_known"}
    assert archived == {"@arch": "UC_arch"}


def test_an_empty_discovery_asks_the_database_nothing(conn: sqlite3.Connection) -> None:
    assert store.partition_discovered(conn, {}) == ({}, {}, {})


def test_a_known_channel_still_records_the_new_keyword_link(conn: sqlite3.Connection) -> None:
    store.record_channel_discovery(conn, "@a", "UC_a", "k1")
    _, known, _ = store.partition_discovered(conn, {"@a": "UC_a"})
    store.record_keyword_links(conn, known, "k2")
    rows = conn.execute(
        "SELECT keyword FROM channel_keywords WHERE channel_id='UC_a' ORDER BY keyword"
    )
    assert [r["keyword"] for r in rows] == ["k1", "k2"]


def test_recording_a_link_twice_is_a_no_op(conn: sqlite3.Connection) -> None:
    store.record_channel_discovery(conn, "@a", "UC_a", "k1")
    store.record_keyword_links(conn, {"@a": "UC_a"}, "k1")
    assert count(conn, "SELECT count(*) FROM channel_keywords WHERE channel_id='UC_a'") == 1


# --- the archive keeps its data (plan D42 to D44) ---
# Each old-app failure is a test here: the tombstone took its keywords from the caller (the
# 7-day sweep passed none, the rules' sweep only the keyword in hand); a second archiving was an
# INSERT OR REPLACE that blanked the first; bring back deleted the tombstone, so the keywords that
# found the channel were lost and a refetch filed it under `__manual_refetch__`; and a channel
# archived before its uploads were read could be counted as zero.

FULL = "UC_full"
FIRST_SEEN = "2026-02-01T09:00:00Z"
LINKS = [
    ("ai agents", "2026-02-01T09:00:00Z"),
    ("claude code review", "2026-03-05T12:00:00Z"),
    ("cursor tips", "2026-04-10T08:30:00Z"),
]
EMAILS = '["team@aiagentslab.example"]'
SOURCES = '[{"email": "team@aiagentslab.example", "source": "about"}]'


# Every version 8 channel fact (A1), each known; shorts_share is a known 0.
V8_FACTS: dict[str, object] = {
    "description": "Hands-on reviews of AI agents. Business: team@aiagentslab.example",
    "profile_picture": "https://yt3.ggpht.example/aiagentslab=s240",
    "last_fetched_at": "2026-04-11T00:00:00Z",
    "videos_fetched_at": "2026-04-11T00:00:00Z",
    "sponsored_ratio": 0.25,
    "default_language": "en",
    "topics": '["Technology"]',
    "total_views": 2400000,
    "video_count": 180,
    "subscribers_hidden": 0,
    "started_at": "2023-05-02T00:00:00Z",
    "uploads_playlist": "UU_aiagentslab",
    "made_for_kids": 0,
    "main_language": "en",
    "main_language_basis": "audio 3/3",
    "topic_counts": '{"Technology": 4}',
    "median_likes": 600,
    "median_comments": 40,
    "engagement_rate": 0.045,
    "median_duration_s": 840,
    "shorts_share": 0.0,
    "paid_share": 0.33,
}


def video(channel_id: str, n: int, views: str, published: str) -> dict[str, object]:
    """One fully read video: every column `videos` has."""
    return {
        "video_id": f"{channel_id}_v{n}",
        "channel_id": channel_id,
        "title": f"Claude Code vs Cursor, part {n}",
        "description": "Sponsored by Notion AI. Use code AGENTS for 20% off.",
        "thumbnail": f"https://i.ytimg.com/vi/{channel_id}_v{n}/hqdefault.jpg",
        "tags": '["ai agents", "claude code"]',
        "published_at": published,
        "view_count": views,
        "last_fetched_at": "2026-04-11T00:00:00Z",
        "last_fetch_status": "success",
        "audio_language": "en-US",
        "default_language": "en",
        "category_id": "28",
        "live_content": "none",
        "like_count": str(int(views) // 25),
        "comment_count": str(int(views) // 300),
        "duration_s": 600 + n,
        "has_captions": 1,
        "made_for_kids": 0,
        "topics": '["Technology"]',
        "paid_placement": n % 2,
    }


def insert(conn: sqlite3.Connection, table: str, row: dict[str, object]) -> None:
    columns, marks = ", ".join(row), ", ".join("?" * len(row))
    conn.execute(f"INSERT INTO {table} ({columns}) VALUES ({marks})", tuple(row.values()))  # noqa: S608 - test names


def full_channel(conn: sqlite3.Connection, channel_id: str = FULL) -> None:
    """A channel this machine read in full: every fact, three keywords found on different days,
    and three videos with every field."""
    insert(
        conn,
        "channels",
        {
            "channel_id": channel_id,
            "handle": "@aiagentslab",
            "name": "AI Agents Lab",
            "subscribers": "48200",
            "country": "US",
            "first_seen_at": FIRST_SEEN,
            "videos_last_30": 2,
            "median_views_last_30": 12000,
            "latest_upload_at": "2026-04-09T15:00:00Z",
            "seen_brands": '["Notion AI"]',
            "found_emails": EMAILS,
            "found_email_sources": SOURCES,
            "banner": "https://yt3.ggpht.example/aiagentslab-banner",
            "link": "https://www.youtube.com/@aiagentslab",
            "last_fetch_status": "success",
            **V8_FACTS,
        },
    )
    conn.executemany(
        "INSERT INTO channel_keywords (channel_id, keyword, discovered_at) VALUES (?, ?, ?)",
        [(channel_id, keyword, at) for keyword, at in LINKS],
    )
    for row in (
        video(channel_id, 1, "15000", "2026-04-09T15:00:00Z"),
        video(channel_id, 2, "9000", "2026-04-01T15:00:00Z"),
        video(channel_id, 3, "30000", "2026-01-20T15:00:00Z"),
    ):
        insert(conn, "videos", row)
    conn.commit()


def tomb(conn: sqlite3.Connection, channel_id: str = FULL) -> dict[str, object]:
    row = conn.execute("SELECT * FROM channel_archive WHERE channel_id=?", (channel_id,)).fetchone()
    assert row is not None
    return dict(row)


def links(conn: sqlite3.Connection, channel_id: str = FULL) -> list[tuple[str, str]]:
    return [
        (r["keyword"], r["discovered_at"])
        for r in conn.execute(
            "SELECT keyword, discovered_at FROM channel_keywords WHERE channel_id=? "
            "ORDER BY discovered_at, keyword",
            (channel_id,),
        )
    ]


def test_archiving_keeps_every_fact_and_every_keyword(conn: sqlite3.Connection) -> None:
    full_channel(conn)

    assert store.archive_channel_locally(conn, FULL, "@aiagentslab", "rejected")

    row = tomb(conn)
    assert {k: row[k] for k in ("handle", "label", "subscribers", "found_at")} == {
        "handle": "@aiagentslab",
        "label": "rejected",
        "subscribers": "48200",
        "found_at": FIRST_SEEN,
    }
    assert {name: row[name] for name, _ in store.ARCHIVE_FACTS} == {
        "name": "AI Agents Lab",
        "country": "US",
        "videos_last_30": 2,
        "latest_upload_at": "2026-04-09T15:00:00Z",
        "seen_brands": '["Notion AI"]',
        "found_emails": EMAILS,
        "found_email_sources": SOURCES,
        **V8_FACTS,
    }
    assert (row["median_views_last_30"], row["median_basis"], row["videos_found_count"]) == (
        12000,
        "window30",
        3,
    )
    assert json.loads(str(row["found_via"])) == [
        {"keyword": k, "limit": None, "discovered_at": at} for k, at in LINKS
    ]
    assert store.get_channel_row(conn, FULL) is None
    assert count(conn, "SELECT count(*) FROM videos") == 0
    assert links(conn) == []


def test_the_caller_keyword_joins_the_links_and_the_earliest_time_wins(
    conn: sqlite3.Connection,
) -> None:
    full_channel(conn)
    store.archive_channel_locally(
        conn,
        FULL,
        "@aiagentslab",
        "irrelevant",
        found_via=[
            {"keyword": "claude code review", "limit": 25, "discovered_at": "2026-10-01T00:00:00Z"},
            {"keyword": "ai news today", "limit": 25, "discovered_at": "2026-10-01T00:00:00Z"},
        ],
    )
    assert json.loads(str(tomb(conn)["found_via"])) == [
        {"keyword": "ai agents", "limit": None, "discovered_at": "2026-02-01T09:00:00Z"},
        {"keyword": "claude code review", "limit": 25, "discovered_at": "2026-03-05T12:00:00Z"},
        {"keyword": "cursor tips", "limit": None, "discovered_at": "2026-04-10T08:30:00Z"},
        {"keyword": "ai news today", "limit": 25, "discovered_at": "2026-10-01T00:00:00Z"},
    ]


def test_a_channel_never_read_says_unknown_not_zero(conn: sqlite3.Connection) -> None:
    store.record_channel_discovery(conn, "@promptdigest", "UC_new", "ai agents")
    store.archive_channel_locally(conn, "UC_new", "@promptdigest", "irrelevant")
    row = tomb(conn, "UC_new")
    # The row's own 30-day count is 0 by default; on the tombstone that would read as a fact.
    assert row["videos_last_30"] is None
    assert row["videos_found_count"] is None
    assert row["name"] is None


def test_archiving_again_never_says_less(conn: sqlite3.Connection) -> None:
    full_channel(conn)
    store.archive_channel_locally(conn, FULL, "@aiagentslab", "rejected")
    store.mark_archives_announced(conn, [FULL])
    conn.commit()
    before = tomb(conn)

    # A re-sweep with nothing new: not one value moves, and nothing goes out again.
    assert not store.archive_channel_locally(conn, FULL, "", "inactive")
    assert tomb(conn) == before

    # The channel reappears as a bare row, found later by another keyword, then is archived again.
    conn.execute(
        "INSERT INTO channels (channel_id, handle, first_seen_at) "
        "VALUES (?, '@aiagentslab', '2026-09-01T00:00:00Z')",
        (FULL,),
    )
    conn.execute(
        "INSERT INTO channel_keywords (channel_id, keyword, discovered_at) "
        "VALUES (?, 'ai coding agents', '2026-09-01T00:00:00Z')",
        (FULL,),
    )
    conn.commit()
    store.archive_channel_locally(conn, FULL, "@aiagentslab", "inactive", subscribers=None)

    after = tomb(conn)
    for key, value in before.items():
        if key in ("found_via", "source", "announced"):
            continue
        assert after[key] == value, key
    assert [e["keyword"] for e in json.loads(str(after["found_via"]))] == [
        *(k for k, _ in LINKS),
        "ai coding agents",
    ]
    assert after["announced"] == 0, "the new keyword goes out"
    assert store.get_channel_row(conn, FULL) is None


def test_archiving_again_adds_what_it_newly_knows(conn: sqlite3.Connection) -> None:
    # The gate archived it before anything was read; later the channel is read in full.
    store.record_channel_discovery(conn, "@aiagentslab", FULL, "ai agents")
    store.archive_channel_locally(conn, FULL, "@aiagentslab", "irrelevant", subscribers=900)
    full_channel(conn)  # the full row, beside the tombstone (as an import can leave it)

    store.archive_channel_locally(conn, FULL, "@aiagentslab", "rejected")

    row = tomb(conn)
    assert row["label"] == "irrelevant", "the first decision's label stays"
    assert (row["name"], row["country"], row["videos_last_30"]) == ("AI Agents Lab", "US", 2)
    assert row["subscribers"] == "48200"
    assert (row["median_views_last_30"], row["videos_found_count"]) == (12000, 3)


def test_a_known_list_is_never_replaced_by_a_shorter_one(conn: sqlite3.Connection) -> None:
    full_channel(conn)
    store.archive_channel_locally(conn, FULL, "@aiagentslab", "rejected")
    conn.execute(
        "INSERT INTO channels (channel_id, handle, first_seen_at, found_emails, seen_brands) "
        "VALUES (?, '@aiagentslab', ?, '[\"press@aiagentslab.example\"]', '[]')",
        (FULL, FIRST_SEEN),
    )
    conn.commit()
    store.archive_channel_locally(conn, FULL, "@aiagentslab", "rejected")
    row = tomb(conn)
    assert json.loads(str(row["found_emails"])) == [
        "team@aiagentslab.example",
        "press@aiagentslab.example",
    ]
    assert json.loads(str(row["seen_brands"])) == ["Notion AI"]


def test_an_old_tombstone_with_blanks_is_filled_not_replaced(conn: sqlite3.Connection) -> None:
    # As an old file or an older pipeline left it: no facts, no keywords, an early date.
    conn.execute(
        "INSERT INTO channel_archive (channel_id, handle, label, archived_at, found_via) "
        "VALUES (?, '@aiagentslab', 'inactive', '2026-05-01T00:00:00Z', NULL)",
        (FULL,),
    )
    full_channel(conn)
    store.archive_channel_locally(conn, FULL, "@aiagentslab", "rejected")
    row = tomb(conn)
    assert (row["label"], row["archived_at"]) == ("inactive", "2026-05-01T00:00:00Z")
    assert row["name"] == "AI Agents Lab"
    assert [e["keyword"] for e in json.loads(str(row["found_via"]))] == [k for k, _ in LINKS]


def test_a_failure_while_archiving_leaves_the_channel_as_it_was(conn: sqlite3.Connection) -> None:
    full_channel(conn)
    conn.execute(
        "CREATE TEMP TRIGGER no_delete BEFORE DELETE ON channels "
        "BEGIN SELECT RAISE(ABORT, 'refused'); END"
    )
    with pytest.raises(sqlite3.IntegrityError):
        store.archive_channel_locally(conn, FULL, "@aiagentslab", "rejected")
    assert not store.is_archived(conn, FULL)
    assert store.get_channel_row(conn, FULL) is not None
    assert count(conn, "SELECT count(*) FROM videos") == 3
    assert count(conn, "SELECT count(*) FROM archived_videos") == 0, "one transaction (A6)"
    assert links(conn) == LINKS


# --- bring back ---


def test_restore_brings_the_row_and_its_keywords_back(conn: sqlite3.Connection) -> None:
    full_channel(conn)
    store.archive_channel_locally(
        conn,
        FULL,
        "@aiagentslab",
        "rejected",
        found_via=[
            {"keyword": REFETCH_KEYWORD, "limit": 0, "discovered_at": "2026-05-01T00:00:00Z"}
        ],
    )

    assert store.restore_channel_locally(conn, FULL) == "@aiagentslab"

    row = store.get_channel_row(conn, FULL)
    assert row is not None
    assert {
        k: row[k]
        for k in (
            "handle",
            "name",
            "subscribers",
            "country",
            "first_seen_at",
            "videos_last_30",
            "median_views_last_30",
            "latest_upload_at",
            "seen_brands",
            "found_emails",
            "found_email_sources",
            "videos_fetched_at",
            "force_refetch",
        )
    } == {
        "handle": "@aiagentslab",
        "name": "AI Agents Lab",
        "subscribers": "48200",
        "country": "US",
        "first_seen_at": FIRST_SEEN,
        "videos_last_30": 2,
        "median_views_last_30": 12000,
        "latest_upload_at": "2026-04-09T15:00:00Z",
        "seen_brands": '["Notion AI"]',
        "found_emails": EMAILS,
        "found_email_sources": SOURCES,
        "videos_fetched_at": None,
        "force_refetch": 1,
    }
    assert row["videos_known"] == 3, "how many videos we had"
    assert links(conn) == LINKS, "original times, and a manual refetch isn't a keyword"
    assert not store.is_archived(conn, FULL)
    assert FULL in store.get_video_backfill_candidates(conn, 10).values()


def test_a_lifetime_median_is_not_put_back_as_a_30_day_one(conn: sqlite3.Connection) -> None:
    store.record_channel_discovery(conn, "@aiagentslab", FULL, "ai agents")
    conn.execute(
        "INSERT INTO videos (video_id, channel_id, view_count) VALUES ('v1', ?, '700')", (FULL,)
    )
    conn.commit()
    store.archive_channel_locally(conn, FULL, "@aiagentslab", "inactive")
    assert tomb(conn)["median_basis"] == "lifetime"
    store.restore_channel_locally(conn, FULL)
    row = store.get_channel_row(conn, FULL)
    assert row is not None
    assert row["median_views_last_30"] is None


def test_restore_beside_an_existing_row_fills_only_its_blanks(conn: sqlite3.Connection) -> None:
    full_channel(conn)
    store.archive_channel_locally(conn, FULL, "@aiagentslab", "rejected")
    conn.execute(
        "INSERT INTO channels (channel_id, handle, name, first_seen_at) "
        "VALUES (?, '@aiagentslabs', 'AI Agents Lab Pro', '2026-09-09T00:00:00Z')",
        (FULL,),
    )
    conn.execute(
        "INSERT INTO channel_keywords (channel_id, keyword, discovered_at) "
        "VALUES (?, 'ai agents', '2026-09-09T00:00:00Z')",
        (FULL,),
    )
    conn.commit()

    store.restore_channel_locally(conn, FULL)

    row = store.get_channel_row(conn, FULL)
    assert row is not None
    assert (row["handle"], row["name"]) == ("@aiagentslabs", "AI Agents Lab Pro")
    assert (row["subscribers"], row["country"], row["found_emails"]) == ("48200", "US", EMAILS)
    assert links(conn) == [
        ("claude code review", "2026-03-05T12:00:00Z"),
        ("cursor tips", "2026-04-10T08:30:00Z"),
        ("ai agents", "2026-09-09T00:00:00Z"),
    ]
    assert not store.is_archived(conn, FULL)


def test_restore_of_an_unknown_channel_does_nothing(conn: sqlite3.Connection) -> None:
    assert store.restore_channel_locally(conn, "UC_nobody") is None
    assert store.get_channel_row(conn, "UC_nobody") is None


def test_a_tombstone_with_no_handle_comes_back_under_its_id(conn: sqlite3.Connection) -> None:
    store.archive_channel_locally(conn, "UC_bare", "", "rejected")
    assert store.restore_channel_locally(conn, "UC_bare") == ""
    row = store.get_channel_row(conn, "UC_bare")
    assert row is not None
    assert row["handle"] == "UC_bare"


def test_archive_restore_archive_loses_nothing(conn: sqlite3.Connection) -> None:
    full_channel(conn)
    store.archive_channel_locally(conn, FULL, "@aiagentslab", "rejected")
    first = tomb(conn)
    store.restore_channel_locally(conn, FULL)
    store.archive_channel_locally(conn, FULL, "@aiagentslab", "rejected")
    second = tomb(conn)
    for key in ("handle", "subscribers", "found_at", "found_via", *dict(store.ARCHIVE_FACTS)):
        assert second[key] == first[key], key
    # A restored row holds no videos until it is read again; how many we had comes back
    # through `videos_known`, and the median from the row.
    assert (second["median_views_last_30"], second["median_basis"]) == (12000, "window30")
    assert second["videos_found_count"] == 3


# The three videos brought back count beside the ones read since (A3).
@pytest.mark.parametrize(("read", "kept"), [(5, 8), (2, 5)])
def test_videos_read_after_a_restore_count_when_there_are_more(
    conn: sqlite3.Connection, read: int, kept: int
) -> None:
    full_channel(conn)
    store.archive_channel_locally(conn, FULL, "@aiagentslab", "rejected")
    store.restore_channel_locally(conn, FULL)
    conn.executemany(
        "INSERT INTO videos (video_id, channel_id, view_count, published_at) VALUES (?, ?, ?, ?)",
        [(f"new{i}", FULL, str(1000 * (i + 1)), "2026-01-01T00:00:00Z") for i in range(read)],
    )
    conn.commit()
    store.mark_channels_videos_fetched(conn, [FULL])

    store.archive_channel_locally(conn, FULL, "@aiagentslab", "rejected")

    row = tomb(conn)
    assert row["videos_found_count"] == kept, "brought back and newly read, both held"
    assert row["median_views_last_30"] is not None


def test_a_failure_while_restoring_leaves_the_tombstone(conn: sqlite3.Connection) -> None:
    full_channel(conn)
    store.archive_channel_locally(conn, FULL, "@aiagentslab", "rejected")
    before = tomb(conn)
    conn.execute(
        "CREATE TEMP TRIGGER keep BEFORE DELETE ON channel_archive "
        "BEGIN SELECT RAISE(ABORT, 'refused'); END"
    )
    with pytest.raises(sqlite3.IntegrityError):
        store.restore_channel_locally(conn, FULL)
    assert tomb(conn) == before
    assert store.get_channel_row(conn, FULL) is None
    assert links(conn) == []


def test_a_teammates_tombstone_keeps_this_machines_facts(conn: sqlite3.Connection) -> None:
    full_channel(conn)
    archive(conn, FULL, "@aiagentslab")
    row = tomb(conn)
    assert (row["name"], row["country"], row["found_emails"]) == ("AI Agents Lab", "US", EMAILS)
    assert row["found_via"] is None, "the sender's keywords stay as sent"
    assert row["label"] == "irrelevant"


# --- bring back, then archive again (review R5) ---


def numbers(row: dict[str, object]) -> tuple[object, object, object]:
    return (row["median_views_last_30"], row["median_basis"], row["videos_found_count"])


def test_a_lifetime_median_survives_bring_back_then_archive_again(
    conn: sqlite3.Connection,
) -> None:
    store.record_channel_discovery(conn, "@aiagentslab", FULL, "ai agents")
    conn.execute(
        "INSERT INTO videos (video_id, channel_id, view_count) VALUES ('v1', ?, '700')", (FULL,)
    )
    conn.commit()
    store.archive_channel_locally(conn, FULL, "@aiagentslab", "inactive")
    assert numbers(tomb(conn)) == (700, "lifetime", 1)

    store.restore_channel_locally(conn, FULL)
    store.archive_channel_locally(conn, FULL, "@aiagentslab", "inactive")

    assert numbers(tomb(conn)) == (700, "lifetime", 1)


def test_a_30_day_median_survives_bring_back_even_when_the_rollups_run_again(
    conn: sqlite3.Connection,
) -> None:
    full_channel(conn)
    store.archive_channel_locally(conn, FULL, "@aiagentslab", "rejected")
    store.restore_channel_locally(conn, FULL)
    # The rollups run over every row (no ids): an unread row's numbers fall to 0 and NULL.
    store.compute_channel_rollups(conn)

    store.archive_channel_locally(conn, FULL, "@aiagentslab", "rejected")

    assert numbers(tomb(conn)) == (12000, "window30", 3)
    assert tomb(conn)["videos_last_30"] == 2


def test_a_known_zero_uploads_survives_bring_back_then_archive_again(
    conn: sqlite3.Connection,
) -> None:
    store.record_channel_discovery(conn, "@promptdigest", "UC_quiet", "ai agents")
    store.mark_channels_videos_fetched(conn, ["UC_quiet"])  # read: nothing in 30 days
    store.archive_channel_locally(conn, "UC_quiet", "@promptdigest", "inactive")
    assert tomb(conn, "UC_quiet")["videos_last_30"] == 0

    store.restore_channel_locally(conn, "UC_quiet")
    store.archive_channel_locally(conn, "UC_quiet", "@promptdigest", "inactive")

    assert tomb(conn, "UC_quiet")["videos_last_30"] == 0, "a known 0 stays 0"

    # And a count never known stays unknown through the same round trip.
    store.record_channel_discovery(conn, "@llmnotes", "UC_unread", "ai agents")
    store.archive_channel_locally(conn, "UC_unread", "@llmnotes", "inactive")
    store.restore_channel_locally(conn, "UC_unread")
    store.archive_channel_locally(conn, "UC_unread", "@llmnotes", "inactive")
    assert tomb(conn, "UC_unread")["videos_last_30"] is None


def test_bring_back_reads_the_tombstone_inside_its_transaction(conn: sqlite3.Connection) -> None:
    full_channel(conn)
    store.archive_channel_locally(conn, FULL, "@aiagentslab", "rejected")
    statements: list[str] = []
    conn.set_trace_callback(statements.append)
    try:
        store.restore_channel_locally(conn, FULL)
    finally:
        conn.set_trace_callback(None)
    opened = statements.index("SAVEPOINT tombstone")
    first_read = next(i for i, s in enumerate(statements) if "FROM channel_archive" in s)
    assert opened < first_read


def test_bring_back_over_an_unread_row_flags_it_for_a_read(conn: sqlite3.Connection) -> None:
    full_channel(conn)
    store.archive_channel_locally(conn, FULL, "@aiagentslab", "rejected")
    # A bare row beside the tombstone, never read (as an import can leave it).
    conn.execute(
        "INSERT INTO channels (channel_id, handle, first_seen_at) VALUES (?, '@aiagentslab', ?)",
        (FULL, FIRST_SEEN),
    )
    conn.commit()

    store.restore_channel_locally(conn, FULL)

    row = store.get_channel_row(conn, FULL)
    assert row is not None
    assert row["force_refetch"] == 1
    assert FULL in store.get_video_backfill_candidates(conn, 10).values()


def test_bring_back_over_a_read_row_leaves_its_read_alone(conn: sqlite3.Connection) -> None:
    full_channel(conn)
    store.archive_channel_locally(conn, FULL, "@aiagentslab", "rejected")
    conn.execute(
        "INSERT INTO channels (channel_id, handle, first_seen_at, videos_fetched_at) "
        "VALUES (?, '@aiagentslab', ?, '2026-10-01T00:00:00Z')",
        (FULL, FIRST_SEEN),
    )
    conn.commit()

    store.restore_channel_locally(conn, FULL)

    row = store.get_channel_row(conn, FULL)
    assert row is not None
    assert (row["force_refetch"], row["videos_fetched_at"]) == (0, "2026-10-01T00:00:00Z")


def keywords_of(entries: object) -> list[object]:
    return [e["keyword"] for e in json.loads(str(entries))]


def test_a_manual_refetch_is_never_written_into_a_tombstone(conn: sqlite3.Connection) -> None:
    full_channel(conn)
    # The refetch job links the channel under its own keyword; it isn't one that found it.
    conn.execute(
        "INSERT INTO channel_keywords (channel_id, keyword, discovered_at) "
        "VALUES (?, ?, '2026-05-01T00:00:00Z')",
        (FULL, REFETCH_KEYWORD),
    )
    conn.commit()
    refetch = {"keyword": REFETCH_KEYWORD, "limit": 0, "discovered_at": "2026-05-01T00:00:00Z"}

    store.archive_channel_locally(conn, FULL, "@aiagentslab", "rejected", found_via=[refetch])

    assert keywords_of(tomb(conn)["found_via"]) == [k for k, _ in LINKS]
    assert store.record_archive_keyword_links(conn, {"@aiagentslab": FULL}, REFETCH_KEYWORD) == 0
    assert store.get_archive_keyword_pending(conn) == []
    store.apply_catalog_archive_link(conn, FULL, REFETCH_KEYWORD, 0, "2026-05-02T00:00:00Z")
    (shared,) = store.get_unannounced_archives(conn)
    assert REFETCH_KEYWORD not in keywords_of(shared["found_via"])


def test_a_refetch_keyword_an_older_build_left_on_a_tombstone_goes_on_the_next_archive(
    conn: sqlite3.Connection,
) -> None:
    conn.execute(
        "INSERT INTO channel_archive (channel_id, handle, label, archived_at, found_via) "
        "VALUES (?, '@aiagentslab', 'rejected', '2026-05-01T00:00:00Z', ?)",
        (
            FULL,
            json.dumps(
                [{"keyword": REFETCH_KEYWORD, "limit": 0, "discovered_at": "2026-05-01T00:00:00Z"}]
            ),
        ),
    )
    full_channel(conn)

    store.archive_channel_locally(conn, FULL, "@aiagentslab", "rejected")

    assert keywords_of(tomb(conn)["found_via"]) == [k for k, _ in LINKS]


# --- parallel workers ---


def test_archiving_waits_for_another_writer_instead_of_failing(tmp_path: Path) -> None:
    """Parallel search workers write the same file. A tombstone reads the channel before it
    writes; in WAL mode a read-then-write transaction can't wait for the lock (it fails at once
    with "database is locked" when another worker committed meanwhile), so it must take the
    write lock first and let busy_timeout do the waiting."""
    db = tmp_path / "pipeline.db"
    setup = store.get_connection(db)
    store.init_db(setup)
    setup.execute(
        "INSERT INTO channels (channel_id, handle, first_seen_at) VALUES (?, ?, ?)",
        ("UC1", "@one", "2026-08-01T00:00:00Z"),
    )
    setup.commit()
    setup.close()

    other = store.get_connection(db)
    other.execute("BEGIN IMMEDIATE")
    other.execute(
        "INSERT INTO channels (channel_id, handle, first_seen_at) VALUES (?, ?, ?)",
        ("UC2", "@two", "2026-08-01T00:00:00Z"),
    )
    errors: list[BaseException] = []

    def archive_in_worker() -> None:
        conn = store.get_connection(db)
        try:
            store.archive_channel_locally(conn, "UC1", "@one", "rejected")
        except BaseException as error:
            errors.append(error)
        finally:
            conn.close()

    worker = threading.Thread(target=archive_in_worker)
    worker.start()
    time.sleep(0.3)  # the worker is now waiting on the other writer's lock
    other.commit()
    worker.join(timeout=10)
    other.close()

    assert not worker.is_alive()
    assert errors == []
    check = store.get_connection(db)
    try:
        assert count(check, "SELECT COUNT(*) FROM channel_archive WHERE channel_id='UC1'") == 1
        assert count(check, "SELECT COUNT(*) FROM channels WHERE channel_id='UC1'") == 0
    finally:
        check.close()


# --- an archive that loses nothing the owner keeps (step S4, A1 to A6) ---

VIDEO_KEPT = tuple(store.KEPT["videos"])
FACT_NAMES = tuple(name for name, _ in store.ARCHIVE_FACTS)


def channel_facts(conn: sqlite3.Connection, channel_id: str = FULL) -> dict[str, object]:
    row = store.get_channel_row(conn, channel_id)
    assert row is not None
    return {name: row[name] for name in FACT_NAMES}


def kept_videos(conn: sqlite3.Connection, table: str) -> dict[str, dict[str, object]]:
    rows = conn.execute(f"SELECT {', '.join(VIDEO_KEPT)} FROM {table} ORDER BY video_id")  # noqa: S608 - test names
    return {r["video_id"]: dict(r) for r in rows}


def test_archive_then_bring_back_round_trips_every_kept_field(conn: sqlite3.Connection) -> None:
    full_channel(conn)
    facts_before = channel_facts(conn)
    videos_before = kept_videos(conn, "videos")
    assert all(v is not None for v in facts_before.values()), "the fixture knows every fact"
    assert all(v is not None for row in videos_before.values() for v in row.values())

    store.archive_channel_locally(conn, FULL, "@aiagentslab", "rejected")

    assert {name: tomb(conn)[name] for name in FACT_NAMES} == facts_before
    assert kept_videos(conn, "archived_videos") == videos_before
    assert count(conn, "SELECT count(*) FROM videos") == 0

    store.restore_channel_locally(conn, FULL)

    row = store.get_channel_row(conn, FULL)
    assert row is not None
    # Every fact comes back but the two read stamps: the backlog reads the channel again (A3),
    # and nothing takes it for fetched; the tombstone's times wait beside them.
    assert channel_facts(conn) == {
        **facts_before,
        "videos_fetched_at": None,
        "last_fetched_at": None,
    }
    assert (row["force_refetch"], row["videos_fetched_known"], row["last_fetched_known"]) == (
        1,
        "2026-04-11T00:00:00Z",
        facts_before["last_fetched_at"],
    )
    assert FULL in store.get_video_backfill_candidates(conn, 10).values()
    assert kept_videos(conn, "videos") == videos_before
    assert {
        tuple(r)
        for r in conn.execute("SELECT last_fetch_status, description, tags, thumbnail FROM videos")
    } == {("archived", None, None, None)}
    assert count(conn, "SELECT count(*) FROM archived_videos") == 0, "moved, not copied"


def test_archiving_again_only_adds(conn: sqlite3.Connection) -> None:
    full_channel(conn)
    store.archive_channel_locally(conn, FULL, "@aiagentslab", "rejected")
    first = kept_videos(conn, "archived_videos")
    # The channel is back as a row beside its tombstone (as an import can leave it), with one
    # video seen again without its counts and a new title, and one new video.
    conn.execute(
        "INSERT INTO channels (channel_id, handle, first_seen_at) VALUES (?, '@aiagentslab', ?)",
        (FULL, FIRST_SEEN),
    )
    conn.execute(
        "INSERT INTO videos (video_id, channel_id, title, last_fetch_status) "
        "VALUES (?, ?, 'Claude Code vs Cursor, part 1 (updated)', 'success')",
        (f"{FULL}_v1", FULL),
    )
    insert(conn, "videos", video(FULL, 4, "21000", "2026-09-01T15:00:00Z"))
    conn.commit()

    store.archive_channel_locally(conn, FULL, "@aiagentslab", "rejected")

    after = kept_videos(conn, "archived_videos")
    assert set(after) == {*first, f"{FULL}_v4"}, "the second archive never drops a video"
    v1 = after[f"{FULL}_v1"]
    assert v1["title"] == "Claude Code vs Cursor, part 1 (updated)", "a newer known value wins"
    assert {k: v1[k] for k in VIDEO_KEPT if k != "title"} == {
        k: first[f"{FULL}_v1"][k] for k in VIDEO_KEPT if k != "title"
    }, "a known value is never blanked"
    assert after[f"{FULL}_v2"] == first[f"{FULL}_v2"]


def test_a_failed_video_fetch_is_not_archived(conn: sqlite3.Connection) -> None:
    full_channel(conn)
    conn.execute(
        "INSERT INTO videos (video_id, channel_id, last_fetch_status) "
        "VALUES ('vfail', ?, 'failed')",
        (FULL,),
    )
    conn.commit()
    store.archive_channel_locally(conn, FULL, "@aiagentslab", "rejected")
    assert "vfail" not in kept_videos(conn, "archived_videos")
    assert count(conn, "SELECT count(*) FROM archived_videos") == 3


def test_bring_back_then_archive_before_a_read_keeps_the_tombstone(
    conn: sqlite3.Connection,
) -> None:
    full_channel(conn)
    store.archive_channel_locally(conn, FULL, "@aiagentslab", "rejected")
    first = tomb(conn)
    first_videos = kept_videos(conn, "archived_videos")

    store.restore_channel_locally(conn, FULL)
    # The rollups run over every row meanwhile, the videos brought back included.
    store.compute_channel_rollups(conn)
    conn.commit()
    store.archive_channel_locally(conn, FULL, "@aiagentslab", "rejected")

    second = tomb(conn)
    assert numbers(second) == numbers(first) == (12000, "window30", 3)
    assert second["videos_last_30"] == first["videos_last_30"] == 2
    assert {n: second[n] for n in FACT_NAMES if n not in ROLLUPS} == {
        n: first[n] for n in FACT_NAMES if n not in ROLLUPS
    }
    assert kept_videos(conn, "archived_videos") == first_videos
    assert count(conn, "SELECT count(*) FROM videos") == 0


# Recomputed from the videos brought back when the rollups run; the rest must not move at all.
ROLLUPS = frozenset(
    {
        "latest_upload_at",
        "main_language",
        "main_language_basis",
        "topic_counts",
        "median_likes",
        "median_comments",
        "engagement_rate",
        "median_duration_s",
        "shorts_share",
        "paid_share",
    }
)


def test_bring_back_then_archive_with_no_rollups_loses_nothing(conn: sqlite3.Connection) -> None:
    full_channel(conn)
    store.archive_channel_locally(conn, FULL, "@aiagentslab", "rejected")
    first = tomb(conn)
    store.restore_channel_locally(conn, FULL)
    store.archive_channel_locally(conn, FULL, "@aiagentslab", "rejected")
    second = tomb(conn)
    for key in ("handle", "subscribers", "found_at", "found_via", *FACT_NAMES):
        assert second[key] == first[key], key
    assert numbers(second) == numbers(first)


def test_videos_brought_back_and_then_read_count_as_read(conn: sqlite3.Connection) -> None:
    full_channel(conn)
    store.archive_channel_locally(conn, FULL, "@aiagentslab", "rejected")
    store.restore_channel_locally(conn, FULL)
    insert(conn, "videos", video(FULL, 4, "21000", store.utc_now()))
    conn.commit()
    store.mark_channels_videos_fetched(conn, [FULL])
    row = store.get_channel_row(conn, FULL)
    assert row is not None
    # The window runs back from the new read: April's videos brought back are outside it.
    assert (row["videos_last_30"], row["median_views_last_30"]) == (1, 21000)

    store.archive_channel_locally(conn, FULL, "@aiagentslab", "rejected")

    assert tomb(conn)["videos_last_30"] == 1, "the row's own count, now that it was read"
    assert tomb(conn)["videos_fetched_at"] == row["videos_fetched_at"], "the later read"
    assert numbers(tomb(conn)) == (21000, "window30", 4)
    assert len(kept_videos(conn, "archived_videos")) == 4


def test_a_channel_brought_back_keeps_the_brands_and_emails_of_its_old_videos(
    conn: sqlite3.Connection,
) -> None:
    full_channel(conn)
    store.archive_channel_locally(conn, FULL, "@aiagentslab", "rejected")
    store.restore_channel_locally(conn, FULL)
    conn.execute("UPDATE channels SET description=NULL WHERE channel_id=?", (FULL,))
    new = video(FULL, 4, "21000", "2026-10-10T15:00:00Z")
    new["description"] = "In partnership with Cursor. Questions: press@aiagentslab.example"
    insert(conn, "videos", new)
    conn.commit()

    signals.derive(conn, [FULL])

    row = store.get_channel_row(conn, FULL)
    assert row is not None
    assert json.loads(row["seen_brands"]) == ["Cursor", "Notion AI"]
    assert row["sponsored_ratio"] == 1.0, "over the videos with a description, not the archived"
    assert json.loads(row["found_emails"]) == [
        "press@aiagentslab.example",
        "team@aiagentslab.example",
    ]


def test_with_only_videos_brought_back_the_signals_stay(conn: sqlite3.Connection) -> None:
    full_channel(conn)
    store.archive_channel_locally(conn, FULL, "@aiagentslab", "rejected")
    store.restore_channel_locally(conn, FULL)
    signals.derive(conn, [FULL])
    row = store.get_channel_row(conn, FULL)
    assert row is not None
    assert (row["sponsored_ratio"], row["seen_brands"]) == (0.25, '["Notion AI"]')
    assert json.loads(row["found_emails"]) == ["team@aiagentslab.example"]


# --- teammates' tombstones (A4) ---


def test_a_teammates_archive_copies_the_videos_held_here(conn: sqlite3.Connection) -> None:
    full_channel(conn)
    videos_before = kept_videos(conn, "videos")
    archive(conn, FULL, "@aiagentslab")
    assert kept_videos(conn, "archived_videos") == videos_before
    assert count(conn, "SELECT count(*) FROM videos") == 0
    assert tomb(conn)["description"] == V8_FACTS["description"], "and the facts held here"


def test_an_older_teammate_record_applies_and_blanks_nothing(conn: sqlite3.Connection) -> None:
    full_channel(conn)
    store.archive_channel_locally(conn, FULL, "@aiagentslab", "rejected")
    facts = {name: tomb(conn)[name] for name in FACT_NAMES}
    videos = kept_videos(conn, "archived_videos")
    # A format-1 record: no version 8 facts, no videos, no archive_format.
    archive(conn, FULL, "@aiagentslab")
    assert {name: tomb(conn)[name] for name in FACT_NAMES} == facts
    assert kept_videos(conn, "archived_videos") == videos


def test_a_newer_teammate_record_applies_and_its_unknown_keys_are_ignored(
    conn: sqlite3.Connection,
) -> None:
    full_channel(conn)
    store.archive_channel_locally(conn, FULL, "@aiagentslab", "rejected")
    record = store.get_unannounced_archives(conn)[0]
    conn.execute("DELETE FROM channel_archive")
    conn.execute("DELETE FROM archived_videos")
    conn.commit()
    record["archive_format"] = 3
    record["thumbnail_style"] = "wide"  # a key from a newer pipeline
    record["archived_videos"] = [
        {**v, "chapters": [{"at": 0, "title": "Intro"}]} for v in record["archived_videos"]
    ]
    record["archived_videos"].append({"title": "no id: skipped"})

    store.apply_remote_archive(conn, record)
    conn.commit()

    row = tomb(conn)
    assert {name: row[name] for name in FACT_NAMES} == {name: record[name] for name in FACT_NAMES}
    assert (row["source"], row["announced"]) == ("remote", 1)
    assert set(kept_videos(conn, "archived_videos")) == {f"{FULL}_v1", f"{FULL}_v2", f"{FULL}_v3"}
    assert kept_videos(conn, "archived_videos")[f"{FULL}_v2"] == {
        k: record["archived_videos"][1][k] for k in VIDEO_KEPT
    }


def test_a_teammate_record_never_blanks_known_values_here(conn: sqlite3.Connection) -> None:
    full_channel(conn)
    store.archive_channel_locally(conn, FULL, "@aiagentslab", "rejected")
    facts = {name: tomb(conn)[name] for name in FACT_NAMES}
    videos = kept_videos(conn, "archived_videos")
    store.apply_remote_archive(
        conn,
        {
            "channel_id": FULL,
            "handle": "@aiagentslab",
            "label": "rejected",
            "archive_format": 2,
            **dict.fromkeys(FACT_NAMES),
            "last_fetched_at": "2026-05-01T00:00:00Z",  # read after the copy here
            "total_views": 2500000,  # a newer known value wins
            "seen_brands": '["Cursor"]',  # lists keep both
            "archived_videos": [
                {"video_id": f"{FULL}_v1", "view_count": None, "title": None},
                {"video_id": "vteam", "channel_id": "UC_other", "title": "Gemini 3 first look"},
            ],
        },
    )
    conn.commit()
    row = tomb(conn)
    assert row["total_views"] == 2500000
    assert json.loads(str(row["seen_brands"])) == ["Notion AI", "Cursor"]
    sent = ("total_views", "seen_brands", "last_fetched_at")
    assert row["last_fetched_at"] == "2026-05-01T00:00:00Z", "the later time"
    assert {n: row[n] for n in FACT_NAMES if n not in sent} == {
        n: v for n, v in facts.items() if n not in sent
    }
    after = kept_videos(conn, "archived_videos")
    assert after[f"{FULL}_v1"] == videos[f"{FULL}_v1"]
    assert after["vteam"]["channel_id"] == FULL, "filed under the tombstone's channel"


@pytest.mark.parametrize(
    "sent_at",
    [None, "2026-03-01T00:00:00Z"],
    ids=["the sent record's time unknown", "the sent record older"],
)
def test_an_older_teammate_record_only_fills_blanks(
    conn: sqlite3.Connection, sent_at: str | None
) -> None:
    full_channel(conn)
    store.archive_channel_locally(conn, FULL, "@aiagentslab", "rejected")
    conn.execute("UPDATE channel_archive SET video_count=NULL")
    conn.commit()
    facts = {name: tomb(conn)[name] for name in FACT_NAMES}
    store.apply_remote_archive(
        conn,
        {
            "channel_id": FULL,
            "handle": "@aiagentslab",
            "label": "rejected",
            "archive_format": 2,
            "last_fetched_at": sent_at,
            "total_views": 1900000,  # older than the value here: loses
            "video_count": 150,  # fills the blank here
        },
    )
    conn.commit()
    row = tomb(conn)
    assert (row["total_views"], row["video_count"]) == (2400000, 150)
    assert row["last_fetched_at"] == facts["last_fetched_at"]


def test_a_newer_teammate_record_wins_when_the_time_here_is_unknown(
    conn: sqlite3.Connection,
) -> None:
    full_channel(conn)
    store.archive_channel_locally(conn, FULL, "@aiagentslab", "rejected")
    conn.execute("UPDATE channel_archive SET last_fetched_at=NULL")
    conn.commit()
    store.apply_remote_archive(
        conn,
        {"channel_id": FULL, "handle": "@aiagentslab", "label": "rejected", "total_views": 1},
    )
    conn.commit()
    assert tomb(conn)["total_views"] == 1


def test_an_announced_tombstone_carries_its_format_and_videos(conn: sqlite3.Connection) -> None:
    full_channel(conn)
    store.archive_channel_locally(conn, FULL, "@aiagentslab", "rejected")
    (record,) = store.get_unannounced_archives(conn)
    assert record["archive_format"] == 2
    assert [v["video_id"] for v in record["archived_videos"]] == [
        f"{FULL}_v1",
        f"{FULL}_v2",
        f"{FULL}_v3",
    ]
    assert record["description"] == V8_FACTS["description"]


def test_the_channel_object_leaves_out_videos_brought_back(conn: sqlite3.Connection) -> None:
    full_channel(conn)
    store.archive_channel_locally(conn, FULL, "@aiagentslab", "rejected")
    store.restore_channel_locally(conn, FULL)
    insert(conn, "videos", video(FULL, 4, "21000", store.utc_now()))
    conn.commit()
    store.mark_channels_videos_fetched(conn, [FULL])
    blob = store.build_channel_blob(conn, FULL)
    assert blob is not None
    assert [v["video_id"] for v in blob["videos"]] == [f"{FULL}_v4"]
    assert blob["failed_video_ids"] == []


# --- review findings on S4 ---


def test_search_positions_survive_an_archive_and_come_back(conn: sqlite3.Connection) -> None:
    full_channel(conn)
    (first, _), (second, _) = LINKS[0], LINKS[1]
    conn.execute(
        "UPDATE channel_keywords SET position=7 WHERE channel_id=? AND keyword=?", (FULL, first)
    )
    conn.commit()
    store.archive_channel_locally(conn, FULL, "@aiagentslab", "rejected")
    by_keyword = {e["keyword"]: e for e in found_via(conn, FULL)}
    assert by_keyword[first]["position"] == 7
    assert "position" not in by_keyword[second], "an unknown position is left out"

    # Seen again by the same keywords, one at a better place: the lower one is kept.
    conn.execute(
        "INSERT INTO channels (channel_id, handle, first_seen_at) VALUES (?, '@aiagentslab', ?)",
        (FULL, FIRST_SEEN),
    )
    conn.execute(
        "INSERT INTO channel_keywords (channel_id, keyword, discovered_at, position) "
        "VALUES (?, ?, '2026-06-01T00:00:00Z', 3), (?, ?, '2026-06-01T00:00:00Z', 9)",
        (FULL, first, FULL, second),
    )
    conn.commit()
    store.archive_channel_locally(conn, FULL, "@aiagentslab", "rejected")
    by_keyword = {e["keyword"]: e for e in found_via(conn, FULL)}
    assert (by_keyword[first]["position"], by_keyword[second]["position"]) == (3, 9)

    store.restore_channel_locally(conn, FULL)
    positions = dict(
        conn.execute(
            "SELECT keyword, position FROM channel_keywords WHERE channel_id=?", (FULL,)
        ).fetchall()
    )
    assert (positions[first], positions[second]) == (3, 9)


def test_a_restored_link_already_here_keeps_the_better_position(conn: sqlite3.Connection) -> None:
    full_channel(conn)
    keyword = LINKS[0][0]
    conn.execute("UPDATE channel_keywords SET position=4 WHERE keyword=?", (keyword,))
    conn.commit()
    store.archive_channel_locally(conn, FULL, "@aiagentslab", "rejected")
    conn.execute(
        "INSERT INTO channels (channel_id, handle, first_seen_at) VALUES (?, '@aiagentslab', ?)",
        (FULL, FIRST_SEEN),
    )
    conn.execute(
        "INSERT INTO channel_keywords (channel_id, keyword, discovered_at, position) "
        "VALUES (?, ?, '2026-06-01T00:00:00Z', 11)",
        (FULL, keyword),
    )
    conn.commit()
    store.restore_channel_locally(conn, FULL)
    (position,) = conn.execute(
        "SELECT position FROM channel_keywords WHERE keyword=?", (keyword,)
    ).fetchone()
    assert position == 4


def test_bring_back_fills_a_video_row_already_here_and_loses_nothing(
    conn: sqlite3.Connection,
) -> None:
    full_channel(conn)
    archived = kept_videos(conn, "videos")[f"{FULL}_v1"]
    store.archive_channel_locally(conn, FULL, "@aiagentslab", "rejected")
    # The channel is back beside its tombstone, with one of its videos read again, partly.
    conn.execute(
        "INSERT INTO channels (channel_id, handle, first_seen_at) VALUES (?, '@aiagentslab', ?)",
        (FULL, FIRST_SEEN),
    )
    conn.execute(
        "INSERT INTO videos (video_id, channel_id, title, view_count, last_fetch_status) "
        "VALUES (?, ?, 'Claude Code vs Cursor, part 1 (updated)', '16000', 'success')",
        (f"{FULL}_v1", FULL),
    )
    conn.commit()

    store.restore_channel_locally(conn, FULL)

    row = conn.execute("SELECT * FROM videos WHERE video_id=?", (f"{FULL}_v1",)).fetchone()
    assert (row["title"], row["view_count"], row["last_fetch_status"]) == (
        "Claude Code vs Cursor, part 1 (updated)",
        "16000",
        "success",
    ), "the values here and the status stay"
    assert {k: row[k] for k in VIDEO_KEPT if k not in ("title", "view_count")} == {
        k: archived[k] for k in VIDEO_KEPT if k not in ("title", "view_count")
    }, "every blank is filled from the archive"
    assert count(conn, "SELECT count(*) FROM archived_videos") == 0


def test_archiving_again_before_a_fetch_keeps_the_tombstones_fetch_time(
    conn: sqlite3.Connection,
) -> None:
    full_channel(conn)
    store.archive_channel_locally(conn, FULL, "@aiagentslab", "rejected")
    store.restore_channel_locally(conn, FULL)
    row = store.get_channel_row(conn, FULL)
    assert row is not None
    assert row["last_fetched_at"] is None, "not taken for fetched"
    store.archive_channel_locally(conn, FULL, "@aiagentslab", "rejected")
    assert tomb(conn)["last_fetched_at"] == V8_FACTS["last_fetched_at"]
    assert tomb(conn)["videos_fetched_at"] == V8_FACTS["videos_fetched_at"]


def blob(channel_id: str, videos: list[dict[str, object]]) -> dict[str, object]:
    return {
        "v": 1,
        "channel": {
            "channel_id": channel_id,
            "handle": "@aiagentslab",
            "name": "AI Agents Lab",
            "first_seen_at": FIRST_SEEN,
            "last_fetched_at": "2026-10-01T00:00:00Z",
            "videos_fetched_at": "2026-10-01T00:00:00Z",
        },
        "videos": videos,
        "failed_video_ids": [],
    }


def test_a_teammates_object_never_brings_back_a_channel_archived_here(
    conn: sqlite3.Connection,
) -> None:
    full_channel(conn)
    store.archive_channel_locally(conn, FULL, "@aiagentslab", "rejected")
    assert not store.apply_channel_blob(conn, blob(FULL, []), "2026-10-01T00:00:00Z")
    assert count(conn, "SELECT count(*) FROM channels") == 0
    assert count(conn, "SELECT count(*) FROM videos") == 0


def test_a_teammates_object_keeps_the_videos_brought_back(conn: sqlite3.Connection) -> None:
    full_channel(conn)
    archived = kept_videos(conn, "videos")
    store.archive_channel_locally(conn, FULL, "@aiagentslab", "rejected")
    store.restore_channel_locally(conn, FULL)
    sent: dict[str, object] = {
        "video_id": f"{FULL}_v1",
        "title": "Claude Code vs Cursor, part 1 (retitled)",
        "description": "Sponsored by Notion AI.",
        "thumbnail": None,
        "tags": [],
        "published_at": "2026-04-09T15:00:00Z",
        "view_count": "18000",
        "last_fetched_at": "2026-10-01T00:00:00Z",
    }
    assert store.apply_channel_blob(conn, blob(FULL, [sent]), "2026-10-01T00:00:00Z")

    assert set(kept_videos(conn, "videos")) == set(archived), "archived rows it doesn't name stay"
    v1 = conn.execute("SELECT * FROM videos WHERE video_id=?", (f"{FULL}_v1",)).fetchone()
    assert (v1["title"], v1["view_count"], v1["last_fetch_status"]) == (
        "Claude Code vs Cursor, part 1 (retitled)",
        "18000",
        "success",
    )
    assert v1["like_count"] == archived[f"{FULL}_v1"]["like_count"], "a column it lacks stays"
    statuses = dict(conn.execute("SELECT video_id, last_fetch_status FROM videos").fetchall())
    assert statuses[f"{FULL}_v2"] == "archived"


def test_the_backfill_never_refetches_a_video_brought_back(conn: sqlite3.Connection) -> None:
    full_channel(conn)
    store.archive_channel_locally(conn, FULL, "@aiagentslab", "rejected")
    store.restore_channel_locally(conn, FULL)
    conn.execute("UPDATE videos SET title=NULL")  # a blank the backfill would chase
    conn.execute(
        "INSERT INTO videos (video_id, channel_id, last_fetch_status) "
        "VALUES ('vread', ?, 'success')",
        (FULL,),
    )
    conn.commit()
    assert store.get_videos_needing_refetch(conn, ["title"]) == [("vread", FULL)]


def test_the_latest_video_is_never_one_brought_back(conn: sqlite3.Connection) -> None:
    full_channel(conn)
    store.archive_channel_locally(conn, FULL, "@aiagentslab", "rejected")
    store.restore_channel_locally(conn, FULL)
    assert store.latest_video(conn, FULL) is None, "only archived rows: wait for the read"
    creator = live_case._creator(conn, FULL, None)  # pyright: ignore[reportPrivateUsage]
    assert creator is not None
    assert "latest_video" not in creator
    assert creator["recent_videos"] == []

    insert(conn, "videos", video(FULL, 9, "4000", "2026-01-01T15:00:00Z"))
    conn.commit()
    latest = store.latest_video(conn, FULL)
    assert latest is not None
    assert latest["video_id"] == f"{FULL}_v9", "a read row, though older than the archived ones"
