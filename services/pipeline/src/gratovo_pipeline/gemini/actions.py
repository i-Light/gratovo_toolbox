"""The `action.*` methods: prompts that live here so the app never composes one.

Each action takes the wire params from DAEMON.md §3, asks Gemini (except `comms_check`, which is
pure Python), and turns the reply into the typed result the app expects. Two shared pieces do most
of the work:

  * `_ask` -- the one way an action talks to Gemini. With `gem` it opens that gem (a fresh chat
    inside it) and sends just the user message; without one it PREPENDS the matching skill file
    from the pipeline's `gemini-skills` data folder so a plain chat behaves like the gem. A skill
    file that is not there is `SKILL_FILE_MISSING`, never a silent prompt without doctrine.
  * `parse_json_reply` (in `json_reply`) -- tolerant of how models actually answer: a ```json
    fence, a bare object, or an object with chatter around it. Anything else is
    `ACTION_PARSE_FAILED` carrying `raw`, so the app can show what came back instead of guessing.

Every result carries `raw` (the full reply) and `model`, per DAEMON.md.

The Comms queue's two actions (`comms_propose`, `comms_check`) build the live case from main's
`facts` and the pipeline's own `pipeline.db` in the bridge's `--data-dir` (plan D6, D10).
"""

from __future__ import annotations

import inspect
import json
import logging
import re
import sqlite3
import threading
from collections.abc import Callable
from pathlib import Path
from typing import TYPE_CHECKING, Any, cast

from gratovo_pipeline import paths

# The actions whose bodies live in their own modules. Imported as modules and only touched at call
# time (see ACTIONS), so those modules may import this one.
from . import gems, keywords_batch, skills
from .errors import (
    ActionParseFailed,
    ActionRefused,
    BadParams,
    GeminiError,
    SkillFileMissing,
)
from .json_reply import extract_json, parse_json_reply
from .progress import Emit

if TYPE_CHECKING:  # pragma: no cover - typing only, avoids a circular import
    from .client import Gemini

__all__ = [
    "ACTIONS",
    "ActionParseFailed",
    "ActionRefused",
    "GeminiError",
    "SkillFileMissing",
    "classify_channel",
    "extract_json",
    "generate_keywords",
    "load_skill",
    "parse_json_reply",
    "parse_keywords",
    "run_action",
    "skill_path",
]

log = logging.getLogger(__name__)

KEYWORDS_SKILL = "keyword generator skill.md"
CLASSIFIER_SKILL = "channel classifier skill.md"

DEFAULT_TIMEOUT_S = 240.0
# Only the most recent `avoid` entries reach the prompt; the whole list is still used for
# client-side dedupe. Beyond this the list stops helping the model and starts crowding out the
# actual instructions.
AVOID_IN_PROMPT = 300

type Params = dict[str, Any]


# --- skill files -------------------------------------------------------------------


def skill_path(name: str, skills_dir: Path | None = None) -> Path:
    """Where skill file `name` lives: the pipeline's `gemini-skills` folder, or `skills_dir`."""
    return Path(skills_dir or paths.GEMINI_SKILLS_DIR) / name


def load_skill(name: str, skills_dir: Path | None = None) -> str:
    """The skill file's text, or `SKILL_FILE_MISSING`."""
    path = skill_path(name, skills_dir)
    try:
        text = path.read_bytes()
    except OSError as error:
        raise SkillFileMissing(
            message=f"skill file not found: {path} ({error.strerror or error})",
            details={"path": str(path)},
        ) from None
    return text.decode("utf-8-sig", "replace").replace("\r\n", "\n").strip()


# --- the shared Gemini round-trip --------------------------------------------------


def _params_common(params: Params) -> tuple[str | None, str | None, bool, float]:
    model = params.get("model") or None
    gem = params.get("gem") or None
    asked_new_chat = params.get("newChat", True)
    new_chat = True if asked_new_chat is None else bool(asked_new_chat)
    asked_timeout = params.get("timeoutS")
    timeout = DEFAULT_TIMEOUT_S if asked_timeout is None else float(asked_timeout)
    return model, gem, new_chat, timeout


def _ask(gemini: Gemini, params: Params, message: str, skill: str | None = None) -> tuple[str, str]:
    """Sends `message` (with the skill prepended unless a gem is used); returns `(raw, model)`."""
    model, gem, new_chat, timeout = _params_common(params)
    if gem:
        # Navigating to the gem IS the new chat; clicking "New chat" after it would leave the gem.
        # So `newChat` is ignored once a gem is given.
        gemini.open_gem(gem)
        prompt = message
        new_chat = False
    elif skill:
        prompt = load_skill(skill) + "\n\n---\n\n" + message
    else:
        prompt = message
    raw, used_model = _send(gemini, prompt, new_chat, model, timeout)
    if _REFUSAL.search(raw) and len(raw) < 400:
        # "I'm having a hard time fulfilling your request" is Gemini balking at a long prompt, not
        # an answer; a fresh chat usually takes it. If it balks again the app sees the refusal
        # verbatim in `raw`.
        log.warning("Gemini refused (%r); retrying once in a new chat", raw[:80])
        retry_raw, retry_model = _send(gemini, prompt, not gem, model, timeout)
        if not (_REFUSAL.search(retry_raw) and len(retry_raw) < 400):
            return retry_raw, retry_model
        raise ActionRefused(
            message="Gemini refused the prompt twice: " + retry_raw.strip()[:200],
            details={"raw": retry_raw, "model": retry_model},
        )
    return raw, used_model


_REFUSAL = re.compile(
    r"having a hard time fulfilling|can.?t help with that|unable to (help|assist) with that|"
    r"something went wrong|try again later",
    re.I,
)


def _send(
    gemini: Gemini, prompt: str, new_chat: bool, model: str | None, timeout: float
) -> tuple[str, str]:
    result: Any = gemini.send(prompt, wait=True, new_chat=new_chat, model=model, timeout=timeout)
    reply = cast("dict[str, Any]", result) if isinstance(result, dict) else {}
    raw: Any = reply.get("text")
    used_model: Any = reply.get("model")
    return (raw if isinstance(raw, str) else ""), (str(used_model) if used_model else "")


def _str(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except TypeError, ValueError:
        return default


def _str_list(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value] if value.strip() else []
    if isinstance(value, list):
        items = cast("list[Any]", value)
        return [str(v) for v in items if isinstance(v, (str, int, float)) and str(v).strip()]
    return []


# --- action.generate_keywords ---------------------------------------------------------

_LIST_PREFIX = re.compile(r"^\s*(?:[-*•‣▪]+|\d+[.):]|\(\d+\))\s*")
_HEADING = re.compile(r"^\s*#{1,6}\s")


def _clean_keyword(line: str) -> str:
    # A markdown heading is the model grouping its list, never a keyword.
    if _HEADING.match(line):
        return ""
    line = _LIST_PREFIX.sub("", line).strip().strip("\"“”'`").strip()
    # Bold wrappers survive from "**AI agents**"-style group labels; a bare label like that is then
    # dropped by the length/colon checks or stays a harmless short phrase the person can untick.
    return line.strip("*_").strip()


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


_DEFAULT_STYLES = [
    "comparison (X vs Y, X or Y for a use case)",
    "how-to / tutorial (how to..., step by step..., beginner's guide to...)",
    "best-of / roundup (best... for..., top 5..., underrated...)",
    "news / trend (...2026, latest..., ...explained)",
]


def _keywords_message(params: Params) -> str:
    """The per-call data the doctrine in KEYWORDS_SKILL is applied to.

    What makes a phrase good, the bad/good examples, and the output format are all in
    `keyword generator skill.md` now (`_ask` prepends it -- see `generate_keywords`) rather than
    hardcoded here; this only states this call's topic, count, styles, language and avoid-list.

    The rules are still the team's own keyword-writing rules (the `youtube-ai-keywords` skill they
    ran by hand before this existed): a generic term returns the same dozen huge channels every
    time, so every phrase has to be long-tail, built from a sub-topic + a phrasing style + one
    specific angle, and spread across the sub-topics of the topic rather than clustered in two or
    three.
    """
    topic = _str(params.get("topic"))
    count = _int(params.get("count"), default=100) or 100
    exclusions = _str_list(params.get("exclusions"))
    styles = _str_list(params.get("styles")) or _DEFAULT_STYLES
    language = _str(params.get("language"))
    avoid = _str_list(params.get("avoid"))
    notes = _str(params.get("notes"))
    lines = [
        f"Generate {count} long-tail YouTube search phrases for discovering channels about: "
        f"{topic}.",
        "",
        "Mix these phrasing styles roughly evenly: " + "; ".join(styles) + ".",
        f"Language: {language}." if language else "Language: English.",
    ]
    if exclusions:
        lines += [
            "",
            "Exclude entirely, no phrase may be about these: " + "; ".join(exclusions) + ".",
        ]
    if notes:
        lines += ["", notes]
    if avoid:
        recent = avoid[-AVOID_IN_PROMPT:]
        lines += [
            "",
            "These were already searched. Do not repeat any of them, and avoid "
            "anything close to them (same sub-topic and angle):",
        ]
        lines += [f"- {a}" for a in recent]
    return "\n".join(lines)


def parse_keywords(raw: str, avoid: list[str] | None = None) -> tuple[list[str], int]:
    """Keywords from a one-per-line reply, deduped (case-insensitive) and minus `avoid`; returns
    `(keywords, dropped)`."""
    seen = {_norm(a) for a in (avoid or []) if a.strip()}
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


def generate_keywords(gemini: Gemini, params: Params, emit: Emit | None = None) -> Params:
    """Asks for `count` search keywords about `topic`; returns `{keywords, dropped, raw, model}`."""
    if _int(params.get("chats"), default=1) > 1:
        # Several separate new chats, merged (CONTRACT_GEMINI.md section 3.5); a request with no
        # `chats`, or 1, is the single-chat action below, exactly as it always was.
        return keywords_batch.generate(gemini, params, emit=emit)
    if not _str(params.get("topic")):
        raise GeminiError("BAD_PARAMS", "generate_keywords needs a `topic`")
    raw, model = _ask(gemini, params, _keywords_message(params), skill=KEYWORDS_SKILL)
    keywords, dropped = parse_keywords(raw, _str_list(params.get("avoid")))
    if not keywords:
        raise ActionParseFailed(message="no keywords found in the reply", details={"raw": raw})
    return {"keywords": keywords, "dropped": dropped, "raw": raw, "model": model}


# --- action.classify_channel ----------------------------------------------------------


def _classify_message(params: Params) -> str:
    """The per-call data the doctrine in CLASSIFIER_SKILL is applied to.

    The output JSON shape is in `channel classifier skill.md` now (`_ask` prepends it -- see
    `classify_channel`); this only states this call's niche, channel data and brand-fit criteria.
    """
    found: Any = params.get("channel")
    channel = cast("dict[str, Any]", found) if isinstance(found, dict) else {}
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


def classify_channel(gemini: Gemini, params: Params) -> Params:
    """Judges a channel against a niche; returns `{niche, audience, language, brandFit, reasons,
    redFlags, raw, model}`."""
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


# --- the Comms queue (docs/plans/decisions_build_plan.md, step 6; 3e-3 plan D6, D10) -------

PIPELINE_DB = "pipeline.db"
COMMS_TIMEOUT_S = 300


def _comms_db(gemini: Gemini, *, write: bool) -> sqlite3.Connection:
    """pipeline.db in the bridge's `--data-dir`: the channels and videos the case reads, and, with
    `write`, the subtitles cache (`video_transcripts`) a first email's moments are kept in.

    The search job owns the file (ADR 0013 §6). The bridge reads it, and writes only that cache
    (plan D10): a check opens it read-only, so it never waits on a running search; a draft creates
    or upgrades it only when it doesn't exist yet or is older than this pipeline.
    """
    from gratovo_pipeline import store

    data_dir: Path | None = getattr(gemini, "data_dir", None)
    if data_dir is None:
        raise BadParams(message="the bridge was started without --data-dir")
    path = data_dir / PIPELINE_DB
    if not write:
        if not path.exists():
            # No search has run on this data yet: an empty store, so the case has no channel facts.
            empty = sqlite3.connect(":memory:")
            empty.row_factory = sqlite3.Row
            store.init_db(empty)
            return empty
        conn = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        return conn
    data_dir.mkdir(parents=True, exist_ok=True)
    conn = store.get_connection(path)
    try:
        version: int = conn.execute("PRAGMA user_version").fetchone()[0]
        if version != store.SCHEMA_VERSION:
            store.init_db(conn)  # a new file, or one a search hasn't upgraded yet
    except BaseException:
        conn.close()
        raise
    return conn


def _comms_params(params: Params) -> tuple[Params, Params]:
    """(the request, main's facts): the app's side of the case, read by main from its own tables
    (plan D6). Anything that is not an object counts as empty."""
    request: Any = params.get("request")
    facts: Any = params.get("facts")
    return (
        cast("Params", request) if isinstance(request, dict) else {},
        cast("Params", facts) if isinstance(facts, dict) else {},
    )


def _comms_timeout(request: Params, params: Params) -> int:
    # The contract carries it in the request; the old wire had it beside the request.
    asked: Any = request.get("timeoutS", params.get("timeoutS"))
    if isinstance(asked, bool) or not isinstance(asked, int | float) or asked <= 0:
        return COMMS_TIMEOUT_S
    return int(asked)


def comms_propose(gemini: Gemini, params: Params) -> Params:
    """One proposal for the Comms queue: the live case from main's facts and pipeline.db
    (comms/live_case.py) -- with the usable moments of the creator's latest video for a first email
    (decision `subtitles`) -- through `engine.propose` (variant auto). Nothing is sent: every
    message waits for a person."""
    from gratovo_pipeline.comms import engine, live_case, moments

    request, facts = _comms_params(params)
    timeout_s = _comms_timeout(request, params)
    conn = _comms_db(gemini, write=True)
    try:
        found: Params | None = None
        note: str | None = None
        channel_id = request.get("channelId")
        # Only for a first email to a creator (no brand).
        if (
            request.get("kind") == "first"
            and isinstance(channel_id, str)
            and channel_id
            and not request.get("brandId")
        ):
            try:
                found = moments.for_latest_video(conn, gemini, channel_id, timeout_s=timeout_s)
            except Exception as exc:  # a first email is still worth drafting without them
                note = f"the latest video's moments could not be read: {exc}"
        case = live_case.build_case(conn, request, facts, moments=found)
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


def comms_check(gemini: Gemini, params: Params) -> Params:
    """Text a person edited, checked again before it goes (the engine's deterministic checks and
    the gates a person must confirm), against the same live case. No Gemini call: `gemini` is
    asked only for its `data_dir`."""
    from gratovo_pipeline.comms import checks, live_case

    request, facts = _comms_params(params)
    conn = _comms_db(gemini, write=False)
    try:
        case = live_case.build_case(conn, request, facts)
    finally:
        conn.close()
    proposal: Params = {
        "message": {
            "channel": "email",
            "subject": str(params.get("subject") or ""),
            "body": str(params.get("body") or ""),
        }
    }
    findings = (
        checks.policy_findings(case)
        + checks.check(case, proposal)
        + checks.placeholders(proposal["message"]["subject"], proposal["message"]["body"])
    )
    # FACT_NUMBER stops the model inventing a number. A number a person typed is theirs: it does
    # not block, it raises the gate they confirm (the price gate for money).
    findings = [
        dict(f, severity="warn", detail=f"a number you typed: {f['detail'].split(' (')[0]}")
        if f.get("code") == "FACT_NUMBER"
        else f
        for f in findings
    ]
    return {
        "findings": findings,
        "gates": checks.gates(case, proposal),
        "blocking": bool(checks.blocking(findings)),
    }


# --- dispatch -----------------------------------------------------------------------


def _gem_create(gemini: Gemini, params: Params, emit: Emit | None = None) -> Params:
    return gems.gem_create(gemini, params, emit=emit)


def _gem_update(gemini: Gemini, params: Params, emit: Emit | None = None) -> Params:
    return gems.gem_update(gemini, params, emit=emit)


def _gem_read(gemini: Gemini, params: Params, emit: Emit | None = None) -> Params:
    return gems.gem_read(gemini, params, emit=emit)


def _skill_deploy(gemini: Gemini, params: Params, emit: Emit | None = None) -> Params:
    return skills.action_deploy(gemini, params, emit=emit)


#: Each action is called as `action(gemini, params)`, and as `action(gemini, params, emit=emit)`
#: when it has an `emit` parameter (see `run_action`).
ACTIONS: dict[str, Callable[..., Params]] = {
    "generate_keywords": generate_keywords,
    "classify_channel": classify_channel,
    # Registered by the contract (CONTRACT_GEMINI.md sections 3.4, 3.6); the bodies live in their
    # own modules and are looked up at call time.
    "gem_create": _gem_create,
    "gem_update": _gem_update,
    "gem_read": _gem_read,
    # Gemini 4 Argon skills (skills.py): the Skills page, driven through the extension.
    "skills_list": skills.action_list,
    "skill_read": skills.action_read,
    "skill_set_active": skills.action_set_active,
    "skill_delete": skills.action_delete,
    "skill_deploy": _skill_deploy,
    # The Comms queue: a proposal from the live case (asks Gemini), and edited text checked again
    # (does not).
    "comms_propose": comms_propose,
    "comms_check": comms_check,
}


#: Actions that never touch the Gemini page, so they need not wait for it.
_OFF_PAGE_ACTIONS = frozenset({"comms_check"})

#: One page-driving action at a time. The daemon runs requests on a pool, and two actions on the
#: one Gemini tab would wreck each other: a gem update navigating to the gem editor in the middle
#: of a draft loses the draft.
_PAGE_LOCK = threading.RLock()


def _accepts_emit(action: Callable[..., Params]) -> bool:
    """Whether `action` can be called with `emit=`: an explicit parameter of that name, or
    `**kwargs`."""
    try:
        parameters = inspect.signature(action).parameters.values()
    except TypeError, ValueError:
        return False
    return any(
        (
            p.name == "emit"
            and p.kind in (inspect.Parameter.POSITIONAL_OR_KEYWORD, inspect.Parameter.KEYWORD_ONLY)
        )
        or p.kind is inspect.Parameter.VAR_KEYWORD
        for p in parameters
    )


def run_action(
    gemini: Gemini, name: str, params: Params | None, emit: Emit | None = None
) -> Params:
    """Runs `action.<name>` (with or without the prefix); unknown names are `BAD_PARAMS`.

    `emit(event, data)`, when given, is handed to the actions that take one so a long action can
    report progress (`progress.emit_progress`); the others are called as before and never see it.
    """
    key = name.removeprefix("action.")
    action = ACTIONS.get(key)
    if action is None:
        raise GeminiError(
            "BAD_PARAMS", f"unknown action {name!r}; known: {', '.join(sorted(ACTIONS))}"
        )
    if key in _OFF_PAGE_ACTIONS:
        return _call_action(action, gemini, params, emit)
    with _PAGE_LOCK:
        return _call_action(action, gemini, params, emit)


def _call_action(
    action: Callable[..., Params], gemini: Gemini, params: Params | None, emit: Emit | None
) -> Params:
    if emit is not None and _accepts_emit(action):
        return action(gemini, dict(params or {}), emit=emit)
    return action(gemini, dict(params or {}))
