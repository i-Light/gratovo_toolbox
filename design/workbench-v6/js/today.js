/* today.js — the home screen. One list of next actions across the whole business, ordered closest-to-money
   first, each with a time estimate and a reason. Selecting an item opens exactly what it needs; finishing it
   opens the next one. Focus mode shows one item at a time; Wrap up closes the day. */
(function(){
"use strict";
var W = window.W, html = W.html, Icon = W.Icon, useState = W.useState, useEffect = W.useEffect, useRef = W.useRef;
var Btn = W.Btn, Tag = W.Tag;

var KIND_ICON = {invoice:"wallet", collect:"alert", payout:"unlock", deal:"box", nextdeal:"trend", reply:"reply", send:"send", followup:"clock", audience:"users", qualify:"flag", pitch:"pen", contact:"at", finds:"scan", bnudge:"clock", stalled:"clock", warmth:"heart"};

function DayBand(p){
  var d = W.D(), items = p.items, planned = W.sum(items, function(i){ return i.est; });
  var doneToday = d.done.filter(function(x){ return W.dayDiff(x.at) === 0; }), doneMin = W.sum(doneToday, function(x){ return x.min; });
  var budget = d.day.budget, free = Math.max(0, budget - planned - doneMin);
  var over = planned + doneMin > budget;
  var byB = W.BUCKETS.map(function(b){ return {b:b, min:W.sum(items.filter(function(i){ return i.b === b.k; }), function(i){ return i.est; })}; }).filter(function(x){ return x.min > 0; });
  var left = W.sum(d.mail, function(m){ return Math.max(0, m.cap - m.sent); });
  return html`<div class="dayband">
    <div class="card tight" data-why="today-budget">
      <div class="row wrap"><h3 class="grow">Your ${budget % 60 ? W.dur(budget) : budget / 60 + " hours"}</h3><span class="small ink2 num">${W.dur(planned)} planned · ${W.dur(doneMin)} done · ${W.dur(free)} free</span>
        ${over ? html`<button type="button" class="btn sm" style=${{height:"24px", padding:"0 8px", fontSize:"11.5px"}} onClick=${function(){ W.A.fitDayBudget(); }} data-tip="Defer lowest-priority items past your daily budget to tomorrow 09:00"><${Icon} n="sliders" s=${12} />Fit to ${budget / 60}h</button>` : null}
      </div>
      <div class="budget" role="img" aria-label=${W.dur(planned) + " planned of " + W.dur(budget)}>
        ${doneMin ? html`<i class="done" style=${{flexGrow:doneMin, "--hue":"var(--good)"}} data-tip=${"Done today: " + W.dur(doneMin)}></i>` : null}
        ${byB.map(function(x){ return html`<i key=${x.b.k} style=${{flexGrow:x.min, "--hue":x.b.hue}} data-tip=${x.b.name + ": " + W.dur(x.min)}></i>`; })}
        <i style=${{flexGrow:free, background:"transparent"}}></i>
      </div>
      <div class="legend">${byB.map(function(x){ return html`<span key=${x.b.k} style=${{"--hue":x.b.hue}}><i></i>${x.b.name} ${W.dur(x.min)}</span>`; })}</div>
    </div>
    <div class="card tight" data-why="today-mail">
      <div class="row"><h3 class="grow">Sending today</h3><span class="small ink2 num">${left} sends left</span></div>
      ${d.mail.map(function(m){ var l = m.cap - m.sent; return html`<div key=${m.id} class="row small" style=${{gap:"8px"}}>
        <span class="mono ell" style=${{width:"150px"}}>${m.addr.split("@")[0]}</span><${W.Meter} v=${m.sent} max=${m.cap} w=${90} tone=${m.status === "slowed" ? "warn" : l <= 3 ? "crit" : null} label=${m.addr + " sends used"} />
        <span class="num muted" style=${{width:"46px"}}>${m.sent}/${m.cap}</span>${m.status === "error" ? html`<${Tag} tone="crit" icon="alert" tip=${m.err}>signed out</${Tag}>` : m.status !== "good" ? html`<${Tag} tone="warn" tip=${m.note || ("Warm-up day " + m.warm.day + " of " + m.warm.of)}>${m.status === "warming" ? "warming" : "slowed"}</${Tag}>` : null}</div>`; })}
    </div>
    <div class="card tight" style=${{minWidth:"200px"}}>
      <div class="row"><h3 class="grow">Done today</h3><b class="num" style=${{fontSize:"18px"}}>${doneToday.length}</b></div>
      ${doneToday.length ? html`<span class="small ink2 ell">${doneToday[0].title}</span><span class="tiny muted">${W.ago(doneToday[0].at)} · Ctrl Z undoes it</span>` : html`<span class="small muted">Nothing yet. The first item is waiting.</span>`}
    </div>
  </div>`;
}

function Row(p){
  var it = p.it, b = W.bucket(it.b), ref = useRef(null);
  useEffect(function(){ if (p.sel && ref.current && ref.current.scrollIntoView) ref.current.scrollIntoView({block:"nearest"}); }, [p.sel]);
  return html`<button ref=${ref} type="button" class="li" aria-current=${p.sel ? "true" : null} onClick=${p.onPick} data-key=${it.key}>
    <span class="bi" style=${{width:"24px", height:"24px", borderRadius:"7px", display:"grid", placeItems:"center", color:b.hue, background:"color-mix(in srgb, " + b.hue + " 13%, transparent)", flex:"none"}}><${Icon} n=${KIND_ICON[it.kind] || "dot"} s=${13} /></span>
    <span class="lt"><b>${W.maskMoney(it.title)}</b><small>${W.maskMoney(it.sub)}</small></span>
    ${p.team && it.owner ? html`<${W.Av} id=${it.owner} size="s" />` : null}
    ${it.quick ? html`<span data-tip="Quick win: under 2 minutes" style=${{color:"var(--accent)"}}><${Icon} n="bolt" s=${13} /></span>` : null}
    ${it.due && !it.age ? html`<${W.Due} ts=${it.due} />` : it.due && it.age ? html`<${W.Due} ts=${it.due} age=${true} />` : html`<span class="due">${it.est < 1 ? "<1" : Math.round(it.est)} min</span>`}
  </button>`;
}

function Queue(p){
  var u = W.U(), d = W.D(), items = p.items, filter = u.todayFilter || "all";
  var shown = items.filter(function(i){ return filter === "quick" ? i.quick : filter === "late" ? i.due && W.dayDiff(i.due) < 0 && !i.age : true; });
  var coll = u.collapsed || {};
  var snoozed = Object.keys(d.snoozed).filter(function(k){ return d.snoozed[k] > W.now(); });
  var doneToday = d.done.filter(function(x){ return W.dayDiff(x.at) === 0; });
  var team = u.todayScope === "team";
  var readyFu = d.drafts.filter(function(q){ return q.kind === "followup" && !q.gates.some(function(g){ return !g.ok; }); }).length;
  function toggle(k){ W.ui(function(uu){ uu.collapsed = Object.assign({}, uu.collapsed); uu.collapsed[k] = !uu.collapsed[k]; }); }
  return html`<div class="card queue" role="region" aria-label="Next actions" data-why="today-queue">
    <div class="row wrap" style=${{padding:"6px 6px 4px", gap:"6px"}}>
      ${[["all","All", items.length],["quick","Quick wins", items.filter(function(i){ return i.quick; }).length],["late","Late", items.filter(function(i){ return i.due && !i.age && W.dayDiff(i.due) < 0; }).length]].map(function(f){
        return html`<button key=${f[0]} type="button" class="chip" aria-pressed=${String(filter === f[0])} onClick=${function(){ W.ui(function(uu){ uu.todayFilter = f[0]; }); }}>${f[0] === "quick" ? html`<${Icon} n="bolt" s=${12} />` : null}${f[1]} <span class="c">${f[2]}</span></button>`; })}
    </div>
    ${team ? html`<${TeamLoad} items=${items} />` : null}
    ${W.BUCKETS.map(function(b){
      var bi = shown.filter(function(i){ return i.b === b.k; }); if (!bi.length) return null;
      var min = W.sum(bi, function(i){ return i.est; });
      return html`<div key=${b.k} class="bucket">
        <div class="row" style=${{gap:"4px"}}>
          <button type="button" class="bucket-h grow" style=${{"--hue":b.hue}} onClick=${function(){ toggle(b.k); }} aria-expanded=${String(!coll[b.k])} data-tip=${b.why}>
            <span class="bi"><${Icon} n=${b.icon} /></span>${b.name} <span class="muted num" style=${{fontWeight:400}}>${bi.length}</span>
            <span class="m num">${W.dur(min)}</span><${Icon} n=${coll[b.k] ? "chevR" : "chevD"} s=${13} cls="flip" />
          </button>
          ${b.k === "followups" && readyFu > 1 ? html`<button type="button" class="btn ghost sm" style=${{height:"24px", padding:"0 8px", fontSize:"11.5px"}} onClick=${function(){ W.A.sendAllReadyFollowups(); }} data-tip="Send all gate-clear follow-ups in one click"><${Icon} n="send" s=${11} />Send all (${readyFu})</button>` : null}
        </div>
        ${coll[b.k] ? null : bi.map(function(it){ return html`<${Row} key=${it.key} it=${it} team=${team} sel=${p.sel === it.key} onPick=${function(){ W.ui(function(uu){ uu.todaySel = it.key; uu.wrap = false; }); }} />`; })}
      </div>`; })}
    ${!shown.length ? html`<p class="hint" style=${{padding:"12px"}}>${filter === "all" ? (d.creators.length || d.deals.length ? "Nothing left." : "Nothing yet.") : "Nothing matches this filter."}</p>` : null}
    ${snoozed.length ? html`<div class="bucket"><button type="button" class="bucket-h" style=${{"--hue":"var(--muted)"}} onClick=${function(){ toggle("_snz"); }}><span class="bi"><${Icon} n="alarm" /></span>Snoozed <span class="muted" style=${{fontWeight:400}}>${snoozed.length}</span><span class="m"></span><${Icon} n=${coll._snz === false ? "chevD" : "chevR"} s=${13} cls="flip" /></button>
      ${coll._snz === false ? snoozed.map(function(k){ return html`<div key=${k} class="li"><span class="lt"><b>${W.maskMoney(W.itemTitle ? W.itemTitle(k) : (k.split(":")[0] + " · " + (k.split(":")[1] || "")))}</b><small>Back ${W.fmtDay(d.snoozed[k]).toLowerCase()} at ${W.fmtTime(d.snoozed[k])}</small></span><button type="button" class="btn ghost sm" onClick=${function(){ W.act("Brought a snoozed item back", function(dd){ delete dd.snoozed[k]; }, {log:false}); }}>Bring back</button></div>`; }) : null}</div>` : null}
    ${doneToday.length ? html`<div class="bucket"><button type="button" class="bucket-h" style=${{"--hue":"var(--good)"}} onClick=${function(){ toggle("_done"); }}><span class="bi"><${Icon} n="check" /></span>Done today <span class="muted" style=${{fontWeight:400}}>${doneToday.length}</span><span class="m num">${W.dur(W.sum(doneToday, function(x){ return x.min; }))}</span><${Icon} n=${coll._done === false ? "chevD" : "chevR"} s=${13} cls="flip" /></button>
      ${coll._done === false ? doneToday.map(function(x, i){ return html`<div key=${x.key + i} class="li done"><span class="lt"><b>${W.maskMoney(x.title)}</b><small>${W.fmtTime(x.at)}</small></span>${i === 0 ? html`<button type="button" class="btn ghost sm" onClick=${W.undo}><${Icon} n="undo" />Undo</button>` : null}</div>`; }) : null}</div>` : null}
  </div>`;
}
function TeamLoad(p){
  var d = W.D();
  return html`<div class="col tight" style=${{padding:"6px 10px 10px", borderBottom:"1px solid var(--line)"}}>
    ${d.team.map(function(m){ var mine = p.items.filter(function(i){ return (i.owner || d.me) === m.id; }), min = W.sum(mine, function(i){ return i.est; });
      return html`<div key=${m.id} class="row small"><${W.Av} id=${m.id} size="s" status=${m.status} /><span style=${{width:"54px"}}>${m.name}</span><${W.Meter} v=${min} max=${240} w=${110} tone=${min > 240 ? "crit" : min > 180 ? "warn" : null} label=${m.name + "'s planned time"} /><span class="muted num">${mine.length} · ${W.dur(min)}</span></div>`; })}
  </div>`;
}

/* ---------- the work panel: exactly what the selected item needs ---------- */
function Snapshot(p){
  var c = p.c, pk = W.U().peek;
  if (pk && pk.t === "creator" && pk.id === c.id) return null;
  return html`<div class="card tight">
    <div class="row"><${W.CAv} c=${c} /><div class="grow col t2"><span class="row" style=${{gap:"6px"}}><b style=${{fontWeight:600}}>${c.name}</b><${W.Stars} n=${c.starRating || 3} /></span><span class="small muted">${c.handle} · ${W.fmtK(c.subs)} subscribers · ${W.STAGE_LABEL[c.stage]}</span></div><${W.Fit} c=${c} />
      <${Btn} size="sm" kind="ghost" icon="eye" onClick=${function(){ W.peek("creator", c.id); }}>Open</${Btn}></div>
    <div class="grid3" style=${{gap:"8px"}}>${c.videos.slice(0, 3).map(function(v, i){ return html`<${W.Vid} key=${i} v=${v} />`; })}</div>
    <div class="row wrap" style=${{gap:"18px"}}><${W.Stat} v=${W.fmtK(c.median)} l="median views" /><${W.Stat} v=${W.fmtK(c.trimmedAvgViews || c.median)} l="trimmed avg (HC-16)" /><${W.Stat} v=${c.up30} l="uploads / 30 days" /><div style=${{minWidth:"200px"}}><${W.Countries} countries=${c.countries} /></div></div>
  </div>`;
}
function Invoice(p){
  var x = p.x, b = W.brand(x.brand), c = W.creator(x.creator), anchor = x.golive || W.now(), due = anchor + 30 * W.DAY;
  W.useKeys({"mod+enter":function(){ W.A.sendInvoice(x.id); }}, true);
  return html`<div class="card" style=${{gap:"14px"}} data-why="invoice">
    <div class="row"><${Icon} n="file" s=${18} /><h3 class="grow">Invoice ${x.invoice.no || "GR-2026-0" + (30 + W.D().deals.indexOf(x))}</h3><${Tag} tone="warn" icon="alert">${W.dayDiff(x.golive) < 0 ? W.plural(-W.dayDiff(x.golive), "day") + " after go-live" : "go-live day"}</${Tag}></div>
    <dl class="kv"><dt>To</dt><dd>${b.name} · ${b.contact} <span class="mono small muted">${b.email}</span></dd><dt>For</dt><dd>${c.name}: ${x.deliverable}, live ${W.fmtDate(x.golive)}${x.live ? html` · <span class="mono small">${x.live}</span>` : null}</dd>
      <dt>Amount</dt><dd><b class="num" style=${{fontSize:"16px"}}>${W.money(x.price)}</b></dd><dt>Terms</dt><dd>Net 30 from go-live (${W.fmtShort(anchor)}) → due <b>${W.fmtDate(due)}</b></dd></dl>
    <div class="row wrap">
      <${Btn} kind="pri" icon="send" onClick=${function(){ W.A.sendInvoice(x.id); }}>Send invoice <span class="kbd">Ctrl Enter</span></${Btn}>
      <${Btn} size="sm" icon="printer" onClick=${function(){ W.openModal({kind:"invoice", dealId:x.id}); }}>Preview Official PDF Invoice</${Btn}>
      <span class="hint">Sent from billing@gratovo.co with the PDF attached. A reminder appears here 3 days before it is due.</span>
    </div>
  </div>`;
}
function Work(p){
  var it = p.it, d = W.D(), b = W.bucket(it.b);
  var last = d.done[0], recent = last && W.now() - last.at < 4500;
  var tick = useState(0), showDual = useState(false);
  useEffect(function(){ if (!recent) return; var t = setTimeout(function(){ tick[1](function(n){ return n + 1; }); }, 4600); return function(){ clearTimeout(t); }; }, [last && last.at]);
  var snzId = "snz-btn", hoId = "ho-btn";
  W.useKeys({
    z:function(){ var el = document.getElementById(snzId); if (el) el.click(); },
    h:function(){ var el = document.getElementById(hoId); if (el) el.click(); },
    o:function(){ if (it.ref) W.peek(it.ref.t, it.ref.id); }
  }, true);
  var body = null, o = it.ref ? W.rec(it.ref) : null;
  if (it.draft){
    var q = W.draft(it.draft);
    var x = q && q.deal ? W.deal(q.deal) : null;
    body = html`<${W.Fragment}>
      ${x ? html`<div class="row wrap"><${W.DealRibbon} x=${x} /><${Btn} size="sm" kind=${showDual[0] ? "pri" : "ghost"} icon="columns" onClick=${function(){ showDual[1](!showDual[0]); }}>${showDual[0] ? "Hide Dual Deal Room" : "Open 3-Column Dual Deal Room"}</${Btn}></div>` : null}
      ${x && showDual[0] ? html`<${W.DualDealRoom} x=${x} />` : null}
      ${W.threadOf(it.ref).length ? html`<div class="card"><div class="card-h"><h3>${it.kind === "reply" ? "Their message" : "So far"}</h3><span class="small muted">${W.threadOf(it.ref).length} emails</span></div><${W.Thread} refx=${it.ref} limit=${it.kind === "reply" ? 2 : 2} /></div>` : null}
      ${x && x.neg ? html`<${W.Ladder} x=${x} />` : null}
      ${q ? html`<${W.DraftCard} key=${q.id} q=${q} primary=${true} itemKey=${it.key} />` : null}
      ${it.ref.t === "creator" && o ? html`<${Snapshot} c=${o} />` : null}
    </${W.Fragment}>`;
  } else if (it.kind === "invoice"){ body = html`<${Invoice} x=${o} />`; }
  else if (it.kind === "collect" || it.kind === "payout"){ body = html`<div class="card"><${W.Money} x=${o} /></div>`; }
  else if (it.kind === "deal" || it.kind === "nextdeal"){
    body = html`<div class="card"><${W.DealRibbon} x=${o} /><div class="row wrap"><${W.DealSteps} x=${o} /><span class="sp"></span><${Btn} size="sm" kind=${showDual[0] ? "pri" : "ghost"} icon="columns" onClick=${function(){ showDual[1](!showDual[0]); }}>${showDual[0] ? "Hide Dual Deal Room" : "3-Column Dual Deal Room"}</${Btn}></div>${showDual[0] ? html`<${W.DualDealRoom} x=${o} />` : null}<${W.DealChecklist} x=${o} /></div><div class="card"><${W.Money} x=${o} /></div>`;
  }
  else if (it.kind === "audience"){ body = html`<div class="card"><h3>Media kit vs. your rules</h3><${W.AudienceCheck} c=${o} /></div><div class="card"><div class="card-h"><h3>Their message</h3></div><${W.Thread} refx=${it.ref} limit=${2} /></div>`; }
  else if (it.kind === "qualify"){ body = html`<div class="card"><${W.Qualify} b=${o} /></div>`; }
  else if (it.kind === "pitch"){ body = html`<div class="card"><${W.PitchPicker} b=${o} /></div>`; }
  else if (it.kind === "contact"){ body = html`<div class="card"><h3>Which address is right?</h3><${W.ContactBlock} c=${o} /></div><${Snapshot} c=${o} />`; }
  else if (it.kind === "bnudge"){
    body = html`<div class="card" style=${{gap:"12px"}}>
      <h3>Nudge ${o.name} on your pitch</h3>
      <p class="small ink2">${o.name} was pitched ${W.ago(o.pitched.at)} for ${(o.pitched.creators || []).map(function(id){ var c = W.creator(id); return c ? c.name : id; }).join(" + ")}. Draft a 45-word follow-up (BRD-FU-01 / HC-24) so the pitch does not go cold.</p>
      <div class="row wrap"><${Btn} kind="pri" icon="mail" onClick=${function(){ W.A.nudgeBrand(o.id); }}>Draft brand follow-up</${Btn}><${Btn} kind="ghost" icon="eye" onClick=${function(){ W.peek("brand", o.id); }}>Open ${o.name}</${Btn}></div>
    </div>`;
  }
  else if (it.kind === "stalled"){
    body = html`<div class="card" style=${{gap:"12px"}}>
      <h3>Check in with ${o.name}</h3>
      <p class="small ink2">${o.name} replied with interest, and we asked for their YouTube Studio audience tab (countries & age, last 90 days). Draft a warm 2-line nudge so they don't go cold.</p>
      <div class="row wrap"><${Btn} kind="pri" icon="mail" onClick=${function(){ W.A.nudgeCreatorReply(o.id); }}>Draft 2-line nudge</${Btn}><${Btn} kind="ghost" icon="eye" onClick=${function(){ W.peek("creator", o.id); }}>Open ${o.name}</${Btn}></div>
      <${W.Thread} refx=${it.ref} limit=${2} />
    </div>`;
  }
  else if (it.kind === "warmth"){
    body = html`<div class="card" style=${{gap:"12px"}} data-why="warmth-item">
      <div class="row"><${Icon} n="heart" s=${18} style=${{color:"var(--warn)"}} /><h3 class="grow">3-Week Roster Warmth Check-In · ${o.name}</h3><${Tag} tone="warn">${o.daysSinceUpdate || 21}d since update (HC-29)</${Tag}></div>
      <p class="small ink2">${o.name} is signed on your roster (${o.relationshipModel === "exclusive_25" ? "Exclusive 25% commission" : "Brokered markup"}, rate ${W.money(o.rate)}) and hasn't received a pitch status update in ${o.daysSinceUpdate || 21} days. Rule HC-29 requires a proactive check-in every 14–21 days so signed talent never goes cold.</p>
      <div class="row wrap">
        <${Btn} kind="pri" icon="heart" onClick=${function(){ W.A.sendWarmthUpdate(o.id); }}>Draft 3-week warmth update</${Btn}>
        <${Btn} size="sm" icon="printer" onClick=${function(){ W.openModal({kind:"mediakit", creatorId:o.id}); }}>Preview Media Kit</${Btn}>
        <${Btn} kind="ghost" icon="eye" onClick=${function(){ W.peek("creator", o.id); }}>Open ${o.name}</${Btn}>
      </div>
      <${Snapshot} c=${o} />
    </div>`;
  }
  else if (it.kind === "finds"){ body = html`<${W.Triage} list=${d.creators.filter(function(c){ return c.stage === "new"; })} />`; }
  var heading = W.maskMoney(it.title);
  return html`<div class="work" key=${it.key} data-why="today-work">
    ${recent ? html`<div class="callout good" role="status"><${Icon} n="checkc" /><span class="grow"><b style=${{fontWeight:600}}>${W.maskMoney(last.title)}.</b> This is the next one.</span><button type="button" class="btn ghost sm" onClick=${W.undo}><${Icon} n="undo" />Undo</button></div>` : null}
    <div class="work-h">
      <span class="bi" style=${{width:"36px", height:"36px", borderRadius:"10px", display:"grid", placeItems:"center", color:b.hue, background:"color-mix(in srgb, " + b.hue + " 14%, transparent)", flex:"none"}}><${Icon} n=${KIND_ICON[it.kind] || b.icon} s=${18} /></span>
      <div class="wt"><h2>${heading}</h2><span class="small ink2 row" style=${{gap:"6px", alignItems:"flex-start"}}><${Icon} n="info" s=${14} style=${{marginTop:"2px", color:"var(--muted)", flex:"none"}} />${W.maskMoney(it.why)}</span></div>
      <div class="row wrap" style=${{gap:"4px"}}>
        ${it.ref ? html`<${Btn} size="sm" kind="ghost" icon="eye" onClick=${function(){ W.peek(it.ref.t, it.ref.id); }} tip="Open the record beside this" kbd="O">Record</${Btn}>` : null}
        <${Btn} id=${snzId} size="sm" kind="ghost" icon="alarm" onClick=${function(e){ W.menu(e, W.snoozeItems(it.key, it.title), {align:"end"}); }} tip="Snooze" kbd="Z">Snooze</${Btn}>
        ${it.ref ? html`<${Btn} id=${hoId} size="sm" kind="ghost" icon="forward" onClick=${function(e){ W.menu(e, W.handItems(it.key, it.ref, it.title), {align:"end"}); }} tip="Hand off" kbd="H">Hand off</${Btn}>` : null}
      </div>
    </div>
    ${body}
  </div>`;
}

function Wrap(p){
  var d = W.D(), doneToday = d.done.filter(function(x){ return W.dayDiff(x.at) === 0; }), left = p.items, tm = W.tomorrow();
  var note = useState(d.day.note || "");
  var money = doneToday.filter(function(x){ return x.b === "money"; }).length;
  return html`<div class="work">
    <div class="work-h"><span class="bi" style=${{width:"36px", height:"36px", borderRadius:"10px", display:"grid", placeItems:"center", background:"var(--sunk-2)"}}><${Icon} n="coffee" s=${18} /></span><div class="wt"><h2>Wrap up the day</h2><span class="small ink2">What got done, what is left, and what tomorrow looks like.</span></div>
      <${Btn} size="sm" kind="ghost" icon="x" onClick=${function(){ W.ui(function(u){ u.wrap = false; }); }}>Back to the list</${Btn}></div>
    <div class="tiles">
      <div class="tile"><span class="tl">Done</span><b>${doneToday.length}</b><span class="ts">${W.dur(W.sum(doneToday, function(x){ return x.min; }))} of work</span></div>
      <div class="tile"><span class="tl">Emails sent</span><b>${W.sum(d.mail, function(m){ return m.sent; })}</b><span class="ts">of ${W.sum(d.mail, function(m){ return m.cap; })} today</span></div>
      <div class="tile"><span class="tl">Money steps</span><b>${money}</b><span class="ts">invoices, payments, payouts</span></div>
      <div class="tile"><span class="tl">Still open</span><b>${left.length}</b><span class="ts">${W.dur(W.sum(left, function(i){ return i.est; }))}</span></div>
    </div>
    <div class="grid2" style=${{alignItems:"start"}}>
      <div class="card"><div class="card-h"><h3>Still open</h3>${left.length ? html`<${Btn} size="sm" icon="alarm" onClick=${function(){ W.act("Moved " + left.length + " open items to tomorrow", function(dd){ left.forEach(function(i){ dd.snoozed[i.key] = W.at(1, W.morning()); }); }, {toast:{msg:left.length + " items moved to tomorrow " + ("0" + W.morning()).slice(-2) + ":00", icon:"alarm", tone:"info"}}); }}>Move all to tomorrow</${Btn}>` : null}</div>
        ${left.slice(0, 8).map(function(i){ return html`<div key=${i.key} class="row small"><${Icon} n=${KIND_ICON[i.kind] || "dot"} /><span class="ell grow">${W.maskMoney(i.title)}</span><span class="muted">${Math.round(i.est)} min</span></div>`; })}
        ${left.length > 8 ? html`<span class="hint">and ${left.length - 8} more</span>` : null}
        ${!left.length ? html`<span class="hint">Nothing. A clean finish.</span>` : null}</div>
      <div class="card"><div class="card-h"><h3>Tomorrow, ${W.fmtDate(W.at(1))}</h3></div>
        ${tm.length ? tm.map(function(t, i){ return html`<div key=${i} class="row small"><${Icon} n=${t.icon} /><span class="ell">${W.maskMoney(t.text)}</span></div>`; }) : html`<span class="hint">Nothing scheduled yet.</span>`}</div>
    </div>
    <div class="card"><h3>Note for tomorrow</h3><textarea class="ta" rows="3" placeholder="Anything you or the team should know first thing (it appears at the top of Today tomorrow)" value=${note[0]} onInput=${function(e){ note[1](e.target.value); }}></textarea>
      <div class="row"><${Btn} kind="pri" icon="check" onClick=${function(){ W.act("Wrapped up the day", function(dd){ dd.day.note = note[0]; dd.day.wrapped = W.now(); }, {toast:{msg:"Day wrapped", sub:note[0] ? "Your note will be waiting tomorrow at 09:00." : "See you tomorrow.", icon:"coffee", tone:"info"}}); W.ui(function(u){ u.wrap = false; }); }}>Finish the day</${Btn}></div></div>
  </div>`;
}

function FirstRun(){
  var d = W.D(), r = d.runs[0], m = d.mail[0], started = r && r.status !== "ready";
  var steps = [
    {icon:"sliders", t:"Check what a search keeps", s:"Countries, minimum views, uploads a month. The defaults suit AI channels with US, UK, Canadian and Australian audiences.", b:["Search rules", function(){ W.openSetting("search"); }]},
    {icon:"scan", t:"Start your first search", s:r ? W.plural(r.kws.length, "keyword") + " are queued. It runs on this computer while you do other things; new channels land here to review." : "Add keywords on Find › Search.", b:[started ? "Open the search" : "Start the search", function(){ if (r && !started) W.A.startRun(r.id); W.go("find", "search"); }], done:started, pri:!started},
    {icon:"mail", t:"Let the mailbox warm up", s:m ? m.addr + " sends " + m.cap + " a day for its first two weeks and rises as it earns trust. Nothing to do but leave it on." : "Connect a Gmail mailbox to send from.", b:["Mailboxes", function(){ W.go("reach", "mailboxes"); }]},
    {icon:"users", t:"Bring the team in when you're ready", s:"VAs can review new channels and confirm contacts from their first day.", b:["Team", function(){ W.go("team"); }]}
  ];
  return html`<div class="card first-run">
    <div class="col t2"><h2>Your first day</h2><p class="ink2">Nothing needs you yet. These four steps get the pipeline moving, and each one fills Today with real work.</p></div>
    <ol class="fr-steps">${steps.map(function(s, i){ return html`<li key=${i} class=${s.done ? "done" : null}>
      <span class="fr-n">${s.done ? html`<${Icon} n="check" s=${14} />` : i + 1}</span>
      <div class="col t2 grow"><b>${s.t}</b><span class="small ink2">${s.s}</span></div>
      <${Btn} size="sm" kind=${s.pri ? "pri" : null} onClick=${s.b[1]}>${s.b[0]}</${Btn}></li>`; })}</ol>
  </div>`;
}
function AllClear(){
  var tm = W.tomorrow();
  return html`<div class="card"><${W.Empty} icon="checkc" title="Clear. Nothing else needs you today.">Every reply, send, deal step and payment that was due is done.${tm.length ? " Tomorrow starts with " + W.plural(tm.length, "item") + "." : ""}</${W.Empty}>
    <div class="row" style=${{justifyContent:"center"}}><${Btn} icon="coffee" onClick=${function(){ W.ui(function(u){ u.wrap = true; }); }}>Wrap up the day</${Btn}></div></div>`;
}

W.screens.today = function(){
  var st = W.useApp(), u = st.ui, d = st.data;
  var scope = u.todayScope || "me", items = W.items(scope);
  var filter = u.todayFilter || "all";
  var visible = items.filter(function(i){ return filter === "quick" ? i.quick : filter === "late" ? i.due && W.dayDiff(i.due) < 0 && !i.age : true; }).filter(function(i){ return !(u.collapsed || {})[i.b]; });
  var keys = visible.map(function(i){ return i.key; });
  var sel = u.todaySel;
  if (!sel || keys.indexOf(sel) < 0){
    var idx = Math.min(Math.max(0, u.todayIdx || 0), Math.max(0, keys.length - 1));
    sel = keys[idx] || null;
  }
  var selIdx = keys.indexOf(sel);
  useEffect(function(){ var keep = Math.max(0, selIdx); if (sel !== u.todaySel || keep !== u.todayIdx) W.ui(function(uu){ uu.todaySel = sel; uu.todayIdx = keep; }); });
  var it = items.filter(function(i){ return i.key === sel; })[0];
  var focus = !!u.focus;
  function move(n){ var j = W.clamp(selIdx + n, 0, keys.length - 1); if (keys[j]) W.ui(function(uu){ uu.todaySel = keys[j]; uu.todayIdx = j; uu.wrap = false; }); }
  W.useKeys({
    j:function(){ if (it && it.kind === "finds") return false; move(1); },
    k:function(){ if (it && it.kind === "finds") return false; move(-1); },
    arrowdown:function(){ if (it && it.kind === "finds") return false; move(1); },
    arrowup:function(){ if (it && it.kind === "finds") return false; move(-1); },
    f:function(){ W.ui(function(uu){ uu.focus = !uu.focus; if (uu.focus) uu.focusStart = W.now(); }); },
    escape:function(){ if (focus){ W.ui(function(uu){ uu.focus = false; }); return true; } return false; }
  });
  var focusTick = useState(0);
  useEffect(function(){ if (!focus) return; var iv = setInterval(function(){ focusTick[1](function(n){ return n + 1; }); }, 15000); return function(){ clearInterval(iv); }; }, [focus]);
  var planned = W.sum(items, function(i){ return i.est; }), firstDay = !d.creators.length && !d.deals.length;
  var firstLate = items.filter(function(i){ return i.due && !i.age && W.dayDiff(i.due) < 0; }).length;
  var sub = items.length ? W.plural(items.length, "thing") + " need" + (items.length === 1 ? "s" : "") + " you, about " + W.dur(planned) + ". " + (items[0].b === "money" ? "Start with the money." : "Start at the top.") + (firstLate ? " " + firstLate + " " + (firstLate === 1 ? "is" : "are") + " late." : "") : firstDay ? "Day one. Start with a search; Today fills in as channels come back." : "Nothing needs you right now.";
  var focusPos = selIdx + 1, focusLeft = W.sum(visible.slice(Math.max(0, selIdx)), function(i){ return i.est; });
  var mins = u.focusStart ? Math.max(0, Math.floor((W.now() - u.focusStart) / 60000)) : 0;
  var welcome = useState(function(){ try { return !localStorage.getItem("wb-welcomed"); } catch (e){ return true; } });
  function dismiss(){ welcome[1](false); try { localStorage.setItem("wb-welcomed", "1"); } catch (e){} }
  return html`<div class="page">
    ${welcome[0] && !focus ? html`<${W.Callout} tone="info" icon="map" right=${html`<div class="row"><${Btn} size="sm" icon="map" onClick=${function(){ W.ui(function(uu){ uu.why = true; }); }}>Show design notes</${Btn}><${Btn} size="sm" kind="ghost" onClick=${function(){ dismiss(); W.go("plan"); }}>Read the plan</${Btn}><${W.IconBtn} icon="x" label="Dismiss" onClick=${dismiss} /></div>`}>
        <b style=${{fontWeight:600}}>Gratovo Workbench V6 — Complete IMA Operating System.</b> Every change saves to localStorage automatically (or use Reset Demo in the top bar). J and K move, Ctrl Enter does the main action, Ctrl K finds anything, Ctrl Z undoes.</${W.Callout}>` : null}
    ${d.day.note && d.day.wrapped && W.dayDiff(d.day.wrapped) < 0 ? html`<${W.Callout} tone="info" icon="note" right=${html`<${W.IconBtn} icon="x" label="Dismiss note" onClick=${function(){ W.act("Dismissed yesterday's note", function(dd){ dd.day.note = ""; }, {log:false}); }} />`}>Note from yesterday: ${W.maskMoney(d.day.note)}</${W.Callout}>` : null}
    ${focus ? html`<div class="focusbar" data-why="focus">
        <${Icon} n="target" s=${18} /><b>Focus</b>
        <span class="num">${focusPos} of ${keys.length}</span><${W.Meter} v=${focusPos} max=${keys.length} w=${160} />
        <span class="num" style=${{opacity:.8}}>about ${W.dur(focusLeft)} left · ${mins} min in</span>
        <span class="sp"></span>
        <span class="small" style=${{opacity:.8}}><span class="kbd">J</span> <span class="kbd">K</span> move · <span class="kbd">Z</span> snooze · <span class="kbd">Esc</span> leave</span>
        <${Btn} size="sm" icon="x" onClick=${function(){ W.ui(function(uu){ uu.focus = false; }); }}>Leave focus</${Btn}>
      </div>` : html`<${W.PageHead} title=${"Today, " + W.fmtDate(W.NOW).replace(/^\w+ /, "") } sub=${sub}
        right=${html`<div class="row wrap">
          <${W.Seg} label="Whose list" cur=${scope} onPick=${function(v){ W.ui(function(uu){ uu.todayScope = v; }); }} opts=${[["me","Mine","user","Only what is yours"],["team","Team","users","Everyone's lists, with who has what"]]} />
          <${Btn} icon="coffee" onClick=${function(){ W.ui(function(uu){ uu.wrap = true; }); }}>Wrap up</${Btn}>
          <${Btn} kind="pri" icon="target" onClick=${function(){ W.ui(function(uu){ uu.focus = true; uu.focusStart = W.now(); }); }} tip="One item at a time, nothing else on screen" kbd="F" >Start focus</${Btn}>
        </div>`} />`}
    ${focus ? null : html`<${DayBand} items=${items} />`}
    <div class=${focus ? "" : "split"} style=${focus ? {maxWidth:"900px", width:"100%", margin:"0 auto"} : null}>
      ${focus ? null : html`<${Queue} items=${items} sel=${sel} />`}
      ${u.wrap ? html`<${Wrap} items=${items} />` : it ? html`<${Work} it=${it} />` : firstDay ? html`<${FirstRun} />` : html`<${AllClear} />`}
    </div>
  </div>`;
};
})();
