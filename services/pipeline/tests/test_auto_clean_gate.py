"""The auto-clean rule's subscriber gate, decided inside a run before any videos are fetched:

- inside the range: left alone, fetched now like always
- below it (here 'sweep'): archived locally and dropped from the run
- above it (here 'delay'): kept, its videos left to the backlog
- count unknown: left alone; nothing is archived on a missing number
"""

import json
import sqlite3

import pytest

from gratovo_pipeline import store
from gratovo_pipeline.config import AutoCleanRule
from gratovo_pipeline.protocol import AutoCleanAction
from gratovo_pipeline.search import auto_clean
from gratovo_pipeline.search.auto_clean import GateResult


def rule(
    *,
    low: int = 50_000,
    high: int = 5_000_000,
    below: AutoCleanAction = "sweep",
    above: AutoCleanAction = "delay",
) -> AutoCleanRule:
    return AutoCleanRule(
        min_subscribers=low,
        max_subscribers=high,
        below_min=below,
        above_max=above,
        label="irrelevant",
    )


def seed(conn: sqlite3.Connection, handle: str, channel_id: str, subscribers: str) -> None:
    """A found channel with its details saved: the state the gate sees (videos not yet read)."""
    store.record_channel_discovery(conn, handle, channel_id, "ai agents")
    conn.execute(
        "UPDATE channels SET subscribers=?, last_fetched_at='2026-09-01T00:00:00Z' "
        "WHERE channel_id=?",
        (subscribers, channel_id),
    )
    conn.commit()


def gate(
    conn: sqlite3.Connection,
    discovered: dict[str, str],
    subscribers: dict[str, str],
    *,
    with_rule: AutoCleanRule | None = None,
    keyword: str = "ai agents",
) -> GateResult:
    info = {handle: {"Subscribers": count} for handle, count in subscribers.items()}
    return auto_clean.apply_gate(
        conn, with_rule or rule(), discovered, info, keyword=keyword, handles_limit=10
    )


# --- the verdict for one count ---


@pytest.mark.parametrize(
    ("subscribers", "verdict"),
    [
        (250_000, None),
        (1_200, "sweep"),
        (9_000_000, "delay"),
        (50_000, None),  # the bounds are inside the range
        (5_000_000, None),
        (None, None),  # unknown size is never acted on
    ],
)
def test_the_verdict_for_one_count(subscribers: int | None, verdict: str | None) -> None:
    assert auto_clean.action_for(rule(), subscribers) == verdict


def test_a_band_switched_off_has_no_verdict() -> None:
    assert auto_clean.action_for(rule(below="off"), 5) is None


def test_no_rule_has_no_verdict() -> None:
    assert auto_clean.action_for(None, 1_200) is None


@pytest.mark.parametrize(
    ("value", "parsed"),
    [
        ("48200", 48200),
        ("1,200", 1200),
        (" 7 ", 7),
        (31, 31),
        ("Hidden", None),
        ("", None),
        (None, None),
        ("1.2M", None),
    ],
)
def test_a_subscriber_count_is_a_plain_number_or_unknown(value: object, parsed: int | None) -> None:
    assert auto_clean.parse_subscribers(value) == parsed


# --- the gate over a keyword's finds ---


def test_an_in_range_channel_is_untouched(conn: sqlite3.Connection) -> None:
    seed(conn, "@mid", "UC_mid", "250000")
    discovered = {"@mid": "UC_mid"}
    result = gate(conn, discovered, {"@mid": "250000"})
    assert (result.swept, result.delayed) == ([], set())
    assert discovered == {"@mid": "UC_mid"}
    assert not store.is_archived(conn, "UC_mid")


def test_below_the_minimum_is_swept(conn: sqlite3.Connection) -> None:
    seed(conn, "@tiny", "UC_tiny", "1200")
    discovered = {"@tiny": "UC_tiny"}
    result = gate(conn, discovered, {"@tiny": "1200"})
    assert [(s.handle, s.channel_id, s.subscribers) for s in result.swept] == [
        ("@tiny", "UC_tiny", 1200)
    ]
    assert result.delayed == set()
    # Gone from the working set and the channels table; tombstoned.
    assert "@tiny" not in discovered
    assert store.get_channel_row(conn, "UC_tiny") is None
    assert store.is_archived(conn, "UC_tiny")


def test_a_swept_tombstone_carries_the_count_label_and_keyword(conn: sqlite3.Connection) -> None:
    seed(conn, "@tiny", "UC_tiny", "1200")
    gate(conn, {"@tiny": "UC_tiny"}, {"@tiny": "1200"}, keyword="ai video tools")
    row = conn.execute(
        "SELECT label, subscribers, found_at, found_via FROM channel_archive "
        "WHERE channel_id='UC_tiny'"
    ).fetchone()
    assert (row["label"], row["subscribers"]) == ("irrelevant", "1200")
    assert row["found_at"] is not None
    found_via = json.loads(row["found_via"])
    assert len(found_via) == 1
    assert (found_via[0]["keyword"], found_via[0]["limit"]) == ("ai video tools", 10)
    assert found_via[0]["discovered_at"]


def test_above_the_maximum_is_delayed_not_archived(conn: sqlite3.Connection) -> None:
    seed(conn, "@huge", "UC_huge", "9000000")
    discovered = {"@huge": "UC_huge"}
    result = gate(conn, discovered, {"@huge": "9000000"})
    assert (result.swept, result.delayed) == ([], {"@huge"})
    # Still live and in the working set, just not this run's video work: the backlog owns it.
    assert "@huge" in discovered
    assert not store.is_archived(conn, "UC_huge")
    row = store.get_channel_row(conn, "UC_huge")
    assert row is not None
    assert row["videos_fetched_at"] is None


def test_an_unknown_count_is_left_alone_and_counted(conn: sqlite3.Connection) -> None:
    seed(conn, "@hidden", "UC_hidden", "Hidden")
    discovered = {"@hidden": "UC_hidden"}
    result = gate(conn, discovered, {"@hidden": "Hidden"})
    assert (result.swept, result.delayed, result.unknown) == ([], set(), 1)
    assert "@hidden" in discovered


def test_the_stored_count_is_used_when_the_fetch_returned_none(conn: sqlite3.Connection) -> None:
    seed(conn, "@tiny", "UC_tiny", "900")
    result = gate(conn, {"@tiny": "UC_tiny"}, {})
    assert [s.handle for s in result.swept] == ["@tiny"]


def test_each_band_can_take_the_other_action(conn: sqlite3.Connection) -> None:
    seed(conn, "@tiny", "UC_tiny", "1200")
    seed(conn, "@huge", "UC_huge", "9000000")
    result = gate(
        conn,
        {"@tiny": "UC_tiny", "@huge": "UC_huge"},
        {"@tiny": "1200", "@huge": "9000000"},
        with_rule=rule(below="delay", above="sweep"),
    )
    assert result.delayed == {"@tiny"}
    assert [s.handle for s in result.swept] == ["@huge"]


def test_off_leaves_a_band_completely_alone(conn: sqlite3.Connection) -> None:
    seed(conn, "@tiny", "UC_tiny", "1200")
    discovered = {"@tiny": "UC_tiny"}
    result = gate(conn, discovered, {"@tiny": "1200"}, with_rule=rule(below="off"))
    assert (result.swept, result.delayed) == ([], set())
    assert not store.is_archived(conn, "UC_tiny")


def test_a_swept_channel_waits_for_the_next_share(conn: sqlite3.Connection) -> None:
    seed(conn, "@tiny", "UC_tiny", "1200")
    gate(conn, {"@tiny": "UC_tiny"}, {"@tiny": "1200"})
    changed = store.get_unannounced_archives(conn)
    assert [r["channel_id"] for r in changed] == ["UC_tiny"]
    assert changed[0]["subscribers"] == "1200"
