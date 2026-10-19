/* core.js — the shared runtime every other file builds on.
   W.html (htm bound to React), the store (W.act / W.ui / W.bg with snapshot undo), navigation, keyboard,
   toasts, menus, formatting helpers and the icon set. Nothing here knows about creators or deals. */
(function(){
"use strict";
var R = window.React;
var W = window.W = {};
W.R = R;
["useState","useEffect","useRef","useMemo","useCallback","useLayoutEffect","Fragment"].forEach(function(k){ W[k] = R[k]; });

/* ---------- htm + React ---------- */
function h(type, props){
  var kids = Array.prototype.slice.call(arguments, 2);
  if (props){
    var p = {};
    for (var k in props){
      if (k === "class") p.className = props[k];
      else if (k === "for") p.htmlFor = props[k];
      else p[k] = props[k];
    }
    props = p;
  }
  return R.createElement.apply(R, [type, props].concat(kids));
}
W.h = h;
W.html = window.htm.bind(h);
var html = W.html;

/* ---------- time ---------- */
var T0 = Date.now();
W.NOW = new Date(2026, 9, 19, 10, 24, 0).getTime();   // Monday 19 October 2026, 10:24
W.MIN = 60000; W.HOUR = 3600000; W.DAY = 86400000;
W.now = function(){ return W.NOW + (Date.now() - T0); };
W.at = function(dayOffset, hh, mm){ var d = new Date(W.NOW); d.setDate(d.getDate() + (dayOffset||0)); if (hh != null) d.setHours(hh, mm||0, 0, 0); return d.getTime(); };
W.startOfDay = function(ts){ var d = new Date(ts); d.setHours(0,0,0,0); return d.getTime(); };
W.dayDiff = function(ts){ return Math.round((W.startOfDay(ts) - W.startOfDay(W.NOW)) / W.DAY); };
var DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"], MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
W.fmtDate = function(ts){ var d = new Date(ts); return DOW[d.getDay()] + " " + d.getDate() + " " + MON[d.getMonth()]; };
W.fmtShort = function(ts){ var d = new Date(ts); return d.getDate() + " " + MON[d.getMonth()]; };
W.fmtTime = function(ts){ var d = new Date(ts); return ("0"+d.getHours()).slice(-2) + ":" + ("0"+d.getMinutes()).slice(-2); };
W.fmtDay = function(ts){ var n = W.dayDiff(ts); if (n === 0) return "Today"; if (n === 1) return "Tomorrow"; if (n === -1) return "Yesterday"; return W.fmtDate(ts); };
/* "in 3 days", "2 days late", "today" — the wording used on every due chip */
W.dueText = function(ts){ var n = W.dayDiff(ts); if (n === 0) return "today"; if (n === 1) return "tomorrow"; if (n === -1) return "1 day late"; if (n < 0) return (-n) + " days late"; if (n < 7) return "in " + n + " days"; return W.fmtShort(ts); };
W.dueTone = function(ts){ var n = W.dayDiff(ts); return n < 0 ? "late" : n <= 1 ? "soon" : ""; };
W.ago = function(ts){ var s = Math.max(0, (W.now() - ts) / 1000); if (s < 45) return "just now"; if (s < 3600) return Math.round(s/60) + " min ago"; if (s < 86400) return Math.round(s/3600) + " h ago"; var d = Math.round(s/86400); return d === 1 ? "yesterday" : d + " days ago"; };
W.dur = function(min){ min = Math.round(min); if (min < 60) return min + " min"; var h = Math.floor(min/60), m = min % 60; return h + " h" + (m ? " " + m + " min" : ""); };

/* ---------- numbers & text ---------- */
W.fmtK = function(n){ if (n == null) return "–"; if (n >= 1e6) return (n/1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/,"") + "M"; if (n >= 1e3) return (n/1e3).toFixed(n >= 1e5 ? 0 : 1).replace(/\.0$/,"") + "K"; return String(n); };
/* text that quotes an amount (a counter-offer, a budget) hides it from roles that don't see money */
W.maskMoney = function(t){ return typeof t === "string" && W.canSeeMoney && W.S.state && !W.canSeeMoney() ? t.replace(/\$\s?\d[\d,.]*[KM]?(\s?[–-]\s?\$?\d[\d,.]*[KM]?)?/g, "$ hidden") : t; };
W.money = function(n){ if (n == null) return "–"; if (W.canSeeMoney && W.S.state && !W.canSeeMoney()) return "$ hidden"; return (n < 0 ? "−$" : "$") + Math.abs(Math.round(n)).toLocaleString("en-US"); };
W.pct = function(n, d){ return (d ? Math.round(1000*n/d)/10 : n) + "%"; };
W.plural = function(n, one, many){ return n + " " + (n === 1 ? one : (many || one + "s")); };
W.cx = function(){ return Array.prototype.filter.call(arguments, Boolean).join(" "); };
W.hash = function(s){ var x = 2166136261; s = String(s); for (var i = 0; i < s.length; i++){ x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; };
W.initials = function(name){ var p = String(name).replace(/^@/,"").split(/\s+/).filter(Boolean); return ((p[0]||"?")[0] + (p[1] ? p[1][0] : (p[0]||"")[1] || "")).toUpperCase(); };
var AV = ["#2c6e9b","#7b4fae","#a3471f","#1f7a5a","#9a3b62","#3d5aa8","#86651a","#2f7f86","#6b5ca5","#a8452e"];
W.avColor = function(seed){ return AV[W.hash(seed) % AV.length]; };
W.uid = function(p){ return (p||"x") + Math.random().toString(36).slice(2, 8); };
W.clamp = function(v, a, b){ return Math.max(a, Math.min(b, v)); };
W.sum = function(a, f){ return a.reduce(function(s, x){ return s + (f ? f(x) : x); }, 0); };
W.by = function(f, dir){ return function(a, b){ var x = f(a), y = f(b); return (x < y ? -1 : x > y ? 1 : 0) * (dir || 1); }; };

/* ---------- store ----------
   state = {data, ui}. data is the business (undoable). ui is where you are (not undoable).
   W.act(label, fn, opts) changes data and records an undo snapshot.
   W.ui(fn) changes ui only. W.bg(fn) is for background jobs: it applies fn to data AND to every
   undo/redo snapshot, so undoing an older action never deletes what a job produced since. */
var S = W.S = {state:null, ver:0, subs:[], undo:[], redo:[]};
function emit(){ S.ver++; for (var i = 0; i < S.subs.length; i++) S.subs[i](); }
W.emit = emit;
W.subscribe = function(f){ S.subs.push(f); return function(){ S.subs = S.subs.filter(function(x){ return x !== f; }); }; };
W.useApp = function(){ R.useSyncExternalStore(W.subscribe, function(){ return S.ver; }); return S.state; };
W.init = function(data, ui){ S.state = {data:data, ui:ui}; };
W.D = function(){ return S.state.data; };
W.U = function(){ return S.state.ui; };
var clone = window.structuredClone ? function(o){ return window.structuredClone(o); } : function(o){ return JSON.parse(JSON.stringify(o)); };
var savingTimer = null;
function saving(){
  S.state.ui.saving = true;
  clearTimeout(savingTimer);
  savingTimer = setTimeout(function(){ S.state.ui.saving = false; S.state.ui.savedAt = W.now(); emit(); }, 700);
}
W.act = function(label, fn, opts){
  opts = opts || {};
  var before = clone(S.state.data);
  var r = fn(S.state.data, S.state.ui);
  if (r === false) return false;
  S.undo.push({label:label, data:before, at:W.now()});
  if (S.undo.length > 80) S.undo.shift();
  S.redo = [];
  if (opts.log !== false) S.state.data.log.unshift({id:W.uid("l"), at:W.now(), who:S.state.data.me || "u1", text:label, ref:opts.ref || null});
  saving();
  var depth = S.undo.length;
  if (opts.toast){
    var t = opts.toast;
    W.toast({msg:t.msg || label, sub:t.sub, icon:t.icon || "check", tone:t.tone || "good", ms:t.ms,
      actions:(t.go ? [{label:t.go.label || "View", run:t.go.run}] : []).concat(t.undo === false ? [] : [{label:"Undo", kbd:"Ctrl Z", run:function(){ if (S.undo.length === depth) W.undo(); else W.toast({msg:"Newer changes came after this one", sub:"Use Ctrl Z to step back through them in order.", icon:"info", tone:"info"}); }}])});
  }
  emit();
  return r;
};
W.undo = function(){
  var u = S.undo.pop(); if (!u) { W.toast({msg:"Nothing to undo", icon:"info", tone:"info", ms:2500}); return; }
  S.redo.push({label:u.label, data:clone(S.state.data), at:W.now()});
  S.state.data = u.data; saving();
  W.toast({msg:"Undone", sub:u.label, icon:"undo", tone:"info", ms:4000, actions:[{label:"Redo", kbd:"Ctrl Shift Z", run:W.redo}]});
  emit();
};
W.redo = function(){
  var r = S.redo.pop(); if (!r) return;
  S.undo.push({label:r.label, data:clone(S.state.data), at:W.now()});
  S.state.data = r.data; saving();
  W.toast({msg:"Redone", sub:r.label, icon:"redo", tone:"info", ms:3000});
  emit();
};
W.ui = function(fn){ fn(S.state.ui, S.state.data); emit(); };
W.bg = function(fn){
  fn(S.state.data);
  S.undo.forEach(function(u){ fn(u.data); });
  S.redo.forEach(function(r){ fn(r.data); });
  emit();
};

/* ---------- navigation ----------
   A route is {s:screen, tab?, rec?:{t:"creator"|"brand"|"deal", id}}. Every move goes into a history
   list so Alt+Left / Alt+Right and the back/forward buttons work across screens, tabs and records. */
W.screens = {};
W.go = function(s, tab, extra){
  var route = Object.assign({s:s, tab:tab || null}, extra || {});
  W.ui(function(u){
    var cur = u.hist[u.histI];
    if (cur && JSON.stringify(cur) === JSON.stringify(route)) return;
    u.hist = u.hist.slice(0, u.histI + 1); u.hist.push(route); u.histI = u.hist.length - 1;
    u.route = route; u.menu = null;
    if (!extra || !extra.keepPeek) u.peek = null;
    u.railOpen = false;
  });
  var c = document.querySelector(".content"); if (c) c.scrollTop = 0;
};
W.setTab = function(tab){ var r = S.state.ui.route; W.go(r.s, tab, r.rec ? {rec:r.rec} : null); };
W.back = function(){ W.ui(function(u){ if (u.histI > 0){ u.histI--; u.route = u.hist[u.histI]; u.peek = null; } }); };
W.fwd = function(){ W.ui(function(u){ if (u.histI < u.hist.length - 1){ u.histI++; u.route = u.hist[u.histI]; u.peek = null; } }); };
/* peek: open a record beside the current list without leaving it. list = ids in on-screen order, so ↑/↓ walks them. */
W.peek = function(t, id, list){ W.ui(function(u){ u.peek = {t:t, id:id, list:list || null}; u.recent = [{t:t, id:id}].concat((u.recent||[]).filter(function(r){ return !(r.t === t && r.id === id); })).slice(0, 8); }); };
W.closePeek = function(){ W.ui(function(u){ u.peek = null; }); };
W.openRec = function(t, id){ var r = S.state.ui.route; W.go("rec", null, {rec:{t:t, id:id}, from:r.s}); W.ui(function(u){ u.recent = [{t:t, id:id}].concat((u.recent||[]).filter(function(x){ return !(x.t === t && x.id === id); })).slice(0, 8); }); };

/* ---------- keyboard ----------
   Screens register handlers with W.useKeys({ "j": fn, "mod+enter": fn }). The newest active registration
   runs first; returning false lets the key fall through. Plain letters are ignored while typing. */
var keyStack = [];
W.useKeys = function(map, active, opts){
  var ref = R.useRef(map); ref.current = map;
  var barrier = !!(opts && opts.barrier);
  R.useEffect(function(){
    if (active === false) return;
    /* a barrier (a modal, a menu, comment mode) stops keys it doesn't handle from reaching the screen behind it */
    var entry = {get:function(){ return ref.current; }, barrier:barrier};
    keyStack.push(entry);
    return function(){ keyStack = keyStack.filter(function(e){ return e !== entry; }); };
  }, [active, barrier]);
};
W.keyBarrier = function(){ return keyStack.some(function(e){ return e.barrier; }); };
/* keyboard actions never animate: for a moment after a handled key, durations drop to zero */
var quietT = null;
W.kbdQuiet = function(){ var r = document.documentElement; r.dataset.input = "kbd"; clearTimeout(quietT); quietT = setTimeout(function(){ delete r.dataset.input; }, 400); };
W.keyName = function(e){
  var k = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  if (k === " ") k = "space";
  var parts = [];
  if (e.ctrlKey || e.metaKey) parts.push("mod");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey && k.length > 1) parts.push("shift");
  parts.push(k);
  return parts.join("+");
};
W.typing = function(el){ el = el || document.activeElement; return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable); };
W.dispatchKey = function(e){
  if (e.defaultPrevented) return false;   // a field or popup already handled this key
  var name = W.keyName(e);
  var inField = W.typing(e.target);
  var plain = !/^(mod|alt)\+/.test(name) && name !== "escape" && !/^f\d/.test(name);
  if (inField && plain) return false;
  /* Settings › Keyboard can turn single-letter keys off (screen readers, dictation); arrows, Enter and Esc still work */
  if (W.lettersOff && name.length === 1) return false;
  for (var i = keyStack.length - 1; i >= 0; i--){
    var f = keyStack[i].get()[name];
    if (f && f(e) !== false){ e.preventDefault(); W.kbdQuiet(); return true; }
    if (keyStack[i].barrier) return false;
  }
  return false;
};

/* ---------- toasts ---------- */
W.toast = function(t){
  var id = W.uid("t"), tt = Object.assign({id:id}, t);
  if (!tt.ms) tt.ms = 6500;   // an undefined ms must not switch auto-dismiss off
  S.state.ui.toasts = S.state.ui.toasts.concat([tt]).slice(-3);
  emit();
  return id;
};
W.dismiss = function(id){ W.ui(function(u){ u.toasts = u.toasts.filter(function(t){ return t.id !== id; }); }); };

/* ---------- menus ----------
   W.menu(event, items, opts) opens a dropdown at the clicked control. items: {label, icon, hint, run, danger} | {sep:true} | {head:"..."} */
W.menu = function(e, items, opts){
  var r = (e.currentTarget || e.target).getBoundingClientRect();
  W.ui(function(u){ u.menu = {x:r.left, y:r.bottom + 4, right:r.right, top:r.top, items:items, align:(opts && opts.align) || "start"}; });
};
W.closeMenu = function(){ if (S.state.ui.menu) W.ui(function(u){ u.menu = null; }); };

/* each screen file adds its own styles with W.css(`...`), using the tokens from index.html */
W.css = function(text){ var el = document.createElement("style"); el.textContent = text; document.head.appendChild(el); };

W.copy = function(text, what){
  function done(){ W.toast({msg:"Copied " + (what || "to the clipboard"), sub:text.length > 60 ? text.slice(0, 60) + "…" : text, icon:"copy", tone:"info", ms:2500}); }
  try { navigator.clipboard.writeText(text).then(done, done); } catch (err){ done(); }
};

/* ---------- icons (authored SVG, one stroke weight) ---------- */
var I = {
  gear:["M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z","c:12,12,3"],
  flask:["M10 2v7.53a2 2 0 0 1-.21.9L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.07-10.12A2 2 0 0 1 14 9.53V2","M8.5 2h7","M7 16h10"],
  chat:["M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"],
  sun:["c:12,12,4","M12 2v2","M12 20v2","m4.93 4.93 1.41 1.41","m17.66 17.66 1.41 1.41","M2 12h2","M20 12h2","m6.34 17.66-1.41 1.41","m19.07 4.93-1.41 1.41"],
  search:["c:11,11,7","m20 20-3.6-3.6"],
  scan:["M3 7V5a2 2 0 0 1 2-2h2","M17 3h2a2 2 0 0 1 2 2v2","M21 17v2a2 2 0 0 1-2 2h-2","M7 21H5a2 2 0 0 1-2-2v-2","c:11.5,11.5,3.2","m16 16-2.2-2.2"],
  send:["M22 2 11 13","M22 2 15 22l-4-9-9-4z"],
  pen:["M12.5 22H18a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v9.5","M14 2v4a2 2 0 0 0 2 2h4","M13.4 15.6a1 1 0 1 0-3-3l-5 5a2 2 0 0 0-.5.9l-.8 2.8a.5.5 0 0 0 .6.6l2.8-.8a2 2 0 0 0 .9-.5z"],
  box:["m7.5 4.27 9 5.15","M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z","m3.3 7 8.7 5 8.7-5","M12 22V12"],
  wallet:["M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1","M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"],
  chart:["M3 3v18h18","M18 17V9","M13 17V5","M8 17v-3"],
  wrench:["M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"],
  users:["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2","c:9,7,4","M22 21v-2a4 4 0 0 0-3-3.87","M16 3.13a4 4 0 0 1 0 7.75"],
  user:["M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2","c:12,7,4"],
  map:["M14.1 5.55a2 2 0 0 0 1.8 0l3.66-1.83A1 1 0 0 1 21 4.62v12.76a1 1 0 0 1-.55.9l-4.55 2.27a2 2 0 0 1-1.8 0l-4.2-2.1a2 2 0 0 0-1.8 0l-3.66 1.83A1 1 0 0 1 3 19.38V6.62a1 1 0 0 1 .55-.9l4.55-2.27a2 2 0 0 1 1.8 0z","M15 5.76v15","M9 3.24v15"],
  sliders:["M4 21v-7","M4 10V3","M12 21v-9","M12 8V3","M20 21v-5","M20 12V3","M2 14h4","M10 8h4","M18 16h4"],
  bell:["M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9","M10.3 21a1.94 1.94 0 0 0 3.4 0"],
  undo:["M3 7v6h6","M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"],
  redo:["M21 7v6h-6","M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"],
  check:["M20 6 9 17l-5-5"],
  checkc:["c:12,12,10","m8.5 12 2.5 2.5 4.5-5"],
  x:["M18 6 6 18","m6 6 12 12"],
  chevR:["m9 18 6-6-6-6"], chevL:["m15 18-6-6 6-6"], chevD:["m6 9 6 6 6-6"], chevU:["m18 15-6-6-6 6"],
  arrowR:["M5 12h14","m12 5 7 7-7 7"], arrowL:["M19 12H5","m12 19-7-7 7-7"],
  clock:["c:12,12,10","M12 6v6l4 2"],
  alarm:["c:12,13,8","M12 9v4l2 2","M5 3 2 6","m22 6-3-3"],
  mail:["r:2,4,20,16,2","m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"],
  reply:["m9 17-5-5 5-5","M20 18v-2a4 4 0 0 0-4-4H4"],
  sparkle:["M9.94 14.06 8.5 19l-1.44-4.94L2 12.5l5.06-1.44L8.5 6l1.44 5.06L15 12.5z","M18 3v4","M20 5h-4","M19 16v4","M21 18h-4"],
  shield:["M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"],
  alert:["m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3","M12 9v4","M12 17h.01"],
  lock:["r:3,11,18,11,2","M7 11V7a5 5 0 0 1 10 0v4"],
  unlock:["r:3,11,18,11,2","M7 11V7a5 5 0 0 1 9.9-1"],
  external:["M15 3h6v6","M10 14 21 3","M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"],
  filter:["M22 3H2l8 9.46V19l4 2v-8.54z"],
  grid:["r:3,3,7,7,1","r:14,3,7,7,1","r:14,14,7,7,1","r:3,14,7,7,1"],
  list:["M8 6h13","M8 12h13","M8 18h13","M3 6h.01","M3 12h.01","M3 18h.01"],
  columns:["r:3,3,18,18,2","M9 3v18","M15 3v18"],
  rows:["r:3,3,18,18,2","M3 9h18","M3 15h18"],
  play:["m6 3 14 9-14 9z"], pause:["r:6,4,4,16,1","r:14,4,4,16,1"],
  plus:["M12 5v14","M5 12h14"], minus:["M5 12h14"],
  more:["c:12,12,1","c:19,12,1","c:5,12,1"],
  star:["M12 2 15.09 8.26 22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"],
  pin:["M12 17v5","M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"],
  keyboard:["r:2,4,20,16,2","M6 8h.01","M10 8h.01","M14 8h.01","M18 8h.01","M8 12h.01","M12 12h.01","M16 12h.01","M7 16h10"],
  moon:["M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"],
  eye:["M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z","c:12,12,3"],
  copy:["r:8,8,14,14,2","M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"],
  calendar:["r:3,4,18,18,2","M16 2v4","M8 2v4","M3 10h18"],
  dollar:["M12 2v20","M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"],
  link:["M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71","M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"],
  video:["r:2,6,14,12,2","m22 8-6 4 6 4z"],
  flag:["M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z","M4 22v-7"],
  refresh:["M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8","M21 3v5h-5","M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16","M8 16H3v5"],
  inbox:["M22 12h-6l-2 3h-4l-2-3H2","M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"],
  bolt:["M13 2 3 14h9l-1 8 10-12h-9z"],
  timer:["M10 2h4","M12 14l3-3","c:12,14,8"],
  target:["c:12,12,10","c:12,12,6","c:12,12,2"],
  forward:["m15 17 5-5-5-5","M4 18v-2a4 4 0 0 1 4-4h12"],
  trash:["M3 6h18","M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6","M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"],
  ban:["c:12,12,10","m4.9 4.9 14.2 14.2"],
  edit:["M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"],
  file:["M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z","M14 2v4a2 2 0 0 0 2 2h4"],
  globe:["c:12,12,10","M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20","M2 12h20"],
  sidebar:["r:3,3,18,18,2","M9 3v18"],
  note:["M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5z","M15 3v6h6"],
  at:["c:12,12,4","M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"],
  gauge:["m12 14 4-4","M3.34 19a10 10 0 1 1 17.32 0"],
  compare:["M8 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h3","M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3","M12 20v2","M12 14v2","M12 8v2","M12 2v2"],
  tag:["M12.59 2.59A2 2 0 0 0 11.17 2H4a2 2 0 0 0-2 2v7.17a2 2 0 0 0 .59 1.42l8.7 8.7a2.43 2.43 0 0 0 3.42 0l6.58-6.58a2.43 2.43 0 0 0 0-3.42z","c:7.5,7.5,.6"],
  info:["c:12,12,10","M12 16v-4","M12 8h.01"],
  help:["c:12,12,10","M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3","M12 17h.01"],
  gem:["M6 3h12l4 6-10 13L2 9z","M11 3 8 9l4 13 4-13-3-6","M2 9h20"],
  coffee:["M10 2v2","M14 2v2","M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1","M6 2v2"],
  layers:["m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z","m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65","m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"],
  paste:["M15 2H9a1 1 0 0 0-1 1v2c0 .6.4 1 1 1h6c.6 0 1-.4 1-1V3c0-.6-.4-1-1-1z","M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2"],
  hand:["M18 11V6a2 2 0 0 0-4 0","M14 10V4a2 2 0 0 0-4 0v2","M10 10.5V6a2 2 0 0 0-4 0v8","M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"],
  trend:["m22 7-8.5 8.5-5-5L2 17","M16 7h6v6"],
  moveup:["m5 12 7-7 7 7","M12 19V5"],
  dot:["c:12,12,3"]
};
W.ICONS = I;
W.Icon = function(p){
  var parts = I[p.n] || I.dot;
  return h("svg", {className:"ic" + (p.cls ? " " + p.cls : ""), viewBox:"0 0 24 24", width:p.s || 16, height:p.s || 16, "aria-hidden":p.title ? null : "true", role:p.title ? "img" : null, style:p.style || null},
    p.title ? h("title", null, p.title) : null,
    parts.map(function(d, i){
      if (d.slice(0, 2) === "c:"){ var c = d.slice(2).split(","); return h("circle", {key:i, cx:c[0], cy:c[1], r:c[2]}); }
      if (d.slice(0, 2) === "r:"){ var r = d.slice(2).split(","); return h("rect", {key:i, x:r[0], y:r[1], width:r[2], height:r[3], rx:r[4] || 0}); }
      return h("path", {key:i, d:d});
    }));
};
})();
