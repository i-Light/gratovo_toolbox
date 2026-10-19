/* comments.js — the comment tool, part of prototype mode only.
   Press C (or the comment button in the top bar), point at anything and click: a note is pinned to that exact
   button, card, row or field, on that screen, tab and record. Pins come back where they were left; the list shows
   them all and can copy the open ones for Claude to work through. With prototype mode off, none of this mounts. */
(function(){
"use strict";
var W = window.W, html = W.html, Icon = W.Icon, useState = W.useState, useEffect = W.useEffect, useRef = W.useRef;
var Btn = W.Btn;

var KINDS = [["fix","Fix","wrench"],["idea","Idea","sparkle"],["question","Question","help"]];
var KIND = {}; KINDS.forEach(function(k){ KIND[k[0]] = {label:k[1], icon:k[2]}; });
var OBJ = "button, a, input, textarea, select, [role=tab], [role=option], .tag, .chip, .av, .kcard, .gcard, .li, tr, .tile, .ck, .msg, .draft, .gate, .fact, .callout, .nextcard, .steps, .thumb, .banner, .vid, .stat, .meter, .budget, .card, .lane, .bucket, section, h1, h2, h3, h4, p, .ph";
var BIG = "[data-why], section, .card, .lane, .rail, .top, .peek, .page";

function snip(el){ return ((el && el.textContent) || "").replace(/\s+/g, " ").trim().slice(0, 60); }
function inUi(el){ return !!(el && el.closest && el.closest("[data-cmt-ui]")); }
function pick(el, big){
  if (!el || !el.closest || inUi(el)) return null;
  var t = big ? el.closest(BIG) : el.closest(OBJ);
  if (!t) t = el.closest(BIG);
  if (!t || t.id === "root" || t.classList.contains("app") || t.classList.contains("main") || t.classList.contains("content") || t.classList.contains("body")) return null;
  return t;
}
function nice(el){ return ((el && (el.innerText != null ? el.innerText : el.textContent)) || "").replace(/\s+/g, " ").trim(); }
/* the named thing an element sits in: a card's title, a row's name */
function context(el){
  var box = el.parentElement && el.parentElement.closest(".gcard, .kcard, .li, tr, .card, section, .lane, .peek, .work, .rail, .top");
  if (!box) return "";
  var h = box.querySelector("h1, h2, h3, h4, .lt b, b"), t = h ? nice(h) : "";
  return t.length > 30 ? t.slice(0, 30) + "…" : t;
}
function label(el){
  var base = describe(el), ctx = el.matches(".card, section, .lane, .gcard, .kcard, .li, tr, .rail, .top, .peek") ? "" : context(el);
  return ctx && base.indexOf(ctx) < 0 ? base + " in “" + ctx + "”" : base;
}
function describe(el){
  var tag = el.tagName.toLowerCase(), t = nice(el), short = t.length > 34 ? t.slice(0, 34) + "…" : t;
  var why = el.getAttribute("data-why");
  if (why && W.WHY && W.WHY[why]) return W.WHY[why].t;
  if (el.getAttribute("role") === "tab") return "Tab “" + short + "”";
  if (tag === "button" || tag === "a") return (el.getAttribute("aria-label") && !t ? "Button “" + el.getAttribute("aria-label") + "”" : "Button “" + short + "”");
  if (tag === "input" || tag === "textarea" || tag === "select") return "Field “" + (el.getAttribute("aria-label") || el.getAttribute("placeholder") || "") .slice(0, 40) + "”";
  if (/^h[1-4]$/.test(tag)) return "Heading “" + short + "”";
  if (tag === "tr") return "Table row “" + short + "”";
  var cls = el.classList;
  if (cls.contains("banner")) return "Channel banner";
  if (cls.contains("thumb")) return "Thumbnail";
  if (cls.contains("vid")) return "Video";
  if (cls.contains("meter") || cls.contains("budget")) return "Bar";
  if (cls.contains("steps")) return "Steps";
  if (cls.contains("av")) return "Avatar";
  if (cls.contains("tag") || cls.contains("chip")) return "Tag “" + short + "”";
  if (cls.contains("li") || cls.contains("kcard") || cls.contains("gcard")) { var b = el.querySelector("b"); return (cls.contains("gcard") ? "Card" : "Row") + " “" + (b ? nice(b) : short) + "”"; }
  if (cls.contains("card") || tag === "section" || cls.contains("lane")){ var h = el.querySelector("h1,h2,h3,h4"); return (cls.contains("lane") ? "Column" : "Card") + (h ? " “" + nice(h) + "”" : ""); }
  if (cls.contains("rail")) return "Sidebar";
  if (cls.contains("top")) return "Top bar";
  if (cls.contains("peek")) return "Record panel";
  if (tag === "p") return "Text “" + short + "”";
  return short ? "“" + short + "”" : "This area";
}
function cssPath(el){
  var parts = [], root = document.getElementById("root");
  while (el && el !== root && el.nodeType === 1){
    var i = 1, s = el;
    while ((s = s.previousElementSibling)) if (s.tagName === el.tagName) i++;
    parts.unshift(el.tagName.toLowerCase() + ":nth-of-type(" + i + ")");
    el = el.parentElement;
  }
  return "#root > " + parts.join(" > ");
}
/* find a comment's element again: the exact spot, else the same text nearby, else its section */
function locate(c, out){
  var a = c.anchor || {}, el = null;
  try { el = a.path ? document.querySelector(a.path) : null; } catch (e){ el = null; }
  if (el && a.text && snip(el) !== a.text) el = null;
  if (!el && a.text && a.tag){
    var scope = a.why ? document.querySelector('[data-why="' + a.why + '"]') : null;
    var cands = (scope || document.getElementById("root")).querySelectorAll(a.tag);
    for (var i = 0; i < cands.length && i < 400; i++) if (snip(cands[i]) === a.text){ el = cands[i]; break; }
  }
  if (!el && a.why){ el = document.querySelector('[data-why="' + a.why + '"]'); if (el && out) out.approx = true; }
  return el && !inUi(el) ? el : null;
}
function routeOf(){ var u = W.U(); return {s:u.route.s, tab:u.route.tab || null, rec:u.route.rec || null}; }
function sameRec(a, b){ return (!a && !b) || (a && b && a.t === b.t && a.id === b.id); }
/* does this comment belong on what is open right now? */
function here(c){
  var u = W.U(), r = u.route;
  if (c.global) return true;
  if (c.screen !== r.s || (c.tab || null) !== (r.tab || null) || !sameRec(c.rec, r.rec || null)) return false;
  if (c.peek && !sameRec(c.peek, u.peek ? {t:u.peek.t, id:u.peek.id} : null)) return false;
  if (c.item && c.item !== u.todaySel) return false;
  return true;
}
function whereText(c){
  if (c.global) return c.anchor && c.anchor.label ? "Everywhere · " + c.anchor.label : "Everywhere";
  var s = W.SCREENS[c.screen] || {name:c.screen}, t = s.tabs && c.tab ? (s.tabs.filter(function(x){ return x[0] === c.tab; })[0] || [0, c.tab])[1] : null;
  var bits = [s.name].concat(t ? [t] : []).concat(c.rec ? [W.refName(c.rec) || "a record"] : []).concat(c.peek ? [W.refName(c.peek) || "a record"] : []);
  return bits.join(" › ");
}
function number(c){ for (var i = 0; i < W.CM.list.length; i++) if (W.CM.list[i].id === c.id) return i + 1; return 0; }

/* go to where a comment was left, then open it */
function visit(c){
  var u = W.U();
  if (!c.global && (u.route.s !== c.screen || (u.route.tab || null) !== (c.tab || null) || !sameRec(u.route.rec, c.rec))) W.go(c.screen, c.tab, c.rec ? {rec:c.rec, from:c.screen} : null);
  if (c.peek) W.peek(c.peek.t, c.peek.id);
  if (c.item) W.ui(function(uu){ uu.todaySel = c.item; });
  W.ui(function(uu){ uu.proto = Object.assign({}, uu.proto, {open:c.id}); });
  setTimeout(function(){ var el = locate(c); if (el && el.scrollIntoView) el.scrollIntoView({block:"center", behavior:"smooth"}); }, 60);
}
W.commentVisit = visit;

function forClaude(list){
  var open = list.filter(function(c){ return c.status !== "done"; });
  var lines = ["Workbench comments: " + W.plural(open.length, "open comment") + ", copied " + W.fmtDate(Date.now()) + " " + W.fmtTime(Date.now()), ""];
  open.forEach(function(c){
    var sc = W.SCENARIOS.filter(function(s){ return s.k === c.scenario; })[0];
    lines.push(number(c) + ". [" + KIND[c.kind].label + "] " + whereText(c) + " · " + (c.anchor ? c.anchor.label : "") + (sc && c.scenario !== "normal" ? " (scenario: " + sc.name + ")" : ""));
    lines.push("   " + c.text.replace(/\n/g, "\n   "));
    if (c.anchor && c.anchor.why) lines.push("   design note: " + c.anchor.why);
  });
  return lines.join("\n");
}

/* ---------- the composer: what should change here? ---------- */
function Composer(p){
  var t = useState(""), k = useState("fix"), ref = useRef(null);
  useEffect(function(){ if (ref.current) ref.current.focus(); }, []);
  function save(){
    var text = t[0].trim(); if (!text) return;
    var c = W.commentAdd(Object.assign({}, p.at.meta, {kind:k[0], text:text}));
    p.onDone();
    W.toast({msg:"Comment " + number(c) + " saved", sub:W.CM.src === "shared" ? "Saved with this page, so Claude can read it too." : "Saved in this browser.", icon:"chat", tone:"good", ms:4000,
      actions:[{label:"Undo", run:function(){ W.commentDelete(c.id); }}]});
  }
  var w = Math.min(330, window.innerWidth - 24), x = W.clamp(p.at.x + 14, 12, window.innerWidth - w - 12), y = W.clamp(p.at.y + 14, 64, window.innerHeight - 270);
  return html`<div class="cmt-pop" data-cmt-ui="1" role="dialog" aria-label="New comment" style=${{left:x + "px", top:y + "px", width:w + "px"}}>
    <div class="row"><${Icon} n="chat" style=${{color:"var(--accent)"}} /><span class="small ell grow"><b style=${{fontWeight:600}}>${p.at.meta.anchor.label}</b></span></div>
    <span class="tiny muted ell">${whereText(p.at.meta)}</span>
    <textarea ref=${ref} class="ta" rows="3" placeholder="What should change here, and why?" value=${t[0]} onInput=${function(e){ t[1](e.target.value); }} aria-label="Comment"
      onKeyDown=${function(e){ if (e.key === "Enter" && (e.ctrlKey || e.metaKey)){ e.preventDefault(); e.stopPropagation(); save(); } else if (e.key === "Escape"){ e.preventDefault(); e.stopPropagation(); p.onDone(); } }}></textarea>
    <div class="row wrap" style=${{gap:"6px"}}>
      <${W.Seg} label="Kind of comment" cur=${k[0]} onPick=${k[1]} opts=${KINDS.map(function(x){ return [x[0], x[1], x[2]]; })} />
      <span class="sp"></span>
      <${Btn} size="sm" kind="ghost" onClick=${p.onDone}>Cancel</${Btn}>
      <${Btn} size="sm" kind="pri" disabled=${!t[0].trim()} onClick=${save}>Save <span class="kbd">Ctrl Enter</span></${Btn}>
    </div>
  </div>`;
}

/* ---------- one comment, opened from its pin or the list ---------- */
function Card(p){
  var c = p.c, ed = useState(null), u = W.U();
  function close(){ W.ui(function(uu){ uu.proto = Object.assign({}, uu.proto, {open:null}); }); }
  W.useKeys({escape:function(){ if (ed[0] != null){ ed[1](null); return true; } close(); return true; }});
  function del(){ var gone = W.commentDelete(c.id); close(); W.toast({msg:"Comment " + p.n + " deleted", icon:"trash", tone:"info", ms:5000, actions:[{label:"Undo", run:function(){ W.commentRestore(gone); }}]}); }
  var w = Math.min(330, window.innerWidth - 24);
  var pos = p.pos ? {left:W.clamp(p.pos.x + 18, 12, window.innerWidth - w - 12) + "px", top:W.clamp(p.pos.y - 10, 64, window.innerHeight - 280) + "px"} : {left:"50%", top:"30%", transform:"translateX(-50%)"};
  var sc = W.SCENARIOS.filter(function(s){ return s.k === c.scenario; })[0];
  return html`<div class="cmt-pop" data-cmt-ui="1" role="dialog" aria-label=${"Comment " + p.n} style=${Object.assign({width:w + "px"}, pos)}>
    <div class="row"><span class=${W.cx("cmt-pin", "static", c.status === "done" ? "done" : null)}>${p.n}</span><${W.Tag} icon=${KIND[c.kind].icon}>${KIND[c.kind].label}</${W.Tag}>${c.status === "done" ? html`<${W.Tag} tone="good" icon="check">Done</${W.Tag}>` : null}<span class="sp"></span>
      <button type="button" class="iconbtn" style=${{width:"28px", height:"28px"}} onClick=${close} aria-label="Close"><${Icon} n="x" s=${14} /></button></div>
    <span class="small"><b style=${{fontWeight:600}}>${c.anchor ? c.anchor.label : ""}</b></span>
    ${ed[0] != null ? html`<textarea class="ta" rows="3" autoFocus=${true} value=${ed[0]} onInput=${function(e){ ed[1](e.target.value); }} aria-label="Edit comment"
        onKeyDown=${function(e){ if (e.key === "Enter" && (e.ctrlKey || e.metaKey)){ e.preventDefault(); e.stopPropagation(); if (ed[0].trim()){ W.commentPatch(c.id, {text:ed[0].trim()}); ed[1](null); } } else if (e.key === "Escape"){ e.preventDefault(); e.stopPropagation(); ed[1](null); } }}></textarea>`
      : html`<p style=${{whiteSpace:"pre-wrap"}}>${c.text}</p>`}
    <span class="tiny muted">${agoReal(c.at)} · ${whereText(c)}${sc && c.scenario !== "normal" ? " · " + sc.name : ""}</span>
    ${p.approx ? html`<span class="hint">The exact spot changed since this was written, so the pin sits on its section.</span>` : null}
    ${p.missing ? html`<span class="hint">This spot isn't on screen right now. It may sit on another tab, below the fold, or have changed.</span>` : null}
    <div class="row wrap" style=${{gap:"6px"}}>
      ${ed[0] != null ? html`<${Btn} size="sm" kind="pri" onClick=${function(){ if (ed[0].trim()){ W.commentPatch(c.id, {text:ed[0].trim()}); ed[1](null); } }}>Save</${Btn}><${Btn} size="sm" kind="ghost" onClick=${function(){ ed[1](null); }}>Cancel</${Btn}>`
        : html`${c.status === "done" ? html`<${Btn} size="sm" icon="undo" onClick=${function(){ W.commentPatch(c.id, {status:"open"}); }}>Reopen</${Btn}>` : html`<${Btn} size="sm" kind="pri" icon="check" onClick=${function(){ W.commentPatch(c.id, {status:"done", doneAt:Date.now()}); close(); W.toast({msg:"Comment " + p.n + " marked done", icon:"check", tone:"good", ms:3500, actions:[{label:"Undo", run:function(){ W.commentPatch(c.id, {status:"open"}); }}]}); }}>Mark done</${Btn}>`}
          <${Btn} size="sm" kind="ghost" icon="edit" onClick=${function(){ ed[1](c.text); }}>Edit</${Btn}>
          <${Btn} size="sm" kind="ghost" icon="copy" onClick=${function(){ W.copy(KIND[c.kind].label + " · " + whereText(c) + " · " + (c.anchor ? c.anchor.label : "") + "\n" + c.text, "the comment"); }}>Copy</${Btn}>
          <span class="sp"></span><${W.IconBtn} icon="trash" label="Delete" onClick=${del} />`}
    </div>
  </div>`;
}
function agoReal(ts){ var s = Math.max(0, (Date.now() - ts) / 1000); if (s < 45) return "Just now"; if (s < 3600) return Math.round(s / 60) + " min ago"; if (s < 86400) return Math.round(s / 3600) + " h ago"; return W.fmtDate(ts); }

/* ---------- the list of every comment ---------- */
function Side(){
  var u = W.U(), pr = u.proto, list = W.CM.list, f = useState("open"), sc = useState("all");
  function close(){ W.ui(function(uu){ uu.proto = Object.assign({}, uu.proto, {panel:false}); }); }
  W.useKeys({escape:function(){ close(); return true; }});
  var shown = list.filter(function(c){ return (f[0] === "all" || (f[0] === "done") === (c.status === "done")) && (sc[0] === "all" || here(c)); }).slice().reverse();
  var openN = list.filter(function(c){ return c.status !== "done"; }).length;
  return html`<aside class="cmt-side" data-cmt-ui="1" aria-label="Comments">
    <div class="row" style=${{padding:"12px 14px", borderBottom:"1px solid var(--line)"}}><${Icon} n="chat" style=${{color:"var(--accent)"}} /><b class="grow" style=${{fontWeight:600}}>Comments <span class="muted num" style=${{fontWeight:400}}>${openN} open</span></b>
      <button type="button" class="iconbtn" style=${{width:"28px", height:"28px"}} onClick=${close} aria-label="Hide comments"><${Icon} n="x" s=${14} /></button></div>
    <div class="row wrap" style=${{padding:"8px 10px", gap:"6px", borderBottom:"1px solid var(--line)"}}>
      <${W.Seg} label="Which comments" cur=${f[0]} onPick=${f[1]} opts=${[["open","Open"],["done","Done"],["all","All"]]} />
      <${W.Seg} label="Where" cur=${sc[0]} onPick=${sc[1]} opts=${[["all","Everywhere"],["here","This screen"]]} />
    </div>
    <div style=${{overflowY:"auto", padding:"6px", flex:1}}>
      ${shown.length ? shown.map(function(c){ var n = number(c);
        return html`<button key=${c.id} type="button" class="tray-i" onClick=${function(){ visit(c); }} style=${pr.open === c.id ? {background:"var(--accent-soft)"} : null}>
          <span class=${W.cx("cmt-pin", "static", c.status === "done" ? "done" : null)}>${n}</span>
          <div class="tx"><span class="row" style=${{gap:"6px"}}><b style=${{fontWeight:500}} class="ell">${c.anchor ? c.anchor.label : "Comment"}</b><span class="tiny muted" style=${{flex:"none"}}>${KIND[c.kind].label}</span></span>
            <span class="cmt-clamp">${c.text}</span><small>${whereText(c)} · ${agoReal(c.at)}</small></div></button>`; })
      : html`<div class="col tight" style=${{padding:"14px 10px"}}><b style=${{fontWeight:600}}>${list.length ? "Nothing here with these filters." : "No comments yet."}</b><span class="hint">Press <span class="kbd">C</span>, then click anything: a button, a card, a row, a chart. Your note is pinned to that exact spot.</span></div>`}
    </div>
    <div class="col tight" style=${{padding:"10px 14px", borderTop:"1px solid var(--line)"}}>
      <div class="row wrap"><${Btn} size="sm" icon="chat" kind=${pr.mode ? "pri" : null} onClick=${function(){ W.toggleCommentMode(); }}>${pr.mode ? "Stop commenting" : "Add a comment"} <span class="kbd">C</span></${Btn}>
        <${Btn} size="sm" kind="ghost" icon="copy" disabled=${!openN} onClick=${function(){ W.copy(forClaude(list), W.plural(openN, "open comment") + " for Claude"); }}>Copy open for Claude</${Btn}></div>
      <span class="tiny muted">${W.CM.src === "shared" ? "Saved with this page: they follow you to any device, and Claude can read them directly." : "Saved in this browser. Copy them for Claude, or open this page where it can save them with the page."}</span>
    </div>
  </aside>`;
}

/* ---------- comment mode: point, click, write ---------- */
W.toggleCommentMode = function(force){
  W.ui(function(u){ var on = force == null ? !u.proto.mode : !!force; u.proto = Object.assign({}, u.proto, {mode:on, open:null}); if (on){ u.why = false; u.whyOpen = null; } });
};
function Picker(p){
  var hov = useState(null), comp = useState(null);
  var compRef = useRef(null); compRef.current = comp[0];
  useEffect(function(){
    var raf = 0;
    function move(e){
      if (compRef.current) return;
      var t = pick(e.target, e.altKey);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(function(){ if (!t){ hov[1](null); return; } var r = t.getBoundingClientRect(); hov[1]({x:r.left, y:r.top, w:r.width, h:r.height, label:label(t)}); });
    }
    function block(e){ if (inUi(e.target)) return; e.preventDefault(); e.stopPropagation(); }
    function click(e){
      if (inUi(e.target)) return;
      e.preventDefault(); e.stopPropagation();
      if (compRef.current){ comp[1](null); return; }
      var t = pick(e.target, e.altKey); if (!t) return;
      var r = t.getBoundingClientRect(), u = W.U(), rt = routeOf();
      var peekEl = t.closest(".peek"), glob = !!t.closest(".rail, .top"), work = t.closest(".work");
      var meta = {screen:rt.s, tab:rt.tab, rec:rt.rec, global:glob || null,
        peek:peekEl && u.peek ? {t:u.peek.t, id:u.peek.id} : null,
        item:work && rt.s === "today" ? u.todaySel : null,
        scenario:u.proto.scenario, viewAs:u.proto.viewAs || null,
        anchor:{path:cssPath(t), tag:t.tagName.toLowerCase(), text:snip(t), why:(t.closest("[data-why]") || {getAttribute:function(){ return null; }}).getAttribute("data-why"), label:label(t),
          rx:r.width ? W.clamp((e.clientX - r.left) / r.width, 0, 1) : .5, ry:r.height ? W.clamp((e.clientY - r.top) / r.height, 0, 1) : .5}};
      if (glob){ meta.screen = null; meta.tab = null; meta.rec = null; meta.peek = null; meta.item = null; }
      comp[1]({x:e.clientX, y:e.clientY, meta:meta});
      hov[1]({x:r.left, y:r.top, w:r.width, h:r.height, label:meta.anchor.label, fixed:true});
    }
    document.addEventListener("pointermove", move, true);
    document.addEventListener("mousedown", block, true);
    document.addEventListener("click", click, true);
    document.documentElement.classList.add("cmt-mode");
    return function(){ document.removeEventListener("pointermove", move, true); document.removeEventListener("mousedown", block, true); document.removeEventListener("click", click, true); document.documentElement.classList.remove("cmt-mode"); cancelAnimationFrame(raf); };
  }, []);
  W.useKeys({escape:function(){ if (comp[0]){ comp[1](null); hov[1](null); return true; } W.toggleCommentMode(false); return true; },
    c:function(){ if (comp[0]) return true; W.toggleCommentMode(false); return true; }}, true, {barrier:true});
  var h = hov[0];
  return html`<${W.Fragment}>
    ${h ? html`<div class="cmt-hl" style=${{left:h.x - 3 + "px", top:h.y - 3 + "px", width:h.w + 6 + "px", height:h.h + 6 + "px"}}><span class="cmt-hl-l">${h.label}</span></div>` : null}
    ${comp[0] ? html`<${Composer} at=${comp[0]} onDone=${function(){ comp[1](null); hov[1](null); }} />` : null}
    <div class="cmt-bar" data-cmt-ui="1" role="status">
      <${Icon} n="chat" /><span><b style=${{fontWeight:600}}>Click anything to comment on it.</b> <span class="hide-narrow">Hold Alt to pick the whole section.</span></span>
      <span class="sp"></span>
      <button type="button" class="btn sm" onClick=${function(){ W.ui(function(u){ u.proto = Object.assign({}, u.proto, {panel:!u.proto.panel}); }); }}>${W.plural(W.CM.list.filter(function(c){ return c.status !== "done"; }).length, "open comment")}</button>
      <button type="button" class="btn sm" onClick=${function(){ W.toggleCommentMode(false); }}>Done <span class="kbd">Esc</span></button>
    </div>
  </${W.Fragment}>`;
}

/* ---------- pins on what is open now ---------- */
function Pins(){
  var u = W.U(), pr = u.proto, pins = useState([]);
  var list = W.CM.list, want = list.filter(function(c){ return here(c) && (pr.showDone || c.status !== "done" || pr.open === c.id); });
  var key = want.map(function(c){ return c.id + c.status; }).join(",") + "|" + u.route.s + u.route.tab + (u.peek ? u.peek.id : "") + u.todaySel;
  useEffect(function(){
    var raf = 0;
    function measure(){
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(function(){
        pins[1](want.map(function(c){ var o = {}, el = locate(c, o); if (!el) return {c:c, miss:true};
          var r = el.getBoundingClientRect(); if (!r.width && !r.height) return {c:c, miss:true};
          var a = c.anchor || {};
          return {c:c, x:r.left + r.width * (a.rx == null ? 1 : a.rx), y:r.top + r.height * (a.ry == null ? 0 : a.ry), off:r.bottom < 56 || r.top > window.innerHeight - 4, approx:!!o.approx}; }));
      });
    }
    measure();
    var iv = setInterval(measure, 450);
    window.addEventListener("scroll", measure, true); window.addEventListener("resize", measure);
    return function(){ clearInterval(iv); window.removeEventListener("scroll", measure, true); window.removeEventListener("resize", measure); cancelAnimationFrame(raf); };
  }, [key]);
  var openC = pr.open ? list.filter(function(c){ return c.id === pr.open && here(c); })[0] : null, openP = openC ? pins[0].filter(function(p){ return p.c.id === openC.id; })[0] : null;
  return html`<${W.Fragment}>
    ${pins[0].map(function(p0){ if (p0.miss || p0.off) return null; var now = list.filter(function(x){ return x.id === p0.c.id; })[0]; if (!now) return null;
      var p = Object.assign({}, p0, {c:now}), n = number(p.c);
      return html`<button key=${p.c.id} type="button" data-cmt-ui="1" class=${W.cx("cmt-pin", p.c.status === "done" ? "done" : null, p.approx ? "approx" : null)} style=${{left:W.clamp(p.x - 4, 4, window.innerWidth - 30) + "px", top:W.clamp(p.y - 24, 58, window.innerHeight - 30) + "px"}}
        aria-label=${"Comment " + n + ": " + p.c.text + (p.approx ? " (its spot changed; pinned to the section)" : "")} aria-expanded=${String(pr.open === p.c.id)} data-tip=${p.c.text.length > 80 ? p.c.text.slice(0, 80) + "…" : p.c.text}
        onClick=${function(){ W.ui(function(uu){ uu.proto = Object.assign({}, uu.proto, {open:uu.proto.open === p.c.id ? null : p.c.id}); }); }}>${n}</button>`; })}
    ${openC ? html`<${Card} key=${openC.id} c=${openC} n=${number(openC)} pos=${openP && !openP.miss ? {x:openP.x, y:openP.y} : null} missing=${!openP || openP.miss} approx=${!!(openP && openP.approx)} />` : null}
  </${W.Fragment}>`;
}

/* ---------- the whole layer: mounted by the app only while prototype mode is on ---------- */
W.CommentLayer = function(){
  var st = W.useApp(), u = st.ui, pr = u.proto;
  W.useKeys({c:function(){ W.toggleCommentMode(); }});
  return html`<${W.Fragment}>
    ${pr.pins !== false || pr.mode ? html`<${Pins} />` : null}
    ${pr.mode ? html`<${Picker} />` : null}
    ${pr.panel ? html`<${Side} />` : null}
  </${W.Fragment}>`;
};
W.commentsForClaude = function(){ return forClaude(W.CM.list); };
})();
