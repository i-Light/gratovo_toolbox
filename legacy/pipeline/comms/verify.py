"""`python -m comms.verify` (from pipeline/): is every rule of the playbook really the course's?

Fails (exit 1) when a rule is malformed, a quote is not in its source or does not make its point alone (it stops
at "two things", two quotes cut from one passage, or the reviewer flagged it), a call quote was not said by a
coach (coaches.json), a video quote was not checked by a person (comms/quote_review.py; quotes the old Whisper
cross-check had already confirmed also pass) or has no coach to say it (videos.json),
two rules share an id, or a lesson that is in scope is cited by no rule (its page or its video). `--context`
prints each quote with the text around it, for reading quotes before trusting them.
"""

from __future__ import annotations

import argparse
import collections
import re
import sys
from typing import Optional

from . import course, playbook, quote_review, video_check

RULE_REF = re.compile(r"\b(?:FND|INF|BRD)-[A-Z]+-\d+\b")
CHOICE_REF = re.compile(r"\bHC-\d+\b")
# a quote that stops where its point begins ("they need two things.", "like this:") proves nothing on its own
PROMISE = re.compile(r"\b(two|three|four|five|2|3|4|5|few|couple of|several)\s+(things?|ways?|reasons?|steps?|options?"
                     r"|questions?|points?|rules?|mistakes?)[.:]?\s*$", re.I)


def stops_short(quote: str) -> bool:
    """Ends on a colon, or is a short line ending on 'two things' (a longer one usually listed them first)."""
    return bool(re.search(r":\s*$", quote)) or (bool(PROMISE.search(quote)) and len(quote.split()) <= 14)
SAME_PASSAGE = 120   # characters between two quotes of one rule from one video: they are one quote


def reference_problems(rules, choices: list[dict]) -> list[str]:
    """Rule ids and house choices named in a rule's text, and the sources of each house choice, must exist."""
    out = []
    ids = {r.id for r in rules}
    choice_ids = {c.get("id") for c in choices}
    for r in rules:
        text = " ".join([r.title, r.rule, *r.do, *r.dont, *r.steps, r.when or ""])
        for ref in sorted(set(RULE_REF.findall(text)) - ids):
            out.append(f"{r.file}:{r.id}: refers to rule {ref}, which does not exist")
        for ref in sorted(set(CHOICE_REF.findall(text)) - choice_ids):
            out.append(f"{r.file}:{r.id}: refers to house choice {ref}, which is not in house_choices.json")
    for c in choices:
        keys = [o.get("key") for o in c.get("options") or []]
        if c.get("default") not in keys:
            out.append(f"house_choices.json:{c.get('id')}: default {c.get('default')!r} is not one of its options {keys}")
        if c.get("pick") is not None and c.get("pick") not in keys:
            out.append(f"house_choices.json:{c.get('id')}: pick {c.get('pick')!r} is not one of its options {keys}")
        for o in c.get("options") or []:
            for ref in o.get("sources") or []:
                if RULE_REF.fullmatch(ref) and ref not in ids:
                    out.append(f"house_choices.json:{c.get('id')}: option {o.get('key')!r} cites rule {ref}, which does not exist")
    return out


def example_problems(examples: list[dict], roster: dict) -> list[str]:
    """A roast example is evidence only through its coach quote: it must be in the call, in a coach's turn, and
    make its point; the reconstructed email it judges must be there to learn from."""
    out: list[str] = []
    seen: set = set()
    for ex in examples:
        where = f"examples.json:{ex.get('id') or '?'}"
        if not ex.get("id") or ex["id"] in seen:
            out.append(f"{where}: missing or repeated id")
        seen.add(ex.get("id"))
        if ex.get("side") not in ("influencer", "brand") or ex.get("stage") not in playbook.AREAS.get(ex.get("side"), ()):
            out.append(f"{where}: unknown side/stage {ex.get('side')}/{ex.get('stage')}")
        if ex.get("verdict") not in ("good", "mixed", "bad"):
            out.append(f"{where}: verdict {ex.get('verdict')!r} is not good, mixed or bad")
        if not (ex.get("student_email") or "").strip():
            out.append(f"{where}: no student email to learn from")
        q = ex.get("quote") or {}
        doc, text = q.get("doc") or "", q.get("quote") or ""
        if not doc.startswith("call:") or not course.contains(doc, text):
            out.append(f"{where}: coach quote not found in {doc}: {text[:100]!r}")
            continue
        seg = course.speaker_of(doc, text)
        if seg is None or seg.speaker not in roster:
            out.append(f"{where}: quote is not in a coach's turn ({doc})")
        if stops_short(text):
            out.append(f"{where}: quote stops before its point: {text[-80:]!r}")
    return out


def split_quotes(where: str, rule, reviews: dict) -> list[str]:
    """Two quotes of one rule from the same passage of a video are one point cut in two: each looks like a
    fragment on the review page and in the skill. Quote the passage once (up to about 70 words)."""
    spans = []
    for s in rule.src:
        if s.doc.startswith("video:"):
            q = course.norm(quote_review.original_of(s.doc, s.quote, reviews))
            pos = course._video_index(s.doc)[0].find(q)
            if pos >= 0:
                spans.append((s.doc, pos, pos + len(q), s.quote))
    spans.sort()
    return [f"{where}: two quotes from one passage of {a[0]}; make them one quote: {a[3][:50]!r} ... {b[3][:50]!r}"
            for a, b in zip(spans, spans[1:]) if a[0] == b[0] and 0 <= b[1] - a[2] <= SAME_PASSAGE and b[2] - a[1] <= 420]


def video_problems(where: str, rule, s, vids: dict, names: set, reviews: Optional[dict] = None) -> list[str]:
    """Who says a video quote (videos.json) and whether a person checked its words by ear (quote_review.py)."""
    out = []
    lesson = s.doc[len("video:"):]
    info = vids.get(lesson)
    if info is None:
        out.append(f"{where}: {lesson} is not in videos.json (who speaks in it?)")
    elif info["speakers"] == "single":
        if s.speaker and s.speaker != info["presenter"]:
            out.append(f"{where}: speaker {s.speaker!r} but {lesson} is presented by {info['presenter']} alone")
        if info["presenter"] not in names and info["presenter"] != "unnamed coach":
            out.append(f"{where}: presenter {info['presenter']!r} is not a coach in coaches.json")
    elif info["speakers"] == "multi":
        # "A|B": certainly a coach, but the recording does not show which of these (a live session)
        who = [x.strip() for x in str(s.speaker or "").split("|") if x.strip()]
        if not who or any(x not in names for x in who):
            out.append(f"{where}: {lesson} has several speakers: name the coach who says it (`speaker`), got {s.speaker!r}")
    elif info["speakers"] == "student":
        if s.speaker != "student" or rule.level != "tip":
            out.append(f"{where}: a student's story backs only a `tip` rule, with `speaker: \"student\"`")
    if quote_review.checked(s.doc, s.quote, reviews if reviews is not None else {"quotes": {}}):
        return out
    check = video_check.cached(s.doc, s.quote)
    if check is not None and check.get("ok"):
        return out   # confirmed by the Whisper cross-check before checking moved to a person (2026-10-15)
    if check is None:
        out.append(f"{where}: video quote not checked by a person yet (python -m comms.quote_review): {s.quote[:80]!r}")
    else:
        out.append(f"{where}: Whisper heard this video quote differently (missing: "
                   f"{' '.join(check.get('missing') or []) or check.get('error')}); check it by ear "
                   f"(python -m comms.quote_review): {s.quote[:80]!r}")
    return out


def check(directory=None) -> dict:
    problems: list[str] = []
    warnings: list[str] = []
    rules = playbook.rules(directory)
    roster = playbook.coaches(directory)
    names = playbook.coach_names(directory)
    vids = playbook.videos(directory)
    seen: dict[str, str] = {}
    cited = collections.Counter()
    lessons = course.lessons()
    reviews = quote_review.load(directory)
    for r in rules:
        where = f"{r.file}:{r.id or '?'}"
        if not r.id:
            problems.append(f"{where}: no id")
        elif r.id in seen:
            problems.append(f"{where}: id also used in {seen[r.id]}")
        else:
            seen[r.id] = r.file
        if r.area not in playbook.AREAS:
            problems.append(f"{where}: unknown area {r.area!r}")
        elif r.stage not in playbook.AREAS[r.area]:
            problems.append(f"{where}: stage {r.stage!r} is not one of {r.area}'s stages")
        if r.level not in playbook.LEVELS:
            problems.append(f"{where}: level {r.level!r} is not one of {playbook.LEVELS}")
        if not r.title.strip() or not r.rule.strip():
            problems.append(f"{where}: needs a title and a rule")
        if not r.src:
            problems.append(f"{where}: no source")
        for s in r.src:
            # an edited video quote is matched to the transcript through its original wording
            text = quote_review.original_of(s.doc, s.quote, reviews) if s.doc.startswith("video:") else s.quote
            doc = course.source(s.doc)
            if doc is None:
                problems.append(f"{where}: unknown source {s.doc!r}")
                continue
            if len(course.norm(text)) < 20:
                problems.append(f"{where}: quote too short to prove anything: {s.quote!r}")
                continue
            title = course.norm(getattr(doc, "title", "") or "")
            if title and (course.norm(text) in title or title.endswith(course.norm(text))):
                problems.append(f"{where}: quote is the source's title, not its teaching: {s.quote!r}")
                continue
            if not course.contains(s.doc, text):
                problems.append(f"{where}: quote not found in {s.doc}: {s.quote[:120]!r}")
                continue
            if stops_short(s.quote):
                problems.append(f"{where}: quote stops before its point; quote the whole point: {s.quote[-80:]!r}")
            rec = quote_review.lookup(s.doc, s.quote, reviews) if s.doc.startswith("video:") else None
            if rec and rec.get("flagged"):
                problems.append(f"{where}: flagged on the review page as not making its point alone"
                                f"{': ' + rec['flag_note'] if rec.get('flag_note') else ''}: {s.quote[:80]!r}")
            cited[s.doc] += 1
            if s.doc.startswith("video:"):
                cited[s.doc[len("video:"):]] += 1
                problems += video_problems(where, r, s, vids, names, reviews)
            if s.doc.startswith("call:"):
                seg = course.speaker_of(s.doc, s.quote)
                if seg is None:
                    warnings.append(f"{where}: call quote spans speakers in {s.doc}")
                elif seg.speaker not in roster:
                    problems.append(f"{where}: call quote is {seg.speaker!r}'s words, not a coach's ({s.doc} @{seg.at})")
        problems += split_quotes(where, r, reviews)
    problems += reference_problems(rules, playbook.house_choices(directory))
    problems += example_problems(playbook.examples(directory), roster)
    scope = playbook.scope(directory)
    out_of_scope = scope.get("out_of_scope") or {}
    pending = scope.get("pending_video") or {}
    for lesson_id in lessons:
        if lesson_id in out_of_scope:
            continue
        if lesson_id in pending:
            if not cited[lesson_id]:
                warnings.append(f"pending video (cite it from its transcript): {lesson_id}")
            continue
        if not cited[lesson_id]:
            warnings.append(f"lesson never cited (cite it or list it in scope.json with a reason): {lesson_id}")
    for lesson_id in list(out_of_scope) + list(pending):
        if lesson_id not in lessons:
            problems.append(f"scope.json names a lesson that does not exist: {lesson_id}")
    by_area = collections.Counter(f"{r.area}.{r.stage}" for r in rules)
    return {"rules": len(rules), "problems": problems, "warnings": warnings, "by_stage": dict(sorted(by_area.items())),
            "lessons_cited": sum(1 for l in lessons if cited[l]), "lessons": len(lessons),
            "lessons_out_of_scope": len(out_of_scope)}


def main(argv: Optional[list] = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m comms.verify", description=__doc__.splitlines()[0])
    parser.add_argument("--context", action="store_true", help="print every quote with the text around it")
    parser.add_argument("--strict", action="store_true", help="uncited in-scope lessons are failures, not warnings")
    args = parser.parse_args(argv)
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    result = check()
    if args.context:
        for r in playbook.rules():
            for s in r.src:
                print(f"--- {r.id} [{s.doc}]\n{course.context(s.doc, s.quote, 300) or '(not found)'}\n")
    print(f"{result['rules']} rules; lessons cited {result['lessons_cited']}/{result['lessons']} "
          f"({result['lessons_out_of_scope']} out of scope)")
    for stage, n in result["by_stage"].items():
        print(f"  {stage}: {n}")
    for w in result["warnings"]:
        print(f"WARN {w}")
    for p in result["problems"]:
        print(f"FAIL {p}")
    failed = bool(result["problems"]) or (args.strict and any(w.startswith("lesson never cited") for w in result["warnings"]))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
