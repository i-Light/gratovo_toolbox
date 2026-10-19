"""The browser and the add-on: find the browser, get the extension into it, make
sure a Gemini window exists.

The names, signatures and wire shapes are the contract's (CONTRACT_GEMINI.md
sections 1, 3.1-3.3 and 6; DAEMON.md "bridge.browser_info / ensure_window /
install_addon").

Firefox (the default) is fully automatic: the app owns a dedicated profile,
starts Firefox on it with a loopback debugging port, and installs the add-on
built from `pipeline/gemini_extension/` as a *temporary* add-on over that port
(firefox_session.py, firefox_rdp.py). Temporary add-ons need no signature --
the only way onto release Firefox without AMO keys -- and are gone when that
Firefox exits, so every launch installs the current build: that is how the
add-on is added and kept up to date without anyone clicking. Edge and Chrome
cannot be driven like that; for them this module launches the browser on
Gemini and waits for an extension the person loaded once (unpacked).

Every call takes the browser settings as params -- `browser`, `browserPath`,
`profileMode` -- so a change in Settings applies to the next call without
restarting the daemon.

`emit(event, data)` is the optional callable the daemon passes so a slow step
can say where it is: `emit("daemon", {"state": "browser_launching", "browser":
"firefox", "message": "Starting Firefox..."})`, and likewise `browser_ready`
and `addon_installing` (DAEMON.md, "progress events"). It may be None.
"""

from __future__ import annotations

import importlib.util
import json
import logging
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable, Optional

from . import firefox_detect, firefox_profile, firefox_session, window_guard
from .errors import AddonInstallFailed, AddonUnsigned, BrowserLaunchFailed, BrowserNotFound, GeminiError
from .firefox_rdp import RdpClient, RdpError
from .progress import Emit

if TYPE_CHECKING:  # pragma: no cover - typing only, avoids a circular import
    from .client import Gemini

log = logging.getLogger("gemini_bridge.browser")

#: The Firefox add-on's id -- `browser_specific_settings.gecko.id` in the
#: Firefox manifest. Dart's `geminiAddonId` is the twin of this constant.
GEMINI_ADDON_ID = "gemini-bridge@gratovo.app"

GEMINI_URL = "https://gemini.google.com/app"
BROWSERS = ("firefox", "edge", "chrome")
_NAMES = {"firefox": "Mozilla Firefox", "edge": "Microsoft Edge", "chrome": "Google Chrome"}
_OTHER_EXE = {
    "edge": ("msedge.exe", ("Microsoft", "Edge", "Application")),
    "chrome": ("chrome.exe", ("Google", "Chrome", "Application")),
}

PIPELINE_DIR = Path(__file__).resolve().parent.parent
EXTENSION_DIR = PIPELINE_DIR / "gemini_extension"
#: Where a Mozilla-signed build would ship (never a dist/ or build/ folder: those are git-ignored).
SIGNED_XPI_DIR = PIPELINE_DIR / "gemini_addon_signed"


# --- small helpers ---------------------------------------------------------------------

def _selected(params: dict) -> str:
    browser = str(params.get("browser") or "firefox").strip().lower()
    return browser if browser in BROWSERS + ("system",) else "firefox"


def _profile_dir(params: dict) -> Path:
    return firefox_profile.default_profile_dir()


def _build_dir() -> Path:
    return firefox_profile.app_support_dir() / "gemini-addon"


def shipped_version() -> Optional[str]:
    try:
        return json.loads((EXTENSION_DIR / "manifest.json").read_text(encoding="utf-8")).get("version")
    except (OSError, ValueError):
        return None


def signed_xpi() -> Optional[Path]:
    if not SIGNED_XPI_DIR.is_dir():
        return None
    found = sorted(SIGNED_XPI_DIR.glob("*.xpi"))
    return found[-1] if found else None


def _load_build_addon():
    path = EXTENSION_DIR / "tools" / "build_addon.py"
    spec = importlib.util.spec_from_file_location("gemini_build_addon", path)
    if spec is None or spec.loader is None or not path.is_file():
        raise AddonInstallFailed(None, f"the add-on packer is missing ({path})",
                                 {"method": "rdp_temporary", "reason": "no_packer"})
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def build_firefox_addon() -> Path:
    """Builds the Firefox flavour of the extension into the app-data folder; returns that folder."""
    out = _build_dir()
    try:
        _load_build_addon().build_firefox(EXTENSION_DIR, out)
    except GeminiError:
        raise
    except Exception as error:  # noqa: BLE001 - reported as an install failure with the reason
        raise AddonInstallFailed(None, f"could not build the Firefox add-on: {error}",
                                 {"method": "rdp_temporary", "reason": "build_failed"}) from error
    return out


def _say(emit: Optional[Emit], state: str, browser: str, message: str) -> None:
    if emit is None:
        return
    try:
        emit("daemon", {"state": state, "browser": browser, "message": message})
    except Exception:  # noqa: BLE001 - advisory only
        log.debug("emit failed", exc_info=True)


def _find_other(browser: str) -> Optional[str]:
    """Edge / Chrome: App Paths, then the usual folders. None when not installed."""
    exe, rel = _OTHER_EXE[browser]
    if sys.platform != "win32":
        return None
    registry = firefox_detect.default_registry()
    for hive in ("HKCU", "HKLM"):
        values = registry.values(hive, "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\" + exe) or {}
        path = values.get("")
        if isinstance(path, str) and Path(path.strip('"')).is_file():
            return path.strip('"')
    for var in ("ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"):
        root = os.environ.get(var)
        if root and Path(root, *rel, exe).is_file():
            return str(Path(root, *rel, exe))
    return None


def _browser_entries(params: dict) -> list[dict]:
    selected = _selected(params)
    configured = str(params.get("browserPath") or "") if selected == "firefox" else ""
    entries = []
    installs, tried = firefox_detect.find_firefox(configured)
    session = firefox_session.attach(_profile_dir(params))
    if installs:
        best = installs[0]
        entries.append({"id": "firefox", "name": _NAMES["firefox"], "path": best.path, "version": best.version or None,
                        "channel": best.channel, "installed": True, "running": session is not None,
                        "canRunUnsigned": best.can_run_unsigned})
    else:
        entries.append({"id": "firefox", "name": _NAMES["firefox"], "path": configured or None, "version": None,
                        "channel": "unknown", "installed": False, "running": False, "canRunUnsigned": False,
                        "tried": tried})
    for other in ("edge", "chrome"):
        path = _find_other(other)
        entries.append({"id": other, "name": _NAMES[other], "path": path, "version": None,
                        "channel": "stable" if path else "unknown", "installed": path is not None,
                        "running": False, "canRunUnsigned": True})
    return entries


def _firefox_or_raise(params: dict) -> firefox_detect.FirefoxInstall:
    configured = str(params.get("browserPath") or "")
    installs, tried = firefox_detect.find_firefox(configured)
    if not installs:
        where = f"at {configured}" if configured.strip() else "on this computer"
        raise BrowserNotFound(None, f"Firefox was not found {where}. Install Firefox, or pick another browser "
                                    "(or the right path) in Settings > Gemini.", {"browser": "firefox", "tried": tried})
    return installs[0]


# --- bridge.browser_info ----------------------------------------------------------------

def browser_info(params: dict, *, data_dir: Optional[Path] = None) -> dict:
    """`bridge.browser_info`: which browsers are here, which is selected, what state the add-on is in.

    Never raises for "the browser is not there": that is said in
    `addon.message` and the per-browser fields.
    """
    params = params or {}
    selected = _selected(params)
    profile_dir = _profile_dir(params)
    shipped = shipped_version()
    try:
        browsers = _browser_entries(params)
    except Exception as error:  # noqa: BLE001 - never throws
        log.warning("browser detection failed: %s", error)
        browsers = []
    xpi = signed_xpi()
    addon: dict = {"id": GEMINI_ADDON_ID, "shippedVersion": shipped, "installedVersion": None, "state": "unknown",
                   "signed": xpi is not None, "restartNeeded": False, "method": "none", "message": ""}
    if selected == "firefox":
        ff = next((b for b in browsers if b["id"] == "firefox"), None)
        session = firefox_session.attach(profile_dir)
        if ff is None or not ff["installed"]:
            addon.update(state="missing", message="Firefox is not installed (or the path in Settings is wrong). "
                                                  "Install Firefox, or choose Edge or Chrome.")
        elif session is not None and session.addon_version:
            outdated = shipped is not None and session.addon_version != shipped
            addon.update(installedVersion=session.addon_version, method="rdp_temporary",
                         state="outdated" if outdated else "temporary",
                         message=("The Gemini window runs an older add-on; it is updated the next time the app "
                                  "opens it." if outdated else "Installed in the app's Firefox window."))
        else:
            addon.update(state="missing", message="Installed automatically when the app opens its Firefox window "
                                                  "(no signing or clicks needed).")
    else:
        name = _NAMES.get(selected, "your browser")
        addon.update(method="unpacked", state="unknown",
                     message=f"Load the extension once in {name}: open its extensions page, turn on Developer mode, "
                             f"choose Load unpacked, and pick {EXTENSION_DIR}.")
    return {
        "selected": selected,
        "browsers": browsers,
        "addon": addon,
        "profile": {"mode": str(params.get("profileMode") or "managed"), "dir": str(profile_dir),
                    "exists": profile_dir.is_dir()},
        "extensionDir": str(EXTENSION_DIR),
        "xpiPath": str(xpi) if xpi else None,
    }


# --- the Firefox steps ---------------------------------------------------------------------

def _start_firefox(params: dict, emit: Optional[Emit], *, url: str,
                   headless: bool = False) -> firefox_session.Session:
    """Reattaches to the managed Firefox or launches it; raises BrowserNotFound / BrowserLaunchFailed."""
    if str(params.get("profileMode") or "managed") == "existing":
        raise BrowserLaunchFailed(None, "The app starts Firefox only on its own profile. Switch Settings > Gemini > "
                                        "Profile to 'App-managed', or open your own Firefox with the add-on installed.",
                                  {"browser": "firefox", "reason": "existing_profile_not_automated"})
    profile_dir = _profile_dir(params)
    session = firefox_session.attach(profile_dir)
    if session is not None:
        return session
    install = _firefox_or_raise(params)
    if firefox_profile.profile_in_use(profile_dir):
        raise BrowserLaunchFailed(None, "The app's Firefox profile is open in a Firefox the app did not start "
                                        "(or is still closing). Close that window and try again.",
                                  {"browser": "firefox", "reason": "profile_in_use"})
    _say(emit, "browser_launching", "firefox", "Starting Firefox...")
    try:
        session = firefox_session.launch(install.path, profile_dir, url=url, headless=headless)
    except OSError as error:
        raise BrowserLaunchFailed(None, f"Firefox did not start: {error}",
                                  {"browser": "firefox", "reason": str(error)}) from error
    if not firefox_session.wait_until_up(session, 30.0):
        raise BrowserLaunchFailed(None, "Firefox started but did not open its debugging port within 30 s.",
                                  {"browser": "firefox", "reason": "rdp_port_closed"})
    _say(emit, "browser_ready", "firefox", "Firefox is open.")
    return session


def _install_temporary(params: dict, session: firefox_session.Session, emit: Optional[Emit]) -> str:
    _say(emit, "addon_installing", "firefox", "Installing the Gemini add-on...")
    addon_dir = build_firefox_addon()
    try:
        with RdpClient(session.rdp_port, wait_s=15.0) as rdp:
            rdp.install_temporary_addon(addon_dir)
    except RdpError as error:
        raise AddonInstallFailed(None, f"Firefox did not take the add-on: {error}",
                                 {"method": "rdp_temporary", "reason": str(error)}) from error
    version = shipped_version() or "?"
    firefox_session.record_addon(_profile_dir(params), session, version)
    return version


# --- bridge.install_addon ---------------------------------------------------------------------

def install_addon(params: dict, *, data_dir: Optional[Path] = None,
                  emit: Optional[Emit] = None) -> dict:
    """`bridge.install_addon`: get the add-on into the browser, or update it.

    Params: `{browser?, mode?: "auto" | "temporary" | "permanent", force?: false, browserPath?, profileMode?}`.
    Result: `{state, version, method, restartNeeded, message}`. Failures that are
    the browser's doing raise `AddonUnsigned` / `AddonInstallFailed` /
    `BrowserNotFound` / `BrowserLaunchFailed` (errors.py).
    """
    params = params or {}
    selected = _selected(params)
    mode = str(params.get("mode") or "auto")
    if selected != "firefox":
        name = _NAMES.get(selected, "This browser")
        return {"state": "unknown", "version": None, "method": "unpacked", "restartNeeded": False,
                "message": f"{name} cannot be given an add-on by another program: load {EXTENSION_DIR} once on its "
                           "extensions page (Developer mode > Load unpacked)."}
    if mode == "permanent":
        install = _firefox_or_raise(params)
        xpi = signed_xpi()
        if xpi is None and not install.can_run_unsigned:
            raise AddonUnsigned(None, "A permanent add-on on release Firefox must be signed by Mozilla, and this build "
                                      "has no signed copy yet. The app installs it automatically as a temporary add-on "
                                      "instead (mode 'auto').",
                                {"browser": "firefox", "channel": install.channel,
                                 "hint": "sign it with the owner's AMO keys: scripts/sign_firefox_addon.ps1"})
        source = xpi
        if source is None:
            source = _build_dir().with_suffix(".xpi")
            _load_build_addon().build_xpi(EXTENSION_DIR, source)
        firefox_profile.sideload_xpi(_profile_dir(params), source, GEMINI_ADDON_ID)
        return {"state": "installed", "version": shipped_version(), "method": "profile_xpi", "restartNeeded": True,
                "message": "Installed into the app's Firefox profile; it takes effect when that Firefox restarts."}
    session = _start_firefox(params, emit, url=str(params.get("url") or GEMINI_URL))
    current = shipped_version()
    if session.addon_version and session.addon_version == current and not params.get("force"):
        return {"state": "temporary", "version": current, "method": "rdp_temporary", "restartNeeded": False,
                "message": "Already installed and up to date."}
    version = _install_temporary(params, session, emit)
    return {"state": "temporary", "version": version, "method": "rdp_temporary", "restartNeeded": False,
            "message": "Installed in the app's Firefox window."}


# --- bridge.ensure_window -----------------------------------------------------------------------

class _Steps:
    """The `steps` list of an ensure_window result: name, ok, ms, detail for each thing tried."""

    def __init__(self) -> None:
        self.items: list[dict] = []

    def run(self, name: str, fn: Callable[[], Any]) -> Any:
        started = time.monotonic()
        try:
            value = fn()
        except Exception as error:
            self.items.append({"name": name, "ok": False, "ms": int((time.monotonic() - started) * 1000),
                               "detail": str(getattr(error, "message", "") or error)})
            raise
        ok = value is not False
        self.items.append({"name": name, "ok": ok, "ms": int((time.monotonic() - started) * 1000), "detail": ""})
        return value

    def note(self, name: str, ok: bool, detail: str = "") -> None:
        self.items.append({"name": name, "ok": ok, "ms": 0, "detail": detail})


def _wait_hello(gemini: "Gemini", timeout_s: float = 3.0) -> dict:
    """The extension's `hello`: the socket opens a moment before that first frame arrives."""
    deadline = time.monotonic() + timeout_s
    while gemini.server.hello is None and gemini.server.connected and time.monotonic() < deadline:
        time.sleep(0.05)
    return gemini.server.hello or {}


def _hello_account(gemini: "Gemini") -> Optional[dict]:
    hello = gemini.server.hello or {}
    account = hello.get("account")
    return account if isinstance(account, dict) and (account.get("name") or account.get("email")) else None


def _open_tab(gemini: "Gemini", focus: bool, url: str) -> Optional[dict]:
    params: dict = {"focus": bool(focus)}
    if url and url != GEMINI_URL:
        params["url"] = url
    tab = gemini.call("open", params, timeout=40.0)
    if isinstance(tab, dict):
        return {"tabId": tab.get("tabId"), "url": tab.get("url")}
    return None


def _launch_other(browser: str, url: str) -> None:
    path = _find_other(browser)
    if path is None:
        raise BrowserNotFound(None, f"{_NAMES[browser]} was not found on this computer.",
                              {"browser": browser, "tried": []})
    kwargs: dict = {"stdin": subprocess.DEVNULL, "stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL,
                    "close_fds": True}
    if sys.platform == "win32":
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS
        kwargs["startupinfo"] = window_guard.minimized_startupinfo()
    # Minimized, and never in front of what the person is doing (window_guard.py).
    guard = window_guard.WindowGuard(path).start()
    try:
        subprocess.Popen([path, url], **kwargs)
    except OSError as error:
        raise BrowserLaunchFailed(None, f"{_NAMES[browser]} did not start: {error}",
                                  {"browser": browser, "reason": str(error)}) from error
    guard.watch()


def ensure_window(gemini: "Gemini", params: dict, *, emit: Optional[Emit] = None) -> dict:
    """`bridge.ensure_window`: the extension is connected and a Gemini tab exists, launching and installing as needed.

    Params: `{browser?, focus?: false, timeoutS?: 45, url?, browserPath?, profileMode?}`. Idempotent.
    Result: `{connected, launched, reused, browser, addon: {state, version,
    method}, tab: {tabId, url} | null, account: {name, email, index} | null,
    steps: [{name, ok, ms, detail}], message}`. "Could not get there" is
    `connected: false` with the failed step and a `message` that says what is
    missing and what to do -- never an exception.
    """
    params = params or {}
    selected = _selected(params)
    focus = bool(params.get("focus"))
    url = str(params.get("url") or GEMINI_URL)
    deadline = time.monotonic() + float(params.get("timeoutS") or 45)
    steps = _Steps()
    result: dict = {"connected": False, "launched": False, "reused": False, "browser": selected,
                    "addon": {"state": "unknown", "version": None, "method": "none"},
                    "tab": None, "account": None, "steps": steps.items, "message": ""}

    def remaining(cap: float) -> float:
        return max(0.5, min(cap, deadline - time.monotonic()))

    steps.note("daemon_listening", gemini.server.running)
    try:
        hello = gemini.server.hello or {}
        if gemini.server.connected and (selected == "system" or hello.get("browser") in (None, "other", selected)):
            result["reused"] = True
            steps.note("extension_connected", True, "already connected")
        elif selected == "firefox":
            session = steps.run("launch_browser", lambda: _start_firefox(params, emit, url=url))
            result["launched"] = session.launched
            if session.launched or session.addon_version != shipped_version():
                steps.run("install_addon", lambda: _install_temporary(params, session, emit))
            connected = steps.run("extension_connect", lambda: gemini.server.wait_for_extension(remaining(20.0)))
            if not connected and not session.launched:
                # Reattached to a Firefox whose temporary add-on is gone (removed, or it crashed): put it back once.
                steps.run("reinstall_addon", lambda: _install_temporary(params, session, emit))
                connected = steps.run("extension_connect_retry",
                                      lambda: gemini.server.wait_for_extension(remaining(20.0)))
            result["addon"] = {"state": "temporary", "version": session.addon_version, "method": "rdp_temporary"}
            if not connected:
                result["message"] = ("Firefox is open but the add-on did not connect. Check that nothing blocks "
                                     "127.0.0.1, then press Open Gemini again.")
                return result
        else:
            if selected in ("edge", "chrome"):
                steps.run("launch_browser", lambda: _launch_other(selected, url))
                result["launched"] = True
            result["addon"] = {"state": "unknown", "version": None, "method": "unpacked"}
            connected = steps.run("extension_connect", lambda: gemini.server.wait_for_extension(remaining(25.0)))
            if not connected:
                name = _NAMES.get(selected, "Your browser")
                result["message"] = (f"{name} is open but the Gemini Bridge extension did not connect. Load it once: "
                                     f"its extensions page > Developer mode > Load unpacked > {EXTENSION_DIR}.")
                return result
        result["connected"] = True
        hello = _wait_hello(gemini)
        if result["addon"]["version"] is None and hello.get("extensionVersion"):
            result["addon"]["version"] = hello.get("extensionVersion")
        result["tab"] = steps.run("open_tab", lambda: _open_tab(gemini, focus, url))
        result["account"] = _hello_account(gemini)
        if result["account"] is None:
            try:
                account = gemini.call("get_account", {}, timeout=10.0)
                if isinstance(account, dict) and (account.get("name") or account.get("email")):
                    result["account"] = {"name": account.get("name"), "email": account.get("email"),
                                         "index": account.get("index", 0)}
            except GeminiError as error:
                steps.note("read_account", False, error.code)
        if result["account"] is None:
            result["message"] = "Sign in to Google in the Gemini window that just opened; the app will pick it up."
    except GeminiError as error:
        result["connected"] = bool(gemini.server.connected)
        if error.code == "SIGNED_OUT":
            result["message"] = "Sign in to Google in the Gemini window; the app will pick it up."
        else:
            result["message"] = error.message or str(error)
    return result
