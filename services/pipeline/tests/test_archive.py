"""The pipeline's half of archiving, and the handle-level gate (ported from the old test_archive).

What matters is the tombstone: without it, the next search for the same keyword would find a
rejected channel again, add it back as new, spend quota on its videos and hand it to somebody to
vet a second time.
"""

import json
import sqlite3

from gratovo_pipeline import store


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
