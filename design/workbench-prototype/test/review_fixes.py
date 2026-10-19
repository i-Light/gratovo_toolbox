"""Regression checks for the review findings (one block per finding).
Usage: python test/review_fixes.py"""
import pathlib, re
from playwright.sync_api import sync_playwright
root = pathlib.Path(__file__).resolve().parent.parent
vendor = root / "vendor"
MAP = {"react.production.min.js","react-dom.production.min.js","htm.umd.js"}
errs, fails = [], []
def check(cond, msg):
    print(("ok   " if cond else "FAIL ") + msg, flush=True)
    if not cond: fails.append(msg)
with sync_playwright() as p:
    b = p.chromium.launch()
    def fresh(width=1440):
        ctx = b.new_context(viewport={"width":width, "height":900})
        pg = ctx.new_page()
        pg.route("**/*", lambda r: r.fulfill(path=str(vendor / r.request.url.split("/")[-1]), content_type="application/javascript") if r.request.url.split("/")[-1] in MAP else r.continue_())
        pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
        pg.on("console", lambda m: errs.append("console: " + m.text) if m.type == "error" else None)
        pg.goto((root / "index.html").as_uri()); pg.wait_for_function("window.W && document.querySelector('.app')"); pg.wait_for_timeout(300)
        return ctx, pg

    ctx, pg = fresh(); ev = pg.evaluate
    # 1. Ctrl+Enter in a comment box saves the comment only
    ev("W.setProto(true, true)"); ev("W.go('today')"); pg.wait_for_timeout(300)
    sent0 = ev("W.D().deals.filter(x=>x.invoice.sent).length")
    pg.keyboard.press("c"); pg.wait_for_timeout(100)
    pg.locator(".work-h h2").click(); pg.wait_for_timeout(150)
    pg.keyboard.type("Heading should say who it's for."); pg.keyboard.press("Control+Enter"); pg.wait_for_timeout(250)
    check(ev("W.CM.list.length") == 1 and ev("W.D().deals.filter(x=>x.invoice.sent).length") == sent0, "1  Ctrl+Enter in the comment box doesn't send the invoice")
    pg.keyboard.press("Escape")

    # 3. comment mode and popups are barriers
    pg.keyboard.press("c"); pg.wait_for_timeout(100)
    sel0 = ev("W.U().todaySel"); pg.keyboard.press("j"); pg.wait_for_timeout(100)
    check(ev("W.U().todaySel") == sel0, "3  J does nothing in comment mode")
    pg.keyboard.press("Escape"); pg.wait_for_timeout(100)
    pg.keyboard.press("?"); pg.wait_for_timeout(100); pg.keyboard.press("j"); pg.keyboard.press("f"); pg.wait_for_timeout(100)
    check(ev("W.U().todaySel") == sel0 and not ev("W.U().focus"), "3  J and F do nothing behind the shortcuts sheet")
    pg.keyboard.press("Escape"); pg.wait_for_timeout(100)
    check(not ev("W.U().shortcuts"), "3  Esc closes the shortcuts sheet")

    # 2. one Esc closes one thing
    ev("W.peek('creator','c1')"); pg.wait_for_timeout(150)
    pg.keyboard.press("Control+k"); pg.wait_for_timeout(100); pg.keyboard.press("Escape"); pg.wait_for_timeout(100)
    check(not ev("W.U().palette") and ev("!!W.U().peek"), "2  Esc in the palette leaves the record open")
    # 4. Esc closes the comment card before the record
    cid = ev("W.CM.list[0].id"); ev(f"W.ui(u => u.proto = Object.assign({{}}, u.proto, {{open:'{cid}'}}))"); pg.wait_for_timeout(200)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(100)
    check(ev("!!W.U().peek") and not ev("W.U().proto.open"), "4  Esc closes the comment card first")
    pg.keyboard.press("Escape")

    # 10. pin number stays right after an edit
    ev(f"W.commentPatch('{cid}', {{text:'Edited text'}})"); pg.wait_for_timeout(700)
    pins = pg.locator(".cmt-pin:not(.static)")
    check(pins.count() == 1 and pins.first.inner_text().strip() == "1" and "Edited text" in (pins.first.get_attribute("aria-label") or ""), "10 pin keeps its number and shows the new text")

    # 22. toast buttons work in comment mode
    pg.keyboard.press("c"); pg.wait_for_timeout(100)
    ev("W.toast({msg:'Test', actions:[{label:'Act', run:function(){ window.__acted = 1; }}]})"); pg.wait_for_timeout(150)
    pg.locator(".toast button", has_text="Act").click(); pg.wait_for_timeout(100)
    check(ev("window.__acted === 1") and pg.locator(".cmt-pop").count() == 0, "22 toast buttons work in comment mode")
    pg.keyboard.press("Escape")

    # 5. first day: after the first search, the first item opens
    ev("W.setScenario('first')"); pg.wait_for_timeout(200)
    pg.locator(".fr-steps button", has_text="Start the search").click(); pg.wait_for_timeout(4300)
    ev("W.go('today')"); pg.wait_for_timeout(300)
    check(pg.locator(".work").count() == 1 and pg.locator(".first-run").count() == 0, "5  after the first search, Today opens the first item")

    # 9. undo after a search finishes never shows a phantom running search
    ev("W.setScenario('normal')"); pg.wait_for_timeout(200)
    ev("W.A.startRun('r3')"); pg.wait_for_timeout(1000)
    ev("W.act('A test change', function(d){ d.notes.c1 = [{who:'u1', at:W.now(), text:'x'}]; })")
    pg.wait_for_timeout(15000)
    check(ev("W.D().runs.find(r=>r.id==='r3').status") == "paused", "9  the run finished (paused at its stop)")
    ev("W.undo()"); pg.wait_for_timeout(300)
    st = ev("W.D().runs.find(r=>r.id==='r3').status"); jobs = ev("W.U().jobs.filter(j=>!j.done).length")
    check(not (st == "running" and jobs == 0), "9  undo doesn't bring back a running search with no job (status " + st + ")")

    # 8. no sending from a signed-out mailbox
    ev("W.setScenario('broke')"); pg.wait_for_timeout(200)
    qid = ev("(W.D().drafts.find(q=>!q.gates.length || q.gates.every(g=>g.ok)) || {}).id")
    ev(f"W.A.setMailbox('{qid}','m1')"); sent = ev("W.D().mail[0].sent")
    r = ev(f"W.A.sendDraft('{qid}')"); pg.wait_for_timeout(150)
    check(r is False and ev("W.D().mail[0].sent") == sent and pg.locator(".toast", has_text="Not sent").count() == 1, "8  a draft on a signed-out mailbox is not sent")
    pg.locator(".toast button", has_text="Send from").first.click(); pg.wait_for_timeout(200)
    check(not ev(f"!!W.draft('{qid}')"), "8  'Send from …' sends it from a working mailbox")

    # 7. a VA sees no amounts
    ev("W.setScenario('normal')"); ev("W.setViewAs('u3')"); pg.wait_for_timeout(200)
    leaks = []
    for s, t in [("today", None), ("reach", "board"), ("close", "roster"), ("close", "brands"), ("close", "negotiate"), ("close", "contracts"), ("deliver", "board"), ("toolbox", None)]:
        ev(f"W.go('{s}', {repr(t) if t else 'null'})"); pg.wait_for_timeout(250)
        txt = pg.locator("#content").inner_text()
        if re.search(r"\$\d", txt): leaks.append(f"{s}/{t}: " + re.search(r".{0,30}\$\d[\d,]*.{0,20}", txt).group(0).replace("\n", " "))
    check(not leaks, "7  no dollar amounts anywhere for a VA" + ("" if not leaks else ": " + " | ".join(leaks[:4])))
    check(ev("W.items('me').filter(i=>i.kind==='pitch'||i.kind==='qualify').length") == 0, "7  brand pitches and qualifying go to the owner, not the VA")
    ev("W.go('settings','prototype')"); pg.wait_for_timeout(150)
    check(pg.locator(".set-nav .li", has_text="Prototype mode").count() == 1, "13 the owner still reaches prototype settings while seeing the app as a VA")
    ev("W.setViewAs('u1')")

    # 6. an Undo toast never reaches across to the other data
    ev("W.setProto(false, true)"); pg.wait_for_timeout(150)
    rej0 = ev("W.D().creators.filter(c=>c.stage==='rejected').length")
    ev("W.A.reject([W.D().creators.find(c=>c.stage==='new').id], 'Too few views')")
    ev("W.setProto(true, true)"); ev("W.A.reject([W.D().creators.find(c=>c.stage==='new').id], 'Too few views')")
    ev("W.setProto(false, true)"); pg.wait_for_timeout(100)
    check(pg.locator(".toast", has_text="rejected").count() == 0 and ev("W.D().creators.filter(c=>c.stage==='rejected').length") == rej0 + 1, "6  switching prototype mode clears toasts; live data keeps its own change")

    # 14. no comment listener or writes while off
    check(ev("W.CM.unsub === null && W.CM.started === false"), "14 the comment store stops when prototype mode is off")
    ctx.close()

    # 11. prototype mode at phone width: no sideways scroll
    ctx, pg = fresh(400); ev = pg.evaluate
    ev("W.setProto(true, true)"); pg.wait_for_timeout(200)
    over = ev("document.querySelector('.top').scrollWidth - document.querySelector('.top').clientWidth")
    body = ev("document.documentElement.scrollWidth - document.documentElement.clientWidth")
    check(over <= 0 and body <= 0, f"11 the top bar fits at 400px with prototype mode on (overflow {over}px)")
    ctx.close()
    b.close()
print("\n".join(errs[:30]) or "no errors")
print(f"{len(fails)} failed")
