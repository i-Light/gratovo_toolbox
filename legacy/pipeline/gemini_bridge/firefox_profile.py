"""The Firefox profile the app manages for Gemini: where it lives, its `user.js`, whether it is in use.

A dedicated profile, not the person's everyday one: it is where the temporary
add-on is installed and the remote debugging server is switched on, and
keeping that away from the everyday profile is what lets the app launch,
reattach to and (only ever its own) stop this Firefox without touching the
person's own browsing. Google sign-in lives in it, so it is kept for good:
under the per-user app folder beside `data\\` -- outside the install folder
(upgrades and side-by-side installs share it) and never inside a repository.

`user.js` is rewritten from `MANAGED_PREFS` whenever it differs; Firefox reads
it at every start, so a changed pref here reaches the profile on the next
launch. Nothing in it changes what a web page can see of the browser
(fingerprinting): it is the debugging switch, first-run quietness, the add-on
scopes, and the throttling that would otherwise slow a Gemini tab that is not
in front.
"""

from __future__ import annotations

import configparser
import json
import os
import shutil
import sys
import time
from pathlib import Path
from typing import Any, Mapping, Optional

APP_FOLDER = "Gratovo IMA ToolBox"
PROFILE_ENV = "GRATOVO_GEMINI_PROFILE"
STATE_FILE = "gratovo-bridge.json"

#: Pref name -> value, written to the managed profile's `user.js`.
MANAGED_PREFS: dict[str, Any] = {
    # The remote debugging server the temporary add-on is installed through
    # (`--start-debugger-server`, loopback only by default), without the
    # "allow incoming connection?" prompt nobody would be there to answer.
    "devtools.debugger.remote-enabled": True,
    "devtools.chrome.enabled": True,
    "devtools.debugger.prompt-connection": False,
    # A first run that opens Gemini and nothing else: no welcome, default
    # browser, terms-of-use or data-policy page competing for the window.
    "browser.shell.checkDefaultBrowser": False,
    "browser.startup.homepage_override.mstone": "ignore",
    "startup.homepage_welcome_url": "",
    "startup.homepage_welcome_url.additional": "",
    "browser.aboutwelcome.enabled": False,
    "trailhead.firstrun.didSeeAboutWelcome": True,
    "datareporting.policy.firstRunURL": "",
    "datareporting.policy.dataSubmissionPolicyBypassNotification": True,
    "termsofuse.bypassNotification": True,
    "browser.uitour.enabled": False,
    "browser.newtabpage.activity-stream.asrouter.userprefs.cfr.addons": False,
    "browser.newtabpage.activity-stream.asrouter.userprefs.cfr.features": False,
    "extensions.htmlaboutaddons.recommendations.enabled": False,
    # No remote experiments flipping prefs under an automated profile.
    "app.normandy.enabled": False,
    "app.shield.optoutstudies.enabled": False,
    # This Firefox is stopped by the app now and then: no "restore session?"
    # tab, no close-tabs prompt, and never the Safe Mode dialog that a few
    # unclean exits in a row would otherwise put in front of everything.
    "browser.sessionstore.resume_from_crash": False,
    "browser.tabs.warnOnClose": False,
    "toolkit.startup.max_resumed_crashes": -1,
    # Add-ons: profile and application scopes enabled and not auto-disabled
    # (what web-ext uses), the profile scope rescanned at start so a replaced
    # signed .xpi is picked up (bug 1664144), and unsigned add-ons allowed
    # where the build honours it (ESR, Developer Edition, Nightly -- release
    # and beta ignore this pref, which is why the temporary route exists).
    "extensions.enabledScopes": 5,
    "extensions.autoDisableScopes": 10,
    "extensions.startupScanScopes": 5,
    "xpinstall.signatures.required": False,
    # The Gemini window opens minimized and usually stays there or behind other
    # windows: do not treat a covered window as hidden, keep a hidden page's
    # timers at full speed, and do not throttle, unload or efficiency-mode it.
    "widget.windows.window_occlusion_tracking.enabled": False,
    "dom.timeout.enable_budget_timer_throttling": False,
    "dom.min_background_timeout_value": 4,
    "dom.min_background_timeout_value_without_budget_throttling": 4,
    "browser.tabs.unloadOnLowMemory": False,
    "dom.ipc.processPriorityManager.backgroundUsesEcoQoS": False,
}

_HEADER = ("// Written by the Gratovo IMA ToolBox (gemini_bridge/firefox_profile.py).\n"
           "// Rewritten on every launch: change MANAGED_PREFS there, not this file.\n")


def app_support_dir(env: Optional[Mapping[str, str]] = None) -> Path:
    """`%LOCALAPPDATA%\\Gratovo IMA ToolBox` -- the parent of the app's per-user `data\\`."""
    env = os.environ if env is None else env
    if sys.platform == "win32":
        base = env.get("LOCALAPPDATA") or env.get("APPDATA") or str(Path.home())
    else:
        base = env.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
    return Path(base) / APP_FOLDER


def default_profile_dir(env: Optional[Mapping[str, str]] = None) -> Path:
    """The managed profile: `$GRATOVO_GEMINI_PROFILE`, else `<app support>\\gemini-profile`."""
    env = os.environ if env is None else env
    override = (env.get(PROFILE_ENV) or "").strip()
    return Path(override) if override else app_support_dir(env) / "gemini-profile"


def _js_value(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    return json.dumps(str(value))


def render_user_js(prefs: Mapping[str, Any]) -> str:
    lines = [f"user_pref({json.dumps(name)}, {_js_value(value)});" for name, value in prefs.items()]
    return _HEADER + "\n".join(lines) + "\n"


def ensure_profile(profile_dir: Path, extra_prefs: Optional[Mapping[str, Any]] = None) -> bool:
    """Creates the folder and writes `user.js` when it differs; returns whether anything was written."""
    profile_dir.mkdir(parents=True, exist_ok=True)
    text = render_user_js({**MANAGED_PREFS, **(extra_prefs or {})})
    target = profile_dir / "user.js"
    try:
        if target.read_text(encoding="utf-8") == text:
            return False
    except OSError:
        pass
    tmp = target.with_suffix(".js.tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, target)
    return True


def profile_in_use(profile_dir: Path) -> bool:
    """Whether a running Firefox holds this profile.

    Firefox keeps `parent.lock` open for exclusive use while it runs (Windows)
    or holds an fcntl lock on `.parentlock` (elsewhere); a lock file left by
    a crash is openable, so it does not count.
    """
    if sys.platform == "win32":
        lock = profile_dir / "parent.lock"
        if not lock.exists():
            return False
        try:
            with open(lock, "ab"):
                return False
        except PermissionError:
            return True
        except OSError:
            return False
    lock = profile_dir / ".parentlock"
    if not lock.exists():
        return False
    try:
        import fcntl  # noqa: PLC0415 - POSIX only
        with open(lock, "ab") as handle:
            try:
                fcntl.lockf(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                return True
            fcntl.lockf(handle, fcntl.LOCK_UN)
            return False
    except OSError:
        return False


# --- the reattach state -----------------------------------------------------------

def read_state(profile_dir: Path) -> Optional[dict]:
    """What the last launch recorded (`pid`, `rdpPort`, `firefox`, `startedAt`, `addon`), or None."""
    try:
        data = json.loads((profile_dir / STATE_FILE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def write_state(profile_dir: Path, state: Mapping[str, Any]) -> None:
    profile_dir.mkdir(parents=True, exist_ok=True)
    target = profile_dir / STATE_FILE
    tmp = target.with_suffix(".json.tmp")
    tmp.write_text(json.dumps({**state, "writtenAt": time.time()}, indent=2), encoding="utf-8")
    os.replace(tmp, target)


def clear_state(profile_dir: Path) -> None:
    try:
        (profile_dir / STATE_FILE).unlink()
    except OSError:
        pass


# --- the permanent (signed) add-on --------------------------------------------------

def sideloaded_xpi(profile_dir: Path, addon_id: str) -> Path:
    return profile_dir / "extensions" / f"{addon_id}.xpi"


def sideload_xpi(profile_dir: Path, xpi: Path, addon_id: str) -> Path:
    """Puts a signed `.xpi` where Firefox installs it from at its next start.

    With the scope prefs above it is enabled without the "another program
    installed an add-on" prompt, and a replaced file is picked up as an
    update. Release Firefox disables it again if it is not Mozilla-signed.
    """
    target = sideloaded_xpi(profile_dir, addon_id)
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(".xpi.tmp")
    shutil.copyfile(xpi, tmp)
    os.replace(tmp, target)
    return target


# --- the person's own profile (`existing` mode) ---------------------------------------

def firefox_default_profile(env: Optional[Mapping[str, str]] = None) -> Optional[Path]:
    """The everyday profile Firefox opens by default, from `profiles.ini`; None when there is none.

    Only read (never written) and only for `profileMode: existing`.
    """
    env = os.environ if env is None else env
    if sys.platform == "win32":
        root = Path(env.get("APPDATA") or Path.home()) / "Mozilla" / "Firefox"
    elif sys.platform == "darwin":
        root = Path.home() / "Library" / "Application Support" / "Firefox"
    else:
        root = Path.home() / ".mozilla" / "firefox"
    ini = configparser.ConfigParser(interpolation=None, strict=False)
    try:
        if not ini.read(root / "profiles.ini", encoding="utf-8"):
            return None
    except (configparser.Error, UnicodeDecodeError):
        return None

    def resolve(path: str, relative: bool) -> Path:
        return (root / path) if relative else Path(path)

    installs = [s for s in ini.sections() if s.startswith("Install")]
    if len(installs) == 1 and ini.get(installs[0], "Default", fallback=""):
        # An install's own default is always relative to the Firefox folder.
        return resolve(ini.get(installs[0], "Default"), True)
    profiles = [s for s in ini.sections() if s.startswith("Profile")]
    chosen = next((s for s in profiles if ini.get(s, "Default", fallback="0") == "1"), None)
    chosen = chosen or (profiles[0] if profiles else None)
    if chosen is None or not ini.get(chosen, "Path", fallback=""):
        return None
    return resolve(ini.get(chosen, "Path"), ini.get(chosen, "IsRelative", fallback="1") == "1")
