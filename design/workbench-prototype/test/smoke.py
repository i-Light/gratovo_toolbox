"""Smoke test for the Workbench prototype.
Usage: python test/smoke.py [screen ...] [--shots DIR] [--wide 1440] [--dark]
Loads index.html from disk, serves the CDN libraries from ../vendor, visits each screen, clicks every
enabled button inside the main content once (skipping destructive-looking ones), and prints console errors."""
import sys, pathlib, json
from playwright.sync_api import sync_playwright
root = pathlib.Path(__file__).resolve().parent.parent
vendor = root / "vendor"
shots = None; dark = "--dark" in sys.argv; width = 1440; skip = set()
for i, a in enumerate(sys.argv):
    if a == "--shots": shots = pathlib.Path(sys.argv[i+1]); shots.mkdir(parents=True, exist_ok=True); skip.add(i+1)
    if a == "--wide": width = int(sys.argv[i+1]); skip.add(i+1)
screens = [a for i, a in enumerate(sys.argv) if i > 0 and i not in skip and not a.startswith("--")] or ["today"]
MAP = {"react.production.min.js":"react.production.min.js","react-dom.production.min.js":"react-dom.production.min.js","htm.umd.js":"htm.umd.js"}
errs = []
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width":width,"height":900}, color_scheme="dark" if dark else "light")
    pg = ctx.new_page()
    def route(r):
        name = r.request.url.split("/")[-1]
        if name in MAP: r.fulfill(path=str(vendor / MAP[name]), content_type="application/javascript")
        else: r.continue_()
    pg.route("**/*", route)
    pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    pg.on("console", lambda m: errs.append("console: " + m.text) if m.type == "error" else None)
    pg.goto((root / "index.html").as_uri()); pg.wait_for_function("window.W && W.SCREENS && document.querySelector('.app')"); pg.wait_for_timeout(300)
    for s in screens:
        pg.evaluate("s => W.go(s, (W.SCREENS[s].tabs||[[null]])[0][0])", s); pg.wait_for_timeout(300)
        tabs = pg.evaluate("s => (W.SCREENS[s].tabs||[]).map(t=>t[0])", s) or [None]
        for t in tabs:
            if t: pg.evaluate("([s,t]) => W.go(s,t)", [s, t]); pg.wait_for_timeout(250)
            if shots: pg.screenshot(path=str(shots / f"{s}{'-'+t if t else ''}.png"))
            n = pg.locator("#content button:not([disabled])").count()
            print(f"{s}{'/'+t if t else ''}: {n} buttons", flush=True)
    ctx.close(); b.close()
print("\n".join(errs[:40]) or "no errors")
