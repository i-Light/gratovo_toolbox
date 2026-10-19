"""The scenario suite (plan step 5): the communication engine on every situation the workflow must handle.

    python -m comms.scenarios list                          # the cases, offline
    python -m comms.scenarios run OUT [--only id,id] [--tabs 3] [--gap 60] [--accounts 0,1] [--variant base|examples|write]
    python -m comms.scenarios grade OUT                     # score and reasons; writes OUT/grade.json

Cases: every incoming message of data/comms/tests/replies.json (written in the course's style, never mailbox
data) on top of data/comms/tests/scenarios.json (the agency works the AI niche: real AI channels from
data/database/gratovo.db, real brands seen sponsoring there, the thread so far, the deal facts), plus first
emails to real AI channels and brands. Each case runs in a fresh chat at thinking high through engine.propose
(pool.run's job hook: 3 tabs, 60 s between sends); bounce, unsubscribe and out-of-office take the engine's
quick path without Gemini. Nothing is ever sent to anyone: the suite only reads proposals.

A case passes when the proposal parsed and was not blocked by the checks after repair, names an expected
reply type and action, raises every expected gate (price, terms, claim, ethics), keeps a message exactly when
one is expected, and its message makes no claim the case does not support (no invented clients, results or
case studies, no brand the case does not name) and contains none of the case's forbidden phrases.
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
import zlib
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Optional

from . import checks, engine, playbook

REPO = Path(__file__).resolve().parents[2]
TESTS = REPO / "data" / "comms" / "tests"
DB = REPO / "data" / "database" / "gratovo.db"

# Claims a new agency with no past campaigns can never make (FND-ETH-01): a message containing one fails.
INVENTED = [r"\bwe('ve| have) worked with\b", r"\bour clients\b", r"\bcase stud(y|ies)\b", r"\btrack record\b",
            r"\bwe('ve| have) (helped|closed|secured|run|managed)\b", r"\bpast campaigns? (with|for)\b"]
NEGATED = re.compile(r"\b(no|not|never|don'?t|do not|haven'?t|have not|without|yet to|any)\b", re.I)
GERMAN = re.compile(r"\b(und|die|der|das|ich|wir|nicht|gerne|Marken|für|mit|dass|Grüße|Hallo)\b")


class _Keep(dict):
    def __missing__(self, key):   # an unknown {placeholder} stays as written
        return "{" + key + "}"


def _fill(text: str, values: dict) -> str:
    return str(text).format_map(_Keep(values))


def short(n) -> str:
    n = int(n or 0)
    if n >= 1_000_000:
        return f"{n / 1e6:.1f}".rstrip("0").rstrip(".") + "M"
    if n >= 1000:
        return f"{round(n / 1000)}k"
    return str(n)


@lru_cache(maxsize=1)
def _con() -> sqlite3.Connection:
    return sqlite3.connect(f"file:{DB.as_posix()}?mode=ro", uri=True, check_same_thread=False)


_URL = re.compile(r"https?://\S+|www\.\S+")
_NOT_PROSE = re.compile(r"^\W*(#|\d{1,2}:\d{2}|timestamps|chapters|links?\b|follow|subscribe|patreon|newsletter|my (gear|setup)|"
                        r"business (inquiries|email)|this video is supported)|subscribe|use code|% off|sign up|join (my|our)|"
                        r"\b(grab|download|get) (my|our|the|\w+'s) |\btry \w+(\.\w+)? for free|free credits|\bmy (latest|new) (project|course|book|app)|"
                        r"\b(my|our) (course|academy|community|discord|merch)\b|:\s*$", re.I)


def _about(description: str, limit: int = 420) -> str:
    """The prose of a video description, up to two paragraphs: no links, hashtags, chapters, emoji, plugs or labels."""
    keep: list[str] = []
    for raw in description.splitlines():
        line = re.sub(r"[^\w\s.,;:!?'\"()&%$/+-]", "", _URL.sub("", raw)).strip()
        if not line:
            continue
        if len(line.split()) < 5 or _NOT_PROSE.search(line) or raw.count("#") >= 2:
            if keep and len(keep) >= 2:
                break
            continue
        keep.append(line)
        if len(keep) >= 2 or sum(len(x) for x in keep) >= limit:
            break
    text = " ".join(keep)
    return text if len(text) <= limit else text[:limit].rsplit(" ", 1)[0] + "..."


_TOOL = re.compile(r"\b(?i:try|sponsored by|thanks to|grab|check out)\s+(?:out\s+)?([A-Z][\w.]*(?:\s[A-Z][\w.]*)?)(?:'s)?")


def _linked_tools(descriptions, limit: int = 10) -> list[str]:
    """Products the creator links or promotes in recent descriptions ('Try Neon for FREE: <link>', 'sponsored by X',
    "Grab HubSpot's free guide")."""
    found: list[str] = []
    for desc in descriptions:
        for line in (desc or "").splitlines():
            if not (_URL.search(line) or re.search(r"\bcode\b|sponsor|:\s*$", line, re.I)):
                continue
            for m in _TOOL.finditer(line):
                name = re.sub(r"(\s+(For|And|With|At|On|To|Free|FREE))+$", "", m.group(1)).strip(" .")
                name = re.sub(r"'s$", "", name)
                if name and name.lower() not in {n.lower() for n in found} and name.lower() not in ("free", "it", "the", "my", "our"):
                    found.append(name)
    return found[:limit]


@lru_cache(maxsize=None)
def channel(handle: str) -> dict:
    """A creator's facts as the workflow would hold them: the channels row and its five latest titles."""
    row = _con().execute("select channel_id, name, subscribers, median_views_last_30, videos_last_30, country, "
                         "sponsored_ratio, seen_brands from channels where handle = ?", (handle,)).fetchone()
    if row is None:
        raise KeyError(f"{handle} is not in {DB.name}")
    cid, name, subs, median, v30, country, ratio, seen = row
    videos = _con().execute("select title, description, view_count, published_at from videos where channel_id = ? "
                            "order by published_at desc limit 5", (cid,)).fetchall()
    titles = [t for t, _, _, _ in videos]
    sponsors = [b.split("\n")[0].strip() for b in json.loads(seen or "[]") if re.search(r"[a-z]", b)]
    facts = {"channel": (name or handle).strip(), "handle": handle, "platform": "YouTube", "subscribers": int(subs or 0),
             "median_views_last_30_days": int(median or 0), "videos_last_30_days": v30, "country": country,
             "recent_videos": titles}
    # What a graduate reads before writing (2026-10-16): the latest video's own description and views, and the tools
    # the creator already links or promotes (a brand they already work with is not one to pitch, INF-FIRST-04).
    if videos:
        title, desc, views, published = videos[0]
        latest = {"title": title, "published": (published or "")[:10], "views": int(views or 0)}
        about = _about(desc or "")
        if about:
            latest["about"] = about
        facts["latest_video"] = latest
    linked = _linked_tools(d for _, d, _, _ in videos)
    if linked:
        facts["tools_linked_in_recent_descriptions"] = linked
    if sponsors:
        facts["sponsors_seen"] = sponsors
    if ratio is not None:
        facts["share_of_recent_videos_sponsored"] = round(ratio, 2)
    return facts


def _day(today: str, days_ago: int) -> str:
    return (date.fromisoformat(today) - timedelta(days=days_ago)).isoformat()


def _values(data: dict, creator: str, brand: Optional[str] = None) -> dict:
    ch, meta = channel(creator), data["creators"][creator]
    names = meta["brands"]
    v = {"channel": ch["channel"], "creator": ch["channel"], "title": (ch["recent_videos"] or [""])[0],
         "niche": meta["niche"], "subs": short(ch["subscribers"]), "median": short(ch["median_views_last_30_days"]),
         "sender": data["agency"]["sender"], "a": names[0], "b": names[-1],
         "a_and_b": " and ".join(names[:2]), "a_or_b": " or ".join(names[:2])}
    if brand:
        b = data["brands"][brand]
        seen = channel(b["seen_on"])["channel"] if b.get("seen_on") else ""
        v.update(brand=brand, seen_on=seen, hi=b["contact"])
    else:
        v["hi"] = meta["contact"] or "there"
    return v


def _brand_facts(data: dict, brand: str) -> dict:
    b = data["brands"][brand]
    out = {"name": brand, "about": b["about"]}
    if b.get("seen_on"):
        out["seen_sponsoring"] = f"{channel(b['seen_on'])['channel']} ({b['seen_on']})"
    return out


def _thread(data: dict, cid: str, ctx: dict, values: dict, opener_kind: str, last: Optional[str]) -> list:
    today = data["today"]
    before = ctx.get("before") or []
    openers = data["openers"][opener_kind]
    opener = openers[zlib.crc32(cid.encode()) % len(openers)]
    start = ctx.get("opener_days_ago", max([m["days_ago"] for m in before], default=1) + 2)
    subject = _fill(opener["subject"], values)
    thread = [{"from": "us", "at": _day(today, start), "subject": subject, "body": _fill(opener["body"], values)}]
    for m in before:
        thread.append({"from": m["from"], "at": _day(today, m["days_ago"]), "subject": "Re: " + subject,
                       "body": _fill(m["body"], values)})
    if last is not None:
        thread.append({"from": "them", "at": today, "subject": "Re: " + subject, "body": last})
    return thread


def _creator_case(data: dict, cid: str, creator: str, ctx: dict, last: Optional[str]) -> dict:
    meta = data["creators"][creator]
    values = _values(data, creator)
    # The earlier emails name the brand of the deal first (2026-10-16: inf-script-1's thread was about GoDaddy while
    # the deal was Higgsfield's).
    deal_brand = ((ctx.get("facts") or {}).get("deal") or {}).get("brand")
    if deal_brand:
        names = [deal_brand] + [n for n in meta["brands"] if n != deal_brand]
        values.update(a=names[0], a_and_b=" and ".join(names[:2]), a_or_b=" or ".join(names[:2]))
    facts = {"today": data["today"], "creator": channel(creator),
             "brands_in_mind": [_brand_facts(data, b) for b in meta["brands"]]}
    if not any(k in (ctx.get("facts") or {}) for k in ("deal", "pitches", "contract")):
        facts["brand_status"] = "none of these brands has been pitched or has agreed yet"
    facts.update(ctx.get("facts") or {})
    first = last is None
    return {"side": "influencer", "stage": ctx.get("stage", "prospect" if first else "contacted"),
            "goal": "First email to this creator: open a conversation about paid brand deals." if first else
                    "Decide the next step after their latest message and draft our reply if one is needed.",
            "channel": "email",
            "counterpart": {"kind": "creator", "name": meta["contact"], "channel": values["channel"], "handle": creator},
            "agency": data["agency"], "facts": facts,
            "thread": [] if first else _thread(data, cid, ctx, values, "influencer", last)}


def _brand_case(data: dict, cid: str, brand: str, creator: str, ctx: dict, last: Optional[str]) -> dict:
    values = _values(data, creator, brand)
    pitched = dict(channel(creator), status=f"agreed that we pitch them to {brand}")
    facts = {"today": data["today"], "brand": _brand_facts(data, brand), "creator": pitched}
    facts.update(ctx.get("facts") or {})
    first = last is None
    return {"side": "brand", "stage": ctx.get("stage", "prospect" if first else "pitched"),
            "goal": f"First email to this brand: pitch {values['creator']}." if first else
                    "Decide the next step after their latest message and draft our reply if one is needed.",
            "channel": "email",
            "counterpart": {"kind": "brand", "company": brand, "name": data["brands"][brand]["contact"]},
            "agency": data["agency"], "facts": facts,
            "thread": [] if first else _thread(data, cid, ctx, values, "brand", last)}


def cases(tests: Path = TESTS) -> list[dict]:
    """Every case: {id, kind (reply|first), type, expect, case}."""
    data = json.loads((tests / "scenarios.json").read_text(encoding="utf-8"))
    replies = json.loads((tests / "replies.json").read_text(encoding="utf-8"))["replies"]
    out = []
    for r in replies:
        ctx = data["replies"].get(r["id"])
        if ctx is None:
            raise KeyError(f"scenarios.json has no context for {r['id']}")
        if "brand" in ctx:
            case = _brand_case(data, r["id"], ctx["brand"], ctx["creator"], ctx, r["text"])
        else:
            case = _creator_case(data, r["id"], ctx["creator"], ctx, r["text"])
        out.append({"id": r["id"], "kind": "reply", "type": r["type"], "expect": r["expect"], "case": case})
    first = data["first_contact"]
    for handle in first["influencer"]:
        cid = "inf-first-" + handle.strip("@").lower()
        out.append({"id": cid, "kind": "first", "type": "inf.first_contact",
                    "expect": {"action": ["send_message"], "no_gates": ["price", "terms", "claim"]},
                    "case": _creator_case(data, cid, handle, {}, None)})
    for brand, handle in first["brand"]:
        cid = "brd-first-" + re.sub(r"\W+", "", brand.lower())
        out.append({"id": cid, "kind": "first", "type": "brd.first_contact",
                    "expect": {"action": ["send_message"], "no_gates": ["price", "terms", "claim"]},
                    "case": _brand_case(data, cid, brand, handle, {}, None)})
    for e in first.get("ethics") or []:
        out.append({"id": e["id"], "kind": "first", "type": "brd.first_contact", "expect": e["expect"],
                    "case": _brand_case(data, e["id"], e["brand"], e["creator"], {}, None)})
    return out


def _named_brands(case: dict, every: list[str]) -> set:
    text = json.dumps(case, ensure_ascii=False).lower()
    return {b for b in every if b.lower() in text}


def grade_one(entry: dict, result: Optional[dict], every_brand: list[str]) -> dict:
    """Pass/fail of one case with the reasons; see the module doc for what passing means."""
    expect, case = entry["expect"], entry["case"]
    out = {"id": entry["id"], "kind": entry["kind"], "type": entry["type"], "pass": False, "reasons": []}
    if not result:
        out["reasons"].append("no answer")
        return out
    p = result.get("proposal") or {}
    obj = lambda x: x if isinstance(x, dict) else {}   # an answer in another shape grades as missing parts, not a crash
    msg = obj(p.get("message")) or None
    body = str((msg or {}).get("body") or "")
    subject = str((msg or {}).get("subject") or "")
    gates = {g.get("what") for g in result.get("gates") or [] if isinstance(g, dict)}
    decision = obj(p.get("decision"))
    reply_type = obj(p.get("situation")).get("reply_type")
    action = decision.get("action")
    out.update(status=result.get("status"), reply_type=reply_type, action=action, gates=sorted(g for g in gates if g),
               findings=[f"{f['severity']}:{f['code']}" for f in result.get("findings") or []],
               rounds=result.get("rounds"), subject=subject, body=body, words=len(body.split()),
               thinking=result.get("thinking"), why=decision.get("why"),
               rules=decision.get("rules"), needs_human=p.get("needs_human"))
    # Machine tier (plan §7b): the reply type's key rules are all in reach, so each one left out counts.
    keys = playbook.key_rules(reply_type) if isinstance(reply_type, str) else []
    cited = set(decision.get("rules") or []) if isinstance(decision.get("rules"), list) else set()
    out.update(key_rules=len(keys), key_rules_cited=sum(k in cited for k in keys),
               key_rules_missed=[k for k in keys if k not in cited])
    why = out["reasons"]
    if result.get("status") == "blocked":
        why.append("blocked: " + "; ".join(f"{f['code']} {f['detail']}" for f in checks.blocking(result.get("findings") or [])))
    if expect.get("reply_type") and reply_type not in expect["reply_type"]:
        why.append(f"reply type {reply_type!r}, expected one of {expect['reply_type']}")
    # An open house choice is the owner's to make: a proposal that stops to ask about HC-08 (female and couple
    # creators; the course's default is to avoid them, the owner has not picked) is right whatever the case expected
    # (2026-10-16, run-02 base: two first emails asked). Counted apart as deferred.
    deferred = any(isinstance(g, dict) and g.get("what") == "ethics" and re.search(r"HC-08|FND-ETH-07", str(g.get("detail")))
                   for g in result.get("gates") or [])
    out["deferred"] = "HC-08" if deferred else None
    if expect.get("action") and action not in expect["action"] and not (deferred and action in ("ask_user", "escalate")):
        why.append(f"action {action!r}, expected one of {expect['action']}")
    for g in expect.get("gates") or []:
        if g not in gates:
            why.append(f"gate '{g}' not raised")
    for g in expect.get("no_gates") or []:
        if g in gates and not (deferred and g == "ethics"):
            why.append(f"gate '{g}' raised where the message should need none")
    if expect.get("no_message") and msg:
        why.append("wrote a message where none should be sent")
    if expect.get("follow_up_min_days"):
        days = (p.get("follow_up") or {}).get("in_working_days")
        if not isinstance(days, (int, float)) or days < expect["follow_up_min_days"]:
            why.append(f"follows up in {days} working days, at least {expect['follow_up_min_days']} expected")
    if action == "send_message" and not body.strip():
        why.append("action send_message without a message")
    text = f"{subject}\n{body}"
    for rx in expect.get("must_not") or []:
        m = re.search(rx, text, re.I)
        if m:
            why.append(f"says '{m.group(0)}' (not allowed here)")
    for rx in INVENTED:
        # "we have no past clients or case studies" is the honest answer, not a claim (2026-10-16, brd-agency-1)
        for m in re.finditer(rx, text, re.I):
            if not NEGATED.search(re.split(r"[.!?\n]", text[:m.start()])[-1]):
                why.append(f"says '{m.group(0)}' (not allowed here)")
                break
    stray = {b for b in every_brand if re.search(r"\b" + re.escape(b) + r"\b", text, re.I)} - _named_brands(case, every_brand)
    if stray:
        why.append(f"names a brand the case does not: {sorted(stray)}")
    if expect.get("language") == "de" and body and len(GERMAN.findall(body)) < 3:
        why.append("not answered in German")
    out["pass"] = not why
    return out


def recheck(case: dict, result: dict) -> dict:
    """The result as today's checks see its final proposal: findings, gates and status again (no repair is replayed,
    and the template check has no recent messages to compare with). Lets a change to the checks be measured on a
    finished run without a Gemini send."""
    p = result.get("proposal")
    if not isinstance(p, dict) or result.get("thinking") == "n/a (quick path)" or engine.shape_problems(p):
        return result
    p = engine.reconnect(p, case)
    findings, gates = checks.check(case, p), checks.gates(case, p)
    status = ("blocked" if checks.blocking(findings) else "needs_human" if gates
              else "ready" if p.get("message") else "no_message")
    return dict(result, proposal=p, findings=findings, gates=gates, status=status)


def grade(out_dir: Path, tests: Path = TESTS, rechecked: bool = False) -> dict:
    out_dir = Path(out_dir)
    data = json.loads((tests / "scenarios.json").read_text(encoding="utf-8"))
    every_brand = list(data["brands"])
    run_cases = json.loads((out_dir / "cases.json").read_text(encoding="utf-8"))
    rows = []
    for entry in run_cases:
        path = out_dir / "answers" / f"{entry['id']}.json"
        result = json.loads(path.read_text(encoding="utf-8")).get("result") if path.exists() else None
        if rechecked and result:
            result = recheck(entry["case"], result)
        rows.append(grade_one(entry, result, every_brand))
    passed = sum(r["pass"] for r in rows)
    answered = [r for r in rows if "status" in r]
    summary = {"cases": len(rows), "answered": len(answered), "passed": passed,
               "score": round(100 * passed / len(rows), 1) if rows else 0.0,
               "gate_misses": sum(any(x.startswith("gate '") and "not raised" in x for x in r["reasons"]) for r in rows),
               "key_rules": f"{sum(r.get('key_rules_cited', 0) for r in rows)}/{sum(r.get('key_rules', 0) for r in rows)}",
               "blocked": sum(r.get("status") == "blocked" for r in rows),
               "by_kind": {k: f"{sum(r['pass'] for r in rows if r['kind'] == k)}/{sum(r['kind'] == k for r in rows)}"
                           for k in ("reply", "first")}}
    report = {"summary": summary, "cases": rows}
    name = "grade.rechecked.json" if rechecked else "grade.json"
    (out_dir / name).write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    return report


def recent_drafts(answers: Path, kind: str, exclude: str = "", n: Optional[int] = 4, side: Optional[str] = None) -> list[str]:
    """The bodies of the last `n` drafts in `answers` for cases of this kind (first emails or replies); all for None.
    With `side` (a case id prefix: inf, brd, any) only that side's: tics belong to a message type (2026-10-16: brand
    first emails' "should I send his details" was in 9 of 9 of them, under the bar in a pool of all 25 first emails)."""
    found = []
    for path in Path(answers).glob("*.json"):
        if path.stem == exclude or (path.stem.split("-")[1] == "first") != (kind == "first"):
            continue
        if side and path.stem.split("-")[0] != side:
            continue
        try:
            msg = ((json.loads(path.read_text(encoding="utf-8")).get("result") or {}).get("proposal") or {}).get("message")
        except (OSError, ValueError, AttributeError):
            continue
        if isinstance(msg, dict) and str(msg.get("body") or "").strip():
            found.append((path.stat().st_mtime, str(msg["body"])))
    return [body for _, body in sorted(found, reverse=True)[:n]]   # [:None] is all


def run(out_dir: Path, only: Optional[set] = None, tabs: int = 3, gap_s: float = 60, timeout_s: int = 900,
        accounts: Optional[list] = None, variant: str = "auto", coach_rounds: int = 0) -> dict:
    from . import pool   # late: imports the bridge
    out_dir = Path(out_dir)
    answers = out_dir / "answers"
    answers.mkdir(parents=True, exist_ok=True)
    picked = [c for c in cases() if not only or c["id"] in only]
    (out_dir / "cases.json").write_text(json.dumps(picked, ensure_ascii=False, indent=1), encoding="utf-8")
    live = {}
    for c in picked:
        quick = engine.quick_path(c["case"])
        if quick:   # no Gemini call: the engine's fixed answer
            (answers / f"{c['id']}.json").write_text(json.dumps({"key": c["id"], "text": "", "thinking": "n/a (quick path)",
                                                                 "result": quick}, ensure_ascii=False), encoding="utf-8")
        else:
            live[c["id"]] = c
    prompts = {k: engine.case_prompt(c["case"]) for k, c in live.items()}

    def job(key: str, client) -> dict:
        # Like the real outbox: the drafts this run already made for other people of the same kind are the agency's
        # recent messages, and a new one must not read like them (checks TEMPLATED, FND-WRITE-01).
        # and the wording the whole run keeps repeating may not come back (checks OVERUSED, FND-WRITE-03).
        base = live[key]["case"]
        history = recent_drafts(answers, live[key]["kind"], exclude=key, n=None, side=key.split("-")[0])
        case = dict(base, recent_messages=history[:4], overused_phrases=checks.overused_phrases(history, base))
        return engine.propose(client, case, timeout_s=timeout_s, variant=variant, coach_rounds=coach_rounds)

    stats = pool.run(prompts, out_dir, tabs=tabs, gap_s=gap_s, timeout_s=timeout_s, job=job, title="Scenario run",
                    accounts=accounts)
    report = grade(out_dir)
    s = report["summary"]
    pool.toast("Scenario run graded", f"{s['passed']}/{s['cases']} passed ({s['score']}%), {s['gate_misses']} gate misses")
    return {"pool": stats, "grade": s}


def _print_report(report: dict) -> None:
    s = report["summary"]
    print(f"{s['passed']}/{s['cases']} passed ({s['score']}%), answered {s['answered']}, blocked {s['blocked']}, "
          f"gate misses {s['gate_misses']}, key rules cited {s['key_rules']}, by kind {s['by_kind']}")
    for r in report["cases"]:
        if not r["pass"]:
            print(f"FAIL {r['id']} [{r.get('status')}, {r.get('reply_type')}, {r.get('action')}]: " + " | ".join(r["reasons"]))


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="python -m comms.scenarios")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    p = sub.add_parser("run")
    p.add_argument("out", type=Path)
    p.add_argument("--only", default="")
    p.add_argument("--tabs", type=int, default=3)
    p.add_argument("--gap", type=float, default=60)
    p.add_argument("--accounts", default="", help="Gemini account indexes, e.g. 0,1: --tabs tabs on each, one shared queue")
    p.add_argument("--variant", default="auto", choices=engine.VARIANTS, help="auto (default) | base | examples | write (plan 7b)")
    p.add_argument("--coach-rounds", type=int, default=0, help="coach reviews, each with one rewrite when not good (plan 7b step 4)")
    p = sub.add_parser("grade")
    p.add_argument("out", type=Path)
    p.add_argument("--recheck", action="store_true", help="grade the final drafts with today's checks (grade.rechecked.json)")
    args = parser.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass
    if args.cmd == "list":
        for c in cases():
            case = c["case"]
            who = case["counterpart"].get("company") or case["counterpart"].get("channel")
            print(f"{c['id']:<28} {c['kind']:<6} {case['side']:<10} {case['stage']:<12} {who}  "
                  f"{'quick' if engine.quick_path(case) else ''}")
        return 0
    if args.cmd == "run":
        only = {x.strip() for x in args.only.split(",") if x.strip()} or None
        accounts = [int(x) for x in args.accounts.split(",") if x.strip()] or None
        print(json.dumps(run(args.out, only=only, tabs=args.tabs, gap_s=args.gap, accounts=accounts, variant=args.variant,
                             coach_rounds=args.coach_rounds), indent=1))
        return 0
    _print_report(grade(args.out, rechecked=args.recheck))
    return 0


if __name__ == "__main__":
    sys.exit(main())
