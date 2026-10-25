"""The exceptions the bridge raises, one subclass per wire error code.

Every failure the extension reports comes back over the socket as `{code, message, details}`
(PROTOCOL.md §2). `error_from_payload` turns that into the matching subclass, so callers can write
`except ElementNotFound` instead of comparing strings, while `except GeminiError` still catches
everything the bridge can raise, including the errors that never cross the wire.

The first positional argument is always the code, so the constructor reads like the wire payload:
`GeminiError(code, message, details)`. Subclasses know their own code, so leaving it out fills it
in: `ElementNotFound(message="no prompt box")`.

Every code here is in `geminiErrorCodes` (apps/desktop/src/main/pipeline/gemini-protocol.ts); a
test keeps the two lists equal. The actions' and the skills' errors live here too (the old code
kept them in actions.py and skills.py), so one table maps every code.
"""

from __future__ import annotations

from typing import Any

Details = dict[str, Any]


class GeminiError(Exception):
    """Base of every error the bridge raises; carries `.code`, `.message`, `.details`."""

    code: str = "UNKNOWN"

    def __init__(
        self, code: str | None = None, message: str = "", details: Details | None = None
    ) -> None:
        self.code = code or type(self).code
        self.message: str = message or ""
        # Always a dict, never None: callers reach into it without checking, as the protocol
        # promises `details` is always an object.
        self.details: Details = dict(details) if details else {}
        super().__init__(self.code, self.message, self.details)

    def __str__(self) -> str:
        return f"{self.code}: {self.message}" if self.message else self.code

    def __repr__(self) -> str:
        return f"{type(self).__name__}({self.code!r}, {self.message!r}, {self.details!r})"

    def to_payload(self) -> Details:
        """The wire shape, `{code, message, details}`."""
        return {"code": self.code, "message": self.message, "details": self.details}


# --- errors that come over the wire (PROTOCOL.md §2) ---


class NoTab(GeminiError):
    """No gemini.google.com tab exists and one could not be opened."""

    code = "NO_TAB"


class TabNotReady(GeminiError):
    """The tab exists but its content script did not answer."""

    code = "TAB_NOT_READY"


class SignedOut(GeminiError):
    """The tab is on a sign-in page or shows no prompt box."""

    code = "SIGNED_OUT"


class ElementNotFound(GeminiError):
    """None of the locator strategies matched; `details` has what was tried."""

    code = "ELEMENT_NOT_FOUND"


class GeminiPageError(GeminiError):
    """The page itself is showing an error (a toast, a limit reached, ...)."""

    code = "GEMINI_ERROR"


class Busy(GeminiError):
    """Gemini is still generating and the call did not ask to interrupt."""

    code = "BUSY"


class BridgeTimeout(GeminiError):
    """A waited-for condition, or the call itself, did not happen in time."""

    code = "TIMEOUT"


class SendNotAccepted(GeminiError):
    """Send was clicked but the page did not react."""

    code = "SEND_NOT_ACCEPTED"


class TypeFailed(GeminiError):
    """Text typed into the prompt box does not read back as expected."""

    code = "TYPE_FAILED"


class ModelNotFound(GeminiError):
    """`set_model` could not match a menu entry; `details["available"]` lists them."""

    code = "MODEL_NOT_FOUND"


class ThinkingNotSet(GeminiError):
    """The thinking level asked for could not be selected and read back; nothing was sent."""

    code = "THINKING_NOT_SET"


class BadParams(GeminiError):
    """Unknown method or invalid params."""

    code = "BAD_PARAMS"


class InternalError(GeminiError):
    """An unexpected exception; `details["stack"]` may have the trace."""

    code = "INTERNAL"


class GemUiNotFound(ElementNotFound):
    """An element of the gem editor could not be found. An `ElementNotFound`, so whatever handles
    a missing element (the healing report: `tried`, `lastKnown`, `suggestions`) handles this too."""

    code = "GEM_UI_NOT_FOUND"


class GemSaveFailed(GeminiError):
    """The gem editor did not accept the save; `details`: `{reason, fieldErrors?}`."""

    code = "GEM_SAVE_FAILED"


# --- the bridge's own (DAEMON.md §2) ---


class ExtensionNotConnected(GeminiError):
    """No extension socket is open (never connected, or dropped mid-call)."""

    code = "EXTENSION_NOT_CONNECTED"


class AccountNotFound(GeminiError):
    """`ensure_account` ran out of accounts; `.tried` lists the ones that are signed in."""

    code = "ACCOUNT_NOT_FOUND"

    def __init__(
        self,
        code: str | None = None,
        message: str = "",
        details: Details | None = None,
        tried: list[tuple[int, Details]] | None = None,
    ) -> None:
        super().__init__(code, message, details)
        # `[(index, account), ...]` in the order they were visited.
        self.tried: list[tuple[int, Details]] = list(tried) if tried else []
        self.details.setdefault("tried", [{"index": i, "account": a} for i, a in self.tried])


class NoSuggestion(GeminiError):
    """`bridge.heal` had nothing to apply; `details`: `{element}`."""

    code = "NO_SUGGESTION"


class JobFailed(GeminiError):
    """A queued job ended in `error` or `cancelled`; `.job` is the job as last reported."""

    code = "JOB_FAILED"

    @property
    def job(self) -> Details | None:
        job: object = self.details.get("job")
        return job if isinstance(job, dict) else None  # pyright: ignore[reportUnknownVariableType]


class BrowserNotFound(GeminiError):
    """The browser is not installed or its path is not a browser; `details`: `{browser, tried}`."""

    code = "BROWSER_NOT_FOUND"


class AddonUnsigned(GeminiError):
    """Release Firefox refuses an unsigned permanent add-on and no temporary install was possible;
    `details`: `{browser, channel, hint}`."""

    code = "ADDON_UNSIGNED"


class AddonInstallFailed(GeminiError):
    """Installing or updating the add-on failed; `details`: `{method, reason}`."""

    code = "ADDON_INSTALL_FAILED"


class BrowserLaunchFailed(GeminiError):
    """The browser did not start, or exited; `details`: `{browser, exitCode?, reason}`."""

    code = "BROWSER_LAUNCH_FAILED"


class NotImplementedYet(GeminiError):
    """A method the daemon registers whose body isn't written yet ("not implemented yet")."""

    code = "NOT_IMPLEMENTED"


class Paused(GeminiError):
    """A prompt was held back: Gemini refused, or showed three page errors in 15 minutes, so the
    bridge sends nothing for 30 minutes (pause.py, the owner's rule); `details`: `{until}`, ISO
    8601 UTC."""

    code = "PAUSED"


# --- the actions' and the skills' ---


class ActionParseFailed(GeminiError):
    """Gemini answered but the reply could not be parsed into the action's result; `{raw}`."""

    code = "ACTION_PARSE_FAILED"


class ActionRefused(GeminiError):
    """Gemini answered with its generic refusal; `details`: `{raw, model}`. It pauses the bridge
    (pause.py), so it is never retried at once."""

    code = "ACTION_REFUSED"


class SkillFileMissing(GeminiError):
    """An action needed a skill file that is not there; `details`: `{path}`."""

    code = "SKILL_FILE_MISSING"


class SkillInvalid(GeminiError):
    """A skill folder the Skills page would refuse; `details`: `{problems}`."""

    code = "SKILL_INVALID"


class SkillVerifyFailed(GeminiError):
    """The page's copy of a skill differs from the package; `details`: `{missing, extra}`."""

    code = "SKILL_VERIFY_FAILED"


ERROR_CLASSES: tuple[type[GeminiError], ...] = (
    NoTab,
    TabNotReady,
    SignedOut,
    ElementNotFound,
    GeminiPageError,
    Busy,
    BridgeTimeout,
    SendNotAccepted,
    TypeFailed,
    ModelNotFound,
    ThinkingNotSet,
    BadParams,
    InternalError,
    GemUiNotFound,
    GemSaveFailed,
    ExtensionNotConnected,
    AccountNotFound,
    NoSuggestion,
    JobFailed,
    BrowserNotFound,
    AddonUnsigned,
    AddonInstallFailed,
    BrowserLaunchFailed,
    NotImplementedYet,
    Paused,
    ActionParseFailed,
    ActionRefused,
    SkillFileMissing,
    SkillInvalid,
    SkillVerifyFailed,
)

_BY_CODE: dict[str, type[GeminiError]] = {cls.code: cls for cls in ERROR_CLASSES}

# Codes nothing catches by class: the extension's from its Skills page, mode switch and job queue,
# and the comms engine's WRONG_CHAT. They come through as a plain `GeminiError` with the code kept.
UNCLASSED_CODES: frozenset[str] = frozenset(
    {
        "MODE_NOT_SET",
        "DROP_FAILED",
        "WORKER_RESTARTED",
        "SKILL_NOT_FOUND",
        "SKILL_FILE_NOT_FOUND",
        "SKILL_UI_NOT_FOUND",
        "SKILL_UPLOAD_FAILED",
        "SKILL_SAVE_FAILED",
        "SKILL_TOGGLE_FAILED",
        "SKILL_DELETE_FAILED",
        "WRONG_CHAT",
    }
)

# Every code an error may carry on the wire: the classes', the unclassed ones, and "UNKNOWN".
ERROR_CODES: frozenset[str] = frozenset({*_BY_CODE, *UNCLASSED_CODES, GeminiError.code})


def error_from_payload(payload: object) -> GeminiError:
    """Maps a wire error `{code, message, details}` to the right subclass.

    Tolerant on purpose: a payload that isn't a dict, or has no code, still becomes a
    `GeminiError` rather than a second exception on top of the first. An unknown code becomes
    `UNKNOWN`, keeping the original in `details["code"]`, so every error the bridge writes is one
    main knows.
    """
    if not isinstance(payload, dict):
        return GeminiError("UNKNOWN", "malformed error payload")
    wire: dict[str, Any] = payload  # pyright: ignore[reportUnknownVariableType]
    code = str(wire.get("code") or "UNKNOWN")
    message = str(wire.get("message") or "")
    raw_details: object = wire.get("details")
    details: Details
    if isinstance(raw_details, dict):
        details = dict(raw_details)  # pyright: ignore[reportUnknownArgumentType]
    else:
        details = {"raw": raw_details} if raw_details is not None else {}
    cls = _BY_CODE.get(code)
    if cls is None and code in UNCLASSED_CODES:
        return GeminiError(code, message, details)
    if cls is None:
        if code != "UNKNOWN":
            details = {**details, "code": code}
        return GeminiError("UNKNOWN", message, details)
    return cls(code, message, details)
