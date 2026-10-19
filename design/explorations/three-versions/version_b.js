/* Version B · Today: the app opens on one list of next actions for this person. Each item opens a work panel
   with exactly what that action needs, and the next item opens when it is done. Records are for lookups. */
(function(){
"use strict";
var esc = P.esc, K = "b";
var d = P.seed();
var s = {screen:"today", sel:null, findsTable:false, fi:0, tsel:{}, rec:null, filter:"all", pitchSel:{}};
var stage = null;
var ctx = {d:d, render:render, palette:palette, openConversation:function(kind,id){ s.screen = kind==="brand"?"brands":"creators"; s.rec = id; render(); }, openQueue:function(){ s.screen="today"; s.sel=null; render(); },
  openCreator:function(id){ s.screen="creators"; s.rec=id; render(); window.scrollTo(0,0); },
  showFinds:function(f){ P.TB.setFilter(ctx, f); s.screen="creators"; s.rec=null; render(); window.scrollTo(0,0); }};
P.TB.bind(K, ctx);

function newFinds(){ return d.creators.filter(function(c){ return c.stage==="new"; }); }
function items(){
  var out = [], drafted = {};
  d.drafts.forEach(function(q){ drafted[q.who] = true; });
  function add(g, key, title, sub, due, urgent){ out.push({g:g, key:key, title:title, sub:sub, due:due||"", urgent:!!urgent}); }
  d.drafts.filter(function(q){ return q.kind==="reply"; }).forEach(function(q){ var w = P.who(d,q); add("Answer replies","q:"+q.id, (q.brand?w.name:w.handle)+" replied", q.brand?"Brand · counter-offer on price":"Asked what sponsors pay", q.age, true); });
  d.drafts.filter(function(q){ return ["first","pitch","upsell"].indexOf(q.kind)>=0; }).forEach(function(q){ var w = P.who(d,q); add("Approve drafts","q:"+q.id, P.KIND[q.kind]+" to "+(q.brand?w.name:w.handle), q.gates.length?"Needs you: "+q.gates[0].what:"Ready to send", q.age); });
  d.drafts.filter(function(q){ return q.kind==="followup"; }).forEach(function(q){ add("Follow-ups due","q:"+q.id, "Follow-up "+q.n+" of 3 to "+P.who(d,q).handle, "No reply since 14 Oct", "today"); });
  d.deals.filter(function(x){ return x.step<P.DEAL_FLOW.length-1 || !x.checks.every(Boolean); }).forEach(function(x){ add("Deal steps","d:"+x.id, P.dealLine(d,x).replace(/&amp;/g,"&")+" · "+P.DEAL_FLOW[x.step].name, "Next: "+P.nextAction(x), x.step===6?"invoice":x.step===7?"report due":"", x.step>=6); });
  if (newFinds().length) add("Review new finds","finds", newFinds().length+" new channels from this morning's search", "Shortlist or reject, one at a time", "");
  d.creators.filter(function(c){ return c.stage==="shortlisted" && !(c.email&&c.confirmed) && !drafted[c.id]; }).forEach(function(c){ add("Get contacts","c:"+c.id, "Confirm "+c.handle+"'s email", c.email?"Found automatically, not confirmed":"No email yet", ""); });
  d.creators.filter(function(c){ return c.stage==="shortlisted" && c.email && c.confirmed && !drafted[c.id]; }).forEach(function(c){ add("Write first emails","w:"+c.id, "First email to "+c.handle, "Contact confirmed, ready to draft", ""); });
  d.creators.filter(function(c){ return c.stage==="mediakit"; }).forEach(function(c){ add("Check audiences","k:"+c.id, "Check "+c.handle+"'s audience", "Media kit received 16 Oct", ""); });
  d.brands.filter(function(b){ return b.status==="found"; }).forEach(function(b){ add("Brands","bq:"+b.id, "Qualify "+b.name, "Seen sponsoring "+b.seen.length+" of your creators", ""); });
  d.brands.filter(function(b){ return b.status==="qualified" && !drafted[b.id]; }).forEach(function(b){ add("Brands","bp:"+b.id, "Pitch creators to "+b.name, "Qualified · "+b.budget, ""); });
  return out;
}
var GROUPS = ["Answer replies","Approve drafts","Follow-ups due","Deal steps","Review new finds","Get contacts","Write first emails","Check audiences","Brands"];

function render(){
  var list = items();
  if (s.screen==="today" && (!s.sel || !list.some(function(i){ return i.key===s.sel; }))) s.sel = list.length ? list[0].key : null;
  ctx.tbVisible = {search:"search", insights:"insights", tools:"tools"}[s.screen] || (s.screen==="creators" && !s.rec ? "gallery" : "");
  stage.innerHTML = '<div class="app"><nav class="rail" aria-label="Sections">'+
    ri("today","Today","Your next actions", list.length)+ri("search","Search",P.TB.running(ctx)?"Running…":"Find new channels")+ri("creators","Creators","Gallery and records")+ri("brands","Brands","")+ri("deals","Deals","")+ri("insights","Insights","Analytics and keywords")+ri("tools","Toolbox","Calculator, archive, setup")+ri("team","Team","People and mailboxes")+
    '<span class="grow"></span>'+ri("settings","Settings","")+'</nav>'+
    '<div class="work"><div class="bar">'+P.searchBox()+P.statusPills()+'<span class="sp"></span><span class="tag pri">Focus block 1 of 2 · '+d.focusLeft+' left</span><span class="ink2 num" style="font-size:13px">Emails <b>'+d.sent+'</b> / '+d.target+'</span></div>'+
    '<div class="page">'+(s.screen==="today"?pToday(list):s.screen==="creators"?pCreators():s.screen==="search"?P.TB.searchConsole(ctx):s.screen==="insights"?P.TB.insights(ctx):s.screen==="tools"?P.TB.tools(ctx):s.screen==="brands"?pBrands():s.screen==="deals"?pDeals():s.screen==="team"?pTeam():pSettings())+'</div></div></div>';
}
function ri(k, label, sub, n){ return '<button class="ri" type="button" data-scr="'+k+'" aria-current="'+(s.screen===k)+'"><span class="ic">'+label[0]+'</span><span>'+esc(label)+(sub?'<span class="sub">'+esc(sub)+'</span>':'')+'</span>'+(n?'<span class="cnt">'+n+'</span>':'')+'</button>'; }

/* ---- Today ---- */
function pToday(list){
  var done = 9 - Math.min(9, list.length);
  var h = '<div class="ph"><div class="col" style="gap:2px"><h2>Today</h2><p>'+list.length+' things need you. Work down the list; the next one opens when you finish. <span class="kbd">J</span> <span class="kbd">K</span> to move.</p></div></div>';
  h += '<div style="display:grid; grid-template-columns:minmax(260px,340px) minmax(0,1fr); gap:16px; align-items:start" class="b-split">';
  h += '<div class="card" style="padding:8px; gap:2px; position:sticky; top:120px; max-height:calc(100vh - 150px); overflow-y:auto" role="listbox" aria-label="Next actions">';
  GROUPS.forEach(function(g){
    var gi = list.filter(function(i){ return i.g===g; }); if (!gi.length) return;
    h += '<div class="rh" style="font:700 11px var(--f-mono); text-transform:uppercase; letter-spacing:.07em; color:var(--muted); padding:10px 8px 4px; display:flex">'+esc(g)+'<span class="sp"></span>'+gi.length+'</div>';
    gi.forEach(function(i){ h += '<button type="button" role="option" class="ri" data-item="'+i.key+'" aria-selected="'+(s.sel===i.key)+'" aria-current="'+(s.sel===i.key)+'" style="align-items:flex-start"><span class="ic" style="'+(i.urgent?'background:var(--rose); color:#fff':'')+'">'+esc(g[0])+'</span><span style="min-width:0">'+esc(i.title)+'<span class="sub">'+esc(i.sub)+'</span></span>'+(i.due?'<span class="tag" style="margin-left:auto">'+esc(i.due)+'</span>':'')+'</button>'; });
  });
  if (!list.length) h += '<p class="hint" style="padding:12px">All clear. Nothing else needs you today.</p>';
  h += '</div><div class="col" style="gap:14px">'+(s.sel ? work(s.sel) : '<div class="card"><h3>Nothing left</h3><p>Every reply, draft and deal step for today is done.</p></div>')+'</div></div>';
  return h+'<style>@media (max-width:900px){ .b-split{grid-template-columns:1fr !important} .b-split > .card{position:static !important; max-height:none !important} }</style>';
}
function snapshot(c){ return '<div class="card"><div class="row">'+P.avatar(c.name,3)+'<div class="col" style="gap:0"><b>'+esc(c.name)+'</b><span class="muted" style="font-size:12.5px">'+esc(c.handle)+' · '+P.fmtK(c.subs)+' subs</span></div><span class="sp"></span><button class="btn sm ghost" type="button" data-rec="'+c.id+'">Open record</button></div>'+P.journey(P.CREATOR_STEPS, P.STAGE_STEP[c.stage])+P.signals(c)+P.statsKv(c)+'</div>'; }
function work(key){
  var p = key.split(":"), t = p[0], id = p[1];
  if (t==="q"){
    var q = P.draft(d,id); if (!q) return "";
    var w = P.who(d,q);
    return '<div class="ph"><h2 style="font-size:1.2rem">'+esc(P.KIND[q.kind])+(q.n?' '+q.n+' of 3':'')+' · '+esc(q.brand?w.name:w.handle)+'</h2></div>'+
      ((d.threads[q.who]||[]).length ? '<div class="card"><h3>'+(q.kind==="reply"?'Their message':'Conversation so far')+'</h3>'+P.threadHtml(d,q.who,q.kind==="reply"?2:3)+'</div>' : '')+
      P.draftCard(d,q,{noOpen:true})+(q.brand ? '<div class="card"><h3>'+esc(w.name)+'</h3><dl class="kv"><dt>Sells</dt><dd>'+esc(w.sells)+'</dd><dt>Budget</dt><dd>'+esc(w.budget)+'</dd><dt>Contact</dt><dd>'+esc(w.contact)+'</dd></dl></div>' : snapshot(w));
  }
  if (t==="finds") return finds();
  if (t==="c"){ var c = P.creator(d,id); return '<div class="ph"><h2 style="font-size:1.2rem">Confirm '+esc(c.handle)+'\'s contact</h2></div><div class="card">'+P.contactsBlock(c)+'</div>'+snapshot(c); }
  if (t==="w"){ var c2 = P.creator(d,id); return '<div class="ph"><h2 style="font-size:1.2rem">First email to '+esc(c2.handle)+'</h2></div><div class="card"><p>The draft uses a moment from their latest video and takes about a minute.</p><div class="row"><button class="btn pri" type="button" data-act="draft-first" data-id="'+c2.id+'">Draft it</button></div></div>'+snapshot(c2); }
  if (t==="k"){ var c3 = P.creator(d,id); return '<div class="ph"><h2 style="font-size:1.2rem">Check '+esc(c3.handle)+'\'s audience</h2></div><div class="card">'+P.audienceCheck(c3)+'<div class="row"><button class="btn pri" type="button" data-act="sign" data-id="'+c3.id+'">Everything passes: mark signed</button><button class="btn" type="button" data-toast="A reply asking for the missing numbers would be drafted (example).">Ask for what is missing</button></div></div><div class="card"><h3>Their media kit message</h3>'+P.threadHtml(d,c3.id,1)+'</div>'; }
  if (t==="bq"){ var b = P.brand(d,id); return '<div class="ph"><h2 style="font-size:1.2rem">Qualify '+esc(b.name)+'</h2></div><div class="card"><dl class="kv"><dt>Sells</dt><dd>'+esc(b.sells)+'</dd><dt>Country</dt><dd>'+esc(b.country)+'</dd><dt>Budget</dt><dd>'+esc(b.budget)+'</dd><dt>Seen with</dt><dd>'+esc(b.seen.map(function(x){ return P.creator(d,x).handle; }).join(", "))+'</dd><dt>Contact</dt><dd>'+esc(b.contact||"none yet")+'</dd></dl><label class="field">Contact email<input class="input" id="b-bq-'+b.id+'" placeholder="name@'+esc(b.name.toLowerCase())+'.com"></label><div class="row"><button class="btn pri" type="button" data-bq="'+b.id+'">Qualified</button><button class="btn" type="button" data-bnot="'+b.id+'">Not a fit</button></div></div>'; }
  if (t==="bp"){ var b2 = P.brand(d,id), rc = d.creators.filter(P.ready), n = Object.keys(s.pitchSel).filter(function(k){ return s.pitchSel[k]; }).length;
    return '<div class="ph"><h2 style="font-size:1.2rem">Pitch creators to '+esc(b2.name)+'</h2></div><div class="card"><p class="hint">Pick one or two signed creators. '+esc(b2.name)+' sells '+esc(b2.sells)+' in '+esc(b2.country)+'.</p><ul class="checks">'+
      rc.map(function(c){ return '<li class="'+(s.pitchSel[c.id]?'done':'')+'"><button class="tick" type="button" data-psel="'+c.id+'" aria-pressed="'+!!s.pitchSel[c.id]+'" aria-label="Pick '+esc(c.handle)+'"'+(!s.pitchSel[c.id]&&n>=2?' disabled':'')+'>'+(s.pitchSel[c.id]?'✓':'')+'</button><span class="t">'+esc(c.name)+'<small>'+P.fmtK(c.median)+' median · '+esc(c.top)+' · '+P.money(c.rate)+'</small></span></li>'; }).join("")+
      '</ul><div class="row"><button class="btn pri" type="button" data-dopitch="'+b2.id+'"'+(n?'':' disabled')+'>Draft the pitch</button></div></div>'; }
  if (t==="d"){ var x = P.deal(d,id); return '<div class="ph"><h2 style="font-size:1.2rem">'+P.dealLine(d,x)+'</h2><span class="sp"></span><span class="muted">'+P.money(x.price)+' → '+P.money(x.payout)+' · '+esc(x.terms||"terms not set")+'</span></div><div class="card">'+P.journey(P.DEAL_FLOW.map(function(f){ return f.name; }), x.step)+'<h3>'+esc(P.DEAL_FLOW[x.step].name)+'</h3>'+P.dealChecklist(d,x)+'</div>'; }
  return "";
}
function finds(){
  var list = newFinds();
  if (!list.length) return '<div class="card"><h3>All new finds reviewed</h3></div>';
  if (s.fi>=list.length) s.fi = 0;
  var head = '<div class="ph"><h2 style="font-size:1.2rem">Review new finds</h2><span class="sp"></span><button class="chip" type="button" data-ftable aria-pressed="'+s.findsTable+'">See as a table</button><button class="btn sm" type="button" data-bgal>Open as gallery</button></div>';
  if (s.findsTable){
    var sel = Object.keys(s.tsel).filter(function(k){ return s.tsel[k]; });
    return head+'<div class="tw"><table><thead><tr><th><span class="sr">Select</span></th><th>Channel</th><th>Median</th><th>Uploads 30 d</th><th>Sponsors</th><th>Email</th></tr></thead><tbody>'+list.map(function(c){ return '<tr class="'+(s.tsel[c.id]?'sel':'')+'"><td><input type="checkbox" data-tsel="'+c.id+'"'+(s.tsel[c.id]?' checked':'')+' aria-label="Select '+esc(c.handle)+'"></td><td class="who"><b>'+esc(c.name)+'</b><span>'+esc(c.handle)+'</span></td><td class="num">'+P.fmtK(c.median)+'</td><td class="num">'+c.up30+'</td><td>'+esc(c.sponsors.join(", ")||"none")+'</td><td>'+(c.email?'<span class="tag warn">found</span>':'<span class="tag crit">none</span>')+'</td></tr>'; }).join("")+'</tbody></table></div>'+
      (sel.length?'<div class="bulk"><b>'+sel.length+' selected</b><button class="btn pri sm" type="button" data-tbulk="short">Shortlist</button><button class="btn sm" type="button" data-tbulk="rej">Reject</button></div>':'');
  }
  var c = list[s.fi];
  return head+'<div class="card" style="gap:14px"><div class="row"><span class="mono muted">'+(s.fi+1)+' of '+list.length+'</span><span class="sp"></span><span class="hint"><span class="kbd">S</span> shortlist · <span class="kbd">R</span> reject · <span class="kbd">→</span> skip</span></div>'+
    '<div class="row">'+P.avatar(c.name,5)+'<div class="col" style="gap:0"><h3 style="font-size:1.3rem">'+esc(c.name)+'</h3><span class="muted">'+esc(c.handle)+' · '+P.fmtK(c.subs)+' subscribers</span></div></div>'+P.signals(c)+P.statsKv(c)+
    '<div class="row"><button class="btn pri" type="button" data-tri="short">Shortlist</button><select class="btn" id="b-rr" aria-label="Reject reason"><option>Irrelevant</option><option>Inactive</option><option>Low views</option><option>Out of scope</option></select><button class="btn" type="button" data-tri="rej">Reject</button><button class="btn ghost" type="button" data-tri="skip">Skip</button></div></div>';
}
function triage(a){
  var list = newFinds(); if (!list.length) return; var c = list[s.fi % list.length];
  if (a==="short"){ P.shortlist(K,d,[c.id]); P.toast(c.handle+" shortlisted. A \"Get contacts\" item was added."); }
  else if (a==="rej"){ var r = document.getElementById("b-rr"); P.reject(K,d,[c.id]); P.toast(c.handle+" rejected ("+(r?r.value:"Irrelevant")+").", "Undo", function(){ c.stage = "new"; render(); }); }
  else s.fi++;
  render();
}

/* ---- lookups ---- */
function pCreators(){
  if (s.rec && P.creator(d,s.rec)) return creatorRec(P.creator(d,s.rec));
  return P.TB.gallery(ctx, {title:"Creators"});
  var f = [["all","All"],["new","New"],["shortlisted","Shortlisted"],["emailed","Emailed"],["replied","Replied"],["signed","Signed"]];
  var list = d.creators.filter(function(c){ return s.filter==="all" ? c.stage!=="rejected" : c.stage===s.filter; });
  return '<div class="ph"><h2>Creators</h2><span class="sp"></span><span class="hint">For lookups. Daily work happens in Today.</span></div><div class="row">'+f.map(function(x){ return '<button class="chip" type="button" data-cf="'+x[0]+'" aria-pressed="'+(s.filter===x[0])+'">'+x[1]+'</button>'; }).join("")+'</div>'+
    '<div class="tw"><table><thead><tr><th>Creator</th><th>Step</th><th>Median</th><th>Email</th><th>Owner</th></tr></thead><tbody>'+list.map(function(c){ return '<tr data-rec="'+c.id+'"><td class="who"><b>'+esc(c.name)+'</b><span>'+esc(c.handle)+'</span></td><td><span class="tag">'+esc(P.CREATOR_STEPS[P.STAGE_STEP[c.stage]])+'</span></td><td class="num">'+P.fmtK(c.median)+'</td><td>'+(c.email?(c.confirmed?'<span class="tag good">confirmed</span>':'<span class="tag warn">found</span>'):'<span class="tag crit">none</span>')+'</td><td>'+esc(c.owner||"nobody")+'</td></tr>'; }).join("")+'</tbody></table></div>';
}
function creatorRec(c){
  return '<div class="row"><button class="btn sm ghost" type="button" data-back>← Creators</button></div><div class="ph"><h2>'+esc(c.name)+'</h2><span class="muted">'+esc(c.handle)+'</span></div>'+P.journey(P.CREATOR_STEPS,P.STAGE_STEP[c.stage])+
    '<div class="grid2"><div class="card"><h3>Profile</h3>'+P.signals(c)+P.statsKv(c)+'</div><div class="col" style="gap:14px"><div class="card"><h3>Contact</h3>'+P.contactsBlock(c)+'</div><div class="card"><h3>Audience</h3>'+P.audienceCheck(c)+'</div></div></div><div class="card"><h3>Conversation</h3>'+P.threadHtml(d,c.id)+'</div>';
}
function pBrands(){
  if (s.rec && P.brand(d,s.rec)){ var b = P.brand(d,s.rec); return '<div class="row"><button class="btn sm ghost" type="button" data-back>← Brands</button></div><div class="ph"><h2>'+esc(b.name)+'</h2><span class="muted">'+esc(b.sells)+'</span></div><div class="card"><h3>Conversation</h3>'+P.threadHtml(d,b.id)+'</div>'; }
  return '<div class="ph"><h2>Brands</h2></div><div class="tw"><table><thead><tr><th>Brand</th><th>Status</th><th>Budget</th><th>Seen with</th></tr></thead><tbody>'+d.brands.map(function(b){ return '<tr data-brec="'+b.id+'"><td class="who"><b>'+esc(b.name)+'</b><span>'+esc(b.sells)+'</span></td><td><span class="tag">'+esc(b.status)+'</span></td><td>'+esc(b.budget)+'</td><td>'+b.seen.length+' creators</td></tr>'; }).join("")+'</tbody></table></div>';
}
function pDeals(){
  return '<div class="ph"><h2>Deals</h2><span class="sp"></span><button class="btn" type="button" data-toast="New deal form (example).">New deal</button></div><div class="tw"><table><thead><tr><th>Deal</th><th>Step</th><th>Next</th><th>Value</th><th>Owner</th></tr></thead><tbody>'+d.deals.map(function(x){ return '<tr data-dl="'+x.id+'"><td><b>'+P.dealLine(d,x)+'</b></td><td><span class="tag">'+esc(P.DEAL_FLOW[x.step].name)+'</span></td><td>'+esc(P.nextAction(x))+'</td><td class="num">'+P.money(x.price)+'</td><td>'+esc(x.owner)+'</td></tr>'; }).join("")+'</tbody></table></div>';
}
function pTeam(){
  var ppl = [["You",14,"full"],["Sara",9,"full"],["Omar",6,"basic (VA): finds, contacts, follow-ups only"]];
  return '<div class="ph"><h2>Team</h2></div><div class="grid2">'+ppl.map(function(p){ return '<div class="card"><div class="row">'+P.avatar(p[0],p[1])+'<b>'+esc(p[0])+'</b><span class="sp"></span><span class="tag">'+esc(p[2])+'</span></div><p><b class="num">'+p[1]+'</b> items in their Today</p><div class="row"><button class="btn sm" type="button" data-toast="Hand-off dialog: pick items to move (example).">Move items to someone</button></div></div>'; }).join("")+'</div>'+
    '<h3>Mailboxes</h3><div class="grid2">'+d.mailboxes.map(function(m){ return '<div class="card"><div class="row"><b class="mono">'+esc(m.addr)+'</b><span class="sp"></span><span class="tag '+(/day/.test(m.warm)?'warn':'good')+'">'+esc(m.warm)+'</span></div><dl class="kv"><dt>Sent today</dt><dd>'+(m.cap-m.left)+' of '+m.cap+'</dd><dt>Bounces (7 d)</dt><dd>0.8%</dd><dt>Inbox placement</dt><dd>9 of 10</dd></dl></div>'; }).join("")+'</div>';
}
function pSettings(){ return '<div class="ph"><h2>Settings</h2></div><div class="grid2"><div class="card"><h3>Everyday</h3><p class="hint">Language, theme, focus blocks, daily target.</p></div><div class="card"><h3>Setup (folded)</h3><p class="hint">Gemini, Python, AWS, GitHub, search tuning.</p></div></div>'; }

function palette(){ P.palette(d, function(k,id){ if (k==="creator"){ s.screen="creators"; s.rec=id; } else if (k==="brand"){ s.screen="brands"; s.rec=id; } else { s.screen="today"; s.sel="d:"+id; } render(); }); }
function tour(id){
  P.closeOverlay(); s.screen = "today"; s.rec = null;
  var pick = {finds:"finds", qualify:"finds", first:null, reply:null, pitch:"bp:b7", deal:"d:d1", money:"d:d4"}[id];
  if (id==="first"){ var q = d.drafts.filter(function(x){ return x.kind==="first"; })[0]; pick = q ? "q:"+q.id : null; }
  if (id==="reply"){ var r = d.drafts.filter(function(x){ return x.kind==="reply" && !x.brand; })[0]; pick = r ? "q:"+r.id : null; }
  if (id==="contact"){ var cs = items().filter(function(i){ return i.key.indexOf("c:")===0; }); var it = cs.filter(function(i){ return P.creator(d,i.key.slice(2)).email; })[0] || cs[0]; pick = it ? it.key : null; if (!pick) P.toast("Shortlist a creator first; a \"Get contacts\" item then appears."); }
  if (id==="team"){ s.screen = "team"; P.tourDone(K,"team"); render(); return; }
  if (pick) s.sel = pick; if (pick==="finds") P.tourDone(K,"finds");
  s.findsTable = false; render();
}
function key(e){
  if (s.screen!=="today") return;
  var list = items(), i = list.map(function(x){ return x.key; }).indexOf(s.sel);
  if (e.key==="j"||e.key==="J"){ if (i<list.length-1){ s.sel = list[i+1].key; render(); } return; }
  if (e.key==="k"||e.key==="K"){ if (i>0){ s.sel = list[i-1].key; render(); } return; }
  if (s.sel==="finds" && !s.findsTable){ if (e.key==="s"||e.key==="S") triage("short"); else if (e.key==="r"||e.key==="R") triage("rej"); else if (e.key==="ArrowRight") triage("skip"); }
}
function onClick(e){
  if (P.current!==K) return;
  var t = e.target, el;
  if ((el = t.closest("[data-act]"))){
    var a = el.getAttribute("data-act");
    if (a==="from") return;
    if (a==="draft-first"){ var c = P.creator(d, el.getAttribute("data-id")); P.makeFirst(d,c); s.sel = "q:f"+c.id; render(); return; }
    if (a==="open-creator"){ s.screen="creators"; s.rec=el.getAttribute("data-id"); render(); return; }
    if (P.act(K, ctx, a, el)) return;
  }
  if ((el = t.closest("[data-scr]"))){ s.screen = el.getAttribute("data-scr"); s.rec = null; if (s.screen==="team") P.tourDone(K,"team"); render(); return; }
  if ((el = t.closest("[data-item]"))){ s.sel = el.getAttribute("data-item"); if (s.sel==="finds") P.tourDone(K,"finds"); s.pitchSel = {}; render(); return; }
  if ((el = t.closest("[data-tri]"))){ triage(el.getAttribute("data-tri")); return; }
  if ((el = t.closest("[data-bgal]"))){ ctx.showFinds({stage:"new"}); return; }
  if ((el = t.closest("[data-ftable]"))){ s.findsTable = !s.findsTable; render(); return; }
  if ((el = t.closest("[data-tsel]"))){ s.tsel[el.getAttribute("data-tsel")] = el.checked; render(); return; }
  if ((el = t.closest("[data-tbulk]"))){ var ids = Object.keys(s.tsel).filter(function(k){ return s.tsel[k]; }); if (el.getAttribute("data-tbulk")==="short") P.shortlist(K,d,ids); else P.reject(K,d,ids); P.toast(ids.length+(el.getAttribute("data-tbulk")==="short"?" shortlisted.":" rejected.")); s.tsel = {}; render(); return; }
  if ((el = t.closest("[data-toast]"))){ P.toast(el.getAttribute("data-toast")); return; }
  if ((el = t.closest("[data-bq]"))){ P.brand(d, el.getAttribute("data-bq")).status = "qualified"; P.toast("Qualified. A \"Pitch creators\" item was added."); render(); return; }
  if ((el = t.closest("[data-bnot]"))){ P.brand(d, el.getAttribute("data-bnot")).status = "lost"; P.toast("Marked not a fit."); render(); return; }
  if ((el = t.closest("[data-psel]"))){ var pid = el.getAttribute("data-psel"); s.pitchSel[pid] = !s.pitchSel[pid]; render(); return; }
  if ((el = t.closest("[data-dopitch]"))){ var bid = el.getAttribute("data-dopitch"), pc = Object.keys(s.pitchSel).filter(function(k){ return s.pitchSel[k]; }); P.draftPitch(K,d,bid,pc); s.pitchSel = {}; s.sel = "q:"+d.drafts[0].id; render(); P.toast("Pitch drafted. Review and send it here."); return; }
  if ((el = t.closest("[data-back]"))){ s.rec = null; render(); return; }
  if ((el = t.closest("[data-cf]"))){ s.filter = el.getAttribute("data-cf"); render(); return; }
  if ((el = t.closest("[data-rec]"))){ s.screen = "creators"; s.rec = el.getAttribute("data-rec"); render(); return; }
  if ((el = t.closest("[data-brec]"))){ s.rec = el.getAttribute("data-brec"); render(); return; }
  if ((el = t.closest("[data-dl]"))){ s.screen = "today"; s.sel = "d:"+el.getAttribute("data-dl"); render(); return; }
}
document.addEventListener("click", onClick);
document.addEventListener("change", function(e){ if (P.current===K && e.target.matches("[data-act=from]")){ d.from = e.target.value; render(); } });
P.register(K, {mount:function(st){ stage = st; render(); }, tour:tour, palette:palette, key:key});
})();
