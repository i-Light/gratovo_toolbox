"""One keyword, end to end, over a YouTube in memory: what is fetched, what is skipped, what is
saved, and what the app is told."""

import dataclasses
import io
import json
import sqlite3
from collections.abc import Callable, Sequence
from typing import Any

import pytest
from fakes import Events, FakeSource, channel_info, make_search

from gratovo_pipeline import run_control, store
from gratovo_pipeline.protocol import Emitter
from gratovo_pipeline.search import keyword
from gratovo_pipeline.search.context import Search, SearchBlockedError
from gratovo_pipeline.youtube import ChannelInfo, YouTubeError

KW = "best ai video editor 2026"

# Inside the example rule (50k to 2M, below sweeps, above delays), below it and above it.
MID = channel_info("@ai-tools-weekly", "UC_mid", "250000", "US")
TINY = channel_info("@prompt-tinkerer", "UC_tiny", "1200", "US")
HUGE = channel_info("@ai-news-giant", "UC_huge", "9000000", "GB")
ABROAD = channel_info("@agentes-ia", "UC_abroad", "300000", "ES")


def source_with(*infos: ChannelInfo, uploads: int = 3) -> FakeSource:
    return FakeSource(
        results={KW: {info["Handle"]: info["Channel_ID"] for info in infos}},
        details=infos,
        uploads={
            info["Handle"]: [f"{info['Channel_ID']}_v{i}" for i in range(uploads)] for info in infos
        },
    )


def events_of(search: Search) -> Events:
    events = search.events
    assert isinstance(events, Events)
    return events


def test_a_new_channel_is_fetched_read_and_kept(conn: sqlite3.Connection) -> None:
    source = source_with(MID)
    search = make_search(conn, source)

    result = keyword.process_keyword(search, KW)

    assert (result.found, result.kept, result.swept, result.delayed) == (1, 1, 0, 0)
    assert source.read == ["@ai-tools-weekly"]
    row = store.get_channel_row(conn, "UC_mid")
    assert row is not None
    assert row["name"] == "Ai Tools Weekly"
    assert row["videos_fetched_at"] is not None
    assert conn.execute("SELECT COUNT(*) FROM videos").fetchone()[0] == 3
    assert events_of(search).channels == [
        {
            "keyword": KW,
            "channel_id": "UC_mid",
            "handle": "@ai-tools-weekly",
            "name": "Ai Tools Weekly",
            "subscribers": 250000,
            "median_views": 1000,
            "country": "US",
            "outcome": "kept",
        }
    ]
    keyword_row = store.get_keyword(conn, KW)
    assert keyword_row is not None
    assert keyword_row["status"] == "done"
    assert keyword_row["channels_found"] == 1


def test_known_and_archived_channels_cost_nothing(conn: sqlite3.Connection) -> None:
    store.record_channel_discovery(conn, "@ai-tools-weekly", "UC_mid", "an older keyword")
    store.archive_channel_locally(conn, "UC_tiny", "@prompt-tinkerer", "irrelevant")
    source = source_with(MID, TINY)
    search = make_search(conn, source)

    result = keyword.process_keyword(search, KW)

    # Found counts the known one (a question about the keyword); nothing is fetched or kept.
    assert (result.found, result.kept) == (1, 0)
    assert source.channel_calls == []
    assert source.read == []
    assert events_of(search).channels == []
    links = conn.execute("SELECT keyword FROM channel_keywords WHERE channel_id='UC_mid'")
    assert {r["keyword"] for r in links} == {"an older keyword", KW}
    assert [p["keyword"] for p in store.get_archive_keyword_pending(conn)] == [KW]


def test_the_gate_sweeps_and_delays_before_any_upload_is_read(conn: sqlite3.Connection) -> None:
    source = source_with(MID, TINY, HUGE)
    search = make_search(conn, source)

    result = keyword.process_keyword(search, KW)

    assert (result.found, result.kept, result.swept, result.delayed) == (3, 1, 1, 1)
    assert events_of(search).outcomes() == {
        "@prompt-tinkerer": "swept",
        "@ai-news-giant": "delayed",
        "@ai-tools-weekly": "kept",
    }
    swept = next(c for c in events_of(search).channels if c["outcome"] == "swept")
    assert (swept["subscribers"], swept["country"], swept["median_views"]) == (1200, "US", None)
    # The delayed one waits for the backlog.
    assert source.read == ["@ai-tools-weekly"]
    assert store.is_archived(conn, "UC_tiny")


def test_auto_clean_off_keeps_every_band(conn: sqlite3.Connection) -> None:
    source = source_with(MID, TINY, HUGE)
    search = make_search(conn, source, job__rules__autoClean__enabled=False)

    result = keyword.process_keyword(search, KW)

    assert (result.kept, result.swept, result.delayed) == (3, 0, 0)


def test_a_channel_outside_the_countries_is_saved_but_not_read_or_kept(
    conn: sqlite3.Connection,
) -> None:
    source = source_with(MID, ABROAD)
    search = make_search(conn, source)

    result = keyword.process_keyword(search, KW)

    assert (result.found, result.kept) == (2, 1)
    assert source.read == ["@ai-tools-weekly"]
    row = store.get_channel_row(conn, "UC_abroad")
    assert row is not None
    assert row["country"] == "ES"
    assert row["videos_fetched_at"] is None
    assert events_of(search).outcomes() == {"@ai-tools-weekly": "kept"}


def test_no_country_rule_reads_every_country(conn: sqlite3.Connection) -> None:
    source = source_with(MID, ABROAD)
    search = make_search(conn, source, job__rules__countries=[])

    assert keyword.process_keyword(search, KW).kept == 2


def test_details_and_videos_are_asked_for_fifty_at_a_time(conn: sqlite3.Connection) -> None:
    infos = [channel_info(f"@ai-creator-{i}", f"UC_{i:03}") for i in range(60)]
    source = source_with(*infos, uploads=1)
    search = make_search(conn, source, job__rules__autoClean__enabled=False)

    assert keyword.process_keyword(search, KW).kept == 60

    assert [len(c) for c in source.channel_calls] == [50, 10]
    assert [len(c) for c in source.video_calls] == [50, 10]
    assert len(source.sweeps) == 1  # one session for the whole sweep
    assert source.sweeps[0].closed


def test_a_channel_the_api_missed_is_still_kept_under_its_handle(conn: sqlite3.Connection) -> None:
    source = source_with(MID)
    source.details.clear()
    search = make_search(conn, source, job__rules__countries=[])

    keyword.process_keyword(search, KW)

    (kept,) = events_of(search).channels
    assert (kept["name"], kept["subscribers"]) == ("@ai-tools-weekly", None)


@pytest.mark.parametrize(
    "error",
    [
        run_control.RunAborted("the run was stopped"),
        SearchBlockedError("YouTube stopped answering"),
    ],
)
def test_a_stop_or_block_mid_sweep_keeps_what_was_read(
    conn: sqlite3.Connection, error: BaseException
) -> None:
    infos = [channel_info(f"@ai-creator-{i}", f"UC_{i}") for i in range(3)]
    source = source_with(*infos)

    def interrupt_at_third(handle: str) -> None:
        if handle == "@ai-creator-2":
            raise error

    source.on_read = interrupt_at_third
    search = make_search(conn, source, job__rules__autoClean__enabled=False)

    with pytest.raises(type(error)):
        keyword.process_keyword(search, KW)

    # The two channels read before the stop are saved, stamped and announced.
    stamped = conn.execute("SELECT handle FROM channels WHERE videos_fetched_at IS NOT NULL")
    assert sorted(r["handle"] for r in stamped) == ["@ai-creator-0", "@ai-creator-1"]
    assert conn.execute("SELECT COUNT(*) FROM videos").fetchone()[0] == 6
    assert sorted(events_of(search).outcomes()) == ["@ai-creator-0", "@ai-creator-1"]
    # The keyword isn't done: a resume runs it again, and finds these as known.
    keyword_row = store.get_keyword(conn, KW)
    assert keyword_row is not None
    assert keyword_row["status"] != "done"
    assert source.sweeps[0].closed


def test_a_spent_quota_saves_nothing_more_and_ends_the_keyword(conn: sqlite3.Connection) -> None:
    source = source_with(MID)

    def quota(_ids: Sequence[str]) -> None:
        raise YouTubeError("quota", "The YouTube API quota for today is spent.")

    source.on_videos = quota
    search = make_search(conn, source)

    with pytest.raises(YouTubeError):
        keyword.process_keyword(search, KW)

    # Its uploads were read but their details never landed: not stamped, so the backlog keeps it.
    row = store.get_channel_row(conn, "UC_mid")
    assert row is not None
    assert row["videos_fetched_at"] is None
    assert len(source.video_calls) == 0


def test_the_backlog_gets_a_slice_once_the_keyword_is_done(conn: sqlite3.Connection) -> None:
    store.record_channel_discovery(conn, "@llm-explained", "UC_old", "an older keyword")
    source = source_with(MID)
    source.uploads["@llm-explained"] = ["old_v1"]
    search = make_search(conn, source)

    keyword.process_keyword(search, KW)
    assert source.read == ["@ai-tools-weekly"]
    keyword.after_keyword(search)

    assert source.read == ["@ai-tools-weekly", "@llm-explained"]
    row = store.get_channel_row(conn, "UC_old")
    assert row is not None
    assert row["videos_fetched_at"] is not None
    # Backlog channels belong to other keywords: not announced as this one's.
    assert events_of(search).outcomes() == {"@ai-tools-weekly": "kept"}


def test_every_message_matches_the_protocol(
    conn: sqlite3.Connection, check_from_pipeline: Callable[[str], dict[str, Any]]
) -> None:
    out = io.StringIO()
    search = make_search(conn, source_with(MID, TINY, HUGE, ABROAD), events=Emitter(out))

    keyword.process_keyword(search, KW)

    lines = out.getvalue().splitlines(keepends=True)
    messages = [check_from_pipeline(line) for line in lines]
    assert {m["outcome"] for m in messages if m["type"] == "channel"} == {
        "kept",
        "swept",
        "delayed",
    }
    assert all("test-key" not in line for line in lines)
    assert json.loads(lines[0])["type"] == "log"


def test_a_never_contact_channel_is_neither_stored_nor_read(conn: sqlite3.Connection) -> None:
    source = source_with(MID, TINY)
    search = make_search(conn, source)
    search = dataclasses.replace(search, skip=frozenset({"UC_mid"}))

    result = keyword.process_keyword(search, KW)

    assert (result.found, result.kept) == (1, 0)  # TINY is swept by the gate; MID is untouched
    assert "@ai-tools-weekly" not in source.read
    assert store.get_channel_row(conn, "UC_mid") is None
    assert (
        conn.execute("SELECT COUNT(*) FROM channel_keywords WHERE channel_id='UC_mid'").fetchone()[
            0
        ]
        == 0
    )
    assert "UC_mid" not in {c["channel_id"] for c in events_of(search).channels}
    assert (
        "info",
        "Skipped 0 known, 0 archived and 1 never-contact channel(s); 1 new.",
    ) in events_of(search).lines


def test_a_never_contact_channel_we_already_hold_is_left_as_it_is(conn: sqlite3.Connection) -> None:
    store.record_channel_discovery(conn, "@ai-tools-weekly", "UC_mid", "an older keyword")
    before = store.get_channel_row(conn, "UC_mid")
    search = dataclasses.replace(make_search(conn, source_with(MID)), skip=frozenset({"UC_mid"}))

    result = keyword.process_keyword(search, KW)

    assert result.found == 0
    assert store.get_channel_row(conn, "UC_mid") == before


def test_an_empty_skip_changes_nothing(conn: sqlite3.Connection) -> None:
    search = make_search(conn, source_with(MID))
    assert search.skip == frozenset()

    result = keyword.process_keyword(search, KW)

    assert (result.found, result.kept) == (1, 1)
    assert not any("never-contact" in text for _, text in events_of(search).lines)
