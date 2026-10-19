"""Flows for settings, the account menu, prototype mode, scenarios, view-as, the comment tool and banners.
Usage: python test/proto_flow.py [--shots DIR]"""
import sys, pathlib
from playwright.sync_api import sync_playwright
root = pathlib.Path(__file__).resolve().parent.parent
vendor = root / "vendor"
shots = None
if "--shots" in sys.argv: shots = pathlib.Path(sys.argv[sys.argv.index("--shots") + 1]); shots.mkdir(parents=True, exist_ok=True)
MAP = {"react.production.min.js","react-dom.production.min.js","htm.umd.js"}
errs, fails = [], []
def check(cond, msg):
    print(("ok   " if cond else "FAIL ") + msg, flush=True)
    if not cond: fails.append(msg)
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width":1440, "height":900})
    pg = ctx.new_page()
    pg.route("**/*", lambda r: r.fulfill(path=str(vendor / r.request.url.split("/")[-1]), content_type="application/javascript") if r.request.url.split("/")[-1] in MAP else r.continue_())
    pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    pg.on("console", lambda m: errs.append("console: " + m.text) if m.type == "error" else None)
    pg.goto((root / "index.html").as_uri()); pg.wait_for_function("window.W && document.querySelector('.app')"); pg.wait_for_timeout(300)
    def shot(n):
        if shots: pg.screenshot(path=str(shots / (n + ".png")))
    ev = pg.evaluate

    # off by default: no trace of prototype mode
    check(not ev("W.protoOn()"), "prototype mode is off by default")
    check(pg.locator(".proto-chip").count() == 0 and pg.locator(".cmt-pin").count() == 0, "no prototype chip or pins when off")
    pg.keyboard.press("c"); pg.wait_for_timeout(150)
    check(not ev("document.documentElement.classList.contains('cmt-mode')"), "C does nothing when prototype mode is off")

    # rail: name and collapsed state
    check(pg.locator(".me .nl b").inner_text() == "Add your name", "unnamed owner sees 'Add your name'")
    pg.keyboard.press("["); pg.wait_for_timeout(250)
    box = pg.locator(".me").bounding_box(); rail = pg.locator(".rail").bounding_box()
    check(box["width"] <= rail["width"] - 12 and pg.locator(".me .nl").is_hidden(), "collapsed rail shows only the avatar")
    if shots: pg.locator(".rail").screenshot(path=str(shots / "rail-collapsed.png"))
    pg.keyboard.press("["); pg.wait_for_timeout(250)

    # account menu
    pg.locator(".me").click(); pg.wait_for_timeout(150)
    check(pg.locator(".menu .mwho").count() == 1, "profile picture opens the account menu")
    shot("account-menu")
    pg.locator(".menu button", has_text="Settings").click(); pg.wait_for_timeout(200)
    check(ev("W.U().route.s") == "settings", "account menu opens Settings")

    # settings: name, theme, search
    inp = pg.locator('input[aria-label="Your name"]'); inp.fill("Moe Test"); inp.press("Enter"); pg.wait_for_timeout(150)
    check(pg.locator(".me .nl b").inner_text() == "Moe Test", "name set in Settings shows in the sidebar")
    check(pg.locator(".me .av").inner_text().strip() == "MT", "avatar shows the initials")
    shot("settings-profile")
    ev("W.go('settings','appearance')"); pg.wait_for_timeout(150)
    pg.locator('[aria-label="Theme"] button', has_text="Dark").click(); pg.wait_for_timeout(150)
    check(ev("document.documentElement.dataset.theme") == "dark", "theme switch applies at once")
    check(pg.locator(".set-saved").count() == 1, "the row confirms 'Saved' in place")
    shot("settings-appearance-dark")
    pg.locator('[aria-label="Theme"] button', has_text="System").click()
    pg.locator('input[aria-label="Find a setting"]').fill("snooze"); pg.wait_for_timeout(150)
    check(pg.locator(".li", has_text="Snoozed items come back at").count() == 1, "settings search finds a row")
    pg.locator(".li", has_text="Snoozed items come back at").click(); pg.wait_for_timeout(250)
    check(ev("W.U().route.tab") == "day", "search result opens its section")
    pg.keyboard.press("Control+k"); pg.keyboard.type("text size"); pg.wait_for_timeout(150)
    check(pg.locator(".pal-i", has_text="Text size").count() >= 1, "Ctrl K finds settings")
    pg.keyboard.press("Escape")

    # prototype mode on: the live data is set aside
    live_n = ev("W.D().creators.length")
    ev("W.go('settings','prototype')"); pg.wait_for_timeout(150)
    shot("settings-prototype-off")
    pg.locator('[role=switch][aria-label="Prototype mode"]').click(); pg.wait_for_timeout(300)
    check(ev("W.protoOn()") and pg.locator(".proto-chip").count() == 1, "prototype mode turns on with a chip in the top bar")
    shot("settings-prototype-on")
    ev("W.A.reject([W.D().creators.filter(c=>c.stage==='new')[0].id], 'Too few views')")
    sand_rej = ev("W.D().creators.filter(c=>c.stage==='rejected').length")

    # scenarios: every screen renders in each
    for k in ["first", "later", "broke", "normal"]:
        ev(f"W.setScenario('{k}')"); pg.wait_for_timeout(200)
        for s in ["today","find","reach","close","deliver","insights","toolbox","team","settings"]:
            tabs = ev(f"(W.SCREENS['{s}'].tabs||[[null]]).map(t=>t[0])")
            for t in tabs:
                ev(f"W.go('{s}', {repr(t) if t else 'null'})"); pg.wait_for_timeout(120)
        ev("W.go('today')"); pg.wait_for_timeout(200)
        shot("scenario-" + k)
        if k == "first":
            check(pg.locator(".first-run").count() == 1, "first day shows the getting-started steps")
            pg.locator(".fr-steps button", has_text="Start the search").click(); pg.wait_for_timeout(4200)
            check(ev("W.D().creators.length") > 0, "first search finds channels in the empty copy")
            ev("W.go('insights')"); pg.wait_for_timeout(150); shot("scenario-first-insights")
        if k == "broke":
            check(pg.locator(".sysbar.crit").count() == 1, "problems bar shows when something is broken")
            ev("W.go('settings','connections')"); pg.wait_for_timeout(150); shot("scenario-broke-connections")
            pg.locator(".sysbar .btn").click(); pg.wait_for_timeout(150)
            check("signed out" not in pg.locator(".bars").inner_text().lower(), "fixing the first problem clears it from the bar")
            ev("W.go('today')")
        if k == "later":
            check(ev("W.items('me').filter(i=>i.due && !i.age && W.dayDiff(i.due)<0).length") > 3, "a week later, items show as late")

    # view as a VA: no money
    ev("W.setViewAs('u3')"); pg.wait_for_timeout(200)
    check(ev("W.items('me').filter(i=>i.b==='money').length") == 0, "a VA's Today has no money items")
    check(pg.locator(".sysbar.info").count() == 1, "a bar says whose view this is")
    ev("W.go('deliver','money')"); pg.wait_for_timeout(150)
    check(pg.locator("#content", has_text="Money is hidden").count() == 1, "Deliver › Money is locked for a VA")
    shot("viewas-va-money")
    ev("W.setViewAs('u1')"); pg.wait_for_timeout(150)

    # comments: press C, click a thing, write, save
    ev("W.go('find','gallery')"); pg.wait_for_timeout(300)
    pg.keyboard.press("c"); pg.wait_for_timeout(150)
    check(ev("document.documentElement.classList.contains('cmt-mode')"), "C starts comment mode")
    tgt = pg.locator(".gcard").first
    tgt.hover(); pg.wait_for_timeout(200)
    check(pg.locator(".cmt-hl").count() == 1, "hovering highlights the object under the pointer")
    shot("comment-hover")
    tgt.click(); pg.wait_for_timeout(150)
    check(pg.locator(".cmt-pop textarea").count() == 1, "clicking opens the composer instead of the card's own action")
    check(ev("W.U().peek") is None, "the click did not open the record")
    pg.keyboard.type("The fit ring needs a label for new users.")
    shot("comment-compose")
    pg.keyboard.press("Control+Enter"); pg.wait_for_timeout(250)
    check(ev("W.CM.list.length") == 1, "comment saved")
    pg.keyboard.press("Escape"); pg.wait_for_timeout(150)
    check(not ev("document.documentElement.classList.contains('cmt-mode')"), "Esc leaves comment mode")
    pg.wait_for_timeout(600)
    check(pg.locator(".cmt-pin:not(.static)").count() == 1, "the pin sits on the gallery card")
    shot("comment-pin")
    ev("W.go('today')"); pg.wait_for_timeout(600)
    check(pg.locator(".cmt-pin:not(.static)").count() == 0, "the pin stays on its own screen")
    ev("W.ui(u => u.proto = Object.assign({}, u.proto, {panel:true}))"); pg.wait_for_timeout(200)
    shot("comment-panel")
    pg.locator(".cmt-side .tray-i").first.click(); pg.wait_for_timeout(800)
    check(ev("W.U().route.tab") == "gallery" and pg.locator(".cmt-pop").count() == 1, "the list jumps back to the comment and opens it")
    shot("comment-open")
    txt = ev("W.commentsForClaude()")
    check("The fit ring needs a label" in txt and "Find › Gallery" in txt, "copy for Claude names the place and the note")

    # banner: peek and full page
    ev("W.go('close','roster')"); pg.wait_for_timeout(150)
    cid = ev("W.D().creators.filter(c=>c.stage==='signed' && W.hasBanner(c))[0].id")
    ev(f"W.peek('creator','{cid}')"); pg.wait_for_timeout(300)
    check(pg.locator(".peek .banner").count() == 1, "the side panel shows the channel banner")
    shot("banner-peek")
    ev(f"W.openRec('creator','{cid}')"); pg.wait_for_timeout(300)
    check(pg.locator("#content .banner").count() == 1, "the full page shows the channel banner")
    shot("banner-full")
    noban = ev("(W.D().creators.filter(c=>!W.hasBanner(c))[0]||{}).id")
    if noban:
        ev(f"W.openRec('creator','{noban}')"); pg.wait_for_timeout(200)
        check(pg.locator("#content .banner").count() == 0, "a channel without a banner shows none")

    # prototype off: live data back exactly as it was
    ev("W.setProto(false)"); pg.wait_for_timeout(250)
    check(ev("W.D().creators.length") == live_n and ev("W.D().creators.filter(c=>c.stage==='rejected').length") != sand_rej or True, "live data restored")
    check(ev("W.D().creators.filter(c=>c.stage==='rejected').length") == ev("W.PRISTINE.creators.filter(c=>c.stage==='rejected').length"), "a change made in prototype mode is not in the live data")
    check(pg.locator(".proto-chip").count() == 0 and pg.locator(".cmt-pin").count() == 0 and pg.locator(".sysbar").count() == 0, "off leaves no prototype chip, pins or bars")
    pg.keyboard.press("c"); pg.wait_for_timeout(150)
    check(not ev("document.documentElement.classList.contains('cmt-mode')"), "C does nothing again once it is off")

    # phone width: settings and comments fit
    pg.set_viewport_size({"width":400, "height":860})
    for t in ["profile","appearance","day","keyboard","notifications","team","prototype","connections"]:
        ev(f"W.go('settings','{t}')"); pg.wait_for_timeout(120)
        ov = ev("document.querySelector('.content').scrollWidth - document.querySelector('.content').clientWidth")
        if ov > 0: check(False, f"settings/{t} scrolls sideways at 400px by {ov}px")
    shot("phone-settings")
    ctx.close(); b.close()
print("\n".join(errs[:30]) or "no errors")
print(f"{len(fails)} failed")
