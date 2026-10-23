"""Mine the coach-call transcripts for communication advice, with quotes that a script can check.

    python -m gratovo_pipeline.comms.mine_calls run --course-dir DIR --out DIR [--tabs 3]
        [--limit N]
        # Gemini, detached-friendly, resumable
    python -m gratovo_pipeline.comms.mine_calls verify --course-dir DIR --out DIR
        # check every quote, write OUT/verified.json
    python -m gratovo_pipeline.comms.mine_calls stats --course-dir DIR --out DIR

One prompt per call: the transcript as Fathom wrote it (speaker labels and timestamps) and the list
of coaches. Gemini returns JSON items (advice, roasted emails, disagreements) with verbatim quotes;
`verify` keeps a quote only if it is in that transcript and was said by a coach (coaches.json). The
result is raw material for the playbook: rules are still written by hand from it, never copied
wholesale.

Excluded: the productivity/mindset calls and the Fawaz Central performance sessions (not about
communication).

The course and the output live on the owner's PC, outside the repository: `--course-dir` (or
`GRATOVO_COURSE_DIR`) names the course, `--out` (or `GRATOVO_MINED_DIR`, the same folder the example
bank and the coach read) the mined calls. With either missing the tool stops with one line saying
which. Nothing here sends an email.
"""

from __future__ import annotations

import argparse
import io
import json
import re
import sys
from pathlib import Path
from typing import Any, cast

from gratovo_pipeline.comms import course, example_bank, playbook
from gratovo_pipeline.gemini.json_reply import extract_json

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
"""  # noqa: E501


def _obj(value: object) -> dict[str, Any]:
    return cast("dict[str, Any]", value) if isinstance(value, dict) else {}


def _objs(value: object) -> list[Any]:
    return cast("list[Any]", value) if isinstance(value, list) else []


def fawaz_led(call: course.Call) -> bool:
    """A Fawaz Central session (habits, sleep, productivity) titled only by its date, so EXCLUDE
    misses it: Fawaz is the main speaker. 10 of the first 12 empty answers were these
    (2026-10-15)."""
    chars: dict[str, int] = {}
    for seg in call.segments:
        chars[seg.speaker] = chars.get(seg.speaker, 0) + len(seg.text)
    return bool(chars) and "fawaz" in max(chars, key=lambda s: chars[s]).lower()


def selected_calls() -> list[course.Call]:
    calls = [c for c in course.calls().values() if not EXCLUDE.search(c.title)]
    return sorted(calls, key=lambda c: (c.date, c.id))


def _skip_keys(out: Path) -> set[str]:
    """Calls the owner marked to skip in OUT/skip.json (Fawaz Central, productivity and mindset).
    Delete a key from that file to mine the call."""
    try:
        data = json.loads((out / "skip.json").read_text(encoding="utf-8"))
    except OSError, ValueError:
        return set()
    return {row["key"] for row in data.get("calls", [])}


def prompt_for(call: course.Call) -> str:
    roster = playbook.coaches()
    names = sorted(set(roster.values()))
    return PROMPT.format(
        coaches=", ".join(names),
        inf=", ".join(STAGES["influencer"]),
        brd=", ".join(STAGES["brand"]),
        fnd=", ".join(STAGES["both"]),
        title=call.title,
        date=call.date,
        transcript=call.text,
    )


def key_of(call: course.Call) -> str:
    return call.id.replace("call:", "")


def _out(args: argparse.Namespace) -> Path:
    """The mined calls' folder: `--out`, else `GRATOVO_MINED_DIR`."""
    out = getattr(args, "out", None) or example_bank.mined_dir()
    if out is None:
        raise FileNotFoundError(
            f"no folder for the mined calls: pass --out or set {example_bank.MINED_DIR_ENV}"
        )
    return Path(out)


def cmd_run(args: argparse.Namespace) -> int:
    from gratovo_pipeline.comms.pool import run

    out = _out(args)
    skip = _skip_keys(out)
    # answers already made for them are kept
    calls = [c for c in selected_calls() if not fawaz_led(c) and key_of(c) not in skip]
    if args.limit:
        calls = calls[: args.limit]
    prompts = {key_of(c): prompt_for(c) for c in calls}
    run(
        prompts,
        out,
        tabs=args.tabs,
        timeout_s=args.timeout,
        title="Call mining",
        model="Argon",
        thinking=args.thinking,
        gap_s=args.gap,
        accounts=[int(x) for x in args.accounts.split(",")] if args.accounts else None,
    )
    return 0


def _repair(s: str) -> str:
    """Escape what breaks Gemini's JSON inside strings: a bare quote that does not end the string
    (one not followed by , : } ]) and raw line breaks."""
    out: list[str] = []
    in_str, esc = False, False
    for i, ch in enumerate(s):
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                nxt = s[i + 1 :].lstrip()[:1]
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


def _loads(s: str) -> Any:
    for cand in (s, _repair(s)):
        try:
            return json.loads(cand)
        except ValueError:
            pass
    return None


def parse_answer(text: str) -> dict[str, Any] | None:
    """The answer's {"items": [...]}, recovering broken JSON (2026-10-15: bare quotes inside a
    string, e.g. `"situation": "... ("Are you open to brand deals?") ..."`, and an answer that
    restarted its JSON halfway). Last resort: item by item. None when nothing can be read."""
    text = text or ""
    data: Any = extract_json(text, strict=False)
    if isinstance(data, dict) and isinstance(data.get("items"), list):  # pyright: ignore[reportUnknownMemberType]
        return data  # pyright: ignore[reportUnknownVariableType]
    for start in reversed([m.start() for m in re.finditer(r'\{\s*"items"\s*:', text)]):
        chunk = text[start:]
        data = _loads(chunk[: chunk.rfind("}") + 1])
        if isinstance(data, dict) and isinstance(data.get("items"), list):  # pyright: ignore[reportUnknownMemberType]
            return data  # pyright: ignore[reportUnknownVariableType]
    items: list[dict[str, Any]] = []
    marks = [m.start() for m in re.finditer(r'\{\s*"kind"\s*:', text)]
    for i, start in enumerate(marks):
        piece = text[start : marks[i + 1] if i + 1 < len(marks) else len(text)]
        ends = [j for j, ch in enumerate(piece) if ch == "}"][::-1][:6]
        for end in ends:
            item = _loads(piece[: end + 1])
            if isinstance(item, dict) and item.get("kind"):  # pyright: ignore[reportUnknownMemberType]
                items.append(item)  # pyright: ignore[reportUnknownArgumentType]
                break
    return {"items": items, "recovered": "item by item"} if items else None


def coach_part(
    call_id: str, quote: str, roster: dict[str, str]
) -> tuple[str, course.Segment] | None:
    """(text, segment) of the longest run of whole sentences of `quote` (40+ chars) that lies
    inside one coach's turn, or None. Fathom's speaker turns change late or early, so a coach's
    sentence can sit at the end of a student's turn (2026-10-15: "The brand is asking for bank
    details..." under the student, the rest under Younes); only the part the transcript gives to
    the coach is kept."""
    sentences = [x.strip() for x in re.split(r"(?<=[.?!])\s+", quote or "") if x.strip()]
    best: tuple[str, course.Segment] | None = None
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
    """Share of a student email's 6-word runs found in the transcript: roasted emails are usually
    shown on screen and only partly read, so Gemini rebuilds them; below ~0.6 treat the email as
    reconstructed."""
    words = re.findall(r"[a-z0-9']+", (email or "").lower())
    if len(words) < 6:
        return 0.0
    hay = course._normed(call_id)  # pyright: ignore[reportPrivateUsage]
    runs = [" ".join(words[i : i + 6]) for i in range(0, len(words) - 5, 3)]
    return round(sum(course.norm(r) in hay for r in runs) / len(runs), 2)


def cmd_verify(args: argparse.Namespace) -> int:
    out = _out(args)
    roster = playbook.coaches()
    calls = {key_of(c): c for c in selected_calls()}
    verified: list[dict[str, Any]] = []
    stats: dict[str, int] = {
        "answers": 0,
        "not_high": 0,
        "unparsed": 0,
        "items": 0,
        "quotes": 0,
        "quotes_ok": 0,
        "not_found": 0,
        "not_coach": 0,
        "items_kept": 0,
    }
    for path in sorted((out / "answers").glob("*.json")):
        rec = json.loads(path.read_text(encoding="utf-8"))
        key = rec["key"]
        call = calls.get(key)
        if call is None:
            continue
        stats["answers"] += 1
        if rec.get("thinkingRequested") != "high" or not rec.get("thinking"):
            stats["not_high"] += 1  # made without a confirmed high thinking level: never used
            continue
        data = parse_answer(rec.get("text") or "")
        if not isinstance(data, dict):  # pyright: ignore[reportUnnecessaryIsInstance]
            stats["unparsed"] += 1
            continue
        if data.get("recovered"):
            stats["recovered_item_by_item"] = stats.get("recovered_item_by_item", 0) + 1
        for raw_item in _objs(data.get("items")):
            item = _obj(raw_item)
            if not isinstance(raw_item, dict):
                continue
            stats["items"] += 1
            good: list[dict[str, Any]] = []
            for raw_quote in _objs(item.get("quotes")):
                q = _obj(raw_quote)
                if not isinstance(raw_quote, dict) or not q.get("text"):
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
                    good.append(
                        {
                            "text": part[0],
                            "at": part[1].at,
                            "speaker": roster[part[1].speaker],
                            "trimmed": True,
                        }
                    )
                elif seg is None:
                    stats["not_found"] += 1
                else:
                    stats["not_coach"] += 1
            # A roast keeps its student email even without a coach quote; advice needs one checked
            # quote.
            if good or (item.get("kind") == "roast" and item.get("student_email")):
                stats["items_kept"] += 1
                verified.append(
                    {
                        "call": f"call:{key}",
                        "title": call.title,
                        "date": call.date,
                        "model": rec.get("model"),
                        "thinking": rec.get("thinking"),
                        "kind": item.get("kind"),
                        "side": item.get("side"),
                        "stage": item.get("stage"),
                        "situation": item.get("situation"),
                        "advice": item.get("advice"),
                        "quotes": good,
                        "student_email": item.get("student_email") or "",
                        "email_read_aloud": read_aloud(
                            f"call:{key}", item.get("student_email") or ""
                        )
                        if item.get("student_email")
                        else None,
                        "verdict": item.get("verdict") or "",
                        "rewrite": item.get("rewrite") or "",
                    }
                )
    (out / example_bank.MINED_NAME).write_text(
        json.dumps({"stats": stats, "items": verified}, ensure_ascii=False, indent=1),
        encoding="utf-8",
    )
    print(json.dumps(stats, indent=1))
    return 0


def cmd_stats(args: argparse.Namespace) -> int:
    out = _out(args)
    calls = selected_calls()
    done = len(list((out / "answers").glob("*.json"))) if (out / "answers").exists() else 0
    print(
        f"{len(calls)} calls selected ({sum(len(c.text) for c in calls) / 1e6:.1f}M chars); "
        f"{done} answered"
    )
    status = out / "status.json"
    if status.exists():
        print(status.read_text(encoding="utf-8"))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m gratovo_pipeline.comms.mine_calls")
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("run")
    p.add_argument("--tabs", type=int, default=3)
    p.add_argument("--gap", type=float, default=60, help="seconds between any two sends")
    p.add_argument("--limit", type=int, default=0)
    p.add_argument(
        "--accounts",
        default="",
        help="Gemini account indexes, e.g. 0,1: --tabs tabs on each, one shared queue",
    )
    p.add_argument("--timeout", type=int, default=900)
    p.add_argument("--thinking", default="high", choices=["low", "medium", "high"])
    for q in (p, sub.add_parser("verify"), sub.add_parser("stats")):
        q.add_argument(
            "--course-dir",
            type=Path,
            default=None,
            help=f"the course folder (else {course.COURSE_DIR_ENV})",
        )
        q.add_argument(
            "--out",
            type=Path,
            default=None,
            help=f"the mined calls' folder (else {example_bank.MINED_DIR_ENV})",
        )
    args = parser.parse_args(argv)
    for stream in (sys.stdout, sys.stderr):
        if isinstance(stream, io.TextIOWrapper):
            stream.reconfigure(encoding="utf-8", errors="replace")
    if args.course_dir is not None:
        course.configure(args.course_dir, course.video_dir())
    if not course.available():
        print(
            f"The course is not here: pass --course-dir or set {course.COURSE_DIR_ENV}.",
            file=sys.stderr,
        )
        return 2
    try:
        _out(args)
    except FileNotFoundError as error:
        print(error, file=sys.stderr)
        return 2
    return {"run": cmd_run, "verify": cmd_verify, "stats": cmd_stats}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
