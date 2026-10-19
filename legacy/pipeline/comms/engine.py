"""The communication engine: one case in, one checked proposal out.

    from comms.engine import propose
    result = propose(gemini, case)        # gemini: gemini_bridge.client.Gemini

A case is a dict (see CASE_FIELDS): who the other side is, the stage, the thread so far, the facts we hold,
the agency's true claims, what the agency wants now. The engine

  1. answers the replies that need no judgment itself (bounce, unsubscribe, out-of-office): honest,
     deterministic, no Gemini call;
  2. otherwise asks Gemini through the `gratovo-comms` skill (picked from the @ list, chat mode) for the
     skill's JSON answer;
  3. runs the deterministic checks (checks.py); blocking findings go back to Gemini in the same chat for
     up to `repair_rounds` fixes;
  4. adds the gates a person must confirm (money, terms, claims, ethics) and returns a status:
     `ready` (approve and send), `needs_human` (a decision or fact is needed), `blocked` (checks still
     fail after repair: do not show as sendable), `no_message` (wait, close, schedule).

Nothing is ever sent from here: every outgoing message waits for a person (owner's decision, 2026-10-14).
"""

from __future__ import annotations

import json
import re
import time
import uuid
from datetime import date, datetime, timedelta
from functools import lru_cache
from typing import Any, Optional

from . import checks

SKILL = "gratovo-comms"
# recent_messages sits before the thread: the pool tells prompts apart by their end (comms/pool.py fingerprint).
CASE_FIELDS = ("side", "stage", "goal", "channel", "counterpart", "agency", "recent_messages", "overused_phrases", "facts",
               "thread", "house_choices", "employee_note")
STATUSES = ("ready", "needs_human", "blocked", "no_message")

PROMPT = """Use the gratovo-comms skill for this case: follow its procedure, read the reference files for this side and stage, respect every hard limit, and answer ONLY with the skill's JSON answer format.{overused}

CASE:
```json
{case}
```"""

REPAIR = """Your answer failed these checks (playbook rule ids in brackets):
{findings}

Fix every one of them without inventing anything new, keep what was right, and answer again with the complete JSON object only."""

JSON_ONLY = "Answer again with ONLY the JSON object of the skill's answer format, in one code block."

ACTIONS = ("send_message", "ask_user", "wait", "close_won", "close_lost", "schedule_follow_up", "escalate")

# Spelled out, because an answer in another shape usually means the skill was not read (2026-10-16, inf-price-us-1:
# {"decision": "reply", "reply": {...}} was filed as 'no message' and the draft was lost).
FORMAT = """Your answer is not in the required format: {problems}

Answer again with ONLY this JSON object, in one code block, keeping your decision and your draft:
{{"situation": {{"side": "influencer|manager|brand", "stage": "...", "reply_type": "... or null", "summary": "one sentence"}},
 "decision": {{"action": "send_message|ask_user|wait|close_won|close_lost|schedule_follow_up|escalate", "why": "...", "rules": ["RULE-ID"]}},
 "message": {{"channel": "email|dm", "subject": "... or null", "body": "plain text"}} or null,
 "needs_human": [{{"what": "price|terms|claim|ethics|fact_missing|other", "detail": "..."}}],
 "follow_up": {{"in_working_days": 0, "note": "... or null"}},
 "facts_used": ["..."]}}"""


@lru_cache(maxsize=1)
def _reply_ids() -> dict:
    """{side: (reply type ids)} from the situations map; 'any' types belong to every side."""
    from . import playbook
    replies = playbook.situations().get("replies") or {}
    shared = tuple(r["id"] for r in replies.get("any") or [])
    return {side: tuple(r["id"] for r in items) + shared for side, items in replies.items()}


def shape_problems(data: dict) -> list[str]:
    """What keeps a parsed answer from being the skill's answer format (empty when it is). The reply type must be an
    id of the situations map (2026-10-16, run-02 examples: "budget_inquiry", "rate_quote", "positive" in place of
    the ids, and with them the reply type's key rules and three gates were missed)."""
    out = []
    if not isinstance(data.get("situation"), dict):
        out.append("'situation' must be an object")
    else:
        rt = data["situation"].get("reply_type")
        ids = _reply_ids()
        known = {i for side in ids.values() for i in side}
        if rt is not None and known and rt not in known:
            side = str(data["situation"].get("side") or "")
            own = ids.get("brand" if side == "brand" else "influencer", tuple(sorted(known)))
            out.append(f"situation.reply_type {rt!r} is not an id from references/situations.md; use one of "
                       f"{', '.join(own)}, or null for a first message")
    decision = data.get("decision")
    if not isinstance(decision, dict):
        out.append("'decision' must be an object with 'action', 'why' and 'rules'")
    elif decision.get("action") not in ACTIONS:
        out.append(f"decision.action {decision.get('action')!r} is not one of {', '.join(ACTIONS)}")
    if "message" not in data:
        out.append("'message' is missing (null when nothing should be sent now)")
    elif data["message"] is not None and (not isinstance(data["message"], dict) or not str(data["message"].get("body") or "").strip()):
        out.append("'message' must be null or an object with 'channel', 'subject' and 'body'")
    elif isinstance(decision, dict) and decision.get("action") == "send_message" and not data["message"]:
        out.append("decision.action is send_message but 'message' is null")
    if not isinstance(data.get("needs_human", []), list):
        out.append("'needs_human' must be a list")
    if data.get("follow_up") is not None and not isinstance(data.get("follow_up"), dict):
        out.append("'follow_up' must be an object or null")
    return out

BOUNCE = re.compile(r"(delivery (status notification|has failed|failed)|undeliverable|address not found|mailer-daemon|"
                    r"recipient address rejected|does not exist|couldn'?t be delivered)", re.I)
UNSUBSCRIBE = re.compile(r"\b(unsubscribe|remove me|stop (emailing|messaging|contacting)|do not contact|don'?t contact)\b", re.I)
OUT_OF_OFFICE = re.compile(r"\b(out of (the )?office|automatic reply|auto-?reply|on (annual )?leave|away until|on vacation|"
                           r"limited access to (my )?email|currently traveling)\b", re.I)
DATE = re.compile(r"\b(?:until|returning|back on|back in the office on|return on)\s+([A-Za-z]+\.? \d{1,2}(?:st|nd|rd|th)?|\d{1,2}(?:st|nd|rd|th)? [A-Za-z]+|\d{1,2}/\d{1,2}(?:/\d{2,4})?)", re.I)


def _back_on(found: str, today: date) -> Optional[date]:
    """The return date an auto-reply names ("October 21", "21st Oct", "10/21"), in the year that puts it after today."""
    text = re.sub(r"(\d)(st|nd|rd|th)\b", r"\1", found.replace(".", "")).strip()
    for fmt in ("%m/%d/%Y", "%m/%d/%y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            pass
    for year in (today.year, today.year + 1):   # the year is given to strptime: parsing without one is deprecated
        for fmt in ("%B %d", "%b %d", "%d %B", "%d %b", "%m/%d"):
            try:
                back = datetime.strptime(f"{text} {year}", f"{fmt} %Y").date()
            except ValueError:
                continue
            if back >= today:
                return back
            break
    return None


def _working_days(start: date, end: date) -> int:
    """Working days after `start` up to and including `end`."""
    days, d = 0, start
    while d < end:
        d += timedelta(days=1)
        days += d.weekday() < 5
    return days


def _today(case: dict) -> date:
    """The case's today (facts.today), else the real one."""
    try:
        return date.fromisoformat(str((case.get("facts") or {}).get("today")))
    except ValueError:
        return date.today()


def _last_inbound(case: dict) -> Optional[dict]:
    thread = case.get("thread") or []
    return thread[-1] if thread and thread[-1].get("from") == "them" else None


def quick_path(case: dict) -> Optional[dict]:
    """Bounce, unsubscribe and out-of-office need no drafting: the right move is fixed."""
    msg = _last_inbound(case)
    if not msg:
        return None
    text = f"{msg.get('subject') or ''}\n{msg.get('body') or ''}"
    if BOUNCE.search(text):
        decision = {"action": "close_lost", "why": "The address bounced; stop and find another contact (FND-DLV-06).", "rules": ["FND-DLV-06"]}
        reply_type, follow = "any.bounce", None
        human = [{"what": "fact_missing", "detail": "find a working address for this contact"}]
    elif UNSUBSCRIBE.search(text):
        decision = {"action": "close_lost", "why": "They asked not to be contacted; stop all messages.", "rules": ["FND-MIND-04"]}
        reply_type, follow, human = "any.unsubscribe", None, []
    elif OUT_OF_OFFICE.search(text):
        # FND-WRITE-05: they get their first working day back as a real window, the follow-up comes the day after.
        # No return date: a working week, then look again.
        found = DATE.search(text)
        today = _today(case)
        back = _back_on(found.group(1), today) if found else None
        if back:
            first_day = back
            while first_day.weekday() >= 5:
                first_day += timedelta(days=1)
            days = _working_days(today, first_day) + 1
            note = f"follow up after they are back ({found.group(1)}), once they have had a working day"
        else:
            days, note = 5, "no return date given: follow up in a working week"
        decision = {"action": "schedule_follow_up", "why": "Auto-reply: wait until they are back, then follow up with a real working day in between (FND-WRITE-05).", "rules": ["FND-WRITE-05"]}
        reply_type, follow, human = "any.out_of_office", {"in_working_days": days, "note": note}, []
    else:
        return None
    proposal = {"situation": {"side": case.get("side"), "stage": case.get("stage"), "reply_type": reply_type,
                              "summary": decision["why"]},
                "decision": decision, "message": None, "needs_human": human, "follow_up": follow, "facts_used": []}
    return {"proposal": proposal, "findings": [], "gates": human, "rounds": 0, "status": "no_message" if not human else "needs_human",
            "quick": reply_type, "raw": []}


EXAMPLES = """HOW COACHES ANSWERED SITUATIONS LIKE THIS ONE (from the coaching calls; the emails and the coaches' versions are reconstructions of what was said: learn the move, never copy the words; where one differs from the playbook, the playbook wins):
{examples}

"""

WRITE = """Now write the message the way an experienced graduate of the course writes it by hand. Keep your decision, needs_human, follow_up and facts as they are, except where a key rule below changes them.
- Answer what they asked first. About {target} words (their message has {theirs}); one ask, at the end.
- Plain words and short sentences. Nothing they did not ask for: no explanation of how we work, no reassurance, no disclaimer about what has not happened yet, no description of a brand they can look up, no list of their own videos.
- Not like any of the agency's recent messages in the case: a different opening, frame and sentences, and none of its overused_phrases.
- Keep every number, name and claim inside the case facts.
{keys}{examples}
Answer with the complete JSON object only, in one code block."""

REVISE = """A coach of the course reviewed the answer below and judged its message "{verdict}". The coach's points (playbook rule ids):
{points}

THE ANSWER:
```json
{answer}
```

Rewrite the message so that every point that is right for this CASE is addressed. Keep the action, keep every number, name and claim inside the CASE facts, and answer with the complete JSON object only, in one code block."""

# A graduate remembers some of the course; the engine can look up all of it (plan §7b, machine tier): the rules the
# situations map names for the reply type go in front of the writer, word for word, so none is left to recall.
KEYS = """
THE PLAYBOOK'S KEY RULES FOR {reply_type} (looked up for you; check each one against your answer):
{rules}
Where one fits this case and your answer does not follow it yet, follow it now, in the message and, if the rule is about them, in decision, needs_human or follow_up. Skip one that does not fit this case. Put the ones you followed in decision.rules.
"""

VARIANTS = ("base", "examples", "write", "auto")
# run-03 (2026-10-17, judged pairwise in both orders): write won first emails 7-1, base won replies 7-4. "auto" takes
# write for a first message (no thread yet) and base for the rest. The owner made it the default on 2026-10-18.

# A no is not forever (INF-FU-06: write again a few months later; BRD-OBJ-23: we get back to them, they rarely come
# back). The reconnect goes in the calendar, never only in a note someone must remember (plan §7b machine tier;
# run-01: brd-no-1 and inf-notinterested-1 said "reconnect in a future quarter" with no date).
RECONNECT = ("brd.no", "brd.paused", "inf.not_interested", "inf.later")
RECONNECT_DAYS = 60   # "a few months", in working days; a date they named, set by the model, is kept
# A no is not chased (BRD-FU-05: after a no, stay in touch): a follow-up sooner than this is moved to the reconnect,
# unless they named the time themselves (run-03, 2026-10-17: "Not interested at this time" got a follow-up in 3 days).
RECONNECT_MIN = 20


MONTHS = ("january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november",
          "december")
_COUNT = {"a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "six": 6}


def _named_start(text: str, today: date) -> Optional[date]:
    """The first working day of the time their message names: a month ("in November"), "next year", "after Q4",
    "next week", "next month", "in two weeks" or "in a few months"."""
    low = text.lower()
    found = [(low.find(m), i + 1) for i, m in enumerate(MONTHS) if re.search(rf"\b{m}\b", low)]
    span = re.search(r"\bin (a|an|one|two|three|four|six|\d+|a few|a couple of) (week|month)s?\b", low)
    if found:
        month = min(found)[1]
        start = date(today.year + (month <= today.month), month, 1)
    elif re.search(r"\bnext year\b|\bafter (the )?q4\b|\bin (the )?new year\b", low):
        start = date(today.year + 1, 1, 1)
    elif re.search(r"\bnext week\b", low):
        start = today + timedelta(days=7)
    elif re.search(r"\bnext month\b", low):
        start = date(today.year + (today.month == 12), today.month % 12 + 1, 1)
    elif span:
        n = {"a few": 3, "a couple of": 2}.get(span.group(1)) or _COUNT.get(span.group(1)) or int(span.group(1))
        start = today + timedelta(days=(7 if span.group(2) == "week" else 30) * n)
    else:
        return None
    while start.weekday() >= 5:
        start += timedelta(days=1)
    return start


def reconnect(data: dict, case: Optional[dict] = None) -> dict:
    situation = data.get("situation") if isinstance(data.get("situation"), dict) else {}
    fu = data.get("follow_up") if isinstance(data.get("follow_up"), dict) else {}
    days = fu.get("in_working_days")
    if situation.get("reply_type") not in RECONNECT:
        return data
    last = _last_inbound(case or {})
    today = _today(case or {})
    start = _named_start(str((last or {}).get("body") or ""), today) if last else None
    dated = isinstance(days, (int, float)) and days > 0
    if dated and (start or days >= RECONNECT_MIN):
        return data   # the model's date for a time they named, or a reconnect a month or more out, is kept
    wanted = max(1, _working_days(today, start)) if start else RECONNECT_DAYS
    note = str(fu.get("note") or "").strip()
    why = "Reconnect with something new and true (INF-FU-06, BRD-OBJ-23)."
    if dated:
        why = f"Moved from {days} working days: a no is not chased (BRD-FU-05). " + why
    return dict(data, follow_up=dict(fu, in_working_days=wanted, set_by="engine", note=(note + " " if note else "") + why))


def target_words(case: dict) -> tuple[int, int]:
    """(about how long our message should be, how long theirs was): a first email 50-70 words (FND-FMT-02); a reply
    in proportion to what it answers, never paragraphs back to a line (FND-WRITE-25)."""
    thread = case.get("thread") or []
    theirs = next((m.get("body") for m in reversed(thread) if m.get("from") == "them"), None)
    if theirs is None:
        return 60, 0
    n = len(str(theirs).split())
    return max(35, min(130, 30 + 2 * n)), n


@lru_cache(maxsize=1)
def _rules_by_id() -> dict:
    from . import playbook
    return {r.id: r for r in playbook.rules()}


def key_rules_text(reply_type: Optional[str]) -> str:
    """The KEYS block for a reply type: each key rule's title, rule, do and don't ("" when the map names none)."""
    from . import playbook
    found = [_rules_by_id()[i] for i in playbook.key_rules(reply_type) if i in _rules_by_id()]
    if not found:
        return ""
    lines = []
    for r in found:
        lines.append(f"- {r.id} ({r.level}) {r.title}: {r.rule}")
        lines += [f"    do: {d}" for d in r.do] + [f"    don't: {d}" for d in r.dont]
    return KEYS.format(reply_type=reply_type, rules="\n".join(lines))


def case_prompt(case: dict, examples: str = "") -> str:
    clean = {k: case[k] for k in CASE_FIELDS if k in case and case[k] not in (None, "", [], {})}
    overused = (" The CASE's overused_phrases are wording the agency's recent messages keep repeating: use none of them, "
                "say the same thing in other words (FND-WRITE-03).") if clean.get("overused_phrases") else ""
    return (EXAMPLES.format(examples=examples) if examples else "") + PROMPT.format(
        case=json.dumps(clean, ensure_ascii=False, indent=1), overused=overused)


def _parse(text: str) -> Optional[dict]:
    from gemini_bridge.actions import extract_json  # late: keeps this module importable without the bridge path
    data = extract_json(text or "", strict=False)
    if isinstance(data, dict) and "decision" in data:
        return data
    return None


def _ours(gemini, tab_id: Optional[int], ref: str) -> bool:
    """The tab's last prompt ends with this call's ref, and an answer follows it."""
    params = {"tabId": tab_id} if tab_id is not None else {}
    convo = gemini.call("get_conversation", params, timeout=30)
    turns = [t for t in convo or [] if isinstance(t, dict)]
    users = [i for i, t in enumerate(turns) if t.get("role") == "user"]
    if not users or not any(t.get("role") == "model" for t in turns[users[-1] + 1:]):
        return False
    return ref in " ".join(str(turns[users[-1]].get("text") or "").split())[-200:]


GENERIC_ERROR = re.compile(r"something went wrong|an error occurred|حدث خطأ", re.I)
EMPTY_ANSWER = re.compile(r"(skills?:\s*[\w ,-]*)?", re.I)


def _send(gemini, text: str, *, new_chat: bool, skill: Optional[str], mode: str, tab_id: Optional[int], timeout_s: int,
          thinking: str = "high", ref: Optional[str] = None, _retried: bool = False) -> dict:
    base_text = text
    # Every prompt ends with the call's ref, and the answer only counts when the tab's last prompt is that one.
    # 2026-10-16 (run-01): a send reported as refused had gone through, and the next case's send on that tab got its
    # answer back. Three first emails were filed under other people (Kalshi held the Wispr Flow pitch to Maya).
    if ref:
        text = f"{text}\n\n(case ref {ref})"
    # The level is set and read back on every send (it resets on a new tab or reload); no confirmation, no answer.
    params: dict[str, Any] = {"text": text, "wait": True, "newChat": new_chat, "timeoutMs": timeout_s * 1000,
                              "thinking": thinking}
    if skill:
        params["skills"] = [skill]
    if mode:
        params["mode"] = mode
    if tab_id is not None:
        params["tabId"] = tab_id
    r = gemini.call("send", params, timeout=timeout_s + 60)
    if not r.get("thinking"):
        from gemini_bridge.errors import ThinkingNotSet
        raise ThinkingNotSet(message="the add-on did not confirm the thinking level")
    if ref and not _ours(gemini, tab_id, ref):
        from gemini_bridge.errors import GeminiError
        raise GeminiError("WRONG_CHAT", f"the answer on the tab does not follow the prompt with case ref {ref}")
    # 2026-10-16: nine answers came back as nothing, as the skill header alone ("Skills: gratovo-comms") or as
    # "Sorry, something went wrong": the prompt never reached the model, and asking it to "answer again" in that chat got
    # "no details are available in this session". An error answer is raised for the pool (its throttle rule counts it);
    # an empty first answer is the send failing, so the prompt is sent again once in a fresh chat.
    answer = str(r.get("textRaw") or r.get("text") or "").strip()
    if len(answer) < 300 and GENERIC_ERROR.search(answer):
        from gemini_bridge.errors import GeminiError
        raise GeminiError("GEMINI_ERROR", answer)
    if new_chat and not _retried and EMPTY_ANSWER.fullmatch(answer):
        return _send(gemini, base_text, new_chat=True, skill=skill, mode=mode, tab_id=tab_id, timeout_s=timeout_s,
                     thinking=thinking, ref=ref, _retried=True)
    return r


def _merged(data: dict, rewritten: Optional[dict]) -> Optional[dict]:
    """A rewrite merged onto the first pass (_keep_decision), or None when it carries no message or the merge is not
    in the answer format. Checked after the merge: the situation is the first pass's, so a rewrite that relabels it
    is not lost for that."""
    if not isinstance(rewritten, dict) or not isinstance(rewritten.get("message"), dict)             or not isinstance(rewritten.get("decision"), dict):
        return None
    merged = _keep_decision(data, rewritten)
    return None if shape_problems(merged) else merged


def _keep_decision(data: dict, rewritten: dict) -> dict:
    """A rewrite (the write pass, a coach revision) keeps the first pass's situation and action; it may add gates,
    change the follow-up and add rule ids."""
    ids = lambda d: [x for x in d.get("rules") or [] if isinstance(x, str)] if isinstance(d.get("rules"), list) else []
    decision = dict(data["decision"], rules=list(dict.fromkeys(ids(data["decision"]) + ids(rewritten["decision"]))))
    return dict(rewritten, situation=data["situation"], decision=decision)


def propose(gemini, case: dict, *, skill: str = SKILL, mode: str = "chat", repair_rounds: int = 2,
            tab_id: Optional[int] = None, timeout_s: int = 300, thinking: str = "high", variant: str = "auto",
            coach_rounds: int = 0) -> dict:
    """`variant` (plan §7b, compared on the scenario suite): "base" one prompt; "examples" the same prompt with the
    example-bank entries closest to the case; "write" those examples plus a second pass in the same chat that
    rewrites the message (decide, then write) with the reply type's key rules in front of it; "auto" write for a
    first message, base otherwise. `coach_rounds` (plan §7b step 4): up to that many coach reviews, each followed by
    one rewrite when the verdict is not "good"."""
    if variant not in VARIANTS:
        raise ValueError(f"variant {variant!r} is not one of {VARIANTS}")
    refused = checks.policy_findings(case)
    if refused:
        return {"proposal": None, "findings": refused, "gates": [], "rounds": 0, "status": "blocked", "raw": [],
                "seconds": 0}
    if variant == "auto":
        variant = "base" if case.get("thread") else "write"
    quick = quick_path(case)
    if quick:
        return quick
    raw: list[str] = []
    t0 = time.time()
    ref = uuid.uuid4().hex[:10]
    shown = ""
    if variant in ("examples", "write"):
        from . import example_bank   # late: the bank is only read when asked for
        shown = example_bank.render(example_bank.for_case(case))
    rounds = 0
    level: dict = {}

    def ask(ref: str) -> Optional[dict]:
        """The case in a fresh chat, then (in that chat) the JSON alone, then the format spelled out."""
        nonlocal rounds, level
        r = _send(gemini, case_prompt(case, shown if variant == "examples" else ""), new_chat=True, skill=skill, mode=mode,
                  tab_id=tab_id, timeout_s=timeout_s, thinking=thinking, ref=ref)
        level = {"model": r.get("model"), "thinking": r.get("thinking")}
        text = str(r.get("textRaw") or r.get("text") or "")
        raw.append(text)
        data = _parse(text)
        rounds += 1
        if data is None:
            r = _send(gemini, JSON_ONLY, new_chat=False, skill=None, mode="", tab_id=tab_id, timeout_s=timeout_s, thinking=thinking, ref=ref)
            text = str(r.get("textRaw") or r.get("text") or "")
            raw.append(text)
            data = _parse(text)
            rounds += 1
        if data is not None and shape_problems(data):
            r = _send(gemini, FORMAT.format(problems="; ".join(shape_problems(data))), new_chat=False, skill=None, mode="",
                      tab_id=tab_id, timeout_s=timeout_s, thinking=thinking, ref=ref)
            text = str(r.get("textRaw") or r.get("text") or "")
            raw.append(text)
            data = _parse(text)
            rounds += 1
        return data

    data = ask(ref)
    # A chat that answered in another shape tends to repeat it (2026-10-17, run-03 inf-first-iswaryaagp: a bare
    # {subject, body} twice, the format spelled out between): the case is asked once more in a fresh chat.
    if data is None or shape_problems(data):
        ref = uuid.uuid4().hex[:10]
        data = ask(ref)
    if data is None or shape_problems(data):
        detail = "Gemini did not return the answer format" + (f": {'; '.join(shape_problems(data))}" if data else "")
        return {"proposal": data, "findings": [{"code": "UNPARSED", "severity": "block", "rule": "-", "detail": detail}],
                "gates": [], "rounds": rounds, "status": "blocked", "raw": raw, "seconds": round(time.time() - t0), **level}
    first_draft = None
    if variant == "write" and isinstance(data.get("message"), dict):
        target, theirs = target_words(case)
        r = _send(gemini, WRITE.format(target=target, theirs=theirs,
                                       keys=key_rules_text(data["situation"].get("reply_type")),
                                       examples=("\n" + EXAMPLES.format(examples=shown).rstrip()) if shown else ""),
                  new_chat=False, skill=None, mode="", tab_id=tab_id, timeout_s=timeout_s, thinking=thinking, ref=ref)
        text = str(r.get("textRaw") or r.get("text") or "")
        raw.append(text)
        rounds += 1
        written = _merged(data, _parse(text))
        if written is not None:
            first_draft = data["message"]
            data = written
    def repair(data: dict) -> tuple:
        """Blocking findings go back to Gemini in the current chat, up to `repair_rounds` times."""
        nonlocal rounds
        findings, used = checks.check(case, data), 0
        while checks.blocking(findings) and used < repair_rounds:
            r = _send(gemini, REPAIR.format(findings=checks.describe(checks.blocking(findings))), new_chat=False, skill=None,
                      mode="", tab_id=tab_id, timeout_s=timeout_s, thinking=thinking, ref=ref)
            text = str(r.get("textRaw") or r.get("text") or "")
            raw.append(text)
            fixed = _parse(text)
            used += 1
            rounds += 1
            if fixed is not None and not shape_problems(fixed):
                data = fixed
                findings = checks.check(case, data)
        return data, findings, used

    data, findings, repairs = repair(data)
    # Plan §7b step 4: the coach reviews a draft that passes the checks, in a fresh chat; when the verdict is not
    # "good", the draft is rewritten once against the coach's points, in another fresh chat with the whole case.
    reviews, before_coach = [], None
    for _ in range(coach_rounds):
        msg = data.get("message")
        if not isinstance(msg, dict) or checks.blocking(findings):
            break
        from . import coach   # late: coach imports this module
        draft = (f"Subject: {msg['subject']}\n\n" if msg.get("subject") else "") + str(msg.get("body") or "")
        rv = coach.review(gemini, case.get("side") or "", case.get("stage") or "", coach.situation_of(case), draft,
                          skill=skill, mode=mode, tab_id=tab_id, timeout_s=timeout_s, thinking=thinking)
        rounds += len(rv.get("raw") or [])
        review = rv.get("review")
        reviews.append(review)
        if not review or review.get("verdict") == "good":
            break
        points = "\n".join(f"- [{p.get('rule')}] {p.get('problem')} -> {p.get('fix')}" for p in review.get("points") or [])
        r = _send(gemini, case_prompt(case, shown if variant == "examples" else "") + "\n\n" +
                  REVISE.format(verdict=review.get("verdict"), points=points or "-",
                                answer=json.dumps(data, ensure_ascii=False, indent=1)),
                  new_chat=True, skill=skill, mode=mode, tab_id=tab_id, timeout_s=timeout_s, thinking=thinking, ref=ref)
        text = str(r.get("textRaw") or r.get("text") or "")
        raw.append(text)
        rounds += 1
        revised = _merged(data, _parse(text))
        if revised is None:
            break
        before_coach = before_coach or msg
        data, findings, used = repair(revised)
        repairs += used
    data = reconnect(data, case)
    gates = checks.gates(case, data)
    if checks.blocking(findings):
        status = "blocked"
    elif not data.get("message"):
        status = "needs_human" if gates else "no_message"
    elif gates:
        status = "needs_human"
    else:
        status = "ready"
    return {"proposal": data, "findings": findings, "gates": gates, "rounds": rounds, "repairs": repairs, "status": status,
            "raw": raw, "seconds": round(time.time() - t0), "variant": variant, "first_draft": first_draft,
            "coach": reviews, "before_coach": before_coach, **level}
