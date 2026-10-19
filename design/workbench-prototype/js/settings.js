/* settings.js — one home for how the Workbench behaves. Every row says what it changes and for whom
   (just you, this computer, or the whole team), applies at once, confirms in place and can be undone.
   A search box finds any setting; Ctrl K finds them too. Agency rules reuse the same editors as the screens
   that use them, so there is one source of truth. */
(function(){
"use strict";
var W = window.W, html = W.html, Icon = W.Icon, useState = W.useState, useEffect = W.useEffect, useRef = W.useRef;
var Btn = W.Btn, Tag = W.Tag;

/* ---------- this computer's appearance ---------- */
var root = document.documentElement;
W.pref = {
  get:function(k){ return W.LS.get("wb-" + k, ""); },
  set:function(k, v){
    W.LS.set("wb-" + k, v);
    if (k === "theme"){ if (v) root.dataset.theme = v; else delete root.dataset.theme; }
    if (k === "density"){ if (v) root.dataset.density = v; else delete root.dataset.density; }
    if (k === "size"){ if (v) root.dataset.size = v; else delete root.dataset.size; }
    if (k === "motion"){ if (v) root.dataset.motion = v; else delete root.dataset.motion; }
    if (k === "letters") W.lettersOff = v === "off";
    if (k === "rail") W.ui(function(u){ u.railMin = v === "min"; });
    W.emit();
  },
  boot:function(){ ["theme","density","size","motion"].forEach(function(k){ var v = W.pref.get(k); if (v) root.dataset[k] = v; }); W.lettersOff = W.pref.get("letters") === "off"; }
};
W.morning = function(){ var s = W.D().settings || {}; return s.morning || 9; };

/* ---------- what each notification is about ---------- */
var NOTIFY = [["reply","Replies","When a creator or brand writes back.","reply"],["money","Money","Invoices due or late, brands paying, payouts unlocked.","wallet"],["handoff","Hand-offs","When a teammate hands something to you.","forward"],["search","Searches","When a search pauses, finishes or stops.","scan"]];
W.notifKind = function(n){ return n.icon === "reply" ? "reply" : n.icon === "wallet" || n.icon === "unlock" ? "money" : n.icon === "forward" ? "handoff" : n.icon === "alert" ? "problem" : "search"; };
W.notifShown = function(n){ var k = W.notifKind(n), s = (W.D().settings || {}).notify || {}; return k === "problem" || s[k] !== false; };

/* ---------- sections ---------- */
var SECTIONS = [
  {k:"profile", g:"You", name:"Profile", icon:"user", sub:"Your name and role", kw:"name account avatar role owner"},
  {k:"appearance", g:"You", name:"Appearance", icon:"moon", sub:"Theme, density, text size, motion", kw:"dark light theme compact density font text size large motion animation sidebar"},
  {k:"day", g:"You", name:"Your day", icon:"sun", sub:"Day length, snooze, Today", kw:"hours budget day length snooze morning welcome"},
  {k:"keyboard", g:"You", name:"Keyboard", icon:"keyboard", sub:"Shortcuts and single-letter keys", kw:"shortcuts keys letters screen reader dictation"},
  {k:"notifications", g:"You", name:"Notifications", icon:"bell", sub:"What reaches the bell", kw:"alerts bell notify replies money hand-offs searches"},
  {k:"search", g:"Agency", name:"Search rules", icon:"scan", sub:"What every search keeps", kw:"countries median views uploads keyword archive rules"},
  {k:"facts", g:"Agency", name:"Agency facts", icon:"sliders", sub:"Audience, pricing, send window", kw:"audience countries ages engagement margin floor cpm markup send window", owner:true},
  {k:"writing", g:"Agency", name:"Writing rules", icon:"pen", sub:"House rules every draft follows", kw:"gemini drafts house rules writing banned words"},
  {k:"team", g:"Agency", name:"Team and money", icon:"users", sub:"Roles, who sees money", kw:"roles va money permissions invite", owner:true},
  {k:"connections", g:"Agency", name:"Connections", icon:"gauge", sub:"Gmail, Gemini, YouTube, sync", kw:"gmail gemini bridge youtube quota pipeline sync updates health", owner:true},
  {k:"prototype", g:"Owner tools", name:"Prototype mode", icon:"flask", sub:"Example data and comments", kw:"prototype example data scenario sandbox comment view as test", owner:true, realOwner:true}
];
W.SETTINGS_SECTIONS = SECTIONS;
var SCOPE = {you:"Just you", device:"This computer", team:"Whole team"};

/* rows that can be searched and reached from Ctrl K: [section, id, label, words] */
var ROWS = [
  ["profile","name","Your name","display name account"],["profile","role","Your role","owner role"],
  ["appearance","theme","Theme","dark light system"],["appearance","density","Density","compact comfortable"],["appearance","size","Text size","font large"],["appearance","motion","Motion","animation reduce"],["appearance","rail","Sidebar","collapse expand"],
  ["day","budget","Length of your working day","hours budget"],["day","morning","Snoozed items come back at","snooze tomorrow morning"],["day","welcome","Welcome note","getting started"],
  ["keyboard","letters","Single-letter shortcuts","keys screen reader dictation"],
  ["notifications","notify","What reaches the bell","alerts"],
  ["team","vamoney","VAs see money","roles invoices payouts margins"],
  ["prototype","proto","Prototype mode","example data sandbox"],["prototype","scenario","Scenario","first day week later broke"],["prototype","viewas","See the app as","teammate role va"],["prototype","comments","Comments","comment tool pins"]
];
W.SETTINGS_ROWS = ROWS;
function secOf(k){ return SECTIONS.filter(function(s){ return s.k === k; })[0]; }
W.openSetting = function(sec, row){
  W.go("settings", sec);
  if (row) setTimeout(function(){ var el = document.getElementById("set-" + row); if (!el) return; el.scrollIntoView({block:"center"}); el.classList.remove("hl"); void el.offsetWidth; el.classList.add("hl"); var f = el.querySelector("input, button"); if (f && f.focus) f.focus({preventScroll:true}); }, 60);
};
function isOwner(){ return W.member(W.D().me).role === "Owner"; }

/* ---------- pieces ---------- */
var flashT = null;
function flash(id){ W.ui(function(u){ u.setFlash = {id:id, at:Date.now()}; }); clearTimeout(flashT); flashT = setTimeout(function(){ W.ui(function(u){ u.setFlash = null; }); }, 1700); }
function Row(p){
  var f = W.U().setFlash, on = f && f.id === p.id;
  return html`<div class="set-row" id=${"set-" + p.id}>
    <div class="set-t"><div class="row wrap" style=${{gap:"8px"}}><b>${p.label}</b>${p.scope ? html`<span class="set-scope">${SCOPE[p.scope]}</span>` : null}${on ? html`<span class="set-saved" role="status"><${Icon} n="check" s=${13} />Saved</span>` : null}</div>${p.desc ? html`<p>${p.desc}</p>` : null}</div>
    <div class="set-c">${p.children}</div>
  </div>`;
}
function Switch(p){
  return html`<button type="button" role="switch" class="switch" aria-checked=${String(!!p.on)} aria-label=${p.label} disabled=${p.disabled} onClick=${function(){ p.onChange(!p.on); }}><i></i></button>`;
}
function Locked(p){ return html`<div class="card tight"><${W.Empty} icon="lock" title=${"Only the owner changes " + p.what}>${W.member(W.D().me).name} sees ${p.what} in effect but can't change them.</${W.Empty}></div>`; }

/* ---------- sections' content ---------- */
function Profile(){
  var u = W.U(), pr = u.profile || {}, me = W.member(W.D().me), mine = W.D().me === "u1";
  var st = useState(null), val = st[0] == null ? W.myName() : st[0];
  function save(){ if (st[0] == null) return; var v = st[0].trim(); if (v === W.myName()){ st[1](null); return; } W.setMyName(v); st[1](null); flash("name"); }
  return html`<${W.Fragment}>
    <div class="set-hero"><${W.Av} id=${me.id} size="xl" tip=${false} /><div class="col t2"><b style=${{fontSize:"17px", fontWeight:600}}>${me.name}</b><span class="small muted">${me.role}${pr.acct && mine ? " · signed in with your Claude account" : ""}</span></div></div>
    ${mine ? html`<${Row} id="name" label="Your name" scope="you" desc="How you appear to the team: in the sidebar, on records you own and in the activity log.">
      <div class="col tight" style=${{minWidth:0}}>
        <input class="inp" value=${val} placeholder=${pr.acct || "Your name"} aria-label="Your name" onInput=${function(e){ st[1](e.target.value); }} onBlur=${save} onKeyDown=${function(e){ if (e.key === "Enter"){ e.preventDefault(); save(); e.target.blur(); } if (e.key === "Escape"){ st[1](null); e.target.blur(); } }} />
        <span class="hint">${pr.local ? "Set on this computer." : pr.acct ? "From your Claude account." : "Not set yet."}${pr.local && pr.acct ? html` <button type="button" class="linkbtn" onClick=${function(){ W.setMyName(""); st[1](null); flash("name"); }}>Use ${pr.acct}</button>` : null}</span>
      </div></${Row}>` : html`<${Row} id="name" label="Name" desc="Set by the person themselves."><span>${me.name}</span></${Row}>`}
    <${Row} id="role" label="Your role" desc=${me.role === "Owner" ? "Owners see money, change the agency's rules and invite people." : "What this role can do is listed in Team › Roles."}>
      <div class="row wrap"><${Tag} icon="shield">${me.role}</${Tag}><${Btn} size="sm" kind="ghost" icon="users" onClick=${function(){ W.go("team"); }}>Roles in Team</${Btn}></div></${Row}>
  </${W.Fragment}>`;
}
function Appearance(){
  var u = W.U(), th = W.pref.get("theme"), dn = W.pref.get("density"), sz = W.pref.get("size"), mo = W.pref.get("motion");
  function set(k, v, id){ W.pref.set(k, v); flash(id || k); }
  return html`<${W.Fragment}>
    <${Row} id="theme" label="Theme" scope="device" desc="System follows your computer's light or dark setting through the day."><${W.Seg} label="Theme" cur=${th} onPick=${function(v){ set("theme", v); }} opts=${[["","System","sun"],["light","Light","sun"],["dark","Dark","moon"]]} /></${Row}>
    <${Row} id="density" label="Density" scope="device" desc="Compact fits more rows on a small screen; comfortable is easier on long days."><${W.Seg} label="Density" cur=${dn || "comfortable"} onPick=${function(v){ set("density", v === "comfortable" ? "" : v); }} opts=${[["comfortable","Comfortable"],["compact","Compact"]]} /></${Row}>
    <${Row} id="size" label="Text size" scope="device" desc="Large raises every text size one step. Layouts reflow to fit."><${W.Seg} label="Text size" cur=${sz || "normal"} onPick=${function(v){ set("size", v === "normal" ? "" : v); }} opts=${[["normal","Normal"],["large","Large"]]} /></${Row}>
    <${Row} id="motion" label="Motion" scope="device" desc="Reduce turns off slides and fades. Your computer's own reduce-motion setting is always respected."><${W.Seg} label="Motion" cur=${mo || "system"} onPick=${function(v){ set("motion", v === "system" ? "" : v); }} opts=${[["system","Follow my computer"],["reduce","Reduce"]]} /></${Row}>
    <${Row} id="rail" label="Sidebar" scope="device" desc="Collapsed keeps only the icons. Press [ anywhere to switch."><${W.Seg} label="Sidebar" cur=${u.railMin ? "min" : "full"} onPick=${function(v){ set("rail", v === "min" ? "min" : ""); }} opts=${[["full","Expanded"],["min","Collapsed"]]} /></${Row}>
  </${W.Fragment}>`;
}
function Day(){
  var d = W.D(), b = d.day.budget, mo = W.morning();
  return html`<${W.Fragment}>
    <${Row} id="budget" label="Length of your working day" scope="you" desc="Today plans against this. The bar at the top of Today shows planned, done and free time inside it.">
      <${W.Seg} label="Hours" cur=${b} onPick=${function(v){ W.act("Set the working day to " + W.dur(v), function(dd){ dd.day.budget = v; }, {log:false}); flash("budget"); }} opts=${[[120,"2 h"],[180,"3 h"],[240,"4 h"],[300,"5 h"],[360,"6 h"]]} /></${Row}>
    <${Row} id="morning" label="Snoozed items come back at" scope="you" desc="Used by Snooze › Tomorrow morning, Next Monday, and Wrap up's Move all to tomorrow.">
      <${W.Seg} label="Morning time" cur=${mo} onPick=${function(v){ W.act("Snoozes now come back at " + v + ":00", function(dd){ dd.settings.morning = v; }, {log:false}); flash("morning"); }} opts=${[[8,"08:00"],[9,"09:00"],[10,"10:00"]]} /></${Row}>
    <${Row} id="welcome" label="Welcome note" scope="device" desc="The short note at the top of Today that explains the keys.">
      <${Btn} size="sm" icon="undo" onClick=${function(){ W.LS.set("wb-welcomed", ""); flash("welcome"); }}>Show it again</${Btn}></${Row}>
  </${W.Fragment}>`;
}
function Keyboard(){
  var off = W.pref.get("letters") === "off";
  return html`<${W.Fragment}>
    <${Row} id="letters" label="Single-letter shortcuts" scope="device" desc="J, K, S, R, Z, F and the rest. Turn them off if you use a screen reader or dictation, so a stray letter never acts. Ctrl shortcuts keep working.">
      <div class="row"><${Switch} on=${!off} label="Single-letter shortcuts" onChange=${function(v){ W.pref.set("letters", v ? "" : "off"); flash("letters"); }} /><span class="small">${off ? "Off" : "On"}</span></div></${Row}>
    <div class="grid2" style=${{alignItems:"start"}}>${(W.SHORTCUTS || []).map(function(g){ return html`<div key=${g[0]} class="col tight"><h4>${g[0]}</h4>${g[1].map(function(s){ return html`<div key=${s[0]} class="row small" style=${{justifyContent:"space-between", gap:"12px", padding:"4px 0", borderBottom:"1px solid var(--line)"}}><span class="ink2">${s[1]}</span><span class="kbd">${s[0]}</span></div>`; })}</div>`; })}</div>
  </${W.Fragment}>`;
}
function Notifications(){
  var s = (W.D().settings || {}).notify || {};
  function set(k, v){ W.act((v ? "Turned on " : "Turned off ") + k + " notifications", function(dd){ dd.settings.notify = Object.assign({}, dd.settings.notify || {}); dd.settings.notify[k] = v; }, {log:false}); flash("notify"); }
  return html`<${Row} id="notify" label="What reaches the bell" scope="you" desc="Turned-off kinds still happen and still show on their screens; they just don't ring the bell.">
    <div class="col tight" style=${{gap:"10px", minWidth:0}}>
      ${NOTIFY.map(function(n){ var on = s[n[0]] !== false; return html`<div key=${n[0]} class="row" style=${{gap:"10px"}}><${Switch} on=${on} label=${n[1]} onChange=${function(v){ set(n[0], v); }} /><${Icon} n=${n[3]} /><div class="col t2" style=${{minWidth:0}}><span>${n[1]}</span><span class="tiny muted">${n[2]}</span></div></div>`; })}
      <div class="row" style=${{gap:"10px"}}><${Switch} on=${true} disabled=${true} label="Problems" onChange=${function(){}} /><${Icon} n="alert" /><div class="col t2"><span>Problems</span><span class="tiny muted">A mailbox signed out, the Gemini bridge down, a search stopped. These always come through.</span></div></div>
    </div></${Row}>`;
}
function TeamMoney(){
  var d = W.D(), v = d.settings.vaMoney;
  return html`<${Row} id="vamoney" label="VAs see money" scope="team" desc="Invoices, payouts and margins. Owners and account managers always see them.">
    <div class="col tight"><${W.Seg} label="VAs see money" cur=${v || ""} onPick=${function(x){ if (x && x !== v){ W.A.setVaMoney(x); flash("vamoney"); } }} opts=${[["hide","Hidden"],["show","Visible"]]} />
      ${v ? null : html`<span class="hint">Not decided yet, so it stays hidden.</span>`}<${Btn} size="sm" kind="ghost" icon="users" onClick=${function(){ W.go("team"); }}>People and roles</${Btn}></div></${Row}>`;
}

/* ---------- prototype mode (owner only) ---------- */
function Prototype(){
  var u = W.U(), on = W.protoOn(), pr = u.proto || {}, d = W.D();
  var openN = W.CM.list.filter(function(c){ return c.status !== "done"; }).length;
  return html`<${W.Fragment}>
    <div class="proto-how">
      <div class="ph-flow" aria-hidden="true">
        <span class="ph-box">The same app<small>every screen, every button</small></span><${Icon} n="arrowR" />
        <span class="ph-split"><span class=${W.cx("ph-box", on ? null : "on")}>Your live data<small>${on ? "set aside, untouched" : "in use now"}</small></span><span class=${W.cx("ph-box", on ? "on" : null)}>An example copy<small>${on ? "in use now" : "made when you turn it on"}</small></span></span>
      </div>
      <ul class="ph-list">
        <li>It is the real app, not a copy of it: change a screen and the change shows here too.</li>
        <li>Nothing leaves the computer. Sending, Gemini and YouTube are stand-ins while it is on.</li>
        <li>Turning it off puts your live data back exactly as it was. Off means off: no buttons, pins or keys from this mode anywhere.</li>
      </ul>
      <span class="hint">This preview has no connection to your accounts, so its "live" data is the example business as you left it.</span>
    </div>
    <${Row} id="proto" label="Prototype mode" scope="you" desc="Work on an example copy to try a flow, test a state or leave comments, without touching the real pipeline.">
      <div class="row"><${Switch} on=${on} label="Prototype mode" onChange=${function(v){ W.setProto(v); flash("proto"); }} /><span class="small">${on ? "On" : "Off"}</span></div></${Row}>
    ${on ? html`<${W.Fragment}>
      <${Row} id="scenario" label="Scenario" desc="Each one starts a fresh example copy, so you can see every screen in that state.">
        <div class="scn-grid">${W.SCENARIOS.map(function(s){ return html`<button key=${s.k} type="button" class="scn" aria-pressed=${String(pr.scenario === s.k)} onClick=${function(){ if (pr.scenario !== s.k) W.setScenario(s.k); }}>
          <span class="row" style=${{gap:"8px"}}><${Icon} n=${s.icon} /><b>${s.name}</b></span><small>${s.sub}</small></button>`; })}</div></${Row}>
      <${Row} id="viewas" label="See the app as" desc="Their Today list and what their role lets them see of money. Handy before someone new starts.">
        <${W.Seg} label="See the app as" cur=${d.me} onPick=${function(v){ if (v !== d.me) W.setViewAs(v); }} opts=${d.team.map(function(m){ return [m.id, m.id === "u1" ? "You" : m.name + " · " + m.role.split(" ·")[0]]; })} /></${Row}>
      <${Row} id="comments" label="Comments" desc="Press C anywhere, then click a button, card, row or chart to pin a note to it. The list keeps them all.">
        <div class="col tight" style=${{gap:"10px", minWidth:0}}>
          <div class="row wrap"><${Btn} size="sm" kind="pri" icon="chat" onClick=${function(){ W.toggleCommentMode(true); }}>Start commenting <span class="kbd">C</span></${Btn}>
            <${Btn} size="sm" icon="list" onClick=${function(){ W.ui(function(uu){ uu.proto = Object.assign({}, uu.proto, {panel:true}); }); }}>All comments (${openN} open)</${Btn}>
            <${Btn} size="sm" kind="ghost" icon="copy" disabled=${!openN} onClick=${function(){ W.copy(W.commentsForClaude(), W.plural(openN, "open comment") + " for Claude"); }}>Copy open for Claude</${Btn}></div>
          <div class="row" style=${{gap:"10px"}}><${Switch} on=${pr.pins !== false} label="Show pins when not commenting" onChange=${function(v){ W.ui(function(uu){ uu.proto = Object.assign({}, uu.proto, {pins:v}); }); }} /><span class="small">Show pins when not commenting</span></div>
          <div class="row" style=${{gap:"10px"}}><${Switch} on=${!!pr.showDone} label="Show done comments too" onChange=${function(v){ W.ui(function(uu){ uu.proto = Object.assign({}, uu.proto, {showDone:v}); }); }} /><span class="small">Show done comments too</span></div>
          <span class="hint">${W.CM.src === "shared" ? "Kept with this page: they follow you to any device and Claude can read them directly." : "Kept in this browser. Use Copy open for Claude to hand them over."}</span>
        </div></${Row}>
    </${W.Fragment}>` : null}
  </${W.Fragment}>`;
}

var VIEW = {profile:Profile, appearance:Appearance, day:Day, keyboard:Keyboard, notifications:Notifications, team:TeamMoney, prototype:Prototype,
  search:function(){ return W.SearchRules ? html`<${W.SearchRules} />` : null; },
  facts:function(){ return W.FactsTool ? html`<div class="card tight"><${W.FactsTool} /></div>` : null; },
  writing:function(){ return W.RulesTool ? html`<div class="card tight"><${W.RulesTool} /></div>` : null; },
  connections:function(){ return W.HealthTool ? html`<div class="card tight"><${W.HealthTool} /></div>` : null; }};
var NOTE = {search:"Every search uses these from its next keyword. Also on Find › Search.", facts:"The numbers the audience check, pricing and sending read. Change one and every check uses it at once.", writing:"Every Gemini draft says which of these it followed.", connections:"Whether the pieces behind the app are connected and working."};

function Results(p){
  var q = p.q.toLowerCase(), rows = ROWS.filter(function(r){ var s = secOf(r[0]); return visible(s) && rowShown(r) && (r[2] + " " + r[3] + " " + s.name).toLowerCase().indexOf(q) >= 0; });
  var secs = SECTIONS.filter(function(s){ return visible(s) && (s.name + " " + s.sub + " " + s.kw).toLowerCase().indexOf(q) >= 0; });
  if (!rows.length && !secs.length) return html`<div class="card"><${W.Empty} icon="search" title=${"No setting matches “" + p.q + "”"}>Try a plainer word: dark, hours, keys, money, Gmail.</${W.Empty}></div>`;
  return html`<div class="col">
    ${rows.length ? html`<div class="card tight">${rows.map(function(r){ var s = secOf(r[0]); return html`<button key=${r[1]} type="button" class="li" onClick=${function(){ p.clear(); W.openSetting(r[0], r[1]); }}><span class="tb-ic"><${Icon} n=${s.icon} s=${15} /></span><span class="lt"><b>${r[2]}</b><small>${s.name}</small></span><${Icon} n="chevR" cls="flip" /></button>`; })}</div>` : null}
    ${secs.length ? html`<div class="card tight">${secs.map(function(s){ return html`<button key=${s.k} type="button" class="li" onClick=${function(){ p.clear(); W.go("settings", s.k); }}><span class="tb-ic"><${Icon} n=${s.icon} s=${15} /></span><span class="lt"><b>${s.name}</b><small>${s.sub}</small></span><${Icon} n="chevR" cls="flip" /></button>`; })}</div>` : null}
  </div>`;
}
/* owner tools only exist for the person signed in as owner (even while they see the app as someone else) */
function visible(s){ return !s.realOwner || W.accountIsOwner(); }
function rowShown(r){ return r[0] !== "prototype" || r[1] === "proto" || W.protoOn(); }

W.screens.settings = function(){
  var st = W.useApp(), u = st.ui, tab = u.route.tab || "profile", sec = secOf(tab) || SECTIONS[0];
  var q = useState(""), inp = useRef(null);
  W.useKeys({"mod+f":function(){ if (inp.current){ inp.current.focus(); return true; } return false; }});
  var groups = ["You", "Agency", "Owner tools"];
  if (!visible(sec)) sec = SECTIONS[0];
  var View = VIEW[sec.k], locked = sec.owner && !sec.realOwner && !isOwner();
  return html`<div class="page">
    <${W.PageHead} title="Settings" sub="How the Workbench behaves for you, on this computer and for the whole team. Changes apply at once; Ctrl Z undoes them."
      right=${html`<label class="set-search"><${Icon} n="search" /><input ref=${inp} value=${q[0]} onInput=${function(e){ q[1](e.target.value); }} onKeyDown=${function(e){ if (e.key === "Escape"){ e.preventDefault(); q[1](""); e.target.blur(); } }} placeholder="Find a setting" aria-label="Find a setting" /></label>`} />
    <div class="set" data-why="settings">
      <nav class="card tight set-nav" aria-label="Settings sections">
        ${groups.map(function(g){ var ss = SECTIONS.filter(function(s){ return s.g === g && visible(s); }); return ss.length ? html`<div key=${g} class="bucket"><div class="bucket-h">${g}</div>
          ${ss.map(function(s){ return html`<button key=${s.k} type="button" class="li" aria-current=${!q[0] && s.k === sec.k ? "page" : null} onClick=${function(){ q[1](""); W.go("settings", s.k); }}>
            <span class="tb-ic"><${Icon} n=${s.icon} s=${15} /></span><span class="lt"><b>${s.name}</b><small>${s.sub}</small></span>${s.k === "prototype" && W.protoOn() ? html`<span class="cnt hot">On</span>` : null}</button>`; })}</div>` : null; })}
      </nav>
      <div class="col" style=${{minWidth:0}}>
        ${q[0].trim() ? html`<${Results} q=${q[0].trim()} clear=${function(){ q[1](""); }} />` : html`<div class="card set-pane" key=${sec.k}>
          <div class="row top" style=${{gap:"12px"}}><span class="tb-ic" style=${{width:"36px", height:"36px", borderRadius:"10px"}}><${Icon} n=${sec.icon} s=${18} /></span><div class="grow col t2"><h2>${sec.name}</h2><p class="small ink2">${NOTE[sec.k] || sec.sub}${sec.g === "Agency" ? " Applies to the whole team." : ""}</p></div></div>
          ${locked ? html`<${Locked} what=${sec.name.toLowerCase()} />` : html`<${View} />`}
        </div>`}
      </div>
    </div>
  </div>`;
};
})();
