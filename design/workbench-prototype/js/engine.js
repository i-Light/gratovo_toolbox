/* engine.js — the business brain. Lookups, scoring, the next-action engine that feeds Today and every record,
   and W.A: every action a person can take. Screens never mutate data themselves; they call W.A.* so feedback,
   undo, the activity log and follow-on work (sequences, jobs, unlocks) behave the same everywhere. */
(function(){
"use strict";
var W = window.W;
function D(){ return W.D(); }

/* ---------- lookups ---------- */
function find(list, id){ for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
W.creator = function(id){ return find(D().creators, id); };
W.brand = function(id){ return find(D().brands, id); };
W.deal = function(id){ return find(D().deals, id); };
W.draft = function(id){ return find(D().drafts, id); };
/* the owner's account shows the signed-in person's own name (or the one set in Settings) */
W.member = function(id){
  var m = find(D().team, id) || {id:id, name:"Nobody", role:""};
  var nm = id === "u1" && W.myName ? W.myName() : "";
  return nm ? Object.assign({}, m, {name:nm}) : m;
};
/* owners and account managers see money; VAs only when the owner decides they can */
W.canSeeMoney = function(){ var d = D(), r = W.member(d.me).role || ""; return r === "Owner" || /Account/.test(r) || d.settings.vaMoney === "show"; };
W.mailbox = function(id){ return find(D().mail, id); };
W.rec = function(ref){ return !ref ? null : ref.t === "creator" ? W.creator(ref.id) : ref.t === "brand" ? W.brand(ref.id) : ref.t === "deal" ? W.deal(ref.id) : null; };
W.dealName = function(x){ var b = W.brand(x.brand), c = W.creator(x.creator); return (b ? b.name : "?") + " × " + (c ? c.name : "?"); };
W.refName = function(ref){ var r = W.rec(ref); if (!r) return "?"; return ref.t === "deal" ? W.dealName(r) : r.name; };
W.toName = function(dr){ var r = W.rec(dr.to); return r ? r.name : "?"; };
W.toAddr = function(dr){ var r = W.rec(dr.to); return r ? r.email : null; };
W.threadOf = function(ref){ return D().threads[ref.id] || []; };
W.lastIn = function(ref){ var t = W.threadOf(ref); for (var i = t.length - 1; i >= 0; i--) if (t[i].dir === "in") return t[i]; return null; };
W.draftsFor = function(ref){ return D().drafts.filter(function(q){ return q.to.t === ref.t && q.to.id === ref.id; }); };
W.dealsFor = function(ref){ return D().deals.filter(function(x){ return ref.t === "creator" ? x.creator === ref.id : ref.t === "brand" ? x.brand === ref.id : x.id === ref.id; }); };
W.owned = function(o){ return !o.owner || o.owner === D().me; };

/* ---------- scoring ---------- */
W.topOk = function(countries){ var top = (countries || []).slice(0, 3); return top.length > 0 && top.some(function(c){ return D().rules.audience.top3.indexOf(c[0]) >= 0; }) && top[0] && D().rules.audience.top3.indexOf(top[0][0]) >= 0; };
W.usShare = function(countries){ return W.sum((countries || []).filter(function(c){ return ["US","GB","CA","AU"].indexOf(c[0]) >= 0; }), function(c){ return c[1]; }); };
/* fit: 0–100 with the reasons, so the number is never a black box */
W.fit = function(c){
  var r = [];
  var mv = Math.round(Math.min(1, c.median / 90000) * 30); r.push({k:"Median views", pts:mv, of:30, note:W.fmtK(c.median) + " per video"});
  var up = c.up30 >= 4 ? 15 : c.up30 === 3 ? 10 : c.up30 >= 1 ? 4 : 0; if (c.up30 > 20) up = 6; r.push({k:"Posting", pts:up, of:15, note:c.up30 + " uploads in 30 days" + (c.up30 > 20 ? " (mostly Shorts)" : "")});
  var share = W.usShare(c.countries), au = Math.round(Math.min(1, share / 55) * 25); r.push({k:"US/UK/CA/AU audience", pts:au, of:25, note:c.countries.length ? share + "% in the top 3" : "not known yet"});
  var en = Math.round(Math.min(1, (c.eng || 0) / 6) * 15); r.push({k:"Engagement", pts:en, of:15, note:(c.eng || "?") + "%"});
  var sp = c.sponsors.length ? 15 : 0; r.push({k:"Sponsored before", pts:sp, of:15, note:c.sponsors.length ? c.sponsors.join(", ") : "no sponsors seen"});
  return {score:W.sum(r, function(x){ return x.pts; }), parts:r};
};
W.gold = function(c){ return c.median >= 40000 && c.median / Math.max(c.subs, 1) >= .4 && c.up30 >= 3 && c.up30 <= 20; };
W.audience = function(src){
  var rules = D().rules.audience, rows = [];
  var top = (src.countries || []).slice(0, 3);
  rows.push({k:"top", label:"US, UK, CA or AU leads the top 3", ok:top.length ? rules.top3.indexOf(top[0][0]) >= 0 : null, detail:top.length ? top.map(function(c){ return c[0] + " " + c[1] + "%"; }).join(" · ") : "Not received"});
  rows.push({k:"age", label:"Buying age (18–44)", ok:src.age ? rules.ages.indexOf(src.age) >= 0 : null, detail:src.age || "Not received"});
  rows.push({k:"eng", label:"Engagement " + rules.minEng + "% or more", ok:src.eng ? src.eng >= rules.minEng : null, detail:src.eng ? src.eng + "%" : "Not received"});
  rows.push({k:"rate", label:"Rate agreed", ok:src.rate ? true : null, detail:src.rate ? W.money(src.rate) : "Not received"});
  var pass = rows.every(function(x){ return x.ok === true; }), fail = rows.some(function(x){ return x.ok === false; });
  return {rows:rows, pass:pass, fail:fail};
};
/* what a brand would pay for this creator: the higher of a CPM quote and the creator's rate plus the house margin */
W.priceFor = function(c){ var cpm = Math.round(c.median / 1000 * 40 / 50) * 50, withMargin = Math.round((c.rate || 0) * 1.6 / 50) * 50; return Math.max(cpm, withMargin); };
W.match = function(b, c){
  var f = W.fit(c).score, pts = Math.round(f * .6), why = [], warn = [];
  if (c.sponsors.indexOf(b.name) >= 0){ pts += 15; why.push("Already made a video for " + b.name); }
  var us = W.usShare(c.countries); if (b.country === "US" && (c.countries[0] || [])[0] === "US"){ pts += 10; why.push("US-led audience for a US brand"); }
  else if (us >= 50){ pts += 6; why.push(us + "% of the top 3 are US/UK/CA/AU"); }
  var price = W.priceFor(c);
  if (b.budget){ if (price <= b.budget[1]){ pts += 12; why.push("Price " + W.money(price) + " fits " + W.money(b.budget[0]) + "–" + W.money(b.budget[1])); } else { warn.push("Price " + W.money(price) + " is above their budget"); } }
  var clash = D().deals.filter(function(x){ var xb = W.brand(x.brand); return x.creator === c.id && x.step < 9 && xb && xb.cat === b.cat && xb.id !== b.id; });
  if (clash.length){ pts -= 30; warn.push("In a live deal with " + W.brand(clash[0].brand).name + " (same category)"); }
  var busy = D().deals.filter(function(x){ return x.creator === c.id && x.step < 6; }).length;
  if (busy >= 2) warn.push(busy + " deals before go-live already");
  return {score:W.clamp(pts, 0, 100), why:why, warn:warn, price:price};
};

/* ---------- next step for any record ---------- */
W.nextFor = function(ref){
  var o = W.rec(ref); if (!o) return null;
  var dr = W.draftsFor(ref)[0];
  if (ref.t === "creator"){
    var c = o;
    if (dr) return {label:dr.kind === "reply" ? "Answer their reply" : dr.kind === "followup" ? "Send follow-up " + dr.n + " of 3" : "Approve the first email", sub:"Drafted " + W.ago(dr.created) + " · waiting for you", icon:dr.kind === "reply" ? "reply" : "send", hue:"var(--reach)", item:itemKeyForDraft(dr)};
    switch (c.stage){
      case "new": return {label:"Shortlist or reject", sub:"Found " + W.ago(c.found) + (c.run ? " in today's search" : ""), icon:"scan", hue:"var(--find)", item:"finds"};
      case "shortlisted": return {label:"Confirm the email address", sub:c.email ? "Found automatically, nobody has checked it" : "No address yet", icon:"at", hue:"var(--find)", item:"contact:" + c.id};
      case "contact": return {label:"Draft the first email", sub:"Contact confirmed", icon:"send", hue:"var(--reach)"};
      case "emailed": var nx = (c.seq && c.seq.steps.filter(function(s){ return s.st !== "sent" && s.st !== "skipped"; })[0]); return {label:nx ? (nx.k === "fu1" ? "Follow-up 1" : nx.k === "fu2" ? "Follow-up 2" : "Follow-up 3") + " " + W.dueText(nx.at) : "Sequence finished", sub:"Waiting for a reply · first email " + W.fmtShort(c.seq.steps[0].at), icon:"clock", hue:"var(--reach)", waiting:true};
      case "replied": return {label:"Ask for the media kit", sub:"They replied " + W.ago((W.lastIn(ref) || {}).at || W.now()), icon:"reply", hue:"var(--reach)"};
      case "kit": return {label:"Check the audience", sub:"Media kit received " + W.ago(c.kit.at), icon:"users", hue:"var(--close)", item:"audience:" + c.id};
      case "signed": var best = W.bestBrandFor(c); return {label:best ? "Pitch to " + best.b.name : "Pitch to a brand", sub:best ? "Best match " + best.m.score + "/100 · " + (best.m.why[0] || "") : "No open brand fits yet", icon:"pen", hue:"var(--close)", pitch:best ? best.b.id : null};
      case "parked": return {label:"Back on " + W.fmtDate(c.parkUntil), sub:"Parked: " + (c.parkWhy || "not now"), icon:"alarm", hue:"var(--muted)", waiting:true};
      case "rejected": return {label:"Archived for good " + W.dueText(c.reject.at + D().rules.archiveDays * W.DAY).replace("in ", "in "), sub:"Rejected: " + c.reject.reason, icon:"trash", hue:"var(--muted)", waiting:true};
      case "never": return {label:"Never contact", sub:c.reject ? c.reject.reason : "", icon:"ban", hue:"var(--crit)", waiting:true};
    }
  }
  if (ref.t === "brand"){
    var b = o;
    if (dr) return {label:dr.kind === "reply" ? "Answer their counter-offer" : "Approve the pitch", sub:"Drafted " + W.ago(dr.created), icon:"reply", hue:"var(--close)", item:itemKeyForDraft(dr)};
    if (b.status === "found") return {label:"Qualify " + b.name, sub:"Seen sponsoring " + W.plural(b.seen.length, "of your creators", "of your creators").replace(/^1 of your creators/, "1 of your creators"), icon:"flag", hue:"var(--close)", item:"qualify:" + b.id};
    if (b.status === "qualified") return {label:"Pitch 1–2 signed creators", sub:"Budget " + (b.budget ? W.money(b.budget[0]) + "–" + W.money(b.budget[1]) : "unknown"), icon:"pen", hue:"var(--close)", item:"pitch:" + b.id};
    if (b.status === "pitched") return {label:"Waiting for " + b.name, sub:"Pitched " + W.ago(b.pitched.at) + " · nudge " + W.dueText(b.pitched.at + 5 * W.DAY), icon:"clock", hue:"var(--muted)", waiting:true};
    if (b.status === "negotiating") return {label:"Agree the price", sub:"Negotiation open", icon:"dollar", hue:"var(--close)"};
    if (b.status === "won") return {label:"Pitch the next creator", sub:W.dealsFor(ref).length + " deals so far", icon:"trend", hue:"var(--money)"};
    return {label:"Not a fit", sub:"", icon:"ban", hue:"var(--muted)", waiting:true};
  }
  if (ref.t === "deal"){
    var x = o, st = W.DEAL_FLOW[x.step], open = x.checks.indexOf(false);
    if (x.step === 6 && !x.invoice.sent) return {label:"Send the invoice", sub:"Went live " + W.fmtDay(x.golive) + " · Net 30 starts when it is sent", icon:"wallet", hue:"var(--money)", item:"invoice:" + x.id};
    if (x.step === 8 && !x.invoice.paid) return {label:"Waiting for " + W.brand(x.brand).name + " to pay", sub:"Invoice due " + W.fmtDate(x.invoice.due) + " · creator payout stays locked", icon:"lock", hue:"var(--muted)", waiting:true};
    if (x.step === 8) return {label:"Pay " + W.creator(x.creator).name + " " + W.money(x.payout), sub:"Brand paid " + W.fmtDay(x.invoice.paid), icon:"unlock", hue:"var(--money)", item:"payout:" + x.id};
    return {label:open >= 0 ? st.items[open] : "Move to " + (W.DEAL_FLOW[x.step + 1] || {}).name, sub:st.name + " · step " + (x.step + 1) + " of " + W.DEAL_FLOW.length + (x.due ? " · due " + W.dueText(x.due) : ""), icon:"box", hue:"var(--deliver)", item:"deal:" + x.id};
  }
  return null;
};
W.bestBrandFor = function(c){
  var best = null;
  D().brands.filter(function(b){ return b.status === "qualified" || b.status === "won"; }).forEach(function(b){ var m = W.match(b, c); if (!m.warn.length && (!best || m.score > best.m.score)) best = {b:b, m:m}; });
  return best;
};
function itemKeyForDraft(q){ return (q.kind === "reply" ? "reply:" : q.kind === "followup" ? "followup:" : "send:") + q.id; }
W.itemKeyForDraft = itemKeyForDraft;

/* ---------- Today: the next-action engine ----------
   Every item says what, why now, how long, and which one action finishes it. Buckets run closest-to-money first. */
W.BUCKETS = [
  {k:"money", name:"Get paid", icon:"wallet", hue:"var(--money)", why:"Money already earned: invoices to send, late payments, creator payouts that just unlocked."},
  {k:"deals", name:"Deal steps", icon:"box", hue:"var(--deliver)", why:"Signed deals with a step due in the next two days."},
  {k:"replies", name:"Answer replies", icon:"reply", hue:"var(--reach)", why:"People who wrote back. A same-day answer is the single biggest lever on signing."},
  {k:"sends", name:"Approve emails", icon:"send", hue:"var(--reach)", why:"First emails and pitches Gemini drafted. Nothing goes out until you press Send."},
  {k:"followups", name:"Follow-ups due", icon:"clock", hue:"var(--reach)", why:"Sequences where today is the follow-up day."},
  {k:"close", name:"Sign and pitch", icon:"pen", hue:"var(--close)", why:"Audiences to check, brands to qualify, signed creators to pitch."},
  {k:"contacts", name:"Confirm contacts", icon:"at", hue:"var(--find)", why:"Shortlisted creators whose address nobody has confirmed."},
  {k:"finds", name:"Review new finds", icon:"scan", hue:"var(--find)", why:"Channels today's search kept. Shortlist or reject them."}
];
W.bucket = function(k){ return W.BUCKETS.filter(function(b){ return b.k === k; })[0]; };
W.items = function(scope){
  var d = D(), me = d.me, out = [], now = W.now(), owner = W.member(me).role === "Owner", money = W.canSeeMoney();
  var boss = (d.team.filter(function(m){ return m.role === "Owner"; })[0] || {id:me}).id;
  function add(it){
    if (d.snoozed[it.key] && d.snoozed[it.key] > now) return;
    if (it.b === "money" && !money) return;
    if (scope !== "team" && it.owner && it.owner !== me && !(it.b === "money" && owner)) return;   // the owner always sees money
    out.push(it);
  }
  /* money */
  d.deals.forEach(function(x){
    var b = W.brand(x.brand), c = W.creator(x.creator);
    if (x.step === 6 && !x.invoice.sent) add({key:"invoice:" + x.id, b:"money", kind:"invoice", ref:{t:"deal", id:x.id}, title:"Send " + b.name + "'s invoice", sub:W.money(x.price) + " · " + c.name + " went live " + W.fmtDay(x.golive).toLowerCase(), due:x.golive, est:3, owner:x.owner, why:"Invoices go out on go-live day so the Net 30 clock starts at once. Every day late is a day later you get paid."});
    if (x.invoice.sent && !x.invoice.paid && x.invoice.due <= now + 3 * W.DAY) add({key:"collect:" + x.id, b:"money", kind:"collect", ref:{t:"deal", id:x.id}, title:b.name + " hasn't paid " + W.money(x.price), sub:"Invoice " + x.invoice.no + " · due " + W.fmtShort(x.invoice.due), due:x.invoice.due, est:3, owner:x.owner, why:"Net 30 is up" + (W.dayDiff(x.invoice.due) < 0 ? "" : " soon") + ". " + c.name + "'s " + W.money(x.payout) + " payout waits on this payment."});
    if (x.step === 8 && x.invoice.paid && !x.paidCreator) add({key:"payout:" + x.id, b:"money", kind:"payout", ref:{t:"deal", id:x.id}, title:"Pay " + c.name + " " + W.money(x.payout), sub:b.name + " paid " + W.fmtDay(x.invoice.paid).toLowerCase(), due:x.invoice.paid + 2 * W.DAY, est:2, owner:x.owner, why:"The brand has paid, so the creator's payout is unlocked. Paying fast is why creators come back."});
  });
  /* deals */
  var replyBrands = {}; d.drafts.forEach(function(q){ if (q.deal) replyBrands[q.deal] = true; });
  d.deals.forEach(function(x){
    if (x.step === 6 || x.step === 8 || replyBrands[x.id]) return;
    if (!x.due || x.due > now + 2 * W.DAY) return;
    var st = W.DEAL_FLOW[x.step], open = x.checks.indexOf(false), b = W.brand(x.brand);
    if (x.step === 9) add({key:"deal:" + x.id, b:"deals", kind:"nextdeal", ref:{t:"deal", id:x.id}, title:"Pitch " + b.name + "'s next creator", sub:"Last deal: " + W.fmtK(x.report.views) + " views, " + x.report.ctr + "% click rate", due:x.due, est:5, owner:x.owner, why:"Their last deal is closed and paid. A brand that just saw results is the easiest yes you will get."});
    else add({key:"deal:" + x.id, b:"deals", kind:"deal", ref:{t:"deal", id:x.id}, title:W.dealName(x), sub:st.name + " · " + (open >= 0 ? st.items[open] : "ready to move on"), due:x.due, est:x.step === 7 ? 8 : 4, owner:x.owner, why:st.name + " is due " + W.dueText(x.due) + "." + (st.ordered ? " " + st.note : "")});
  });
  /* drafts */
  d.drafts.forEach(function(q){
    var o = W.rec(q.to), owner = o ? (o.owner || me) : me;
    if (q.to.t === "brand") owner = q.deal ? W.deal(q.deal).owner || boss : boss;
    var last = W.lastIn(q.to);
    if (q.kind === "reply") add({key:"reply:" + q.id, b:"replies", kind:"reply", ref:q.to, draft:q.id, title:o.name + (q.to.t === "brand" ? " countered" : " replied"), sub:last && last.ai ? W.maskMoney(last.ai.intent) : "Reply drafted", due:last ? last.at : q.created, age:true, est:q.to.t === "brand" ? 6 : 3, owner:owner, why:last && last.ai ? last.ai.summary : "They wrote back."});
    else if (q.kind === "followup") add({key:"followup:" + q.id, b:"followups", kind:"followup", ref:q.to, draft:q.id, title:"Follow-up " + q.n + " to " + o.name, sub:"No reply since " + W.fmtShort((o.seq && o.seq.steps[0].at) || q.created), due:W.now(), est:1, owner:owner, quick:true, why:"Follow-up " + q.n + " of 3 is due today. Most replies come after a follow-up, not the first email."});
    else add({key:"send:" + q.id, b:"sends", kind:"send", ref:q.to, draft:q.id, title:W.KIND[q.kind] + " to " + o.name, sub:q.gates.length ? "Needs you: " + gateShort(q.gates[0]) : "Ready to send", due:null, est:q.kind === "pitch" ? 4 : 1.5, owner:owner, quick:!q.gates.length, why:q.why});
  });
  /* close */
  d.creators.forEach(function(c){ if (c.stage === "kit") add({key:"audience:" + c.id, b:"close", kind:"audience", ref:{t:"creator", id:c.id}, title:"Check " + c.name + "'s audience", sub:"Media kit in " + W.ago(c.kit.at) + " · rate " + W.money(c.kit.rate), due:null, est:3, owner:c.owner, why:"Only creators with a US/UK/CA/AU-led audience of buying age get signed. The kit is here, so this is a two-minute decision."}); });
  d.brands.forEach(function(b){
    var pending = d.drafts.some(function(q){ return q.to.t === "brand" && q.to.id === b.id; });
    if (b.status === "found") add({key:"qualify:" + b.id, b:"close", kind:"qualify", ref:{t:"brand", id:b.id}, title:"Qualify " + b.name, sub:b.sells + " · seen with " + W.plural(b.seen.length, "creator"), due:null, est:4, owner:boss, why:"Brands already sponsoring channels like yours are the warmest leads. Check budget and find a contact."});
    if (b.status === "qualified" && !pending) add({key:"pitch:" + b.id, b:"close", kind:"pitch", ref:{t:"brand", id:b.id}, title:"Pitch creators to " + b.name, sub:b.sells + " · " + (b.budget ? W.money(b.budget[0]) + "–" + W.money(b.budget[1]) : "budget unknown"), due:null, est:5, owner:boss, why:"Qualified with a contact and budget. Pitch one or two signed creators who fit."});
  });
  /* contacts */
  d.creators.forEach(function(c){ if (c.stage === "shortlisted") add({key:"contact:" + c.id, b:"contacts", kind:"contact", ref:{t:"creator", id:c.id}, title:"Confirm " + c.name + "'s email", sub:c.email ? c.emailSrc + " · " + Math.round(c.emailConf * 100) + "% sure" : (c.finding ? "Looking for an address…" : "No address found yet"), due:null, est:2, owner:c.owner, quick:!!c.email, why:"A first email to a guessed address bounces and hurts the mailbox. Confirm before anything is sent."}); });
  /* finds */
  var nf = d.creators.filter(function(c){ return c.stage === "new"; });
  if (nf.length) add({key:"finds", b:"finds", kind:"finds", ref:null, title:W.plural(nf.length, "new channel") + " to review", sub:"From today's search · " + nf.filter(W.gold).length + " look like gold mines", due:null, est:Math.max(2, Math.round(nf.length * .5)), owner:null, why:"Kept by your search rules. Each one takes about 30 seconds: shortlist or reject."});
  var order = {}; W.BUCKETS.forEach(function(b, i){ order[b.k] = i; });
  out.sort(function(a, b){
    if (order[a.b] !== order[b.b]) return order[a.b] - order[b.b];
    var ad = a.due == null ? Infinity : a.due, bd = b.due == null ? Infinity : b.due;
    return ad - bd;
  });
  return out;
};
function gateShort(g){ return g.k === "unconfirmed" ? "address not confirmed" : g.k === "price" ? "confirm the price" : g.k === "cap" ? "mailbox nearly full" : g.text; }
W.gateShort = gateShort;
W.KIND = {first:"First email", followup:"Follow-up", reply:"Reply", pitch:"Pitch", golive:"Go-live email", nudge:"Payment reminder", report:"30-day report", upsell:"Next-deal pitch"};
W.phaseCounts = function(items){
  var c = {find:0, reach:0, close:0, deliver:0};
  items.forEach(function(it){
    if (it.b === "finds") c.find += W.D().creators.filter(function(x){ return x.stage === "new"; }).length;
    else if (it.b === "contacts") c.find++;
    else if (it.b === "replies" || it.b === "sends" || it.b === "followups") c.reach++;
    else if (it.b === "close") c.close++;
    else c.deliver++;
  });
  return c;
};
W.tomorrow = function(){
  var d = D(), t0 = W.at(1, 0), t1 = W.at(2, 0), out = [];
  d.creators.forEach(function(c){ (c.seq ? c.seq.steps : []).forEach(function(s){ if (s.st === "planned" && s.at >= t0 && s.at < t1) out.push({icon:"clock", text:(s.k === "fu1" ? "Follow-up 1" : s.k === "fu2" ? "Follow-up 2" : "Follow-up 3") + " to " + c.name}); }); });
  d.deals.forEach(function(x){ if (x.due >= t0 && x.due < t1) out.push({icon:"box", text:W.dealName(x) + " · " + W.DEAL_FLOW[x.step].name}); if (x.golive >= t0 && x.golive < t1) out.push({icon:"video", text:W.creator(x.creator).name + " goes live for " + W.brand(x.brand).name}); });
  return out;
};

/* ---------- draft text helpers ---------- */
function firstName(o){ return o.contact || ""; }
W.makeFirst = function(c){
  var m = c.moment ? c.moment.split(" ")[0] : null, quote = c.moment && c.moment.indexOf("\"") >= 0 ? c.moment.split("\"")[1] : null;
  var v = c.videos[0] ? c.videos[0].t : "your latest video";
  return {id:W.uid("q"), kind:"first", to:{t:"creator", id:c.id}, mailbox:"m1", created:W.now(), subject:(quote || v).toLowerCase().slice(0, 52),
    body:"Hi" + (firstName(c) ? " " + firstName(c) : " there") + ",\n\n\"" + v + "\"" + (m ? " was great, and the bit at " + m + " stuck with me" : " was a great watch") + ". That is exactly the kind of result AI tool brands want to show their buyers.\n\nWe help AI creators land paid integrations with tools they'd use anyway. Open to hearing about one or two?\n\nMoustafa, Gratovo",
    why:"First email: one real moment from their latest video, a short bridge, one yes-or-no question.", rules:["INF-FIRST-02","FND-WRITE-11"], gates:c.confirmed ? [] : [{k:"unconfirmed", text:"Nobody has confirmed this address yet."}]};
};
W.STEER = {
  shorter:function(t){ var p = t.split(/\n\n/); if (p.length > 3) return [p[0], p[1].split(". ")[0] + ".", p[p.length - 2], p[p.length - 1]].join("\n\n"); return t.split(". ").slice(0, 3).join(". "); },
  warmer:function(t){ return t.replace(/^(Hi[^\n]*\n\n)/, "$1Hope your week is off to a good start. "); },
  direct:function(t){ return t.replace(/Hope your week is off to a good start\. /, "").replace(/just floating this back up in case it got buried\. /i, "").replace(/Totally fair\. /, ""); },
  redo:function(t, q){ var o = W.rec(q.to); return t.replace(/^Hi([^\n]*)\n\n[^\n]*/, "Hi$1\n\n" + (o && o.videos && o.videos[1] ? "\"" + o.videos[1].t + "\" is the one I keep sending people." : "Your recent videos are the clearest in the niche.")); }
};

/* ---------- actions ---------- */
var A = W.A = {};
function markDone(d, key, title, b, min){ d.done = d.done.filter(function(x){ return x.key !== key; }); d.done.unshift({key:key, title:title, b:b, at:W.now(), min:min || 1}); }
A.markDone = markDone;

A.sendDraft = function(id, opts){
  opts = opts || {};
  var q = W.draft(id); if (!q) return;
  if (q.gates.some(function(g){ return !g.ok; })){ W.toast({msg:"This email still needs you", sub:q.gates.filter(function(g){ return !g.ok; }).map(function(g){ return g.text; })[0], icon:"alert", tone:"warn"}); return false; }
  var o = W.rec(q.to), mb = W.mailbox(q.mailbox), label = (W.KIND[q.kind] || "Email") + " to " + o.name, next = "";
  if (mb && !opts.at && W.mailboxBlocked(mb)){
    var nm = mb.addr.split("@")[0], alt = W.D().mail.filter(function(m){ return m.id !== mb.id && !W.mailboxBlocked(m); }).sort(W.by(function(m){ return m.cap - m.sent; }, -1))[0];
    W.toast({msg:"Not sent: " + nm + " " + W.mailboxBlocked(mb), sub:alt ? "Send it from " + alt.addr.split("@")[0] + " instead, or schedule it for tomorrow." : "No mailbox can send today. Schedule it for tomorrow.", icon:"alert", tone:"warn",
      actions:alt ? [{label:"Send from " + alt.addr.split("@")[0], run:function(){ A.setMailbox(id, alt.id); A.sendDraft(id, opts); }}] : []});
    return false;
  }
  if (opts.at) label = "Scheduled " + label.toLowerCase();
  /* say what happens next before it happens, so the toast can carry it */
  var t0 = opts.at || W.now();
  if (q.to.t === "creator"){
    if (q.kind === "first") next = "Follow-up 1 is planned for " + W.fmtDate(t0 + 3 * W.DAY) + ".";
    else if (q.kind === "followup" && o.seq){ var nx0 = o.seq.steps.filter(function(s){ return s.st === "planned" && s.k !== "fu" + q.n; })[0]; next = nx0 ? "Next follow-up " + W.dueText(nx0.at) + "." : "That was the last follow-up. If they stay quiet, the sequence closes in 7 days."; }
    else if (q.kind === "reply") next = q.after && q.after.park ? "Parked until " + W.fmtDate(q.after.park) + ". It comes back to Today on its own." : "Waiting for their answer. It lands back in Today when they write.";
  } else {
    if (q.kind === "pitch") next = "If " + o.name + " is quiet for 5 days, a nudge appears in Today.";
    else if (q.kind === "nudge") next = "If it is still unpaid in 5 days, it comes back here.";
    else next = "Waiting for " + o.name + ". The negotiation log is updated.";
  }
  return W.act(label, function(d){
    d.drafts = d.drafts.filter(function(x){ return x.id !== id; });
    var th = d.threads[q.to.id] = d.threads[q.to.id] || [];
    th.push({dir:"out", at:opts.at || W.now(), text:q.body, by:d.me, scheduled:!!opts.at, mailbox:mb.addr});
    var m = d.mail.filter(function(x){ return x.id === q.mailbox; })[0]; if (m && !opts.at) m.sent++;
    var oo = q.to.t === "creator" ? d.creators.filter(function(x){ return x.id === q.to.id; })[0] : d.brands.filter(function(x){ return x.id === q.to.id; })[0];
    if (q.to.t === "creator"){
      if (q.kind === "first"){
        var t = opts.at || W.now();
        oo.stage = "emailed";
        oo.seq = {steps:[{k:"first", at:t, st:"sent"},{k:"fu1", at:t + 3 * W.DAY, st:"planned"},{k:"fu2", at:t + 7 * W.DAY, st:"planned"},{k:"fu3", at:t + 14 * W.DAY, st:"planned"}]};
      } else if (q.kind === "followup" && oo.seq){
        oo.seq.steps.forEach(function(s){ if (s.k === "fu" + q.n) { s.st = "sent"; s.at = W.now(); } });
      } else if (q.kind === "reply"){
        if (q.after && q.after.park){ oo.stage = "parked"; oo.parkUntil = q.after.park; oo.parkWhy = "Booked until the new year"; }
      }
    } else {
      if (q.kind === "pitch"){ oo.status = "pitched"; oo.pitched = {at:W.now(), creators:q.creators || []};  }
      if (q.kind === "reply" && q.deal){ var x = d.deals.filter(function(z){ return z.id === q.deal; })[0]; if (x && x.neg){ var amt = (q.body.match(/\$([\d,]+)/) || [])[1]; if (amt){ x.neg.hist.push({who:"us", amt:+amt.replace(/,/g, ""), at:W.now(), note:"Our answer"}); x.neg.ask = +amt.replace(/,/g, ""); } }  }
    }
    markDone(d, opts.key || itemKeyForDraft(q), label, opts.bucket || (q.kind === "reply" ? "replies" : q.kind === "followup" ? "followups" : "sends"), q.kind === "reply" ? 3 : 1.5);
  }, {ref:q.to, toast:{msg:opts.at ? "Scheduled for " + W.fmtDate(opts.at) + " " + W.fmtTime(opts.at) : "Sent to " + o.name, sub:(opts.at ? "" : "From " + mb.addr + ". ") + next, icon:"send", ms:10000}});
};
/* why a mailbox can't send right now, in words; "" when it can */
W.mailboxBlocked = function(m){ return m.status === "error" ? "is signed out" : m.paused ? "is paused" : m.sent >= m.cap ? "has used all " + m.cap + " sends today" : ""; };
A.confirmGate = function(qid, k){ W.act("Confirmed " + (k === "price" ? "the price" : "the warning") + " on an email", function(d){ var q = d.drafts.filter(function(x){ return x.id === qid; })[0]; q.gates.forEach(function(g){ if (g.k === k) g.ok = true; }); }, {log:false}); };
A.editDraft = function(id, patch){ var q = W.draft(id); if (!q) return; Object.assign(q, patch, {edited:true}); W.emit(); };
A.setMailbox = function(id, mid){ W.act("Changed the sending mailbox", function(d){ d.drafts.filter(function(x){ return x.id === id; })[0].mailbox = mid; }, {log:false}); };
A.steer = function(id, how){
  var q = W.draft(id); if (!q || q.rewriting) return;
  q.rewriting = how; W.emit();
  var data0 = W.S.state.data;
  setTimeout(function(){
    var cur = W.draft(id); if (!cur) return;
    if (W.S.state.data !== data0){ if (cur.rewriting){ cur.rewriting = null; W.emit(); } return; }
    W.act("Rewrote an email: " + (how === "redo" ? "new angle" : how), function(d){
      var x = d.drafts.filter(function(z){ return z.id === id; })[0];
      x.rewriting = null; x.prev = x.body; x.body = W.STEER[how](x.body, x); x.steered = how;
    }, {log:false, toast:{msg:how === "redo" ? "New version written" : "Rewritten " + how, sub:"Gemini kept the house rules. Undo brings the old text back.", icon:"sparkle", tone:"info", ms:4000}});
  }, 900);
};
A.skipDraft = function(id, key){
  var q = W.draft(id); if (!q) return;
  W.act("Skipped " + (W.KIND[q.kind] || "email").toLowerCase() + " to " + W.toName(q), function(d){
    d.drafts = d.drafts.filter(function(x){ return x.id !== id; });
    if (q.kind === "followup"){ var c = d.creators.filter(function(x){ return x.id === q.to.id; })[0]; if (c && c.seq) c.seq.steps.forEach(function(s){ if (s.k === "fu" + q.n) s.st = "skipped"; }); }
    markDone(d, key || itemKeyForDraft(q), "Skipped: " + (W.KIND[q.kind] || "email") + " to " + W.toName(q), "sends", .2);
  }, {ref:q.to, toast:{msg:"Skipped", sub:q.kind === "followup" ? "The next follow-up stays planned." : "The draft is gone. The creator stays where they were.", icon:"arrowR", tone:"info"}});
};
A.snooze = function(key, until, title){
  W.act("Snoozed " + (title || "an item") + " until " + W.fmtDate(until) + " " + W.fmtTime(until), function(d){ d.snoozed[key] = until; },
    {toast:{msg:"Back " + (W.dayDiff(until) === 0 ? "today at " + W.fmtTime(until) : W.fmtDay(until).toLowerCase() + " at " + W.fmtTime(until)), sub:title || "", icon:"alarm", tone:"info"}});
};
A.handOff = function(key, ref, to, note, title){
  var m = W.member(to);
  W.act("Handed " + (title || W.refName(ref)) + " to " + m.name, function(d){
    var o = ref.t === "creator" ? d.creators.filter(function(x){ return x.id === ref.id; })[0] : ref.t === "brand" ? d.brands.filter(function(x){ return x.id === ref.id; })[0] : d.deals.filter(function(x){ return x.id === ref.id; })[0];
    if (o) o.owner = to;
    d.handed[key] = {to:to, note:note || "", at:W.now()};
  }, {ref:ref, toast:{msg:m.name + " has it now", sub:note ? "\"" + note + "\"" : "It moved to " + m.name + "'s Today.", icon:"forward", tone:"info"}});
};
A.assign = function(ref, to){ A.handOff("assign:" + ref.id, ref, to, "", W.refName(ref)); };

/* find */
A.shortlist = function(ids, opts){
  opts = opts || {};
  var names = ids.map(function(id){ return W.creator(id).name; });
  W.act(ids.length === 1 ? "Shortlisted " + names[0] : "Shortlisted " + ids.length + " channels", function(d){
    d.creators.forEach(function(c){ if (ids.indexOf(c.id) >= 0){ c.stage = "shortlisted"; c.owner = c.owner || d.me; c.finding = !c.email; if (c.email && !c.cands.length) c.cands = [{email:c.email, src:c.emailSrc, conf:c.emailConf}]; } });
  }, {toast:opts.quiet ? null : {msg:ids.length === 1 ? names[0] + " shortlisted" : ids.length + " shortlisted", sub:"Looking for missing emails in the background. They land in Confirm contacts.", icon:"check", go:{label:"Contacts", run:function(){ W.go("find", "contacts"); }}}});
  W.startJob({kind:"contacts", label:"Finding emails for " + W.plural(ids.length, "channel"), total:ids.length, ids:ids});
};
A.reject = function(ids, reason, opts){
  opts = opts || {};
  var one = ids.length === 1 ? W.creator(ids[0]).name : null;
  W.act(one ? "Rejected " + one + " (" + reason.toLowerCase() + ")" : "Rejected " + ids.length + " channels", function(d){
    d.creators.forEach(function(c){ if (ids.indexOf(c.id) >= 0){ c.stage = "rejected"; c.reject = {reason:reason, at:W.now(), by:d.me}; } });
  }, {toast:opts.quiet ? null : {msg:one ? one + " rejected" : ids.length + " rejected", sub:reason + ". Archived for good in " + W.D().rules.archiveDays + " days; bring back any time before.", icon:"x", tone:"info"}});
};
A.restore = function(id){ var c = W.creator(id); W.act("Brought back " + c.name, function(){ c.stage = "new"; c.reject = null; }, {toast:{msg:c.name + " is back in New finds", icon:"undo", tone:"info"}}); };
A.never = function(id, reason){ var c = W.creator(id); W.act("Marked " + c.name + " as never contact", function(d){ var x = d.creators.filter(function(z){ return z.id === id; })[0]; x.stage = "never"; x.reject = {reason:reason || "Never contact", at:W.now(), by:d.me}; d.drafts = d.drafts.filter(function(q){ return !(q.to.t === "creator" && q.to.id === id); }); }, {ref:{t:"creator", id:id}, toast:{msg:c.name + " will never be emailed", sub:"Searches skip this channel and drafts to it are deleted.", icon:"ban", tone:"info"}}); };
A.confirmEmail = function(cid, email){
  var c = W.creator(cid), had = W.draftsFor({t:"creator", id:cid}).length > 0;
  W.act("Confirmed " + c.name + "'s email", function(d){
    var x = d.creators.filter(function(z){ return z.id === cid; })[0];
    x.email = email; x.confirmed = true; x.finding = false;
    var cand = x.cands.filter(function(k){ return k.email === email; })[0]; if (cand){ x.emailSrc = cand.src; x.emailConf = cand.conf; }
    if (x.stage === "shortlisted") x.stage = "contact";
    d.drafts.forEach(function(q){ if (q.to.t === "creator" && q.to.id === cid) q.gates = q.gates.filter(function(g){ return g.k !== "unconfirmed"; }); });
    if (!d.drafts.some(function(q){ return q.to.t === "creator" && q.to.id === cid; })) d.drafts.push(W.makeFirst(x));
    markDone(d, "contact:" + cid, "Confirmed " + x.name + "'s email", "contacts", 2);
  }, {ref:{t:"creator", id:cid}, toast:{msg:"Confirmed " + email, sub:had ? "The first email can go now: the warning on it is gone." : "Gemini drafted the first email. It is waiting in Approve emails.", icon:"at", go:{label:"Review it", run:function(){ W.go("today", null); W.ui(function(u){ var q = W.draftsFor({t:"creator", id:cid})[0]; if (q) u.todaySel = itemKeyForDraft(q); }); }}}});
};
A.saveFact = function(ref, msgAt, k){
  W.act("Saved a fact from " + W.refName(ref) + "'s reply", function(d){
    var th = d.threads[ref.id], msg = th.filter(function(m){ return m.at === msgAt; })[0], f = msg.ai.facts.filter(function(x){ return x.k === k; })[0];
    var c = d.creators.filter(function(z){ return z.id === ref.id; })[0];
    f.saved = true;
    if (c){
      if (k === "rate") c.rate = f.v;
      if (k === "countries") c.countries = f.v;
      if (k === "age") c.age = f.v;
      if (k === "park"){ c.stage = "parked"; c.parkUntil = f.v; }
      if (c.rate && c.countries.length && (c.stage === "replied")){ c.stage = "kit"; c.kit = {at:msgAt, rate:c.rate, countries:c.countries, age:c.age, eng:c.eng, file:null, fromReply:true}; }
    }
  }, {ref:ref, toast:{msg:"Saved to " + W.refName(ref), sub:k === "rate" ? "Rate is now on the record and in pricing." : k === "countries" ? "Audience saved. The audience check can run." : "Saved.", icon:"check"}});
};
A.pasteReply = function(ref, text){
  var o = W.rec(ref), t = text.trim(); if (!t) return;
  var rate = (t.match(/\$\s?([\d,]{3,6})/) || [])[1], facts = [];
  if (rate) facts.push({k:"rate", label:"Rate", v:+rate.replace(/,/g, ""), show:"$" + rate});
  W.act("Added a pasted reply to " + o.name, function(d){
    var th = d.threads[ref.id] = d.threads[ref.id] || [];
    th.push({dir:"in", at:W.now(), text:t, pasted:true, ai:{intent:/not now|later|busy|booked/i.test(t) ? "Not now" : /\$|rate|price|budget/i.test(t) ? "Talks about price" : "Replied", summary:"Pasted by you. Gemini read it like any other reply.", facts:facts, next:"Answer it; a draft is ready."}});
    if (ref.t === "creator"){ var c = d.creators.filter(function(z){ return z.id === ref.id; })[0]; if (c.stage === "emailed") { c.stage = "replied"; if (c.seq) c.seq.stopped = "replied"; } }
    d.drafts.push({id:W.uid("q"), kind:"reply", to:ref, mailbox:"m1", created:W.now(), subject:"Re: our last email", body:"Hi" + (o.contact ? " " + o.contact.split(" ")[0] : "") + ",\n\nThanks for getting back to me. " + (rate ? "$" + rate + " works as a starting point. " : "") + "Could you share your top countries and age range from YouTube Studio? Then I can bring you a concrete offer.\n\nMoustafa", why:"Answer to the reply you pasted in.", rules:["INF-REPLY-03"], gates:[]});
  }, {ref:ref, toast:{msg:"Reply added to " + o.name, sub:"Follow-ups stopped. A draft answer is waiting in Answer replies.", icon:"paste"}});
};
A.sign = function(cid){
  var c = W.creator(cid);
  W.act("Signed " + c.name, function(d){ var x = d.creators.filter(function(z){ return z.id === cid; })[0]; x.stage = "signed"; if (x.kit){ x.rate = x.kit.rate; } markDone(d, "audience:" + cid, "Signed " + x.name, "close", 3); },
    {ref:{t:"creator", id:cid}, toast:{msg:c.name + " is signed", sub:"On the roster now, ready to pitch to brands.", icon:"pen", go:{label:"Roster", run:function(){ W.go("close", "roster"); }}}});
};
A.declineKit = function(cid){
  var c = W.creator(cid);
  W.act("Declined " + c.name + " (audience)", function(d){ var x = d.creators.filter(function(z){ return z.id === cid; })[0]; x.stage = "rejected"; x.reject = {reason:"Audience outside US/UK/CA/AU", at:W.now(), by:d.me};
    d.drafts.push({id:W.uid("q"), kind:"reply", to:{t:"creator", id:cid}, mailbox:"m1", created:W.now(), subject:"Re: sponsors", body:"Hi " + (x.contact || "there") + ",\n\nThank you for sending this over. Right now our brands are looking for audiences led by the US, UK, Canada and Australia, so I don't have a fit for you today. I'll reach out as soon as one comes in.\n\nMoustafa", why:"Polite no that keeps the door open.", rules:["INF-DECLINE-01"], gates:[]});
    markDone(d, "audience:" + cid, "Declined " + x.name, "close", 2); },
    {ref:{t:"creator", id:cid}, toast:{msg:"Declined " + c.name, sub:"A short, kind reply is drafted for you to send.", icon:"x", tone:"info"}});
};
A.park = function(cid, until, why){ var c = W.creator(cid); W.act("Parked " + c.name + " until " + W.fmtDate(until), function(d){ var x = d.creators.filter(function(z){ return z.id === cid; })[0]; x.stage = "parked"; x.parkUntil = until; x.parkWhy = why || "Not now"; }, {ref:{t:"creator", id:cid}, toast:{msg:c.name + " parked until " + W.fmtDate(until), sub:"Comes back to Today on its own.", icon:"alarm", tone:"info"}}); };

/* close */
A.qualify = function(bid, patch){
  var b = W.brand(bid);
  W.act("Qualified " + b.name, function(d){ var x = d.brands.filter(function(z){ return z.id === bid; })[0]; Object.assign(x, patch || {}); x.status = "qualified"; markDone(d, "qualify:" + bid, "Qualified " + x.name, "close", 4); },
    {ref:{t:"brand", id:bid}, toast:{msg:b.name + " qualified", sub:"Next: pitch one or two signed creators. It is in Sign and pitch.", icon:"flag"}});
};
A.notFit = function(bid){ var b = W.brand(bid); W.act("Marked " + b.name + " as not a fit", function(d){ d.brands.filter(function(z){ return z.id === bid; })[0].status = "lost"; markDone(d, "qualify:" + bid, b.name + ": not a fit", "close", 1); }, {ref:{t:"brand", id:bid}, toast:{msg:b.name + " set aside", sub:"Not a fit. It stays searchable.", icon:"x", tone:"info"}}); };
A.draftPitch = function(bid, cids){
  var b = W.brand(bid), cs = cids.map(W.creator);
  var lines = cs.map(function(c){ return c.name + " (" + W.fmtK(c.subs) + " subscribers, " + W.fmtK(c.median) + " median views, " + (c.countries[0] ? c.countries[0][1] + "% " + c.countries[0][0] : "") + ")"; });
  var id = W.uid("q");
  W.act("Drafted a pitch to " + b.name, function(d){
    d.drafts.push({id:id, kind:"pitch", to:{t:"brand", id:bid}, creators:cids, mailbox:"m1", created:W.now(), subject:cs.map(function(c){ return c.name; }).join(" + ") + " for " + b.name,
      body:"Hi " + (b.contact ? b.contact.split(" ")[0] : "there") + ",\n\n" + (cs.length === 1 ? "One creator" : "Two creators") + " your buyers already watch:\n\n" + lines.map(function(l){ return "• " + l; }).join("\n") + "\n\nBoth make honest, hands-on videos about AI tools like " + b.sells.toLowerCase() + ". A 60–90 second integration starts at " + W.money(W.priceFor(cs[0])) + ". Worth a quick call this week?\n\nMoustafa, Gratovo",
      why:"Pitch: 1–2 signed creators with the numbers a buyer checks first, one price anchor, one easy next step.", rules:["BRD-PITCH-02","BRD-PRICE-09"], gates:[{k:"price", text:"This pitch names a price: " + W.money(W.priceFor(cs[0])) + ". Confirm it before sending."}]});
    markDone(d, "pitch:" + bid, "Drafted a pitch to " + b.name, "close", 4);
  }, {ref:{t:"brand", id:bid}, toast:{msg:"Pitch to " + b.name + " drafted", sub:"It waits in Approve emails with the price check.", icon:"sparkle", go:{label:"Review", run:function(){ W.go("today"); W.ui(function(u){ u.todaySel = "send:" + id; }); }}}});
  return id;
};
A.counter = function(dealId, amt){
  var x = W.deal(dealId), b = W.brand(x.brand), c = W.creator(x.creator);
  W.act("Set the counter-offer for " + W.dealName(x) + " to " + W.money(amt), function(d){
    var q = d.drafts.filter(function(z){ return z.deal === dealId; })[0];
    var body = "Hi " + b.contact.split(" ")[0] + ",\n\nThanks for coming back quickly. " + (amt >= x.neg.ask ? c.name + "'s dedicated videos run at " + W.money(amt) + ", and his last one passed 146K views in six days." : "We can meet you at " + W.money(amt) + " for the dedicated video, with paid usage limited to 30 days.") + " I can hold the late-November slot for you. Shall I send the details?\n\nMoustafa";
    if (q){ q.body = body; q.gates = [{k:"price", text:"This email names a price: " + W.money(amt) + ". Confirm it before sending."}]; }
  }, {ref:{t:"deal", id:dealId}, toast:{msg:"Counter set to " + W.money(amt), sub:"The reply to " + b.name + " is rewritten with it.", icon:"dollar", tone:"info"}});
};

/* deliver */
A.tick = function(dealId, i){
  var x = W.deal(dealId), st = W.DEAL_FLOW[x.step];
  if (st.ordered && i > 0 && !x.checks[i - 1] && !x.checks[i]){ W.toast({msg:"Not yet", sub:st.note, icon:"lock", tone:"warn"}); return; }
  if (st.lockedUntilPaid && !x.invoice.paid){ W.toast({msg:"Locked until " + W.brand(x.brand).name + " pays", sub:"Creators are paid from money already received.", icon:"lock", tone:"warn"}); return; }
  var turningOn = !x.checks[i], last = turningOn && x.checks.filter(Boolean).length === x.checks.length - 1;
  var label = (turningOn ? "Ticked " : "Unticked ") + "\"" + st.items[i] + "\" on " + W.dealName(x);
  W.act(label, function(d){
    var y = d.deals.filter(function(z){ return z.id === dealId; })[0];
    y.checks[i] = !y.checks[i];
    if (st.ordered && !y.checks[i]) for (var j = i + 1; j < y.checks.length; j++) y.checks[j] = false;
    if (last) advance(d, y);
  }, {ref:{t:"deal", id:dealId}, toast:last ? {msg:st.name + " done", sub:W.dealName(x) + " moved to " + (W.DEAL_FLOW[x.step + 1] || {name:"done"}).name + ".", icon:"checkc"} : null});
};
function advance(d, y, quiet){
  var from = y.step;
  if (y.step < W.DEAL_FLOW.length - 1){ y.step++; y.checks = W.DEAL_FLOW[y.step].items.map(function(){ return false; }); }
  if (W.DEAL_FLOW[y.step].k === "golive" && !y.golive) y.golive = W.now();
  if (W.DEAL_FLOW[y.step].k === "invoice") y.due = y.golive;
  if (W.DEAL_FLOW[y.step].k === "report"){ y.report = y.report || {views:null, clicks:null, ctr:null}; y.report.due = (y.golive || W.now()) + 30 * W.DAY; y.due = y.report.due; }
  if (W.DEAL_FLOW[y.step].k === "pay") y.due = y.invoice.paid ? W.now() : y.invoice.due;
  if (W.DEAL_FLOW[y.step].k === "next") y.due = W.now() + W.DAY;
  if (!quiet) markDone(d, "deal:" + y.id, W.DEAL_FLOW[from].name + " done for " + W.dealName(y), "deals", 4);
}
A.advance = function(dealId){ var x = W.deal(dealId); W.act("Moved " + W.dealName(x) + " to " + (W.DEAL_FLOW[x.step + 1] || {}).name, function(d){ advance(d, d.deals.filter(function(z){ return z.id === dealId; })[0]); }, {ref:{t:"deal", id:dealId}, toast:{msg:"Moved to " + (W.DEAL_FLOW[x.step + 1] || {}).name, icon:"arrowR"}}); };
A.sendInvoice = function(dealId){
  var x = W.deal(dealId), b = W.brand(x.brand), due = W.now() + 30 * W.DAY;
  W.act("Sent " + b.name + "'s invoice " + (x.invoice.no || ""), function(d){
    var y = d.deals.filter(function(z){ return z.id === dealId; })[0];
    y.invoice.no = y.invoice.no || "GR-2026-0" + (30 + d.deals.indexOf(y)); y.invoice.sent = W.now(); y.invoice.due = due; y.checks = [true];
    markDone(d, "invoice:" + dealId, "Sent " + b.name + "'s invoice", "money", 3);
    advance(d, y, true);
  }, {ref:{t:"deal", id:dealId}, toast:{msg:"Invoice sent to " + b.name, sub:W.money(x.price) + " due " + W.fmtDate(due) + ". You'll see it here 3 days before.", icon:"wallet"}});
};
A.markPaid = function(dealId, when){
  var x = W.deal(dealId), b = W.brand(x.brand), c = W.creator(x.creator);
  W.act("Marked " + b.name + " as paid (" + W.money(x.price) + ")", function(d){ var y = d.deals.filter(function(z){ return z.id === dealId; })[0]; y.invoice.paid = when || W.now(); if (y.step === 8) y.due = W.now(); markDone(d, "collect:" + dealId, b.name + " paid " + W.money(x.price), "money", 1); },
    {ref:{t:"deal", id:dealId}, toast:{msg:W.money(x.price) + " received from " + b.name, sub:c.name + "'s " + W.money(x.payout) + " payout is unlocked.", icon:"unlock"}});
};
A.nudge = function(dealId){
  var x = W.deal(dealId), b = W.brand(x.brand), id = W.uid("q");
  W.act("Drafted a payment reminder to " + b.name, function(d){
    d.drafts.push({id:id, kind:"nudge", to:{t:"brand", id:x.brand}, deal:dealId, mailbox:"m1", created:W.now(), subject:"Invoice " + x.invoice.no + " · " + W.money(x.price),
      body:"Hi " + b.contact.split(" ")[0] + ",\n\nA quick note that invoice " + x.invoice.no + " for " + W.money(x.price) + " (" + W.creator(x.creator).name + "'s video, live " + W.fmtShort(x.golive) + ") was due on " + W.fmtShort(x.invoice.due) + ". Could you check where it is with your finance team?\n\nThanks,\nMoustafa",
      why:"Friendly, specific reminder: invoice number, amount, the video, the due date.", rules:["BRD-PAY-01"], gates:[]});
  }, {ref:{t:"deal", id:dealId}, toast:{msg:"Reminder drafted", sub:"Check it and send. It is in Approve emails.", icon:"mail", go:{label:"Review", run:function(){ W.ui(function(u){ u.todaySel = "send:" + id; }); W.go("today"); }}}});
};
A.payCreator = function(dealId){
  var x = W.deal(dealId), c = W.creator(x.creator);
  W.act("Paid " + c.name + " " + W.money(x.payout), function(d){ var y = d.deals.filter(function(z){ return z.id === dealId; })[0]; y.paidCreator = W.now(); y.checks = [true]; markDone(d, "payout:" + dealId, "Paid " + c.name + " " + W.money(x.payout), "money", 2); advance(d, y, true); },
    {ref:{t:"deal", id:dealId}, toast:{msg:"Paid " + c.name + " " + W.money(x.payout), sub:"Margin on this deal: " + W.money(x.price - x.payout) + ". Next: pitch " + W.brand(x.brand).name + " again.", icon:"wallet"}});
};
A.sendReport = function(dealId){
  var x = W.deal(dealId), b = W.brand(x.brand);
  W.act("Sent the 30-day report to " + b.name, function(d){ var y = d.deals.filter(function(z){ return z.id === dealId; })[0]; y.report.sent = W.now(); y.checks = y.checks.map(function(){ return true; }); markDone(d, "deal:" + dealId, "Sent " + b.name + " the 30-day report", "deals", 8); advance(d, y, true); },
    {ref:{t:"deal", id:dealId}, toast:{msg:"30-day report sent to " + b.name, sub:x.invoice.paid ? "Payout is unlocked." : "The creator's payout unlocks when " + b.name + " pays.", icon:"chart"}});
};

/* ---------- background jobs (search runs, email finding) ---------- */
W.startJob = function(j){ W.ui(function(u){ u.jobs = u.jobs.concat([Object.assign({id:W.uid("j"), progress:0, started:W.now()}, j)]); }); };
W.tickJobs = function(){
  var u = W.U(); if (!u.jobs.length) return;
  var changed = false;
  u.jobs.forEach(function(j){
    if (j.done) return;
    if (j.kind === "contacts"){
      j.progress += 1; changed = true;
      if (j.progress >= 3){
        j.done = true;
        var found = 0;
        W.bg(function(d){ d.creators.forEach(function(c){ if (j.ids.indexOf(c.id) >= 0 && c.finding){ c.finding = false; var h = W.hash(c.id);
          if (h % 4 !== 0){ var dom = c.handle.slice(1) + (h % 2 ? ".com" : ".io"); c.cands = [{email:"hello@" + dom, src:"About page", conf:.9},{email:c.handle.slice(1) + "@gmail.com", src:"Guessed from the channel name", conf:.52}]; c.email = c.cands[0].email; c.emailSrc = c.cands[0].src; c.emailConf = .9; } } }); });
        j.ids.forEach(function(id){ var c = W.creator(id); if (c && c.email && !c.confirmed) found++; });
        if (found) W.D().notifs.unshift({id:W.uid("n"), at:W.now(), icon:"at", text:W.plural(found, "email") + " found, ready to confirm", sub:"Find · Contacts", go:{s:"find", tab:"contacts"}, read:false});
        W.toast({msg:W.plural(found, "email") + " found", sub:"Confirm them before the first email goes out.", icon:"at", tone:"info", actions:[{label:"Confirm", run:function(){ W.go("find", "contacts"); }}]});
      }
    }
    if (j.kind === "search") changed = W.tickSearch(j) || changed;
  });
  u.jobs = u.jobs.filter(function(j){ return !j.done || W.now() - (j.doneAt || (j.doneAt = W.now())) < 6000; });
  if (changed) W.emit();
};
function runIn(dd, id){ return dd.runs.filter(function(x){ return x.id === id; })[0]; }
W.tickSearch = function(j){
  var d = W.D(), r = runIn(d, j.run);
  if (!r || r.status !== "running"){ j.done = true; return true; }
  j.sub = (j.sub || 0) + 1;
  var kw = r.kws[r.cur], cur = r.cur;
  if (!kw){ W.bg(function(dd){ var rr = runIn(dd, j.run); if (rr) rr.status = "done"; }); j.done = true; return true; }
  if (kw.st !== "running") W.bg(function(dd){ var rr = runIn(dd, j.run), k = rr && rr.kws[cur]; if (k && k.st !== "done") k.st = "running"; });
  j.label = "Searching \"" + kw.q + "\""; j.progress = cur; j.total = r.kws.length;
  if (j.sub % 4 === 0){
    var h = W.hash(kw.q), found = 6 + h % 11, kept = 1 + h % 3, at = W.now(), base = d.poolI;
    var stop = cur + 1 >= (r.stopAt || r.kws.length), fin = cur + 1 >= r.kws.length;
    var tot = {found:r.found + found, archived:r.archived + found - kept, videos:r.videos + found * 5, kept:r.kept + kept, gold:r.gold + (kept > 1 ? 1 : 0)};
    var log = r.log.concat([[at, "\"" + kw.q + "\" · " + found + " channels, " + kept + " kept"]]).concat(stop ? [[at, fin ? "Run finished" : "Paused after keyword " + (cur + 1) + " (demo stops here) · everything found is saved"]] : []);
    var added = [], nid = W.uid("n");
    W.bg(function(dd){
      var rr = runIn(dd, j.run); if (!rr) return;
      var k2 = rr.kws[cur]; if (k2){ k2.st = "done"; k2.found = found; k2.kept = kept; }
      Object.assign(rr, tot, {cur:cur + 1, log:log.slice(), status:stop ? (fin ? "done" : "paused") : rr.status});
      for (var i = 0; i < kept; i++){
        var p = dd.pool[(base + i) % dd.pool.length]; var id = "p" + ((base + i) % dd.pool.length);
        if (dd.creators.some(function(c){ return c.id === id; })) continue;
        dd.creators.push({id:id, name:p[0], handle:p[1], subs:p[4], median:p[3], up30:3 + (W.hash(p[1]) % 5), lastUp:1 + W.hash(p[0]) % 6, videos:[{t:p[2], v:Math.round(p[3] * 1.15), ago:2, dur:"12:" + (10 + W.hash(p[2]) % 49)},{t:"What I learned this month", v:p[3], ago:9, dur:"10:41"},{t:"Q&A: tools I use", v:Math.round(p[3] * .9), ago:16, dur:"14:05"}],
          sponsors:[], email:null, emailSrc:null, emailConf:0, confirmed:false, contact:"", cands:[], countries:[["US",30 + W.hash(p[0]) % 15],["GB",8 + W.hash(p[1]) % 7],["CA",5 + W.hash(p[2]) % 5]], age:"18–34", eng:3.5 + (W.hash(p[0]) % 30) / 10,
          stage:"new", owner:null, rate:0, moment:"", run:r.id, found:W.now(), tags:[], notes:[], seq:null, kit:null, reject:null, before:null, pay:null, fresh:true});
        added.push(p[0]);
      }
      dd.poolI = base + kept;
      if (stop){
        var fr = dd.creators.filter(function(c){ return c.stage === "new" && c.fresh; }).length;
        if (!dd.notifs.some(function(n){ return n.id === nid; })) dd.notifs.unshift({id:nid, at:at, icon:"scan", text:"Search " + (fin ? "finished" : "paused") + ": " + W.plural(fr, "new channel") + " kept", sub:"Find · Review", go:{s:"find", tab:"triage"}, read:false});
      }
    });
    if (stop){
      j.done = true;
      var fresh = W.D().creators.filter(function(c){ return c.stage === "new" && c.fresh; }).length;
      W.toast({msg:"Search " + (fin ? "finished" : "paused"), sub:W.plural(fresh, "new channel") + " kept and waiting for review.", icon:"scan", tone:"info", actions:[{label:"Review", run:function(){ W.go("find", "triage"); }}]});
    }
  }
  return true;
};
/* problems: something behind the app is broken and work is blocked until it is fixed */
W.problems = function(){
  var d = D(), out = [], h = d.health || {};
  d.mail.forEach(function(m){ if (m.status === "error") out.push({k:"mail-" + m.id, text:m.addr.split("@")[0] + " is signed out of Gmail.", sub:m.note || "", act:{label:"Sign in again", run:function(){ A.reconnectMailbox(m.id); }}}); });
  if (h.gemini === "offline") out.push({k:"gemini", text:"The Gemini bridge is offline.", sub:"Drafts can't be written or rewritten until it answers again.", act:{label:"Reconnect", run:A.reconnectGemini}});
  d.runs.forEach(function(r){ if (r.status === "failed") out.push({k:"run-" + r.id, text:"Today's search stopped at keyword " + (r.cur + 1) + ".", sub:(r.err || "It hit an error") + ". Everything found is saved.", act:{label:"Open the search", run:function(){ W.go("find", "search"); }}}); });
  return out;
};
A.reconnectMailbox = function(id){
  var m = W.mailbox(id);
  W.act("Signed " + m.addr.split("@")[0] + " back in to Gmail", function(d){ var x = d.mail.filter(function(z){ return z.id === id; })[0]; x.status = x.warm && !x.warm.done ? "warming" : x.bounce > 3 ? "slowed" : "good"; delete x.err; delete x.note; },
    {toast:{msg:m.addr.split("@")[0] + " is signed in again", sub:"Sending from it resumes with the next approved email.", icon:"mail"}});
};
A.reconnectGemini = function(){
  W.act("Reconnected the Gemini bridge", function(d){ d.health = Object.assign({}, d.health, {gemini:"ok"}); },
    {toast:{msg:"The Gemini bridge answered", sub:"Drafts and rewrites work again.", icon:"sparkle"}});
};
A.startRun = function(runId){
  var d = W.D(), r = runIn(d, runId);
  if (!r) return;
  var cur = r.cur, stopAt = Math.min(r.kws.length, cur + 4), line = [W.now(), (cur ? "Resumed at keyword " + (cur + 1) : "Run started") + " on this computer"];
  W.bg(function(dd){
    var rr = runIn(dd, runId); if (!rr) return;
    rr.status = "running"; rr.stopAt = stopAt; delete rr.err; rr.log = rr.log.concat([line]);
    if (dd.health && dd.health.youtube === "quota") dd.health = Object.assign({}, dd.health, {youtube:"ok"});
  });
  W.startJob({kind:"search", run:runId, label:"Searching", total:r.kws.length, progress:cur});
  W.emit();
};
A.pauseRun = function(runId){
  var d = W.D(), r = runIn(d, runId); if (!r) return;
  var line = [W.now(), "Paused at keyword " + (r.cur + 1) + " by you · everything found is saved"];
  W.bg(function(dd){ var rr = runIn(dd, runId); if (!rr) return; rr.status = "paused"; if (rr.kws[rr.cur] && rr.kws[rr.cur].st === "running") rr.kws[rr.cur].st = "queued"; rr.log = rr.log.concat([line]); });
  W.ui(function(u){ u.jobs.forEach(function(j){ if (j.run === runId) j.done = true; }); });
  W.toast({msg:"Search paused", sub:"Everything found so far is saved. Resume picks up at keyword " + (r.cur + 1) + ".", icon:"pause", tone:"info"});
};
})();
