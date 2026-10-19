#!/usr/bin/env python3
"""
Reads the Email Critique Library corpus back out of `data/database/email_library.db`.

WHAT THIS IS FOR
----------------
The app's Email Critique Library page (lib/features/email_library/) collects emails
somebody wrote and what an expert said about each one. The corpus is not the
deliverable — it is the evidence. This tool turns it into the two things that
actually improve the drafting skills in `data/gemini skills/`:

  * `--digest`  a readable brief of what the critiques keep saying, grouped by
                stage and niche, for the human deciding what a skill should say
  * `--corpus`  the raw examples as markdown or JSON, to paste into a model
                alongside the skill being revised

The old critique loop's notes (`CRITIQUE_LOOP.md`) went with the old drafting skills (decision
old-files, 2026-10-18); drafting now runs on the course-built `gratovo-comms` skill.

READ-ONLY, ALWAYS
-----------------
This never writes to `email_library.db`. The app owns that file, may have it
open, and the corpus is the only copy of hours of study. Every connection here
is opened in SQLite's read-only mode, so a bug in this file cannot cost a
single record.

USAGE
-----
    python tools/email_library.py                          # what is in there
    python tools/email_library.py --digest                 # the brief
    python tools/email_library.py --digest --audience brand
    python tools/email_library.py --corpus                 # markdown examples
    python tools/email_library.py --corpus --json          # same, as JSON
    python tools/email_library.py --corpus --stage "Follow-up" --niche Fitness
    python tools/email_library.py --corpus --min-critique 40 -o corpus.md
    python tools/email_library.py --verdicts               # goldens + regression cases (JSON)

Filters combine with AND. `--stage` and `--niche` match a tag label
case-insensitively, and may be repeated.

Requires only the Python standard library.
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from collections import Counter, defaultdict
from pathlib import Path

# tools/ sits beside gratovo/, so the package is one level up.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gratovo import config  # noqa: E402

# Windows consoles still default to a legacy code page, and every heading this
# tool prints contains an em dash. Without this, piping the digest to a plain
# terminal raises UnicodeEncodeError — the same cp1252 problem the Flutter side
# works around with PYTHONUTF8 (see core/native/scraper_process_io.dart).
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):  # already wrapped, or not a TextIO
        pass

DB_PATH = config.EMAIL_LIBRARY_DB_PATH

AUDIENCES = ("influencer", "brand")

# Words too common to be worth reporting as a theme. Deliberately short: the
# point of the theme counts is to surface the vocabulary the critiques actually
# use, and an aggressive stop list would hide exactly the domain words
# ("specific", "generic", "opener") that make the output useful.
STOPWORDS = {
    "a", "an", "and", "the", "is", "it", "its", "to", "of", "in", "on",
    "for", "with", "that", "this", "these", "those", "at", "as", "by", "from",
    "or", "but", "not", "no", "so", "if", "then", "than", "too", "very", "you",
    "your", "yours", "i", "we", "they", "he", "she", "them", "their", "there",
    "here", "be", "been", "being", "am", "are", "was", "were", "do", "does",
    "did", "doing", "have", "has", "had", "will", "would", "can", "could",
    "should", "may", "might", "must", "one", "two", "also", "just", "only",
    "more", "most", "much", "many", "some", "any", "all", "each", "into",
    "about", "after", "before", "over", "under", "again", "up", "down", "out",
    "off", "email", "emails", "line", "lines", "read", "reads",
}


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------

def open_db(path: Path) -> sqlite3.Connection:
    """Opens the corpus read-only, or exits with a message a person can act on.

    `mode=ro` rather than a plain path: the app may have this file open, and an
    accidental write from a reporting script is not a failure mode worth
    leaving available.
    """
    if not path.exists():
        sys.exit(
            f"No email critique library at {path}\n"
            "Add records in the app first (Email critique library in the nav rail). "
            "The file is created on first open of that page."
        )
    connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    return connection


def load_records(connection, audience=None, stages=(), niches=(),
                 min_critique=0):
    """Every matching record, newest first, with its tag labels attached.

    Tags are matched by *label* rather than id, because the ids are per-machine
    UUIDs for everything except the three seeded stages — a command line that
    named ids would not survive being run on a colleague's copy.
    """
    where = ["1 = 1"]
    params = []
    if audience:
        where.append("audience = ?")
        params.append(audience)
    if min_critique:
        where.append("length(trim(critique)) >= ?")
        params.append(min_critique)

    rows = connection.execute(
        f"SELECT * FROM email_records WHERE {' AND '.join(where)} "
        "ORDER BY video_date DESC, updated_at DESC",
        params,
    ).fetchall()

    tags_by_record = defaultdict(list)
    for row in connection.execute(
        "SELECT rt.record_id, t.kind, t.label "
        "FROM email_record_tags rt JOIN email_tags t ON t.id = rt.tag_id "
        "ORDER BY t.sort_order, t.label"
    ):
        tags_by_record[row["record_id"]].append((row["kind"], row["label"]))

    wanted_stages = {s.strip().lower() for s in stages if s.strip()}
    wanted_niches = {n.strip().lower() for n in niches if n.strip()}

    records = []
    for row in rows:
        tags = tags_by_record.get(row["id"], [])
        record = dict(row)
        record["stages"] = [label for kind, label in tags if kind == "stage"]
        record["niches"] = [label for kind, label in tags if kind == "niche"]

        have_stages = {s.lower() for s in record["stages"]}
        have_niches = {n.lower() for n in record["niches"]}
        # AND across the filters, matching the app's own list semantics.
        if wanted_stages and not wanted_stages <= have_stages:
            continue
        if wanted_niches and not wanted_niches <= have_niches:
            continue
        records.append(record)
    return records


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------

def summary(connection) -> str:
    """What is in the library, in the handful of numbers worth knowing."""
    lines = ["EMAIL CRITIQUE LIBRARY", f"  {DB_PATH}", ""]

    counts = {row["audience"]: row["n"] for row in connection.execute(
        "SELECT audience, count(*) AS n FROM email_records GROUP BY audience"
    )}
    total = sum(counts.values())
    lines.append(f"  {total} records")
    for audience in AUDIENCES:
        lines.append(f"    {audience:<12} {counts.get(audience, 0)}")

    critiqued = connection.execute(
        "SELECT count(*) AS n FROM email_records WHERE trim(critique) != ''"
    ).fetchone()["n"]
    # The number that actually matters. A record with no critique is an
    # example, not a lesson, and only the critiqued ones can teach a skill
    # anything.
    lines.append("")
    lines.append(f"  {critiqued} of {total} carry a critique")

    lines.append("")
    lines.append("  Stage tags")
    for row in connection.execute(
        "SELECT t.label, count(rt.record_id) AS n FROM email_tags t "
        "LEFT JOIN email_record_tags rt ON rt.tag_id = t.id "
        "WHERE t.kind = 'stage' GROUP BY t.id ORDER BY t.sort_order"
    ):
        lines.append(f"    {row['label']:<28} {row['n']}")

    niches = connection.execute(
        "SELECT t.label, count(rt.record_id) AS n FROM email_tags t "
        "LEFT JOIN email_record_tags rt ON rt.tag_id = t.id "
        "WHERE t.kind = 'niche' GROUP BY t.id ORDER BY n DESC, t.label"
    ).fetchall()
    lines.append("")
    lines.append(f"  Niche tags ({len(niches)})")
    for row in niches[:15]:
        lines.append(f"    {row['label']:<28} {row['n']}")
    if len(niches) > 15:
        lines.append(f"    ... and {len(niches) - 15} more")

    return "\n".join(lines)


def digest(records, audience_label: str) -> str:
    """A brief on what the critiques keep saying.

    Counts, not conclusions. This does not try to decide what a skill should
    say — it puts the recurring vocabulary and the per-stage split in front of
    whoever is deciding, with enough of the actual sentences to check that a
    frequent word means what it looks like it means.
    """
    critiques = [r for r in records if (r["critique"] or "").strip()]
    lines = [
        f"# Critique digest — {audience_label}",
        "",
        f"{len(critiques)} critiqued "
        f"{'record' if len(critiques) == 1 else 'records'} "
        f"out of {len(records)} matched.",
        "",
    ]
    if not critiques:
        lines.append("Nothing to summarise yet.")
        return "\n".join(lines)

    by_stage = defaultdict(list)
    for record in critiques:
        for stage in record["stages"] or ["(untagged)"]:
            by_stage[stage].append(record)

    lines.append("## By stage")
    lines.append("")
    for stage, group in sorted(by_stage.items(), key=lambda kv: -len(kv[1])):
        plural = "critique" if len(group) == 1 else "critiques"
        lines.append(f"- **{stage}** — {len(group)} {plural}")
    lines.append("")

    words = Counter()
    for record in critiques:
        for word in re.findall(r"[a-z']{3,}", record["critique"].lower()):
            if word not in STOPWORDS:
                words[word] += 1
    lines.append("## Recurring vocabulary")
    lines.append("")
    lines.append(
        "Word counts across every critique. A word near the top is a thing "
        "the expert keeps having to say, which is a candidate for a rule the "
        "skill should state outright."
    )
    lines.append("")
    for word, count in words.most_common(25):
        if count < 2:
            break
        lines.append(f"- {word} — {count}")
    lines.append("")

    lines.append("## The critiques, by stage")
    lines.append("")
    for stage, group in sorted(by_stage.items(), key=lambda kv: -len(kv[1])):
        lines.append(f"### {stage}")
        lines.append("")
        for record in group:
            subject = (record["subject"] or "").strip() or "(no subject)"
            niches = ", ".join(record["niches"]) or "—"
            lines.append(f"- **{subject}** _({niches})_")
            for line in record["critique"].strip().splitlines():
                if line.strip():
                    lines.append(f"  > {line.strip()}")
            lines.append("")
    return "\n".join(lines)


def corpus_markdown(records) -> str:
    """The examples themselves, in the shape a model reads best.

    One heading per record, the metadata as a short list, then the email and
    the critique as separate blocks. Bodies go in fenced blocks so an email
    containing markdown of its own cannot restructure the document around it.
    """
    noun = "record" if len(records) == 1 else "records"
    out = ["# Email corpus", "", f"{len(records)} {noun}.", ""]
    for index, record in enumerate(records, start=1):
        subject = (record["subject"] or "").strip() or "(no subject)"
        out.append(f"## {index}. {subject}")
        out.append("")
        out.append(f"- audience: {record['audience']}")
        if record["stages"]:
            out.append(f"- stage: {', '.join(record['stages'])}")
        if record["niches"]:
            out.append(f"- niche: {', '.join(record['niches'])}")
        if record["video_date"]:
            out.append(f"- video date: {record['video_date']}")
        if record["video_url"]:
            timecode = format_timecode(record["timecode_seconds"])
            at = f" @ {timecode}" if timecode else ""
            out.append(f"- source: {record['video_url']}{at}")
        if (record["context"] or "").strip():
            out.append(f"- context: {record['context'].strip()}")
        out.append("")
        out.append("**Email**")
        out.append("")
        out.append("```text")
        out.append((record["body"] or "").strip())
        out.append("```")
        out.append("")
        if (record["critique"] or "").strip():
            out.append("**Critique**")
            out.append("")
            out.append("```text")
            out.append(record["critique"].strip())
            out.append("```")
            out.append("")
    return "\n".join(out)


def corpus_json(records) -> str:
    return json.dumps(
        [
            {
                "audience": r["audience"],
                "stages": r["stages"],
                "niches": r["niches"],
                "video_date": r["video_date"],
                "video_url": r["video_url"],
                "timecode": format_timecode(r["timecode_seconds"]),
                "context": (r["context"] or "").strip(),
                "subject": (r["subject"] or "").strip(),
                "body": (r["body"] or "").strip(),
                "critique": (r["critique"] or "").strip(),
            }
            for r in records
        ],
        indent=2,
        ensure_ascii=False,
    )


def format_timecode(seconds):
    """Mirrors `lib/core/utils/timecode.dart` — h:mm:ss, hour dropped below one."""
    if seconds is None or seconds < 0:
        return None
    hours, rest = divmod(int(seconds), 3600)
    minutes, secs = divmod(rest, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes}:{secs:02d}"


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

VERDICT_COLUMNS = ("verdict", "verdict_note", "source", "knobs", "facts", "source_ref", "verdict_at")


def verdicts(connection) -> dict:
    """The owner's verdicts on drafts, for the skill factory's bench (decision D41).

    `goldens` are drafts rated good: later card versions must still pass them. `regressions` are drafts
    rated bad, with the owner's why: the bench drafts their situation again and checks the fault is gone.
    `examples` are the owner's own emails marked "my example" in the app (decision G3): ideas for the
    drafter next to the PDFs' good emails, never wording to copy (D16).
    A library from before the verdict columns (migration v6) has none, and says so instead of failing.
    """
    have = {row["name"] for row in connection.execute("PRAGMA table_info(email_records)")}
    if not set(VERDICT_COLUMNS) <= have:
        return {"goldens": [], "regressions": [], "examples": [],
                "note": "this library predates verdicts (schema v6)"}
    out: dict = {"goldens": [], "regressions": [], "examples": []}
    for row in connection.execute(
            "SELECT id, audience, subject, body, context FROM email_records WHERE source = 'mine' "
            "AND trim(body) != '' ORDER BY created_at, id"):
        out["examples"].append({"id": row["id"], "audience": row["audience"], "subject": row["subject"],
                                "body": row["body"], "context": row["context"]})
    for row in connection.execute(
            "SELECT id, audience, subject, body, critique, verdict, verdict_note, source, knobs, facts, "
            "source_ref, verdict_at FROM email_records WHERE verdict IN ('good', 'bad') "
            "ORDER BY verdict_at, id"):
        def obj(text):
            try:
                value = json.loads(text) if text else {}
            except ValueError:
                value = {}
            return value if isinstance(value, dict) else {}
        item = {"id": row["id"], "audience": row["audience"], "source": row["source"],
                "sourceRef": row["source_ref"], "knobs": obj(row["knobs"]), "facts": obj(row["facts"]),
                "subject": row["subject"], "body": row["body"], "note": row["verdict_note"],
                "critique": row["critique"], "at": row["verdict_at"]}
        out["goldens" if row["verdict"] == "good" else "regressions"].append(item)
    return out


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Read the Email Critique Library corpus (read-only).",
    )
    parser.add_argument("--digest", action="store_true",
                        help="summarise what the critiques keep saying")
    parser.add_argument("--corpus", action="store_true",
                        help="print the matching records as examples")
    parser.add_argument("--json", action="store_true",
                        help="with --corpus, emit JSON instead of markdown")
    parser.add_argument("--audience", choices=AUDIENCES,
                        help="limit to one tab")
    parser.add_argument("--stage", action="append", default=[],
                        help="require this stage tag (repeatable)")
    parser.add_argument("--niche", action="append", default=[],
                        help="require this niche tag (repeatable)")
    parser.add_argument("--min-critique", type=int, default=0, metavar="N",
                        help="skip records whose critique is shorter than N "
                             "characters")
    parser.add_argument("--verdicts", action="store_true",
                        help="the owner's good/bad verdicts on drafts, as JSON goldens "
                             "and regression cases (for the skill factory's bench)")
    parser.add_argument("-o", "--out", metavar="FILE",
                        help="write to a file instead of stdout")
    args = parser.parse_args()

    connection = open_db(DB_PATH)
    try:
        if args.verdicts:
            text = json.dumps(verdicts(connection), ensure_ascii=False, indent=1)
            if args.out:
                Path(args.out).write_text(text, encoding="utf-8")
                print(f"wrote {args.out}", file=sys.stderr)
            else:
                print(text)
            return 0
        if not args.digest and not args.corpus:
            print(summary(connection))
            return 0

        records = load_records(
            connection,
            audience=args.audience,
            stages=args.stage,
            niches=args.niche,
            min_critique=args.min_critique,
        )
        if not records:
            print("No records matched.", file=sys.stderr)
            return 1

        if args.digest:
            text = digest(records, args.audience or "all audiences")
        elif args.json:
            text = corpus_json(records)
        else:
            text = corpus_markdown(records)
    finally:
        connection.close()

    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
        print(f"wrote {args.out}", file=sys.stderr)
    else:
        print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
