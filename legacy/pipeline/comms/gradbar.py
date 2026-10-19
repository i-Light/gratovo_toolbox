"""The graduate bar (plan §7b): the engine's draft against the coach's own rewrite, on situations from the calls.

    python -m comms.gradbar list                                       # the cases, offline
    python -m comms.gradbar run OUT [--variant base] [--bar rewrite|good] [--only gb-380,...] [--tabs 3] [--accounts 0,1]
    python -m comms.gradbar judge RUN OUT [--tabs 3] [--accounts 0,1]
    python -m comms.gradbar report OUT

Why (2026-10-17): the scenario suite ranks our variants against each other, and its gates check the machine tier;
neither says whether the writing is a graduate's. The calls do: a student reads an email, the coach rewrites it.
data/comms/tests/gradbar.json turns such roasts into engine cases holding only what the student knew, and the
pairwise judge (calibrated: it chose the coach's rewrite over the student's email in 56 of 60 pairs) compares
  - the engine's draft with the coach's rewrite, in both orders: a graduate ties or wins about half the time or more;
  - the engine's draft with the student's email, once: the engine should win nearly always.
A verdict that flips with the order is a split (the judge cannot tell). The items are held out of the example
bank (example_bank.build), so no variant is ever shown the rewrite it is judged against.

A subject line is shown only when the other draft has one: most rewrites were spoken without one, and an extra
line must not decide the comparison.

Two kinds of item (`bar`), since v1 (2026-10-18) showed the coach's rewrite is an unfair yardstick:
  - "rewrite" (v1): the coach's rewrite of a weak student email. The engine beat it 33 of 33, but in 57 of 66
    comparisons because the rewrite was incomplete (coaches mostly spoke only the part they would change) or used
    details the coach saw on screen that the case lacks. Kept as the floor: the engine against the student's email.
  - "good" (v2): a student email a coach called good, i.e. a competent graduate's whole email, with the case written
    from that email, so both drafts hold the same facts. The engine against it in both orders ("graduate").
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Optional

from . import coach, engine, example_bank, pairwise

ITEMS = example_bank.GRADBAR

AGENCY = {"name": "[Agency]", "sender": "[Your name]",
          "what_we_do": "A small influencer-marketing agency in the {niche} niche: we find brand sponsorships for YouTube "
                        "creators and match brands with creators whose audience fits. The brand pays us; we pay the creator.",
          "true_claims": ["We are a small influencer-marketing agency.",
                          "We connect brands with YouTube creators whose audience fits them.",
                          "The creator pays us nothing; our fee comes out of the brand's budget."],
          "past_campaigns": [], "website": None}

GOALS = {"first": {"influencer": "First email to this creator: open a conversation about paid brand deals.",
                   "brand": "First email to this brand: pitch our creator."},
         "reply": "Decide the next step after their latest message and draft our reply if one is needed.",
         "follow_up": "Write our follow-up."}
TYPES = {("first", "influencer"): "inf.first_contact", ("first", "brand"): "brd.first_contact"}


@lru_cache(maxsize=1)
def _mined() -> tuple:
    return tuple(json.loads(example_bank.MINED.read_text(encoding="utf-8"))["items"])


def _thread(item: dict) -> list:
    today = date.fromisoformat(item["today"])
    out, subject = [], None
    for m in item.get("thread") or []:
        subject = m.get("subject") or subject
        out.append({"from": m["from"], "at": (today - timedelta(days=m["days_ago"])).isoformat(),
                    "subject": m.get("subject") or ("Re: " + subject if subject else ""), "body": m["body"]})
    return out


def case_of(item: dict) -> dict:
    agency = dict(AGENCY, what_we_do=AGENCY["what_we_do"].format(niche=item["niche"]),
                  past_campaigns=item.get("past_campaigns") or [])
    item = dict(item, today=item.get("today") or _mined()[item["idx"]].get("date"))
    kind, side = item["kind"], item["side"]
    goal = item.get("goal") or (GOALS["first"][side] if kind == "first" else GOALS[kind])
    return {"side": side, "stage": item.get("stage", "prospect" if kind == "first" else "contacted"), "goal": goal,
            "channel": "email", "counterpart": item["counterpart"], "agency": agency,
            "facts": dict({"today": item["today"]}, **item["facts"]), "thread": _thread(item)}


def cases(path: Path = ITEMS) -> list[dict]:
    """Every item as a scenario-run entry ({id, kind, type, expect, case}) plus its set, call index and the call's
    stage (the judge reads that stage's references, as in its calibration)."""
    out = []
    for item in json.loads(Path(path).read_text(encoding="utf-8"))["items"]:
        out.append({"id": f"gb-{item['idx']}", "kind": item["kind"], "type": TYPES.get((item["kind"], item["side"]), ""),
                    "expect": {}, "set": item["set"], "bar": item.get("bar", "rewrite"), "idx": item["idx"],
                    "call_stage": _mined()[item["idx"]].get("stage"), "case": case_of(item)})
    return out


def run(out_dir: Path, only: Optional[set] = None, variant: str = "auto", tabs: int = 3, gap_s: float = 60,
        timeout_s: int = 900, accounts: Optional[list] = None, bar: Optional[str] = None) -> dict:
    from . import pool   # late: imports the bridge
    out_dir = Path(out_dir)
    (out_dir / "answers").mkdir(parents=True, exist_ok=True)
    picked = [c for c in cases() if (not only or c["id"] in only) and (not bar or c["bar"] == bar)]
    (out_dir / "cases.json").write_text(json.dumps(picked, ensure_ascii=False, indent=1), encoding="utf-8")
    by_id = {c["id"]: c for c in picked}
    prompts = {k: engine.case_prompt(c["case"]) for k, c in by_id.items()}

    def job(key: str, client) -> dict:
        return engine.propose(client, by_id[key]["case"], timeout_s=timeout_s, variant=variant)

    stats = pool.run(prompts, out_dir, tabs=tabs, gap_s=gap_s, timeout_s=timeout_s, job=job, title="Graduate bar drafts",
                     accounts=accounts)
    return {"pool": stats, "drafts": len(coach.drafts(out_dir)), "cases": len(picked)}


# --- judging -----------------------------------------------------------------------------------------------------

_SUBJECT = re.compile(r"^\s*subject\s*:", re.I | re.M)


def shown(draft: str, other: str) -> str:
    """The engine's draft as the judge sees it next to `other`: without its subject line when `other` has none."""
    if _SUBJECT.search(other):
        return draft
    return re.sub(r"^\s*Subject:[^\n]*\n+", "", draft, count=1, flags=re.I)


def _keys(case_id: str, bar: str = "rewrite") -> list[str]:
    if bar == "good":
        return [f"{case_id}~grad", f"{case_id}~grad~swap"]
    return [f"{case_id}~coach", f"{case_id}~coach~swap", f"{case_id}~student"]


def engine_first(key: str) -> bool:
    """Whether the engine's draft is A: by the case's hash, flipped for the swap; the student pair has its own hash."""
    case_id, rest = key.split("~", 1)
    if rest == "student":
        return pairwise._a_first(case_id + "~student")
    return pairwise._a_first(case_id) != rest.endswith("~swap")


def judge(run_dir: Path, out_dir: Path, tabs: int = 3, gap_s: float = 60, timeout_s: int = 600,
          accounts: Optional[list] = None) -> dict:
    from . import pool   # late: imports the bridge
    run_dir, out_dir = Path(run_dir), Path(out_dir)
    found = coach.drafts(run_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "run.json").write_text(json.dumps({"run": str(run_dir)}), encoding="utf-8")
    keys = [k for case_id in sorted(found) for k in _keys(case_id, found[case_id][0].get("bar", "rewrite"))]

    def args(key):
        case_id, rest = key.split("~", 1)
        entry, draft = found[case_id]
        it = _mined()[entry["idx"]]
        other = it["rewrite"] if rest.startswith("coach") else it["student_email"]   # "grad": the good email itself
        mine = shown(draft, other)
        a, b = (mine, other) if engine_first(key) else (other, mine)
        return entry["case"]["side"], entry.get("call_stage") or "", coach.situation_of(entry["case"]), a, b

    prompts = {k: pairwise.prompt(*args(k)) for k in keys}

    def job(key: str, client) -> dict:
        return dict(pairwise.choose(client, *args(key), timeout_s=timeout_s), engine_first=engine_first(key))

    stats = pool.run(prompts, out_dir, tabs=tabs, gap_s=gap_s, timeout_s=timeout_s, job=job, title="Graduate bar judge",
                     accounts=accounts)
    rep = report(out_dir)
    g = rep["all"]["graduate"] if rep["all"]["graduate"]["cases"] else rep["all"]["coach"]
    pool.toast("Graduate bar", f"engine {g['engine']}, other {g['other']}, same/split {g['same'] + g['split']}")
    return {"pool": stats, "report": {k: v for k, v in rep.items() if k != "cases"}}


def _vote(res: dict) -> Optional[str]:
    got = (res.get("pair") or {}).get("better")
    if got in ("A", "B"):
        return "engine" if (got == "A") == bool(res.get("engine_first")) else "other"
    return "same" if got == "same" else None


def _tally(rows: list) -> dict:
    count = lambda x: sum(r == x for r in rows)
    judged = [r for r in rows if r is not None]
    t = {"cases": len(rows), "engine": count("engine"), "other": count("other"), "same": count("same"),
         "split": count("split"), "failed": count(None)}
    # "other" is the coach's rewrite, the student's email or the good email. Graduate level: the engine's draft ties
    # or wins against the good email in about half the cases or more (a split is the judge unable to tell).
    t["tie_or_win_pct"] = round(100 * (t["engine"] + t["same"] + t["split"]) / len(judged), 1) if judged else None
    t["win_pct"] = round(100 * t["engine"] / len(judged), 1) if judged else None
    return t


def report(out_dir: Path) -> dict:
    """Per case: the verdict against the coach's rewrite (both orders must agree, else 'split') and against the
    student's email; totals for all cases and per set (ai, tech)."""
    out_dir = Path(out_dir)
    run_dir = Path(json.loads((out_dir / "run.json").read_text(encoding="utf-8"))["run"])
    entries = {e["id"]: e for e in json.loads((run_dir / "cases.json").read_text(encoding="utf-8"))}
    votes: dict = {}
    for p in sorted((out_dir / "answers").glob("gb-*.json")):
        case_id, rest = p.stem.split("~", 1)
        res = json.loads(p.read_text(encoding="utf-8")).get("result") or {}
        votes.setdefault(case_id, {}).setdefault(rest.split("~")[0], []).append(_vote(res))
    cases = {}
    for case_id, v in votes.items():
        row = {"set": entries.get(case_id, {}).get("set"), "bar": entries.get(case_id, {}).get("bar", "rewrite")}
        for kind, name in (("coach", "coach"), ("student", "student"), ("grad", "graduate")):
            if kind in v:
                known = [x for x in v[kind] if x is not None]
                row[name] = None if not known else known[0] if len(set(known)) == 1 else "split"
        cases[case_id] = row
    no_draft = sorted(set(entries) - set(coach.drafts(run_dir)))
    rep = {"run": str(run_dir), "no_draft": no_draft}
    for name in ("all", "ai", "tech"):
        rows = [c for c in cases.values() if name == "all" or c["set"] == name]
        rep[name] = {k: _tally([c[k] for c in rows if k in c]) for k in ("graduate", "coach", "student")}
    rep["cases"] = cases
    (out_dir / "report.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1), encoding="utf-8")
    return rep


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="python -m comms.gradbar")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    p = sub.add_parser("run")
    p.add_argument("out", type=Path)
    p.add_argument("--only", default="")
    p.add_argument("--variant", default="auto", choices=engine.VARIANTS)
    p.add_argument("--bar", default="", choices=("", "rewrite", "good"), help="only the items of this kind")
    p2 = sub.add_parser("judge")
    p2.add_argument("run", type=Path)
    p2.add_argument("out", type=Path)
    for q in (p, p2):
        q.add_argument("--tabs", type=int, default=3)
        q.add_argument("--gap", type=float, default=60)
        q.add_argument("--accounts", default="")
    sub.add_parser("report").add_argument("out", type=Path)
    args = parser.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass
    accounts = [int(x) for x in getattr(args, "accounts", "").split(",") if x.strip()] or None
    if args.cmd == "list":
        for c in cases():
            print(f"{c['id']:9} {c['bar']:7} {c['set']:4} {c['kind']:9} {c['case']['side']:10} {c['call_stage']}")
        return 0
    if args.cmd == "run":
        only = {x.strip() for x in args.only.split(",") if x.strip()} or None
        out = run(args.out, only=only, variant=args.variant, tabs=args.tabs, gap_s=args.gap, accounts=accounts,
                  bar=args.bar or None)
    elif args.cmd == "judge":
        out = judge(args.run, args.out, tabs=args.tabs, gap_s=args.gap, accounts=accounts)
    else:
        out = {k: v for k, v in report(args.out).items() if k != "cases"}
    print(json.dumps(out, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
