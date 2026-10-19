"""Deterministic checks on a proposed message, and the gates that need a person.

`check(case, proposal)` returns findings `{code, severity, rule, detail}`: `block` findings must be fixed
before the message is shown as ready (the engine asks Gemini to repair them), `warn` findings are shown to
the person approving. `gates(case, proposal)` returns what a person must confirm whatever the wording
(money, contract terms, claims about the agency, ethics), merged with the gates the model raised.

Everything here comes from playbook rules (ids in each finding); nothing is a matter of taste.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable, Optional

from . import course, playbook

# Only the course's own list (1.6 Email Deliverability Training, FND-WRITE-12): spam magnets and hype language.
SPAM_WORDS = ["offer", "guarantee", "guaranteed", "opportunity", "opportunities", "revenue", "grow your brand",
              "we help influencers", "scale", "grow fast"]
# The course's bad examples (1.2 How to Write a Cold Email; BRD-FIRST-03 "just reaching out").
OPENERS = [r"hope (this|my) (e-?mail|message) finds you", r"my name is",
           r"i run an? (influencer )?(marketing )?agency", r"just reaching out"]
FAN = [r"\b(huge|big|massive) fan\b", r"\blove (your|ur) (content|channel|videos)\b", r"\byou('| a)re (amazing|incredible|awesome)\b",
       r"\bobsessed with\b", r"\bbiggest fan\b"]
NEEDY = [r"\bwe (really )?need this\b", r"\bplease consider\b", r"\bi('d| would) be (so )?grateful\b", r"\bbeg\b",
         r"\bany chance at all\b", r"\bi know you('| a)re (super )?busy\b", r"\bsorry (to bother|for bothering)\b"]
CLAIMS = [r"\bwe('ve| have) worked with\b", r"\bour (clients|partners|roster)\b", r"\bcase stud(y|ies)\b", r"\bwe (manage|represent)\b",
          r"\bwe('ve| have) (helped|closed|secured)\b", r"\bresults? (we|our)\b", r"\bguarantee\b", r"\btrack record\b",
          r"\bwe('re| are) (already )?working with\b", r"\bfilling up fast\b", r"\blimited (slots|spots)\b"]
TERMS = [r"\bcontract\b", r"\bagreement\b", r"\bexclusiv", r"\busage rights\b", r"\bupfront\b", r"\bnet ?\d+\b", r"\binvoice\b",
         r"\bterms\b", r"\bwhitelist"]
HARAM_HINTS = ["alcohol", "beer", "wine", "vodka", "casino", "gambling", "betting", "bet ", "poker", "lottery", "pork", "cannabis",
               "weed", "vape", "dating", "loan", "interest rate", "credit card", "forex", "margin trading", "music instrument",
               "guitar", "piano", "nightclub",
               # betting that does not call itself betting (run-01, 2026-10-16: Kalshi, "contracts that pay out on the
               # outcome of real events such as elections, sports results", raised no gate)
               "prediction market", "pay out on the outcome", "pays out on the outcome", "event contract", "wager",
               "sportsbook", "sports book", "parlay", "betting odds"]
# Subject lines and lines the coaches say are now overused course examples (FND-SUBJ-01, FND-WRITE-15, FND-MIND-22).
SUBJECT_COURSE = re.compile(r"(partnership|sponsorship|collaboration) (opportunit|request|inquir)|^quick question\W*$", re.I)
COURSE_PHRASES = ["would be killers", "enjoy taking tips", "just checking if you had a chance", "in case they are a better contact",
                  "wanted to loop you in", "your last video wasn't sponsored", "your last video was not sponsored"]
FAKE_REPLY = re.compile(r"^\s*(re|fwd?)\s*:", re.I)
LINK = re.compile(r"(https?://|www\.)\S+", re.I)
MARKDOWN = re.compile(r"(\*\*|__|^#+\s|^\s*[-*]\s|\[[^\]]+\]\([^)]+\))", re.M)
MONEY = re.compile(r"(\$\s?\d|\d\s?(usd|dollars|bucks|grand)\b|€\s?\d|£\s?\d)", re.I)
# "5k" and "20%" are money only where money is the subject: "61k median views" and "41% of your viewers in the US"
# are audience facts, and so is a title like "ChatGPT settings 90% of people miss" (run-01: seven first emails got a
# price gate for a view count or a title, 2026-10-16).
# "220K+ views" is an audience too (gradbar-01, 2026-10-17: three false price gates): a "+" may follow the k.
KILO = re.compile(r"\b\d[\d.,]*\s?k\b(?!\+?\s+(?:[a-z-]+\s+){0,2}(?:views|subscribers|subs|followers|viewers|impressions|plays|"
                  r"watchers|people|likes|comments|clicks))", re.I)
PERCENT = re.compile(r"\b\d+(?:\.\d+)?\s?%")
AUDIENCE = re.compile(r"\b(views|viewers|subscribers|subs|followers|impressions|plays|watch(ers|ed)?|audience)\b", re.I)
MONEY_WORDS = re.compile(r"\b(code|commission|cut|fees?|upfront|up-front|deposit|discount|off|split|payout|pay|paid|payment|"
                         r"price|pricing|rates?|budget|cost|margin|take|keep|revenue|sales|cpm|bonus|affiliate|share|invoice)\b", re.I)


_UNITS = {w: i for i, w in enumerate("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen "
                                     "fifteen sixteen seventeen eighteen nineteen".split())}
_TENS = {w: 10 * (i + 2) for i, w in enumerate("twenty thirty forty fifty sixty seventy eighty ninety".split())}
_SCALES = {"hundred": 100, "thousand": 1000, "million": 1_000_000}
_NUM_WORD = "|".join(list(_UNITS) + list(_TENS) + list(_SCALES))
_SPELLED = re.compile(rf"\b(?:a|{_NUM_WORD})(?:[\s-]+(?:and[\s-]+)?(?:{_NUM_WORD}))*\b(?=(\s+(?:dollars|usd|bucks|grand)\b)?)", re.I)


def spell_out(text: str) -> str:
    """`text` with amounts written in words turned to digits ("three thousand USD" -> "3,000 USD"): only phrases with a
    scale word (hundred, thousand, million) or followed by a currency word, so "two brands" stays as it is."""
    def value(words: list) -> int:
        total = current = 0
        for w in words:
            if w in _UNITS:
                current += _UNITS[w]
            elif w in _TENS:
                current += _TENS[w]
            elif w == "a":
                current += 1
            elif w == "hundred":
                current = max(current, 1) * 100
            elif w in _SCALES:
                total += max(current, 1) * _SCALES[w]
                current = 0
        return total + current

    def swap(m: re.Match) -> str:
        words = [w for w in re.split(r"[\s-]+", m.group(0).lower()) if w and w != "and"]
        if not (set(words) & set(_SCALES)) and not m.group(1):
            return m.group(0)
        if words == ["a"] or (words[0] == "a" and len(words) == 1):
            return m.group(0)
        return f"{value(words):,}"
    return _SPELLED.sub(swap, text)


def money(text: str) -> Optional[str]:
    """The first amount of money the text names: a currency amount, a 'k' figure that is not a count of views or
    people, or a percentage in a sentence about money, amounts written in words included. None for none."""
    text = spell_out(text)
    m = MONEY.search(text)
    if m:
        return m.group(0)

    def sentence(m: re.Match) -> str:
        start = max(text.rfind(c, 0, m.start()) for c in ".!?\n") + 1
        ends = [i for i in (text.find(c, m.end()) for c in ".!?\n") if i >= 0]
        return text[start:min(ends) if ends else len(text)]

    for m in KILO.finditer(text):
        # "hit 850k views, past your usual 590k": the second figure is views too (run-02 base, 2026-10-16). Only a
        # figure right after "usual/average/median/typical" in a sentence about views is let off: "2.5k per video"
        # next to "63k viewers" is still a price, and a missed price gate is worse than a needless one.
        s = sentence(m)
        compared = re.search(r"\b(usual|average|median|typical|normal)\s+(?:of\s+)?(?:about\s+|around\s+)?$",
                             text[max(0, m.start() - 30):m.start()], re.I)
        if not (compared and AUDIENCE.search(s) and not MONEY_WORDS.search(s)):
            return m.group(0)
    for m in PERCENT.finditer(text):
        if MONEY_WORDS.search(sentence(m)):
            return m.group(0)
    return None
NUMBER = re.compile(r"\b\d[\d,.]*\s?(k|m|%)?\b", re.I)
# The length of a sponsored segment ("a 60-90 second integration") is a format we propose, from the playbook
# (INF-PRICE-09, BRD-OFFER), not a fact about anyone: it never has to be in the case (2026-10-16, a creator who
# asked "make me an offer" was asked their rate for a 60-90 second integration and the check blocked it).
_DELIVERABLE = r"(?:integrations?|segments?|mentions?|spots?|ads?|reads?|placements?|slots?|shout-?outs?|plugs?)"
_SECONDS = r"(\d{1,3})(?:\s?(?:-|–|to)\s?(\d{1,3}))?[\s-]?(?:seconds?|secs?)\b"
SEGMENT_SECONDS = re.compile(rf"\b{_SECONDS}[\s-]+(?:[a-z]+[\s-]+)?{_DELIVERABLE}\b|\b{_DELIVERABLE}\s+(?:of|at|around|about|lasting|that runs)\s+(?:about\s+|around\s+)?{_SECONDS}", re.I)
WORD = re.compile(r"[A-Za-z']+")


# A slot left for a person to fill: "[Your name]", "{creator_name}", "<Brand>". Words only (no digits), so "[2 min]"
# is not one; a markdown link's "[text](url)" is MARKDOWN's to flag, not this.
PLACEHOLDER = re.compile(r"\[[A-Za-z][A-Za-z _'/-]{0,40}\](?!\()|\{[A-Za-z_][A-Za-z_ ]{0,40}\}|<[A-Z][A-Za-z _]{0,40}>")


def placeholders(subject: str, body: str) -> list[dict]:
    """Unfilled placeholders in text about to be sent. The engine may leave one on purpose when a fact is missing
    and ask a person to fill it (a gate); at send time one left in is a block, never something a confirmation sends.
    `APP-SEND`: the app's own safeguard, not a course rule."""
    found = PLACEHOLDER.findall(f"{subject}\n{body}")
    return [_f("PLACEHOLDER", "block", "APP-SEND", f"fill in '{slot}' before sending") for slot in dict.fromkeys(found)]


def _f(code: str, severity: str, rule: str, detail: str) -> dict:
    return {"code": code, "severity": severity, "rule": rule, "detail": detail}


def _words(text: str) -> list[str]:
    return WORD.findall(text.lower())


def _shingles(text: str, n: int = 8) -> set:
    w = _words(text)
    return {" ".join(w[i:i + n]) for i in range(len(w) - n + 1)}


@lru_cache(maxsize=1)
def course_shingles() -> frozenset:
    """8-word sequences of the lessons, the lesson videos, the rules' quotes and the roast examples (the
    students' emails and the coaches' rewrites): a message may never reuse one (FND-WRITE-15)."""
    out: set = set()
    for lesson in course.lessons().values():
        out |= _shingles(lesson.text)
    for video in course.videos().values():
        out |= _shingles(video.text)
    for r in playbook.rules():
        for s in r.src:
            out |= _shingles(s.quote)
    for ex in playbook.examples():
        out |= _shingles(ex.get("student_email") or "") | _shingles(ex.get("rewrite") or "")
        out |= _shingles((ex.get("quote") or {}).get("quote") or "")
    return frozenset(out)


def _rounds_a_case_number(token: str, case_numbers: list) -> bool:
    """'63k' for 63,244 views is the fact, rounded the way people write it (FND-WRITE-07); within 6%."""
    t = token.lower().replace(",", "").replace(" ", "")
    if t[-1:] not in ("k", "m"):
        return False
    try:
        value = float(t[:-1]) * (1e3 if t[-1] == "k" else 1e6)
    except ValueError:
        return False
    return any(n and abs(value - n) <= 0.06 * n for n in case_numbers)


def _titles(node) -> list[str]:
    """Every video title in the case facts (any `recent_videos` list, at any depth)."""
    out: list[str] = []
    if isinstance(node, dict):
        for k, v in node.items():
            if k == "recent_videos" and isinstance(v, list):
                out += [str(t) for t in v if t and len(str(t)) >= 8]
            else:
                out += _titles(v)
    elif isinstance(node, list):
        for v in node:
            out += _titles(v)
    return out


def _case_text(case: dict) -> str:
    return json.dumps({k: v for k, v in case.items() if k != "thread"}, ensure_ascii=False).lower() + " " + \
        " ".join(str(m.get("body") or "") + " " + str(m.get("subject") or "") for m in case.get("thread") or []).lower()


def applies(case: dict, choice_id: str):
    """The option of a house choice that applies to this case: the case's own, else the owner's pick, else the default."""
    given = case.get("house_choices")
    if isinstance(given, dict) and given.get(choice_id):
        return given[choice_id]
    for c in playbook.house_choices():
        if c.get("id") == choice_id:
            return c.get("pick") or c.get("default")
    return None


def _first_contact(case: dict) -> bool:
    return not any(m.get("from") == "us" for m in case.get("thread") or []) and case.get("stage") in (None, "prospect", "contacted")


def _is_follow_up(case: dict) -> bool:
    thread = case.get("thread") or []
    return bool(thread) and thread[-1].get("from") == "us"


def check(case: dict, proposal: dict) -> list[dict]:
    msg = (proposal or {}).get("message") or None
    findings: list[dict] = []
    if not msg:
        return findings
    body = str(msg.get("body") or "")
    subject = str(msg.get("subject") or "")
    # A video title quoted from the case is the creator's words, not ours: "Why Is ChatGPT OBSESSED with Goblins?"
    # is neither fan language nor a second question (2026-10-16). Word and question checks read the text without them.
    own, own_subject = body, subject
    for title in sorted(_titles(case.get("facts")), key=len, reverse=True):
        own = re.sub(re.escape(title), " ", own, flags=re.I)
        own_subject = re.sub(re.escape(title), " ", own_subject, flags=re.I)
    low = own.lower()
    words = _words(body)
    first = _first_contact(case)
    # spam / hype words (subject included)
    for w in SPAM_WORDS:
        rx = r"\b" + re.escape(w) + r"\b" if w[0].isalnum() else re.escape(w)
        if re.search(rx, low) or re.search(rx, own_subject.lower()):
            findings.append(_f("SPAM_WORD", "block", "FND-WRITE-12", f"uses '{w}'"))
    for rx in OPENERS:
        if re.search(rx, low):
            findings.append(_f("OPENER", "block", "FND-WRITE-10", f"sender-centred opener matching /{rx}/"))
    for rx in FAN:
        if re.search(rx, low):
            findings.append(_f("FAN", "block", "FND-MIND-02", f"fan language /{rx}/"))
    for rx in NEEDY:
        if re.search(rx, low):
            findings.append(_f("NEEDY", "warn", "INF-NEG-07", f"needy phrasing /{rx}/"))
    if MARKDOWN.search(body):
        findings.append(_f("MARKDOWN", "block", "FND-WRITE-16", "markdown in a plain-text message"))
    if "\u2014" in body or "\u2014" in subject:
        findings.append(_f("EM_DASH", "block", "FND-FMT-04", "a long dash reads as AI-written; use a comma, a full stop or a hyphen"))
    if first and LINK.search(body):
        findings.append(_f("LINK_FIRST", "block", "FND-FMT-01", "a link in a first message"))
    if SUBJECT_COURSE.search(subject.strip()):
        findings.append(_f("SUBJECT_PATTERN", "block", "FND-SUBJ-01", f"subject '{subject}' is an overused course pattern"))
    if FAKE_REPLY.match(subject) and not any(m.get("subject") for m in case.get("thread") or []):
        findings.append(_f("FAKE_REPLY", "block", "FND-ETH-11", f"subject '{subject}' pretends to be a reply or a forward"))
    for phrase in COURSE_PHRASES:
        if phrase in low:
            findings.append(_f("COURSE_PHRASE", "block", "FND-WRITE-15", f"uses the course's overused line '{phrase}'"))
    # length and questions
    n = len(words)
    if first and n > 90:
        findings.append(_f("LENGTH", "block", "FND-FMT-02", f"first message has {n} words (aim 50-70, max ~90)"))
    elif _is_follow_up(case) and n > 70:
        findings.append(_f("LENGTH", "warn", "INF-FU-02", f"follow-up has {n} words; keep follow-ups short"))
    elif n > 220:
        findings.append(_f("LENGTH", "warn", "FND-WRITE-06", f"{n} words; replies should stay focused"))
    questions = own.count("?")
    if first and questions > 1:
        findings.append(_f("QUESTIONS", "block", "INF-FIRST-06", f"{questions} questions; one per email"))
    if first and applies(case, "HC-20") != "statement":
        last = [line for line in body.strip().splitlines() if line.strip() and not re.match(r"^(best|kind|thanks|regards|cheers|sincerely)\b", line.strip(), re.I) and len(line.split()) > 2]
        if last and "?" not in last[-1]:
            findings.append(_f("CTA", "block", "INF-FIRST-05", "the last line before the sign-off is not a question"))
    # Amounts written in words are read as digits, and are asked for in digits (2026-10-16, run-02 examples: a $3,000
    # quote blocked as "not in the facts" came back as "three thousand USD", past this check and the price gate).
    digits = spell_out(body)
    if spell_out(own) != own:   # titles quoted from the case are theirs ("One Hundred Days of Code")
        findings.append(_f("NUMBER_WORDS", "block", "FND-WRITE-11", "write amounts as digits ($3,000), not in words"))
    # facts: numbers and money must come from the case; a price we propose may be new, when the price gate is raised
    # for a person to confirm it (the skill's hard limit: write the proposed number and raise the gate)
    case_text = spell_out(_case_text(case))
    case_numbers = [float(x.replace(",", "")) for x in re.findall(r"\d[\d,]*(?:\.\d+)?", case_text)]
    priced = any(isinstance(g, dict) and g.get("what") == "price" for g in (proposal or {}).get("needs_human") or [])
    segment = [s.span() for s in SEGMENT_SECONDS.finditer(digits) if all(int(x) <= 180 for x in s.groups() if x and x.isdigit())]
    for m in NUMBER.finditer(digits):
        if any(a <= m.start() < b for a, b in segment):
            continue
        token = m.group(0).strip().lower().rstrip(".,")
        bare = token.replace(",", "")
        if bare.isdigit() and len(bare) <= 1:
            continue
        if priced and money(digits[max(0, m.start() - 2):m.end() + 9]):
            continue
        if token not in case_text and bare not in case_text.replace(",", "") and not _rounds_a_case_number(token, case_numbers):
            findings.append(_f("FACT_NUMBER", "block", "FND-ETH-01",
                               f"'{m.group(0).strip()}' is not in the case facts (a price you propose is allowed with "
                               "the price gate raised in needs_human)"))
    # copied course lines and repeats of our own earlier messages
    sh = _shingles(body)
    copied = sh & course_shingles()
    if copied:
        findings.append(_f("COPY_COURSE", "block", "FND-WRITE-15", f"reuses course wording: '{sorted(copied)[0]}'"))
    ours = " ".join(str(m.get("body") or "") for m in case.get("thread") or [] if m.get("from") == "us")
    repeat = sh & _shingles(ours)
    if repeat:
        findings.append(_f("REPEAT", "block", "FND-WRITE-14", f"repeats an earlier message: '{sorted(repeat)[0]}'"))
    # The agency's other recent messages (FND-WRITE-01): every first email in run-01 came out of one skeleton
    # ("we're onboarding creators for ... could be a good fit ... are you open to"), sharing 6-13 four-word runs
    # with each other where unrelated drafts share at most 4 (2026-10-16). Five shared runs with one message is a copy.
    mine = _shingles(_skeleton(own, case), 4)
    for prior in case.get("recent_messages") or []:
        same = mine & _shingles(_skeleton(str(prior), case), 4)
        if len(same) >= 5:
            findings.append(_f("TEMPLATED", "block", "FND-WRITE-01",
                               f"reads like a recent message of ours ({len(same)} shared phrases, e.g. '{sorted(same)[0]}'); "
                               "change the structure and the wording, not just the names"))
            break
    # Wording the agency's recent messages keep repeating (FND-WRITE-03): the pairwise check above misses a tic spread
    # thinly over many sends ("speaking of", "your content could be a good fit", "are you open to" in run-01's first
    # emails, 2026-10-16). One such phrase passes; two are a frame.
    tics = _tic_runs(own, case, _trigrams(case.get("overused_phrases") or []))
    if len(tics) >= 2:
        findings.append(_f("OVERUSED", "block", "FND-WRITE-03",
                           f"repeats wording our recent messages keep using: {', '.join(repr(t) for t in tics)}; "
                           "say the same thing in other words"))
    # The person greeted is the one the case is about, or someone who wrote in the thread (run-01, 2026-10-16: the
    # Matt Loui case came back greeting "Mo", another creator of the run).
    greeted = _greeted(body)
    if greeted and case.get("counterpart"):
        known = " ".join([json.dumps(case.get("counterpart"), ensure_ascii=False)] +
                         [str(m.get("body") or "") for m in case.get("thread") or [] if m.get("from") != "us"]).lower()
        if not all(w in known for w in greeted.lower().lstrip("@").split()):
            findings.append(_f("WRONG_PERSON", "block", "FND-ETH-01",
                               f"greets '{greeted}', who is not the person this case is about"))
    return findings


def _trigrams(phrases) -> set:
    out = set()
    for p in phrases:
        w = _words(str(p))
        out |= {" ".join(w[i:i + 3]) for i in range(len(w) - 2)}
    return out


def _tic_runs(text: str, case: dict, over: set) -> list[str]:
    """The stretches of `text` made of overused three-word runs, each as one phrase."""
    if not over:
        return []
    w = _words(_skeleton(text, case))
    runs, start, last = [], None, None
    for i in range(len(w) - 2):
        if " ".join(w[i:i + 3]) in over:
            if start is None or i != last + 1:
                if start is not None:
                    runs.append(" ".join(w[start:last + 3]))
                start = i
            last = i
    if start is not None:
        runs.append(" ".join(w[start:last + 3]))
    return list(dict.fromkeys(runs))


def overused_phrases(history: list, case: Optional[dict] = None, share: float = 0.4, floor: int = 3) -> list[str]:
    """The wording the agency's own recent messages keep repeating: three-word runs (names set aside, sign-off dropped)
    found in at least `share` of `history` and in `floor` messages or more, joined back into the phrases they form.
    Calibrated on run-01 (2026-10-16): 16 of 25 first emails reuse two or more of them, none of 39 replies does."""
    case = case or {}
    seen = Counter()
    for body in history:
        w = _words(_skeleton(str(body), case))
        seen.update({" ".join(w[i:i + 3]) for i in range(len(w) - 2)})
    need = max(floor, share * len(history))
    over = {g for g, k in seen.items() if k >= need and "xname" not in g}
    phrases = [p for p, _ in Counter(p for body in history for p in _tic_runs(str(body), case, over)).most_common()]
    # the core of each: "your content could be a good fit are you open to" runs over a full stop into "are you open to"
    core = [p for p in phrases if not any(q != p and q in p for q in phrases)]
    return core[:12]


GREETING = re.compile(r"^\s*(?:hi|hey|hello|dear|hallo|guten tag)\s+([^,!\n:]{1,40}?)\s*[,!\n:]", re.I)
ANYONE = {"there", "team", "all", "everyone", "folks", "both", "guys"}


def _greeted(body: str) -> str:
    """The name in the opening greeting ('Hi Mo,' -> 'Mo'), '' for none or a greeting to anyone ('Hi there,')."""
    m = GREETING.match(body or "")
    if not m:
        return ""
    name = re.sub(r"\s+(?:and|&)\s+.*$", "", m.group(1).strip())   # "Hi Sam and Lee," -> Sam is enough to check
    return "" if name.lower() in ANYONE or name.lower().split()[0] in ANYONE else name


def _skeleton(text: str, case: dict) -> str:
    """The message with its names swapped for one placeholder and the sign-off dropped, so that two emails built on
    the same frame match whatever brands and people they name."""
    agency = case.get("agency") or {}
    sign = {str(agency.get("sender") or ""), str(agency.get("name") or "")} - {""}
    lines = [ln for ln in text.strip().splitlines() if ln.strip() not in sign and not re.match(r"^(best|thanks|cheers|regards)\W*$", ln.strip(), re.I)]
    out = "\n".join(lines)
    for name in sorted(set(_names(case)) | _brand_names(), key=len, reverse=True):
        out = re.sub(r"\b" + re.escape(name) + r"\b", " xname ", out, flags=re.I)
    return out


@lru_cache(maxsize=1)
def _brand_names() -> frozenset:
    """Every brand the scenario facts know, so a recent message about another brand still matches on its frame."""
    try:
        data = json.loads((Path(__file__).resolve().parents[2] / "data" / "comms" / "tests" / "scenarios.json").read_text(encoding="utf-8"))
        return frozenset(data.get("brands") or {})
    except (OSError, ValueError):
        return frozenset()


def _names(case: dict) -> list[str]:
    """Names the case gives (people, channels, brands): sharing them with another message is not copying."""
    out = []
    def walk(node, key=""):
        if isinstance(node, dict):
            for k, v in node.items():
                walk(v, k)
        elif isinstance(node, list):
            for v in node:
                walk(v, key)
        elif isinstance(node, str) and key in ("name", "channel", "handle", "company", "brand", "sender") and len(node) < 60:
            out.append(node)
    walk({k: v for k, v in case.items() if k != "recent_messages"})
    return out


def policy_findings(case: dict) -> list[dict]:
    """What the agency refuses outright, read from the live case's `policy` (comms/live_case.py) -- never the
    model's call: HC-08 (no female or couple creators), HC-09 (boycotted brands and countries), BRD-PRES-15 (only
    creators whose analytics and agreed rate we hold go into a brand pitch)."""
    policy = case.get("policy") or {}
    out = []
    if policy.get("creator_out_of_scope"):
        out.append(_f("HC08_OUT_OF_SCOPE", "block", "HC-08",
                      "the creator is flagged female or couple: the agency does not contact or pitch them"))
    if policy.get("boycott"):
        out.append(_f("HC09_BOYCOTT", "block", "HC-09", f"the brand is {policy['boycott']}: no pitch, no creator for it"))
    if policy.get("not_ready"):
        out.append(_f("PITCH_NOT_READY", "block", "BRD-PRES-15",
                      "not ready to pitch (analytics and an agreed rate first): " + ", ".join(policy["not_ready"])))
    return out


def gates(case: dict, proposal: dict) -> list[dict]:
    """What a person must confirm before sending: the model's own list plus what the text shows."""
    out = [dict(g) for g in (proposal or {}).get("needs_human") or [] if isinstance(g, dict)]
    have = {g.get("what") for g in out}
    msg = (proposal or {}).get("message") or {}
    body = str(msg.get("body") or "")
    low = body.lower()
    agency_claims = " ".join(str(x) for x in (case.get("agency") or {}).get("true_claims") or []).lower()
    if money(f"{msg.get('subject') or ''}\n{body}") and "price" not in have:
        out.append({"what": "price", "detail": "the message names a price, amount or percentage", "source": "checks"})
    if any(re.search(rx, low) for rx in TERMS) and "terms" not in have:
        out.append({"what": "terms", "detail": "the message touches contract or payment terms", "source": "checks"})
    for rx in CLAIMS:
        m = re.search(rx, low)
        if m and m.group(0) not in agency_claims and "claim" not in have:
            out.append({"what": "claim", "detail": f"claim about the agency: '{m.group(0)}' \u2014 confirm it is true", "source": "checks"})
            break
    facts = json.dumps(case.get("facts") or {}, ensure_ascii=False).lower()
    hits = [h.strip() for h in HARAM_HINTS if h in facts]
    if hits and "ethics" not in have:
        out.append({"what": "ethics", "detail": f"possible haram category in the case ({', '.join(hits[:3])}) \u2014 FND-ETH-05/06", "source": "checks"})
    return out


def blocking(findings: Iterable[dict]) -> list[dict]:
    return [f for f in findings if f.get("severity") == "block"]


def describe(findings: Iterable[dict]) -> str:
    return "\n".join(f"- [{f['rule']}] {f['code']}: {f['detail']}" for f in findings)
