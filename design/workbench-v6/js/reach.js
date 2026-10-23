/* reach.js — Reach out. Four tabs on one idea: nothing sends until you press Send, and nothing waits unseen.
   Board: where every outreach stands. Sequences: a day-by-day timeline of every creator (3-touch) and brand (4-touch) follow-up.
   Replies: a mail view with Gemini's reading, 47-Situation reclassifier, and the drafted answer. Mailboxes: capacity, health and the slowdown rule. */
(function(){
"use strict";
var W = window.W, html = W.html, Icon = W.Icon, useRef = W.useRef, useEffect = W.useEffect;
var Btn = W.Btn, Tag = W.Tag;

W.css(`
/* header summary */
.rc-cap{display:inline-flex; align-items:center; gap:12px; padding:7px 12px; border:1px solid var(--line); border-radius:var(--r-m); background:var(--panel); text-align:start; color:inherit; max-width:100%; transition:border-color .12s}
.rc-cap:hover{border-color:var(--line-2)}
.rc-cap b{font-size:1.2rem; font-weight:600; line-height:1.1; font-variant-numeric:tabular-nums}
.rc-cap small{font-size:11.5px; color:var(--muted); line-height:1.3}

/* board */
.rc-board{grid-auto-columns:minmax(180px,1fr)}
@media (max-width:600px){ .rc-board{grid-auto-flow:row; grid-auto-columns:minmax(0,1fr)} }
.rc-k{cursor:pointer; gap:5px}
.rc-k:hover{border-color:var(--line-2)}
.rc-k .rc-sub{display:flex; gap:5px; align-items:flex-start; line-height:1.35; color:var(--muted); font-size:11.8px}
.rc-k .rc-sub .ic{width:12px; height:12px; margin-top:2px; flex:none}
.rc-k .rc-sub.need{color:var(--warn)}
.rc-foot{display:flex; align-items:center; gap:6px; min-height:26px}
.rc-foot .btn.sm{height:26px; padding:0 8px}
.rc-more{align-self:flex-start}
.lane .empty .btn{margin-top:4px}

/* sequences timeline */
.sq{overflow-x:auto; border:1px solid var(--line); border-radius:var(--r-l); background:var(--panel); min-width:0}
.sq-in{position:relative; min-width:1060px; --lw:192px; --rw:260px; --cols:var(--lw) repeat(29,minmax(22px,1fr)) var(--rw)}
@media (max-width:600px){ .sq-in{--lw:136px; --rw:220px} }
.sq-r{display:grid; grid-template-columns:var(--cols); border-bottom:1px solid var(--line); min-height:46px}
.sq-body .sq-r:last-child{border-bottom:0}
.sq-body .sq-r{cursor:pointer; transition:background .1s}
.sq-body .sq-r:hover{background:var(--sunk)}
.sq-body .sq-r:hover>.sq-l{background:var(--sunk)}
.sq-body .sq-r[aria-selected="true"]{background:var(--accent-soft)}
.sq-body .sq-r[aria-selected="true"]>.sq-l{background:var(--accent-soft)}
.sq-hd{background:var(--sunk)}
.sq-hd>.sq-l,.sq-hd>.sq-x{background:var(--sunk)}
.sq-wkrow{min-height:26px; border-bottom:0}
.sq-wk{font-size:11px; color:var(--muted); padding:5px 0 0 6px; overflow:hidden; white-space:nowrap; min-width:0}
.sq-l{position:sticky; inset-inline-start:0; z-index:2; display:flex; align-items:center; gap:8px; padding:6px 10px; min-width:0; background:var(--panel); border:0; border-inline-end:1px solid var(--line); text-align:start; color:inherit; font-size:13px}
.sq-l b{font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0}
.sq-hd>.sq-l{font-size:11.5px; color:var(--muted); font-weight:500; align-items:flex-end}
.sq-x{display:flex; align-items:center; gap:6px; padding:4px 6px 4px 12px; min-width:0; border-inline-start:1px solid var(--line)}
.sq-hd>.sq-x{font-size:11.5px; color:var(--muted); font-weight:500; align-items:flex-end}
.sq-x .nx{flex:1; min-width:0; font-size:12.5px; color:var(--ink-2); display:flex; align-items:center; gap:5px}
.sq-x .nx span{overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0}
.sq-x .nx .ic{width:13px; height:13px; flex:none}
.sq-x .nx.due{color:var(--warn); font-weight:500}
.sq-c{position:relative; display:flex; align-items:center; justify-content:center; gap:2px; min-width:0}
.sq-c.mon{border-inline-start:1px solid var(--line)}
.sq-c.now{background:color-mix(in srgb, var(--reach) 9%, transparent)}
.sq-day{flex-direction:column; gap:1px; padding:4px 0 6px; font-size:10px; color:var(--muted); line-height:1.25; justify-content:flex-end}
.sq-day b{font-size:11.5px; font-weight:500; color:var(--ink-2); font-variant-numeric:tabular-nums}
.sq-day.we b{color:var(--muted)}
.sq-day.now b{background:var(--reach); color:var(--panel); border-radius:9px; padding:0 6px; font-weight:600}
.sq-c.ln::before{content:""; position:absolute; inset-inline:0; top:50%; height:2px; margin-top:-1px; background:var(--line-2)}
.sq-c.ls::before{inset-inline-start:50%}
.sq-c.le::before{inset-inline-end:50%}
.sq-c.fut.ln::before{background:repeating-linear-gradient(90deg, var(--line-2) 0 4px, transparent 4px 7px)}
.sq-d{position:relative; z-index:1; width:11px; height:11px; border-radius:50%; flex:none; display:inline-grid; place-items:center; box-sizing:border-box}
.sq-d.sent{background:var(--reach)}
.sq-d.plan{background:var(--panel); border:1.6px solid var(--reach)}
.sq-d.due{background:var(--warn-soft); border:2px solid var(--warn); box-shadow:0 0 0 3px color-mix(in srgb, var(--warn) 20%, transparent)}
.sq-d.reply{width:10px; height:10px; border-radius:2px; background:var(--good); transform:rotate(45deg)}
.sq-d.skip{background:var(--panel); color:var(--muted); width:13px; height:13px}
.sq-d.skip .ic{width:11px; height:11px; stroke-width:2.4}
.sq-c.two{gap:0}
.sq-c.two .sq-d.sent,.sq-c.two .sq-d.plan,.sq-c.two .sq-d.due{width:9px; height:9px}
.sq-leg{display:flex; flex-wrap:wrap; gap:6px 18px; font-size:12px; color:var(--ink-2)}
.sq-leg span{display:inline-flex; align-items:center; gap:7px; white-space:nowrap}
.sq-leg .sw{display:inline-block; width:12px; height:12px; border-radius:3px; background:color-mix(in srgb, var(--reach) 9%, var(--panel)); border:1px solid var(--line-2)}
.sq-leg .dash{display:inline-block; width:18px; height:0; border-top:2px dashed var(--line-2)}

/* replies */
.rc-in .li{align-items:flex-start; padding:9px 10px}
.rc-in .li .lt small{white-space:normal; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden}
.rc-in .li .rt{display:flex; flex-direction:column; align-items:flex-end; gap:2px; flex:none; text-align:end}
.rc-in .li .rt small{font-size:11.5px; color:var(--muted)}
.rc-in .li .rt small.go{color:var(--accent-strong); font-weight:500}
.rc-filters{display:flex; flex-wrap:wrap; gap:6px; padding:6px 6px 8px}

/* mailboxes */
.rc-mgrid{display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:var(--gap); align-items:start}
.rc-mrow{display:grid; grid-template-columns:84px minmax(0,1fr) auto; gap:10px; align-items:center; font-size:12.5px}
.rc-mrow .meter{width:100%}
.rc-mstats{display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px}
.rc-ms{display:flex; flex-direction:column; gap:1px; padding:8px 10px; border-radius:var(--r-m); background:var(--sunk); min-width:0}
.rc-ms b{font-size:15px; font-weight:600; font-variant-numeric:tabular-nums}
.rc-ms small{font-size:11.5px; color:var(--muted)}
.rc-ms.warn b{color:var(--warn)}
.rc-ms.crit b{color:var(--crit)}
.rc-step{min-width:34px; text-align:center; font-weight:600; font-variant-numeric:tabular-nums; font-size:13px}
.seg button:disabled{opacity:.4; cursor:not-allowed}
`);

var DEF = {filter:"all", sel:null, show:"all", seqKind:"all", who:"all", boardAll:false, seqOff:0, q:"", addingMb:false};
function R(){ return Object.assign({}, DEF, W.U().reach || {}); }
function setR(patch){ W.ui(function(u){ u.reach = Object.assign({}, DEF, u.reach || {}, patch); }); }

var STEP = {first:"First email", fu1:"Follow-up 1 (Day 4)", fu2:"Follow-up 2 (Day 9)", fu3:"Closing email (Step 3)", t1:"Touch 1: Pitch", t2:"Touch 2: Bump (Day 3)", t3:"Touch 3: Social Proof (Day 7)", t4:"Touch 4: Breakup (Day 13)"};
function dayWord(ts){ var n = W.dayDiff(ts); return n === 0 ? "today" : n === 1 ? "tomorrow" : n === -1 ? "yesterday" : W.fmtShort(ts); }
function whenWord(ts){ var n = W.dayDiff(ts); if (n === 0) return "due today"; if (n < 0) return "was due " + (n === -1 ? "yesterday" : (-n) + " days ago"); if (n === 1) return "tomorrow"; if (n < 7) return "in " + n + " days"; return "on " + W.fmtShort(ts); }
function draftOf(ref, reply){ return W.draftsFor(ref).filter(function(q){ return (q.kind === "reply") === reply; })[0] || null; }
function nextStep(o){ return o.seq ? o.seq.steps.filter(function(s){ return s.st === "due" || s.st === "planned"; })[0] || null : null; }
function inToday(key){ W.go("today"); W.ui(function(u){ u.todaySel = key; u.wrap = false; }); }
function shortName(m){ return m.addr.split("@")[0]; }
function failWord(a){
  var bad = a.rows.filter(function(r){ return r.ok === false; })[0];
  return !bad ? "" : bad.k === "top" ? "led outside US/UK/CA/AU" : bad.k === "age" ? "outside buying age" : bad.k === "eng" ? "engagement too low" : "rate missing";
}

W.A.draftFirstEmail = function(cid){
  var c = W.creator(cid); if (!c || W.draftsFor({t:"creator", id:cid}).length) return;
  var qid = null;
  W.act("Drafted the first email to " + c.name, function(d){
    var x = d.creators.filter(function(z){ return z.id === cid; })[0], q = W.makeFirst(x);
    qid = q.id; d.drafts.push(q);
  }, {ref:{t:"creator", id:cid}, toast:{msg:"First email to " + c.name + " drafted", sub:"It waits in Approve emails. Nothing sends until you press Send.", icon:"sparkle", ms:6500, go:{label:"Review", run:function(){ inToday("send:" + qid); }}}});
};
W.A.stopSequence = function(cid){
  var c = W.creator(cid) || W.brand(cid); if (!c || !c.seq) return;
  var isB = !!W.brand(cid);
  var left = c.seq.steps.filter(function(s){ return s.st === "due" || s.st === "planned"; }).length;
  W.act("Stopped the sequence to " + c.name, function(d){
    var x = (isB ? d.brands : d.creators).filter(function(z){ return z.id === cid; })[0];
    x.seq.stopped = "you";
    x.seq.steps = x.seq.steps.filter(function(s){ return s.st === "sent" || s.st === "skipped"; });
    d.drafts = d.drafts.filter(function(q){ return !(q.kind === "followup" && q.to.id === cid); });
  }, {ref:{t:isB ? "brand" : "creator", id:cid}, toast:{msg:"Stopped the sequence to " + c.name, sub:(left ? W.plural(left, "planned follow-up") + " removed. " : "") + "They stay in your pipeline.", icon:"pause", tone:"info", ms:6500}});
};
W.A.setMailboxCap = function(mid, cap){
  var m = W.mailbox(mid); if (!m || m.cap === cap) return;
  W.act("Set " + shortName(m) + "'s daily limit to " + cap, function(d){ d.mail.filter(function(x){ return x.id === mid; })[0].cap = cap; },
    {toast:{msg:shortName(m) + " can send " + cap + " a day", sub:m.sent + " sent so far today.", icon:"gauge", tone:"info", ms:3500}});
};
W.A.setMailboxPaused = function(mid, paused){
  var m = W.mailbox(mid); if (!m) return;
  W.act((paused ? "Paused sending from " : "Resumed sending from ") + shortName(m), function(d){ d.mail.filter(function(x){ return x.id === mid; })[0].paused = paused; },
    {toast:{msg:paused ? shortName(m) + " is paused" : shortName(m) + " is sending again", sub:paused ? "Nothing goes out from it until you resume. Its sends leave today's total." : (m.cap - m.sent) + " sends left today.", icon:paused ? "pause" : "play", tone:"info", ms:6500}});
};
W.A.moveMailboxDrafts = function(fromId){
  var m = W.mailbox(fromId); if (!m) return;
  var live = W.D().mail.filter(function(x){ return x.id !== fromId && !W.mailboxBlocked(x); });
  if (!live.length){ W.toast({msg:"No healthy mailbox has room today", icon:"alert", tone:"warn"}); return; }
  var moved = 0;
  W.act("Moved queued drafts from " + shortName(m) + " to healthy mailboxes", function(d){
    d.drafts.forEach(function(q, i){ if (q.mailbox === fromId){ q.mailbox = live[i % live.length].id; moved++; } });
  }, {toast:{msg:"Moved " + W.plural(moved, "draft") + " to " + live.map(shortName).join(", "), icon:"mail", tone:"good"}});
};
W.A.connectMailbox = function(addr){
  var a = String(addr || "").trim().toLowerCase(); if (!/^\S+@\S+\.\S+$/.test(a)) return;
  var id = W.uid("m");
  W.act("Connected mailbox " + a, function(d){
    d.mail.push({id:id, addr:a, cap:10, sent:0, warm:{done:false, day:1, of:14}, bounce:0, reply:0, inbox:10, status:"warming"});
  }, {toast:{msg:a + " connected", sub:"Starts warming up at 10 sends a day for 14 days.", icon:"mail", tone:"good"}});
};
W.A.testMailbox = function(mid){
  var m = W.mailbox(mid); if (!m) return;
  if (m.paused){ W.toast({msg:shortName(m) + " is paused", sub:"Resume sending first, then send the test.", icon:"alert", tone:"warn", ms:4500}); return; }
  W.toast({msg:"Test email sent from " + shortName(m), sub:m.inbox >= 8 ? "It went to your own address and reached the main inbox." : "It went to your own address and landed in Promotions, not the main inbox.", icon:"mail", tone:"info", ms:5500});
};

function CapSummary(){
  var d = W.D(), live = d.mail.filter(function(m){ return !m.paused && m.status !== "error"; });
  var left = W.sum(live, function(m){ return Math.max(0, m.cap - m.sent); }), cap = W.sum(live, function(m){ return m.cap; }), sent = W.sum(live, function(m){ return Math.min(m.sent, m.cap); });
  var slowed = live.filter(function(m){ return m.status === "slowed"; }).length, paused = d.mail.length - live.length;
  return html`<button type="button" class="rc-cap" onClick=${function(){ W.setTab("mailboxes"); }} data-tip="See each mailbox">
    <span class="col t2" style=${{gap:"0"}}><b>${left}</b><small>sends left today</small></span>
    <span class="col tight" style=${{gap:"4px"}}><${W.Meter} v=${sent} max=${Math.max(cap, 1)} w=${120} tone=${left <= 5 ? "crit" : left <= 15 ? "warn" : null} label="Sends used today" /><small class="num">${sent} of ${cap} used · ${W.plural(live.length, "mailbox", "mailboxes")}</small></span>
    ${slowed ? html`<${Tag} tone="warn" icon="alert">${slowed} slowed</${Tag}>` : null}${paused ? html`<${Tag} icon="pause">${paused} paused</${Tag}>` : null}
  </button>`;
}

/* ================= board ================= */
function boardLanes(who){
  var d = W.D(), L = {todraft:[], waiting:[], seq:[], replied:[], kit:[], signed:[]};
  d.creators.forEach(function(c){
    if (who === "me" && !W.owned(c)) return;
    var ref = {t:"creator", id:c.id}, rq = draftOf(ref, true), oq = draftOf(ref, false), it = {t:"creator", o:c};
    if (rq) L.replied.push(Object.assign({q:rq}, it));
    else if (oq) L.waiting.push(Object.assign({q:oq}, it));
    else if (c.stage === "contact") L.todraft.push(it);
    else if (c.stage === "emailed") L.seq.push(it);
    else if (c.stage === "replied") L.replied.push(it);
    else if (c.stage === "kit") L.kit.push(it);
    else if (c.stage === "signed") L.signed.push(it);
  });
  d.brands.forEach(function(b){
    var ref = {t:"brand", id:b.id}, rq = draftOf(ref, true), oq = draftOf(ref, false);
    if (rq) L.replied.push({t:"brand", o:b, q:rq}); else if (oq) L.waiting.push({t:"brand", o:b, q:oq});
  });
  function lastInAt(it){ var li = W.lastIn({t:it.t, id:it.o.id}); return li ? li.at : 0; }
  L.todraft.sort(W.by(function(it){ return it.o.found; }));
  L.waiting.sort(W.by(function(it){ return it.q.created; }));
  L.seq.sort(W.by(function(it){ var nx = nextStep(it.o); return nx ? nx.at : Infinity; }));
  L.replied.sort(W.by(lastInAt, -1));
  L.kit.sort(W.by(function(it){ return it.o.kit ? it.o.kit.at : 0; }));
  L.signed.sort(W.by(function(it){ return it.o.name; }));
  return [
    {k:"todraft", name:"To draft", hint:"Confirmed, no email yet", items:L.todraft, empty:{title:"Nothing waiting for a draft", text:"Gemini writes the first email as soon as you confirm an address.", act:{label:"Confirm contacts", run:function(){ W.go("find", "contacts"); }}}},
    {k:"waiting", name:"Waiting for you", hint:"Drafted, needs your OK", items:L.waiting, empty:{title:"No emails waiting", text:"New drafts land here. Nothing sends until you press Send.", act:{label:"Confirm contacts", run:function(){ W.go("find", "contacts"); }}}},
    {k:"seq", name:"In sequence", hint:"Sent, waiting on them", items:L.seq, empty:{title:"No sequences running", text:"The first email you send starts one. Follow-ups go out 4 and 9 days later.", act:{label:"Approve emails", run:function(){ W.go("today"); }}}},
    {k:"replied", name:"Replied", hint:"They wrote back", items:L.replied, empty:{title:"No replies to answer", text:"When someone writes back, their reply and Gemini's draft answer appear here."}},
    {k:"kit", name:"Media kit in", hint:"Check audience, then sign", items:L.kit, empty:{title:"No media kits waiting", text:"Ask a creator who replied for their YouTube Studio audience tab."}},
    {k:"signed", name:"Signed", hint:"Ready to pitch to brands", items:L.signed, empty:{title:"No one signed yet", text:"Creators move here once their audience check passes and you sign them."}}
  ];
}
function cardInfo(it, lane){
  var o = it.o, q = it.q, ref = {t:it.t, id:o.id};
  if (lane === "todraft") return {sub:"Address confirmed, no email written yet", chip:html`<${W.Due} ts=${o.found} age=${true} />`, act:{label:"Draft it", run:function(){ W.A.draftFirstEmail(o.id); }}};
  if (lane === "waiting"){
    var g = q.gates.filter(function(x){ return !x.ok; })[0];
    return {sub:W.KIND[q.kind] + (q.n ? " " + q.n + " of 3" : "") + " · " + (g ? W.gateShort(g) : "ready to send"), need:!!g, chip:html`<${W.Due} ts=${q.created} age=${true} />`, act:{label:"Review", run:function(){ inToday(W.itemKeyForDraft(q)); }}};
  }
  if (lane === "seq"){
    var nx = nextStep(o), first = o.seq && o.seq.steps[0];
    if (o.seq && o.seq.stopped) return {sub:"Sequence stopped by you", chip:null};
    return {sub:"Emailed " + (first ? dayWord(first.at) : "earlier") + (nx ? " · next is " + (STEP[nx.k] || nx.k).toLowerCase() : " · sequence finished"), chip:nx ? html`<${W.Due} ts=${nx.at} />` : html`<${Tag}>finished</${Tag}>`, act:!nx ? {label:"Park 60d", run:function(){ W.A.park(o.id, W.at(60), "3-step sequence finished without reply"); }} : null};
  }
  if (lane === "replied"){
    var li = W.lastIn(ref), th = W.threadOf(ref), last = th[th.length - 1], answered = !q && last && last.dir === "out";
    return {sub:answered ? "Answered, waiting for them" : li && li.ai ? W.maskMoney(li.ai.intent) : "Replied", chip:li ? html`<${W.Due} ts=${li.at} age=${true} />` : null, act:q ? {label:"Answer", run:function(){ inToday(W.itemKeyForDraft(q)); }} : null};
  }
  if (lane === "kit"){
    var src = o.kit || o, a = W.audience({countries:src.countries, age:src.age, eng:src.eng || o.eng, rate:src.rate || o.rate});
    return {sub:a.pass ? "Passes your audience rules" : a.fail ? "Fails your rules: " + failWord(a) : "Some numbers are missing", need:a.fail, chip:o.kit ? html`<${W.Due} ts=${o.kit.at} age=${true} />` : null, act:{label:"Check", run:function(){ inToday("audience:" + o.id); }}};
  }
  return {sub:"Rate " + W.money(o.rate) + " · " + W.plural(W.dealsFor(ref).length, "deal"), chip:null};
}
function BoardCard(p){
  var it = p.it, o = it.o, t = it.t, info = cardInfo(it, p.lane), pk = W.U().peek;
  var sel = !!pk && pk.t === t && pk.id === o.id;
  function open(){ W.peek(t, o.id, p.list); }
  return html`<div class="kcard rc-k" role="button" tabindex="0" aria-selected=${sel ? "true" : null} onClick=${open}
    onKeyDown=${function(e){ if (e.target !== e.currentTarget) return; if (e.key === "Enter" || e.key === " "){ e.preventDefault(); open(); } }}>
    <div class="row">${t === "brand" ? html`<${W.BAv} b=${o} size="s" />` : html`<${W.CAv} c=${o} size="s" />`}<b class="grow ell" data-tip=${o.name}>${o.name}</b>${o.owner ? html`<${W.Av} id=${o.owner} size="s" />` : null}</div>
    <span class=${W.cx("rc-sub", info.need ? "need" : null)}>${info.need ? html`<${Icon} n="alert" />` : null}<span>${W.maskMoney(info.sub)}</span></span>
    ${info.chip || info.act ? html`<div class="rc-foot">${info.chip || null}<span class="sp"></span>${info.act ? html`<${Btn} size="sm" kind="ghost" onClick=${function(e){ e.stopPropagation(); info.act.run(); }}>${info.act.label}</${Btn}>` : null}</div>` : null}
  </div>`;
}
function Lane(p){
  var l = p.lane, r = R(), ids = {creator:[], brand:[]};
  l.items.forEach(function(it){ ids[it.t].push(it.o.id); });
  var shown = l.k === "signed" && !r.boardAll ? l.items.slice(0, 6) : l.items;
  return html`<section class="lane" aria-label=${l.name}>
    <div class="lane-h"><span class="grow"><span>${l.name}</span><small>${l.hint}</small></span><span class="m num">${l.items.length}</span></div>
    ${shown.map(function(it){ return html`<${BoardCard} key=${it.t + it.o.id} it=${it} lane=${l.k} list=${ids[it.t]} />`; })}
    ${l.items.length > shown.length ? html`<div class="row wrap"><${Btn} size="sm" kind="ghost" cls="rc-more" onClick=${function(){ setR({boardAll:true}); }}>Show all ${l.items.length}</${Btn}><${Btn} size="sm" kind="ghost" onClick=${function(){ W.go("close", "roster"); }}>Roster →</${Btn}></div>` : null}
    ${!l.items.length ? html`<div class="empty"><b>${l.empty.title}</b><span>${l.empty.text}</span>${l.empty.act ? html`<${Btn} size="sm" onClick=${l.empty.act.run}>${l.empty.act.label}</${Btn}>` : null}</div>` : null}
  </section>`;
}
function Board(){
  var r = R(), lanes = boardLanes(r.who);
  return html`<div class="col">
    <div class="row wrap"><${W.Seg} label="Whose outreach" cur=${r.who} onPick=${function(v){ setR({who:v}); }} opts=${[["all","Everyone","users"],["me","Mine","user"]]} /><span class="sp"></span><span class="small muted">Click any card to open its record beside the board.</span></div>
    <div class="board rc-board" data-why="reach-board">${lanes.map(function(l){ return html`<${Lane} key=${l.k} lane=${l} />`; })}</div>
  </div>`;
}

/* ================= sequences: F7 & System 9 — Both Creators (3-touch) & Brands (4-touch) ================= */
function seqRows(){
  var d = W.D(), rows = [];
  d.creators.filter(function(c){ return c.seq && ["emailed", "replied", "parked"].indexOf(c.stage) >= 0; }).forEach(function(c){
    var nx = nextStep(c), running = c.stage === "emailed" && !c.seq.stopped && !!nx, li = W.lastIn({t:"creator", id:c.id});
    rows.push({t:"creator", o:c, nx:nx, running:running, li:li});
  });
  d.brands.filter(function(b){ return !!b.seq; }).forEach(function(b){
    var nx = nextStep(b), running = !b.seq.stopped && !!nx, li = W.lastIn({t:"brand", id:b.id});
    rows.push({t:"brand", o:b, nx:nx, running:running, li:li});
  });
  rows.sort(function(a, b){
    if (a.running !== b.running) return a.running ? -1 : 1;
    if (a.running) return a.nx.at - b.nx.at;
    return (b.li ? b.li.at : 0) - (a.li ? a.li.at : 0);
  });
  return rows;
}
function seqEvents(row, off){
  off = off || 0;
  var o = row.o, ev = [], raw = [], ref = {t:row.t, id:o.id}, fq = draftOf(ref, false);
  for (var i = 0; i < 29; i++) ev.push([]);
  o.seq.steps.forEach(function(s){
    var dn = W.dayDiff(s.at), lbl = s.label || STEP[s.k] || s.k, when = W.fmtDate(s.at) + " " + W.fmtTime(s.at), type, text;
    if (s.st === "sent"){ type = "sent"; text = lbl + " sent " + when; }
    else if (s.st === "skipped"){ type = "skip"; text = lbl + " skipped (" + W.fmtDate(s.at) + ")"; }
    else if (s.st === "due" || dn <= 0){ type = "due"; text = lbl + (dn < 0 ? " was due " + W.fmtDate(s.at) : " is due today at " + W.fmtTime(s.at)) + (fq ? ". Draft ready" : ""); }
    else { type = "plan"; text = lbl + " planned for " + when; }
    raw.push({i:dn - off + 14, type:type, text:text});
  });
  var li = W.lastIn(ref);
  if (li) raw.push({i:W.dayDiff(li.at) - off + 14, type:"reply", text:"They replied " + W.fmtDate(li.at) + " " + W.fmtTime(li.at) + (li.ai ? ": " + W.maskMoney(li.ai.intent) : "")});
  raw.forEach(function(e){ if (e.i >= 0 && e.i < 29) ev[e.i].push(e); });
  var idx = raw.map(function(e){ return e.i; });
  return {ev:ev, lo:Math.min.apply(null, idx), hi:Math.max.apply(null, idx)};
}
function seqNext(r){
  var o = r.o, s = o.seq, nx = r.nx;
  if (r.t === "creator" && o.stage === "parked") return {text:"Parked until " + W.fmtDate(o.parkUntil), icon:"alarm"};
  if (s.stopped === "replied") return {text:"Stopped: they replied", icon:"reply"};
  if (s.stopped) return {text:"Stopped by you", icon:"pause"};
  if (!nx) return {text:"Sequence finished", icon:"checkc"};
  var due = nx.st === "due" || W.dayDiff(nx.at) <= 0;
  return {text:(nx.label || STEP[nx.k] || nx.k) + " " + whenWord(nx.at), icon:due ? "alarm" : "clock", due:due};
}
function seqMenu(r, ids){
  var o = r.o, ref = {t:r.t, id:o.id}, fq = draftOf(ref, false), rq = draftOf(ref, true);
  var items = [{head:o.name + " (" + (r.t === "brand" ? "4-Touch Brand Sequence" : "3-Touch Creator Sequence") + ")"}];
  if (fq) items.push({label:"Review due follow-up", icon:"send", hint:"In Today", run:function(){ inToday(W.itemKeyForDraft(fq)); }});
  if (rq) items.push({label:"Answer their reply", icon:"reply", hint:"In Today", run:function(){ inToday(W.itemKeyForDraft(rq)); }});
  if (r.t === "creator"){
    items.push({label:"Draft Follow-Up 1 (Day 4)", icon:"mail", run:function(){ W.A.draftCreatorFollowup(o.id, 1); }});
    items.push({label:"Draft Follow-Up 2 (Day 9)", icon:"mail", run:function(){ W.A.draftCreatorFollowup(o.id, 2); }});
    items.push({label:"Draft Step 3 Closing Email (INF-FU-09)", icon:"mail", run:function(){ W.A.draftCreatorFollowup(o.id, 3); }});
  } else {
    items.push({label:"Draft Next Brand Touch (HC-24)", icon:"mail", run:function(){ W.A.nudgeBrand(o.id); }});
  }
  items.push({label:"Open " + o.name, icon:"eye", run:function(){ W.peek(r.t, o.id, ids); }});
  if (!o.seq.stopped && r.nx) items.push({sep:true}, {label:"Stop the sequence", icon:"pause", danger:true, run:function(){ W.A.stopSequence(o.id); }});
  return items;
}
function Sequences(){
  var r = R(), pk = W.U().peek, ref = useRef(null);
  var allRows = seqRows();
  var kindRows = allRows.filter(function(x){ return r.seqKind === "creators" ? x.t === "creator" : r.seqKind === "brands" ? x.t === "brand" : true; });
  var running = kindRows.filter(function(x){ return x.running; }).length;
  var shown = kindRows.filter(function(x){ return r.show === "running" ? x.running : r.show === "stopped" ? !x.running : true; });
  var nCreators = allRows.filter(function(x){ return x.t === "creator"; }).length;
  var nBrands = allRows.filter(function(x){ return x.t === "brand"; }).length;
  useEffect(function(){
    var el = ref.current; if (!el) return;
    var td = el.querySelector(".sq-day.now"), lab = el.querySelector(".sq-l");
    if (td && lab && el.scrollWidth > el.clientWidth + 2) el.scrollLeft = Math.max(0, td.offsetLeft - lab.offsetWidth - td.offsetWidth * 4);
  }, []);
  var off = r.seqOff || 0, days = []; for (var i = -14 + off; i <= 14 + off; i++) days.push(W.at(i));
  var weeks = [];
  days.forEach(function(ts){ if (!weeks.length || new Date(ts).getDay() === 1) weeks.push({ts:ts, n:0}); weeks[weeks.length - 1].n++; });
  var dueToday = kindRows.filter(function(x){ return x.running && W.dayDiff(x.nx.at) <= 0; }).length;
  return html`<div class="col" data-why="reach-sequences">
    <div class="row wrap">
      <${W.Seg} label="Target" cur=${r.seqKind || "all"} onPick=${function(v){ setR({seqKind:v}); }} opts=${[["all", "All (" + allRows.length + ")"], ["creators", "Creators 3-touch (" + nCreators + ")"], ["brands", "Brands 4-touch (" + nBrands + ")"]]} />
      <${W.Seg} label="Show" cur=${r.show} onPick=${function(v){ setR({show:v}); }} opts=${[["all", "All " + kindRows.length], ["running", "Running " + running], ["stopped", "Stopped " + (kindRows.length - running)]]} />
      <div class="row" style=${{gap:"4px"}}><${Btn} size="sm" kind="ghost" icon="chevL" onClick=${function(){ setR({seqOff:off - 14}); }}>2 wk earlier</${Btn}>${off ? html`<${Btn} size="sm" kind="ghost" onClick=${function(){ setR({seqOff:0}); }}>Today</${Btn}>` : null}<${Btn} size="sm" kind="ghost" onClick=${function(){ setR({seqOff:off + 14}); }}>2 wk later<${Icon} n="chevR" /></${Btn}></div>
      <span class="sp"></span>
      <span class="small ink2">${dueToday ? W.plural(dueToday, "follow-up is", "follow-ups are") + " due today. Their drafts wait in Today." : running ? "No follow-up is due today." : "Nothing is running."}</span>
    </div>
    ${shown.length ? html`<div class="sq" ref=${ref} role="table" aria-label="Follow-up timeline, 14 days back and 14 days ahead">
      <div class="sq-in">
        <div class="sq-r sq-hd sq-wkrow" role="row"><div class="sq-l"></div>
          ${weeks.map(function(w, k){ return html`<div key=${k} class=${W.cx("sq-wk", new Date(w.ts).getDay() === 1 ? "mon" : null)} style=${{gridColumn:"span " + w.n}}>${w.n >= 3 ? "Week of " + W.fmtShort(w.ts) : ""}</div>`; })}
          <div class="sq-x"></div></div>
        <div class="sq-r sq-hd" role="row"><div class="sq-l" role="columnheader">Creator / Brand</div>
          ${days.map(function(ts, k){ var dow = new Date(ts).getDay(), isNow = W.dayDiff(ts) === 0;
            return html`<div key=${k} role="columnheader" class=${W.cx("sq-c sq-day", dow === 1 ? "mon" : null, dow === 0 || dow === 6 ? "we" : null, isNow ? "now" : null)} data-tip=${(isNow ? "Today, " : "") + W.fmtDate(ts)}>${["S", "M", "T", "W", "T", "F", "S"][dow]}<b>${new Date(ts).getDate()}</b></div>`; })}
          <div class="sq-x" role="columnheader">Next step</div></div>
        <div class="sq-body">
          ${shown.map(function(row){
            var o = row.o, e = seqEvents(row, off), nx = seqNext(row), sel = !!pk && pk.t === row.t && pk.id === o.id;
            return html`<div key=${row.t + o.id} class="sq-r" role="row" aria-selected=${sel ? "true" : null} onClick=${function(){ W.peek(row.t, o.id); }}>
              <button type="button" class="sq-l" data-tip=${o.name}>${row.t === "brand" ? html`<${W.BAv} b=${o} size="s" />` : html`<${W.CAv} c=${o} size="s" />`}<b>${o.name}</b><span class="tiny muted">${row.t === "brand" ? "4-touch" : "3-touch"}</span></button>
              ${days.map(function(ts, k){
                var evs = e.ev[k], hasLine = e.lo < e.hi && k >= Math.max(e.lo, 0) && k <= Math.min(e.hi, 28), dn = W.dayDiff(ts);
                var line = !hasLine ? null : k === e.lo ? "ln ls" : k === e.hi ? "ln le" : "ln";
                return html`<div key=${k} role="cell" class=${W.cx("sq-c", new Date(ts).getDay() === 1 ? "mon" : null, dn === 0 ? "now" : null, dn > 0 ? "fut" : null, line, evs.length > 1 ? "two" : null)} data-tip=${evs.length ? evs.map(function(x){ return x.text; }).join(" · ") : null}>
                  ${evs.map(function(x, j){ return html`<span key=${j} class=${"sq-d " + x.type} role="img" aria-label=${x.text}>${x.type === "skip" ? html`<${Icon} n="x" />` : null}</span>`; })}</div>`; })}
              <div class="sq-x" role="cell"><span class=${W.cx("nx", nx.due ? "due" : null)} data-tip=${nx.text}><${Icon} n=${nx.icon} /><span>${nx.text}</span></span>
                <button type="button" class="iconbtn" aria-label=${"More actions for " + o.name} onClick=${function(ev){ ev.stopPropagation(); W.menu(ev, seqMenu(row, []), {align:"end"}); }}><${Icon} n="more" /></button></div>
            </div>`; })}
        </div>
      </div>
    </div>
    <div class="sq-leg" aria-label="Legend">
      <span><i class="sq-d sent"></i>Sent</span><span><i class="sq-d due"></i>Due today</span><span><i class="sq-d plan"></i>Planned</span><span><i class="sq-d skip"><${Icon} n="x" /></i>Skipped</span><span><i class="sq-d reply"></i>They replied</span>
      <span><i class="sw"></i>Today</span><span><i class="dash"></i>Still to come</span>
    </div>` : html`<div class="card">${allRows.length
      ? html`<${W.Empty} icon="clock" title="No sequences match" action=${html`<${Btn} size="sm" onClick=${function(){ setR({show:"all", seqKind:"all"}); }}>Show all</${Btn}>`}>Try another filter.</${W.Empty}>`
      : html`<${W.Empty} icon="clock" title="No sequences yet" action=${html`<${Btn} kind="pri" icon="send" onClick=${function(){ W.go("today"); }}>Approve emails in Today</${Btn}>`}>The first email you send starts one. Creator sequences run 3 touches (Days 1, 5, 10) and Brand sequences run 4 touches (Days 1, 4, 8, 14).</${W.Empty}>`}</div>`}
  </div>`;
}

/* ================= replies ================= */
var FILTERS = [["all", "All"], ["needs", "Needs an answer"], ["interested", "Interested"], ["notnow", "Not now"], ["price", "Talks price"]];
function matches(it, f){
  var s = it.intent.toLowerCase(), hasPriceFact = !!(it.li && it.li.ai && (it.li.ai.facts || []).some(function(x){ return x.k === "rate" || x.k === "offer"; }));
  return f === "all" ? true : f === "needs" ? !!it.q : f === "interested" ? /interested/.test(s) : f === "notnow" ? /not now/.test(s) : (/price|pay|rate|offer|\$/.test(s) || hasPriceFact);
}
function inboxItems(){
  var d = W.D(), out = [];
  function add(t, o){
    var ref = {t:t, id:o.id}, th = W.threadOf(ref), li = W.lastIn(ref); if (!li) return;
    out.push({t:t, o:o, ref:ref, li:li, q:draftOf(ref, true), answered:th[th.length - 1].dir === "out", intent:li.ai ? W.maskMoney(li.ai.intent) : "Replied"});
  }
  d.creators.forEach(function(c){ add("creator", c); });
  d.brands.forEach(function(b){ add("brand", b); });
  out.sort(function(a, b){ return (b.q ? 1 : 0) - (a.q ? 1 : 0) || b.li.at - a.li.at; });
  return out;
}
function intentTone(s){ s = s.toLowerCase(); return /interested/.test(s) ? "good" : /counter|offer|kit/.test(s) ? "info" : null; }
function InboxRow(p){
  var it = p.it, o = it.o, short = it.intent.split(" · ")[0];
  return html`<button type="button" class="li" role="option" aria-selected=${String(p.sel)} onClick=${p.onPick}>
    ${it.t === "brand" ? html`<${W.BAv} b=${o} />` : html`<${W.CAv} c=${o} />`}
    <span class="lt"><span class="row" style=${{gap:"6px"}}><b>${o.name}</b><${Tag} tone=${intentTone(it.intent)}>${short}</${Tag}></span><small>${W.maskMoney(it.li.text.split("\n")[0])}</small></span>
    <span class="rt"><${W.Due} ts=${it.li.at} age=${true} /><small class=${it.q ? "go" : null}>${it.q ? "Draft ready" : it.answered ? "Answered" : "Your move"}</small></span>
  </button>`;
}
function Inbox(){
  var r = R(), all = inboxItems(), detail = useRef(null);
  var counts = {}; FILTERS.forEach(function(f){ counts[f[0]] = all.filter(function(it){ return matches(it, f[0]); }).length; });
  var rq = (r.q || "").toLowerCase().trim();
  var list = all.filter(function(it){ return matches(it, r.filter) && (!rq || (it.o.name + " " + it.li.text + " " + it.intent).toLowerCase().indexOf(rq) >= 0); });
  var cur = list.filter(function(it){ return it.t + ":" + it.o.id === r.sel; })[0] || list[0] || null;
  var ids = {creator:[], brand:[]}; list.forEach(function(it){ ids[it.t].push(it.o.id); });
  function pick(it){
    setR({sel:it.t + ":" + it.o.id});
    if (window.innerWidth <= 980 && detail.current && detail.current.scrollIntoView) detail.current.scrollIntoView({block:"start"});
  }
  function move(n){ if (!list.length) return; var j = W.clamp((cur ? list.indexOf(cur) : 0) + n, 0, list.length - 1); setR({sel:list[j].t + ":" + list[j].o.id}); }
  W.useKeys({
    j:function(){ move(1); }, k:function(){ move(-1); }, arrowdown:function(){ move(1); }, arrowup:function(){ move(-1); },
    o:function(){ if (!cur) return false; W.peek(cur.t, cur.o.id, ids[cur.t]); }
  }, true);
  if (!all.length) return html`<div class="card" data-why="reach-inbox"><${W.Empty} icon="inbox" title="No replies yet" action=${html`<${Btn} size="sm" onClick=${function(){ W.setTab("board"); }}>Back to the board</${Btn}>`}>When someone answers an email, their message, Gemini's reading and a drafted answer show up here.</${W.Empty}></div>`;
  var o = cur ? cur.o : null, th = cur ? W.threadOf(cur.ref) : [], last = th[th.length - 1];
  return html`<div class="split rc-in" data-why="reach-inbox">
    <div class="card queue" role="listbox" aria-label="Replies">
      <div style=${{padding:"6px 6px 2px"}}><input class="inp sm" placeholder="Search replies…" value=${r.q || ""} onInput=${function(e){ setR({q:e.target.value}); }} aria-label="Search replies" /></div>
      <div class="rc-filters">${FILTERS.map(function(f){ return html`<button key=${f[0]} type="button" class="chip" aria-pressed=${String(r.filter === f[0])} onClick=${function(){ setR({filter:f[0]}); }}>${f[1]} <span class="c">${counts[f[0]]}</span></button>`; })}</div>
      ${list.map(function(it){ return html`<${InboxRow} key=${it.t + it.o.id} it=${it} sel=${cur === it} onPick=${function(){ pick(it); }} />`; })}
      ${!list.length ? html`<div class="empty"><b>Nothing here</b><span>No reply matches "${(FILTERS.filter(function(f){ return f[0] === r.filter; })[0] || [0, ""])[1]}".</span><${Btn} size="sm" onClick=${function(){ setR({filter:"all"}); }}>Show all replies</${Btn}></div>` : null}
    </div>
    <div class="work" ref=${detail}>
      ${cur ? html`<${W.Fragment}>
        <div class="work-h">
          ${cur.t === "brand" ? html`<${W.BAv} b=${o} size="l" />` : html`<${W.CAv} c=${o} size="l" />`}
          <div class="wt"><h2>${o.name}</h2><span class="small ink2 row wrap" style=${{gap:"8px"}}><span>${cur.t === "brand" ? o.sells : o.handle}</span>${cur.t === "brand" ? html`<${Tag} hue="var(--close)">${o.status}</${Tag}>` : html`<${Tag} hue="var(--reach)">${W.STAGE_LABEL[o.stage]}</${Tag}>`}</span></div>
          <${Btn} size="sm" kind="ghost" icon="eye" onClick=${function(){ W.peek(cur.t, o.id, ids[cur.t]); }} tip="Open the record beside this" kbd="O">Open record</${Btn}>
        </div>
        <div class="card"><div class="card-h"><h3>Conversation</h3><span class="small muted">${W.plural(th.length, "email")}</span></div><${W.Thread} key=${cur.t + o.id} refx=${cur.ref} limit=${6} /></div>
        ${cur.q ? html`<${W.DraftCard} key=${cur.q.id} q=${cur.q} primary=${true} />`
          : cur.answered ? html`<${W.Callout} icon="clock" right=${html`<${Btn} size="sm" icon="send" onClick=${function(){ W.act("Drafted a follow-up to " + o.name, function(d){ d.drafts.push({id:W.uid("q"), kind:"reply", to:cur.ref, mailbox:"m1", created:W.now(), subject:"Re: our conversation", body:"Hi " + (o.contact ? o.contact.split(" ")[0] : "there") + ",\n\nChecking back in on this — let me know if you had a chance to look!\n\nMoustafa", why:"Follow-up on an answered thread.", rules:["INF-FU-03"], gates:[]}); }); }}>Write follow-up</${Btn}>`}><b style=${{fontWeight:600}}>Answered. Waiting for them.</b> You wrote back ${W.ago(last.at)}. It comes back to Today when they reply.</${W.Callout}>`
          : html`<${W.NextCard} refx=${cur.ref} />`}
      </${W.Fragment}>` : html`<div class="card"><${W.Empty} icon="inbox" title="Pick a reply to read">The conversation and the drafted answer open here.</${W.Empty}></div>`}
    </div>
  </div>`;
}

/* ================= mailboxes ================= */
function MailCard(p){
  var m = p.m, d = W.D(), name = shortName(m), left = Math.max(0, m.cap - m.sent);
  var queued = d.drafts.filter(function(q){ return q.mailbox === m.id; }).length;
  var capMax = m.status === "good" ? 60 : 20, capMin = Math.max(5, Math.ceil(m.sent / 5) * 5);
  var tag = m.status === "error" ? html`<${Tag} tone="crit" icon="alert">Signed out</${Tag}>` : m.paused ? html`<${Tag} icon="pause">Paused</${Tag}>` : m.status === "good" ? html`<${Tag} tone="good" icon="check">Healthy</${Tag}>` : m.status === "warming" ? html`<${Tag} tone="info" icon="timer">Warming up</${Tag}>` : html`<${Tag} tone="warn" icon="alert">Slowed</${Tag}>`;
  var bTone = m.bounce >= 3 ? "crit" : m.bounce >= 2 ? "warn" : null, iTone = m.inbox < 7 ? "crit" : m.inbox < 9 ? "warn" : null;
  return html`<div class="card" style=${{opacity:m.paused ? .78 : 1}}>
    <div class="card-h"><h3 class="mono ell" style=${{fontSize:".95rem"}}>${m.addr}</h3>${tag}</div>
    ${m.note ? html`<div class="gate"><${Icon} n="alert" /><span class="grow">${m.err ? html`<b style=${{fontWeight:600}}>${m.err}.</b> ` : null}${m.note}</span>${m.status === "error" ? html`<${Btn} size="sm" kind="pri" icon="mail" onClick=${function(){ W.A.reconnectMailbox(m.id); }}>Sign in again</${Btn}>` : null}</div>` : null}
    <div class="col tight" style=${{gap:"8px"}}>
      <div class="rc-mrow"><span class="ink2">Sent today</span><${W.Meter} v=${m.sent} max=${m.cap} w="100%" tone=${m.paused ? null : left <= 3 ? "crit" : left <= 8 ? "warn" : null} label=${name + " sends used"} /><span class="num">${m.sent} of ${m.cap}</span></div>
      <div class="rc-mrow"><span class="ink2">Warm-up</span>${m.warm.done ? html`<span class="muted">Finished, running for ${m.warm.day} days</span><span></span>` : html`<${W.Meter} v=${m.warm.day} max=${m.warm.of} w="100%" label="Warm-up progress" /><span class="num">day ${m.warm.day} of ${m.warm.of}</span>`}</div>
    </div>
    <div class="rc-mstats">
      <div class=${W.cx("rc-ms", bTone)} data-tip="Share of emails that bounced this week. Over 3% slows the mailbox."><b>${m.bounce}%</b><small>Bounces</small></div>
      <div class="rc-ms"><b>${m.reply}%</b><small>Replies</small></div>
      <div class=${W.cx("rc-ms", iTone)} data-tip="Of 10 test emails, how many reached the main inbox"><b>${m.inbox}/10</b><small>Inbox placement</small></div>
    </div>
    <div class="row wrap" style=${{gap:"10px"}}>
      <span class="ink2" style=${{fontSize:"12.5px"}}>Daily limit</span>
      <div class="seg" role="group" aria-label=${"Daily limit for " + name}>
        <button type="button" aria-label="Lower the daily limit by 5" disabled=${m.cap <= capMin} onClick=${function(){ W.A.setMailboxCap(m.id, Math.max(capMin, m.cap - 5)); }} data-tip=${m.cap <= capMin ? "Already " + m.sent + " sent today" : null}><${Icon} n="minus" s=${14} /></button>
        <span class="rc-step" style=${{alignSelf:"center"}}>${m.cap}</span>
        <button type="button" aria-label="Raise the daily limit by 5" disabled=${m.cap >= capMax} onClick=${function(){ W.A.setMailboxCap(m.id, Math.min(capMax, m.cap + 5)); }} data-tip=${m.cap >= capMax ? (m.status === "good" ? "60 a day is the most we allow" : m.status === "slowed" ? "Held at 20 until bounces are under 2%" : "Held at 20 until warm-up ends") : null}><${Icon} n="plus" s=${14} /></button>
      </div>
    </div>
    ${m.status === "slowed" ? html`<span class="hint">Goes back to ${m.capNormal} a day once bounces are under 2%.</span>` : m.status === "warming" ? html`<span class="hint">Capped at ${capMax} a day until warm-up ends.</span>` : null}
    <div class="row wrap">
      <${Btn} size="sm" icon="mail" onClick=${function(){ W.A.testMailbox(m.id); }}>Send a test</${Btn}>
      <${Btn} size="sm" kind=${m.paused ? "pri" : null} icon=${m.paused ? "play" : "pause"} onClick=${function(){ W.A.setMailboxPaused(m.id, !m.paused); }}>${m.paused ? "Resume sending" : "Pause sending"}</${Btn}>
      <span class="sp"></span>
      ${queued ? html`<span class="row wrap" style=${{gap:"6px"}}><span class="small muted num">${W.plural(queued, "draft")} will send from here</span>${(m.paused || m.status === "error") ? html`<${Btn} size="sm" kind="ghost" onClick=${function(){ W.A.moveMailboxDrafts(m.id); }}>Move to healthy mailbox</${Btn}>` : null}</span>` : null}
    </div>
  </div>`;
}
function Mailboxes(){
  var d = W.D(), r = R(), slowed = d.mail.filter(function(m){ return m.status === "slowed"; }), addr = W.useState("");
  return html`<div class="col" data-why="reach-mailboxes">
    <${W.Callout} icon="gauge" right=${html`<${Btn} size="sm" icon="plus" onClick=${function(){ setR({addingMb:!r.addingMb}); }}>Connect a mailbox</${Btn}>`}><b style=${{fontWeight:600}}>Bounces over 3% slow a mailbox down on its own.</b> It drops to 20 sends a day and goes back to its normal limit once bounces are under 2%. Fewer bounces protect every address you send from.${slowed.length ? " Right now " + slowed.map(function(m){ return shortName(m) + " (" + m.bounce + "%)"; }).join(" and ") + " is slowed." : ""}</${W.Callout}>
    ${r.addingMb ? html`<div class="card tight"><div class="row wrap"><input class="inp sm mono" style=${{width:"260px"}} placeholder="outreach4@gratovo.co" value=${addr[0]} onInput=${function(e){ addr[1](e.target.value); }} aria-label="New mailbox address" /><${Btn} size="sm" kind="pri" icon="check" disabled=${!/^\S+@\S+\.\S+$/.test(addr[0])} onClick=${function(){ W.A.connectMailbox(addr[0]); addr[1](""); setR({addingMb:false}); }}>Connect & start warm-up</${Btn}><${Btn} size="sm" kind="ghost" onClick=${function(){ setR({addingMb:false}); }}>Cancel</${Btn}></div></div>` : null}
    <div class="rc-mgrid">${d.mail.map(function(m){ return html`<${MailCard} key=${m.id} m=${m} />`; })}</div>
  </div>`;
}

/* ================= screen ================= */
W.screens.reach = function(){
  var st = W.useApp(), u = st.ui, d = st.data;
  var tabs = W.SCREENS.reach.tabs, tab = u.route.tab;
  if (!tabs.some(function(t){ return t[0] === tab; })) tab = "board";
  var replyN = d.drafts.filter(function(q){ return q.kind === "reply"; }).length;
  var fuN = d.drafts.filter(function(q){ return q.kind === "followup"; }).length;
  var sendN = d.drafts.length - replyN - fuN;
  var running = seqRows().filter(function(x){ return x.running; }).length;
  var parts = [];
  if (sendN) parts.push(W.plural(sendN, "email") + " to approve");
  if (fuN) parts.push(W.plural(fuN, "follow-up") + " due today");
  if (replyN) parts.push(W.plural(replyN, "reply", "replies") + " to answer");
  var sub = parts.length ? parts.join(", ").replace(/, ([^,]*)$/, " and $1") + ". Nothing leaves until you press Send." : "Nothing is waiting. New replies and due follow-ups show up here first.";
  var tabList = tabs.map(function(t){ return [t[0], t[1], t[0] === "sequences" ? running || null : t[0] === "inbox" ? replyN || null : null]; });
  return html`<div class="page">
    <${W.PageHead} title="Reach out" sub=${sub} right=${html`<${CapSummary} />`} />
    <${W.Tabs} tabs=${tabList} cur=${tab} onPick=${W.setTab} hue="var(--reach)" />
    ${tab === "board" ? html`<${Board} />` : tab === "sequences" ? html`<${Sequences} />` : tab === "inbox" ? html`<${Inbox} />` : html`<${Mailboxes} />`}
  </div>`;
};
})();
