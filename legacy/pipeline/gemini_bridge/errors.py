"""The exceptions the bridge raises, one subclass per wire error code.

Every failure the extension reports comes back over the socket as
`{"code", "message", "details"}` (PROTOCOL.md §2). `error_from_payload` turns
that into the matching subclass so callers can write `except ElementNotFound`
instead of comparing strings, while `except GeminiError` still catches
everything the bridge can throw -- including the errors that never cross the
wire (`ExtensionNotConnected`, `AccountNotFound`, `JobFailed`).

The first positional argument is ALWAYS the code, on every class, so the
constructor reads the same as the wire payload: `GeminiError(code, message,
details)`. Subclasses know their own code, so `code=None` (or leaving it out
by keyword) fills it in: `ElementNotFound(message="no prompt box")`.
"""

from __future__ import annotations

from typing import Any, Optional


class GeminiError(Exception):
    """Base of every error the bridge raises; carries `.code`, `.message`, `.details`."""

    #: the wire code this class stands for; subclasses override it and it is
    #: what `code=None` falls back to.
    code: str = "ERROR"

    def __init__(self, code: Optional[str] = None, message: str = "",
                 details: Optional[dict] = None):
        self.code = code or type(self).code
        self.message = message or ""
        # Always a dict, never None -- the CLI and `wait()` reach into it
        # without checking, exactly like the protocol promises `details`
        # is always an object.
        self.details: dict = dict(details) if details else {}
        super().__init__(self.code, self.message, self.details)

    def __str__(self) -> str:
        return f"{self.code}: {self.message}" if self.message else self.code

    def __repr__(self) -> str:
        return f"{type(self).__name__}({self.code!r}, {self.message!r}, {self.details!r})"

    def to_payload(self) -> dict:
        """The wire shape, `{code, message, details}` -- handy for logs and `--json`."""
        return {"code": self.code, "message": self.message, "details": self.details}


# --- errors that come over the wire (PROTOCOL.md §2) --------------------------

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
    """The page itself is showing an error (toast, limit reached, ...)."""
    code = "GEMINI_ERROR"


class Busy(GeminiError):
    """Gemini is still generating and the call did not ask to interrupt."""
    code = "BUSY"


class BridgeTimeout(GeminiError):
    """A waited-for condition (or the RPC itself) did not happen in time."""
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
    """Unexpected exception inside the extension; `details["stack"]` has the trace."""
    code = "INTERNAL"


# --- errors raised on the Python side only ------------------------------------

class ExtensionNotConnected(GeminiError):
    """No extension socket is open (never connected, or dropped mid-call)."""
    code = "EXTENSION_NOT_CONNECTED"


class JobFailed(GeminiError):
    """A queued job ended in `error` or `cancelled`; `.job` is the full job dict."""
    code = "JOB_FAILED"

    @property
    def job(self) -> Optional[dict]:
        """The job object as the extension last reported it."""
        return self.details.get("job")


class AccountNotFound(GeminiError):
    """`ensure_account` ran out of accounts; `.tried` lists the ones that ARE signed in."""
    code = "ACCOUNT_NOT_FOUND"

    def __init__(self, code: Optional[str] = None, message: str = "",
                 details: Optional[dict] = None, tried: Optional[list] = None):
        super().__init__(code, message, details)
        #: `[(index, account_dict), ...]` in the order they were visited.
        self.tried: list = list(tried) if tried else []
        self.details.setdefault(
            "tried", [{"index": i, "account": a} for i, a in self.tried])


# --- errors added with the browser and gem work (DAEMON.md section 2) ------------
# All of them live here, in one block, so the owners of browser_manager.py and
# gems.py never have to edit this file.

class BrowserNotFound(GeminiError):
    """The configured browser is not installed or its path is not a browser; `details`: `{browser, tried}`."""
    code = "BROWSER_NOT_FOUND"


class AddonUnsigned(GeminiError):
    """Release Firefox refuses an unsigned permanent add-on and no temporary install was possible; `details`: `{browser, channel, hint}`."""
    code = "ADDON_UNSIGNED"


class AddonInstallFailed(GeminiError):
    """Installing or updating the add-on failed; `details`: `{method, reason}`."""
    code = "ADDON_INSTALL_FAILED"


class BrowserLaunchFailed(GeminiError):
    """The browser process did not start, or exited; `details`: `{browser, exitCode?, reason}`."""
    code = "BROWSER_LAUNCH_FAILED"


class GemUiNotFound(ElementNotFound):
    """An element of the gem editor could not be found; `details` are the standard element diagnostics.

    An `ElementNotFound`, so whatever already handles a missing element (the
    healing report: `tried`, `lastKnown`, `suggestions`) handles this too.
    """
    code = "GEM_UI_NOT_FOUND"


class GemSaveFailed(GeminiError):
    """The gem editor did not accept the save; `details`: `{reason, fieldErrors?}`."""
    code = "GEM_SAVE_FAILED"


class NotImplementedYet(GeminiError):
    """A method the daemon has registered but nobody has written the body of yet.

    The daemon answers a `NotImplementedError` with this code and the message
    "not implemented yet" (CONTRACT_GEMINI.md section 6); the class exists so the
    code round-trips through `error_from_payload`.
    """
    code = "NOT_IMPLEMENTED"


_BY_CODE: dict[str, type[GeminiError]] = {
    cls.code: cls
    for cls in (
        NoTab, TabNotReady, SignedOut, ElementNotFound, GeminiPageError, Busy,
        BridgeTimeout, SendNotAccepted, TypeFailed, ModelNotFound, ThinkingNotSet, BadParams,
        InternalError, ExtensionNotConnected, JobFailed, AccountNotFound,
        BrowserNotFound, AddonUnsigned, AddonInstallFailed, BrowserLaunchFailed,
        GemUiNotFound, GemSaveFailed, NotImplementedYet,
    )
}


def error_from_payload(payload: Any) -> GeminiError:
    """Maps a wire error `{code, message, details}` to the right subclass.

    Tolerant on purpose: a payload that is not even a dict, or has no code,
    still becomes a `GeminiError` rather than a second exception on top of
    the first -- the original failure is the one worth reporting.
    """
    if not isinstance(payload, dict):
        return GeminiError("UNKNOWN", f"malformed error payload: {payload!r}")
    code = str(payload.get("code") or "UNKNOWN")
    message = str(payload.get("message") or "")
    details = payload.get("details")
    if not isinstance(details, dict):
        details = {"raw": details} if details is not None else {}
    cls = _BY_CODE.get(code, GeminiError)
    return cls(code, message, details)
