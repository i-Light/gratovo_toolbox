"""Only the selected browser's extension may hold the bridge (server.set_browser).

Run with:  python -m pytest -q tests/test_bridge_browser_admission.py    (from pipeline/)

The owner has the old extension loaded in Edge and the app manages Firefox:
with "most recent connection wins" alone the two replaced each other every few
seconds, and a call could land in Edge. Pinned here: with a browser set, a
newcomer from another browser is refused (4003) without disturbing the
connection there is; setting the browser drops a connected extension of
another browser; no browser (or `system`) accepts any, as before.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from test_gemini_bridge import FakeExtension, Harness, harness, no_threads_left_behind, wait_until  # noqa: E402,F401

from gemini_bridge import daemon as daemon_module  # noqa: E402
from gemini_bridge.server import WRONG_BROWSER_CODE  # noqa: E402


def attach(h: Harness, browser: str, handlers=None) -> FakeExtension:
    fake = h.attach(handlers or {}, browser=browser)
    return fake


def refused(h: Harness, browser: str) -> FakeExtension:
    fake = FakeExtension(h.port, {}, browser=browser)
    h.fakes.append(fake)
    fake.start()
    assert fake.closed.wait(5), "the extension was not closed"
    return fake


def test_another_browsers_extension_is_refused_and_the_selected_one_keeps_the_bridge(harness):
    harness.gemini.server.set_browser("firefox")
    firefox = attach(harness, "firefox", {"status": {"who": "firefox"}})
    edge = refused(harness, "edge")
    assert (edge.close_code, edge.close_reason) == (WRONG_BROWSER_CODE, "only the firefox extension is accepted")
    assert not firefox.closed.is_set()
    assert harness.gemini.status() == {"who": "firefox"}


def test_with_nothing_connected_the_wrong_browser_is_still_refused(harness):
    harness.gemini.server.set_browser("firefox")
    edge = refused(harness, "edge")
    assert edge.close_code == WRONG_BROWSER_CODE
    assert not harness.gemini.connected


def test_an_extension_that_never_names_its_browser_is_refused_when_one_is_required(harness):
    harness.gemini.server.set_browser("firefox")
    anonymous = refused(harness, None)
    assert anonymous.close_code == WRONG_BROWSER_CODE


def test_selecting_a_browser_drops_a_connected_extension_of_another(harness):
    edge = attach(harness, "edge")
    harness.gemini.server.set_browser("firefox")
    assert edge.closed.wait(5)
    assert edge.close_code == WRONG_BROWSER_CODE
    wait_until(lambda: not harness.gemini.connected, what="the bridge to drop the edge extension")


def test_selecting_the_connected_browser_keeps_it(harness):
    firefox = attach(harness, "firefox")
    harness.gemini.server.set_browser("Firefox")
    assert not firefox.closed.wait(0.3)
    assert harness.gemini.connected


def test_no_browser_or_system_accepts_any_and_the_newest_still_wins(harness):
    harness.gemini.server.set_browser("system")
    assert harness.gemini.server.browser is None
    first = attach(harness, "edge")
    second = attach(harness, "firefox", {"status": {"who": "firefox"}})
    assert first.closed.wait(5) and first.close_reason == "replaced"
    assert harness.gemini.status() == {"who": "firefox"}
    assert second.connected.is_set()


def test_the_daemon_selects_the_browser_from_the_browser_calls(monkeypatch):
    seen = []

    class FakeServer:
        def set_browser(self, browser):
            seen.append(browser)

    class FakeGemini:
        server = FakeServer()
        data_dir = None

    monkeypatch.setattr(daemon_module.browser_manager, "browser_info", lambda params, data_dir=None: {"ok": 1})
    d = daemon_module.Daemon.__new__(daemon_module.Daemon)
    d.gemini = FakeGemini()
    d.emit = None
    assert d.bridge_method("browser_info", {"browser": "firefox"}) == {"ok": 1}
    assert d.bridge_method("browser_info", {}) == {"ok": 1}
    assert seen == ["firefox"]
