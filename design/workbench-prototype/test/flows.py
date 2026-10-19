"""Interaction checks for the core: Why layer, Show me, sending, triage keys, palette, undo."""
import sys, pathlib
from playwright.sync_api import sync_playwright
root = pathlib.Path(__file__).resolve().parent.parent; vendor = root / "vendor"
out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else root.parent / "shots_wb" / "flows"; out.mkdir(parents=True, exist_ok=True)
errs = []
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width":1440,"height":900})
    def route(r):
        n = r.request.url.split("/")[-1]
        if n in ("react.production.min.js","react-dom.production.min.js","htm.umd.js"): r.fulfill(path=str(vendor / n), content_type="application/javascript")
        else: r.continue_()
    pg.route("**/*", route)
    pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    pg.on("console", lambda m: errs.append("console: " + m.text) if m.type == "error" else None)
    pg.goto((root / "index.html").as_uri()); pg.wait_for_function("window.W && document.querySelector('.app')"); pg.wait_for_timeout(400)
    def shot(n): pg.screenshot(path=str(out / (n + ".png")))
    # why layer on today
    pg.evaluate("W.ui(u=>{u.why=true})"); pg.wait_for_timeout(700)
    print("pins on today:", pg.locator(".why-pin").count())
    pg.locator("button.why-pin").first.click(); pg.wait_for_timeout(200); shot("why-today")
    # show me: gates
    pg.evaluate("W.showMe('gates')"); pg.wait_for_timeout(900); shot("show-gates")
    print("gate popover:", pg.locator(".why-pop h3").all_inner_texts())
    pg.evaluate("W.ui(u=>{u.why=false; u.whyOpen=null})")
    # confirm address then send the draft with Ctrl+Enter
    pg.locator(".gate button.btn.pri").first.click(); pg.wait_for_timeout(300)
    print("toast after confirm:", pg.locator(".toast .tm").all_inner_texts()[-1:])
    pg.keyboard.press("Control+Enter"); pg.wait_for_timeout(400); shot("after-send")
    print("toast after send:", pg.locator(".toast .tm").all_inner_texts()[-1:])
    pg.keyboard.press("Control+z"); pg.wait_for_timeout(300)
    print("toast after undo:", pg.locator(".toast .tm").all_inner_texts()[-1:])
    # triage keys in Today finds
    pg.evaluate("W.ui(u=>{u.todaySel='finds'})"); pg.wait_for_timeout(300)
    before = pg.locator(".card h2").first.inner_text()
    pg.keyboard.press("s"); pg.wait_for_timeout(250); pg.keyboard.press("r"); pg.wait_for_timeout(250)
    print("triage moved:", before, "->", pg.locator(".card h2").first.inner_text())
    shot("triage")
    # palette
    pg.keyboard.press("Control+k"); pg.wait_for_timeout(200); pg.keyboard.type("agent"); pg.wait_for_timeout(200); shot("palette")
    print("palette results:", pg.locator(".pal-i").count())
    pg.keyboard.press("Enter"); pg.wait_for_timeout(400); shot("peek")
    print("peek open:", pg.locator(".peek").count())
    pg.keyboard.press("Escape"); pg.wait_for_timeout(200)
    # focus mode + wrap up
    pg.evaluate("W.go('today')"); pg.wait_for_timeout(200); pg.keyboard.press("f"); pg.wait_for_timeout(300); shot("focus")
    print("focus bar:", pg.locator(".focusbar").count())
    pg.keyboard.press("Escape"); pg.evaluate("W.ui(u=>{u.wrap=true})"); pg.wait_for_timeout(300); shot("wrap")
    # invoice + payout chain
    pg.evaluate("W.ui(u=>{u.wrap=false; u.todaySel='invoice:d3'})"); pg.wait_for_timeout(300); pg.keyboard.press("Control+Enter"); pg.wait_for_timeout(300)
    print("toast invoice:", pg.locator(".toast .tm").all_inner_texts()[-1:])
    pg.evaluate("W.ui(u=>{u.todaySel='collect:d4'})"); pg.wait_for_timeout(300); shot("collect")
    # dark theme look
    pg.evaluate("document.documentElement.dataset.theme='dark'"); pg.evaluate("W.ui(u=>{u.todaySel='reply:q9'})"); pg.wait_for_timeout(300); shot("dark-reply")
    # phone width
    pg.set_viewport_size({"width":400,"height":860}); pg.wait_for_timeout(300); shot("phone-today")
    print("phone overflow:", pg.evaluate("document.querySelector('.content').scrollWidth - document.querySelector('.content').clientWidth"))
    b.close()
print("\n".join(errs) or "no errors")
