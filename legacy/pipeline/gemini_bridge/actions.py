"""The `action.*` methods: prompts that live here so the app never composes one.

Each action takes the wire params from DAEMON.md §3, asks Gemini (except
`comms_check`, which is pure Python), and turns the reply into the typed
result the app expects. Two shared pieces do most of the work:

  * `_ask` -- the one way an action talks to Gemini. With `gem` it opens
    that gem (a fresh chat inside it) and sends just the user message; without
    one it PREPENDS the matching skill file from `data/gemini skills/` so a
    plain chat behaves like the gem. A skill file that is not there is
    `SKILL_FILE_MISSING`, never a silent prompt without doctrine.
  * `extract_json` -- tolerant of how models actually answer: a ```json
    fence, a bare object, or an object with chatter around it. Anything else
    is `ACTION_PARSE_FAILED` carrying `raw`, so the app can show what came
    back instead of guessing.

Every result carries `raw` (the full reply) and `model`, per DAEMON.md.
"""

from __future__ import annotations

import inspect
import json
import logging
import os
import re
import threading
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable, Optional

# The actions whose bodies live in their own modules. Imported as modules and
# only touched at call time (see ACTIONS), so those modules may import this one.
from . import gems, keywords_batch, skills
from .errors import GeminiError
from .progress import Emit, emit_progress

log = logging.getLogger("gemini_bridge.actions")

if TYPE_CHECKING:  # pragma: no cover - typing only, avoids a circular import
    from .client import Gemini

PACKAGE_DIR = Path(__file__).resolve().parent
PIPELINE_DIR = PACKAGE_DIR.parent
REPO_ROOT = PIPELINE_DIR.parent
# The same resolution `gratovo/config.py` uses, without importing it: the
# bridge stays a standalone package with one dependency.
DEFAULT_DATA_DIR = Path(os.environ.get("GRATOVO_DATA_DIR") or (REPO_ROOT / "data"))
SKILLS_DIRNAME = "gemini skills"
KEYWORDS_SKILL = "keyword generator skill.md"
CLASSIFIER_SKILL = "channel classifier skill.md"

DEFAULT_TIMEOUT_S = 240.0
# Only the most recent `avoid` entries reach the prompt; the whole list is
# still used for client-side dedupe. Beyond this the list stops helping the
# model and starts crowding out the actual instructions.
AVOID_IN_PROMPT = 300


# --- errors this module raises --------------------------------------------------

class ActionParseFailed(GeminiError):
    """Gemini answered but the reply could not be parsed into the action's result."""
    code = "ACTION_PARSE_FAILED"


class ActionRefused(GeminiError):
    """Gemini answered with its generic refusal twice in a row; `details.raw` has the text."""
    code = "ACTION_REFUSED"


class SkillFileMissing(GeminiError):
    """An action needed a skill file from `data/gemini skills/` that is not there."""
    code = "SKILL_FILE_MISSING"


# --- JSON extraction --------------------------------------------------------------

_FENCE = re.compile(r"```(?:json|JSON)?\s*\n(.*?)\n\s*```", re.S)


def _balanced_object(text: str, start: int) -> Optional[str]:
    """The `{...}` starting at `start`, honouring strings and escapes; None if unbalanced."""
    depth = 0
    in_string = False
    escaped = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start:i + 1]
    return None


def extract_json(text: str, strict: bool = True) -> Optional[dict]:
    """The first JSON object in a reply: a ```json fence, else the first balanced `{...}`.

    `strict=False` also reads raw line breaks inside strings, as text copied out of a chat window has them.
    """
    if not isinstance(text, str):
        return None
    for match in _FENCE.finditer(text):
        try:
            value = json.loads(match.group(1), strict=strict)
        except ValueError:
            continue
        if isinstance(value, dict):
            return value
    start = text.find("{")
    while start != -1:
        candidate = _balanced_object(text, start)
        if candidate is not None:
            try:
                value = json.loads(candidate, strict=strict)
            except ValueError:
                value = None
            if isinstance(value, dict):
                return value
        start = text.find("{", start + 1)
    return None


def parse_json_reply(raw: str, what: str) -> dict:
    """`extract_json` or `ACTION_PARSE_FAILED` with the raw reply attached."""
    payload = extract_json(raw)
    if payload is None:
        raise ActionParseFailed(
            message=f"could not find a JSON object in Gemini's {what} reply",
            details={"raw": raw})
    return payload


# --- skill files -------------------------------------------------------------------

def skill_path(data_dir: Optional[Path], name: str) -> Path:
    return Path(data_dir or DEFAULT_DATA_DIR) / SKILLS_DIRNAME / name


def load_skill(data_dir: Optional[Path], name: str) -> str:
    """The skill file's text, or `SKILL_FILE_MISSING`."""
    path = skill_path(data_dir, name)
    try:
        text = path.read_bytes()
    except OSError as error:
        raise SkillFileMissing(
            message=f"skill file not found: {path} ({error.strerror or error})",
            details={"path": str(path)}) from None
    return text.decode("utf-8-sig", "replace").replace("\r\n", "\n").strip()


# --- the shared Gemini round-trip --------------------------------------------------

def _params_common(params: dict) -> tuple[Optional[str], Optional[str], bool, float]:
    model = params.get("model") or None
    gem = params.get("gem") or None
    new_chat = params.get("newChat", True)
    new_chat = True if new_chat is None else bool(new_chat)
    timeout = params.get("timeoutS")
    timeout = DEFAULT_TIMEOUT_S if timeout is None else float(timeout)
    return model, gem, new_chat, timeout


def _ask(gemini: "Gemini", params: dict, message: str,
         skill: Optional[str] = None) -> tuple[str, str]:
    """Sends `message` (with the skill prepended unless a gem is used); returns `(raw, model)`."""
    model, gem, new_chat, timeout = _params_common(params)
    if gem:
        # Navigating to the gem IS the new chat; clicking "New chat" after it
        # would leave the gem. So `newChat` is ignored once a gem is given.
        gemini.open_gem(gem)
        prompt = message
        new_chat = False
    elif skill:
        prompt = load_skill(gemini.data_dir, skill) + "\n\n---\n\n" + message
    else:
        prompt = message
    raw, used_model = _send(gemini, prompt, new_chat, model, timeout)
    if _REFUSAL.search(raw) and len(raw) < 400:
        # "I'm having a hard time fulfilling your request" is Gemini balking
        # at a long prompt, not an answer; a fresh chat usually takes it. If
        # it balks again the app sees the refusal verbatim in `raw`.
        log.warning("Gemini refused (%r); retrying once in a new chat", raw[:80])
        retry_raw, retry_model = _send(gemini, prompt, True if not gem else False, model, timeout)
        if not (_REFUSAL.search(retry_raw) and len(retry_raw) < 400):
            return retry_raw, retry_model
        raise ActionRefused(message="Gemini refused the prompt twice: " + retry_raw.strip()[:200],
                            details={"raw": retry_raw, "model": retry_model})
    return raw, used_model


_REFUSAL = re.compile(
    r"having a hard time fulfilling|can.?t help with that|unable to (help|assist) with that|"
    r"something went wrong|try again later", re.I)


def _send(gemini: "Gemini", prompt: str, new_chat: bool, model: Optional[str],
          timeout: float) -> tuple[str, str]:
    result = gemini.send(prompt, wait=True, new_chat=new_chat, model=model, timeout=timeout)
    raw = result.get("text") if isinstance(result, dict) else None
    used_model = result.get("model") if isinstance(result, dict) else None
    return (raw if isinstance(raw, str) else ""), (str(used_model) if used_model else "")


def _str(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _str_list(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value] if value.strip() else []
    if isinstance(value, list):
        return [str(v) for v in value if isinstance(v, (str, int, float)) and str(v).strip()]
    return []


# --- action.generate_keywords ---------------------------------------------------------

_LIST_PREFIX = re.compile(r"^\s*(?:[-*•‣▪]+|\d+[.):]|\(\d+\))\s*")
_HEADING = re.compile(r"^\s*#{1,6}\s")


def _clean_keyword(line: str) -> str:
    # A markdown heading is the model grouping its list, never a keyword.
    if _HEADING.match(line):
        return ""
    line = _LIST_PREFIX.sub("", line).strip().strip('"“”\'`').strip()
    # Bold wrappers survive from "**AI agents**"-style group labels; a bare
    # label like that is then dropped by the length/colon checks or stays a
    # harmless short phrase the person can untick.
    return line.strip("*_").strip()


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


_DEFAULT_STYLES = [
    "comparison (X vs Y, X or Y for a use case)",
    "how-to / tutorial (how to..., step by step..., beginner's guide to...)",
    "best-of / roundup (best... for..., top 5..., underrated...)",
    "news / trend (...2026, latest..., ...explained)",
]


def _keywords_message(params: dict) -> str:
    """The per-call data the doctrine in KEYWORDS_SKILL is applied to.

    What makes a phrase good, the bad/good examples, and the output format are
    all in `data/gemini skills/keyword generator skill.md` now (`_ask`
    prepends it -- see `generate_keywords`) rather than hardcoded here; this
    only states this call's topic, count, styles, language and avoid-list.

    The rules are still the team's own keyword-writing rules (the
    `youtube-ai-keywords` skill they ran by hand before this existed): a
    generic term returns the same dozen huge channels every time, so every
    phrase has to be long-tail, built from a sub-topic + a phrasing style +
    one specific angle, and spread across the sub-topics of the topic rather
    than clustered in two or three.
    """
    topic = _str(params.get("topic"))
    count = _int(params.get("count"), default=100) or 100
    exclusions = _str_list(params.get("exclusions"))
    styles = _str_list(params.get("styles")) or _DEFAULT_STYLES
    language = _str(params.get("language"))
    avoid = _str_list(params.get("avoid"))
    notes = _str(params.get("notes"))
    lines = [
        f"Generate {count} long-tail YouTube search phrases for discovering channels about: {topic}.",
        "",
        "Mix these phrasing styles roughly evenly: " + "; ".join(styles) + ".",
        f"Language: {language}." if language else "Language: English.",
    ]
    if exclusions:
        lines += ["", "Exclude entirely, no phrase may be about these: " + "; ".join(exclusions) + "."]
    if notes:
        lines += ["", notes]
    if avoid:
        recent = avoid[-AVOID_IN_PROMPT:]
        lines += ["", "These were already searched. Do not repeat any of them, and avoid "
                      "anything close to them (same sub-topic and angle):"]
        lines += [f"- {a}" for a in recent]
    return "\n".join(lines)


def parse_keywords(raw: str, avoid: Optional[list] = None) -> tuple[list[str], int]:
    """Keywords from a one-per-line reply, deduped (case-insensitive) and minus `avoid`; returns `(keywords, dropped)`."""
    seen = {_norm(a) for a in (avoid or []) if isinstance(a, str) and a.strip()}
    keywords: list[str] = []
    dropped = 0
    for line in (raw or "").splitlines():
        candidate = _clean_keyword(line)
        if not candidate:
            continue
        if candidate.endswith(":") or candidate.startswith("```") or len(candidate) > 80:
            continue  # a heading, a fence, or a sentence -- not a keyword
        key = _norm(candidate)
        if key in seen:
            dropped += 1
            continue
        seen.add(key)
        keywords.append(candidate)
    return keywords, dropped


def generate_keywords(gemini: "Gemini", params: dict, emit: Optional[Emit] = None) -> dict:
    """Asks for `count` search keywords about `topic`; returns `{keywords, dropped, raw, model}`."""
    if _int(params.get("chats"), default=1) > 1:
        # Several separate new chats, merged (CONTRACT_GEMINI.md section 3.5); a request with
        # no `chats`, or 1, is the single-chat action below, exactly as it always was.
        return keywords_batch.generate(gemini, params, emit=emit)
    if not _str(params.get("topic")):
        raise GeminiError("BAD_PARAMS", "generate_keywords needs a `topic`")
    raw, model = _ask(gemini, params, _keywords_message(params), skill=KEYWORDS_SKILL)
    keywords, dropped = parse_keywords(raw, _str_list(params.get("avoid")))
    if not keywords:
        raise ActionParseFailed(message="no keywords found in the reply", details={"raw": raw})
    return {"keywords": keywords, "dropped": dropped, "raw": raw, "model": model}


# --- action.classify_channel ----------------------------------------------------------

def _classify_message(params: dict) -> str:
    """The per-call data the doctrine in CLASSIFIER_SKILL is applied to.

    The output JSON shape is in `data/gemini skills/channel classifier
    skill.md` now (`_ask` prepends it -- see `classify_channel`); this only
    states this call's niche, channel data and brand-fit criteria.
    """
    channel = params.get("channel") if isinstance(params.get("channel"), dict) else {}
    niche = _str(params.get("niche"))
    criteria = _str_list(params.get("criteria"))
    lines = [
        f"Classify this YouTube channel for an influencer-marketing roster in the niche: {niche}.",
        "",
        "Channel data (the only facts you have; do not assume anything not here):",
        json.dumps(channel, ensure_ascii=False, indent=2),
    ]
    if criteria:
        lines += ["", "Brand-fit criteria, in priority order:"] + [f"- {c}" for c in criteria]
    return "\n".join(lines)


def classify_channel(gemini: "Gemini", params: dict) -> dict:
    """Judges a channel against a niche; returns `{niche, audience, language, brandFit, reasons, redFlags, raw, model}`."""
    if not isinstance(params.get("channel"), dict) or not _str(params.get("niche")):
        raise GeminiError("BAD_PARAMS", "classify_channel needs `channel` and `niche`")
    raw, model = _ask(gemini, params, _classify_message(params), skill=CLASSIFIER_SKILL)
    payload = parse_json_reply(raw, "classify_channel")
    fit = _int(payload.get("brandFit", payload.get("brand_fit")), default=0)
    return {
        "niche": _str(payload.get("niche")),
        "audience": _str(payload.get("audience")),
        "language": _str(payload.get("language")),
        "brandFit": min(5, max(1, fit)) if fit else 0,
        "reasons": _str_list(payload.get("reasons")),
        "redFlags": _str_list(payload.get("redFlags", payload.get("red_flags"))),
        "raw": raw,
        "model": model,
    }


# --- the Comms queue (docs/plans/decisions_build_plan.md, step 6) ------------------------

def _comms_db(params: dict):
    """The local database the app and the pipeline share; `dbPath` only in tests."""
    from gratovo import config, store
    conn = store.get_connection(str(params.get("dbPath") or config.DB_PATH))
    store.init_db(conn)   # the pipeline's own tables, the subtitles cache among them
    return conn


def comms_propose(gemini: "Gemini", params: dict) -> dict:
    """One proposal for the Comms queue: the live case from gratovo.db (comms/live_case.py) -- with the usable
    moments of the creator's latest video for a first email (decision `subtitles`) -- through `engine.propose`
    (variant auto). Nothing is sent: every message waits for a person."""
    from comms import engine, live_case, moments
    request = params.get("request") if isinstance(params.get("request"), dict) else {}
    timeout_s = int(params.get("timeoutS") or 300)
    conn = _comms_db(params)
    try:
        found, note = None, None
        if request.get("kind") == "first" and request.get("channelId") and not request.get("brandId"):
            try:
                found = moments.for_latest_video(conn, gemini, request["channelId"], timeout_s=timeout_s)
            except Exception as exc:   # noqa: BLE001 - a first email is still worth drafting without them
                note = f"the latest video's moments could not be read: {exc}"
        case = live_case.build_case(conn, request, moments=found)
    finally:
        conn.close()
    result = engine.propose(gemini, case, variant="auto", timeout_s=timeout_s)
    return {
        "status": result.get("status"),
        "proposal": result.get("proposal"),
        "findings": result.get("findings") or [],
        "gates": result.get("gates") or [],
        "case": {"side": case.get("side"), "stage": case.get("stage"), "goal": case.get("goal")},
        "moments": (found or {}).get("moments") or [],
        "momentsNote": note or (found or {}).get("note"),
        "seconds": result.get("seconds"),
        "model": result.get("model"),
        "thinking": result.get("thinking"),
    }


def comms_check(params: dict) -> dict:
    """Text a person edited, checked again before it goes (the engine's deterministic checks and the gates a person
    must confirm), against the same live case. No Gemini call."""
    from comms import checks, live_case
    request = params.get("request") if isinstance(params.get("request"), dict) else {}
    conn = _comms_db(params)
    try:
        case = live_case.build_case(conn, request)
    finally:
        conn.close()
    proposal = {"message": {"channel": "email", "subject": str(params.get("subject") or ""),
                            "body": str(params.get("body") or "")}}
    findings = (checks.policy_findings(case) + checks.check(case, proposal)
                + checks.placeholders(proposal["message"]["subject"], proposal["message"]["body"]))
    # FACT_NUMBER stops the model inventing a number. A number a person typed is theirs: it does not block, it
    # raises the gate they confirm (the price gate for money).
    findings = [dict(f, severity="warn", detail=f"a number you typed: {f['detail'].split(' (')[0]}")
                if f.get("code") == "FACT_NUMBER" else f for f in findings]
    return {"findings": findings, "gates": checks.gates(case, proposal),
            "blocking": bool(checks.blocking(findings))}


# --- dispatch -----------------------------------------------------------------------

#: Each action is called as `action(gemini, params)`, and as `action(gemini,
#: params, emit=emit)` when it has an `emit` parameter (see `run_action`).
ACTIONS: dict[str, Callable[..., dict]] = {
    "generate_keywords": generate_keywords,
    "classify_channel": classify_channel,
    # Registered by the contract (CONTRACT_GEMINI.md sections 3.4, 3.6); the bodies live in
    # their own modules and are looked up at call time. Until an owner writes one it raises
    # NotImplementedError, which the daemon answers as NOT_IMPLEMENTED.
    "gem_create": lambda gemini, params, emit=None: gems.gem_create(gemini, params, emit=emit),
    "gem_update": lambda gemini, params, emit=None: gems.gem_update(gemini, params, emit=emit),
    "gem_read": lambda gemini, params, emit=None: gems.gem_read(gemini, params, emit=emit),
    # Gemini 4 Argon skills (skills.py): the Skills page, driven through the extension.
    "skills_list": skills.action_list,
    "skill_read": skills.action_read,
    "skill_set_active": skills.action_set_active,
    "skill_delete": skills.action_delete,
    "skill_deploy": lambda gemini, params, emit=None: skills.action_deploy(gemini, params, emit=emit),
    # The Comms queue: a proposal from the live case (asks Gemini), and edited text checked again (does not).
    "comms_propose": comms_propose,
    "comms_check": lambda gemini, params: comms_check(params),
}


#: Actions that never touch the Gemini page, so they need not wait for it.
_OFF_PAGE_ACTIONS = frozenset({"comms_check"})

#: One page-driving action at a time. The daemon runs requests on a pool, and
#: two actions on the one Gemini tab would wreck each other: a gem update
#: navigating to the gem editor in the middle of a draft loses the draft.
_PAGE_LOCK = threading.RLock()


def _accepts_emit(action: Callable[..., dict]) -> bool:
    """Whether `action` can be called with `emit=`: an explicit parameter of that name, or `**kwargs`."""
    try:
        parameters = inspect.signature(action).parameters.values()
    except (TypeError, ValueError):
        return False
    return any(
        (p.name == "emit" and p.kind in (inspect.Parameter.POSITIONAL_OR_KEYWORD, inspect.Parameter.KEYWORD_ONLY))
        or p.kind is inspect.Parameter.VAR_KEYWORD
        for p in parameters)


def run_action(gemini: "Gemini", name: str, params: Optional[dict],
               emit: Optional[Emit] = None) -> dict:
    """Runs `action.<name>` (with or without the prefix); unknown names are `BAD_PARAMS`.

    `emit(event, data)`, when given, is handed to the actions that take one so a long
    action can report progress (`progress.emit_progress`); the others are called as
    before and never see it.
    """
    key = name[len("action."):] if name.startswith("action.") else name
    action = ACTIONS.get(key)
    if action is None:
        raise GeminiError("BAD_PARAMS", f"unknown action {name!r}; known: {', '.join(sorted(ACTIONS))}")
    if key in _OFF_PAGE_ACTIONS:
        return _call_action(action, gemini, params, emit)
    with _PAGE_LOCK:
        return _call_action(action, gemini, params, emit)


def _call_action(action: Callable[..., dict], gemini: "Gemini", params: Optional[dict],
                 emit: Optional[Emit]) -> dict:
    if emit is not None and _accepts_emit(action):
        return action(gemini, dict(params or {}), emit=emit)
    return action(gemini, dict(params or {}))
