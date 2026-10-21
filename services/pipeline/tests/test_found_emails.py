"""Emails a creator publishes in their About text and video descriptions.

Creators write their business address in awkward forms so scrapers miss it: "name (at) gmail
(dot) com", "name [at] gmail [dot] com", "name at gmail dot com", spaced or full-width signs. Each
is found and made a plain address; ordinary English ("look at this") and things that only look
like addresses (a retina image name, an @handle) are not.
"""

import json
import sqlite3

import pytest

from gratovo_pipeline import store
from gratovo_pipeline.found_emails import find_emails as find
from gratovo_pipeline.search import signals


def test_a_plain_address() -> None:
    assert find("Business: Hello@StudioAI.io") == ["hello@studioai.io"]


@pytest.mark.parametrize(
    "text",
    [
        "contact: jane (at) gmail (dot) com",
        "jane [at] gmail [dot] com",
        "jane{at}gmail{dot}com",
        "jane(AT)gmail(DOT)com",
    ],
)
def test_spelled_out_with_brackets(text: str) -> None:
    assert find(text) == ["jane@gmail.com"]


def test_spelled_out_in_plain_words() -> None:
    assert find("email me: jane at gmail dot com") == ["jane@gmail.com"]
    assert find("biz AT aiexplained DOT co DOT uk") == ["biz@aiexplained.co.uk"]


def test_spaced_and_full_width_signs() -> None:
    assert find("jane @ gmail . com") == ["jane@gmail.com"]
    assert find("jane＠gmail．com") == ["jane@gmail.com"]  # noqa: RUF001 - full-width on purpose


def test_dots_inside_the_name_and_domain() -> None:
    assert find("first.last (at) mail (dot) studio (dot) io") == ["first.last@mail.studio.io"]


def test_trailing_punctuation_is_not_part_of_it() -> None:
    assert find("Write to a@b.com. Thanks!") == ["a@b.com"]
    assert find("(a@b.com)") == ["a@b.com"]


@pytest.mark.parametrize(
    "text",
    [
        "Look at this dot product video",
        "I'm at home, dot your i's",
        "we met at the conference, more at our site",
    ],
)
def test_ordinary_english_is_not_an_address(text: str) -> None:
    assert find(text) == []


@pytest.mark.parametrize(
    "text", ["logo@2x.png banner@3x.jpg", "follow @aiexplained on X", "https://x.com/@aiexplained"]
)
def test_things_that_only_look_like_addresses(text: str) -> None:
    assert find(text) == []


@pytest.mark.parametrize(
    "text",
    [
        "thanks @Prompt.Lab for helping film",
        "collaborators Neural Notes @agents.weekly !",
        "jane @gmail.com",
    ],
)
def test_a_handle_with_dots_is_a_mention_not_an_address(text: str) -> None:
    # A space before "@" and none after it is how a mention is written.
    assert find(text) == []


def test_a_line_break_does_not_join_a_handle_to_the_next_line() -> None:
    assert find("Thanks to @PromptLab .\n\nAdd a texture") == []


def test_a_capitalised_word_glued_after_the_domain_is_not_part_of_it() -> None:
    assert find("contact: jane@gmail.com.Tags: ai, tools") == ["jane@gmail.com"]


def test_machine_addresses_are_not_contacts() -> None:
    assert find("lore.kernel.org/lkml/abc@pop-os.localdomain/") == []


def test_first_seen_first_and_no_repeats() -> None:
    assert find("About: biz@a.io", "video: biz (at) a (dot) io and team@b.io", None, "") == [
        "biz@a.io",
        "team@b.io",
    ]


def test_nothing_to_read() -> None:
    assert find() == []
    assert find(None, "") == []


# --- the derive step: sponsorship and found emails together ---


def add_channel(conn: sqlite3.Connection, channel_id: str, description: str | None = None) -> None:
    conn.execute(
        "INSERT INTO channels (channel_id, handle, description, first_seen_at) VALUES (?, ?, ?, ?)",
        (channel_id, "@" + channel_id, description, "2026-01-01T00:00:00Z"),
    )


def add_video(conn: sqlite3.Connection, video_id: str, channel_id: str, description: str) -> None:
    conn.execute(
        "INSERT INTO videos (video_id, channel_id, description, last_fetch_status) "
        "VALUES (?, ?, ?, 'success')",
        (video_id, channel_id, description),
    )


def found(conn: sqlite3.Connection, channel_id: str) -> tuple[list[str] | None, float | None]:
    row = conn.execute(
        "SELECT found_emails, sponsored_ratio FROM channels WHERE channel_id=?", (channel_id,)
    ).fetchone()
    emails = json.loads(row["found_emails"]) if row["found_emails"] else None
    return emails, row["sponsored_ratio"]


def test_about_text_first_then_videos(conn: sqlite3.Connection) -> None:
    add_channel(conn, "UC_a", "For business: biz (at) ai (dot) studio")
    add_video(conn, "v1", "UC_a", "Sponsored by AgentForge. Questions? team@ai.studio")
    add_video(conn, "v2", "UC_a", "just a video about AI agents")
    conn.commit()

    signals.derive(conn, ["UC_a"])

    assert found(conn, "UC_a") == (["biz@ai.studio", "team@ai.studio"], 0.5)


def test_a_channel_with_no_address_gets_an_empty_list(conn: sqlite3.Connection) -> None:
    add_channel(conn, "UC_none", "Videos about AI.")
    conn.commit()

    signals.derive(conn, ["UC_none"])

    assert found(conn, "UC_none")[0] == []


def test_a_downloaded_channel_gets_its_signals(conn: sqlite3.Connection) -> None:
    # Another machine read this channel; its object lands through apply_channel_blob, and the
    # derived columns must not stay empty just because no local fetch ran.
    blob = {
        "channel": {
            "channel_id": "UC_r2",
            "handle": "@r2",
            "description": "mail: r2 [at] studio [dot] ai",
            "videos_fetched_at": "2026-10-01T00:00:00Z",
        },
        "videos": [{"video_id": "r1", "description": "Use code PROMPTLAB for 10% off"}],
    }
    store.apply_channel_blob(conn, blob, "2026-10-01T00:00:00Z")

    signals.derive(conn, ["UC_r2"])

    assert found(conn, "UC_r2") == (["r2@studio.ai"], 1.0)


def test_the_backfill_covers_every_channel(conn: sqlite3.Connection) -> None:
    add_channel(conn, "UC_1", "a@one.io")
    add_channel(conn, "UC_2", "b (at) two (dot) io")
    conn.commit()
    lines: list[str] = []

    assert signals.derive_all(conn, batch=1, log=lines.append) == 2

    assert found(conn, "UC_1")[0] == ["a@one.io"]
    assert found(conn, "UC_2")[0] == ["b@two.io"]
    assert lines == ["Signals: 1 of 2 channel(s)", "Signals: 2 of 2 channel(s)"]
