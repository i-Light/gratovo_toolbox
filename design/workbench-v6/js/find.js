/* find.js — Find creators: the search console (keywords, rules, live run, history), triage one channel at a time,
   the gallery (channels as their latest videos, faceted, multi-select, compare, saved views), and contacts. */
(function(){
"use strict";
var W = window.W, html = W.html, Icon = W.Icon, useState = W.useState, useEffect = W.useEffect, useRef = W.useRef;
var Btn = W.Btn, Tag = W.Tag;

W.css(`
.fd-grid{display:grid; grid-template-columns:minmax(0,1.15fr) minmax(0,1fr); gap:var(--gap); align-items:start}
@media (max-width:1100px){ .fd-grid{grid-template-columns:1fr} }
.kw-list{display:flex; flex-direction:column; max-height:460px; overflow-y:auto; border:1px solid var(--line); border-radius:var(--r-m)}
.kw{display:grid; grid-template-columns:28px minmax(0,1fr) auto; gap:10px; align-items:center; padding:7px 10px; border-bottom:1px solid var(--line); font-size:13px; min-height:40px}
.kw:last-child{border-bottom:0}
.kw .n{font:500 11px var(--f-mono); color:var(--muted); text-align:end}
.kw.done .q{color:var(--ink-2)}
.kw.running{background:color-mix(in srgb, var(--find) 7%, var(--panel))}
.kw .acts{display:flex; gap:2px; align-items:center}
.kw .acts .btn{opacity:.55; transition:opacity .12s}
.kw:hover .acts .btn, .kw .acts .btn:focus-visible{opacity:1}
@media (hover:none){ .kw .acts .btn{opacity:1} }
.yield{display:inline-flex; align-items:center; gap:6px; font-size:12px; color:var(--muted); white-space:nowrap}
.yield i{display:inline-block; width:44px; height:5px; border-radius:3px; background:var(--sunk-2); position:relative; overflow:hidden}
.yield i b{position:absolute; inset-block:0; inset-inline-start:0; background:var(--find); border-radius:3px}
.log{font:12px/1.6 var(--f-mono); background:var(--sunk); border-radius:var(--r-m); padding:10px 12px; max-height:190px; overflow-y:auto; color:var(--ink-2); white-space:pre-wrap; overflow-wrap:anywhere}
.log .t{color:var(--muted)}
.minis{display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px}
@media (max-width:560px){ .minis{grid-template-columns:repeat(2,minmax(0,1fr))} }
.mini-stat{background:var(--sunk); border-radius:var(--r-m); padding:10px; display:flex; flex-direction:column; gap:2px; min-width:0}
.mini-stat b{font-size:18px; font-weight:600; font-variant-numeric:tabular-nums}
.mini-stat small{font-size:11.5px; color:var(--muted)}
.gal-wrap{display:grid; grid-template-columns:232px minmax(0,1fr); gap:18px; align-items:start}
@media (max-width:900px){ .gal-wrap{grid-template-columns:1fr} .gal-wrap .facets{position:static; max-height:none} }
.fchips{display:flex; flex-wrap:wrap; gap:5px}
.fchips .chip{height:26px; padding:0 9px; font-size:12px}
.gcard .gtitle{font-size:12.5px; color:var(--ink-2); display:-webkit-box; -webkit-line-clamp:1; -webkit-box-orient:vertical; overflow:hidden}
.gcard .gmeta{font-size:12px; color:var(--muted); display:flex; gap:4px 10px; flex-wrap:wrap}
.gcard .gmeta b{color:var(--ink); font-weight:600; font-variant-numeric:tabular-nums}
.gcard .thumbwrap{position:relative}
.gcard.dim{opacity:.62}
.cmp{display:grid; gap:12px}
.cmp .cc{display:flex; flex-direction:column; gap:8px; min-width:0}
.cmp-row{display:grid; gap:12px; font-size:12.5px; padding:6px 0; border-top:1px solid var(--line); align-items:center}
.cmp-row .lbl{color:var(--muted)}
.cmp-row .best{color:var(--good); font-weight:600}
.view-chip{display:inline-flex; align-items:center; gap:4px}
`);

/* ---------- state ---------- */
var FIND_DEF = {stages:[], signals:[], countries:[], minMedian:0, maxMedian:null, minUp:0, owners:[], runs:[], q:""};
var UI_DEF = {sort:"fit", view:"gallery", size:"m", pics:true, latest:true, sig:true, sel:{}, last:null, compare:false, saving:false, viewName:"",
  views:[{name:"US/UK gold mines", f:{signals:["gold"], countries:["US","GB"]}},{name:"New this morning", f:{stages:["new"], runs:["r3"]}},{name:"Sponsored, no email yet", f:{signals:["sponsored"], stages:["shortlisted"]}},{name:"5-Star Priority", f:{signals:["stars5"]}}],
  kw:"", gen:false, genBusy:false, genPick:{}, rules:false, facetsOpen:false};
function F(){ return Object.assign({}, FIND_DEF, W.U().find || {}); }
function X(){ return Object.assign({}, UI_DEF, W.U().findui || {}); }
function setF(patch){ W.ui(function(u){ u.find = Object.assign({}, FIND_DEF, u.find || {}, typeof patch === "function" ? patch(Object.assign({}, FIND_DEF, u.find || {})) : patch); }); }
function setX(patch){ W.ui(function(u){ u.findui = Object.assign({}, UI_DEF, u.findui || {}, typeof patch === "function" ? patch(Object.assign({}, UI_DEF, u.findui || {})) : patch); }); }
function toggleIn(list, v){ return list.indexOf(v) >= 0 ? list.filter(function(x){ return x !== v; }) : list.concat([v]); }
function run(){ return W.D().runs.filter(function(r){ return r.id === "r3"; })[0]; }

/* ---------- gallery filtering ---------- */
var SIGNALS = [
  ["gold","Gold mine",W.gold,"Median views at least 40% of subscribers, posting 3–20 times a month"],
  ["stars5","5-Star Priority",function(c){ return (c.starRating || 3) >= 5; },"Rated 5 stars by the scouting team"],
  ["stable","Stable views (HC-16)",function(c){ return c.viewStability === "stable"; },"Consistent view floor without one-hit outlier dependency"],
  ["longform","Long-form only",function(c){ return c.format === "Long-form"; },"Dedicated long-form YouTube videos (no Shorts inflation)"],
  ["sponsored","Sponsored before",function(c){ return c.sponsors.length > 0; }],
  ["email","Has an email",function(c){ return !!c.email; }],
  ["confirmed","Email confirmed",function(c){ return c.confirmed; }],
  ["fresh","Never emailed",function(c){ return !c.seq; }]
];
var STAGES = ["new","shortlisted","contact","emailed","replied","kit","signed","parked","rejected","never"];
var COUNTRIES = ["US","GB","CA","AU","IN"];
var MEDIANS = [[0,"Any"],[25000,"25K+"],[45000,"45K+"],[80000,"80K+"]];
var UPLOADS = [[0,"Any"],[3,"3+"],[5,"5+"]];
function sig(k){ return SIGNALS.filter(function(s){ return s[0] === k; })[0]; }
function text(c){ return (c.name + " " + c.handle + " " + c.videos.map(function(v){ return v.t; }).join(" ") + " " + c.sponsors.join(" ") + " " + (c.email || "")).toLowerCase(); }
function passes(c, f, skip){
  if (skip !== "stages"){ if (f.stages.length){ if (f.stages.indexOf(c.stage) < 0) return false; } else if (c.stage === "rejected" || c.stage === "never") return false; }
  if (skip !== "signals" && f.signals.some(function(k){ return !sig(k) || !sig(k)[2](c); })) return false;
  if (skip !== "countries" && f.countries.length && !c.countries.slice(0, 3).some(function(x){ return f.countries.indexOf(x[0]) >= 0; })) return false;
  if (skip !== "median" && (c.median < (f.minMedian || 0) || (f.maxMedian != null && c.median > f.maxMedian))) return false;
  if (skip !== "uploads" && c.up30 < (f.minUp || 0)) return false;
  if (skip !== "owners" && f.owners.length && f.owners.indexOf(c.owner || "none") < 0) return false;
  if (skip !== "runs" && f.runs.length && f.runs.indexOf(c.run || "hand") < 0) return false;
  if (f.q && text(c).indexOf(f.q.toLowerCase()) < 0) return false;
  return true;
}
var SORTS = {fit:["Fit",function(c){ return -W.fit(c).score; }], stars:["Star rating",function(c){ return -(c.starRating || 3); }], median:["Median views",function(c){ return -c.median; }], trimmed:["Trimmed avg (HC-16)",function(c){ return -(c.trimmedAvgViews || c.median); }], subs:["Subscribers",function(c){ return -c.subs; }], found:["Recently found",function(c){ return -c.found; }], latest:["Latest upload",function(c){ return c.videos[0] ? c.videos[0].ago : 99; }]};
function results(){ var f = F(), x = X(); return W.D().creators.filter(function(c){ return passes(c, f); }).sort(W.by((SORTS[x.sort] || SORTS.fit)[1])); }
function activeCount(f){ return f.stages.length + f.signals.length + f.countries.length + (f.minMedian ? 1 : 0) + (f.maxMedian != null ? 1 : 0) + (f.minUp ? 1 : 0) + f.owners.length + f.runs.length + (f.q ? 1 : 0); }
function runLabel(id){ if (id === "hand") return "Added by hand"; var r = W.D().runs.filter(function(x){ return x.id === id; })[0]; return r ? (W.dayDiff(r.at) === 0 ? "Today's search" : W.fmtShort(r.at) + " · " + W.member(r.by).name) : id; }

/* ---------- actions ---------- */
W.A.kwStartHere = function(i){ var r = run(); W.act("Set today's search to resume at keyword " + (i + 1), function(d){ var rr = d.runs.filter(function(z){ return z.id === "r3"; })[0]; rr.cur = i; }, {toast:{msg:"Resumes at keyword " + (i + 1), sub:"\"" + r.kws[i].q + "\"", icon:"play", tone:"info"}}); };
W.A.kwRedo = function(i){ var q = run().kws[i].q; W.act("Queued \"" + q + "\" to search again", function(d){ var rr = d.runs.filter(function(z){ return z.id === "r3"; })[0], k = rr.kws.splice(i, 1)[0]; if (i < rr.cur) rr.cur--; rr.kws.push({q:k.q, st:"queued", found:0, kept:0}); }, {toast:{msg:"\"" + q + "\" goes again", sub:"Moved to the end of the list. Channels it already found stay.", icon:"refresh", tone:"info"}}); };
W.A.kwRemove = function(i){ var q = run().kws[i].q; W.act("Removed keyword \"" + q + "\"", function(d){ var rr = d.runs.filter(function(z){ return z.id === "r3"; })[0]; rr.kws.splice(i, 1); if (i < rr.cur) rr.cur--; }, {toast:{msg:"Removed \"" + q + "\"", icon:"trash", tone:"info"}}); };
W.A.kwAdd = function(list){
  var have = run().kws.map(function(k){ return k.q.toLowerCase(); }), add = [], dup = 0;
  list.map(function(s){ return s.trim().replace(/\s+/g, " "); }).filter(Boolean).forEach(function(s){ if (have.indexOf(s.toLowerCase()) >= 0 || add.some(function(a){ return a.toLowerCase() === s.toLowerCase(); })) dup++; else add.push(s); });
  if (!add.length){ W.toast({msg:"Nothing new to add", sub:dup ? W.plural(dup, "keyword was", "keywords were") + " already in the list." : "", icon:"info", tone:"info"}); return 0; }
  W.act("Added " + W.plural(add.length, "keyword"), function(d){ var rr = d.runs.filter(function(z){ return z.id === "r3"; })[0]; add.forEach(function(q){ rr.kws.push({q:q, st:"queued", found:0, kept:0}); }); },
    {toast:{msg:"Added " + W.plural(add.length, "keyword"), sub:dup ? dup + " " + (dup === 1 ? "was" : "were") + " already there, so skipped." : "They run after the ones already queued.", icon:"plus"}});
  return add.length;
};
W.A.setRules = function(r){ W.act("Changed the search rules", function(d){ Object.assign(d.rules, r); }, {toast:{msg:"Rules saved", sub:"They apply from the next keyword. Channels already kept stay.", icon:"sliders"}}); };
W.A.confirmMany = function(list){
  W.act("Confirmed " + W.plural(list.length, "address", "addresses"), function(d){
    list.forEach(function(it){
      var x = d.creators.filter(function(z){ return z.id === it.id; })[0]; if (!x) return;
      x.email = it.email; x.confirmed = true; x.finding = false; x.emailSrc = it.src; x.emailConf = it.conf; if (x.stage === "shortlisted") x.stage = "contact";
      d.drafts.forEach(function(q){ if (q.to.t === "creator" && q.to.id === x.id) q.gates = q.gates.filter(function(g){ return g.k !== "unconfirmed"; }); });
      if (!d.drafts.some(function(q){ return q.to.t === "creator" && q.to.id === x.id; })) d.drafts.push(W.makeFirst(x));
      W.A.markDone(d, "contact:" + x.id, "Confirmed " + x.name + "'s email", "contacts", 2);
    });
  }, {toast:{msg:"Confirmed " + W.plural(list.length, "address", "addresses"), sub:"First emails are drafted and waiting in Approve emails.", icon:"at", go:{label:"Review", run:function(){ W.go("today"); }}}});
};
W.A.assignMany = function(ids, to){ var m = W.member(to); W.act("Gave " + W.plural(ids.length, "channel") + " to " + m.name, function(d){ d.creators.forEach(function(c){ if (ids.indexOf(c.id) >= 0) c.owner = to; }); }, {toast:{msg:m.name + " has " + W.plural(ids.length, "channel") + " now", sub:"They show up in " + m.name + "'s lists.", icon:"forward", tone:"info"}}); };
/* ---------- header ---------- */
function RunStatus(){
  var r = run(), running = r.status === "running", failed = r.status === "failed", ready = r.status === "ready";
  return html`<div class="row wrap">
    <span class=${W.cx("tag", failed ? "crit" : null)} style=${{height:"30px", padding:"0 10px", gap:"7px"}}>${running ? html`<${Icon} n="refresh" cls="spin" />` : html`<${Icon} n=${r.status === "done" ? "checkc" : failed ? "alert" : ready ? "play" : "pause"} />`}
      ${running ? "Searching keyword " + (r.cur + 1) + " of " + r.kws.length : r.status === "done" ? "Today's search finished" : failed ? "Stopped at keyword " + (r.cur + 1) + ": " + (r.err || "an error") : ready ? "Ready: " + r.kws.length + " keywords" : "Paused at keyword " + (r.cur + 1) + " of " + r.kws.length}</span>
    ${running ? html`<${Btn} icon="pause" onClick=${function(){ W.A.pauseRun("r3"); }}>Pause</${Btn}>` : r.status !== "done" ? html`<${Btn} kind="pri" icon=${failed ? "refresh" : "play"} onClick=${function(){ W.A.startRun("r3"); }}>${ready ? "Start the search" : failed ? "Try again" : "Resume"}</${Btn}>${r.kws.length - r.cur > 4 ? html`<${Btn} size="sm" kind="ghost" icon="play" onClick=${function(){ W.A.startRun("r3", {all:true}); }}>Run all ${r.kws.length - r.cur}</${Btn}>` : null}` : null}
  </div>`;
}
W.SearchRules = function(){ return html`<${Rules} />`; };

/* ================= search console ================= */
var SUGGEST = ["claude code tutorial","ai agents for ecommerce","n8n ai automation","ai video editing workflow","best ai note taker 2026","ai tools for freelancers","local llm on mac","ai research assistant review"];
function Keywords(){
  var r = run(), x = X(), mate = W.D().mateRun, running = r.status === "running";
  var done = r.kws.filter(function(k){ return k.st === "done"; }).length;
  var have = r.kws.map(function(k){ return k.q.toLowerCase(); });
  var pick = x.genPick, nPick = SUGGEST.filter(function(s){ return pick[s] !== false && have.indexOf(s) < 0; }).length;
  function openGen(){ setX({gen:!x.gen, genBusy:!x.gen}); if (!x.gen) setTimeout(function(){ setX({genBusy:false}); }, 900); }
  return html`<div class="card" data-why="search">
    <div class="card-h"><h3>Keywords <span class="muted num" style=${{fontWeight:400}}>${r.kws.length} · ${done} done</span></h3>
      <${Btn} size="sm" icon="sparkle" onClick=${openGen} kind=${x.gen ? "pri" : null}>Suggest with Gemini</${Btn}></div>
    ${x.gen ? html`<div class="ai-read">
      ${x.genBusy ? html`<div class="row"><${Icon} n="refresh" cls="spin" /><span class="small">Gemini is reading your best keywords…</span></div>` : html`<${W.Fragment}>
        <div class="row"><${Icon} n="sparkle" /><b style=${{fontWeight:600}}>Suggested from your best keywords</b><span class="small muted">"best ai video editor 2026" kept 31%, the best so far</span></div>
        <div class="fchips">${SUGGEST.map(function(s){ var dup = have.indexOf(s) >= 0, on = !dup && pick[s] !== false; return html`<button key=${s} type="button" class="chip" aria-pressed=${String(on)} disabled=${dup} onClick=${function(){ setX(function(cur){ var p = Object.assign({}, cur.genPick); p[s] = !on; return {genPick:p}; }); }} data-tip=${dup ? "Already in your list" : null}>${on ? html`<${Icon} n="check" s=${12} />` : null}${s}</button>`; })}</div>
        <div class="row"><${Btn} size="sm" kind="pri" icon="plus" disabled=${!nPick} onClick=${function(){ W.A.kwAdd(SUGGEST.filter(function(s){ return pick[s] !== false && have.indexOf(s) < 0; })); setX({gen:false, genPick:{}}); }}>Add ${nPick} selected</${Btn}><${Btn} size="sm" kind="ghost" onClick=${function(){ setX({gen:false}); }}>Close</${Btn}></div>
      </${W.Fragment}>`}
    </div>` : null}
    <div class="kw-list" role="list">
      ${r.kws.map(function(k, i){
        var overlap = !!mate && mate.kws.indexOf(k.q) >= 0 && k.st !== "done";
        var cur = i === r.cur && k.st !== "done";
        return html`<div key=${k.q + i} class=${W.cx("kw", k.st, k.st === "running" ? "running" : null)} role="listitem">
          <span class="n">${i + 1}</span>
          <span class="col t2" style=${{minWidth:0}}><span class="q ell">${k.st === "done" ? html`<${Icon} n="check" s=${13} style=${{color:"var(--good)", verticalAlign:"-2px", marginInlineEnd:"5px"}} />` : null}${k.q}</span>
            ${overlap ? html`<span><${Tag} tone="warn" icon="users" tip="Overlapping keywords are skipped so nobody searches the same thing twice">${W.member(mate.by).name} is searching this · will be skipped</${Tag}></span>` : null}</span>
          <span class="acts">
            ${k.st === "done" ? html`<span class="yield" data-tip=${k.kept + " of " + k.found + " kept by your rules"}>${k.found} found · ${k.kept} kept <i><b style=${{width:(k.found ? 100 * k.kept / k.found : 0) + "%"}}></b></i></span>`
              : k.st === "running" ? html`<span class="yield"><${Icon} n="refresh" cls="spin" s=${13} />searching…</span>`
              : cur ? html`<span class="yield" style=${{color:"var(--find)"}}>next up</span>` : html`<span class="yield">queued</span>`}
            ${k.st === "queued" && !cur && !running ? html`<button type="button" class="btn ghost sm" onClick=${function(){ W.A.kwStartHere(i); }}>Start here</button>` : null}
            ${k.st === "done" ? html`<button type="button" class="btn ghost sm" onClick=${function(){ W.A.kwRedo(i); }}>Redo</button>` : null}
            ${k.st !== "running" ? html`<button type="button" class="btn ghost sm" aria-label=${"Remove " + k.q} data-tip="Remove" onClick=${function(){ W.A.kwRemove(i); }}><${Icon} n="x" s=${13} /></button>` : null}
          </span>
        </div>`; })}
    </div>
    <div class="col tight">
      <textarea class="ta" rows="3" placeholder="Paste keywords, one per line. Duplicates are skipped." value=${x.kw} onInput=${function(e){ setX({kw:e.target.value}); }} aria-label="New keywords"></textarea>
      <div class="row"><${Btn} size="sm" icon="plus" disabled=${!x.kw.trim()} onClick=${function(){ if (W.A.kwAdd(x.kw.split(/\n|,/)) >= 0) setX({kw:""}); }}>Add keywords</${Btn}><span class="hint">${x.kw.trim() ? W.plural(x.kw.split(/\n|,/).filter(function(s){ return s.trim(); }).length, "keyword") + " ready to add" : "Commas work too."}</span></div>
    </div>
  </div>`;
}
function Rules(){
  var d = W.D(), rl = d.rules, x = X();
  var st = useState(null), f = st[0] || {countries:rl.countries.slice(), minMedian:rl.minMedian, minUploads:rl.minUploads, perKeyword:rl.perKeyword, archiveDays:rl.archiveDays, excludeFemaleCouple:rl.excludeFemaleCouple !== false, excludeHaram:rl.excludeHaram !== false};
  function set(k, v){ var n = Object.assign({}, f); n[k] = v; st[1](n); }
  return html`<div class="card">
    <div class="card-h"><h3>Rules for every run</h3><${Btn} size="sm" icon=${x.rules ? "x" : "sliders"} kind="ghost" onClick=${function(){ setX({rules:!x.rules}); st[1](null); }}>${x.rules ? "Cancel" : "Edit rules"}</${Btn}></div>
    ${x.rules ? html`<div class="col" style=${{gap:"10px"}}>
        <div class="col tight"><span class="small ink2 b">Audience countries</span><div class="fchips">${["US","GB","CA","AU","IN","DE"].map(function(c){ var on = f.countries.indexOf(c) >= 0; return html`<button key=${c} type="button" class="chip" aria-pressed=${String(on)} onClick=${function(){ set("countries", toggleIn(f.countries, c)); }}>${c}</button>`; })}</div></div>
        <div class="grid2">
          <${W.Field} label="Keep: median views at least"><input class="inp num" inputMode="numeric" value=${f.minMedian} onInput=${function(e){ set("minMedian", +e.target.value.replace(/\D/g, "") || 0); }} /></${W.Field}>
          <${W.Field} label="Keep: uploads in 30 days at least"><input class="inp num" inputMode="numeric" value=${f.minUploads} onInput=${function(e){ set("minUploads", +e.target.value.replace(/\D/g, "") || 0); }} /></${W.Field}>
          <${W.Field} label="Channels per keyword"><input class="inp num" inputMode="numeric" value=${f.perKeyword} onInput=${function(e){ set("perKeyword", +e.target.value.replace(/\D/g, "") || 0); }} /></${W.Field}>
          <${W.Field} label="Archive rejects after (days)" hint="Bring any back before then."><input class="inp num" inputMode="numeric" value=${f.archiveDays} onInput=${function(e){ set("archiveDays", +e.target.value.replace(/\D/g, "") || 0); }} /></${W.Field}>
        </div>
        <div class="col tight"><span class="small ink2 b">Agency ethics & presenter rules (HC-08 / FND-ETH-06)</span>
          <div class="fchips">
            <button type="button" class="chip" aria-pressed=${String(!!f.excludeFemaleCouple)} onClick=${function(){ set("excludeFemaleCouple", !f.excludeFemaleCouple); }}>Male solo/duo presenters only (HC-08)</button>
            <button type="button" class="chip" aria-pressed=${String(!!f.excludeHaram)} onClick=${function(){ set("excludeHaram", !f.excludeHaram); }}>Exclude gambling/alcohol/adult (FND-ETH-06)</button>
          </div>
        </div>
        <div class="row"><${Btn} kind="pri" size="sm" icon="check" onClick=${function(){ W.A.setRules(f); setX({rules:false}); st[1](null); }}>Save rules</${Btn}><span class="hint">Apply from the next keyword.</span></div>
      </div>`
    : html`<div class="fchips">
        <${Tag} icon="globe">${rl.countries.join(" · ")}</${Tag}>
        <${Tag} tone="good" icon="check">Keep: ${W.fmtK(rl.minMedian)}+ median views</${Tag}>
        <${Tag} tone="good" icon="check">Keep: ${rl.minUploads}+ uploads in 30 days</${Tag}>
        ${rl.excludeFemaleCouple !== false ? html`<${Tag} icon="shield">HC-08: male solo/duo only</${Tag}>` : null}
        ${rl.excludeHaram !== false ? html`<${Tag} icon="shield">FND-ETH-06: ethics filter</${Tag}>` : null}
        <${Tag}>${rl.perKeyword} channels per keyword</${Tag}>
        <${Tag} icon="trash">Rejects archived after ${rl.archiveDays} days</${Tag}>
      </div><p class="hint">Channels that fail a rule are archived automatically and can be brought back from Toolbox › Archive.</p>`}
  </div>`;
}
function Live(){
  var r = run(), running = r.status === "running", logRef = useRef(null);
  useEffect(function(){ var el = logRef.current; if (el) el.scrollTop = el.scrollHeight; }, [r.log.length]);
  var k = r.kws[r.cur];
  return html`<div class="card">
    <div class="card-h"><h3 class="row" style=${{gap:"8px"}}>${running ? html`<${Icon} n="refresh" cls="spin" style=${{color:"var(--find)"}} />` : html`<${Icon} n=${r.status === "done" ? "checkc" : "pause"} style=${{color:"var(--muted)"}} />`}
      ${running ? "Searching \"" + (k ? k.q : "") + "\"" : r.status === "done" ? "Finished · everything found is saved" : r.status === "ready" ? "Not started yet · " + W.plural(r.kws.length, "keyword") + " queued" : r.status === "failed" ? "Stopped at keyword " + (r.cur + 1) + " · everything found is saved" : "Paused at keyword " + (r.cur + 1) + " · everything found is saved"}</h3><span class="num small muted">${Math.min(r.cur, r.kws.length)}/${r.kws.length}</span></div>
    <${W.Meter} v=${Math.min(r.cur, r.kws.length) + (running ? .5 : 0)} max=${r.kws.length} w=${"100%"} label="Keywords searched" />
    <div class="minis">
      <div class="mini-stat"><b>${r.found}</b><small>channels found</small></div>
      <div class="mini-stat"><b>${r.kept}</b><small>kept by your rules</small></div>
      <div class="mini-stat"><b>${r.archived}</b><small>archived by rules</small></div>
      <div class="mini-stat"><b>${W.fmtK(r.videos)}</b><small>videos read</small></div>
    </div>
    ${r.status === "failed" ? html`<${W.Callout} tone="crit">${r.err || "The search hit an error"}. YouTube's limit resets at midnight Pacific time; try again then, or now if a teammate's key has room.</${W.Callout}>` : null}
    <div class="log" ref=${logRef} role="log" aria-live="polite">${r.log.length ? r.log.map(function(l, i){ return html`<div key=${i}><span class="t">${W.fmtTime(l[0])}</span>  ${l[1]}</div>`; }) : html`<div class="faint">The log fills in as each keyword is searched.</div>`}</div>
    <div class="row wrap">
      ${running ? html`<${Btn} icon="pause" onClick=${function(){ W.A.pauseRun("r3"); }}>Pause</${Btn}><span class="hint">Pausing finishes the keyword in progress first.</span>`
        : r.status !== "done" ? html`<${Btn} kind="pri" icon=${r.status === "failed" ? "refresh" : "play"} onClick=${function(){ W.A.startRun("r3"); }}>${r.status === "ready" ? "Start the search" : r.status === "failed" ? "Try again from keyword " + (r.cur + 1) : "Resume at keyword " + (r.cur + 1)}</${Btn}>${r.kws.length - r.cur > 4 ? html`<${Btn} size="sm" kind="ghost" icon="play" onClick=${function(){ W.A.startRun("r3", {all:true}); }}>Run all ${r.kws.length - r.cur}</${Btn}>` : null}<span class="hint">Runs on this computer. You can leave this page; the tray keeps count.</span>` : null}
      <span class="sp"></span>
      <${Btn} size="sm" kind="ghost" icon="scan" onClick=${function(){ W.setTab("triage"); }}>Review what it kept</${Btn}>
    </div>
  </div>`;
}
function Mate(){
  var m = W.D().mateRun; if (!m) return null;
  var mine = run().kws.map(function(k){ return k.q; });
  return html`<div class="card tight">
    <div class="row"><${W.Av} id=${m.by} status="online" /><div class="grow col t2"><b style=${{fontWeight:500}}>${W.member(m.by).name} is searching</b><span class="small muted">Keyword ${m.cur} of ${m.total} · started ${W.fmtTime(m.at)}</span></div><${W.Meter} v=${m.cur} max=${m.total} w=${90} /></div>
    <div class="fchips">${m.kws.map(function(q){ var ov = mine.indexOf(q) >= 0; return html`<${Tag} key=${q} tone=${ov ? "warn" : null} icon=${ov ? "users" : null} tip=${ov ? "Also in your list: yours will be skipped" : null}>${q}</${Tag}>`; })}</div>
  </div>`;
}
function Runs(){
  var d = W.D();
  function review(r){ if (r.id === "r3"){ W.setTab("triage"); return; } setF(Object.assign({}, FIND_DEF, {runs:[r.id], stages:[]})); W.setTab("gallery"); }
  return html`<${W.Section} title="Runs" count=${d.runs.length} right=${html`<span class="hint">Every run ends with a link to what it kept.</span>`}>
    <div class="tw"><table class="tbl"><thead><tr><th>When</th><th>By</th><th class="n">Keywords</th><th class="n">Found</th><th class="n">Kept</th><th class="n">Gold mines</th><th></th></tr></thead><tbody>
      ${d.runs.map(function(r){ return html`<tr key=${r.id}><td>${W.dayDiff(r.at) === 0 ? "Today " + W.fmtTime(r.at) : W.fmtDate(r.at)}${r.status === "running" ? html` <${Tag} tone="info">running</${Tag}>` : r.status === "paused" ? html` <${Tag}>paused</${Tag}>` : r.status === "failed" ? html` <${Tag} tone="crit" icon="alert">stopped</${Tag}>` : r.status === "ready" ? html` <${Tag}>not started</${Tag}>` : null}</td>
        <td><span class="row" style=${{gap:"6px"}}><${W.Av} id=${r.by} size="s" tip=${false} />${W.member(r.by).name}</span></td>
        <td class="n">${r.kws.length || r.cur}</td><td class="n">${r.found}</td><td class="n">${r.kept}</td><td class="n">${r.gold}</td>
        <td style=${{textAlign:"end"}}><${Btn} size="sm" kind=${r.id === "r3" ? "pri" : null} icon="eye" onClick=${function(){ review(r); }}>Review results</${Btn}></td></tr>`; })}
    </tbody></table></div>
  </${W.Section}>`;
}
function Search(){
  return html`<${W.Fragment}>
    <div class="fd-grid"><${Keywords} /><div class="col"><${Live} /><${Rules} /><${Mate} /></div></div>
    <${Runs} />
  </${W.Fragment}>`;
}

/* ================= review new (triage) ================= */
function Triage(){
  var d = W.D(), list = d.creators.filter(function(c){ return c.stage === "new"; }).sort(function(a, b){ var ga = W.gold(a) ? 0 : 1, gb = W.gold(b) ? 0 : 1; return ga - gb || W.fit(b).score - W.fit(a).score; });
  var gold = list.filter(W.gold).length;
  return html`<${W.Fragment}>
    <div class="row wrap"><span class="ink2">${list.length ? html`<b class="num">${list.length}</b> new · <b class="num">${gold}</b> look like gold mines · gold mines first, then by fit` : "Nothing new to review."}</span><span class="sp"></span>
      ${list.length ? html`<${Btn} size="sm" icon="grid" onClick=${function(){ setF(Object.assign({}, FIND_DEF, {stages:["new"]})); W.setTab("gallery"); }}>See them as a gallery</${Btn}>` : null}</div>
    <div style=${{maxWidth:"980px"}}><${W.Triage} list=${list} /></div>
  </${W.Fragment}>`;
}

/* ================= gallery ================= */
function Facet(p){
  return html`<div class="facet"><h4>${p.title}</h4>${p.children}</div>`;
}
function Opt(p){
  return html`<button type="button" class="fopt" aria-pressed=${String(!!p.on)} onClick=${p.onClick} data-tip=${p.tip || null} disabled=${!p.on && p.n === 0}><span class="bx"><${Icon} n="check" s=${11} /></span><span class="ell">${p.label}</span><span class="c">${p.n}</span></button>`;
}
function Facets(){
  var d = W.D(), f = F(), cs = d.creators;
  function n(skip, test){ return cs.filter(function(c){ return passes(c, f, skip) && test(c); }).length; }
  var owners = d.team.map(function(m){ return [m.id, m.name]; }).concat([["none","Nobody"]]);
  var runs = d.runs.map(function(r){ return r.id; }).concat(["hand"]);
  return html`<aside class="facets" aria-label="Filters" data-why="gallery-facets">
    <${Facet} title="Stage">${STAGES.map(function(s){ var on = f.stages.indexOf(s) >= 0; return html`<${Opt} key=${s} on=${on} label=${W.STAGE_LABEL[s]} n=${n("stages", function(c){ return c.stage === s; })} onClick=${function(){ setF({stages:toggleIn(f.stages, s)}); }} />`; })}</${Facet}>
    <${Facet} title="Signals">${SIGNALS.map(function(s){ var on = f.signals.indexOf(s[0]) >= 0; return html`<${Opt} key=${s[0]} on=${on} label=${s[1]} tip=${s[3] || null} n=${n("signals", function(c){ return f.signals.filter(function(k){ return k !== s[0]; }).every(function(k){ return sig(k)[2](c); }) && s[2](c); })} onClick=${function(){ setF({signals:toggleIn(f.signals, s[0])}); }} />`; })}</${Facet}>
    <${Facet} title="In the top 3 countries"><div class="fchips">${COUNTRIES.concat(f.countries.filter(function(k){ return COUNTRIES.indexOf(k) < 0; })).map(function(k){ var on = f.countries.indexOf(k) >= 0; return html`<button key=${k} type="button" class="chip" aria-pressed=${String(on)} onClick=${function(){ setF({countries:toggleIn(f.countries, k)}); }} data-tip=${(W.COUNTRY[k] || k) + ": " + n("countries", function(c){ return c.countries.slice(0, 3).some(function(x){ return x[0] === k; }); }) + " channels"}>${k}</button>`; })}</div></${Facet}>
    <${Facet} title="Median views at least"><div class="fchips">${MEDIANS.map(function(m){ var on = (f.minMedian || 0) === m[0]; return html`<button key=${m[0]} type="button" class="chip" aria-pressed=${String(on)} onClick=${function(){ setF({minMedian:m[0]}); }}>${m[1]}</button>`; })}</div>
      ${f.maxMedian != null ? html`<span class="small muted">and at most ${W.fmtK(f.maxMedian)} <button type="button" class="btn ghost sm" onClick=${function(){ setF({maxMedian:null}); }}>Remove</button></span>` : null}</${Facet}>
    <${Facet} title="Uploads in 30 days"><div class="fchips">${UPLOADS.map(function(m){ var on = (f.minUp || 0) === m[0]; return html`<button key=${m[0]} type="button" class="chip" aria-pressed=${String(on)} onClick=${function(){ setF({minUp:m[0]}); }}>${m[1]}</button>`; })}</div></${Facet}>
    <${Facet} title="Who has it">${owners.map(function(o){ var on = f.owners.indexOf(o[0]) >= 0; return html`<${Opt} key=${o[0]} on=${on} label=${o[1]} n=${n("owners", function(c){ return (c.owner || "none") === o[0]; })} onClick=${function(){ setF({owners:toggleIn(f.owners, o[0])}); }} />`; })}</${Facet}>
    <${Facet} title="Found by">${runs.map(function(id){ var on = f.runs.indexOf(id) >= 0; return html`<${Opt} key=${id} on=${on} label=${runLabel(id)} n=${n("runs", function(c){ return (c.run || "hand") === id; })} onClick=${function(){ setF({runs:toggleIn(f.runs, id)}); }} />`; })}</${Facet}>
  </aside>`;
}
function ActiveChips(){
  var f = F(), x = X(), chips = [];
  f.stages.forEach(function(s){ chips.push([W.STAGE_LABEL[s], function(){ setF({stages:toggleIn(f.stages, s)}); }]); });
  f.signals.forEach(function(s){ if (sig(s)) chips.push([sig(s)[1], function(){ setF({signals:toggleIn(f.signals, s)}); }]); });
  if (f.countries.length) chips.push(["Top 3: " + f.countries.join(" or "), function(){ setF({countries:[]}); }]);
  if (f.minMedian) chips.push([W.fmtK(f.minMedian) + "+ median", function(){ setF({minMedian:0}); }]);
  if (f.maxMedian != null) chips.push(["Up to " + W.fmtK(f.maxMedian) + " median", function(){ setF({maxMedian:null}); }]);
  if (f.minUp) chips.push([f.minUp + "+ uploads", function(){ setF({minUp:0}); }]);
  f.owners.forEach(function(o){ chips.push([o === "none" ? "Nobody has it" : W.member(o).name + " has it", function(){ setF({owners:toggleIn(f.owners, o)}); }]); });
  f.runs.forEach(function(r){ chips.push([runLabel(r), function(){ setF({runs:toggleIn(f.runs, r)}); }]); });
  if (f.q) chips.push(["\"" + f.q + "\"", function(){ setF({q:""}); }]);
  var nameOk = x.viewName.trim().length > 0;
  return html`<div class="row wrap" style=${{gap:"6px"}}>
    ${chips.map(function(c, i){ return html`<button key=${i} type="button" class="chip" aria-pressed="true" onClick=${c[1]} aria-label=${"Remove filter " + c[0]}>${c[0]}<${Icon} n="x" s=${12} /></button>`; })}
    ${chips.length ? html`<button type="button" class="btn ghost sm" onClick=${function(){ setF(FIND_DEF); }}>Clear all</button>` : html`<span class="small muted">No filters. Rejected and never-contact channels are hidden.</span>`}
    <span class="sp"></span>
    <span class="small muted">Saved views</span>
    ${x.views.map(function(v, i){ var vf = Object.assign({}, FIND_DEF, v.f), match = JSON.stringify(vf) === JSON.stringify(f); return html`<span key=${i} class="view-chip"><button type="button" class="chip" aria-pressed=${String(match)} onClick=${function(){ setF(vf); W.toast({msg:"View: " + v.name, icon:"filter", tone:"info", ms:2000}); }}><${Icon} n="star" s=${12} />${v.name}</button>${i >= 4 ? html`<button type="button" class="iconbtn" style=${{width:"20px", height:"20px"}} aria-label=${"Delete view " + v.name} onClick=${function(){ setX(function(cur){ return {views:cur.views.filter(function(_, j){ return j !== i; })}; }); }}><${Icon} n="x" s=${11} /></button>` : null}</span>`; })}
    ${x.saving ? html`<span class="row" style=${{gap:"4px"}}><input class="inp sm" style=${{width:"150px"}} autoFocus=${true} placeholder="Name this view" value=${x.viewName} onInput=${function(e){ setX({viewName:e.target.value}); }} onKeyDown=${function(e){ if (e.key === "Enter" && nameOk){ setX(function(cur){ return {views:cur.views.concat([{name:cur.viewName.trim(), f:F()}]), saving:false, viewName:""}; }); W.toast({msg:"View saved", sub:"One click brings these filters back.", icon:"star", tone:"info"}); } if (e.key === "Escape") setX({saving:false}); }} aria-label="View name" /><${Btn} size="sm" disabled=${!nameOk} onClick=${function(){ setX(function(cur){ return {views:cur.views.concat([{name:cur.viewName.trim(), f:F()}]), saving:false, viewName:""}; }); }}>Save</${Btn}></span>`
      : chips.length ? html`<button type="button" class="btn ghost sm" onClick=${function(){ setX({saving:true}); }}><${Icon} n="plus" s=${13} />Save this view</button>` : null}
  </div>`;
}
function Card(p){
  var c = p.c, x = X(), hv = useState(0), vi = Math.min(hv[0], c.videos.length - 1), v = c.videos[vi] || c.videos[0];
  var sel = !!x.sel[c.id], top = c.countries[0];
  var hue = c.stage === "signed" ? "var(--close)" : ["emailed","replied","kit","contact"].indexOf(c.stage) >= 0 ? "var(--reach)" : c.stage === "rejected" || c.stage === "never" ? "var(--muted)" : "var(--find)";
  function move(e){ var r = e.currentTarget.getBoundingClientRect(), i = Math.floor(3 * (e.clientX - r.left) / Math.max(1, r.width)); if (i !== hv[0]) hv[1](W.clamp(i, 0, 2)); }
  return html`<div class=${W.cx("gcard", c.stage === "rejected" || c.stage === "never" ? "dim" : null)} aria-selected=${String(sel)} role="listitem" onClick=${function(e){ if (e.shiftKey || e.ctrlKey || e.metaKey){ p.onSel(e); return; } W.peek("creator", c.id, p.order); }}>
    ${x.pics ? html`<button type="button" class="gsel" aria-pressed=${String(sel)} aria-label=${(sel ? "Unselect " : "Select ") + c.name} onClick=${function(e){ e.stopPropagation(); p.onSel(e); }}><${Icon} n="check" s=${13} /></button>` : null}
    ${x.pics ? html`<div class="thumbwrap" onMouseMove=${move} onMouseLeave=${function(){ hv[1](0); }}>
        <${W.Thumb} v=${v} style=${{borderRadius:0}}>
          <span class="gstage"><${Tag} hue=${hue} cls="" >${W.STAGE_LABEL[c.stage]}</${Tag}></span>
          ${c.videos.length > 1 ? html`<span class="scrub" aria-hidden="true">${c.videos.slice(0, 3).map(function(_, i){ return html`<i key=${i} class=${i === vi ? "on" : null}></i>`; })}</span>` : null}
        </${W.Thumb}></div>` : null}
    <div class="gb">
      <div class="row" style=${{gap:"8px"}}>${!x.pics ? html`<button type="button" class="gsel" style=${{position:"static", opacity:1, flex:"none", background:sel ? "var(--accent)" : "var(--sunk-2)", borderColor:sel ? "var(--accent)" : "var(--line-2)", color:sel ? "var(--accent-ink)" : "transparent"}} aria-pressed=${String(sel)} aria-label=${(sel ? "Unselect " : "Select ") + c.name} onClick=${function(e){ e.stopPropagation(); p.onSel(e); }}><${Icon} n="check" s=${13} /></button>` : null}<${W.CAv} c=${c} size="s" /><span class="grow col t2" style=${{minWidth:0}}><span class="row" style=${{gap:"6px"}}><b class="ell" style=${{fontWeight:600, fontSize:"13.5px"}}>${c.name}</b><${W.Stars} n=${c.starRating || 3} /></span><span class="small muted ell">${c.handle} · ${W.fmtK(c.subs)}</span></span>${x.pics ? null : html`<${Tag} hue=${hue}>${W.STAGE_LABEL[c.stage]}</${Tag}>`}<${W.Fit} c=${c} /></div>
      ${x.latest && v ? html`<span class="gtitle" data-tip=${v.t}>${vi === 0 ? "Latest: " : "Video " + (vi + 1) + ": "}${v.t} · <span class="num">${W.fmtK(v.v)}</span> · ${v.ago === 0 ? "today" : v.ago + " d ago"}</span>` : null}
      <span class="gmeta"><span><b>${W.fmtK(c.median)}</b> median</span><span data-tip="Trimmed average views (HC-16)"><b>${W.fmtK(c.trimmedAvgViews || c.median)}</b> trimmed</span><span><b>${c.up30}</b> in 30 d</span>${top ? html`<span><b>${top[0]}</b> ${top[1]}%</span>` : null}</span>
      ${x.sig ? html`<div class="row wrap" style=${{gap:"4px"}}>
        ${W.gold(c) ? html`<${Tag} tone="good" icon="gem">Gold</${Tag}>` : null}
        ${c.viewStability === "volatile" ? html`<${Tag} tone="warn" tip="Spiky outlier views">Volatile</${Tag}>` : null}
        ${c.format && c.format !== "Long-form" ? html`<${Tag} tone="warn">${c.format}</${Tag}>` : null}
        ${c.sponsors.slice(0, 2).map(function(s){ return html`<button key=${s} type="button" class="tag" style=${{cursor:"pointer"}} data-tip=${"Click to add " + s + " to Close › Brands"} onClick=${function(e){ e.stopPropagation(); W.A.spotBrand(s, c.id); }}><${Icon} n="plus" s=${10} />${s}</button>`; })}${c.sponsors.length > 2 ? html`<${Tag}>+${c.sponsors.length - 2}</${Tag}>` : null}
        ${c.confirmed ? html`<${Tag} tone="good" icon="at">confirmed</${Tag}>` : c.email ? html`<${Tag} tone="warn" icon="at">email found</${Tag}>` : null}
        ${c.owner ? html`<${W.Av} id=${c.owner} size="s" />` : null}
      </div>` : null}
    </div>
  </div>`;
}
function Compare(p){
  var cs = p.list, n = cs.length;
  var rows = [
    ["Fit", function(c){ return W.fit(c).score; }, function(v){ return v + "/100"; }],
    ["Star rating", function(c){ return c.starRating || 3; }, function(v){ return v + " / 5★"; }],
    ["Subscribers", function(c){ return c.subs; }, W.fmtK],
    ["Median views", function(c){ return c.median; }, W.fmtK],
    ["Trimmed avg (HC-16)", function(c){ return c.trimmedAvgViews || c.median; }, W.fmtK],
    ["Uploads in 30 days", function(c){ return c.up30 > 20 ? -1 : c.up30; }, function(v, c){ return c.up30 + (c.up30 > 20 ? " (Shorts)" : ""); }],
    ["Engagement", function(c){ return c.eng || 0; }, function(v){ return v ? v + "%" : "?"; }],
    ["US/UK/CA/AU in top 3", function(c){ return W.usShare(c.countries); }, function(v){ return v + "%"; }],
    ["Sponsors seen", function(c){ return c.sponsors.length; }, function(v, c){ return c.sponsors.join(", ") || "none"; }]
  ];
  var cols = {gridTemplateColumns:"150px repeat(" + n + ", minmax(0,1fr))"};
  return html`<div class="card" data-why="compare">
    <div class="card-h"><h3>Comparing ${n} channels</h3><span class="hint">Best value in each row is green.</span><${W.IconBtn} icon="x" label="Close the comparison" onClick=${function(){ setX({compare:false}); }} /></div>
    <div style=${{overflowX:"auto"}}><div style=${{minWidth:(150 + n * 190) + "px"}}>
      <div class="cmp" style=${Object.assign({}, cols, {display:"grid"})}><span></span>${cs.map(function(c){ return html`<div key=${c.id} class="cc"><${W.Thumb} v=${c.videos[0]} /><b style=${{fontWeight:600}}>${c.name}</b><span class="small muted">${c.handle} · ${W.STAGE_LABEL[c.stage]}</span></div>`; })}</div>
      ${rows.map(function(r){ var vals = cs.map(r[1]), best = Math.max.apply(null, vals); return html`<div key=${r[0]} class="cmp-row" style=${cols}><span class="lbl">${r[0]}</span>${cs.map(function(c, i){ return html`<span key=${c.id} class=${vals[i] === best && n > 1 ? "best num" : "num"}>${r[2](vals[i], c)}</span>`; })}</div>`; })}
      <div class="cmp-row" style=${cols}><span class="lbl">Audience</span>${cs.map(function(c){ return html`<span key=${c.id}><${W.Countries} countries=${c.countries} /></span>`; })}</div>
      <div class="cmp-row" style=${cols}><span></span>${cs.map(function(c){ return html`<span key=${c.id} class="row wrap">${c.stage === "new" ? html`<${Btn} size="sm" kind="pri" icon="check" onClick=${function(){ W.A.shortlist([c.id]); }}>Shortlist</${Btn}>` : null}<${Btn} size="sm" kind="ghost" icon="eye" onClick=${function(){ W.peek("creator", c.id, cs.map(function(z){ return z.id; })); }}>Open</${Btn}></span>`; })}</div>
    </div></div>
  </div>`;
}
function Bulk(p){
  var ids = p.ids, cs = ids.map(W.creator).filter(Boolean), newOnes = cs.filter(function(c){ return c.stage === "new" || c.stage === "rejected"; });
  var rejOnes = cs.filter(function(c){ return c.stage === "new" || c.stage === "shortlisted" || c.stage === "contact"; });
  var reason = useState(W.REJECT_REASONS[0]);
  function clear(){ setX({sel:{}, compare:false}); }
  return html`<div class="bulkbar" role="toolbar" aria-label="Selected channels">
    <b>${ids.length} selected</b>
    <${Btn} size="sm" kind="pri" icon="check" disabled=${!newOnes.length} onClick=${function(){ W.A.shortlist(newOnes.map(function(c){ return c.id; })); clear(); }} tip=${newOnes.length ? "Shortlist the new ones" : "Only new or rejected channels can be shortlisted"}>Shortlist${newOnes.length !== ids.length && newOnes.length ? " " + newOnes.length : ""}</${Btn}>
    <span class="btn-split"><${Btn} size="sm" icon="x" disabled=${!rejOnes.length} tip=${rejOnes.length < ids.length ? "Signed and active sequence channels are protected from bulk reject" : "Reject selected channels"} onClick=${function(){ W.A.reject(rejOnes.map(function(c){ return c.id; }), reason[0]); clear(); }}>Reject${rejOnes.length !== ids.length && rejOnes.length ? " " + rejOnes.length : ""}</${Btn}>
      <select class="btn sm" style=${{maxWidth:"180px", background:"transparent", color:"inherit"}} value=${reason[0]} onChange=${function(e){ reason[1](e.target.value); }} aria-label="Reject reason">${W.REJECT_REASONS.map(function(r){ return html`<option key=${r} value=${r}>${r}</option>`; })}</select></span>
    <${Btn} size="sm" icon="forward" onClick=${function(e){ W.menu(e, [{head:"Give them to"}].concat(W.D().team.map(function(m){ return {label:m.name, hint:m.role, icon:"user", run:function(){ W.A.assignMany(ids, m.id); }}; })), {align:"start"}); }}>Give to…</${Btn}>
    <${Btn} size="sm" icon="compare" disabled=${ids.length < 2 || ids.length > 4} onClick=${function(){ setX({compare:true}); var c = document.querySelector(".content"); if (c) c.scrollTo({top:0, behavior:"smooth"}); }} tip=${ids.length < 2 ? "Pick 2 to 4" : ids.length > 4 ? "Compare takes up to 4" : "Side by side"}>Compare</${Btn}>
    <${Btn} size="sm" kind="ghost" onClick=${clear} tip="Clear the selection" kbd="Esc">Clear</${Btn}>
  </div>`;
}
function Table(p){
  var x = X(), list = p.list;
  function th(k, label, n){ var on = x.sort === k; return html`<th class=${n ? "n" : null}>${k ? html`<button type="button" class="btn ghost sm" style=${{padding:"0 4px", height:"22px", font:"inherit", color:on ? "var(--ink)" : "inherit"}} onClick=${function(){ setX({sort:k}); }} aria-pressed=${String(on)}>${label}${on ? html`<${Icon} n="chevD" s=${12} />` : null}</button>` : label}</th>`; }
  return html`<div class="tw"><table class="tbl"><thead><tr><th><span class="sr">Select</span></th>${th(null, "Channel")}${th("stars", "Stars")}${th(null, "Stage")}${th("fit", "Fit", 1)}${th("median", "Median", 1)}${th("trimmed", "Trimmed (HC-16)", 1)}${th("subs", "Subs", 1)}${th("latest", "Latest", 1)}<th>Top country</th><th>Email</th></tr></thead><tbody>
    ${list.map(function(c){ var sel = !!x.sel[c.id], top = c.countries[0]; return html`<tr key=${c.id} class="click" aria-selected=${String(sel)} onClick=${function(e){ if (e.shiftKey){ p.onSel(c, e); return; } W.peek("creator", c.id, p.order); }}>
      <td onClick=${function(e){ e.stopPropagation(); }}><input type="checkbox" checked=${sel} onChange=${function(e){ p.onSel(c, e); }} aria-label=${"Select " + c.name} /></td>
      <td><span class="row" style=${{gap:"8px"}}><${W.CAv} c=${c} size="s" /><span class="col t2"><b style=${{fontWeight:500}}>${c.name}</b><span class="small muted">${c.handle} · ${c.format || "Long-form"}</span></span></span></td>
      <td><${W.Stars} n=${c.starRating || 3} onPick=${function(n){ W.A.setCreatorStars(c.id, n); }} /></td>
      <td><${Tag}>${W.STAGE_LABEL[c.stage]}</${Tag}></td><td class="n"><${W.Fit} c=${c} /></td><td class="n">${W.fmtK(c.median)}</td><td class="n">${W.fmtK(c.trimmedAvgViews || c.median)}</td><td class="n">${W.fmtK(c.subs)}</td><td class="n">${c.videos[0] ? c.videos[0].ago + " d" : "–"}</td>
      <td>${top ? top[0] + " " + top[1] + "%" : "–"}</td><td>${c.confirmed ? html`<${Tag} tone="good">confirmed</${Tag}>` : c.email ? html`<${Tag} tone="warn">found</${Tag}>` : html`<span class="muted">none</span>`}</td></tr>`; })}
  </tbody></table></div>`;
}
function Gallery(){
  var x = X(), f = F(), list = results(), order = list.map(function(c){ return c.id; });
  var selIds = Object.keys(x.sel).filter(function(k){ return x.sel[k] && W.creator(k); });
  var cw = {s:"210px", m:"260px", l:"330px"}[x.size];
  function onSel(id, e){
    setX(function(cur){
      var s = Object.assign({}, cur.sel);
      if (e && e.shiftKey && cur.last && order.indexOf(cur.last) >= 0){ var a = order.indexOf(cur.last), b = order.indexOf(id); for (var i = Math.min(a, b); i <= Math.max(a, b); i++) s[order[i]] = true; }
      else s[id] = !s[id];
      return {sel:s, last:id};
    });
  }
  W.useKeys({
    escape:function(){ if (selIds.length){ setX({sel:{}, compare:false}); return true; } return false; },
    "mod+a":function(e){ if (W.typing(e.target)) return false; var s = {}; order.forEach(function(id){ s[id] = true; }); setX({sel:s}); }
  });
  var cmp = x.compare && selIds.length >= 2 && selIds.length <= 4 ? selIds.map(W.creator) : null;
  return html`<div class="gal-wrap">
    <div>
      <button type="button" class="btn sm only-narrow" style=${{marginBottom:"10px", width:"100%"}} onClick=${function(){ setX({facetsOpen:!x.facetsOpen}); }}><${Icon} n="filter" />${x.facetsOpen ? "Hide filters" : "Filters" + (activeCount(f) ? " (" + activeCount(f) + ")" : "")}</button>
      <div class=${x.facetsOpen ? "" : "hide-narrow"}><${Facets} /></div>
    </div>
    <div class="col" style=${{minWidth:0}}>
      <div class="card tight">
        <div class="row wrap">
          <span class="row grow" style=${{minWidth:"200px", gap:"6px", border:"1px solid var(--line-2)", borderRadius:"var(--r-s)", padding:"0 8px", height:"34px", background:"var(--panel)"}}><${Icon} n="search" style=${{color:"var(--muted)"}} /><input style=${{border:0, outline:"none", background:"none", flex:1, minWidth:0}} placeholder="Name, handle, video title or sponsor" value=${f.q} onInput=${function(e){ setF({q:e.target.value}); }} aria-label="Filter channels" />${f.q ? html`<button type="button" class="iconbtn" style=${{width:"24px", height:"24px"}} onClick=${function(){ setF({q:""}); }} aria-label="Clear"><${Icon} n="x" s=${13} /></button>` : null}</span>
          <label class="row small muted" style=${{gap:"6px"}}>Sort<select class="sel sm" style=${{width:"auto"}} value=${x.sort} onChange=${function(e){ setX({sort:e.target.value}); }}>${Object.keys(SORTS).map(function(k){ return html`<option key=${k} value=${k}>${SORTS[k][0]}</option>`; })}</select></label>
          <${W.Seg} label="View" cur=${x.view} onPick=${function(v){ setX({view:v}); }} opts=${[["gallery","Gallery","grid"],["table","Table","list"]]} />
          ${x.view === "gallery" ? html`<${W.Seg} label="Card size" cur=${x.size} onPick=${function(v){ setX({size:v}); }} opts=${[["s","S",null,"Small cards"],["m","M",null,"Medium cards"],["l","L",null,"Large cards"]]} />` : null}
        </div>
        ${x.view === "gallery" ? html`<div class="row wrap" style=${{gap:"6px"}}><span class="small muted">Show</span>
          ${[["pics","Pictures"],["latest","Latest video"],["sig","Signals"]].map(function(t){ return html`<button key=${t[0]} type="button" class="chip" aria-pressed=${String(!!x[t[0]])} onClick=${function(){ var o = {}; o[t[0]] = !x[t[0]]; setX(o); }}>${x[t[0]] ? html`<${Icon} n="check" s=${12} />` : null}${t[1]}</button>`; })}
          <span class="sp"></span><span class="hint">Hover a picture to flip through the last 3 videos · Shift-click to select a range</span></div>` : null}
        <${ActiveChips} />
      </div>
      ${cmp ? html`<${Compare} list=${cmp} />` : null}
      <div class="row"><span class="small ink2"><b class="num">${list.length}</b> ${list.length === 1 ? "channel" : "channels"}</span>
        ${list.length ? html`<button type="button" class="btn ghost sm" onClick=${function(){ var s = {}; order.forEach(function(id){ s[id] = true; }); setX({sel:s}); }}>Select all ${list.length}</button>` : null}
        ${selIds.length ? html`<button type="button" class="btn ghost sm" onClick=${function(){ setX({sel:{}, compare:false}); }}>Clear selection</button>` : null}</div>
      ${!list.length ? html`<div class="card"><${W.Empty} icon="filter" title="No channel matches these filters">Loosen one of them, or clear them all.</${W.Empty}><div class="row" style=${{justifyContent:"center"}}><${Btn} onClick=${function(){ setF(FIND_DEF); }}>Clear filters</${Btn}></div></div>`
        : x.view === "table" ? html`<${Table} list=${list} order=${order} onSel=${function(c, e){ onSel(c.id, e); }} />`
        : html`<div class=${W.cx("gal", selIds.length ? "selecting" : null)} style=${{"--card-w":cw}} role="list" data-why="gallery">${list.map(function(c){ return html`<${Card} key=${c.id} c=${c} order=${order} onSel=${function(e){ onSel(c.id, e); }} />`; })}</div>`}
      ${selIds.length ? html`<${Bulk} ids=${selIds} />` : null}
    </div>
  </div>`;
}

/* ================= contacts ================= */
function Contacts(){
  var d = W.D(), list = d.creators.filter(function(c){ return c.stage === "shortlisted"; }).sort(W.by(function(c){ return c.finding ? 1 : 0; }));
  var sure = list.filter(function(c){ return !c.finding && (c.cands || []).some(function(k){ return k.conf >= .9; }); }).map(function(c){ var k = c.cands.slice().sort(W.by(function(z){ return z.conf; }, -1))[0]; return {id:c.id, email:k.email, src:k.src, conf:k.conf}; });
  if (!list.length) return html`<div class="card"><${W.Empty} icon="at" title="Everyone shortlisted has a confirmed address">Shortlist channels in Review new; their emails are looked up in the background and land here.</${W.Empty}><div class="row" style=${{justifyContent:"center"}}><${Btn} icon="scan" onClick=${function(){ W.setTab("triage"); }}>Review new finds</${Btn}></div></div>`;
  return html`<div class="col" data-why="contacts">
    <div class="row wrap"><span class="ink2"><b class="num">${list.length}</b> shortlisted ${list.length === 1 ? "channel needs" : "channels need"} a confirmed address before the first email.</span><span class="sp"></span>
      ${sure.length ? html`<${Btn} kind="pri" icon="check" onClick=${function(){ W.A.confirmMany(sure); }} tip=${sure.map(function(s){ return s.email; }).join(", ")}>Confirm all 90%+ addresses (${sure.length})</${Btn}>` : null}</div>
    <div class="grid2" style=${{alignItems:"start"}}>${list.map(function(c){ return html`<div key=${c.id} class="card">
      <div class="row"><${W.CAv} c=${c} /><div class="grow col t2"><b style=${{fontWeight:600}}>${c.name}</b><span class="small muted">${c.handle} · ${W.fmtK(c.subs)} subscribers · ${W.fmtK(c.median)} median</span></div><${W.Fit} c=${c} /><${Btn} size="sm" kind="ghost" icon="eye" onClick=${function(){ W.peek("creator", c.id, list.map(function(z){ return z.id; })); }}>Open</${Btn}></div>
      <span class="small ink2">${c.finding ? "Looking for an address now." : c.cands && c.cands.length ? W.plural(c.cands.length, "address", "addresses") + " found. Pick the one a person checked." : "Nothing found on the About page, video descriptions or linked sites."}</span>
      <${W.ContactBlock} c=${c} />
    </div>`; })}</div>
  </div>`;
}

/* ================= the screen ================= */
W.screens.find = function(){
  var st = W.useApp(), u = st.ui, d = st.data, tab = u.route.tab || "search";
  var nNew = d.creators.filter(function(c){ return c.stage === "new"; }).length, nContact = d.creators.filter(function(c){ return c.stage === "shortlisted"; }).length;
  var baseTabs = W.SCREENS.find.tabs;
  var tabs = baseTabs.map(function(t){ return [t[0], t[1], t[0] === "triage" ? nNew || null : t[0] === "contacts" ? nContact || null : null]; });
  return html`<div class="page">
    <${W.PageHead} title="Find creators" sub="Search YouTube for AI channels, review what your rules kept, and confirm a contact." right=${html`<${RunStatus} />`} />
    <${W.Tabs} tabs=${tabs} cur=${tab} hue="var(--find)" onPick=${W.setTab} />
    ${tab === "search" ? html`<${Search} />` : tab === "triage" ? html`<${Triage} />` : tab === "gallery" ? html`<${Gallery} />` : html`<${Contacts} />`}
  </div>`;
};
})();
