"""The browser and the add-on: find the browser, get the extension into it, make sure a Gemini
window exists.

The names, signatures and wire shapes are the old contract's (DAEMON.md "bridge.browser_info /
ensure_window / install_addon"), now typed by main (`gemini-protocol.ts`, `geminiResultSchemas`).

Firefox (the default) is fully automatic: the app owns a dedicated profile, starts Firefox on it
with a loopback debugging port, and installs the add-on built from the extension's folder as a
*temporary* add-on over that port (firefox_session.py, firefox_rdp.py). Temporary add-ons need no
signature -- the only way onto release Firefox without AMO keys -- and are gone when that Firefox
exits, so every launch installs the current build: that is how the add-on is added and kept up to
date without anyone clicking. Edge and Chrome cannot be driven like that; for them this module
launches the browser on Gemini and waits for an extension the person loaded once (unpacked).

Where things are comes from the daemon's argv (plan D2, D3), as a `BrowserPaths`: the managed
profile (`<userData>/gemini-profile`) and the extension's source folder. Until the extension is in
the app (step 6) that folder does not exist: `browser_info` says the add-on is `missing` and that
it comes with a later update, and `ensure_window` / `install_addon` fail with
`ADDON_INSTALL_FAILED` (`reason: "no extension"`).

Every call takes the browser settings as params -- `browser`, `browserPath`, `profileMode` -- so a
change in Settings applies to the next call without restarting the daemon.

`emit(event, data)` is the optional callable the daemon passes so a slow step can say where it is:
`emit("daemon", {"state": "browser_launching", "browser": "firefox", "message": "Starting
Firefox..."})`, and likewise `browser_ready` and `addon_installing` (DAEMON.md, "progress
events"). It may be None.
"""

from __future__ import annotations

import importlib.util
import json
import logging
import os
import subprocess
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from types import ModuleType
from typing import TYPE_CHECKING, Any, cast

from ..errors import (
    AddonInstallFailed,
    AddonUnsigned,
    BrowserLaunchFailed,
    BrowserNotFound,
    GeminiError,
)
from ..progress import Emit
from . import firefox_detect, firefox_profile, firefox_session, window_guard
from .firefox_rdp import RdpClient, RdpError

if TYPE_CHECKING:  # pragma: no cover - typing only, avoids a circular import
    from ..client import Gemini

log = logging.getLogger(__name__)

#: The Firefox add-on's id -- `browser_specific_settings.gecko.id` in the Firefox manifest.
GEMINI_ADDON_ID = "gemini-bridge@gratovo.app"

GEMINI_URL = "https://gemini.google.com/app"
BROWSERS = ("firefox", "edge", "chrome")
_NAMES = {"firefox": "Mozilla Firefox", "edge": "Microsoft Edge", "chrome": "Google Chrome"}
_OTHER_EXE = {
    "edge": ("msedge.exe", ("Microsoft", "Edge", "Application")),
    "chrome": ("chrome.exe", ("Google", "Chrome", "Application")),
}

NO_EXTENSION_MESSAGE = (
    "The Gemini extension is not part of this version of the app yet; it comes with a later "
    "update. Until then the app cannot open Gemini."
)


@dataclass(frozen=True, slots=True)
class BrowserPaths:
    """Where the browser half finds things on this computer, from the daemon's argv."""

    #: The managed Firefox profile (`<userData>/gemini-profile`), kept for good: the Google
    #: sign-in lives in it.
    profile_dir: Path
    #: The extension's source (`services/gemini-extension`, step 6); it may not exist yet.
    extension_dir: Path
    #: Where a Mozilla-signed build would be. None until step 6 decides; the old app looked in
    #: a folder of its repository.
    signed_xpi_dir: Path | None = None
    #: This launch's bridge token (plan D13), from the daemon's environment, or None. Written into
    #: the Firefox build only (`bridge-token.js`); kept out of `repr` so no log line can show it.
    token: str | None = field(default=None, repr=False)

    @property
    def build_dir(self) -> Path:
        """Where the Firefox flavour of the add-on is built: beside the profile, in the app's own
        folder (the old app built it in its app-data folder beside the profile too)."""
        return self.profile_dir.parent / "gemini-addon"

    @property
    def has_extension(self) -> bool:
        """The add-on itself is there: its `manifest.json`, not just a folder (the folder held
        only a README before the add-on was ported)."""
        return (self.extension_dir / "manifest.json").is_file()


# --- small helpers ---------------------------------------------------------------------


def _selected(params: dict[str, Any]) -> str:
    browser = str(params.get("browser") or "firefox").strip().lower()
    return browser if browser in (*BROWSERS, "system") else "firefox"


def _no_extension() -> AddonInstallFailed:
    return AddonInstallFailed(
        None, NO_EXTENSION_MESSAGE, {"method": "none", "reason": "no extension"}
    )


def shipped_version(paths: BrowserPaths) -> str | None:
    try:
        manifest: object = json.loads(
            (paths.extension_dir / "manifest.json").read_text(encoding="utf-8")
        )
    except OSError, ValueError:
        return None
    if not isinstance(manifest, dict):
        return None
    fields = cast("dict[str, Any]", manifest)
    version: object = fields.get("version")
    return version if isinstance(version, str) else None


def signed_xpi(paths: BrowserPaths) -> Path | None:
    folder = paths.signed_xpi_dir
    if folder is None or not folder.is_dir():
        return None
    found = sorted(folder.glob("*.xpi"))
    return found[-1] if found else None


def _load_build_addon(paths: BrowserPaths) -> ModuleType:
    """The extension's own packer, `<extension>/tools/build_addon.py`, loaded only if there."""
    path = paths.extension_dir / "tools" / "build_addon.py"
    if not path.is_file():
        raise AddonInstallFailed(
            None,
            f"the add-on packer is missing ({path})",
            {"method": "rdp_temporary", "reason": "no_packer"},
        )
    spec = importlib.util.spec_from_file_location("gemini_build_addon", path)
    if spec is None or spec.loader is None:
        raise AddonInstallFailed(
            None,
            f"the add-on packer cannot be loaded ({path})",
            {"method": "rdp_temporary", "reason": "no_packer"},
        )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


#: The managed profiles whose Firefox got the add-on from this process, so with this launch's token.
#: A Firefox left running by an earlier bridge holds an add-on with that launch's token, which this
#: bridge refuses (plan D13), so it is installed again rather than waited for.
_installed_this_launch: set[Path] = set()


def _installed_now(paths: BrowserPaths) -> bool:
    return paths.token is None or paths.profile_dir in _installed_this_launch


def _token_kwargs(paths: BrowserPaths) -> dict[str, str]:
    """`token=` for the packer only when there is one, so a run without a token builds as before."""
    return {} if paths.token is None else {"token": paths.token}


def build_firefox_addon(paths: BrowserPaths) -> Path:
    """Builds the Firefox flavour of the extension into the app's folder; returns that folder.

    With a token (plan D13) the build carries it in `bridge-token.js`, first of the background
    scripts, so the add-on can show it in its `hello`."""
    out = paths.build_dir
    try:
        _load_build_addon(paths).build_firefox(paths.extension_dir, out, **_token_kwargs(paths))
    except GeminiError:
        raise
    except Exception as error:  # reported as an install failure with the reason
        raise AddonInstallFailed(
            None,
            f"could not build the Firefox add-on: {error}",
            {"method": "rdp_temporary", "reason": "build_failed"},
        ) from error
    return out


def _say(emit: Emit | None, state: str, browser: str, message: str) -> None:
    if emit is None:
        return
    try:
        emit("daemon", {"state": state, "browser": browser, "message": message})
    except Exception:  # advisory only
        log.debug("emit failed", exc_info=True)


def _find_other(browser: str) -> str | None:
    """Edge / Chrome: App Paths, then the usual folders. None when not installed."""
    exe, rel = _OTHER_EXE[browser]
    if sys.platform != "win32":
        return None
    registry = firefox_detect.default_registry()
    for hive in ("HKCU", "HKLM"):
        values = (
            registry.values(hive, "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\" + exe)
            or {}
        )
        path = values.get("")
        if isinstance(path, str) and Path(path.strip('"')).is_file():
            return path.strip('"')
    for var in ("ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"):
        root = os.environ.get(var)
        if root and Path(root, *rel, exe).is_file():
            return str(Path(root, *rel, exe))
    return None


def _browser_entries(params: dict[str, Any], paths: BrowserPaths) -> list[dict[str, Any]]:
    selected = _selected(params)
    configured = str(params.get("browserPath") or "") if selected == "firefox" else ""
    entries: list[dict[str, Any]] = []
    installs, tried = firefox_detect.find_firefox(configured)
    session = firefox_session.attach(paths.profile_dir)
    if installs:
        best = installs[0]
        entries.append(
            {
                "id": "firefox",
                "name": _NAMES["firefox"],
                "path": best.path,
                "version": best.version or None,
                "channel": best.channel,
                "installed": True,
                "running": session is not None,
                "canRunUnsigned": best.can_run_unsigned,
            }
        )
    else:
        entries.append(
            {
                "id": "firefox",
                "name": _NAMES["firefox"],
                "path": configured or None,
                "version": None,
                "channel": "unknown",
                "installed": False,
                "running": False,
                "canRunUnsigned": False,
                "tried": tried,
            }
        )
    for other in ("edge", "chrome"):
        path = _find_other(other)
        entries.append(
            {
                "id": other,
                "name": _NAMES[other],
                "path": path,
                "version": None,
                "channel": "stable" if path else "unknown",
                "installed": path is not None,
                "running": False,
                "canRunUnsigned": True,
            }
        )
    return entries


def _firefox_or_raise(params: dict[str, Any]) -> firefox_detect.FirefoxInstall:
    configured = str(params.get("browserPath") or "")
    installs, tried = firefox_detect.find_firefox(configured)
    if not installs:
        where = f"at {configured}" if configured.strip() else "on this computer"
        raise BrowserNotFound(
            None,
            f"Firefox was not found {where}. Install Firefox, or pick another browser "
            "(or the right path) in Settings > Gemini.",
            {"browser": "firefox", "tried": tried},
        )
    return installs[0]


# --- bridge.browser_info ----------------------------------------------------------------


def browser_info(
    params: dict[str, Any], *, paths: BrowserPaths, data_dir: Path | None = None
) -> dict[str, Any]:
    """`bridge.browser_info`: which browsers are here, which is selected, what state the add-on
    is in.

    Never raises for "the browser is not there": that is said in `addon.message` and the
    per-browser fields.
    """
    del data_dir  # the contract passes it; nothing here needs it
    params = params or {}
    selected = _selected(params)
    profile_dir = paths.profile_dir
    shipped = shipped_version(paths)
    try:
        browsers = _browser_entries(params, paths)
    except Exception as error:  # never throws
        log.warning("browser detection failed: %s", error)
        browsers = []
    xpi = signed_xpi(paths)
    addon: dict[str, Any] = {
        "id": GEMINI_ADDON_ID,
        "shippedVersion": shipped,
        "installedVersion": None,
        "state": "unknown",
        "signed": xpi is not None,
        "restartNeeded": False,
        "method": "none",
        "message": "",
    }
    if not paths.has_extension:
        addon.update(state="missing", message=NO_EXTENSION_MESSAGE)
    elif selected == "firefox":
        ff = next((b for b in browsers if b["id"] == "firefox"), None)
        session = firefox_session.attach(profile_dir)
        if ff is None or not ff["installed"]:
            addon.update(
                state="missing",
                message="Firefox is not installed (or the path in Settings is wrong). "
                "Install Firefox, or choose Edge or Chrome.",
            )
        elif session is not None and session.addon_version:
            outdated = shipped is not None and session.addon_version != shipped
            addon.update(
                installedVersion=session.addon_version,
                method="rdp_temporary",
                state="outdated" if outdated else "temporary",
                message=(
                    "The Gemini window runs an older add-on; it is updated the next time the "
                    "app opens it."
                    if outdated
                    else "Installed in the app's Firefox window."
                ),
            )
        else:
            addon.update(
                state="missing",
                message="Installed automatically when the app opens its Firefox window "
                "(no signing or clicks needed).",
            )
    else:
        name = _NAMES.get(selected, "your browser")
        addon.update(
            method="unpacked",
            state="unknown",
            message=f"Load the extension once in {name}: open its extensions page, turn on "
            f"Developer mode, choose Load unpacked, and pick {paths.extension_dir}.",
        )
    return {
        "selected": selected,
        "browsers": browsers,
        "addon": addon,
        "profile": {
            "mode": str(params.get("profileMode") or "managed"),
            "dir": str(profile_dir),
            "exists": profile_dir.is_dir(),
        },
        "extensionDir": str(paths.extension_dir),
        "xpiPath": str(xpi) if xpi else None,
    }


# --- the Firefox steps ---------------------------------------------------------------------


def _start_firefox(
    params: dict[str, Any],
    paths: BrowserPaths,
    emit: Emit | None,
    *,
    url: str,
    headless: bool = False,
) -> firefox_session.Session:
    """Reattaches to the managed Firefox or launches it; raises BrowserNotFound /
    BrowserLaunchFailed."""
    if str(params.get("profileMode") or "managed") == "existing":
        raise BrowserLaunchFailed(
            None,
            "The app starts Firefox only on its own profile. Switch Settings > Gemini > "
            "Profile to 'App-managed', or open your own Firefox with the add-on installed.",
            {"browser": "firefox", "reason": "existing_profile_not_automated"},
        )
    profile_dir = paths.profile_dir
    session = firefox_session.attach(profile_dir)
    if session is not None:
        return session
    install = _firefox_or_raise(params)
    if firefox_profile.profile_in_use(profile_dir):
        raise BrowserLaunchFailed(
            None,
            "The app's Firefox profile is open in a Firefox the app did not start "
            "(or is still closing). Close that window and try again.",
            {"browser": "firefox", "reason": "profile_in_use"},
        )
    _say(emit, "browser_launching", "firefox", "Starting Firefox...")
    try:
        session = firefox_session.launch(install.path, profile_dir, url=url, headless=headless)
    except OSError as error:
        raise BrowserLaunchFailed(
            None, f"Firefox did not start: {error}", {"browser": "firefox", "reason": str(error)}
        ) from error
    if not firefox_session.wait_until_up(session, 30.0):
        raise BrowserLaunchFailed(
            None,
            "Firefox started but did not open its debugging port within 30 s.",
            {"browser": "firefox", "reason": "rdp_port_closed"},
        )
    _say(emit, "browser_ready", "firefox", "Firefox is open.")
    return session


def _install_temporary(
    paths: BrowserPaths, session: firefox_session.Session, emit: Emit | None
) -> str:
    _say(emit, "addon_installing", "firefox", "Installing the Gemini add-on...")
    addon_dir = build_firefox_addon(paths)
    try:
        with RdpClient(session.rdp_port, wait_s=15.0) as rdp:
            rdp.install_temporary_addon(addon_dir)
    except RdpError as error:
        raise AddonInstallFailed(
            None,
            f"Firefox did not take the add-on: {error}",
            {"method": "rdp_temporary", "reason": str(error)},
        ) from error
    _installed_this_launch.add(paths.profile_dir)
    version = shipped_version(paths) or "?"
    firefox_session.record_addon(paths.profile_dir, session, version)
    return version


# --- bridge.install_addon ---------------------------------------------------------------------


def install_addon(
    params: dict[str, Any],
    *,
    paths: BrowserPaths,
    data_dir: Path | None = None,
    emit: Emit | None = None,
) -> dict[str, Any]:
    """`bridge.install_addon`: get the add-on into the browser, or update it.

    Params: `{browser?, mode?: "auto" | "temporary" | "permanent", force?: false, browserPath?,
    profileMode?}`. Result: `{state, version, method, restartNeeded, message}`. Failures that are
    the browser's doing raise `AddonUnsigned` / `AddonInstallFailed` / `BrowserNotFound` /
    `BrowserLaunchFailed` (errors.py); no extension in the app yet is `AddonInstallFailed`.
    """
    del data_dir  # the contract passes it; nothing here needs it
    params = params or {}
    if not paths.has_extension:
        raise _no_extension()
    selected = _selected(params)
    mode = str(params.get("mode") or "auto")
    if selected != "firefox":
        name = _NAMES.get(selected, "This browser")
        return {
            "state": "unknown",
            "version": None,
            "method": "unpacked",
            "restartNeeded": False,
            "message": f"{name} cannot be given an add-on by another program: load "
            f"{paths.extension_dir} once on its extensions page (Developer mode > Load unpacked).",
        }
    if mode == "permanent":
        install = _firefox_or_raise(params)
        xpi = signed_xpi(paths)
        if xpi is None and not install.can_run_unsigned:
            raise AddonUnsigned(
                None,
                "A permanent add-on on release Firefox must be signed by Mozilla, and this build "
                "has no signed copy yet. The app installs it automatically as a temporary add-on "
                "instead (mode 'auto').",
                {
                    "browser": "firefox",
                    "channel": install.channel,
                    "hint": "sign it with the owner's AMO keys",
                },
            )
        source = xpi
        if source is None:
            source = paths.build_dir.with_suffix(".xpi")
            # Carries this launch's token like the temporary build does (plan D13): it is only
            # admitted while this bridge runs, and the next launch installs a fresh copy.
            _load_build_addon(paths).build_xpi(paths.extension_dir, source, **_token_kwargs(paths))
        firefox_profile.sideload_xpi(paths.profile_dir, source, GEMINI_ADDON_ID)
        return {
            "state": "installed",
            "version": shipped_version(paths),
            "method": "profile_xpi",
            "restartNeeded": True,
            "message": "Installed into the app's Firefox profile; it takes effect when that "
            "Firefox restarts.",
        }
    session = _start_firefox(params, paths, emit, url=str(params.get("url") or GEMINI_URL))
    current = shipped_version(paths)
    if (
        session.addon_version
        and session.addon_version == current
        and _installed_now(paths)
        and not params.get("force")
    ):
        return {
            "state": "temporary",
            "version": current,
            "method": "rdp_temporary",
            "restartNeeded": False,
            "message": "Already installed and up to date.",
        }
    version = _install_temporary(paths, session, emit)
    return {
        "state": "temporary",
        "version": version,
        "method": "rdp_temporary",
        "restartNeeded": False,
        "message": "Installed in the app's Firefox window.",
    }


# --- bridge.ensure_window -----------------------------------------------------------------------


class _Steps:
    """The `steps` list of an ensure_window result: name, ok, ms, detail for each thing tried."""

    def __init__(self) -> None:
        self.items: list[dict[str, Any]] = []

    def run[T](self, name: str, fn: Callable[[], T]) -> T:
        started = time.monotonic()
        try:
            value = fn()
        except Exception as error:
            self.items.append(
                {
                    "name": name,
                    "ok": False,
                    "ms": int((time.monotonic() - started) * 1000),
                    "detail": str(getattr(error, "message", "") or error),
                }
            )
            raise
        ok = value is not False
        self.items.append(
            {
                "name": name,
                "ok": ok,
                "ms": int((time.monotonic() - started) * 1000),
                "detail": "",
            }
        )
        return value

    def note(self, name: str, ok: bool, detail: str = "") -> None:
        self.items.append({"name": name, "ok": ok, "ms": 0, "detail": detail})


def _wait_hello(gemini: Gemini, timeout_s: float = 3.0) -> dict[str, Any]:
    """The extension's `hello`: the socket opens a moment before that first frame arrives."""
    deadline = time.monotonic() + timeout_s
    while gemini.server.hello is None and gemini.server.connected and time.monotonic() < deadline:
        time.sleep(0.05)
    return gemini.server.hello or {}


def _hello_account(gemini: Gemini) -> dict[str, Any] | None:
    hello = gemini.server.hello or {}
    account: object = hello.get("account")
    if not isinstance(account, dict):
        return None
    found: dict[str, Any] = account  # pyright: ignore[reportUnknownVariableType]
    return found if found.get("name") or found.get("email") else None


def _open_tab(gemini: Gemini, focus: bool, url: str) -> dict[str, Any] | None:
    params: dict[str, Any] = {"focus": bool(focus)}
    if url and url != GEMINI_URL:
        params["url"] = url
    tab: object = gemini.call("open", params, timeout=40.0)
    if isinstance(tab, dict):
        opened: dict[str, Any] = tab  # pyright: ignore[reportUnknownVariableType]
        return {"tabId": opened.get("tabId"), "url": opened.get("url")}
    return None


def _launch_other(browser: str, url: str) -> None:
    path = _find_other(browser)
    if path is None:
        raise BrowserNotFound(
            None,
            f"{_NAMES[browser]} was not found on this computer.",
            {"browser": browser, "tried": []},
        )
    creationflags = 0
    startupinfo = None
    if sys.platform == "win32":
        creationflags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS
        startupinfo = window_guard.minimized_startupinfo()
    # Minimized, and never in front of what the person is doing (window_guard.py).
    guard = window_guard.WindowGuard(path).start()
    try:
        subprocess.Popen(  # noqa: S603 - the browser found on this computer, and the Gemini URL
            [path, url],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            close_fds=True,
            creationflags=creationflags,
            startupinfo=startupinfo,
        )
    except OSError as error:
        raise BrowserLaunchFailed(
            None,
            f"{_NAMES[browser]} did not start: {error}",
            {"browser": browser, "reason": str(error)},
        ) from error
    guard.watch()


def ensure_window(
    gemini: Gemini, params: dict[str, Any], *, paths: BrowserPaths, emit: Emit | None = None
) -> dict[str, Any]:
    """`bridge.ensure_window`: the extension is connected and a Gemini tab exists, launching and
    installing as needed.

    Params: `{browser?, focus?: false, timeoutS?: 45, url?, browserPath?, profileMode?}`.
    Idempotent. Result: `{connected, launched, reused, browser, addon: {state, version, method},
    tab: {tabId, url} | null, account: {name, email, index} | null, steps: [{name, ok, ms,
    detail}], message}`. "Could not get there" is `connected: false` with the failed step and a
    `message` that says what is missing and what to do -- never an exception. The one exception:
    no extension in the app yet (plan D3) is `ADDON_INSTALL_FAILED`, before anything is started.
    """
    params = params or {}
    if not paths.has_extension:
        raise _no_extension()
    selected = _selected(params)
    focus = bool(params.get("focus"))
    url = str(params.get("url") or GEMINI_URL)
    deadline = time.monotonic() + float(params.get("timeoutS") or 45)
    steps = _Steps()
    addon: dict[str, Any] = {"state": "unknown", "version": None, "method": "none"}
    result: dict[str, Any] = {
        "connected": False,
        "launched": False,
        "reused": False,
        "browser": selected,
        "addon": addon,
        "tab": None,
        "account": None,
        "steps": steps.items,
        "message": "",
    }

    def remaining(cap: float) -> float:
        return max(0.5, min(cap, deadline - time.monotonic()))

    steps.note("daemon_listening", gemini.server.running)
    try:
        hello = gemini.server.hello or {}
        if gemini.server.connected and (
            selected == "system" or hello.get("browser") in (None, "other", selected)
        ):
            result["reused"] = True
            steps.note("extension_connected", True, "already connected")
        elif selected == "firefox":
            session = steps.run(
                "launch_browser", lambda: _start_firefox(params, paths, emit, url=url)
            )
            result["launched"] = session.launched
            if (
                session.launched
                or session.addon_version != shipped_version(paths)
                or not _installed_now(paths)
            ):
                steps.run("install_addon", lambda: _install_temporary(paths, session, emit))
            connected = steps.run(
                "extension_connect", lambda: gemini.server.wait_for_extension(remaining(20.0))
            )
            if not connected and not session.launched:
                # Reattached to a Firefox whose temporary add-on is gone (removed, or it
                # crashed): put it back once.
                steps.run("reinstall_addon", lambda: _install_temporary(paths, session, emit))
                connected = steps.run(
                    "extension_connect_retry",
                    lambda: gemini.server.wait_for_extension(remaining(20.0)),
                )
            addon = {
                "state": "temporary",
                "version": session.addon_version,
                "method": "rdp_temporary",
            }
            result["addon"] = addon
            if not connected:
                result["message"] = (
                    "Firefox is open but the add-on did not connect. Check that nothing blocks "
                    "127.0.0.1, then press Open Gemini again."
                )
                return result
        else:
            if selected in ("edge", "chrome"):
                steps.run("launch_browser", lambda: _launch_other(selected, url))
                result["launched"] = True
            addon = {"state": "unknown", "version": None, "method": "unpacked"}
            result["addon"] = addon
            connected = steps.run(
                "extension_connect", lambda: gemini.server.wait_for_extension(remaining(25.0))
            )
            if not connected:
                name = _NAMES.get(selected, "Your browser")
                result["message"] = (
                    f"{name} is open but the Gemini Bridge extension did not connect. Load it "
                    f"once: its extensions page > Developer mode > Load unpacked > "
                    f"{paths.extension_dir}."
                )
                return result
        result["connected"] = True
        hello = _wait_hello(gemini)
        if addon["version"] is None and hello.get("extensionVersion"):
            addon["version"] = hello.get("extensionVersion")
        result["tab"] = steps.run("open_tab", lambda: _open_tab(gemini, focus, url))
        result["account"] = _hello_account(gemini)
        if result["account"] is None:
            try:
                account: object = gemini.call("get_account", {}, timeout=10.0)
                if isinstance(account, dict):
                    found: dict[str, Any] = account  # pyright: ignore[reportUnknownVariableType]
                    if found.get("name") or found.get("email"):
                        result["account"] = {
                            "name": found.get("name"),
                            "email": found.get("email"),
                            "index": found.get("index", 0),
                        }
            except GeminiError as error:
                steps.note("read_account", False, error.code)
        if result["account"] is None:
            result["message"] = (
                "Sign in to Google in the Gemini window that just opened; the app will pick it up."
            )
    except GeminiError as error:
        result["connected"] = bool(gemini.server.connected)
        if error.code == "SIGNED_OUT":
            result["message"] = "Sign in to Google in the Gemini window; the app will pick it up."
        else:
            result["message"] = error.message or str(error)
    return result
