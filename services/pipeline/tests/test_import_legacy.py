"""The import.legacy job: dry run, real run, backups, idempotence, the five refusals, and proof
that the old file is never touched. Over small old databases built in tmp_path."""

import hashlib
import io
import json
import os
import sqlite3
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from helpers import start_with
from legacy_fixture import build

from gratovo_pipeline import jobs, net, store
from gratovo_pipeline.jobs import import_legacy
from gratovo_pipeline.protocol import Emitter, Start


class Run:
    def __init__(self, check: Callable[[str], dict[str, Any]], root: Path) -> None:
        self.out = io.StringIO()
        self.check = check
        self.root = root
        # As the app lays it out: <userData>/pipeline and <userData>/backups.
        self.user_data = root / "user data"
        self.data_dir = self.user_data / "pipeline"
        self.backups = self.user_data / "backups"
        self.source = root / "old app" / "data" / "database" / "gratovo.db"

    def start(self, *, dry_run: bool, source: Path | None = None) -> Start:
        job = {
            "kind": "import.legacy",
            "source": str(source or self.source),
            "dryRun": dry_run,
            "backupDir": None if dry_run else str(self.backups),
        }
        return start_with(source="live", dataDir=str(self.data_dir), job=job, settings={})

    def go(self, *, dry_run: bool = False, source: Path | None = None) -> None:
        self.out = io.StringIO()
        import_legacy.run(self.start(dry_run=dry_run, source=source), Emitter(self.out))

    def messages(self) -> list[dict[str, Any]]:
        return [self.check(line) for line in self.out.getvalue().splitlines(keepends=True)]

    def end(self) -> dict[str, Any]:
        last = self.messages()[-1]
        assert last["type"] == "end"
        return last

    def report(self) -> dict[str, Any]:
        (result,) = [m for m in self.messages() if m["type"] == "result"]
        assert result["kind"] == "import.legacy"
        return result["data"]

    def counts(self) -> dict[str, tuple[int, int, int]]:
        return {t["name"]: (t["inOld"], t["toAdd"], t["already"]) for t in self.report()["tables"]}

    def dest(self) -> sqlite3.Connection:
        return sqlite3.connect(self.data_dir / "pipeline.db")


@pytest.fixture
def run(check_from_pipeline: Callable[[str], dict[str, Any]], tmp_path: Path) -> Run:
    r = Run(check_from_pipeline, tmp_path)
    build(r.source)
    return r


def error_code(r: Run) -> str:
    end = r.end()
    assert end["state"] == "failed"
    return end["error"]["code"]


def fingerprint(path: Path) -> tuple[str, int]:
    return hashlib.sha256(path.read_bytes()).hexdigest(), path.stat().st_mtime_ns


def test_dry_run_reports_and_writes_nothing(run: Run) -> None:
    before = fingerprint(run.source)
    run.go(dry_run=True)
    assert run.end()["state"] == "done"
    report = run.report()
    assert report["dryRun"] is True
    assert report["backup"] is None
    assert run.counts() == {
        "keywords": (2, 2, 0),
        "channels": (2, 2, 0),
        "channel_keywords": (2, 2, 0),
        "videos": (3, 3, 0),
        "channel_archive": (1, 1, 0),
        "runs": (1, 1, 0),
        "video_transcripts": (1, 1, 0),
    }
    assert not run.data_dir.exists()
    assert not run.backups.exists()
    assert fingerprint(run.source) == before


def test_a_channel_beside_its_own_tombstone_gives_the_tombstone_its_facts(run: Run) -> None:
    # The old app could leave a channel and its tombstone side by side; its tombstones kept no
    # name and, from the 7-day sweep, no keywords (plan D42).
    old = sqlite3.connect(run.source)
    old.execute(
        "INSERT INTO channel_archive (channel_id, handle, label, archived_at)"
        " VALUES ('UCai0002', '@claudecodedaily', 'rejected', '2026-09-20T00:00:00Z')"
    )
    old.commit()
    old.close()

    run.go()

    assert run.end()["state"] == "done"
    conn = run.dest()
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT * FROM channel_archive WHERE channel_id = 'UCai0002'").fetchone()
    assert (row["label"], row["archived_at"]) == ("rejected", "2026-09-20T00:00:00Z")
    assert (row["name"], row["subscribers"]) == ("Claude Code Daily", "54000")
    assert [e["keyword"] for e in json.loads(row["found_via"])] == ["claude code tutorial"]
    assert row["announced"] == 0, "nothing is announced"
    assert row["source"] is None
    # The import removes nothing, and an old tombstone with no channel keeps its blanks.
    assert conn.execute("SELECT COUNT(*) FROM channels").fetchone()[0] == 2
    bare = conn.execute("SELECT * FROM channel_archive WHERE channel_id = 'UCai0009'").fetchone()
    assert (bare["handle"], bare["name"], bare["found_via"]) == ("@oldaichannel", None, None)
    conn.close()


def test_dry_run_counts_against_an_existing_store_without_touching_it(run: Run) -> None:
    run.go()
    dest = run.data_dir / "pipeline.db"
    conn = run.dest()
    conn.execute("DELETE FROM videos WHERE video_id = 'vid00000003'")
    conn.commit()
    conn.close()
    before = fingerprint(dest)
    backups = len(list(run.backups.iterdir())) if run.backups.exists() else 0
    run.go(dry_run=True)
    assert run.counts()["videos"] == (3, 1, 2)
    assert fingerprint(dest) == before
    assert (len(list(run.backups.iterdir())) if run.backups.exists() else 0) == backups


def test_real_run_copies_and_the_old_file_is_untouched(run: Run) -> None:
    before = fingerprint(run.source)
    run.go()
    assert run.end()["state"] == "done"
    assert run.report()["backup"] is None  # a first import: nothing to back up
    assert run.counts()["videos"] == (3, 3, 0)
    conn = run.dest()
    assert conn.execute("SELECT COUNT(*) FROM channels").fetchone()[0] == 2
    assert conn.execute("SELECT COUNT(*) FROM videos").fetchone()[0] == 3
    assert conn.execute("SELECT COUNT(*) FROM video_transcripts").fetchone()[0] == 1
    assert conn.execute("PRAGMA user_version").fetchone()[0] == store.SCHEMA_VERSION
    # A legacy file has no sources column: an imported row has it empty.
    assert conn.execute("SELECT found_email_sources FROM channels").fetchall() == [(None,), (None,)]
    found = conn.execute(
        "SELECT found_emails FROM channels WHERE channel_id = 'UCai0001'"
    ).fetchone()[0]
    assert "aitoolsweekly" in found
    conn.close()
    assert fingerprint(run.source) == before


def to_wal(path: Path) -> None:
    """Puts the old file in WAL mode and closes cleanly, so no -wal/-shm is left."""
    conn = sqlite3.connect(path)
    assert conn.execute("PRAGMA journal_mode=WAL").fetchone()[0] == "wal"
    conn.close()
    assert sorted(p.name for p in path.parent.iterdir()) == [path.name]


@pytest.mark.parametrize("dry_run", [True, False])
def test_a_wal_mode_old_file_gets_no_companions(run: Run, dry_run: bool) -> None:
    to_wal(run.source)
    names = sorted(p.name for p in run.source.parent.iterdir())
    before = fingerprint(run.source)
    run.go(dry_run=dry_run)
    assert run.end()["state"] == "done"
    assert run.counts()["videos"] == (3, 3, 0)
    assert sorted(p.name for p in run.source.parent.iterdir()) == names
    assert fingerprint(run.source) == before


def test_a_non_empty_wal_beside_the_old_file_is_refused(run: Run) -> None:
    to_wal(run.source)
    wal = run.source.with_name(run.source.name + "-wal")
    wal.write_bytes(b"unsent pages")
    for dry_run in (True, False):
        run.go(dry_run=dry_run)
        assert error_code(run) == "old_app_open"
    assert not (run.data_dir / "pipeline.db").exists()
    assert wal.read_bytes() == b"unsent pages"


def test_an_empty_wal_beside_the_old_file_is_ignored(run: Run) -> None:
    to_wal(run.source)
    wal = run.source.with_name(run.source.name + "-wal")
    wal.write_bytes(b"")
    run.go()
    assert run.end()["state"] == "done"
    assert run.counts()["videos"] == (3, 3, 0)
    assert wal.read_bytes() == b""
    assert not run.source.with_name(run.source.name + "-shm").exists()


def test_second_run_backs_up_adds_nothing_and_new_rows_win(run: Run) -> None:
    run.go()
    conn = run.dest()
    conn.execute("UPDATE channels SET name = 'Edited here' WHERE channel_id = 'UCai0001'")
    conn.commit()
    conn.close()
    run.go()
    report = run.report()
    assert all(added == 0 for _, added, _ in run.counts().values())
    assert run.counts()["channels"] == (2, 0, 2)
    backup = Path(report["backup"])
    assert backup.parent == run.backups
    assert backup.name.startswith("pipeline-")
    assert backup.suffix == ".db"
    copy = sqlite3.connect(backup)
    assert copy.execute("SELECT COUNT(*) FROM channels").fetchone()[0] == 2
    copy.close()
    conn = run.dest()
    name = conn.execute("SELECT name FROM channels WHERE channel_id = 'UCai0001'").fetchone()[0]
    conn.close()
    assert name == "Edited here"


def test_an_empty_existing_store_needs_no_backup(run: Run) -> None:
    run.data_dir.mkdir(parents=True)
    conn = run.dest()
    store.init_db(conn)
    conn.close()
    run.go()
    assert run.report()["backup"] is None
    assert not run.backups.exists()


def test_missing_tables_and_columns(run: Run, tmp_path: Path) -> None:
    sparse = build(
        tmp_path / "sep" / "data" / "database" / "gratovo.db",
        found_emails=False,
        pipeline_tables=False,
    )
    run.go(source=sparse)
    assert run.end()["state"] == "done"
    counts = run.counts()
    assert counts["channels"] == (2, 2, 0)
    assert counts["videos"] == (0, 0, 0)
    assert counts["video_transcripts"] == (0, 0, 0)
    conn = run.dest()
    assert conn.execute("SELECT found_emails FROM channels").fetchall() == [(None,), (None,)]
    conn.close()


def test_orphan_child_rows_are_dropped_not_fatal(run: Run) -> None:
    old = sqlite3.connect(run.source)
    old.execute(
        "INSERT INTO videos (video_id, channel_id, title) VALUES"
        " ('vid00000099', 'UCgone', 'A video whose channel was deleted')"
    )
    old.execute(
        "INSERT INTO channel_keywords (channel_id, keyword, discovered_at) VALUES"
        " ('UCgone', 'ai news', '2026-09-01T10:00:00Z')"
    )
    old.commit()
    old.close()
    run.go(dry_run=True)
    assert run.counts()["videos"] == (4, 3, 0)
    assert run.counts()["channel_keywords"] == (3, 2, 0)
    run.go()
    assert run.end()["state"] == "done"
    assert run.counts()["videos"] == (4, 3, 0)
    assert run.counts()["channel_keywords"] == (3, 2, 0)
    conn = run.dest()
    assert conn.execute("SELECT COUNT(*) FROM videos").fetchone()[0] == 3
    conn.close()


def test_skipped_unsent_and_settings_files(run: Run) -> None:
    folder = run.source.parent.parent
    (folder / "run_config.json").write_text("{}")
    (folder / "all_keywords.txt").write_text("ai news\n")
    (folder / ".env").write_text("SECRET=1")
    run.go(dry_run=True)
    report = run.report()
    skipped = {s["name"]: (s["rows"], s["why"]) for s in report["skipped"]}
    assert skipped["channel_state"] == (1, "synced")
    assert skipped["brands"] == (1, "synced")
    assert skipped["activity_log"] == (3, "synced")
    assert skipped["_outbox"] == (1, "bookkeeping")
    assert skipped["sync_state"] == (0, "bookkeeping")
    assert skipped["news_sources"] == (1, "not-ported")
    assert "channels" not in skipped
    assert all(not name.startswith("sqlite_") for name in skipped)
    assert report["unsent"] == {"outbox": 1, "activity": 2}
    assert report["settingsFiles"] == [
        {"name": "run_config.json", "found": True},
        {"name": "settings.json", "found": False},
        {"name": "keywords.json", "found": False},
        {"name": "all_keywords.txt", "found": True},
    ]


def test_unsent_is_zero_without_the_app_tables(run: Run, tmp_path: Path) -> None:
    plain = build(tmp_path / "plain" / "gratovo.db", app_tables=False)
    run.go(dry_run=True, source=plain)
    assert run.report()["unsent"] == {"outbox": 0, "activity": 0}


def test_progress_lines(run: Run) -> None:
    run.go()
    progress = [m for m in run.messages() if m["type"] == "progress"]
    assert [(p["table"], p["done"], p["total"]) for p in progress] == [
        (t, i, 7) for i, t in enumerate(import_legacy.COPIED, start=1)
    ]


def test_source_missing_is_unreadable(run: Run, tmp_path: Path) -> None:
    run.go(source=tmp_path / "nowhere" / "gratovo.db")
    assert error_code(run) == "source_unreadable"
    run.go(source=tmp_path)  # a folder
    assert error_code(run) == "source_unreadable"
    assert not run.data_dir.exists()


def test_not_sqlite(run: Run, tmp_path: Path) -> None:
    text = tmp_path / "notes.db"
    text.write_text("this is a list of AI keywords, not a database " * 5)
    run.go(source=text)
    assert error_code(run) == "not_sqlite"
    short = tmp_path / "short.db"
    short.write_bytes(b"SQLite")
    run.go(source=short)
    assert error_code(run) == "not_sqlite"
    corrupt = tmp_path / "corrupt.db"
    corrupt.write_bytes(import_legacy.SQLITE_HEADER + b"\xff" * 4096)
    run.go(source=corrupt)
    assert error_code(run) == "not_sqlite"


def test_no_channels_table(run: Run, tmp_path: Path) -> None:
    other = tmp_path / "other.db"
    conn = sqlite3.connect(other)
    conn.execute("CREATE TABLE brands (id TEXT PRIMARY KEY, name TEXT)")
    conn.commit()
    conn.close()
    run.go(source=other)
    assert error_code(run) == "no_channels_table"
    assert not (run.data_dir / "pipeline.db").exists() or not any(
        True for _ in run.dest().execute("SELECT 1 FROM channels")
    )


def test_source_inside_the_data_dir(run: Run) -> None:
    inside = build(run.data_dir / "database" / "gratovo.db")
    run.go(source=inside)
    assert error_code(run) == "source_in_data_dir"
    run.go(dry_run=True, source=inside)
    assert error_code(run) == "source_in_data_dir"


@pytest.mark.skipif(os.name != "nt", reason="case-insensitive paths are a Windows thing")
def test_source_in_data_dir_ignores_case_on_windows(run: Run) -> None:
    inside = build(run.data_dir / "database" / "gratovo.db")
    run.go(source=Path(str(inside).upper()))
    assert error_code(run) == "source_in_data_dir"


def test_source_in_the_app_data_folder_is_refused(run: Run) -> None:
    """The app's own gratovo.db sits in userData, beside the pipeline folder, not inside it."""
    beside = build(run.user_data / "gratovo.db")
    for dry_run in (True, False):
        run.go(dry_run=dry_run, source=beside)
        assert error_code(run) == "source_in_data_dir"
    assert not (run.data_dir / "pipeline.db").exists()


def link_or_skip(link: Path, target: Path) -> None:
    try:
        link.symlink_to(target, target_is_directory=True)
    except (OSError, NotImplementedError) as error:
        pytest.skip(f"this machine doesn't allow creating a symlink here ({type(error).__name__})")


def test_a_link_into_the_app_data_folder_is_refused(run: Run, tmp_path: Path) -> None:
    build(run.user_data / "gratovo.db")
    link = tmp_path / "looks elsewhere"
    link_or_skip(link, run.user_data)
    run.go(source=link / "gratovo.db")
    assert error_code(run) == "source_in_data_dir"


@pytest.mark.skipif(os.name != "nt", reason="\\\\?\\ paths are a Windows thing")
def test_an_extended_length_prefix_is_still_checked(run: Run) -> None:
    beside = build(run.user_data / "gratovo.db")
    run.go(source=Path("\\\\?\\" + str(beside.resolve())))
    assert error_code(run) == "source_in_data_dir"
    # And a good file behind the prefix still imports.
    run.go(dry_run=True, source=Path("\\\\?\\" + str(run.source.resolve())))
    assert run.end()["state"] == "done"


@pytest.mark.parametrize(
    "path",
    [
        "\\\\server\\share\\gratovo.db",
        "//server/share/gratovo.db",
        "\\\\?\\UNC\\server\\share\\gratovo.db",
        "\\\\.\\C:\\gratovo.db",
    ],
)
def test_a_network_or_device_path_is_unreadable(run: Run, path: str) -> None:
    run.go(dry_run=True, source=Path(path))
    assert error_code(run) == "source_unreadable"


def add_runs(path: Path, rows: list[tuple[int, str, str, int | None]]) -> None:
    conn = sqlite3.connect(path)
    conn.executemany(
        "INSERT INTO runs (run_id, started_at, status, pid, kind) VALUES (?, ?, ?, ?, 'search')",
        rows,
    )
    conn.commit()
    conn.close()


def test_old_runs_with_ids_already_taken_here_still_arrive(run: Run) -> None:
    # The old file's run 1 is in the fixture; add run 2, left saying running by a dead process.
    add_runs(run.source, [(2, "2026-09-02T10:00:00Z", "running", 4242)])
    run.data_dir.mkdir(parents=True)
    conn = run.dest()
    store.init_db(conn)
    conn.executemany(
        "INSERT INTO runs (run_id, started_at, status, kind) VALUES (?, ?, 'done', 'search')",
        [(1, "2026-10-20T08:00:00Z"), (2, "2026-10-21T08:00:00Z")],
    )
    conn.commit()
    conn.close()

    run.go(dry_run=True)
    assert run.counts()["runs"] == (2, 2, 0)
    run.go()
    assert run.counts()["runs"] == (2, 2, 0)
    conn = run.dest()
    rows = conn.execute(
        "SELECT run_id, started_at, status, pid FROM runs ORDER BY run_id"
    ).fetchall()
    conn.close()
    assert rows == [
        (1, "2026-10-20T08:00:00Z", "done", None),
        (2, "2026-10-21T08:00:00Z", "done", None),
        (3, "2026-09-01T10:00:00Z", "done", None),
        (4, "2026-09-02T10:00:00Z", "interrupted", None),
    ]

    run.go(dry_run=True)
    assert run.counts()["runs"] == (2, 0, 2)
    run.go()
    assert run.counts()["runs"] == (2, 0, 2)
    conn = run.dest()
    assert conn.execute("SELECT COUNT(*) FROM runs").fetchone()[0] == 4
    conn.close()


def test_an_old_running_run_arrives_ended_without_its_pid(run: Run) -> None:
    add_runs(run.source, [(2, "2026-09-02T10:00:00Z", "running", os.getpid())])
    run.go()
    conn = sqlite3.connect(run.data_dir / "pipeline.db")
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT status, pid FROM runs WHERE started_at = '2026-09-02T10:00:00Z'")
    assert tuple(row.fetchone()) == ("interrupted", None)
    assert store.reconcile_stale_runs(conn) == 0
    conn.close()


def test_a_newer_store_is_refused_and_left_alone(run: Run) -> None:
    run.data_dir.mkdir(parents=True)
    conn = run.dest()
    store.init_db(conn)
    conn.execute("INSERT INTO keywords (keyword, added_at) VALUES ('ai news', 'x')")
    conn.execute(f"PRAGMA user_version={store.SCHEMA_VERSION + 1}")
    conn.commit()
    conn.close()
    dest = run.data_dir / "pipeline.db"
    before = fingerprint(dest)
    run.go()
    assert error_code(run) == "store_too_new"
    assert not run.backups.exists()
    assert fingerprint(dest) == before
    run.go(dry_run=True)
    assert error_code(run) == "store_too_new"


def test_the_job_gets_no_extra_hosts() -> None:
    net.allow_job_hosts("import.legacy")
    try:
        for url in (
            "https://gmail.googleapis.com/gmail/v1/users/me/messages",
            "https://apigateway.eu-west-1.amazonaws.com/v2/apis",
            "https://example.com/",
        ):
            with pytest.raises(net.HostNotAllowedError):
                net.check_url(url)
    finally:
        net.allow_job_hosts("search")


def test_the_job_is_routed_here() -> None:
    start = start_with(
        source="live",
        job={
            "kind": "import.legacy",
            "source": "C:\\nowhere\\gratovo.db",
            "dryRun": True,
            "backupDir": None,
        },
    )
    out = io.StringIO()
    jobs.run(start, Emitter(out))
    assert '"source_unreadable"' in out.getvalue()
