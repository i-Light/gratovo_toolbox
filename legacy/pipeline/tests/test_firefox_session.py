"""Reattaching to the app's own Firefox (gemini_bridge/firefox_session.attach).

Run with:  python -m pytest -q tests/test_firefox_session.py    (from pipeline/)

On Windows the pid `launch` records belongs to Firefox's launcher process,
which hands over to the real browser and exits within seconds. Reattaching used
to require that pid alive, so a few seconds after launch the app decided its
Firefox was "someone else's" and refused to touch it. Ours is now: the profile
is locked and the debugging port the app chose answers.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gemini_bridge import firefox_profile, firefox_session  # noqa: E402


def setup(monkeypatch, tmp_path, *, alive, in_use=True, port_up=True, real_pid=4242):
    state = {"pid": 111, "rdpPort": 5000, "firefox": "firefox.exe", "addon": "0.2.0"}
    written = {}
    monkeypatch.setattr(firefox_profile, "read_state", lambda d: dict(state))
    monkeypatch.setattr(firefox_profile, "write_state", lambda d, s: written.update(s))
    monkeypatch.setattr(firefox_profile, "profile_in_use", lambda d: in_use)
    monkeypatch.setattr(firefox_session, "port_open", lambda port, *a, **k: port_up and port == 5000)
    monkeypatch.setattr(firefox_session, "pid_alive", lambda pid: alive)
    monkeypatch.setattr(firefox_session, "browser_pid", lambda port: real_pid if port == 5000 else None)
    return written


def test_a_live_launch_pid_is_kept(monkeypatch, tmp_path):
    written = setup(monkeypatch, tmp_path, alive=True)
    session = firefox_session.attach(tmp_path)
    assert session.pid == 111 and session.rdp_port == 5000 and not session.launched
    assert written == {}


def test_a_gone_launcher_pid_is_replaced_by_the_browsers_real_one(monkeypatch, tmp_path):
    written = setup(monkeypatch, tmp_path, alive=False)
    session = firefox_session.attach(tmp_path)
    assert session is not None and session.pid == 4242
    assert written["pid"] == 4242 and written["rdpPort"] == 5000


def test_still_ours_when_the_real_pid_cannot_be_looked_up(monkeypatch, tmp_path):
    setup(monkeypatch, tmp_path, alive=False, real_pid=None)
    assert firefox_session.attach(tmp_path) is not None


def test_not_ours_without_our_debugging_port(monkeypatch, tmp_path):
    setup(monkeypatch, tmp_path, alive=True, port_up=False)
    assert firefox_session.attach(tmp_path) is None


def test_not_running_when_the_profile_is_not_locked(monkeypatch, tmp_path):
    setup(monkeypatch, tmp_path, alive=True, in_use=False)
    assert firefox_session.attach(tmp_path) is None
