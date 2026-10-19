/* Version C · Records: a classic CRM. Lists with saved views on the left, the record in the middle with its journey
   and one "Next step", context (activity, related records) on the right. One inbox holds creator and brand conversations. */
(function(){
"use strict";
var esc = P.esc, K = "c";
var d = P.seed();
var s = {screen:"creators", view:{creators:"new", inbox:"reply", brands:"qualified", deals:"action"}, rec:{}, sel:{}, tab:"overview", pitchSel:{}, q:""};
var stage = null;
var ctx = {d:d, render:render, palette:palette, openConversation:function(kind,id){ s.screen="inbox"; s.view.inbox="all"; s.rec.inbox=id; render(); }, openQueue:function(){ s.screen="inbox"; s.view.inbox="drafts"; render(); },
  openCreator:function(id){ s.screen="creators"; s.cmode="list"; s.view.creators="all"; s.rec.creators=id; s.tab="overview"; render(); window.scrollTo(0,0); },
  showFinds:function(f){ P.TB.setFilter(ctx, f); s.screen="creators"; s.cmode="gallery"; render(); window.scrollTo(0,0); }};
P.TB.bind(K, ctx);
s.cmode = "list";

var CV = [["new","New finds",function(c){ return c.stage==="new"; }],["contact","To contact",function(c){ return c.stage==="shortlisted"; }],["waiting","Waiting for reply",function(c){ return c.stage==="emailed"; }],["replied","Replied",function(c){ return c.stage==="replied"||c.stage==="mediakit"; }],["ready","Ready to pitch",function(c){ return c.stage==="signed"; }],["mine","Mine",function(c){ return c.owner==="You" && c.stage!=="rejected"; }],["all","All",function(c){ return c.stage!=="rejected"; }]];
var BV = [["found","Found"],["qualified","Qualified"],["pitched","Pitched"],["negotiating","Negotiating"],["won","Won"]];
var BRAND_STEPS = ["Found","Qualified","Pitched","Negotiating","Won","Repeat"];
function convs(){
  var keys = {};
  Object.keys(d.threads).forEach(function(k){ keys[k] = true; }); d.drafts.forEach(function(q){ keys[q.who] = true; });
  return Object.keys(keys).map(function(k){
    var isB = !!P.brand(d,k), w = isB ? P.brand(d,k) : P.creator(d,k), t = d.threads[k]||[], last = t[t.length-1], q = d.drafts.filter(function(x){ return x.who===k; })[0];
    return {key:k, brand:isB, w:w, last:last, draft:q, needsReply: !!last && last.dir==="in"};
  });
}
function inboxList(){
  var v = s.view.inbox;
  return convs().filter(function(c){ return v==="all" || (v==="reply" && c.draft && c.draft.kind==="reply") || (v==="drafts" && c.draft && c.draft.kind!=="reply") || (v==="waiting" && !c.draft && c.last && c.last.dir==="out"); });
}

function render(){
  var ib = convs().filter(function(c){ return c.draft; }).length;
  ctx.tbVisible = {search:"search", insights:"insights", tools:"tools"}[s.screen] || (s.screen==="creators" && s.cmode==="gallery" ? "gallery" : "");
  stage.innerHTML = '<div class="app"><nav class="rail" aria-label="Sections">'+
    ri("inbox","Inbox",ib)+ri("search","Search")+ri("creators","Creators",d.creators.filter(function(c){ return c.stage==="new"; }).length,true)+ri("brands","Brands")+ri("deals","Deals",d.deals.filter(function(x){ return x.step>=5; }).length,true)+ri("campaigns","Campaigns")+ri("insights","Insights")+ri("tools","Toolbox")+ri("team","Team")+
    '<span class="grow"></span>'+ri("settings","Settings")+'</nav>'+
    '<div class="work"><div class="bar">'+P.searchBox()+P.statusPills()+'<span class="sp"></span><span class="ink2 num" style="font-size:13px">Emails today <b>'+d.sent+'</b> / '+d.target+'</span></div>'+
    '<div class="page" style="padding:0">'+screen()+'</div></div></div>';
}
function ri(k, label, n, quiet){ return '<button class="ri" type="button" data-scr="'+k+'" aria-current="'+(s.screen===k)+'"><span class="ic">'+label[0]+'</span><span>'+esc(label)+'</span>'+(n?'<span class="cnt'+(quiet?' q':'')+'">'+n+'</span>':'')+'</button>'; }
function panes(list, rec, side){
  return '<div class="c3" style="display:grid; grid-template-columns:minmax(250px,320px) minmax(0,1fr) minmax(220px,280px); min-height:calc(100vh - 110px)">'+
    '<div style="border-right:1px solid var(--line); background:var(--surface); display:flex; flex-direction:column; min-width:0">'+list+'</div>'+
    '<div style="padding:18px; display:flex; flex-direction:column; gap:14px; min-width:0">'+rec+'</div>'+
    '<aside style="border-left:1px solid var(--line); padding:16px; display:flex; flex-direction:column; gap:12px; min-width:0; background:var(--surface)">'+side+'</aside></div>'+
    '<style>@media (max-width:1150px){ .c3{grid-template-columns:minmax(230px,290px) minmax(0,1fr) !important} .c3 > aside{display:none !important} } @media (max-width:760px){ .c3{grid-template-columns:1fr !important} .c3 > div:first-child{border-right:0 !important; border-bottom:1px solid var(--line)} }</style>';
}
function views(list, cur, attr, countFn){ return '<div style="padding:12px; display:flex; flex-wrap:wrap; gap:6px; border-bottom:1px solid var(--line)">'+list.map(function(v){ var n = countFn ? countFn(v) : null; return '<button class="chip" type="button" '+attr+'="'+v[0]+'" aria-pressed="'+(cur===v[0])+'">'+esc(v[1])+(n!=null?' <span class="c">'+n+'</span>':'')+'</button>'; }).join("")+'</div>'; }
function rowBtn(attr, id, on, title, sub, right, check){ return '<div style="display:flex; align-items:center; gap:8px; padding:9px 12px; border-bottom:1px solid var(--line); background:'+(on?'var(--primary-soft)':'transparent')+'">'+(check||'')+'<button type="button" '+attr+'="'+id+'" style="flex:1; min-width:0; text-align:left; border:0; background:transparent; cursor:pointer; padding:0"><b style="display:block; font-size:13.5px">'+title+'</b><span class="muted" style="font-size:12px">'+sub+'</span></button>'+(right||'')+'</div>'; }

function screen(){
  if (s.screen==="creators" && s.cmode==="gallery") return '<div class="page"><div class="row"><span class="seg" role="group" aria-label="Layout"><button type="button" data-cmode="list" aria-pressed="false">List and record</button><button type="button" data-cmode="gallery" aria-pressed="true">Gallery</button></span></div>'+P.TB.gallery(ctx,{title:"Creators"})+'</div>';
  if (s.screen==="creators") return creators();
  if (s.screen==="search") return '<div class="page">'+P.TB.searchConsole(ctx)+'</div>';
  if (s.screen==="insights") return '<div class="page">'+P.TB.insights(ctx)+'</div>';
  if (s.screen==="tools") return '<div class="page">'+P.TB.tools(ctx)+'</div>';
  if (s.screen==="inbox") return inbox();
  if (s.screen==="brands") return brands();
  if (s.screen==="deals") return deals();
  if (s.screen==="campaigns") return campaigns();
  if (s.screen==="team") return team();
  return '<div class="page"><div class="ph"><h2>Settings</h2></div><div class="grid2"><div class="card"><h3>Everyday</h3><p class="hint">Language, theme, mailboxes.</p></div><div class="card"><h3>Setup (folded)</h3><p class="hint">Gemini, Python, AWS, GitHub.</p></div></div></div>';
}

/* ---- creators ---- */
function creators(){
  var v = CV.filter(function(x){ return x[0]===s.view.creators; })[0], list = d.creators.filter(v[2]);
  if (!s.rec.creators || !list.some(function(c){ return c.id===s.rec.creators; })) s.rec.creators = s.rec.creators && P.creator(d,s.rec.creators) && s.keepRec ? s.rec.creators : (list[0]||{}).id;
  var sel = Object.keys(s.sel).filter(function(k){ return s.sel[k]; });
  var L = '<div style="padding:10px 12px 0"><span class="seg" role="group" aria-label="Layout"><button type="button" data-cmode="list" aria-pressed="true">List and record</button><button type="button" data-cmode="gallery" aria-pressed="false">Gallery</button></span></div>'+views(CV.map(function(x){ return [x[0],x[1]]; }), s.view.creators, "data-cv", function(x){ return d.creators.filter(CV.filter(function(y){ return y[0]===x[0]; })[0][2]).length; })+
    '<div style="overflow-y:auto; flex:1">'+(list.map(function(c){ return rowBtn("data-crec", c.id, c.id===s.rec.creators, esc(c.name)+(c.gold?' <span class="tag good">Gold</span>':''), esc(c.handle)+' · '+P.fmtK(c.median)+' median · '+(c.sponsors.length?'sponsored':'no sponsors'), '', s.view.creators==="new"?'<input type="checkbox" data-csel="'+c.id+'"'+(s.sel[c.id]?' checked':'')+' aria-label="Select '+esc(c.handle)+'">':''); }).join("") || '<p class="hint" style="padding:14px">No creators in this view.</p>')+'</div>'+
    (sel.length?'<div class="bulk" style="margin:10px"><b>'+sel.length+'</b><button class="btn pri sm" type="button" data-cbulk="short">Shortlist</button><button class="btn sm" type="button" data-cbulk="rej">Reject</button></div>':'');
  var c = P.creator(d, s.rec.creators);
  if (!c) return panes(L, '<p class="hint">Pick a creator.</p>', '');
  return panes(L, creatorRec(c), context(c));
}
function nextStep(c){
  var hasDraft = d.drafts.some(function(q){ return q.who===c.id; });
  if (c.stage==="new") return ['Qualify this channel','<button class="btn pri" type="button" data-one="short" data-id="'+c.id+'">Shortlist</button><button class="btn" type="button" data-one="rej" data-id="'+c.id+'">Reject</button>'];
  if (c.stage==="shortlisted" && !c.email) return ['Find their email','<button class="btn pri" type="button" data-act="find-email" data-id="'+c.id+'">Find email</button>'];
  if (c.stage==="shortlisted" && !c.confirmed) return ['Confirm their email','<button class="btn pri" type="button" data-act="confirm" data-id="'+c.id+'">Confirm '+esc(c.email)+'</button>'];
  if (c.stage==="shortlisted") return [hasDraft?'Approve the first email':'Write the first email','<button class="btn pri" type="button" data-first="'+c.id+'">'+(hasDraft?'Open draft in Inbox':'Draft first email')+'</button>'];
  if (c.stage==="emailed") return ['Wait for a reply · follow-up 1 due 21 Oct','<button class="btn" type="button" data-conv="'+c.id+'">Open conversation</button>'];
  if (c.stage==="replied") return ['Answer their reply','<button class="btn pri" type="button" data-conv="'+c.id+'">Open in Inbox</button>'];
  if (c.stage==="mediakit") return ['Check the audience, then sign','<button class="btn pri" type="button" data-tabgo="audience">Check audience</button>'];
  if (c.stage==="signed") return ['Pitch to a brand','<button class="btn pri" type="button" data-scr="brands">Choose a brand</button>'];
  return ['Rejected',''];
}
function creatorRec(c){
  var ns = nextStep(c), T = [["overview","Overview"],["contact","Contact"],["talk","Conversation"],["audience","Audience"],["deals","Deals"]];
  var b = '<div class="row">'+P.avatar(c.name,4)+'<div class="col" style="gap:0"><h2 style="font-size:1.35rem">'+esc(c.name)+'</h2><span class="muted">'+esc(c.handle)+' · owner '+esc(c.owner||"nobody")+'</span></div><span class="sp"></span><button class="btn sm" type="button" data-act="assign">Assign</button></div>'+
    P.journey(P.CREATOR_STEPS, P.STAGE_STEP[c.stage])+
    '<div class="card" style="border-color:var(--primary); flex-direction:row; align-items:center; flex-wrap:wrap"><div class="col" style="gap:0; flex:1; min-width:180px"><span class="mono muted" style="font-size:11px">NEXT STEP</span><b>'+esc(ns[0])+'</b></div><div class="row">'+ns[1]+'</div></div>'+
    '<div class="tabs">'+T.map(function(t){ return '<button type="button" data-ctab="'+t[0]+'" aria-current="'+(s.tab===t[0])+'">'+t[1]+'</button>'; }).join("")+'</div>';
  if (s.tab==="overview") b += '<div class="card">'+P.signals(c)+P.statsKv(c)+'</div>';
  if (s.tab==="contact") b += '<div class="card">'+P.contactsBlock(c)+'</div>';
  if (s.tab==="talk") b += '<div class="card">'+P.threadHtml(d,c.id)+'<div class="row"><button class="btn sm" type="button" data-conv="'+c.id+'">Open in Inbox</button></div></div>';
  if (s.tab==="audience") b += '<div class="card">'+P.audienceCheck(c)+(c.stage==="mediakit"?'<div class="row"><button class="btn pri" type="button" data-act="sign" data-id="'+c.id+'">Mark signed</button></div>':'')+'</div>';
  if (s.tab==="deals") b += '<div class="card">'+(d.deals.filter(function(x){ return x.creator===c.id; }).map(function(x){ return '<div class="row"><b>'+P.dealLine(d,x)+'</b><span class="tag">'+esc(P.DEAL_FLOW[x.step].name)+'</span><span class="sp"></span><button class="btn sm" type="button" data-drec="'+x.id+'">Open</button></div>'; }).join("") || '<p class="hint">No deals yet.</p>')+'</div>';
  return b;
}
function context(c){
  return '<h4 style="font-size:12px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted)">Activity</h4><ul class="checks">'+
    [["Found by search","12 Oct"],c.stage!=="new"?["Shortlisted by "+(c.owner||"You"),"13 Oct"]:null,(d.threads[c.id]||[]).length?["First email sent","14 Oct"]:null].filter(Boolean).map(function(a){ return '<li><span class="t">'+esc(a[0])+'<small>'+esc(a[1])+'</small></span></li>'; }).join("")+'</ul>'+
    '<h4 style="font-size:12px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted)">Brands seen with</h4><p>'+(c.sponsors.length?esc(c.sponsors.join(", ")):'None yet')+'</p>';
}

/* ---- inbox ---- */
function inbox(){
  var list = inboxList();
  if (!s.rec.inbox || !list.some(function(c){ return c.key===s.rec.inbox; })) s.rec.inbox = (list[0]||{}).key;
  var IV = [["reply","Needs reply"],["drafts","Drafts to approve"],["waiting","Waiting"],["all","All"]];
  var L = views(IV, s.view.inbox, "data-iv", function(v){ var keep = s.view.inbox; s.view.inbox = v[0]; var n = inboxList().length; s.view.inbox = keep; return n; })+
    '<div style="overflow-y:auto; flex:1">'+(list.map(function(c){ return rowBtn("data-irec", c.key, c.key===s.rec.inbox, esc(c.brand?c.w.name:c.w.handle)+(c.brand?' <span class="tag mag">Brand</span>':''), c.draft ? esc(P.KIND[c.draft.kind])+' waiting for you' : c.last ? esc(c.last.text.slice(0,48))+'…' : '', c.last?'<span class="mono muted" style="font-size:11px">'+esc(c.last.at)+'</span>':''); }).join("") || '<p class="hint" style="padding:14px">Inbox zero for this view.</p>')+'</div>';
  var cv = convs().filter(function(c){ return c.key===s.rec.inbox; })[0];
  if (!cv) return panes(L, '<p class="hint">Nothing selected.</p>', '');
  var rec = '<div class="row"><h2 style="font-size:1.3rem">'+esc(cv.brand?cv.w.name:cv.w.name+' '+cv.w.handle)+'</h2><span class="sp"></span><button class="btn sm ghost" type="button" data-'+(cv.brand?'brec':'crec-go')+'="'+cv.key+'">Open record</button></div>'+P.threadHtml(d,cv.key)+(cv.draft?P.draftCard(d,cv.draft,{noOpen:true}):'<div class="row"><button class="btn" type="button" data-toast="A reply draft would be made here (example).">Draft a reply</button></div>');
  var side = cv.brand ? '<h4>'+esc(cv.w.name)+'</h4><dl class="kv"><dt>Sells</dt><dd>'+esc(cv.w.sells)+'</dd><dt>Budget</dt><dd>'+esc(cv.w.budget)+'</dd></dl>' : P.signals(cv.w)+P.statsKv(cv.w);
  return panes(L, rec, side);
}

/* ---- brands ---- */
function brands(){
  var list = d.brands.filter(function(b){ return b.status===s.view.brands; });
  if (!s.rec.brands || !P.brand(d,s.rec.brands)) s.rec.brands = (list[0]||{}).id;
  var L = views(BV, s.view.brands, "data-bv", function(v){ return d.brands.filter(function(b){ return b.status===v[0]; }).length; })+
    '<div style="overflow-y:auto; flex:1">'+(list.map(function(b){ return rowBtn("data-brec", b.id, b.id===s.rec.brands, esc(b.name), esc(b.sells)+' · '+esc(b.budget)); }).join("") || '<p class="hint" style="padding:14px">No brands in this view.</p>')+'</div>';
  var b = P.brand(d,s.rec.brands); if (!b) return panes(L, '<p class="hint">Pick a brand.</p>', '');
  var at = Math.max(0, BRAND_STEPS.map(function(x){ return x.toLowerCase(); }).indexOf(b.status));
  var rec = '<div class="row"><h2 style="font-size:1.35rem">'+esc(b.name)+'</h2><span class="muted">'+esc(b.sells)+' · '+esc(b.country)+'</span></div>'+P.journey(BRAND_STEPS, at);
  if (b.status==="found") rec += '<div class="card" style="border-color:var(--primary)"><span class="mono muted" style="font-size:11px">NEXT STEP</span><b>Qualify: fit, budget, a contact</b><div class="row"><button class="btn pri" type="button" data-bq="'+b.id+'">Qualified</button><button class="btn" type="button" data-toast="Marked not a fit (example).">Not a fit</button></div></div>';
  else if (b.status==="qualified" || b.status==="won"){
    var rc = d.creators.filter(P.ready), n = Object.keys(s.pitchSel).filter(function(k){ return s.pitchSel[k]; }).length;
    rec += '<div class="card" style="border-color:var(--primary)"><span class="mono muted" style="font-size:11px">NEXT STEP</span><b>'+(b.status==="won"?'Pitch their next creator':'Pitch 1–2 signed creators')+'</b><ul class="checks">'+rc.map(function(c){ return '<li class="'+(s.pitchSel[c.id]?'done':'')+'"><button class="tick" type="button" data-psel="'+c.id+'" aria-pressed="'+!!s.pitchSel[c.id]+'" aria-label="Pick '+esc(c.handle)+'"'+(!s.pitchSel[c.id]&&n>=2?' disabled':'')+'>'+(s.pitchSel[c.id]?'✓':'')+'</button><span class="t">'+esc(c.name)+'<small>'+P.fmtK(c.median)+' median · '+esc(c.top)+'</small></span></li>'; }).join("")+'</ul><div class="row"><button class="btn pri" type="button" data-dopitch="'+b.id+'"'+(n?'':' disabled')+'>Draft pitch</button></div></div>';
  } else rec += '<div class="card" style="border-color:var(--primary)"><span class="mono muted" style="font-size:11px">NEXT STEP</span><b>'+(b.status==="negotiating"?'Answer their counter-offer':'Wait for their answer')+'</b><div class="row"><button class="btn pri" type="button" data-bconv="'+b.id+'">Open in Inbox</button></div></div>';
  rec += '<div class="card"><h3>Conversation</h3>'+P.threadHtml(d,b.id)+'</div>';
  var side = '<h4>Contact</h4><p>'+esc(b.contact||"none")+'<br><span class="mono" style="font-size:12px">'+esc(b.email)+'</span></p><h4>Seen with</h4><p>'+esc(b.seen.map(function(x){ return P.creator(d,x).handle; }).join(", "))+'</p><h4>Deals</h4>'+(d.deals.filter(function(x){ return x.brand===b.id; }).map(function(x){ return '<button class="kc" type="button" data-drec="'+x.id+'"><b>'+P.dealLine(d,x)+'</b><span class="m">'+esc(P.DEAL_FLOW[x.step].name)+'</span></button>'; }).join("") || '<p class="hint">None yet.</p>');
  return panes(L, rec, side);
}

/* ---- deals ---- */
function deals(){
  var DV = [["action","Needs action"],["mine","Mine"],["all","All"]];
  var list = d.deals.filter(function(x){ return s.view.deals==="all" || (s.view.deals==="mine" ? x.owner==="You" : true); });
  if (!s.rec.deals || !P.deal(d,s.rec.deals)) s.rec.deals = (list[0]||{}).id;
  var L = views(DV, s.view.deals, "data-dv")+'<div style="overflow-y:auto; flex:1">'+list.map(function(x){ return rowBtn("data-drec", x.id, x.id===s.rec.deals, P.dealLine(d,x), esc(P.DEAL_FLOW[x.step].name)+' · next: '+esc(P.nextAction(x))); }).join("")+'</div>';
  var x = P.deal(d,s.rec.deals);
  var rec = '<div class="row"><h2 style="font-size:1.3rem">'+P.dealLine(d,x)+'</h2><span class="sp"></span><span class="muted">'+P.money(x.price)+' → '+P.money(x.payout)+' · margin '+P.money(x.price-x.payout)+'</span></div>'+P.journey(P.DEAL_FLOW.map(function(f){ return f.name; }), x.step)+'<div class="card" style="border-color:var(--primary)"><span class="mono muted" style="font-size:11px">NEXT STEP</span><h3>'+esc(P.DEAL_FLOW[x.step].name)+'</h3>'+P.dealChecklist(d,x)+'</div>';
  var side = '<h4>Terms</h4><dl class="kv"><dt>Payment</dt><dd>'+esc(x.terms||"not set")+'</dd><dt>Deliverable</dt><dd>'+esc(x.deliverable)+'</dd><dt>Due</dt><dd>'+esc(x.due)+'</dd><dt>Owner</dt><dd>'+esc(x.owner)+'</dd></dl><h4>Parties</h4><button class="kc" type="button" data-brec="'+x.brand+'"><b>'+esc(P.brand(d,x.brand).name)+'</b><span class="m">Brand</span></button><button class="kc" type="button" data-crec-go="'+x.creator+'"><b>'+esc(P.creator(d,x.creator).handle)+'</b><span class="m">Creator</span></button>';
  return panes(L, rec, side);
}
function campaigns(){
  var rows = d.brands.filter(function(b){ return b.status!=="found"; }).map(function(b){ return [b, d.deals.filter(function(x){ return x.brand===b.id; }).length]; });
  return '<div class="page"><div class="ph"><h2>Campaigns</h2><span class="sp"></span><button class="btn" type="button" data-toast="New campaign: pick a brand and dates (example).">New campaign</button></div><div class="tw"><table><thead><tr><th>Campaign</th><th>Brand</th><th>Shortlist</th><th>Pitched</th><th>Deals</th></tr></thead><tbody>'+rows.map(function(r,i){ return '<tr data-brec="'+r[0].id+'"><td><b>'+esc(r[0].name)+' · Q4 push</b></td><td>'+esc(r[0].name)+'</td><td class="num">'+(2+i%2)+'</td><td>'+(r[0].status==="qualified"?'<span class="tag warn">not yet</span>':'<span class="tag good">yes</span>')+'</td><td class="num">'+r[1]+'</td></tr>'; }).join("")+'</tbody></table></div></div>';
}
function team(){
  return '<div class="page"><div class="ph"><h2>Team</h2></div><div class="grid2">'+d.mailboxes.map(function(m){ return '<div class="card"><div class="row"><b class="mono">'+esc(m.addr)+'</b><span class="sp"></span><span class="tag '+(/day/.test(m.warm)?'warn':'good')+'">'+esc(m.warm)+'</span></div><dl class="kv"><dt>Sent today</dt><dd>'+(m.cap-m.left)+' of '+m.cap+'</dd><dt>Bounces (7 d)</dt><dd>0.8%</dd><dt>Inbox placement</dt><dd>9 of 10</dd></dl></div>'; }).join("")+'</div>'+
    '<div class="tw"><table><thead><tr><th>Person</th><th>Access</th><th>Open records</th><th>Emails this week</th><th>Reply rate</th></tr></thead><tbody><tr><td><b>You</b></td><td>full</td><td class="num">11</td><td class="num">58</td><td class="num">16%</td></tr><tr><td><b>Sara</b></td><td>full</td><td class="num">9</td><td class="num">71</td><td class="num">17%</td></tr><tr><td><b>Omar</b></td><td>basic (VA)</td><td class="num">7</td><td class="num">40</td><td class="num">13%</td></tr></tbody></table></div></div>';
}

function palette(){ P.palette(d, function(k,id){ if (k==="creator"){ s.screen="creators"; s.view.creators="all"; s.rec.creators=id; } else if (k==="brand"){ var b = P.brand(d,id); s.screen="brands"; s.view.brands=b.status; s.rec.brands=id; } else { s.screen="deals"; s.view.deals="all"; s.rec.deals=id; } s.tab="overview"; render(); }); }
function goCreator(id){ var c = P.creator(d,id); s.screen = "creators"; s.view.creators = "all"; s.rec.creators = id; s.tab = "overview"; render(); }
function tour(id){
  P.closeOverlay(); s.tab = "overview";
  if (id==="finds"){ s.screen="search"; render(); P.toast("Press \"Review results\" on today's run, or start a new search."); }
  else if (id==="qualify"){ ctx.showFinds({stage:"new"}); P.toast("Shortlist two cards and reject one, or tick several and use the bulk bar."); }
  else if (id==="contact"){ s.screen="creators"; s.view.creators="contact"; var cs = d.creators.filter(function(x){ return x.stage==="shortlisted" && !(x.email&&x.confirmed); }), c = cs.filter(function(x){ return x.email; })[0] || cs[0]; s.rec.creators = c ? c.id : null; render(); }
  else if (id==="first"){ s.screen="inbox"; s.view.inbox="drafts"; var q = d.drafts.filter(function(x){ return x.kind==="first"; })[0]; s.rec.inbox = q ? q.who : null; render(); }
  else if (id==="reply"){ s.screen="inbox"; s.view.inbox="reply"; s.rec.inbox="c6"; render(); }
  else if (id==="pitch"){ s.screen="brands"; s.view.brands="qualified"; s.rec.brands="b7"; render(); }
  else if (id==="deal"){ s.screen="deals"; s.view.deals="all"; s.rec.deals="d1"; render(); }
  else if (id==="money"){ s.screen="deals"; s.view.deals="all"; s.rec.deals="d4"; render(); }
  else if (id==="team"){ s.screen="team"; render(); P.tourDone(K,"team"); }
}
function onClick(e){
  if (P.current!==K) return;
  var t = e.target, el;
  if ((el = t.closest("[data-act]"))){
    var a = el.getAttribute("data-act");
    if (a==="from") return;
    if (a==="open-creator"){ goCreator(el.getAttribute("data-id")); return; }
    if (P.act(K, ctx, a, el)) return;
  }
  if ((el = t.closest("[data-scr]"))){ s.screen = el.getAttribute("data-scr"); if (s.screen==="team") P.tourDone(K,"team"); if (s.screen==="creators" && s.view.creators==="new") P.tourDone(K,"finds"); render(); return; }
  if ((el = t.closest("[data-cmode]"))){ s.cmode = el.getAttribute("data-cmode"); render(); return; }
  if ((el = t.closest("[data-cv]"))){ s.view.creators = el.getAttribute("data-cv"); s.rec.creators = null; s.sel = {}; if (s.view.creators==="new") P.tourDone(K,"finds"); render(); return; }
  if ((el = t.closest("[data-csel]"))){ s.sel[el.getAttribute("data-csel")] = el.checked; render(); return; }
  if ((el = t.closest("[data-cbulk]"))){ var ids = Object.keys(s.sel).filter(function(k){ return s.sel[k]; }); if (el.getAttribute("data-cbulk")==="short") P.shortlist(K,d,ids); else P.reject(K,d,ids); P.toast(ids.length+(el.getAttribute("data-cbulk")==="short"?" shortlisted. They are in the \"To contact\" view.":" rejected.")); s.sel = {}; render(); return; }
  if ((el = t.closest("[data-crec]"))){ s.rec.creators = el.getAttribute("data-crec"); s.tab = "overview"; render(); return; }
  if ((el = t.closest("[data-crec-go]"))){ goCreator(el.getAttribute("data-crec-go")); return; }
  if ((el = t.closest("[data-ctab]"))){ s.tab = el.getAttribute("data-ctab"); render(); return; }
  if ((el = t.closest("[data-tabgo]"))){ s.tab = el.getAttribute("data-tabgo"); render(); return; }
  if ((el = t.closest("[data-one]"))){ var id1 = el.getAttribute("data-id"); if (el.getAttribute("data-one")==="short") P.shortlist(K,d,[id1]); else P.reject(K,d,[id1]); P.toast(P.creator(d,id1).handle+(el.getAttribute("data-one")==="short"?" shortlisted.":" rejected.")); render(); return; }
  if ((el = t.closest("[data-first]"))){ var c = P.creator(d, el.getAttribute("data-first")); P.makeFirst(d,c); s.screen="inbox"; s.view.inbox="drafts"; s.rec.inbox=c.id; render(); return; }
  if ((el = t.closest("[data-conv]"))){ s.screen="inbox"; s.view.inbox="all"; s.rec.inbox=el.getAttribute("data-conv"); render(); return; }
  if ((el = t.closest("[data-bconv]"))){ s.screen="inbox"; s.view.inbox="all"; s.rec.inbox=el.getAttribute("data-bconv"); render(); return; }
  if ((el = t.closest("[data-iv]"))){ s.view.inbox = el.getAttribute("data-iv"); s.rec.inbox = null; render(); return; }
  if ((el = t.closest("[data-irec]"))){ s.rec.inbox = el.getAttribute("data-irec"); render(); return; }
  if ((el = t.closest("[data-bv]"))){ s.view.brands = el.getAttribute("data-bv"); s.rec.brands = null; s.pitchSel = {}; render(); return; }
  if ((el = t.closest("[data-brec]"))){ var b = P.brand(d, el.getAttribute("data-brec")); s.screen="brands"; s.view.brands=b.status; s.rec.brands=b.id; s.pitchSel = {}; render(); return; }
  if ((el = t.closest("[data-bq]"))){ var b2 = P.brand(d, el.getAttribute("data-bq")); b2.status = "qualified"; s.view.brands = "qualified"; render(); P.toast(b2.name+" qualified."); return; }
  if ((el = t.closest("[data-psel]"))){ var pid = el.getAttribute("data-psel"); s.pitchSel[pid] = !s.pitchSel[pid]; render(); return; }
  if ((el = t.closest("[data-dopitch]"))){ var bid = el.getAttribute("data-dopitch"), pc = Object.keys(s.pitchSel).filter(function(k){ return s.pitchSel[k]; }); P.draftPitch(K,d,bid,pc); s.pitchSel = {}; s.screen="inbox"; s.view.inbox="drafts"; s.rec.inbox=bid; render(); P.toast("Pitch drafted. It is open in the Inbox."); return; }
  if ((el = t.closest("[data-dv]"))){ s.view.deals = el.getAttribute("data-dv"); render(); return; }
  if ((el = t.closest("[data-drec]"))){ s.screen="deals"; s.view.deals="all"; s.rec.deals = el.getAttribute("data-drec"); render(); return; }
  if ((el = t.closest("[data-toast]"))){ P.toast(el.getAttribute("data-toast")); return; }
}
document.addEventListener("click", onClick);
document.addEventListener("change", function(e){ if (P.current===K && e.target.matches("[data-act=from]")){ d.from = e.target.value; render(); } });
P.register(K, {mount:function(st){ stage = st; render(); }, tour:tour, palette:palette});
})();
