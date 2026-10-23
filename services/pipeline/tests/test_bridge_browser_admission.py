"""Only the selected browser's extension may hold the bridge (server.set_browser).

The owner had the old extension loaded in Edge while the app managed Firefox: with "most recent
connection wins" alone the two replaced each other every few seconds, and a call could land in
Edge. Pinned here: with a browser set, a newcomer from another browser is refused (4003) without
disturbing the connection there is; setting the browser drops a connected extension of another
browser; no browser (or `system`) accepts any, as before.
"""

from __future__ import annotations

import io
import threading
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fake_extension import THREAD_PREFIXES, FakeExtension, Harness, Scripted, wait_until

from gratovo_pipeline.gemini import daemon as daemon_module
from gratovo_pipeline.gemini.browser.manager import BrowserPaths
from gratovo_pipeline.gemini.server import WRONG_BROWSER_CODE


@pytest.fixture
def harness(loopback: None) -> Iterator[Harness]:
    h = Harness()
    try:
        yield h
    finally:
        h.close()


@pytest.fixture(autouse=True)
def no_threads_left_behind() -> Iterator[None]:
    yield
    deadline = time.monotonic() + 2
    ours: list[str] = []
    while time.monotonic() < deadline:
        ours = [t.name for t in threading.enumerate() if t.name.startswith(THREAD_PREFIXES)]
        if not ours:
            return
        time.sleep(0.05)
    raise AssertionError(f"threads left behind: {ours}")


def attach(h: Harness, browser: str, handlers: dict[str, Scripted] | None = None) -> FakeExtension:
    return h.attach(handlers or {}, browser=browser)


def refused(h: Harness, browser: str | None) -> FakeExtension:
    fake = FakeExtension(h.port, {}, browser=browser)
    h.fakes.append(fake)
    fake.start()
    assert fake.closed.wait(5), "the extension was not closed"
    return fake


def test_another_browsers_extension_is_refused_and_the_selected_one_keeps_the_bridge(
    harness: Harness,
) -> None:
    harness.gemini.server.set_browser("firefox")
    firefox = attach(harness, "firefox", {"status": {"who": "firefox"}})
    edge = refused(harness, "edge")
    assert (edge.close_code, edge.close_reason) == (
        WRONG_BROWSER_CODE,
        "only the firefox extension is accepted",
    )
    assert not firefox.closed.is_set()
    assert harness.gemini.status() == {"who": "firefox"}


def test_with_nothing_connected_the_wrong_browser_is_still_refused(harness: Harness) -> None:
    harness.gemini.server.set_browser("firefox")
    edge = refused(harness, "edge")
    assert edge.close_code == WRONG_BROWSER_CODE
    assert not harness.gemini.connected


def test_an_extension_that_never_names_its_browser_is_refused_when_one_is_required(
    harness: Harness,
) -> None:
    harness.gemini.server.set_browser("firefox")
    anonymous = refused(harness, None)
    assert anonymous.close_code == WRONG_BROWSER_CODE


def test_selecting_a_browser_drops_a_connected_extension_of_another(harness: Harness) -> None:
    edge = attach(harness, "edge")
    harness.gemini.server.set_browser("firefox")
    assert edge.closed.wait(5)
    assert edge.close_code == WRONG_BROWSER_CODE
    wait_until(lambda: not harness.gemini.connected, what="the bridge to drop the edge extension")


def test_selecting_the_connected_browser_keeps_it(harness: Harness) -> None:
    firefox = attach(harness, "firefox")
    harness.gemini.server.set_browser("Firefox")
    assert not firefox.closed.wait(0.3)
    assert harness.gemini.connected


def test_no_browser_or_system_accepts_any_and_the_newest_still_wins(harness: Harness) -> None:
    harness.gemini.server.set_browser("system")
    assert harness.gemini.server.browser is None
    first = attach(harness, "edge")
    second = attach(harness, "firefox", {"status": {"who": "firefox"}})
    assert first.closed.wait(5)
    assert first.close_reason == "replaced"
    assert harness.gemini.status() == {"who": "firefox"}
    assert second.connected.is_set()


def test_the_daemon_selects_the_browser_from_the_browser_calls(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    paths = BrowserPaths(profile_dir=Path("profile"), extension_dir=Path("extension"))
    d = daemon_module.Daemon(
        port=0, data_dir=None, out=daemon_module.Out(io.StringIO()), paths=paths
    )
    seen: list[str | None] = []
    monkeypatch.setattr(d.gemini.server, "set_browser", seen.append)

    def info(params: dict[str, Any], **_kwargs: Any) -> dict[str, Any]:
        del params
        return {"ok": 1}

    monkeypatch.setattr(daemon_module.browser_manager, "browser_info", info)
    assert d.bridge_method("browser_info", {"browser": "firefox"}) == {"ok": 1}
    assert d.bridge_method("browser_info", {}) == {"ok": 1}
    assert seen == ["firefox"]
