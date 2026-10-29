"""The example-history load (plan P8a, A6): fills an example data folder's pipeline.db with the
six-month history prototype mode shows (`packages/core/src/data/example-history.ts`).

Main writes the history's `pipeline` part as a JSON file in the data folder and starts this job
with the file's name. The job reads it, writes every table in ONE transaction (all or nothing),
and deletes the file. It is for example data only (the start line is refused for live data), and
it answers once with the counts it wrote.
"""

from __future__ import annotations

import json
import re
import sqlite3
import sys
import time
import traceback
from pathlib import Path
from typing import Any, Final, cast

from gratovo_pipeline import store
from gratovo_pipeline.config import Config
from gratovo_pipeline.protocol import Emitter, ExampleLoadData, Start

DB_NAME: Final = "pipeline.db"
_PLAIN_FILE = re.compile(r"(?!.*\.\.)[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}")
_NON_ALNUM = re.compile(r"[^a-z0-9]")

_CHANNEL_COLUMNS: Final = (
    "channel_id",
    "handle",
    "name",
    "country",
    "subscribers",
    "first_seen_at",
    "videos_fetched_at",
    "videos_last_30",
    "median_views_last_30",
    "latest_upload_at",
    "sponsored_ratio",
    "seen_brands",
    "found_emails",
    "found_email_sources",
    "read_failures",
    "unreadable_until",
    "median_known",
    "videos_last_30_known",
)
_KEYWORD_COLUMNS: Final = ("keyword", "status", "channels_found", "added_at", "completed_at")
_LINK_COLUMNS: Final = ("channel_id", "keyword", "discovered_at", "source")
_RUN_COLUMNS: Final = (
    "started_at",
    "finished_at",
    "status",
    "keywords_total",
    "keywords_done",
    "channels_upserted",
    "videos_upserted",
    "kind",
)
_PENDING_COLUMNS: Final = ("channel_id", "keyword", "handles_limit", "discovered_at")
_ARCHIVE_COLUMNS: Final = (
    "channel_id",
    "handle",
    "label",
    "archived_at",
    "subscribers",
    "found_at",
    "found_via",
    "source",
    "announced",
    "median_views_last_30",
    "median_basis",
    "videos_found_count",
    "name",
    "country",
    "videos_last_30",
    "latest_upload_at",
    "seen_brands",
    "found_emails",
    "found_email_sources",
)


def _insert(table: str, columns: tuple[str, ...]) -> str:
    marks = ", ".join("?" * len(columns))
    return f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({marks})"  # noqa: S608


def _rows(items: list[dict[str, Any]], columns: tuple[str, ...]) -> list[tuple[Any, ...]]:
    return [tuple(item[c] for c in columns) for item in items]


def _stamp(ms: int) -> str:
    """The store's timestamp text (`utc_now`): `YYYY-MM-DDTHH:MM:SSZ`."""
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ms // 1000))


def _handle(name: str) -> str:
    return "@" + (_NON_ALNUM.sub("", name.lower()) or "channel")


def _found_via(entries: list[tuple[str, int | None, str]]) -> str:
    """The `found_via` JSON the store writes: [{"keyword", "limit", "discovered_at"}, ...]."""
    return json.dumps(
        [{"keyword": k, "limit": limit, "discovered_at": at} for k, limit, at in entries]
    )


def expand_archive(archive: dict[str, Any], pending: list[dict[str, Any]]) -> list[tuple[Any, ...]]:
    """One `channel_archive` row (as `_ARCHIVE_COLUMNS`) per tuple."""
    labels = cast("list[str]", archive["labels"])
    keywords = cast("list[str]", archive["keywords"])
    names = cast("list[str]", archive["names"])
    pending_by_channel: dict[str, list[dict[str, Any]]] = {}
    for item in pending:
        pending_by_channel.setdefault(item["channel_id"], []).append(item)
    handles: list[str] = [_handle(n) for n in names]
    keyword_json = [json.dumps(k) for k in keywords]
    rows: list[tuple[Any, ...]] = []
    for t in cast("list[list[Any]]", archive["tuples"]):
        suffix: str = t[0]
        name_i: int = t[1]
        archived_ms: int = t[2]
        label_i: int = t[3]
        key_i: int = t[4]
        median, subs, country, videos30 = t[5], t[6], t[7], t[8]
        sponsored, has_email, found_ms = t[9], t[10], t[11]
        channel_id = "UC" + suffix
        found_at = _stamp(found_ms)
        extra = pending_by_channel.get(channel_id)
        if extra:
            entries: list[tuple[str, int | None, str]] = [(keywords[key_i], None, found_at)]
            seen: set[str] = {keywords[key_i]}
            for item in extra:
                if item["keyword"] not in seen:
                    seen.add(item["keyword"])
                    entries.append((item["keyword"], item["handles_limit"], item["discovered_at"]))
            via = _found_via(entries)
        else:  # the common case, written out by hand: 150,000 of them
            via = (
                f'[{{"keyword": {keyword_json[key_i]}, "limit": null, '
                f'"discovered_at": "{found_at}"}}]'
            )
        handle: str = handles[name_i]
        # "some" is a one-name list, "none" an empty list, unknown is NULL: how the readers
        # (find/catalog.ts sponsorsOf and emailsOf) tell the three apart.
        brands = None if sponsored is None else ('["sponsor"]' if sponsored else "[]")
        if has_email is None:
            emails = None
        else:
            emails = json.dumps([f"{handle[1:]}@example.com"]) if has_email else "[]"
        rows.append(
            (
                channel_id,
                handle,
                labels[label_i],
                _stamp(archived_ms),
                None if subs is None else str(subs),
                found_at,
                via,
                "local",
                1,  # announced: example data is never shared
                median,
                None if median is None else "window30",
                None,  # videos_found_count: "no machine could count them"
                names[name_i],
                country,
                videos30,
                None,
                brands,
                emails,
                None if has_email is None else "[]",
            )
        )
    return rows


def load(conn: sqlite3.Connection, history: dict[str, Any]) -> ExampleLoadData:
    """Writes the history in one transaction (BEGIN IMMEDIATE, as the store's `_atomic`)."""
    channels = cast("list[dict[str, Any]]", history["channels"])
    keywords = cast("list[dict[str, Any]]", history["keywords"])
    links = cast("list[dict[str, Any]]", history["links"])
    runs = cast("list[dict[str, Any]]", history["runs"])
    pending = cast("list[dict[str, Any]]", history["pending"])
    archive_rows = expand_archive(cast("dict[str, Any]", history["archive"]), pending)
    conn.execute("BEGIN IMMEDIATE")
    try:
        conn.executemany(_insert("channels", _CHANNEL_COLUMNS), _rows(channels, _CHANNEL_COLUMNS))
        conn.executemany(_insert("keywords", _KEYWORD_COLUMNS), _rows(keywords, _KEYWORD_COLUMNS))
        conn.executemany(_insert("channel_keywords", _LINK_COLUMNS), _rows(links, _LINK_COLUMNS))
        conn.executemany(_insert("runs", _RUN_COLUMNS), _rows(runs, _RUN_COLUMNS))
        conn.executemany(_insert("channel_archive", _ARCHIVE_COLUMNS), archive_rows)
        conn.executemany(
            _insert("archive_keyword_pending", _PENDING_COLUMNS), _rows(pending, _PENDING_COLUMNS)
        )
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    return {
        "channels": len(channels),
        "keywords": len(keywords),
        "links": len(links),
        "runs": len(runs),
        "archived": len(archive_rows),
        "pending": len(pending),
    }


def _read(path: Path) -> dict[str, Any]:
    value: object = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("the history file is not an object")
    return cast("dict[str, Any]", value)


def run_file(data_dir: Path, name: str) -> ExampleLoadData:
    """Loads `<data_dir>/<name>` into `<data_dir>/pipeline.db` and deletes the file."""
    if not _PLAIN_FILE.fullmatch(name):
        raise ValueError("the file must be a plain file name")
    path = data_dir / name
    try:
        history = _read(path)
        conn = store.get_connection(data_dir / DB_NAME)
        try:
            store.init_db(conn)
            return load(conn, history)
        finally:
            conn.close()
    finally:
        path.unlink(missing_ok=True)


def run(start: Start, emitter: Emitter) -> None:
    """Runs the job and always ends with an `end` line."""
    job = start["job"]
    try:
        if job["kind"] != "example.load":  # the dispatch guarantees the kind
            raise ValueError("not the example load")
        if start["source"] != "example":  # never fill a live pipeline.db with made-up channels
            raise ValueError("the example load is for example data only")
        cfg = Config.from_start(start)
        cfg.data_dir.mkdir(parents=True, exist_ok=True)
        counts = run_file(cfg.data_dir, job["file"])
        emitter.result("example.load", counts)
    except BaseException as error:  # every way out ends with `end`
        frames = "".join(traceback.format_tb(error.__traceback__))
        print(
            f"example load crashed: {type(error).__name__}\n{frames}", file=sys.stderr, flush=True
        )
        emitter.end(
            state="failed",
            at=0,
            found=0,
            kept=0,
            error=(
                "crash",
                f"The example load stopped on an unexpected error ({type(error).__name__}).",
            ),
        )
        return
    emitter.end(state="done", at=0, found=0, kept=0)
