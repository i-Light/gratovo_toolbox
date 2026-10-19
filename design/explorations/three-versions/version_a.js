/* Version A · Pipeline: the sidebar is the IMA framework (five phases), each phase has its steps as tabs,
   work happens in boards and bulk tables, and any creator, brand or deal opens in a side drawer. */
(function(){
"use strict";
var esc = P.esc, K = "a";
var d = P.seed();
var s = {phase:"find", tab:{find:"search", reach:"board", close:"brands", deliver:"board", team:"mine"}, filter:"new", gold:false, sel:{}, pitchBrand:"b7", pitchSel:{}};
var dr = null, stage = null;
var ctx = {d:d, render:render, palette:palette, openConversation:function(kind,id){ openDrawer(kind==="brand"?"brand":"creator", id, "talk"); }, openQueue:function(){ s.phase="reach"; s.tab.reach="board"; P.closeOverlay(); dr=null; render(); },
  openCreator:function(id){ openDrawer("creator", id, "overview"); },
  showFinds:function(f){ P.TB.setFilter(ctx, f); s.phase="find"; s.tab.find="qualify"; P.closeOverlay(); dr=null; render(); window.scrollTo(0,0); }};
P.TB.bind(K, ctx);

var PHASES = [
  ["find","Find creators","Search, qualify, contacts","F"],["reach","Reach out","Emails, replies, media kits","R"],["close","Close","Sign, brands, pitch, terms","C"],
  ["deliver","Deliver and get paid","Brief to payout","D"],["team","Team","My work, scorecard, mailboxes","T"],
  ["insights","Insights","Channel analytics, keywords, money","I"],["tools","Toolbox","Calculator, archive, logs, setup","X"]
];
var TABS = {
  find:[["search","Search"],["qualify","Qualify"],["contacts","Contacts"]],
  reach:[["board","Outreach board"],["kits","Media kits and audience"]],
  close:[["brands","Brands"],["pitch","Pitch"],["terms","Negotiation and contracts"]],
  deliver:[["board","Deal board"]],
  team:[["mine","My work"],["score","Scorecard"],["mail","Mailbox health"]]
};
function cNew(){ return d.creators.filter(function(c){ return c.stage==="new"; }); }
function counts(){
  return {find:cNew().length, reach:d.drafts.length, close:d.brands.filter(function(b){ return b.status==="found"||b.status==="qualified"; }).length,
    deliver:d.deals.filter(function(x){ return x.step<P.DEAL_FLOW.length-1; }).length, team:0};
}
function tabCount(ph, t){
  if (ph==="find" && t==="qualify") return cNew().length;
  if (ph==="find" && t==="contacts") return d.creators.filter(function(c){ return ["shortlisted","emailed","replied"].indexOf(c.stage)>=0 && !(c.email&&c.confirmed); }).length;
  if (ph==="reach" && t==="board") return d.drafts.length;
  return 0;
}

function render(){
  if (!document.querySelector("#overlay .drawer")) dr = null;
  ctx.tbVisible = s.phase==="find" ? (s.tab.find==="search" ? "search" : s.tab.find==="qualify" ? "gallery" : "") : s.phase==="insights" ? "insights" : s.phase==="tools" ? "tools" : "";
  var c = counts();
  stage.innerHTML = '<div class="app"><nav class="rail" aria-label="Phases"><div class="rh">IMA framework</div>'+
    PHASES.map(function(p){ return '<button class="ri" type="button" data-ph="'+p[0]+'" aria-current="'+(s.phase===p[0])+'"><span class="ic">'+p[3]+'</span><span>'+esc(p[1])+'<span class="sub">'+esc(p[2])+'</span></span>'+(c[p[0]]?'<span class="cnt'+(p[0]==="deliver"||p[0]==="close"?' q':'')+'">'+c[p[0]]+'</span>':'')+'</button>'; }).join("")+
    '<span class="grow"></span><button class="ri" type="button" data-ph="settings" aria-current="'+(s.phase==="settings")+'"><span class="ic">S</span><span>Settings</span></button></nav>'+
    '<div class="work"><div class="bar">'+P.searchBox()+P.statusPills()+'<span class="sp"></span><span class="ink2 num" style="font-size:13px">Emails today <b>'+d.sent+'</b> / '+d.target+'</span></div>'+
    '<div class="page">'+page()+'</div></div></div>';
  if (dr) renderDrawer();
}
function tabs(){
  var list = TABS[s.phase]; if (!list || list.length<2) return "";
  return '<div class="tabs" role="tablist">'+list.map(function(t){ var n = tabCount(s.phase,t[0]); return '<button type="button" role="tab" data-tab="'+t[0]+'" aria-current="'+(s.tab[s.phase]===t[0])+'">'+esc(t[1])+(n?'<span class="c">'+n+'</span>':'')+'</button>'; }).join("")+'</div>';
}
function head(title, sub, right){ return '<div class="ph"><div class="col" style="gap:2px"><h2>'+esc(title)+'</h2><p>'+esc(sub)+'</p></div><span class="sp"></span>'+(right||'')+'</div>'; }
function page(){
  var ph = s.phase, t = s.tab[ph];
  if (ph==="find") return tabs()+(t==="search"?P.TB.searchConsole(ctx):t==="qualify"?P.TB.gallery(ctx,{title:"Qualify"}):head("Contacts","Get a confirmed address and a first name before the first email.")+pContacts());
  if (ph==="insights") return P.TB.insights(ctx);
  if (ph==="tools") return P.TB.tools(ctx);
  if (ph==="reach") return head("Reach out","Every creator conversation, from first email to a confirmed audience.", P.fromPicker(d))+tabs()+(t==="board"?pReachBoard():pKits());
  if (ph==="close") return head("Close","Sign creators, qualify brands, pitch, agree terms.")+tabs()+(t==="brands"?pBrands():t==="pitch"?pPitch():pTerms());
  if (ph==="deliver") return head("Deliver and get paid","Each deal moves one column at a time, only when its checklist is done.")+pDeliver();
  if (ph==="team") return head("Team","Who is doing what, how it is going, and whether the mailboxes are healthy.")+tabs()+(t==="mine"?pMine():t==="score"?pScore():pMail());
  return head("Settings","Daily settings first; one-time setup is folded away.")+pSettings();
}

/* ---- Find ---- */
function pSearch(){
  var n = cNew().length;
  return '<div class="card" style="border-color:var(--primary)"><div class="row"><span class="tag good">Run complete</span><span class="muted">Today 08:10 · 24 keywords · 61 archived by auto-clean</span></div>'+
    '<h3>'+n+' new channels passed your rules</h3><div class="row"><button class="btn pri" type="button" data-go="review">Review '+n+' new channels</button><span class="hint">Opens them in Qualify, newest first.</span></div></div>'+
    '<div class="grid2"><div class="card"><h3>Keywords</h3><textarea class="input" id="a-kw" rows="6">ai agents for small business\nclaude vs gpt coding\nai note taker review\nbest ai video editor 2026\nrag tutorial beginners\nai automation zapier</textarea><div class="row"><button class="btn pri" type="button" data-toast="Search started on this computer (example).">Start search</button><button class="btn" type="button" data-toast="Gemini would suggest 20 more keywords (example).">Suggest keywords</button></div></div>'+
    '<div class="card"><h3>Rules for this run</h3><p class="hint">Always visible, so nobody has to find a hidden dialog.</p><div class="row"><span class="tag">Sort: relevance</span><span class="tag">Results: channels</span><span class="tag">US · GB · CA · AU</span><span class="tag good">Keep: 45K+ median views</span><span class="tag good">Keep: 3+ uploads in 30 days</span><span class="tag">Rejects archived after 7 days</span></div><div class="row"><button class="btn" type="button" data-toast="Rules editor would open inline here (example).">Edit rules</button></div></div></div>';
}
function qualifyRows(){
  return d.creators.filter(function(c){
    if (s.filter==="new" && c.stage!=="new") return false;
    if (s.filter==="short" && c.stage!=="shortlisted") return false;
    if (s.filter==="rej" && c.stage!=="rejected") return false;
    if (s.gold && !c.gold) return false; return true;
  });
}
function pQualify(){
  var rows = qualifyRows(), sel = Object.keys(s.sel).filter(function(k){ return s.sel[k]; });
  var f = [["new","New",cNew().length],["short","Shortlisted",d.creators.filter(function(c){ return c.stage==="shortlisted"; }).length],["rej","Rejected",d.creators.filter(function(c){ return c.stage==="rejected"; }).length],["all","All",d.creators.length]];
  return '<div class="row">'+f.map(function(x){ return '<button class="chip" type="button" data-filter="'+x[0]+'" aria-pressed="'+(s.filter===x[0])+'">'+esc(x[1])+' <span class="c">'+x[2]+'</span></button>'; }).join("")+'<button class="chip" type="button" data-gold aria-pressed="'+s.gold+'">Gold mine only</button><span class="sp"></span><span class="hint">Tick rows for bulk actions · click a row for details</span></div>'+
    '<div class="tw"><table><thead><tr><th><span class="sr">Select</span></th><th>Channel</th><th>Median views</th><th>Uploads 30 d</th><th>Sponsors seen</th><th>Email</th><th>Top countries</th><th>Owner</th></tr></thead><tbody>'+
    (rows.length ? rows.map(function(c,i){ return '<tr data-open-c="'+c.id+'" class="'+(s.sel[c.id]?'sel':'')+'"><td><input type="checkbox" data-sel="'+c.id+'" aria-label="Select '+esc(c.handle)+'"'+(s.sel[c.id]?' checked':'')+'></td><td class="who"><div class="row" style="flex-wrap:nowrap">'+P.avatar(c.name,i)+'<span><b>'+esc(c.name)+(c.gold?' <span class="tag good">Gold</span>':'')+'</b><span>'+esc(c.handle)+' · '+P.fmtK(c.subs)+' subs</span></span></div></td><td class="num">'+P.fmtK(c.median)+'</td><td class="num">'+c.up30+'</td><td>'+(c.sponsors.length?esc(c.sponsors.join(", ")):'<span class="muted">none</span>')+'</td><td>'+(c.email?(c.confirmed?'<span class="tag good">confirmed</span>':'<span class="tag warn">found</span>'):'<span class="tag crit">none</span>')+'</td><td>'+esc(c.top.split("·").slice(0,2).join("·"))+'</td><td>'+(c.owner?esc(c.owner):'<span class="muted">nobody</span>')+'</td></tr>'; }).join("") : '<tr><td colspan="8" class="muted" style="cursor:default">Nothing here. '+(s.filter==="new"?'Every new channel has been reviewed.':'')+'</td></tr>')+
    '</tbody></table></div>'+
    (sel.length ? '<div class="bulk" role="toolbar" aria-label="Bulk actions"><b>'+sel.length+' selected</b><button class="btn pri sm" type="button" data-bulk="short">Shortlist</button><select class="btn sm" id="a-rej" aria-label="Reject reason"><option>Irrelevant</option><option>Inactive</option><option>Out of scope</option><option>Haram content</option></select><button class="btn sm" type="button" data-bulk="rej">Reject</button><button class="btn sm" type="button" data-bulk="assign">Assign to Sara</button><button class="btn sm" type="button" data-bulk="clear">Clear</button></div>' : '');
}
function pContacts(){
  var list = d.creators.filter(function(c){ return ["shortlisted","emailed","replied"].indexOf(c.stage)>=0 && !(c.email&&c.confirmed); });
  return '<p class="hint">Shortlisted creators who still need a confirmed address and a first name before the first email.</p>'+
    (list.length ? '<div class="grid2">'+list.map(function(c){ return '<div class="card"><div class="row"><b>'+esc(c.name)+'</b><span class="muted">'+esc(c.handle)+'</span><span class="sp"></span><button class="btn sm ghost" type="button" data-open-c="'+c.id+'">Open</button></div>'+P.contactsBlock(c)+'</div>'; }).join("")+'</div>' : '<div class="card"><p>Every shortlisted creator has a confirmed address.</p></div>');
}

/* ---- Reach out ---- */
function lane(title, hint, cards){ return '<section class="lane"><h4>'+esc(title)+' <span class="c">'+cards.length+'</span></h4><p class="lh">'+esc(hint)+'</p>'+(cards.join("")||'<p class="empty">Nothing here.</p>')+'</section>'; }
function pReachBoard(){
  var drafted = {}; d.drafts.forEach(function(q){ drafted[q.who] = true; });
  var toDraft = d.creators.filter(function(c){ return c.stage==="shortlisted" && !drafted[c.id]; });
  return '<div class="board">'+
    lane("To draft","Shortlisted, no email yet", toDraft.map(function(c){ return '<div class="kc"><b>'+esc(c.name)+'</b><span class="m">'+P.fmtK(c.median)+' median · '+(c.email?(c.confirmed?'email confirmed':'email not confirmed'):'no email')+'</span><button class="btn sm" type="button" data-act="draft-first" data-id="'+c.id+'">Draft first email</button></div>'; }))+
    lane("Waiting for you","Drafts to approve", d.drafts.map(function(q){ var w = P.who(d,q); return '<button class="kc" type="button" data-open-q="'+q.id+'"><b>'+esc(q.brand?w.name:w.handle)+'</b><span class="m">'+esc(P.KIND[q.kind])+(q.n?' '+q.n+' of 3':'')+' · '+esc(q.age)+'</span>'+(q.gates.length?'<span class="tag warn">Needs you: '+esc(q.gates[0].what)+'</span>':'')+'<span class="nx">Review and send →</span></button>'; }))+
    lane("Waiting for reply","Follow-ups come back here when due", d.creators.filter(function(c){ return c.stage==="emailed" && !drafted[c.id]; }).map(function(c){ return '<button class="kc" type="button" data-open-c="'+c.id+'" data-t="talk"><b>'+esc(c.handle)+'</b><span class="m">Sent 14 Oct · follow-up 1 due 21 Oct</span></button>'; }))+
    lane("Replied","Answer, then ask for the media kit", d.creators.filter(function(c){ return c.stage==="replied" && !drafted[c.id]; }).map(function(c){ return '<button class="kc" type="button" data-open-c="'+c.id+'" data-t="talk"><b>'+esc(c.handle)+'</b><span class="m">Replied · ask for analytics</span></button>'; }))+
    lane("Media kit and audience","Check the audience, agree a rate", d.creators.filter(function(c){ return c.stage==="mediakit"; }).map(function(c){ return '<button class="kc" type="button" data-open-c="'+c.id+'" data-t="kit"><b>'+esc(c.handle)+'</b><span class="m">Kit received · '+esc(c.top.split("·")[0])+'</span><span class="nx">Check audience →</span></button>'; }))+
    lane("Signed","Ready to pitch to brands", d.creators.filter(function(c){ return c.stage==="signed"; }).map(function(c){ return '<button class="kc" type="button" data-open-c="'+c.id+'"><b>'+esc(c.handle)+'</b><span class="m">'+P.fmtK(c.median)+' median · rate '+P.money(c.rate)+'</span></button>'; }))+
  '</div>';
}
function pKits(){
  var list = d.creators.filter(function(c){ return ["replied","mediakit","signed"].indexOf(c.stage)>=0; });
  function ok(b){ return b ? '<span class="tag good">yes</span>' : '<span class="tag crit">no</span>'; }
  return '<div class="tw"><table><thead><tr><th>Creator</th><th>US/UK/CA/AU top 3</th><th>Age band</th><th>Engagement</th><th>Rate agreed</th><th></th></tr></thead><tbody>'+
    list.map(function(c){ var all = P.topOk(c) && c.eng>=3 && c.rate>0; return '<tr data-open-c="'+c.id+'" data-t="kit"><td class="who"><b>'+esc(c.name)+'</b><span>'+esc(c.top)+'</span></td><td>'+ok(P.topOk(c))+'</td><td>'+esc(c.age)+'</td><td class="num">'+c.eng+'%</td><td>'+(c.rate?P.money(c.rate):'<span class="tag warn">not yet</span>')+'</td><td>'+(c.stage==="signed"?'<span class="tag good">Signed</span>':all?'<button class="btn sm pri" type="button" data-act="sign" data-id="'+c.id+'">Mark signed</button>':'<span class="muted">waiting</span>')+'</td></tr>'; }).join("")+'</tbody></table></div>';
}

/* ---- Close ---- */
function pBrands(){
  function card(b){ var seen = b.seen.map(function(id){ return P.creator(d,id).handle; }).join(", ");
    return '<div class="kc" data-open-b="'+b.id+'"><b>'+esc(b.name)+'</b><span class="m">'+esc(b.sells)+' · '+esc(b.country)+' · '+esc(b.budget)+'</span><span class="m">Seen with '+esc(seen)+'</span>'+
      (b.status==="found"?'<button class="btn sm" type="button" data-qualify="'+b.id+'">Qualify</button>':b.status==="qualified"?'<button class="btn sm pri" type="button" data-pitch="'+b.id+'">Pitch creators</button>':'')+'</div>'; }
  var by = function(st){ return d.brands.filter(function(b){ return b.status===st; }).map(card); };
  return '<div class="row"><button class="btn pri" type="button" data-toast="New brand form would open here (example).">New brand</button><span class="hint">Brands your creators already work with are added to Found automatically.</span></div><div class="board">'+
    lane("Found","Seen sponsoring your creators", by("found"))+lane("Qualified","Fits, has budget, has a contact", by("qualified"))+lane("Pitched","Waiting for their answer", by("pitched"))+lane("Negotiating","Terms on the table", by("negotiating"))+lane("Won","Deal signed at least once", by("won"))+'</div>';
}
function pPitch(){
  var b = P.brand(d,s.pitchBrand), choices = d.brands.filter(function(x){ return x.status!=="found"; });
  var readyC = d.creators.filter(P.ready), notReady = d.creators.filter(function(c){ return ["replied","mediakit"].indexOf(c.stage)>=0; });
  var n = Object.keys(s.pitchSel).filter(function(k){ return s.pitchSel[k]; }).length;
  return '<div class="card"><div class="row"><label class="field" style="min-width:240px">Brand<select class="input" id="a-pb" data-pb>'+choices.map(function(x){ return '<option value="'+x.id+'"'+(x.id===s.pitchBrand?' selected':'')+'>'+esc(x.name)+' · '+esc(x.sells)+'</option>'; }).join("")+'</select></label><span class="sp"></span><span class="hint">Contact: '+esc(b.contact||"none yet")+' '+(b.email?'&lt;'+esc(b.email)+'&gt;':'')+'</span></div>'+
    '<p class="hint">Pick one or two signed creators. Creators who are not ready show why.</p><ul class="checks">'+
    readyC.map(function(c){ return '<li class="'+(s.pitchSel[c.id]?'done':'')+'"><button class="tick" type="button" data-psel="'+c.id+'" aria-pressed="'+!!s.pitchSel[c.id]+'" aria-label="Pick '+esc(c.handle)+'"'+(!s.pitchSel[c.id]&&n>=2?' disabled':'')+'>'+(s.pitchSel[c.id]?'✓':'')+'</button><span class="t">'+esc(c.name)+' '+esc(c.handle)+'<small>'+P.fmtK(c.median)+' median · '+esc(c.top)+' · '+P.money(c.rate)+(c.sponsors.indexOf(b.name)>=0?' · already sponsored by '+esc(b.name):'')+'</small></span></li>'; }).join("")+
    notReady.map(function(c){ return '<li class="locked"><span class="tick" aria-hidden="true"></span><span class="t">'+esc(c.name)+'<small>Not ready: '+(c.rate?'':'no agreed rate, ')+(P.topOk(c)?'':'audience outside US/UK/CA/AU, ')+'not signed</small></span></li>'; }).join("")+
    '</ul><div class="row"><button class="btn pri" type="button" data-dopitch'+(n?'':' disabled')+'>Draft pitch to '+esc(b.name)+'</button></div></div>';
}
function pTerms(){
  var list = d.deals.filter(function(x){ return x.step<=1; });
  return '<div class="grid2">'+list.map(function(x){ return '<button class="kc" type="button" data-open-d="'+x.id+'"><b>'+P.dealLine(d,x)+'</b><span class="m">'+esc(P.DEAL_FLOW[x.step].name)+' · '+P.money(x.price)+' → '+P.money(x.payout)+'</span><span class="nx">Next: '+esc(P.nextAction(x))+'</span></button>'; }).join("")+'</div>'+
    '<div class="row"><button class="btn" type="button" data-toast="New deal form: pick brand and creator, price prefilled from the agreed rate (example).">New deal</button></div>';
}

/* ---- Deliver ---- */
function pDeliver(){
  return '<div class="board">'+P.DEAL_FLOW.map(function(st, i){
    var ds = d.deals.filter(function(x){ return x.step===i; });
    return lane(st.name, i===0?"Agree price, payout, terms":"", ds.map(function(x){ var done = x.checks.filter(Boolean).length; return '<button class="kc" type="button" data-open-d="'+x.id+'"><b>'+P.dealLine(d,x)+'</b><span class="m">'+done+' of '+x.checks.length+' done · '+esc(x.owner)+'</span><span class="nx">Next: '+esc(P.nextAction(x))+'</span></button>'; }));
  }).join("")+'</div>';
}

/* ---- Team ---- */
function pMine(){
  var mine = d.creators.filter(function(c){ return c.owner==="You" && ["signed","rejected"].indexOf(c.stage)<0; }), dl = d.deals.filter(function(x){ return x.owner==="You"; });
  return '<div class="grid2"><div class="card"><h3>My creators</h3>'+mine.map(function(c){ return '<div class="row"><b>'+esc(c.handle)+'</b><span class="tag">'+esc(P.CREATOR_STEPS[P.STAGE_STEP[c.stage]])+'</span><span class="sp"></span><button class="btn sm ghost" type="button" data-open-c="'+c.id+'">Open</button></div>'; }).join("")+'</div>'+
    '<div class="card"><h3>My deals</h3>'+dl.map(function(x){ return '<div class="row"><b>'+P.dealLine(d,x)+'</b><span class="tag">'+esc(P.DEAL_FLOW[x.step].name)+'</span><span class="sp"></span><button class="btn sm ghost" type="button" data-open-d="'+x.id+'">Open</button></div>'; }).join("")+'</div></div>';
}
function pScore(){
  var rows = [["You",58,9,"16%","3 h"],["Sara",71,12,"17%","2 h"],["Omar (VA)",40,5,"13%","5 h"]];
  return '<div class="tw"><table><thead><tr><th>Person</th><th>Emails this week</th><th>Replies</th><th>Reply rate</th><th>First answer</th></tr></thead><tbody>'+rows.map(function(r){ return '<tr><td><b>'+r[0]+'</b></td><td class="num">'+r[1]+'</td><td class="num">'+r[2]+'</td><td class="num">'+r[3]+'</td><td class="num">'+r[4]+'</td></tr>'; }).join("")+'</tbody></table></div><p class="hint">Funnel this month: 1,040 emails → 52 replies → 6 signed (course benchmark: about 5 per 1,000).</p>';
}
function pMail(){
  return '<div class="grid2">'+d.mailboxes.map(function(m){ return '<div class="card"><div class="row"><b class="mono">'+esc(m.addr)+'</b><span class="sp"></span>'+(/day/.test(m.warm)?'<span class="tag warn">'+esc(m.warm)+'</span>':'<span class="tag good">'+esc(m.warm)+'</span>')+'</div><dl class="kv"><dt>Sent today</dt><dd class="num">'+(m.cap-m.left)+' of '+m.cap+'</dd><dt>Bounces (7 d)</dt><dd class="num">0.8%</dd><dt>Spam placement test</dt><dd>Inbox 9 of 10</dd><dt>Connection</dt><dd>Signed in, renews in 5 days</dd></dl><div class="row"><button class="btn sm" type="button" data-toast="Cap set (example).">Change daily cap</button><button class="btn sm" type="button" data-toast="Test email sent to you (example).">Send a test</button></div></div>'; }).join("")+'</div>';
}
function pSettings(){
  return '<div class="grid2"><div class="card"><h3>Everyday</h3><p class="hint">Language, theme, text size, your mailboxes.</p></div><div class="card"><h3>Agency facts</h3><p class="hint">What drafts may claim, boycott list, daily target.</p></div><div class="card"><h3>Setup (folded)</h3><p class="hint">Python, Gemini, AWS, GitHub, search tuning. Shown with a red dot only when something is broken.</p></div></div>';
}

/* ---- drawers ---- */
function openDrawer(kind, id, tab){ dr = {kind:kind, id:id, tab:tab||"overview"}; P.openDrawer("", ""); renderDrawer(); }
function renderDrawer(){
  var o = document.querySelector("#overlay .drawer"); if (!o){ dr = null; return; }
  var h = "", b = "";
  if (dr.kind==="creator"){
    var c = P.creator(d,dr.id), qs = d.drafts.filter(function(q){ return q.who===c.id; });
    h = P.avatar(c.name,2)+'<div class="col" style="gap:0"><b>'+esc(c.name)+'</b><span class="muted" style="font-size:12.5px">'+esc(c.handle)+' · owner '+esc(c.owner||"nobody")+'</span></div>';
    var T = [["overview","Overview"],["contact","Contact"],["talk","Conversation"+(qs.length?" ("+qs.length+")":"")],["kit","Media kit and audience"],["deals","Deals"]];
    b = P.journey(P.CREATOR_STEPS, P.STAGE_STEP[c.stage])+'<div class="tabs">'+T.map(function(t){ return '<button type="button" data-dtab="'+t[0]+'" aria-current="'+(dr.tab===t[0])+'">'+esc(t[1])+'</button>'; }).join("")+'</div>';
    if (dr.tab==="overview") b += P.signals(c)+P.statsKv(c)+(c.stage==="new"||c.stage==="rejected"?'<div class="row"><button class="btn pri" type="button" data-one="short" data-id="'+c.id+'">Shortlist</button><button class="btn" type="button" data-one="rej" data-id="'+c.id+'">Reject</button><button class="btn ghost" type="button" data-act="assign">Assign</button></div>':'');
    if (dr.tab==="contact") b += P.contactsBlock(c);
    if (dr.tab==="talk") b += P.threadHtml(d,c.id)+qs.map(function(q){ return P.draftCard(d,q,{noOpen:true}); }).join("")+(qs.length?'':'<div class="row"><button class="btn" type="button" data-act="draft-first" data-id="'+c.id+'">Draft a message</button></div>');
    if (dr.tab==="kit") b += P.audienceCheck(c)+(c.stage==="mediakit"?'<div class="row"><button class="btn pri" type="button" data-act="sign" data-id="'+c.id+'">Mark signed</button></div>':'');
    if (dr.tab==="deals") b += d.deals.filter(function(x){ return x.creator===c.id; }).map(function(x){ return '<button class="kc" type="button" data-open-d="'+x.id+'"><b>'+P.dealLine(d,x)+'</b><span class="m">'+esc(P.DEAL_FLOW[x.step].name)+'</span></button>'; }).join("") || '<p class="hint">No deals yet.</p>';
  } else if (dr.kind==="brand"){
    var br = P.brand(d,dr.id), bq = d.drafts.filter(function(q){ return q.who===br.id; });
    h = '<div class="col" style="gap:0"><b>'+esc(br.name)+'</b><span class="muted" style="font-size:12.5px">'+esc(br.sells)+' · '+esc(br.country)+'</span></div>';
    b = '<dl class="kv"><dt>Contact</dt><dd>'+esc(br.contact||"none")+' '+(br.email?'&lt;'+esc(br.email)+'&gt;':'')+'</dd><dt>Budget</dt><dd>'+esc(br.budget)+'</dd><dt>Status</dt><dd>'+esc(br.status)+'</dd></dl>'+
      '<h4>Conversation</h4>'+P.threadHtml(d,br.id)+bq.map(function(q){ return P.draftCard(d,q,{noOpen:true}); }).join("")+
      '<div class="row"><button class="btn" type="button" data-pitch="'+br.id+'">Pitch creators</button></div>';
  } else {
    var x = P.deal(d,dr.id);
    h = '<div class="col" style="gap:0"><b>'+P.dealLine(d,x)+'</b><span class="muted" style="font-size:12.5px">'+P.money(x.price)+' → '+P.money(x.payout)+' · '+esc(x.terms||"terms not set")+' · '+esc(x.deliverable)+'</span></div>';
    b = P.journey(P.DEAL_FLOW.map(function(f){ return f.name; }), x.step)+'<h3>'+esc(P.DEAL_FLOW[x.step].name)+'</h3>'+P.dealChecklist(d,x);
  }
  o.querySelector(".drawer-h").innerHTML = h+'<span class="sp"></span><button class="btn sm ghost" type="button" data-close aria-label="Close">✕</button>';
  o.querySelector(".drawer-b").innerHTML = b;
}

function palette(){ P.palette(d, function(k,id){ openDrawer(k==="creator"?"creator":k==="brand"?"brand":"deal", id); }); }
function tour(id){
  P.closeOverlay(); dr = null;
  if (id==="finds"){ s.phase="find"; s.tab.find="search"; render(); P.toast("Press \"Review results\" on today's run, or start a new search."); }
  else if (id==="qualify"){ P.TB.setFilter(ctx,{stage:"new"}); s.phase="find"; s.tab.find="qualify"; render(); P.toast("Shortlist two cards and reject one, or tick several and use the bulk bar."); }
  else if (id==="contact"){ s.phase="find"; s.tab.find="contacts"; render(); }
  else if (id==="first"){ s.phase="reach"; s.tab.reach="board"; render(); var q = d.drafts.filter(function(x){ return x.kind==="first"; })[0]; if (q) openDrawer("creator", q.who, "talk"); }
  else if (id==="reply"){ s.phase="reach"; s.tab.reach="board"; render(); var r = d.drafts.filter(function(x){ return x.kind==="reply" && !x.brand; })[0]; if (r) openDrawer("creator", r.who, "talk"); }
  else if (id==="pitch"){ s.phase="close"; s.tab.close="pitch"; render(); }
  else if (id==="deal"){ s.phase="deliver"; render(); openDrawer("deal","d1"); }
  else if (id==="money"){ s.phase="deliver"; render(); openDrawer("deal","d4"); }
  else if (id==="team"){ s.phase="team"; s.tab.team="mail"; render(); P.tourDone(K,"team"); }
}

function onClick(e){
  if (P.current!==K) return;
  var t = e.target, el;
  if (t.closest("[data-close]")){ dr = null; return; }
  if ((el = t.closest("[data-act]"))){
    var a = el.getAttribute("data-act");
    if (a==="from") return;
    if (a==="draft-first"){ P.makeFirst(d, P.creator(d, el.getAttribute("data-id"))); var c = P.creator(d, el.getAttribute("data-id")); render(); openDrawer("creator", c.id, "talk"); return; }
    if (a==="open-creator"){ openDrawer("creator", el.getAttribute("data-id"), "contact"); return; }
    if (a==="open-brand"){ openDrawer("brand", el.getAttribute("data-id")); return; }
    if (P.act(K, ctx, a, el)) return;
  }
  if ((el = t.closest("[data-ph]"))){ s.phase = el.getAttribute("data-ph"); if (s.phase==="team") {} render(); return; }
  if ((el = t.closest("[data-tab]"))){ s.tab[s.phase] = el.getAttribute("data-tab"); if (s.phase==="team" && s.tab.team==="mail") P.tourDone(K,"team"); render(); return; }
  if ((el = t.closest("[data-dtab]"))){ dr.tab = el.getAttribute("data-dtab"); renderDrawer(); return; }
  if ((el = t.closest("[data-go]"))){ s.tab.find = "qualify"; s.filter = "new"; P.tourDone(K,"finds"); render(); return; }
  if ((el = t.closest("[data-toast]"))){ P.toast(el.getAttribute("data-toast")); return; }
  if ((el = t.closest("[data-filter]"))){ s.filter = el.getAttribute("data-filter"); s.sel = {}; render(); return; }
  if ((el = t.closest("[data-gold]"))){ s.gold = !s.gold; render(); return; }
  if ((el = t.closest("[data-sel]"))){ s.sel[el.getAttribute("data-sel")] = el.checked; render(); return; }
  if ((el = t.closest("[data-bulk]"))){
    var ids = Object.keys(s.sel).filter(function(k){ return s.sel[k]; }), b = el.getAttribute("data-bulk");
    if (b==="short"){ P.shortlist(K,d,ids); P.toast(ids.length+" shortlisted. They are now in Reach out › To draft.", "Go there", function(){ s.phase="reach"; s.tab.reach="board"; render(); }); }
    if (b==="rej"){ P.reject(K,d,ids); P.toast(ids.length+" rejected as "+document.getElementById("a-rej").value+". Archived in 7 days.", "Undo", function(){ ids.forEach(function(id){ P.creator(d,id).stage="new"; }); render(); }); }
    if (b==="assign"){ ids.forEach(function(id){ P.creator(d,id).owner = "Sara"; }); P.toast(ids.length+" assigned to Sara."); }
    s.sel = {}; render(); return;
  }
  if ((el = t.closest("[data-one]"))){ var id1 = el.getAttribute("data-id"); if (el.getAttribute("data-one")==="short") P.shortlist(K,d,[id1]); else P.reject(K,d,[id1]); render(); P.toast(P.creator(d,id1).handle+(el.getAttribute("data-one")==="short"?" shortlisted.":" rejected.")); return; }
  if ((el = t.closest("[data-qualify]"))){ P.brand(d, el.getAttribute("data-qualify")).status = "qualified"; render(); P.toast("Brand qualified. Next: pitch 1–2 signed creators."); return; }
  if ((el = t.closest("[data-pitch]"))){ s.pitchBrand = el.getAttribute("data-pitch"); s.pitchSel = {}; s.phase = "close"; s.tab.close = "pitch"; P.closeOverlay(); dr = null; render(); return; }
  if ((el = t.closest("[data-psel]"))){ var pid = el.getAttribute("data-psel"); s.pitchSel[pid] = !s.pitchSel[pid]; render(); return; }
  if ((el = t.closest("[data-dopitch]"))){ var pc = Object.keys(s.pitchSel).filter(function(k){ return s.pitchSel[k]; }); P.draftPitch(K,d,s.pitchBrand,pc); s.pitchSel = {}; render(); openDrawer("brand", s.pitchBrand); P.toast("Pitch drafted. Review it here, then send."); return; }
  if ((el = t.closest("[data-open-q]"))){ var q = P.draft(d, el.getAttribute("data-open-q")); openDrawer(q.brand?"brand":"creator", q.who, "talk"); return; }
  if ((el = t.closest("[data-open-c]")) && !t.closest("input,button:not([data-open-c])")){ openDrawer("creator", el.getAttribute("data-open-c"), el.getAttribute("data-t")||"overview"); return; }
  if ((el = t.closest("[data-open-b]")) && !t.closest("button")){ openDrawer("brand", el.getAttribute("data-open-b")); return; }
  if ((el = t.closest("[data-open-d]"))){ openDrawer("deal", el.getAttribute("data-open-d")); return; }
}
function onChange(e){
  if (P.current!==K) return;
  if (e.target.matches("[data-act=from]")){ d.from = e.target.value; render(); }
  if (e.target.matches("[data-pb]")){ s.pitchBrand = e.target.value; s.pitchSel = {}; render(); }
}
document.addEventListener("click", onClick);
document.addEventListener("change", onChange);
P.register(K, {mount:function(st){ stage = st; render(); }, tour:tour, palette:palette});
})();
