"""The example.load job: a small history in, every table's rows out, the file gone."""

import io
import json
import sqlite3
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from helpers import start_with

from gratovo_pipeline import store
from gratovo_pipeline.jobs import example_load
from gratovo_pipeline.jobs import run as run_job
from gratovo_pipeline.protocol import BadStartError, Emitter

Check = Callable[[str], dict[str, Any]]
SUFFIX_A = "a" * 22
SUFFIX_B = "b" * 22
SUFFIX_C = "c" * 22
UC_LIVE = "UC" + "d" * 22
MS = 1_760_000_000_000  # 2025-10-09T08:53:20Z


def channel(channel_id: str, handle: str) -> dict[str, Any]:
    return {
        "channel_id": channel_id,
        "handle": handle,
        "name": handle[1:],
        "country": "US",
        "subscribers": "120000",
        "first_seen_at": "2026-05-01T10:00:00Z",
        "videos_fetched_at": "2026-05-01T10:05:00Z",
        "videos_last_30": 4,
        "median_views_last_30": 52000,
        "latest_upload_at": "2026-05-20T10:00:00Z",
        "sponsored_ratio": 0.25,
        "seen_brands": '["Notion"]',
        "found_emails": '["hi@example.com"]',
        "found_email_sources": "[]",
        "read_failures": 0,
        "unreadable_until": None,
        "median_known": None,
        "videos_last_30_known": None,
    }


def video(video_id: str, title: str, views: str, published: str) -> dict[str, Any]:
    return {
        "video_id": video_id,
        "channel_id": UC_LIVE,
        "title": title,
        "published_at": published,
        "view_count": views,
    }


def history() -> dict[str, Any]:
    return {
        "channels": [channel(UC_LIVE, "@aitoolsweekly")],
        "videos": [
            video("abcdefghijk", "I let 5 AI agents run my week", "71000", "2026-05-18T09:00:00Z"),
            video(
                "lmnopqrs-_Z", "The AI calendar that finally works", "58000", "2026-05-10T09:00:00Z"
            ),
        ],
        "keywords": [
            {
                "keyword": "ai video editor",
                "status": "done",
                "channels_found": 3,
                "added_at": "2026-05-01T09:00:00Z",
                "completed_at": "2026-05-01T09:30:00Z",
            },
            {
                "keyword": "claude code tutorial",
                "status": "done",
                "channels_found": 1,
                "added_at": "2026-05-02T09:00:00Z",
                "completed_at": "2026-05-02T09:30:00Z",
            },
        ],
        "links": [
            {
                "channel_id": UC_LIVE,
                "keyword": "ai video editor",
                "discovered_at": "2026-05-01T10:00:00Z",
                "source": "local",
            }
        ],
        "runs": [
            {
                "started_at": "2026-05-01T09:00:00Z",
                "finished_at": "2026-05-01T09:30:00Z",
                "status": "done",
                "keywords_total": 2,
                "keywords_done": 2,
                "channels_upserted": 4,
                "videos_upserted": 40,
                "kind": "search",
            }
        ],
        "archive": {
            "labels": ["inactive", "rejected"],
            "keywords": ["ai video editor", "claude code tutorial"],
            "names": ["AI Tools Weekly!", "Prompt Lab 2"],
            # [suffix, name, archived, label, keyword, median, subs, country, videos30,
            #  sponsored, has_email, found]
            "tuples": [
                [SUFFIX_A, 0, MS, 1, 0, 41000, 80000, "US", 3, 1, 1, MS - 86_400_000],
                [SUFFIX_B, 1, MS, 0, 1, None, None, None, None, None, None, MS - 2 * 86_400_000],
                [SUFFIX_C, 1, MS, 0, 1, 900, 1200, "GB", 0, 0, 0, MS - 3 * 86_400_000],
            ],
        },
        "pending": [
            {
                "channel_id": "UC" + SUFFIX_A,
                "keyword": "claude code tutorial",
                "handles_limit": 200,
                "discovered_at": "2026-06-01T10:00:00Z",
            }
        ],
    }


def write_history(folder: Path, name: str = "history.json") -> Path:
    path = folder / name
    path.write_text(json.dumps(history()), encoding="utf-8")
    return path


def table(conn: sqlite3.Connection, name: str) -> list[sqlite3.Row]:
    return list(conn.execute(f"SELECT * FROM {name} ORDER BY 1, 2"))  # noqa: S608


def test_the_job_fills_every_table_and_deletes_the_file(
    tmp_path: Path, check_from_pipeline: Check
) -> None:
    path = write_history(tmp_path)
    out = io.StringIO()
    start = start_with(
        source="example",
        dataDir=str(tmp_path),
        job={"kind": "example.load", "file": "history.json"},
    )
    run_job(start, Emitter(out))
    lines = [check_from_pipeline(line + "\n") for line in out.getvalue().splitlines()]
    results = [m for m in lines if m["type"] == "result"]
    assert results == [
        {
            "type": "result",
            "kind": "example.load",
            "data": {
                "channels": 1,
                "keywords": 2,
                "links": 1,
                "runs": 1,
                "archived": 3,
                "pending": 1,
            },
        }
    ]
    assert lines[-1]["type"] == "end"
    assert lines[-1]["state"] == "done"
    assert not path.exists()

    conn = store.get_connection(tmp_path / "pipeline.db")
    assert [r["channel_id"] for r in table(conn, "channels")] == [UC_LIVE]
    assert len(table(conn, "keywords")) == 2
    assert len(table(conn, "channel_keywords")) == 1
    assert len(table(conn, "runs")) == 1
    assert len(table(conn, "archive_keyword_pending")) == 1
    assert len(table(conn, "channel_archive")) == 3
    videos = table(conn, "videos")
    assert [(v["video_id"], v["channel_id"], v["title"], v["view_count"]) for v in videos] == [
        ("abcdefghijk", UC_LIVE, "I let 5 AI agents run my week", "71000"),
        ("lmnopqrs-_Z", UC_LIVE, "The AI calendar that finally works", "58000"),
    ]
    assert videos[0]["published_at"] == "2026-05-18T09:00:00Z"
    # A read leaves the channel's own stamp and a success status.
    assert {v["last_fetched_at"] for v in videos} == {"2026-05-01T10:05:00Z"}
    assert {v["last_fetch_status"] for v in videos} == {"success"}

    row = conn.execute(
        "SELECT * FROM channel_archive WHERE channel_id=?", ("UC" + SUFFIX_A,)
    ).fetchone()
    assert row["handle"] == "@aitoolsweekly"
    assert row["name"] == "AI Tools Weekly!"
    assert row["label"] == "rejected"
    assert row["archived_at"] == "2025-10-09T08:53:20Z"
    assert row["found_at"] == "2025-10-08T08:53:20Z"
    assert row["subscribers"] == "80000"
    assert row["median_views_last_30"] == 41000
    assert row["median_basis"] == "window30"
    assert row["country"] == "US"
    assert row["videos_last_30"] == 3
    assert row["source"] == "local"
    assert json.loads(row["seen_brands"]) == ["sponsor"]
    assert json.loads(row["found_emails"]) == ["aitoolsweekly@example.com"]
    assert json.loads(row["found_via"]) == [
        {"keyword": "ai video editor", "limit": None, "discovered_at": "2025-10-08T08:53:20Z"},
        {"keyword": "claude code tutorial", "limit": 200, "discovered_at": "2026-06-01T10:00:00Z"},
    ]
    # Unknown stays NULL; "none" is an empty list.
    unknown = conn.execute(
        "SELECT * FROM channel_archive WHERE channel_id=?", ("UC" + SUFFIX_B,)
    ).fetchone()
    assert unknown["seen_brands"] is None
    assert unknown["found_emails"] is None
    assert unknown["median_views_last_30"] is None
    assert unknown["median_basis"] is None
    none = conn.execute(
        "SELECT * FROM channel_archive WHERE channel_id=?", ("UC" + SUFFIX_C,)
    ).fetchone()
    assert none["seen_brands"] == "[]"
    assert none["found_emails"] == "[]"
    conn.close()


def test_a_failed_load_changes_nothing_and_ends_failed(
    tmp_path: Path, check_from_pipeline: Check
) -> None:
    data = history()
    data["links"].append(
        {
            "channel_id": "UC" + "z" * 22,  # no such channel: a foreign key fails
            "keyword": "x",
            "discovered_at": "2026-05-01T10:00:00Z",
            "source": "local",
        }
    )
    path = tmp_path / "history.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    out = io.StringIO()
    start = start_with(
        source="example",
        dataDir=str(tmp_path),
        job={"kind": "example.load", "file": "history.json"},
    )
    run_job(start, Emitter(out))
    lines = [check_from_pipeline(line + "\n") for line in out.getvalue().splitlines()]
    assert lines[-1]["state"] == "failed"
    conn = store.get_connection(tmp_path / "pipeline.db")
    assert table(conn, "channels") == []
    assert table(conn, "channel_archive") == []
    conn.close()


@pytest.mark.parametrize("name", ["../history.json", "sub/history.json", "a\\b.json", "..", ""])
def test_a_file_name_with_a_separator_is_refused(tmp_path: Path, name: str) -> None:
    with pytest.raises(BadStartError):
        start_with(
            source="example", dataDir=str(tmp_path), job={"kind": "example.load", "file": name}
        )
    with pytest.raises(ValueError, match="plain file name"):
        example_load.run_file(tmp_path, name)


def test_it_does_not_run_on_live_data(tmp_path: Path, check_from_pipeline: Check) -> None:
    path = write_history(tmp_path)
    out = io.StringIO()
    job = {"kind": "example.load", "file": "history.json"}
    start = start_with(source="live", dataDir=str(tmp_path), job=job, secrets__youtubeKey="k")
    run_job(start, Emitter(out))
    lines = [check_from_pipeline(line + chr(10)) for line in out.getvalue().splitlines()]
    assert lines[-1]["state"] == "failed"
    assert not (tmp_path / "pipeline.db").exists()
    assert path.exists()  # nothing was touched


@pytest.mark.parametrize("name", ["CON", "nul.json", "Com1.txt", "lpt9"])
def test_a_windows_device_name_is_refused(tmp_path: Path, name: str) -> None:
    with pytest.raises(ValueError, match="plain file name"):
        example_load.run_file(tmp_path, name)


def test_it_does_not_load_on_top_of_channels(tmp_path: Path) -> None:
    write_history(tmp_path)
    example_load.run_file(tmp_path, "history.json")
    write_history(tmp_path)
    with pytest.raises(ValueError, match=r"empty pipeline.db"):
        example_load.run_file(tmp_path, "history.json")
    conn = store.get_connection(tmp_path / "pipeline.db")
    assert len(table(conn, "channels")) == len(history()["channels"])
    conn.close()
    assert not (tmp_path / "history.json").exists()  # the file goes all the same


def test_a_history_without_videos_still_loads(tmp_path: Path) -> None:
    data = history()
    del data["videos"]
    conn = store.get_connection(tmp_path / "pipeline.db")
    store.init_db(conn)
    counts = example_load.load(conn, data)
    assert counts["channels"] == 1
    assert table(conn, "videos") == []
    conn.close()


def test_rollup_keys_load_and_older_histories_load_as_null(tmp_path: Path) -> None:
    keys = {
        "main_language": "en",
        "main_language_basis": "audio 4/5",
        "topic_counts": '{"Technology": 5}',
        "total_views": 1000,
        "video_count": 50,
        "started_at": "2020-01-01T00:00:00Z",
        "median_likes": 10,
        "median_comments": 2,
        "engagement_rate": 0.04,
        "median_duration_s": 600,
        "shorts_share": 0.1,
        "paid_share": 0.2,
    }
    with_keys = history()
    with_keys["channels"][0].update(keys)
    conn = store.get_connection(tmp_path / "pipeline.db")
    store.init_db(conn)
    example_load.load(conn, with_keys)
    row = table(conn, "channels")[0]
    assert {k: row[k] for k in keys} == keys
    conn.close()
    conn = store.get_connection(tmp_path / "second.db")
    store.init_db(conn)
    example_load.load(conn, history())
    row = table(conn, "channels")[0]
    assert all(row[k] is None for k in keys)
    conn.close()


def _route(run_id: int, label: str) -> dict[str, Any]:
    return {
        "run_id": run_id, "kind": "aws", "label": label, "requests": 10, "successes": 9,
        "blocks": 1, "connection_failures": 0, "bytes": 1000, "keywords_finished": 2,
        "channels_found": 5, "in_range_found": 3, "seconds_used": 12.5, "seconds_resting": 1.0,
    }  # fmt: skip


def test_run_routes_load_against_the_inserted_run_ids(tmp_path: Path) -> None:
    data = history()
    data["runs"] = [data["runs"][0], data["runs"][0]]
    data["runRoutes"] = [_route(1, "us-east-1"), _route(2, "eu-west-1")]
    conn = store.get_connection(tmp_path / "pipeline.db")
    store.init_db(conn)
    example_load.load(conn, data)
    rows = conn.execute("SELECT run_id, label, in_range_found FROM run_routes ORDER BY run_id")
    ids = [r["run_id"] for r in conn.execute("SELECT run_id FROM runs ORDER BY run_id")]
    assert [(r["run_id"], r["label"], r["in_range_found"]) for r in rows] == [
        (ids[0], "us-east-1", 3),
        (ids[1], "eu-west-1", 3),
    ]
    conn.close()


def test_a_history_without_run_routes_loads_with_none(tmp_path: Path) -> None:
    conn = store.get_connection(tmp_path / "pipeline.db")
    store.init_db(conn)
    example_load.load(conn, history())
    assert table(conn, "run_routes") == []
    conn.close()


def test_the_desktop_reader_columns_exist_in_run_routes(tmp_path: Path) -> None:
    conn = store.get_connection(tmp_path / "pipeline.db")
    store.init_db(conn)
    have = {r[1] for r in conn.execute("PRAGMA table_info(run_routes)")}
    wanted = {
        "kind", "label", "requests", "successes", "blocks", "connection_failures", "bytes",
        "keywords_finished", "channels_found", "in_range_found", "seconds_used", "seconds_resting",
    }  # fmt: skip
    assert wanted <= have
    conn.close()
