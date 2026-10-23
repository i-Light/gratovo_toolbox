/* more.js — Insights, Toolbox and Team.
   Insights: real SVG charts drawn to scale, Input-Driven Reverse Funnel Planner (FND-DLV-21), 50-Send Batch Ghosting Diagnostics (FND-DLV-22 / BRD-FU-12), and channel analytics.
   Toolbox: Multi-Format Pricing & 3-Option Package Calculator, Archive, Never Contact, Scheduled, Logs, Notifications, Rules, Facts, Health.
   Team: People, Load, Rebalance, First-Week VA Onboarding Checklist (QOL[210]), VA Shadow-Approval Mode, and Permissions. */
(function(){
"use strict";
var W = window.W, html = W.html, Icon = W.Icon, useState = W.useState, useEffect = W.useEffect, useRef = W.useRef, useLayoutEffect = W.useLayoutEffect;
var Btn = W.Btn, Tag = W.Tag;

W.css(`
:root{--ser-1:#0079ba; --ser-2:#cf6d14}
@media (prefers-color-scheme: dark){ :root:not([data-theme="light"]){ --ser-1:#3a9ad3; --ser-2:#c8711f } }
:root[data-theme="dark"]{ --ser-1:#3a9ad3; --ser-2:#c8711f }

.ix{position:relative; min-width:0; width:100%}
.ix svg{display:block; overflow:visible}
.ix:focus-visible{outline:2px solid var(--accent); outline-offset:4px; border-radius:6px}
.chart text.val{fill:var(--ink-2); font-weight:500}
.chart text.cap{fill:var(--ink-2); font-weight:500}
.chart .hit{fill:transparent; outline:none}
.chart .hit:focus-visible{stroke:var(--accent); stroke-width:2}
.chart .xh{stroke:var(--muted); stroke-width:1}
.chart .wk{fill:var(--sunk)}
.cht{position:absolute; z-index:6; pointer-events:none; background:var(--panel); color:var(--ink); border-radius:9px; padding:8px 11px; font-size:12px; box-shadow:var(--shadow-2); display:flex; flex-direction:column; gap:3px; min-width:150px; white-space:nowrap}
.cht .d{font-weight:600; margin-bottom:2px}
.cht .r{display:flex; align-items:center; gap:8px}
.cht .r b{font-weight:600; font-variant-numeric:tabular-nums}
.cht .r span{color:var(--ink-2)}
.cht .r.m span{color:var(--muted)}
.lk{display:inline-block; width:16px; height:2px; border-radius:1px; background:var(--c, var(--hue)); flex:none}
.legend .lk{width:16px; height:2px; border-radius:1px; background:var(--hue)}
.legend .wkx{width:12px; height:9px; border-radius:2px; background:var(--sunk); box-shadow:inset 0 0 0 1px var(--line)}
.legend .sw{background:var(--hue)}
.cap-line{font-size:12.5px; color:var(--ink-2); max-width:78ch}
.bench{position:relative; height:6px; border-radius:3px; background:var(--sunk-2); margin:4px 0 2px}
.bench i{position:absolute; inset-block:0; inset-inline-start:0; border-radius:3px; background:var(--ser-1)}
.bench u{position:absolute; top:-3px; bottom:-3px; width:2px; margin-inline-start:-1px; background:var(--ink-2); border-radius:1px}
.fn{display:flex; flex-direction:column; gap:6px}
.fn-row{display:grid; grid-template-columns:minmax(72px,104px) minmax(0,1fr) 86px; gap:12px; align-items:center; padding:5px 6px; border-radius:7px; border:0; background:none; text-align:start; color:inherit; width:100%; font-size:12.5px}
button.fn-row:hover{background:var(--sunk)}
.fn-row .tr{height:14px; border-radius:0 4px 4px 0; background:var(--sunk-2); position:relative; overflow:hidden}
.fn-row .tr i{position:absolute; inset-block:0; inset-inline-start:0; background:var(--ser-1); border-radius:0 4px 4px 0}
.fn-row .fv{display:flex; align-items:baseline; gap:8px; justify-content:flex-end; font-variant-numeric:tabular-nums}
.fn-row .fv b{font-weight:600}
.cbars .hbar .tr i{background:var(--ser-1)}
.cbars .hbar.o .tr i{background:var(--faint)}
div.hbar{cursor:default}
div.hbar:hover{background:none}
.thb{border:0; background:none; font:inherit; color:inherit; text-transform:inherit; letter-spacing:inherit; display:inline-flex; align-items:center; gap:4px; padding:0}
.thb:hover{color:var(--ink)}
.numtw{max-height:320px}
.kwt td:first-child{min-width:170px}
.tw.flat{border-radius:var(--r-m)}
.tbl tr.sum td{font-weight:600; background:var(--sunk)}

.tb{display:grid; grid-template-columns:minmax(250px,320px) minmax(0,1fr); gap:var(--gap); align-items:start}
.tb-list{position:sticky; top:0; padding:6px; gap:0}
.tb-list .li{align-items:flex-start; padding:8px 8px}
.tb-list .lt small{white-space:normal; overflow:visible; text-overflow:clip; line-height:1.35}
.tb-ic{width:28px; height:28px; border-radius:8px; display:grid; place-items:center; flex:none; background:var(--sunk-2); color:var(--ink-2)}
.tb-list .li[aria-selected="true"] .tb-ic{background:var(--accent); color:var(--accent-ink)}
.tb-pane{min-height:420px}
.tb-calc{display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:20px; align-items:start}
.tb-calc .rng{flex:1 1 auto; min-width:0; width:100%}
.big{font-size:2rem; font-weight:600; letter-spacing:-.02em; line-height:1.15}
.pillrow{display:flex; flex-wrap:wrap; gap:6px}
@media (max-width:980px){
  .tb,.tb-calc{grid-template-columns:minmax(0,1fr)}
  .tb-list{position:static}
  .tb-list .bucket-h{display:none}
  .tb-list .bucket{flex-direction:row; flex:none}
  .tb-list{flex-direction:row; overflow-x:auto; padding:6px}
  .tb-list .li{width:auto; flex:none; white-space:nowrap; align-items:center}
  .tb-list .lt small{display:none}
}
.tm-load{display:flex; flex-direction:column; gap:6px}
.tm-perm td:not(:first-child),.tm-perm th:not(:first-child){min-width:130px}
.cellv{display:inline-flex; align-items:center; gap:6px; white-space:nowrap}
.cellv.y{color:var(--good)} .cellv.n{color:var(--muted)} .cellv.p{color:var(--warn)}
`);

function D(){ return W.D(); }
function num(v, d){ var n = parseFloat(String(v == null ? "" : v).replace(/,/g, "")); return isNaN(n) ? (d == null ? 0 : d) : n; }
function nf(n){ return Math.round(n).toLocaleString("en-US"); }
function pct1(n){ return (Math.round(n * 10) / 10) + "%"; }
function kusd(n){ return n === 0 ? "0" : "$" + W.fmtK(n); }
var DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
function isWeekend(ts){ var g = new Date(ts).getDay(); return g === 0 || g === 6; }
function ns(name, def){ return Object.assign({}, def, W.U()[name] || {}); }
function setNs(name, def, patch){ W.ui(function(u){ var cur = Object.assign({}, def, u[name] || {}); u[name] = Object.assign(cur, typeof patch === "function" ? patch(cur) : patch); }); }
function refOf(id){ return W.creator(id) ? {t:"creator", id:id} : W.brand(id) ? {t:"brand", id:id} : W.deal(id) ? {t:"deal", id:id} : null; }

function useWidth(){
  var ref = useRef(null), st = useState(0);
  useLayoutEffect(function(){
    var el = ref.current; if (!el) return;
    function m(){ var w = Math.round(el.getBoundingClientRect().width); st[1](function(o){ return o === w ? o : w; }); }
    m();
    var ro = window.ResizeObserver ? new window.ResizeObserver(m) : null;
    if (ro) ro.observe(el); else window.addEventListener("resize", m);
    return function(){ if (ro) ro.disconnect(); else window.removeEventListener("resize", m); };
  }, []);
  return [ref, st[0]];
}
function niceScale(max, target, int){
  max = Math.max(max, int ? 1 : 0.0001);
  var raw = max / target, pow = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), f = raw / pow;
  var step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow;
  if (int) step = Math.max(1, Math.ceil(step));
  var top = Math.ceil(max / step - 1e-9) * step, ticks = [];
  for (var v = 0; v <= top + 1e-9; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return {max:top, step:step, ticks:ticks};
}
function pickTicks(n, spacing, labelW){
  var step = Math.max(1, Math.ceil(labelW / Math.max(spacing, 1))), out = [];
  for (var i = n - 1; i >= 0; i -= step) out.push(i);
  return out.reverse();
}
function colPath(x, y, bw, bh, r){
  r = Math.min(r, bw / 2, bh);
  return "M" + x + "," + (y + bh) + " L" + x + "," + (y + r) + " Q" + x + "," + y + " " + (x + r) + "," + y + " L" + (x + bw - r) + "," + y + " Q" + (x + bw) + "," + y + " " + (x + bw) + "," + (y + r) + " L" + (x + bw) + "," + (y + bh) + " Z";
}
function csv(cols, rows){
  function q(v){ v = String(v); return /[",\n]/.test(v) ? "\"" + v.replace(/"/g, "\"\"") + "\"" : v; }
  return [cols.map(function(c){ return q(c.h); }).join(",")].concat(rows.map(function(r){ return r.map(q).join(","); })).join("\n");
}

/* ======================================================================= INSIGHTS */
var INS_DEF = {period:30, tables:{}, kwSort:"rate", kwDir:-1};
var TARGET = ["US","GB","CA","AU"];
var FIND_CLEAR = {stages:[], signals:[], countries:[], minMedian:0, maxMedian:null, minUp:0, owners:[], runs:[], q:""};

function openGallery(patch){
  W.ui(function(u){ u.find = Object.assign({}, u.find || {}, FIND_CLEAR, patch); });
  W.go("find", "gallery");
}

function dayVal(kind, i){
  if (i < 30) return D().hist[kind][29 - i].v;
  var weekend = isWeekend(W.at(-i));
  var s = weekend ? 4 + (W.hash("s" + i) % 6) : 28 + (W.hash("s" + i) % 22);
  return kind === "sent" ? s : Math.round(s * (0.04 + (W.hash("r" + i) % 5) / 100));
}
function series(period, skip){
  var out = [];
  for (var i = period - 1 + skip; i >= skip; i--){ var at = W.at(-i); out.push({i:i, at:at, wk:isWeekend(at), sent:dayVal("sent", i), replies:dayVal("replies", i)}); }
  return out;
}
function dayLabel(r, short){ var d = new Date(r.at); return r.i === 0 ? "Today" : short ? DOW[d.getDay()] + " " + d.getDate() : W.fmtShort(r.at); }

function NumTable(p){
  var csvText = csv(p.cols, p.rows);
  return html`<div class="col tight">
    <div class=${W.cx("tw flat", p.scroll ? "numtw" : null)}><table class="tbl"><thead><tr>${p.cols.map(function(c, i){ return html`<th key=${i} class=${c.n ? "n" : null}>${c.h}</th>`; })}</tr></thead>
      <tbody>${p.rows.map(function(r, i){ return html`<tr key=${i}>${r.map(function(v, j){ return html`<td key=${j} class=${p.cols[j].n ? "n" : null}>${v}</td>`; })}</tr>`; })}</tbody></table></div>
    <div class="row"><button type="button" class="btn ghost sm" onClick=${function(){ W.copy(csvText, "the numbers as CSV"); }}><${Icon} n="copy" />Copy as CSV</button><span class="hint">Same numbers as the chart, nothing hidden behind hover.</span></div>
  </div>`;
}
function ChartCard(p){
  var S = ns("insights", INS_DEF), open = !!S.tables[p.id];
  function toggle(){ setNs("insights", INS_DEF, function(cur){ var t = Object.assign({}, cur.tables); t[p.id] = !t[p.id]; return {tables:t}; }); }
  return html`<div class=${W.cx("card", p.cls)} data-why=${"chart-" + p.id}>
    <div class="card-h" style=${{alignItems:"flex-start"}}><div class="grow col t2"><h3>${p.title}</h3>${p.sub ? html`<span class="small muted">${p.sub}</span>` : null}</div>
      ${p.table ? html`<button type="button" class="btn ghost sm" aria-expanded=${String(open)} onClick=${toggle}><${Icon} n=${open ? "chevU" : "list"} />${open ? "Hide the numbers" : "See the numbers"}</button>` : null}</div>
    ${p.legend || null}
    ${p.children}
    ${p.take ? html`<p class="cap-line">${p.take}</p>` : null}
    ${open && p.table ? html`<${NumTable} cols=${p.table.cols} rows=${p.table.rows} scroll=${p.table.scroll} />` : null}
  </div>`;
}

function LineChart(p){
  var m = useWidth(), ref = m[0], w = Math.max(m[1] || 640, 280);
  var hs = useState(null), hv = hs[0], setHv = hs[1];
  var days = p.days, n = days.length;
  var L = 40, R = 14, T = 22, h1 = 148, gap = 36, h2 = 76, AX = 28, H = T + h1 + gap + h2 + AX;
  var x0 = L + 8, x1 = w - R - 8, dx = n > 1 ? (x1 - x0) / (n - 1) : 0;
  function X(i){ return x0 + dx * i; }
  var s1 = niceScale(Math.max.apply(null, days.map(function(r){ return r.sent; })), 2, true);
  var s2 = niceScale(Math.max.apply(null, days.map(function(r){ return r.replies; })), 3, true);
  var top2 = T + h1 + gap;
  function Y1(v){ return T + h1 - v / s1.max * h1; }
  function Y2(v){ return top2 + h2 - v / s2.max * h2; }
  function path(key, Y){ return days.map(function(r, i){ return (i ? "L" : "M") + X(i).toFixed(1) + "," + Y(r[key]).toFixed(1); }).join(""); }
  var ticks = pickTicks(n, dx, 58), few = n <= 14;
  function onMove(e){ if (!dx) return; var r = e.currentTarget.getBoundingClientRect(); var sx = e.clientX - r.left + L; var i = W.clamp(Math.round((sx - x0) / dx), 0, n - 1); if (i !== hv) setHv(i); }
  function onKey(e){
    var k = e.key, i = hv == null ? n - 1 : hv;
    if (k === "ArrowLeft") i = Math.max(0, i - 1); else if (k === "ArrowRight") i = Math.min(n - 1, i + 1); else if (k === "Home") i = 0; else if (k === "End") i = n - 1; else if (k === "Escape"){ setHv(null); return; } else return;
    e.preventDefault(); setHv(i);
  }
  var cur = hv == null ? null : days[hv];
  var left = hv != null && X(hv) > w * .55;
  function panel(Y, sc, top, h, key, color){
    return html`<g key=${key}>
      ${days.map(function(r, i){ var bx = Math.max(L, X(i) - dx / 2), be = Math.min(w - R, X(i) + dx / 2); return r.wk ? html`<rect key=${"w" + i} class="wk" x=${bx} y=${top} width=${be - bx} height=${h} />` : null; })}
      ${sc.ticks.map(function(t){ return html`<g key=${t}><line class="gridl" x1=${L} x2=${w - R} y1=${Y(t)} y2=${Y(t)} /><text x=${L - 8} y=${Y(t)} dy="0.35em" textAnchor="end">${nf(t)}</text></g>`; })}
      <path d=${path(key, Y)} fill="none" stroke=${color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      ${few ? days.map(function(r, i){ return i === n - 1 ? null : html`<circle key=${"m" + i} cx=${X(i)} cy=${Y(r[key])} r="4" fill=${color} stroke="var(--panel)" strokeWidth="2" />`; }) : null}
      <circle cx=${X(n - 1)} cy=${Y(days[n - 1][key])} r="4" fill="var(--panel)" stroke=${color} strokeWidth="2" />
      ${hv != null ? html`<circle cx=${X(hv)} cy=${Y(days[hv][key])} r="5" fill=${color} stroke="var(--panel)" strokeWidth="2" />` : null}
    </g>`;
  }
  return html`<div class="ix" ref=${ref} tabIndex="0" role="group" aria-label=${"Emails sent and replies for each of the last " + n + " days."} onKeyDown=${onKey} onFocus=${function(){ if (hv == null) setHv(n - 1); }} onBlur=${function(){ setHv(null); }}>
    <svg class="chart" width=${w} height=${H} viewBox=${"0 0 " + w + " " + H} aria-hidden="true">
      <text x=${L} y=${T - 8}>Emails sent per day</text>
      <text x=${L} y=${top2 - 10}>Replies per day</text>
      ${panel(Y1, s1, T, h1, "sent", "var(--ser-1)")}
      ${panel(Y2, s2, top2, h2, "replies", "var(--ser-2)")}
      <line class="axis" x1=${L} x2=${w - R} y1=${T + h1} y2=${T + h1} />
      <line class="axis" x1=${L} x2=${w - R} y1=${top2 + h2} y2=${top2 + h2} />
      ${ticks.map(function(i){ return html`<g key=${"x" + i}><line class="axis" x1=${X(i)} x2=${X(i)} y1=${top2 + h2} y2=${top2 + h2 + 4} /><text x=${X(i)} y=${top2 + h2 + 18} textAnchor=${i === n - 1 ? "end" : "middle"} dx=${i === n - 1 ? 8 : 0}>${dayLabel(days[i], n <= 7)}</text></g>`; })}
      ${hv != null ? html`<line class="xh" x1=${X(hv)} x2=${X(hv)} y1=${T} y2=${top2 + h2} />` : null}
      <rect x=${L} y=${0} width=${w - L - R} height=${top2 + h2 + 1} fill="transparent" onPointerMove=${onMove} onPointerDown=${onMove} onPointerLeave=${function(){ if (document.activeElement !== ref.current) setHv(null); }} />
    </svg>
    ${cur ? html`<div class="cht" style=${{top:(T + 4) + "px", left:left ? (X(hv) - 14) + "px" : (X(hv) + 14) + "px", transform:left ? "translateX(-100%)" : "none"}}>
      <span class="d">${W.fmtDate(cur.at)}${cur.i === 0 ? " · so far today" : ""}</span>
      <span class="r"><i class="lk" style=${{"--c":"var(--ser-1)"}}></i><b>${cur.sent}</b><span>emails sent</span></span>
      <span class="r"><i class="lk" style=${{"--c":"var(--ser-2)"}}></i><b>${cur.replies}</b><span>replies</span></span>
      <span class="r m"><i class="lk" style=${{"--c":"transparent"}}></i><b>${cur.sent ? pct1(100 * cur.replies / cur.sent) : "–"}</b><span>reply rate</span></span>
    </div>` : null}
  </div>`;
}

function Columns(p){
  var m = useWidth(), ref = m[0], w = Math.max(m[1] || 560, 280);
  var hs = useState(null), hv = hs[0], setHv = hs[1];
  var items = p.items, n = items.length, edge = !!p.edge;
  var L = 44, R = 12, T = 24, PH = p.h || 170, AX = p.axis || 34, H = T + PH + AX;
  var band = (w - L - R) / n, bw = Math.min(24, Math.max(6, band * .62));
  var sc = niceScale(Math.max.apply(null, items.map(function(x){ return x.v; })), p.target || 4, p.int);
  function Y(v){ return T + PH - v / sc.max * PH; }
  var thin = band < 36 ? 2 : 1, it = hv == null ? null : items[hv];
  var cx = hv == null ? 0 : L + band * (hv + .5), left = hv != null && hv >= n / 2;
  function key(e, i){ if (e.key === "Enter" || e.key === " "){ if (items[i].onPick){ e.preventDefault(); items[i].onPick(); } } }
  return html`<div class="ix" ref=${ref}>
    <svg class="chart" width=${w} height=${H} viewBox=${"0 0 " + w + " " + H} role="group" aria-label=${p.aria}>
      ${sc.ticks.map(function(t){ return html`<g key=${t}><line class="gridl" x1=${L} x2=${w - R} y1=${Y(t)} y2=${Y(t)} /><text x=${L - 8} y=${Y(t)} dy="0.35em" textAnchor="end">${p.yfmt ? p.yfmt(t) : nf(t)}</text></g>`; })}
      <line class="axis" x1=${L} x2=${w - R} y1=${T + PH} y2=${T + PH} />
      ${items.map(function(x, i){
        var y = Y(x.v), bh = T + PH - y, bx = L + band * i + (band - bw) / 2, base = x.op || 1;
        return html`<g key=${x.k}>
          ${bh > 0 ? html`<path d=${colPath(bx, y, bw, bh, 4)} fill="var(--ser-1)" opacity=${hv == null || hv === i ? base : base * .55} />` : null}
          <text class="val" x=${bx + bw / 2} y=${y - 7} textAnchor="middle">${p.vfmt ? p.vfmt(x.v) : nf(x.v)}</text>
        </g>`; })}
      ${edge ? items.map(function(x, i){ return i % thin ? null : html`<text key=${"e" + i} x=${L + band * i} y=${T + PH + 17} textAnchor="middle">${x.edge}</text>`; })
        : items.map(function(x, i){ return html`<g key=${"c" + i}><text x=${L + band * (i + .5)} y=${T + PH + 17} textAnchor="middle">${x.label}</text>${x.label2 ? html`<text x=${L + band * (i + .5)} y=${T + PH + 31} textAnchor="middle">${x.label2}</text>` : null}</g>`; })}
      ${p.marker ? html`<g><polygon points=${(L + band * p.marker.pos - 5) + "," + (T + PH + 10) + " " + (L + band * p.marker.pos + 5) + "," + (T + PH + 10) + " " + (L + band * p.marker.pos) + "," + (T + PH + 2)} fill="var(--ink-2)" /><text class="cap" x=${L + band * p.marker.pos} y=${T + PH + 34} textAnchor="middle">${p.marker.label}</text></g>` : null}
      ${items.map(function(x, i){ return html`<rect key=${"h" + i} class="hit" x=${L + band * i} y=${T - 20} width=${band} height=${PH + 20 + AX} tabIndex="0" role=${x.onPick ? "button" : "img"} aria-label=${x.aria} style=${{cursor:x.onPick ? "pointer" : "default"}}
        onPointerEnter=${function(){ setHv(i); }} onPointerMove=${function(){ if (hv !== i) setHv(i); }} onPointerLeave=${function(){ setHv(null); }} onFocus=${function(){ setHv(i); }} onBlur=${function(){ setHv(null); }}
        onClick=${x.onPick || null} onKeyDown=${function(e){ key(e, i); }} />`; })}
    </svg>
    ${it ? html`<div class="cht" style=${{top:(T + 2) + "px", left:left ? (cx - bw / 2 - 12) + "px" : (cx + bw / 2 + 12) + "px", transform:left ? "translateX(-100%)" : "none"}}>
      <span class="d">${it.tip[0]}</span>
      ${it.tip.slice(1).map(function(r, j){ return html`<span key=${j} class=${W.cx("r", j > 0 ? "m" : null)}><b>${r[0]}</b><span>${r[1]}</span></span>`; })}
    </div>` : null}
  </div>`;
}

function Funnel(p){
  var top = p.steps[0].n || 1;
  return html`<div class="fn" role="list">${p.steps.map(function(s, i){
    var conv = i ? (p.steps[i - 1].n ? Math.round(100 * s.n / p.steps[i - 1].n) : 0) : null;
    var tip = i ? s.n + " of " + p.steps[i - 1].n + " " + p.steps[i - 1].low + " channels " + (s.low === "with a deal" ? "have a deal" : "were " + s.low) : s.n + " channels found so far";
    var inner = html`<${W.Fragment}><span class="ell">${s.label}</span><span class="tr"><i style=${{width:Math.max(s.n ? 1 : 0, 100 * s.n / top) + "%"}}></i></span><span class="fv"><b>${s.n}</b><span class="muted">${conv == null ? "start" : conv + "%"}</span></span></${W.Fragment}>`;
    return s.stages ? html`<button key=${s.k} type="button" class="fn-row" role="listitem" data-tip=${tip + ". Click to open them in the Gallery."} onClick=${function(){ openGallery({stages:s.stages}); }}>${inner}</button>`
      : html`<div key=${s.k} class="fn-row" role="listitem" data-tip=${tip}>${inner}</div>`; })}</div>`;
}

function funnelSteps(){
  var d = D(), cs = d.creators, idx = W.STAGE_INDEX;
  function from(k){ return Object.keys(idx).filter(function(s){ return idx[s] >= k && s !== "rejected" && s !== "never" && s !== "audience"; }); }
  function count(stages){ return cs.filter(function(c){ return stages.indexOf(c.stage) >= 0; }).length; }
  var withDeal = {}; d.deals.forEach(function(x){ withDeal[x.creator] = true; });
  return [
    {k:"found", label:"Found", low:"found", n:cs.length, stages:[]},
    {k:"short", label:"Shortlisted", low:"shortlisted", n:count(from(1)), stages:from(1)},
    {k:"email", label:"Emailed", low:"emailed", n:count(from(3)), stages:from(3)},
    {k:"reply", label:"Replied", low:"replied", n:count(from(4)), stages:from(4)},
    {k:"sign", label:"Signed", low:"signed", n:count(["signed"]), stages:["signed"]},
    {k:"deal", label:"Got a deal", low:"with a deal", n:Object.keys(withDeal).length, stages:null}
  ];
}

/* System 16: Input-Driven Reverse Funnel Planner (FND-DLV-21) & 50-Send Batch Ghosting Diagnostics (FND-DLV-22) */
function ReverseFunnelPlanner(){
  var d = D(), ft = d.funnelTarget || {monthlyRevenueGoal:20000, avgDealSize:3200, agencyMarginPct:38};
  var revGoal = ft.monthlyRevenueGoal || 20000, avgDeal = ft.avgDealSize || 3200, marginPct = ft.agencyMarginPct || 38;
  var grossBookingsNeeded = Math.ceil(revGoal / (marginPct / 100));
  var dealsNeeded = Math.max(1, Math.ceil(grossBookingsNeeded / avgDeal));
  var brandPitchesNeeded = dealsNeeded * 12; /* ~8.3% pitch-to-close */
  var signedCreatorsNeeded = Math.max(3, Math.ceil(dealsNeeded * 1.4));
  var creatorRepliesNeeded = signedCreatorsNeeded * 3;
  var creatorEmailsNeeded = creatorRepliesNeeded * 16; /* ~6.25% reply rate */
  var rawChannelsNeeded = Math.ceil(creatorEmailsNeeded * 2.5);
  var dailySendsNeeded = Math.ceil((creatorEmailsNeeded + brandPitchesNeeded) / 22);
  var liveCap = W.sum(d.mail.filter(function(m){ return !m.paused && m.status !== "error"; }), function(m){ return m.cap; });

  return html`<div class="card" data-why="reverse-funnel">
    <div class="card-h">
      <div class="grow col t2"><h3>Input-Driven Reverse Funnel Planner (FND-DLV-21)</h3><span class="small muted">Enter your monthly net agency revenue target; the planner backwards-calculates exact daily input volume required.</span></div>
      <${Tag} tone=${liveCap >= dailySendsNeeded ? "good" : "warn"} icon="gauge">${liveCap} daily mailbox capacity vs ${dailySendsNeeded} needed/day</${Tag}>
    </div>
    <div class="grid3">
      <${W.Field} label="Monthly Net Agency Profit Goal ($)">
        <input class="inp num" value=${revGoal} onInput=${function(e){ W.A.updateFunnelTarget({monthlyRevenueGoal:+e.target.value.replace(/\D/g, "") || 5000}); }} aria-label="Monthly Net Agency Profit Goal" />
      </${W.Field}>
      <${W.Field} label="Average Brand Deal Price ($)">
        <input class="inp num" value=${avgDeal} onInput=${function(e){ W.A.updateFunnelTarget({avgDealSize:+e.target.value.replace(/\D/g, "") || 1000}); }} aria-label="Average Brand Deal Price" />
      </${W.Field}>
      <${W.Field} label="Target Agency Margin (%)">
        <input class="inp num" value=${marginPct} onInput=${function(e){ W.A.updateFunnelTarget({agencyMarginPct:W.clamp(+e.target.value.replace(/\D/g, "") || 25, 10, 80)}); }} aria-label="Target Agency Margin" />
      </${W.Field}>
    </div>
    <div class="tiles">
      <div class="tile"><span class="tl">Gross Bookings</span><b>${W.money(grossBookingsNeeded)}</b><span class="ts">to net ${W.money(revGoal)} at ${marginPct}%</span></div>
      <div class="tile"><span class="tl">Closed Deals / mo</span><b>${dealsNeeded}</b><span class="ts">at ${W.money(avgDeal)} avg deal</span></div>
      <div class="tile"><span class="tl">Brand Pitches / mo</span><b>${brandPitchesNeeded}</b><span class="ts">4-touch sequences (HC-24)</span></div>
      <div class="tile"><span class="tl">Creator Emails / mo</span><b>${creatorEmailsNeeded}</b><span class="ts">to sign ${signedCreatorsNeeded} creators</span></div>
      <div class="tile"><span class="tl">Raw Channels / mo</span><b>${rawChannelsNeeded}</b><span class="ts">to vet & shortlist</span></div>
      <div class="tile"><span class="tl">Daily Sends Needed</span><b>${dailySendsNeeded}/day</b><span class="ts">across 22 workdays</span></div>
    </div>
  </div>`;
}

function BatchDiagnosticsCard(){
  var batches = D().batchDiagnostics || [];
  if (!batches.length) return null;
  return html`<div class="card" data-why="batch-diagnostics">
    <div class="card-h">
      <div class="grow col t2"><h3>50-Send Batch Ghosting Diagnostics (FND-DLV-22 & BRD-FU-12)</h3><span class="small muted">Diagnose outreach performance in 50-email cohorts so deliverability, subject-line, and hook issues are isolated immediately.</span></div>
    </div>
    <div class="tw"><table class="tbl">
      <thead><tr><th>Batch Cohort</th><th class="n">Sent</th><th class="n">Open %</th><th class="n">Reply %</th><th class="n">Signed</th><th>Status</th><th>Playbook Diagnosis (FND-DLV-22 / BRD-FU-12)</th></tr></thead>
      <tbody>${batches.map(function(b){
        var crit = b.status !== "healthy" || b.replyRate < 4;
        return html`<tr key=${b.id}>
          <td><b>${b.batch || b.label}</b></td>
          <td class="n">${b.sent}</td>
          <td class="n">${b.openRate}%</td>
          <td class="n"><b>${b.replyRate}%</b></td>
          <td class="n">${b.signed != null ? b.signed : 0}</td>
          <td><${Tag} tone=${b.status === "healthy" ? "good" : "warn"}>${b.status || "review"}</${Tag}></td>
          <td><span class=${W.cx("small", crit ? "b" : "ink2")}>${b.diagnosis || b.fix}</span></td>
        </tr>`;
      })}</tbody>
    </table></div>
  </div>`;
}

function Insights(){
  var st = W.useApp(), d = st.data;
  var S = ns("insights", INS_DEF), period = S.period, money = W.canSeeMoney();
  if (!d.hist.months.length) return html`<div class="page"><${W.PageHead} title="Insights" sub="How outreach is doing, where channels drop out, and what the channels you found look like." />
    <div class="card"><${W.Empty} icon="chart" title="Insights fill in after your first week of sending" action=${html`<${W.Btn} size="sm" icon="scan" onClick=${function(){ W.go("find", "search"); }}>Open the search</${W.Btn}>`}>Reply rates, the funnel and revenue need a few days of emails behind them.</${W.Empty}></div></div>`;

  var cur = series(period, 0), prev = series(period, period);
  var sent = W.sum(cur, function(r){ return r.sent; }), replies = W.sum(cur, function(r){ return r.replies; });
  var pSent = W.sum(prev, function(r){ return r.sent; }), pReplies = W.sum(prev, function(r){ return r.replies; });
  var rate = sent ? 100 * replies / sent : 0, pRate = pSent ? 100 * pReplies / pSent : 0, dRate = rate - pRate;
  var months = d.hist.months, thisM = months[months.length - 1], lastM = months[months.length - 2];
  var win = months.slice(-(period === 7 ? 1 : period === 30 ? 2 : 3));
  var winSent = W.sum(win, function(x){ return x.sent; }), winSigned = W.sum(win, function(x){ return x.signed; });
  var per1k = winSent ? 1000 * winSigned / winSent : 0;
  var paid = d.deals, rev = W.sum(paid, function(x){ return x.price; }), cost = W.sum(paid, function(x){ return x.payout; });
  var margin = rev ? 100 * (rev - cost) / rev : 0;
  var floor = d.rules.marginFloor;
  var dayOfMonth = new Date(W.NOW).getDate(), daysInMonth = new Date(new Date(W.NOW).getFullYear(), new Date(W.NOW).getMonth() + 1, 0).getDate();
  var winLabel = win.length === 1 ? win[0].m : win[0].m + " to " + win[win.length - 1].m;

  var steps = funnelSteps(), worst = null;
  steps.forEach(function(s, i){ if (!i || !steps[i - 1].n) return; var loss = 1 - s.n / steps[i - 1].n; if (!worst || loss > worst.loss) worst = {loss:loss, a:steps[i - 1], b:s}; });

  var r3 = d.runs.filter(function(r){ return r.id === "r3"; })[0];
  var kws = r3 ? r3.kws.filter(function(k){ return k.st === "done"; }).map(function(k){ return {q:k.q, found:k.found, kept:k.kept, rate:k.found ? 100 * k.kept / k.found : 0}; }) : [];
  var queued = r3 ? r3.kws.filter(function(k){ return k.st !== "done"; }).length : 0;
  var sorted = kws.slice().sort(function(a, b){ var x = S.kwSort === "kw" ? a.q.toLowerCase() : a[S.kwSort], y = S.kwSort === "kw" ? b.q.toLowerCase() : b[S.kwSort]; return (x < y ? -1 : x > y ? 1 : 0) * S.kwDir || (a.q < b.q ? -1 : 1); });
  var kFound = W.sum(kws, function(k){ return k.found; }), kKept = W.sum(kws, function(k){ return k.kept; });
  var bestK = kws.slice().sort(W.by(function(k){ return k.rate; }, -1))[0], worstK = kws.slice().sort(W.by(function(k){ return k.rate; }, 1))[0];
  function tier(r){ return r >= 30 ? "Strong" : r >= 20 ? "Fair" : "Weak"; }
  function sortBy(k){ setNs("insights", INS_DEF, function(c){ return c.kwSort === k ? {kwDir:-c.kwDir} : {kwSort:k, kwDir:k === "kw" ? 1 : -1}; }); }
  function th(k, label, n){ var on = S.kwSort === k; return html`<th class=${n ? "n" : null} aria-sort=${on ? (S.kwDir > 0 ? "ascending" : "descending") : "none"}><button type="button" class="thb" onClick=${function(){ sortBy(k); }}>${label}${on ? html`<${Icon} n=${S.kwDir > 0 ? "chevU" : "chevD"} s=${12} />` : null}</button></th>`; }

  var revItems = months.map(function(x, i){
    var lastOne = i === months.length - 1;
    return {k:x.m, label:x.m, label2:lastOne ? "so far" : "", v:x.revenue, op:lastOne ? .6 : 1,
      tip:[x.m + (lastOne ? " (" + dayOfMonth + " of " + daysInMonth + " days)" : ""), [W.money(x.revenue), "revenue"], [nf(x.sent), "emails sent"], [String(x.replies), "replies"], [String(x.signed), "creators signed"]],
      aria:x.m + ": " + W.money(x.revenue) + " revenue" + (lastOne ? ", month still running" : "")};
  });

  var cs = d.creators, total = cs.length, minM = d.rules.minMedian;
  var BIN = 10000, NB = 10, bins = [];
  for (var b = 0; b < NB; b++) bins.push({lo:b * BIN, hi:b === NB - 1 ? null : (b + 1) * BIN, n:0});
  cs.forEach(function(c){ var k = Math.min(NB - 1, Math.floor(c.median / BIN)); bins[k].n++; });
  function binName(x){ return x.hi == null ? W.fmtK(x.lo) + "+" : (x.lo ? W.fmtK(x.lo) : "0") + "–" + W.fmtK(x.hi); }
  var histItems = bins.map(function(x, i){
    return {k:"b" + i, edge:x.lo ? W.fmtK(x.lo) : "0", v:x.n,
      tip:[binName(x) + " median views", [String(x.n), "channels"], [pct1(100 * x.n / total), "of all " + total]],
      aria:binName(x) + " median views: " + x.n + " channels. Open them in the Gallery.",
      onPick:x.n ? function(){ openGallery({minMedian:x.lo, maxMedian:x.hi == null ? null : x.hi - 1}); } : null};
  });
  var under = cs.filter(function(c){ return c.median < minM; }).length, peak = bins.slice().sort(W.by(function(x){ return x.n; }, -1))[0];
  var cnt = {};
  cs.forEach(function(c){ (c.countries || []).slice(0, 3).forEach(function(k){ cnt[k[0]] = (cnt[k[0]] || 0) + 1; }); });
  var countryRows = Object.keys(cnt).map(function(k){ return {k:k, n:cnt[k], target:TARGET.indexOf(k) >= 0, gal:true}; }).sort(W.by(function(r){ return r.n; }, -1)).slice(0, 9);
  var passing = cs.filter(function(c){ return W.topOk(c.countries); }).length;

  var lineTable = {cols:[{h:"Date"},{h:"Emails sent", n:1},{h:"Replies", n:1},{h:"Reply rate", n:1}], scroll:true,
    rows:cur.slice().reverse().map(function(r){ return [W.fmtDate(r.at) + (r.i === 0 ? " (so far)" : ""), r.sent, r.replies, r.sent ? pct1(100 * r.replies / r.sent) : "–"]; })};

  return html`<div class="page">
    <${W.PageHead} title="Insights" sub="Reverse Funnel Planner, 50-Send Batch Ghosting Diagnostics, outreach velocity, and channel analytics."
      right=${html`<${W.Seg} label="Period" cur=${period} onPick=${function(v){ setNs("insights", INS_DEF, {period:v}); }} opts=${[[7, "7 days"],[30, "30 days"],[90, "90 days"]]} />`} />

    <div class="tiles" data-why="insights">
      <div class="tile"><span class="tl">Emails sent, last ${period} days</span><b>${nf(sent)}</b><span class="ts">${(sent / period).toFixed(1)} a day · ${cur[cur.length - 1].sent} so far today</span></div>
      <div class="tile"><span class="tl">Reply rate</span><b>${pct1(rate)}</b><span class="ts" style=${{color:dRate >= 0 ? "var(--good)" : "var(--warn)"}}><${Icon} n="trend" style=${dRate >= 0 ? null : {transform:"scaleY(-1)"}} />${Math.abs(dRate) < .05 ? "Same as" : (dRate > 0 ? "Up " : "Down ") + Math.abs(dRate).toFixed(1) + " points on"} the ${period} days before</span></div>
      <div class="tile"><span class="tl">Signed per 1,000 emails</span><b>${per1k.toFixed(1)}</b>
        <div class="bench" role="img" aria-label=${"Signed per 1,000 emails: " + per1k.toFixed(1) + " against a course benchmark of about 5"}><i style=${{width:W.clamp(per1k * 10, 0, 100) + "%"}}></i><u style=${{left:"50%"}}></u></div>
        <span class="ts">${per1k >= 4.5 ? "Near" : "Below"} the course benchmark of about 5</span><span class="ts muted">${winSigned} signed from ${nf(winSent)} emails, ${winLabel}</span></div>
      ${money ? html`<div class="tile"><span class="tl">Revenue this month</span><b>${W.money(thisM.revenue)}</b><span class="ts">${dayOfMonth} of ${daysInMonth} days in · ${lastM.m} ended at ${W.money(lastM.revenue)}</span></div>` : null}
      ${money ? html`<div class="tile"><span class="tl">Average margin</span><b>${pct1(margin)}</b><span class="ts">${W.money(rev - cost)} on ${W.money(rev)}, all ${d.deals.length} deals</span><span class="ts muted">Your floor is ${floor}%</span></div>` : null}
    </div>

    ${money ? html`<${ReverseFunnelPlanner} />` : null}
    <${BatchDiagnosticsCard} />

    <${ChartCard} id="line" title="Emails sent and replies per day" sub=${"Last " + period + " days. Each line has its own scale, so the small reply numbers stay readable."} table=${lineTable}
      legend=${html`<div class="legend"><span style=${{"--hue":"var(--ser-1)"}}><i class="lk"></i>Emails sent per day</span><span style=${{"--hue":"var(--ser-2)"}}><i class="lk"></i>Replies per day</span><span><i class="wkx"></i>Weekends</span></div>`}
      take=${"Replies were " + pct1(rate) + " of the " + nf(sent) + " emails sent. Weekends are quiet on purpose; the hollow dot is today so far."}>
      <${LineChart} days=${cur} />
    </${ChartCard}>

    <div class="grid2" style=${{alignItems:"stretch"}}>
      <${ChartCard} id="funnel" title="Where channels drop out" sub="All channels found so far. Percentages are the share that made it from the step above." table=${{cols:[{h:"Step"},{h:"Channels", n:1},{h:"From the step above", n:1}], rows:steps.map(function(s, i){ return [s.label, s.n, i ? Math.round(100 * s.n / (steps[i - 1].n || 1)) + "%" : "start"]; })}}
        take=${worst ? "The biggest drop is between " + worst.a.low + " and " + worst.b.low + ": " + (worst.a.n - worst.b.n) + " of " + worst.a.n + " did not move on. Click a bar to see those channels." : null}>
        <${Funnel} steps=${steps} />
      </${ChartCard}>
      ${money ? html`<${ChartCard} id="rev" title="Revenue by month" sub="What brands paid the agency, last 6 months. October is still running, so its bar is paler." table=${{cols:[{h:"Month"},{h:"Revenue", n:1},{h:"Emails sent", n:1},{h:"Replies", n:1},{h:"Signed", n:1}], rows:months.map(function(x){ return [x.m, W.money(x.revenue), nf(x.sent), x.replies, x.signed]; })}}
        take=${"Revenue grew from " + W.money(months[0].revenue) + " in " + months[0].m + " to " + W.money(lastM.revenue) + " in " + lastM.m + ". " + thisM.m + " is at " + W.money(thisM.revenue) + " after " + dayOfMonth + " days."}>
        <${Columns} items=${revItems} yfmt=${kusd} vfmt=${kusd} target=${4} axis=${42} aria="Revenue by month, May to October" />
      </${ChartCard}>` : null}
    </div>

    <div class="card">
      <div class="card-h" style=${{alignItems:"flex-start"}}><div class="grow col t2"><h3>Keyword yield, today's search</h3><span class="small muted">Run r3 · started ${r3 ? W.fmtTime(r3.at) : ""} · ${kws.length} of ${kws.length + queued} keywords done${r3 && r3.status === "paused" ? ", paused" : ""}. Kept rate is channels kept by your rules out of channels found.</span></div>
        <${Btn} size="sm" kind="ghost" icon="scan" onClick=${function(){ W.go("find", "search"); }}>Open the search</${Btn}></div>
      <div class="tw"><table class="tbl kwt"><thead><tr>${th("kw", "Keyword")}${th("found", "Found", true)}${th("kept", "Kept", true)}${th("rate", "Kept rate")}<th>Tier</th></tr></thead>
        <tbody>${sorted.map(function(k){ var t = tier(k.rate); return html`<tr key=${k.q}><td>${k.q}</td><td class="n">${k.found}</td><td class="n">${k.kept}</td>
          <td><span class="row" style=${{gap:"10px"}}><${W.Meter} v=${k.rate} max=${100} w=${110} label=${"Kept rate " + Math.round(k.rate) + "%"} /><span class="num small">${Math.round(k.rate)}%</span></span></td>
          <td>${t === "Strong" ? html`<${Tag} tone="good" icon="check">Strong</${Tag}>` : t === "Weak" ? html`<${Tag} tone="warn" icon="alert">Weak</${Tag}>` : html`<${Tag}>Fair</${Tag}>`}</td></tr>`; })}
          <tr class="sum"><td>Run so far</td><td class="n">${kFound}</td><td class="n">${kKept}</td><td><span class="num">${kFound ? Math.round(100 * kKept / kFound) : 0}%</span></td><td></td></tr></tbody></table></div>
      ${bestK ? html`<p class="cap-line">Best: "${bestK.q}" kept ${bestK.kept} of ${bestK.found} (${Math.round(bestK.rate)}%). Weakest: "${worstK.q}" kept ${worstK.kept} of ${worstK.found} (${Math.round(worstK.rate)}%). Strong is 30% or more, weak is under 20%. ${queued} more keywords are queued.</p>` : null}
    </div>

    <${W.Section} title="The channels you found" count=${total}>
      <p class="cap-line" style=${{marginTop:"-4px"}}>Click a bar to open those channels in Find, Gallery.</p>
      <div class="grid2" style=${{alignItems:"stretch"}}>
        <${ChartCard} id="hist" title="Median views per channel" sub="How many channels sit at each level of typical views per video" table=${{cols:[{h:"Median views"},{h:"Channels", n:1},{h:"Share", n:1}], rows:bins.map(function(x){ return [binName(x), x.n, pct1(100 * x.n / total)]; })}}
          take=${under + " of " + total + " channels are under your " + W.fmtK(minM) + " minimum. The busiest band is " + binName(peak) + " with " + peak.n + "."}>
          <${Columns} items=${histItems} edge=${true} int=${true} target=${3} h=${196} axis=${46} marker=${{pos:minM / BIN, label:W.fmtK(minM) + " · your minimum"}} aria=${"Histogram of median views for " + total + " channels"} />
        </${ChartCard}>
        <${ChartCard} id="countries" title="Audience countries" sub="Channels with this country in their top 3 audience countries" table=${{cols:[{h:"Country"},{h:"Channels", n:1},{h:"Share of all", n:1}], rows:countryRows.map(function(r){ return [W.COUNTRY[r.k] || r.k, r.n, pct1(100 * r.n / total)]; })}}
          legend=${html`<div class="legend"><span style=${{"--hue":"var(--ser-1)"}}><i class="sw"></i>Markets you sell to: US, UK, CA, AU</span><span style=${{"--hue":"var(--faint)"}}><i class="sw"></i>Other</span></div>`}
          take=${passing + " of " + total + " channels have a target market leading their audience. " + (total - passing) + " do not, or have no audience data yet."}>
          <div class="hbars cbars">${countryRows.map(function(r){
            var cls = W.cx("hbar", r.target ? null : "o"), name = W.COUNTRY[r.k] || r.k, tip = name + ": " + r.n + " of " + total + " channels (" + pct1(100 * r.n / total) + ")";
            var inner = html`<${W.Fragment}><span class="ell">${name}</span><span class="tr"><i style=${{width:(100 * r.n / total) + "%"}}></i></span><span class="v">${r.n}</span></${W.Fragment}>`;
            return r.gal ? html`<button key=${r.k} type="button" class=${cls} data-tip=${tip + ". Click to open them in the Gallery."} onClick=${function(){ openGallery({countries:[r.k]}); }}>${inner}</button>`
              : html`<div key=${r.k} class=${cls} data-tip=${tip}>${inner}</div>`; })}</div>
        </${ChartCard}>
      </div>
    </${W.Section}>
  </div>`;
}
W.screens.insights = Insights;

/* ======================================================================= TOOLBOX */
var TB_DEF = {tool:"price", calc:{}, logWho:"all", logAll:false, rulesQ:"", checked:null};
var TOOLS = [
  {k:"price", g:"Tools", name:"Price & Package Calculator", icon:"dollar", desc:"Views, CPM, format & 3-Option Packages (HC-26)", long:"Turn a channel's median views, deliverable format, whitelisting, and relationship model into a brand quote, creator payout, and 3-Option Package Menu (Starter / Growth / Dominate)."},
  {k:"archive", g:"Tools", name:"Archive", icon:"trash", desc:"Rejected channels you can still bring back", long:"Rejected channels wait here before they are archived for good. Bring one back and it returns to New finds."},
  {k:"never", g:"Tools", name:"Never contact", icon:"ban", desc:"Channels that must not be emailed again", long:"Searches skip these channels and any draft to them is deleted. Add one here or from any draft."},
  {k:"scheduled", g:"Tools", name:"Scheduled emails", icon:"clock", desc:"Emails waiting for their send time", long:"Emails you approved with Send later. Cancel one and it comes back as a draft."},
  {k:"log", g:"History", name:"Activity log", icon:"list", desc:"Who did what, newest first", long:"Every change anyone made, so a surprise on a record can be traced."},
  {k:"notifs", g:"History", name:"Notifications", icon:"bell", desc:"Alerts from searches, replies and money", long:"The same alerts as the bell in the top bar, with room to read them."},
  {k:"rules", g:"Moved", name:"Writing rules", icon:"pen", desc:"The house rules every Gemini draft follows", long:"Every draft says which of these rules it followed. They are read-only here."},
  {k:"facts", g:"Moved", name:"Agency facts", icon:"sliders", desc:"Audience rules, margin floor, send window", long:"The numbers the audience check, pricing and sending read. Change one and every check uses it at once."},
  {k:"health", g:"Moved", name:"Setup health", icon:"gauge", desc:"Gemini bridge, pipeline, Gmail, sync, updates", long:"Whether the pieces behind the app are connected and working."}
];

W.A.allowAgain = function(id){
  var c = W.creator(id);
  W.act("Allowed emailing " + c.name + " again", function(d){ var x = d.creators.filter(function(z){ return z.id === id; })[0]; x.stage = "new"; x.reject = null; },
    {ref:{t:"creator", id:id}, toast:{msg:c.name + " can be emailed again", sub:"They are back in New finds and searches no longer skip them.", icon:"undo", tone:"info"}});
};
W.A.cancelScheduled = function(ref, at){
  var o = W.rec(ref), name = o ? o.name : "them";
  W.act("Cancelled the scheduled email to " + name, function(d){
    var th = d.threads[ref.id] || [], k = -1;
    th.forEach(function(m, j){ if (m.dir === "out" && m.scheduled && m.at === at) k = j; });
    if (k < 0) return false;
    var m = th.splice(k, 1)[0], mb = d.mail.filter(function(x){ return x.addr === m.mailbox; })[0], x = (ref.t === "creator" ? d.creators : d.brands).filter(function(z){ return z.id === ref.id; })[0];
    var first = ref.t === "creator" && x && x.stage === "emailed" && !th.some(function(z){ return z.dir === "out"; });
    if (first){ x.stage = "contact"; x.seq = null; }
    d.drafts.push({id:W.uid("q"), kind:first ? "first" : "reply", to:ref, mailbox:mb ? mb.id : "m1", created:W.now(), subject:first ? ((x.videos && x.videos[0] ? x.videos[0].t : "Hello") + "").toLowerCase().slice(0, 52) : "Re: our last email", body:m.text, why:"You cancelled the scheduled send. Edit it or send it again.", rules:[], gates:[]});
  }, {ref:ref, toast:{msg:"Scheduled email cancelled", sub:"It is back in Approve emails as a draft.", icon:"undo", tone:"info"}});
};

function ListEmpty(p){ return html`<${W.Empty} icon=${p.icon || "checkc"} title=${p.title}>${p.children}</${W.Empty}>`; }

/* ---- System 10: Multi-Format Pricing & 3-Option Package Calculator (HC-26) ---- */
var NICHE = {lo:30, hi:55};
function PriceTool(){
  var d = D(), r = d.rules, tb = ns("toolbox", TB_DEF), c = tb.calc || {};
  var defCpm = r.cpm || 40, defMk = r.markup || 60;
  var vwV = c.views == null ? "60000" : c.views, cpmV = c.cpm == null ? String(defCpm) : c.cpm, mkV = c.markup == null ? String(defMk) : c.markup;
  var deliv = c.deliv || "integration_60s", model = c.model || "brokered", wl = !!c.wl, bundle = c.bundle || 1;
  function set(patch){ setNs("toolbox", TB_DEF, function(cur){ return {calc:Object.assign({}, cur.calc, patch)}; }); }
  var views = num(vwV), cpm = num(cpmV), mk = num(mkV);
  var cr = c.cid ? W.creator(c.cid) : null;
  var fakeCreator = cr || {median:views, trimmedAvgViews:views, rate:Math.round((views / 1000 * cpm) / (1 + mk / 100) / 50) * 50, relationshipModel:model};
  var price = W.priceFor(fakeCreator, {deliverable:deliv, whitelisting30d:wl, bundleCount:bundle, model:model});
  var payout = model === "exclusive_25" ? Math.round(price * 0.75 / 50) * 50 : Math.round(price / (1 + mk / 100) / 50) * 50;
  var margin = price - payout, mpct = price ? 100 * margin / price : 0;
  var pkgs = W.buildPackagesFor(fakeCreator);
  var signed = d.creators.filter(function(x){ return x.stage === "signed"; });
  var below = cpm < NICHE.lo, above = cpm > NICHE.hi, floorOk = mpct >= r.marginFloor;
  var quote = "Brand price " + W.money(price) + " (" + deliv + (wl ? " + 30d whitelisting" : "") + (bundle > 1 ? ", " + bundle + "-video bundle" : "") + ") for " + W.fmtK(views) + " views. Creator payout " + W.money(payout) + ", agency margin " + W.money(margin) + " (" + Math.round(mpct) + "%).";
  var same = cpm === defCpm && mk === defMk;
  function saveDefaults(){
    W.act("Saved the pricing defaults: CPM $" + cpm + ", markup " + mk + "%", function(dd){ dd.rules.cpm = cpm; dd.rules.markup = mk; },
      {toast:{msg:"Pricing defaults saved", sub:"CPM $" + cpm + " and a " + mk + "% markup are now where the calculator starts.", icon:"check"}});
    set({cpm:null, markup:null});
  }
  return html`<div class="col" style=${{gap:"18px"}}>
    <div class="tb-calc">
      <div class="col">
        <${W.Field} label="Use a signed creator">
          <select class="sel" value=${c.cid || ""} onChange=${function(e){ var x = W.creator(e.target.value); set({cid:e.target.value, views:x ? String(x.trimmedAvgViews || x.median) : vwV, model:x ? x.relationshipModel || "brokered" : model}); }}>
            <option value="">Type my own numbers</option>${signed.map(function(x){ return html`<option key=${x.id} value=${x.id}>${x.name} · ${W.fmtK(x.trimmedAvgViews || x.median)} trimmed avg (${x.relationshipModel === "exclusive_25" ? "Excl 25%" : "Brokered"})</option>`; })}
          </select>
        </${W.Field}>
        <div class="grid2">
          <${W.Field} label="Deliverable Format">
            <select class="sel" value=${deliv} onChange=${function(e){ set({deliv:e.target.value}); }}>
              <option value="integration_60s">60–90s Integration (1.0×)</option>
              <option value="shoutout_30s">30s Quick Shoutout (0.6×)</option>
              <option value="dedicated">Dedicated Full Video (2.2×)</option>
              <option value="short_reel">YouTube Short / Reel (0.4×)</option>
            </select>
          </${W.Field}>
          <${W.Field} label="Relationship Model">
            <select class="sel" value=${model} onChange=${function(e){ set({model:e.target.value}); }}>
              <option value="brokered">Brokered Markup (Price − Payout)</option>
              <option value="exclusive_25">Exclusive Roster (25% Commission)</option>
            </select>
          </${W.Field}>
        </div>
        <div class="row wrap" style=${{gap:"8px"}}>
          <button type="button" class="chip" aria-pressed=${String(wl)} onClick=${function(){ set({wl:!wl}); }}>+30-Day Paid Ads Whitelisting (+25%)</button>
          <${W.Seg} label="Bundle" cur=${bundle} onPick=${function(v){ set({bundle:v}); }} opts=${[[1,"1 Video"],[2,"2 Videos (-5%)"],[3,"3 Videos (-12%)"]]} />
        </div>
        <${W.Field} label="Trimmed average / median views per video">
          <div class="row"><input class="rng" type="range" min="5000" max="150000" step="1000" value=${W.clamp(views, 5000, 150000)} onInput=${function(e){ set({views:e.target.value, cid:""}); }} aria-label="Median views slider" />
            <input class="inp num" style=${{width:"104px"}} inputMode="numeric" value=${vwV} onInput=${function(e){ set({views:e.target.value, cid:""}); }} aria-label="Median views" /></div>
        </${W.Field}>
        <${W.Field} label="Your CPM, dollars per 1,000 views" hint=${"AI-tool brands in the examples pay about $" + NICHE.lo + " to $" + NICHE.hi + " for a sponsored segment."}>
          <div class="row"><input class="rng" type="range" min="10" max="90" step="1" value=${W.clamp(cpm, 10, 90)} onInput=${function(e){ set({cpm:e.target.value}); }} aria-label="CPM slider" />
            <input class="inp num" style=${{width:"104px"}} inputMode="decimal" value=${cpmV} onInput=${function(e){ set({cpm:e.target.value}); }} aria-label="CPM in dollars" /></div>
          <span class="row small" style=${{gap:"6px", color:below || above ? "var(--warn)" : "var(--good)"}}><${Icon} n=${below || above ? "alert" : "checkc"} s=${14} />${below ? "Below the niche range." : above ? "Above the niche range." : "Inside the niche range."}</span>
        </${W.Field}>
      </div>
      <div class="card flat" style=${{gap:"14px"}} aria-live="polite">
        <div class="col t2"><span class="small muted">Brand price (${model === "exclusive_25" ? "Exclusive 25% Commission" : "Brokered Markup"})</span><span class="big">${W.money(price)}</span><span class="small muted">${W.fmtK(views)} views × $${cpm} CPM · ${deliv}${wl ? " + 30d whitelisting" : ""}${bundle > 1 ? " · " + bundle + " videos" : ""}</span></div>
        <div class="cbar" role="img" aria-label=${"Creator gets " + W.money(payout) + ", agency keeps " + W.money(margin)}><i style=${{width:(price ? 100 * payout / price : 0) + "%", background:"var(--ser-1)"}}></i><i style=${{width:(price ? 100 * margin / price : 0) + "%", background:"var(--ser-2)"}}></i></div>
        <div class="legend"><span style=${{"--hue":"var(--ser-1)"}}><i class="sw"></i>Creator payout ${W.money(payout)}</span><span style=${{"--hue":"var(--ser-2)"}}><i class="sw"></i>Agency margin ${W.money(margin)}</span></div>
        <dl class="kv">
          <dt>Margin</dt><dd><b class="num">${Math.round(mpct)}%</b> of the price ${floorOk ? html`<${Tag} tone="good" icon="check">above your ${r.marginFloor}% floor</${Tag}>` : html`<${Tag} tone="crit" icon="alert">below your ${r.marginFloor}% floor</${Tag}>`}</dd>
          <dt>Per 1,000 views</dt><dd class="num">Brand pays $${cpm} · creator gets $${views ? (payout / views * 1000).toFixed(0) : 0}</dd>
        </dl>
        <div class="row wrap">
          <${Btn} icon="copy" onClick=${function(){ W.copy(quote, "the quote"); }}>Copy the quote</${Btn}>
          ${cr ? html`<${Btn} kind="pri" icon="pen" onClick=${function(){ W.go("close", "pitch", {pitchCreator:cr.id}); }}>Pitch ${cr.name}</${Btn}>` : null}
          <${Btn} icon="check" disabled=${same} onClick=${saveDefaults}>Save CPM as default</${Btn}>
        </div>
      </div>
    </div>
    <div class="card flat">
      <div class="card-h"><h4>3-Option Package Menu (HC-26: Never Send a Single Flat Rate)</h4><span class="small muted">Send all 3 tiers on every brand quote so the buyer compares packages rather than yes/no</span></div>
      <div class="grid3">
        ${pkgs.map(function(pk){ return html`<div key=${pk.k} class="card tight">
          <div class="row"><b class="grow">${pk.name}</b><b class="num" style=${{fontSize:"16px"}}>${W.money(pk.price)}</b></div>
          <span class="small ink2">${pk.desc}</span>
          <span class="tiny muted">${pk.save}</span>
        </div>`; })}
      </div>
    </div>
  </div>`;
}

function ArchiveTool(){
  var d = D(), days = d.rules.archiveDays;
  var list = d.creators.filter(function(c){ return c.stage === "rejected"; }).sort(W.by(function(c){ return c.reject.at; }, -1));
  var ids = list.map(function(c){ return c.id; });
  if (!list.length) return html`<${ListEmpty} icon="trash" title="Nothing in the archive">Rejected channels wait here for ${days} days before they are archived for good.</${ListEmpty}>`;
  return html`<div class="col tight">
    <p class="hint">Rejected channels are archived for good after ${days} days. Bring one back before then and it returns to New finds.</p>
    ${list.map(function(c){
      var left = Math.max(0, Math.ceil((c.reject.at + days * W.DAY - W.now()) / W.DAY));
      return html`<div key=${c.id} class="row wrap" style=${{gap:"6px"}}>
        <button type="button" class="li" style=${{flex:"1 1 280px"}} onClick=${function(){ W.peek("creator", c.id, ids); }}>
          <${W.CAv} c=${c} /><span class="lt"><b>${c.name}</b><small>${c.handle} · ${c.reject.reason} · by ${W.member(c.reject.by).name}, ${W.ago(c.reject.at)}</small></span>
          <span class="col t2" style=${{alignItems:"flex-end", flex:"none"}}><span class="small ink2 num">${left === 0 ? "archived today" : "archived for good in " + W.plural(left, "day")}</span><${W.Meter} v=${left} max=${days} w=${90} tone=${left <= 1 ? "warn" : null} label="Days left" /></span>
        </button>
        <${Btn} size="sm" icon="undo" onClick=${function(){ W.A.restore(c.id); }}>Bring back</${Btn}>
      </div>`; })}
  </div>`;
}

function NeverTool(){
  var d = D(), add = useState(""), custom = useState(""), why = useState(""), conf = useState(null);
  var list = d.creators.filter(function(c){ return c.stage === "never"; }).sort(W.by(function(c){ return c.reject ? c.reject.at : 0; }, -1));
  var ids = list.map(function(c){ return c.id; });
  var options = d.creators.filter(function(c){ return c.stage !== "never"; }).sort(W.by(function(c){ return c.name.toLowerCase(); }));
  function blockChannel(){
    var rsn = why[0].trim() || "Owner chose never contact";
    if (add[0]){ W.A.never(add[0], rsn); add[1](""); why[1](""); return; }
    var nm = custom[0].trim(); if (!nm) return;
    var cid = W.uid("c"), hdl = nm.charAt(0) === "@" ? nm : "@" + nm.toLowerCase().replace(/[^a-z0-9]/g, "");
    W.act("Added " + nm + " to Never contact", function(dd){ dd.creators.push({id:cid, name:nm.replace(/^@/, ""), handle:hdl, subs:0, median:0, up30:0, lastUp:0, videos:[], sponsors:[], email:null, emailSrc:null, emailConf:0, confirmed:false, contact:"", cands:[], countries:[], age:"", eng:0, stage:"never", owner:dd.me, rate:0, moment:"", run:null, found:W.now(), tags:[], notes:[], seq:null, kit:null, reject:{reason:rsn, at:W.now(), by:dd.me}, before:null, pay:null}); }, {toast:{msg:nm + " added to Never contact", sub:"Searches will skip this channel.", icon:"ban", tone:"info"}});
    custom[1](""); why[1]("");
  }
  return html`<div class="col">
    <div class="card flat tight">
      <h4>Add a channel</h4>
      <div class="row wrap">
        <select class="sel" style=${{flex:"1 1 180px", width:"auto"}} value=${add[0]} onChange=${function(e){ add[1](e.target.value); if (e.target.value) custom[1](""); }} aria-label="Channel to add">
          <option value="">Choose existing channel…</option>${options.map(function(c){ return html`<option key=${c.id} value=${c.id}>${c.name} · ${W.STAGE_LABEL[c.stage]}</option>`; })}
        </select>
        <input class="inp" style=${{flex:"1 1 170px", width:"auto"}} placeholder="Or type @handle / name" value=${custom[0]} onInput=${function(e){ custom[1](e.target.value); if (e.target.value) add[1](""); }} aria-label="New channel handle or name" />
        <input class="inp" style=${{flex:"2 1 200px", width:"auto"}} placeholder="Why (optional), for example: asked us to stop" value=${why[0]} onInput=${function(e){ why[1](e.target.value); }} aria-label="Reason" />
        <${Btn} icon="ban" disabled=${!add[0] && !custom[0].trim()} onClick=${blockChannel}>Never contact</${Btn}>
      </div>
    </div>
    ${list.length ? list.map(function(c){
      var asking = conf[0] === c.id;
      return html`<div key=${c.id} class="row wrap" style=${{gap:"6px"}}>
        <button type="button" class="li" style=${{flex:"1 1 280px"}} onClick=${function(){ W.peek("creator", c.id, ids); }}>
          <${W.CAv} c=${c} /><span class="lt"><b>${c.name}</b><small>${c.reject ? c.reject.reason + " · " + W.member(c.reject.by).name + ", " + W.ago(c.reject.at) : "No reason saved"}</small></span>
          <${Tag} tone="crit" icon="ban">Never</${Tag}>
        </button>
        ${asking ? html`<${Btn} size="sm" kind="pri" onClick=${function(){ conf[1](null); W.A.allowAgain(c.id); }}>Yes, allow emails</${Btn}><${Btn} size="sm" kind="ghost" onClick=${function(){ conf[1](null); }}>Keep blocked</${Btn}>`
          : html`<${Btn} size="sm" icon="undo" onClick=${function(){ conf[1](c.id); }}>Allow again</${Btn}>`}
      </div>`; })
      : html`<${ListEmpty} icon="ban" title="Nobody is blocked">Channels you mark as never contact show up here.</${ListEmpty}>`}
  </div>`;
}

function ScheduledTool(){
  var d = D(), out = [];
  Object.keys(d.threads).forEach(function(id){ d.threads[id].forEach(function(m){ if (m.dir === "out" && m.scheduled){ var ref = refOf(id); if (ref) out.push({ref:ref, m:m, o:W.rec(ref)}); } }); });
  out.sort(W.by(function(x){ return x.m.at; }));
  if (!out.length) return html`<${ListEmpty} icon="clock" title="Nothing is scheduled">Use the arrow beside Send on any draft to pick a later time. Scheduled emails wait here until they go out.</${ListEmpty}>`;
  return html`<div class="col tight">${out.map(function(x){
    var line = W.maskMoney((x.m.text || "").split("\n").filter(Boolean).slice(0, 2).join(" "));
    return html`<div key=${x.ref.id + x.m.at} class="row wrap" style=${{gap:"6px"}}>
      <button type="button" class="li" style=${{flex:"1 1 280px"}} onClick=${function(){ W.peek(x.ref.t, x.ref.id); }}>
        <${W.Av} name=${x.o.name} seed=${x.o.handle || x.o.name} tip=${false} /><span class="lt"><b>${x.o.name}</b><small>${line}</small></span>
        <span class="col t2" style=${{alignItems:"flex-end", flex:"none"}}><b class="small num" style=${{fontWeight:600}}>${W.fmtDay(x.m.at)} ${W.fmtTime(x.m.at)}</b><span class="tiny muted">from ${x.m.mailbox || "a mailbox"}</span></span>
      </button>
      <${Btn} size="sm" icon="x" onClick=${function(){ W.A.cancelScheduled(x.ref, x.m.at); }}>Cancel send</${Btn}>
    </div>`; })}</div>`;
}

function LogTool(){
  var d = D(), tb = ns("toolbox", TB_DEF), who = tb.logWho;
  var all = d.log.slice().sort(W.by(function(l){ return l.at; }, -1));
  var list = who === "all" ? all : all.filter(function(l){ return l.who === who; });
  var shown = tb.logAll ? list : list.slice(0, 30);
  var groups = [];
  shown.forEach(function(l){ var k = W.fmtDay(l.at), g = groups[groups.length - 1]; if (!g || g.k !== k){ g = {k:k, rows:[]}; groups.push(g); } g.rows.push(l); });
  return html`<div class="col">
    <div class="pillrow" role="group" aria-label="Filter by person">
      <button type="button" class="chip" aria-pressed=${String(who === "all")} onClick=${function(){ setNs("toolbox", TB_DEF, {logWho:"all"}); }}>Everyone <span class="c">${all.length}</span></button>
      ${d.team.map(function(m){ var c = all.filter(function(l){ return l.who === m.id; }).length; return html`<button key=${m.id} type="button" class="chip" aria-pressed=${String(who === m.id)} onClick=${function(){ setNs("toolbox", TB_DEF, {logWho:m.id}); }}>${m.name} <span class="c">${c}</span></button>`; })}
    </div>
    ${groups.length ? groups.map(function(g){ return html`<div key=${g.k} class="bucket"><div class="bucket-h" style=${{paddingTop:"4px"}}>${g.k}<span class="m">${W.plural(g.rows.length, "change")}</span></div>
      ${g.rows.map(function(l){ var inner = html`<${W.Fragment}><${W.Av} id=${l.who} size="s" tip=${false} /><span class="lt"><b style=${{whiteSpace:"normal"}}>${W.maskMoney(l.text)}</b><small>${W.member(l.who).name} · ${W.fmtTime(l.at)}${l.ref && W.rec(l.ref) ? " · " + W.refName(l.ref) : ""}</small></span>${l.ref && W.rec(l.ref) ? html`<${Icon} n="chevR" s=${14} cls="flip" />` : null}</${W.Fragment}>`;
        return l.ref && W.rec(l.ref) ? html`<button key=${l.id} type="button" class="li" onClick=${function(){ W.peek(l.ref.t, l.ref.id); }}>${inner}</button>` : html`<div key=${l.id} class="li">${inner}</div>`; })}</div>`; })
      : html`<${ListEmpty} icon="list" title="No changes yet">Nothing has been logged for this person.</${ListEmpty}>`}
    ${list.length > 30 ? html`<div class="row" style=${{justifyContent:"center"}}><${Btn} size="sm" onClick=${function(){ setNs("toolbox", TB_DEF, {logAll:!tb.logAll}); }}>${tb.logAll ? "Show fewer" : "Show all " + list.length}</${Btn}></div>` : null}
  </div>`;
}

function NotifsTool(){
  var d = D(), list = d.notifs.filter(function(n){ return !W.notifShown || W.notifShown(n); }).slice().sort(W.by(function(n){ return n.at; }, -1)), unread = list.filter(function(n){ return !n.read; }).length;
  function open(n){
    if (!n.read) W.act("Opened a notification", function(dd){ dd.notifs.forEach(function(x){ if (x.id === n.id) x.read = true; }); }, {log:false});
    W.ui(function(u){ if (n.go.item) u.todaySel = n.go.item; });
    W.go(n.go.s, n.go.tab || null);
  }
  return html`<div class="col tight">
    <div class="row"><span class="small ink2 grow">${unread ? W.plural(unread, "unread notification") : "Everything is read"}</span>
      <${Btn} size="sm" icon="check" disabled=${!unread} onClick=${function(){ W.act("Marked notifications read", function(dd){ dd.notifs.forEach(function(n){ n.read = true; }); }, {log:false, toast:{msg:"All notifications marked read", icon:"check"}}); }}>Mark all read</${Btn}></div>
    ${list.map(function(n){ return html`<button key=${n.id} type="button" class="li" onClick=${function(){ open(n); }}>
      <span class="tb-ic"><${Icon} n=${n.icon} s=${15} /></span><span class="lt"><b style=${{whiteSpace:"normal"}}>${W.maskMoney(n.text)}</b><small>${W.maskMoney(n.sub)} · ${W.ago(n.at)}</small></span>
      ${n.read ? null : html`<i style=${{width:"8px", height:"8px", borderRadius:"50%", background:"var(--accent)", flex:"none"}} aria-label="Unread"></i>`}<${Icon} n="chevR" s=${14} cls="flip" /></button>`; })}
  </div>`;
}

var RULES = [
  ["Foundations", [["FND-WRITE-11", "Write every email fresh for that person. No stock openers, no template phrases, no banned words."], ["HC-17", "Never put two separate parties on the same email thread or CC."]]],
  ["Creators", [
    ["INF-FIRST-02", "First email: one real moment from their latest video, a short bridge, one yes-or-no question."],
    ["INF-FIRST-14", "No fanboy flattery ('huge fan', 'love your channel'). Peer-to-peer professional tone."],
    ["INF-FIRST-21", "Truthful brand bridge: only name a specific brand when an active requirement exists."],
    ["INF-FU-03", "Follow-up 1 goes out four days after the first email, stays short and adds one new reason."],
    ["INF-FU-05", "Follow-up 2 brings a concrete, timely reason instead of repeating the ask."],
    ["INF-FU-09", "Follow-up 3 is a 35-word polite closing email ('closing the loop for now')."],
    ["INF-KIT-01", "Frame the YouTube Studio audience request around creator value — never say 'brands ask for it'."],
    ["HC-29", "Proactively check in with signed roster creators every 14–21 days."]]],
  ["Brands", [
    ["BRD-FIRST-01", "Mode A Cold Brand First Touch: 65–110 words, past-campaign hook + 1 creator teaser, no prices or links."],
    ["BRD-PITCH-02", "Mode B Warm Brand Proposal: full audience fit, 3-Option Package Menu (HC-26), and price gate (BRD-PRICE-09)."],
    ["HC-24", "4-Touch Brand Sequence across 14 days (Pitch, Day 4 Bump, Day 8 Social Proof, Day 14 Breakup)."],
    ["HC-25", "Dual-Buyer Sequencing: stagger Role 1 and Role 2 by 2–3 days with distinct angles."],
    ["BRD-NEG-04", "In a negotiation, hold the price once with proof or trade scope when dropping price (BRD-NEG-03)."],
    ["BRD-PAY-01", "Payment reminders name the invoice number, amount, video and due date, and stay friendly."]]]
];
function RulesTool(){
  var d = D(), tb = ns("toolbox", TB_DEF), q = tb.rulesQ.trim().toLowerCase();
  var use = {}; d.drafts.forEach(function(x){ (x.rules || []).forEach(function(r){ use[r] = (use[r] || 0) + 1; }); });
  var shown = 0;
  var groups = RULES.map(function(g){ var rows = g[1].filter(function(r){ return !q || r[0].toLowerCase().indexOf(q) >= 0 || r[1].toLowerCase().indexOf(q) >= 0; }); shown += rows.length; return [g[0], rows]; }).filter(function(g){ return g[1].length; });
  return html`<div class="col">
    <input class="inp" type="search" placeholder="Search by rule ID or words" value=${tb.rulesQ} onInput=${function(e){ setNs("toolbox", TB_DEF, {rulesQ:e.target.value}); }} aria-label="Search the writing rules" />
    ${groups.map(function(g){ return html`<div key=${g[0]} class="col tight"><h4>${g[0]}</h4>
      ${g[1].map(function(r){ return html`<div key=${r[0]} class="row top" style=${{padding:"6px 2px", gap:"12px"}}><span class="tag line mono" style=${{flex:"none", minWidth:"118px", justifyContent:"center"}}>${r[0]}</span><span class="grow">${r[1]}</span>
        ${use[r[0]] ? html`<span class="small muted num" style=${{flex:"none"}} data-tip="Drafts waiting for you that followed this rule">${W.plural(use[r[0]], "draft")} now</span>` : null}</div>`; })}</div>`; })}
    ${!shown ? html`<${ListEmpty} icon="search" title="No rule matches">Try a shorter search.</${ListEmpty}>` : null}
  </div>`;
}

var AGES = ["18–24","18–34","25–34","25–44","35–54"];
function FactsTool(){
  var d = D(), r = d.rules, a = r.audience, ed = useState(null), e = ed[0];
  function start(){ ed[1]({top3:a.top3.slice(), ages:a.ages.slice(), minEng:String(a.minEng), floor:String(r.marginFloor), cpm:String(r.cpm || 40), markup:String(r.markup || 60), win:r.sendWindow}); }
  function toggle(k, v){ var cur = e[k].slice(), i = cur.indexOf(v); if (i >= 0) cur.splice(i, 1); else cur.push(v); ed[1](Object.assign({}, e, (function(){ var o = {}; o[k] = cur; return o; })())); }
  function put(k, v){ var o = {}; o[k] = v; ed[1](Object.assign({}, e, o)); }
  function save(){
    var ch = [];
    if (e.top3.join() !== a.top3.join()) ch.push("lead countries " + e.top3.join(", "));
    if (e.ages.join() !== a.ages.join()) ch.push("buying ages");
    if (num(e.minEng) !== a.minEng) ch.push("engagement " + a.minEng + "% to " + num(e.minEng) + "%");
    if (num(e.floor) !== r.marginFloor) ch.push("margin floor " + r.marginFloor + "% to " + num(e.floor) + "%");
    if (num(e.cpm) !== (r.cpm || 40)) ch.push("CPM $" + (r.cpm || 40) + " to $" + num(e.cpm));
    if (num(e.markup) !== (r.markup || 60)) ch.push("markup " + (r.markup || 60) + "% to " + num(e.markup) + "%");
    if (e.win.trim() !== r.sendWindow) ch.push("send window");
    if (!ch.length){ ed[1](null); W.toast({msg:"Nothing changed", icon:"info", tone:"info", ms:2500}); return; }
    var snap = e;
    W.act("Changed the agency facts: " + ch.join(", "), function(dd){
      var rr = dd.rules; rr.audience.top3 = snap.top3.slice(); rr.audience.ages = snap.ages.slice(); rr.audience.minEng = num(snap.minEng); rr.marginFloor = num(snap.floor); rr.cpm = num(snap.cpm); rr.markup = num(snap.markup); rr.sendWindow = snap.win.trim();
    }, {toast:{msg:"Agency facts saved", sub:ch.join(" · ") + ". Checks and pricing use them now.", icon:"check"}});
    ed[1](null);
  }
  var bad = e && (!e.top3.length || !e.ages.length || !(num(e.floor) > 0 && num(e.floor) < 90) || !(num(e.cpm) > 0) || !e.win.trim());
  function chips(k, opts, label){ return html`<div class="pillrow" role="group" aria-label=${label}>${opts.map(function(o){ return html`<button key=${o[0]} type="button" class="chip" aria-pressed=${String(e[k].indexOf(o[0]) >= 0)} onClick=${function(){ toggle(k, o[0]); }}>${o[1]}</button>`; })}</div>`; }
  if (!e) return html`<div class="col">
    <dl class="kv" style=${{rowGap:"12px"}}>
      <dt>Lead countries</dt><dd>${a.top3.map(function(k){ return W.COUNTRY[k] || k; }).join(", ")} <span class="hint">The biggest audience country must be one of these.</span></dd>
      <dt>Buying ages</dt><dd>${a.ages.join(", ")}</dd>
      <dt>Engagement</dt><dd>${a.minEng}% or more</dd>
      <dt>Margin floor</dt><dd>${r.marginFloor}% <span class="hint">Counter-offers below this are flagged.</span></dd>
      <dt>Default CPM</dt><dd>${W.money(r.cpm || 40)} per 1,000 views</dd>
      <dt>Default markup</dt><dd>${r.markup || 60}% on the creator's payout</dd>
      <dt>Boycott list (HC-09)</dt><dd>${(r.boycott || ["Wix","Fiverr","Monday.com"]).join(", ")}</dd>
      <dt>Send window</dt><dd>${r.sendWindow}</dd>
    </dl>
    <div class="row wrap"><${Btn} icon="edit" onClick=${start}>Edit these facts</${Btn}><span class="hint">Search rules (minimum views, uploads, keywords) live in Find, Search.</span></div>
  </div>`;
  return html`<div class="col">
    <${W.Field} label="Lead countries" hint="Channels whose biggest audience country is not one of these fail the audience check.">${chips("top3", Object.keys(W.COUNTRY).map(function(k){ return [k, W.COUNTRY[k]]; }), "Lead countries")}</${W.Field}>
    <${W.Field} label="Buying ages">${chips("ages", AGES.map(function(x){ return [x, x]; }), "Buying ages")}</${W.Field}>
    <div class="grid2" style=${{gap:"12px"}}>
      <${W.Field} label="Engagement, at least %"><input class="inp num" inputMode="decimal" value=${e.minEng} onInput=${function(ev){ put("minEng", ev.target.value); }} /></${W.Field}>
      <${W.Field} label="Margin floor, %" hint="Between 1 and 89."><input class="inp num" inputMode="decimal" value=${e.floor} onInput=${function(ev){ put("floor", ev.target.value); }} /></${W.Field}>
      <${W.Field} label="Default CPM, dollars"><input class="inp num" inputMode="decimal" value=${e.cpm} onInput=${function(ev){ put("cpm", ev.target.value); }} /></${W.Field}>
      <${W.Field} label="Default markup, %"><input class="inp num" inputMode="decimal" value=${e.markup} onInput=${function(ev){ put("markup", ev.target.value); }} /></${W.Field}>
    </div>
    <${W.Field} label="Send window"><input class="inp" value=${e.win} onInput=${function(ev){ put("win", ev.target.value); }} /></${W.Field}>
    <div class="row wrap"><${Btn} kind="pri" icon="check" disabled=${bad} onClick=${save}>Save changes</${Btn}><${Btn} kind="ghost" onClick=${function(){ ed[1](null); }}>Cancel</${Btn}></div>
  </div>`;
}

function HealthTool(){
  var d = D(), u = W.U(), tb = ns("toolbox", TB_DEF);
  var slowed = d.mail.filter(function(m){ return m.status === "slowed"; }), warming = d.mail.filter(function(m){ return m.status === "warming"; });
  var run = d.runs.filter(function(x){ return x.id === "r3"; })[0], busy = u.jobs.some(function(j){ return !j.done; });
  var hl = d.health || {}, signedOut = d.mail.filter(function(m){ return m.status === "error"; }), gemDown = hl.gemini === "offline";
  var rows = [
    gemDown ? {k:"gem", icon:"sparkle", name:"Gemini bridge", tone:"crit", label:"Offline", detail:"The browser add-on stopped answering at " + W.fmtTime(hl.geminiAt || W.now()) + ". Open Chrome on the Gemini tab, then reconnect.", fix:["Reconnect", W.A.reconnectGemini]}
      : {k:"gem", icon:"sparkle", name:"Gemini bridge", tone:"good", label:"Connected", detail:"Browser add-on 0.3.3 is open on the Gemini tab. Every draft is asked for at thinking level high.", test:"Gemini answered a test prompt in 2.4 s"},
    hl.youtube === "quota" ? {k:"yt", icon:"video", name:"YouTube search", tone:"warn", label:"Daily limit used", detail:"Today's search used up YouTube's daily allowance at keyword " + ((run || {}).cur + 1) + ". It resets at midnight Pacific time.", go:["find", "search", "Open the search"]}
      : {k:"yt", icon:"video", name:"YouTube search", tone:"good", label:"Within limits", detail:"About a fifth of today's search allowance is used.", test:"YouTube answered a test search in 0.6 s"},
    {k:"py", icon:"scan", name:"Python pipeline", tone:"good", label:busy ? "Running" : "Ready", detail:run ? "Last search was run r3 at " + W.fmtTime(run.at) + ", " + run.status + " after keyword " + run.cur + "." : "No search has run yet.", test:"The pipeline answered on this computer in 0.3 s"},
    signedOut.length ? {k:"gm", icon:"mail", name:"Gmail accounts", tone:"crit", label:"Signed out", detail:signedOut[0].addr.split("@")[0] + " is signed out (" + (signedOut[0].err || "sign-in expired") + ").", fix:["Sign in again", function(){ W.A.reconnectMailbox(signedOut[0].id); }]} :
    {k:"gm", icon:"mail", name:"Gmail accounts", tone:slowed.length ? "warn" : "good", label:slowed.length ? "Needs a look" : "Connected", detail:W.plural(d.mail.length, "mailbox", "mailboxes") + " connected" + (slowed.length ? ". " + slowed[0].addr.split("@")[0] + " is held at " + slowed[0].cap + " a day after bounces" : "") + (warming.length ? ". " + warming[0].addr.split("@")[0] + " is still warming up" : "") + ".", go:["reach", "mailboxes", "Open mailboxes"], test:"All " + d.mail.length + " mailboxes accepted a test login"},
    {k:"sync", icon:"refresh", name:"Local state & team sync", tone:u.saving ? "warn" : "good", label:u.saving ? "Saving" : "Persisted", detail:"Automatically persisted to localStorage (" + W.STORAGE_KEY + ") and synced " + W.ago(u.savedAt) + ".", test:"localStorage state verified"}
  ];
  var warn = rows.filter(function(r){ return r.tone !== "good"; });
  function check(r){ W.toast({msg:r.name + " is working", sub:r.test, icon:"check", tone:"info", ms:3500}); }
  return html`<div class="col">
    ${warn.length ? html`<${W.Fragment}><${W.Callout} tone="warn">Needs a look: ${warn.map(function(r){ return r.name; }).join(", ")}. ${warn[0].detail}</${W.Callout}>${warn[0].go ? html`<div class="row"><${Btn} size="sm" icon="arrowR" onClick=${function(){ W.go(warn[0].go[0], warn[0].go[1]); }}>${warn[0].go[2]}</${Btn}></div>` : null}</${W.Fragment}>`
      : html`<${W.Callout} tone="good">Everything behind the app is connected and working.</${W.Callout}>`}
    <div class="col tight">${rows.map(function(r){ return html`<div key=${r.k} class="row top" style=${{gap:"12px", padding:"10px 4px", borderBottom:"1px solid var(--line)"}}>
      <span class="tb-ic"><${Icon} n=${r.icon} s=${15} /></span>
      <div class="grow col t2"><div class="row"><b style=${{fontWeight:600}}>${r.name}</b><${Tag} tone=${r.tone} icon=${r.tone === "good" ? "check" : "alert"}>${r.label}</${Tag}></div><span class="small ink2">${r.detail}</span></div>
      ${r.fix ? html`<${Btn} size="sm" kind="pri" onClick=${r.fix[1]}>${r.fix[0]}</${Btn}>` : r.go ? html`<${Btn} size="sm" onClick=${function(){ W.go(r.go[0], r.go[1]); }}>${r.go[2]}</${Btn}>` : html`<${Btn} size="sm" onClick=${function(){ check(r); }}>Test</${Btn}>`}</div>`; })}</div>
  </div>`;
}

W.FactsTool = FactsTool; W.RulesTool = RulesTool; W.HealthTool = HealthTool;
var TOOL_VIEW = {price:PriceTool, archive:ArchiveTool, never:NeverTool, scheduled:ScheduledTool, log:LogTool, notifs:NotifsTool, rules:RulesTool, facts:FactsTool, health:HealthTool};

function Toolbox(){
  var st = W.useApp(), d = st.data;
  function shown(t){ return t.g !== "Moved" && (t.k !== "price" || W.canSeeMoney()); }
  var tb = ns("toolbox", TB_DEF), cur = TOOLS.filter(function(t){ return t.k === tb.tool && shown(t); })[0] || TOOLS.filter(shown)[0];
  function pick(k){ setNs("toolbox", TB_DEF, {tool:k}); }
  var LIST = TOOLS.filter(shown);
  function step(n){ var i = LIST.indexOf(cur) + n; if (i >= 0 && i < LIST.length) pick(LIST[i].k); }
  W.useKeys({j:function(){ step(1); }, k:function(){ step(-1); }});
  var counts = {
    archive:d.creators.filter(function(c){ return c.stage === "rejected"; }).length,
    never:d.creators.filter(function(c){ return c.stage === "never"; }).length,
    scheduled:W.sum(Object.keys(d.threads), function(id){ return d.threads[id].filter(function(m){ return m.dir === "out" && m.scheduled; }).length; }),
    log:d.log.filter(function(l){ return W.dayDiff(l.at) === 0; }).length,
    notifs:d.notifs.filter(function(n){ return !n.read && (!W.notifShown || W.notifShown(n)); }).length,
    rules:W.sum(RULES, function(g){ return g[1].length; }),
    health:d.mail.filter(function(m){ return m.status === "slowed"; }).length
  };
  var View = TOOL_VIEW[cur.k];
  return html`<div class="page">
    <${W.PageHead} title="Toolbox" sub="The smaller tools behind the work. Pick a tool from the list and it opens next to it." />
    <div class="tb" data-why="toolbox">
      <div class="card tb-list" role="listbox" aria-label="Tools">
        ${["Tools","History"].map(function(g){ return html`<div key=${g} class="bucket"><div class="bucket-h">${g}</div>
          ${TOOLS.filter(function(t){ return t.g === g && shown(t); }).map(function(t){ var n = counts[t.k];
            return html`<button key=${t.k} type="button" class="li" role="option" aria-selected=${String(t.k === cur.k)} onClick=${function(){ pick(t.k); }}>
              <span class="tb-ic"><${Icon} n=${t.icon} s=${15} /></span><span class="lt"><b>${t.name}</b><small>${t.desc}</small></span>
              ${n ? html`<span class=${W.cx("cnt", (t.k === "notifs" || t.k === "health") ? "hot" : null)}>${n}</span>` : null}</button>`; })}</div>`; })}
        <div class="bucket"><div class="bucket-h">Settings</div><button type="button" class="li" onClick=${function(){ W.go("settings", "facts"); }}><span class="tb-ic"><${Icon} n="gear" s=${15} /></span><span class="lt"><b>Rules, facts and connections</b><small>Writing rules, agency facts and setup health now live in Settings</small></span><${Icon} n="arrowR" cls="flip" /></button></div>
      </div>
      <div class="card tb-pane" key=${cur.k}>
        <div class="row top" style=${{gap:"12px"}}><span class="tb-ic" style=${{width:"36px", height:"36px", borderRadius:"10px"}}><${Icon} n=${cur.icon} s=${18} /></span><div class="grow col t2"><h2>${cur.name}</h2><p class="small ink2" style=${{maxWidth:"64ch"}}>${cur.long}</p></div></div>
        <hr class="divider" />
        <${View} />
      </div>
    </div>
  </div>`;
}
W.screens.toolbox = Toolbox;

/* ======================================================================= TEAM */
var TEAM_DEF = {rebalance:false, inviting:false, invName:"", invRole:"VA", rebSkip:{}, rebTo:null};

W.A.rebalance = function(picks, to){
  var m = W.member(to), n = picks.length, mins = Math.round(W.sum(picks, function(x){ return x.est; }));
  W.act("Rebalanced the day: handed " + W.plural(n, "item") + " to " + m.name, function(d){
    picks.forEach(function(x){
      var list = x.ref.t === "creator" ? d.creators : x.ref.t === "deal" ? d.deals : d.brands, o = list.filter(function(z){ return z.id === x.ref.id; })[0];
      if (o) o.owner = to;
      d.handed[x.key] = {to:to, note:"Rebalanced the day", at:W.now()};
    });
  }, {toast:{msg:"Handed " + W.plural(n, "quick win") + " to " + m.name, sub:"About " + W.dur(mins) + " of work moved to " + m.name + "'s Today.", icon:"forward", tone:"info"}});
};
W.A.setVaMoney = function(v){
  W.act(v === "show" ? "Decided: VAs can see money" : "Decided: VAs do not see money", function(d){ d.settings.vaMoney = v; },
    {toast:{msg:v === "show" ? "VAs will see invoices and payouts" : "Money stays hidden from VAs", sub:"The permissions table shows the decision.", icon:"shield", tone:"info"}});
};

function loadBy(items){
  var d = D(), by = {};
  d.team.forEach(function(m){ by[m.id] = {m:m, items:[], min:0}; });
  items.forEach(function(it){ var o = it.owner || d.me; if (by[o]){ by[o].items.push(it); by[o].min += it.est; } });
  return by;
}
function rebalancePlan(by){
  var d = D(), arr = d.team.map(function(m){ return by[m.id]; });
  var busiest = arr.slice().sort(W.by(function(x){ return x.min; }, -1))[0];
  var least = arr.filter(function(x){ return x.m.id !== busiest.m.id; }).sort(function(a, b){ return ((a.m.status === "online" ? 0 : 1) - (b.m.status === "online" ? 0 : 1)) || (a.min - b.min); })[0];
  if (!least) return null;
  var va = /^VA/.test(least.m.role);
  var picks = busiest.items.filter(function(it){ return it.quick && it.ref && (it.ref.t === "creator" || it.ref.t === "deal") && !(va && (it.b === "money" || it.b === "deals" || it.b === "pitches")); }).slice(0, 6);
  return {from:busiest, to:least, picks:picks, mins:W.sum(picks, function(x){ return x.est; })};
}
function handoffRows(){
  var d = D();
  return d.log.filter(function(l){ return /^(Handed |Rebalanced|Routed )/.test(l.text); }).sort(W.by(function(l){ return l.at; }, -1)).slice(0, 8).map(function(l){
    var mt = l.text.match(/^Handed (.+) to ([^:]+)$/) || l.text.match(/^Rebalanced the day: handed (.+) to (.+)$/), to = null, title = null, note = null;
    if (mt){ title = mt[1]; var nm = mt[2]; to = nm === "you" ? d.me : (d.team.filter(function(m){ return m.name === nm; })[0] || {}).id;
      var hit = d.notifs.filter(function(n){ return /handed you/.test(n.text) && n.text.indexOf(title) >= 0; })[0]; if (hit) note = hit.sub.replace(/^"|"$/g, ""); }
    var h = l.ref ? Object.keys(d.handed).filter(function(k){ return k.slice(-l.ref.id.length) === l.ref.id; }).map(function(k){ return d.handed[k]; })[0] : null;
    if (h && h.note) note = h.note;
    return {l:l, title:title, to:to, note:note};
  });
}

var PERMS = [
  ["See creators, brands and deals", "y", "y", "y"],
  ["Run searches and review new channels", "y", "y", "y"],
  ["Approve and send emails", "y", "y", "From their own list (or shadow-approval)"],
  ["Set prices and answer counter-offers", "y", "y", "n"],
  ["See money: invoices, payouts and margins", "y", "y", "money"],
  ["Mark invoices paid and pay creators", "y", "y", "n"],
  ["Change writing rules and agency facts", "y", "n", "n"],
  ["Hand off and snooze", "y", "y", "Their own items"],
  ["Mark a channel never contact", "y", "y", "y"],
  ["Invite people and change roles", "y", "n", "n"]
];
function Cell(p){
  var v = p.v;
  if (v === "y") return html`<span class="cellv y"><${Icon} n="check" s=${14} />Yes</span>`;
  if (v === "n") return html`<span class="cellv n"><${Icon} n="x" s=${14} />No</span>`;
  return html`<span class="cellv p"><${Icon} n="minus" s=${14} />${v}</span>`;
}

function PersonCard(p){
  var m = p.p.m, items = p.p.items, min = p.p.min, d = D(), u = W.U(), budget = d.day.budget;
  var did = d.log.filter(function(l){ return l.who === m.id && W.dayDiff(l.at) === 0; }).length;
  var looking = Object.keys(u.viewers || {}).filter(function(k){ return u.viewers[k] === m.id; }).map(refOf).filter(Boolean);
  var tone = min > budget ? "crit" : min > budget * .75 ? "warn" : null;
  return html`<div class="card">
    <div class="row top" style=${{gap:"12px"}}>
      <${W.Av} id=${m.id} size="l" status=${m.status} tip=${false} />
      <div class="grow col t2"><h3>${m.name}</h3><span class="small muted">${m.role}</span></div>
    </div>
    <div class="col t2"><div class="row"><span class="small muted grow">Doing now</span><${Tag} tone=${m.status === "online" ? "good" : null} icon=${m.status === "online" ? "check" : "clock"}>${m.status === "online" ? "Online" : "Away"}</${Tag}></div><span>${m.doing}</span>
      ${looking.length ? html`<button type="button" class="btn ghost sm" style=${{alignSelf:"flex-start", marginInlineStart:"-9px"}} onClick=${function(){ W.peek(looking[0].t, looking[0].id); }}><${Icon} n="eye" />Looking at ${W.refName(looking[0])}</button>` : null}</div>
    <div class="tm-load"><div class="row"><span class="small muted grow">Today's load</span><span class="small num">${W.plural(items.length, "item")} · ${W.dur(min)} of ${W.dur(budget)}</span></div>
      <${W.Meter} v=${min} max=${budget} w=${"100%"} tone=${tone} label=${m.name + "'s planned time"} /></div>
    <div class="row"><span class="small muted grow" data-tip="Changes logged under this name today">Done today</span><b class="num">${did}</b></div>
    ${items.length ? html`<div class="col" style=${{gap:"0"}}><span class="small muted" style=${{marginBottom:"2px"}}>Next up</span>
      ${items.slice(0, 3).map(function(it){ var b = W.bucket(it.b); return html`<button key=${it.key} type="button" class="li" style=${{minHeight:"34px", padding:"4px 6px"}} onClick=${function(){ W.ui(function(uu){ uu.todayScope = "team"; uu.todaySel = it.key; uu.wrap = false; }); W.go("today"); }}>
        <span class="lt"><b style=${{fontSize:"12.5px"}}>${W.maskMoney(it.title)}</b><small>${b.name} · about ${Math.max(1, Math.round(it.est))} min</small></span></button>`; })}</div>` : html`<span class="small muted">Nothing is assigned to ${m.id === d.me ? "you" : m.name} right now.</span>`}
  </div>`;
}

function Team(){
  var st = W.useApp(), d = st.data;
  var S = ns("team", TEAM_DEF);
  var items = W.items("team"), by = loadBy(items), plan = rebalancePlan(by);
  var online = d.team.filter(function(m){ return m.status === "online"; }).length;
  var rows = handoffRows(), vaMoney = d.settings.vaMoney, vaApproval = !!d.settings.vaApproval;
  var canMove = plan && plan.picks.length > 0 && plan.from.min - plan.to.min >= 15;
  var va = d.team.filter(function(m){ return /^VA/.test(m.role); });
  var vaSteps = d.vaOnboarding || [];
  function roleHead(role, label){ var ppl = d.team.filter(function(m){ return role === "VA" ? /^VA/.test(m.role) : m.role === role; }); return html`<th>${label}<span class="avs" style=${{marginTop:"4px"}}>${ppl.map(function(m){ return html`<${W.Av} key=${m.id} id=${m.id} size="s" />`; })}</span></th>`; }
  var isOwn = W.member(d.me).role === "Owner";
  var targetTo = (S.rebTo && by[S.rebTo]) ? by[S.rebTo] : (plan ? plan.to : null);
  var activePicks = plan ? plan.picks.filter(function(it){ return !(S.rebSkip || {})[it.key]; }) : [];
  return html`<div class="page">
    <${W.PageHead} title="Team" sub=${W.plural(d.team.length, "person", "people") + ", " + online + " online. Who has what today, VA onboarding, and who can do what."}
      right=${html`<div class="row wrap">${isOwn ? html`<${Btn} icon="plus" onClick=${function(){ setNs("team", TEAM_DEF, {inviting:!S.inviting}); }}>Invite teammate</${Btn}>` : null}<${Btn} icon="users" onClick=${function(){ setNs("team", TEAM_DEF, {rebalance:!S.rebalance, rebSkip:{}}); }} tip="Hand quick wins from the busiest person to the least busy">Rebalance</${Btn}></div>`} />
    ${S.inviting ? html`<div class="card tight"><div class="card-h"><h3>Invite a teammate</h3><${Btn} size="sm" kind="ghost" icon="x" onClick=${function(){ setNs("team", TEAM_DEF, {inviting:false}); }}>Cancel</${Btn}></div><div class="row wrap"><input class="inp sm" style=${{width:"200px"}} placeholder="First name (e.g. Tariq)" value=${S.invName || ""} onInput=${function(e){ setNs("team", TEAM_DEF, {invName:e.target.value}); }} aria-label="Teammate name" /><select class="sel sm" style=${{width:"180px"}} value=${S.invRole || "VA"} onChange=${function(e){ setNs("team", TEAM_DEF, {invRole:e.target.value}); }} aria-label="Role"><option value="VA">VA</option><option value="Account manager">Account manager</option></select><${Btn} size="sm" kind="pri" icon="check" disabled=${!(S.invName || "").trim()} onClick=${function(){ var nm = S.invName.trim(), rl = S.invRole || "VA", uid = W.uid("u"); W.act("Invited " + nm + " (" + rl + ")", function(dd){ dd.team.push({id:uid, name:nm, role:rl, status:"online", doing:"Just joined"}); }, {toast:{msg:nm + " added to the team", sub:"Role: " + rl + ". You can hand items to them now.", icon:"users"}}); setNs("team", TEAM_DEF, {inviting:false, invName:""}); }}>Add to team</${Btn}></div></div>` : null}

    ${S.rebalance ? html`<div class="card" style=${{gap:"12px"}}>
      <div class="card-h"><h3>Rebalance today</h3><${Btn} size="sm" kind="ghost" icon="x" onClick=${function(){ setNs("team", TEAM_DEF, {rebalance:false}); }}>Close</${Btn}></div>
      <div class="row wrap" style=${{gap:"8px", paddingBottom:"8px", borderBottom:"1px solid var(--line)"}}>
        <span class="small ink2">1-click role routing:</span>
        <${Btn} size="sm" icon="at" onClick=${function(){ W.A.rebalanceByRole("va"); setNs("team", TEAM_DEF, {rebalance:false}); }}>Route Contacts & Follow-ups → VA</${Btn}>
        <${Btn} size="sm" icon="box" onClick=${function(){ W.A.rebalanceByRole("am"); setNs("team", TEAM_DEF, {rebalance:false}); }}>Route Delivery & Kits → AM</${Btn}>
      </div>
      ${!plan ? html`<p class="hint">There is nobody to hand work to.</p>` : html`<${W.Fragment}>
        <div class="row wrap"><span><b>${plan.from.m.name}</b> has the most planned (${W.dur(plan.from.min)}). Hand to:</span><select class="sel sm" style=${{width:"auto"}} value=${targetTo.m.id} onChange=${function(e){ setNs("team", TEAM_DEF, {rebTo:e.target.value}); }} aria-label="Hand off to teammate">${d.team.filter(function(m){ return m.id !== plan.from.m.id; }).map(function(m){ return html`<option key=${m.id} value=${m.id}>${m.name} · ${m.role} (${W.dur(by[m.id].min)}${m.status === "away" ? ", away" : ""})</option>`; })}</select></div>
        ${canMove ? html`<${W.Fragment}>
          <p class="small ink2">Quick wins under two minutes that can move across, about ${W.dur(W.sum(activePicks, function(x){ return x.est; }))} selected:</p>
          <div class="col" style=${{gap:"4px"}}>${plan.picks.map(function(it){ var b = W.bucket(it.b), on = !(S.rebSkip || {})[it.key]; return html`<label key=${it.key} class="ck" style=${{cursor:"pointer"}}><input type="checkbox" checked=${on} onChange=${function(){ var sk = Object.assign({}, S.rebSkip || {}); sk[it.key] = on; setNs("team", TEAM_DEF, {rebSkip:sk}); }} /><span class="t"><b>${W.maskMoney(it.title)}</b><small>${b.name} · about ${Math.max(1, Math.round(it.est))} min</small></span></label>`; })}</div>
          <div class="row wrap"><${Btn} kind="pri" icon="forward" disabled=${!activePicks.length} onClick=${function(){ W.A.rebalance(activePicks, targetTo.m.id); setNs("team", TEAM_DEF, {rebalance:false, rebSkip:{}}); }}>Hand ${W.plural(activePicks.length, "item")} to ${targetTo.m.name}</${Btn}><${Btn} kind="ghost" onClick=${function(){ setNs("team", TEAM_DEF, {rebalance:false}); }}>Not now</${Btn}></div></${W.Fragment}>`
        : html`<${W.Callout} tone="good">${plan.from.min - plan.to.min < 15 ? "The day is already balanced." : plan.from.m.name + " has no quick wins that can move."} Nothing to hand over.</${W.Callout}>`}
      </${W.Fragment}>`}
    </div>` : null}

    <div class="auto-grid" data-why="team">${d.team.map(function(m){ return html`<${PersonCard} key=${m.id} p=${by[m.id]} />`; })}</div>

    ${vaSteps.length ? html`<div class="card" data-why="va-onboarding">
      <div class="card-h">
        <div class="grow col t2"><h3>First-Week VA Onboarding & Shadow-Approval Gate (QOL[210])</h3><span class="small muted">Track a new VA's first 5 training milestones and require Owner approval on their first 50 outreach drafts.</span></div>
        <${Tag} tone=${vaApproval ? "warn" : "good"} icon="shield">${vaApproval ? "Shadow-Approval ON (Owner approves VA sends)" : "Direct Send Enabled"}</${Tag}>
      </div>
      <ul class="checks">
        ${vaSteps.map(function(s){ var sid = s.k || s.id; return html`<li key=${sid} class=${W.cx("ck", s.done ? "done" : null)}>
          <button type="button" class="box" aria-pressed=${String(!!s.done)} onClick=${function(){ W.A.toggleVaOnboarding(sid); }}><${Icon} n="check" s=${13} /></button>
          <span class="t">${s.label || s.t}</span>
        </li>`; })}
      </ul>
      <div class="row wrap">
        <${Btn} size="sm" kind=${vaApproval ? "pri" : "ghost"} icon="shield" onClick=${function(){ W.A.setVaApproval(!vaApproval); }}>${vaApproval ? "Disable VA Shadow-Approval Gate" : "Enable VA Shadow-Approval Gate"}</${Btn}>
      </div>
    </div>` : null}

    <div class="card">
      <div class="card-h"><h3>Handoffs</h3><span class="small muted">What moved between people recently</span></div>
      ${rows.length ? html`<div class="col" style=${{gap:"0"}}>${rows.map(function(x){ var ref = x.l.ref && W.rec(x.l.ref) ? x.l.ref : null;
        var inner = html`<${W.Fragment}><${W.Av} id=${x.l.who} size="s" tip=${false} /><span class="lt"><b style=${{whiteSpace:"normal"}}>${W.maskMoney(x.title ? W.member(x.l.who).name + " handed " + x.title + " to " + (x.to ? (x.to === d.me ? "you" : W.member(x.to).name) : "a teammate") : x.l.text)}</b><small>${x.note ? "\"" + W.maskMoney(x.note) + "\" · " : ""}${W.ago(x.l.at)}</small></span>${x.to ? html`<${Icon} n="arrowR" s=${14} cls="flip" /><${W.Av} id=${x.to} size="s" tip=${false} />` : null}</${W.Fragment}>`;
        return ref ? html`<button key=${x.l.id} type="button" class="li" onClick=${function(){ W.peek(ref.t, ref.id); }}>${inner}</button>` : html`<div key=${x.l.id} class="li">${inner}</div>`; })}</div>`
        : html`<${ListEmpty} icon="forward" title="Nothing handed off yet">Hand an item to a teammate from Today (press H) or from the owner menu on any record.</${ListEmpty}>`}
    </div>

    <div class="card" data-why="roles">
      <div class="card-h"><h3>Who can do what</h3><span class="small muted">Roles in the example team</span></div>
      <div class="tw"><table class="tbl tm-perm"><thead><tr><th>What</th>${roleHead("Owner", "Owner")}${roleHead("Account manager", "Account manager")}${roleHead("VA", "VA")}</tr></thead>
        <tbody>${PERMS.map(function(r){ var money = r[3] === "money", vv = money ? (vaMoney === "show" ? "y" : "n") : r[3];
          return html`<tr key=${r[0]}><td>${r[0]}${money ? html` <${Tag} tone=${vaMoney ? "good" : "warn"} icon=${vaMoney ? "check" : "help"}>${vaMoney ? "Decided" : "Open decision"}</${Tag}>` : null}</td><td><${Cell} v=${r[1]} /></td><td><${Cell} v=${r[2]} /></td><td><${Cell} v=${vv} /></td></tr>`; })}</tbody></table></div>
      <${W.Callout} tone=${vaMoney ? "good" : "warn"} icon=${vaMoney ? "checkc" : "help"}>
        ${vaMoney ? "Decided: VAs " + (vaMoney === "show" ? "can" : "cannot") + " see invoices, payouts and margins." : "Open decision: should VAs see invoices, payouts and margins? Until you decide, the prototype hides money from VAs."} ${va.length ? W.plural(va.length, "VA") + " on the team today." : ""}
      </${W.Callout}>
      <div class="row wrap"><${Btn} size="sm" kind=${vaMoney === "hide" ? "pri" : null} onClick=${function(){ if (vaMoney !== "hide") W.A.setVaMoney("hide"); }}>Keep money hidden</${Btn}><${Btn} size="sm" kind=${vaMoney === "show" ? "pri" : null} onClick=${function(){ if (vaMoney !== "show") W.A.setVaMoney("show"); }}>Let VAs see money</${Btn}></div>
    </div>
  </div>`;
}
W.screens.team = Team;
})();
