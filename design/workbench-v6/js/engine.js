/* engine.js — the V6 business brain.
   Lookups, scoring (12-video outlier-trimmed views, bot detection, 1–5 star rubric, Brokered vs Exclusive 25% math),
   the next-action engine that feeds Today and every record, Playbook Linter (P1–P7 compliant),
   and W.A: every action an operator can take across all 16 permanent IMA systems. */
(function(){
"use strict";
var W = window.W;
function D(){ return W.D(); }

/* ---------- lookups ---------- */
function find(list, id){ if (!list) return null; for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
W.creator = function(id){ return find(D().creators, id); };
W.manager = function(id){ return find(D().managers, id); };
W.brand = function(id){ return find(D().brands, id); };
W.deal = function(id){ return find(D().deals, id); };
W.draft = function(id){ return find(D().drafts, id); };
W.member = function(id){
  var m = find(D().team, id) || {id:id, name:"Nobody", role:""};
  var nm = id === "u1" && W.myName ? W.myName() : "";
  return nm ? Object.assign({}, m, {name:nm}) : m;
};
W.canSeeMoney = function(){ var d = D(), r = W.member(d.me).role || ""; return r === "Owner" || /Account/.test(r) || d.settings.vaMoney === "show"; };
W.isShadowVA = function(){ var d = D(), r = W.member(d.me).role || ""; return /^VA/.test(r) && (d.settings.vaApproval || "shadow") === "shadow"; };
W.mailbox = function(id){ return find(D().mail, id); };
W.rec = function(ref){ return !ref ? null : ref.t === "creator" ? W.creator(ref.id) : ref.t === "brand" ? W.brand(ref.id) : ref.t === "deal" ? W.deal(ref.id) : ref.t === "manager" ? W.manager(ref.id) : null; };
W.dealName = function(x){ var b = W.brand(x.brand), c = W.creator(x.creator); return (b ? b.name : "?") + " × " + (c ? c.name : "?"); };
W.refName = function(ref){ var r = W.rec(ref); if (!r) return "?"; return ref.t === "deal" ? W.dealName(r) : r.name; };
W.toName = function(dr){ var r = W.rec(dr.to); return r ? r.name : "?"; };
W.toAddr = function(dr){ var r = W.rec(dr.to); return r ? (dr.toEmail || r.email) : null; };
W.threadOf = function(ref){ return D().threads[ref.id] || []; };
W.lastIn = function(ref){ var t = W.threadOf(ref); for (var i = t.length - 1; i >= 0; i--) if (t[i].dir === "in") return t[i]; return null; };
W.draftsFor = function(ref){ return D().drafts.filter(function(q){ return q.to.t === ref.t && q.to.id === ref.id; }); };
W.dealsFor = function(ref){ return D().deals.filter(function(x){ return ref.t === "creator" ? x.creator === ref.id : ref.t === "brand" ? x.brand === ref.id : x.id === ref.id; }); };
W.owned = function(o){ return !o.owner || o.owner === D().me; };

/* ---------- System 1 & 2: Scoring, 12-Video Trimmed Average, Bot Detection & Pricing ---------- */
W.topOk = function(countries){ var top = (countries || []).slice(0, 3); return top.length > 0 && top.some(function(c){ return D().rules.audience.top3.indexOf(c[0]) >= 0; }) && top[0] && D().rules.audience.top3.indexOf(top[0][0]) >= 0; };
W.usShare = function(countries){ return W.sum((countries || []).filter(function(c){ return ["US","GB","CA","AU"].indexOf(c[0]) >= 0; }), function(c){ return c[1]; }); };
W.fit = function(c){
  var r = [];
  var baseViews = c.trimmedAvgViews || c.median || 0;
  var mv = Math.round(Math.min(1, baseViews / 90000) * 30); r.push({k:"12-vid trimmed avg", pts:mv, of:30, note:W.fmtK(baseViews) + " avg (" + W.fmtK(c.median) + " median)"});
  var up = c.up30 >= 4 ? 15 : c.up30 === 3 ? 10 : c.up30 >= 1 ? 4 : 0; if (c.up30 > 20) up = 6; r.push({k:"Posting & format", pts:up, of:15, note:c.up30 + " uploads/30d · " + (c.format || "Talking-head")});
  var share = W.usShare(c.countries), au = Math.round(Math.min(1, share / 55) * 25); r.push({k:"US/UK/CA/AU audience", pts:au, of:25, note:c.countries.length ? share + "% in the top 3" : "not known yet"});
  var en = Math.round(Math.min(1, (c.eng || 0) / 6) * 15); if (c.botRisk && c.botRisk.level === "high") en = Math.min(en, 4);
  r.push({k:"Authenticity & Eng.", pts:en, of:15, note:(c.eng || "?") + "% · " + (c.botRisk ? c.botRisk.level : "clean")});
  var sp = c.sponsors.length ? 15 : 0; r.push({k:"Sponsored before", pts:sp, of:15, note:c.sponsors.length ? c.sponsors.join(", ") : "no sponsors seen"});
  return {score:W.sum(r, function(x){ return x.pts; }), parts:r};
};
W.gold = function(c){ return (c.trimmedAvgViews || c.median) >= 40000 && c.median / Math.max(c.subs, 1) >= .4 && c.up30 >= 3 && c.up30 <= 20 && (!c.botRisk || c.botRisk.level === "clean"); };
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

/* System 2 & 8: Pricing Calculator supporting Brokered Markup vs Exclusive 25% Commission + Multi-Format Multipliers (HC-04, HC-26, HC-30, HC-34, BRD-OFFER-21, INF-PRICE-13) */
W.priceFor = function(c, opts){
  opts = opts || {};
  var views = c.trimmedAvgViews || c.median || 45000;
  var cpmBase = Math.round(views / 1000 * (D().rules.cpm || 40) / 50) * 50;
  var basePrice;
  if (c.relationshipModel === "exclusive_25"){
    /* Exclusive 25% management: creator's rate IS 75% of the gross brand price (or gross = rate / 0.75) */
    var grossFromRate = c.rate ? Math.round((c.rate / 0.75) / 50) * 50 : cpmBase;
    basePrice = Math.max(cpmBase, grossFromRate);
  } else {
    var withMargin = Math.round((c.rate || 0) * (1 + (D().rules.markup || 60) / 100) / 50) * 50;
    basePrice = Math.max(cpmBase, withMargin);
  }
  var mult = 1.0;
  if (opts.format === "shoutout_30s") mult = 0.70;            /* BRD-OFFER-21 */
  else if (opts.format === "dedicated") mult = 2.50;          /* INF-PRICE-13 */
  else if (opts.format === "short_reel") mult = 0.65;         /* HC-34 */
  var price = Math.round(basePrice * mult / 50) * 50;
  if (opts.whitelisting30d) price = Math.round(price * 1.25 / 50) * 50; /* HC-30 +25% */
  if (opts.bundleCount && opts.bundleCount >= 3) price = Math.round(price * opts.bundleCount * 0.92 / 50) * 50; /* HC-26 3-video bundle -8% */
  return price;
};
W.payoutFor = function(c, grossPrice){
  if (c.relationshipModel === "exclusive_25") return Math.round(grossPrice * 0.75 / 50) * 50;
  return c.rate || Math.round(grossPrice * 0.62 / 50) * 50;
};

/* System 8: HC-26 3-Option Package Menu Builder (EX-33) */
W.buildPackagesFor = function(b, cs){
  if (b && !cs && (b.median != null || b.trimmedAvgViews != null)){ cs = [b]; b = D().brands[0]; }
  cs = (cs && cs.length) ? cs : D().creators.filter(function(c){ return c.stage === "signed"; }).slice(0, 2);
  var c0 = cs[0] || D().creators[0];
  var singlePrice = W.priceFor(c0);
  var bundle3Price = W.priceFor(c0, {bundleCount:3});
  var multiPrice = W.sum(cs, function(c){ return W.priceFor(c); }) + Math.round(W.priceFor(c0, {format:"short_reel"}) * 0.85 / 50) * 50;
  return [
    {k:"optA", name:"Option A · Single Test Integration", price:singlePrice, desc:"1 × 60–90s first-third YouTube integration on " + c0.name + " (" + W.fmtK(c0.trimmedAvgViews || c0.median) + " avg views) + top-3-line UTM link + pinned comment."},
    {k:"optB", name:"Option B · 3-Video Momentum Bundle (-8%)", price:bundle3Price, desc:"3 × 60–90s integrations across consecutive uploads on " + c0.name + " to build compounding recall (BRD-PRES-05) + link-in-bio + pinned comment."},
    {k:"optC", name:"Option C · Multi-Creator Category Takeover", price:multiPrice, desc:cs.map(function(c){ return c.name; }).join(" + ") + " (" + W.fmtK(W.sum(cs, function(c){ return c.trimmedAvgViews || c.median; })) + " combined avg views) + 1 YouTube Short cutdown + 30-day whitelisting."}
  ];
};

W.match = function(b, c){
  var f = W.fit(c).score, pts = Math.round(f * .6), why = [], warn = [];
  var ourPast = D().deals.some(function(x){ return x.brand === b.id && x.creator === c.id; });
  if (c.sponsors.indexOf(b.name) >= 0){
    if (b.status === "won" || ourPast){ pts += 15; why.push("Proven repeat fit with " + b.name); }
    else { pts -= 10; warn.push("Sponsored by " + b.name + " directly before (check with creator first, BRD-PRES-13)"); }
  }
  /* System 5: Check active Category Exclusivity Lock Calendar (INF-REPLY-32, BRD-PRES-22) */
  var activeLock = (c.exclusivityLocks || []).filter(function(lk){ return lk.cat === b.cat && lk.brand.toLowerCase() !== b.name.toLowerCase() && lk.until > W.now(); })[0];
  if (activeLock){
    pts -= 25;
    warn.push("Exclusivity lock in '" + activeLock.cat + "' (" + activeLock.brand + ") until " + W.fmtShort(activeLock.until));
  }
  var compSpons = (c.sponsors || []).filter(function(sn){
    if (sn === b.name) return false;
    var sb = D().brands.filter(function(z){ return z.name.toLowerCase() === sn.toLowerCase(); })[0];
    return sb && sb.cat === b.cat;
  });
  if (compSpons.length && !activeLock){ pts -= 12; warn.push("Promoted competitor " + compSpons[0] + " recently (verify 30d window, BRD-PRES-22)"); }
  /* Check creator hard-no categories (INF-ONB-06) */
  if (c.onboarding && c.onboarding.dreamBrands && c.onboarding.dreamBrands.indexOf(b.name) >= 0){
    pts += 10; why.push(b.name + " is on " + c.name + "'s Dream Brands list");
  }
  var us = W.usShare(c.countries); if (b.country === "US" && (c.countries[0] || [])[0] === "US"){ pts += 10; why.push("US-led audience for a US brand"); }
  else if (us >= 50){ pts += 6; why.push(us + "% of the top 3 are US/UK/CA/AU"); }
  var price = W.priceFor(c);
  if (b.budget){ if (price <= b.budget[1]){ pts += 12; why.push("Quote " + W.money(price) + " fits " + W.money(b.budget[0]) + "–" + W.money(b.budget[1])); } else { warn.push("Quote " + W.money(price) + " is above their " + W.money(b.budget[1]) + " ceiling"); } }
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
    if (dr) return {label:dr.kind === "reply" ? "Answer their reply" : dr.kind === "followup" ? "Send follow-up " + dr.n + " of 3" : "Approve the first email", sub:"Drafted " + W.ago(dr.created) + " · waiting for you", icon:dr.kind === "reply" ? "reply" : "send", hue:"var(--reach)", item:itemKeyForDraft(dr), qid:dr.id};
    switch (c.stage){
      case "new": return {label:"Shortlist or reject", sub:"Found " + W.ago(c.found) + (c.run ? " in today's search" : ""), icon:"scan", hue:"var(--find)", item:"finds"};
      case "shortlisted": return {label:"Confirm the email address", sub:c.email ? "Found automatically, nobody has checked it" : "No address yet", icon:"at", hue:"var(--find)", item:"contact:" + c.id};
      case "contact": return {label:"Draft the first email", sub:"Contact confirmed", icon:"send", hue:"var(--reach)"};
      case "emailed":
        var nx = (c.seq && c.seq.steps.filter(function(s){ return s.st !== "sent" && s.st !== "skipped"; })[0]);
        if (!nx && c.seq && !c.seq.stopped) return {label:"Sequence finished · Send Closing Email or Park 90d", sub:"All 3 follow-ups sent (INF-FU-14 / HC-01)", icon:"alarm", hue:"var(--reach)", waiting:true};
        return {label:nx ? (nx.k === "fu1" ? "Follow-up 1" : nx.k === "fu2" ? "Follow-up 2" : "Follow-up 3 (Closing)") + " " + W.dueText(nx.at) : "Sequence finished", sub:"Waiting for a reply · first email " + (c.seq && c.seq.steps[0] ? W.fmtShort(c.seq.steps[0].at) : ""), icon:"clock", hue:"var(--reach)", waiting:true};
      case "replied":
        var th = W.threadOf(ref), lastM = th[th.length - 1];
        if (lastM && lastM.dir === "out"){
          var stalled = W.now() - lastM.at >= 2 * W.DAY;
          return stalled ? {label:"Nudge for audience analytics", sub:"Asked " + W.ago(lastM.at) + " · stalled exchange (HC-12)", icon:"reply", hue:"var(--reach)", item:"stalled:" + c.id}
            : {label:"Waiting for their media kit", sub:"You asked " + W.ago(lastM.at) + " · nudge " + W.dueText(lastM.at + 2 * W.DAY), icon:"clock", hue:"var(--reach)", waiting:true};
        }
        return {label:"Ask for the media kit", sub:"They replied " + W.ago((W.lastIn(ref) || {}).at || W.now()), icon:"reply", hue:"var(--reach)"};
      case "kit": return {label:"Check the audience", sub:"Media kit received " + W.ago(c.kit.at), icon:"users", hue:"var(--close)", item:"audience:" + c.id};
      case "signed":
        if (c.daysSinceUpdate >= 10) return {label:"Send 14-day roster warmth update", sub:c.daysSinceUpdate + " days since last update · keep creator warm (HC-29)", icon:"coffee", hue:"var(--close)", warmth:c.id};
        var best = W.bestBrandFor(c); return {label:best ? "Pitch to " + best.b.name : "Pitch to a brand", sub:best ? "Best match " + best.m.score + "/100 · " + (best.m.why[0] || "") : "No open brand fits yet", icon:"pen", hue:"var(--close)", pitch:best ? best.b.id : null};
      case "parked": return {label:"Back on " + W.fmtDate(c.parkUntil), sub:"Parked: " + (c.parkWhy || "not now"), icon:"alarm", hue:"var(--muted)", waiting:true};
      case "rejected": return {label:"Archived for good " + W.dueText(c.reject.at + D().rules.archiveDays * W.DAY).replace("in ", "in "), sub:"Rejected: " + c.reject.reason, icon:"trash", hue:"var(--muted)", waiting:true};
      case "never": return {label:"Never contact", sub:c.reject ? c.reject.reason : "", icon:"ban", hue:"var(--crit)", waiting:true};
    }
  }
  if (ref.t === "brand"){
    var b = o;
    if (dr) return {label:dr.kind === "reply" ? "Answer their counter-offer" : "Approve the pitch", sub:"Drafted " + W.ago(dr.created), icon:"reply", hue:"var(--close)", item:itemKeyForDraft(dr), qid:dr.id};
    if (b.status === "found") return {label:"Qualify " + b.name, sub:"Seen sponsoring " + W.plural(b.seen.length, "of your creators", "of your creators"), icon:"flag", hue:"var(--close)", item:"qualify:" + b.id};
    if (b.status === "qualified") return {label:"Pitch 1–2 signed creators", sub:"Budget " + (b.budget ? W.money(b.budget[0]) + "–" + W.money(b.budget[1]) : "unknown"), icon:"pen", hue:"var(--close)", item:"pitch:" + b.id};
    if (b.status === "pitched"){
      var ndDue = b.pitched && W.now() >= b.pitched.at + 5 * W.DAY;
      return ndDue ? {label:"Send 5-day nudge to " + b.name, sub:"Pitched " + W.ago(b.pitched.at) + " · no answer yet (HC-24)", icon:"clock", hue:"var(--close)", item:"bnudge:" + b.id}
        : {label:"Waiting for " + b.name, sub:"Pitched " + W.ago(b.pitched.at) + " · nudge " + W.dueText(b.pitched.at + 5 * W.DAY), icon:"clock", hue:"var(--muted)", waiting:true};
    }
    if (b.status === "negotiating") return {label:"Agree the price", sub:"Negotiation open", icon:"dollar", hue:"var(--close)"};
    if (b.status === "won") return {label:"Pitch the next creator", sub:W.dealsFor(ref).length + " deals so far", icon:"trend", hue:"var(--money)"};
    return {label:"Not a fit", sub:"", icon:"ban", hue:"var(--muted)", waiting:true};
  }
  if (ref.t === "deal"){
    var x = o, st = W.DEAL_FLOW[x.step], open = x.checks.indexOf(false);
    if (x.step === 6 && !x.invoice.sent) return {label:"Send the invoice", sub:"Went live " + W.fmtDay(x.golive) + " · Net 30 starts on go-live day", icon:"wallet", hue:"var(--money)", item:"invoice:" + x.id};
    if (x.invoice.paid && !x.paidCreator && x.step >= 6) return {label:"Pay " + W.creator(x.creator).name + " " + W.money(x.payout), sub:"Brand paid " + W.fmtDay(x.invoice.paid), icon:"unlock", hue:"var(--money)", item:"payout:" + x.id};
    if (x.step === 8 && !x.invoice.paid) return {label:"Waiting for " + W.brand(x.brand).name + " to pay", sub:"Invoice due " + W.fmtDate(x.invoice.due) + " · creator payout stays locked", icon:"lock", hue:"var(--muted)", waiting:true};
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
W.itemTitle = function(key){
  var d = D(), meta = (d.snoozeMeta || {})[key]; if (meta && meta.title) return meta.title;
  var p = String(key || "").split(":"), k = p[0], id = p[1];
  if (k === "reply" || k === "followup" || k === "send"){ var q = W.draft(id); if (q) return (W.KIND[q.kind] || "Email") + " to " + W.toName(q); }
  if (k === "invoice"){ var x1 = W.deal(id); if (x1) return "Send " + W.brand(x1.brand).name + "'s invoice"; }
  if (k === "collect"){ var x2 = W.deal(id); if (x2) return W.brand(x2.brand).name + " invoice " + (x2.invoice.no || ""); }
  if (k === "payout"){ var x3 = W.deal(id); if (x3) return "Pay " + W.creator(x3.creator).name; }
  if (k === "deal"){ var x4 = W.deal(id); if (x4) return W.dealName(x4); }
  if (k === "audience"){ var c1 = W.creator(id); if (c1) return "Check " + c1.name + "'s audience"; }
  if (k === "contact"){ var c2 = W.creator(id); if (c2) return "Confirm " + c2.name + "'s email"; }
  if (k === "qualify"){ var b1 = W.brand(id); if (b1) return "Qualify " + b1.name; }
  if (k === "pitch"){ var b2 = W.brand(id); if (b2) return "Pitch creators to " + b2.name; }
  if (k === "bnudge"){ var b3 = W.brand(id); if (b3) return "Follow up with " + b3.name; }
  if (k === "stalled"){ var c3 = W.creator(id); if (c3) return "Nudge " + c3.name + " for analytics"; }
  if (k === "warmth"){ var c4 = W.creator(id); if (c4) return "Send 14d warmth update to " + c4.name; }
  if (k === "finds") return "Review new channels";
  return key;
};

/* ---------- Today: the next-action engine ---------- */
W.BUCKETS = [
  {k:"money", name:"Get paid", icon:"wallet", hue:"var(--money)", why:"Money already earned: invoices to send, late payments, creator payouts that just unlocked."},
  {k:"deals", name:"Deal steps", icon:"box", hue:"var(--deliver)", why:"Signed deals with a step due in the next two days."},
  {k:"replies", name:"Answer replies", icon:"reply", hue:"var(--reach)", why:"People who wrote back. A same-day answer is the single biggest lever on signing."},
  {k:"sends", name:"Approve emails", icon:"send", hue:"var(--reach)", why:"First emails and pitches Gemini drafted. Nothing goes out until you press Send."},
  {k:"followups", name:"Follow-ups due", icon:"clock", hue:"var(--reach)", why:"Sequences where today is the follow-up day, plus 14-day creator warmth pulses."},
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
    if (scope !== "team" && it.owner && it.owner !== me && !(it.b === "money" && owner)) return;
    out.push(it);
  }
  /* money */
  d.deals.forEach(function(x){
    var b = W.brand(x.brand), c = W.creator(x.creator);
    if (x.step === 6 && !x.invoice.sent) add({key:"invoice:" + x.id, b:"money", kind:"invoice", ref:{t:"deal", id:x.id}, title:"Send " + b.name + "'s invoice", sub:W.money(x.price) + " · " + c.name + " went live " + W.fmtDay(x.golive).toLowerCase(), due:x.golive, est:3, owner:x.owner, why:"Invoices go out on go-live day so the Net 30 clock starts at once. Every day late is a day later you get paid."});
    if (x.invoice.sent && !x.invoice.paid && x.invoice.due <= now + 3 * W.DAY) add({key:"collect:" + x.id, b:"money", kind:"collect", ref:{t:"deal", id:x.id}, title:b.name + " hasn't paid " + W.money(x.price), sub:"Invoice " + x.invoice.no + " · due " + W.fmtShort(x.invoice.due), due:x.invoice.due, est:3, owner:x.owner, why:"Net 30 is up" + (W.dayDiff(x.invoice.due) < 0 ? "" : " soon") + ". " + c.name + "'s " + W.money(x.payout) + " payout waits on this payment."});
    if (x.invoice.paid && !x.paidCreator && x.step >= 6) add({key:"payout:" + x.id, b:"money", kind:"payout", ref:{t:"deal", id:x.id}, title:"Pay " + c.name + " " + W.money(x.payout), sub:b.name + " paid " + W.fmtDay(x.invoice.paid).toLowerCase(), due:x.invoice.paid + 2 * W.DAY, est:2, owner:x.owner, why:"The brand has paid, so the creator's payout is unlocked. Paying fast is why creators come back."});
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
    if (q.to.t === "brand" || q.gates.some(function(g){ return (g.k === "price" || g.k === "claim" || g.k === "va_shadow") && !g.ok; })) owner = q.deal ? W.deal(q.deal).owner || boss : boss;
    var last = W.lastIn(q.to);
    if (q.kind === "reply") add({key:"reply:" + q.id, b:"replies", kind:"reply", ref:q.to, draft:q.id, title:o.name + (q.to.t === "brand" ? " countered" : " replied"), sub:last && last.ai ? W.maskMoney(last.ai.intent) : "Reply drafted", due:last ? last.at : q.created, age:true, est:q.to.t === "brand" ? 6 : 3, owner:owner, why:last && last.ai ? W.maskMoney(last.ai.summary) : "They wrote back."});
    else if (q.kind === "followup") add({key:"followup:" + q.id, b:"followups", kind:"followup", ref:q.to, draft:q.id, title:"Follow-up " + q.n + " to " + o.name, sub:"No reply since " + W.fmtShort((o.seq && o.seq.steps[0].at) || q.created), due:W.now(), est:1, owner:owner, quick:true, why:"Follow-up " + q.n + " of 3 is due today. Most replies come after a follow-up, not the first email."});
    else add({key:"send:" + q.id, b:"sends", kind:"send", ref:q.to, draft:q.id, title:(W.KIND[q.kind] || "Email") + " to " + o.name, sub:q.gates.length ? "Needs you: " + gateShort(q.gates[0]) : "Ready to send", due:null, est:q.kind === "pitch" ? 4 : 1.5, owner:owner, quick:!q.gates.length, why:q.why});
  });
  /* stalled warm replies (HC-12) */
  d.creators.forEach(function(c){
    if (c.stage !== "replied" || W.draftsFor({t:"creator", id:c.id}).length) return;
    var th = W.threadOf({t:"creator", id:c.id}), lastM = th[th.length - 1];
    if (lastM && lastM.dir === "out" && now - lastM.at >= 2 * W.DAY){
      add({key:"stalled:" + c.id, b:"followups", kind:"stalled", ref:{t:"creator", id:c.id}, title:"Nudge " + c.name + " for analytics", sub:"You asked " + W.ago(lastM.at) + " · no reply yet", due:lastM.at + 2 * W.DAY, est:1.5, owner:c.owner || boss, quick:true, why:"Two working days since you asked for their audience tab (HC-12). A short nudge keeps the warm conversation moving."});
    }
  });
  /* System 3: Signed-Creator 14-Day Warmth Pulse (HC-29, INF-ONB-02) */
  d.creators.forEach(function(c){
    if (c.stage === "signed" && c.daysSinceUpdate >= 10 && !W.draftsFor({t:"creator", id:c.id}).length){
      add({key:"warmth:" + c.id, b:"followups", kind:"warmth", ref:{t:"creator", id:c.id}, title:"Send 14d warmth update to " + c.name, sub:c.daysSinceUpdate + " days since last update · prevent roster churn (HC-29)", due:now, est:1.5, owner:c.owner || boss, quick:true, why:"Signed creators go cold if they don't hear from us every 10–14 days while we hunt brand deals (HC-29)."});
    }
  });
  /* close */
  d.creators.forEach(function(c){ if (c.stage === "kit") add({key:"audience:" + c.id, b:"close", kind:"audience", ref:{t:"creator", id:c.id}, title:"Check " + c.name + "'s audience", sub:"Media kit in " + W.ago(c.kit.at) + " · rate " + W.money(c.kit.rate), due:null, est:3, owner:c.owner || boss, why:"Only creators with a US/UK/CA/AU-led audience of buying age get signed. The kit is here, so this is a two-minute decision."}); });
  d.brands.forEach(function(b){
    var pending = d.drafts.some(function(q){ return q.to.t === "brand" && q.to.id === b.id; });
    if (b.status === "found") add({key:"qualify:" + b.id, b:"close", kind:"qualify", ref:{t:"brand", id:b.id}, title:"Qualify " + b.name, sub:b.sells + " · seen with " + W.plural(b.seen.length, "creator"), due:null, est:4, owner:boss, why:"Brands already sponsoring channels like yours are the warmest leads. Check budget and find a contact."});
    if (b.status === "qualified" && !pending) add({key:"pitch:" + b.id, b:"close", kind:"pitch", ref:{t:"brand", id:b.id}, title:"Pitch creators to " + b.name, sub:b.sells + " · " + (b.budget ? W.money(b.budget[0]) + "–" + W.money(b.budget[1]) : "budget unknown"), due:null, est:5, owner:boss, why:"Qualified with a contact and budget. Pitch one or two signed creators who fit."});
    if (b.status === "pitched" && !pending && b.pitched && now >= b.pitched.at + 5 * W.DAY) add({key:"bnudge:" + b.id, b:"followups", kind:"bnudge", ref:{t:"brand", id:b.id}, title:"Follow up with " + b.name + " on pitch", sub:"Pitched " + W.ago(b.pitched.at) + " · 5-day nudge due", due:b.pitched.at + 5 * W.DAY, est:2, owner:boss, quick:true, why:"Five days since your pitch with no reply (HC-24). Draft a short follow-up with a fresh proof point."});
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
function gateShort(g){ return g.k === "unconfirmed" ? "address not confirmed" : g.k === "price" ? "confirm the price" : g.k === "claim" ? "verify track-record claim" : g.k === "phishing" ? "personal @gmail brand warning" : g.k === "cc_leak" ? "cross-party CC blocked" : g.k === "va_shadow" ? "needs owner approval" : g.k === "cap" ? "mailbox nearly full" : g.text; }
W.gateShort = gateShort;
W.KIND = {first:"First email", followup:"Follow-up", reply:"Reply", pitch:"Pitch", golive:"Go-live email", nudge:"Payment reminder", report:"30-day report", upsell:"Next-deal pitch", warmth:"Warmth pulse", relay:"Deal relay"};
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

/* ---------- P2 Fixed: Truthful Brand Stage Phrasing (INF-FIRST-21) ---------- */
function firstName(o){ return (o.contact && o.contact.trim()) ? o.contact.trim().split(" ")[0] : (o.name ? o.name.split(" ")[0] : ""); }
W.truthfulBrandBridge = function(c){
  var won = D().brands.filter(function(b){ return b.status === "won" && (c.sponsors || []).indexOf(b.name) < 0; });
  var active = D().brands.filter(function(b){ return (b.status === "pitched" || b.status === "negotiating") && (c.sponsors || []).indexOf(b.name) < 0; });
  var prospect = D().brands.filter(function(b){ return (b.status === "qualified" || b.status === "found") && (c.sponsors || []).indexOf(b.name) < 0; });
  if (won.length >= 2){
    return "We work with " + won[0].name + " and " + won[1].name + " and are booking their November creator slots right now.";
  }
  if (active.length >= 1 && won.length >= 1){
    return "We work with " + won[0].name + " and are planning a November campaign for " + active[0].name + ", and your audience fits what they look for.";
  }
  if (prospect.length >= 2){
    return "We are looking to pair you with brands like " + prospect[0].name + " and " + prospect[1].name + " next month, and your audience fits what they look for.";
  }
  return "We are looking to pair you with developer brands like Inboxly and Agentic HQ next month.";
};

W.makeFirst = function(c, mIdx){
  var mList = c.moments && c.moments.length ? c.moments : [];
  var chosen = mList[mIdx != null ? mIdx : (c.momentIdx || 0)] || null;
  var m = chosen ? chosen.at : (c.moment ? c.moment.split(" ")[0] : "2:40");
  var quote = chosen ? chosen.quote : (c.moment && c.moment.indexOf("\"") >= 0 ? c.moment.split("\"")[1] : null);
  var v = c.videos[0] ? c.videos[0].t : "your latest video";
  var hook = chosen && chosen.bridge ? chosen.bridge : ("The part at " + m + " in \"" + v + "\"" + (quote ? " where you showed \"" + quote + "\"" : "") + " is the exact kind of real test AI tool buyers look for.");
  var bridge = W.truthfulBrandBridge(c);
  var greet = firstName(c);
  var gates = c.confirmed ? [] : [{k:"unconfirmed", text:"Nobody has confirmed this address yet."}];
  if (W.isShadowVA()) gates.push({k:"va_shadow", text:"VA Shadow Mode: Owner/AM must approve before sending."});
  return {id:W.uid("q"), kind:"first", to:{t:"creator", id:c.id}, mailbox:"m1", created:W.now(), momentIdx:mIdx != null ? mIdx : (c.momentIdx || 0),
    subject:(quote || v).toLowerCase().replace(/[^a-z0-9 $/-]/g, "").slice(0, 52),
    body:"Hi" + (greet ? " " + greet : " there") + ",\n\n" + hook + "\n\n" + bridge + " Open to hearing what they have in mind?\n\nMoustafa, Gratovo",
    why:"First email: one real moment from their latest video, truthful brand-stage wording (INF-FIRST-21), one yes-or-no question.", rules:["INF-FIRST-02","INF-FIRST-21","FND-WRITE-11"], gates:gates};
};

W.STEER = {
  shorter:function(t){ var p = t.split(/\n\n/); if (p.length > 3) return [p[0], p[1].split(". ")[0] + ".", p[p.length - 2], p[p.length - 1]].join("\n\n"); return t.split(". ").slice(0, 3).join(". "); },
  warmer:function(t){ return t.replace(/^(Hi[^\n]*\n\n)/, "$1Hope your week is going well. "); },
  direct:function(t){ return t.replace(/Hope your week is (off to a good start|going well)\. /, "").replace(/Totally fair\. /, ""); },
  redo:function(t, q){
    var o = W.rec(q.to);
    if (q.to.t === "creator" && o && o.moments && o.moments.length > 1){
      var nextIdx = ((q.momentIdx || 0) + 1) % o.moments.length, m = o.moments[nextIdx];
      q.momentIdx = nextIdx;
      return t.replace(/^Hi([^\n]*)\n\n[^\n]*/, "Hi$1\n\n" + m.bridge);
    }
    return t.replace(/^Hi([^\n]*)\n\n[^\n]*/, "Hi$1\n\n" + (o && o.videos && o.videos[1] ? "The breakdown at 4:15 in \"" + o.videos[1].t + "\" is the clearest side-by-side test in the niche." : "Your hands-on tests are the clearest in the niche."));
  }
};

/* ---------- V6 Playbook Live Coach Linter (gratovo-comms P1–P7 enforcement) ---------- */
W.lintDraft = function(q){
  if (!q) return {ok:true, verdict:"good", words:0, issues:[]};
  var body = String(q.body || ""), subj = String(q.subject || "");
  var words = body.trim() ? body.trim().split(/\s+/).length : 0;
  var issues = [];
  var spamRe = /\b(opportunity|guarantee|guaranteed|revenue|scale|grow your brand|we help|hope this finds you well|synergy|thrilled)\b/i;
  var hitSpam = body.match(spamRe) || subj.match(spamRe);
  if (hitSpam) issues.push({rule:"FND-WRITE-12", msg:'Banned spam/hype phrase: "' + hitSpam[0] + '"'});
  /* P3: Fanboy Praise Detector (FND-MIND-01, INF-FIRST-26, EX-01..09) */
  var fanboyRe = /\b(great watch|love your|huge fan|awesome video|is brilliant|was brilliant|amazing channel|love the honest)\b/i;
  var hitFanboy = body.match(fanboyRe);
  if (hitFanboy) issues.push({rule:"INF-FIRST-26", msg:'Fanboy praise ("' + hitFanboy[0] + '") weakens peer authority; state why the timestamped moment matters instead'});
  /* P1: Cold Brand Pitch Rules (FND-WRITE-18 no subscriber lead, BRD-FIRST-15 no $ in cold pitch) */
  if (q.kind === "pitch" && q.pitchMode !== "warm"){
    if (/\b\d+[KkMm]?\s+subscribers\b/i.test(body)) issues.push({rule:"FND-WRITE-18", msg:"Subscribers don't watch ads; lead with average views per video instead"});
    if (/\$\s?\d/.test(body)) issues.push({rule:"BRD-FIRST-15", msg:"Cold first email to a brand should not quote dollar prices (use Warm Offer mode for pricing)"});
  }
  /* P5: Blaming brands for analytics request (INF-REPLY-18 / EX-19) */
  if (/brands ask for it/i.test(body)) issues.push({rule:"INF-REPLY-18", msg:'Never say "Brands ask for it" (EX-19); state our own campaign-matching reason'});
  /* P4: Cross-Party CC Block (BRD-REPLY-24) */
  if (q.cc){
    var ccLower = q.cc.toLowerCase();
    var crossLeak = (q.to.t === "brand" && D().creators.some(function(c){ return c.email && ccLower.indexOf(c.email.toLowerCase()) >= 0; })) ||
                    (q.to.t === "creator" && D().brands.some(function(b){ return b.email && ccLower.indexOf(b.email.toLowerCase()) >= 0; }));
    if (crossLeak) issues.push({rule:"BRD-REPLY-24", msg:"CRITICAL: Never CC a creator on a brand thread or vice versa (exposes agency spread)"});
  }
  if (/\u2014|--/.test(body) || /\u2014|--/.test(subj)) issues.push({rule:"FND-FMT-04", msg:"Contains an em-dash (\u2014), an AI writing tell"});
  if ((q.kind === "first" || q.kind === "pitch") && /^re:\s/i.test(subj)) issues.push({rule:"FND-ETH-11", msg:"Fake 'Re:' in a cold subject line"});
  if (q.kind === "first" && /partnership opportunity|collaboration request|sponsorship inquiry/i.test(subj)) issues.push({rule:"FND-SUBJ-01", msg:"Pattern subject line gets skipped"});
  if (q.kind === "first" && words > 82) issues.push({rule:"FND-FMT-02", msg:"First email is " + words + " words (target 50–75w)"});
  if (q.kind === "followup" && /\b(just bumping this|floating this back up|slipped through the cracks|circling back)\b/i.test(body)) issues.push({rule:"FND-WRITE-27", msg:"Stock bump phrase; add a concrete true update instead"});
  if (q.kind === "reply"){
    var lastIn = W.lastIn(q.to), inWords = lastIn && lastIn.text ? lastIn.text.trim().split(/\s+/).length : 30;
    if (words > Math.max(85, inWords * 2.5)) issues.push({rule:"FND-WRITE-25", msg:"Reply (" + words + "w) is much longer than their message (" + inWords + "w)"});
  }
  var bodyNoSign = body.replace(/\n+(Thanks,?\s*\n*)?(Moustafa[^\n]*)\s*$/i, "").trim();
  if ((q.kind === "first" || (q.kind === "followup" && q.n !== 3) || q.kind === "pitch") && bodyNoSign && !/\?\s*$/.test(bodyNoSign)){
    issues.push({rule:"INF-FIRST-05", msg:"Does not end with an easy yes/no question (?)"});
  }
  var verdict = issues.length === 0 ? "good" : issues.some(function(x){ return x.rule === "FND-WRITE-12" || x.rule === "FND-ETH-11" || x.rule === "FND-FMT-04" || x.rule === "BRD-REPLY-24"; }) ? "bad" : "mixed";
  return {ok:issues.length === 0, verdict:verdict, words:words, issues:issues};
};

/* ---------- actions ---------- */
var A = W.A = {};
function markDone(d, key, title, b, min){ d.done = d.done.filter(function(x){ return x.key !== key; }); d.done.unshift({key:key, title:title, b:b, at:W.now(), min:min || 1}); }
A.markDone = markDone;

A.sendDraft = function(id, opts){
  opts = opts || {};
  var q = W.draft(id); if (!q) return;
  if (q.gates.some(function(g){ return !g.ok; })){ W.toast({msg:"This email still needs you", sub:q.gates.filter(function(g){ return !g.ok; }).map(function(g){ return g.text; })[0], icon:"alert", tone:"warn"}); return false; }
  /* P4 Hard Block on Cross-Party CC (BRD-REPLY-24) */
  if (q.cc){
    var ccL = q.cc.toLowerCase();
    var leak = (q.to.t === "brand" && D().creators.some(function(c){ return c.email && ccL.indexOf(c.email.toLowerCase()) >= 0; })) ||
               (q.to.t === "creator" && D().brands.some(function(b){ return b.email && ccL.indexOf(b.email.toLowerCase()) >= 0; }));
    if (leak){ W.toast({msg:"Blocked by BRD-REPLY-24", sub:"Never CC a creator on a brand thread or vice versa. Remove the cross-party CC first.", icon:"shield", tone:"warn"}); return false; }
  }
  var o = W.rec(q.to), mb = W.mailbox(q.mailbox), label = (W.KIND[q.kind] || "Email") + " to " + o.name, next = "";
  if (mb && !opts.at && W.mailboxBlocked(mb)){
    var nm = mb.addr.split("@")[0], alt = W.D().mail.filter(function(m){ return m.id !== mb.id && !W.mailboxBlocked(m); }).sort(W.by(function(m){ return m.cap - m.sent; }, -1))[0];
    W.toast({msg:"Not sent: " + nm + " " + W.mailboxBlocked(mb), sub:alt ? "Send it from " + alt.addr.split("@")[0] + " instead, or schedule it for tomorrow." : "No mailbox can send today. Schedule it for tomorrow.", icon:"alert", tone:"warn",
      actions:alt ? [{label:"Send from " + alt.addr.split("@")[0], run:function(){ A.setMailbox(id, alt.id); A.sendDraft(id, opts); }}] : []});
    return false;
  }
  if (opts.at) label = "Scheduled " + label.toLowerCase();
  var t0 = opts.at || W.now();
  if (q.to.t === "creator"){
    if (q.kind === "first") next = "Follow-up 1 is planned for " + W.fmtDate(t0 + 3 * W.DAY) + ".";
    else if (q.kind === "followup" && o.seq){ var nx0 = o.seq.steps.filter(function(s){ return s.st === "planned" && s.k !== "fu" + q.n; })[0]; next = nx0 ? "Next follow-up " + W.dueText(nx0.at) + "." : "Closing follow-up sent. Sequence moves to parked_warm."; }
    else if (q.kind === "warmth") next = "14-day warmth timer reset to 0 days (HC-29).";
    else if (q.kind === "reply") next = q.after && q.after.park ? "Parked until " + W.fmtDate(q.after.park) + ". It comes back to Today on its own." : "Waiting for their answer. It lands back in Today when they write.";
  } else {
    if (q.kind === "pitch") next = "4-touch brand sequence started (HC-24). Nudge 1 due in 5 days.";
    else if (q.kind === "nudge") next = "If it is still unpaid in 5 days, it comes back here.";
    else next = "Waiting for " + o.name + ". The negotiation log is updated.";
  }
  return W.act(label, function(d, u){
    d.drafts = d.drafts.filter(function(x){ return x.id !== id; });
    if (u && u.quickDraft && u.quickDraft.id === id) u.quickDraft = null;
    var th = d.threads[q.to.id] = d.threads[q.to.id] || [];
    th.push({dir:"out", at:opts.at || W.now(), text:q.body, by:d.me, scheduled:!!opts.at, mailbox:mb.addr, toContact:q.toContact || null});
    var m = d.mail.filter(function(x){ return x.id === q.mailbox; })[0]; if (m && !opts.at) m.sent++;
    var oo = q.to.t === "creator" ? d.creators.filter(function(x){ return x.id === q.to.id; })[0] : d.brands.filter(function(x){ return x.id === q.to.id; })[0];
    if (q.to.t === "creator" && oo){
      oo.daysSinceUpdate = 0;
      if (q.kind === "first"){
        var t = opts.at || W.now();
        oo.stage = "emailed";
        var fu1At = W.addWorkDays ? W.addWorkDays(t, 2, 9) : t + 3 * W.DAY, fu2At = W.addWorkDays ? W.addWorkDays(t, 5, 9) : t + 7 * W.DAY, fu3At = W.addWorkDays ? W.addWorkDays(t, 10, 9) : t + 14 * W.DAY;
        oo.seq = {steps:[{k:"first", at:t, st:"sent"},{k:"fu1", at:fu1At, st:"planned"},{k:"fu2", at:fu2At, st:"planned"},{k:"fu3", at:fu3At, st:"planned"}]};
      } else if (q.kind === "followup" && oo.seq){
        oo.seq.steps.forEach(function(s){ if (s.k === "fu" + q.n) { s.st = "sent"; s.at = W.now(); } });
        if (q.n === 3){ oo.stage = "parked"; oo.parkUntil = W.at(60); oo.parkWhy = "Closed 3-step sequence warmly (INF-FU-14)"; }
      } else if (q.kind === "reply"){
        if (q.after && q.after.park){ oo.stage = "parked"; oo.parkUntil = q.after.park; oo.parkWhy = "Booked until the new year"; }
      }
    } else if (oo){
      if (q.kind === "pitch"){
        var tb = opts.at || W.now();
        oo.status = "pitched";
        oo.pitched = {at:tb, creators:q.creators || [], mode:q.pitchMode || "cold"};
        oo.seq = {steps:[{k:"first", at:tb, st:"sent"},{k:"fu1", at:tb + 5 * W.DAY, st:"planned"},{k:"fu2", at:tb + 10 * W.DAY, st:"planned"},{k:"fu3", at:tb + 15 * W.DAY, st:"planned"}]};
      } else if (q.kind === "followup" && oo.seq){
        oo.seq.steps.forEach(function(s){ if (s.k === "fu" + q.n) { s.st = "sent"; s.at = W.now(); } });
      }
      if (q.kind === "reply" && q.deal){
        var x = d.deals.filter(function(z){ return z.id === q.deal; })[0];
        if (x && x.neg){ var amt = (q.body.match(/\$([\d,]+)/) || [])[1]; if (amt){ x.neg.hist.push({who:"us", amt:+amt.replace(/,/g, ""), at:W.now(), note:"Our answer"}); x.neg.ask = +amt.replace(/,/g, ""); } }
      }
    }
    markDone(d, opts.key || itemKeyForDraft(q), label, opts.bucket || (q.kind === "reply" ? "replies" : q.kind === "followup" || q.kind === "warmth" ? "followups" : "sends"), q.kind === "reply" ? 3 : 1.5);
  }, {ref:q.to, toast:{msg:opts.at ? "Scheduled for " + W.fmtDate(opts.at) + " " + W.fmtTime(opts.at) : "Sent to " + o.name, sub:(opts.at ? "" : "From " + mb.addr + ". ") + next, icon:"send", ms:10000}});
};

W.mailboxBlocked = function(m){ return m.status === "error" ? "is signed out" : m.paused ? "is paused" : m.sent >= m.cap ? "has used all " + m.cap + " sends today" : ""; };
A.confirmGate = function(qid, k){ W.act("Confirmed " + (k === "price" ? "the price" : k === "claim" ? "the track-record claim" : "the warning") + " on an email", function(d){ var q = d.drafts.filter(function(x){ return x.id === qid; })[0]; if (q) q.gates.forEach(function(g){ if (g.k === k) g.ok = true; }); }, {log:false}); };
/* P7: Toggle HC-07 Emergency Social Proof on a draft */
A.useEmergencySocialProof = function(qid){
  var q = W.draft(qid); if (!q) return;
  var o = W.rec(q.to);
  W.act("Switched draft to HC-07 Emergency Social Proof framing", function(d){
    var x = d.drafts.filter(function(z){ return z.id === qid; })[0]; if (!x) return;
    if (x.to.t === "creator"){
      x.body = "Hi " + (firstName(o) || "there") + ",\n\nGreat question. Gratovo is a focused developer-tool partnership studio — we work on a 100% non-exclusive basis and only bring you vetted AI software sponsors whose buyers already match your audience (" + W.fmtK(o.trimmedAvgViews || o.median) + " avg views).\n\nYou have full veto power on every brand and pay zero upfront fees. Could you share a screenshot of your YouTube Studio Audience tab (top countries and age) so we can match you to our November briefs?\n\nMoustafa, Gratovo";
    } else {
      x.body = "Hi " + (firstName(o) || "there") + ",\n\nGlad to share context. Rather than pitching generic agency decks, we represent technical AI channels whose developer audiences already buy in your category — including Prompt Lab (64K median views, 41% US) and Code with Kai (88K median views, 44% US), whose recent tool integrations exceeded 1.35% link CTR.\n\nWe handle brief translation, firm 5-day draft buffers, and 5-point video QC end-to-end. Would a 15-minute walkthrough this week make sense?\n\nMoustafa, Gratovo";
    }
    x.gates.forEach(function(g){ if (g.k === "claim") g.ok = true; });
  }, {toast:{msg:"Applied HC-07 Emergency Social Proof", sub:"Frames verified creator performance & zero-risk representation without inventing agency claims (FND-ETH-03).", icon:"shield", tone:"good"}});
};
A.editDraft = function(id, patch){ var q = W.draft(id); if (!q) return; W.actText("draft:" + id, "Edited draft to " + W.toName(q), function(d){ var x = d.drafts.filter(function(z){ return z.id === id; })[0]; if (x) Object.assign(x, patch, {edited:true}); }); };
A.setMailbox = function(id, mid){ W.act("Changed the sending mailbox", function(d){ var x = d.drafts.filter(function(x){ return x.id === id; })[0]; if (x) x.mailbox = mid; }, {log:false}); };
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
  }, 600);
};
A.skipDraft = function(id, key){
  var q = W.draft(id); if (!q) return;
  W.act("Skipped " + (W.KIND[q.kind] || "email").toLowerCase() + " to " + W.toName(q), function(d, u){
    d.drafts = d.drafts.filter(function(x){ return x.id !== id; });
    if (u && u.quickDraft && u.quickDraft.id === id) u.quickDraft = null;
    if (q.kind === "followup"){ var c = d.creators.filter(function(x){ return x.id === q.to.id; })[0]; if (c && c.seq) c.seq.steps.forEach(function(s){ if (s.k === "fu" + q.n) s.st = "skipped"; }); }
    markDone(d, key || itemKeyForDraft(q), "Skipped: " + (W.KIND[q.kind] || "email") + " to " + W.toName(q), "sends", .2);
  }, {ref:q.to, toast:{msg:"Skipped", sub:q.kind === "followup" ? "The next follow-up stays planned." : "The draft is gone. The creator stays where they were.", icon:"arrowR", tone:"info"}});
};
A.snooze = function(key, until, title){
  var resolved = title || W.itemTitle(key);
  W.act("Snoozed " + (resolved || "an item") + " until " + W.fmtDate(until) + " " + W.fmtTime(until), function(d){ d.snoozed[key] = until; d.snoozeMeta = d.snoozeMeta || {}; d.snoozeMeta[key] = {title:resolved}; },
    {toast:{msg:"Back " + (W.dayDiff(until) === 0 ? "today at " + W.fmtTime(until) : W.fmtDay(until).toLowerCase() + " at " + W.fmtTime(until)), sub:resolved || "", icon:"alarm", tone:"info"}});
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
A.confirmEmail = function(cid, email, contactName){
  var c = W.creator(cid), had = W.draftsFor({t:"creator", id:cid}).length > 0;
  var newQid = null;
  W.act("Confirmed " + c.name + "'s email", function(d){
    var x = d.creators.filter(function(z){ return z.id === cid; })[0];
    x.email = email; x.confirmed = true; x.finding = false;
    if (contactName != null && String(contactName).trim()) x.contact = String(contactName).trim();
    var cand = x.cands.filter(function(k){ return k.email === email; })[0]; if (cand){ x.emailSrc = cand.src; x.emailConf = cand.conf; }
    if (x.stage === "shortlisted") x.stage = "contact";
    d.drafts.forEach(function(q){ if (q.to.t === "creator" && q.to.id === cid){ q.gates = q.gates.filter(function(g){ return g.k !== "unconfirmed"; }); newQid = q.id; } });
    if (!d.drafts.some(function(q){ return q.to.t === "creator" && q.to.id === cid; })){
      var fq = W.makeFirst(x);
      newQid = fq.id;
      d.drafts.push(fq);
    }
    markDone(d, "contact:" + cid, "Confirmed " + x.name + "'s email", "contacts", 2);
  }, {ref:{t:"creator", id:cid}, toast:{msg:"Confirmed " + email, sub:had ? "The first email can go now: the warning on it is gone." : "First email drafted and opened in QuickDraft.", icon:"at", go:{label:"Composer", run:function(){ if (newQid) W.openQuickDraft(newQid); }}}});
  if (newQid && W.U().route.s !== "today") W.openQuickDraft(newQid);
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

/* ---------- F6: Full 47-Situation Reply Classifier + Interactive Reclassify ---------- */
W.classifyReplyText = function(ref, t){
  var isC = ref.t === "creator";
  var rate = (t.match(/\$\s?([\d,]{3,6})/) || [])[1], facts = [];
  if (rate) facts.push({k:isC ? "rate" : "offer", label:isC ? "Rate" : "Their offer", v:+rate.replace(/,/g, ""), show:"$" + rate});
  if (/us\s*\d+%/i.test(t)){
    var usM = +(t.match(/us\s*(\d+)%/i) || [0,42])[1];
    facts.push({k:"countries", label:"Top countries", v:[["US",usM],["GB",11],["CA",8]], show:"US " + usM + "% · GB 11% · CA 8%"});
  }
  var sitId = isC ? "inf.interested_what_next" : "brd.wants_roster";
  if (isC){
    if (/who are you|track record|case stud|past brands|legit/i.test(t)) sitId = "inf.who_are_you";
    else if (/not now|later|busy|booked|january|next quarter/i.test(t)) sitId = "inf.not_now";
    else if (/call|zoom|meet|chat live/i.test(t)) sitId = "inf.wants_call";
    else if (/manager|represent|roster|agency/i.test(t)) sitId = "inf.manager_cc";
    else if (/exclusive|exclusivity|other agencies/i.test(t)) sitId = "inf.no_exclusivity";
    else if (rate && /us\s*\d+%|audience|kit/i.test(t)) sitId = "inf.rate_and_audience";
    else if (/what do these pay|usually pay|how much|budget/i.test(t)) sitId = "inf.interested_asks_pay";
    else if (rate) sitId = "inf.rate_too_high";
  } else {
    if (/why not go direct|direct to creator|middleman/i.test(t)) sitId = "brd.direct_bypass";
    else if (/cpm|performance|guarantee|conversions/i.test(t)) sitId = "brd.wants_cpm";
    else if (/about your agency|case stud|track record|who do you work with/i.test(t)) sitId = "brd.about_agency";
    else if (/call|zoom|15 min|walkthrough/i.test(t)) sitId = "brd.wants_call";
    else if (/next quarter|q1|locked|no budget/i.test(t)) sitId = "brd.next_quarter";
    else if (rate || /budget is|work with \$|counter/i.test(t)) sitId = "brd.counter_offer";
    else sitId = "brd.wants_roster";
  }
  var list = W.SITUATIONS[isC ? "creator" : "brand"] || [];
  var sit = list.filter(function(s){ return s.id === sitId; })[0] || list[0];
  return {sit:sit, facts:facts, rate:rate};
};

W.draftForSituation = function(ref, sitId, rateVal){
  var o = W.rec(ref), isC = ref.t === "creator", fn = firstName(o) || "there";
  var list = W.SITUATIONS[isC ? "creator" : "brand"] || [];
  var sit = list.filter(function(s){ return s.id === sitId; })[0] || list[0];
  var body = "", gates = (sit.gates || []).map(function(g){ return Object.assign({}, g); });
  if (isC){
    if (sitId === "inf.who_are_you"){
      body = "Hi " + fn + ",\n\nGreat question. Gratovo is a developer-tool partnership studio — we work with AI software brands like Codewell, Lumen AI, and VoxCraft to run 60–90 second integrations on technical YouTube channels.\n\nEverything is 100% non-exclusive: we bring you vetted briefs, handle the contract and Net 30 invoicing, and you only take deals you like. Could you share a screenshot of your YouTube Studio Audience tab (top countries and age) so we can match you to our November briefs?\n\nMoustafa, Gratovo";
    } else if (sitId === "inf.wants_call"){
      body = "Hi " + fn + ",\n\nHappy to jump on a quick 10-minute intro call. Here are two times that work on our end:\n• Tomorrow at 10:00 AM EST\n• Thursday at 2:00 PM EST\n\nWe'll cover: (1) how we match your channel to developer brands, (2) your preferred deliverables and hard-no categories, and (3) November campaign timelines (FND-CALL-13). Which slot works best for you?\n\nMoustafa, Gratovo";
    } else if (sitId === "inf.manager_cc"){
      body = "Hi " + fn + ",\n\nGreat to connect with you directly. For our active November developer-tool briefs ($2,000–$5,000 budget range, mid-November go-live window), we would love to lock in " + o.name + "'s 60–90s integration rate and 90-day YouTube Studio audience split.\n\nAlso, could you send over your full creator roster so we can match your other technical channels against our Q4 brand budgets (INF-MGR-03)?\n\nMoustafa, Gratovo";
    } else if (sitId === "inf.no_exclusivity"){
      body = "Hi " + fn + ",\n\n100% aligned — our standard roster representation is completely non-exclusive (HC-04). You keep all your direct sponsors and other agency relationships, and you have full veto power over every brand we bring you.\n\nCould you send a quick screenshot of your YouTube Studio Audience tab (top countries and age) and your standard rate for a 60–90s integration so we can match you to our November campaigns?\n\nMoustafa, Gratovo";
    } else if (sitId === "inf.not_now"){
      body = "Hi " + fn + ",\n\nTotally understood, congrats on the full schedule! I'll park this and check back in when the next campaign window opens up.\n\nMoustafa";
    } else if (sitId === "inf.rate_too_high"){
      var bench = Math.round((o.trimmedAvgViews || o.median || 45000) / 1000 * 30 / 50) * 50;
      body = "Hi " + fn + ",\n\nThanks for sending that over. For channels averaging " + W.fmtK(o.trimmedAvgViews || o.median) + " views, our developer-tool brands typically allocate closer to " + W.money(bench) + " per 60–90s integration (with zero editing or invoicing admin on your side).\n\nWould " + W.money(bench) + " be a dealbreaker for you, or would you be open to a " + W.money(bench) + " base + performance bonus if the video passes " + W.fmtK(Math.round((o.median || 45000) * 1.25)) + " views?\n\nMoustafa";
    } else if (sitId === "inf.interested_asks_pay"){
      body = "Hi " + fn + ",\n\nTotally fair. For a channel averaging " + W.fmtK(o.trimmedAvgViews || o.median) + " views, a 60–90 second integration usually pays in the low thousands, and we only bring you tools you'd genuinely use on camera so it never reads like an ad.\n\nCould you send a screenshot of your YouTube Studio Audience tab (top countries and age, last 90 days) so we can match your audience to our November brand campaigns?\n\nMoustafa";
    } else {
      body = "Hi " + fn + ",\n\nThanks for getting back to me! " + (rateVal ? "$" + rateVal + " for a 60–90 second integration works well as a starting point. " : "") + "Could you share a screenshot of your YouTube Studio Audience tab (top countries and age, last 90 days) so we can match your audience against our active brand budgets and bring you a concrete offer?\n\nMoustafa";
    }
  } else {
    if (sitId === "brd.direct_bypass"){
      body = "Hi " + fn + ",\n\nGreat question. Our signed creators route sponsorship operations through Gratovo so they can stay focused on filming. On your side, we translate your product brief into developer-trusted demos, enforce a firm 5-day pre-publish draft buffer, run a 5-point compliance & link QC check, and consolidate contracts and Net 30 invoicing at zero extra agency management fee.\n\nWould you like me to send over the 4-line audience packet for our top 2 matched channels?\n\nMoustafa, Gratovo";
    } else if (sitId === "brd.wants_cpm"){
      body = "Hi " + fn + ",\n\nWe can structure this around performance. We offer a hybrid Base + View Guarantee structure (BRD-NEG-25): a 50% base fee to cover production, paired with a $40 CPM up to a pre-agreed cap and a 70% view guarantee threshold (with an automatic make-good Short if views land below floor).\n\nWould a quick 15-minute call on Thursday work to lock the exact numbers?\n\nMoustafa, Gratovo";
    } else if (sitId === "brd.about_agency"){
      body = "Hi " + fn + ",\n\nGlad to share context. Gratovo represents vetted AI and developer-tool YouTube educators — including Prompt Lab (64K median views, 41% US) and Code with Kai (88K median views, 44% US), whose recent integrations for developer SaaS tools averaged 1.38% link CTR.\n\nShould I send over the full Talent Packet with 90-day YouTube Studio audience proof for your November window?\n\nMoustafa, Gratovo";
    } else if (sitId === "brd.wants_call"){
      body = "Hi " + fn + ",\n\nHappy to jump on a 15-minute discovery call. Do either of these times work on your end?\n• Tomorrow at 11:00 AM EST\n• Thursday at 3:00 PM EST\n\nAgenda: (1) your Q4 conversion vs. awareness goals and target CPM/CPA, (2) live walkthrough of our matched creators' YouTube Studio demographics, and (3) November upload dates (FND-CALL-13). Which time works best?\n\nMoustafa, Gratovo";
    } else if (sitId === "brd.next_quarter"){
      body = "Hi " + fn + ",\n\nMakes complete sense. Do you typically lock Q1 creator budgets in early December or the first week of January? I'll set a reminder on our end so we can share fresh availability right when your planning window opens.\n\nMoustafa, Gratovo";
    } else if (sitId === "brd.counter_offer"){
      body = "Hi " + fn + ",\n\nThanks for coming back quickly. Our quote reflects the channel's 12-video outlier-trimmed average views and 40%+ US developer audience. If we keep the integration to organic channel upload (without 30-day paid ad whitelisting), we can meet you halfway — or lock a 3-video momentum bundle with an 8% volume discount. Shall I send the updated options?\n\nMoustafa, Gratovo";
    } else {
      body = "Hi " + fn + ",\n\nGlad to share the details. I've put together our top 2 matched creators for " + o.name + " with their 30-day average views, verified US/UK/CA/AU audience splits, and 3 package options (Single Test Integration, 3-Video Bundle, or Multi-Creator Takeover).\n\nWould Tuesday or Thursday work for a 15-minute walkthrough?\n\nMoustafa, Gratovo";
    }
  }
  return {body:body, why:sit.summary + " " + sit.next, rules:sit.rules, gates:gates, sit:sit};
};

A.pasteReply = function(ref, text){
  var o = W.rec(ref), t = text.trim(); if (!t) return;
  var parsed = W.classifyReplyText(ref, t);
  var gen = W.draftForSituation(ref, parsed.sit.id, parsed.rate);
  var qid = W.uid("q");
  W.act("Added a pasted reply to " + o.name + " (" + parsed.sit.label + ")", function(d){
    var th = d.threads[ref.id] = d.threads[ref.id] || [];
    th.push({dir:"in", at:W.now(), text:t, pasted:true, ai:{intent:parsed.sit.label, situationId:parsed.sit.id, summary:parsed.sit.summary, facts:parsed.facts, next:parsed.sit.next}});
    if (ref.t === "creator"){ var c = d.creators.filter(function(z){ return z.id === ref.id; })[0]; if (c && c.stage === "emailed") { c.stage = "replied"; if (c.seq) c.seq.stopped = "replied"; } }
    if (ref.t === "brand"){ var b = d.brands.filter(function(z){ return z.id === ref.id; })[0]; if (b && b.seq) b.seq.stopped = "replied"; }
    d.drafts.push({id:qid, kind:"reply", to:ref, mailbox:"m1", created:W.now(), subject:"Re: " + (o.name || "our last email"), body:gen.body, why:gen.why, rules:gen.rules, gates:gen.gates, situationId:parsed.sit.id});
  }, {ref:ref, toast:{msg:"Reply classified: " + parsed.sit.label, sub:"Follow-ups stopped & Playbook reply opened.", icon:"paste", go:{label:"Composer", run:function(){ W.openQuickDraft(qid); }}}});
  if (W.U().route.s !== "today") W.openQuickDraft(qid);
};

A.reclassifyReply = function(ref, msgAt, newSitId){
  if (typeof ref === "string" && !newSitId){
    var q0 = W.draft(ref); if (!q0) return;
    newSitId = msgAt; ref = q0.to;
    var li0 = W.lastIn(ref); msgAt = li0 ? li0.at : 0;
  }
  var list0 = W.SITUATIONS[ref.t === "creator" ? "creator" : "brand"] || [];
  if (newSitId && !list0.some(function(s){ return s.id === newSitId; })){
    var byCode = list0.filter(function(s){ return s.label.indexOf(newSitId) === 0; })[0];
    if (byCode) newSitId = byCode.id; else if (list0[0]) newSitId = list0[0].id;
  }
  var o = W.rec(ref); if (!o) return;
  var gen = W.draftForSituation(ref, newSitId, null);
  W.act("Reclassified " + o.name + "'s reply to '" + gen.sit.label + "'", function(d){
    var th = d.threads[ref.id] || [], msg = th.filter(function(m){ return m.at === msgAt; })[0] || th[th.length - 1];
    if (msg && msg.ai){
      msg.ai.intent = gen.sit.label;
      msg.ai.situationId = gen.sit.id;
      msg.ai.summary = gen.sit.summary;
      msg.ai.next = gen.sit.next;
    }
    var q = d.drafts.filter(function(z){ return z.to.t === ref.t && z.to.id === ref.id && z.kind === "reply"; })[0];
    if (q){
      q.body = gen.body;
      q.why = gen.why;
      q.rules = gen.rules;
      q.gates = gen.gates;
      q.situationId = gen.sit.id;
    } else {
      d.drafts.push({id:W.uid("q"), kind:"reply", to:ref, mailbox:"m1", created:W.now(), subject:"Re: " + o.name, body:gen.body, why:gen.why, rules:gen.rules, gates:gen.gates, situationId:gen.sit.id});
    }
  }, {ref:ref, toast:{msg:"Reclassified as: " + gen.sit.label, sub:"Coaching rules, gates, and drafted reply updated automatically.", icon:"sparkle", tone:"good"}});
};

A.sign = function(cid){
  var c = W.creator(cid);
  W.act("Signed " + c.name, function(d){ var x = d.creators.filter(function(z){ return z.id === cid; })[0]; x.stage = "signed"; x.daysSinceUpdate = 0; if (x.kit){ x.rate = x.kit.rate; } markDone(d, "audience:" + cid, "Signed " + x.name, "close", 3); },
    {ref:{t:"creator", id:cid}, toast:{msg:c.name + " is signed", sub:"On the roster now, ready to pitch to brands.", icon:"pen", go:{label:"Roster", run:function(){ W.go("close", "roster"); }}}});
};
A.declineKit = function(cid){
  var c = W.creator(cid), qid = W.uid("q");
  W.act("Declined " + c.name + " (audience)", function(d){ var x = d.creators.filter(function(z){ return z.id === cid; })[0]; x.stage = "rejected"; x.reject = {reason:"Audience outside US/UK/CA/AU", at:W.now(), by:d.me};
    d.drafts.push({id:qid, kind:"reply", to:{t:"creator", id:cid}, mailbox:"m1", created:W.now(), subject:"Re: sponsors", body:"Hi " + (x.contact || "there") + ",\n\nThank you for sending this over. Right now our brands are looking for audiences led by the US, UK, Canada and Australia, so I don't have a fit for you today. I'll reach out as soon as one comes in.\n\nMoustafa", why:"Polite no that keeps the door open.", rules:["INF-DECLINE-01"], gates:[]});
    markDone(d, "audience:" + cid, "Declined " + x.name, "close", 2); },
    {ref:{t:"creator", id:cid}, toast:{msg:"Declined " + c.name, sub:"A short, kind reply is drafted for you to send.", icon:"x", tone:"info"}});
  if (W.U().route.s !== "today") W.openQuickDraft(qid);
};
A.park = function(cid, until, why){ var c = W.creator(cid); W.act("Parked " + c.name + " until " + W.fmtDate(until), function(d){ var x = d.creators.filter(function(z){ return z.id === cid; })[0]; x.stage = "parked"; x.parkUntil = until; x.parkWhy = why || "Not now"; }, {ref:{t:"creator", id:cid}, toast:{msg:c.name + " parked until " + W.fmtDate(until), sub:"Comes back to Today on its own.", icon:"alarm", tone:"info"}}); };
A.unconfirmEmail = function(cid){
  var c = W.creator(cid); if (!c) return;
  W.act("Reopened email confirmation for " + c.name, function(d){
    var x = d.creators.filter(function(z){ return z.id === cid; })[0];
    if (x){ x.confirmed = false; if (x.stage === "contact") x.stage = "shortlisted"; }
  }, {ref:{t:"creator", id:cid}, toast:{msg:"Choose or type a new address for " + c.name, icon:"at", tone:"info"}});
};
A.askMissingAudience = function(cid){
  var c = W.creator(cid); if (!c) return;
  var src = c.kit || c, a = W.audience({countries:src.countries, age:src.age, eng:src.eng || c.eng, rate:src.rate || c.rate});
  var missing = a.rows.filter(function(r){ return r.ok === null; }).map(function(r){ return r.k === "top" ? "top audience countries" : r.k === "age" ? "age range" : r.k === "eng" ? "engagement rate" : "rate for a 60–90 s integration"; });
  var askTxt = missing.length ? missing.join(" and ") : "YouTube Studio audience tab (top countries and age, last 90 days)";
  var qid = W.uid("q");
  W.act("Drafted a request for " + c.name + "'s missing audience numbers", function(d){
    d.drafts.push({id:qid, kind:"reply", to:{t:"creator", id:cid}, mailbox:"m1", created:W.now(), subject:"Re: audience numbers",
      body:"Hi " + (c.contact || "there") + ",\n\nThanks for sending this over! So we can match your channel against our active November brand budgets, could you share your " + askTxt + " from YouTube Studio?\n\nMoustafa",
      why:"States our own matching reason for the missing YouTube Studio fields (INF-REPLY-17, INF-REPLY-18).", rules:["INF-REPLY-17","INF-REPLY-18"], gates:[]});
  }, {ref:{t:"creator", id:cid}, toast:{msg:"Drafted request for missing numbers", sub:"Opened right here in QuickDraft.", icon:"sparkle", go:{label:"Composer", run:function(){ W.openQuickDraft(qid); }}}});
  if (W.U().route.s !== "today") W.openQuickDraft(qid);
};
A.updateCreatorAudience = function(cid, patch){
  var c = W.creator(cid); if (!c) return;
  W.act("Updated " + c.name + "'s audience & rate details", function(d){
    var x = d.creators.filter(function(z){ return z.id === cid; })[0]; if (!x) return;
    if (patch.rate != null) { x.rate = patch.rate; if (x.kit) x.kit.rate = patch.rate; }
    if (patch.eng != null) { x.eng = patch.eng; if (x.kit) x.kit.eng = patch.eng; }
    if (patch.age != null) { x.age = patch.age; if (x.kit) x.kit.age = patch.age; }
    if (patch.countries != null) { x.countries = patch.countries; if (x.kit) x.kit.countries = patch.countries; }
    if (patch.relationshipModel != null) x.relationshipModel = patch.relationshipModel;
  }, {ref:{t:"creator", id:cid}, toast:{msg:"Updated " + c.name + "'s numbers", icon:"check"}});
};

/* System 3: Send 14-Day Creator Warmth Update (HC-29, INF-ONB-02) */
A.sendWarmthUpdate = function(cid){
  var c = W.creator(cid); if (!c) return;
  var best = W.bestBrandFor(c);
  var bName = best ? best.b.name : "Inboxly and Agentic HQ";
  var qid = W.uid("q");
  W.act("Drafted 14-day roster warmth update to " + c.name, function(d){
    var x = d.creators.filter(function(z){ return z.id === cid; })[0];
    if (x) x.daysSinceUpdate = 0;
    d.drafts.push({id:qid, kind:"warmth", to:{t:"creator", id:cid}, mailbox:"m1", created:W.now(), subject:"Quick November campaign update for " + c.name,
      body:"Hi " + (firstName(c) || "there") + ",\n\nQuick bi-weekly check-in so you're in the loop: we are actively pitching your channel to developer-tool brands including " + bName + " for November 60–90s slots.\n\nWe're waiting on two Q4 budget sign-offs this week and I will update you again by next Thursday with any concrete offers. Has anything changed on your upload schedule for next month?\n\nMoustafa, Gratovo",
      why:"14-day signed-creator warmth pulse (HC-29, INF-ONB-02): names active brand categories, shares market feedback, and sets the next check-in date.", rules:["HC-29","INF-ONB-02"], gates:[]});
    markDone(d, "warmth:" + cid, "Drafted warmth update to " + c.name, "followups", 1.5);
  }, {ref:{t:"creator", id:cid}, toast:{msg:"14-day warmth update drafted to " + c.name, sub:"Prevents roster churn during the 30–60d brand hunt (HC-29).", icon:"coffee", go:{label:"Composer", run:function(){ W.openQuickDraft(qid); }}}});
  if (W.U().route.s !== "today") W.openQuickDraft(qid);
};

/* System 4: Talent Manager Roster Request & Multi-Creator Brief (INF-MGR-03, EX-29) */
A.requestManagerRoster = function(mgrId){
  var mgr = W.manager(mgrId); if (!mgr) return;
  var c0 = W.creator(mgr.creators[0]) || D().creators[0];
  var qid = W.uid("q");
  W.act("Drafted full roster request to talent manager " + mgr.name + " (" + mgr.agency + ")", function(d){
    mgr.lastTouch = W.now();
    d.drafts.push({id:qid, kind:"reply", to:{t:"creator", id:c0.id}, toEmail:mgr.email, toContact:mgr.name, mailbox:"m1", created:W.now(), subject:mgr.agency + " roster × Gratovo Q4 developer briefs",
      body:"Hi " + mgr.name.split(" ")[0] + ",\n\nWe are locking Q4 developer-tool integrations ($2,500–$6,000 per integration, mid-November go-live window) for Codewell, Inboxly, and Agentic HQ.\n\nAlongside " + mgr.creators.map(function(id){ return (W.creator(id) || {}).name; }).join(" and ") + ", could you send over your full talent roster with current 60–90s rates and US/UK/CA/AU audience splits so we can package multi-creator briefs for your channels (INF-MGR-03, EX-29)?\n\nMoustafa, Gratovo",
      why:"Multi-creator manager brief (EX-29, INF-MGR-03): leads with budget range and go-live window, and asks for the manager's full roster.", rules:["INF-MGR-03","EX-29"], gates:[]});
  }, {toast:{msg:"Manager roster request drafted to " + mgr.name, sub:"Uses EX-29 multi-creator brief structure.", icon:"users", go:{label:"Composer", run:function(){ W.openQuickDraft(qid); }}}});
  W.openQuickDraft(qid);
};

/* close */
A.qualify = function(bid, patch){
  var b = W.brand(bid);
  W.act("Qualified " + b.name, function(d){ var x = d.brands.filter(function(z){ return z.id === bid; })[0]; Object.assign(x, patch || {}); x.status = "qualified"; markDone(d, "qualify:" + bid, "Qualified " + x.name, "close", 4); },
    {ref:{t:"brand", id:bid}, toast:{msg:b.name + " qualified", sub:"Next: pitch one or two signed creators. It is in Sign and pitch.", icon:"flag"}});
};
A.notFit = function(bid){ var b = W.brand(bid); W.act("Marked " + b.name + " as not a fit", function(d){ d.brands.filter(function(z){ return z.id === bid; })[0].status = "lost"; markDone(d, "qualify:" + bid, b.name + ": not a fit", "close", 1); }, {ref:{t:"brand", id:bid}, toast:{msg:b.name + " set aside", sub:"Not a fit. It stays searchable.", icon:"x", tone:"info"}}); };

/* ---------- P1 & System 8 & 9 Fixed: Mode A (Cold First Touch HC-14) vs Mode B (Warm 3-Option Priced Offer HC-26) + Multi-Buyer Sequencing (HC-25) ---------- */
A.draftPitch = function(bid, cids, opts){
  opts = opts || {};
  var b = W.brand(bid), cs = (cids || []).map(W.creator).filter(Boolean);
  if (!b || !cs.length) return;
  var mode = opts.mode || opts.pitchMode || (b.status === "won" || b.status === "negotiating" ? "warm" : "cold");
  var format = opts.format || opts.deliverable || "integration_60s";
  var whitelisting = !!opts.whitelisting30d;
  var includeContact2 = !!(opts.includeContact2 || opts.buyerRole === "role2") && !!b.email2;
  var prices = cs.map(function(c){ return W.priceFor(c, {format:format, whitelisting30d:whitelisting}); });
  var anchor = Math.min.apply(null, prices);
  var pkgs = W.buildPackagesFor(b, cs);
  var hook = b.pastCampaignHook || ("your recent creator campaigns in the " + (b.sells || "AI software").toLowerCase() + " space");
  var id = W.uid("q"), id2 = includeContact2 ? W.uid("q") : null;
  var isPersonalEmail = /@(gmail|yahoo|hotmail|outlook|icloud)\.com$/i.test(b.email || "");

  W.act("Drafted " + (mode === "cold" ? "cold first-touch pitch (HC-14)" : "priced proposal (HC-26)") + " to " + b.name + (includeContact2 ? " (2 buyers sequenced per HC-25)" : ""), function(d){
    var body1, why1, rules1, gates1 = [];
    if (isPersonalEmail){
      gates1.push({k:"phishing", text:"BRD-REPLY-30 Guard: " + b.email + " is a personal email address. Verify they reply from @" + (b.site || b.name.toLowerCase() + ".com") + " before sharing full media kits."});
    }
    if (mode === "cold"){
      /* Mode A: Cold First Touch (HC-14, BRD-FIRST-04, FND-WRITE-18, BRD-OFFER-18) — ZERO dollar prices, ZERO subscriber counts, rounded views (50K+) */
      var coldLines = cs.map(function(c){
        var roundedK = Math.floor((c.trimmedAvgViews || c.median) / 5000) * 5;
        return "• " + c.name + " (" + roundedK + "K+ average views per video, " + (c.countries[0] ? c.countries[0][1] + "% " + c.countries[0][0] : "US-led") + " developer audience)";
      });
      body1 = "Hi " + (b.contact ? b.contact.split(" ")[0] : "there") + ",\n\nSaw " + hook + ". We represent " + (cs.length === 1 ? "an AI channel" : "two AI channels") + " your technical buyers already watch:\n\n" + coldLines.join("\n") + "\n\nBoth build hands-on workflows with tools like " + b.sells.toLowerCase() + " and have November integration slots open. Should I send the details?\n\nMoustafa, Gratovo";
      why1 = "Cold First Touch (HC-14, BRD-FIRST-04, FND-WRITE-18, BRD-OFFER-18): Opens with their marketing campaign, leads with rounded average views (never subscriber counts), omits cold dollar figures, and ends with 'Should I send the details?'.";
      rules1 = ["BRD-FIRST-04","FND-WRITE-18","BRD-OFFER-18","HC-14"];
    } else {
      /* Mode B: Warm Presentation / 3-Option Priced Offer (HC-22, HC-26, BRD-PRES-04, EX-33) */
      var statBlocks = cs.map(function(c){
        var p = W.priceFor(c, {format:format, whitelisting30d:whitelisting});
        return "• " + c.name + " (" + c.handle + ") · " + W.fmtK(c.trimmedAvgViews || c.median) + " 12-video avg views (" + c.viewStability + ") · " + (c.countries.slice(0,3).map(function(x){ return x[0] + " " + x[1] + "%"; }).join(", ")) + " (" + c.age + ") · Quote: " + W.money(p);
      });
      var pkgBlock = opts.useThreeOptions !== false
        ? "\n\nPackage Options (HC-26):\n1. " + pkgs[0].name + ": " + W.money(pkgs[0].price) + " (" + pkgs[0].desc + ")\n2. " + pkgs[1].name + ": " + W.money(pkgs[1].price) + " (" + pkgs[1].desc + ")\n3. " + pkgs[2].name + ": " + W.money(pkgs[2].price) + " (" + pkgs[2].desc + ")"
        : "\n\nA " + (format === "dedicated" ? "dedicated 8–12m walkthrough" : format === "shoutout_30s" ? "30-second shoutout" : "60–90 second first-third integration") + (whitelisting ? " + 30-day whitelisting" : "") + " starts at " + W.money(anchor) + ".";
      body1 = "Hi " + (b.contact ? b.contact.split(" ")[0] : "there") + ",\n\nFollowing up on " + hook + ", here is the 4-line audience & pricing breakdown for our matched creators:\n\n" + statBlocks.join("\n") + pkgBlock + "\n\nWould Tuesday or Thursday work for a 15-minute call to lock your November slot?\n\nMoustafa, Gratovo";
      why1 = "Warm Presentation & 3-Option Offer (BRD-PRES-04, HC-22, HC-26, EX-33): Full 4-line stat block + Single vs. Bundle package options.";
      rules1 = ["BRD-PRES-04","HC-26","BRD-PRICE-09","EX-33"];
      gates1.push({k:"price", text:"This warm proposal quotes " + W.money(anchor) + "+. Confirm pricing before sending."});
    }
    if (W.isShadowVA()) gates1.push({k:"va_shadow", text:"VA Shadow Mode: Owner/AM must approve before sending."});
    d.drafts.push({id:id, kind:"pitch", pitchMode:mode, to:{t:"brand", id:bid}, toContact:b.contact, toEmail:b.email, creators:cids, mailbox:"m1", created:W.now(),
      subject:cs.map(function(c){ return c.name; }).join(" + ") + " × " + b.name,
      body:body1, why:why1, rules:rules1, gates:gates1});

    /* System 9: Second Buyer Role-Tailored Angle (HC-25, BRD-OFFER-06, FND-DLV-23 max 2/domain/day) */
    if (includeContact2 && id2){
      var c2First = b.contact2 ? b.contact2.split(" ")[0] : "there";
      var body2 = "Hi " + c2First + ",\n\nSaw " + hook + ". From a growth & ROI angle (" + (b.role2 || "VP Growth") + "), we manage two high-converting technical channels (" + cs.map(function(c){ return c.name; }).join(" and ") + ") whose developer integrations average 1.38% link CTR in the " + b.sells.toLowerCase() + " category.\n\nBoth have November test slots open. Should I send over the audience & CTR breakdown?\n\nMoustafa, Gratovo";
      d.drafts.push({id:id2, kind:"pitch", pitchMode:"cold", to:{t:"brand", id:bid}, toContact:b.contact2, toEmail:b.email2, creators:cids, mailbox:"m2", created:W.now(),
        subject:b.name + " Q4 developer creator ROI (" + cs[0].name + ")",
        body:body2, why:"Second buyer angle (HC-25, BRD-OFFER-06, FND-DLV-23): Tailored to " + (b.role2 || "Growth/CMO") + " around conversion & CTR; auto-pauses if " + (b.contact || "colleague") + " replies first.", rules:["HC-25","BRD-OFFER-06","FND-DLV-23"], gates:[]});
    }
    markDone(d, "pitch:" + bid, "Drafted a pitch to " + b.name, "close", 4);
  }, {ref:{t:"brand", id:bid}, toast:{msg:(mode === "cold" ? "Cold First-Touch Pitch" : "3-Option Priced Proposal") + " drafted to " + b.name, sub:includeContact2 ? "2 role-tailored emails queued (max 2/domain/day per FND-DLV-23)." : "Opened right here in QuickDraft.", icon:"sparkle", go:{label:"Composer", run:function(){ W.openQuickDraft(id); }}}});
  if (W.U().route.s !== "today") W.openQuickDraft(id);
  return id;
};

/* ---------- P6 Fixed: 3-Step Escalating Follow-Up Generator (FND-WRITE-27, BRD-FU-06, INF-FU-14, BRD-FU-10) ---------- */
A.nudgeBrand = function(bid, stepNum){
  var b = W.brand(bid); if (!b) return;
  var cs = ((b.pitched && b.pitched.creators) || []).map(W.creator).filter(Boolean);
  var names = cs.map(function(c){ return c.name; }).join(" and ") || "Prompt Lab and The AI Desk";
  var sentSteps = b.seq ? b.seq.steps.filter(function(s){ return s.st === "sent"; }).length : 1;
  var n = stepNum || Math.min(3, Math.max(1, sentSteps));
  var id = W.uid("q");
  var body, why, rules;
  if (n === 1){
    /* Follow-up 1 (Day 5, BRD-FU-04, BRD-FU-06: drops 'Hi' on subsequent follow-up or keeps ultra-light) */
    body = (b.contact ? b.contact.split(" ")[0] : "Team") + " — wanted to share one quick proof point on my note from last week. " + (cs[0] ? cs[0].name + "'s latest upload passed " + W.fmtK(cs[0].videos[0] ? cs[0].videos[0].v : cs[0].median) + " views in 5 days, and they" : names) + " still have one November integration slot open. Worth a 15-minute chat this week?\n\nMoustafa";
    why = "Brand Follow-Up 1 of 3 (HC-24, BRD-FU-06, HC-15): Drops formal 'Hi' greeting, adds a fresh view proof point, and asks an easy question.";
    rules = ["BRD-FU-04","BRD-FU-06","HC-15"];
  } else if (n === 2){
    body = (b.contact ? b.contact.split(" ")[0] : "Team") + " — one more angle in case Q4 planning is underway: we can also structure a single low-risk test integration or a 30-second quick shoutout at 0.7x rate (BRD-OFFER-21) so you can benchmark developer CTR first. Open to seeing the numbers?\n\nMoustafa";
    why = "Brand Follow-Up 2 of 3 (HC-24, BRD-OFFER-21): Offers a lower-friction test integration entry point.";
    rules = ["HC-24","BRD-OFFER-21","FND-WRITE-27"];
  } else {
    /* Follow-up 3: Closing "Keep the Door Open" Email (BRD-FU-10) */
    body = (b.contact ? b.contact.split(" ")[0] : "Team") + " — I'll pause reaching out after this note so I don't clutter your inbox. If creator partnerships open up for " + b.name + " in Q1, my door is always open.\n\nAll the best,\nMoustafa, Gratovo";
    why = "Brand Follow-Up 3 of 3 — Closing 'Keep the Door Open' Email (BRD-FU-10): Leaves a warm, zero-pressure impression and parks the brand for 60 days.";
    rules = ["BRD-FU-10","HC-24"];
  }
  W.act("Drafted Brand Follow-Up " + n + " of 3 to " + b.name, function(d){
    d.drafts.push({id:id, kind:"followup", n:n, to:{t:"brand", id:bid}, mailbox:"m1", created:W.now(), subject:"Re: " + names + " × " + b.name, body:body, why:why, rules:rules, gates:[]});
    markDone(d, "bnudge:" + bid, "Drafted follow-up " + n + " to " + b.name, "followups", 2);
  }, {ref:{t:"brand", id:bid}, toast:{msg:"Brand Follow-Up " + n + " of 3 drafted", sub:"Opened right here in QuickDraft.", icon:"clock", go:{label:"Composer", run:function(){ W.openQuickDraft(id); }}}});
  if (W.U().route.s !== "today") W.openQuickDraft(id);
};

A.draftCreatorFollowup = function(cid, stepNum){
  var c = W.creator(cid); if (!c) return;
  var sentSteps = c.seq ? c.seq.steps.filter(function(s){ return s.st === "sent"; }).length : 1;
  var n = stepNum || Math.min(3, Math.max(1, sentSteps));
  var id = W.uid("q"), fn = firstName(c) || "there";
  var vNew = (c.videos && c.videos[0]) ? c.videos[0].t : "your latest upload";
  var body, why, rules;
  if (n === 1){
    body = "Hi " + fn + ",\n\nQuick check-in on my note from earlier this week. " + W.truthfulBrandBridge(c) + " Would you be open to seeing how a 60–90 second integration would look?\n\nMoustafa";
    why = "Creator Follow-Up 1 of 3 (INF-FU-03, FND-WRITE-27): Light 2-sentence check-in in the same thread.";
    rules = ["INF-FU-03","FND-WRITE-27"];
  } else if (n === 2){
    body = "Hi " + fn + ",\n\nSaw your newer upload (\"" + vNew + "\") and the developer audience engagement in the comments is spot on for our November briefs. Worth a quick look this week?\n\nMoustafa";
    why = "Creator Follow-Up 2 of 3 (INF-FU-15): Hooks onto a newer upload + timely brand campaign demand.";
    rules = ["INF-FU-15","FND-WRITE-27"];
  } else {
    body = "Hi " + fn + ",\n\nI'll stop following up after this note so I don't crowd your inbox. Whenever you open up sponsorship slots on " + c.name + ", feel free to reply here anytime — our door is always open.\n\nMoustafa, Gratovo";
    why = "Creator Follow-Up 3 of 3 — Closing 'Keep the Door Open' Email (INF-FU-14): Leaves a respectful peer impression and parks for 60 days.";
    rules = ["INF-FU-14","HC-01"];
  }
  W.act("Drafted Creator Follow-Up " + n + " of 3 to " + c.name, function(d){
    d.drafts.push({id:id, kind:"followup", n:n, to:{t:"creator", id:cid}, mailbox:"m1", created:W.now(), subject:"Re: " + vNew.slice(0, 42), body:body, why:why, rules:rules, gates:[]});
  }, {ref:{t:"creator", id:cid}, toast:{msg:"Creator Follow-Up " + n + " of 3 drafted", sub:"Opened right here in QuickDraft.", icon:"clock", go:{label:"Composer", run:function(){ W.openQuickDraft(id); }}}});
  if (W.U().route.s !== "today") W.openQuickDraft(id);
};

A.nudgeCreatorReply = function(cid){
  var c = W.creator(cid); if (!c) return;
  var id = W.uid("q");
  W.act("Drafted analytics nudge to " + c.name, function(d){
    d.drafts.push({id:id, kind:"followup", n:1, to:{t:"creator", id:cid}, mailbox:"m1", created:W.now(), subject:"Re: audience analytics",
      body:"Hi " + (firstName(c) || "there") + ",\n\nFollowing up on our note from earlier this week. Once you send a quick screenshot of your YouTube Studio Audience tab (top countries and age, last 90 days), I can match your channel against our November brand budgets. Do you have that handy?\n\nMoustafa",
      why:"2-day nudge on a stalled warm reply (HC-12, INF-REPLY-18).", rules:["INF-REPLY-01","INF-REPLY-18","FND-WRITE-27"], gates:[]});
    markDone(d, "stalled:" + cid, "Nudged " + c.name + " for analytics", "followups", 1.5);
  }, {ref:{t:"creator", id:cid}, toast:{msg:"Analytics nudge to " + c.name + " drafted", sub:"Opened right here in QuickDraft.", icon:"reply", go:{label:"Composer", run:function(){ W.openQuickDraft(id); }}}});
  if (W.U().route.s !== "today") W.openQuickDraft(id);
};

/* ---------- F3: Dual-Sided Deal Room Relay Actions (Brand ⇄ Agency Margin Bridge ⇄ Creator) ---------- */
A.relayBrandToCreator = function(dealId){
  var x = W.deal(dealId); if (!x) return;
  var b = W.brand(x.brand), c = W.creator(x.creator), qid = W.uid("q");
  var lastBrandMsg = W.lastIn({t:"brand", id:b.id});
  var noteSummary = lastBrandMsg ? lastBrandMsg.text.replace(/\$\s?[\d,]+/g, "[gross price stripped]") : "confirmed campaign talking points and timeline";
  W.act("Relayed " + b.name + "'s update to " + c.name + " (agency margin stripped per BRD-REPLY-24)", function(d){
    d.drafts.push({id:qid, kind:"reply", to:{t:"creator", id:c.id}, deal:dealId, mailbox:"m1", created:W.now(),
      subject:"Update on " + b.name + " integration (" + W.fmtShort(x.creatorDeadline || (x.golive - 5 * W.DAY)) + " draft slot)",
      body:"Hi " + (firstName(c) || "there") + ",\n\nQuick update from our side on the " + b.name + " campaign (" + W.money(x.payout) + " creator payout for your " + x.deliverable.toLowerCase() + "):\n\n• Brand note (translated into your workflow): " + noteSummary.slice(0, 180) + "\n• Firm Unlisted Draft Deadline: " + W.fmtDate(x.creatorDeadline || (x.golive - 5 * W.DAY)) + " (5 days ahead of the " + W.fmtDate(x.golive) + " release window per BRD-DELIV-09).\n\nDoes that timeline still work cleanly for your filming schedule?\n\nMoustafa",
      why:"Dual-Sided Deal Room Relay (BRD-REPLY-24, INF-DELIV-13, BRD-DELIV-09): Strips brand gross price, translates brand feedback calmly, and enforces the -5d creator draft buffer.", rules:["BRD-REPLY-24","INF-DELIV-13","BRD-DELIV-09"], gates:[]});
  }, {ref:{t:"deal", id:dealId}, toast:{msg:"Relayed to " + c.name + " (gross price stripped)", sub:"Opened in QuickDraft for immediate review.", icon:"forward", go:{label:"Composer", run:function(){ W.openQuickDraft(qid); }}}});
  W.openQuickDraft(qid);
};

A.relayCreatorToBrand = function(dealId){
  var x = W.deal(dealId); if (!x) return;
  var b = W.brand(x.brand), c = W.creator(x.creator), qid = W.uid("q");
  var lastCrMsg = W.lastIn({t:"creator", id:c.id});
  W.act("Relayed " + c.name + "'s progress to " + b.name, function(d){
    d.drafts.push({id:qid, kind:"reply", to:{t:"brand", id:b.id}, deal:dealId, mailbox:"m1", created:W.now(),
      subject:c.name + " × " + b.name + " production status update",
      body:"Hi " + (b.contact ? b.contact.split(" ")[0] : "there") + ",\n\nQuick status update on " + c.name + "'s " + x.deliverable.toLowerCase() + " (" + W.money(x.price) + "):\n\n• Creator update: " + (lastCrMsg ? lastCrMsg.text.replace(/\$\s?[\d,]+/g, "").slice(0, 180) : "Filming is on track against your approved outline.") + "\n• Target Go-Live Window: " + W.fmtDate(x.golive) + " (we are running our internal 5-point compliance & UTM check ahead of forwarding).\n\nLet me know if anything changed on your landing page or tracking link.\n\nMoustafa, Gratovo",
      why:"Dual-Sided Deal Room Relay (BRD-DELIV-05, BRD-REPLY-24): Formats creator progress professionally for the brand while keeping creator net payout private.", rules:["BRD-DELIV-05","BRD-REPLY-24"], gates:[]});
  }, {ref:{t:"deal", id:dealId}, toast:{msg:"Relayed status update to " + b.name, sub:"Opened in QuickDraft for immediate review.", icon:"forward", go:{label:"Composer", run:function(){ W.openQuickDraft(qid); }}}});
  W.openQuickDraft(qid);
};

A.startDeal = function(bid, cid, opts){
  opts = opts || {};
  var b = W.brand(bid); if (!b) return;
  var cids = Array.isArray(cid) ? cid : [cid || ((b.pitched && b.pitched.creators && b.pitched.creators[0]) || (W.D().creators.filter(function(x){ return x.stage === "signed"; })[0] || {}).id)];
  var cs = cids.map(W.creator).filter(Boolean);
  if (!cs.length) return;
  var lastDid = null, lastQid = null;
  W.act("Started negotiation deal: " + b.name + " × " + cs.map(function(c){ return c.name; }).join(" + "), function(d){
    var bb = d.brands.filter(function(z){ return z.id === bid; })[0]; if (bb) bb.status = "negotiating";
    cs.forEach(function(c){
      var ask = W.priceFor(c), rate = W.payoutFor(c, ask), offer = b.budget ? Math.min(ask, b.budget[1]) : Math.round(ask * .9 / 50) * 50;
      var did = W.uid("d"), qid = W.uid("q");
      lastDid = did; lastQid = qid;
      d.deals.push({id:did, brand:bid, creator:c.id, step:0, checks:[false,false,false,false], price:ask, payout:rate, dealModel:c.relationshipModel || "brokered", videoCount:opts.videoCount || 1, videosDelivered:0, owner:d.me, creatorDeadline:W.at(16), golive:W.at(21), due:W.at(1), deliverable:"60–90 s integration in the first third", terms:"Net 30", created:W.now(), invoice:{no:null,sent:null,due:null,paid:null}, report:null, paidCreator:null,
        contractClauses:[true,true,true,true,true,true,true], redlineFlags:[],
        shipping:{required:false, promoCode:c.handle.slice(1).toUpperCase().slice(0,8), utmLink:(b.site || b.name.toLowerCase()+".com") + "/" + c.handle.slice(1)},
        scriptApproved:false, placementWindow:"First third (01:30–03:00)", qcChecks:[false,false,false,false,false],
        neg:{ask:ask, offer:offer, rate:rate, floor:d.rules.marginFloor || 25, hist:[{who:"us", amt:ask, at:W.now(), note:"Opening quote from pitch"},{who:"brand", amt:offer, at:W.now(), note:"Initial budget indication"}]}});
      d.drafts.push({id:qid, kind:"reply", to:{t:"brand", id:bid}, deal:did, mailbox:"m1", created:W.now(), subject:"Re: " + c.name + " for " + b.name,
        body:"Hi " + (b.contact ? b.contact.split(" ")[0] : "there") + ",\n\nThanks for getting back to us. For " + c.name + " (" + W.fmtK(c.trimmedAvgViews || c.median) + " 12-video avg views, " + (c.countries[0] ? c.countries[0][1] + "% " + c.countries[0][0] : "strong US audience") + "), our rate for a 60–90 second first-third integration is " + W.money(ask) + ". Shall I lock in the November slot for you?\n\nMoustafa",
        why:"Opening negotiation reply linked to the deal price ladder.", rules:["BRD-NEG-04","BRD-PRICE-09"], gates:[{k:"price", text:"This email names a price: " + W.money(ask) + ". Confirm it before sending."}]});
    });
  }, {ref:{t:"deal", id:lastDid}, toast:{msg:b.name + " × " + cs.map(function(c){ return c.name; }).join(" + ") + " moved to Negotiate", sub:"Price ladder and reply draft are ready on Close › Negotiate.", icon:"dollar", go:{label:"Negotiate", run:function(){ W.go("close", "negotiate"); }}}});
  return lastDid;
};

A.counter = function(dealId, amt, opts){
  opts = opts || {};
  var x = W.deal(dealId); if (!x) return;
  var b = W.brand(x.brand), c = W.creator(x.creator);
  var negAsk = (x.neg && x.neg.ask) ? x.neg.ask : x.price;
  var negRate = (x.neg && x.neg.rate) ? x.neg.rate : x.payout;
  var newRate = opts.payout != null ? opts.payout : negRate;
  var deliv = opts.deliverable || x.deliverable || "60–90 s integration";
  var dealModel = opts.dealModel || x.dealModel || "brokered";
  var scopeNote = opts.scopeNote || (amt < negAsk ? "with paid usage limited to organic channel upload" : "with a pinned comment and top-3 link included");
  var qid = null;
  W.act("Set the counter-offer for " + W.dealName(x) + " to " + W.money(amt) + " (" + dealModel + ")", function(d){
    var dx = d.deals.filter(function(z){ return z.id === dealId; })[0];
    if (dx){
      dx.price = amt; dx.payout = newRate; dx.deliverable = deliv; dx.dealModel = dealModel;
      if (opts.videoCount) dx.videoCount = opts.videoCount;
      if (dx.neg){ dx.neg.ask = amt; dx.neg.rate = newRate; }
    }
    var q = d.drafts.filter(function(z){ return z.deal === dealId && z.to.t === "brand"; })[0];
    var body = "Hi " + (b.contact ? b.contact.split(" ")[0] : "there") + ",\n\nThanks for coming back quickly. " +
      (dealModel === "cpm" ? "We can structure " + c.name + "'s integration on a performance basis: " + W.money(Math.round(amt * 0.5)) + " base fee + $40 CPM capped at " + W.money(amt) + " with a 70% view guarantee threshold (BRD-NEG-25)."
        : amt >= negAsk ? c.name + "'s " + deliv.toLowerCase() + " runs at " + W.money(amt) + ", backed by a " + W.fmtK(c.trimmedAvgViews || c.median) + " 12-video trimmed average."
        : "We can meet you at " + W.money(amt) + " for the " + deliv.toLowerCase() + ", " + scopeNote + ".") +
      " I can hold the upcoming slot for you. Shall I send the agreement over?\n\nMoustafa";
    if (q){ qid = q.id; q.body = body; q.gates = [{k:"price", text:"This email names a price: " + W.money(amt) + ". Confirm it before sending."}]; }
    else {
      qid = W.uid("q");
      d.drafts.push({id:qid, kind:"reply", to:{t:"brand", id:b.id}, deal:dealId, mailbox:"m1", created:W.now(), subject:"Re: " + c.name + " for " + b.name, body:body,
        why:"Counter-offer from the price ladder.", rules:["BRD-NEG-04","BRD-PRICE-09"], gates:[{k:"price", text:"This email names a price: " + W.money(amt) + ". Confirm it before sending."}]});
    }
  }, {ref:{t:"deal", id:dealId}, toast:{msg:"Counter set to " + W.money(amt), sub:"The reply to " + b.name + " is updated right beside the ladder.", icon:"dollar", tone:"info"}});
};

A.squeezeCreator = function(dealId, targetPayout){
  var x = W.deal(dealId); if (!x) return;
  var c = W.creator(x.creator), b = W.brand(x.brand), qid = W.uid("q");
  W.act("Asked " + c.name + " to align payout at " + W.money(targetPayout) + " for " + b.name, function(d){
    var dx = d.deals.filter(function(z){ return z.id === dealId; })[0];
    if (dx){ dx.payout = targetPayout; if (dx.neg) dx.neg.rate = targetPayout; }
    d.drafts.push({id:qid, kind:"reply", to:{t:"creator", id:c.id}, deal:dealId, mailbox:"m1", created:W.now(), subject:"Re: " + b.name + " campaign slot",
      body:"Hi " + (firstName(c) || "there") + ",\n\n" + b.name + " wants to book your channel for next month. For this campaign we can allocate " + W.money(targetPayout) + " for the " + x.deliverable.toLowerCase() + " (with zero editing re-shoots and fast payout). Would that be a dealbreaker for you, or can we lock it in?\n\nMoustafa",
      why:"Honest campaign-specific rate revisit to protect agency margin (HC-13, INF-NEG-32, BRD-NEG-04).", rules:["INF-NEG-32","BRD-NEG-04","HC-13"], gates:[{k:"price", text:"This email proposes a creator payout of " + W.money(targetPayout) + ". Confirm before sending."}]});
  }, {ref:{t:"deal", id:dealId}, toast:{msg:"Creator rate counter drafted (" + W.money(targetPayout) + ")", sub:"Opened right here in QuickDraft.", icon:"dollar", go:{label:"Composer", run:function(){ W.openQuickDraft(qid); }}}});
  if (W.U().route.s !== "today") W.openQuickDraft(qid);
};

A.counterCreatorRate = function(cid, targetRate){
  var c = W.creator(cid); if (!c) return;
  var qid = W.uid("q");
  W.act("Drafted onboarding rate counter (" + W.money(targetRate) + ") to " + c.name, function(d){
    d.drafts.push({id:qid, kind:"reply", to:{t:"creator", id:cid}, mailbox:"m1", created:W.now(), subject:"Re: partnership rates",
      body:"Hi " + (firstName(c) || "there") + ",\n\nThanks for sending the audience numbers over, the US share looks strong. The brands we work with for channels around " + W.fmtK(c.trimmedAvgViews || c.median) + " average views usually allocate closer to " + W.money(targetRate) + " per 60–90s integration. Would that range be a dealbreaker for you?\n\nMoustafa",
      why:"Onboarding rate negotiation: test flexibility politely before locking roster rate (HC-13, INF-NEG-31).", rules:["INF-NEG-31","HC-13"], gates:[{k:"price", text:"This email proposes a rate of " + W.money(targetRate) + ". Confirm before sending."}]});
  }, {ref:{t:"creator", id:cid}, toast:{msg:"Rate counter (" + W.money(targetRate) + ") drafted to " + c.name, sub:"Opened right here in QuickDraft.", icon:"dollar", go:{label:"Composer", run:function(){ W.openQuickDraft(qid); }}}});
  if (W.U().route.s !== "today") W.openQuickDraft(qid);
};

A.replaceDealCreator = function(dealId, newCid){
  var x = W.deal(dealId); if (!x) return;
  var b = W.brand(x.brand), oldC = W.creator(x.creator), newC = W.creator(newCid);
  if (!newC) return;
  var newAsk = W.priceFor(newC), newRate = W.payoutFor(newC, newAsk);
  W.act("Swapped " + oldC.name + " for replacement " + newC.name + " on " + b.name + " deal", function(d){
    var dx = d.deals.filter(function(z){ return z.id === dealId; })[0];
    if (dx){ dx.creator = newC.id; dx.price = newAsk; dx.payout = newRate; if (dx.neg){ dx.neg.ask = newAsk; dx.neg.rate = newRate; dx.neg.hist.push({who:"us", amt:newAsk, at:W.now(), note:"Swapped to " + newC.name + " (HC-23)"}); } }
    var q = d.drafts.filter(function(z){ return z.deal === dealId; })[0];
    var body = "Hi " + (b.contact ? b.contact.split(" ")[0] : "there") + ",\n\nIt won't work out with " + oldC.name + " for this campaign window after all. We have " + newC.name + " (" + W.fmtK(newC.trimmedAvgViews || newC.median) + " avg views, " + (newC.countries[0] ? newC.countries[0][1] + "% " + newC.countries[0][0] : "strong US audience") + ", " + newC.eng + "% engagement) ready for the same window at " + W.money(newAsk) + ". Would you like to lock " + newC.name + " in instead?\n\nMoustafa";
    if (q){ q.body = body; q.gates = [{k:"price", text:"This email names a price: " + W.money(newAsk) + ". Confirm before sending."}]; }
  }, {ref:{t:"deal", id:dealId}, toast:{msg:"Swapped to " + newC.name + " (HC-23)", sub:"Replacement pitch written to " + b.name + " at " + W.money(newAsk) + ".", icon:"users"}});
};

/* ---------- Deliver & Lifecycle Actions (Systems 11, 12, 13, 14, 15) ---------- */
A.jumpDealStep = function(dealId, stepIdx){
  var x = W.deal(dealId); if (!x || stepIdx < 0 || stepIdx >= W.DEAL_FLOW.length) return;
  W.act("Moved " + W.dealName(x) + " to step " + (stepIdx + 1) + " (" + W.DEAL_FLOW[stepIdx].name + ")", function(d){
    var y = d.deals.filter(function(z){ return z.id === dealId; })[0];
    if (!y) return;
    y.step = stepIdx;
    y.checks = W.DEAL_FLOW[stepIdx].items.map(function(_, i){ return y.checks[i] || false; });
  }, {ref:{t:"deal", id:dealId}, toast:{msg:"Switched to " + W.DEAL_FLOW[stepIdx].name, sub:"10-step Deal Lifecycle Ribbon updated.", icon:"layers", tone:"info"}});
};

A.tick = function(dealId, i){
  var x = W.deal(dealId), st = W.DEAL_FLOW[x.step];
  if (st.ordered && i > 0 && !x.checks[i - 1] && !x.checks[i]){ W.toast({msg:"Signing order locked (BRD-CONTRACT-08)", sub:st.note, icon:"lock", tone:"warn"}); return; }
  if (st.lockedUntilPaid && !x.invoice.paid){ W.toast({msg:"Locked until " + W.brand(x.brand).name + " pays", sub:"Creators are paid from money already received.", icon:"lock", tone:"warn"}); return; }
  /* System 13: Enforce 5-Point Video Draft QC Gate before marking Brand Approved on step 3 */
  if (x.step === 3 && i >= 2 && !x.checks[i] && x.qcChecks && x.qcChecks.some(function(v){ return !v; })){
    W.toast({msg:"Complete the 5-Point Video QC Gate first (INF-DELIV-07)", sub:"Verify talking points, 60–90s length, UTM link, #ad disclosure (FND-ETH-13), and zero copyrighted music (HC-33).", icon:"shield", tone:"warn"});
    return;
  }
  var turningOn = !x.checks[i], last = turningOn && x.checks.filter(Boolean).length === x.checks.length - 1;
  var label = (turningOn ? "Ticked " : "Unticked ") + "\"" + st.items[i] + "\" on " + W.dealName(x);
  W.act(label, function(d){
    var y = d.deals.filter(function(z){ return z.id === dealId; })[0];
    y.checks[i] = !y.checks[i];
    if (st.ordered && !y.checks[i]) for (var j = i + 1; j < y.checks.length; j++) y.checks[j] = false;
    if (last) advance(d, y);
  }, {ref:{t:"deal", id:dealId}, toast:last ? {msg:st.name + " done", sub:W.dealName(x) + " moved to " + (W.DEAL_FLOW[x.step + 1] || {name:"done"}).name + ".", icon:"checkc"} : null});
};

A.tickQc = function(dealId, idx){
  var x = W.deal(dealId); if (!x) return;
  W.act("Updated 5-Point Video QC check on " + W.dealName(x), function(d){
    var y = d.deals.filter(function(z){ return z.id === dealId; })[0];
    if (!y) return;
    y.qcChecks = y.qcChecks || [false,false,false,false,false];
    y.qcChecks[idx] = !y.qcChecks[idx];
    if (y.qcChecks.every(Boolean) && y.step === 3) y.checks[2] = true;
  }, {log:false});
};

A.updateShipping = function(dealId, patch, trackingArg){
  if (typeof patch === "string") patch = {status:patch, tracking:trackingArg || "", deliveredAt:patch === "delivered" ? W.now() : null};
  var x = W.deal(dealId); if (!x) return;
  W.act("Updated shipping & tracking for " + W.dealName(x), function(d){
    var y = d.deals.filter(function(z){ return z.id === dealId; })[0];
    if (!y) return;
    y.shipping = Object.assign({}, y.shipping || {}, patch);
    if (patch.deliveredAt){
      /* INF-DELIV-08: Filming deadline clock starts on product delivery date! */
      y.creatorDeadline = patch.deliveredAt + 7 * W.DAY;
      y.golive = y.creatorDeadline + 5 * W.DAY;
      if (y.step === 2) y.checks[1] = true;
    }
  }, {ref:{t:"deal", id:dealId}, toast:{msg:"Shipping & tracking updated", sub:patch.deliveredAt ? "Product delivered! Creator filming clock started (+7d draft, +12d go-live per INF-DELIV-08)." : "Tracking saved.", icon:"truck"}});
};

function advance(d, y, quiet){
  var from = y.step;
  if (y.step < W.DEAL_FLOW.length - 1){ y.step++; y.checks = W.DEAL_FLOW[y.step].items.map(function(){ return false; }); }
  var sk = W.DEAL_FLOW[y.step].k;
  if (sk === "contracts") y.due = W.now() + 2 * W.DAY;
  if (sk === "brief") y.due = W.now() + W.DAY;
  if (sk === "draft") y.due = Math.min(W.now() + 2 * W.DAY, Math.max(W.now() + W.DAY, (y.golive || W.at(10)) - 5 * W.DAY));
  if (sk === "prelive") y.due = Math.min(W.now() + 2 * W.DAY, Math.max(W.now() + W.DAY, (y.golive || W.at(5)) - 2 * W.DAY));
  if (sk === "golive"){ if (!y.golive) y.golive = W.now(); y.due = y.golive; }
  if (sk === "invoice") y.due = y.golive || W.now();
  if (sk === "report"){
    var cr = W.creator(y.creator);
    y.report = y.report || {views:Math.round((cr.trimmedAvgViews || cr.median) * 1.18), targetViews:cr.trimmedAvgViews || cr.median, clicks:1140, ctr:1.42, retentionPct:73, verdict:"overperformed"};
    y.report.due = (y.golive || W.now()) + 30 * W.DAY; y.due = y.report.due;
  }
  if (sk === "pay") y.due = y.invoice.paid ? W.now() : (y.invoice.due || W.now() + 14 * W.DAY);
  if (sk === "next") y.due = W.now() + W.DAY;
  if (!quiet) markDone(d, "deal:" + y.id, W.DEAL_FLOW[from].name + " done for " + W.dealName(y), "deals", 4);
}
A.advance = function(dealId){ var x = W.deal(dealId); W.act("Moved " + W.dealName(x) + " to " + (W.DEAL_FLOW[x.step + 1] || {}).name, function(d){ advance(d, d.deals.filter(function(z){ return z.id === dealId; })[0]); }, {ref:{t:"deal", id:dealId}, toast:{msg:"Moved to " + (W.DEAL_FLOW[x.step + 1] || {}).name, icon:"arrowR"}}); };
A.sendInvoice = function(dealId){
  var x = W.deal(dealId), b = W.brand(x.brand);
  var base = (x.golive && x.golive < W.now()) ? x.golive : W.now(), due = base + 30 * W.DAY;
  W.act("Sent " + b.name + "'s invoice " + (x.invoice.no || ""), function(d){
    var y = d.deals.filter(function(z){ return z.id === dealId; })[0];
    y.invoice.no = y.invoice.no || "GR-2026-0" + (30 + d.deals.indexOf(y)); y.invoice.sent = W.now(); y.invoice.due = due; y.checks = [true];
    markDone(d, "invoice:" + dealId, "Sent " + b.name + "'s invoice", "money", 3);
    if (y.step === 6) advance(d, y, true);
  }, {ref:{t:"deal", id:dealId}, toast:{msg:"Invoice sent to " + b.name, sub:W.money(x.price) + " all-in (no surprise VAT per BRD-PAY-09), due " + W.fmtDate(due) + " (Net 30 from go-live).", icon:"wallet"}});
};
A.markPaid = function(dealId, when, partialAmt){
  var x = W.deal(dealId), b = W.brand(x.brand), c = W.creator(x.creator);
  if (partialAmt && partialAmt < x.price){
    W.act("Recorded 50% deposit (" + W.money(partialAmt) + ") from " + b.name, function(d){
      var y = d.deals.filter(function(z){ return z.id === dealId; })[0];
      y.invoice.paidPart = partialAmt; y.invoice.partialPaid = partialAmt; y.invoice.paidPartAt = when || W.now();
    }, {ref:{t:"deal", id:dealId}, toast:{msg:"50% deposit (" + W.money(partialAmt) + ") recorded from " + b.name, sub:W.money(x.price - partialAmt) + " remains open. Full creator payout unlocks when final 50% arrives.", icon:"wallet", tone:"info"}});
    return;
  }
  W.act("Marked " + b.name + " as paid (" + W.money(x.price) + ")", function(d){ var y = d.deals.filter(function(z){ return z.id === dealId; })[0]; y.invoice.paid = when || W.now(); delete y.invoice.paidPart; delete y.invoice.partialPaid; if (y.step === 8) y.due = W.now(); markDone(d, "collect:" + dealId, b.name + " paid " + W.money(x.price), "money", 1); },
    {ref:{t:"deal", id:dealId}, toast:{msg:W.money(x.price) + " received from " + b.name, sub:c.name + "'s " + W.money(x.payout) + " payout is unlocked in Today › Get paid.", icon:"unlock"}});
};
A.nudge = function(dealId){
  var x = W.deal(dealId), b = W.brand(x.brand), c = W.creator(x.creator), id = W.uid("q");
  var daysLate = x.invoice.due ? -W.dayDiff(x.invoice.due) : 0;
  var hasPerf = x.report && x.report.views;
  var body = (daysLate <= 3 && hasPerf)
    ? "Hi " + b.contact.split(" ")[0] + ",\n\nQuick update on " + c.name + "'s integration: the video just passed " + W.fmtK(x.report.views) + " views and " + (x.report.clicks || 1200).toLocaleString() + " link clicks (" + (x.report.ctr || 1.35) + "% CTR).\n\nAlso checking in to make sure invoice " + x.invoice.no + " for " + W.money(x.price) + " all-in (due " + W.fmtShort(x.invoice.due) + ") landed cleanly with your finance team. Do you have an estimated payment date?\n\nThanks,\nMoustafa"
    : "Hi " + b.contact.split(" ")[0] + ",\n\nFollowing up on invoice " + x.invoice.no + " for " + W.money(x.price) + " (" + c.name + "'s video, live " + W.fmtShort(x.golive) + "), which is now past the agreed Net 30 due date of " + W.fmtShort(x.invoice.due) + ". Could you confirm the scheduled payment date with your finance team?\n\nThanks,\nMoustafa";
  W.act("Drafted a payment reminder to " + b.name, function(d){
    d.drafts.push({id:id, kind:"nudge", to:{t:"brand", id:x.brand}, deal:dealId, mailbox:"m1", created:W.now(), subject:"Invoice " + x.invoice.no + " + " + c.name + " performance update",
      body:body,
      why:daysLate <= 3 && hasPerf ? "Chocolate-Pill reminder (BRD-PAY-01): leads with positive campaign results before checking on the invoice." : "Overdue past contract terms (BRD-PAY-08): states the due date plainly and asks for a firm payment date.", rules:daysLate <= 3 ? ["BRD-PAY-01"] : ["BRD-PAY-08"], gates:[]});
  }, {ref:{t:"deal", id:dealId}, toast:{msg:"Reminder drafted", sub:"Opened right here in QuickDraft.", icon:"mail", go:{label:"Composer", run:function(){ W.openQuickDraft(id); }}}});
  if (W.U().route.s !== "today") W.openQuickDraft(id);
};
A.payCreator = function(dealId, opts){
  opts = opts || {};
  var x = W.deal(dealId), c = W.creator(x.creator);
  W.act("Paid " + c.name + " " + W.money(x.payout) + (opts.ref ? " (ref " + opts.ref + ")" : ""), function(d){ var y = d.deals.filter(function(z){ return z.id === dealId; })[0]; y.paidCreator = opts.at || W.now(); if (opts.ref) y.payRef = opts.ref; if (y.step === 8){ y.checks = [true]; advance(d, y, true); } markDone(d, "payout:" + dealId, "Paid " + c.name + " " + W.money(x.payout), "money", 2); },
    {ref:{t:"deal", id:dealId}, toast:{msg:"Paid " + c.name + " " + W.money(x.payout), sub:(opts.ref ? "Ref: " + opts.ref + " · " : "") + "Margin on this deal: " + W.money(x.price - x.payout) + ". Next: pitch " + W.brand(x.brand).name + " again.", icon:"wallet"}});
};
A.sendReport = function(dealId){
  var x = W.deal(dealId), b = W.brand(x.brand), c = W.creator(x.creator), qid = W.uid("q");
  var isUnder = x.report && x.report.verdict === "underperformed";
  W.act("Sent the 30-day report to " + b.name + (isUnder ? " with proactive Make-Good offer (BRD-AFTER-07)" : " + Retainer / Droplet pitch (BRD-AFTER-16)"), function(d){
    var y = d.deals.filter(function(z){ return z.id === dealId; })[0];
    y.report.sent = W.now(); y.checks = y.checks.map(function(){ return true; });
    var body = isUnder
      ? "Hi " + (b.contact ? b.contact.split(" ")[0] : "there") + ",\n\nHere is the 30-day wrap-up on " + c.name + "'s integration: the video reached " + W.fmtK(x.report.views) + " views and " + (x.report.clicks || 590) + " clicks (" + (x.report.ctr || 1.43) + "% CTR), which landed slightly below our " + W.fmtK(x.report.targetViews || 58000) + " benchmark.\n\nBecause we stand behind every campaign (BRD-AFTER-07), we have already arranged a complimentary YouTube Short cutdown + 30-day pinned comment extension with " + c.name + " next week at zero cost to make up the impression gap. Does that work well for your team?\n\nMoustafa, Gratovo"
      : "Hi " + (b.contact ? b.contact.split(" ")[0] : "there") + ",\n\n30-day performance report for " + c.name + " × " + b.name + ":\n• Views: " + W.fmtK(x.report.views) + " (+" + Math.round(((x.report.views / Math.max(1, x.report.targetViews || c.median)) - 1) * 100) + "% above benchmark)\n• Link Clicks: " + (x.report.clicks || 1310).toLocaleString() + " (" + (x.report.ctr || 1.39) + "% CTR · " + (x.report.retentionPct || 74) + "% sponsor segment retention)\n\nWe also just signed two channels with the exact same developer audience (BRD-AFTER-16) and can lock a 3-month Q1 retainer at an 8% bundle discount. Worth a 10-minute look this week?\n\nMoustafa, Gratovo";
    d.drafts.push({id:qid, kind:"report", to:{t:"brand", id:b.id}, deal:dealId, mailbox:"m1", created:W.now(),
      subject:c.name + " × " + b.name + " 30-day ROI report" + (isUnder ? " + bonus Short make-good" : " + next steps"),
      body:body, why:isUnder ? "Proactive Make-Good report (BRD-AFTER-07, BRD-AFTER-10): flags view shortfall before the brand complains and delivers a pre-arranged recovery Short." : "30-day ROI Case Study + Droplet Cross-Sell (BRD-AFTER-12, BRD-AFTER-16).",
      rules:isUnder ? ["BRD-AFTER-07","BRD-AFTER-10"] : ["BRD-AFTER-12","BRD-AFTER-16"], gates:[]});
    markDone(d, "deal:" + dealId, "Sent " + b.name + " the 30-day report", "deals", 8);
    advance(d, y, true);
  }, {ref:{t:"deal", id:dealId}, toast:{msg:"30-day report drafted to " + b.name, sub:"Opened right here in QuickDraft.", icon:"chart", go:{label:"Composer", run:function(){ W.openQuickDraft(qid); }}}});
  if (W.U().route.s !== "today") W.openQuickDraft(qid);
};

/* System 14: Post-Go-Live Hype Cadence (24h / 7d / 14d / 30d Studio Pull) & Whitelisting Renewal (BRD-AFTER-08, INF-AFTER-02, HC-30) */
A.sendHypeTouch = function(dealId, touchKey){
  var x = W.deal(dealId); if (!x) return;
  var b = W.brand(x.brand), c = W.creator(x.creator), qid = W.uid("q");
  var isCreatorPull = touchKey === "d30_creator";
  var isWhitelist = touchKey === "whitelist_renew";
  W.act("Drafted post-go-live " + touchKey + " touch for " + W.dealName(x), function(d){
    var y = d.deals.filter(function(z){ return z.id === dealId; })[0];
    if (y){ y.hypeCadence = y.hypeCadence || {}; y.hypeCadence[touchKey] = true; }
    if (isCreatorPull){
      d.drafts.push({id:qid, kind:"reply", to:{t:"creator", id:c.id}, deal:dealId, mailbox:"m1", created:W.now(),
        subject:"30-day YouTube Studio retention screenshot for " + b.name + " renewal",
        body:"Hi " + (firstName(c) || "there") + ",\n\nYour " + b.name + " integration just hit 30 days! Could you send a quick screenshot of the YouTube Studio audience retention graph for that video (INF-AFTER-02)? We use it to pitch " + b.name + " on a multi-video renewal for your channel.\n\nMoustafa",
        why:"Pulls 30-day YouTube Studio retention from the creator to power the brand renewal pitch (INF-AFTER-02).", rules:["INF-AFTER-02"], gates:[]});
    } else if (isWhitelist){
      var wlFee = Math.round(x.price * 0.25 / 50) * 50;
      d.drafts.push({id:qid, kind:"upsell", to:{t:"brand", id:b.id}, deal:dealId, mailbox:"m1", created:W.now(),
        subject:c.name + " × " + b.name + " 30-day whitelisting / paid ad rights renewal",
        body:"Hi " + (b.contact ? b.contact.split(" ")[0] : "there") + ",\n\nHeads-up that the 30-day paid ad / Spark whitelisting window on " + c.name + "'s integration expires on " + W.fmtDate(x.whitelistingExpiry || W.at(3)) + " (HC-30).\n\nSince the segment is converting at " + ((x.report && x.report.ctr) || 1.39) + "% CTR, would you like to extend paid ad usage for another 30 days at " + W.money(wlFee) + " (+25%)?\n\nMoustafa, Gratovo",
        why:"30-day paid ad whitelisting renewal alert (HC-30).", rules:["HC-30","BRD-AFTER-15"], gates:[{k:"price", text:"Quotes " + W.money(wlFee) + " for 30-day whitelisting extension. Confirm before sending."}]});
    } else {
      var daysLabel = touchKey === "d7" ? "Day-7 early traction" : "Day-14 momentum";
      var estViews = Math.round((c.trimmedAvgViews || c.median) * (touchKey === "d7" ? 0.68 : 0.92));
      d.drafts.push({id:qid, kind:"reply", to:{t:"brand", id:b.id}, deal:dealId, mailbox:"m1", created:W.now(),
        subject:daysLabel + " snapshot: " + c.name + " × " + b.name + " (" + W.fmtK(estViews) + " views)",
        body:"Hi " + (b.contact ? b.contact.split(" ")[0] : "there") + ",\n\nQuick " + daysLabel.toLowerCase() + " update on " + c.name + "'s integration (BRD-AFTER-08): the video just crossed " + W.fmtK(estViews) + " views with strong developer comments on the " + b.name + " workflow demo.\n\nWe're tracking toward " + W.fmtK(Math.round((c.trimmedAvgViews || c.median) * 1.15)) + "+ by Day 30 — I'll send the full 30-day retention & click report once the window completes.\n\nMoustafa, Gratovo",
        why:"Post-go-live hype cadence (BRD-AFTER-08): shares early traction screenshots at Day 7 and Day 14 so the brand feels taken care of before renewal.", rules:["BRD-AFTER-08"], gates:[]});
    }
  }, {ref:{t:"deal", id:dealId}, toast:{msg:"Post-go-live touch drafted", sub:"Opened right here in QuickDraft.", icon:"trend", go:{label:"Composer", run:function(){ W.openQuickDraft(qid); }}}});
  W.openQuickDraft(qid);
};

/* System 13: 7d / 72h / 24h Pre-Go-Live Creator Check-In Generator (INF-DELIV-10/11) */
A.sendPreLiveCheckin = function(dealId, windowLabel){
  var x = W.deal(dealId); if (!x) return;
  var b = W.brand(x.brand), c = W.creator(x.creator), qid = W.uid("q");
  W.act("Drafted " + windowLabel + " pre-go-live check-in to " + c.name, function(d){
    d.drafts.push({id:qid, kind:"reply", to:{t:"creator", id:c.id}, deal:dealId, mailbox:"m1", created:W.now(),
      subject:windowLabel + " check-in: " + b.name + " integration (" + W.fmtShort(x.golive) + ")",
      body:"Hi " + (firstName(c) || "there") + ",\n\nQuick " + windowLabel + " check-in ahead of the " + W.fmtDate(x.golive) + " publish slot for " + b.name + " (INF-DELIV-10):\n• Tracking link for top 3 lines + pinned comment: " + ((x.shipping && x.shipping.utmLink) || x.link || "attached in brief") + "\n• Promo code: " + ((x.shipping && x.shipping.promoCode) || c.handle.slice(1).toUpperCase()) + "\n• Quick reminder: keep background music off during the sponsor read (HC-33) and toggle YouTube's paid promotion box (#ad per FND-ETH-13).\n\nEverything still on track for " + W.fmtShort(x.golive) + "?\n\nMoustafa",
      why:"Proactive " + windowLabel + " pre-go-live check-in (INF-DELIV-10, INF-DELIV-11, HC-33, FND-ETH-13).", rules:["INF-DELIV-10","INF-DELIV-11","HC-33","FND-ETH-13"], gates:[]});
  }, {ref:{t:"deal", id:dealId}, toast:{msg:windowLabel + " check-in drafted to " + c.name, sub:"Opened right here in QuickDraft.", icon:"clock", go:{label:"Composer", run:function(){ W.openQuickDraft(qid); }}}});
  W.openQuickDraft(qid);
};

/* ---------- superchargers & edge-case actions ---------- */
A.pickMoment = function(cid, idx){
  var c = W.creator(cid); if (!c || !c.moments || !c.moments[idx]) return;
  var m = c.moments[idx];
  W.act("Picked video moment " + m.at + " for " + c.name, function(d){
    var x = d.creators.filter(function(z){ return z.id === cid; })[0];
    if (x){ x.momentIdx = idx; x.moment = m.at + ' "' + m.quote + '"'; }
    d.drafts.forEach(function(q){
      if (q.kind === "first" && q.to.t === "creator" && q.to.id === cid){
        var fresh = W.makeFirst(x, idx);
        q.momentIdx = idx; q.subject = fresh.subject; q.body = fresh.body;
      }
    });
  }, {log:false, toast:{msg:"Swapped to moment at " + m.at, sub:'"' + m.quote + '"', icon:"video", tone:"info", ms:2800}});
};
A.fixDraftLint = function(qid){
  var q = W.draft(qid); if (!q) return;
  W.act("Cleaned draft to " + W.toName(q) + " against playbook rules", function(d){
    var x = d.drafts.filter(function(z){ return z.id === qid; })[0]; if (!x) return;
    x.subject = String(x.subject || "").replace(/^re:\s*/i, (x.kind === "first" || x.kind === "pitch") ? "" : "Re: ").replace(/\u2014|--/g, "-").replace(/partnership opportunity|collaboration request|sponsorship inquiry/ig, "quick idea");
    var b = String(x.body || "").replace(/\s*\u2014\s*|\s*--\s*/g, ", ")
      .replace(/we help (ai )?(creators|influencers)( land)?/ig, "we pair creators on")
      .replace(/\bwe help\b/ig, "we work with")
      .replace(/\s*i hope this finds you well[!. ]*/ig, " ")
      .replace(/\b(was a great watch|is brilliant|was brilliant|love your|huge fan|awesome video|love the honest)\b/ig, "stood out to our team")
      .replace(/brands ask for it/ig, "so we can match your audience to our active brand campaigns")
      .replace(/\bopportunity\b/ig, "fit").replace(/\bguarantee(d)?\b/ig, "consistent")
      .replace(/\bscale\b/ig, "grow").replace(/\brevenue\b/ig, "results")
      .replace(/\bsynergy\b/ig, "fit").replace(/\bthrilled\b/ig, "glad")
      .replace(/\s*(just )?(floating this back up|bumping this|slipped through the cracks|circling back)[^.\n]*\.?/ig, "");
    if (x.kind === "pitch" && x.pitchMode !== "warm"){
      b = b.replace(/\b\d+[KkMm]?\s+subscribers,?\s*/ig, "");
      b = b.replace(/A 60–90 second integration starts at \$[\d,]+\./ig, "Both have November integration slots open.");
    }
    var signMatch = b.match(/\n+(?:Thanks,?\s*\n*)?(Moustafa[^\n]*)/i);
    var sign = signMatch ? signMatch[1] : "Moustafa, Gratovo";
    var core = b.replace(/\n+(?:Thanks,?\s*\n*)?Moustafa[\s\S]*$/i, "").trim();
    if ((x.kind === "first" || (x.kind === "followup" && x.n !== 3) || x.kind === "pitch") && !/\?\s*$/.test(core)){
      core = core.replace(/[.!]\s*$/, "") + " — open to taking a quick look?".replace(/\u2014/g, ",");
    }
    if (x.kind === "first" && core.split(/\s+/).length > 74 && x.to.t === "creator"){
      var cr = d.creators.filter(function(z){ return z.id === x.to.id; })[0];
      if (cr){ var fresh = W.makeFirst(cr, x.momentIdx || cr.momentIdx || 0); x.body = fresh.body; return; }
    }
    x.body = core + "\n\n" + sign;
  }, {log:false, toast:{msg:"Playbook issues fixed", sub:"Removed AI tells, fanboy/hype words, and ensured a clean question CTA.", icon:"sparkle", tone:"good", ms:3000}});
};
A.draftDm = function(cid, platform){
  var c = W.creator(cid); if (!c) return;
  platform = platform || "Instagram DM";
  var m = (c.moments && c.moments[c.momentIdx || 0]) ? c.moments[c.momentIdx || 0] : {at:"2:40", quote:c.videos[0] ? c.videos[0].t : "your latest video"};
  var dmText = "Paid collab: Hey " + (firstName(c) || c.name.split(" ")[0]) + ", the part at " + m.at + " in your latest video was spot on. " + W.truthfulBrandBridge(c) + " Who handles your brand deals, or what's the best email to send a quick idea over?";
  W.copy(dmText, platform + " to " + c.name);
  W.act("Sent " + platform + " to " + c.name + " (copied to clipboard)", function(d){
    var x = d.creators.filter(function(z){ return z.id === cid; })[0];
    if (x){
      x.dmSent = {via:platform, at:W.now()};
      x.stage = "emailed";
      var t = W.now(), fu1 = W.addWorkDays ? W.addWorkDays(t, 2, 9) : t + 3 * W.DAY;
      x.seq = {steps:[{k:"first", at:t, st:"sent"},{k:"fu1", at:fu1, st:"planned"}]};
    }
    var th = d.threads[cid] = d.threads[cid] || [];
    th.push({dir:"out", at:W.now(), text:"[" + platform + "] " + dmText, by:d.me});
    markDone(d, "contact:" + cid, "Sent " + platform + " to " + c.name, "contacts", 1.5);
  }, {ref:{t:"creator", id:cid}, toast:{msg:platform + " copied & logged for " + c.name, sub:"Starts with 'Paid collab:' (INF-FIRST-23) so the request preview shows business intent.", icon:"copy", tone:"good"}});
};
A.spotBrand = function(name, cid){
  var clean = String(name || "").trim(); if (!clean) return;
  var existing = D().brands.filter(function(b){ return b.name.toLowerCase() === clean.toLowerCase(); })[0];
  if (existing){
    if (cid && existing.seen.indexOf(cid) < 0){
      W.act("Linked " + clean + " to " + W.creator(cid).name, function(d){
        var bb = d.brands.filter(function(z){ return z.id === existing.id; })[0];
        if (bb && bb.seen.indexOf(cid) < 0) bb.seen.push(cid);
      }, {log:false});
    }
    W.peek("brand", existing.id);
    return existing.id;
  }
  var bid = W.uid("b");
  W.act("Spotted brand " + clean + (cid ? " on " + W.creator(cid).name : ""), function(d){
    d.brands.push({id:bid, name:clean, sells:"AI software tool", cat:"ai", country:"US", headcount:45, recommendedTitle:"Founder / CMO (<50 emp)", paidSpenderVerified:true, pastCampaignHook:"your recent creator integration on " + (cid ? W.creator(cid).name : "YouTube"), budget:null, contact:"", email:"", status:"found", seen:cid ? [cid] : [], since:W.now(), site:clean.toLowerCase().replace(/[^a-z0-9]/g, "") + ".ai"});
  }, {ref:{t:"brand", id:bid}, toast:{msg:clean + " added to Brands › Found", sub:"Opened in side panel so you can qualify it in one step.", icon:"flag"}});
  W.peek("brand", bid);
  return bid;
};
A.saveAllFacts = function(ref, msgAt){
  W.act("Saved all facts from " + W.refName(ref) + "'s reply", function(d){
    var th = d.threads[ref.id] || [], msg = th.filter(function(m){ return m.at === msgAt; })[0];
    if (!msg || !msg.ai || !msg.ai.facts) return;
    var c = ref.t === "creator" ? d.creators.filter(function(z){ return z.id === ref.id; })[0] : null;
    msg.ai.facts.forEach(function(f){
      f.saved = true;
      if (c){
        if (f.k === "rate") c.rate = f.v;
        if (f.k === "countries") c.countries = f.v;
        if (f.k === "age") c.age = f.v;
        if (f.k === "park"){ c.stage = "parked"; c.parkUntil = f.v; }
      }
    });
    if (c && c.rate && c.countries.length && c.stage === "replied"){
      c.stage = "kit"; c.kit = {at:msgAt, rate:c.rate, countries:c.countries, age:c.age, eng:c.eng, file:null, fromReply:true};
    }
  }, {ref:ref, toast:{msg:"All facts saved to " + W.refName(ref), sub:"Rate and audience split updated on the record.", icon:"check"}});
};
A.addCcFromReply = function(ref, ccEmail){
  var o = W.rec(ref); if (!o || !ccEmail) return;
  /* P4: Check Cross-Party CC Block (BRD-REPLY-24) before adding */
  var ccL = ccEmail.toLowerCase();
  var isCross = (ref.t === "brand" && D().creators.some(function(c){ return c.email && ccL === c.email.toLowerCase(); })) ||
                (ref.t === "creator" && D().brands.some(function(b){ return b.email && ccL === b.email.toLowerCase(); }));
  if (isCross){
    W.toast({msg:"Blocked by BRD-REPLY-24", sub:"Never CC a creator on a brand thread or vice versa.", icon:"shield", tone:"warn"});
    return;
  }
  W.act("Added " + ccEmail + " to CC on " + o.name, function(d){
    var qs = d.drafts.filter(function(q){ return q.to.t === ref.t && q.to.id === ref.id; });
    qs.forEach(function(q){ q.cc = ccEmail; });
    var rec = (ref.t === "creator" ? d.creators : d.brands).filter(function(z){ return z.id === ref.id; })[0];
    if (rec) rec.cc = ccEmail;
  }, {ref:ref, toast:{msg:"Added " + ccEmail + " to CC", sub:"Manager / colleague will be copied on the reply (INF-MGR-02, BRD-REPLY-08).", icon:"users"}});
};
A.generateMirroredContract = function(dealId){
  var x = W.deal(dealId); if (!x) return;
  var b = W.brand(x.brand), c = W.creator(x.creator), qid = W.uid("q");
  var draftDate = W.fmtDate(x.creatorDeadline || ((x.golive || W.at(14)) - 5 * W.DAY));
  var summary = "MIRRORED CREATOR AGREEMENT (" + c.name + " × Gratovo Agency for " + b.name + ")\n" +
    "1. Deliverable: " + x.deliverable + " in first third of video\n" +
    "2. Dual Timeline (BRD-DELIV-09): Firm Unlisted Draft Due " + draftDate + " (-5d buffer) · Public Go-Live Window " + W.fmtDate(x.golive || W.at(14)) + "\n" +
    "3. Creator Fee: " + W.money(x.payout) + " all-in (" + (x.dealModel === "exclusive_25" ? "75% net after 25% management split" : "net creator rate") + ")\n" +
    "4. Payment Terms: Released within 48h after Gratovo receives " + b.name + "'s Net 30 payment\n" +
    "5. Revisions: Max 2 rounds of factual brief-aligned edits; script approval locks creative direction\n" +
    "6. Usage & Exclusivity: Organic channel upload + 30-day category exclusivity (" + b.cat + ") only\n" +
    "7. Compliance: Mandatory FTC #ad disclosure (FND-ETH-13) & Zero Copyrighted Music in sponsor segment (HC-33)";
  W.copy(summary, "mirrored creator contract");
  W.act("Generated mirrored creator contract for " + c.name + " & drafted email", function(d){
    var y = d.deals.filter(function(z){ return z.id === dealId; })[0];
    if (y && y.step === 1){ y.checks[0] = true; y.checks[1] = true; y.checks[2] = true; }
    d.drafts.push({id:qid, kind:"reply", to:{t:"creator", id:c.id}, deal:dealId, mailbox:"m1", created:W.now(), subject:"Agreement for " + b.name + " integration (" + W.fmtShort(x.golive || W.at(14)) + ")",
      body:"Hi " + (firstName(c) || "there") + ",\n\n" + b.name + " has signed off on the campaign terms. Attached is our 7-point mirrored creator agreement for your " + x.deliverable.toLowerCase() + " at " + W.money(x.payout) + " (firm draft due " + draftDate + ", target go-live " + W.fmtDate(x.golive || W.at(14)) + ").\n\nPlease review and countersign so we can send the creative brief over right away. Does everything look good on your side?\n\nMoustafa, Gratovo",
      why:"Mirrored creator contract with all 7 mandatory clauses and 5-day earlier draft buffer (INF-CLOSE-03, INF-CLOSE-04, BRD-CONTRACT-08).", rules:["INF-CLOSE-03","INF-CLOSE-04","BRD-CONTRACT-08"], gates:[{k:"price", text:"This contract email states the creator payout: " + W.money(x.payout) + ". Confirm before sending."}]});
  }, {ref:{t:"deal", id:dealId}, toast:{msg:"Mirrored contract copied & opened in QuickDraft", sub:"All 7 mandatory clauses included (INF-CLOSE-03).", icon:"file", go:{label:"Preview Contract", run:function(){ W.ui(function(u){ u.modal = {kind:"contract", dealId:dealId}; }); }}}});
  if (W.U().route.s !== "today") W.openQuickDraft(qid);
};
A.flagContractClause = function(dealId, clauseText){
  var x = W.deal(dealId); if (!x) return;
  var b = W.brand(x.brand), c = W.creator(x.creator), qid = W.uid("q");
  W.act("Drafted contract redline email to " + b.name + " (" + clauseText + ")", function(d){
    d.drafts.push({id:qid, kind:"reply", to:{t:"brand", id:b.id}, deal:dealId, mailbox:"m1", created:W.now(), subject:"Re: " + b.name + " × " + c.name + " IO redlines",
      body:"Hi " + (b.contact ? b.contact.split(" ")[0] : "there") + ",\n\nThanks for sending the agreement over. In our single-pass review against our agreed quote (BRD-CONTRACT-10), we flagged: " + clauseText + ".\n\nOur quote covers organic YouTube channel upload with a 30-day subcategory exclusivity window (" + b.cat + "), max 2 factual revision rounds after script approval, and Net 30 payment from go-live. Could we update that clause so we can countersign today?\n\nMoustafa, Gratovo",
      why:"Single-batch redline for dangerous contract clauses before signing (BRD-CONTRACT-09, BRD-CONTRACT-10).", rules:["BRD-CONTRACT-09","BRD-CONTRACT-10"], gates:[]});
  }, {ref:{t:"deal", id:dealId}, toast:{msg:"Contract redline drafted to " + b.name, sub:"Opened right here in QuickDraft.", icon:"shield", go:{label:"Composer", run:function(){ W.openQuickDraft(qid); }}}});
  if (W.U().route.s !== "today") W.openQuickDraft(qid);
};
A.draftStageEmail = function(dealId, stageKey){
  var x = W.deal(dealId); if (!x) return;
  var b = W.brand(x.brand), c = W.creator(x.creator), qid = W.uid("q");
  var draftDeadline = W.fmtDate(x.creatorDeadline || ((x.golive || W.at(10)) - 5 * W.DAY));
  if (stageKey === "brief"){
    W.act("Drafted production brief email to " + c.name, function(d){
      var y = d.deals.filter(function(z){ return z.id === dealId; })[0]; if (y && y.step === 2) y.checks[0] = true;
      d.drafts.push({id:qid, kind:"reply", to:{t:"creator", id:c.id}, deal:dealId, mailbox:"m1", created:W.now(), subject:b.name + " brief + dates (" + W.fmtShort(x.golive || W.at(10)) + ")",
        body:"Hi " + (firstName(c) || "there") + ",\n\nHere are the key points for the " + b.name + " " + x.deliverable.toLowerCase() + ":\n1. Placement & hook: place the 60–90s segment in the first third of the video (INF-DELIV-17) showing how " + b.name + " (" + b.sells.toLowerCase() + ") fits your real workflow.\n2. Script gate (INF-DELIV-09): send over your 3–4 bullet talking-point outline before filming so we can lock brand sign-off and avoid re-shoots.\n3. Link, audio & disclosure: put " + ((x.shipping && x.shipping.utmLink) || "the tracking link") + " in the top 3 description lines + pinned comment, use zero copyrighted background music (HC-33), and include #ad (FND-ETH-13).\n4. Firm Draft Deadline: please send the unlisted video draft by " + draftDeadline + " (5 days ahead of the " + W.fmtDate(x.golive || W.at(10)) + " release window).\n\nCan you confirm those dates work on your end?\n\nMoustafa",
        why:"Creator brief with Script Gate (INF-DELIV-09), first-third placement (INF-DELIV-17), no-music rule (HC-33), and 5-day earlier draft buffer (BRD-DELIV-09).", rules:["BRD-DELIV-09","INF-DELIV-09","INF-DELIV-17","HC-33"], gates:[]});
    }, {ref:{t:"deal", id:dealId}, toast:{msg:"Creator brief drafted to " + c.name, sub:"Opened right here in QuickDraft.", icon:"file", go:{label:"Composer", run:function(){ W.openQuickDraft(qid); }}}});
    if (W.U().route.s !== "today") W.openQuickDraft(qid);
  } else if (stageKey === "draft"){
    W.act("Forwarded " + c.name + "'s draft to " + b.name + " for approval", function(d){
      var y = d.deals.filter(function(z){ return z.id === dealId; })[0]; if (y && y.step === 3){ y.checks[0] = true; y.checks[1] = true; y.checks[2] = true; }
      d.drafts.push({id:qid, kind:"reply", to:{t:"brand", id:b.id}, deal:dealId, mailbox:"m1", created:W.now(), subject:c.name + " draft ready for review (" + b.name + ")",
        body:"Hi " + (b.contact ? b.contact.split(" ")[0] : "there") + ",\n\n" + c.name + "'s integration draft is in and has passed our 5-point internal QC check (first-third placement, talking points, UTM link in top 3 lines, #ad disclosure, and clean audio).\n\nCould you review and confirm approval by tomorrow afternoon so we stay on track for the " + W.fmtDate(x.golive || W.at(5)) + " release?\n\nMoustafa",
        why:"Checked draft against 5-point QC gate first, then forwarded to brand with clear approval deadline (INF-DELIV-07, BRD-DELIV-05).", rules:["INF-DELIV-07","BRD-DELIV-05","BRD-DELIV-06"], gates:[]});
    }, {ref:{t:"deal", id:dealId}, toast:{msg:"Draft approval email ready for " + b.name, sub:"Opened right here in QuickDraft.", icon:"video", go:{label:"Composer", run:function(){ W.openQuickDraft(qid); }}}});
    if (W.U().route.s !== "today") W.openQuickDraft(qid);
  } else if (stageKey === "golive"){
    var liveUrl = x.live || ("youtu.be/" + c.handle.slice(1) + "-" + b.name.toLowerCase().replace(/\s+/g, ""));
    var base = W.now(), due = base + 30 * W.DAY;
    W.act("Marked " + W.dealName(x) + " live, emailed " + b.name + " & sent Net-30 invoice", function(d){
      var y = d.deals.filter(function(z){ return z.id === dealId; })[0];
      if (y){
        y.live = liveUrl; y.golive = y.golive || base;
        y.invoice.no = y.invoice.no || "GR-2026-0" + (30 + d.deals.indexOf(y));
        y.invoice.sent = base; y.invoice.due = due;
        y.step = 7; y.checks = [false, false];
        y.report = y.report || {views:Math.round((c.trimmedAvgViews || c.median) * 1.15), targetViews:c.trimmedAvgViews || c.median, clicks:1180, ctr:1.41, retentionPct:74, verdict:"overperformed", due:base + 30 * W.DAY};
        y.due = base + 30 * W.DAY;
      }
      d.drafts.push({id:qid, kind:"golive", to:{t:"brand", id:b.id}, deal:dealId, mailbox:"m1", created:W.now(), subject:c.name + " × " + b.name + " is live + Invoice " + (x.invoice.no || "GR-2026-035"),
        body:"Hi " + (b.contact ? b.contact.split(" ")[0] : "there") + ",\n\n" + c.name + "'s video featuring " + b.name + " is now live: https://" + liveUrl + " (first-third placement, UTM link in top 3 lines, and pinned comment verified).\n\nI have also attached Invoice " + (x.invoice.no || "GR-2026-035") + " PDF for " + W.money(x.price) + " all-in (Net 30, due " + W.fmtDate(due) + "). I'll share a Day-7 early traction snapshot once initial views settle. Confirming receipt?\n\nMoustafa, Gratovo",
        why:"Same-day go-live link + all-in PDF invoice starts the Net 30 clock immediately (BRD-DELIV-12, BRD-PAY-03, BRD-PAY-09).", rules:["BRD-DELIV-12","BRD-PAY-03","BRD-PAY-09"], gates:[]});
      markDone(d, "deal:" + dealId, "Go-live & invoice sent for " + W.dealName(x), "money", 4);
    }, {ref:{t:"deal", id:dealId}, toast:{msg:"Video marked live & Net-30 invoice sent!", sub:"Opened right here in QuickDraft.", icon:"wallet", go:{label:"Composer", run:function(){ W.openQuickDraft(qid); }}}});
    if (W.U().route.s !== "today") W.openQuickDraft(qid);
  }
};
A.slipGolive = function(dealId, addDays){
  var x = W.deal(dealId); if (!x) return;
  var b = W.brand(x.brand), c = W.creator(x.creator), qid = W.uid("q");
  var nextDate = (x.golive || W.now()) + addDays * W.DAY;
  W.act("Shifted go-live for " + W.dealName(x) + " to " + W.fmtDate(nextDate), function(d){
    var y = d.deals.filter(function(z){ return z.id === dealId; })[0];
    if (y){ y.golive = nextDate; y.creatorDeadline = nextDate - 5 * W.DAY; if (y.due) y.due += addDays * W.DAY; }
    d.drafts.push({id:qid, kind:"reply", to:{t:"brand", id:b.id}, deal:dealId, mailbox:"m1", created:W.now(), subject:"Quick schedule update: " + c.name + " × " + b.name,
      body:"Hi " + (b.contact ? b.contact.split(" ")[0] : "there") + ",\n\nQuick heads-up on " + c.name + "'s upload schedule: final edit polish moved the publish date by " + addDays + " days to " + W.fmtDate(nextDate) + " so the integration segment gets full retention.\n\nWe will send the live link over as soon as it goes up on " + W.fmtShort(nextDate) + ". Does that timing still work cleanly on your side?\n\nMoustafa",
      why:"Proactive date-slip notice: short apology and new date without blame (BRD-DELIV-02).", rules:["BRD-DELIV-02"], gates:[]});
  }, {ref:{t:"deal", id:dealId}, toast:{msg:"Go-live moved to " + W.fmtDate(nextDate), sub:"Proactive update to " + b.name + " opened in QuickDraft.", icon:"calendar", go:{label:"Composer", run:function(){ W.openQuickDraft(qid); }}}});
  if (W.U().route.s !== "today") W.openQuickDraft(qid);
};

/* System 10: Call Co-Pilot & Post-Call Recap Generator (FND-CALL-01..13, BRD-PRES-26) */
A.saveCallRecap = function(ref, callData){
  var o = W.rec(ref); if (!o) return;
  var qid = W.uid("q");
  var isB = ref.t === "brand";
  W.act("Logged call notes & generated same-day written recap for " + o.name, function(d){
    d.calls = d.calls || {};
    d.calls[ref.id] = Object.assign({at:W.now()}, callData);
    var body = isB
      ? "Hi " + (firstName(o) || "there") + ",\n\nGreat speaking today. Quick written recap of what we aligned on (FND-CALL-11):\n• Campaign Goal: " + (callData.goal || "Direct developer conversions + trial signups") + " (target KPI: " + (callData.kpi || "$40 CPM / 1.3%+ CTR") + ")\n• Selected Creators & Format: " + (callData.creatorsText || "60–90s first-third YouTube integration") + "\n• Target Window & Next Step: " + (callData.timeline || "Mid-November upload · Call 2 / IO review on Thursday") + "\n\nI've attached the Brand Talent Packet with verified 90-day YouTube Studio demographics. Shall I send the insertion order over to lock the dates?\n\nMoustafa, Gratovo"
      : "Hi " + (firstName(o) || "there") + ",\n\nGreat chatting today! Quick written summary so we both have it in one place (FND-CALL-11):\n• Standard Integration Rate: " + W.money(callData.rate || o.rate || 1800) + " for a 60–90s first-third integration (" + (callData.model === "exclusive_25" ? "Exclusive 25% management" : "Non-exclusive brokered representation") + ")\n• Dream Brands & Hard-Nos: Pitching " + (callData.dream || "AI coding & productivity tools") + "; skipping " + (callData.hardNos || "crypto, gambling, and unverified VPNs") + "\n• Next Check-In: We are pitching your channel this week and will send a progress update within 10 days (HC-29).\n\nExcited to build together!\n\nMoustafa, Gratovo";
    d.drafts.push({id:qid, kind:"reply", to:ref, mailbox:"m1", created:W.now(), subject:"Recap + next steps: " + o.name + " × Gratovo", body:body,
      why:"Same-day written post-call recap (FND-CALL-11, FND-CALL-12, BRD-PRES-26): locks agreed scope, KPIs, and next step in writing.", rules:["FND-CALL-11","FND-CALL-12","BRD-PRES-26"], gates:[]});
  }, {ref:ref, toast:{msg:"Call logged & Same-Day Written Recap drafted", sub:"Opened in QuickDraft.", icon:"phone", go:{label:"Composer", run:function(){ W.openQuickDraft(qid); }}}});
  W.ui(function(u){ u.modal = null; });
  W.openQuickDraft(qid);
};

/* System 15: Export Accounting Ledger CSV */
A.exportLedgerCsv = function(){
  var d = D();
  var rows = [["Deal ID","Brand","Creator","Model","Step","Brand Gross ($)","Creator Payout ($)","Agency Margin ($)","Margin %","Invoice #","Sent Date","Due Date (Net 30)","Brand Paid","Creator Paid","Payment Rail & Tax"]];
  d.deals.forEach(function(x){
    var b = W.brand(x.brand) || {}, c = W.creator(x.creator) || {}, inv = x.invoice || {};
    var margin = x.price - x.payout, pct = Math.round(100 * margin / Math.max(1, x.price));
    rows.push([
      x.id, b.name || "", c.name || "", x.dealModel || "brokered", W.DEAL_FLOW[x.step].name,
      x.price, x.payout, margin, pct + "%",
      inv.no || "Unsent", inv.sent ? W.fmtShort(inv.sent) : "", inv.due ? W.fmtShort(inv.due) : "",
      inv.paid ? W.fmtShort(inv.paid) : (inv.partialPaid ? "50% (" + inv.partialPaid + ")" : "Open"),
      x.paidCreator ? W.fmtShort(x.paidCreator) : "Locked",
      (c.pay || "") + " (" + ((c.onboarding && c.onboarding.taxForm) || "W-9") + ")"
    ]);
  });
  var csv = rows.map(function(r){ return r.map(function(cell){ return '"' + String(cell).replace(/"/g, '""') + '"'; }).join(","); }).join("\n");
  try {
    var blob = new Blob([csv], {type:"text/csv;charset=utf-8;"});
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = "gratovo-financial-ledger-2026.csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1500);
    W.toast({msg:"Exported Financial Ledger (.csv)", sub:d.deals.length + " deals with Net-30 aging, agency margins, and tax status.", icon:"download", tone:"good"});
  } catch (e) {
    W.copy(csv, "financial ledger CSV");
  }
};

A.fitDayBudget = function(){
  var items = W.items("me"), d = W.D(), budget = d.day.budget || 240;
  var va = d.team.filter(function(m){ return /^VA/.test(m.role) && m.status === "online"; })[0] || d.team.filter(function(m){ return /^VA/.test(m.role); })[0];
  var handed = 0, snoozed = 0, acc = 0;
  W.act("Triaged Today to fit your " + W.dur(budget) + " budget", function(dd){
    items.forEach(function(it){
      if ((it.b === "contacts" || (it.b === "followups" && it.kind === "followup")) && va && it.ref && it.ref.t === "creator"){
        var c = dd.creators.filter(function(z){ return z.id === it.ref.id; })[0];
        if (c){ c.owner = va.id; dd.handed[it.key] = {to:va.id, note:"Auto-delegated VA queue", at:W.now()}; handed++; return; }
      }
      acc += it.est;
      if (acc > budget && it.b !== "money" && it.b !== "replies"){
        dd.snoozed[it.key] = W.at(1, W.morning ? W.morning() : 9);
        dd.snoozeMeta = dd.snoozeMeta || {}; dd.snoozeMeta[it.key] = {title:it.title};
        snoozed++;
      }
    });
  }, {toast:{msg:"Day fitted to " + W.dur(budget), sub:(handed ? handed + " items delegated to " + va.name + ". " : "") + (snoozed ? snoozed + " lower-priority items moved to tomorrow 09:00." : "Money and warm replies kept at the top."), icon:"bolt", tone:"good"}});
};
A.sendAllReadyFollowups = function(){
  var d = W.D(), ready = d.drafts.filter(function(q){
    if (q.kind !== "followup") return false;
    if (q.gates && q.gates.some(function(g){ return !g.ok; })) return false;
    var mb = W.mailbox(q.mailbox);
    return mb && !W.mailboxBlocked(mb);
  });
  if (!ready.length){ W.toast({msg:"No un-gated follow-ups on healthy mailboxes", icon:"info", tone:"info"}); return; }
  W.act("Batch-sent " + W.plural(ready.length, "ready follow-up"), function(dd){
    ready.forEach(function(q){
      dd.drafts = dd.drafts.filter(function(x){ return x.id !== q.id; });
      var mb = dd.mail.filter(function(x){ return x.id === q.mailbox; })[0]; if (mb) mb.sent++;
      var th = dd.threads[q.to.id] = dd.threads[q.to.id] || [];
      th.push({dir:"out", at:W.now(), text:q.body, by:dd.me, mailbox:mb ? mb.addr : "outreach1@gratovo.co"});
      if (q.to.t === "creator"){
        var oo = dd.creators.filter(function(x){ return x.id === q.to.id; })[0];
        if (oo && oo.seq) oo.seq.steps.forEach(function(s){ if (s.k === "fu" + q.n){ s.st = "sent"; s.at = W.now(); } });
      }
      markDone(dd, itemKeyForDraft(q), "Follow-up " + q.n + " to " + W.toName(q), "followups", 1);
    });
  }, {toast:{msg:"Sent " + W.plural(ready.length, "due follow-up"), sub:"All passed playbook & mailbox checks.", icon:"send", tone:"good"}});
};
A.rebalanceByRole = function(mode){
  var d = W.D(), va = d.team.filter(function(m){ return /^VA/.test(m.role); })[0], am = d.team.filter(function(m){ return /Account/.test(m.role); })[0];
  if (mode === "va" && va){
    var moved = 0;
    W.act("Delegated all contacts & routine follow-ups to " + va.name + " (VA)", function(dd){
      dd.creators.forEach(function(c){
        if (c.stage === "shortlisted" || (c.stage === "emailed" && W.draftsFor({t:"creator", id:c.id}).some(function(q){ return q.kind === "followup" && !q.gates.length; }))){
          c.owner = va.id; moved++;
        }
      });
    }, {toast:{msg:"Routed " + W.plural(moved, "top-of-funnel item") + " to " + va.name, sub:"Contacts and un-gated follow-ups are now on " + va.name + "'s Today.", icon:"users", tone:"good"}});
  } else if (mode === "am" && am){
    var movedAm = 0;
    W.act("Delegated warm creator replies & kit checks to " + am.name + " (AM)", function(dd){
      dd.creators.forEach(function(c){
        if (c.stage === "replied" || c.stage === "kit"){ c.owner = am.id; movedAm++; }
      });
    }, {toast:{msg:"Routed " + W.plural(movedAm, "warm creator thread") + " to " + am.name, sub:"Replies and media-kit checks moved to " + am.name + "'s Today.", icon:"users", tone:"good"}});
  }
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
        dd.creators.push({id:id, name:p[0], handle:p[1], subs:p[4], median:p[3], trimmedAvgViews:Math.round(p[3]*0.96/500)*500, viewStability:"stable", botRisk:{level:"clean", note:"Organic comment ratio verified"}, format:"Talking-head + screen", starRating:p[3]>=50000?5:4, relationshipModel:"brokered", daysSinceUpdate:0, exclusivityLocks:[], nextOpenSlot:W.at(10), up30:3 + (W.hash(p[1]) % 5), lastUp:1 + W.hash(p[0]) % 6, videos:[{t:p[2], v:Math.round(p[3] * 1.15), ago:2, dur:"12:" + (10 + W.hash(p[2]) % 49)},{t:"What I learned this month", v:p[3], ago:9, dur:"10:41"},{t:"Q&A: tools I use", v:Math.round(p[3] * .9), ago:16, dur:"14:05"}],
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
A.startRun = function(runId, opts){
  var d = W.D(), r = runIn(d, runId);
  if (!r) return;
  var cur = r.cur, stopAt = (opts && opts.all) ? r.kws.length : Math.min(r.kws.length, cur + 4), line = [W.now(), (cur ? "Resumed at keyword " + (cur + 1) : "Run started") + " on this computer"];
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

A.setCreatorStars = function(cid, stars){
  var c = W.creator(cid); if (!c) return;
  W.act("Rated " + c.name + " " + stars + " stars", function(d){
    var x = d.creators.filter(function(z){ return z.id === cid; })[0]; if (x) x.starRating = stars;
  }, {ref:{t:"creator", id:cid}, toast:{msg:c.name + " rated " + stars + "★", icon:"star", tone:"info", ms:2200}});
};
A.setCreatorModel = function(cid, model){
  var c = W.creator(cid); if (!c) return;
  W.act("Set " + c.name + " relationship model to " + (model === "exclusive_25" ? "Exclusive 25% Commission" : "Brokered Markup"), function(d){
    var x = d.creators.filter(function(z){ return z.id === cid; })[0]; if (x) x.relationshipModel = model;
  }, {ref:{t:"creator", id:cid}, toast:{msg:c.name + " model: " + (model === "exclusive_25" ? "Exclusive 25%" : "Brokered"), icon:"shield", tone:"info"}});
};
A.toggleVaOnboarding = function(stepId){
  W.act("Updated VA onboarding step", function(d){
    (d.vaOnboarding || []).forEach(function(st){ if ((st.k || st.id) === stepId) st.done = !st.done; });
  }, {toast:{msg:"VA onboarding step updated", icon:"check", tone:"info", ms:2200}});
};
A.setVaApproval = function(on){
  W.act((on ? "Enabled" : "Disabled") + " VA shadow-approval gate", function(d){
    d.settings = d.settings || {}; d.settings.vaApproval = !!on;
  }, {toast:{msg:on ? "VA shadow-approval gate ON" : "VA direct send enabled", sub:on ? "First 50 VA outreach drafts require Owner sign-off." : "VAs can send approved outreach directly.", icon:"shield", tone:"info"}});
};
A.updateFunnelTarget = function(patch){
  W.act("Updated Reverse Funnel targets", function(d){
    d.funnelTarget = Object.assign({}, d.funnelTarget || {monthlyRevenueGoal:20000, avgDealSize:3200, agencyMarginPct:38}, patch);
  }, {log:false});
};
})();
