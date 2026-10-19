"""Progress events: how a long action tells the app how far it has got.

Owner: the contract commit -- frozen (DAEMON.md, "progress events"). Nobody
else edits the shape; an action that needs a field of its own passes it as
`**extra`.

An action that runs for minutes (a keyword batch of several chats, a gem
saved through its editor) takes an optional `emit(event, data)` callable. The
daemon passes one that writes an `event` line to stdout and
`actions.run_action` hands it on, so what reaches the app is

    {"type": "event", "event": "progress",
     "data": {"action": "generate_keywords", "done": 2, "total": 4,
              "keywords": 137, "message": "chat 2 of 4 done"}}

`emit_progress` builds that payload so every action spells it the same way,
and it never raises: progress is advisory, and an action must not fail
because the app stopped listening.
"""

from __future__ import annotations

import logging
from typing import Any, Callable, Optional

log = logging.getLogger("gemini_bridge.progress")

#: `emit(event, data)` -- what the daemon hands an action to report with.
#: `event` is the wire event name (`progress`), `data` its JSON-able payload.
Emit = Callable[[str, dict], None]


def emit_progress(emit: Optional[Emit], action: str, done: int, total: int,
                  message: str = "", **extra: Any) -> None:
    """Emits one `progress` event; does nothing when `emit` is None; never raises.

    `action` is the action's name without the `action.` prefix, `done` / `total`
    count its steps (`total` 0 when that is not known yet), `message` is a
    sentence for the person, and anything in `extra` (`keywords=137`) rides
    along in the payload.
    """
    if emit is None:
        return
    data: dict = {"action": action, "done": int(done), "total": int(total), "message": message}
    data.update(extra)
    try:
        emit("progress", data)
    except Exception:  # noqa: BLE001 - reporting progress must never fail the action
        log.debug("progress emit failed for %s", action, exc_info=True)
