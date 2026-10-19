"""Mine the coach-call transcripts for communication advice, with quotes that a script can check.

    python -m comms.mine_calls run [--tabs 10] [--limit N]   # Gemini, detached-friendly, resumable
    python -m comms.mine_calls verify                         # check every quote, write mined/verified.json
    python -m comms.mine_calls stats

One prompt per call: the transcript as Fathom wrote it (speaker labels and timestamps) and the list of
coaches. Gemini returns JSON items (advice, roasted emails, disagreements) with verbatim quotes; `verify`
keeps a quote only if it is in that transcript and was said by a coach (coaches.json). The result is raw
material for the playbook: rules are still written by hand from it, never copied wholesale.

Excluded: the productivity/mindset calls and the Fawaz Central performance sessions (not about
communication). Output: E:\\IMA work\\Learning\\mined calls\\ (outside the repo, like the course).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from . import course, playbook

OUT = Path(r"E:\IMA work\Learning\mined calls")
EXCLUDE = re.compile(r"productiv|mindset|momentum|sleep|motivation|fawaz", re.I)

STAGES = {
    "influencer": playbook.AREAS["influencer"],
    "brand": playbook.AREAS["brand"],
    "both": playbook.AREAS["foundations"],
}

PROMPT = """You are extracting a coaching knowledge base from ONE recorded coaching call of an influencer-marketing agency course. The agency connects brands with YouTube/Instagram/TikTok creators and earns the margin.

Coaches (only their words count as advice): {coaches}. Everyone else is a student; a student's claim is never advice, but a student's question or the email a student reads out gives the situation.

Extract every piece of guidance a coach gives about COMMUNICATING with creators or brands: first messages, emails and DMs, subject lines, follow-ups, replies to every kind of answer, objections, negotiation and pricing talk, managers/agencies, contracts, briefs, delivery, payment, reports, deliverability and sending, ethics. Also extract each email/DM a student reads or shows that a coach then critiques (a "roast"): the email as read, the coach's verdict and reasons, and the coach's improved version if he gives one.

Rules:
- Quotes must be copied EXACTLY from the transcript (same words, same order), 8-45 words each, from one speaker's turn. Never paraphrase inside "text". Give the timestamp shown before that turn and the speaker label exactly as written.
- `advice` is your short restatement; `situation` says who it is about and what happened (creator or brand, which stage, what they said or did).
- Skip small talk, logistics of the course, mindset/motivation talk, and anything not about communication.
- If coaches disagree with each other or contradict a common rule, add an item with kind "disagreement".
- If nothing relevant is in the call, return {{"items": []}}.

Return ONLY JSON in one code block, no prose:
{{"items": [{{"kind": "advice|roast|disagreement", "side": "influencer|brand|both", "stage": "<one stage word from the list>", "situation": "...", "advice": "...", "quotes": [{{"text": "...", "at": "mm:ss", "speaker": "..."}}], "student_email": "only for roasts: the email as read, else empty", "verdict": "only for roasts: good|bad|mixed", "rewrite": "only for roasts: the coach's improved version if spoken, else empty"}}]}}

Stage words: influencer: {inf}; brand: {brd}; both: {fnd}.

CALL: {title} ({date})

TRANSCRIPT:
{transcript}
"""


def fawaz_led(call) -> bool:
    """A Fawaz Central session (habits, sleep, productivity) titled only by its date, so EXCLUDE misses it:
    Fawaz is the main speaker. 10 of the first 12 empty answers were these (2026-10-15)."""
    chars: dict = {}
    for seg in call.segments:
        chars[seg.speaker] = chars.get(seg.speaker, 0) + len(seg.text)
    return bool(chars) and "fawaz" in max(chars, key=chars.get).lower()


def selected_calls() -> list:
    calls = [c for c in course.calls().values() if not EXCLUDE.search(c.title)]
    return sorted(calls, key=lambda c: (c.date, c.id))


def _skip_keys() -> set:
    """Calls the owner marked to skip in OUT/skip.json (Fawaz Central, productivity and mindset). Delete a key
    from that file to mine the call."""
    try:
        data = json.loads((OUT / "skip.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return set()
    return {row["key"] for row in data.get("calls", [])}


def prompt_for(call) -> str:
    roster = playbook.coaches()
    names = sorted(set(roster.values()))
    return PROMPT.format(coaches=", ".join(names), inf=", ".join(STAGES["influencer"]), brd=", ".join(STAGES["brand"]),
                         fnd=", ".join(STAGES["both"]), title=call.title, date=call.date, transcript=call.text)


def key_of(call) -> str:
    return call.id.replace("call:", "")


def cmd_run(args) -> int:
    from .pool import run
    skip = _skip_keys()
    calls = [c for c in selected_calls() if not fawaz_led(c) and key_of(c) not in skip]   # answers already made for them are kept
    if args.limit:
        calls = calls[: args.limit]
    prompts = {key_of(c): prompt_for(c) for c in calls}
    run(prompts, OUT, tabs=args.tabs, timeout_s=args.timeout, title="Call mining", model="Argon", thinking=args.thinking,
        gap_s=args.gap, accounts=[int(x) for x in args.accounts.split(",")] if args.accounts else None)
    return 0


def _extract_json(text: str):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from gemini_bridge.actions import extract_json
    return extract_json(text, strict=False)


def _repair(s: str) -> str:
    """Escape what breaks Gemini's JSON inside strings: a bare quote that does not end the string (one not
    followed by , : } ]) and raw line breaks."""
    out, in_str, esc = [], False, False
    for i, ch in enumerate(s):
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                nxt = s[i + 1:].lstrip()[:1]
                if nxt and nxt not in ",:}]":
                    out.append('\\"')
                    continue
                in_str = False
            elif ch == "\n":
                out.append("\\n")
                continue
        elif ch == '"':
            in_str = True
        out.append(ch)
    return "".join(out)


def _loads(s: str):
    for cand in (s, _repair(s)):
        try:
            return json.loads(cand)
        except ValueError:
            pass
    return None


def parse_answer(text: str):
    """The answer's {"items": [...]}, recovering broken JSON (2026-10-15: bare quotes inside a string, e.g.
    `"situation": "... ("Are you open to brand deals?") ..."`, and an answer that restarted its JSON halfway).
    Last resort: item by item. None when nothing can be read."""
    text = text or ""
    data = _extract_json(text)
    if isinstance(data, dict) and isinstance(data.get("items"), list):
        return data
    for start in reversed([m.start() for m in re.finditer(r'\{\s*"items"\s*:', text)]):
        chunk = text[start:]
        data = _loads(chunk[:chunk.rfind("}") + 1])
        if isinstance(data, dict) and isinstance(data.get("items"), list):
            return data
    items = []
    marks = [m.start() for m in re.finditer(r'\{\s*"kind"\s*:', text)]
    for i, start in enumerate(marks):
        piece = text[start:marks[i + 1] if i + 1 < len(marks) else len(text)]
        ends = [j for j, ch in enumerate(piece) if ch == "}"][::-1][:6]
        for end in ends:
            item = _loads(piece[:end + 1])
            if isinstance(item, dict) and item.get("kind"):
                items.append(item)
                break
    return {"items": items, "recovered": "item by item"} if items else None


def coach_part(call_id: str, quote: str, roster: dict):
    """(text, segment) of the longest run of whole sentences of `quote` (40+ chars) that lies inside one
    coach's turn, or None. Fathom's speaker turns change late or early, so a coach's sentence can sit at the
    end of a student's turn (2026-10-15: "The brand is asking for bank details..." under the student, the rest
    under Younes); only the part the transcript gives to the coach is kept."""
    sentences = [x.strip() for x in re.split(r"(?<=[.?!])\s+", quote or "") if x.strip()]
    best = None
    for i in range(len(sentences)):
        for j in range(len(sentences), i, -1):
            text = " ".join(sentences[i:j])
            if len(text) < 40 or (best and len(text) <= len(best[0])):
                continue
            if course.contains(call_id, text):
                seg = course.speaker_of(call_id, text)
                if seg is not None and seg.speaker in roster:
                    best = (text, seg)
                    break
    return best


def read_aloud(call_id: str, email: str) -> float:
    """Share of a student email's 6-word runs found in the transcript: roasted emails are usually shown on
    screen and only partly read, so Gemini rebuilds them; below ~0.6 treat the email as reconstructed."""
    words = re.findall(r"[a-z0-9']+", (email or "").lower())
    if len(words) < 6:
        return 0.0
    hay = course._normed(call_id)
    runs = [" ".join(words[i:i + 6]) for i in range(0, len(words) - 5, 3)]
    return round(sum(course.norm(r) in hay for r in runs) / len(runs), 2)


def cmd_verify(args) -> int:
    roster = playbook.coaches()
    calls = {key_of(c): c for c in selected_calls()}
    verified, stats = [], {"answers": 0, "not_high": 0, "unparsed": 0, "items": 0, "quotes": 0, "quotes_ok": 0,
                           "not_found": 0, "not_coach": 0, "items_kept": 0}
    for path in sorted((OUT / "answers").glob("*.json")):
        rec = json.loads(path.read_text(encoding="utf-8"))
        key = rec["key"]
        call = calls.get(key)
        if call is None:
            continue
        stats["answers"] += 1
        if rec.get("thinkingRequested") != "high" or not rec.get("thinking"):
            stats["not_high"] += 1   # made without a confirmed high thinking level: never used
            continue
        data = parse_answer(rec.get("text") or "")
        if not isinstance(data, dict):
            stats["unparsed"] += 1
            continue
        if data.get("recovered"):
            stats["recovered_item_by_item"] = stats.get("recovered_item_by_item", 0) + 1
        for item in data.get("items") or []:
            if not isinstance(item, dict):
                continue
            stats["items"] += 1
            good = []
            for q in item.get("quotes") or []:
                if not isinstance(q, dict) or not q.get("text"):
                    continue
                stats["quotes"] += 1
                doc = f"call:{key}"
                seg = course.speaker_of(doc, q["text"]) if course.contains(doc, q["text"]) else None
                if seg is not None and seg.speaker in roster:
                    stats["quotes_ok"] += 1
                    good.append({"text": q["text"], "at": seg.at, "speaker": roster[seg.speaker]})
                    continue
                part = coach_part(doc, q["text"], roster)
                if part:
                    stats["quotes_trimmed"] = stats.get("quotes_trimmed", 0) + 1
                    good.append({"text": part[0], "at": part[1].at, "speaker": roster[part[1].speaker], "trimmed": True})
                elif seg is None:
                    stats["not_found"] += 1
                else:
                    stats["not_coach"] += 1
            # A roast keeps its student email even without a coach quote; advice needs one checked quote.
            if good or (item.get("kind") == "roast" and item.get("student_email")):
                stats["items_kept"] += 1
                verified.append({"call": f"call:{key}", "title": call.title, "date": call.date,
                                 "model": rec.get("model"), "thinking": rec.get("thinking"),
                                 "kind": item.get("kind"), "side": item.get("side"), "stage": item.get("stage"),
                                 "situation": item.get("situation"), "advice": item.get("advice"), "quotes": good,
                                 "student_email": item.get("student_email") or "",
                                 "email_read_aloud": read_aloud(f"call:{key}", item.get("student_email") or "") if item.get("student_email") else None,
                                 "verdict": item.get("verdict") or "",
                                 "rewrite": item.get("rewrite") or ""})
    (OUT / "verified.json").write_text(json.dumps({"stats": stats, "items": verified}, ensure_ascii=False, indent=1),
                                       encoding="utf-8")
    print(json.dumps(stats, indent=1))
    return 0


def cmd_stats(args) -> int:
    calls = selected_calls()
    done = len(list((OUT / "answers").glob("*.json"))) if (OUT / "answers").exists() else 0
    print(f"{len(calls)} calls selected ({sum(len(c.text) for c in calls) / 1e6:.1f}M chars); {done} answered")
    status = OUT / "status.json"
    if status.exists():
        print(status.read_text(encoding="utf-8"))
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="python -m comms.mine_calls")
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("run")
    p.add_argument("--tabs", type=int, default=3)
    p.add_argument("--gap", type=float, default=60, help="seconds between any two sends")
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--accounts", default="", help="Gemini account indexes, e.g. 0,1: --tabs tabs on each, one shared queue")
    p.add_argument("--timeout", type=int, default=900)
    p.add_argument("--thinking", default="high", choices=["low", "medium", "high"])
    sub.add_parser("verify")
    sub.add_parser("stats")
    args = parser.parse_args(argv)
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    return {"run": cmd_run, "verify": cmd_verify, "stats": cmd_stats}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
