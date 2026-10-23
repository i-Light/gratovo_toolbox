"""The example bank (plan §7b step 3): what the coaches told students to write instead, many times
over.

    python -m gratovo_pipeline.comms.example_bank build [--mined-dir DIR]
        # from the mined calls -> data/comms/playbook/example_bank.json
    python -m gratovo_pipeline.comms.example_bank show CASE_ID [--k 4]
        # what a scenario case would be shown

Each entry is one roast from a coaching call: the situation, the student's email (as read on the
call), the coach's verdict and points, the coach's rewrite, and one coach quote checked word for
word in the transcript. The emails and rewrites are reconstructions of what was on screen and said,
so they teach the move, never the wording: the engine shows a case the few entries closest to it,
and the copy and template checks stop a draft from reusing them. Left out: anything that breaks the
playbook's ethics (pressure, invented urgency or claims, pretending to be the brand), entries
without a usable quote, and the 33 roasts the skill already ships.

The mined calls (`verified.json`, `coach_calibration.json`) are made from the course and live with
it on the owner's PC (plan D8): `build` is given their folder (`--mined-dir`, or
`GRATOVO_MINED_DIR`). The bank it writes ships with the code, so reading it needs nothing from the
course."""

from __future__ import annotations

import argparse
import importlib
import io
import json
import math
import os
import re
import sys
from collections import Counter
from functools import lru_cache
from pathlib import Path
from typing import Any

from gratovo_pipeline import paths
from gratovo_pipeline.comms import course, playbook

MINED_DIR_ENV = "GRATOVO_MINED_DIR"
MINED_NAME = "verified.json"
CALIBRATION_NAME = "coach_calibration.json"
GRADBAR = paths.COMMS_TESTS_DIR / "gradbar.json"
BANK = playbook.DEFAULT_DIR / "example_bank.json"

# Tactics the playbook rules out (FND-ETH-01, INF-FU-11, FND-ETH-11 ...): an entry that teaches one
# is left out.
UNETHICAL = re.compile(
    r"reverse psych|pretend|act as if|as if you (are|were|have)|fake|bait|lie\b|lying|scarcity|"
    r"last (slot|spot)|"
    r"only (one|two|a few) (slot|spot)s?|(remaining|limited) (spot|slot)s?|finali[sz]e (our|the) "
    r"roster|"
    r"end of (this|the) week|by (friday|monday|tomorrow)|deadline|other offers (are )?coming|guilt|"
    r"fomo|urgency|"
    r"last round|final round|only (onboarding|taking|accepting) \d+|limited to \d+|only \d+ "
    r"(creators|influencers|spots|slots)|"
    r"spots? (are )?(filling|left)|before (it'?s|they'?re) gone|"
    r"don'?t (reveal|tell them|mention) (you'?re|that you|we'?re) an agency|speak as (if you are "
    r")?the brand|"
    r"botted|\bbots?\b|haram|music|dating|gambl|casino|alcohol|beer|wine|vape|crypto",
    re.I,
)
INVENTED = re.compile(
    r"\bwe('ve| have) worked with\b|\bour clients\b|\bcase stud(y|ies) (show|prove)|\btrack "
    r"record\b|"
    r"\bwe('ve| have) (helped|closed|secured)\b",
    re.I,
)
STOP = {
    "the",
    "a",
    "an",
    "and",
    "or",
    "to",
    "of",
    "in",
    "on",
    "for",
    "with",
    "is",
    "are",
    "be",
    "it",
    "that",
    "this",
    "you",
    "your",
    "they",
    "them",
    "their",
    "we",
    "our",
    "i",
    "he",
    "she",
    "his",
    "her",
    "as",
    "at",
    "by",
    "if",
    "so",
    "not",
    "do",
    "can",
    "will",
    "just",
    "like",
    "get",
    "but",
    "from",
    "what",
    "when",
    "then",
    "than",
    "have",
    "has",
    "was",
    "were",
    "about",
    "into",
    "out",
    "up",
    "more",
    "most",
    "very",
    "really",
    "also",
    "student",
    "students",
    "coach",
    "email",
    "emails",
}


def mined_dir() -> Path | None:
    """The mined calls' folder on this computer, from `GRATOVO_MINED_DIR`; None when not set."""
    value = os.environ.get(MINED_DIR_ENV)
    return Path(value) if value else None


def mined_file() -> Path | None:
    folder = mined_dir()
    return folder / MINED_NAME if folder is not None else None


def calibration_file() -> Path | None:
    """The coach's calibration roasts, held out of the bank (next to the mined calls)."""
    folder = mined_dir()
    return folder / CALIBRATION_NAME if folder is not None else None


def _ok(it: dict[str, Any]) -> bool:
    if it.get("kind") != "roast" or it.get("verdict") not in ("good", "mixed", "bad"):
        return False
    rewrite, email = (it.get("rewrite") or "").strip(), (it.get("student_email") or "").strip()
    if it["verdict"] != "good" and len(rewrite.split()) < 12:
        return False  # a roast with no rewrite teaches only what not to do
    if not (8 <= len(email.split()) <= 260):
        return False
    text = " ".join(str(it.get(k) or "") for k in ("situation", "advice", "rewrite"))
    if UNETHICAL.search(text) or INVENTED.search(rewrite):
        return False
    return not (it["verdict"] == "good" and (UNETHICAL.search(email) or INVENTED.search(email)))


def _quote(it: dict[str, Any], roster: dict[str, str]) -> dict[str, Any] | None:
    """The longest coach quote of the item that is word for word in the coach's own turn."""
    best: dict[str, Any] | None = None
    quotes: list[Any] = it.get("quotes") or []
    for q in quotes:
        text = (q.get("text") or "").strip()
        if not (8 <= len(text.split()) <= 85) or not course.contains(it["call"], text):
            continue
        seg = course.speaker_of(it["call"], text)
        if not seg or seg.speaker not in roster:
            continue
        if best is None or len(text) > len(best["quote"]):
            best = {
                "doc": it["call"],
                "quote": text,
                "coach": roster[seg.speaker],
                "at": q.get("at"),
            }
    return best


def _read(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def build(
    mined: Path | None = None,
    out: Path = BANK,
    calibration: Path | None = None,
    gradbar: Path = GRADBAR,
) -> dict[str, Any]:
    mined = mined or mined_file()
    if mined is None or not mined.exists():
        raise FileNotFoundError(
            f"the mined calls ({MINED_NAME}) are not on this computer: pass their folder with "
            "--mined-dir "
            f"or set {MINED_DIR_ENV}"
        )
    calibration = calibration or mined.parent / CALIBRATION_NAME
    items: list[dict[str, Any]] = _read(mined)["items"]
    roster = playbook.coaches()
    shown = {
        (e["call"], " ".join((e.get("student_email") or "").split()[:8]).lower())
        for e in playbook.examples()
    }
    # The coach's calibration roasts stay held out: a coach shown bank entries must never have seen
    # their verdicts (2026-10-16: 64 of the 120 were in the bank). So do the graduate bar's: the
    # engine is measured against those coach rewrites and must never be shown one (2026-10-17).
    held_out: set[int] = {it["idx"] for it in _read(calibration)} if calibration.exists() else set()
    bar: set[int] = {it["idx"] for it in _read(gradbar)["items"]} if gradbar.exists() else set()
    entries: list[dict[str, Any]] = []
    dropped: Counter[str] = Counter()
    for idx, it in enumerate(items):
        if it.get("kind") != "roast":
            continue
        if idx in held_out:
            dropped["held out for the coach's calibration"] += 1
            continue
        if idx in bar:
            dropped["held out for the graduate bar"] += 1
            continue
        email = (it.get("student_email") or "").strip()
        if (it["call"], " ".join(email.split()[:8]).lower()) in shown:
            dropped["in the skill's examples"] += 1
            continue
        if not _ok(it):
            dropped["no rewrite, length or ethics"] += 1
            continue
        q = _quote(it, roster)
        if not q:
            dropped["no checked coach quote"] += 1
            continue
        entries.append(
            {
                "id": f"EB-{idx}",
                "side": it.get("side"),
                "stage": it.get("stage"),
                "verdict": it["verdict"],
                "date": it.get("date"),
                "situation": it.get("situation"),
                "student_email": email,
                "points": it.get("advice"),
                "rewrite": (it.get("rewrite") or "").strip(),
                "quote": q,
                "read_aloud": it.get("email_read_aloud"),
            }
        )
    data = {
        "about": "Coach rewrites and verdicts from the coaching calls, for the engine to show a "
        "case the closest few. "
        "Student emails and rewrites are reconstructions of what was on screen and said: learn the "
        "move, never "
        "copy the words. Built by comms/example_bank.py; do not edit by hand.",
        "entries": entries,
    }
    Path(out).write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return {
        "entries": len(entries),
        "dropped": dict(dropped),
        "by_stage": Counter(f"{e['side']}/{e['stage']}" for e in entries).most_common(),
    }


@lru_cache(maxsize=1)
def entries(path: Path = BANK) -> tuple[dict[str, Any], ...]:
    if not Path(path).exists():
        return ()
    return tuple(_read(Path(path))["entries"])


def _toks(text: str) -> list[str]:
    return [w for w in re.findall(r"[a-z0-9']+", text.lower()) if w not in STOP and len(w) > 2]


type _Vector = dict[str, float]


@lru_cache(maxsize=1)
def _index() -> tuple[tuple[_Vector, ...], dict[str, float]]:
    docs = [_toks(f"{e['situation']} {e['student_email']}") for e in entries()]
    df = Counter(w for d in docs for w in set(d))
    n = max(len(docs), 1)
    idf = {w: math.log(n / (1 + c)) + 1 for w, c in df.items()}
    return tuple(_vec(d, idf) for d in docs), idf


def _vec(words: list[str], idf: dict[str, float]) -> _Vector:
    c = Counter(words)
    v = {w: (1 + math.log(k)) * idf.get(w, 1.0) for w, k in c.items()}
    norm = math.sqrt(sum(x * x for x in v.values())) or 1.0
    return {w: x / norm for w, x in v.items()}


# The case's stage and the side's reply types name the playbook stages whose roasts fit it.
CASE_STAGES = {
    "prospect": ("first_contact", "subject"),
    "contacted": ("replies", "follow_up", "qualify", "managers"),
    "interested": ("replies", "offer", "follow_up"),
    "negotiating": ("negotiation", "pricing", "objections"),
    "pitched": ("replies", "presenting", "objections", "follow_up", "offer"),
    "closing": ("closing", "contract"),
    "contract": ("contract", "closing"),
    "delivery": ("delivery", "onboarding"),
    "payment": ("payment",),
    "after": ("after",),
}


def for_case(case: dict[str, Any], k: int = 4) -> list[dict[str, Any]]:
    """The `k` entries closest to the case: same side, a fitting stage, most similar situation; one
    per call."""
    bank = entries()
    if not bank:
        return []
    vecs, idf = _index()
    thread: list[Any] = case.get("thread") or []
    last = next((m.get("body") for m in reversed(thread) if m.get("from") == "them"), "") or ""
    query = _vec(_toks(f"{case.get('goal') or ''} {last} {last}"), idf)
    stages = set(CASE_STAGES.get(case.get("stage") or "", ())) or None
    side = case.get("side")
    scored: list[tuple[float, dict[str, Any]]] = []
    for e, v in zip(bank, vecs, strict=True):
        if e["side"] not in (side, "both") or (stages and e["stage"] not in stages):
            continue
        s = sum(x * v.get(w, 0.0) for w, x in query.items())
        s += 0.05 if e["verdict"] == "good" else 0.0
        scored.append((s, e))
    scored.sort(key=lambda p: -p[0])
    out: list[dict[str, Any]] = []
    calls: set[str] = set()
    for _s, e in scored:
        if e["quote"]["doc"] in calls:
            continue
        calls.add(e["quote"]["doc"])
        out.append(e)
        if len(out) == k:
            break
    return out


def for_review(side: str, stage: str, text: str, k: int = 4) -> list[dict[str, Any]]:
    """Coach verdicts to anchor a review: same side, the stage (a playbook stage, or a case stage
    via CASE_STAGES), closest to `text`; the best of each verdict first, then the closest others,
    one per call."""
    bank = entries()
    if not bank:
        return []
    vecs, idf = _index()
    query = _vec(_toks(text), idf)
    stages = set(CASE_STAGES.get(stage, ())) | {stage}
    scored = sorted(
        (
            (sum(x * v.get(w, 0.0) for w, x in query.items()), e)
            for e, v in zip(bank, vecs, strict=True)
            if e["side"] in (side, "both") and e["stage"] in stages
        ),
        key=lambda p: -p[0],
    )
    out: list[dict[str, Any]] = []
    calls: set[str] = set()
    for want in ("good", "mixed", "bad", None):
        for _, e in scored:
            if len(out) == k:
                return out
            if (want is None or e["verdict"] == want) and e["quote"]["doc"] not in calls:
                out.append(e)
                calls.add(e["quote"]["doc"])
                if want is not None:
                    break
    return out


def render(found: list[dict[str, Any]]) -> str:
    """The entries as the prompt shows them: the situation, what the student wrote, the coach's
    verdict and move."""
    blocks: list[str] = []
    for e in found:
        lines = [
            f"- Situation: {e['situation']}",
            f"  Student wrote: {e['student_email']}",
            f"  Coach's verdict: {e['verdict']}. {e['points']}",
        ]
        if e.get("rewrite"):
            lines.append(f"  Coach's version (reconstructed): {e['rewrite']}")
        blocks.append("\n".join(lines))
    return "\n".join(blocks)


def _utf8(stream: object) -> None:
    if isinstance(stream, io.TextIOWrapper):
        stream.reconfigure(encoding="utf-8", errors="replace")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m gratovo_pipeline.comms.example_bank")
    sub = parser.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build")
    b.add_argument(
        "--mined-dir",
        type=Path,
        default=None,
        help=f"the mined calls' folder (else {MINED_DIR_ENV})",
    )
    p = sub.add_parser("show")
    p.add_argument("case_id")
    p.add_argument("--k", type=int, default=4)
    args = parser.parse_args(argv)
    _utf8(sys.stdout)
    if args.cmd == "build":
        mined: Path | None = args.mined_dir / MINED_NAME if args.mined_dir else None
        print(json.dumps(build(mined), ensure_ascii=False, indent=1))
    else:
        # Late, by name: scenarios is a hand-run tool (ported with task B3).
        scenarios = importlib.import_module("gratovo_pipeline.comms.scenarios")
        case = next(c["case"] for c in scenarios.cases() if c["id"] == args.case_id)
        print(render(for_case(case, args.k)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
