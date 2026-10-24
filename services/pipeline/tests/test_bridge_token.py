"""The per-launch bridge token (plan D13).

Main makes a fresh token for every bridge start and passes it in `GRATOVO_BRIDGE_TOKEN`. The bridge
reads it once, drops it from its environment, writes it into the Firefox copy of the add-on it
builds, and admits a Firefox extension only when its `hello` carries that exact token (else 4001).
Chrome and Edge load the source folder unpacked, which cannot carry it, so they are admitted as
before. The token never reaches a log line, `bridge.status`, the forwarded `hello` or stdout.
"""

from __future__ import annotations

import io
import json
import logging
import os
import subprocess
import sys
import threading
import time
import zipfile
from collections.abc import Iterator
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from fake_extension import THREAD_PREFIXES, FakeExtension, Harness, free_port, wait_until
from test_gemini_bridge import _dial  # pyright: ignore[reportPrivateUsage]

from gratovo_pipeline.gemini import daemon as daemon_module
from gratovo_pipeline.gemini.browser import manager
from gratovo_pipeline.gemini.browser.manager import BrowserPaths
from gratovo_pipeline.gemini.server import WRONG_BROWSER_CODE, WRONG_TOKEN_CODE

TOKEN = "1a" * 32  # a made-up token, not a secret
OTHER = "0f" * 32
EXTENSION = Path(__file__).resolve().parents[3] / "services" / "gemini-extension"
MOZ = "moz-extension://6f1c2b1e-0d2a-4f7e-9c1a-3b5d7e9f1a2c"


@pytest.fixture
def harness(loopback: None) -> Iterator[Harness]:
    h = Harness()
    h.gemini.server.set_token(TOKEN)
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


@pytest.fixture(autouse=True)
def fresh_launch() -> Iterator[None]:
    manager._installed_this_launch.clear()  # pyright: ignore[reportPrivateUsage]
    yield
    manager._installed_this_launch.clear()  # pyright: ignore[reportPrivateUsage]


def refused(h: Harness, **kw: Any) -> FakeExtension:
    fake = FakeExtension(h.port, {}, **kw)
    h.fakes.append(fake)
    fake.start()
    assert fake.closed.wait(5), "the extension was not closed"
    return fake


# --- admission -------------------------------------------------------------------------------


@pytest.mark.parametrize("browser", ["firefox", None])
def test_firefox_with_the_right_token_is_admitted(harness: Harness, browser: str | None) -> None:
    if browser is not None:
        harness.gemini.server.set_browser(browser)
    fake = harness.attach(
        {"status": {"who": "firefox"}},
        browser="firefox",
        origin=MOZ,
        extra_hello={"token": TOKEN},
    )
    assert harness.gemini.status() == {"who": "firefox"}
    assert not fake.closed.is_set()


@pytest.mark.parametrize("browser", ["firefox", None])
@pytest.mark.parametrize("sent", [{"token": OTHER}, {}, {"token": None}, {"token": TOKEN[:-1]}])
def test_firefox_with_a_wrong_or_missing_token_is_closed_4001(
    harness: Harness, browser: str | None, sent: dict[str, Any]
) -> None:
    if browser is not None:
        harness.gemini.server.set_browser(browser)
    fake = refused(harness, browser="firefox", extra_hello=sent)
    assert (fake.close_code, fake.close_reason) == (WRONG_TOKEN_CODE, "wrong token")
    assert not harness.gemini.connected


def test_a_firefox_add_on_that_claims_to_be_edge_still_needs_the_token(harness: Harness) -> None:
    fake = refused(harness, browser="edge", origin=MOZ)
    assert fake.close_code == WRONG_TOKEN_CODE


@pytest.mark.parametrize("browser", ["edge", None])
def test_edge_without_a_token_is_admitted(harness: Harness, browser: str | None) -> None:
    # The unpacked source folder can't carry a per-launch value (D13); origin and browser
    # admission guard it.
    if browser is not None:
        harness.gemini.server.set_browser(browser)
    fake = harness.attach(
        {"status": {"who": "edge"}},
        browser="edge",
        origin="chrome-extension://abcdefghijklmnopabcdefghijklmnop",
        extra_hello={"token": None},
    )
    assert harness.gemini.status() == {"who": "edge"}
    assert not fake.closed.is_set()


def test_the_wrong_browser_is_still_refused_4003_before_the_token(harness: Harness) -> None:
    harness.gemini.server.set_browser("edge")
    fake = refused(harness, browser="firefox", extra_hello={"token": TOKEN})
    assert fake.close_code == WRONG_BROWSER_CODE


def test_without_a_token_firefox_is_admitted_as_before(loopback: None) -> None:
    h = Harness()
    try:
        h.attach({}, browser="firefox")
        assert h.gemini.connected
    finally:
        h.close()


@pytest.mark.parametrize("origin", ["https://evil.example", "null"])
def test_a_web_page_is_still_refused_403(harness: Harness, origin: str) -> None:
    assert _dial(harness.port, origin) == "refused 403"


# --- the token stays secret ----------------------------------------------------------------------


def test_the_token_is_never_logged_stored_or_echoed(
    harness: Harness, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    out = io.StringIO()
    paths = BrowserPaths(profile_dir=Path("profile"), extension_dir=EXTENSION, token=TOKEN)
    assert TOKEN not in repr(paths)

    forwarded: list[dict[str, Any]] = []
    harness.gemini.on("hello", forwarded.append)
    refused(harness, browser="firefox", extra_hello={"token": OTHER})
    harness.attach({}, browser="firefox", extra_hello={"token": TOKEN})
    wait_until(lambda: forwarded, what="the forwarded hello")

    assert harness.gemini.server.hello is not None
    assert "token" not in harness.gemini.server.hello
    assert all("token" not in data for data in forwarded)

    # bridge.status, as the daemon answers it, carries the stored hello.
    # (its own Gemini is never started; the harness's stands in for it).
    d = daemon_module.Daemon(port=0, data_dir=None, out=daemon_module.Out(out), paths=paths)
    d.gemini = harness.gemini
    status = d.bridge_status()
    assert status["hello"] is not None
    text = json.dumps(status, default=str) + out.getvalue()
    for secret in (TOKEN, OTHER):
        assert secret not in text
        assert secret not in caplog.text


def test_the_daemon_hands_the_token_to_its_server() -> None:
    paths = BrowserPaths(profile_dir=Path("profile"), extension_dir=EXTENSION, token=TOKEN)
    plain = BrowserPaths(profile_dir=Path("profile"), extension_dir=EXTENSION)
    for given, required in ((paths, True), (plain, False)):
        out = daemon_module.Out(io.StringIO())
        d = daemon_module.Daemon(port=0, data_dir=None, out=out, paths=given)
        assert d.gemini.server.requires_token is required


# --- reading the environment -----------------------------------------------------------------


def test_the_token_is_read_once_and_removed_from_the_environment() -> None:
    env = {"GRATOVO_BRIDGE_TOKEN": TOKEN, "PATH": "x"}
    assert daemon_module.read_bridge_token(env) == TOKEN
    assert env == {"PATH": "x"}


def test_the_real_environment_loses_it_too(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GRATOVO_BRIDGE_TOKEN", TOKEN)
    assert daemon_module.read_bridge_token() == TOKEN
    assert "GRATOVO_BRIDGE_TOKEN" not in os.environ


@pytest.mark.parametrize("env", [{}, {"GRATOVO_BRIDGE_TOKEN": ""}])
def test_absent_or_empty_is_no_token(env: dict[str, str]) -> None:
    assert daemon_module.read_bridge_token(env) is None
    assert env == {}


@pytest.mark.parametrize("bad", [TOKEN.upper(), TOKEN[:-1], TOKEN + "0", "z" * 64, f" {TOKEN}"])
def test_a_malformed_token_is_refused_without_showing_it(bad: str) -> None:
    env = {"GRATOVO_BRIDGE_TOKEN": bad}
    with pytest.raises(daemon_module.BadBridgeTokenError) as caught:
        daemon_module.read_bridge_token(env)
    assert bad.strip() not in str(caught.value)
    assert env == {}, "removed even when refused"


def _run_bridge(tmp_path: Path, token: str) -> subprocess.Popen[bytes]:
    env = {k: v for k, v in os.environ.items() if k != "GRATOVO_BRIDGE_TOKEN"}
    env["GRATOVO_BRIDGE_TOKEN"] = token
    return subprocess.Popen(  # noqa: S603 - our own interpreter, the module main starts
        [
            sys.executable,
            "-I",
            "-u",
            "-m",
            "gratovo_pipeline.gemini",
            "--port",
            str(free_port()),
            "--profile-dir",
            str(tmp_path / "gemini-profile"),
            "--extension-dir",
            str(EXTENSION),
        ],
        cwd=tmp_path,
        env=env,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def test_a_bad_token_refuses_the_start(tmp_path: Path) -> None:
    bad = "not-a-token-" + "9" * 20
    proc = _run_bridge(tmp_path, bad)
    out, err = proc.communicate(timeout=60)
    assert proc.returncode == 2
    lines = [json.loads(line) for line in out.decode("utf-8").splitlines()]
    assert lines == [
        {
            "type": "event",
            "event": "daemon",
            "data": {
                "state": "failed",
                "reason": "bad_token",
                "message": "GRATOVO_BRIDGE_TOKEN must be 64 lowercase hex characters",
            },
        }
    ]
    assert bad not in out.decode("utf-8") + err.decode("utf-8")


def test_a_good_token_starts_and_never_shows(tmp_path: Path) -> None:
    proc = _run_bridge(tmp_path, TOKEN)
    assert proc.stdout is not None
    assert proc.stdin is not None
    try:
        first = json.loads(proc.stdout.readline())
        assert first["data"]["state"] == "listening", first
        proc.stdin.write(b'{"id":"s","method":"bridge.status","params":{}}\n')
        proc.stdin.flush()
        status = json.loads(proc.stdout.readline())
        assert status["ok"] is True
        proc.stdin.close()
        out, err = proc.communicate(timeout=30)
        assert proc.returncode == 0
        everything = json.dumps(first) + json.dumps(status) + out.decode() + err.decode()
        assert TOKEN not in everything
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait(10)


# --- the add-on build ----------------------------------------------------------------------------


def test_the_firefox_build_carries_the_token_first(tmp_path: Path) -> None:
    paths = BrowserPaths(
        profile_dir=tmp_path / "gemini-profile", extension_dir=EXTENSION, token=TOKEN
    )
    out = manager.build_firefox_addon(paths)
    assert out == tmp_path / "gemini-addon"
    assert (out / "bridge-token.js").read_text(encoding="utf-8") == (
        f'self.GB_BRIDGE_TOKEN = "{TOKEN}";\n'
    )
    built = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    assert built["background"]["scripts"][0] == "bridge-token.js"


def test_without_a_token_the_build_has_no_token_file(tmp_path: Path) -> None:
    paths = BrowserPaths(profile_dir=tmp_path / "gemini-profile", extension_dir=EXTENSION)
    out = manager.build_firefox_addon(paths)
    assert not (out / "bridge-token.js").exists()
    assert not (EXTENSION / "bridge-token.js").exists(), "the source folder never holds it"


def test_the_permanent_xpi_carries_the_token(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    paths = BrowserPaths(
        profile_dir=tmp_path / "gemini-profile", extension_dir=EXTENSION, token=TOKEN
    )
    sideloaded: list[Path] = []

    def firefox(_params: dict[str, Any]) -> SimpleNamespace:
        return SimpleNamespace(can_run_unsigned=True, channel="developer")

    def sideload(_profile: Path, source: Path, _addon_id: str) -> None:
        sideloaded.append(source)

    monkeypatch.setattr(manager, "_firefox_or_raise", firefox)
    monkeypatch.setattr(manager.firefox_profile, "sideload_xpi", sideload)
    result = manager.install_addon({"mode": "permanent"}, paths=paths)
    assert result["method"] == "profile_xpi"
    with zipfile.ZipFile(sideloaded[0]) as xpi:
        assert TOKEN in xpi.read("bridge-token.js").decode("utf-8")
        assert json.loads(xpi.read("manifest.json"))["background"]["scripts"][0] == (
            "bridge-token.js"
        )


def _fake_firefox(monkeypatch: pytest.MonkeyPatch, paths: BrowserPaths) -> list[str]:
    installs: list[str] = []
    session = SimpleNamespace(
        launched=False, addon_version=manager.shipped_version(paths), rdp_port=1
    )

    def start_firefox(*_args: object, **_kwargs: object) -> SimpleNamespace:
        return session

    monkeypatch.setattr(manager, "_start_firefox", start_firefox)

    def install(p: BrowserPaths, _session: object, _emit: object) -> str:
        installs.append("install")
        manager._installed_this_launch.add(p.profile_dir)  # pyright: ignore[reportPrivateUsage]
        return "v"

    monkeypatch.setattr(manager, "_install_temporary", install)
    return installs


def test_a_firefox_left_from_an_earlier_launch_gets_the_add_on_again(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Its add-on holds the old launch's token, which this bridge refuses: reinstall, don't wait.
    paths = BrowserPaths(
        profile_dir=tmp_path / "gemini-profile", extension_dir=EXTENSION, token=TOKEN
    )
    installs = _fake_firefox(monkeypatch, paths)
    assert manager.install_addon({}, paths=paths)["message"] == (
        "Installed in the app's Firefox window."
    )
    assert manager.install_addon({}, paths=paths)["message"] == "Already installed and up to date."
    assert installs == ["install"]


def test_without_a_token_an_up_to_date_add_on_is_kept(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    paths = BrowserPaths(profile_dir=tmp_path / "gemini-profile", extension_dir=EXTENSION)
    installs = _fake_firefox(monkeypatch, paths)
    assert manager.install_addon({}, paths=paths)["message"] == "Already installed and up to date."
    assert installs == []


# --- has_extension -------------------------------------------------------------------------------


def test_a_folder_with_only_a_readme_is_no_extension(tmp_path: Path) -> None:
    folder = tmp_path / "gemini-extension"
    folder.mkdir()
    (folder / "README.md").write_text("comes later\n", encoding="utf-8")
    assert not BrowserPaths(profile_dir=tmp_path / "p", extension_dir=folder).has_extension
    missing = tmp_path / "none"
    assert not BrowserPaths(profile_dir=tmp_path / "p", extension_dir=missing).has_extension


def test_the_real_extension_folder_is_an_extension(tmp_path: Path) -> None:
    assert BrowserPaths(profile_dir=tmp_path / "p", extension_dir=EXTENSION).has_extension
