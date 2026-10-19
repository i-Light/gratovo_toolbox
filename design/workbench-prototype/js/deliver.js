/* deliver.js — Deliver and get paid. Two tabs: the deal board (ten steps, scrolls sideways inside its own
   container) and the money (what brands owe us, what we owe creators, and the one rule between them: a creator
   is paid only after the brand has paid). Every card and row opens the deal in the peek; every change goes
   through W.A.* so it toasts with Undo. */
(function(){
"use strict";
var W = window.W, html = W.html, Icon = W.Icon, useState = W.useState, useEffect = W.useEffect, useRef = W.useRef;
var Btn = W.Btn, Tag = W.Tag;

W.css(`
.dv-bar{display:flex; align-items:center; gap:8px; flex-wrap:wrap}
.dv-bar .sp{min-width:0}
.dv-board{align-items:stretch; grid-auto-columns:minmax(236px,1fr); min-height:clamp(340px, calc(100vh - 400px), 600px); padding-bottom:10px}
.dv-board:focus-visible{outline-offset:-2px}
.dv-lane{padding:8px; gap:8px}
.dv-lane .lane-h{align-items:flex-start; gap:8px; padding:4px 4px 6px}
.dv-step{width:20px; height:20px; border-radius:50%; display:grid; place-items:center; flex:none; font:600 10.5px var(--f-mono); color:var(--deliver); background:color-mix(in srgb, var(--deliver) 14%, transparent)}
.dv-hint{color:var(--muted); display:inline-grid; place-items:center; height:20px; flex:none}
.dv-hint .ic{width:14px; height:14px}
.dv-card{cursor:pointer; gap:8px}
.dv-card[aria-current="true"]{border-color:var(--accent); box-shadow:0 0 0 2px var(--accent-soft)}
.dv-name{font-weight:500; font-size:13px; line-height:1.3; overflow-wrap:anywhere}
.dv-price{font-size:12.5px; font-weight:600; flex:none}
.dv-quiet{border:1px dashed var(--line-2); border-radius:var(--r-m); padding:16px 8px; text-align:center; font-size:12px; color:var(--faint)}
.dv-note{display:flex; align-items:center; gap:6px}
.dv-note .ic{flex:none}

.tiles.dv-tiles{grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}
.dv-ts{flex-wrap:wrap; gap:2px 12px}
.dv-ts>span{display:inline-flex; align-items:center; gap:4px}
.dv-ts .ic{width:13px; height:13px; flex:none}
.dv-crit{color:var(--crit)} .dv-warn{color:var(--warn)} .dv-good{color:var(--good)}
.dv-call{flex-wrap:wrap; align-items:center; gap:8px 12px}
.dv-call>.grow{flex:1 1 260px}
.dv-ca{display:flex; gap:8px; flex-wrap:wrap}
.dv-age{display:flex; height:34px; border-radius:8px; overflow:hidden; gap:2px; background:var(--sunk-2)}
.dv-age>i{display:flex; align-items:center; min-width:6px; padding:0 10px; font:600 12px var(--f-ui); font-style:normal; color:var(--panel); white-space:nowrap; overflow:hidden}
.dv-age>i>span{overflow:hidden; text-overflow:ellipsis}
.dv-age.none{align-items:center; justify-content:center; color:var(--muted); font-size:12.5px}
.dv-k-unsent{background:repeating-linear-gradient(135deg, var(--sunk-2) 0 6px, var(--panel) 6px 12px); box-shadow:inset 0 0 0 1px var(--line-2)}
.dv-age>i.dv-k-unsent{color:var(--ink)}
.dv-k-ok{background:var(--good)} .dv-k-soon{background:var(--warn)} .dv-k-late{background:var(--crit)}
.dv-legend{display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:10px 16px}
.dv-lg{display:flex; gap:9px; align-items:flex-start; min-width:0}
.dv-lg.zero{opacity:.55}
.dv-lg>i{width:12px; height:12px; border-radius:4px; flex:none; margin-top:3px}
.dv-lg b{display:block; font-weight:600; font-variant-numeric:tabular-nums}
.dv-lg small{display:block; color:var(--muted); font-size:12px}

.dv-tbl th,.dv-tbl td{padding-inline:10px; white-space:nowrap}
.dv-tbl td.dv-act,.dv-tbl th.dv-act{position:sticky; inset-inline-end:0; background:var(--panel); border-inline-start:1px solid var(--line); text-align:end}
.dv-tbl th.dv-act{background:var(--sunk); z-index:2}
.dv-tbl tbody tr:hover td.dv-act{background:var(--sunk)}
.dv-tbl tbody tr[aria-selected="true"] td.dv-act{background:var(--accent-soft)}
.dv-tbl .dv-act .row{justify-content:flex-end}
.dv-tbl tr.dv-paid td:not(.dv-act){color:var(--ink-2)}
.dv-link{border:0; background:none; padding:0; color:var(--ink); font:inherit; text-align:start}
.dv-link:hover{text-decoration:underline}
.dv-locked{opacity:.6; cursor:not-allowed}
.dv-locked:hover{background:var(--panel)}
@media (max-width:760px){ .dv-tbl td.dv-act,.dv-tbl th.dv-act{position:static} }
.dv-who{min-width:0}
.dv-who b{font-weight:500}
`);

/* ---------- screen state (W.U().deliver), created on first write ---------- */
var DEF = {who:"all", late:false, recv:"all"};
function view(u){ return Object.assign({}, DEF, u.deliver); }
function setView(patch){ W.ui(function(u){ u.deliver = Object.assign({}, DEF, u.deliver, patch); }); }
function openDeal(id, list){ W.peek("deal", id, list); }
function peeked(u){ return u.peek && u.peek.t === "deal" ? u.peek.id : null; }

/* ---------- money facts about one deal ---------- */
/* invoice: later (not live yet) · unsent (live, not sent) · open · late · paid */
function invState(x){ var i = x.invoice; if (i.paid) return "paid"; if (i.sent) return W.dayDiff(i.due) < 0 ? "late" : "open"; return x.step >= 6 ? "unsent" : "later"; }
/* payout: locked until the brand pays, then unlocked, then paid */
function payState(x){ return x.paidCreator ? "paid" : x.invoice.paid ? "unlocked" : "locked"; }
function isLate(x){ return invState(x) === "late" || (!!x.due && W.dayDiff(x.due) < 0); }
function ageBucket(x){ var s = invState(x); if (s === "unsent" || s === "late") return s; if (s === "open") return W.dayDiff(x.invoice.due) <= 7 ? "soon" : "ok"; return null; }
function reminderOf(x){ return W.D().drafts.filter(function(q){ return q.kind === "nudge" && q.deal === x.id; })[0] || null; }
function remind(x){ var q = reminderOf(x); if (q){ W.ui(function(u){ u.todaySel = "send:" + q.id; }); W.go("today"); } else W.A.nudge(x.id); }
function daysAgo(ts){ var n = W.dayDiff(ts); return n === 0 ? "today" : n === -1 ? "yesterday" : n < 0 ? (-n) + " days ago" : W.fmtShort(ts); }
function stop(f){ return function(e){ e.stopPropagation(); f(e); }; }

function calc(d){
  var m0 = new Date(W.now()); m0.setDate(1); m0.setHours(0, 0, 0, 0); m0 = m0.getTime();
  var r = {invoiced:0, nInv:0, collected:0, nPaid:0, lastPaid:null, out:0, nOut:0, late:0, nLate:0, unsent:0, nUnsent:0, ready:0, nReady:0, locked:0, nLocked:0, later:0, nLater:0, laterPay:0,
    age:{unsent:{sum:0, n:0}, ok:{sum:0, n:0}, soon:{sum:0, n:0}, late:{sum:0, n:0}}};
  d.deals.forEach(function(x){
    var i = x.invoice, s = invState(x), ps = payState(x), k = ageBucket(x);
    if (i.sent && i.sent >= m0){ r.invoiced += x.price; r.nInv++; }
    if (i.paid && i.paid >= m0){ r.collected += x.price; r.nPaid++; if (!r.lastPaid || i.paid > r.lastPaid.at) r.lastPaid = {at:i.paid, brand:W.brand(x.brand).name}; }
    if (k){ r.age[k].sum += x.price; r.age[k].n++; }
    if (s === "open" || s === "late"){ r.out += x.price; r.nOut++; }
    if (s === "late"){ r.late += x.price; r.nLate++; }
    if (s === "unsent"){ r.unsent += x.price; r.nUnsent++; }
    if (s === "later"){ r.later += x.price; r.nLater++; r.laterPay += x.payout; }
    if (x.step >= 6){ if (ps === "unlocked"){ r.ready += x.payout; r.nReady++; } else if (ps === "locked"){ r.locked += x.payout; r.nLocked++; } }
  });
  return r;
}

/* ================= board ================= */
function DealCard(p){
  var x = p.x, nx = W.nextFor({t:"deal", id:x.id}), b = W.brand(x.brand);
  var done = x.checks.filter(Boolean).length, total = x.checks.length, s = invState(x), ps = payState(x), tag = null;
  if (x.step === 8 && !x.paidCreator) tag = ps === "unlocked" ? html`<${Tag} tone="good" icon="unlock">Ready to pay</${Tag}>` : html`<${Tag} icon="lock" tip="Creators are paid from money already received">Waits for ${b.name} to pay</${Tag}>`;
  else if (s === "late") tag = html`<${Tag} tone="crit" icon="alert">Invoice ${W.plural(-W.dayDiff(x.invoice.due), "day")} late</${Tag}>`;
  else if (s === "unsent") tag = html`<${Tag} tone="warn" icon="alert">Invoice not sent</${Tag}>`;
  else if (x.paidCreator) tag = html`<${Tag} tone="good" icon="check">Creator paid ${W.fmtShort(x.paidCreator)}</${Tag}>`;
  return html`<button type="button" class="kcard dv-card" aria-current=${p.sel ? "true" : null} onClick=${p.onOpen}>
    <span class="row" style=${{alignItems:"flex-start"}}><b class="dv-name grow">${W.dealName(x)}</b>${x.owner ? html`<${W.Av} id=${x.owner} size="s" />` : null}</span>
    <span class="row"><small class="ell grow" data-tip=${nx ? nx.label : null}>${nx ? nx.label : ""}</small><b class="num dv-price">${W.money(x.price)}</b></span>
    <span class="row"><${W.Meter} v=${done} max=${total} w=${56} tone=${done === total ? "good" : null} label=${done + " of " + total + " checks done"} /><small class="num">${done}/${total}</small><span class="sp"></span><${W.Due} ts=${x.due} /></span>
    ${tag ? html`<span class="row wrap">${tag}</span>` : null}
  </button>`;
}

function Lane(p){
  var l = p.l, s = l.s, hint = null;
  if (s.lockedUntilPaid) hint = {icon:"lock", tip:"A deal waits here until the brand has paid. Creators are paid from money already received."};
  else if (s.k === "invoice") hint = {icon:"wallet", tip:"Net 30 starts the day the invoice is sent."};
  else if (s.ordered) hint = {icon:"info", tip:s.note};
  return html`<section class="lane dv-lane" aria-label=${s.name + ", " + W.plural(l.ds.length, "deal")}>
    <div class="lane-h">
      <span class="dv-step" aria-hidden="true">${l.i + 1}</span>
      <span class="col t2 grow" style=${{gap:"1px"}}><span class="ell">${s.name}</span><small class="num">${l.ds.length ? W.money(l.sum) : "–"}</small></span>
      ${hint ? html`<span class="dv-hint" data-tip=${hint.tip}><${Icon} n=${hint.icon} /></span>` : null}
      <span class="m">${l.ds.length}</span>
    </div>
    ${l.ds.length ? l.ds.map(function(x){ return html`<${DealCard} key=${x.id} x=${x} sel=${p.pk === x.id} onOpen=${function(){ openDeal(x.id, p.order); }} />`; }) : html`<div class="dv-quiet">No deals in this step</div>`}
  </section>`;
}

function BoardTab(){
  var st = W.useApp(), d = st.data, u = st.ui, v = view(u), pk = peeked(u);
  var ref = useRef(null), es = useState({l:false, r:true}), edge = es[0], setEdge = es[1];
  var mine = d.deals.filter(function(x){ return v.who === "all" || W.owned(x); });
  var shown = mine.filter(function(x){ return !v.late || isLate(x); }).sort(W.by(function(x){ return x.due || Infinity; }));
  var has = shown.length > 0, order = [];
  var lanes = W.DEAL_FLOW.map(function(s, i){ var ds = shown.filter(function(x){ return x.step === i; }); ds.forEach(function(x){ order.push(x.id); }); return {s:s, i:i, ds:ds, sum:W.sum(ds, function(x){ return x.price; })}; });
  useEffect(function(){
    var el = ref.current; if (!el) return;
    function upd(){ var l = el.scrollLeft > 4, r = el.scrollLeft + el.clientWidth < el.scrollWidth - 4; setEdge(function(o){ return o.l === l && o.r === r ? o : {l:l, r:r}; }); }
    upd(); el.addEventListener("scroll", upd, {passive:true});
    var ro = window.ResizeObserver ? new window.ResizeObserver(upd) : null; if (ro) ro.observe(el);
    return function(){ el.removeEventListener("scroll", upd); if (ro) ro.disconnect(); };
  }, [has]);
  function nudgeBoard(dir){ var el = ref.current; if (el) el.scrollBy({left:dir * Math.max(240, el.clientWidth * .8), behavior:"smooth"}); }
  var lateN = mine.filter(isLate).length;
  return html`<${W.Fragment}>
    <div class="dv-bar">
      <${W.Seg} label="Whose deals" cur=${v.who} onPick=${function(k){ setView({who:k}); }} opts=${[["me", "Mine", "user", "Deals you own"], ["all", "Everyone", "users", "The whole team's deals"]]} />
      <button type="button" class="chip" aria-pressed=${String(v.late)} onClick=${function(){ setView({late:!v.late}); }}><${Icon} n="alert" s=${13} />Late only <span class="c">${lateN}</span></button>
      <span class="sp"></span>
      <span class="small muted num">${W.plural(shown.length, "deal")} · ${W.money(W.sum(shown, function(x){ return x.price; }))}</span>
      <span class="row" style=${{gap:"2px"}}>
        <${W.IconBtn} icon="chevL" label="Scroll the board left" cls="hide-narrow" disabled=${!has || !edge.l} onClick=${function(){ nudgeBoard(-1); }} />
        <${W.IconBtn} icon="chevR" label="Scroll the board right" cls="hide-narrow" disabled=${!has || !edge.r} onClick=${function(){ nudgeBoard(1); }} />
      </span>
    </div>
    ${has ? html`<div class="board dv-board" data-why="dealboard" ref=${ref} role="group" aria-label="Deals by step. Scrolls sideways." tabindex="0">${lanes.map(function(l){ return html`<${Lane} key=${l.s.k} l=${l} pk=${pk} order=${order} />`; })}</div>`
      : html`<div class="card"><${W.Empty} icon=${v.late ? "checkc" : "box"} title=${v.late ? "Nothing is late" : "No deals are yours"}
          action=${html`<${Btn} size="sm" onClick=${function(){ setView(v.late ? {late:false} : {who:"all"}); }}>${v.late ? "Show every deal" : "Show everyone's deals"}</${Btn}>`}>${v.late ? "Every deal in this view is on time." : "Deals you own appear here. Everyone's deals are one click away."}</${W.Empty}></div>`}
    <p class="hint dv-note"><${Icon} n="lock" s=${14} />A deal waits in Pay creator until the brand has paid. Creators are paid from money already received.</p>
  </${W.Fragment}>`;
}

/* ================= money ================= */
function Tiles(p){
  var m = p.m;
  return html`<div class="tiles dv-tiles">
    <div class="tile"><span class="tl">Invoiced this month</span><b>${W.money(m.invoiced)}</b>
      <span class="ts dv-ts"><span>${m.nInv ? W.plural(m.nInv, "invoice") + " sent" : "Nothing sent yet"}</span>${m.nUnsent ? html`<span class="dv-warn"><${Icon} n="alert" />${W.money(m.unsent)} not sent yet</span>` : null}</span></div>
    <div class="tile"><span class="tl">Collected this month</span><b>${W.money(m.collected)}</b>
      <span class="ts dv-ts"><span>${m.nPaid ? W.plural(m.nPaid, "payment") + " · " + m.lastPaid.brand + ", " + W.fmtShort(m.lastPaid.at) : "No payments yet"}</span></span></div>
    <div class="tile"><span class="tl">Outstanding</span><b>${W.money(m.out)}</b>
      <span class="ts dv-ts"><span>${W.plural(m.nOut, "invoice")} open</span>${m.nLate ? html`<span class="dv-crit"><${Icon} n="alert" />${W.money(m.late)} late</span>` : html`<span class="dv-good"><${Icon} n="check" />Nothing late</span>`}</span></div>
    <div class="tile"><span class="tl">Owed to creators</span><b>${W.money(m.ready + m.locked)}</b>
      <span class="ts dv-ts"><span class=${m.ready ? "dv-good" : ""}><${Icon} n="unlock" />${W.money(m.ready)} ready to pay</span><span><${Icon} n="lock" />${W.money(m.locked)} locked</span></span></div>
  </div>`;
}

function Callouts(p){
  var late = p.recv.filter(function(x){ return invState(x) === "late"; }).sort(W.by(function(x){ return x.invoice.due; }));
  var unsent = p.recv.filter(function(x){ return invState(x) === "unsent"; }).sort(W.by(function(x){ return x.golive; }));
  var out = [];
  if (late.length){
    var x = late[0], b = W.brand(x.brand), c = W.creator(x.creator), n = -W.dayDiff(x.invoice.due), q = reminderOf(x);
    out.push(html`<div key="late" class="callout crit dv-call"><${Icon} n="alert" />
      <div class="grow">${late.length === 1
        ? html`<b>${b.name} is ${W.plural(n, "day")} late</b> on invoice ${x.invoice.no}. ${W.money(x.price)} was due ${W.fmtDate(x.invoice.due)}, and ${c.name}'s ${W.money(x.payout)} payout stays locked until it arrives.`
        : html`<b>${W.plural(late.length, "invoice")} are late, ${W.money(W.sum(late, function(y){ return y.price; }))} in total.</b> The oldest is ${b.name}, ${W.plural(n, "day")} past Net 30.`}</div>
      <div class="dv-ca"><${Btn} kind="pri" size="sm" icon="mail" onClick=${function(){ remind(x); }}>${q ? "Review reminder" : "Draft a reminder"}${late.length > 1 ? " to " + b.name : ""}</${Btn}>
        ${late.length === 1 ? html`<${Btn} size="sm" icon="check" onClick=${function(){ W.A.markPaid(x.id); }}>Mark paid</${Btn}>` : null}</div></div>`);
  }
  if (unsent.length){
    var y = unsent[0], yb = W.brand(y.brand), yc = W.creator(y.creator);
    out.push(html`<div key="unsent" class="callout warn dv-call"><${Icon} n="clock" />
      <div class="grow">${unsent.length === 1
        ? html`<b>${yb.name}'s invoice has not gone out.</b> ${yc.name} went live ${daysAgo(y.golive)}. Net 30 starts only when it is sent.`
        : html`<b>${W.plural(unsent.length, "invoice")} have not gone out</b> (${W.money(W.sum(unsent, function(z){ return z.price; }))}). Net 30 starts only when each one is sent.`}</div>
      <div class="dv-ca"><${Btn} kind="pri" size="sm" icon="send" onClick=${function(){ W.A.sendInvoice(y.id); }}>Send ${yb.name}'s invoice</${Btn}></div></div>`);
  }
  if (!out.length && p.recv.length) out.push(html`<div key="ok" class="callout good dv-call"><${Icon} n="checkc" /><div class="grow"><b>Nothing is late and every invoice is out.</b> Net 30 is running on all of them.</div></div>`);
  return out.length ? html`<div class="col tight">${out}</div>` : null;
}

var AGE = [["unsent", "Not sent yet", "Net 30 has not started"], ["ok", "Not due", "More than 7 days left"], ["soon", "Due within 7 days", "Ask early, politely"], ["late", "Late", "Past the Net 30 date"]];
function Aging(p){
  var a = p.m.age, total = W.sum(AGE, function(k){ return a[k[0]].sum; });
  return html`<div class="card">
    <div class="card-h"><h3>Invoices by due date</h3><span class="small ink2 num">${W.money(total)} waiting on brands</span></div>
    ${total ? html`<div class="dv-age" role="img" aria-label=${AGE.filter(function(k){ return a[k[0]].n; }).map(function(k){ return k[1] + " " + W.money(a[k[0]].sum); }).join(", ")}>
        ${AGE.filter(function(k){ return a[k[0]].sum > 0; }).map(function(k){ return html`<i key=${k[0]} class=${"dv-k-" + k[0]} style=${{flexGrow:a[k[0]].sum, flexBasis:0}}><span>${k[1]} · ${W.money(a[k[0]].sum)}</span></i>`; })}
      </div>` : html`<div class="dv-age none">No open invoices</div>`}
    <div class="dv-legend">${AGE.map(function(k){ var g = a[k[0]]; return html`<div key=${k[0]} class=${W.cx("dv-lg", g.n ? null : "zero")}><i class=${"dv-k-" + k[0]}></i><span><b>${k[1]} <span class="muted" style=${{fontWeight:400}}>${W.money(g.sum)}</span></b><small>${g.n ? W.plural(g.n, "invoice") : k[2]}</small></span></div>`; })}</div>
    <p class="hint dv-note"><${Icon} n="info" s=${14} />Net 30 means the brand has 30 days from the day you send the invoice. Send it on go-live day so the clock starts at once.</p>
  </div>`;
}

function Net30(p){
  var x = p.x, i = x.invoice, s = p.s;
  if (s === "unsent") return html`<span class="row" style=${{gap:"8px"}}><${W.Meter} v=${0} max=${30} w=${110} label="Net 30 has not started" /><span class="tiny muted">Starts when sent</span></span>`;
  var used = s === "paid" ? Math.max(0, W.dayDiff(i.paid) - W.dayDiff(i.sent)) : -W.dayDiff(i.sent);
  var tone = s === "paid" ? "good" : s === "late" ? "crit" : W.dayDiff(i.due) <= 7 ? "warn" : null;
  return html`<span class="row" style=${{gap:"8px"}}><${W.Meter} v=${used} max=${30} w=${110} tone=${tone} label=${"Day " + used + " of 30"} /><span class=${W.cx("tiny num", s === "late" ? "dv-crit b" : "muted")}>${s === "paid" ? "Paid on day " + used : "Day " + used + " of 30"}</span></span>`;
}
function InvTag(p){
  var x = p.x, s = p.s, i = x.invoice;
  if (s === "paid") return html`<${Tag} tone="good" icon="check">Paid ${W.fmtShort(i.paid)}</${Tag}>`;
  if (s === "late") return html`<${Tag} tone="crit" icon="alert">${W.plural(-W.dayDiff(i.due), "day")} late</${Tag}>`;
  if (s === "unsent") return html`<${Tag} tone="warn" icon="alert" tip=${"Went live " + daysAgo(x.golive) + ". The Net 30 clock has not started."}>Not sent</${Tag}>`;
  var n = W.dayDiff(i.due);
  return n <= 7 ? html`<${Tag} tone="warn" icon="clock">${n === 0 ? "Due today" : "Due in " + W.plural(n, "day")}</${Tag}>` : html`<${Tag} tone="info" icon="clock">Due ${W.fmtShort(i.due)}</${Tag}>`;
}

function paidMenu(e, x){
  var since = -W.dayDiff(x.invoice.sent);
  var opts = [[0, "Today"], [1, "Yesterday"], [2, "2 days ago"], [7, "A week ago"]].filter(function(o){ return o[0] <= since; });
  W.menu(e, [{head:"When did the money arrive?"}].concat(opts.map(function(o){ return {label:o[1], hint:W.fmtShort(W.at(-o[0], 12, 0)), icon:"calendar", run:function(){ W.A.markPaid(x.id, o[0] ? W.at(-o[0], 12, 0) : undefined); }}; })), {align:"end"});
}
function MarkPaid(p){
  var x = p.x;
  return html`<span class="btn-split"><${Btn} size="sm" icon="check" onClick=${stop(function(){ W.A.markPaid(x.id); })}>Mark paid</${Btn}><button type="button" class="btn sm" aria-label="Choose when it was paid" data-tip="Paid on another day" onClick=${stop(function(e){ paidMenu(e, x); })}><${Icon} n="chevD" s=${13} /></button></span>`;
}

function RecvRow(p){
  var x = p.x, b = W.brand(x.brand), c = W.creator(x.creator), i = x.invoice, s = invState(x), q = reminderOf(x);
  var soon = s === "open" && W.dayDiff(i.due) <= 3;
  function open(){ openDeal(x.id, p.order); }
  return html`<tr class=${W.cx("click", s === "paid" ? "dv-paid" : null)} aria-selected=${p.sel ? "true" : null} onClick=${open}>
    <td><button type="button" class="dv-link mono" onClick=${stop(open)}>${i.no || "Draft"}</button></td>
    <td><span class="row dv-who"><${W.BAv} b=${b} size="s" /><span class="col t2"><b>${b.name}</b><span class="tiny muted">${c.name}</span></span></span></td>
    <td class="n"><b>${W.money(x.price)}</b></td>
    <td>${i.sent ? W.fmtShort(i.sent) : html`<span class="muted">Not sent</span>`}</td>
    <td>${i.due ? html`<span class=${s === "late" ? "dv-crit b" : ""}>${W.fmtShort(i.due)}</span>` : html`<span class="muted">–</span>`}</td>
    <td><${Net30} x=${x} s=${s} /></td>
    <td><${InvTag} x=${x} s=${s} /></td>
    <td class="dv-act"><span class="row" style=${{gap:"6px"}}>
      ${s === "unsent" ? html`<${Btn} kind="pri" size="sm" icon="send" onClick=${stop(function(){ W.A.sendInvoice(x.id); })}>Send invoice</${Btn}>` : null}
      ${s === "late" || soon ? html`<${Btn} kind=${s === "late" ? "pri" : null} size="sm" icon="mail" tip=${q ? "A reminder is drafted and waiting for you" : "Draft a payment reminder for you to approve"} onClick=${stop(function(){ remind(x); })}>${q ? "Review reminder" : "Remind"}</${Btn}>` : null}
      ${s === "late" || s === "open" ? html`<${MarkPaid} x=${x} />` : null}
      ${s === "paid" ? html`<span class="tiny faint">Nothing to do</span>` : null}
    </span></td>
  </tr>`;
}

var RANK = {late:0, unsent:1, open:2, paid:3};
function Receivables(p){
  var d = p.d, v = p.v, m = p.m;
  var all = d.deals.filter(function(x){ return invState(x) !== "later"; }).sort(function(a, b){
    var sa = invState(a), sb = invState(b); if (RANK[sa] !== RANK[sb]) return RANK[sa] - RANK[sb];
    if (sa === "paid") return b.invoice.paid - a.invoice.paid;
    return (a.invoice.due || a.golive || 0) - (b.invoice.due || b.golive || 0);
  });
  var nPaid = all.filter(function(x){ return invState(x) === "paid"; }).length;
  var rows = all.filter(function(x){ var s = invState(x); return v.recv === "all" || (v.recv === "paid" ? s === "paid" : s !== "paid"); });
  var order = rows.map(function(x){ return x.id; });
  return html`<${W.Section} why="receivables" title="Invoices" count=${all.length}
    right=${html`<${W.Seg} label="Which invoices" cur=${v.recv} onPick=${function(k){ setView({recv:k}); }} opts=${[["all", "All " + all.length], ["open", "Open " + (all.length - nPaid)], ["paid", "Paid " + nPaid]]} />`}>
    ${rows.length ? html`<div class="tw"><table class="tbl dv-tbl">
      <thead><tr><th>Invoice</th><th>Brand</th><th class="n">Amount</th><th>Sent</th><th>Due</th><th data-tip="Days used of the 30 the brand has to pay">Net 30</th><th>Status</th><th class="dv-act">Action</th></tr></thead>
      <tbody>${rows.map(function(x){ return html`<${RecvRow} key=${x.id} x=${x} order=${order} sel=${p.pk === x.id} />`; })}</tbody>
    </table></div>` : html`<div class="card"><${W.Empty} icon="wallet" title=${all.length ? "No " + (v.recv === "paid" ? "paid" : "open") + " invoices" : "No invoices yet"}>${all.length ? "Try another filter." : "An invoice appears here when a deal goes live."}</${W.Empty}></div>`}
    ${m.nLater ? html`<p class="hint">${W.plural(m.nLater, "deal")} ${m.nLater === 1 ? "has" : "have"} not gone live yet. About ${W.money(m.later)} will be invoiced as ${m.nLater === 1 ? "it does" : "they do"}.</p>` : null}
  </${W.Section}>`;
}

function PayRow(p){
  var x = p.x, b = W.brand(x.brand), c = W.creator(x.creator), i = x.invoice, ps = payState(x), s = invState(x);
  function open(){ openDeal(x.id, p.order); }
  var paidCell = i.paid ? html`<span class="row dv-good" style=${{gap:"6px"}}><${Icon} n="check" />Paid ${W.fmtShort(i.paid)}</span>`
    : s === "late" ? html`<span class="row dv-crit" style=${{gap:"6px"}}><${Icon} n="alert" />Not yet · ${W.plural(-W.dayDiff(i.due), "day")} late</span>`
    : s === "open" ? html`<span class="row muted" style=${{gap:"6px"}}><${Icon} n="clock" />Not yet · due ${W.fmtShort(i.due)}</span>`
    : html`<span class="row dv-warn" style=${{gap:"6px"}}><${Icon} n="alert" />Invoice not sent</span>`;
  function locked(){ W.toast({msg:"Locked until " + b.name + " pays", sub:"Creators are paid from money already received.", icon:"lock", tone:"warn"}); }
  return html`<tr class=${W.cx("click", ps === "paid" ? "dv-paid" : null)} aria-selected=${p.sel ? "true" : null} onClick=${open}>
    <td><span class="row dv-who"><${W.CAv} c=${c} size="s" /><span class="col t2"><button type="button" class="dv-link b" onClick=${stop(open)}>${c.name}</button><span class="tiny muted">${c.pay || "No payment method on file"}</span></span></span></td>
    <td><span class="col t2"><b style=${{fontWeight:500}}>${b.name}</b><span class="tiny muted mono">${i.no || "No invoice yet"}</span></span></td>
    <td class="n"><b>${W.money(x.payout)}</b><br /><span class="tiny muted">of ${W.money(x.price)}</span></td>
    <td>${paidCell}</td>
    <td>${ps === "paid" ? html`<${Tag} tone="good" icon="check">Paid ${W.fmtShort(x.paidCreator)}</${Tag}>`
      : ps === "unlocked" ? html`<${Tag} tone="good" icon="unlock">Ready to pay</${Tag}>`
      : html`<${Tag} icon="lock" tip=${"Locked until " + b.name + " pays"}>Locked</${Tag}>`}</td>
    <td class="dv-act"><span class="row" style=${{gap:"6px"}}>
      ${ps === "unlocked" ? html`<${Btn} kind="pri" size="sm" icon="wallet" onClick=${stop(function(){ W.A.payCreator(x.id); })}>Pay ${W.money(x.payout)}</${Btn}><button type="button" class="btn ghost sm" aria-label=${"Copy " + c.name + "'s payment details"} data-tip="Copy payment details" onClick=${stop(function(){ W.copy(c.pay || "", "payment details"); })}><${Icon} n="copy" /></button>` : null}
      ${ps === "locked" ? html`<button type="button" class="btn sm dv-locked" aria-disabled="true" data-tip=${"Locked until " + b.name + " pays. Creators are paid from money already received."} onClick=${stop(locked)}><${Icon} n="lock" />Pay</button>` : null}
      ${ps === "paid" ? html`<span class="tiny faint">Nothing to do</span>` : null}
    </span></td>
  </tr>`;
}

var PRANK = {unlocked:0, locked:1, paid:2};
function Payables(p){
  var d = p.d, m = p.m;
  var rows = d.deals.filter(function(x){ return x.step >= 6 || x.paidCreator; }).sort(function(a, b){
    var sa = payState(a), sb = payState(b); if (PRANK[sa] !== PRANK[sb]) return PRANK[sa] - PRANK[sb];
    if (sa === "paid") return b.paidCreator - a.paidCreator;
    return (a.invoice.due || Infinity) - (b.invoice.due || Infinity);
  });
  var order = rows.map(function(x){ return x.id; });
  return html`<${W.Section} why="payables" title="Creator payouts" count=${rows.length}
    right=${html`<span class="small ink2 num">${W.money(m.ready)} ready · ${W.money(m.locked)} locked</span>`}>
    <div class="callout info"><${Icon} n="lock" /><div class="grow"><b>Creators are paid from money already received.</b> A payout unlocks when its brand's invoice is marked paid.</div></div>
    ${rows.length ? html`<div class="tw"><table class="tbl dv-tbl">
      <thead><tr><th>Creator</th><th>Brand</th><th class="n">Payout</th><th>Brand paid?</th><th>Status</th><th class="dv-act">Action</th></tr></thead>
      <tbody>${rows.map(function(x){ return html`<${PayRow} key=${x.id} x=${x} order=${order} sel=${p.pk === x.id} />`; })}</tbody>
    </table></div>` : html`<div class="card"><${W.Empty} icon="wallet" title="No payouts yet">A payout appears here when a creator's video goes live.</${W.Empty}></div>`}
    ${m.nLater ? html`<p class="hint">${W.plural(m.nLater, "more payout")} (${W.money(m.laterPay)}) will follow as ${m.nLater === 1 ? "its video goes" : "those videos go"} live.</p>` : null}
  </${W.Section}>`;
}

function MoneyTab(){
  var st = W.useApp(), d = st.data, u = st.ui, v = view(u), m = calc(d), pk = peeked(u);
  if (!W.canSeeMoney()) return html`<div class="card"><${W.Empty} icon="lock" title=${"Money is hidden for " + W.member(d.me).role + "s"}>Invoices, payouts and margins stay with the owner and account managers. The owner can change this in Settings › Team and money.</${W.Empty}></div>`;
  var recv = d.deals.filter(function(x){ return invState(x) !== "later"; });
  return html`<${W.Fragment}>
    <${Tiles} m=${m} />
    <${Callouts} recv=${recv} />
    <${Aging} m=${m} />
    <${Receivables} d=${d} v=${v} m=${m} pk=${pk} />
    <${Payables} d=${d} m=${m} pk=${pk} />
  </${W.Fragment}>`;
}

/* ================= screen ================= */
W.screens.deliver = function(){
  var st = W.useApp(), d = st.data, u = st.ui;
  var tab = u.route.tab === "money" ? "money" : "board";
  var motion = d.deals.filter(function(x){ return x.step < W.DEAL_FLOW.length - 1; }).length;
  var lateN = d.deals.filter(isLate).length;
  var m = calc(d), todo = m.nLate + m.nUnsent + m.nReady;
  var sub = W.plural(motion, "deal") + " in motion" + (lateN ? ", " + lateN + " late" : "") + "." + (m.nReady && W.canSeeMoney() ? " " + W.plural(m.nReady, "payout") + (m.nReady === 1 ? " is" : " are") + " ready to pay." : "");
  return html`<div class="page">
    <${W.PageHead} title="Deliver and get paid" sub=${sub} hue="var(--deliver)" />
    <${W.Tabs} hue="var(--deliver)" cur=${tab} onPick=${W.setTab} tabs=${[["board", "Deal board", motion || null], ["money", "Money", W.canSeeMoney() ? todo || null : null]]} />
    ${tab === "money" ? html`<${MoneyTab} />` : html`<${BoardTab} />`}
  </div>`;
};
})();
