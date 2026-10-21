"""Launching, finding again and (only ever our own) stopping the app-managed Firefox.

The managed Firefox runs in its own profile (firefox_profile.py) with the
remote debugging server on a free loopback port. It is started DETACHED --
its own process group, no console, stdio on DEVNULL -- so it neither inherits
the daemon's stdout pipe (which would corrupt the JSON-lines protocol) nor
dies with the daemon: the person's Gemini window stays open across app
restarts, and the next daemon reattaches through the state file
(`gratovo-bridge.json`: pid, rdpPort, firefox path, add-on version).

Nothing here touches another Firefox: the pid in the state file is trusted
only while that profile is locked by a running Firefox, and stopping is
limited to that pid.
"""

import contextlib
import os
import socket
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from . import firefox_profile, window_guard
from .firefox_rdp import port_open

GEMINI_URL = "https://gemini.google.com/app"


@dataclass
class Session:
    pid: int
    rdp_port: int
    firefox: str
    launched: bool  # True = started just now, False = reattached to one already running
    addon_version: str | None = None


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if sys.platform == "win32":
        import ctypes
        from ctypes import wintypes

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.OpenProcess.restype = wintypes.HANDLE
        handle = kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not handle:
            return False
        try:
            code = wintypes.DWORD()
            if not kernel32.GetExitCodeProcess(handle, ctypes.byref(code)):
                return False
            return code.value == 259  # STILL_ACTIVE
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def browser_pid(port: int) -> int | None:
    """The pid of the Firefox listening for the debugger on `port`, by its command line; else None.

    On Windows `firefox.exe` starts through a launcher process that hands over
    to the real browser under a new pid and exits, so the pid `launch` got is
    gone within seconds while the browser runs on. The debugging port is the
    one `launch` chose, so the process whose command line carries it is ours.
    """
    if sys.platform != "win32" or port <= 0:
        return None
    script = (
        "Get-CimInstance -ClassName Win32_Process | Where-Object { $_.Name -eq 'firefox.exe' "
        f"-and $_.CommandLine -like '*--start-debugger-server {port}*' "
        "-and $_.CommandLine -notlike '*-contentproc*' } | "
        "Select-Object -First 1 -ExpandProperty ProcessId"
    )
    try:
        done = subprocess.run(  # noqa: S603 - fixed arguments; only the int port is interpolated
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", script],  # noqa: S607
            capture_output=True,
            text=True,
            timeout=20,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
    except OSError, subprocess.SubprocessError:
        return None
    text = (done.stdout or "").strip()
    return int(text) if text.isdigit() else None


def attach(profile_dir: Path) -> Session | None:
    """The managed Firefox running now, if the state file names one that is really ours and alive.

    Ours = the profile is locked and the debugging port the app chose answers.
    A recorded pid that is gone (Windows' launcher process, see `browser_pid`)
    is replaced by the browser's real one, so `stop` closes the right process.
    """
    state = firefox_profile.read_state(profile_dir)
    if not state:
        return None
    try:
        pid = int(state.get("pid") or 0)
        port = int(state.get("rdpPort") or 0)
    except TypeError, ValueError:
        return None
    if not (port and firefox_profile.profile_in_use(profile_dir) and port_open(port)):
        return None
    if not pid_alive(pid):
        real = browser_pid(port)
        if real is not None:
            pid = real
            firefox_profile.write_state(profile_dir, {**state, "pid": pid})
    return Session(
        pid=pid,
        rdp_port=port,
        firefox=str(state.get("firefox") or ""),
        launched=False,
        addon_version=state.get("addon") or None,
    )


def launch(
    firefox: str,
    profile_dir: Path,
    *,
    url: str = GEMINI_URL,
    headless: bool = False,
    extra_prefs: dict[str, Any] | None = None,
) -> Session:
    """Starts Firefox on the managed profile with a debugging port; OSError when it cannot start.

    The window opens minimized and does not take the focus (window_guard.py).
    """
    firefox_profile.ensure_profile(profile_dir, extra_prefs)
    port = free_port()
    args = [
        firefox,
        "-no-remote",
        "-profile",
        str(profile_dir),
        "--start-debugger-server",
        str(port),
    ]
    if headless:
        args.append("-headless")
    args.append(url)
    kwargs: dict[str, Any] = {
        "stdin": subprocess.DEVNULL,
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
        "close_fds": True,
    }
    if sys.platform == "win32":
        kwargs["creationflags"] = (
            subprocess.CREATE_NEW_PROCESS_GROUP
            | subprocess.DETACHED_PROCESS
            | subprocess.CREATE_BREAKAWAY_FROM_JOB
        )
        kwargs["startupinfo"] = window_guard.minimized_startupinfo()
    else:
        kwargs["start_new_session"] = True
    guard = None if headless else window_guard.WindowGuard(firefox).start()
    try:
        proc = subprocess.Popen(args, **kwargs)  # noqa: S603 - the firefox path is configured
    except OSError as error:
        if sys.platform == "win32" and getattr(error, "winerror", None) == 5:
            # The app's job object forbids breakaway: start inside it instead.
            kwargs["creationflags"] &= ~subprocess.CREATE_BREAKAWAY_FROM_JOB
            proc = subprocess.Popen(args, **kwargs)  # noqa: S603 - as above
        else:
            raise
    if guard is not None:
        guard.watch()
    firefox_profile.write_state(
        profile_dir,
        {
            "pid": proc.pid,
            "rdpPort": port,
            "firefox": firefox,
            "startedAt": time.time(),
            "addon": None,
        },
    )
    return Session(pid=proc.pid, rdp_port=port, firefox=firefox, launched=True)


def record_addon(profile_dir: Path, session: Session, version: str | None) -> None:
    session.addon_version = version
    state = firefox_profile.read_state(profile_dir) or {}
    state.update(
        {
            "pid": session.pid,
            "rdpPort": session.rdp_port,
            "firefox": session.firefox,
            "addon": version,
        }
    )
    firefox_profile.write_state(profile_dir, state)


def wait_until_up(session: Session, timeout_s: float) -> bool:
    """Waits for the debugging port to open (Firefox is up enough to take the add-on)."""
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        if port_open(session.rdp_port):
            return True
        if session.launched and not pid_alive(session.pid):
            # The launcher process may hand over to an already-running instance and exit;
            # the port decides.
            time.sleep(0.3)
        time.sleep(0.25)
    return False


def stop(profile_dir: Path) -> bool:
    """Stops the managed Firefox named in the state file (never any other); says if one was."""
    session = attach(profile_dir)
    if session is None:
        firefox_profile.clear_state(profile_dir)
        return False
    if sys.platform == "win32":
        subprocess.run(  # noqa: S603 - fixed arguments; the pid is an int
            ["taskkill", "/PID", str(session.pid), "/T", "/F"],  # noqa: S607
            capture_output=True,
            timeout=30,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
    else:
        with contextlib.suppress(OSError):
            os.kill(session.pid, 15)
    firefox_profile.clear_state(profile_dir)
    return True
