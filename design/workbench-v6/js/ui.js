/* ui.js — small, consistent building blocks + V6 Modals, Deal Lifecycle Ribbon, Star Rubric, and QuickDraft Dock. */
(function(){
"use strict";
var W = window.W, html = W.html, Icon = W.Icon, useState = W.useState;

W.Btn = function(p){
  return html`<button type="button" class=${W.cx("btn", p.kind, p.size, p.cls)} onClick=${p.onClick} disabled=${p.disabled} data-tip=${p.tip || null} data-kbd=${p.tip ? p.kbd || null : null} aria-label=${p.label || null} id=${p.id || null} style=${p.style || null}>
    ${p.icon ? html`<${Icon} n=${p.icon} cls=${p.iconCls} />` : null}${p.children}${p.kbd && (p.kind === "pri" || !p.tip) ? html`<span class="kbd">${p.kbd}</span>` : null}${p.caret ? html`<${Icon} n="chevD" s=${14} />` : null}
  </button>`;
};
W.IconBtn = function(p){
  return html`<button type="button" class=${W.cx("iconbtn", p.cls)} onClick=${p.onClick} aria-label=${p.label} data-tip=${p.label} data-kbd=${p.kbd || null} aria-pressed=${p.pressed == null ? null : String(!!p.pressed)} disabled=${p.disabled}>
    <${Icon} n=${p.icon} s=${p.s || 17} cls=${p.iconCls} />${p.badge ? html`<span class="badge">${p.badge}</span>` : null}
  </button>`;
};
W.Kbd = function(p){ return html`<span class="kbd">${p.children}</span>`; };
W.Tag = function(p){
  return html`<span class=${W.cx("tag", p.tone, p.hue ? "ph" : null, p.cls)} style=${p.hue ? {"--hue":p.hue} : null} data-tip=${p.tip || null}>${p.icon ? html`<${Icon} n=${p.icon} />` : null}${p.children}</span>`;
};
W.Stars = function(p){
  var n = W.clamp(p.n || 4, 1, 5), s = "";
  for (var i = 0; i < 5; i++) s += i < n ? "★" : "☆";
  return html`<span class="stars" data-tip=${"INF-QUAL-02 Qualification Rubric: " + n + " of 5 stars"}>${s}</span>`;
};
W.Av = function(p){
  var m = p.id ? W.member(p.id) : null, name = m ? m.name : p.name || "?";
  var self = m && m.id === "u1", pr = self ? (W.U().profile || {}) : {}, named = !self || !!W.myName();
  var bg = p.color || (self ? W.avColor("owner") : W.avColor(p.seed || name));
  var cls = W.cx("av", p.size, p.sq ? "sq" : null);
  var face = self && pr.avatar && !pr.local ? html`<img src=${pr.avatar} alt="" />` : named ? W.initials(name) : html`<${Icon} n="user" s=${p.size === "xl" ? 24 : p.size === "l" ? 20 : 14} />`;
  return html`<span class=${cls} style=${{background:bg}} data-tip=${p.tip === false ? null : (m ? m.name + (m.role ? " · " + m.role : "") : p.tip || null)} aria-label=${name}>${face}${p.status ? html`<i class=${W.cx("dot", p.status === "away" ? "away" : null)}></i>` : null}</span>`;
};
W.CAv = function(p){ var c = p.c; return html`<${W.Av} name=${c.name} seed=${c.handle} size=${p.size} sq=${p.sq} tip=${false} />`; };
W.BAv = function(p){ var b = p.b; return html`<${W.Av} name=${b.name} seed=${b.name + "brand"} size=${p.size} sq=${true} tip=${false} />`; };
W.Due = function(p){
  if (!p.ts) return null;
  if (p.age) return html`<span class="due" data-tip=${W.fmtDate(p.ts) + " " + W.fmtTime(p.ts)}><${Icon} n="clock" />${W.ago(p.ts).replace(" ago", "")}</span>`;
  var tone = W.dueTone(p.ts);
  return html`<span class=${W.cx("due", tone)} data-tip=${W.fmtDate(p.ts)}>${tone === "late" ? html`<${Icon} n="alert" />` : html`<${Icon} n="calendar" />`}${W.dueText(p.ts)}</span>`;
};
W.Meter = function(p){
  var pct = W.clamp(100 * (p.v || 0) / (p.max || 1), 0, 100);
  return html`<span class=${W.cx("meter", p.tone)} style=${{width:p.w || 80}} role="meter" aria-valuenow=${p.v} aria-valuemax=${p.max} aria-label=${p.label || null}><i style=${{width:pct + "%"}}></i></span>`;
};
W.Steps = function(p){
  return html`<div class="steps" style=${p.hue ? {"--hue":p.hue} : null} role="img" aria-label=${"Step " + (p.at + 1) + " of " + p.steps.length + ": " + p.steps[p.at]}>
    ${p.steps.map(function(s, i){ return html`<div key=${i} class=${W.cx("st", i < p.at ? "done" : i === p.at ? "now" : null)} data-tip=${p.tips ? p.tips[i] : null}><i></i><span>${s}</span></div>`; })}
  </div>`;
};
/* V6 F4: Interactive 10-Step Deal Lifecycle Ribbon */
W.DealRibbon = function(p){
  var x = p.x; if (!x) return null;
  return html`<div class="lc-ribbon" role="navigation" aria-label="10-Step Deal Lifecycle Ribbon">
    ${W.DEAL_FLOW.map(function(s, i){
      var isCur = x.step === i, isDone = i < x.step;
      return html`<button key=${s.k} type="button" class=${W.cx("lc-pill", isCur ? "on" : isDone ? "done" : null)} onClick=${function(){ W.A.jumpDealStep(x.id, i); }} data-tip=${"Step " + (i + 1) + " of 10: " + s.name + " (click to jump)"}>
        <span class="c">${isDone ? "✓" : i + 1}</span><span>${s.name}</span>
      </button>`;
    })}
  </div>`;
};
W.Tabs = function(p){
  return html`<div class="tabs" role="tablist" style=${p.hue ? {"--hue":p.hue} : null}>
    ${p.tabs.map(function(t){ return html`<button key=${t[0]} type="button" role="tab" aria-selected=${String(p.cur === t[0])} onClick=${function(){ p.onPick(t[0]); }} data-why=${t[3] || null}>${t[1]}${t[2] ? html`<span class="cnt">${t[2]}</span>` : null}</button>`; })}
  </div>`;
};
W.Seg = function(p){
  return html`<div class="seg" role="group" aria-label=${p.label || null}>
    ${p.opts.map(function(o){ return html`<button key=${o[0]} type="button" aria-pressed=${String(p.cur === o[0])} onClick=${function(){ p.onPick(o[0]); }} data-tip=${o[3] || null}>${o[2] ? html`<${Icon} n=${o[2]} s=${14} />` : null}${o[1]}</button>`; })}
  </div>`;
};
W.Empty = function(p){
  return html`<div class="empty"><span class="ei"><${Icon} n=${p.icon || "checkc"} s=${20} /></span><b>${p.title}</b>${p.children ? html`<p class="hint" style=${{maxWidth:"46ch"}}>${p.children}</p>` : null}${p.action || null}</div>`;
};
W.Callout = function(p){ return html`<div class=${W.cx("callout", p.tone)}><${Icon} n=${p.icon || (p.tone === "warn" || p.tone === "crit" ? "alert" : p.tone === "good" ? "checkc" : "info")} /><div class="grow">${p.children}</div>${p.right || null}</div>`; };
W.Field = function(p){ return html`<label class="field" style=${p.style || null}>${p.label}${p.children}${p.hint ? html`<span class="hint">${p.hint}</span>` : null}</label>`; };
W.Stat = function(p){ return html`<div class="stat" data-tip=${p.tip || null}><b>${p.v}</b><small>${p.l}</small></div>`; };
W.PageHead = function(p){
  return html`<div class="ph" style=${p.hue ? {"--hue":p.hue} : null}>
    <div class="t grow"><h1>${p.title}</h1>${p.sub ? html`<p>${p.sub}</p>` : null}</div>
    ${p.right || null}
  </div>`;
};
W.Section = function(p){
  return html`<section class="col" style=${{gap:"10px"}} data-why=${p.why || null}>
    <div class="card-h"><h3>${p.title}${p.count != null ? html` <span class="muted" style=${{fontWeight:400}}>${p.count}</span>` : null}</h3>${p.right || null}</div>
    ${p.children}
  </section>`;
};

W.Countries = function(p){
  var cs = p.countries || [];
  if (!cs.length) return html`<span class="muted small">Audience not known yet</span>`;
  var ok = ["US","GB","CA","AU"];
  return html`<div class="col tight" style=${{gap:"5px"}}>
    <div class="cbar" aria-hidden="true">${cs.map(function(c){ return html`<i key=${c[0]} style=${{width:c[1] + "%", background:ok.indexOf(c[0]) >= 0 ? "var(--accent)" : "var(--line-2)"}}></i>`; })}<i style=${{flex:1, background:"transparent"}}></i></div>
    <div class="row wrap small" style=${{gap:"4px 10px"}}>${cs.map(function(c){ return html`<span key=${c[0]} class=${ok.indexOf(c[0]) >= 0 ? "" : "muted"} data-tip=${W.COUNTRY[c[0]] || c[0]}><b class="num" style=${{fontWeight:600}}>${c[1]}%</b> ${c[0]}</span>`; })}</div>
  </div>`;
};
W.Fit = function(p){
  var f = W.fit(p.c), s = f.score, tone = s >= 70 ? "var(--good)" : s >= 50 ? "var(--warn)" : "var(--crit)";
  var tip = "Fit " + s + "/100 · " + f.parts.map(function(x){ return x.k + " " + x.pts + "/" + x.of; }).join(" · ");
  var r = 8, C = 2 * Math.PI * r;
  return html`<span class="fit" data-tip=${tip}><svg viewBox="0 0 22 22" width="20" height="20" aria-hidden="true" style=${{transform:"rotate(-90deg)"}}><circle cx="11" cy="11" r=${r} fill="none" stroke="var(--sunk-2)" stroke-width="3"/><circle cx="11" cy="11" r=${r} fill="none" stroke=${tone} stroke-width="3" stroke-dasharray=${C} stroke-dashoffset=${C * (1 - s / 100)} stroke-linecap="round"/></svg><span>${s}</span>${p.label ? html`<span class="muted" style=${{fontWeight:400}}>fit</span>` : null}</span>`;
};
W.FitParts = function(p){
  var f = W.fit(p.c);
  return html`<div class="col tight">${f.parts.map(function(x){ return html`<div key=${x.k} class="row small" style=${{gap:"10px"}}>
    <span style=${{width:"150px"}} class="ink2">${x.k}</span><${W.Meter} v=${x.pts} max=${x.of} w=${70} tone=${x.pts / x.of >= .66 ? "good" : x.pts / x.of >= .33 ? "warn" : "crit"} /><span class="num muted" style=${{width:"42px"}}>${x.pts}/${x.of}</span><span class="muted ell">${x.note}</span></div>`; })}</div>`;
};

var THUMB = [["#0f4c81","#1b9aaa"],["#5b2a86","#c2185b"],["#1d3557","#e63946"],["#264653","#2a9d8f"],["#3d2c8d","#916bbf"],["#7f2b0a","#e85d04"],["#0b3d2e","#3a7d44"],["#22223b","#6d6a9c"],["#003049","#d62828"],["#2b2d42","#ef233c"],["#14213d","#fca311"],["#3c096c","#ff6d00"]];
function wrapWords(t, n){ var w = t.toUpperCase().split(/\s+/), lines = [], cur = ""; w.forEach(function(x){ if ((cur + " " + x).trim().length > n && cur){ lines.push(cur); cur = x; } else cur = (cur + " " + x).trim(); }); if (cur) lines.push(cur); return lines.slice(0, 3); }
W.Thumb = function(p){
  var v = p.v, h = W.hash(v.t), pal = THUMB[h % THUMB.length], left = h % 2 === 0, lines = wrapWords(v.t, 15);
  var gid = "g" + h;
  return html`<div class="thumb" style=${p.style || null}>
    <svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs><linearGradient id=${gid} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color=${pal[0]} /><stop offset="1" stop-color=${pal[1]} /></linearGradient></defs>
      <rect width="320" height="180" fill=${"url(#" + gid + ")"} />
      <circle cx=${left ? 250 : 70} cy="112" r="58" fill="rgba(0,0,0,.22)" />
      <circle cx=${left ? 250 : 70} cy="86" r="26" fill="rgba(255,255,255,.18)" />
      <rect x=${left ? 18 : 140} y="22" width="40" height="5" rx="2.5" fill="rgba(255,255,255,.85)" />
      ${lines.map(function(l, i){ return html`<text key=${i} x=${left ? 18 : 140} y=${58 + i * 30} fill="#fff" font-family="Readex Pro, Segoe UI, sans-serif" font-weight="700" font-size="25" style=${{paintOrder:"stroke", stroke:"rgba(0,0,0,.25)", strokeWidth:3}}>${l}</text>`; })}
    </svg>
    ${v.dur ? html`<span class="dur">${v.dur}</span>` : null}
    ${p.children || null}
  </div>`;
};
var BAN = [
  {bg:["#0b1026","#1c2f7a"], ac:"#7cf3ff", ink:"#ffffff"}, {bg:["#140b2e","#5a1e8c"], ac:"#ff7ad9", ink:"#ffffff"},
  {bg:["#f6f1e8","#e9dfcc"], ac:"#ff5a36", ink:"#1b1b1b", light:true}, {bg:["#04130d","#0d3525"], ac:"#3dff9a", ink:"#e9fff3"},
  {bg:["#121212","#2b2b2b"], ac:"#ffcc33", ink:"#ffffff"}, {bg:["#0a2a43","#0f6f8f"], ac:"#ffd166", ink:"#ffffff"},
  {bg:["#2b0f12","#7a1f2b"], ac:"#ffb199", ink:"#fff4ef"}, {bg:["#eef3ff","#d3e0ff"], ac:"#3355ff", ink:"#0d1b4c", light:true}];
var BTAG = ["New AI tools, tested every week","Agents and automations, explained","Build with LLMs, step by step","AI news without the hype","Honest reviews for builders","Prompts, workflows and teardowns"];
var BDAY = ["NEW VIDEOS EVERY TUESDAY","NEW VIDEOS MON & THU","EVERY FRIDAY","TWICE A WEEK","NEW VIDEO EVERY SUNDAY"];
var CODE = ["> agent.run({ task: \"summarise inbox\" })","tokens: 4,096 · temperature 0.2","for step in plan: tools.call(step)","embedding = model.encode(chunk)","> claude --resume session","retrieval@k=8 · rerank → top 3"];
function rng(seed){ var x = seed % 2147483647 || 7; return function(){ x = x * 16807 % 2147483647; return x / 2147483647; }; }
W.hasBanner = function(c){ return !!c && W.hash(c.handle + "b") % 7 !== 0; };
W.Banner = function(p){
  var c = p.c; if (!W.hasBanner(c)) return null;
  var h = W.hash(c.handle + "b"), pal = BAN[h % BAN.length], st = (h >>> 4) % 5, tag = BTAG[(h >>> 7) % BTAG.length], day = BDAY[(h >>> 10) % BDAY.length], R = rng(h);
  var gid = "bn" + h, L = 547, nm = st === 4 ? c.name.toUpperCase() : c.name, fs = Math.min(132, Math.round(1380 / (nm.length * (st === 4 ? .66 : st === 3 ? .62 : .56))));
  var font = st === 3 ? "IBM Plex Mono, Consolas, monospace" : "Readex Pro, Segoe UI, sans-serif";
  var art = [];
  if (st === 0){ for (var i = -14; i <= 14; i++) art.push(html`<line key=${"v" + i} x1="1280" y1="250" x2=${1280 + i * 190} y2="423" stroke=${pal.ac} stroke-opacity=".28" stroke-width="2" />`);
    [262, 285, 318, 362, 423].forEach(function(y, k){ art.push(html`<line key=${"h" + k} x1="0" y1=${y} x2="2560" y2=${y} stroke=${pal.ac} stroke-opacity=${.18 + k * .04} stroke-width="2" />`); });
    art.push(html`<circle key="g" cx="1900" cy="150" r="170" fill=${pal.ac} fill-opacity=".14" />`); }
  if (st === 1){ var pts = []; for (var j = 0; j < 26; j++) pts.push([R() * 2560, 30 + R() * 363]);
    pts.forEach(function(a, k){ var b = pts[(k + 1) % pts.length], e = pts[(k + 5) % pts.length]; art.push(html`<line key=${"l" + k} x1=${a[0]} y1=${a[1]} x2=${b[0]} y2=${b[1]} stroke=${pal.ac} stroke-opacity=".22" stroke-width="2" />`); if (k % 3 === 0) art.push(html`<line key=${"m" + k} x1=${a[0]} y1=${a[1]} x2=${e[0]} y2=${e[1]} stroke=${pal.ac} stroke-opacity=".12" stroke-width="2" />`); art.push(html`<circle key=${"c" + k} cx=${a[0]} cy=${a[1]} r=${5 + R() * 9} fill=${pal.ac} fill-opacity=${.35 + R() * .5} />`); }); }
  if (st === 2){ for (var w = 0; w < 6; w++){ var y0 = 60 + w * 62, a1 = 40 + R() * 70; art.push(html`<path key=${"w" + w} d=${"M0 " + y0 + " C 640 " + (y0 - a1) + ", 1280 " + (y0 + a1) + ", 1920 " + y0 + " S 2560 " + (y0 - a1 / 2) + ", 2560 " + y0} fill="none" stroke=${pal.ac} stroke-opacity=${.18 + w * .07} stroke-width="3" />`); } }
  if (st === 3){ for (var r = 0; r < 7; r++) art.push(html`<text key=${"t" + r} x=${(r % 2) * -260 + 40} y=${48 + r * 58} fill=${pal.ac} fill-opacity=".13" font-family="IBM Plex Mono, Consolas, monospace" font-size="34">${(CODE[r % CODE.length] + "      " + CODE[(r + 3) % CODE.length] + "      " + CODE[(r + 1) % CODE.length]).slice(0, 140)}</text>`); }
  if (st === 4){ art.push(html`<circle key="a" cx="2080" cy="330" r="300" fill=${pal.ac} fill-opacity=".9" />`, html`<circle key="b" cx="1830" cy="40" r="150" fill=${pal.ink} fill-opacity=".1" />`, html`<rect key="c" x="0" y="372" width="2560" height="51" fill=${pal.ac} fill-opacity=".9" />`); }
  var tx = st === 1 ? 1280 : L, anchor = st === 1 ? "middle" : "start";
  return html`<div class=${W.cx("banner", p.cls)} data-why="banner" role="img" aria-label=${c.name + "'s channel banner"}>
    <svg viewBox="0 0 2560 423" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs><linearGradient id=${gid} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color=${pal.bg[0]} /><stop offset="1" stop-color=${pal.bg[1]} /></linearGradient></defs>
      <rect width="2560" height="423" fill=${"url(#" + gid + ")"} />
      ${art}
      <text x=${tx} y=${st === 1 ? 222 : 196} text-anchor=${anchor} fill=${st === 3 ? pal.ac : pal.ink} font-family=${font} font-weight="700" font-size=${fs} letter-spacing=${st === 4 ? 4 : -1}>${st === 3 ? "> " : ""}${nm}${st === 3 ? "_" : ""}</text>
      <text x=${tx} y=${st === 1 ? 290 : 262} text-anchor=${anchor} fill=${pal.ink} fill-opacity=".82" font-family=${font} font-weight="400" font-size="46">${tag}</text>
      ${st === 1 ? null : html`<g><rect x=${L} y="296" width=${day.length * 21 + 44} height="54" rx="27" fill=${pal.ac} fill-opacity=${st === 4 ? 0 : .16} stroke=${pal.ac} stroke-opacity=".7" stroke-width="2" /><text x=${L + 22} y="332" fill=${pal.light ? pal.ink : pal.ac} font-family="Readex Pro, Segoe UI, sans-serif" font-weight="600" font-size="28" letter-spacing="3">${day}</text></g>`}
    </svg>
  </div>`;
};
W.Vid = function(p){ var v = p.v; return html`<div class="vid"><${W.Thumb} v=${v} /><b>${v.t}</b><small class="num">${W.fmtK(v.v)} views · ${v.ago === 0 ? "today" : v.ago + " days ago"}</small></div>`; };

W.Owner = function(p){
  var ref = p.refx, o = W.rec(ref), id = o && o.owner;
  function open(e){ e.stopPropagation(); W.menu(e, [{head:"Who has it"}].concat(W.D().team.map(function(m){ return {label:m.name + (m.id === id ? "  ✓" : ""), icon:"user", hint:m.role, run:function(){ if (m.id !== id) W.A.assign(ref, m.id); }}; }))); }
  return html`<button type="button" class="btn ghost sm" onClick=${open} data-tip="Change who has it" data-why="owner">${id ? html`<${W.Av} id=${id} size="s" tip=${false} />` : html`<${Icon} n="user" />`}${id ? W.member(id).name : "Nobody"}<${Icon} n="chevD" s=${13} /></button>`;
};

W.snoozeItems = function(key, title){
  function at(day, hh){ return W.at(day, hh, 0); }
  var dow = new Date(W.NOW).getDay(), toMon = ((8 - dow) % 7) || 7, mo = W.morning(), hm = ("0" + mo).slice(-2) + ":00";
  return [{head:"Bring it back"},
    {label:"Later today", hint:"15:00", icon:"clock", run:function(){ W.A.snooze(key, at(0, 15), title); }},
    {label:"Tomorrow morning", hint:W.fmtDate(at(1)) + " " + hm, icon:"sun", run:function(){ W.A.snooze(key, at(1, mo), title); }},
    {label:"Next Monday", hint:W.fmtDate(at(toMon)) + " " + hm, icon:"calendar", run:function(){ W.A.snooze(key, at(toMon, mo), title); }},
    {label:"In two weeks", hint:W.fmtDate(at(14)), icon:"calendar", run:function(){ W.A.snooze(key, at(14, mo), title); }}];
};
W.handItems = function(key, ref, title){
  return [{head:"Hand it to"}].concat(W.D().team.filter(function(m){ return m.id !== W.D().me; }).map(function(m){
    return {label:m.name, hint:m.role + (m.status === "away" ? " · away" : ""), icon:"forward", run:function(){ W.ui(function(u){ u.handoff = {key:key, ref:ref, to:m.id, title:title, note:""}; }); }};
  }));
};

W.Timeline = function(p){
  var ev = p.events;
  if (!ev.length) return html`<p class="hint">Nothing has happened here yet.</p>`;
  return html`<ul class="timeline">${ev.map(function(e, i){ return html`<li key=${i}><span class="td"><${Icon} n=${e.icon || "dot"} /></span><div class="tx">${e.text}<small>${W.fmtDate(e.at)} · ${W.fmtTime(e.at)}${e.who ? " · " + W.member(e.who).name : ""}</small></div></li>`; })}</ul>`;
};
W.eventsFor = function(ref){
  var d = W.D(), out = [], o = W.rec(ref);
  W.threadOf(ref).forEach(function(m){ out.push({at:m.at, icon:m.dir === "in" ? "reply" : "send", text:m.dir === "in" ? (m.ai ? "They replied: " + m.ai.intent.toLowerCase() : "They replied") + (m.pasted ? " (pasted in)" : "") : (m.scheduled ? "Email scheduled" : "Email sent") + (m.mailbox ? " from " + m.mailbox : ""), who:m.by}); });
  d.log.forEach(function(l){ if (l.ref && l.ref.t === ref.t && l.ref.id === ref.id) out.push({at:l.at, icon:"check", text:l.text, who:l.who}); });
  if (ref.t === "creator" && o){ out.push({at:o.found, icon:"scan", text:o.run ? "Found by a search run" : "Added to the pipeline"}); if (o.kit) out.push({at:o.kit.at, icon:"file", text:"Media kit received" + (o.kit.file ? ": " + o.kit.file : "")}); }
  if (ref.t === "deal" && o){ out.push({at:o.created, icon:"box", text:"Deal created"}); if (o.invoice.sent) out.push({at:o.invoice.sent, icon:"wallet", text:"Invoice " + o.invoice.no + " sent"}); if (o.invoice.paid) out.push({at:o.invoice.paid, icon:"unlock", text:"Brand paid " + W.money(o.price)}); if (o.paidCreator) out.push({at:o.paidCreator, icon:"wallet", text:"Creator paid " + W.money(o.payout)}); }
  var seen = {};
  return out.filter(function(e){ var k = e.at + e.text; if (seen[k]) return false; seen[k] = 1; return true; }).sort(W.by(function(e){ return e.at; }, -1));
};

/* ---------- V6 F2: Universal Inline Composer Dock (#quickdraft) ---------- */
W.QuickDraftDock = function(){
  var u = W.U(), qd = u.quickDraft;
  if (!qd || !qd.id) return null;
  var q = W.draft(qd.id);
  if (!q) return null;
  var o = W.rec(q.to);
  return html`<aside class=${W.cx("qdock", qd.min ? "min" : null)} role="region" aria-label="Inline Email Composer">
    <div class="qdock-h">
      <${Icon} n="send" s=${15} />
      <b class="grow ell">QuickDraft · ${(W.KIND[q.kind] || "Email") + " to " + (o ? o.name : "?")}</b>
      <span class="tiny" style=${{opacity:.8}}>Stay on this screen · no teleporting</span>
      <button type="button" class="iconbtn" onClick=${function(){ W.ui(function(uu){ uu.quickDraft = Object.assign({}, uu.quickDraft, {min:!qd.min}); }); }} aria-label=${qd.min ? "Expand composer" : "Minimize composer"} data-tip=${qd.min ? "Expand" : "Minimize"}><${Icon} n=${qd.min ? "chevU" : "chevD"} s=${14} /></button>
      <button type="button" class="iconbtn" onClick=${W.closeQuickDraft} aria-label="Close composer" data-tip="Close (stays in Today queue)"><${Icon} n="x" s=${14} /></button>
    </div>
    ${qd.min ? null : html`<div class="qdock-b"><${W.DraftCard} key=${q.id} q=${q} primary=${true} /></div>`}
  </aside>`;
};

/* ---------- V6 System 7, 10, 11, 15: Printable & Interactive Agency Modals ---------- */
W.AgencyModal = function(){
  var u = W.U(), m = u.modal;
  var showPricingSt = useState(false), showPricing = showPricingSt[0], setShowPricing = showPricingSt[1];
  var callGoalSt = useState("Direct developer trial signups + brand recall"), callKpiSt = useState("$40 CPM · 1.35%+ link CTR"), callTimeSt = useState("Mid-November release window · Call 2 on Thursday 14:00 EST");
  function close(){ W.ui(function(uu){ uu.modal = null; }); }
  W.useKeys({escape:close}, !!m, {barrier:true});
  if (!m) return null;

  /* 1. Brand-Safe Talent Roster & Media Kit Packet (W.MediaKitModal — System 7, BRD-PRES-04/15/18, BRD-OBJ-21) */
  if (m.kind === "mediakit"){
    var b = W.brand(m.brandId) || W.D().brands[0];
    var cids = (m.creatorIds && m.creatorIds.length) ? m.creatorIds : W.D().creators.filter(function(c){ return c.stage === "signed"; }).slice(0, 3).map(function(c){ return c.id; });
    var cs = cids.map(W.creator).filter(Boolean);
    var pkgs = W.buildPackagesFor(b, cs);
    return html`<${W.Fragment}><div class="scrim" onClick=${close}></div>
      <div class="modal xl" role="dialog" aria-label="Brand Talent Roster & Media Kit Packet">
        <div class="row wrap no-print">
          <${W.Tag} hue="var(--close)" icon="shield">Brand-Safe Packet (BRD-PRES-04 · Creator Net Rates & Personal Contacts Stripped)</${W.Tag}>
          <span class="sp"></span>
          <label class="row small" style=${{gap:"6px", cursor:"pointer"}}><input type="checkbox" checked=${showPricing} onChange=${function(){ setShowPricing(!showPricing); }} />Include 3-Option Package Pricing (HC-26)</label>
          <${W.Btn} size="sm" icon="printer" onClick=${function(){ window.print(); }}>Print / Save PDF</${W.Btn}>
          <${W.Btn} size="sm" kind="pri" icon="copy" onClick=${function(){
            var txt = "GRATOVO TALENT PACKET FOR " + b.name.toUpperCase() + "\n\n" + cs.map(function(c, i){
              return (i+1) + ". " + c.name + " (" + c.handle + " · youtube.com/" + c.handle + ")\n" +
                "   • 12-Video Trimmed Avg Views: " + W.fmtK(c.trimmedAvgViews || c.median) + " per upload (" + c.viewStability + ")\n" +
                "   • Verified YouTube Studio Audience (90d): " + c.countries.map(function(x){ return x[0] + " " + x[1] + "%"; }).join(" · ") + " · Age " + c.age + "\n" +
                "   • Why They Fit " + b.name + ": Hands-on technical educator; past integrations with " + (c.sponsors.join(", ") || "AI tools") + " averaged 1.38%+ CTR.";
            }).join("\n\n");
            W.copy(txt, "Brand Talent Packet");
          }}>Copy 4-Line Blocks</${W.Btn}>
          <${W.IconBtn} icon="x" label="Close" onClick=${close} />
        </div>
        <div class="doc-sheet">
          <div class="doc-head">
            <div>
              <span class="tiny mono muted">GRATOVO CREATOR PARTNERSHIPS · VERIFIED AUDIENCE PACKET</span>
              <h2>Curated Creator Roster for ${b.name}</h2>
              <span class="small ink2">Prepared for ${b.contact || "Partnerships Team"} (${b.sells}) · ${W.fmtDate(W.NOW)}</span>
            </div>
            <div class="col t2" style=${{textAlign:"end"}}>
              <${W.Tag} tone="good" icon="check">Proof of Representation Verified (BRD-OBJ-21)</${W.Tag}>
              <span class="tiny muted">90-Day YouTube Studio Demographics Attached</span>
            </div>
          </div>
          <div class="col" style=${{gap:"12px"}}>
            ${cs.map(function(c, idx){
              var mt = W.match(b, c);
              return html`<div key=${c.id} class="card tight" style=${{border:"1px solid var(--line-2)"}}>
                <div class="row wrap">
                  <${W.CAv} c=${c} size="l" />
                  <div class="grow col t2">
                    <div class="row wrap"><h3 style=${{fontSize:"1.05rem"}}>${idx + 1}. ${c.name} <span class="muted mono" style=${{fontWeight:400}}>${c.handle}</span></h3><${W.Stars} n=${c.starRating || 5} /><${W.Tag} tone="good" icon="check">Studio Analytics Verified</${W.Tag}></div>
                    <span class="small ink2"><b>Line 1 (Channel & Format):</b> ${c.format || "Talking-head + screen"} · Next open upload slot: <b>${W.fmtDate(c.nextOpenSlot || W.at(10))}</b></span>
                    <span class="small ink2"><b>Line 2 (Views & Stability — BRD-PRES-04):</b> <b>${W.fmtK(c.trimmedAvgViews || c.median)}</b> 12-video outlier-trimmed avg views (${W.fmtK(c.median)} 30d median · ${c.viewStability}) · ${c.eng}% engagement</span>
                    <span class="small ink2"><b>Line 3 (Top Geographies & Buying Age):</b> ${c.countries.map(function(k){ return k[0] + " " + k[1] + "%"; }).join(" · ")} · Core age <b>${c.age}</b></span>
                    <span class="small ink2"><b>Line 4 (Why ${c.name} Fits ${b.name}):</b> ${mt.why.join(" · ") || ("Technical developer audience actively building with " + b.sells.toLowerCase())}</span>
                  </div>
                  ${showPricing && W.canSeeMoney() ? html`<div class="col t2" style=${{textAlign:"end"}}><span class="tiny muted">60–90s First-Third Integration</span><b class="num" style=${{fontSize:"1.2rem"}}>${W.money(W.priceFor(c))}</b><span class="tiny muted">Dedicated 8–12m: ${W.money(W.priceFor(c, {format:"dedicated"}))}</span></div>` : null}
                </div>
              </div>`;
            })}
          </div>
          ${showPricing && W.canSeeMoney() ? html`<div class="card flat tight">
            <h4>Recommended Campaign Packages for ${b.name} (HC-26 · EX-33)</h4>
            <div class="grid3">
              ${pkgs.map(function(pk){ return html`<div key=${pk.k} class="card tight"><b style=${{color:"var(--close)"}}>${pk.name}</b><b class="num" style=${{fontSize:"1.3rem"}}>${W.money(pk.price)}</b><span class="small ink2">${pk.desc}</span></div>`; })}
            </div>
          </div>` : html`<div class="callout info"><${Icon} n="info" /><span class="small">Discovery Packet Mode (HC-14 / BRD-PRES-18): Pricing is hidden so you can walk the buyer through creator fit and audience proof on the call first. Toggle "Include 3-Option Package Pricing" above for post-call proposals.</span></div>`}
        </div>
      </div></${W.Fragment}>`;
  }

  /* 2. Side-by-Side Brand IO vs. Mirrored Creator Contract Preview (W.ContractPreviewModal — System 11, INF-CLOSE-03/04, BRD-CONTRACT-08/09) */
  if (m.kind === "contract"){
    var x = W.deal(m.dealId) || W.D().deals[0];
    var b = W.brand(x.brand), c = W.creator(x.creator);
    var draftDue = W.fmtDate(x.creatorDeadline || ((x.golive || W.at(14)) - 5 * W.DAY));
    return html`<${W.Fragment}><div class="scrim" onClick=${close}></div>
      <div class="modal xl" role="dialog" aria-label="Side-by-Side Mirrored Contract Preview">
        <div class="row wrap no-print">
          <${W.Tag} hue="var(--close)" icon="shield">1:1 Operational Term Mirroring (INF-CLOSE-04 · BRD-CONTRACT-08 Signing Order)</${W.Tag}>
          <span class="sp"></span>
          <${W.Btn} size="sm" icon="printer" onClick=${function(){ window.print(); }}>Print / Save PDF</${W.Btn}>
          <${W.Btn} size="sm" kind="pri" icon="sparkle" onClick=${function(){ close(); W.A.generateMirroredContract(x.id); }}>Copy & Email Mirrored Contract to ${c.name}</${W.Btn}>
          <${W.IconBtn} icon="x" label="Close" onClick=${close} />
        </div>
        <div class="doc-sheet">
          <div class="doc-head">
            <div>
              <span class="tiny mono muted">GRATOVO LEGAL & DEAL DESK · SIDE-BY-SIDE MIRROR AUDIT</span>
              <h2>${b.name} × ${c.name} — Mirrored Agreement Verification</h2>
              <span class="small ink2">Deal Model: <b>${x.dealModel === "exclusive_25" ? "Exclusive Management (25% Agency Commission)" : "Brokered Markup"}</b> · Signing Order: <b>1. ${b.name} Signs IO → 2. ${c.name} Signs Mirrored Contract</b></span>
            </div>
            ${W.canSeeMoney() ? html`<div class="stats"><${W.Stat} v=${W.money(x.price)} l="Brand IO Gross" /><${W.Stat} v=${W.money(x.payout)} l="Creator Net Contract" /><${W.Stat} v=${W.money(x.price - x.payout)} l=${"Agency Spread (" + Math.round(100*(x.price-x.payout)/x.price) + "%)"} /></div>` : null}
          </div>
          <div class="grid2">
            <div class="card tight" style=${{border:"1px solid var(--close)"}}>
              <div class="row"><${W.BAv} b=${b} size="s" /><h4>Document A: Brand Insertion Order (${b.name})</h4><span class="sp"></span><${W.Tag} tone=${x.checks[1] ? "good" : "warn"}>${x.checks[1] ? "Signed First ✓" : "Signs 1st (BRD-CONTRACT-08)"}</${W.Tag}></div>
              <dl class="kv">
                <dt>1. Deliverable</dt><dd>${x.deliverable} (first-third placement + top-3-line UTM link)</dd>
                <dt>2. Publish Window</dt><dd><b>${W.fmtDate(x.golive || W.at(14))}</b> (48h draft review turnaround)</dd>
                <dt>3. Total Brand Fee</dt><dd><b class="num">${W.money(x.price)} all-in</b> (zero surprise VAT per BRD-PAY-09)</dd>
                <dt>4. Payment Terms</dt><dd>${x.terms} from go-live date via ACH / Wire</dd>
                <dt>5. Revisions</dt><dd>Max 2 factual brief-based rounds after script sign-off</dd>
                <dt>6. Usage & Excl.</dt><dd>Organic YouTube upload; 30-day exclusivity in <b>${b.cat}</b></dd>
                <dt>7. Compliance</dt><dd>FTC #ad disclosure (FND-ETH-13) & clean audio (HC-33)</dd>
              </dl>
            </div>
            <div class="card tight" style=${{border:"1px solid var(--reach)"}}>
              <div class="row"><${W.CAv} c=${c} size="s" /><h4>Document B: Mirrored Creator Agreement (${c.name})</h4><span class="sp"></span><${W.Tag} tone=${x.checks[3] ? "good" : "info"}>${x.checks[3] ? "Countersigned ✓" : "Countersigns 2nd"}</${W.Tag}></div>
              <dl class="kv">
                <dt>1. Deliverable</dt><dd>${x.deliverable} (identical 1:1 scope)</dd>
                <dt>2. Firm Draft Due</dt><dd><b style=${{color:"var(--warn)"}}>${draftDue} (-5d buffer per BRD-DELIV-09)</b> · Live ${W.fmtDate(x.golive || W.at(14))}</dd>
                <dt>3. Creator Payout</dt><dd><b class="num">${W.money(x.payout)} net</b> (${c.pay || "Wise / ACH"})</dd>
                <dt>4. Payout Trigger</dt><dd>Paid within 48h of Gratovo receiving ${b.name}'s funds</dd>
                <dt>5. Revisions</dt><dd>Max 2 factual brief-based rounds; script approval locks concept</dd>
                <dt>6. Usage & Excl.</dt><dd>Organic YouTube upload; 30-day exclusivity in <b>${b.cat}</b></dd>
                <dt>7. Compliance</dt><dd>FTC #ad disclosure (FND-ETH-13) & zero copyrighted music (HC-33)</dd>
              </dl>
            </div>
          </div>
          <div class="card flat tight">
            <h4>6-Clause Brand Redline Scanner (BRD-CONTRACT-09 / BRD-CONTRACT-10)</h4>
            <div class="grid2">
              ${W.REDLINE_CLAUSES.map(function(rc){
                var flagged = (x.redlineFlags || []).indexOf(rc.k) >= 0;
                return html`<div key=${rc.k} class="row small" style=${{padding:"6px 8px", background:"var(--panel)", borderRadius:"7px", border:"1px solid " + (flagged ? "var(--warn)" : "var(--line)")}}>
                  <${Icon} n=${flagged ? "alert" : "checkc"} style=${{color:flagged ? "var(--warn)" : "var(--good)"}} />
                  <div class="grow col t2"><b>${rc.label}</b><span class="tiny muted">${rc.fix}</span></div>
                  <${W.Btn} size="sm" kind="ghost" onClick=${function(){ close(); W.A.flagContractClause(x.id, rc.label); }}>Redline</${W.Btn}>
                </div>`;
              })}
            </div>
          </div>
        </div>
      </div></${W.Fragment}>`;
  }

  /* 3. Official All-In PDF Invoice Preview Modal (W.InvoicePreviewModal — System 15, BRD-PAY-02/03/09) */
  if (m.kind === "invoice"){
    var xi = W.deal(m.dealId) || W.D().deals[2];
    var bi = W.brand(xi.brand), ci = W.creator(xi.creator);
    var invNo = xi.invoice.no || ("GR-2026-0" + (30 + W.D().deals.indexOf(xi)));
    var sentDate = xi.invoice.sent || W.now();
    var dueDate = xi.invoice.due || (sentDate + 30 * W.DAY);
    return html`<${W.Fragment}><div class="scrim" onClick=${close}></div>
      <div class="modal lg" role="dialog" aria-label="Official Agency Invoice Preview">
        <div class="row wrap no-print">
          <${W.Tag} hue="var(--money)" icon="wallet">All-In Pricing Verified (BRD-PAY-09 · Zero Surprise VAT)</${W.Tag}>
          <span class="sp"></span>
          <${W.Btn} size="sm" icon="printer" onClick=${function(){ window.print(); }}>Print / Save PDF</${W.Btn}>
          ${!xi.invoice.sent ? html`<${W.Btn} size="sm" kind="pri" icon="send" onClick=${function(){ W.A.sendInvoice(xi.id); close(); }}>Send Invoice (${W.money(xi.price)})</${W.Btn}>` : null}
          <${W.IconBtn} icon="x" label="Close" onClick=${close} />
        </div>
        <div class="doc-sheet">
          <div class="doc-head">
            <div>
              <span class="tiny mono muted">GRATOVO AGENCY LLC · CREATOR PARTNERSHIPS</span>
              <h2>INVOICE ${invNo}</h2>
              <span class="small ink2">Issued: ${W.fmtDate(sentDate)} · Payment Terms: <b>Net 30 (Due ${W.fmtDate(dueDate)})</b></span>
            </div>
            <div class="col t2" style=${{textAlign:"end"}}>
              <b class="num" style=${{fontSize:"1.6rem", color:"var(--money)"}}>${W.money(xi.price)} USD</b>
              <span class="tiny muted">All-in amount (inclusive of any applicable taxes per BRD-PAY-09)</span>
            </div>
          </div>
          <div class="grid2">
            <div class="col t2"><span class="tiny muted">BILL TO</span><b>${bi.name}</b><span class="small">${bi.contact || "Accounts Payable"} · ${bi.email}</span><span class="small muted">${W.COUNTRY[bi.country] || bi.country}</span></div>
            <div class="col t2"><span class="tiny muted">PAYABLE TO (ACH / WISE WIRE — BRD-PAY-04)</span><b>Gratovo Agency LLC</b><span class="small mono">Wise USD Routing: 026073150 · Acct: 8310049281</span><span class="small muted">billing@gratovo.co · W-9 / W-8BEN-E attached</span></div>
          </div>
          <div class="tw"><table class="tbl">
            <thead><tr><th>Description & Deliverable</th><th>Live Video Link</th><th>Publish Date</th><th class="n">Amount (All-In)</th></tr></thead>
            <tbody>
              <tr>
                <td><b>${ci.name} (${ci.handle})</b> — ${xi.deliverable}<br/><span class="tiny muted">Includes top-3-line UTM tracking link (${(xi.shipping && xi.shipping.utmLink) || xi.link || "verified"}) & pinned comment</span></td>
                <td class="mono small">${xi.live || ("youtu.be/" + ci.handle.slice(1))}</td>
                <td>${W.fmtDate(xi.golive || W.now())}</td>
                <td class="n"><b>${W.money(xi.price)}</b></td>
              </tr>
              ${xi.invoice.partialPaid ? html`<tr><td colspan="3">Less 50% Deposit Received (${W.fmtDate(xi.invoice.paidPartAt || W.now())})</td><td class="n">−${W.money(xi.invoice.partialPaid)}</td></tr>` : null}
            </tbody>
          </table></div>
          <div class="row wrap"><span class="small muted">Please reference Invoice <b>${invNo}</b> on wire/ACH remittance.</span><span class="sp"></span><b class="num" style=${{fontSize:"1.15rem"}}>Balance Due: ${W.money(xi.price - (xi.invoice.partialPaid || 0))}</b></div>
        </div>
      </div></${W.Fragment}>`;
  }

  /* 4. Sales & Discovery Call Co-Pilot Sheet (W.CallSheetModal — System 10, FND-CALL-01..13, BRD-PRES-26) */
  if (m.kind === "call"){
    var ref = m.ref || {t:"brand", id:"b5"}, o = W.rec(ref) || W.D().brands[0], isB = ref.t === "brand";
    return html`<${W.Fragment}><div class="scrim" onClick=${close}></div>
      <div class="modal lg" role="dialog" aria-label="Call Co-Pilot & Same-Day Recap Builder">
        <div class="row wrap">
          <${W.Tag} hue="var(--close)" icon="phone">Call Co-Pilot (FND-CALL-01..13 · BRD-PRES-26 Two-Call Close)</${W.Tag}>
          <span class="sp"></span>
          <${W.IconBtn} icon="x" label="Close" onClick=${close} />
        </div>
        <div class="col" style=${{gap:"12px"}}>
          <div class="row"><${Icon} n="phone" s=${20} /><div class="col t2"><h2>${isB ? "Brand Discovery & Roster Walkthrough Call: " : "Creator Onboarding & Alignment Call: "}${o.name}</h2><span class="small muted">Rule FND-CALL-13: Send a 3-bullet written agenda 24h before the call · Rule FND-CALL-07: Never quote unverified rates live on the call.</span></div></div>
          <div class="callout warn"><${Icon} n="shield" /><span class="small"><b>Live Call Guardrail (FND-CALL-07):</b> If ${o.name} asks for a custom bundle or unverified creator rate live on the call, say: <i>"Let me confirm the exact Q4 slot and send you 3 clean package options in writing this afternoon"</i> rather than guessing a number on the spot.</span></div>
          <div class="grid2">
            <${W.Field} label=${isB ? "1. Campaign Goal (Awareness vs. Conversions)" : "1. Agreed Base Rate & Representation Tier"}>
              <input class="inp" value=${callGoalSt[0]} onInput=${function(e){ callGoalSt[1](e.target.value); }} />
            </${W.Field}>
            <${W.Field} label=${isB ? "2. Target KPI / Budget Ceiling (CPA / CPM)" : "2. Dream Brands & Hard-No Categories (INF-ONB-06)"}>
              <input class="inp" value=${callKpiSt[0]} onInput=${function(e){ callKpiSt[1](e.target.value); }} />
            </${W.Field}>
          </div>
          <${W.Field} label="3. Agreed Timeline & Next Step (Call 2 / IO / Roster Packet)">
            <input class="inp" value=${callTimeSt[0]} onInput=${function(e){ callTimeSt[1](e.target.value); }} />
          </${W.Field}>
          <div class="row wrap">
            <${W.Btn} kind="pri" icon="send" onClick=${function(){ W.A.saveCallRecap(ref, {goal:callGoalSt[0], kpi:callKpiSt[0], timeline:callTimeSt[0]}); }}>Generate Same-Day Written Recap (FND-CALL-11)</${W.Btn}>
            ${isB ? html`<${W.Btn} icon="file" onClick=${function(){ W.ui(function(uu){ uu.modal = {kind:"mediakit", brandId:o.id}; }); }}>Open Brand Talent Packet</${W.Btn}>` : null}
            <${W.Btn} kind="ghost" onClick=${close}>Cancel</${W.Btn}>
          </div>
        </div>
      </div></${W.Fragment}>`;
  }
  return null;
};
})();
