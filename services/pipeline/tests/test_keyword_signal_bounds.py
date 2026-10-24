"""`rules.minMedianViews` and `rules.minUploads30`: a kept channel below a bound is archived once
its videos are read, with the rule's label; on the bound it stays; both off changes nothing. A stop
or a block mid-sweep still judges the stamped channels; any other error judges nothing."""

import sqlite3

import pytest
from fakes import Events, FakeSource, channel_info, make_search
from test_keyword import KW, MID, source_with

from gratovo_pipeline import run_control, store
from gratovo_pipeline.search import auto_clean, keyword
from gratovo_pipeline.search.context import Search, SearchBlockedError


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


def three_creators() -> FakeSource:
    infos = [channel_info(f"@ai-creator-{i}", f"UC_{i}", "250000", "US") for i in range(3)]
    return source_with(*infos)


def fail_at_third(source: FakeSource, error: BaseException) -> None:
    def interrupt(handle: str) -> None:
        if handle == "@ai-creator-2":
            raise error

    source.on_read = interrupt


def archived_count(conn: sqlite3.Connection) -> int:
    return conn.execute("SELECT COUNT(*) FROM channel_archive").fetchone()[0]


def test_a_fetch_error_mid_sweep_archives_nothing_and_propagates(
    conn: sqlite3.Connection,
) -> None:
    source = three_creators()
    fail_at_third(source, RuntimeError("the uploads page didn't load"))

    with pytest.raises(RuntimeError, match="uploads page"):
        run(conn, source, minMedianViews=1_000_000, autoClean__enabled=False)

    # Two channels were stamped, but nothing is judged while an unexpected error is in flight.
    stamped = conn.execute("SELECT COUNT(*) FROM channels WHERE videos_fetched_at IS NOT NULL")
    assert stamped.fetchone()[0] == 2
    assert archived_count(conn) == 0


@pytest.mark.parametrize(
    "error",
    [run_control.RunAborted("the run was stopped"), SearchBlockedError("YouTube stopped")],
)
def test_a_stop_or_block_still_judges_the_stamped_channels(
    conn: sqlite3.Connection, error: BaseException
) -> None:
    source = three_creators()
    fail_at_third(source, error)
    changes = {"job__rules__minMedianViews": 1_000_000, "job__rules__autoClean__enabled": False}
    search = make_search(conn, source, **changes)

    with pytest.raises(type(error)):
        keyword.process_keyword(search, KW)

    assert store.is_archived(conn, "UC_0")
    assert store.is_archived(conn, "UC_1")
    assert archived_count(conn) == 2
    assert isinstance(search.events, Events)
    assert search.events.outcomes() == {"@ai-creator-0": "swept", "@ai-creator-1": "swept"}


def test_a_failed_judgement_during_a_stop_re_raises_the_stop(
    conn: sqlite3.Connection, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = three_creators()
    stop = run_control.RunAborted("the run was stopped")
    fail_at_third(source, stop)

    def broken(*_args: object, **_kwargs: object) -> list[auto_clean.SignalSwept]:
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(auto_clean, "sweep_by_signals", broken)

    with pytest.raises(run_control.RunAborted) as raised:
        run(conn, source, minMedianViews=1_000_000)
    assert raised.value is stop


def test_a_failed_judgement_after_a_clean_sweep_propagates(
    conn: sqlite3.Connection, monkeypatch: pytest.MonkeyPatch
) -> None:
    def broken(*_args: object, **_kwargs: object) -> list[auto_clean.SignalSwept]:
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(auto_clean, "sweep_by_signals", broken)

    with pytest.raises(sqlite3.OperationalError):
        run(conn, source_with(MID), minMedianViews=1)
