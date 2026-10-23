"""Leases on video quotes, so a person (comms/quote_review.py) and Whisper (comms/video_check.py watch) never work
on the same quote at the same time.

A claim is a row (quote key, owner, expiry) in the playbook folder's review_claims.sqlite3
(`paths.PLAYBOOK_DIR`; git-ignored); SQLite's own locking makes taking a claim safe between
processes. A claim held by someone else and not yet expired means "busy, pick another quote". Leases end
by themselves: a crashed Whisper run or a closed browser tab frees its quote within minutes, and the page
renews its lease only while the person is active. Claims never touch the rules or the results: the worst
a race can do is make two workers look at the same quote.

This module is also where the hand-run quote tools (verify, quote_review, video_check, skill_build) share
their course flags: `add_course_arguments` and `require_course` (plan D8).
"""

# ruff: noqa: E501 - prose docstrings and message strings keep the old code's wording and line breaks

from __future__ import annotations

import argparse
import sqlite3
import sys
import time
from pathlib import Path

from gratovo_pipeline.comms import course, playbook

PERSON_LEASE = 120.0  # seconds; the page renews it every 30 s while someone is working
WHISPER_LEASE = 900.0  # one Whisper check takes 1-5 minutes on a busy CPU


def db_path(directory: Path | None = None) -> Path:
    return Path(directory or playbook.playbook_dir()) / "review_claims.sqlite3"


def _connect(directory: Path | None = None) -> sqlite3.Connection:
    con = sqlite3.connect(db_path(directory), timeout=15, isolation_level=None)
    con.execute(
        "CREATE TABLE IF NOT EXISTS claims (key TEXT PRIMARY KEY, owner TEXT NOT NULL, expires REAL NOT NULL)"
    )
    return con


def claim(key: str, owner: str, seconds: float, directory: Path | None = None) -> bool:
    """Take or renew the lease on `key`; False when someone else holds it."""
    con = _connect(directory)
    try:
        con.execute("BEGIN IMMEDIATE")
        now = time.time()
        con.execute("DELETE FROM claims WHERE expires < ?", (now,))
        row = con.execute("SELECT owner FROM claims WHERE key = ?", (key,)).fetchone()
        if row and row[0] != owner:
            con.execute("COMMIT")
            return False
        con.execute(
            "INSERT OR REPLACE INTO claims (key, owner, expires) VALUES (?, ?, ?)",
            (key, owner, now + seconds),
        )
        con.execute("COMMIT")
        return True
    except Exception:
        con.execute("ROLLBACK")
        raise
    finally:
        con.close()


def release(key: str, owner: str, directory: Path | None = None) -> None:
    con = _connect(directory)
    try:
        con.execute("DELETE FROM claims WHERE key = ? AND owner = ?", (key, owner))
    finally:
        con.close()


def release_all(owner: str, directory: Path | None = None) -> None:
    con = _connect(directory)
    try:
        con.execute("DELETE FROM claims WHERE owner = ?", (owner,))
    finally:
        con.close()


def held(directory: Path | None = None) -> dict[str, str]:
    """Unexpired claims: quote key -> owner."""
    con = _connect(directory)
    try:
        return dict(
            con.execute(
                "SELECT key, owner FROM claims WHERE expires >= ?", (time.time(),)
            ).fetchall()
        )
    finally:
        con.close()


def add_course_arguments(parser: argparse.ArgumentParser) -> None:
    """The flags every hand-run tool that reads the course takes (they fall back to the environment)."""
    parser.add_argument(
        "--course-dir",
        type=Path,
        help=f"the course folder (lessons and calls); default: ${course.COURSE_DIR_ENV}",
    )
    parser.add_argument(
        "--video-dir",
        type=Path,
        help=f"the folder of the video transcripts; default: ${course.VIDEO_DIR_ENV}",
    )


def require_course(args: argparse.Namespace, *, videos: bool = True) -> int | None:
    """Point `course` at the flags (or the environment) and check the course is here.

    Returns None when it is, or 2 after writing one line to stderr: a missing course must never read
    as "every quote failed". `videos=False` for a tool that needs no video transcripts.
    """
    if args.course_dir is not None or args.video_dir is not None:
        course.configure(
            args.course_dir or course.course_dir(), args.video_dir or course.video_dir()
        )
    if not course.available():
        print(
            f"The course is not here: pass --course-dir or set {course.COURSE_DIR_ENV}.",
            file=sys.stderr,
        )
        return 2
    root = course.video_dir()
    if videos and (root is None or not root.is_dir()):
        print(
            f"The video transcripts are not here: pass --video-dir or set {course.VIDEO_DIR_ENV}.",
            file=sys.stderr,
        )
        return 2
    return None
