"""End-to-end smoke of the Firefox path, on a throwaway profile, with no Google traffic.

    python tools/firefox_smoke.py [--idle 90] [--visible] [--keep]

What it proves, on this machine's real Firefox:
  1. the Firefox build of pipeline/gemini_extension installs as a temporary add-on over the
     remote debugging protocol (the route the daemon takes on every launch);
  2. the add-on's background connects to a BridgeServer and its `hello` carries
     browser=firefox, manifestVersion=2 and the capabilities;
  3. it stays connected while idle (MV2 persistent background: never suspended), and
     answers a request (`tabs`) at the end.

It never touches the app's managed profile or anyone's everyday profile: the profile is a
temporary folder, Firefox runs headless on about:blank, the extension is pointed at a free
port (the built copy's DEFAULT_PORT is rewritten), and only the Firefox it started is stopped.
Exit code 0 = pass.
"""

from __future__ import annotations

import argparse
import re
import shutil
import sys
import tempfile
import time
from pathlib import Path

PIPELINE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PIPELINE))

from gemini_bridge import browser_manager, firefox_detect, firefox_session  # noqa: E402
from gemini_bridge.firefox_rdp import RdpClient  # noqa: E402
from gemini_bridge.server import BridgeServer  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--idle", type=float, default=90.0, help="seconds to stay idle while watching the connection")
    parser.add_argument("--visible", action="store_true", help="show the Firefox window (default: headless)")
    parser.add_argument("--keep", action="store_true", help="keep the temporary folder")
    args = parser.parse_args()

    installs, tried = firefox_detect.find_firefox()
    if not installs:
        print(f"FAIL: no Firefox found (tried {tried})")
        return 1
    ff = installs[0]
    print(f"firefox: {ff.path} {ff.version} ({ff.channel})")

    work = Path(tempfile.mkdtemp(prefix="gemini-ff-smoke-"))
    profile = work / "profile"
    addon = work / "addon"
    server = BridgeServer(port=firefox_session.free_port())
    session = None
    ok = False
    try:
        server.start()
        print(f"bridge server on port {server.port}")
        browser_manager._load_build_addon().build_firefox(browser_manager.EXTENSION_DIR, addon)
        bg = addon / "background.js"
        text = bg.read_text(encoding="utf-8")
        bg.write_text(re.sub(r"const DEFAULT_PORT = \d+;", f"const DEFAULT_PORT = {server.port};", text, count=1),
                      encoding="utf-8")

        t0 = time.monotonic()
        session = firefox_session.launch(ff.path, profile, url="about:blank", headless=not args.visible)
        if not firefox_session.wait_until_up(session, 45.0):
            print("FAIL: Firefox did not open its debugging port")
            return 1
        print(f"firefox up (pid {session.pid}, rdp {session.rdp_port}) in {time.monotonic() - t0:.1f}s")
        with RdpClient(session.rdp_port) as rdp:
            installed = rdp.install_temporary_addon(addon)
        print(f"temporary add-on installed: {installed.get('id')}")
        if installed.get("id") != browser_manager.GEMINI_ADDON_ID:
            print("FAIL: unexpected add-on id")
            return 1

        if not server.wait_for_extension(30.0):
            print("FAIL: the add-on did not connect within 30 s")
            return 1
        # The socket opens a moment before the extension's first frame (`hello`) arrives.
        hello_deadline = time.monotonic() + 10.0
        while server.hello is None and time.monotonic() < hello_deadline:
            time.sleep(0.05)
        hello = server.hello or {}
        print(f"connected in {time.monotonic() - t0:.1f}s; hello: browser={hello.get('browser')} "
              f"manifestVersion={hello.get('manifestVersion')} capabilities={hello.get('capabilities')} "
              f"extensionVersion={hello.get('extensionVersion')}")
        problems = []
        if hello.get("browser") != "firefox":
            problems.append("hello.browser is not firefox")
        if hello.get("manifestVersion") != 2:
            problems.append("hello.manifestVersion is not 2")
        if not isinstance(hello.get("capabilities"), list) or "gems" not in hello["capabilities"]:
            problems.append("hello.capabilities lacks 'gems'")

        drops = []
        server.on("disconnected", lambda data: drops.append(time.monotonic()))
        print(f"idle {args.idle:.0f}s ...")
        end = time.monotonic() + args.idle
        while time.monotonic() < end:
            time.sleep(1.0)
        if drops:
            problems.append(f"connection dropped {len(drops)} time(s) while idle")
        if not server.connected:
            problems.append("not connected after the idle period")
        else:
            tabs = server.call("tabs", {}, 15.0)
            print(f"request after idle answered: tabs={tabs!r}")
        for problem in problems:
            print("FAIL:", problem)
        ok = not problems
        print("PASS" if ok else "FAIL")
        return 0 if ok else 1
    finally:
        if session is not None:
            firefox_session.stop(profile)
        server.stop()
        time.sleep(1.0)
        if args.keep:
            print(f"kept {work}")
        else:
            shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
