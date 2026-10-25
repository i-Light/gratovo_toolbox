"""The archive jobs (plan D37, D38): reject channels for good, or take a tombstone back.

Both are local: they only touch the open source's own `pipeline.db`, so they run on example data
too. How a run ends:
- every channel done: `result`, then `end` `done`;
- a stop between channels: `result` with what landed, then `end` `stopped`;
- anything else: `failed` with `crash` (the error's kind and frames, never its text).
"""

from __future__ import annotations

import re
import sqlite3
import sys
import traceback
from typing import Final

from gratovo_pipeline import run_control, store
from gratovo_pipeline.config import Config
from gratovo_pipeline.protocol import ArchiveChannel, Emitter, EndState, Start

DB_NAME: Final = "pipeline.db"
# The label a rejected channel's tombstone carries.
REJECTED: Final = "rejected"
# The protocol's handle pattern: a stored handle outside it is sent as null.
_HANDLE = re.compile(r"@[A-Za-z0-9._-]{1,100}")


def _open(cfg: Config) -> sqlite3.Connection:
    cfg.data_dir.mkdir(parents=True, exist_ok=True)
    conn = store.get_connection(cfg.data_dir / DB_NAME)
    try:
        store.init_db(conn)
    except store.SchemaTooNewError:
        conn.close()
        raise
    return conn


def _sendable_handle(stored: str | None) -> str | None:
    if not stored or not stored.strip():
        return None
    handle = stored.strip()
    if not handle.startswith("@"):
        handle = "@" + handle
    return handle if _HANDLE.fullmatch(handle) else None


def _sweep(conn: sqlite3.Connection, channels: list[ArchiveChannel]) -> tuple[int, bool]:
    """(tombstones newly written, whether a stop cut it short)."""
    archived = 0
    try:
        for channel in channels:
            run_control.check_stop()
            channel_id = channel["channelId"]
            row = store.get_channel_row(conn, channel_id)
            if row is None and store.is_archived(conn, channel_id):
                continue  # already archived and nothing new to keep: its date and facts stay
            handle = channel["handle"] or (row["handle"] if row else None)
            # A channel row beside its tombstone is merged in (D43): nothing is lost either way.
            if store.archive_channel_locally(conn, channel_id, handle or "", REJECTED):
                archived += 1
    except KeyboardInterrupt:  # RunAborted too: a stop
        return archived, True
    return archived, False


def _restore(conn: sqlite3.Connection, channel_ids: list[str]) -> tuple[list[ArchiveChannel], bool]:
    """(the channels brought back with their handles, whether a stop cut it short)."""
    restored: list[ArchiveChannel] = []
    try:
        for channel_id in channel_ids:
            run_control.check_stop()
            # The row and its keywords come back from the tombstone (D44); unknown ids are skipped.
            handle = store.restore_channel_locally(conn, channel_id)
            if handle is None:
                continue
            restored.append({"channelId": channel_id, "handle": _sendable_handle(handle)})
    except KeyboardInterrupt:
        return restored, True
    return restored, False


def run(start: Start, emitter: Emitter) -> None:
    """Runs the job and always ends with an `end` line."""
    job = start["job"]
    try:
        cfg = Config.from_start(start)
        conn = _open(cfg)
        try:
            state: EndState
            if job["kind"] == "archive.sweep":
                archived, cut = _sweep(conn, job["channels"])
                emitter.result("archive.sweep", {"archived": archived})
            elif job["kind"] == "archive.restore":
                restored, cut = _restore(conn, job["channelIds"])
                emitter.result("archive.restore", {"restored": restored})
            else:  # the dispatch guarantees the kind
                raise ValueError("not an archive job")
            state = "stopped" if cut else "done"
        finally:
            conn.close()
    except BaseException as error:  # every way out ends with `end`
        # Kind and frames only: the message itself could carry a path.
        frames = "".join(traceback.format_tb(error.__traceback__))
        print(f"archive crashed: {type(error).__name__}\n{frames}", file=sys.stderr, flush=True)
        emitter.end(
            state="failed",
            at=0,
            found=0,
            kept=0,
            error=(
                "crash",
                f"The archive stopped on an unexpected error ({type(error).__name__}).",
            ),
        )
        return
    emitter.end(state=state, at=0, found=0, kept=0)
