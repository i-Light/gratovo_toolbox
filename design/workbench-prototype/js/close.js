/* close.js — the Close phase: sign creators, find brands, match the two, pitch, agree the price, sign the contract.
   Tabs: roster · brands · match · pitch · negotiate · contracts. Every record opens the peek; every change goes through
   W.act / W.A so it gets a toast with Undo. Screen state lives in W.U().close. */
(function(){
"use strict";
var W = window.W, html = W.html, Icon = W.Icon, useState = W.useState, useEffect = W.useEffect, useRef = W.useRef;
var Btn = W.Btn, Tag = W.Tag;
var HUE = "var(--close)";

W.css(`
.cl-wrap{container-type:inline-size; display:flex; flex-direction:column; gap:var(--gap); min-width:0}
.cl-two{display:grid; grid-template-columns:minmax(0,1fr); gap:var(--gap); align-items:start}
@container (min-width:980px){ .cl-two{grid-template-columns:minmax(0,1.5fr) minmax(300px,1fr)} .cl-two.even{grid-template-columns:repeat(2,minmax(0,1fr))} }
.cl-bar{display:flex; flex-wrap:wrap; align-items:center; gap:8px 12px}
.cl-bar .hint{max-width:none}
.clt{display:flex; flex-direction:column; min-width:0; flex:1}
.clt b{font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.clt small{color:var(--muted); font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.rowbtn{display:flex; align-items:center; gap:10px; min-width:0; flex:1 1 220px; border:0; background:none; color:inherit; text-align:start; padding:6px 8px; border-radius:var(--r-m); transition:background .1s}
.rowbtn:hover{background:var(--sunk)}
.rowbtn[aria-selected="true"]{background:var(--accent-soft)}
.cl-row{display:flex; align-items:center; flex-wrap:wrap; gap:6px 10px; padding:2px 4px; border-radius:var(--r-m); min-width:0}
.cl-row+.cl-row{border-top:1px solid var(--line); padding-top:6px; margin-top:4px}
.cl-sub{display:flex; flex-direction:column; gap:4px}
.cl-sub>p.hint{margin-bottom:2px}
.kit-body{padding:8px 8px 12px 8px; margin-top:4px; border-top:1px solid var(--line)}
.lnk{display:inline-flex; align-items:center; gap:10px; border:0; background:none; padding:0; color:inherit; text-align:start; min-width:0; max-width:100%}
.lnk .clt b{font-weight:500}

/* roster table */
.rt td small{display:block; color:var(--muted); font-size:11.8px; white-space:nowrap}
.rt .aud{min-width:150px}

/* brand board */
.cl-wrap .board{grid-auto-columns:minmax(200px,1fr)}
.bk{padding:0; gap:0}
.bk .bk-main{display:flex; flex-direction:column; gap:6px; padding:9px 10px; border:0; background:none; text-align:start; width:100%; color:inherit; border-radius:var(--r-m)}
.bk .bk-next{display:flex; gap:7px; align-items:flex-start; font-size:12.5px; padding-top:6px; border-top:1px solid var(--line)}
.bk .bk-next .ic{margin-top:2px}
.bk .bk-next b{display:block; font-size:12.5px}
.bk .bk-next small{display:block}
.bk .bk-act{display:flex; flex-wrap:wrap; gap:4px; padding:0 8px 8px}

/* match grid */
.mx{border-collapse:separate; border-spacing:0}
.mx th,.mx td{padding:6px}
.mx thead th{text-transform:none; letter-spacing:0; font-size:12px; font-weight:500; color:var(--ink); text-align:center; vertical-align:bottom}
.mx thead th.bh{text-align:start; color:var(--muted); font:600 12px var(--f-ui); text-transform:none; left:0; z-index:3; padding-inline:12px}
.mx .bh{position:sticky; left:0; z-index:1; background:var(--panel); min-width:210px; max-width:260px; box-shadow:1px 0 0 var(--line)}
.mx thead .bh{background:var(--sunk)}
.mx .ch{min-width:104px}
.chb{display:flex; flex-direction:column; align-items:center; gap:3px; width:100%; border:0; background:none; color:inherit; padding:4px 2px; border-radius:var(--r-s)}
.chb:hover{background:var(--sunk-2)}
.chb b{font-weight:500; max-width:112px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.chb small{color:var(--muted); font-size:11.5px; font-weight:400}
.mx td.bh .rowbtn{padding:4px 6px}
.mcell{position:relative; display:grid; place-items:center; width:100%; min-width:72px; height:46px; border:0; border-radius:var(--r-s); color:var(--ink); font-size:14.5px; font-weight:600; transition:box-shadow .12s}
.mcell:hover{box-shadow:inset 0 0 0 2px var(--ink)}
.mcell.best{box-shadow:inset 0 0 0 2px var(--close)}
.mcell.best:hover{box-shadow:inset 0 0 0 2px var(--ink)}
.mcell .mk{position:absolute; width:16px; height:16px; border-radius:50%; background:var(--panel); display:grid; place-items:center}
.mcell .mk .ic{width:11px; height:11px}
.mcell .mk.w{top:3px; inset-inline-end:3px; color:var(--warn)}
.mcell .mk.w.crit{color:var(--crit)}
.mcell .mk.d{bottom:3px; inset-inline-start:3px; color:var(--ink-2)}
.cl-legend{display:flex; flex-wrap:wrap; align-items:center; gap:6px 18px; font-size:12px; color:var(--ink-2)}
.cl-legend .sw{display:inline-flex; align-items:center; gap:3px}
.cl-legend .sw i{width:30px; height:18px; border-radius:4px; box-shadow:inset 0 0 0 1px var(--line); display:grid; place-items:center; font:600 10.5px var(--f-mono); font-style:normal; color:var(--ink)}
.cl-legend .it{display:inline-flex; align-items:center; gap:6px}
.cl-legend .ring{width:18px; height:18px; border-radius:4px; box-shadow:inset 0 0 0 2px var(--close); background:var(--panel)}

/* contracts: the signing order */
.docs{list-style:none; margin:0; padding:0; display:flex; flex-direction:column}
.docs li{display:grid; grid-template-columns:28px minmax(0,1fr) auto; gap:2px 12px; align-items:start; padding-bottom:16px; position:relative}
.docs li::before{content:""; position:absolute; inset-inline-start:13px; top:30px; bottom:2px; width:2px; background:var(--line)}
.docs li:last-child{padding-bottom:0}
.docs li:last-child::before{display:none}
.docs li.done::before{background:color-mix(in srgb, var(--good) 50%, var(--line))}
.docs .dn{width:28px; height:28px; border-radius:50%; display:grid; place-items:center; font:600 12px var(--f-mono); background:var(--sunk-2); color:var(--ink-2); grid-row:1 / span 2}
.docs li.done .dn{background:var(--good); color:#fff}
.docs li.now .dn{background:var(--close); color:var(--panel)}
.docs li.lock{opacity:.6}
.docs .dt{font-weight:500; padding-top:3px; min-width:0}
.docs .dd{color:var(--muted); font-size:12.5px; min-width:0; grid-column:2}
.docs .da{grid-column:3; grid-row:1 / span 2; align-self:center}
@media (max-width:520px){ .docs li{grid-template-columns:28px minmax(0,1fr)} .docs .da{grid-column:2; grid-row:auto; margin-top:6px; justify-self:start} }
.dealhead{display:flex; align-items:center; flex-wrap:wrap; gap:8px 14px}
.dealhead .rowbtn{flex:1 1 260px}
.dealfacts{display:flex; align-items:center; flex-wrap:wrap; gap:6px 16px}
@container (max-width:560px){ .mx .bh{min-width:128px; max-width:140px} .mx td.bh .clt small{display:none} .mx td.bh .av{display:none} }
.quote{border-inline-start:2px solid var(--line-2); padding-inline-start:10px; color:var(--ink-2); font-size:13px; overflow-wrap:anywhere}
`);

/* ---------- screen state and helpers ---------- */
var DEF = {openKit:null, showLost:false, adding:false, mStatus:["qualified", "negotiating", "won"], mSort:"fit", pitchBrand:null};
function CL(){ return W.U().close || DEF; }
function setCl(patch){ W.ui(function(u){ u.close = Object.assign({}, DEF, u.close, patch); }); }
function budgetText(b){ return !W.canSeeMoney() ? "Budget hidden" : b.budget ? "$" + W.fmtK(b.budget[0]) + "–" + W.fmtK(b.budget[1]) : "Budget unknown"; }
function peeking(t, id){ var p = W.U().peek; return !!p && p.t === t && p.id === id; }
function openPitch(bid, cid){ W.go("close", "pitch", {pitchBrand:bid, pitchCreator:cid || null}); }
function signedList(){ return W.D().creators.filter(function(c){ return c.stage === "signed"; }); }
function liveDealOf(bid, cid){ return W.D().deals.filter(function(x){ return x.brand === bid && x.creator === cid && x.step < 9; })[0] || null; }
function pitchDrafts(){ return W.D().drafts.filter(function(q){ return q.kind === "pitch"; }); }
function dealsAt(step){ return W.D().deals.filter(function(x){ return x.step === step; }).sort(W.by(function(x){ return x.due || Infinity; })); }
function reviewInToday(key){ W.go("today"); W.ui(function(u){ u.todaySel = key; }); }

/* ---------- actions this screen adds ---------- */
W.A.addBrand = function(f){
  var id = W.uid("b"), name = f.name.trim(), sells = (f.sells || "").trim() || "AI tool";
  var site = (f.site || "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  var cat = sells.toLowerCase().replace(/^ai\s+/, "").split(/\s+/)[0] || name.toLowerCase();
  W.act("Added " + name + " as a brand to qualify", function(d){
    d.brands.push({id:id, name:name, sells:sells, cat:cat, country:"US", budget:null, contact:"", email:"", status:"found", seen:[], since:W.now(), site:site || null});
  }, {ref:{t:"brand", id:id}, toast:{msg:name + " added to Found", sub:"Next: check the budget and find a contact. Open it to qualify.", icon:"plus", go:{label:"Open", run:function(){ W.peek("brand", id); }}}});
  return id;
};
W.A.reopenBrand = function(bid){
  var b = W.brand(bid); if (!b) return;
  W.act("Moved " + b.name + " back to Found", function(d){ d.brands.filter(function(z){ return z.id === bid; })[0].status = "found"; },
    {ref:{t:"brand", id:bid}, toast:{msg:b.name + " is back in Found", sub:"It needs qualifying again.", icon:"undo", tone:"info"}});
};
/* a checklist tick that always answers with a toast and Undo (W.A.tick only speaks when a step completes) */
W.A.tickNote = function(dealId, i){
  var x = W.deal(dealId); if (!x) return;
  var step = x.step, was = !!x.checks[i], item = W.DEAL_FLOW[step].items[i];
  W.A.tick(dealId, i);
  var y = W.deal(dealId);
  if (!y || y.step !== step || !!y.checks[i] === was) return;
  var open = y.checks.indexOf(false), depth = W.S.undo.length;
  W.toast({msg:(was ? "Unticked: " : "Done: ") + item, sub:was ? W.dealName(y) : open >= 0 ? "Next: " + W.DEAL_FLOW[step].items[open] : W.dealName(y), icon:was ? "undo" : "check", tone:was ? "info" : "good",
    actions:[{label:"Undo", kbd:"Ctrl Z", run:function(){ if (W.S.undo.length === depth) W.undo(); else W.toast({msg:"Newer changes came after this one", sub:"Use Ctrl Z to step back through them in order.", icon:"info", tone:"info"}); }}]});
};

/* ================= roster ================= */
var CHECK_NAME = {top:"audience country", age:"buying age", eng:"engagement", rate:"rate"};
function kitVerdict(c){
  var src = c.kit || c, a = W.audience({countries:src.countries, age:src.age, eng:src.eng || c.eng, rate:src.rate || c.rate});
  if (a.pass) return {tone:"good", icon:"checkc", text:"Passes all four checks"};
  if (a.fail){ var f = a.rows.filter(function(r){ return r.ok === false; })[0]; return {tone:"crit", icon:"x", text:"Fails: " + CHECK_NAME[f.k]}; }
  return {tone:"warn", icon:"help", text:"Numbers missing"};
}
function KitRow(p){
  var c = p.c, open = p.open, v = kitVerdict(c);
  return html`<div class="cl-sub">
    <div class="cl-row">
      <button type="button" class="rowbtn" aria-selected=${String(peeking("creator", c.id))} onClick=${function(){ W.peek("creator", c.id, p.ids); }} aria-label=${"Open " + c.name}>
        <${W.CAv} c=${c} /><span class="clt"><b>${c.name}</b><small>${c.handle} · kit received ${W.ago(c.kit.at)} · asks ${W.money(c.kit.rate)}</small></span>
      </button>
      <${Tag} tone=${v.tone} icon=${v.icon}>${v.text}</${Tag}>
      <button type="button" class="btn sm" aria-expanded=${String(open)} onClick=${function(){ setCl({openKit:open ? null : c.id}); }}>${open ? "Hide the check" : "Check the audience"}<${Icon} n=${open ? "chevU" : "chevD"} s=${14} /></button>
    </div>
    ${open ? html`<div class="kit-body"><${W.AudienceCheck} c=${c} /></div>` : null}
  </div>`;
}
function Roster(){
  var cl = CL(), d = W.D();
  var kits = d.creators.filter(function(c){ return c.stage === "kit"; });
  var kitIds = kits.map(function(c){ return c.id; });
  var rows = signedList().map(function(c){
    var all = W.dealsFor({t:"creator", id:c.id});
    return {c:c, live:all.filter(function(x){ return x.step < 9; }),
      last:all.filter(function(x){ return x.golive && x.golive <= W.now(); }).sort(W.by(function(x){ return x.golive; }, -1))[0] || null,
      next:all.filter(function(x){ return x.golive && x.golive > W.now(); }).sort(W.by(function(x){ return x.golive; }))[0] || null,
      best:W.bestBrandFor(c)};
  }).sort(W.by(function(r){ return r.c.median; }, -1));
  var ids = rows.map(function(r){ return r.c.id; });
  return html`<${W.Fragment}>
    ${kits.length ? html`<div class="card" data-why="kit-check">
      <div class="card-h"><h3>Waiting for an audience check <span class="muted" style=${{fontWeight:400}}>${kits.length}</span></h3></div>
      <p class="hint">Brands buy US, UK, CA or AU audiences of buying age. Check the media kit against your rules, then sign or decline.</p>
      <div class="col" style=${{gap:"6px"}}>${kits.map(function(c){ return html`<${KitRow} key=${c.id} c=${c} ids=${kitIds} open=${cl.openKit === c.id} />`; })}</div>
    </div>` : null}
    <${W.Section} why="roster" title="Signed creators" count=${rows.length}>
      ${rows.length ? html`<div class="tw"><table class="tbl rt">
        <thead><tr><th>Creator</th><th class="n">Rate</th><th class="n">Median views</th><th>Audience</th><th>Live deals</th><th>Last go-live</th><th>Best next brand</th></tr></thead>
        <tbody>${rows.map(function(r){
          var c = r.c;
          return html`<tr key=${c.id} class="click" aria-selected=${String(peeking("creator", c.id))} onClick=${function(){ W.peek("creator", c.id, ids); }}>
            <td><button type="button" class="lnk" onClick=${function(e){ e.stopPropagation(); W.peek("creator", c.id, ids); }}><${W.CAv} c=${c} /><span class="clt"><b>${c.name}</b><small>${c.handle} · ${W.fmtK(c.subs)} subscribers</small></span></button></td>
            <td class="n">${W.money(c.rate)}</td>
            <td class="n">${W.fmtK(c.median)}</td>
            <td class="aud"><${W.Countries} countries=${c.countries} /></td>
            <td>${r.live.length ? html`<b class="num">${r.live.length}</b><small class="ell" style=${{maxWidth:"150px"}}>${r.live.map(function(x){ return W.brand(x.brand).name; }).join(", ")}</small>` : html`<span class="muted">None</span>`}</td>
            <td>${r.last ? html`<span class="num">${W.fmtShort(r.last.golive)}</span>` : html`<span class="muted">Not yet</span>`}${r.next ? html`<small>next ${W.dueText(r.next.golive)}</small>` : r.last ? html`<small>${W.ago(r.last.golive)}</small>` : null}</td>
            <td>${r.best ? html`<div class="row" style=${{gap:"8px"}}><${W.BAv} b=${r.best.b} size="s" /><span class="clt" style=${{minWidth:"84px"}}><b>${r.best.b.name}</b><small>${r.best.m.score}/100 fit</small></span>
              <${Btn} size="sm" icon="pen" onClick=${function(e){ e.stopPropagation(); openPitch(r.best.b.id, c.id); }} tip=${"Draft a pitch to " + r.best.b.name + " for " + c.name}>Pitch</${Btn}></div>`
              : html`<div class="row" style=${{gap:"8px"}}><span class="muted small">No open brand fits yet</span><${Btn} size="sm" kind="ghost" onClick=${function(e){ e.stopPropagation(); W.go("close", "match"); }}>See matches</${Btn}></div>`}</td>
          </tr>`; })}</tbody></table></div>`
        : html`<div class="card"><${W.Empty} icon="users" title="Nobody is signed yet" action=${html`<${Btn} icon="reply" onClick=${function(){ W.go("reach", "board"); }}>See who has replied</${Btn}>`}>${kits.length ? "Check the media kits above. A creator who passes can be signed in one click." : "Creators who reply with a media kit show up here for an audience check."}</${W.Empty}></div>`}
    </${W.Section}>
  </${W.Fragment}>`;
}

/* ================= brands ================= */
var LANES = [["found", "Found", "Seen sponsoring your channels"], ["qualified", "Qualified", "Budget and contact known"], ["pitched", "Pitched", "Waiting for a reply"], ["negotiating", "Negotiating", "Agreeing the price"], ["won", "Won", "Working with us"]];
function BrandCard(p){
  var b = p.b, n = W.nextFor({t:"brand", id:b.id}), acts = [], meta = [];
  if (!(n && /^Budget/.test(n.sub))) meta.push(budgetText(b));
  if (b.status !== "found") meta.push(b.seen.length ? "Seen with " + W.plural(b.seen.length, "creator") : "Not seen with your creators");
  function open(){ W.peek("brand", b.id, p.ids); }
  if (b.status === "found") acts = [html`<${Btn} key="q" size="sm" icon="flag" onClick=${open}>Qualify</${Btn}>`, html`<${Btn} key="n" size="sm" kind="ghost" icon="x" onClick=${function(){ W.A.notFit(b.id); }}>Not a fit</${Btn}>`];
  else if (b.status === "qualified" || b.status === "won") acts = [html`<${Btn} key="p" size="sm" icon="pen" onClick=${function(){ openPitch(b.id); }}>${b.status === "won" ? "Pitch again" : "Pitch"}</${Btn}>`];
  else if (b.status === "negotiating") acts = [html`<${Btn} key="g" size="sm" icon="dollar" onClick=${function(){ W.go("close", "negotiate"); }}>Price talk</${Btn}>`];
  else if (b.status === "lost") acts = [html`<${Btn} key="r" size="sm" icon="undo" onClick=${function(){ W.A.reopenBrand(b.id); }}>Move back to Found</${Btn}>`];
  return html`<div class="kcard bk" aria-selected=${String(peeking("brand", b.id))}>
    <button type="button" class="bk-main" onClick=${open} aria-label=${"Open " + b.name}>
      <span class="row" style=${{gap:"8px"}}><${W.BAv} b=${b} size="s" /><b class="ell grow">${b.name}</b><span class="tiny muted" data-tip=${W.COUNTRY[b.country] || b.country}>${b.country}</span></span>
      <small>${b.sells}</small>
      ${meta.length ? html`<span class="row wrap tiny muted" style=${{gap:"2px 10px"}}>${meta.map(function(t, i){ return html`<span key=${i}>${t}</span>`; })}</span>` : null}
      ${n ? html`<span class="bk-next"><${Icon} n=${n.icon} s=${14} style=${{color:n.hue}} /><span><b>${n.label}</b><small>${n.sub}</small></span></span>` : null}
    </button>
    ${acts.length ? html`<div class="bk-act">${acts}</div>` : null}
  </div>`;
}
function AddBrand(){
  var f = useState({name:"", sells:"", site:""}), v = f[0], ref = useRef(null);
  useEffect(function(){ if (ref.current) ref.current.focus(); }, []);
  function close(){ setCl({adding:false}); }
  W.useKeys({escape:function(){ close(); }});
  function set(k, val){ var n = Object.assign({}, v); n[k] = val; f[1](n); }
  var nm = v.name.trim().toLowerCase(), existing = nm ? W.D().brands.filter(function(b){ return b.name.toLowerCase() === nm; })[0] : null;
  function submit(){ if (!nm || existing) return; W.A.addBrand(v); close(); }
  function onKey(e){ if (e.key === "Enter"){ e.preventDefault(); submit(); } }
  return html`<div class="card" role="group" aria-label="Add a brand">
    <div class="card-h"><h3>Add a brand</h3><${W.IconBtn} icon="x" label="Close" kbd="Esc" onClick=${close} /></div>
    <div class="grid3">
      <${W.Field} label="Brand name"><input ref=${ref} class="inp" value=${v.name} onInput=${function(e){ set("name", e.target.value); }} onKeyDown=${onKey} placeholder="Transcribo" /></${W.Field}>
      <${W.Field} label="What it sells"><input class="inp" value=${v.sells} onInput=${function(e){ set("sells", e.target.value); }} onKeyDown=${onKey} placeholder="AI transcription" /></${W.Field}>
      <${W.Field} label="Website, if you have it"><input class="inp mono" value=${v.site} onInput=${function(e){ set("site", e.target.value); }} onKeyDown=${onKey} placeholder="transcribo.co.uk" /></${W.Field}>
    </div>
    ${existing ? html`<${W.Callout} tone="warn" right=${html`<${Btn} size="sm" onClick=${function(){ W.peek("brand", existing.id); }}>Open ${existing.name}</${Btn}>`}>${existing.name} is already on the board (${existing.status === "lost" ? "set aside as not a fit" : existing.status}).</${W.Callout}>` : null}
    <div class="row wrap"><${Btn} kind="pri" icon="plus" disabled=${!nm || !!existing} onClick=${submit}>Add to Found</${Btn}><${Btn} kind="ghost" onClick=${close}>Cancel</${Btn}><span class="hint">It lands in Found. Qualifying it takes a budget and a contact.</span></div>
  </div>`;
}
function Brands(){
  var cl = CL(), d = W.D();
  W.useKeys({n:function(){ setCl({adding:true}); }}, !cl.adding);
  var lanes = LANES.concat(cl.showLost ? [["lost", "Not a fit", "Set aside. Move one back if that changes"]] : []);
  var by = {};
  lanes.forEach(function(l){ by[l[0]] = d.brands.filter(function(b){ return b.status === l[0]; }).sort(W.by(function(b){ return b.since; }, -1)); });
  var ids = []; lanes.forEach(function(l){ by[l[0]].forEach(function(b){ ids.push(b.id); }); });
  var lost = d.brands.filter(function(b){ return b.status === "lost"; }).length;
  var need = by.found.length + by.qualified.length;
  return html`<${W.Fragment}>
    ${cl.adding ? html`<${AddBrand} />` : null}
    <div class="cl-bar">
      <span class="ink2">${W.plural(d.brands.length - lost, "brand")} on the board${need ? ", " + need + " waiting on you" : ""}.</span>
      <span class="sp"></span>
      <button type="button" class="chip" aria-pressed=${String(!!cl.showLost)} onClick=${function(){ setCl({showLost:!cl.showLost}); }}>Not a fit <span class="c">${lost}</span></button>
    </div>
    <div class="board" data-why="brand-board">${lanes.map(function(l){
      var list = by[l[0]];
      return html`<section key=${l[0]} class="lane" aria-label=${l[1]}>
        <div class="lane-h"><span>${l[1]}<small>${l[2]}</small></span><span class="m">${list.length}</span></div>
        ${list.map(function(b){ return html`<${BrandCard} key=${b.id} b=${b} ids=${ids} />`; })}
        ${!list.length ? html`<${W.Empty} icon=${l[0] === "found" ? "plus" : "box"} title=${l[0] === "found" ? "No new brands" : "Nothing here"}>${l[0] === "found" ? "Add one with the button above." : l[0] === "lost" ? "Brands you set aside appear here." : "Brands move here as you work them."}</${W.Empty}>` : null}
      </section>`; })}</div>
  </${W.Fragment}>`;
}

/* ================= match ================= */
var M_STATUS = [["qualified", "Qualified"], ["negotiating", "Negotiating"], ["won", "Won"], ["pitched", "Pitched"]];
function shade(score){ var t = W.clamp((score - 40) / 60, 0, 1); return "color-mix(in srgb, var(--close) " + Math.round(6 + t * 44) + "%, var(--panel))"; }
function Cell(p){
  var m = p.m, b = p.b, c = p.c, clash = m.warn.some(function(w){ return /live deal/.test(w); });
  var tip = m.score + "/100. " + (m.why.length ? m.why.join(". ") : "No strong signals") + "." + (m.warn.length ? " Watch out: " + m.warn.join(". ") + "." : "") + (p.deal ? " Live deal together: " + W.DEAL_FLOW[p.deal.step].name + "." : "") + " Click to pitch.";
  return html`<button type="button" class=${W.cx("mcell", p.best ? "best" : null)} style=${{background:shade(m.score)}} data-tip=${tip} aria-label=${b.name + " with " + c.name + ": fit " + m.score + " of 100" + (m.warn.length ? ", " + m.warn.join(", ") : "") + (p.deal ? ", live deal together" : "") + ". Start a pitch."} onClick=${function(){ openPitch(b.id, c.id); }}>
    <span class="num">${m.score}</span>
    ${m.warn.length ? html`<span class=${W.cx("mk", "w", clash ? "crit" : null)}><${Icon} n="alert" /></span>` : null}
    ${p.deal ? html`<span class="mk d"><${Icon} n="box" /></span>` : null}
  </button>`;
}
function Match(){
  var cl = CL(), d = W.D(), creators = signedList().sort(W.by(function(c){ return c.median; }, -1));
  var sts = cl.mStatus, waiting = {};
  pitchDrafts().forEach(function(q){ waiting[q.to.id] = true; });
  var all = d.brands.filter(function(b){ return M_STATUS.some(function(s){ return s[0] === b.status; }); });
  var rows = all.filter(function(b){ return sts.indexOf(b.status) >= 0; }).map(function(b){
    var cells = creators.map(function(c){ return {c:c, m:W.match(b, c), deal:liveDealOf(b.id, c.id)}; });
    var clean = cells.filter(function(x){ return !x.m.warn.length && !x.deal; }).sort(W.by(function(x){ return x.m.score; }, -1))[0] || null;
    return {b:b, cells:cells, best:clean, top:Math.max.apply(null, cells.map(function(x){ return x.m.score; }).concat([0]))};
  });
  rows.sort(cl.mSort === "name" ? W.by(function(r){ return r.b.name; }) : W.by(function(r){ return r.best ? r.best.m.score : -1; }, -1));
  var pairs = [];
  rows.forEach(function(r){ if (r.b.status === "negotiating" || r.b.status === "pitched" || waiting[r.b.id]) return; r.cells.forEach(function(x){ if (!x.m.warn.length && !x.deal) pairs.push({b:r.b, x:x}); }); });
  pairs.sort(W.by(function(p){ return p.x.m.score; }, -1));
  var seen = {}; pairs = pairs.filter(function(p){ if (seen[p.b.id]) return false; seen[p.b.id] = 1; return true; }).slice(0, 4);
  var brandIds = rows.map(function(r){ return r.b.id; }), creatorIds = creators.map(function(c){ return c.id; });
  function toggle(k){ var n = sts.indexOf(k) >= 0 ? sts.filter(function(x){ return x !== k; }) : sts.concat([k]); setCl({mStatus:n}); }
  return html`<${W.Fragment}>
    <p class="hint" style=${{maxWidth:"80ch"}}>Each cell scores how well a creator fits a brand: audience, price against the brand's budget, past sponsors, and clashes with live deals. Click a cell to start a pitch.</p>
    <div class="cl-bar" data-why="match-filters">
      ${M_STATUS.map(function(s){ var n = all.filter(function(b){ return b.status === s[0]; }).length; return html`<button key=${s[0]} type="button" class="chip" aria-pressed=${String(sts.indexOf(s[0]) >= 0)} onClick=${function(){ toggle(s[0]); }}>${s[1]} <span class="c">${n}</span></button>`; })}
      <span class="sp"></span>
      <${W.Seg} label="Sort brands" cur=${cl.mSort} onPick=${function(v){ setCl({mSort:v}); }} opts=${[["fit", "Best fit"], ["name", "Name"]]} />
    </div>
    ${!creators.length ? html`<div class="card"><${W.Empty} icon="users" title="No signed creators to match" action=${html`<${Btn} onClick=${function(){ W.go("close", "roster"); }}>Go to the roster</${Btn}>`}>Sign a creator first. Then every brand gets a score against them.</${W.Empty}></div>`
      : !rows.length ? html`<div class="card"><${W.Empty} icon="filter" title="No brands match these filters" action=${html`<${Btn} onClick=${function(){ setCl({mStatus:DEF.mStatus.slice()}); }}>Show the usual three</${Btn}>`}>Pick at least one status above.</${W.Empty}></div>`
      : html`<div class="tw" data-why="match-grid"><table class="tbl mx">
        <thead><tr><th class="bh">Brand</th>${creators.map(function(c){ return html`<th key=${c.id} class="ch"><button type="button" class="chb" onClick=${function(){ W.peek("creator", c.id, creatorIds); }} aria-label=${"Open " + c.name}><${W.CAv} c=${c} size="s" /><b>${c.name}</b><small>${W.fmtK(c.median)} median</small></button></th>`; })}</tr></thead>
        <tbody>${rows.map(function(r){
          return html`<tr key=${r.b.id} aria-selected=${String(peeking("brand", r.b.id))}>
            <td class="bh"><button type="button" class="rowbtn" onClick=${function(){ W.peek("brand", r.b.id, brandIds); }} aria-label=${"Open " + r.b.name}><${W.BAv} b=${r.b} size="s" /><span class="clt"><b>${r.b.name}</b><small>${r.b.status} · ${budgetText(r.b)}${waiting[r.b.id] ? " · pitch drafted" : ""}</small></span></button></td>
            ${r.cells.map(function(x){ return html`<td key=${x.c.id}><${Cell} b=${r.b} c=${x.c} m=${x.m} deal=${x.deal} best=${r.best && r.best.c.id === x.c.id} /></td>`; })}
          </tr>`; })}</tbody></table></div>`}
    ${rows.length && creators.length ? html`<div class="cl-legend" aria-label="How to read the grid">
      <span class="sw">${[40, 55, 70, 85, 100].map(function(s){ return html`<i key=${s} style=${{background:shade(s)}}>${s}</i>`; })}<span style=${{marginInlineStart:"4px"}}>fit score, darker is better</span></span>
      <span class="it"><span class="ring"></span>best fit to pitch: no warning, no live deal</span>
      <span class="it" style=${{color:"var(--warn)"}}><${Icon} n="alert" s=${14} /><span class="ink2">warning: over budget, a clash or a full schedule</span></span>
      <span class="it"><${Icon} n="box" s=${14} />already in a live deal together</span>
    </div>` : null}
    ${rows.length && creators.length ? html`<div class="card" data-why="match-pairs">
      <div class="card-h"><h3>Strongest pairings to pitch now</h3></div>
      <p class="hint">No warning, no live deal between the two, and no pitch already waiting. One per brand.</p>
      ${pairs.length ? html`<div class="col" style=${{gap:"2px"}}>${pairs.map(function(p){ var m = p.x.m;
        return html`<div key=${p.b.id} class="cl-row">
          <button type="button" class="rowbtn" aria-selected=${String(peeking("brand", p.b.id))} onClick=${function(){ W.peek("brand", p.b.id, brandIds); }}><${W.BAv} b=${p.b} size="s" /><span class="clt"><b>${p.b.name} with ${p.x.c.name}</b><small>${m.why[0] || "Solid all-round fit"}</small></span></button>
          <b class="num" style=${{fontSize:"15px"}}>${m.score}</b>
          <${Btn} size="sm" icon="pen" onClick=${function(){ openPitch(p.b.id, p.x.c.id); }}>Pitch</${Btn}>
        </div>`; })}</div>` : html`<p class="ink2">Every strong pairing already has a deal or a pitch in motion, or carries a warning. Qualify another brand to add options.</p>`}
    </div>` : null}
  </${W.Fragment}>`;
}

/* ================= pitch ================= */
/* a Match cell or the roster can ask for particular creators; PitchPicker takes them as its starting picks */
function PitchBox(p){
  return html`<${W.PitchPicker} key=${p.b.id + (p.pick || []).join(",")} b=${p.b} pick=${p.pick} />`;
}
function PendingPitch(p){
  var q = p.q, b = W.rec(q.to), open = q.gates.filter(function(g){ return !g.ok; });
  if (!b) return null;
  var names = (q.creators || []).map(function(id){ var c = W.creator(id); return c ? c.name : id; }).join(" + ");
  return html`<div class="cl-row">
    <button type="button" class="rowbtn" aria-selected=${String(peeking("brand", b.id))} onClick=${function(){ W.peek("brand", b.id, p.ids); }} aria-label=${"Open " + b.name}>
      <${W.BAv} b=${b} size="s" /><span class="clt"><b>Pitch to ${b.name}</b><small>${names} · drafted ${W.ago(q.created)}</small></span>
    </button>
    ${open.length ? html`<${Tag} tone="warn" icon="alert">${(function(t){ return t.charAt(0).toUpperCase() + t.slice(1); })(W.gateShort(open[0]))}</${Tag}>` : html`<${Tag} tone="good" icon="check">Ready to send</${Tag}>`}
    <${Btn} size="sm" kind="pri" icon="eye" onClick=${function(){ reviewInToday("send:" + q.id); }}>Review in Today</${Btn}>
    <${Btn} size="sm" kind="ghost" onClick=${function(){ W.A.skipDraft(q.id, "send:" + q.id); }} tip="Drop this draft">Discard</${Btn}>
  </div>`;
}
function Pitch(){
  var d = W.D(), u = W.U(), r = u.route, cl = CL();
  var creators = signedList();
  function clean(b){ return Math.max.apply(null, creators.filter(function(c){ return !liveDealOf(b.id, c.id); }).map(function(c){ var m = W.match(b, c); return m.warn.length ? -1 : m.score; }).concat([-1])); }
  var ready = d.brands.filter(function(b){ return b.status === "qualified" || b.status === "won"; }).map(function(b){ return {b:b, k:clean(b)}; })
    .sort(function(a, z){ return (z.k >= 0) - (a.k >= 0) || (a.b.status === "qualified" ? 0 : 1) - (z.b.status === "qualified" ? 0 : 1) || z.k - a.k; }).map(function(x){ return x.b; });
  var want = W.brand(r.pitchBrand || cl.pitchBrand || ""), extra = want && ready.indexOf(want) < 0 ? want : null;
  var chips = ready.concat(extra ? [extra] : []);
  var sel = want && chips.indexOf(want) >= 0 ? want : chips[0] || null;
  var waiting = pitchDrafts(), waitIds = waiting.map(function(q){ return q.to.id; });
  var sent = d.brands.filter(function(b){ return b.status === "pitched"; }).sort(W.by(function(b){ return b.pitched ? b.pitched.at : 0; }));
  var pick = sel && r.pitchBrand === sel.id && r.pitchCreator ? [r.pitchCreator] : null;
  function choose(b){
    W.ui(function(uu){ var nr = Object.assign({}, uu.route, {pitchBrand:b.id, pitchCreator:null}); uu.route = nr; uu.hist[uu.histI] = nr; uu.close = Object.assign({}, DEF, uu.close, {pitchBrand:b.id}); });
  }
  var selWaiting = sel ? waiting.filter(function(q){ return q.to.id === sel.id; })[0] : null;
  var live = sel ? d.deals.filter(function(x){ return x.brand === sel.id && x.step < 9; }) : [];
  var allIds = waitIds.concat(sent.map(function(b){ return b.id; }));
  return html`<div class="cl-two">
    <div class="col" data-why="pitch-picker">
      ${!sel ? html`<div class="card"><${W.Empty} icon="flag" title="No brand is ready to pitch" action=${html`<${Btn} icon="columns" onClick=${function(){ W.go("close", "brands"); }}>Go to Brands</${Btn}>`}>A brand needs a contact and a budget before you pitch it. Qualify one on the Brands board.</${W.Empty}></div>` : html`<${W.Fragment}>
        <div class="col tight"><span class="small muted" id="pitch-to">Pitch to</span>
          <div class="row wrap" role="group" aria-labelledby="pitch-to">${chips.map(function(b){ return html`<button key=${b.id} type="button" class="chip" aria-pressed=${String(b.id === sel.id)} onClick=${function(){ choose(b); }}>${b.name}${waitIds.indexOf(b.id) >= 0 ? html`<${Icon} n="send" s=${12} />` : null}<span class="c">${b.status}</span></button>`; })}</div>
        </div>
        <div class="card">
          <div class="row top wrap" style=${{gap:"10px 12px"}}>
            <${W.BAv} b=${sel} size="l" />
            <div class="clt" style=${{gap:"2px", flexBasis:"150px"}}><h2 style=${{overflowWrap:"anywhere"}}>${sel.name}</h2><span class="muted small">${sel.sells} · ${W.COUNTRY[sel.country] || sel.country}</span></div>
            <${Btn} size="sm" kind="ghost" icon="eye" onClick=${function(){ W.peek("brand", sel.id); }}>Open record</${Btn}>
          </div>
          <dl class="kv"><dt>Budget</dt><dd>${sel.budget ? W.money(sel.budget[0]) + "–" + W.money(sel.budget[1]) : "unknown"}</dd><dt>Contact</dt><dd>${sel.contact || "none yet"} <span class="mono small muted">${sel.email}</span></dd>
            <dt>Seen with</dt><dd>${sel.seen.map(function(id){ var c = W.creator(id); return c ? c.name : id; }).join(", ") || "none of your creators"}</dd>${live.length ? html`<dt>Live deals</dt><dd>${live.map(function(x, i){ return html`<button key=${x.id} type="button" class="btn ghost sm" style=${{marginInlineEnd:"4px"}} onClick=${function(){ W.peek("deal", x.id); }}>${W.creator(x.creator).name} · ${W.DEAL_FLOW[x.step].name}</button>`; })}</dd>` : null}</dl>
          ${sel.status === "pitched" ? html`<${W.Callout} tone="info" icon="clock">Pitched ${W.ago(sel.pitched.at)}. A nudge is due ${W.dueText(sel.pitched.at + 5 * W.DAY)}. A new pitch here offers a different creator.</${W.Callout}>` : null}
          ${sel.status === "negotiating" ? html`<${W.Callout} tone="info" icon="dollar" right=${html`<${Btn} size="sm" onClick=${function(){ W.go("close", "negotiate"); }}>Price talk</${Btn}>`}>${sel.name} is already talking price. A new pitch offers them another creator.</${W.Callout}>` : null}
          ${selWaiting ? html`<${W.Callout} tone="warn" right=${html`<${Btn} size="sm" onClick=${function(){ reviewInToday("send:" + selWaiting.id); }}>Review in Today</${Btn}>`}>A pitch to ${sel.name} is already waiting for your approval. Drafting another adds a second one.</${W.Callout}>` : null}
          <${PitchBox} key=${sel.id + ":" + (pick || []).join(",")} b=${sel} pick=${pick} />
        </div>
      </${W.Fragment}>`}
    </div>
    <div class="col">
      <div class="card" data-why="pitch-waiting">
        <div class="card-h"><h3>Waiting for your approval${waiting.length ? html` <span class="muted" style=${{fontWeight:400}}>${waiting.length}</span>` : ""}</h3></div>
        ${waiting.length ? html`<div class="col" style=${{gap:"2px"}}>${waiting.map(function(q){ return html`<${PendingPitch} key=${q.id} q=${q} ids=${allIds} />`; })}</div>`
          : html`<p class="hint">No pitch is waiting. Draft one and it lands here, then in Today for the price check.</p>`}
      </div>
      <div class="card">
        <div class="card-h"><h3>Sent, waiting for a reply <span class="muted" style=${{fontWeight:400}}>${sent.length}</span></h3></div>
        ${sent.length ? html`<div class="col" style=${{gap:"2px"}}>${sent.map(function(b){ return html`<div key=${b.id} class="cl-row">
          <button type="button" class="rowbtn" aria-selected=${String(peeking("brand", b.id))} onClick=${function(){ W.peek("brand", b.id, allIds); }} aria-label=${"Open " + b.name}>
            <${W.BAv} b=${b} size="s" /><span class="clt"><b>${b.name}</b><small>${(b.pitched.creators || []).map(function(id){ var c = W.creator(id); return c ? c.name : id; }).join(" + ")} · ${W.ago(b.pitched.at)}</small></span>
          </button>
          <span class="small muted">Nudge</span><${W.Due} ts=${b.pitched.at + 5 * W.DAY} />
        </div>`; })}</div>` : html`<p class="hint">Nothing sent yet. Approved pitches wait here for the brand's answer.</p>`}
      </div>
    </div>
  </div>`;
}

/* ================= negotiate and contracts: the deal card ================= */
function DealCard(p){
  var x = p.x, b = W.brand(x.brand), c = W.creator(x.creator), margin = Math.round(100 * (x.price - x.payout) / x.price), floor = W.D().rules.marginFloor;
  return html`<div class="card" data-why=${p.why || null}>
    <div class="dealhead">
      <button type="button" class="rowbtn" aria-selected=${String(peeking("deal", x.id))} onClick=${function(){ W.peek("deal", x.id, p.ids); }} aria-label=${"Open the deal " + W.dealName(x)}>
        <${W.BAv} b=${b} /><span class="clt"><b style=${{fontSize:"14.5px"}}>${W.dealName(x)}</b><small>${x.deliverable} · ${x.terms}</small></span>
      </button>
      <span class="dealfacts">
        <span class="small"><b class="num">${W.money(x.price)}</b> <span class="muted">brand pays</span></span>
        <span class="small"><b class="num">${W.money(x.payout)}</b> <span class="muted">${c.name.split(" ")[0]} gets</span></span>
        <${Tag} tone=${margin < floor ? "crit" : "good"} tip=${"Your margin floor is " + floor + "%"}>${margin}% margin</${Tag}>
        <${W.Av} id=${x.owner} size="s" />
        ${x.due ? html`<${W.Due} ts=${x.due} />` : null}
      </span>
    </div>
    ${p.children}
  </div>`;
}
function ToAgree(p){
  var x = p.x, st = W.DEAL_FLOW[x.step], done = x.checks.filter(Boolean).length;
  return html`<div class="col" style=${{gap:"10px"}}>
    <div class="row"><h3 class="grow">To agree</h3><span class="small muted num">${done} of ${x.checks.length} done</span></div>
    <ul class="checks">${st.items.map(function(it, i){ return html`<li key=${i} class=${W.cx("ck", x.checks[i] ? "done" : null)}>
      <button type="button" class="box" onClick=${function(){ W.A.tickNote(x.id, i); }} aria-pressed=${String(!!x.checks[i])} aria-label=${(x.checks[i] ? "Untick " : "Tick ") + it}><${Icon} n="check" s=${13} /></button>
      <span class="t">${it}</span></li>`; })}</ul>
  </div>`;
}
function Negotiate(){
  var deals = dealsAt(0), ids = deals.map(function(x){ return x.id; });
  if (!deals.length) return html`<div class="card"><${W.Empty} icon="dollar" title="No price talks are open" action=${html`<${Btn} icon="pen" onClick=${function(){ W.go("close", "pitch"); }}>Go to Pitch</${Btn}>`}>When a brand answers a pitch with interest, the deal starts here and you agree the price.</${W.Empty}></div>`;
  return html`<${W.Fragment}>${deals.map(function(x){
    var ref = {t:"brand", id:x.brand}, b = W.brand(x.brand), last = W.lastIn(ref);
    var reply = W.draftsFor(ref).filter(function(q){ return q.deal === x.id; })[0];
    return html`<${DealCard} key=${x.id} x=${x} ids=${ids} why="negotiate">
      <div class="cl-two even">
        <div class="col">${x.neg ? html`<${W.Ladder} x=${x} />` : html`<${W.DealChecklist} x=${x} />`}</div>
        <div class="col">
          <div class="card flat">
            <div class="row"><h3 class="grow">${b.name}'s last message</h3>${last && last.ai ? html`<${Tag} tone="info">${last.ai.intent}</${Tag}>` : null}</div>
            ${last ? html`<p class="quote">${last.text}</p><span class="small muted">${W.fmtDate(last.at)} · ${W.ago(last.at)}</span>` : html`<p class="hint">${b.name} has not written back yet.</p>`}
            ${reply ? html`<${W.Callout} tone="warn" icon="reply" right=${html`<${Btn} size="sm" kind="pri" onClick=${function(){ reviewInToday("reply:" + reply.id); }}>Review in Today</${Btn}>`}>Your reply is drafted and names a price, so it waits for your confirmation.</${W.Callout}>` : null}
            <div class="row"><${Btn} size="sm" icon="eye" onClick=${function(){ W.peek("brand", b.id); }}>Open ${b.name}</${Btn}></div>
          </div>
          ${x.neg ? html`<${ToAgree} x=${x} />` : null}
        </div>
      </div>
    </${DealCard}>`; })}</${W.Fragment}>`;
}

var DOCS = [
  {t:"Brand's contract", done:function(b, c){ return "Received from " + b.name; }, open:function(b, c){ return "Waiting for " + b.name + " to send it"; }, btn:"Mark received"},
  {t:"Creator's version", done:function(b, c){ return "Mirrored for " + c.name; }, open:function(b, c){ return "Mirror it for " + c.name + " so the terms match"; }, btn:"Mark mirrored"},
  {t:"Creator signs", done:function(b, c){ return c.name + " signed"; }, open:function(b, c){ return "Waiting for " + c.name + " to sign"; }, btn:"Creator has signed"},
  {t:"Agency signs", done:function(b, c){ return "Signed with " + b.name; }, open:function(b, c){ return "You sign with " + b.name + " once " + c.name + " has"; }, btn:"We have signed"}
];
function docDate(x, i){
  var key = 'Ticked "' + W.DEAL_FLOW[1].items[i] + '"', hit = W.D().log.filter(function(l){ return l.ref && l.ref.t === "deal" && l.ref.id === x.id && l.text.indexOf(key) === 0; })[0];
  return hit ? hit.at : null;
}
function Documents(p){
  var x = p.x, b = W.brand(x.brand), c = W.creator(x.creator), now = x.checks.indexOf(false);
  return html`<div class="col" style=${{gap:"12px"}} data-why="documents">
    <div class="col t2"><h3>Documents and signatures</h3><p class="hint">Follow the numbers. Each step unlocks the next.</p></div>
    <ol class="docs" style=${{margin:0}}>${DOCS.map(function(s, i){
      var done = !!x.checks[i], isNow = i === now, at = done ? docDate(x, i) : null;
      return html`<li key=${i} class=${done ? "done" : isNow ? "now" : "lock"}>
        <span class="dn">${done ? html`<${Icon} n="check" s=${14} />` : isNow ? i + 1 : html`<${Icon} n="lock" s=${13} />`}</span>
        <span class="dt">${s.t}</span>
        <span class="dd">${done ? s.done(b, c) + (at ? " · " + W.fmtDate(at) : "") : s.open(b, c)}</span>
        ${isNow ? html`<span class="da"><${Btn} size="sm" kind="pri" icon="check" onClick=${function(){ W.A.tickNote(x.id, i); }}>${s.btn}</${Btn}></span>` : null}
      </li>`; })}</ol>
  </div>`;
}
function Contracts(){
  var deals = dealsAt(1), ids = deals.map(function(x){ return x.id; });
  if (!deals.length) return html`<div class="card"><${W.Empty} icon="file" title="No contracts are waiting" action=${html`<${Btn} icon="dollar" onClick=${function(){ W.go("close", "negotiate"); }}>See price talks</${Btn}>`}>A deal lands here once the price and terms are agreed. The creator signs first, then you sign with the brand.</${W.Empty}></div>`;
  return html`<${W.Fragment}>${deals.map(function(x){
    return html`<${DealCard} key=${x.id} x=${x} ids=${ids} why="contracts">
      <div class="cl-two even">
        <div class="card flat"><${W.DealChecklist} x=${x} /></div>
        <div class="card flat"><${Documents} x=${x} /></div>
      </div>
    </${DealCard}>`; })}</${W.Fragment}>`;
}

/* ================= the screen ================= */
var BODY = {roster:Roster, brands:Brands, match:Match, pitch:Pitch, negotiate:Negotiate, contracts:Contracts};
W.screens.close = function(){
  var st = W.useApp(), u = st.ui, d = st.data, tab = BODY[u.route.tab] ? u.route.tab : "roster";
  useEffect(function(){ if (!W.U().close) W.ui(function(uu){ uu.close = Object.assign({}, DEF); }); }, []);
  var kits = d.creators.filter(function(c){ return c.stage === "kit"; }).length;
  var need = d.brands.filter(function(b){ return b.status === "found" || b.status === "qualified"; }).length;
  var tabs = [["roster", "Roster", kits || null], ["brands", "Brands", need || null], ["match", "Match"], ["pitch", "Pitch", pitchDrafts().length || null], ["negotiate", "Negotiate", dealsAt(0).length || null], ["contracts", "Contracts", dealsAt(1).length || null]];
  var Body = BODY[tab];
  if (tab === "negotiate" && !W.canSeeMoney()) Body = function(){ return html`<div class="card"><${W.Empty} icon="lock" title="Price talks stay with the owner and account managers">Counter-offers carry the price and the margin, which ${W.member(d.me).role}s don't see. Pitches and contracts are still yours to follow.</${W.Empty}></div>`; };
  return html`<div class="page">
    <${W.PageHead} title="Close" hue=${HUE} sub="Sign creators, match them to brands, then agree the price and the contract."
      right=${tab === "brands" ? html`<${Btn} kind="pri" icon="plus" kbd="N" onClick=${function(){ setCl({adding:!CL().adding}); }}>Add a brand</${Btn}>` : null} />
    <${W.Tabs} tabs=${tabs} cur=${tab} hue=${HUE} onPick=${W.setTab} />
    <div class="cl-wrap"><${Body} key=${tab} /></div>
  </div>`;
};
})();
