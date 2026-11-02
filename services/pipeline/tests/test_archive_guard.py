"""The archive's guard (step S4, A5): every column of `channels`, `channel_keywords` and `videos`
is either KEPT by an archive (on the tombstone, in its `found_via`, or in `archived_videos`) or
DROPPED with a reason, never neither and never both. A column added later fails here, by name,
until someone decides where it goes, so an archive can't lose it quietly."""

import sqlite3

import pytest

from gratovo_pipeline import store

TABLES = ("channels", "channel_keywords", "videos")


def columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}


@pytest.mark.parametrize("table", TABLES)
def test_every_column_is_kept_or_dropped(conn: sqlite3.Connection, table: str) -> None:
    kept, dropped = set(store.KEPT[table]), set(store.DROPPED[table])
    neither = sorted(columns(conn, table) - kept - dropped)
    assert not neither, f"{table}: say whether an archive keeps or drops {', '.join(neither)}"


@pytest.mark.parametrize("table", TABLES)
def test_no_column_is_both_kept_and_dropped(table: str) -> None:
    both = sorted(set(store.KEPT[table]) & set(store.DROPPED[table]))
    assert not both, f"{table}: kept and dropped at once: {', '.join(both)}"


@pytest.mark.parametrize("table", TABLES)
def test_the_maps_name_only_real_columns(conn: sqlite3.Connection, table: str) -> None:
    unknown = sorted((set(store.KEPT[table]) | set(store.DROPPED[table])) - columns(conn, table))
    assert not unknown, f"{table}: no such column: {', '.join(unknown)}"


def test_a_kept_column_lives_where_the_map_says(conn: sqlite3.Connection) -> None:
    assert set(store.KEPT) == set(store.DROPPED) == set(TABLES)
    assert set(store.KEPT["channel_keywords"].values()) == {"found_via"}
    assert set(store.KEPT["videos"].values()) == {"archived_videos"}
    assert set(store.KEPT["videos"]) == columns(conn, "archived_videos"), "the table is the map"


def test_each_channel_column_says_how_the_tombstone_keeps_it(conn: sqlite3.Connection) -> None:
    facts = {name for name, _ in store.ARCHIVE_FACTS}
    kept = store.KEPT["channels"]
    marked_fact = {column for column, how in kept.items() if how == "fact"}
    assert marked_fact == facts, "a fact is an ARCHIVE_FACTS member, and every member is a fact"
    assert facts <= columns(conn, "channel_archive"), "each fact has its tombstone column"
    tombstone = columns(conn, "channel_archive")
    for column, how in kept.items():
        if how == "fact":
            continue
        assert how.startswith("as:"), f"channels.{column}: 'fact' or 'as:<column>', not {how!r}"
        assert how.removeprefix("as:") in tombstone, f"channels.{column}: no tombstone {how}"


def test_every_drop_says_why() -> None:
    for table, reasons in store.DROPPED.items():
        for column, reason in reasons.items():
            assert reason.strip(), f"{table}.{column}"
