"""Gemini Bridge -- drive the Gemini web UI from Python through a browser extension.

    from gemini_bridge import Gemini

    with Gemini() as g:
        print(g.ask("Five keywords about solar panels", new_chat=True))

The contract with the extension is `PROTOCOL.md` next to this file; the
extension itself lives in `pipeline/gemini_extension/`. `README.md` has the
quickstart, the API reference and the healing workflow.
"""

from .actions import ActionParseFailed, SkillFileMissing
from .client import Gemini, Job
from .errors import (
    AccountNotFound,
    AddonInstallFailed,
    AddonUnsigned,
    BadParams,
    BridgeTimeout,
    BrowserLaunchFailed,
    BrowserNotFound,
    Busy,
    ElementNotFound,
    ExtensionNotConnected,
    GeminiError,
    GeminiPageError,
    GemSaveFailed,
    GemUiNotFound,
    InternalError,
    JobFailed,
    ModelNotFound,
    ThinkingNotSet,
    NoTab,
    NotImplementedYet,
    SendNotAccepted,
    SignedOut,
    TabNotReady,
    TypeFailed,
    error_from_payload,
)
from .server import BridgeServer

__version__ = "0.1.0"

__all__ = [
    "__version__",
    "Gemini",
    "Job",
    "BridgeServer",
    "GeminiError",
    "AccountNotFound",
    "ActionParseFailed",
    "SkillFileMissing",
    "AddonInstallFailed",
    "AddonUnsigned",
    "BadParams",
    "BridgeTimeout",
    "BrowserLaunchFailed",
    "BrowserNotFound",
    "Busy",
    "ElementNotFound",
    "ExtensionNotConnected",
    "GeminiPageError",
    "GemSaveFailed",
    "GemUiNotFound",
    "InternalError",
    "JobFailed",
    "ModelNotFound",
    "ThinkingNotSet",
    "NoTab",
    "NotImplementedYet",
    "SendNotAccepted",
    "SignedOut",
    "TabNotReady",
    "TypeFailed",
    "error_from_payload",
]
