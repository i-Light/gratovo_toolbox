"""`rules.minMedianViews` and `rules.minUploads30`: a kept channel below a bound is archived once
its videos are read, with the rule's label; on the bound it stays; both off changes nothing."""

import sqlite3

from fakes import Events, FakeSource, make_search
from test_keyword import KW, MID, source_with

from gratovo_pipeline import store
from gratovo_pipeline.search import keyword
from gratovo_pipeline.search.context import Search


def run(
    conn: sqlite3.Connection, source: FakeSource, **rules: object
) -> tuple[keyword.KeywordResult, Search]:
    changes = {f"job__rules__{k}": v for k, v in rules.items()}
    search = make_search(conn, source, **changes)
    return keyword.process_keyword(search, KW), search


def label_of(conn: sqlite3.Connection) -> str:
    return conn.execute("SELECT label FROM channel_archive WHERE channel_id='UC_mid'").fetchone()[0]


def test_below_the_median_bound_is_archived_with_the_label(conn: sqlite3.Connection) -> None:
    result, search = run(conn, source_with(MID), minMedianViews=1001)

    assert (result.kept, result.swept) == (0, 1)
    assert store.is_archived(conn, "UC_mid")
    assert store.get_channel_row(conn, "UC_mid") is None
    assert label_of(conn) == "inactive"
    assert isinstance(search.events, Events)
    assert search.events.outcomes() == {"@ai-tools-weekly": "swept"}
    assert search.events.channels[0]["median_views"] == 1000


def test_the_rules_label_is_used(conn: sqlite3.Connection) -> None:
    run(conn, source_with(MID), minMedianViews=5000, autoClean__label="haramStuff")
    assert label_of(conn) == "haramStuff"


def test_below_the_uploads_bound_is_archived(conn: sqlite3.Connection) -> None:
    result, _ = run(conn, source_with(MID), minUploads30=4)
    assert (result.kept, result.swept) == (0, 1)
    assert store.is_archived(conn, "UC_mid")


def test_the_bounds_apply_with_the_subscriber_band_off(conn: sqlite3.Connection) -> None:
    result, _ = run(conn, source_with(MID), minUploads30=4, autoClean__enabled=False)
    assert (result.kept, result.swept) == (0, 1)


def test_exactly_on_a_bound_is_kept(conn: sqlite3.Connection) -> None:
    result, _ = run(conn, source_with(MID), minMedianViews=1000, minUploads30=3)
    assert (result.kept, result.swept) == (1, 0)
    assert not store.is_archived(conn, "UC_mid")


def test_no_videos_reads_as_zero_when_a_bound_is_set(conn: sqlite3.Connection) -> None:
    result, _ = run(conn, source_with(MID, uploads=0), minMedianViews=1)
    assert (result.kept, result.swept) == (0, 1)


def test_a_failed_videos_fetch_leaves_the_channel_alone(conn: sqlite3.Connection) -> None:
    source = source_with(MID)
    source.missing_videos = {"UC_mid_v0", "UC_mid_v1", "UC_mid_v2"}
    result, _ = run(conn, source, minMedianViews=1, minUploads30=1)
    assert (result.kept, result.swept) == (1, 0)
    assert not store.is_archived(conn, "UC_mid")


def test_both_bounds_off_changes_nothing(conn: sqlite3.Connection) -> None:
    result, _ = run(conn, source_with(MID), minMedianViews=None, minUploads30=None)
    assert (result.kept, result.swept) == (1, 0)
