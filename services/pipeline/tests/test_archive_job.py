"""The archive jobs: sweep tombstones rejected channels, restore takes tombstones back. A real
pipeline.db in a temporary folder; every line is checked against the protocol schema."""

import io
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
