"""Keyword generation across several separate chats.

One chat asked for ~100 keywords is slow, gets truncated or refused. A batch
asks `chats` NEW chats (one after the other through the extension's single tab)
for a slice each and merges them:

  * every chat gets a distinct ANGLE (a phrasing/sub-topic lens rotated from
    `DEFAULT_ANGLES`, or the caller's `angles`), so the slices do not overlap
    by construction, without needing to know the topic;
  * every later chat is given everything found so far as `avoid`, on top of the
    caller's own `avoid` (the app sends every keyword ever searched). Only the
    last `AVOID_IN_PROMPT` reach the prompt; the FULL set is used to dedupe;
  * merging drops exact duplicates (case/space-insensitive) and near
    duplicates (same words, any order, plurals folded) against the whole
    `avoid` set and against earlier chats;
  * a chat that fails is retried once in a fresh chat; a chat that still fails
    does not sink the batch: the result says so (`partial`), unless every chat
    failed, then the last error is raised. Errors that no retry can fix (no
    extension, signed out) stop the batch at once;
  * progress is emitted after every chat, and the batch stops between chats
    when the bridge has been shut down.

`actions.py` imports this module when it loads, so it imports `actions`
inside `generate`, never at the top.
"""

# `actions` and this module are one unit split in two for size: the batch uses its helpers.
# pyright: reportPrivateUsage=false

from __future__ import annotations

import math
import re
import time
from typing import TYPE_CHECKING, Any

from .errors import ActionParseFailed, GeminiError
from .progress import Emit, emit_progress

if TYPE_CHECKING:  # pragma: no cover - typing only, avoids a circular import
    from .client import Gemini

MAX_CHATS = 8
#: Extra attempts for a chat that failed for a reason a fresh chat can fix.
CHAT_RETRIES = 1
#: A retry cannot fix these: nothing is listening, or the account is signed out.
FATAL_CODES = frozenset({"EXTENSION_NOT_CONNECTED", "SIGNED_OUT", "NO_TAB", "BAD_PARAMS"})

#: Topic-agnostic lenses, after the `youtube-ai-keywords` rules (sub-topic +
#: phrasing style + one specific angle). Rotated across the chats of a batch.
DEFAULT_ANGLES = [
    "beginner questions and how-to tutorials (skill level: beginner, step by step)",
    "specific tools and products, comparisons (X vs Y) and alternatives",
    "concrete use cases and workflows for one job, industry or profession",
    "advanced and technical deep dives, niche sub-topics that few channels cover",
    "news, trends and what changed this year, with the year in the phrase",
    "free, cheap and open-source options, budget setups",
    "reviews, tests, best-of and underrated roundups",
    "problems, mistakes and troubleshooting",
]

_STOP = frozenset(
    {"a", "an", "the", "of", "for", "to", "in", "on", "at", "with"}
    | {"and", "or", "by", "from", "is", "are", "you", "your", "my"}
)
_WORD = re.compile(r"\w+", re.UNICODE)


def near_key(text: str) -> str:
    """Same words in any order, minus small filler words and plural `s`, are one key."""
    words: list[str] = []
    for word in _WORD.findall(text.casefold()):
        if word in _STOP:
            continue
        if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
            word = word[:-1]
        words.append(word)
    return " ".join(sorted(set(words)))


def _error_dict(error: GeminiError) -> dict[str, Any]:
    return {"code": error.code, "message": error.message}


def _stopped(gemini: Gemini) -> bool:
    server: Any = getattr(gemini, "server", None)
    return server is not None and getattr(server, "running", True) is False


def generate(gemini: Gemini, params: dict[str, Any], emit: Emit | None = None) -> dict[str, Any]:
    """`action.generate_keywords` with `chats > 1` (see the module docstring and DAEMON.md)."""
    from . import actions

    topic = actions._str(params.get("topic"))
    if not topic:
        raise GeminiError("BAD_PARAMS", "generate_keywords needs a `topic`")
    chats = min(MAX_CHATS, max(1, actions._int(params.get("chats"), default=1)))
    per_chat_param = actions._int(params.get("perChat"), default=0)
    count_param = actions._int(params.get("count"), default=0)
    if count_param > 0:
        count = count_param
        per_chat = per_chat_param if per_chat_param > 0 else math.ceil(count / chats)
    elif per_chat_param > 0:
        per_chat, count = per_chat_param, per_chat_param * chats
    else:
        count = 100
        per_chat = math.ceil(count / chats)
    angles = actions._str_list(params.get("angles")) or DEFAULT_ANGLES
    user_avoid = actions._str_list(params.get("avoid"))
    notes = actions._str(params.get("notes"))

    seen_exact = {actions._norm(a) for a in user_avoid}
    seen_near = {near_key(a) for a in user_avoid}
    found: list[str] = []
    dropped = 0
    reports: list[dict[str, Any]] = []
    raws: list[str] = []
    model = ""
    last_error: GeminiError | None = None
    fatal: GeminiError | None = None

    for index in range(chats):
        requested = per_chat
        if fatal is not None or _stopped(gemini):
            error = fatal or GeminiError(
                "EXTENSION_NOT_CONNECTED", "the bridge was stopped before this chat ran"
            )
            last_error = last_error or error
            reports.append(
                {
                    "index": index,
                    "requested": requested,
                    "received": 0,
                    "ok": False,
                    "error": _error_dict(error),
                    "durationMs": 0,
                    "skipped": True,
                }
            )
            fatal = fatal or error
            continue
        if len(found) >= count:
            reports.append(
                {
                    "index": index,
                    "requested": 0,
                    "received": 0,
                    "ok": True,
                    "error": None,
                    "durationMs": 0,
                    "skipped": True,
                }
            )
            continue
        angle = angles[index % len(angles)]
        chat_notes = "\n\n".join(
            p
            for p in (
                notes,
                f"This is chat {index + 1} of {chats}; the other chats cover other angles, "
                "so stay inside this one. "
                f"Angle for this batch: {angle}.",
            )
            if p
        )
        chat_params = {
            **params,
            "count": requested,
            "avoid": user_avoid + found,
            "notes": chat_notes,
            "newChat": True,
        }
        message = actions._keywords_message(chat_params)
        started = time.monotonic()
        new: list[str] = []
        error: GeminiError | None = None
        for _attempt in range(1 + CHAT_RETRIES):
            error = None
            try:
                raw, used_model = actions._ask(
                    gemini, chat_params, message, skill=actions.KEYWORDS_SKILL
                )
                parsed, _ = actions.parse_keywords(raw)
                if not parsed:
                    raise ActionParseFailed(
                        message="no keywords found in the reply", details={"raw": raw}
                    )
            except GeminiError as caught:
                error = caught
                if caught.code in FATAL_CODES or _stopped(gemini):
                    break
                continue
            raws.append(raw)
            model = used_model or model
            for keyword in parsed:
                key, near = actions._norm(keyword), near_key(keyword)
                if key in seen_exact or near in seen_near:
                    dropped += 1
                    continue
                seen_exact.add(key)
                seen_near.add(near)
                new.append(keyword)
            break
        duration = int((time.monotonic() - started) * 1000)
        if error is not None:
            last_error = error
            if error.code in FATAL_CODES:
                fatal = error
            reports.append(
                {
                    "index": index,
                    "requested": requested,
                    "received": 0,
                    "ok": False,
                    "error": _error_dict(error),
                    "durationMs": duration,
                }
            )
            message_text = f"chat {index + 1} of {chats} failed: {error.message or error.code}"
        else:
            found.extend(new)
            reports.append(
                {
                    "index": index,
                    "requested": requested,
                    "received": len(new),
                    "ok": True,
                    "error": None,
                    "durationMs": duration,
                }
            )
            message_text = f"chat {index + 1} of {chats} done"
        emit_progress(
            emit,
            "generate_keywords",
            done=index + 1,
            total=chats,
            message=message_text,
            keywords=len(found),
        )

    if not found:
        if last_error is not None:
            raise last_error
        raise ActionParseFailed(
            message="no keywords found in any reply", details={"raw": "\n\n".join(raws)}
        )
    failed = any(not r["ok"] for r in reports)
    return {
        "keywords": found[:count],
        "dropped": dropped,
        "chats": reports,
        "partial": failed,
        "raw": "\n\n---\n\n".join(raws),
        "model": model,
    }
