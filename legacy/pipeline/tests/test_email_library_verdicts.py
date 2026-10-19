"""`tools/email_library.py --verdicts`: the owner's draft verdicts, read back for the skill factory's bench.

Run with:  python -m pytest -q tests/test_email_library_verdicts.py    (from pipeline/)

The app writes verdicts into `email_library.db` (schema v6, lib/data/repositories/email_library/
email_library_schema.dart); the factory only ever reads them. A library from before v6 has no verdicts and
must say so rather than fail.
"""

from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

import email_library  # noqa: E402

V1 = """
CREATE TABLE email_records (
  id TEXT PRIMARY KEY, audience TEXT NOT NULL, video_date TEXT, video_url TEXT NOT NULL DEFAULT '',
  timecode_seconds INTEGER, context TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '', critique TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL);
"""
V6 = """
ALTER TABLE email_records ADD COLUMN verdict TEXT;
ALTER TABLE email_records ADD COLUMN verdict_note TEXT NOT NULL DEFAULT '';
ALTER TABLE email_records ADD COLUMN verdict_at TEXT;
ALTER TABLE email_records ADD COLUMN source TEXT NOT NULL DEFAULT 'video';
ALTER TABLE email_records ADD COLUMN source_ref TEXT;
ALTER TABLE email_records ADD COLUMN knobs TEXT NOT NULL DEFAULT '';
ALTER TABLE email_records ADD COLUMN facts TEXT NOT NULL DEFAULT '';
"""


def _db(tmp_path: Path, v6: bool) -> sqlite3.Connection:
    path = tmp_path / "email_library.db"
    with sqlite3.connect(path) as raw:
        raw.executescript(V1 + (V6 if v6 else ""))
        if v6:
            rows = [
                ("a", "influencer", "S1", "good body", "good", "sounds human", "2026-10-02T10:00:00Z", "test-draft",
                 "2026-10-01T19:57/c1-hiller-nothing-A", json.dumps({"reader": "creator", "stage": "first"}), ""),
                ("b", "brand", "", "bad body", "bad", "asks for a call", "2026-10-02T11:00:00Z", "app-draft", None,
                 json.dumps({"reader": "brand"}), json.dumps({"brand": "HomeRack"})),
                ("c", "influencer", "", "unrated", None, "", None, "test-draft", "x/y", "", ""),
                ("d", "influencer", "", "old video record", None, "", None, "video", None, "", ""),
                ("e", "brand", "Mine", "my own email", None, "", None, "mine", None, "", ""),
            ]
            raw.executemany(
                "INSERT INTO email_records (id, audience, subject, body, verdict, verdict_note, verdict_at, source, "
                "source_ref, knobs, facts, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,'t','t')", rows)
    return email_library.open_db(path)


def test_verdicts_split_goldens_and_regressions(tmp_path: Path):
    connection = _db(tmp_path, v6=True)
    try:
        out = email_library.verdicts(connection)
    finally:
        connection.close()
    assert [g["id"] for g in out["goldens"]] == ["a"]
    assert [r["id"] for r in out["regressions"]] == ["b"]
    assert out["goldens"][0]["knobs"] == {"reader": "creator", "stage": "first"}
    assert out["goldens"][0]["sourceRef"].endswith("c1-hiller-nothing-A")
    assert out["regressions"][0]["facts"] == {"brand": "HomeRack"}
    assert out["regressions"][0]["note"] == "asks for a call"
    assert "note" not in out or out.get("note") is None
    # The owner's own emails, marked "my example" in the app, are examples, not verdicts.
    assert [e["id"] for e in out["examples"]] == ["e"]
    assert out["examples"][0]["audience"] == "brand"


def test_a_library_before_v6_has_no_verdicts(tmp_path: Path):
    connection = _db(tmp_path, v6=False)
    try:
        out = email_library.verdicts(connection)
    finally:
        connection.close()
    assert out["goldens"] == [] and out["regressions"] == [] and out["examples"] == []
    assert "v6" in out["note"]
