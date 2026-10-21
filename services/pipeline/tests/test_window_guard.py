"""window_guard: new browser windows are held minimized until they settle; old ones are never
touched (ported from the old test_window_guard)."""

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
        self.api.iconic[hwnd] = cmd == window_guard.SW_SHOWMINNOACTIVE

    def IsWindow(self, _hwnd: int) -> bool:  # noqa: N802
        return True

    def SetForegroundWindow(self, hwnd: int) -> None:  # noqa: N802
        self.api.fg = hwnd


class FakeApi:
    def __init__(self) -> None:
        self.windows = [1]
        self.iconic: dict[int, bool] = {}
        self.shown: list[tuple[int, int]] = []
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
    return window_guard.WindowGuard(r"C:\ff\firefox.exe", watch_s=0.5).start()


def test_a_new_window_is_minimized_again_when_the_browser_restores_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api = FakeApi()
    guard = make_guard(monkeypatch, api)
    api.windows.append(2)
    api.fg = 2
    guard.watch()
    for _ in range(200):
        if api.shown:
            break
        time.sleep(0.005)
    api.iconic[2] = False  # Firefox shows its first window again after starting
    guard.join()
    minimized = [hwnd for hwnd, _ in api.shown]
    assert minimized.count(2) >= 2
    assert 1 not in minimized  # a window that was there before is left alone
    assert api.fg == 99  # the focus went back to where it was


def test_a_settled_window_is_let_go(monkeypatch: pytest.MonkeyPatch) -> None:
    api = FakeApi()
    guard = make_guard(monkeypatch, api)
    api.windows.append(2)
    guard.watch()
    time.sleep(0.2)  # well past SETTLED_S
    api.iconic[2] = False  # the person restored it
    guard.join()
    assert [hwnd for hwnd, _ in api.shown] == [2]


@pytest.mark.skipif(sys.platform != "win32", reason="Windows only")
def test_the_startupinfo_asks_for_minimized_and_inactive() -> None:
    info: Any = window_guard.minimized_startupinfo()
    assert info.wShowWindow == window_guard.SW_SHOWMINNOACTIVE
