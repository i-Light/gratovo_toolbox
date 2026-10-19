"""Leases on video quotes, so a person (comms/quote_review.py) and Whisper (comms/video_check.py watch) never work
on the same quote at the same time.

A claim is a row (quote key, owner, expiry) in data/comms/playbook/review_claims.sqlite3; SQLite's own locking
makes taking a claim safe between processes. A claim held by someone else and not yet expired means "busy, pick
another quote". Leases end by themselves: a crashed Whisper run or a closed browser tab frees its quote within
minutes, and the page renews its lease only while the person is active. Claims never touch the rules or the
results: the worst a race can do is make two workers look at the same quote.
"""

from __future__ import annotations

import sqlite3
import time
from pathlib import Path
from typing import Optional

from . import playbook

PERSON_LEASE = 120.0    # seconds; the page renews it every 30 s while someone is working
WHISPER_LEASE = 900.0   # one Whisper check takes 1-5 minutes on a busy CPU


def db_path(directory: Optional[Path] = None) -> Path:
    return Path(directory or playbook.playbook_dir()) / "review_claims.sqlite3"


def _connect(directory: Optional[Path] = None) -> sqlite3.Connection:
    con = sqlite3.connect(db_path(directory), timeout=15, isolation_level=None)
    con.execute("CREATE TABLE IF NOT EXISTS claims (key TEXT PRIMARY KEY, owner TEXT NOT NULL, expires REAL NOT NULL)")
    return con


def claim(key: str, owner: str, seconds: float, directory: Optional[Path] = None) -> bool:
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
        con.execute("INSERT OR REPLACE INTO claims (key, owner, expires) VALUES (?, ?, ?)", (key, owner, now + seconds))
        con.execute("COMMIT")
        return True
    except Exception:
        con.execute("ROLLBACK")
        raise
    finally:
        con.close()


def release(key: str, owner: str, directory: Optional[Path] = None) -> None:
    con = _connect(directory)
    try:
        con.execute("DELETE FROM claims WHERE key = ? AND owner = ?", (key, owner))
    finally:
        con.close()


def release_all(owner: str, directory: Optional[Path] = None) -> None:
    con = _connect(directory)
    try:
        con.execute("DELETE FROM claims WHERE owner = ?", (owner,))
    finally:
        con.close()


def held(directory: Optional[Path] = None) -> dict[str, str]:
    """Unexpired claims: quote key -> owner."""
    con = _connect(directory)
    try:
        return dict(con.execute("SELECT key, owner FROM claims WHERE expires >= ?", (time.time(),)).fetchall())
    finally:
        con.close()
