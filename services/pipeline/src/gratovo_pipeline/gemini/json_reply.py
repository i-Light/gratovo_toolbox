"""Reading a JSON object out of Gemini's reply.

Tolerant on purpose: a ```json fence, or else the first balanced `{...}` in the text; anything else
is "no object" (`ACTION_PARSE_FAILED` for an action). The old bridge kept this in actions.py; it
lives on its own so the comms engine and its studio tools use it without importing the actions.
"""

from __future__ import annotations

import json
import re
from typing import Any

from gratovo_pipeline.gemini.errors import ActionParseFailed

_FENCE = re.compile(r"```(?:json|JSON)?\s*\n(.*?)\n\s*```", re.S)


def _balanced_object(text: str, start: int) -> str | None:
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
                return text[start : i + 1]
    return None


def _as_object(value: object) -> dict[str, Any] | None:
    return value if isinstance(value, dict) else None  # pyright: ignore[reportUnknownVariableType]


def extract_json(text: object, strict: bool = True) -> dict[str, Any] | None:
    """The first JSON object in a reply: a ```json fence, else the first balanced `{...}`.

    `strict=False` also reads raw line breaks inside strings, as text copied out of a chat window
    has them.
    """
    if not isinstance(text, str):
        return None
    for match in _FENCE.finditer(text):
        try:
            value = _as_object(json.loads(match.group(1), strict=strict))
        except ValueError:
            continue
        if value is not None:
            return value
    start = text.find("{")
    while start != -1:
        candidate = _balanced_object(text, start)
        if candidate is not None:
            try:
                value = _as_object(json.loads(candidate, strict=strict))
            except ValueError:
                value = None
            if value is not None:
                return value
        start = text.find("{", start + 1)
    return None


def parse_json_reply(raw: str, what: str) -> dict[str, Any]:
    """`extract_json`, or `ACTION_PARSE_FAILED` with the raw reply attached."""
    payload = extract_json(raw)
    if payload is None:
        raise ActionParseFailed(
            message=f"could not find a JSON object in Gemini's {what} reply",
            details={"raw": raw},
        )
    return payload
