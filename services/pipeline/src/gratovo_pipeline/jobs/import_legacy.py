"""The `import.legacy` job: copies the old app's gratovo.db into this app's pipeline.db (plan D2
to D5, step 4).

The old file is opened read-only and immutable (`mode=ro&immutable=1`, so SQLite makes no
-shm/-wal beside it) and is never written. A non-empty `-wal` beside it is refused.
The tables both sides have are copied with `INSERT OR IGNORE`, only the columns both sides
have, one transaction and
one `progress` line per table. A row this app already holds wins. `runs` is the exception to
the key: its ids are AUTOINCREMENT on both sides, so the id is left out and a run counts as
here when one with the same `started_at` and `kind` is; an old `running` run arrives
`interrupted`, without its pid. The source must be a local file (not a network share or a
device path) outside the app's data folder (data_dir's parent). A real import first backs an
existing pipeline.db up into `backupDir`; a dry run writes nothing at all (it counts against an
in-memory copy of the new schema, plus the real pipeline.db attached read-only when there is one).

Its refusals end `failed` with `source_unreadable`, `not_sqlite`, `no_channels_table`,
`source_in_data_dir` or `store_too_new`. A good run answers with an `ImportReport` `result` and
ends `done`. The job needs no network.
"""

from __future__ import annotations

import os
import sqlite3
import sys
import traceback
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Final

from gratovo_pipeline import store
from gratovo_pipeline.protocol import (
    Emitter,
    EndErrorCode,
    ImportReport,
    ImportSettingsFile,
    ImportSkipped,
    ImportTable,
    SkipReason,
    Start,
)

DB_NAME: Final = "pipeline.db"
SQLITE_HEADER: Final = b"SQLite format 3\x00"

# In this order, so a parent row is in before the rows that name it.
COPIED: Final = (
    "keywords",
    "channels",
    "channel_keywords",
    "videos",
    "channel_archive",
    "runs",
    "video_transcripts",
)

# The app's own tables, mirrored from Supabase: the sync brings them back.
SYNCED: Final = frozenset(
    {
        "channel_state",
        "edit_conflicts",
        "brands",
        "deals",
        "outreach_threads",
        "outreach_messages",
        "email_templates",
        "writing_rules",
        "follow_up_reminders",
        "profiles",
        "scratchpads",
        "remote_search_requests",
        "campaigns",
        "campaign_shortlist",
        "deliverables",
        "channel_rate_history",
        "sequences",
        "sequence_steps",
        "agency_settings",
        "comms_proposals",
        "activity_log",
        "member_access",
    }
)
BOOKKEEPING: Final = frozenset(
    {
        "sync_state",
        "_applied_segments",
        "archive_keyword_pending",
        "_sync_meta",
        "_outbox",
        "_client_merge_status",
        "scheduled_jobs",
    }
)
# Looked for beside the database's parent folder; never opened. Secrets are never listed.
SETTINGS_NAMES: Final = ("run_config.json", "settings.json", "keywords.json", "all_keywords.txt")

_TOO_NEW: Final = "pipeline.db was written by a newer version of the app."


class _EndError(Exception):
    def __init__(self, code: EndErrorCode, message: str) -> None:
        super().__init__(message)
        self.code: EndErrorCode = code
        self.message = message


def _q(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _uri(path: Path, mode: str) -> str:
    """A SQLite URI for an absolute path (handles drive letters and spaces)."""
    return f"{path.as_uri()}?mode={mode}"


def _old_uri(path: Path) -> str:
    """The old file, read-only and immutable: SQLite then creates no -shm/-wal beside it."""
    return f"{path.as_uri()}?mode=ro&immutable=1"


def _inside(path: Path, folder: Path) -> bool:
    inner = Path(os.path.normcase(str(path)))
    outer = Path(os.path.normcase(str(folder)))
    return inner == outer or inner.is_relative_to(outer)


def _local(path: Path) -> Path | None:
    """The path with a `\\\\?\\C:\\` prefix dropped; None for a network share (`\\\\server\\share`,
    `\\\\?\\UNC\\...`) or a device path (`\\\\.\\...`), which SQLite can't open from a file URI."""
    raw = str(path)
    if raw.startswith(("\\\\?\\", "//?/")):
        rest = raw[4:]
        if len(rest) >= 3 and rest[0].isalpha() and rest[1] == ":" and rest[2] in "\\/":
            return Path(rest)
        return None
    if raw.startswith(("\\\\", "//")):
        return None
    return path


def _check_source(source: Path, data_dir: Path) -> Path:
    """The source, resolved, once it is known to be a readable local SQLite file outside the
    app's data folder (data_dir's parent, the app's userData, which holds data_dir)."""
    unreadable = _EndError("source_unreadable", "The old database can't be read.")
    local = _local(source)
    if local is None:
        raise unreadable
    try:
        resolved = _local(local.resolve(strict=True))
        if resolved is None:
            raise unreadable
        if not resolved.is_file():
            raise OSError("not a file")
        with resolved.open("rb") as handle:
            header = handle.read(len(SQLITE_HEADER))
    except OSError:
        raise unreadable from None
    app_data = _local(data_dir.resolve().parent)
    if app_data is None or _inside(resolved, app_data):
        raise _EndError(
            "source_in_data_dir",
            "The old database is inside this app's data folder. Pick the old app's file.",
        )
    if header != SQLITE_HEADER:
        raise _EndError("not_sqlite", "That file isn't a SQLite database.")
    wal = resolved.with_name(resolved.name + "-wal")
    try:
        unsent = wal.is_file() and wal.stat().st_size > 0
    except OSError:
        unsent = False
    if unsent:
        raise _EndError(
            "old_app_open",
            "The old app seems to be open, or it didn't close cleanly. "
            "Open it and close it once, then try again.",
        )
    return resolved


def _tables(conn: sqlite3.Connection, schema: str) -> set[str]:
    rows = conn.execute(
        f"SELECT name FROM {schema}.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
    ).fetchall()
    return {str(r[0]) for r in rows}


def _columns(conn: sqlite3.Connection, schema: str, table: str) -> list[tuple[str, int]]:
    """(name, primary-key position) of each column in order; empty when there is no such table."""
    rows = conn.execute(f"PRAGMA {schema}.table_info({_q(table)})").fetchall()
    return [(str(r[1]), int(r[5])) for r in rows]


def _old_rows(conn: sqlite3.Connection, table: str) -> list[dict[str, Any]]:
    """Every row of the old file's table, by column name; none when it has no such table."""
    names = [name for name, _ in _columns(conn, "old", table)]
    if not names:
        return []
    picked = ", ".join(_q(name) for name in names)
    rows = conn.execute(f"SELECT {picked} FROM old.{_q(table)}").fetchall()
    return [dict(zip(names, row, strict=True)) for row in rows]


def _count(conn: sqlite3.Connection, schema: str, table: str) -> int:
    try:
        return int(conn.execute(f"SELECT COUNT(*) FROM {schema}.{_q(table)}").fetchone()[0])
    except sqlite3.Error:
        return 0


def _guards(conn: sqlite3.Connection, table: str, cols: list[str], parents: list[str]) -> str:
    """` AND ...` keeping only rows whose parent exists in one of the `parents` schemas, from the
    new table's foreign keys. Without it a missing parent would abort the table."""
    clause = ""
    for fk in conn.execute(f"PRAGMA main.foreign_key_list({_q(table)})").fetchall():
        parent, child_col, parent_col = str(fk[2]), str(fk[3]), str(fk[4])
        if child_col not in cols:
            continue
        options = " OR ".join(
            f"o.{_q(child_col)} IN (SELECT {_q(parent_col)} FROM {schema}.{_q(parent)})"
            for schema in parents
        )
        clause += f" AND ({options})"
    return clause


def _run_value(column: str) -> str:
    """What an old `runs` column is copied as. A run the old app left saying `running` arrives
    `interrupted` (what `store.reconcile_stale_runs` makes of a run whose process is gone), and no
    pid comes along, so a reused pid can't make an old run look alive."""
    if column == "status":
        return "CASE WHEN o.status = 'running' THEN 'interrupted' ELSE o.status END"
    if column == "pid":
        return "NULL"
    return f"o.{_q(column)}"


def _copy_table(
    conn: sqlite3.Connection, table: str, *, dry_run: bool, have_dst: bool
) -> ImportTable:
    """Counts one table and, on a real run, copies it in one transaction."""
    old_cols = {name for name, _ in _columns(conn, "old", table)}
    if not old_cols:
        return {"name": table, "inOld": 0, "toAdd": 0, "already": 0}
    in_old = _count(conn, "old", table)
    new_cols = _columns(conn, "main", table)
    cols = [name for name, _ in new_cols if name in old_cols]
    keys = [name for name, pos in sorted(new_cols, key=lambda c: c[1]) if pos > 0]
    if not cols or not keys or not set(keys) <= set(cols):
        return {"name": table, "inOld": in_old, "toAdd": 0, "already": 0}

    target = "dst" if dry_run else "main"
    has_target = (have_dst if dry_run else True) and bool(_columns(conn, target, table))
    same = " AND ".join(f"d.{_q(k)} = o.{_q(k)}" for k in keys)
    picked = ", ".join(f"o.{_q(c)}" for c in cols)
    if table == "runs":
        # run_id is AUTOINCREMENT on both sides: old run 3 and this app's run 3 are different
        # runs. A run is the same run when it started at the same instant for the same kind.
        cols = [c for c in cols if c != "run_id"]
        same = " AND ".join(f"d.{_q(c)} IS o.{_q(c)}" for c in ("started_at", "kind") if c in cols)
        if not same:
            return {"name": table, "inOld": in_old, "toAdd": 0, "already": 0}
        picked = ", ".join(_run_value(c) for c in cols)
    present = f"EXISTS (SELECT 1 FROM {target}.{_q(table)} AS d WHERE {same})"
    already = 0
    if has_target:
        already = int(
            conn.execute(f"SELECT COUNT(*) FROM old.{_q(table)} AS o WHERE {present}").fetchone()[0]
        )
    if dry_run:
        guard = _guards(conn, table, cols, ["old", "dst"] if have_dst else ["old"])
        missing = f"NOT {present}" if has_target else "1"
        to_add = int(
            conn.execute(
                f"SELECT COUNT(*) FROM old.{_q(table)} AS o WHERE {missing}{guard}"
            ).fetchone()[0]
        )
        return {"name": table, "inOld": in_old, "toAdd": to_add, "already": already}

    guard = _guards(conn, table, cols, ["main"])
    names = ", ".join(_q(c) for c in cols)
    # A table without a separate identity (runs) needs the check in the query; for the others
    # the primary key and INSERT OR IGNORE do it.
    keep = f" AND NOT {present}" if table == "runs" else ""
    conn.execute("BEGIN")
    try:
        before = conn.total_changes
        conn.execute(
            f"INSERT OR IGNORE INTO main.{_q(table)} ({names}) "
            f"SELECT {picked} FROM old.{_q(table)} AS o WHERE 1{guard}{keep}"
        )
        added = conn.total_changes - before
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    return {"name": table, "inOld": in_old, "toAdd": added, "already": already}


def _skipped(conn: sqlite3.Connection) -> list[ImportSkipped]:
    found: list[ImportSkipped] = []
    for name in sorted(_tables(conn, "old") - set(COPIED)):
        why: SkipReason = (
            "synced" if name in SYNCED else "bookkeeping" if name in BOOKKEEPING else "not-ported"
        )
        found.append({"name": name, "rows": _count(conn, "old", name), "why": why})
    return found


def _unsent(conn: sqlite3.Connection) -> tuple[int, int]:
    old = _tables(conn, "old")
    outbox = _count(conn, "old", "_outbox") if "_outbox" in old else 0
    activity = 0
    if "activity_log" in old and "synced" in {n for n, _ in _columns(conn, "old", "activity_log")}:
        try:
            activity = int(
                conn.execute("SELECT COUNT(*) FROM old.activity_log WHERE synced = 0").fetchone()[0]
            )
        except sqlite3.Error:
            activity = 0
    return outbox, activity


def _settings_files(source: Path) -> list[ImportSettingsFile]:
    folder = source.parent.parent
    return [{"name": name, "found": (folder / name).is_file()} for name in SETTINGS_NAMES]


def _has_rows(path: Path) -> bool:
    conn = sqlite3.connect(_uri(path, "ro"), uri=True)
    try:
        return any(_count(conn, "main", name) > 0 for name in _tables(conn, "main"))
    finally:
        conn.close()


def _backup(dest: Path, backup_dir: Path) -> Path:
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    target = backup_dir / f"pipeline-{stamp}.db"
    counter = 1
    while target.exists():
        counter += 1
        target = backup_dir / f"pipeline-{stamp}-{counter}.db"
    conn = sqlite3.connect(_uri(dest, "ro"), uri=True)
    try:
        conn.execute("VACUUM INTO ?", (str(target),))
    finally:
        conn.close()
    return target


def _dest_version(path: Path) -> int:
    conn = sqlite3.connect(_uri(path, "ro"), uri=True)
    try:
        return int(conn.execute("PRAGMA user_version").fetchone()[0])
    finally:
        conn.close()


def _open_destination(dest: Path, dry_run: bool) -> sqlite3.Connection:
    """The connection the copy runs on: pipeline.db itself on a real run (made or migrated), an
    empty in-memory store of the current version on a dry run."""
    if dry_run:
        conn = sqlite3.connect(":memory:", uri=True, isolation_level=None)
        store.init_db(conn)
        return conn
    dest.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(_uri(dest, "rwc"), uri=True, isolation_level=None)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute(f"PRAGMA busy_timeout={store.BUSY_TIMEOUT_MS}")
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        store.init_db(conn)
    except store.SchemaTooNewError:
        conn.close()
        raise _EndError("store_too_new", _TOO_NEW) from None
    return conn


def _import(
    source_path: Path, data_dir: Path, dry_run: bool, backup_dir: Path | None, emitter: Emitter
) -> ImportReport:
    source = _check_source(source_path, data_dir)
    dest = data_dir / DB_NAME
    have_dst = dest.is_file()
    backup: Path | None = None
    if have_dst:
        try:
            if _dest_version(dest) > store.SCHEMA_VERSION:
                raise _EndError("store_too_new", _TOO_NEW)
            if not dry_run and backup_dir is not None and _has_rows(dest):
                backup = _backup(dest, backup_dir)
        except sqlite3.Error:
            raise _EndError("crash", "pipeline.db can't be read.") from None

    conn = _open_destination(dest, dry_run)
    try:
        try:
            conn.execute("ATTACH DATABASE ? AS old", (_old_uri(source),))
            if dry_run and have_dst:
                conn.execute("ATTACH DATABASE ? AS dst", (_uri(dest, "ro"),))
            old_tables = _tables(conn, "old")
        except sqlite3.DatabaseError:
            raise _EndError("not_sqlite", "That file isn't a SQLite database.") from None
        if "channels" not in old_tables:
            raise _EndError("no_channels_table", "The old database has no channels table.")
        tables: list[ImportTable] = []
        for done, table in enumerate(COPIED, start=1):
            tables.append(_copy_table(conn, table, dry_run=dry_run, have_dst=have_dst))
            emitter.progress(table=table, done=done, total=len(COPIED))
        if not dry_run:
            # A tombstone already here was skipped by the copy: what the old file's copy knew
            # (other keywords, its numbers, facts blank here) is merged into it (plan D43).
            store.merge_archive_copies(conn, _old_rows(conn, "channel_archive"))
            # An old file can hold a channel and its own tombstone: the tombstone keeps the
            # channel's facts and keywords too (plan D42). Nothing is deleted or announced.
            store.fill_archive_from_channels(conn)
        outbox, activity = _unsent(conn)
        skipped = _skipped(conn)
    finally:
        conn.close()
    return {
        "source": str(source),
        "tables": tables,
        "skipped": skipped,
        "unsent": {"outbox": outbox, "activity": activity},
        "settingsFiles": _settings_files(source),
        "dryRun": dry_run,
        "backup": None if backup is None else str(backup),
    }


def run(start: Start, emitter: Emitter) -> None:
    """Runs the job and always ends with an `end` line."""
    job = start["job"]
    if job["kind"] != "import.legacy":  # parse_start guarantees it
        emitter.end(state="failed", at=0, found=0, kept=0, error=("crash", "Not an import job."))
        return
    backup_dir = job["backupDir"]
    try:
        report = _import(
            Path(job["source"]),
            Path(start["dataDir"]),
            job["dryRun"],
            None if backup_dir is None else Path(backup_dir),
            emitter,
        )
    except _EndError as error:
        emitter.end(state="failed", at=0, found=0, kept=0, error=(error.code, error.message))
        return
    except (sqlite3.Error, OSError) as error:
        # Kind and frames only: a message can carry a path.
        frames = "".join(traceback.format_tb(error.__traceback__))
        print(
            f"import.legacy crashed: {type(error).__name__}\n{frames}", file=sys.stderr, flush=True
        )
        message = f"The import stopped on an unexpected error ({type(error).__name__})."
        emitter.end(state="failed", at=0, found=0, kept=0, error=("crash", message))
        return
    emitter.result("import.legacy", report)
    emitter.end(state="done", at=0, found=0, kept=0)
