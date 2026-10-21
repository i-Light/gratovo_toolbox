"""Where Firefox is on this machine, which version it is, and which release channel.

The channel decides what the add-on can be: release and beta Firefox refuse
an unsigned add-on for good (`xpinstall.signatures.required` is ignored
there), while ESR, Developer Edition and Nightly honour that pref -- so only
on those can an unsigned add-on be installed permanently, and everywhere else
it goes in as a *temporary* add-on over the remote debugging protocol
(firefox_rdp.py) for as long as that Firefox runs.

Stdlib only and Windows first: the registry is where installers write the
truth, `App Paths` and the usual folders are the fallback, and `which` covers
a developer's macOS/Linux machine. Nothing here starts a process or writes
anything; the registry reader and the environment are parameters so the
tests run on fakes.
"""

import configparser
import os
import re
import shutil
import sys
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

#: `app.update.channel` -> the contract's channel names (CONTRACT_GEMINI.md 3.1).
_CHANNELS = {
    "release": "release",
    "beta": "beta",
    "esr": "esr",
    "aurora": "dev",  # Developer Edition
    "nightly": "nightly",
}

#: Channels on which `xpinstall.signatures.required=false` is honoured.
UNSIGNED_OK_CHANNELS = frozenset({"esr", "dev", "nightly"})

_HKLM = "HKLM"
_HKCU = "HKCU"
_MOZILLA_KEYS = (
    (_HKCU, r"SOFTWARE\Mozilla"),
    (_HKLM, r"SOFTWARE\Mozilla"),
    (_HKLM, r"SOFTWARE\WOW6432Node\Mozilla"),
)
_APP_PATHS = (
    (_HKCU, r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\firefox.exe"),
    (_HKLM, r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\firefox.exe"),
)
# Relative to %ProgramFiles%, %ProgramFiles(x86)% and %LOCALAPPDATA% (per-user installs).
_FOLDERS = ("Mozilla Firefox", "Firefox Developer Edition", "Firefox Nightly")
_FOLDER_ROOTS = ("ProgramFiles", "ProgramW6432", "ProgramFiles(x86)", "LOCALAPPDATA")


class Registry(Protocol):
    """The two registry reads detection needs -- `WinRegistry` on Windows, a dict in tests."""

    def values(self, hive: str, key: str) -> dict[str, Any] | None:
        """The key's values by name (`""` is the default value); None when there is no such key."""
        ...

    def subkeys(self, hive: str, key: str) -> list[str]:
        """The key's subkey names; empty when there is no such key."""
        ...


class WinRegistry:
    """`winreg`, read-only, both views as the key names them; every miss is None / []."""

    def __init__(self) -> None:
        import winreg

        self._winreg = winreg
        self._hives = {_HKLM: winreg.HKEY_LOCAL_MACHINE, _HKCU: winreg.HKEY_CURRENT_USER}

    def _open(self, hive: str, key: str) -> Any:
        return self._winreg.OpenKey(self._hives[hive], key, 0, self._winreg.KEY_READ)

    def values(self, hive: str, key: str) -> dict[str, Any] | None:
        try:
            handle = self._open(hive, key)
        except OSError:
            return None
        out: dict[str, Any] = {}
        with handle:
            index = 0
            while True:
                try:
                    name, value, _kind = self._winreg.EnumValue(handle, index)
                except OSError:
                    break
                out[name] = value
                index += 1
        return out

    def subkeys(self, hive: str, key: str) -> list[str]:
        try:
            handle = self._open(hive, key)
        except OSError:
            return []
        names: list[str] = []
        with handle:
            index = 0
            while True:
                try:
                    names.append(self._winreg.EnumKey(handle, index))
                except OSError:
                    break
                index += 1
        return names


class NoRegistry:
    """What a machine without a registry has."""

    def values(self, hive: str, key: str) -> dict[str, Any] | None:
        return None

    def subkeys(self, hive: str, key: str) -> list[str]:
        return []


def default_registry() -> Registry:
    return WinRegistry() if sys.platform == "win32" else NoRegistry()


@dataclass(frozen=True)
class FirefoxInstall:
    """One Firefox on disk. `version` is "" and `channel` "unknown" when the files do not say."""

    path: str
    version: str
    channel: str
    source: str  # configured | registry | app_paths | folder | path

    @property
    def can_run_unsigned(self) -> bool:
        return self.channel in UNSIGNED_OK_CHANNELS

    @property
    def install_dir(self) -> Path:
        return Path(self.path).parent

    def to_json(self) -> dict[str, Any]:
        return {
            "path": self.path,
            "version": self.version or None,
            "channel": self.channel,
            "source": self.source,
            "canRunUnsigned": self.can_run_unsigned,
        }


def read_version_and_channel(exe: Path) -> tuple[str, str]:
    """`(version, channel)` from the files beside `firefox.exe`; `("", "unknown")` if not there.

    The version is `application.ini`'s `[App] Version`; the channel is the
    `app.update.channel` default in `defaults/pref/channel-prefs.js`, with the
    source repository as the fallback (`mozilla-esr128` -> esr).
    """
    folder = exe.parent
    version = ""
    repository = ""
    ini = configparser.ConfigParser(interpolation=None, strict=False)
    try:
        ini.read(folder / "application.ini", encoding="utf-8")
        version = ini.get("App", "Version", fallback="").strip()
        repository = ini.get("App", "SourceRepository", fallback="").strip()
    except configparser.Error, OSError, UnicodeDecodeError:
        pass

    channel = "unknown"
    try:
        text = (folder / "defaults" / "pref" / "channel-prefs.js").read_text(
            encoding="utf-8", errors="replace"
        )
    except OSError:
        text = ""
    match = re.search(r"""pref\(\s*["']app\.update\.channel["']\s*,\s*["']([^"']+)["']""", text)
    if match:
        channel = _CHANNELS.get(match.group(1).strip().lower(), "unknown")
    elif repository:
        tail = repository.rstrip("/").rsplit("/", 1)[-1].lower()
        if tail.startswith("mozilla-esr"):
            channel = "esr"
        elif tail in ("mozilla-release", "mozilla-beta"):
            channel = tail[len("mozilla-") :]
        elif tail == "mozilla-central":
            channel = "nightly"
    return version, channel


def _candidates(
    configured: str, registry: Registry, env: Mapping[str, str]
) -> Iterable[tuple[str, str]]:
    """`(path, source)` pairs in order of preference; paths may repeat or not exist."""
    if configured.strip():
        yield configured.strip().strip('"'), "configured"
    for hive, root in _MOZILLA_KEYS:
        for product in registry.subkeys(hive, root):
            base = f"{root}\\{product}"
            current = (registry.values(hive, base) or {}).get("CurrentVersion")
            if not isinstance(current, str) or not current:
                continue  # Mozilla\Firefox (shared settings), MaintenanceService, ...
            main = registry.values(hive, f"{base}\\{current}\\Main") or {}
            exe = main.get("PathToExe")
            if isinstance(exe, str) and exe:
                yield exe, "registry"
    for hive, key in _APP_PATHS:
        exe = (registry.values(hive, key) or {}).get("")
        if isinstance(exe, str) and exe:
            yield exe.strip('"'), "app_paths"
    for root_var in _FOLDER_ROOTS:
        root = env.get(root_var)
        if not root:
            continue
        for folder in _FOLDERS:
            yield str(Path(root) / folder / "firefox.exe"), "folder"
    which = shutil.which("firefox", path=env.get("PATH"))
    if which:
        yield which, "path"
    if sys.platform == "darwin":
        yield "/Applications/Firefox.app/Contents/MacOS/firefox", "folder"


def find_firefox(
    configured: str = "", *, registry: Registry | None = None, env: Mapping[str, str] | None = None
) -> tuple[list[FirefoxInstall], list[str]]:
    """Every Firefox found, best first, and every path that was tried (for `BROWSER_NOT_FOUND`).

    A configured path that does not exist is NOT silently replaced by another
    Firefox: it comes back as not found, so Settings can say the path is wrong
    instead of quietly launching a different browser.
    """
    registry = registry or default_registry()
    env = os.environ if env is None else env
    found: list[FirefoxInstall] = []
    tried: list[str] = []
    seen: set[str] = set()
    for path, source in _candidates(configured, registry, env):
        key = os.path.normcase(os.path.normpath(path))
        if key in seen:
            continue
        seen.add(key)
        tried.append(path)
        exe = Path(path)
        if exe.is_file():
            version, channel = read_version_and_channel(exe)
            found.append(FirefoxInstall(str(exe), version, channel, source))
        if source == "configured":
            break
    return found, tried
