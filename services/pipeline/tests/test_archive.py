"""The pipeline's half of archiving, and the handle-level gate (ported from the old test_archive).

What matters is the tombstone: without it, the next search for the same keyword would find a
rejected channel again, add it back as new, spend quota on its videos and hand it to somebody to
vet a second time.
"""

import json
import sqlite3

import pytest

from gratovo_pipeline import store
from gratovo_pipeline.protocol import REFETCH_KEYWORD


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


def full_channel(conn: sqlite3.Connection, channel_id: str = FULL) -> None:
    """A channel this machine read in full: every fact, three keywords found on different days,
    and three videos."""
    conn.execute(
        "INSERT INTO channels (channel_id, handle, name, subscribers, country, first_seen_at, "
        " videos_fetched_at, videos_last_30, median_views_last_30, latest_upload_at, "
        " seen_brands, found_emails, found_email_sources) "
        "VALUES (?, '@aiagentslab', 'AI Agents Lab', '48200', 'US', ?, '2026-04-11T00:00:00Z', "
        " 2, 12000, '2026-04-09T15:00:00Z', '[\"Notion AI\"]', ?, ?)",
        (channel_id, FIRST_SEEN, EMAILS, SOURCES),
    )
    conn.executemany(
        "INSERT INTO channel_keywords (channel_id, keyword, discovered_at) VALUES (?, ?, ?)",
        [(channel_id, keyword, at) for keyword, at in LINKS],
    )
    conn.executemany(
        "INSERT INTO videos (video_id, channel_id, view_count, published_at) VALUES (?, ?, ?, ?)",
        [
            (f"{channel_id}_v1", channel_id, "15000", "2026-04-09T15:00:00Z"),
            (f"{channel_id}_v2", channel_id, "9000", "2026-04-01T15:00:00Z"),
            (f"{channel_id}_v3", channel_id, "30000", "2026-01-20T15:00:00Z"),
        ],
    )
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


@pytest.mark.parametrize(("read", "kept"), [(5, 5), (2, 3)])
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
    assert row["videos_found_count"] == kept, "the larger count wins"
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
