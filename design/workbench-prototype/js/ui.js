/* ui.js — small, consistent building blocks. Every screen uses these so a button, a due chip or an avatar
   looks and behaves the same everywhere. */
(function(){
"use strict";
var W = window.W, html = W.html, Icon = W.Icon;

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
W.Av = function(p){
  var m = p.id ? W.member(p.id) : null, name = m ? m.name : p.name || "?";
  /* the owner's own avatar: their account photo when there is one, their initials once a name is known */
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

/* country split: the top 3 as a thin stacked bar plus labels; US/UK/CA/AU in the accent, others neutral */
W.Countries = function(p){
  var cs = p.countries || [];
  if (!cs.length) return html`<span class="muted small">Audience not known yet</span>`;
  var ok = ["US","GB","CA","AU"];
  return html`<div class="col tight" style=${{gap:"5px"}}>
    <div class="cbar" aria-hidden="true">${cs.map(function(c){ return html`<i key=${c[0]} style=${{width:c[1] + "%", background:ok.indexOf(c[0]) >= 0 ? "var(--accent)" : "var(--line-2)"}}></i>`; })}<i style=${{flex:1, background:"transparent"}}></i></div>
    <div class="row wrap small" style=${{gap:"4px 10px"}}>${cs.map(function(c){ return html`<span key=${c[0]} class=${ok.indexOf(c[0]) >= 0 ? "" : "muted"} data-tip=${W.COUNTRY[c[0]] || c[0]}><b class="num" style=${{fontWeight:600}}>${c[1]}%</b> ${c[0]}</span>`; })}</div>
  </div>`;
};
/* fit score with its reasons in the tooltip, so nobody has to trust a bare number */
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

/* thumbnails: drawn, not fetched, so the gallery reads like YouTube without loading anything */
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
/* channel banners: drawn, not fetched, in YouTube's own proportions. The full image is 2560 wide; desktop shows a
   2560 x 423 band and phones and narrow panels crop to the 1546-wide middle, so names and taglines stay in that middle.
   In the real app this is the channel's banner image from YouTube, cropped the same way. */
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

/* owner chip: who has it, and one click to hand it to someone else */
W.Owner = function(p){
  var ref = p.refx, o = W.rec(ref), id = o && o.owner;
  function open(e){ e.stopPropagation(); W.menu(e, [{head:"Who has it"}].concat(W.D().team.map(function(m){ return {label:m.name + (m.id === id ? "  ✓" : ""), icon:"user", hint:m.role, run:function(){ if (m.id !== id) W.A.assign(ref, m.id); }}; }))); }
  return html`<button type="button" class="btn ghost sm" onClick=${open} data-tip="Change who has it" data-why="owner">${id ? html`<${W.Av} id=${id} size="s" tip=${false} />` : html`<${Icon} n="user" />`}${id ? W.member(id).name : "Nobody"}<${Icon} n="chevD" s=${13} /></button>`;
};

/* snooze presets: one click, plain words, no date picker unless you want one */
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

/* activity: a record's life story, newest first */
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
})();
