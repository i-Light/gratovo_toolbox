"""Sponsorship detection: a phrase scan over each channel's stored video descriptions, and the
brands named by a few confident patterns. A real temporary database: the behaviour is "read these
rows, write these two columns", and a fake store would only test the fake."""

import json
import sqlite3

import pytest

from gratovo_pipeline.search import signals


def add_channel(conn: sqlite3.Connection, channel_id: str) -> None:
    conn.execute(
        "INSERT INTO channels (channel_id, handle, first_seen_at) VALUES (?, ?, ?)",
        (channel_id, "@x", "2026-01-01T00:00:00Z"),
    )
    conn.commit()


def add_video(
    conn: sqlite3.Connection,
    video_id: str,
    channel_id: str,
    description: str | None = None,
    *,
    failed: bool = False,
) -> None:
    if failed:
        conn.execute(
            "INSERT INTO videos (video_id, channel_id, last_fetched_at, last_fetch_status) "
            "VALUES (?, ?, '2026-01-02T00:00:00Z', 'failed')",
            (video_id, channel_id),
        )
    else:
        conn.execute(
            "INSERT INTO videos (video_id, channel_id, description, last_fetched_at, "
            "  last_fetch_status) VALUES (?, ?, ?, '2026-01-02T00:00:00Z', 'success')",
            (video_id, channel_id, description),
        )
    conn.commit()


def sponsorship(conn: sqlite3.Connection, channel_id: str) -> tuple[float | None, list[str]]:
    row = conn.execute(
        "SELECT sponsored_ratio, seen_brands FROM channels WHERE channel_id=?", (channel_id,)
    ).fetchone()
    return row["sponsored_ratio"], json.loads(row["seen_brands"])


# --- the ratio ---


def test_the_ratio_counts_only_videos_with_a_sponsorship_signal(conn: sqlite3.Connection) -> None:
    add_channel(conn, "UC_a")
    add_video(conn, "v1", "UC_a", "This video is sponsored by AgentForge, check them out.")
    add_video(conn, "v2", "UC_a", "Use code AGENTS20 for 20% off at checkout.")
    add_video(conn, "v3", "UC_a", "Testing three AI coding assistants, nothing paid.")
    add_video(conn, "v4", "UC_a", "This week in AI news.")

    signals.compute_sponsorship(conn, ["UC_a"])

    assert sponsorship(conn, "UC_a")[0] == pytest.approx(0.5)


def test_a_channel_with_no_signal_gets_zero(conn: sqlite3.Connection) -> None:
    add_channel(conn, "UC_clean")
    add_video(conn, "v1", "UC_clean", "A walkthrough of an open-source agent framework.")
    add_video(conn, "v2", "UC_clean", "My thoughts on the new model release.")

    signals.compute_sponsorship(conn, ["UC_clean"])

    assert sponsorship(conn, "UC_clean") == (0.0, [])


def test_a_channel_that_is_always_sponsored_gets_one(conn: sqlite3.Connection) -> None:
    add_channel(conn, "UC_full")
    add_video(conn, "v1", "UC_full", "#ad this episode is a paid partnership with PromptLab.")
    add_video(conn, "v2", "UC_full", "Affiliate link to the AI tool in the description.")

    signals.compute_sponsorship(conn, ["UC_full"])

    assert sponsorship(conn, "UC_full")[0] == 1.0


def test_a_failed_video_counts_in_the_denominator_not_the_match(conn: sqlite3.Connection) -> None:
    add_channel(conn, "UC_b")
    add_video(conn, "v1", "UC_b", "Sponsored by AgentForge, use code FORGE10.")
    add_video(conn, "v2", "UC_b", failed=True)

    signals.compute_sponsorship(conn, ["UC_b"])

    assert sponsorship(conn, "UC_b")[0] == pytest.approx(0.5)


def test_no_stored_videos_is_a_null_ratio_not_an_error(conn: sqlite3.Connection) -> None:
    add_channel(conn, "UC_empty")

    signals.compute_sponsorship(conn, ["UC_empty"])

    assert sponsorship(conn, "UC_empty") == (None, [])


def test_no_ids_and_unknown_ids_are_harmless(conn: sqlite3.Connection) -> None:
    signals.compute_sponsorship(conn, [])
    signals.compute_sponsorship(conn, ["UC_missing"])


# --- brands: confident patterns only ---


@pytest.mark.parametrize(
    ("description", "brands"),
    [
        ("This video is sponsored by AgentForge. Try it free.", ["AgentForge"]),
        ("Made in partnership with Prompt Lab for this review.", ["Prompt Lab"]),
        ("Get 15% off with use code AITOOLS at checkout.", ["AITOOLS"]),
        # "sponsored" fires the ratio, but no narrow pattern matches: no guessing.
        ("This video is Sponsored. Thanks for watching!", []),
    ],
)
def test_a_sponsored_description_names_only_confident_brands(
    description: str, brands: list[str]
) -> None:
    assert signals.detect_sponsorship(description) == (True, brands)


def test_capitalised_words_without_a_signal_name_no_brand() -> None:
    assert signals.detect_sponsorship("I Tested Every New AI Model And Ranked Them All") == (
        False,
        [],
    )


def test_a_blank_description_is_neither() -> None:
    assert signals.detect_sponsorship(None) == (False, [])
    assert signals.detect_sponsorship("") == (False, [])


def test_brands_are_deduplicated_and_written_as_json(conn: sqlite3.Connection) -> None:
    add_channel(conn, "UC_dupe")
    add_video(conn, "v1", "UC_dupe", "Sponsored by AgentForge -- AgentForge builds agents.")
    add_video(conn, "v2", "UC_dupe", "This one is also sponsored by AgentForge again.")

    signals.compute_sponsorship(conn, ["UC_dupe"])

    assert sponsorship(conn, "UC_dupe")[1] == ["AgentForge"]
