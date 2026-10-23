"""Reattaching to the app's own Firefox (gemini/browser/firefox_session.attach).

On Windows the pid `launch` records belongs to Firefox's launcher process, which hands over to the
real browser and exits within seconds. Reattaching used to require that pid alive, so a few seconds
after launch the app decided its Firefox was "someone else's" and refused to touch it. Ours is now:
the profile is locked and the debugging port the app chose answers.
"""

from collections.abc import Mapping
from pathlib import Path
from typing import Any

import pytest

from gratovo_pipeline.gemini.browser import firefox_profile, firefox_session


def setup(
    monkeypatch: pytest.MonkeyPatch,
    *,
    alive: bool,
    in_use: bool = True,
    port_up: bool = True,
    real_pid: int | None = 4242,
) -> dict[str, Any]:
    state: dict[str, Any] = {
        "pid": 111,
        "rdpPort": 5000,
        "firefox": "firefox.exe",
        "addon": "0.2.0",
    }
    written: dict[str, Any] = {}

    def read_state(_d: Path) -> dict[str, Any]:
        return dict(state)

    def write_state(_d: Path, s: Mapping[str, Any]) -> None:
        written.update(s)

    def profile_in_use(_d: Path) -> bool:
        return in_use

    def port_open(port: int, *_a: object, **_k: object) -> bool:
        return port_up and port == 5000

    def pid_alive(_pid: int) -> bool:
        return alive

    def browser_pid(port: int) -> int | None:
        return real_pid if port == 5000 else None

    monkeypatch.setattr(firefox_profile, "read_state", read_state)
    monkeypatch.setattr(firefox_profile, "write_state", write_state)
    monkeypatch.setattr(firefox_profile, "profile_in_use", profile_in_use)
    monkeypatch.setattr(firefox_session, "port_open", port_open)
    monkeypatch.setattr(firefox_session, "pid_alive", pid_alive)
    monkeypatch.setattr(firefox_session, "browser_pid", browser_pid)
    return written


def test_a_live_launch_pid_is_kept(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    written = setup(monkeypatch, alive=True)
    session = firefox_session.attach(tmp_path)
    assert session is not None
    assert session.pid == 111
    assert session.rdp_port == 5000
    assert not session.launched
    assert written == {}


def test_a_gone_launcher_pid_is_replaced_by_the_browsers_real_one(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    written = setup(monkeypatch, alive=False)
    session = firefox_session.attach(tmp_path)
    assert session is not None
    assert session.pid == 4242
    assert written["pid"] == 4242
    assert written["rdpPort"] == 5000


def test_still_ours_when_the_real_pid_cannot_be_looked_up(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    setup(monkeypatch, alive=False, real_pid=None)
    assert firefox_session.attach(tmp_path) is not None


def test_not_ours_without_our_debugging_port(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    setup(monkeypatch, alive=True, port_up=False)
    assert firefox_session.attach(tmp_path) is None


def test_not_running_when_the_profile_is_not_locked(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    setup(monkeypatch, alive=True, in_use=False)
    assert firefox_session.attach(tmp_path) is None
