"""The archive jobs: sweep tombstones rejected channels, restore takes tombstones back. A real
pipeline.db in a temporary folder; every line is checked against the protocol schema."""

import io
import json
import sqlite3
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from helpers import start_with

from gratovo_pipeline import run_control, store
from gratovo_pipeline.jobs import run as run_job
from gratovo_pipeline.protocol import Emitter

Check = Callable[[str], dict[str, Any]]
UC_A = "UC" + "a" * 22
UC_B = "UC" + "b" * 22
UC_C = "UC" + "c" * 22


@pytest.fixture(autouse=True)
def fresh_stop() -> Iterator[None]:
    run_control.clear_stop()
    yield
    run_control.clear_stop()


def run(tmp_path: Path, check: Check, job: dict[str, Any]) -> list[dict[str, Any]]:
    out = io.StringIO()
    run_job(start_with(source="example", dataDir=str(tmp_path), job=job), Emitter(out))
    return [check(line + "\n") for line in out.getvalue().splitlines()]


def db(tmp_path: Path) -> sqlite3.Connection:
    conn = store.get_connection(tmp_path / "pipeline.db")
    store.init_db(conn)
    return conn


def add_channel(conn: sqlite3.Connection, channel_id: str, handle: str) -> None:
    conn.execute(
        "INSERT INTO channels (channel_id, handle, first_seen_at) VALUES (?, ?, ?)",
        (channel_id, handle, "2026-01-01T00:00:00Z"),
    )
    conn.execute(
        "INSERT INTO channel_keywords (channel_id, keyword, discovered_at) VALUES (?, ?, ?)",
        (channel_id, "ai tools", "2026-01-01T00:00:00Z"),
    )
    conn.commit()


def tombstone(conn: sqlite3.Connection, channel_id: str) -> sqlite3.Row | None:
    row: sqlite3.Row | None = conn.execute(
        "SELECT * FROM channel_archive WHERE channel_id=?", (channel_id,)
    ).fetchone()
    return row


def sweep_job(*channels: tuple[str, str | None]) -> dict[str, Any]:
    return {
        "kind": "archive.sweep",
        "channels": [{"channelId": i, "handle": h} for i, h in channels],
    }


def test_sweep_tombstones_a_channel_and_deletes_its_rows(
    tmp_path: Path, check_from_pipeline: Check
) -> None:
    conn = db(tmp_path)
    add_channel(conn, UC_A, "@aitoolsdaily")

    lines = run(tmp_path, check_from_pipeline, sweep_job((UC_A, "@aitoolsdaily")))

    assert [m["type"] for m in lines] == ["result", "end"]
    assert lines[0]["data"] == {"archived": 1}
    assert lines[1]["state"] == "done"
    row = tombstone(conn, UC_A)
    assert row is not None
    assert row["label"] == "rejected"
    assert row["handle"] == "@aitoolsdaily"
    assert store.get_channel_row(conn, UC_A) is None
    assert conn.execute("SELECT COUNT(*) FROM channel_keywords").fetchone()[0] == 0
    conn.close()


def test_sweep_tombstones_a_channel_with_no_row(tmp_path: Path, check_from_pipeline: Check) -> None:
    conn = db(tmp_path)

    lines = run(tmp_path, check_from_pipeline, sweep_job((UC_A, None), (UC_B, "@newsbot")))

    assert lines[0]["data"] == {"archived": 2}
    row_a, row_b = tombstone(conn, UC_A), tombstone(conn, UC_B)
    assert row_a is not None
    assert not row_a["handle"]
    assert row_b is not None
    assert row_b["handle"] == "@newsbot"
    conn.close()


def test_sweep_leaves_an_archived_channel_alone(tmp_path: Path, check_from_pipeline: Check) -> None:
    conn = db(tmp_path)
    add_channel(conn, UC_A, "@old")
    store.archive_channel_locally(conn, UC_A, "@old", "inactive", subscribers=1200)
    before = dict(tombstone(conn, UC_A) or {})

    lines = run(tmp_path, check_from_pipeline, sweep_job((UC_A, "@old"), (UC_B, "@fresh")))

    assert lines[0]["data"] == {"archived": 1}
    after = tombstone(conn, UC_A)
    assert after is not None
    assert dict(after) == before
    assert after["label"] == "inactive"
    conn.close()


def test_sweep_takes_the_handle_from_the_channel_row_when_none_is_sent(
    tmp_path: Path, check_from_pipeline: Check
) -> None:
    conn = db(tmp_path)
    add_channel(conn, UC_A, "@kept")

    run(tmp_path, check_from_pipeline, sweep_job((UC_A, None)))

    row = tombstone(conn, UC_A)
    assert row is not None
    assert row["handle"] == "@kept"
    conn.close()


def test_restore_returns_handles_and_deletes_only_the_named_tombstones(
    tmp_path: Path, check_from_pipeline: Check
) -> None:
    conn = db(tmp_path)
    for channel_id, handle in ((UC_A, "@good"), (UC_B, "odd handle!"), (UC_C, "@stays")):
        store.archive_channel_locally(conn, channel_id, handle, "rejected")
    missing = "UC" + "z" * 22

    lines = run(
        tmp_path,
        check_from_pipeline,
        {"kind": "archive.restore", "channelIds": [UC_A, UC_B, missing]},
    )

    assert lines[0]["data"] == {
        "restored": [
            {"channelId": UC_A, "handle": "@good"},
            {"channelId": UC_B, "handle": None},
        ]
    }
    assert lines[1]["state"] == "done"
    assert tombstone(conn, UC_A) is None
    assert tombstone(conn, UC_B) is None
    assert tombstone(conn, UC_C) is not None
    conn.close()


def test_restore_adds_a_missing_at_sign(tmp_path: Path, check_from_pipeline: Check) -> None:
    conn = db(tmp_path)
    store.archive_channel_locally(conn, UC_A, "plainname", "rejected")
    store.archive_channel_locally(conn, UC_B, "", "rejected")

    lines = run(
        tmp_path, check_from_pipeline, {"kind": "archive.restore", "channelIds": [UC_A, UC_B]}
    )

    assert lines[0]["data"]["restored"] == [
        {"channelId": UC_A, "handle": "@plainname"},
        {"channelId": UC_B, "handle": None},
    ]
    conn.close()


def test_a_stop_ends_stopped_with_what_landed(tmp_path: Path, check_from_pipeline: Check) -> None:
    run_control.request_stop()

    lines = run(tmp_path, check_from_pipeline, sweep_job((UC_A, "@a")))

    assert lines[0]["data"] == {"archived": 0}
    assert lines[1]["state"] == "stopped"


def test_a_crash_ends_failed_without_the_error_text(
    tmp_path: Path, check_from_pipeline: Check, monkeypatch: pytest.MonkeyPatch
) -> None:
    def boom(*_: object, **__: object) -> None:
        raise RuntimeError(r"secret C:\private\path")

    monkeypatch.setattr(store, "archive_channel_locally", boom)

    lines = run(tmp_path, check_from_pipeline, sweep_job((UC_A, "@a")))

    assert [m["type"] for m in lines] == ["end"]
    assert lines[0]["state"] == "failed"
    assert lines[0]["error"]["code"] == "crash"
    assert "secret" not in lines[0]["error"]["message"]


# --- the archive keeps its data (plan D42 to D44) ---


def add_full_channel(conn: sqlite3.Connection, channel_id: str) -> None:
    """A channel read in full: its facts, keywords found on different days, and two videos."""
    conn.execute(
        "INSERT INTO channels (channel_id, handle, name, subscribers, country, first_seen_at, "
        " videos_fetched_at, videos_last_30, median_views_last_30, latest_upload_at, "
        " seen_brands, found_emails, found_email_sources) "
        "VALUES (?, '@llmnewsroom', 'LLM Newsroom', '76000', 'GB', '2026-01-01T00:00:00Z', "
        " '2026-03-02T00:00:00Z', 1, 5400, '2026-03-01T00:00:00Z', '[\"Perplexity\"]', "
        ' \'["desk@llmnewsroom.example"]\', \'[{"email": "desk@llmnewsroom.example"}]\')',
        (channel_id,),
    )
    conn.executemany(
        "INSERT INTO channel_keywords (channel_id, keyword, discovered_at) VALUES (?, ?, ?)",
        [
            (channel_id, "ai news", "2026-01-01T00:00:00Z"),
            (channel_id, "gpt release recap", "2026-02-14T00:00:00Z"),
        ],
    )
    conn.executemany(
        "INSERT INTO videos (video_id, channel_id, view_count) VALUES (?, ?, ?)",
        [(f"{channel_id}_1", channel_id, "5400"), (f"{channel_id}_2", channel_id, "8000")],
    )
    conn.commit()


def test_the_sweep_keeps_every_fact_and_every_keyword(
    tmp_path: Path, check_from_pipeline: Check
) -> None:
    conn = db(tmp_path)
    add_full_channel(conn, UC_A)

    run(tmp_path, check_from_pipeline, sweep_job((UC_A, "@llmnewsroom")))

    row = tombstone(conn, UC_A)
    assert row is not None
    assert (row["name"], row["country"], row["subscribers"]) == ("LLM Newsroom", "GB", "76000")
    assert (row["videos_last_30"], row["latest_upload_at"]) == (1, "2026-03-01T00:00:00Z")
    assert row["found_at"] == "2026-01-01T00:00:00Z"
    assert (row["median_views_last_30"], row["videos_found_count"]) == (5400, 2)
    assert row["seen_brands"] == '["Perplexity"]'
    assert row["found_emails"] == '["desk@llmnewsroom.example"]'
    assert row["found_email_sources"] == '[{"email": "desk@llmnewsroom.example"}]'
    assert [(e["keyword"], e["discovered_at"]) for e in json.loads(row["found_via"])] == [
        ("ai news", "2026-01-01T00:00:00Z"),
        ("gpt release recap", "2026-02-14T00:00:00Z"),
    ]
    conn.close()


def test_a_re_sweep_merges_a_row_that_came_back_and_loses_nothing(
    tmp_path: Path, check_from_pipeline: Check
) -> None:
    conn = db(tmp_path)
    add_full_channel(conn, UC_A)
    run(tmp_path, check_from_pipeline, sweep_job((UC_A, "@llmnewsroom")))
    before = dict(tombstone(conn, UC_A) or {})
    conn.execute(
        "INSERT INTO channels (channel_id, handle, first_seen_at) "
        "VALUES (?, '@llmnewsroom', '2026-09-01T00:00:00Z')",
        (UC_A,),
    )
    conn.execute(
        "INSERT INTO channel_keywords (channel_id, keyword, discovered_at) "
        "VALUES (?, 'ai agents news', '2026-09-01T00:00:00Z')",
        (UC_A,),
    )
    conn.commit()

    lines = run(tmp_path, check_from_pipeline, sweep_job((UC_A, None)))

    assert lines[0]["data"] == {"archived": 0}, "merged, not new"
    after = tombstone(conn, UC_A)
    assert after is not None
    for key in ("label", "archived_at", "found_at", "subscribers", "name", "videos_found_count"):
        assert after[key] == before[key], key
    assert [e["keyword"] for e in json.loads(after["found_via"])] == [
        "ai news",
        "gpt release recap",
        "ai agents news",
    ]
    assert store.get_channel_row(conn, UC_A) is None
    conn.close()


def test_restore_brings_the_row_and_its_keywords_back(
    tmp_path: Path, check_from_pipeline: Check
) -> None:
    conn = db(tmp_path)
    add_full_channel(conn, UC_A)
    run(tmp_path, check_from_pipeline, sweep_job((UC_A, "@llmnewsroom")))

    lines = run(tmp_path, check_from_pipeline, {"kind": "archive.restore", "channelIds": [UC_A]})

    assert lines[0]["data"] == {"restored": [{"channelId": UC_A, "handle": "@llmnewsroom"}]}
    assert tombstone(conn, UC_A) is None
    row = store.get_channel_row(conn, UC_A)
    assert row is not None
    assert (row["name"], row["subscribers"], row["first_seen_at"]) == (
        "LLM Newsroom",
        "76000",
        "2026-01-01T00:00:00Z",
    )
    assert (row["videos_fetched_at"], row["force_refetch"]) == (None, 1)
    keywords = conn.execute(
        "SELECT keyword, discovered_at FROM channel_keywords WHERE channel_id=? ORDER BY 2",
        (UC_A,),
    ).fetchall()
    assert [tuple(k) for k in keywords] == [
        ("ai news", "2026-01-01T00:00:00Z"),
        ("gpt release recap", "2026-02-14T00:00:00Z"),
    ]
    conn.close()
