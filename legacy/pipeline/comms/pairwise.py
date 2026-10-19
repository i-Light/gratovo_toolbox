"""Pairwise coach judgments (plan §7b): which of two drafts the course's coaches would rather see sent.

    python -m comms.pairwise calibrate OUT [--n 60] [--tabs 3] [--accounts 0]   # a student's email against the coach's rewrite
    python -m comms.pairwise accuracy OUT
    python -m comms.pairwise judge RUN_A RUN_B OUT [--tabs 3] [--accounts 0]    # the cases both runs answered with a message
    python -m comms.pairwise report OUT

Why (2026-10-16): one absolute verdict per draft agreed with the coaches only half the time (cal-01: exact 51%,
bad-or-not 62%; version 2 swung from too harsh to too lenient). Choosing between two drafts is the question a
variant comparison asks, and it has a calibration set that needs no grades: a student's email against the coach's
own rewrite of it, where the coach's version should win. The order of the two is fixed per item by a hash, so half
the time the better draft is A and half the time B.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import sys
import uuid
from pathlib import Path
from typing import Optional

from . import coach, engine, example_bank

CHOICES = ("A", "B", "same")

PAIR = """Use the gratovo-comms skill in COACH COMPARISON mode: below are two drafts, A and B, for the same situation. Decide which one the course's coaches would rather see sent, the way they judge students' emails on the coaching calls. Read the reference files for this side and stage first. Judge the move first (the right thing to say here, honest, easy to answer, likely to get the result), then the words. Either draft may have been written down from speech: ignore typos, punctuation, capitals, line breaks, filler words and placeholders like [Name]. Answer ONLY with this JSON in one code block:
{{"better": "A|B|same", "why": "one sentence a coach would say", "rules": ["RULE-ID"]}}

SIDE: {side}
STAGE: {stage}
SITUATION:
{situation}

DRAFT A:
```
{a}
```

DRAFT B:
```
{b}
```"""


def prompt(side: str, stage: str, situation: str, a: str, b: str) -> str:
    return PAIR.format(side=side, stage=stage, situation=situation.strip(), a=a.strip(), b=b.strip())


def parse(text: str) -> Optional[dict]:
    from gemini_bridge.actions import extract_json  # late: keeps this module importable without the bridge path
    data = extract_json(text or "", strict=False)
    if not isinstance(data, dict) or str(data.get("better")) not in CHOICES:
        return None
    return data


def choose(gemini, side: str, stage: str, situation: str, a: str, b: str, *, tab_id: Optional[int] = None,
           timeout_s: int = 600, thinking: str = "high") -> dict:
    """One comparison in a fresh chat, asked once more for the JSON when the answer has none."""
    ref = uuid.uuid4().hex[:10]
    r = engine._send(gemini, prompt(side, stage, situation, a, b), new_chat=True, skill=engine.SKILL, mode="chat",
                     tab_id=tab_id, timeout_s=timeout_s, thinking=thinking, ref=ref)
    raw = [str(r.get("textRaw") or r.get("text") or "")]
    data = parse(raw[0])
    if data is None:
        r = engine._send(gemini, 'Answer again with ONLY the JSON {"better": "A|B|same", "why": "...", "rules": [...]}, in one code block.',
                         new_chat=False, skill=None, mode="", tab_id=tab_id, timeout_s=timeout_s, thinking=thinking, ref=ref)
        raw.append(str(r.get("textRaw") or r.get("text") or ""))
        data = parse(raw[-1])
    return {"pair": data, "raw": raw, "model": r.get("model"), "thinking": r.get("thinking")}


def _a_first(key: str) -> bool:
    return hashlib.sha1(key.encode()).digest()[0] % 2 == 0


# --- calibration: the student's email against the coach's rewrite ----------------------------------------------

def calibration_pairs(n: int = 60, seed: int = 20261016) -> dict:
    """{key: item} for `n` roasts (bad or mixed) whose coach rewrite is a real email (25+ words, at least 60% of the
    student's length, different from it), half per side where possible, passing the example bank's ethics filter.
    Shorter rewrites are often a spoken line ("I'm here to bring you sponsors"), not an email to choose against."""
    items = json.loads(example_bank.MINED.read_text(encoding="utf-8"))["items"]
    pool = []
    for idx, it in enumerate(items):
        email, rw = (it.get("student_email") or "").strip(), (it.get("rewrite") or "").strip()
        if it.get("kind") != "roast" or it.get("verdict") not in ("bad", "mixed") or rw == email:
            continue
        if not (8 <= len(email.split()) <= 260) or len(rw.split()) < max(25, 0.6 * len(email.split())):
            continue
        if not example_bank._ok(it):
            continue
        pool.append((idx, it))
    rng = random.Random(seed)
    by_side = {s: [p for p in pool if p[1].get("side") == s] for s in ("influencer", "brand")}
    picked = []
    for side_pool in by_side.values():
        picked += rng.sample(side_pool, min(n // 2, len(side_pool)))
    rest = [p for p in pool if p not in picked]
    picked += rng.sample(rest, max(0, min(n - len(picked), len(rest))))
    return {f"pair-{idx}": it for idx, it in picked}


def _calibration_order(key: str, it: dict) -> tuple:
    """(a, b, expected): the coach's rewrite is A or B by the key's hash."""
    if _a_first(key):
        return it["rewrite"], it["student_email"], "A"
    return it["student_email"], it["rewrite"], "B"


def calibrate(out_dir: Path, n: int = 60, tabs: int = 3, gap_s: float = 60, timeout_s: int = 600,
              accounts: Optional[list] = None) -> dict:
    from . import pool   # late: imports the bridge
    items = calibration_pairs(n)

    def args(key):
        it = items[key]
        a, b, _ = _calibration_order(key, it)
        return it.get("side") or "", it.get("stage") or "", it.get("situation") or "", a, b

    prompts = {k: prompt(*args(k)) for k in items}

    def job(key: str, client) -> dict:
        res = choose(client, *args(key), timeout_s=timeout_s)
        return dict(res, expected=_calibration_order(key, items[key])[2])

    stats = pool.run(prompts, Path(out_dir), tabs=tabs, gap_s=gap_s, timeout_s=timeout_s, job=job,
                     title="Pairwise calibration", accounts=accounts)
    rep = accuracy(out_dir)
    pool.toast("Pairwise calibration", f"{rep.get('judged')} judged: coach's rewrite chosen {rep.get('right_pct')}%")
    return {"pool": stats, "accuracy": {k: v for k, v in rep.items() if k != "rows"}}


def accuracy(out_dir: Path) -> dict:
    """How often the coach's rewrite was chosen; 'same' and failed sends are reported apart."""
    rows = []
    for p in sorted((Path(out_dir) / "answers").glob("pair-*.json")):
        res = json.loads(p.read_text(encoding="utf-8")).get("result") or {}
        got = (res.get("pair") or {}).get("better")
        rows.append({"key": p.stem, "expected": res.get("expected"), "got": got})
    judged = [r for r in rows if r["got"] in ("A", "B")]
    right = sum(r["got"] == r["expected"] for r in judged)
    rep = {"answers": len(rows), "judged": len(judged), "right": right,
           "right_pct": round(100 * right / len(judged), 1) if judged else None,
           "same": sum(r["got"] == "same" for r in rows), "failed": sum(r["got"] is None for r in rows), "rows": rows}
    (Path(out_dir) / "accuracy.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1), encoding="utf-8")
    return rep


# --- judging two scenario runs head to head ---------------------------------------------------------------------

def judge(run_a: Path, run_b: Path, out_dir: Path, tabs: int = 3, gap_s: float = 60, timeout_s: int = 600,
          accounts: Optional[list] = None) -> dict:
    """Every case both runs answered with a message, judged twice, once in each order ("<case>" and "<case>~swap"):
    two decent drafts are a harder call than a student's email against the coach's rewrite, and a verdict that flips
    with the order is the judge not knowing (report counts it as a tie)."""
    from . import pool   # late: imports the bridge
    da, db = coach.drafts(run_a), coach.drafts(run_b)
    keys = sorted(set(da) & set(db))
    keys = keys + [f"{k}~swap" for k in keys]
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "runs.json").write_text(json.dumps({"A": str(run_a), "B": str(run_b)}), encoding="utf-8")

    def a_first(key):
        case = key.split("~")[0]
        return _a_first(case) != key.endswith("~swap")

    def args(key):
        entry, a = da[key.split("~")[0]]
        _, b = db[key.split("~")[0]]
        first, second = (a, b) if a_first(key) else (b, a)
        case = entry["case"]
        return case.get("side") or "", case.get("stage") or "", coach.situation_of(case), first, second

    prompts = {k: prompt(*args(k)) for k in keys}

    def job(key: str, client) -> dict:
        return dict(choose(client, *args(key), timeout_s=timeout_s), run_a_first=a_first(key))

    stats = pool.run(prompts, out_dir, tabs=tabs, gap_s=gap_s, timeout_s=timeout_s, job=job, title="Pairwise judge",
                     accounts=accounts)
    rep = report(out_dir)
    pool.toast("Pairwise judge", f"{Path(run_a).name} {rep['wins_a']} - {rep['wins_b']} {Path(run_b).name}")
    return {"pool": stats, "report": {k: v for k, v in rep.items() if k != "cases"}}


def report(out_dir: Path) -> dict:
    """Wins of run A and run B (as named in runs.json) per case: a case judged in both orders counts only when the two
    agree, otherwise it is 'split' (the judge cannot tell); ties, failed sends and each case's result."""
    out_dir = Path(out_dir)
    runs = json.loads((out_dir / "runs.json").read_text(encoding="utf-8"))
    votes: dict = {}
    for p in sorted((out_dir / "answers").glob("*.json")):
        res = json.loads(p.read_text(encoding="utf-8")).get("result") or {}
        got = (res.get("pair") or {}).get("better")
        if got in ("A", "B"):
            vote = "A" if (got == "A") == bool(res.get("run_a_first")) else "B"
        else:
            vote = "same" if got == "same" else None
        votes.setdefault(p.stem.split("~")[0], []).append(vote)
    cases = {}
    for case, vs in votes.items():
        known = [v for v in vs if v is not None]
        if not known:
            cases[case] = None
        elif len(set(known)) == 1:
            cases[case] = known[0]
        else:
            cases[case] = "split"
    count = lambda x: sum(v == x for v in cases.values())
    rep = {"A": runs["A"], "B": runs["B"], "wins_a": count("A"), "wins_b": count("B"), "same": count("same"),
           "split": count("split"), "failed": count(None), "cases": cases}
    (out_dir / "report.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1), encoding="utf-8")
    return rep


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="python -m comms.pairwise")
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("calibrate")
    p.add_argument("out", type=Path)
    p.add_argument("--n", type=int, default=60)
    p2 = sub.add_parser("judge")
    p2.add_argument("run_a", type=Path)
    p2.add_argument("run_b", type=Path)
    p2.add_argument("out", type=Path)
    for q in (p, p2):
        q.add_argument("--tabs", type=int, default=3)
        q.add_argument("--gap", type=float, default=60)
        q.add_argument("--accounts", default="")
    sub.add_parser("accuracy").add_argument("out", type=Path)
    sub.add_parser("report").add_argument("out", type=Path)
    args = parser.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass
    accounts = [int(x) for x in getattr(args, "accounts", "").split(",") if x.strip()] or None
    if args.cmd == "calibrate":
        out = calibrate(args.out, n=args.n, tabs=args.tabs, gap_s=args.gap, accounts=accounts)
    elif args.cmd == "judge":
        out = judge(args.run_a, args.run_b, args.out, tabs=args.tabs, gap_s=args.gap, accounts=accounts)
    elif args.cmd == "accuracy":
        out = {k: v for k, v in accuracy(args.out).items() if k != "rows"}
    else:
        out = report(args.out)
    print(json.dumps(out, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
