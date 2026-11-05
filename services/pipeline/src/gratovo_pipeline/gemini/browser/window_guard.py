"""Keep a browser the bridge starts out of the way: behind the other windows, never in front.

Never minimized: a minimized Gemini page stalls, its answers time out and its text comes back
without line breaks (real-use week, 2026-11-03 to 11-05).

The app opens its Gemini browser in the background; the person should not
find it covering what they were doing. Two layers, because neither is enough
alone on Windows:

  * `background_startupinfo()` asks the new process to show its first window
    inactive (`SW_SHOWNOACTIVATE`). Chrome and Edge honour it; Firefox does
    not -- its launcher process hands over to the real browser without passing
    the show state on.
  * `WindowGuard` snapshots the browser's windows before the launch, then
    watches for a short while and puts every new browser window at the bottom
    of the stack (without activating it), and gives the focus back to whatever
    had it if the browser took it. Firefox shows its first window again about
    half a second after it starts, so a new window is held there for
    `SETTLED_S`; after that it is left alone, and a window the person brings
    forward stays where they put it.

Everything here is best effort and a no-op off Windows: a window in front is
an annoyance, never a failure.
"""

import logging
import os
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Self

log = logging.getLogger(__name__)

SW_SHOWNOACTIVATE = 4
HWND_BOTTOM = 1
#: SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE
_SWP_QUIET = 0x0013
_GWL_STYLE = -16
_GWL_EXSTYLE = -20
_WS_MINIMIZEBOX = 0x00020000
_WS_EX_TOOLWINDOW = 0x00000080
_GW_OWNER = 4
_PROCESS_QUERY_LIMITED_INFORMATION = 0x1000

#: How long a guard keeps watching for the browser's first windows.
WATCH_S = 30.0
#: A new window is let go after it has been held at the bottom this long.
SETTLED_S = 3.0
_POLL_S = 0.04


def background_startupinfo() -> subprocess.STARTUPINFO | None:
    """A STARTUPINFO that shows the first window inactive; None off Windows."""
    if sys.platform != "win32":
        return None
    info = subprocess.STARTUPINFO()
    info.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    info.wShowWindow = SW_SHOWNOACTIVATE
    return info


def _same_path(a: str, b: str) -> bool:
    return os.path.normcase(Path(a).resolve()) == os.path.normcase(Path(b).resolve())


class _Win32:
    """The handful of user32/kernel32 calls the guard needs."""

    def __init__(self) -> None:
        import ctypes
        from ctypes import wintypes

        self._ctypes = ctypes
        self.user32 = ctypes.WinDLL("user32", use_last_error=True)
        self.kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        self._enum_proc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
        self.user32.GetWindowLongW.restype = ctypes.c_long
        self.user32.GetForegroundWindow.restype = wintypes.HWND
        self.user32.GetWindow.restype = wintypes.HWND
        self.kernel32.OpenProcess.restype = wintypes.HANDLE
        self._wintypes = wintypes

    def top_level_windows(self) -> list[int]:
        found: list[int] = []

        def collect(hwnd: int, _param: int) -> bool:
            found.append(int(hwnd))
            return True

        self.user32.EnumWindows(self._enum_proc(collect), 0)
        return found

    def is_app_window(self, hwnd: int) -> bool:
        """A visible, unowned window with a minimize box: a browser window, not a popup."""
        user32 = self.user32
        if not user32.IsWindowVisible(hwnd) or user32.GetWindow(hwnd, _GW_OWNER):
            return False
        style = user32.GetWindowLongW(hwnd, _GWL_STYLE)
        ex_style = user32.GetWindowLongW(hwnd, _GWL_EXSTYLE)
        return bool(style & _WS_MINIMIZEBOX) and not ex_style & _WS_EX_TOOLWINDOW

    def image_path(self, hwnd: int) -> str | None:
        ctypes, wintypes = self._ctypes, self._wintypes
        pid = wintypes.DWORD()
        self.user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if not pid.value:
            return None
        handle = self.kernel32.OpenProcess(_PROCESS_QUERY_LIMITED_INFORMATION, False, pid.value)
        if not handle:
            return None
        try:
            size = wintypes.DWORD(1024)
            buf = ctypes.create_unicode_buffer(size.value)
            if not self.kernel32.QueryFullProcessImageNameW(handle, 0, buf, ctypes.byref(size)):
                return None
            return buf.value
        finally:
            self.kernel32.CloseHandle(handle)

    def foreground(self) -> int:
        return int(self.user32.GetForegroundWindow() or 0)


class WindowGuard:
    """Holds the windows a launch opens behind the others: `start()` before, `watch()` after."""

    def __init__(self, exe: str, *, watch_s: float = WATCH_S) -> None:
        self.exe = exe
        self.watch_s = watch_s
        self.held: list[int] = []
        self._api: _Win32 | None = None
        self._before: set[int] = set()
        self._foreground = 0
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()

    def start(self) -> Self:
        """Remembers the browser's windows that exist now and which window has the focus."""
        if sys.platform != "win32":
            return self
        try:
            self._api = _Win32()
            self._before = set(self._browser_windows())
            self._foreground = self._api.foreground()
        except Exception:
            log.debug("window guard unavailable", exc_info=True)
            self._api = None
        return self

    def watch(self) -> Self:
        """Watches in the background for `watch_s` seconds, holding each new browser window back."""
        if self._api is not None and self._thread is None:
            self._thread = threading.Thread(
                target=self._run, name="gemini-window-guard", daemon=True
            )
            self._thread.start()
        return self

    def stop(self) -> None:
        self._stop.set()

    def join(self, timeout: float | None = None) -> None:
        if self._thread is not None:
            self._thread.join(timeout)

    def _browser_windows(self) -> list[int]:
        api = self._api
        assert api is not None  # noqa: S101 - set by start() before watch()
        out: list[int] = []
        for hwnd in api.top_level_windows():
            if not api.is_app_window(hwnd):
                continue
            path = api.image_path(hwnd)
            if path and _same_path(path, self.exe):
                out.append(hwnd)
        return out

    def _run(self) -> None:
        api = self._api
        assert api is not None  # noqa: S101 - set by start() before watch()
        seen = set(self._before)
        holding: dict[int, float] = {}  # window -> when it was first held
        deadline = time.monotonic() + self.watch_s
        while not self._stop.is_set() and time.monotonic() < deadline:
            now = time.monotonic()
            try:
                for hwnd in self._browser_windows():
                    if hwnd not in seen:
                        seen.add(hwnd)
                        holding[hwnd] = now
                        self.held.append(hwnd)
                        log.info("holding the new browser window %s behind the others", hwnd)
                    if hwnd not in holding:
                        continue
                    if now - holding[hwnd] >= SETTLED_S:
                        del holding[hwnd]
                        continue
                    if api.user32.IsIconic(hwnd):
                        api.user32.ShowWindow(hwnd, SW_SHOWNOACTIVATE)
                    api.user32.SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, _SWP_QUIET)
                    self._give_focus_back(hwnd)
            except Exception:
                log.debug("window guard pass failed", exc_info=True)
            self._stop.wait(_POLL_S)

    def _give_focus_back(self, hwnd: int) -> None:
        api = self._api
        assert api is not None  # noqa: S101 - set by start() before watch()
        previous = self._foreground
        if (
            previous
            and previous != hwnd
            and api.foreground() in (hwnd, 0)
            and api.user32.IsWindow(previous)
        ):
            api.user32.SetForegroundWindow(previous)
