"""Build the Gemini skill `gratovo-comms` from the playbook (data/comms/playbook/).

    python -m comms.skill_build [--out DIR]      # writes DIR/gratovo-comms/ (default: data/comms/skill/)

The skill is references only (no scripts), so it works in a fast chat as well as in a task: SKILL.md is
the operating procedure and the answer format; references/ holds every rule rendered by area and stage
with its course quote, the house choices as currently decided, the situations map, the glossary, the roast
examples (learn from, never copy), and a build id the workflow probes after an upload to know Gemini reads this
version.

Deploy with `python -m comms.skill_build --deploy` (build, upload, probe the build id), or
gemini_bridge.skills.deploy() (CLI: python -m gemini_bridge skill-deploy <folder>).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

from . import course, playbook

REPO = Path(__file__).resolve().parents[2]
DEFAULT_OUT = REPO / "data" / "comms" / "skill"
SKILL_NAME = "gratovo-comms"
GLOSSARY = ["module 5 FAQs/5.Common Influencer Marketing Terms", "module 5 FAQs/5.Acronyms Resource List"]

STAGE_TITLES = {
    "mindset": "Mindset and power dynamics", "writing": "Writing", "subject": "Subject lines", "formatting": "Formatting",
    "channels": "Channels", "calls": "Calls (briefs, booking, recap)", "deliverability": "Deliverability and sending", "ethics": "Ethics (halal, honesty)",
    "qualify": "Qualifying", "first_contact": "First contact", "follow_up": "Follow-ups", "replies": "Handling replies",
    "offer": "The offer", "pricing": "Pricing", "negotiation": "Negotiation", "managers": "Managers and agencies",
    "closing": "Closing", "onboarding": "Onboarding", "delivery": "Delivery", "payment": "Payment", "after": "After the campaign",
    "objections": "Objections", "presenting": "Presenting creators", "contract": "Contracts",
}

SKILL_MD = """---
name: gratovo-comms
description: The Gratovo agency's communication playbook from its influencer-marketing course. Use it for every message to or from a creator, a creator's manager or a brand - first outreach, follow-ups, replies, objections, negotiation, contracts, briefs, delivery, payment, reports - and to decide the next step in a deal.
---

# Gratovo communication playbook

You work for a small influencer-marketing agency (it connects brands with YouTube/Instagram/TikTok creators and earns the margin). Everything you decide and write must follow the playbook in `references/`, which comes only from the agency's course; nothing else applies. Rule ids (e.g. INF-FIRST-04) refer to it.

## How to work a case

The message you receive contains a CASE: who the other side is (creator, manager, brand), the stage of the deal, the thread so far, the facts we hold (channel stats, audience, prices, brands in hand, roster), the house choices, and what the agency wants. Then:

1. Read `references/foundations.md` (always) and the files for this side and stage, e.g. `references/influencer-replies.md`, `references/brand-negotiation.md`. If the case is a reply, read `references/situations.md` to name the reply type first. `references/examples.md` shows coach verdicts on real student emails for this stage: learn what works and fails from them, never copy their words.
2. Decide the next action the playbook prescribes for this exact situation. When a choice depends on a fact you were not given, ask for it instead of guessing.
3. Draft the message in the counterpart's language (English for first contact), following every applicable rule.
4. Check the draft against the checklist below and fix it before answering.

## Reading the CASE facts

- The facts are your notes, not the message: use only the ones that move this message forward (FND-WRITE-24).
- `median_views_last_30_days` is what one video typically gets (the median of that channel's videos in the last 30 days), never total views. To a brand give it as the exact number (BRD-PRES-04); to a creator, about their own channel, round it the way people talk ("about 63k a video").
- A brand's `about` and `seen_sponsoring` tell you who the brand is and who it backs. To a creator, name the brand, with a few plain words only when they may not know it, and never tell a creator who a brand sponsored. To a brand, a creator it sponsored is a good opener (BRD-FIRST).
- `creator.latest_video` is the newest upload: its title, views and the prose of its own description (`about`). The personal line reacts to one thing the video covers or did (a tool it compares, a result, unusual views against the median), never retelling it and never claiming to have watched more than the facts show (INF-FIRST-26). `tools_linked_in_recent_descriptions` and `sponsors_seen` are products the creator already promotes: never pitch one of them as new, and treat a direct competitor of one with care, since a recent sponsorship usually carries exclusivity (INF-FIRST-04, BRD-PRES-22).
- `agency.true_claims` are facts you may rely on, not lines to paste: say them in your own words, differently each time, and only when they answer something.
- `recent_messages` are emails the agency sent lately to other people. Yours must not read like any of them: a different opening, a different frame, different sentences, not the same email with new names (FND-WRITE-01).
- `needs_human` holds only what a person must decide or supply before this message can go: a price, terms, a claim, ethics, or a missing fact the message depends on (including a missing first name, INF-FIRST-20). Agency setup (website, domain, warm-up) and general research to-dos are not gates for a message.

## Hard limits (never break these)

- Never state anything that is not in the CASE facts: no invented brands, clients, results, budgets, deadlines, scarcity, case studies, guarantees, or relationships. Honesty is a religious and business rule here (FND-ETH-01).
- Never commit money: prices, counter-offers, discounts and payment terms are proposed with their reasoning and marked for a person to approve (INF-PRICE-06, FND-WRITE-16). When the next move is to quote or counter, write the proposed number into the message and raise the price gate: the person approves or changes it before anything is sent.
- Never agree to contract terms or sign anything; never invent a contract clause.
- Never promote or accept anything haram (FND-ETH-05..08); flag it.
- Never copy a sentence from the playbook or the course into a message; state the idea in fresh words, different every time (FND-WRITE-01, FND-WRITE-15).
- Plain text only in the message: no markdown, no links in a first email, no signature block beyond a simple sign-off.

## Checklist for every message

- One idea, one ask, a clear next step; the call to action is the last line and easy to answer (FND-WRITE-08, INF-FIRST-05).
- A first message has four parts in order (INF-FIRST-01): a subject taken from the personal line or a short curiosity line (FND-SUBJ-01); one personal point about their latest work, never retold, never 'I watched' or 'the way you' (INF-FIRST-26); a bridge sentence that carries that point into the offer (INF-FIRST-16); one easy question. If it could go unchanged to someone else, it is not personal yet (FND-WRITE-09).
- Short: first emails about six sentences, 50-70 words, text-message tone, 4th-grade words (FND-FMT-02, FND-WRITE-13, FND-WRITE-11). Replies answer what was asked, at the length they wrote, and add nothing they did not ask for: no explanations of how we work, no reassurance, no disclaimers (FND-WRITE-25).
- About them, not us; specific details only from the facts (FND-WRITE-10, FND-WRITE-07).
- No spam or hype words: offer, guarantee, opportunity, revenue, grow your brand, scale... (FND-WRITE-12).
- Never needy, never a fan, never pushy; facts over feelings (FND-MIND-01..04).
- Follow-up timing and count per the house choices.

## Answer format

Answer with ONE JSON object in a code block and nothing else:

```json
{
  "situation": {"side": "influencer|manager|brand", "stage": "<stage>", "reply_type": "<from situations.md or null>", "summary": "one sentence"},
  "decision": {"action": "<send_message|ask_user|wait|close_won|close_lost|schedule_follow_up|escalate>", "why": "one or two sentences", "rules": ["RULE-ID", "..."]},
  "message": {"channel": "email|dm", "subject": "string or null", "body": "plain text"},
  "needs_human": [{"what": "price|terms|claim|ethics|fact_missing|other", "detail": "what a person must confirm or supply"}],
  "follow_up": {"in_working_days": 0, "note": "what the next touch should do, or null"},
  "facts_used": ["each fact from the CASE that the message relies on"]
}
```

Use `"message": null` when no message should be sent now (waiting, or a person must decide first). Keep `rules` to the ids that actually drove the decision and the wording.

## Coach review mode

When the message asks for a COACH REVIEW you do not draft: you judge a draft the way the course's coaches judge a student's email on the coaching calls (`references/examples.md` shows real verdicts). Read the files for the side and stage, then judge what the draft does in this situation.

- good: a coach would send it as it is, or with a word changed.
- mixed: the right move, with flaws a coach would point out (too long, vague, a weak or salesy line, a missing or hard ask).
- bad: a coach would roast it: the wrong move for the situation, or it breaks a must rule (invented or dishonest, needy, a fan, copied or templated, vague, pushy, no clear ask, would not get a reply).

What the coaches roast most often: the four parts of a first email in order (INF-FIRST-01), the subject line (FND-SUBJ-01), plain words (FND-WRITE-11), the request for audience data (INF-REPLY-01, INF-REPLY-18), personalization that proves the video was seen (INF-FIRST-02, INF-FIRST-26), the bridge from the personal line to the offer (INF-FIRST-16), fake replies (FND-ETH-11), follow-up count and length (BRD-FU-09, FND-WRITE-27), the two-recipients test (FND-WRITE-09), copied templates (FND-WRITE-15), one easy question at the end (INF-FIRST-05), replies longer than the message they answer (FND-WRITE-25).

Be as strict with a polished draft as with a student's: judge the moves and the words, not the effort. Name each problem once, by the rule it breaks, with the fix in a few words. A good draft gets few or no points.

Coach-review answer format, ONE JSON object in a code block:

```json
{"verdict": "good|mixed|bad", "points": [{"rule": "RULE-ID", "problem": "what is wrong, in a few words", "fix": "what to do instead"}], "summary": "one sentence a coach would say"}
```
"""


def _source_label(doc_id: str) -> str:
    if doc_id.startswith("call:"):
        c = course.calls().get(doc_id)
        return f"coaching call \"{c.title}\" ({c.date})" if c else doc_id
    if doc_id.startswith("video:"):
        return f"lesson video \"{doc_id.split('/', 1)[-1]}\""
    return doc_id.split("/", 1)[-1]


def render_rule(r: playbook.Rule) -> str:
    lines = [f"### {r.id} — {r.title}", ""]
    if r.when:
        lines.append(f"When: {r.when}")
    lines.append(f"Rule ({r.level}): {r.rule}")
    if r.steps:
        lines.append("Steps: " + " → ".join(r.steps))
    if r.do:
        lines.append("Do: " + "; ".join(r.do))
    if r.dont:
        lines.append("Don't: " + "; ".join(r.dont))
    for s in r.src[:2]:
        lines.append(f"Source: {_source_label(s.doc)}{' @' + s.at if s.at else ''} — \"{s.quote.strip()}\"")
    return "\n".join(lines) + "\n"


def render_choices(directory: Path) -> str:
    data = json.loads((directory / "house_choices.json").read_text(encoding="utf-8"))
    out = ["# House choices", "", "Where the course gives more than one answer, the agency's pick (or the default until it picks) applies.", ""]
    for c in data["choices"]:
        chosen = c.get("pick") or c.get("default")
        label = next((o["label"] for o in c["options"] if o["key"] == chosen), chosen)
        out += [f"## {c['id']} — {c['topic']}", f"Applies: {label}" + ("" if c.get("pick") else " (default; the owner has not picked yet)")]
        if c.get("owner_note"):
            out.append(f"Owner's rule: {c['owner_note']}")
        out.append("")
    return "\n".join(out) + "\n"


def render_examples(examples: list[dict]) -> str:
    out = ["# Roast examples — learn from them, never copy them", "",
           "Student emails judged by a coach on a call. The student emails and the coaches' rewrites are reconstructed "
           "from what was read aloud; only the coach's quote is verbatim. Use them to recognise what works and what "
           "fails. Never reuse their wording: a message that repeats eight words of any of them is rejected "
           "(FND-WRITE-15). Placeholders such as [Brand] mean the facts of a real case go there; never fill them with "
           "anything the CASE does not give.", ""]
    order = {"bad": 0, "mixed": 1, "good": 2}
    for side in ("influencer", "brand"):
        for stage in playbook.AREAS[side]:
            group = sorted((e for e in examples if e["side"] == side and e["stage"] == stage),
                           key=lambda e: order.get(e["verdict"], 3))
            if not group:
                continue
            out += [f"## {side.title()}s — {STAGE_TITLES.get(stage, stage)}", ""]
            for e in group:
                out += [f"### {e['id']} — verdict: {e['verdict']} ({e['coach']}, {e['date']})",
                        f"Situation: {e['situation']}",
                        f"Student email (reconstructed): \"\"\"{e['student_email']}\"\"\"",
                        f"Coach's points: {e['points']}",
                        f"Coach, verbatim: \"{e['quote']['quote']}\""]
                if e.get("rewrite"):
                    out.append(f"Coach's spoken rewrite (reconstructed): \"\"\"{e['rewrite']}\"\"\"")
                if e.get("note"):
                    out.append(e["note"])
                out.append("")
    return "\n".join(out) + "\n"


def render_situations(directory: Path) -> str:
    data = json.loads((directory / "situations.json").read_text(encoding="utf-8"))
    out = ["# Situations", "", "Name the stage of the deal and, for a reply, its type (the id goes in `situation.reply_type`).",
           "`needs a person` marks replies where a human must confirm before anything is sent.", ""]
    for side, stages in data["stages"].items():
        out += [f"## Deal stages — {side}", ""]
        out += [f"- `{s['id']}` {s['label']} — rules {', '.join(s['rules'])}" for s in stages]
        out.append("")
    for side, replies in data["replies"].items():
        out += [f"## Reply types — {side}", ""]
        for r in replies:
            signs = f" (e.g. {'; '.join(repr(x) for x in r['signs'])})" if r["signs"] else ""
            gate = f" — needs a person: {r['human']}" if r.get("human") else ""
            out.append(f"- `{r['id']}` {r['label']}{signs} → rules {', '.join(r['rules'])}{gate}")
        out.append("")
    return "\n".join(out)


def build(out_root: Path = DEFAULT_OUT, directory: Path | None = None) -> dict:
    directory = Path(directory or playbook.playbook_dir())
    rules = playbook.rules(directory)
    folder = Path(out_root) / SKILL_NAME
    refs = folder / "references"
    if folder.exists():
        for p in sorted(folder.rglob("*"), reverse=True):
            p.unlink() if p.is_file() else p.rmdir()
    refs.mkdir(parents=True, exist_ok=True)
    files: dict[str, str] = {}
    foundations = [r for r in rules if r.area == "foundations"]
    body = ["# Foundations (always apply)", ""]
    for stage in playbook.AREAS["foundations"]:
        group = [r for r in foundations if r.stage == stage]
        if group:
            body += [f"## {STAGE_TITLES.get(stage, stage)}", ""] + [render_rule(r) for r in group]
    files["references/foundations.md"] = "\n".join(body)
    for area in ("influencer", "brand"):
        for stage in playbook.AREAS[area]:
            group = [r for r in rules if r.area == area and r.stage == stage]
            if group:
                title = f"# {area.title()}s — {STAGE_TITLES.get(stage, stage)}"
                files[f"references/{area}-{stage.replace('_', '-')}.md"] = "\n".join([title, ""] + [render_rule(r) for r in group])
    files["references/house-choices.md"] = render_choices(directory)
    if (directory / "situations.json").exists():
        files["references/situations.md"] = render_situations(directory)
    examples = playbook.examples(directory)
    if examples:
        files["references/examples.md"] = render_examples(examples)
    glossary = ["# Glossary (from the course)", ""]
    for doc in GLOSSARY:
        lesson = course.lessons().get(doc)
        if lesson:
            glossary += [lesson.text.strip(), ""]
    files["references/glossary.md"] = "\n".join(glossary)
    index = ["# Index of reference files", ""] + [f"- {name}" for name in sorted(files)]
    files["references/index.md"] = "\n".join(index) + "\n"
    # SKILL.md is part of the id: a change to the procedure alone must show as a new build (2026-10-16, it did not).
    files["SKILL.md"] = SKILL_MD
    digest = hashlib.sha256("".join(files[k] for k in sorted(files)).encode("utf-8")).hexdigest()[:10]
    build_id = f"comms-{digest}"
    files["references/build.md"] = f"Build id: {build_id}\nBuilt: {time.strftime('%Y-%m-%d %H:%M')}\nRules: {len(rules)}\n"
    for name, text in files.items():
        path = folder / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    return {"folder": str(folder), "build_id": build_id, "rules": len(rules), "files": sorted(files),
            "bytes": sum(len(t.encode("utf-8")) for t in files.values())}


def deploy(info: dict) -> dict:
    """Uploads the built folder (create or replace, turned on; the workflow still picks it by @-mention) and asks
    Gemini for the build id until it answers with this build's: proof it reads the version just uploaded."""
    from gemini_bridge import skills   # late: the bridge is only needed to deploy
    from . import pool
    g = pool.connect()
    try:
        # A browser just launched shows its Gemini tab a while after the bridge connects; opening more tabs in the
        # meantime (2026-10-16) only stacked background tabs that never finish loading. Wait for a ready one.
        deadline = time.time() + 180
        while not any(t.get("ready") for t in g.tabs()) and time.time() < deadline:
            time.sleep(5)
        if not any(t.get("ready") for t in g.tabs()):
            g.open(new_tab=True, focus=True, timeout=120)
        # On, not off: an off skill named by @ makes Gemini show "Submitting this will enable the gratovo-comms
        # skill", which the add-on reads as a refused send (2026-10-16), and the first use turns it on anyway.
        result = skills.deploy(g, info["folder"], active=True)
        result["probe"] = skills.probe(g, SKILL_NAME, "What is the build id written in references/build.md? "
                                                      "Answer with the id only.", info["build_id"])
    finally:
        g.close()
    return {k: result[k] for k in ("name", "mode", "active", "verified", "probe") if k in result}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="python -m comms.skill_build")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--deploy", action="store_true", help="also upload it to Gemini and probe the build id")
    args = parser.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass
    info = build(args.out)
    print(json.dumps(info, indent=1))
    if args.deploy:
        print(json.dumps(deploy(info), ensure_ascii=False, indent=1)[:3000])
    return 0


if __name__ == "__main__":
    sys.exit(main())
