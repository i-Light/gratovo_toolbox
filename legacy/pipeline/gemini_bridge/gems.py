"""Gems -- create, change and read a Gemini gem through its editor page.

Python opens the page, the extension does the rest (`content/gems.js`):

  * `gem_create`: `/u/N/gems/create`, then the extension's `gem_create` fills
    name, description and instructions and saves;
  * `gem_update` / `gem_read`: `/u/N/gems/edit/<id>`, then `gem_update` (writes
    only the fields that differ, saves only when something changed) or
    `gem_read`;
  * `gem_diagnose`: either page, then `gem_diagnostics` -- every gem element's
    locator report plus a map of the editor's fields and buttons, for when
    Gemini changes its editor (CLI: `python -m gemini_bridge gem-diag`).

`N` is the account the Gemini tab is on now (`get_url`), so a gem is made in
the account that is being used. The extension never navigates: a navigation
would unload the script running the method. Wire shapes: DAEMON.md
("action.gem_*") and PROTOCOL.md ("gem_* methods").

`actions.py` imports this module when it loads, so this module must not import
`actions` at the top. `emit(event, data)` is the optional progress callable
(`progress.py`); it may be None.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, Any, Optional

from .errors import BadParams, GemUiNotFound, GeminiError
from .progress import Emit, emit_progress

if TYPE_CHECKING:  # pragma: no cover - typing only, avoids a circular import
    from .client import Gemini

GEMINI_ORIGIN = "https://gemini.google.com"
_GEM_ID = re.compile(r"/gems?/(?:edit/)?([A-Za-z0-9_-]{6,})(?:[/?#]|$)")
_BARE_ID = re.compile(r"^[A-Za-z0-9_-]{6,}$")

#: Default budgets (seconds) for the extension call, per the contract.
READ_TIMEOUT_S = 60.0
WRITE_TIMEOUT_S = 180.0


def gem_id(gem: Any) -> str:
    """The id in a gem URL (`/gem/<id>`, `/gems/edit/<id>`) or a bare id; `BAD_PARAMS` otherwise."""
    text = gem.strip() if isinstance(gem, str) else ""
    match = _GEM_ID.search(text)
    if match and match.group(1) not in ("create", "view"):
        return match.group(1)
    if _BARE_ID.match(text):
        return text
    raise BadParams(message=f"not a gem id or gem URL: {gem!r}")


def _account_index(gemini: "Gemini") -> int:
    index = gemini.call("get_url").get("accountIndex")
    return index if isinstance(index, int) and index >= 0 else 0


def _open_editor(gemini: "Gemini", path: str, timeout: float) -> str:
    """Opens `path` of the gem editor under the current account; returns the URL it landed on.

    Gemini sends a gem that does not exist (or belongs to another account) back
    to its gem list or the chat page -- that is reported here, before the
    extension looks for a form that is not there.
    """
    url = f"{GEMINI_ORIGIN}/u/{_account_index(gemini)}{path}"
    landed = str(gemini.navigate(url, timeout=timeout).get("url") or "")
    if "/gems/" not in landed or ("/gems/edit/" in path and "/gems/edit/" not in landed):
        raise GemUiNotFound(
            message=f"the gem editor did not open: asked for {url}, landed on {landed or 'nothing'}. "
                    "Is this gem in the account the Gemini tab is signed in to?",
            details={"element": "gemEditor", "url": landed, "requestedUrl": url})
    return landed


def _timeout(params: dict, default: float) -> float:
    value = params.get("timeoutS")
    try:
        return float(value) if value is not None and float(value) > 0 else default
    except (TypeError, ValueError):
        return default


def _text(params: dict, key: str) -> Optional[str]:
    value = params.get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        raise BadParams(message=f"`{key}` must be text")
    return value


def _extension(gemini: "Gemini", method: str, params: dict, timeout: float) -> dict:
    return gemini.call(method, {**params, "timeoutMs": int(timeout * 1000)}, timeout=timeout + 15)


def gem_create(gemini: "Gemini", params: dict, emit: Optional[Emit] = None) -> dict:
    """`action.gem_create`: make a new gem.

    Params: `{name, description?, instructions?, timeoutS?: 180}`.
    Result: `{url: "https://gemini.google.com/gem/<id>", gemId, name}` (`gemId`
    empty when the editor saved but never showed the new id).
    Errors: `GEM_UI_NOT_FOUND` (an element of the editor, with the standard
    element diagnostics), `GEM_SAVE_FAILED` (`{reason, fieldErrors?}`).
    """
    name = _text(params, "name")
    if not name or not name.strip():
        raise BadParams(message="gem_create needs a `name`")
    fields = {"name": name, "description": _text(params, "description") or "",
              "instructions": _text(params, "instructions") or ""}
    timeout = _timeout(params, WRITE_TIMEOUT_S)
    emit_progress(emit, "gem_create", 0, 2, "opening the gem editor")
    _open_editor(gemini, "/gems/create", timeout)
    emit_progress(emit, "gem_create", 1, 2, "filling in and saving the gem")
    result = _extension(gemini, "gem_create", fields, timeout)
    emit_progress(emit, "gem_create", 2, 2, "saved")
    return {"url": result.get("url") or "", "gemId": result.get("gemId") or "", "name": result.get("name") or name}


def gem_update(gemini: "Gemini", params: dict, emit: Optional[Emit] = None) -> dict:
    """`action.gem_update`: change the given fields of a gem, leave the others alone.

    Params: `{gem (url or id), name?, description?, instructions?, timeoutS?}`.
    Result: `{url, gemId, name, changed: ["name", "instructions"]}` -- empty
    `changed` (and no save) when the gem already said all that.
    """
    ident = gem_id(params.get("gem"))
    fields = {key: value for key in ("name", "description", "instructions")
              if (value := _text(params, key)) is not None}
    if "name" in fields and not fields["name"].strip():
        raise BadParams(message="a gem cannot have an empty `name`")
    timeout = _timeout(params, WRITE_TIMEOUT_S)
    emit_progress(emit, "gem_update", 0, 2, "opening the gem editor")
    _open_editor(gemini, f"/gems/edit/{ident}", timeout)
    emit_progress(emit, "gem_update", 1, 2, "updating the gem")
    result = _extension(gemini, "gem_update", fields, timeout)
    emit_progress(emit, "gem_update", 2, 2, "saved" if result.get("changed") else "nothing to change")
    return {"url": result.get("url") or f"{GEMINI_ORIGIN}/gem/{ident}", "gemId": result.get("gemId") or ident,
            "name": result.get("name") or "", "changed": list(result.get("changed") or [])}


def gem_read(gemini: "Gemini", params: dict, emit: Optional[Emit] = None) -> dict:
    """`action.gem_read`: a gem as its editor shows it.

    Params: `{gem (url or id), timeoutS?}`.
    Result: `{url, gemId, name, description, instructions}` -- the description and
    instructions verbatim.
    """
    ident = gem_id(params.get("gem"))
    timeout = _timeout(params, READ_TIMEOUT_S)
    _open_editor(gemini, f"/gems/edit/{ident}", timeout)
    result = _extension(gemini, "gem_read", {}, timeout)
    return {"url": result.get("url") or f"{GEMINI_ORIGIN}/gem/{ident}", "gemId": result.get("gemId") or ident,
            "name": result.get("name") or "", "description": result.get("description") or "",
            "instructions": result.get("instructions") or ""}


def gem_diagnose(gemini: "Gemini", params: Optional[dict] = None) -> dict:
    """What the bridge sees in the gem editor: the create page, or `params["gem"]`'s edit page.

    Not a daemon action -- the CLI's `gem-diag` and the calibration notes use
    it. Opening a gem's edit page changes nothing.
    """
    params = params or {}
    path = f"/gems/edit/{gem_id(params['gem'])}" if params.get("gem") else "/gems/create"
    timeout = _timeout(params, READ_TIMEOUT_S)
    try:
        _open_editor(gemini, path, timeout)
    except GeminiError as error:
        # Still worth a look: the diagnostics say what page this is instead.
        if error.code != "GEM_UI_NOT_FOUND":
            raise
    return gemini.call("gem_diagnostics", {}, timeout=timeout)
