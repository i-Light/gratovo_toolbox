/* app.js — the frame around the work: rail, top bar, peek panel, command palette, menus, tooltips, toasts,
   trays, shortcut sheet, hand-off note, global keys and the mount. */
(function(){
"use strict";
var W = window.W, html = W.html, Icon = W.Icon, useState = W.useState, useEffect = W.useEffect, useRef = W.useRef, useLayoutEffect = W.useLayoutEffect;
var Btn = W.Btn;

var SCREENS = {
  today:{name:"Today", icon:"sun", hue:"var(--accent)"},
  find:{name:"Find", icon:"scan", hue:"var(--find)", sub:"Search, triage, contacts", tabs:[["search","Search"],["triage","Review new"],["gallery","Gallery"],["contacts","Contacts"]]},
  reach:{name:"Reach", icon:"send", hue:"var(--reach)", sub:"Emails, replies, sequences", tabs:[["board","Board"],["sequences","Sequences"],["inbox","Replies"],["mailboxes","Mailboxes"]]},
  close:{name:"Close", icon:"pen", hue:"var(--close)", sub:"Audience, brands, pitch, terms", tabs:[["roster","Roster"],["brands","Brands"],["match","Match"],["pitch","Pitch"],["negotiate","Negotiate"],["contracts","Contracts"]]},
  deliver:{name:"Deliver", icon:"box", hue:"var(--deliver)", sub:"Deals and money", tabs:[["board","Deal board"],["money","Money"]]},
  insights:{name:"Insights", icon:"chart", hue:"var(--ink-2)", sub:"Analytics, keywords, funnel"},
  toolbox:{name:"Toolbox", icon:"wrench", hue:"var(--ink-2)", sub:"Calculator, archive, logs, setup"},
  team:{name:"Team", icon:"users", hue:"var(--ink-2)", sub:"People, load, mailboxes"},
  plan:{name:"The plan", icon:"map", hue:"var(--close)", sub:"Why every part is here"},
  settings:{name:"Settings", icon:"gear", hue:"var(--ink-2)", sub:"You, this computer, the agency", tabs:W.SETTINGS_SECTIONS.map(function(x){ return [x.k, x.name]; })},
  rec:{name:"Record", icon:"user", hue:"var(--ink-2)"}
};
W.SCREENS = SCREENS;

/* ---------- rail ---------- */
function Rail(p){
  var u = W.U(), d = W.D(), r = u.route, items = p.items, c = W.phaseCounts(items);
  var me = W.member(d.me), meName = me.name, named = d.me !== "u1" || !!W.myName(), viewing = W.protoOn() && d.me !== "u1";
  var planned = W.sum(items, function(i){ return i.est; });
  var prev = useRef({});
  function nav(k, label, sub, count, hot){
    var s = SCREENS[k], bump = prev.current[k] !== undefined && prev.current[k] !== count;
    prev.current[k] = count;
    return html`<button key=${k} type="button" class="nav" style=${{"--hue":s.hue}} aria-current=${r.s === k || (r.s === "rec" && r.from === k) ? "page" : null} onClick=${function(){ W.go(k, s.tabs ? (u.lastTab || {})[k] || s.tabs[0][0] : null); }} data-tip=${u.railMin ? label : null}>
      <span class="nic"><${Icon} n=${s.icon} /></span>
      <span class="nl"><b>${label}</b>${sub ? html`<small>${sub}</small>` : null}</span>
      ${count ? html`<span key=${k + count} class=${W.cx("cnt", hot ? "hot" : null, bump ? "bump" : null)}>${count}</span>` : null}
      ${count ? html`<i class="cnt-dot"></i>` : null}
    </button>`;
  }
  return html`<nav class="rail" aria-label="Main" data-why="rail">
    <div class="brand"><span class="logo" aria-hidden="true"></span><div><b>Gratovo</b><small>Workbench</small></div></div>
    ${nav("today", "Today", items.length ? W.dur(planned) + " planned" : "All clear", items.length, true)}
    <div class="nav-h">Pipeline</div>
    ${nav("find", "Find", SCREENS.find.sub, c.find)}
    ${nav("reach", "Reach", SCREENS.reach.sub, c.reach)}
    ${nav("close", "Close", SCREENS.close.sub, c.close)}
    ${nav("deliver", "Deliver", SCREENS.deliver.sub, c.deliver)}
    <div class="nav-h">Workbench</div>
    ${nav("insights", "Insights", SCREENS.insights.sub)}
    ${nav("toolbox", "Toolbox", SCREENS.toolbox.sub)}
    ${nav("team", "Team", SCREENS.team.sub)}
    <span class="sp"></span>
    ${nav("plan", "The plan", SCREENS.plan.sub)}
    <div class="rail-foot">
      <button type="button" class="me" data-why="account" onClick=${accountMenu} aria-haspopup="menu" aria-current=${r.s === "settings" ? "page" : null} aria-label=${"Your account: " + meName} data-tip=${u.railMin ? meName + " · " + me.role : null}>
        <${W.Av} id=${me.id} status=${me.status === "away" ? "away" : "online"} tip=${false} />
        <span class="nl"><b>${named ? meName : "Add your name"}</b><small>${me.role}${viewing ? " · viewing as" : " · online"}</small></span>
        <${Icon} n="chevU" s=${14} cls="me-chev" />
      </button>
      <button type="button" class="iconbtn rail-tog hide-narrow" onClick=${function(){ W.pref.set("rail", u.railMin ? "" : "min"); }} aria-label=${u.railMin ? "Expand the sidebar" : "Collapse the sidebar"} data-tip=${u.railMin ? "Expand" : "Collapse"} data-kbd="["><${Icon} n="sidebar" /></button>
    </div>
  </nav>`;
}
/* the account menu: who you are, settings, and the few things people reach for from their own picture */
function accountMenu(e){
  var d = W.D(), me = W.member(d.me), th = W.pref.get("theme");
  W.menu(e, [{who:me, unnamed:d.me === "u1" && !W.myName(), run:function(){ W.openSetting("profile", "name"); }},
    {label:"Settings", icon:"gear", hint:"Ctrl ,", run:function(){ W.go("settings", "profile"); }},
    {label:"Appearance", icon:"moon", hint:th === "dark" ? "Dark" : th === "light" ? "Light" : "System", run:function(){ W.go("settings", "appearance"); }},
    {label:"Keyboard shortcuts", icon:"keyboard", hint:"?", run:function(){ W.ui(function(uu){ uu.shortcuts = true; }); }},
    {sep:true},
    {label:"Notifications", icon:"bell", run:function(){ W.go("settings", "notifications"); }},
    {label:"Connections", icon:"gauge", run:function(){ W.go("settings", "connections"); }}]);
}

/* ---------- top bar ---------- */
function Top(){
  var u = W.U(), d = W.D(), r = u.route, s = SCREENS[r.s] || SCREENS.today;
  var unread = d.notifs.filter(function(n){ return !n.read && W.notifShown(n); }).length;
  var jobs = u.jobs.filter(function(j){ return !j.done; });
  var crumbs = [s.name];
  if (r.s === "rec" && r.rec){ crumbs = [SCREENS[r.from] ? SCREENS[r.from].name : "Records", W.refName(r.rec)]; }
  else if (s.tabs && r.tab){ var t = s.tabs.filter(function(x){ return x[0] === r.tab; })[0]; if (t) crumbs.push(t[1]); }
  var online = d.team.filter(function(m){ return m.status === "online" && m.id !== d.me; });
  var jobPct = jobs.length ? (jobs[0].progress || 0) / (jobs[0].total || 1) : 0;
  return html`<header class="top">
    <button type="button" class="iconbtn only-narrow" onClick=${function(){ W.ui(function(uu){ uu.railOpen = !uu.railOpen; }); }} aria-label="Menu"><${Icon} n="sidebar" /></button>
    <div class="row hide-narrow" style=${{gap:"2px"}}>
      <${W.IconBtn} icon="chevL" iconCls="flip" label="Back" kbd="Alt ←" disabled=${u.histI <= 0} onClick=${W.back} />
      <${W.IconBtn} icon="chevR" iconCls="flip" label="Forward" kbd="Alt →" disabled=${u.histI >= u.hist.length - 1} onClick=${W.fwd} />
    </div>
    <nav class="crumbs hide-narrow" aria-label="You are here">${crumbs.map(function(c, i){ return i === crumbs.length - 1 ? html`<b key=${i}>${c}</b>` : html`<span key=${i} class="row" style=${{gap:"6px"}}>${c}<${Icon} n="chevR" s=${12} cls="flip" /></span>`; })}</nav>
    <button type="button" class="cmdk" onClick=${function(){ W.ui(function(uu){ uu.palette = true; }); }} data-why="cmdk"><${Icon} n="search" /><span class="grow">Search or run a command</span><span class="kbd">Ctrl K</span></button>
    <div class="row" style=${{gap:"2px"}}>
      <button type="button" class="iconbtn" aria-label=${jobs.length ? jobs[0].label : "Background jobs"} data-tip=${jobs.length ? jobs[0].label : "Background jobs: none running"} aria-pressed=${String(u.tray === "jobs")} onClick=${function(){ W.ui(function(uu){ uu.tray = uu.tray === "jobs" ? null : "jobs"; }); }} data-why="jobs">
        ${jobs.length ? html`<svg class="ring-prog" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5" fill="none" stroke="var(--sunk-2)" stroke-width="2.5"/><circle cx="10" cy="10" r="7.5" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-dasharray="47.1" stroke-dashoffset=${47.1 * (1 - Math.max(.08, jobPct))} stroke-linecap="round"/></svg>` : html`<${Icon} n="layers" s=${17} />`}
        ${jobs.length ? html`<span class="badge" style=${{background:"var(--accent)"}}>${jobs.length}</span>` : null}
      </button>
      <${W.IconBtn} icon="bell" label="Notifications" badge=${unread || null} pressed=${u.tray === "notifs"} onClick=${function(){ W.ui(function(uu){ uu.tray = uu.tray === "notifs" ? null : "notifs"; }); }} />
      ${W.protoOn() ? html`<${ProtoControls} />` : null}
      <${W.IconBtn} icon="map" label="Why is this here? Show the design notes" pressed=${!!u.why} onClick=${function(){ W.ui(function(uu){ uu.why = !uu.why; uu.whyOpen = null; }); }} />
      <span class=${W.cx("save", u.saving ? "busy" : null, "hide-narrow")} role="status" data-why="save" data-tip=${u.saving ? "Saving to this computer, then syncing to the team" : "Saved on this computer and synced " + W.ago(u.savedAt)}><i></i>${u.saving ? "Saving…" : "Saved"}</span>
      <span class="avs hide-narrow" style=${{marginInlineStart:"6px"}}>${online.map(function(m){ return html`<${W.Av} key=${m.id} id=${m.id} size="s" status="online" />`; })}</span>
    </div>
  </header>`;
}

/* ---------- prototype controls: drawn only while prototype mode is on ---------- */
function ProtoControls(){
  var u = W.U(), d = W.D(), pr = u.proto, sc = W.SCENARIOS.filter(function(s){ return s.k === pr.scenario; })[0] || W.SCENARIOS[0];
  var openN = W.CM.list.filter(function(c){ return c.status !== "done"; }).length;
  function menu(e){
    W.menu(e, [{head:"Example data"}].concat(W.SCENARIOS.map(function(s){ return {label:s.name, icon:s.icon, checked:s.k === pr.scenario, run:function(){ if (s.k !== pr.scenario) W.setScenario(s.k); }}; }),
      [{sep:true}, {head:"See the app as"}], d.team.map(function(m){ return {label:m.id === "u1" ? "You" : m.name, hint:m.role, icon:"user", checked:m.id === d.me, run:function(){ if (m.id !== d.me) W.setViewAs(m.id); }}; }),
      [{sep:true}, {label:"Comment on something", icon:"chat", hint:"C", run:function(){ W.toggleCommentMode(true); }},
       {label:"All comments", icon:"list", hint:openN ? openN + " open" : null, run:function(){ W.ui(function(uu){ uu.proto = Object.assign({}, uu.proto, {panel:true}); }); }},
       {label:"Prototype settings", icon:"gear", run:function(){ W.go("settings", "prototype"); }},
       {label:"Turn prototype mode off", icon:"x", run:function(){ W.setProto(false); }}]), {align:"end"});
  }
  return html`<span class="row" style=${{gap:"2px"}} data-cmt-ui="1">
    <button type="button" class="proto-chip" data-why="proto" onClick=${menu} aria-haspopup="menu" data-tip="Prototype mode: an example copy, nothing is sent"><${Icon} n="flask" s=${15} /><span class="hide-narrow">${sc.short}</span><${Icon} n="chevD" s=${13} /></button>
    <${W.IconBtn} icon="chat" cls="hide-narrow" label="Comment on something" kbd="C" pressed=${!!pr.mode} badge=${openN || null} onClick=${function(){ W.toggleCommentMode(); }} />
  </span>`;
}
function ViewAsBar(){
  var d = W.D(), m = W.member(d.me), money = W.canSeeMoney();
  return html`<div class="sysbar info" role="status"><${Icon} n="eye" /><span class="grow"><b style=${{fontWeight:600}}>Seeing the app as ${m.name}</b> · ${m.role}. Their Today list${money ? "" : "; money is hidden, as their role hides it"}.</span>
    <button type="button" class="btn sm" onClick=${function(){ W.setViewAs("u1"); }}>Back to you</button></div>`;
}
/* problems: something behind the app is broken. Shown on every screen until it is fixed, never dismissed into silence */
function SysBar(){
  var ps = W.problems(), open = useState(false);
  if (!ps.length) return null;
  var p = ps[0];
  return html`<div class="sysbar crit" role="alert" data-why="problems"><${Icon} n="alert" />
    <span class="grow"><b style=${{fontWeight:600}}>${p.text}</b> <span class="hide-narrow">${p.sub}</span>${ps.length > 1 ? html` <button type="button" class="linkbtn" onClick=${function(){ open[1](!open[0]); }}>${open[0] ? "Hide" : "+" + (ps.length - 1) + " more"}</button>` : null}
      ${open[0] ? html`<span class="sys-more">${ps.slice(1).map(function(x){ return html`<span key=${x.k} class="row wrap" style=${{gap:"8px"}}><span>${x.text}</span>${x.act ? html`<button type="button" class="linkbtn" onClick=${x.act.run}>${x.act.label}</button>` : null}</span>`; })}</span>` : null}</span>
    ${p.act ? html`<button type="button" class="btn sm" onClick=${p.act.run}>${p.act.label}</button>` : null}
  </div>`;
}

/* ---------- trays ---------- */
function Tray(){
  var u = W.U(), d = W.D(), ref = useRef(null);
  useEffect(function(){ function off(e){ if (ref.current && !ref.current.contains(e.target) && !e.target.closest(".top")) W.ui(function(uu){ uu.tray = null; }); } document.addEventListener("mousedown", off); return function(){ document.removeEventListener("mousedown", off); }; }, []);
  if (u.tray === "jobs"){
    var jobs = u.jobs, mate = d.mateRun;
    var mateRow = mate ? html`<${W.Fragment}><hr class="divider" /><div class="tray-i"><${W.Av} id=${mate.by} size="s" status="online" /><div class="tx">${W.member(mate.by).name} is searching · keyword ${mate.cur} of ${mate.total}<small>Started ${W.fmtTime(mate.at)}. Keywords that overlap yours are skipped automatically.</small></div></div></${W.Fragment}>` : null;
    return html`<div class="tray" ref=${ref} role="dialog" aria-label="Background jobs">
      <div class="row" style=${{padding:"6px 8px"}}><h4 class="grow">Running in the background</h4><span class="hint">Keep working; you'll get a note when each finishes.</span></div>
      ${jobs.length ? jobs.map(function(j){ return html`<div key=${j.id} class="tray-i"><${Icon} n=${j.done ? "checkc" : j.kind === "search" ? "scan" : "at"} cls=${j.done ? null : null} /><div class="tx">${j.label}<small>${j.done ? "Finished" : j.kind === "search" ? "Keyword " + ((j.progress || 0) + 1) + " of " + j.total : "Checking About pages, descriptions and linked sites"}</small>${j.done ? null : html`<${W.Meter} v=${(j.progress || 0) + .3} max=${j.total || 3} w=${"100%"} />`}</div></div>`; }) : html`<p class="hint" style=${{padding:"6px 9px"}}>Nothing of yours is running.</p>`}
      ${mateRow}
      <div class="row" style=${{padding:"4px 8px"}}><${Btn} size="sm" kind="ghost" icon="scan" onClick=${function(){ W.go("find", "search"); W.ui(function(uu){ uu.tray = null; }); }}>Open the search console</${Btn}></div>
    </div>`;
  }
  if (u.tray === "notifs") return html`<div class="tray" ref=${ref} role="dialog" aria-label="Notifications">
    <div class="row" style=${{padding:"6px 8px"}}><h4 class="grow">Notifications</h4><button type="button" class="btn ghost sm" onClick=${function(){ W.act("Marked notifications read", function(dd){ dd.notifs.forEach(function(n){ n.read = true; }); }, {log:false}); }}>Mark all read</button><${W.IconBtn} icon="gear" label="Choose what reaches the bell" onClick=${function(){ W.ui(function(uu){ uu.tray = null; }); W.openSetting("notifications", "notify"); }} /></div>
    ${d.notifs.filter(W.notifShown).length ? null : html`<p class="hint" style=${{padding:"6px 9px"}}>Nothing new.</p>`}
    ${d.notifs.filter(W.notifShown).map(function(n){ return html`<button key=${n.id} type="button" class=${W.cx("tray-i", n.read ? null : "unread")} onClick=${function(){ n.read = true; W.ui(function(uu){ uu.tray = null; if (n.go.item) uu.todaySel = n.go.item; }); W.go(n.go.s, n.go.tab || null); }}>
      <${Icon} n=${n.icon} /><div class="tx">${n.text}<small>${n.sub} · ${W.ago(n.at)}</small></div>${n.read ? null : html`<i style=${{width:"8px", height:"8px", borderRadius:"50%", background:"var(--accent)", marginTop:"6px", flex:"none"}}></i>`}</button>`; })}
  </div>`;
  return null;
}

/* ---------- peek ---------- */
function peekStep(n){ var p = W.U().peek; if (!p || !p.list) return; var j = p.list.indexOf(p.id) + n; if (j >= 0 && j < p.list.length) W.ui(function(uu){ uu.peek = {t:p.t, id:p.list[j], list:p.list}; }); }
function Peek(){
  var u = W.U(), p = u.peek;
  W.useKeys({escape:function(){ W.closePeek(); }, "alt+arrowdown":function(){ peekStep(1); }, "alt+arrowup":function(){ peekStep(-1); }}, !!p);
  if (!p) return null;
  var list = p.list || [], i = list.indexOf(p.id), step = peekStep;
  return html`<aside class="peek" aria-label="Record" data-why="peek">
    <div class="peek-h">
      ${list.length > 1 ? html`<${W.IconBtn} icon="chevU" label="Previous" kbd="Alt ↑" disabled=${i <= 0} onClick=${function(){ step(-1); }} /><${W.IconBtn} icon="chevD" label="Next" kbd="Alt ↓" disabled=${i >= list.length - 1} onClick=${function(){ step(1); }} /><span class="small muted num">${i + 1} of ${list.length}</span>` : null}
      <span class="sp"></span>
      <${Btn} size="sm" kind="ghost" icon="external" onClick=${function(){ W.openRec(p.t, p.id); }}>Full page</${Btn}>
      <${W.IconBtn} icon="x" label="Close" kbd="Esc" onClick=${W.closePeek} />
    </div>
    <div class="peek-b"><${W.Record} key=${p.t + p.id} refx=${{t:p.t, id:p.id}} /></div>
  </aside>`;
}
W.screens.rec = function(){
  var u = W.U(), r = u.route.rec;
  return html`<div class="page" style=${{maxWidth:"1000px"}}>
    <div class="row"><${Btn} size="sm" kind="ghost" icon="arrowL" iconCls="flip" onClick=${W.back}>Back</${Btn}></div>
    <div class="card" style=${{padding:"22px"}}><${W.Record} key=${r.t + r.id} refx=${r} /></div>
  </div>`;
};

/* ---------- command palette ---------- */
function Palette(){
  var u = W.U(), d = W.D(), st = useState(""), q = st[0], setQ = st[1], sel = useState(0), inp = useRef(null);
  useEffect(function(){ if (inp.current) inp.current.focus(); }, []);
  function close(){ W.ui(function(uu){ uu.palette = false; }); }
  W.useKeys({"mod+k":function(){ close(); }, escape:function(){ close(); }}, true, {barrier:true});
  var acts = [
    {g:"Actions", icon:"target", label:"Start focus", hint:"F", run:function(){ W.go("today"); W.ui(function(uu){ uu.focus = true; uu.focusStart = W.now(); }); }},
    {g:"Actions", icon:"coffee", label:"Wrap up the day", run:function(){ W.go("today"); W.ui(function(uu){ uu.wrap = true; }); }},
    {g:"Actions", icon:"play", label:"Resume today's search", run:function(){ W.go("find", "search"); W.A.startRun("r3"); }},
    {g:"Actions", icon:"scan", label:"Review new finds", run:function(){ W.go("find", "triage"); }},
    {g:"Actions", icon:"at", label:"Confirm contacts", run:function(){ W.go("find", "contacts"); }},
    {g:"Actions", icon:"undo", label:"Undo the last change", hint:"Ctrl Z", run:W.undo},
    {g:"Actions", icon:"keyboard", label:"Show keyboard shortcuts", hint:"?", run:function(){ W.ui(function(uu){ uu.shortcuts = true; }); }},
    {g:"Actions", icon:"map", label:"Show the design notes on this screen", run:function(){ W.ui(function(uu){ uu.why = true; }); }},
    {g:"Actions", icon:"moon", label:"Switch light / dark", run:cycleTheme},
    {g:"Actions", icon:"gear", label:"Open settings", hint:"Ctrl ,", run:function(){ W.go("settings", "profile"); }},
    {g:"Actions", icon:"rows", label:"Switch density (comfortable / compact)", run:function(){ W.pref.set("density", W.pref.get("density") === "compact" ? "" : "compact"); }}
  ];
  var go = Object.keys(SCREENS).filter(function(k){ return k !== "rec"; }).map(function(k){ return {g:"Go to", icon:SCREENS[k].icon, label:SCREENS[k].name, hint:"G " + ({today:"T", find:"F", reach:"R", close:"C", deliver:"D", insights:"I", toolbox:"X", team:"M", plan:"P", settings:"S"})[k], run:function(){ W.go(k, SCREENS[k].tabs ? SCREENS[k].tabs[0][0] : null); }}; });
  var sets = W.SETTINGS_ROWS.filter(function(r){ return r[0] !== "prototype" || W.protoOn() || (r[1] === "proto" && W.accountIsOwner()); }).map(function(r){ var s = W.SETTINGS_SECTIONS.filter(function(x){ return x.k === r[0]; })[0]; return {g:"Settings", icon:s.icon, label:r[2], sub:s.name, words:r[3], run:function(){ W.openSetting(r[0], r[1]); }}; });
  if (W.protoOn()) acts = acts.concat([{g:"Prototype", icon:"chat", label:"Comment on something", hint:"C", run:function(){ W.toggleCommentMode(true); }}, {g:"Prototype", icon:"list", label:"Show all comments", run:function(){ W.ui(function(uu){ uu.proto = Object.assign({}, uu.proto, {panel:true}); }); }}]);
  var recs = d.creators.map(function(c){ return {g:"Creators", av:c, label:c.name, sub:c.handle + " · " + W.STAGE_LABEL[c.stage] + (c.email ? " · " + c.email : ""), run:function(){ W.peek("creator", c.id); }}; })
    .concat(d.brands.map(function(b){ return {g:"Brands", icon:"flag", label:b.name, sub:b.sells + " · " + b.status, run:function(){ W.peek("brand", b.id); }}; }))
    .concat(d.deals.map(function(x){ return {g:"Deals", icon:"box", label:W.dealName(x), sub:W.DEAL_FLOW[x.step].name + " · " + W.money(x.price), run:function(){ W.peek("deal", x.id); }}; }));
  var list;
  if (!q.trim()){
    var recent = (u.recent || []).map(function(r){ var o = W.rec(r); return o ? {g:"Recent", icon:r.t === "deal" ? "box" : r.t === "brand" ? "flag" : "user", label:W.refName(r), sub:r.t, run:function(){ W.peek(r.t, r.id); }} : null; }).filter(Boolean);
    list = recent.slice(0, 5).concat(acts.slice(0, 5), go);
  } else {
    var t = q.toLowerCase().trim();
    list = acts.concat(go, sets, recs).filter(function(x){ return (x.label + " " + (x.sub || "") + " " + (x.words || "")).toLowerCase().indexOf(t) >= 0; }).slice(0, 14);
  }
  var i = W.clamp(sel[0], 0, Math.max(0, list.length - 1));
  function key(e){
    if (e.key === "ArrowDown"){ e.preventDefault(); sel[1](i + 1); }
    else if (e.key === "ArrowUp"){ e.preventDefault(); sel[1](Math.max(0, i - 1)); }
    else if (e.key === "Enter"){ e.preventDefault(); W.kbdQuiet(); if (list[i]){ close(); list[i].run(); } }
    else if (e.key === "Escape"){ e.preventDefault(); close(); }
  }
  var lastG = null;
  return html`<${W.Fragment}><div class="scrim" onClick=${close}></div>
    <div class="pal" role="dialog" aria-label="Command palette" style=${{animation:"none"}}>
      <div class="pal-in"><${Icon} n="search" s=${18} /><input ref=${inp} value=${q} onInput=${function(e){ setQ(e.target.value); sel[1](0); }} onKeyDown=${key} placeholder="Find a creator, brand or deal, or type a command" aria-label="Search or run a command" /><span class="kbd">Esc</span></div>
      <div class="pal-list" role="listbox">
        ${list.map(function(x, k){ var head = x.g !== lastG ? (lastG = x.g, html`<div class="pal-g">${x.g}</div>`) : null;
          return html`<${W.Fragment} key=${x.g + x.label + k}>${head}<button type="button" class="pal-i" role="option" aria-selected=${String(k === i)} onMouseMove=${function(){ if (k !== i) sel[1](k); }} onClick=${function(){ close(); x.run(); }}>
            ${x.av ? html`<${W.CAv} c=${x.av} size="s" />` : html`<${Icon} n=${x.icon} />`}<span class="grow ell">${x.label}${x.sub ? html` <small>${x.sub}</small>` : null}</span>${x.hint ? html`<span class="kbd">${x.hint}</span>` : null}</button></${W.Fragment}>`; })}
        ${!list.length ? html`<p class="hint" style=${{padding:"14px"}}>Nothing matches "${q}".</p>` : null}
      </div>
      <div class="pal-f"><span><span class="kbd">↑</span> <span class="kbd">↓</span> move</span><span><span class="kbd">Enter</span> open</span><span><span class="kbd">G</span> then a letter jumps to a screen</span><span><span class="kbd">?</span> all shortcuts</span></div>
    </div></${W.Fragment}>`;
}

/* ---------- shortcuts ---------- */
var SHORTCUTS = W.SHORTCUTS = [
  ["Everywhere", [["Ctrl K","Search or run a command"],["?","This list"],["G then T / F / R / C / D","Go to Today, Find, Reach, Close, Deliver"],["G then I / X / M / P / S","Insights, Toolbox, Team, The plan, Settings"],["Ctrl ,","Settings"],["Alt ← / Alt →","Back and forward"],["Ctrl Z / Ctrl Shift Z","Undo and redo any change"],["[","Collapse the sidebar"],["Esc","Close whatever is open"]]],
  ["Today", [["J / K","Next and previous item"],["Ctrl Enter","Do the main action (send, invoice, pay)"],["Z","Snooze the item"],["H","Hand it to a teammate"],["O","Open its record beside the list"],["F","Focus: one item at a time"]]],
  ["Reviewing finds", [["S","Shortlist"],["R","Reject with the chosen reason"],["1 – 4","Reject with that reason"],["→ / ←","Skip / go back"],["Enter","Open the channel"]]],
  ["Records", [["Alt ↑ / Alt ↓","Previous and next record in the list"],["Esc","Close the record"]]]
];
function Shortcuts(){
  function close(){ W.ui(function(uu){ uu.shortcuts = false; }); }
  W.useKeys({escape:close, "?":close}, true, {barrier:true});
  return html`<${W.Fragment}><div class="scrim" onClick=${close}></div><div class="modal" role="dialog" aria-label="Keyboard shortcuts" style=${{"--mw":"760px"}}>
    <div class="row"><h2 class="grow">Keyboard shortcuts</h2><${W.IconBtn} icon="x" label="Close" onClick=${close} /></div>
    <div class="grid2">${SHORTCUTS.map(function(g){ return html`<div key=${g[0]} class="col tight"><h4>${g[0]}</h4>${g[1].map(function(s){ return html`<div key=${s[0]} class="row small" style=${{justifyContent:"space-between", gap:"12px", padding:"3px 0", borderBottom:"1px solid var(--line)"}}><span class="ink2">${s[1]}</span><span class="kbd">${s[0]}</span></div>`; })}</div>`; })}</div>
    <p class="hint">Single-letter keys never fire while you are typing in a field.</p>
  </div></${W.Fragment}>`;
}

/* ---------- hand-off note ---------- */
function Handoff(){
  var u = W.U(), h = u.handoff, st = useState("");
  function close(){ W.ui(function(uu){ uu.handoff = null; }); }
  function go(){ W.A.handOff(h.key, h.ref, h.to, st[0].trim(), h.title); close(); }
  W.useKeys({escape:close, "mod+enter":go}, true, {barrier:true});
  var m = W.member(h.to);
  return html`<${W.Fragment}><div class="scrim" onClick=${close}></div><div class="modal" role="dialog" aria-label="Hand off" style=${{"--mw":"480px"}}>
    <div class="row"><${W.Av} id=${h.to} status=${m.status} /><div class="grow col t2"><h3>Hand to ${m.name}</h3><span class="small muted">${h.title}</span></div></div>
    ${m.status === "away" ? html`<${W.Callout} tone="warn">${m.name} is away: ${m.doing}. It will wait in their Today.</${W.Callout}>` : null}
    <textarea class="ta" rows="3" autoFocus=${true} placeholder=${"What should " + m.name + " know? (optional)"} value=${st[0]} onInput=${function(e){ st[1](e.target.value); }} aria-label="Note"></textarea>
    <div class="row"><${Btn} kind="pri" icon="forward" onClick=${go}>Hand it over <span class="kbd">Ctrl Enter</span></${Btn}><${Btn} kind="ghost" onClick=${close}>Cancel</${Btn}></div>
  </div></${W.Fragment}>`;
}

/* ---------- menu ---------- */
function Menu(){
  var u = W.U(), m = u.menu, ref = useRef(null), pos = useState(null);
  useLayoutEffect(function(){
    var el = ref.current; if (!el) return;
    var w = el.offsetWidth, h = el.offsetHeight, x = m.align === "end" ? m.right - w : m.x, y = m.y;
    x = W.clamp(x, 8, window.innerWidth - w - 8); if (y + h > window.innerHeight - 8) y = Math.max(8, m.top - h - 4);
    pos[1]({x:x, y:y});
    var first = el.querySelector("button"); if (first) first.focus();
  }, [m]);
  useEffect(function(){ function off(e){ if (ref.current && !ref.current.contains(e.target)) W.closeMenu(); } setTimeout(function(){ document.addEventListener("mousedown", off); }, 0); return function(){ document.removeEventListener("mousedown", off); }; }, []);
  W.useKeys({escape:function(){ W.closeMenu(); },
    arrowdown:function(){ var b = Array.prototype.slice.call(ref.current.querySelectorAll("button")), i = b.indexOf(document.activeElement); if (b[i + 1]) b[i + 1].focus(); },
    arrowup:function(){ var b = Array.prototype.slice.call(ref.current.querySelectorAll("button")), i = b.indexOf(document.activeElement); if (b[i - 1]) b[i - 1].focus(); }}, true, {barrier:true});
  return html`<div class="menu" ref=${ref} role="menu" style=${{left:(pos[0] ? pos[0].x : m.x) + "px", top:(pos[0] ? pos[0].y : m.y) + "px", visibility:pos[0] ? "visible" : "hidden"}}>
    ${m.items.map(function(it, i){
      if (it.sep) return html`<hr key=${i} />`;
      if (it.head) return html`<div key=${i} class="mh">${it.head}</div>`;
      if (it.who) return html`<button key=${i} type="button" role="menuitem" class="mwho" onClick=${function(){ W.closeMenu(); it.run(); }}><${W.Av} id=${it.who.id} size="l" tip=${false} /><span class="col t2" style=${{minWidth:0}}><b class="ell">${it.unnamed ? "Add your name" : it.who.name}</b><small>${it.unnamed ? "So the team knows who did what" : it.who.role}</small></span></button>`;
      return html`<button key=${i} type="button" role=${it.checked == null ? "menuitem" : "menuitemradio"} aria-checked=${it.checked == null ? null : String(!!it.checked)} style=${it.danger ? {color:"var(--crit)"} : null} onClick=${function(){ W.closeMenu(); it.run(); }}>${it.icon ? html`<${Icon} n=${it.icon} />` : null}${it.label}${it.hint ? html`<small>${it.hint}</small>` : null}${it.checked ? html`<${Icon} n="check" s=${14} cls="mcheck" />` : null}</button>`; })}
  </div>`;
}

/* ---------- toasts ---------- */
function Toast(p){
  var t = p.t, hover = useRef(false), left = useRef(t.ms), last = useRef(Date.now());
  useEffect(function(){
    var iv = setInterval(function(){
      var now = Date.now(), dt = now - last.current; last.current = now;
      if (hover.current || document.hidden) return;
      left.current -= dt; if (left.current <= 0){ clearInterval(iv); W.dismiss(t.id); }
    }, 200);
    return function(){ clearInterval(iv); };
  }, []);
  return html`<div class="toast" role="status" onMouseEnter=${function(){ hover.current = true; }} onMouseLeave=${function(){ hover.current = false; }}>
    <span class=${W.cx("ti", t.tone === "good" ? "good" : null)}><${Icon} n=${t.icon || "check"} /></span>
    <div class="tm">${t.msg}${t.sub ? html`<small>${t.sub}</small>` : null}</div>
    ${(t.actions || []).map(function(a, i){ return html`<button key=${i} type="button" class="btn sm" onClick=${function(){ W.dismiss(t.id); a.run(); }}>${a.label}</button>`; })}
    <button type="button" class="iconbtn" style=${{width:"26px", height:"26px", color:"inherit"}} onClick=${function(){ W.dismiss(t.id); }} aria-label="Dismiss"><${Icon} n="x" s=${14} /></button>
    <i class="life" style=${{animationDuration:t.ms + "ms"}}></i>
  </div>`;
}

/* ---------- tooltip (delay on the first, instant on the next) ---------- */
function Tip(){
  var st = useState(null), tip = st[0], set = st[1];
  useEffect(function(){
    var timer = null, warm = 0;
    function over(e){
      var el = e.target.closest && e.target.closest("[data-tip]"); if (!el){ clearTimeout(timer); set(null); return; }
      var text = el.getAttribute("data-tip"); if (!text) return;
      clearTimeout(timer);
      var show = function(){ var r = el.getBoundingClientRect(); set({text:text, kbd:el.getAttribute("data-kbd"), x:r.left + r.width / 2, y:r.bottom + 8, top:r.top}); warm = Date.now(); };
      if (Date.now() - warm < 700) show(); else timer = setTimeout(show, 480);
    }
    function out(e){ var el = e.target.closest && e.target.closest("[data-tip]"); if (!el) return; clearTimeout(timer); if (tip) warm = Date.now(); set(null); }
    function down(){ clearTimeout(timer); set(null); }
    document.addEventListener("mouseover", over); document.addEventListener("mouseout", out); document.addEventListener("mousedown", down); document.addEventListener("keydown", down);
    return function(){ document.removeEventListener("mouseover", over); document.removeEventListener("mouseout", out); document.removeEventListener("mousedown", down); document.removeEventListener("keydown", down); };
  }, []);
  var ref = useRef(null), pos = useState(null);
  useLayoutEffect(function(){ if (!tip || !ref.current) return; var w = ref.current.offsetWidth, h = ref.current.offsetHeight, x = W.clamp(tip.x - w / 2, 8, window.innerWidth - w - 8), y = tip.y + h > window.innerHeight - 8 ? tip.top - h - 8 : tip.y; pos[1]({x:x, y:y}); }, [tip]);
  if (!tip) return null;
  return html`<div class="tip" ref=${ref} role="tooltip" style=${{left:(pos[0] ? pos[0].x : -999) + "px", top:(pos[0] ? pos[0].y : -999) + "px"}}>${tip.text}${tip.kbd ? html`<span class="kbd">${tip.kbd}</span>` : null}</div>`;
}

/* ---------- theme ---------- */
function cycleTheme(){
  var cur = W.pref.get("theme"), next = cur === "" ? "dark" : cur === "dark" ? "light" : "";
  W.pref.set("theme", next);
  W.toast({msg:"Theme: " + (next || "follows your system"), icon:next === "dark" ? "moon" : "sun", tone:"info", ms:2000});
}
W.cycleTheme = cycleTheme;

/* ---------- global keys ---------- */
var gPending = 0;
function useGlobalKeys(){
  W.useKeys({
    "mod+k":function(){ W.ui(function(u){ u.palette = !u.palette; }); },
    "/":function(){ W.ui(function(u){ u.palette = true; }); },
    "?":function(){ W.ui(function(u){ u.shortcuts = true; }); },
    "mod+z":function(e){ if (e.shiftKey) W.redo(); else W.undo(); },
    "mod+y":function(){ W.redo(); },
    "alt+arrowleft":function(){ W.back(); }, "alt+arrowright":function(){ W.fwd(); },
    "[":function(){ W.pref.set("rail", W.U().railMin ? "" : "min"); },
    "mod+,":function(){ W.go("settings", W.U().route.s === "settings" ? W.U().route.tab : "profile"); },
    g:function(){ gPending = Date.now(); },
    escape:function(){ var u = W.U(); if (u.tray){ W.ui(function(uu){ uu.tray = null; }); return true; } if (u.why){ W.ui(function(uu){ uu.why = false; uu.whyOpen = null; }); return true; } return false; }
  });
}
var GO = {t:"today", f:"find", r:"reach", c:"close", d:"deliver", i:"insights", x:"toolbox", m:"team", p:"plan", s:"settings"};

/* ---------- placeholder for screens still being built ---------- */
function Missing(p){
  var s = SCREENS[p.s] || {name:p.s};
  return html`<div class="page"><${W.PageHead} title=${s.name} sub=${s.sub} /><div class="card"><${W.Empty} icon="wrench" title=${s.name + " is still being built"}>This screen arrives in the next build step. Today, records, the command palette and the plan already work.</${W.Empty}></div></div>`;
}

/* ---------- app ---------- */
function App(){
  var st = W.useApp(), u = st.ui;
  useGlobalKeys();
  useEffect(function(){
    function onKey(e){
      if (gPending && Date.now() - gPending < 1200 && !e.ctrlKey && !e.metaKey && !e.altKey && !W.typing(e.target) && !W.lettersOff && !W.keyBarrier()){
        var k = GO[e.key.toLowerCase()]; gPending = 0;
        if (k){ e.preventDefault(); W.go(k, SCREENS[k].tabs ? SCREENS[k].tabs[0][0] : null); return; }
      }
      W.dispatchKey(e);
    }
    document.addEventListener("keydown", onKey);
    var iv = setInterval(W.tickJobs, 900);
    return function(){ document.removeEventListener("keydown", onKey); clearInterval(iv); };
  }, []);
  useEffect(function(){ try { history.replaceState(null, "", "#" + u.route.s); } catch (e){} if (u.route.tab) W.ui(function(uu){ if (!uu.lastTab) uu.lastTab = {}; if (uu.lastTab[u.route.s] !== u.route.tab) uu.lastTab[u.route.s] = u.route.tab; }); }, [u.route.s, u.route.tab]);
  var items = W.items("me");
  var Screen = W.screens[u.route.s];
  var proto = W.protoOn();
  /* toasts sit below any bar (a problem, or whose view this is) so they never cover its button */
  useLayoutEffect(function(){
    var el = document.querySelector(".bars"); if (!el || !window.ResizeObserver) return;
    var ro = new ResizeObserver(function(){ document.documentElement.style.setProperty("--bars-h", el.offsetHeight + "px"); });
    ro.observe(el); return function(){ ro.disconnect(); };
  }, []);
  return html`<div class=${W.cx("app", u.railMin ? "rail-min" : null, u.railOpen ? "rail-open" : null, u.why ? "why-on" : null, proto ? "proto-on" : null, proto && u.proto.panel ? "cmt-panel-on" : null)}>
    <${Rail} items=${items} />
    ${u.railOpen ? html`<div class="scrim only-narrow" style=${{zIndex:85}} onClick=${function(){ W.ui(function(uu){ uu.railOpen = false; }); }}></div>` : null}
    <div class="main">
      <${Top} />
      <div class="bars">${proto && st.data.me !== "u1" ? html`<${ViewAsBar} />` : null}<${SysBar} /></div>
      <div class=${W.cx("body", u.peek ? "has-peek" : null)}>
        <main class="content" id="content">${Screen ? html`<${Screen} key=${u.route.s} />` : html`<${Missing} s=${u.route.s} />`}</main>
        <${Peek} />
      </div>
    </div>
    ${u.tray ? html`<${Tray} />` : null}
    ${u.palette ? html`<${Palette} />` : null}
    ${u.shortcuts ? html`<${Shortcuts} />` : null}
    ${u.handoff ? html`<${Handoff} />` : null}
    ${u.menu ? html`<${Menu} key=${u.menu.x + "," + u.menu.y} />` : null}
    ${u.why && W.WhyLayer ? html`<${W.WhyLayer} />` : null}
    ${proto ? html`<${W.CommentLayer} />` : null}
    <div class="toasts" data-cmt-ui="1">${u.toasts.map(function(t){ return html`<${Toast} key=${t.id} t=${t} />`; })}</div>
    <${Tip} />
  </div>`;
}

/* ---------- boot ---------- */
(function boot(){
  W.pref.boot();
  var clone = window.structuredClone ? function(o){ return window.structuredClone(o); } : function(o){ return JSON.parse(JSON.stringify(o)); };
  W.PRISTINE = clone(W.seed()); W.NOW0 = W.NOW;
  var start = (location.hash || "").replace("#", "");
  if (!SCREENS[start] || start === "rec") start = "today";
  var s0 = SCREENS[start], tab0 = s0.tabs ? s0.tabs[0][0] : null;
  W.init(clone(W.PRISTINE), {route:{s:start, tab:tab0}, hist:[{s:start, tab:tab0}], histI:0, peek:null, toasts:[], menu:null, jobs:[], saving:false, savedAt:W.now() - 40000,
    palette:false, shortcuts:false, tray:null, why:false, whyOpen:null, railMin:W.pref.get("rail") === "min", railOpen:false, handoff:null, proto:{on:false}, profile:{}, setFlash:null,
    todaySel:null, todayIdx:0, todayScope:"me", todayFilter:"all", collapsed:{}, focus:false, wrap:false, recent:[], lastTab:{},
    viewers:{d5:"u2", c13:"u3", b5:"u2"}});
  W.loadProfile();
  if (W.LS.get("wb-proto", "") === "1") W.setProto(true, true);
  ReactDOM.createRoot(document.getElementById("root")).render(html`<${App} />`);
})();
})();
