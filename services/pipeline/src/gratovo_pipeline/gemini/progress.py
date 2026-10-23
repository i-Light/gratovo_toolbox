"""Progress events: how a long action says how far it has got (DAEMON.md "progress events").

An action that runs for minutes (a keyword batch of several chats, a gem saved through its editor)
takes an optional `emit(event, data)` callable. The daemon passes one that writes an `event` line,
so what reaches main is

    {"type": "event", "event": "progress",
     "data": {"action": "generate_keywords", "done": 2, "total": 4,
              "keywords": 137, "message": "chat 2 of 4 done"}}

`emit_progress` builds that payload so every action spells it the same way, and it never raises:
progress is advisory, and an action must not fail because nobody is listening.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

log = logging.getLogger(__name__)

# `emit(event, data)`: what the daemon hands an action to report with.
type Emit = Callable[[str, dict[str, Any]], None]


def emit_progress(
    emit: Emit | None, action: str, done: int, total: int, message: str = "", **extra: Any
) -> None:
    """Emits one `progress` event; does nothing when `emit` is None; never raises.

    `action` is the action's name without the `action.` prefix, `done` and `total` count its steps
    (`total` 0 while unknown), `message` is a sentence for the person, and `extra`
    (`keywords=137`) rides along in the payload.
    """
    if emit is None:
        return
    data: dict[str, Any] = {
        "action": action,
        "done": int(done),
        "total": int(total),
        "message": message,
    }
    data.update(extra)
    try:
        emit("progress", data)
    except Exception:  # reporting progress must never fail the action
        log.debug("progress emit failed for %s", action, exc_info=True)
