"""window_guard: new browser windows are held behind the others until they settle, never minimized;
old ones are never touched."""

import sys
import time
from typing import Any

import pytest

from gratovo_pipeline.gemini.browser import window_guard


class FakeUser32:
    def __init__(self, api: FakeApi) -> None:
        self.api = api

    def IsIconic(self, hwnd: int) -> bool:  # noqa: N802 - Win32 name
        return self.api.iconic.get(hwnd, False)

    def ShowWindow(self, hwnd: int, cmd: int) -> None:  # noqa: N802
        self.api.shown.append((hwnd, cmd))
        self.api.iconic[hwnd] = False

    def SetWindowPos(self, hwnd: int, after: int, *_rest: int) -> None:  # noqa: N802
        self.api.placed.append((hwnd, after))

    def IsWindow(self, _hwnd: int) -> bool:  # noqa: N802
        return True

    def SetForegroundWindow(self, hwnd: int) -> None:  # noqa: N802
        self.api.fg = hwnd


class FakeApi:
    def __init__(self) -> None:
        self.windows = [1]
        self.iconic: dict[int, bool] = {}
        self.shown: list[tuple[int, int]] = []
        self.placed: list[tuple[int, int]] = []
        self.fg = 99
        self.user32 = FakeUser32(self)

    def top_level_windows(self) -> list[int]:
        return list(self.windows)

    def is_app_window(self, _hwnd: int) -> bool:
        return True

    def image_path(self, _hwnd: int) -> str:
        return r"C:\ff\firefox.exe"

    def foreground(self) -> int:
        return self.fg


def make_guard(monkeypatch: pytest.MonkeyPatch, api: FakeApi) -> window_guard.WindowGuard:
    monkeypatch.setattr(window_guard, "_Win32", lambda: api)
    monkeypatch.setattr(window_guard.sys, "platform", "win32")
    monkeypatch.setattr(window_guard, "_POLL_S", 0.005)
    monkeypatch.setattr(window_guard, "SETTLED_S", 0.05)
    return window_guard.WindowGuard(r"C:\ff\firefox.exe", watch_s=0.2).start()


def test_a_new_window_goes_behind_the_others_and_gives_the_focus_back(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api = FakeApi()
    guard = make_guard(monkeypatch, api)
    api.windows.append(2)
    api.fg = 2
    guard.watch()
    guard.join()
    assert (2, window_guard.HWND_BOTTOM) in api.placed
    assert 1 not in [hwnd for hwnd, _ in api.placed]  # a window from before is left alone
    assert api.fg == 99  # the focus went back to where it was


def test_a_new_window_is_never_left_minimized(monkeypatch: pytest.MonkeyPatch) -> None:
    api = FakeApi()
    guard = make_guard(monkeypatch, api)
    api.windows.append(2)
    api.iconic[2] = True
    guard.watch()
    guard.join()
    assert (2, window_guard.SW_SHOWNOACTIVATE) in api.shown
    assert api.iconic[2] is False


def test_a_settled_window_is_let_go(monkeypatch: pytest.MonkeyPatch) -> None:
    api = FakeApi()
    guard = make_guard(monkeypatch, api)
    api.windows.append(2)
    guard.watch()
    time.sleep(0.12)  # well past SETTLED_S
    count = len(api.placed)
    guard.join()
    assert len(api.placed) == count


@pytest.mark.skipif(sys.platform != "win32", reason="Windows only")
def test_the_startupinfo_asks_for_inactive() -> None:
    info: Any = window_guard.background_startupinfo()
    assert info.wShowWindow == window_guard.SW_SHOWNOACTIVATE
