/* data.js — V6 Final-State Seed Data for Monday 19 October 2026, 10:24.
   Enriched with all 16 Permanent IMA Business Systems:
   - System 1: 12-video outlier-trimmed average (trimmedAvgViews), view stability (viewStability), bot-detection (botRisk), presenter format (format), 1–5 Star Rubric (starRating)
   - System 2: Brokered Markup vs. Exclusive Management (25% Comm) Roster Tiers (relationshipModel)
   - System 3: Signed-Creator Warmth Pulse & 14-Day Retention Guard (daysSinceUpdate, onboarding profile)
   - System 4: Talent Manager & Multi-Creator Agency Hub (d.managers, managerId)
   - System 5: Category Exclusivity Lock Calendar (exclusivityLocks) & Next Open Upload Slot (nextOpenSlot)
   - System 6: Brand Audit, Paid-Integration Spender Verification (paidSpenderVerified), Company-Size Title Router (headcount, recommendedTitle), Boycott Screen, Phishing Guard
   - System 7–16: Multi-Model Deals, Dual Deadlines, 7-Must-Have Contract Clauses, 6-Clause Redline Scanner, Physical Shipping Guard, 5-Point Video QC Gate, Post-Go-Live Hype Cadence & Make-Good Engine, Official Invoices, Reverse Funnel & 50-Send Batch Diagnostics.
   - Playbook Contradictions P1–P7 fixed across all seed threads and drafts. */
(function(){
"use strict";
var W = window.W, at = W.at, DAY = W.DAY;

/* The 10-step unified deal lifecycle (F4). Step indices 0..9 preserved across Close and Deliver. */
W.DEAL_FLOW = [
  {k:"negotiate", name:"Negotiate", items:["Price the brand pays agreed","Creator's payout agreed","Payment terms set (Net 30)","Exclusivity and usage rights written down"]},
  {k:"contracts", name:"Contracts", items:["Brand's IO received & redlined (BRD-CONTRACT-09)","Brand signed IO first (BRD-CONTRACT-08)","Mirrored creator contract generated (INF-CLOSE-04)","Creator countersigned mirrored agreement"], ordered:true, note:"Runs in strict order: Brand signs IO first (or locks terms), then Creator signs mirrored agreement with 5-day earlier draft buffer."},
  {k:"brief", name:"Brief & Ship", items:["Brief translated into creator voice (INF-DELIV-01)","Product shipped / tracking or demo account confirmed (INF-DELIV-08)","Creator confirmed firm draft deadline (-5d buffer)"]},
  {k:"draft", name:"Draft & QC", items:["Script / outline approved before filming (INF-DELIV-09)","Unlisted video draft received from creator","5-Point Agency QC passed (no music HC-33, #ad FND-ETH-13)","Brand approved the draft (within 2-round limit)"]},
  {k:"prelive", name:"Pre-live checks", items:["UTM tracking link opens landing page cleanly","Integration placed in first third of video (INF-DELIV-17)","Promo code & top-3-line description link verified"]},
  {k:"golive", name:"Go-live", items:["Video is live, public link saved","Same-day go-live email + PDF invoice sent to brand"]},
  {k:"invoice", name:"Invoice", items:["Invoice sent on go-live day (Net 30 clock running)"]},
  {k:"report", name:"30-day report", items:["YouTube Studio 30d retention & link clicks pulled (INF-AFTER-02)","30-day ROI report (or proactive Make-Good) sent to brand"]},
  {k:"pay", name:"Pay creator", items:["Creator payout released via Wise/PayPal/ACH"], lockedUntilPaid:true},
  {k:"next", name:"Next deal", items:["Retainer / Droplet next-creator pitch sent to brand (BRD-AFTER-16)"]}
];
W.CREATOR_STEPS = [
  {k:"new", name:"Found"},{k:"shortlisted", name:"Qualified"},{k:"contact", name:"Contact"},{k:"emailed", name:"Emailed"},
  {k:"replied", name:"Replied"},{k:"kit", name:"Media kit"},{k:"audience", name:"Audience"},{k:"signed", name:"Signed"}
];
W.STAGE_INDEX = {new:0, shortlisted:1, contact:2, emailed:3, replied:4, kit:5, audience:6, signed:7, rejected:0, parked:4, never:0};
W.STAGE_LABEL = {new:"New find", shortlisted:"Needs contact", contact:"Contact confirmed", emailed:"In sequence", replied:"Replied", kit:"Media kit in", audience:"Audience checked", signed:"Signed", rejected:"Rejected", parked:"Parked", never:"Never contact"};
W.BRAND_STEPS = [{k:"found", name:"Found"},{k:"qualified", name:"Qualified"},{k:"pitched", name:"Pitched"},{k:"negotiating", name:"Negotiating"},{k:"won", name:"Won"}];
W.REJECT_REASONS = ["Not relevant to AI tools","Too few views","Not posting enough","Audience outside US/UK/CA/AU","Bot / fake engagement detected (INF-QUAL-08)"];
W.COUNTRY = {US:"United States", GB:"United Kingdom", CA:"Canada", AU:"Australia", IN:"India", PK:"Pakistan", DE:"Germany", BR:"Brazil", PH:"Philippines", NG:"Nigeria", FR:"France", ES:"Spain"};

/* 47-Situation Reply Catalog from user:gratovo-comms/references/situations.md (F6) */
W.SITUATIONS = {
  creator: [
    {id:"inf.interested_asks_pay", label:"C-01 · Interested · asks what it pays", rules:["INF-REPLY-07","INF-PRICE-02"], gates:[], summary:"Open to sponsors, asked what integrations pay.", next:"Give a realistic range, reassure on fit, and ask for YouTube Studio audience numbers."},
    {id:"inf.rate_and_audience", label:"C-02 · Interested · sent rate & audience", rules:["INF-REPLY-03","INF-REPLY-17","INF-REPLY-18"], gates:[], summary:"Shared starting rate and top countries in their reply.", next:"Save the facts, request a YouTube Studio Audience tab screenshot to verify for brand matching, then sign."},
    {id:"inf.interested_what_next", label:"C-03 · Interested · asks what we need", rules:["INF-REPLY-02","INF-REPLY-17","INF-REPLY-18"], gates:[], summary:"Warm reply asking what details we need to get started.", next:"Ask for their 90-day YouTube Studio Audience screenshot (top countries + age) and 60–90s integration rate."},
    {id:"inf.who_are_you", label:"C-04 · Skeptical · 'Who are you / track record?'", rules:["INF-REPLY-10","FND-ETH-01","HC-07"], gates:[{k:"claim", text:"Verify agency track-record claim or use HC-07 Emergency Social Proof before sending."}], summary:"Creator wants to verify who Gratovo is and what brands or results we have before sharing analytics.", next:"Use verified agency proof (FND-ETH-01) or HC-07 Emergency Social Proof (audience alignment + zero-cost non-exclusive representation)."},
    {id:"inf.wants_call", label:"C-05 · Warm · asks for a quick intro call", rules:["FND-CALL-02","FND-CALL-13","INF-ONB-01"], gates:[], summary:"Creator wants a 10–15 minute intro call before signing.", next:"Offer 2 concrete time slots in their timezone (FND-CALL-02) and include a 3-bullet written agenda (FND-CALL-13)."},
    {id:"inf.rate_too_high", label:"C-06 · Sent media kit · rate above market", rules:["INF-NEG-01","INF-NEG-31","HC-13"], gates:[{k:"price", text:"Proposes a lower benchmark creator rate. Confirm before sending."}], summary:"Creator's quoted rate is >20% above the 12-video outlier-trimmed CPM benchmark.", next:"Politely test rate flexibility using our volume & zero-admin promise (HC-13) or propose a CPM + performance bonus structure (INF-NEG-35)."},
    {id:"inf.manager_cc", label:"C-07 · Talent manager replied · represents roster", rules:["INF-MGR-02","INF-MGR-03","EX-29"], gates:[], summary:"Talent manager replied on behalf of the creator.", next:"Treat the manager as a multi-deal partner (INF-MGR-02), confirm the creator's slot, and ask for their full talent roster (INF-MGR-03)."},
    {id:"inf.not_now", label:"C-08 · Booked / Not right now", rules:["INF-REPLY-21","INF-NOTNOW-01"], gates:[], summary:"Creator is fully booked this month and asked to reconnect later.", next:"Send a warm 1-sentence thank-you and park with an automatic wake-up date."},
    {id:"inf.no_exclusivity", label:"C-09 · Pushback · wants to work with other agencies", rules:["INF-ONB-04","HC-04"], gates:[], summary:"Creator only wants non-exclusive representation.", next:"Reassure immediately: Gratovo's standard brokered roster is 100% non-exclusive; you only approve deals you love."},
    {id:"inf.what_brands", label:"C-10 · Asks which specific brand before sharing kit", rules:["INF-REPLY-08","INF-FIRST-21"], gates:[], summary:"Creator wants to know the exact brand name before sending analytics.", next:"Explain truthfully that we match verified audience demographics against our active AI SaaS briefs so we only bring relevant sponsors."},
    {id:"inf.how_commission", label:"C-11 · Asks how our commission / fee works", rules:["INF-ONB-03","HC-04"], gates:[], summary:"Creator asked whether we take a cut of their rate.", next:"Clarify that on brokered deals we quote your net rate + agency markup to the brand, or 25% commission on exclusive management."},
    {id:"inf.bad_past_agency", label:"C-12 · Burned by a past agency (ghosted / late pay)", rules:["INF-OBJ-02","HC-29"], gates:[], summary:"Creator had a bad experience with an agency that overpromised or paid late.", next:"Acknowledge candidly; commit to 14-day warmth updates (HC-29), zero lock-in, and transparent Net-30 payment tracking."},
    {id:"inf.only_dedicated", label:"C-13 · Only does dedicated videos (no 60s spots)", rules:["INF-REPLY-14","INF-PRICE-04"], gates:[], summary:"Creator prefers full dedicated reviews over 60–90s integrations.", next:"Note dedicated format preference (2.2x multiplier) and request their dedicated rate + YouTube Studio audience tab."},
    {id:"inf.only_shorts", label:"C-14 · Wants Shorts / Reels sponsorship", rules:["INF-REPLY-15"], gates:[], summary:"Creator asked if brands sponsor YouTube Shorts.", next:"Confirm we package Shorts as multi-channel bundle add-ons (0.4x rate) alongside long-form integrations."},
    {id:"inf.no_sponsors_yet", label:"C-15 · Never done a brand sponsorship before", rules:["INF-REPLY-19","INF-ONB-05"], gates:[], summary:"First-time sponsored creator unsure about pricing and process.", next:"Guide them warmly: ask for their YouTube Studio audience tab and suggest a fair market starting rate based on trimmed views."},
    {id:"inf.wants_upfront_pay", label:"C-16 · Asks for 50% or 100% upfront payment", rules:["INF-PAY-02","HC-02"], gates:[], summary:"Creator requested payment before publishing.", next:"Explain standard industry Net-30 from go-live (HC-02) or offer a 50% deposit upon signed IO if the brand pays deposit."},
    {id:"inf.script_pushback", label:"C-17 · Pushback on brand talking points", rules:["INF-DELIV-04","INF-DELIV-13"], gates:[], summary:"Creator feels the brand's talking points sound too scripted.", next:"Translate into natural creator-voice bullet points and reassure them that authentic phrasing converts best."},
    {id:"inf.running_late", label:"C-18 · Creator filming / edit running behind schedule", rules:["INF-DELIV-10","BRD-DELIV-02"], gates:[], summary:"Creator needs 2–3 extra days on the draft deadline.", next:"Use the 5-day internal buffer first; if go-live slips, proactively notify the brand with the new upload date."},
    {id:"inf.revision_pushback", label:"C-19 · Creator resists brand revision request", rules:["INF-DELIV-09","BRD-CONTRACT-05"], gates:[], summary:"Creator pushed back on a draft edit requested by the brand.", next:"Check if the edit is factual/brief-aligned (covered under 2-round cap) vs scope creep (which we push back on for the creator)."},
    {id:"inf.wants_product_key", label:"C-20 · Needs pro account / API key / hardware", rules:["INF-DELIV-02","INF-DELIV-08"], gates:[], summary:"Creator needs product access or physical unit before filming.", next:"Request sandbox key / tracking number from brand immediately; filming clock starts upon delivery (INF-DELIV-08)."},
    {id:"inf.asking_payment_status", label:"C-21 · Asks when payout will arrive", rules:["INF-PAY-04","HC-02"], gates:[], summary:"Creator checked in on payout timing after going live.", next:"Share exact Net-30 invoice due date and confirm we release payout within 48 hours of brand funds clearing."},
    {id:"inf.exclusivity_question", label:"C-22 · Asks about category exclusivity window", rules:["INF-CLOSE-03","BRD-PRES-22"], gates:[], summary:"Creator wants to make sure they can still take other AI sponsors.", next:"Confirm exclusivity is strictly limited to 30 days in the exact product subcategory only."},
    {id:"inf.whitelisting_question", label:"C-23 · Asks about paid ads / whitelisting usage", rules:["HC-30","BRD-CONTRACT-04"], gates:[], summary:"Creator asked if the brand will run their video as a paid ad.", next:"Confirm agreement is organic YouTube upload only unless the brand pays a +25% / 30-day whitelisting fee."},
    {id:"inf.audience_screenshot_sent", label:"C-24 · Sent YouTube Studio Audience screenshot", rules:["INF-KIT-01","INF-ONB-01"], gates:[], summary:"Creator attached their 90-day YouTube Studio demographics.", next:"Verify US/UK/CA/AU share ≥35% and buying age 18–44, then sign to roster and send welcome note."},
    {id:"inf.low_us_audience", label:"C-25 · Audience screenshot below US/UK/CA/AU threshold", rules:["INF-DECLINE-01"], gates:[], summary:"Creator's top geographies are outside US/UK/CA/AU.", next:"Decline kindly with one honest line on current brand geo requirements and keep the door open."},
    {id:"inf.inbound_referral", label:"C-26 · Inbound creator referred by another signed channel", rules:["INF-FIRST-02","INF-ONB-01"], gates:[], summary:"Creator reached out via a referral from a roster peer.", next:"Fast-track audience verification and thank the referring creator."},
    {id:"inf.rate_increase_request", label:"C-27 · Signed creator wants to raise their rate", rules:["INF-PRICE-07","INF-NEG-01"], gates:[], summary:"Creator's views grew and they want to update their rate card.", next:"Recalculate 12-video outlier-trimmed average views and update their roster rate accordingly."},
    {id:"inf.link_pin_missing", label:"C-28 · Live video missing top-3-line link or pinned comment", rules:["INF-DELIV-07","HC-33"], gates:[], summary:"Post-publish check found the UTM link below the fold.", next:"Send a warm, urgent note asking them to move the UTM link into the top 3 description lines and pin the comment."},
    {id:"inf.rebook_yes", label:"C-29 · Excited to run a follow-up deal with same brand", rules:["BRD-UPSELL-01","INF-ONB-02"], gates:[], summary:"Creator loved the product and wants a multi-video renewal.", next:"Pitch a 3-video momentum bundle renewal to the brand using Day-30 CTR proof."},
    {id:"inf.hard_no", label:"C-30 · Uninterested / asks to be removed", rules:["FND-ETH-04","HC-01"], gates:[], summary:"Creator asked not to receive outreach emails.", next:"Stop sequence immediately and move to Never Contact list."}
  ],
  brand: [
    {id:"brd.counter_offer", label:"B-01 · Counter-offer · budget below our ask", rules:["BRD-NEG-04","BRD-PRICE-09","BRD-NEG-11"], gates:[{k:"price", text:"Quotes a counter-offer price to the brand. Confirm before sending."}], summary:"Brand wants the creator but countered below our opening ask.", next:"Hold near the ask with 12-video view proof, or meet in the middle by trimming usage rights/scope or offering a 3-video bundle."},
    {id:"brd.wants_roster", label:"B-02 · Interested · 'Send your talent roster / kits'", rules:["BRD-PRES-04","BRD-PRES-18","BRD-REPLY-30"], gates:[], summary:"Brand asked to see our full creator roster or media kits.", next:"Verify they replied from a corporate domain (BRD-REPLY-30), then send 2–3 curated matches with the 4-line stat block (BRD-PRES-04) and generate the Brand Talent Packet."},
    {id:"brd.about_agency", label:"B-03 · Skeptical · 'Tell us about your agency / case studies'", rules:["BRD-OBJ-03","FND-ETH-01","HC-07"], gates:[{k:"claim", text:"Verify agency case-study numbers or switch to HC-07 Creator-Proof framing before sending."}], summary:"Brand asked about Gratovo's past campaigns and case studies.", next:"Lead with the specific pitched creators' verified sponsor performance (HC-07) and concrete CTR/view metrics."},
    {id:"brd.wants_call", label:"B-04 · Warm · 'Let's hop on a discovery call'", rules:["FND-CALL-02","FND-CALL-07","FND-CALL-13","BRD-PRES-26"], gates:[], summary:"Brand buyer wants a 15-minute call this week.", next:"Propose 2 timezone-matched slots (FND-CALL-02), attach a 3-point agenda (FND-CALL-13), and open the Call Co-Pilot Sheet."},
    {id:"brd.direct_bypass", label:"B-05 · Objection · 'Why not go direct to the creator?'", rules:["BRD-OBJ-14","BRD-OBJ-21"], gates:[], summary:"Brand asked why they shouldn't contact the creator directly instead of going through Gratovo.", next:"Frame agency value: we handle brief translation, firm -5d draft buffers, 5-point QC, and contract/invoice admin at zero extra overhead—and the creator routes sponsorship ops through us."},
    {id:"brd.wants_cpm", label:"B-06 · Objection · 'We only do CPM or performance deals'", rules:["BRD-NEG-23","BRD-NEG-25","INF-NEG-35"], gates:[{k:"price", text:"Quotes a Base + View Bonus / CPM structure. Confirm before sending."}], summary:"Brand wants a CPM or view-guarantee structure instead of a flat fee.", next:"Propose a 50% Base Fee + CPM Performance Bonus with a 70% View Guarantee threshold (BRD-NEG-25)."},
    {id:"brd.next_quarter", label:"B-07 · Timing · 'Budget locked until next quarter'", rules:["BRD-REPLY-14","BRD-FU-10"], gates:[], summary:"Brand is interested but Q4 budget is fully allocated until Q1.", next:"Ask when Q1 planning locks (early Dec vs. Jan) and park the brand with a scheduled pre-quarter check-in."},
    {id:"brd.affiliate_only", label:"B-08 · Objection · 'We only do affiliate / rev-share'", rules:["BRD-QUAL-19","BRD-NEG-24"], gates:[], summary:"Brand only offers commission links with zero base fee.", next:"Politely decline pure affiliate; offer a reduced test-integration base fee paired with a conversion bonus."},
    {id:"brd.wrong_person", label:"B-09 · Referral · 'Talk to our Head of Partnerships'", rules:["BRD-REPLY-08","HC-25"], gates:[], summary:"Contact pointed us to another stakeholder on the marketing team.", next:"Thank them, update the primary buyer contact, and reference the internal referral in the opener."},
    {id:"brd.wants_exclusivity", label:"B-10 · Contract · Demands 90-day broad exclusivity", rules:["BRD-CONTRACT-09","BRD-PRES-22"], gates:[], summary:"Brand redlined contract to block all tech sponsors for 90 days.", next:"Redline to 30 days in their exact product subcategory only, or quote a paid exclusivity buyout."},
    {id:"brd.wants_perpetual_ads", label:"B-11 · Contract · Demands perpetual paid ad rights", rules:["BRD-CONTRACT-10","HC-30"], gates:[], summary:"Brand wants unlimited paid whitelisting rights included for free.", next:"Clarify that base fee covers organic YouTube upload; quote +25% per 30 days for paid ad whitelisting."},
    {id:"brd.wants_net60", label:"B-12 · Contract · Requests Net 60 / Net 90 payment terms", rules:["BRD-PAY-03","BRD-CONTRACT-09"], gates:[], summary:"Brand procurement requested Net 60 or Net 90 payment terms.", next:"Hold Net 30 from go-live date or propose 50% upon signature / 50% Net 30."},
    {id:"brd.brief_sent", label:"B-13 · Delivery · Sent campaign brief & tracking links", rules:["BRD-DELIV-03","INF-DELIV-13"], gates:[], summary:"Brand shared product talking points and UTM link.", next:"Sanitize brief into creator-voice bullet points and relay to creator with -5d draft deadline."},
    {id:"brd.draft_revision", label:"B-14 · Delivery · Requested edits on unlisted draft", rules:["BRD-DELIV-06","INF-DELIV-09"], gates:[], summary:"Brand reviewed the unlisted video draft and requested a timestamp tweak.", next:"Verify edit is within the 2-round factual revision cap and relay calmly to creator."},
    {id:"brd.draft_approved", label:"B-15 · Delivery · Approved unlisted draft for publish", rules:["BRD-DELIV-11"], gates:[], summary:"Brand signed off on the unlisted draft.", next:"Greenlight creator for scheduled publish date and prepare same-day Net-30 invoice."},
    {id:"brd.invoice_question", label:"B-16 · Billing · Asks for W-8BEN / W-9 or PO number", rules:["BRD-PAY-09","BRD-PAY-01"], gates:[], summary:"Brand AP team requested vendor tax form or PO match.", next:"Send all-in PDF invoice with Gratovo vendor details and confirm Net-30 due date."},
    {id:"brd.wants_renewal", label:"B-17 · Upsell · Happy with results, wants next wave", rules:["BRD-UPSELL-01","HC-26"], gates:[{k:"price", text:"Quotes renewal bundle pricing. Confirm before sending."}], summary:"Brand saw strong click-through from the integration and asked about Q1 slots.", next:"Pitch a 3-video momentum bundle or multi-creator takeover with an 8% renewal discount."}
  ]
};

/* 7 Must-Have Creator & Brand Contract Clauses (INF-CLOSE-03, BRD-CONTRACT-02) */
W.CONTRACT_CLAUSES = [
  {k:"deliverable", label:"Exact Deliverable & Format (60–90s first-third integration + top-3-line link)"},
  {k:"dates", label:"Dual Timeline: Creator Draft Due (-5d buffer) & Brand Go-Live Window"},
  {k:"revisions", label:"Revision Cap: Max 2 rounds of factual brief-aligned edits (no full re-shoots)"},
  {k:"usage", label:"Usage Rights: Organic channel upload only (Paid Whitelisting requires +25% / 30d fee)"},
  {k:"exclusivity", label:"Category Exclusivity: Narrow 30-day window in exact product subcategory only"},
  {k:"payment", label:"Payment Terms: Brand Net 30 from Go-Live; Creator paid within 48h of brand funds clearing"},
  {k:"compliance", label:"Compliance: Mandatory FTC #ad disclosure (FND-ETH-13) & Zero Copyrighted Music (HC-33)"}
];

/* 6 Dangerous Brand Contract Clauses Scanner (BRD-CONTRACT-09 / BRD-CONTRACT-10) */
W.REDLINE_CLAUSES = [
  {k:"perpetual", label:"Perpetual paid usage / whitelisting in perpetuity", fix:"Limit organic to channel upload; price 30-day paid ad whitelisting at +25% (HC-30)"},
  {k:"broad_excl", label:"90-day broad 'all tech / software' category exclusivity", fix:"Narrow to 30 days in exact product subcategory only (BRD-PRES-22)"},
  {k:"net60", label:"Net 60 or Net 90 payment terms", fix:"Redline to Net 30 from go-live date or 50% deposit upon signature (BRD-PAY-03)"},
  {k:"unilateral_cancel", label:"Unilateral brand cancellation without kill fee after script/filming", fix:"Add 50% kill fee once script is approved and 100% once draft is filmed"},
  {k:"unlimited_rev", label:"Unlimited creative revisions at brand's sole discretion", fix:"Cap at 2 rounds of brief-based revisions; script sign-off locks creative direction (INF-DELIV-09)"},
  {k:"creator_liable", label:"Unbounded indemnification beyond deal fee", fix:"Cap mutual liability at total campaign fee paid under the IO"}
];

function V(t, views, ago, dur){ return {t:t, v:views, ago:ago, dur:dur}; }
function buildMoments(name, videos, customMoment){
  var v0 = (videos && videos[0]) ? videos[0].t : "your latest video";
  var v1 = (videos && videos[1]) ? videos[1].t : "the workflow test";
  var base = [];
  if (customMoment){
    var mAt = customMoment.split(" ")[0] || "3:15";
    var mQ = customMoment.indexOf('"') >= 0 ? customMoment.split('"')[1] : customMoment;
    base.push({at:mAt, kind:"result", quote:mQ, point:"Concrete result from " + v0, bridge:"The bit at " + mAt + " where you showed \"" + mQ + "\" is the exact kind of proof AI tool buyers look for."});
  }
  base.push(
    {at:"2:40", kind:"test", quote:"I ran this live on a real project without editing out the failures", point:"Unfiltered side-by-side test in " + v0, bridge:"Running the test live at 2:40 in \"" + v0 + "\" without cutting the rough edges is why developers trust your walkthroughs."},
    {at:"6:15", kind:"opinion", quote:"most tools in this space add steps instead of saving time", point:"Clear verdict on workflow bloat", bridge:"Your point at 6:15 about tools that actually save steps instead of adding bloat stood out to our team."},
    {at:"9:50", kind:"contrarian", quote:"I switched back to a simpler stack after a week", point:"Practical takeaway at the end of " + v1, bridge:"The breakdown at 9:50 on keeping the stack lean lines up directly with what our developer brands build."}
  );
  return base.slice(0, 3);
}
function C(id, name, handle, subs, median, up30, o){
  o = o || {};
  var mList = o.moments || buildMoments(name, o.videos, o.moment);
  var defMom = o.moment || (mList[0] ? mList[0].at + ' "' + mList[0].quote + '"' : "");
  var hClean = String(handle || "").replace(/^@/, "");
  var socials = o.socials || {ig:"@" + hClean, x:"@" + hClean};
  /* Compute 12-video outlier-trimmed average (INF-PRICE-07) & view stability (INF-PRICE-10) */
  var trimmed = o.trimmedAvgViews || Math.round(median * 0.96 / 500) * 500;
  var vs = o.viewStability || (o.videos && o.videos[0] && o.videos[2] && (o.videos[0].v / Math.max(1, o.videos[2].v) > 1.8) ? "volatile" : "stable");
  var bot = o.botRisk || (up30 > 20 || (o.eng && o.eng < 2.2) ? {level:"watch", note:"Low comment depth / Shorts spike — verify organic comment ratio (INF-QUAL-08)"} : {level:"clean", note:"Organic developer comment threads verified"});
  var fmt = o.format || (up30 > 20 ? "Shorts / Faceless" : "Talking-head + screen");
  var stars = o.starRating || (median >= 60000 && (o.eng || 4) >= 4.5 && up30 >= 3 && up30 <= 12 ? 5 : median >= 45000 && up30 >= 3 ? 4 : median >= 30000 ? 3 : 2);
  var relModel = o.relationshipModel || "brokered";
  var daysUpd = o.daysSinceUpdate != null ? o.daysSinceUpdate : (o.stage === "signed" ? (W.hash(id) % 15) : 0);
  var nextSlot = o.nextOpenSlot || at(7 + (W.hash(id) % 12));
  var onb = o.onboarding || {
    address: "Private on file · verified for product shipping (INF-MGR-16)",
    dreamBrands: ["Codewell","Agentic HQ","Linear"],
    hardNos: ["Crypto","Gambling","Adult","Unverified VPNs"],
    paymentRail: o.pay ? o.pay.split(" · ")[0] : "Wise",
    taxForm: "W-9 / W-8BEN on file"
  };
  return Object.assign({
    id:id, name:name, handle:handle, subs:subs, median:median, trimmedAvgViews:trimmed, viewStability:vs, botRisk:bot, format:fmt, starRating:stars,
    relationshipModel:relModel, managerId:o.managerId || null, daysSinceUpdate:daysUpd, exclusivityLocks:o.exclusivityLocks || [], nextOpenSlot:nextSlot, onboarding:onb,
    up30:up30, lastUp:2, videos:[], sponsors:[], email:null, emailSrc:null, emailConf:0, confirmed:false, contact:"",
    cands:[], countries:[], age:"", eng:0, stage:"new", owner:null, rate:0, moment:defMom, moments:mList, socials:socials, dmSent:null, run:null, found:at(-1, 8), tags:[], notes:[], seq:null, kit:null, reject:null, before:null, pay:null
  }, o, {moment:defMom, moments:mList, socials:socials, trimmedAvgViews:trimmed, viewStability:vs, botRisk:bot, format:fmt, starRating:stars, relationshipModel:relModel, daysSinceUpdate:daysUpd, nextOpenSlot:nextSlot, onboarding:onb});
}

/* System 4: Talent Manager & Multi-Creator Agency Hub (INF-MGR-01..16, EX-29) */
var managers = [
  {id:"mgr1", name:"Sarah Lin", agency:"Apex Creator Talent", email:"sarah@apextalent.co", phone:"+1 (415) 890-2311", feeNote:"Creator-side 15% (Gratovo adds 25% brand markup on top per INF-MGR-06)", creators:["c3","c8"], unindexedRoster:["@devopswithdan (94K median · US 48%)","@rustweekly (62K median · US 44%)"], lastTouch:at(-2), status:"active_partner", notes:"Prefers multi-creator briefs (EX-29) with target budget range and go-live window in paragraph 1."},
  {id:"mgr2", name:"Marcus Vance", agency:"Signal Talent Group", email:"marcus@signaltalent.io", phone:"+1 (212) 641-0982", feeNote:"Exclusive 20% agency split or standard brokered net rate", creators:["c4","c7"], unindexedRoster:["@mlopsdaily (78K median · US 41%)"], lastTouch:at(-5), status:"active_partner", notes:"Fastest turnaround on dedicated walkthroughs; requires 50% kill-fee protection in brand IOs."},
  {id:"mgr3", name:"Elena Rostova", agency:"CreatorBridge EU", email:"elena@creatorbridge.eu", phone:"+44 20 7946 0821", feeNote:"All-in EUR/USD invoicing via Wise (no surprise VAT per BRD-PAY-09)", creators:["c5"], unindexedRoster:["@cloudnativeeu (53K median · GB/US 52%)"], lastTouch:at(-9), status:"warm", notes:"Manages UK/EU developer educators."}
];

var creators = [
  /* ---- signed ---- */
  C("c1","Prompt Lab","@promptlab",182000,64000,6,{stage:"signed", owner:"u1", rate:1800, trimmedAvgViews:62500, viewStability:"stable", starRating:5, relationshipModel:"brokered", daysSinceUpdate:3,
    exclusivityLocks:[{cat:"voice", brand:"VoxCraft", until:at(28), days:30}], nextOpenSlot:at(9),
    email:"hello@promptlab.tv", emailSrc:"About page", emailConf:.97, confirmed:true, contact:"Maya", countries:[["US",41],["GB",12],["CA",7]], age:"18–34", eng:5.1, sponsors:["VoxCraft","Pagewise"], pay:"PayPal · maya@promptlab.tv", found:at(-74), moment:"7:40 \"it booked 11 meetings without asking me once\"",
    videos:[V("I let 5 AI agents run my week",71000,3,"14:32"),V("The AI calendar that finally works",58000,9,"11:05"),V("Building a CRM in one hour, live",49000,15,"58:12")]}),
  C("c2","Neural Notes","@neuralnotes",96000,52000,4,{stage:"signed", owner:"u2", rate:1200, trimmedAvgViews:50500, viewStability:"stable", starRating:5, relationshipModel:"brokered", daysSinceUpdate:12,
    exclusivityLocks:[{cat:"writing", brand:"Lumen AI", until:at(36), days:30}], nextOpenSlot:at(11),
    email:"team@neuralnotes.io", emailSrc:"Video description", emailConf:.94, confirmed:true, contact:"Theo", countries:[["US",36],["GB",14],["AU",6]], age:"18–34", eng:6.3, sponsors:["Lumen AI"], pay:"Wise · theo@neuralnotes.io", found:at(-61),
    videos:[V("Notion vs Obsidian with AI, 30 days later",61000,5,"16:40"),V("My second brain runs on 3 prompts",44000,12,"9:58"),V("AI summaries saved me 4 hours a week",52000,20,"12:05")]}),
  C("c3","Code with Kai","@codewithkai",240000,88000,5,{stage:"signed", owner:"u1", rate:2400, trimmedAvgViews:85500, viewStability:"stable", starRating:5, relationshipModel:"exclusive_25", managerId:"mgr1", daysSinceUpdate:4,
    exclusivityLocks:[{cat:"code", brand:"Codewell", until:at(46), days:30}], nextOpenSlot:at(14),
    email:"kai@codewithkai.dev", cc:"sarah@apextalent.co", emailSrc:"Website", emailConf:.98, confirmed:true, contact:"Kai", countries:[["US",44],["IN",13],["GB",8]], age:"18–34", eng:4.4, sponsors:["Codewell"], pay:"Bank transfer · US (W-9 verified)", found:at(-90),
    videos:[V("I built a SaaS in a weekend with Cursor",96000,4,"21:17"),V("Claude Code vs Copilot: one real project",83000,11,"18:44"),V("41 minutes to a working login page",77000,19,"13:02")]}),
  C("c4","Tensor Talk","@tensortalk",310000,120000,3,{stage:"signed", owner:"u1", rate:3100, trimmedAvgViews:116000, viewStability:"stable", starRating:5, relationshipModel:"brokered", managerId:"mgr2", daysSinceUpdate:2,
    exclusivityLocks:[], nextOpenSlot:at(12),
    email:"biz@tensortalk.com", cc:"marcus@signaltalent.io", emailSrc:"About page", emailConf:.99, confirmed:true, contact:"Lena", countries:[["US",39],["GB",10],["CA",8]], age:"25–44", eng:3.8, sponsors:["Clipforge","VoxCraft"], pay:"Wise · DE (W-8BEN verified)", found:at(-120),
    videos:[V("Every AI video tool, ranked",146000,6,"24:51"),V("This one cut my edit time in half",112000,14,"15:30"),V("The open-source model nobody talks about",98000,25,"19:12")]}),
  C("c5","The AI Desk","@theaidesk",150000,58000,8,{stage:"signed", owner:"u2", rate:1500, trimmedAvgViews:57500, viewStability:"stable", starRating:4, relationshipModel:"exclusive_25", managerId:"mgr3", daysSinceUpdate:5,
    exclusivityLocks:[], nextOpenSlot:at(6),
    email:"desk@theaidesk.news", emailSrc:"About page", emailConf:.96, confirmed:true, contact:"Ruth", countries:[["US",33],["GB",15],["AU",9]], age:"25–44", eng:4.9, sponsors:["Pagewise","Lumen AI"], pay:"PayPal · ruth@theaidesk.news", found:at(-80),
    videos:[V("This week in AI: 9 launches that matter",64000,2,"17:08"),V("The only launch I would actually pay for",59000,9,"12:44"),V("AI news, minus the hype",55000,16,"15:01")]}),
  C("c17","Agent Arena","@agentarena",140000,61000,4,{stage:"signed", owner:"u1", rate:1900, trimmedAvgViews:59000, viewStability:"volatile", starRating:5, relationshipModel:"brokered", daysSinceUpdate:14,
    exclusivityLocks:[], nextOpenSlot:at(8),
    email:"hi@agentarena.gg", emailSrc:"About page", emailConf:.95, confirmed:true, contact:"Jonas", countries:[["US",37],["GB",12],["CA",9]], age:"18–34", eng:5.4, sponsors:[], pay:"Wise · jonas@agentarena.gg", found:at(-40),
    videos:[V("5 agents race to build an app",88000,5,"22:10"),V("Which coding agent actually ships?",61000,13,"18:31"),V("I made agents argue about my startup",47000,21,"14:22")]}),

  /* ---- media kit in ---- */
  C("c7","AgentWorks","@agentworks",128000,67000,5,{stage:"kit", owner:"u1", rate:1700, trimmedAvgViews:65000, managerId:"mgr2", email:"partnerships@agentworks.ai", emailSrc:"About page", emailConf:.97, confirmed:true, contact:"Dev", countries:[["US",38],["GB",11],["CA",9]], age:"18–34", eng:4.7, sponsors:["Codewell"], found:at(-30),
    kit:{at:at(-3,16,20), rate:1700, countries:[["US",38],["GB",11],["CA",9]], age:"18–34", eng:4.7, file:"AgentWorks media kit 2026.pdf"},
    videos:[V("I gave an agent my inbox for a week",79000,4,"13:48"),V("It unsubscribed me from 212 newsletters",64000,10,"9:02"),V("Agents that actually save time",58000,18,"16:15")]}),
  C("c18","Silicon Sage","@siliconsage",88000,39000,6,{stage:"kit", owner:"u1", rate:700, trimmedAvgViews:38000, starRating:2, email:"sage@siliconsage.in", emailSrc:"Video description", emailConf:.9, confirmed:true, contact:"Arjun", countries:[["IN",31],["US",22],["PK",9]], age:"18–24", eng:3.4, found:at(-26),
    kit:{at:at(-2,11,5), rate:700, countries:[["IN",31],["US",22],["PK",9]], age:"18–24", eng:3.4, file:"Silicon Sage rate card.png"},
    videos:[V("The AI tools I actually pay for",42000,3,"12:30"),V("Free AI tools that beat paid ones",39000,10,"10:12"),V("My AI setup as a student",35000,17,"8:44")]}),

  /* ---- replied ---- */
  C("c6","Build with LLMs","@buildwithllms",74000,41000,7,{stage:"replied", owner:"u1", email:"contact@buildwithllms.dev", emailSrc:"Website", emailConf:.93, confirmed:true, contact:"Sam", countries:[["US",29],["IN",21],["DE",7]], age:"18–34", eng:5.6, found:at(-14), moment:"5:48 \"most RAG demos skip this step\"",
    seq:{steps:[{k:"first", at:at(-10,9,40), st:"sent"}], stopped:"replied"},
    videos:[V("RAG explained with one whiteboard",52000,6,"11:20"),V("Fine-tuning is not what you need",41000,12,"14:05"),V("My LLM app costs $3 a month",38000,19,"10:48")]}),
  C("c19","Latent Lounge","@latentlounge",112000,48000,5,{stage:"replied", owner:"u1", email:"collab@latentlounge.ai", emailSrc:"About page", emailConf:.95, confirmed:true, contact:"Mia", countries:[["US",40],["GB",13],["CA",6]], age:"25–34", eng:4.2, found:at(-15),
    seq:{steps:[{k:"first", at:at(-9,10,5), st:"sent"}], stopped:"replied"},
    videos:[V("Fine-tuning a 7B model on my laptop",57000,7,"19:40"),V("Local LLMs, one year in",46000,15,"16:02"),V("Why I stopped paying for ChatGPT",51000,23,"12:31")]}),
  C("c20","Copilot Corner","@copilotcorner",81000,46000,6,{stage:"replied", owner:"u1", email:"hello@copilotcorner.com", emailSrc:"About page", emailConf:.96, confirmed:true, contact:"Ben", countries:[], age:"", eng:5.0, found:at(-12),
    seq:{steps:[{k:"first", at:at(-6,9,15), st:"sent"}], stopped:"replied"},
    videos:[V("Copilot vs Cursor: 30 day test",62000,4,"15:12"),V("AI pair programming, honestly",44000,11,"12:50"),V("The settings I change on every AI editor",39000,18,"8:31")]}),

  /* ---- in sequence ---- */
  C("c8","Pixel Diffusion","@pixeldiffusion",205000,73000,4,{stage:"emailed", owner:"u1", managerId:"mgr1", email:"studio@pixeldiffusion.art", emailSrc:"About page", emailConf:.96, confirmed:true, contact:"Ines", countries:[["US",31],["BR",14],["GB",9]], age:"18–34", eng:5.9, sponsors:["Clipforge"], found:at(-9), moment:"14:10 \"the open model won on hands, finally\"",
    seq:{steps:[{k:"first", at:at(-4,9,30), st:"sent"},{k:"fu1", at:at(0,10,0), st:"due"},{k:"fu2", at:at(4,10,0), st:"planned"},{k:"fu3", at:at(11,10,0), st:"planned"}]},
    videos:[V("Midjourney v8 vs the open models",82000,2,"22:19"),V("Hands, finally solved?",69000,9,"11:44"),V("I trained a style model on my art",61000,16,"17:03")]}),
  C("c21","Token Talks","@tokentalks",67000,45000,5,{stage:"emailed", owner:"u1", email:"tokentalks.yt@gmail.com", emailSrc:"Video description", emailConf:.91, confirmed:true, contact:"Ravi", countries:[["US",35],["GB",12],["CA",8]], age:"25–34", eng:4.8, found:at(-16),
    seq:{steps:[{k:"first", at:at(-11,9,5), st:"sent"},{k:"fu1", at:at(-7,9,30), st:"sent"},{k:"fu2", at:at(0,9,0), st:"due"},{k:"fu3", at:at(7,9,0), st:"planned"}]},
    videos:[V("I spent $500 on AI APIs so you don't",58000,5,"16:22"),V("Cheapest way to run GPT-class models",47000,13,"12:10"),V("Token prices are collapsing",43000,20,"9:40")]}),
  C("c22","Gradient Guy","@gradientguy",59000,46000,4,{stage:"emailed", owner:"u1", email:"gradientguy@proton.me", emailSrc:"About page", emailConf:.92, confirmed:true, contact:"Leo", countries:[["US",30],["GB",14],["AU",8]], age:"18–34", eng:6.1, found:at(-8),
    seq:{steps:[{k:"first", at:at(-2,10,40), st:"sent"},{k:"fu1", at:at(1,10,0), st:"planned"},{k:"fu2", at:at(5,10,0), st:"planned"},{k:"fu3", at:at(12,10,0), st:"planned"}]},
    videos:[V("Backprop explained with pizza",51000,6,"10:30"),V("Transformers in 12 minutes",48000,14,"12:00"),V("What a GPU actually does",42000,22,"9:15")]}),
  C("c23","Bot Builder","@botbuilder",101000,52000,6,{stage:"emailed", owner:"u2", email:"team@botbuilder.dev", emailSrc:"Website", emailConf:.95, confirmed:true, contact:"Ola", countries:[["US",42],["CA",10],["GB",8]], age:"25–44", eng:4.5, found:at(-20),
    seq:{steps:[{k:"first", at:at(-13,9,0), st:"sent"},{k:"fu1", at:at(-10,9,0), st:"sent"},{k:"fu2", at:at(-6,9,0), st:"sent"},{k:"fu3", at:at(4,9,0), st:"planned"}]},
    videos:[V("My AI support bot answered 4,000 tickets",63000,8,"14:05"),V("Bots that don't annoy customers",49000,16,"11:40"),V("No-code agents, tested",45000,24,"13:22")]}),
  C("c24","Diffusion Daily","@diffusiondaily",77000,50000,9,{stage:"emailed", owner:"u1", email:"hey@diffusiondaily.co", emailSrc:"About page", emailConf:.94, confirmed:true, contact:"Noor", countries:[["US",34],["GB",13],["CA",9]], age:"18–34", eng:5.3, found:at(-5),
    seq:{steps:[{k:"first", at:at(0,9,12), st:"sent"},{k:"fu1", at:at(3,9,30), st:"planned"},{k:"fu2", at:at(7,9,30), st:"planned"},{k:"fu3", at:at(14,9,30), st:"planned"}]},
    videos:[V("Flux vs Midjourney, blind test",57000,3,"13:30"),V("Prompting for product photos",50000,10,"11:12"),V("Every image model this month",46000,17,"15:48")]}),
  C("c25","Vector Vibes","@vectorvibes",64000,47000,5,{stage:"emailed", owner:"u3", email:"vectorvibes@outlook.com", emailSrc:"Video description", emailConf:.9, confirmed:true, contact:"Ana", countries:[["US",38],["GB",10],["AU",7]], age:"25–34", eng:5.7, found:at(-7),
    seq:{steps:[{k:"first", at:at(-4,11,0), st:"sent"},{k:"fu1", at:at(0,11,0), st:"due"},{k:"fu2", at:at(4,11,0), st:"planned"},{k:"fu3", at:at(11,11,0), st:"planned"}]},
    videos:[V("Vector databases in 8 minutes",54000,4,"8:12"),V("Search that understands meaning",47000,12,"10:41"),V("I rebuilt Google for my notes",44000,19,"14:03")]}),

  /* ---- contact confirmed, first email drafted ---- */
  C("c15","Agentic Ally","@agentically",54000,46000,7,{stage:"contact", owner:"u1", email:"ally@agentically.co", emailSrc:"About page", emailConf:.95, confirmed:true, contact:"Ally", countries:[["US",42],["CA",11],["GB",9]], age:"18–34", eng:6.1, found:at(-3), moment:"3:05 \"my whole support inbox runs itself now\"",
    videos:[V("My agent stack for a one-person business",49000,3,"15:44"),V("Agents for solo founders",46000,10,"12:20"),V("The $20 AI stack",41000,17,"9:58")]}),
  C("c28","Neural Nomad","@neuralnomad",92000,51000,6,{stage:"contact", owner:"u1", email:"hello@neuralnomad.travel", emailSrc:"Website", emailConf:.93, confirmed:true, contact:"Eli", countries:[["US",36],["GB",15],["AU",10]], age:"25–34", eng:5.2, found:at(-4), moment:"9:20 \"the AI planned 3 countries in one prompt\"",
    videos:[V("Running a business from a van with AI",58000,5,"18:20"),V("AI travel planning, tested",51000,12,"13:40"),V("Remote work tools I'd keep",47000,20,"11:02")]}),

  /* ---- shortlisted, contact needed ---- */
  C("c9","AutoFlow Daily","@autoflowdaily",58000,47000,9,{stage:"shortlisted", owner:"u1", email:"autoflowdaily@gmail.com", emailSrc:"Guessed from the channel name", emailConf:.55, confirmed:false, countries:[["US",34],["GB",13],["CA",10]], age:"25–44", eng:6.8, found:at(-2), moment:"1:30 \"this one replaced a part-time hire\"",
    cands:[{email:"autoflowdaily@gmail.com", src:"Guessed from the channel name", conf:.55},{email:"business@autoflowdaily.com", src:"Linked website footer", conf:.81}],
    videos:[V("12 Zapier + AI automations I use daily",52000,2,"14:18"),V("This one replaced a part-time hire",47000,9,"10:05"),V("Automate your inbox in 10 minutes",44000,16,"10:11")]}),
  C("c10","Bytewise AI","@bytewiseai",91000,55000,5,{stage:"shortlisted", owner:"u1", email:null, countries:[["US",37],["GB",9],["AU",8]], age:"18–34", eng:5.2, sponsors:["Lumen AI"], found:at(-1),
    cands:[], videos:[V("The AI note-taker test: 6 apps, 1 meeting",61000,4,"15:15"),V("Two of them invented action items",55000,11,"6:15"),V("Meeting notes that write themselves",50000,18,"12:44")]}),
  C("c26","Inference Inc","@inferenceinc",73000,49000,4,{stage:"shortlisted", owner:"u1", email:"team@inference.inc", emailSrc:"About page", emailConf:.92, confirmed:false, countries:[["US",39],["GB",11],["CA",7]], age:"25–44", eng:4.6, found:at(-1),
    cands:[{email:"team@inference.inc", src:"About page", conf:.92}],
    videos:[V("Why your AI app is slow (and the 3 fixes)",53000,5,"13:00"),V("Caching LLM calls the right way",49000,13,"11:35"),V("Latency budgets for AI products",44000,21,"14:50")]}),
  C("c27","Prompt Craft","@promptcraft",48000,45000,8,{stage:"shortlisted", owner:"u3", email:"promptcraft.studio@gmail.com", emailSrc:"Video description", emailConf:.74, confirmed:false, countries:[["US",33],["GB",12],["CA",9]], age:"18–34", eng:6.4, found:at(-1),
    cands:[{email:"promptcraft.studio@gmail.com", src:"Video description", conf:.74},{email:"hi@promptcraft.io", src:"Twitter/X bio", conf:.68}],
    videos:[V("The prompt pattern nobody uses",49000,3,"9:30"),V("Prompts that write prompts",45000,10,"11:18"),V("I tested 100 prompt tips",42000,17,"16:40")]}),

  /* ---- new finds from today's run (r3) ---- */
  C("c11","Model Matters","@modelmatters",67000,49000,6,{run:"r3", found:at(0,8,14), email:"modelmatters.yt@gmail.com", emailSrc:"Video description", emailConf:.88, countries:[["US",35],["GB",12],["CA",6]], age:"18–34", eng:5.0, sponsors:["Codewell"],
    videos:[V("Claude vs GPT for coding, honest results",58000,1,"17:22"),V("Benchmarks lie: test models yourself",49000,8,"12:40"),V("Which model for which job",46000,15,"14:12")]}),
  C("c12","Prompt Daily","@promptdaily",43000,12000,2,{run:"r3", found:at(0,8,15), countries:[["IN",38],["US",18],["PK",9]], age:"18–24", eng:2.1, botRisk:{level:"high", note:"Generic 2-word comment clusters & 2.1% engagement (INF-QUAL-08)"},
    videos:[V("100 prompts in 10 minutes",14000,12,"10:02"),V("ChatGPT tricks part 47",11000,26,"0:59"),V("Make money with AI (real)",9000,33,"8:12")]}),
  C("c13","Vector Shop","@vectorshop",112000,61000,5,{run:"r3", found:at(0,8,17), email:"vectorshop@proton.me", emailSrc:"About page", emailConf:.9, countries:[["US",40],["GB",11],["AU",7]], age:"25–44", eng:4.6, sponsors:["Pagewise","Lumen AI","Sheetsmith"],
    before:{by:"u2", at:at(-122), note:"3 follow-ups, no reply"},
    videos:[V("I replaced my CRM with an AI spreadsheet",72000,3,"13:55"),V("Spreadsheets that think",61000,10,"11:21"),V("My AI ops stack",55000,17,"15:30")]}),
  C("c14","Synth Studio","@synthstudio",88000,36000,3,{run:"r3", found:at(0,8,18), countries:[["US",30],["GB",10],["DE",9]], age:"18–34", eng:3.9, sponsors:["VoxCraft"],
    videos:[V("AI voices that fooled my family",41000,5,"9:45"),V("Cloning my voice, ethically",36000,16,"12:10"),V("Text to song, tested",31000,27,"10:30")]}),
  C("c16","Deep Learning Dad","@dldad",132000,23000,1,{run:"r3", found:at(0,8,20), countries:[["US",27],["IN",19],["GB",8]], age:"35–54", eng:2.8, lastUp:21,
    videos:[V("Teaching my kids about neural nets",26000,21,"18:40"),V("A dad's guide to AI homework",22000,48,"14:12"),V("Should kids use ChatGPT?",19000,70,"16:05")]}),
  C("c30","LLM Lab Notes","@llmlabnotes",71000,52000,6,{run:"r3", found:at(0,8,22), email:"notes@llmlab.dev", emailSrc:"About page", emailConf:.93, countries:[["US",43],["GB",10],["CA",8]], age:"25–34", eng:5.8,
    videos:[V("I read every AI paper this week",61000,2,"21:04"),V("Evals explained without math",52000,9,"13:33"),V("The paper that changes agents",49000,16,"15:10")]}),
  C("c31","AI Shorts Daily","@aishortsdaily",205000,9000,31,{run:"r3", found:at(0,8,23), countries:[["US",22],["PH",14],["IN",13]], age:"18–24", eng:1.6, format:"Shorts / Faceless", botRisk:{level:"high", note:"Shorts farm: 4.3% view-to-sub ratio & 1.6% engagement (INF-QUAL-08)"},
    videos:[V("This AI is insane",12000,0,"0:41"),V("ChatGPT secret mode",8000,1,"0:38"),V("AI did my homework",9000,1,"0:44")]}),
  C("c32","Workflow Wizard","@workflowwizard",62000,48000,7,{run:"r3", found:at(0,8,25), email:"wizard@workflowwizard.io", emailSrc:"Website", emailConf:.91, countries:[["US",37],["CA",12],["GB",10]], age:"25–44", eng:6.0, sponsors:["Inboxly"],
    videos:[V("My 7 AI automations for client work",55000,3,"16:01"),V("Make.com vs Zapier with AI",48000,11,"14:42"),V("Automations that broke (and fixes)",44000,18,"12:15")]}),
  C("c33","The Agent Shop","@theagentshop",93000,58000,5,{run:"r3", found:at(0,8,27), countries:[["US",41],["GB",12],["AU",8]], age:"25–34", eng:4.9,
    videos:[V("I hired 3 AI agents for my store",66000,4,"14:48"),V("Shopify + agents: what works",58000,12,"13:10"),V("The agent that answers DMs",51000,19,"9:52")]}),
  C("c34","Data Dojo","@datadojo",118000,54000,4,{run:"r3", found:at(0,8,29), email:"sensei@datadojo.academy", emailSrc:"About page", emailConf:.94, countries:[["US",32],["IN",17],["GB",11]], age:"18–34", eng:4.3,
    videos:[V("SQL with AI: 10x faster?",59000,5,"18:22"),V("Data analysis with one prompt",54000,13,"15:40"),V("AI for analysts, honestly",50000,21,"17:35")]}),
  C("c35","Ollama Ollie","@ollamaollie",52000,46000,6,{run:"r3", found:at(0,8,31), countries:[["US",38],["GB",13],["CA",10]], age:"25–34", eng:6.6,
    videos:[V("Local AI on a $300 mini PC",51000,3,"16:55"),V("Ollama setup in 5 minutes",46000,10,"7:41"),V("Private AI for your family",43000,17,"12:02")]}),

  /* ---- rejected / never ---- */
  C("c37","Crypto AI Signals","@cryptoaisignals",41000,15000,12,{stage:"rejected", run:"r2", found:at(-2), reject:{reason:"Not relevant to AI tools", at:at(-2,14), by:"u3"}, countries:[["NG",21],["US",19],["IN",12]],
    videos:[V("AI picks the next 100x coin",17000,1,"8:40"),V("My trading bot made $4,000",14000,4,"11:12"),V("Signals for this week",12000,6,"6:55")]}),
  C("c38","AI Gossip Hour","@aigossiphour",36000,8000,3,{stage:"rejected", run:"r2", found:at(-2), reject:{reason:"Too few views", at:at(-1,15), by:"u1"}, countries:[["US",28],["GB",11],["IN",10]],
    videos:[V("Which AI CEO is lying?",9000,3,"22:10"),V("AI drama of the week",8000,10,"25:40"),V("The OpenAI rumour",7000,17,"19:02")]}),
  C("c39","Hype Machine AI","@hypemachineai",150000,40000,9,{stage:"never", run:"r1", found:at(-60), email:"ops@hypemachine.ai", reject:{reason:"Asked us to stop emailing", at:at(-30), by:"u2"}, countries:[["US",35],["GB",9],["CA",8]],
    videos:[V("AI will replace you (here's how)",44000,2,"12:44"),V("10 AI side hustles",41000,9,"10:20"),V("The AI bubble",39000,16,"14:30")]})
];

/* Brands enriched with headcount, recommendedTitle (BRD-QUAL-17), paidSpenderVerified (BRD-QUAL-19), pastCampaignHook (BRD-FIRST-04), and 4-touch brand sequences (HC-24) */
var brands = [
  {id:"b1", name:"Codewell", sells:"AI code review", cat:"code", country:"US", headcount:140, recommendedTitle:"VP Marketing / Head of DevRel", paidSpenderVerified:true, pastCampaignHook:"your recent PR-review integration on Code with Kai", budget:[3000,6000], contact:"Dana Brooks", role1:"VP Marketing", email:"dana@codewell.dev", contact2:"Evan Cole", role2:"DevRel Lead", email2:"evan@codewell.dev", status:"won", seen:["c3","c7","c11"], since:at(-150),
    seq:{steps:[{k:"first", at:at(-150,9,0), st:"sent"}], stopped:"replied"}},
  {id:"b2", name:"Lumen AI", sells:"AI writing assistant", cat:"writing", country:"GB", headcount:85, recommendedTitle:"Head of Growth / Partnerships", paidSpenderVerified:true, pastCampaignHook:"your Q3 creator campaign with Neural Notes", budget:[1500,3000], contact:"Priya Shah", role1:"Head of Partnerships", email:"priya@lumen.ai", status:"won", seen:["c2","c5","c10","c13"], since:at(-110),
    seq:{steps:[{k:"first", at:at(-110,9,0), st:"sent"}], stopped:"replied"}},
  {id:"b3", name:"VoxCraft", sells:"AI voice-over", cat:"voice", country:"US", headcount:42, recommendedTitle:"Founder / CMO", paidSpenderVerified:true, pastCampaignHook:"your voice-cloning walkthrough with Prompt Lab", budget:[2000,4000], contact:"Marco Diaz", role1:"CMO", email:"marco@voxcraft.io", status:"won", seen:["c1","c4","c14"], since:at(-95),
    seq:{steps:[{k:"first", at:at(-95,9,0), st:"sent"}], stopped:"replied"}},
  {id:"b4", name:"Pagewise", sells:"AI notes and docs", cat:"notes", country:"CA", headcount:34, recommendedTitle:"Founder / Head of Growth", paidSpenderVerified:true, pastCampaignHook:"your knowledge-base sponsor spot on The AI Desk", budget:[1000,2500], contact:"Hana Kim", role1:"Head of Growth", email:"hana@pagewise.app", status:"won", seen:["c1","c5","c13"], since:at(-130),
    seq:{steps:[{k:"first", at:at(-130,9,0), st:"sent"}], stopped:"replied"}},
  {id:"b5", name:"Clipforge", sells:"AI video editor", cat:"video", country:"US", headcount:110, recommendedTitle:"VP Marketing / Influencer Lead", paidSpenderVerified:true, pastCampaignHook:"your timeline-cut integration on Pixel Diffusion", budget:[3000,5000], contact:"Sam Ortiz", role1:"Influencer Marketing Lead", email:"sam@clipforge.video", contact2:"Nadia Ross", role2:"VP Marketing", email2:"nadia@clipforge.video", status:"negotiating", seen:["c4","c8"], since:at(-12),
    seq:{steps:[{k:"first", at:at(-9,10,0), st:"sent"}], stopped:"replied"}},
  {id:"b6", name:"Sheetsmith", sells:"AI spreadsheets", cat:"sheets", country:"US", headcount:28, recommendedTitle:"Founder / CEO / CMO (<50 emp)", paidSpenderVerified:true, pastCampaignHook:"your AI formula demo on Vector Shop", budget:null, contact:"", email:"", status:"found", seen:["c13"], since:at(0,8,17), site:"sheetsmith.ai"},
  {id:"b7", name:"Inboxly", sells:"AI email triage", cat:"email", country:"AU", headcount:64, recommendedTitle:"Head of Growth + Partnerships Manager", paidSpenderVerified:true, pastCampaignHook:"your inbox-zero sponsor integration on Workflow Wizard", budget:[1500,3200], contact:"Jo Park", role1:"Partnerships Manager", email:"jo@inboxly.com", contact2:"Liam Vance", role2:"Head of Growth", email2:"liam@inboxly.com", status:"qualified", seen:["c7","c32"], since:at(-6)},
  {id:"b8", name:"Slidecraft", sells:"AI presentations", cat:"slides", country:"US", headcount:95, recommendedTitle:"Head of Partnerships / Growth", paidSpenderVerified:true, pastCampaignHook:"your Q3 deck-generation campaign with productivity creators", budget:[1500,3500], contact:"Tom Reyes", role1:"Partnerships Lead", email:"tom@slidecraft.ai", contact2:"Clara Wu", role2:"VP Growth", email2:"clara@slidecraft.ai", status:"pitched", seen:[], since:at(-9), pitched:{at:at(-5,11,20), creators:["c1","c5"], mode:"cold"},
    seq:{steps:[{k:"first", at:at(-5,11,20), st:"sent"},{k:"fu1", at:at(0,10,0), st:"due"},{k:"fu2", at:at(5,10,0), st:"planned"},{k:"fu3", at:at(10,10,0), st:"planned"}]}},
  {id:"b9", name:"Transcribo", sells:"AI transcription", cat:"transcription", country:"GB", headcount:22, recommendedTitle:"Founder / CMO (<50 emp)", paidSpenderVerified:false, pastCampaignHook:"your meeting-notes benchmark on Bytewise AI", budget:null, contact:"", email:"", status:"found", seen:["c10","c30"], since:at(-1), site:"transcribo.co.uk"},
  {id:"b10", name:"Agentic HQ", sells:"Agent platform for teams", cat:"agents", country:"US", headcount:260, recommendedTitle:"Influencer Partnerships Manager (250+ emp)", paidSpenderVerified:true, pastCampaignHook:"your multi-agent workflow launch last month", budget:[4000,8000], contact:"Rina Patel", role1:"Influencer Partnerships Manager", email:"rina@agentichq.com", contact2:"Marcus Chen", role2:"VP Demand Gen", email2:"marcus@agentichq.com", status:"qualified", seen:["c17","c33"], since:at(-4)}
];

function inv(no, sent, due, paid){ return {no:no, sent:sent, due:due, paid:paid}; }
/* Deals enriched with dealModel, videoCount, dual deadlines (creatorDeadline vs golive), shipping, scriptApproved, qcChecks, hypeCadence, and makeGood */
var deals = [
  {id:"d1", brand:"b1", creator:"c3", step:1, checks:[true,true,false,false], price:4800, payout:3600, dealModel:"exclusive_25", videoCount:1, videosDelivered:0, owner:"u1", creatorDeadline:at(11), golive:at(16), due:at(1), deliverable:"60–90 s integration in the first third", terms:"Net 30", created:at(-9), invoice:inv("GR-2026-034",null,null,null), report:null, paidCreator:null,
    contractClauses:[true,true,true,true,true,true,true], redlineFlags:["perpetual","net60"],
    shipping:{required:false, promoCode:"KAI20", utmLink:"codewell.dev/kai?utm_source=youtube&utm_campaign=q4"},
    scriptApproved:false, placementWindow:"First third (01:40–03:10)", qcChecks:[false,false,false,false,false]},
  {id:"d2", brand:"b2", creator:"c2", step:3, checks:[true,true,false,false], price:2600, payout:1200, dealModel:"brokered", videoCount:1, videosDelivered:0, owner:"u2", creatorDeadline:at(1), golive:at(6), due:at(1), deliverable:"60–90 s integration in the first 3 minutes", terms:"Net 30", created:at(-21), invoice:inv("GR-2026-033",null,null,null), report:null, paidCreator:null,
    contractClauses:[true,true,true,true,true,true,true], redlineFlags:[],
    shipping:{required:true, item:"Lumen AI Smart Pen + Hardware Dongle", carrier:"DHL Express", tracking:"DHL-8841209", shippedAt:at(-6), deliveredAt:at(-3), promoCode:"NEURAL30", utmLink:"lumen.ai/neuralnotes"},
    scriptApproved:true, placementWindow:"First third (01:15–02:45)", qcChecks:[true,true,true,false,false]},
  {id:"d3", brand:"b3", creator:"c1", step:6, checks:[false], price:3400, payout:1800, dealModel:"brokered", videoCount:1, videosDelivered:1, owner:"u1", creatorDeadline:at(-7), golive:at(-2,15), due:at(-2), deliverable:"60–90 s integration + pinned comment", terms:"Net 30", created:at(-34), invoice:inv("GR-2026-031",null,null,null), report:null, paidCreator:null, live:"youtu.be/pl-agents-week",
    contractClauses:[true,true,true,true,true,true,true], redlineFlags:[],
    shipping:{required:false, promoCode:"PROMPTLAB", utmLink:"voxcraft.io/promptlab"},
    scriptApproved:true, placementWindow:"First third (02:10–03:35)", qcChecks:[true,true,true,true,true], hypeCadence:{h24:true, d7:false, d14:false, d30:false}, whitelistingExpiry:at(28)},
  {id:"d4", brand:"b4", creator:"c5", step:7, checks:[false,false], price:2200, payout:1500, dealModel:"exclusive_25", videoCount:1, videosDelivered:1, owner:"u1", creatorDeadline:at(-36), golive:at(-31,14), due:at(-1), deliverable:"60–90 s integration", terms:"Net 30", created:at(-60), invoice:inv("GR-2026-024",at(-31,16),at(-1),null),
    report:{due:at(-1), views:94200, targetViews:58000, clicks:1310, ctr:1.39, retentionPct:74, verdict:"overperformed"}, paidCreator:null, live:"youtu.be/aidesk-9-launches",
    contractClauses:[true,true,true,true,true,true,true], redlineFlags:[],
    shipping:{required:false, promoCode:"AIDESK", utmLink:"pagewise.app/aidesk"},
    scriptApproved:true, placementWindow:"First third (01:50–03:10)", qcChecks:[true,true,true,true,true], hypeCadence:{h24:true, d7:true, d14:true, d30:false}, whitelistingExpiry:at(3)},
  {id:"d5", brand:"b5", creator:"c4", step:0, checks:[false,false,true,false], price:5200, payout:3100, dealModel:"brokered", videoCount:1, videosDelivered:0, cpmRate:42, cpmCap:6000, viewGuarantee:85000, owner:"u1", creatorDeadline:at(25), golive:at(30), due:at(0), deliverable:"Dedicated video, 8–12 min", terms:"Net 30", created:at(-12), invoice:inv(null,null,null,null), report:null, paidCreator:null,
    contractClauses:[true,true,true,false,true,true,true], redlineFlags:["perpetual","broad_excl"],
    shipping:{required:false, promoCode:"TENSOR", utmLink:"clipforge.video/tensortalk"},
    neg:{ask:5200, offer:4500, rate:3100, floor:25, hist:[{who:"us", amt:5200, at:at(-9,10,0), note:"Opening ask with 116K 12-video trimmed average views"},{who:"brand", amt:4500, at:at(-2,17,40), note:"\"Our budget is $4,500 for a dedicated video\""}]}},
  {id:"d6", brand:"b2", creator:"c5", step:8, checks:[false], price:2600, payout:1500, dealModel:"brokered", videoCount:1, videosDelivered:1, owner:"u2", creatorDeadline:at(-39), golive:at(-34), due:at(0), deliverable:"60–90 s integration", terms:"Net 30", created:at(-70), invoice:inv("GR-2026-021",at(-34,12),at(-4),at(-4,15)),
    report:{due:at(-4), sent:at(-4,11), views:41200, targetViews:58000, clicks:590, ctr:1.43, retentionPct:68, verdict:"underperformed", makeGoodOption:"Bonus YouTube Short cutdown + pinned comment extension"}, paidCreator:null, live:"youtu.be/aidesk-lumen",
    contractClauses:[true,true,true,true,true,true,true], redlineFlags:[],
    shipping:{required:false, promoCode:"DESKLUMEN", utmLink:"lumen.ai/thedesk"},
    scriptApproved:true, placementWindow:"First third (02:05–03:20)", qcChecks:[true,true,true,true,true], hypeCadence:{h24:true, d7:true, d14:true, d30:true}},
  {id:"d7", brand:"b3", creator:"c4", step:4, checks:[true,false,false], price:4200, payout:3100, dealModel:"brokered", videoCount:1, videosDelivered:0, owner:"u1", creatorDeadline:at(-2), golive:at(3,17), due:at(2), deliverable:"60–90 s integration at 2:00–3:30", terms:"Net 30", created:at(-25), invoice:inv("GR-2026-032",null,null,null), report:null, paidCreator:null, link:"vox.cr/tensortalk",
    contractClauses:[true,true,true,true,true,true,true], redlineFlags:[],
    shipping:{required:true, item:"VoxCraft Studio Mic Preamp", carrier:"FedEx Priority", tracking:"FDX-7712904", shippedAt:at(-10), deliveredAt:at(-7), promoCode:"TENSORVOX", utmLink:"vox.cr/tensortalk"},
    scriptApproved:true, placementWindow:"First third (02:00–03:30)", qcChecks:[true,true,true,true,true]},
  {id:"d8", brand:"b4", creator:"c1", step:9, checks:[false], price:2100, payout:1300, dealModel:"brokered", videoCount:1, videosDelivered:1, owner:"u1", creatorDeadline:at(-57), golive:at(-52), due:at(1), deliverable:"60–90 s integration", terms:"Net 30", created:at(-90), invoice:inv("GR-2026-017",at(-52),at(-22),at(-20)),
    report:{due:at(-22), sent:at(-22,10), views:88400, targetViews:60000, clicks:1520, ctr:1.72, retentionPct:78, verdict:"overperformed"}, paidCreator:at(-18), payRef:"WISE-9920184", live:"youtu.be/pl-pagewise",
    contractClauses:[true,true,true,true,true,true,true], redlineFlags:[],
    shipping:{required:false, promoCode:"PLPAGE", utmLink:"pagewise.app/promptlab"},
    scriptApproved:true, placementWindow:"First third (01:30–02:50)", qcChecks:[true,true,true,true,true], hypeCadence:{h24:true, d7:true, d14:true, d30:true}}
];

function M(dir, when, text, ai, by){ return {dir:dir, at:when, text:text, ai:ai || null, by:by || null}; }
/* Threads upgraded:
   - P3 Fixed: Zero fanboy praise in c19, c22, c7, c18; replaced with peer-level timestamped observations (EX-05, EX-09, INF-FIRST-26).
   - F3 Fixed: Added active deal threads for c1, c2, c3, c4, c5 and b1, b2, b3, b4 so every Deal in the Dual-Sided Deal Room has both Brand AND Creator/Manager threads! */
var threads = {
  /* Active signed creator deal threads for Dual-Sided Deal Room (F3) */
  c1:[M("out", at(-35,10,0), "Hi Maya,\n\nVoxCraft confirmed $1,800 for the 60–90s integration + pinned comment on your 5 AI agents video. Draft is due 5 days before publish so we can clear approval smoothly.\n\nMoustafa", null, "u1"),
      M("in", at(-3,11,15), "Video is scheduled for yesterday at 15:00 EST! Link is youtu.be/pl-agents-week and the VoxCraft tracking link is in line 2 of the description + pinned comment.", {intent:"Live link confirmed", situationId:"inf.interested_what_next", summary:"Maya confirmed the VoxCraft integration is live with tracking link in top 3 lines and pinned comment.", facts:[], next:"Send the same-day Net 30 invoice to VoxCraft."})],
  c2:[M("out", at(-6,14,0), "Hi Theo,\n\nLumen AI shipped the Smart Pen via DHL Express (tracking DHL-8841209). Once it lands, our firm draft deadline is Tuesday so we have a 5-day buffer ahead of your Sunday upload.\n\nMoustafa", null, "u2"),
      M("in", at(-1,16,45), "Got the DHL package and filmed the integration at 01:20! Here is the unlisted draft link: youtu.be/unlisted-neural-lumen. Let me know if Lumen AI has any notes.", {intent:"Draft video submitted", situationId:"inf.interested_what_next", summary:"Theo submitted the unlisted draft video (placed at 01:20). Needs our 5-point QC check before forwarding to Lumen AI.", facts:[], next:"Run the 5-point QC gate (no background music HC-33, #ad disclosure FND-ETH-13), then forward to Lumen AI."})],
  c3:[M("out", at(-4,11,0), "Hi Kai and Sarah,\n\nCodewell locked in the Q4 slot ($3,600 net creator payout after our 25% management split). We are redlining two clauses in Codewell's IO (perpetual paid usage and Net 60) back to organic-only and Net 30 before sending your mirrored agreement.\n\nMoustafa", null, "u1"),
      M("in", at(-2,15,20), "Thanks Moustafa — Sarah here (Apex Talent). Once Codewell signs the cleaned Net 30 IO, send the mirrored agreement over and Kai will sign the same day. Also let us know if Codewell wants to see @devopswithdan for November.", {intent:"Manager ready to countersign", situationId:"inf.manager_cc", summary:"Sarah Lin (Apex Talent) confirmed Kai will countersign as soon as Codewell signs the redlined IO, and pitched @devopswithdan.", facts:[], next:"Generate the mirrored creator contract once Codewell signs first (BRD-CONTRACT-08)."})],
  c4:[M("out", at(-8,10,30), "Hi Lena and Marcus,\n\nClipforge came back with a $4,500 offer for the dedicated walkthrough (against our $5,200 quote). We're holding firm near $5,200 using your 146K-view AI video ranking upload as proof.\n\nMoustafa", null, "u1"),
      M("in", at(-2,19,10), "Appreciate you holding the line on rate. For the dedicated 8–12m build, $3,100 net is our firm floor given the 2-day production prep. Keep us posted on where Sam lands.", {intent:"Creator firm on $3,100 floor", situationId:"inf.rate_and_audience", summary:"Lena & Marcus confirmed $3,100 net is their floor for a dedicated video; VoxCraft integration is also in pre-live checks for this week.", facts:[], next:"Hold Clipforge at $5,000–$5,200 or pivot scope to a 60–90s integration."})],
  c5:[M("out", at(-32,9,30), "Hi Ruth,\n\nYour Pagewise integration just hit day 30 with 94,200 views and 1,310 clicks (1.39% CTR). Could you send a quick screenshot of the 30-day retention curve from YouTube Studio so we can include it in Pagewise's renewal report?\n\nMoustafa", null, "u1"),
      M("in", at(-1,10,15), "Attached the YouTube Studio retention screenshot — 74% retention across the 01:50–03:10 sponsor segment! Also open to booking Pagewise again next month.", {intent:"Sent 30d Studio analytics", situationId:"inf.interested_what_next", summary:"Ruth shared the 30-day YouTube Studio retention screenshot (74% sponsor retention) and confirmed availability for a renewal deal.", facts:[], next:"Send the 30-day ROI report + renewal pitch to Pagewise and follow up on overdue Invoice GR-2026-024."})],

  /* Active brand deal threads for Dual-Sided Deal Room (F3) */
  b1:[M("out", at(-6,10,0), "Hi Dana,\n\nCode with Kai is locked for your November release window ($4,800 for a 60–90s first-third integration). Send over the IO whenever ready.\n\nMoustafa", null, "u1"),
      M("in", at(-2,14,10), "Attached our standard insertion order for Code with Kai ($4,800). Please sign and return so we can kick off the brief.", {intent:"Sent brand IO (has redline flags)", situationId:"brd.counter_offer", summary:"Dana sent Codewell's standard IO, which includes Perpetual Paid Usage and Net 60 terms that conflict with our agreed quote.", facts:[], next:"Send batch redline email (BRD-CONTRACT-09) to narrow usage to organic channel upload and Net 30 before signing."})],
  b2:[M("out", at(-5,11,0), "Hi Priya,\n\nDHL confirmed delivery of the Smart Pen to Theo (@neuralnotes). His unlisted draft will be in our inbox by Tuesday for QC, well ahead of Sunday's publish slot.\n\nMoustafa", null, "u2"),
      M("in", at(-4,15,10), "Awesome, thank you! Also confirming our finance team wired $2,600 today for Invoice GR-2026-021 (The AI Desk's September video).", {intent:"Paid Invoice GR-2026-021 ($2,600)", situationId:"brd.wants_roster", summary:"Priya confirmed the $2,600 wire for The AI Desk's invoice cleared, and is waiting for Neural Notes' draft video.", facts:[], next:"Release The AI Desk's $1,500 payout and send a proactive Make-Good bonus Short offer for the September video."})],
  b3:[M("out", at(-3,16,0), "Hi Marco,\n\nPrompt Lab's integration went live yesterday afternoon (youtu.be/pl-agents-week) and Tensor Talk's pre-live link (vox.cr/tensortalk) is ready for Thursday's release.\n\nMoustafa", null, "u1"),
      M("in", at(-2,16,30), "Prompt Lab's segment came out super clean — already seeing trial signups from the pinned link. Send the invoice over to billing@voxcraft.io whenever ready.", {intent:"Approved live video · ready for invoice", situationId:"brd.wants_roster", summary:"Marco praised Prompt Lab's live integration and asked for the Net 30 invoice.", facts:[], next:"Send Official PDF Invoice GR-2026-031 ($3,400) today so the Net 30 clock starts."})],
  b4:[M("out", at(-31,16,0), "Hi Hana,\n\nThe AI Desk's video featuring Pagewise is live (youtu.be/aidesk-9-launches) with your tracking link in line 2 of the description. Attached is Invoice GR-2026-024 ($2,200, Net 30).\n\nMoustafa", null, "u1"),
      M("in", at(-15,11,0), "Received, thanks Moustafa! Queued with finance for this month's run.", {intent:"Invoice queued with finance", situationId:"brd.wants_roster", summary:"Hana confirmed receipt of Invoice GR-2026-024 (now 1 day past Net 30) while the video overperformed at 94.2K views.", facts:[], next:"Send the Chocolate-Pill reminder (BRD-PAY-01) leading with 94.2K views & 1,310 clicks + check on Invoice GR-2026-024."})],

  /* Creator outreach & reply threads (P3 Fixed: zero fanboy praise) */
  c6:[M("out", at(-10,9,40), "Hi Sam,\n\nAt 5:48 in your RAG whiteboard video, you walked through the chunk-overlap failure mode that most tutorials skip, which is why developers actually finish your builds. We're pairing AI educators with developer-tool sponsors for November. Open to hearing how paid integrations work?\n\nMoustafa, Gratovo", null, "u1"),
      M("in", at(-1,18,2), "Hey, thanks! Yes, open to it. What do these usually pay? I've never done a sponsor before and I don't want to sound like an ad.", {intent:"Interested · asks about pay", situationId:"inf.interested_asks_pay", summary:"Open to sponsors, first time. Worried the integration will sound like an ad. Asked what it pays.", facts:[], next:"Give a range, reassure on fit, ask for YouTube Studio numbers."})],
  c19:[M("out", at(-9,10,5), "Hi Mia,\n\nAt 4:12 in your 7B-on-a-laptop video, you benchmarked token/sec drop-off under real memory pressure instead of synthetic prompts, which gives local-LLM builders a real buying signal. We pair AI channels with developer tools they'd use on camera anyway. Open to hearing about paid integrations?\n\nMoustafa, Gratovo", null, "u1"),
       M("in", at(-3,13,30), "Thanks, but I'm fully booked until the new year. Maybe ping me in January?", {intent:"Not now · try in January", situationId:"inf.not_now", summary:"Booked until the new year. Asked to be contacted in January.", facts:[{k:"park", label:"Come back", v:at(79), show:"Early January"}], next:"Thank her, park until 6 January with a reminder."})],
  c20:[M("out", at(-6,9,15), "Hi Ben,\n\nAt 6:30 in your 30-day Copilot vs Cursor test, you kept the failed multi-file refactor in the cut to show where context windows actually break. We pair developer channels with coding tools for paid 60–90s integrations. Open to hearing what we're planning?\n\nMoustafa, Gratovo", null, "u1"),
       M("in", at(0,8,42), "Hey! Thanks for reaching out. My rate for a 60-second integration is $900. Audience is US 46%, UK 9%, Canada 8%, mostly 25–34. Happy to chat.", {intent:"Interested · sent rate and audience", situationId:"inf.rate_and_audience", summary:"Interested. Shared a rate and the audience split in the first reply.", facts:[{k:"rate", label:"Rate", v:900, show:"$900 per 60 s integration"},{k:"countries", label:"Top countries", v:[["US",46],["GB",9],["CA",8]], show:"US 46% · GB 9% · CA 8%"},{k:"age", label:"Age", v:"25–34", show:"Mostly 25–34"}], next:"Save the facts, ask for a screenshot from YouTube Studio to confirm for brand matching, then sign."})],
  c8:[M("out", at(-4,9,30), "Hi Ines,\n\nThe side-by-side hand-rendering test at 14:10 in your Midjourney v8 breakdown showed the exact prompt delta without cherry-picking outputs. We work with creative AI brands like Clipforge and VoxCraft that sponsor workflow breakdowns. Would paid integrations be of interest?\n\nMoustafa, Gratovo", null, "u1")],
  c21:[M("out", at(-11,9,5), "Hi Ravi,\n\nAt 3:40 in \"I spent $500 on AI APIs so you don't\", your cost-per-1K-output-tokens table exposed the hidden retry overhead developers miss. We're planning campaigns for Codewell and Agentic HQ next month. Open to seeing how a 60–90s integration would look?\n\nMoustafa, Gratovo", null, "u1"),
       M("out", at(-7,9,30), "Hi Ravi,\n\nQuick addition to my note — your newer upload on collapsing token prices lines up directly with what Codewell's engineering buyers watch. Open to a quick look?\n\nMoustafa", null, "u1")],
  c25:[M("out", at(-4,11,0), "Hi Ana,\n\nAt 4:05 in \"Vector databases in 8 minutes\", your diagram comparing HNSW recall against latency made the trade-off immediately clear for backend engineers. We're looking to pair you with brands like Codewell and Pagewise. Open to hearing more?\n\nMoustafa, Gratovo", null, "u1")],
  c22:[M("out", at(-2,10,40), "Hi Leo,\n\nAt 5:18 in \"Backprop explained with pizza\", walking through the chain-rule gradient step by hand before showing PyTorch code is why engineering students stick through the whole video. We're planning campaigns for Codewell and Lumen AI. Open to paid integrations?\n\nMoustafa, Gratovo", null, "u1")],
  c23:[M("out", at(-13,9,0), "Hi Ola,\n\nAt 6:12 in your 4,000-ticket support bot teardown, showing the exact fallback prompt that prevented hallucinated refunds is what SaaS buyers look for. We're planning campaigns for Inboxly and Agentic HQ. Open to sponsors?\n\nMoustafa, Gratovo", null, "u2"),
       M("out", at(-10,9,0), "Hi Ola,\n\nQuick check-in on my note from Monday — Inboxly is locking their November creator roster this week. Worth a quick look?\n\nMoustafa", null, "u2"),
       M("out", at(-6,9,0), "Hi Ola,\n\nYour newer upload on no-code agents hit 45K views in a week, and Agentic HQ is booking that exact audience right now. Open to hearing the details?\n\nMoustafa", null, "u2")],
  c24:[M("out", at(0,9,12), "Hi Noor,\n\nAt 7:22 in your blind Flux vs Midjourney test, holding lighting prompts constant across 12 product shots made the benchmark genuinely reproducible. We work with creative AI brands like Clipforge and VoxCraft. Open to hearing about paid integrations?\n\nMoustafa, Gratovo", null, "u1")],
  c7:[M("out", at(-17,10,0), "Hi Dev,\n\nAt 4:50 in your inbox-agent video, showing the rule filter that unsubscribed 212 newsletters without touching client threads proved the workflow works in production. We're planning campaigns for Inboxly and Codewell. Open to paid integrations?\n\nMoustafa, Gratovo", null, "u1"),
      M("in", at(-14,12,0), "Thanks! Happy to talk. What do you need from me?", {intent:"Interested", situationId:"inf.interested_what_next", summary:"Interested, asked what we need.", facts:[], next:"Ask for analytics and rate."}),
      M("out", at(-13,9,0), "Could you share your YouTube Studio audience analytics (top countries and age, last 90 days) so we can match your audience to our active brand budgets, plus your rate for a 60–90 s integration?", null, "u1"),
      M("in", at(-3,16,20), "Here's my media kit: US 38%, GB 11%, CA 9%, mostly 18–34. Rate is $1,700 for an integration.", {intent:"Media kit sent", situationId:"inf.rate_and_audience", summary:"Sent the media kit with rate and audience.", facts:[{k:"rate", label:"Rate", v:1700, show:"$1,700 per integration", saved:true},{k:"countries", label:"Top countries", v:[["US",38],["GB",11],["CA",9]], show:"US 38% · GB 11% · CA 9%", saved:true}], next:"Check the audience, then sign."})],
  c18:[M("out", at(-12,10,0), "Hi Arjun,\n\nAt 3:15 in \"The AI tools I actually pay for\", breaking down monthly subscription ROI against student project hours was a sharp, practical filter. We match AI educators with software sponsors. Open to hearing how we work?\n\nMoustafa, Gratovo", null, "u1"),
       M("in", at(-2,11,5), "Sure! Rate card attached. $700 per video. Audience mostly India and US.", {intent:"Media kit sent", situationId:"inf.rate_and_audience", summary:"Rate card sent. Audience led by India.", facts:[{k:"rate", label:"Rate", v:700, show:"$700 per video", saved:true}], next:"Audience fails the US/UK/CA/AU rule. Decline politely or keep for non-US brands."})],

  /* Brand negotiation & pitch threads (P1 Fixed: views instead of subs, marketing campaign opener) */
  b5:[M("out", at(-9,10,0), "Hi Sam,\n\nSaw Clipforge's recent timeline-cut integration on Pixel Diffusion. Tensor Talk (120K average views per upload, 39% US audience) just published a 24-minute AI video tool ranking that passed 146K views in six days.\n\nFollowing our discovery chat, a dedicated 8–12m walkthrough is $5,200. Want to lock his November slot?\n\nMoustafa, Gratovo", null, "u1"),
      M("in", at(-2,17,40), "Interested. Our budget is $4,500 for a dedicated video, can you work with that?", {intent:"Counter-offer · $4,500", situationId:"brd.counter_offer", summary:"Wants Tensor Talk. Offered $4,500 against our $5,200 ask.", facts:[{k:"offer", label:"Their offer", v:4500, show:"$4,500 dedicated video"}], next:"Hold near $5,200 with proof, or meet at $4,900 with a 30-day usage limit."})],
  b8:[M("out", at(-5,11,20), "Hi Tom,\n\nSaw Slidecraft's Q3 deck-generation campaign with productivity creators. We manage two AI workflow channels your buyers already watch: Prompt Lab (60K+ views per video, 41% US) and The AI Desk (55K+ views per video, weekly AI launches).\n\nBoth have November integration slots open and consistently beat 1.3% link CTR. Should I send the details?\n\nMoustafa, Gratovo", null, "u1")],
  b7:[], b10:[]
};

/* Drafts upgraded (P2, P5, P6 fixed) */
var drafts = [
  {id:"q1", kind:"reply", to:{t:"creator", id:"c6"}, mailbox:"m1", created:at(-1,18,6), subject:"Re: AI educators roster",
    body:"Hi Sam,\n\nTotally fair. For a channel averaging 40K+ views, a 60–90 second integration usually pays in the $1,200–$1,800 range, and we only bring you developer tools you'd genuinely use on camera so it never reads like an ad.\n\nCould you send a screenshot of your YouTube Studio Audience tab (top countries and age, last 90 days) so we can match your audience to our November brand campaigns?\n\nMoustafa",
    why:"They asked about pay and worry about sounding like an ad. Answer with a concrete range, reassure on fit, and state our matching reason for analytics (INF-REPLY-07, INF-REPLY-18).", rules:["INF-REPLY-07","INF-REPLY-18","INF-PRICE-02"], gates:[]},
  {id:"q2", kind:"reply", to:{t:"brand", id:"b5"}, deal:"d5", mailbox:"m1", created:at(-2,18,0), subject:"Re: Tensor Talk for Clipforge",
    body:"Hi Sam,\n\nThanks for coming back quickly. Tensor Talk's dedicated walkthroughs run at $5,200 because his 12-video trimmed average is 116K views and his last AI video ranking passed 146K views in six days.\n\nIf it helps fit your Q4 budget, we can meet at $4,900 for the dedicated video with organic channel upload, or keep $4,500 for a 90-second first-third integration + pinned comment. Shall I send the agreement over?\n\nMoustafa",
    why:"The brand offered under our ask. Hold value with 12-video view proof, or offer a clean scope trade-off (BRD-NEG-04, BRD-NEG-11, BRD-PRICE-09).", rules:["BRD-NEG-04","BRD-NEG-11","BRD-PRICE-09"], gates:[{k:"price", text:"This email names prices ($5,200 / $4,900 / $4,500). Confirm before sending."}]},
  {id:"q3", kind:"first", to:{t:"creator", id:"c9"}, mailbox:"m2", created:at(-1,16,0), subject:"the automation that replaced a part-time hire",
    body:"Hi AutoFlow,\n\nThe automation at 1:30 in your Zapier + AI video that replaced a part-time hire is the clearest workflow demo I have seen this week.\n\nWe are looking to pair you with brands like Inboxly and Agentic HQ next month, and your audience fits what they look for. Open to hearing what they have in mind?\n\nMoustafa, Gratovo",
    why:"First email: one real moment from their latest video, truthful brand-stage wording for qualified prospects (INF-FIRST-21), one yes-or-no question.", rules:["INF-FIRST-02","INF-FIRST-21","FND-WRITE-11"], gates:[{k:"unconfirmed", text:"The address was guessed from the channel name and nobody has confirmed it."}]},
  {id:"q4", kind:"first", to:{t:"creator", id:"c15"}, mailbox:"m1", created:at(0,8,50), subject:"a support inbox that runs itself",
    body:"Hi Ally,\n\n\"My whole support inbox runs itself now\" at 3:05 is the line I keep repeating to people. Solo founders are the exact buyers our AI workflow brands want to reach.\n\nWe are looking to pair you with brands like Inboxly and Agentic HQ for November integrations. Open to hearing the details?\n\nMoustafa, Gratovo",
    why:"First email: quotes the strongest line from the latest video, uses truthful brand stage wording (INF-FIRST-21), and asks one easy question.", rules:["INF-FIRST-02","INF-FIRST-21","FND-WRITE-11"], gates:[]},
  {id:"q5", kind:"first", to:{t:"creator", id:"c28"}, mailbox:"m1", created:at(0,8,52), subject:"three countries in one prompt",
    body:"Hi Eli,\n\nThe bit at 9:20 where the AI planned three countries in one prompt sold me on the whole van setup. Remote-work builders are right in the sweet spot for our productivity brands.\n\nWe work with Pagewise and Lumen AI and are booking their November creator slots now. Would you be open to a paid integration?\n\nMoustafa, Gratovo",
    why:"First email: a specific moment, truthful 'we work with' phrasing for won clients (INF-FIRST-21), one easy question.", rules:["INF-FIRST-02","INF-FIRST-21","FND-WRITE-11"], gates:[]},
  {id:"q6", kind:"followup", n:1, to:{t:"creator", id:"c8"}, mailbox:"m1", created:at(0,7,0), subject:"Re: the hands comparison",
    body:"Hi Ines,\n\nWanted to add one quick detail to my note from Thursday. We work with VoxCraft and Lumen AI, and both are booking 60–90 second integrations for November right now. Open to seeing how that would look?\n\nMoustafa",
    why:"Follow-up 1 of 3, two sentences with a concrete brand update instead of a stock bump (FND-WRITE-27, HC-15).", rules:["INF-FU-03","FND-WRITE-27"], gates:[]},
  {id:"q7", kind:"followup", n:2, to:{t:"creator", id:"c21"}, mailbox:"m3", created:at(0,7,0), subject:"Re: AI API cost breakdown",
    body:"Hi Ravi,\n\nSaw your newer upload on collapsing token prices pass 43K views. Codewell and Agentic HQ are booking developer channels that test API costs honestly for November, and your channel was the first I thought of. Worth a quick look?\n\nMoustafa",
    why:"Follow-up 2 of 3 (INF-FU-15): references a newer upload + concrete brand fit rather than repeating the first email.", rules:["INF-FU-15","FND-WRITE-27"], gates:[{k:"cap", text:"outreach3 is slowed to 20 a day after bounces; this send uses 1 of the 3 left."}]},
  {id:"q8", kind:"followup", n:1, to:{t:"creator", id:"c25"}, mailbox:"m1", created:at(0,7,0), subject:"Re: vector databases in 8 minutes",
    body:"Hi Ana,\n\nQuick check-in on my note from last week. We work with Codewell and Pagewise and are locking their November developer explainers this week. Would you be open to a 60–90 second integration?\n\nMoustafa",
    why:"Follow-up 1 of 3, three short sentences with named won clients (INF-FIRST-21, FND-WRITE-27).", rules:["INF-FU-03","FND-WRITE-27"], gates:[]},
  {id:"q9", kind:"reply", to:{t:"creator", id:"c20"}, mailbox:"m1", created:at(0,8,45), subject:"Re: Copilot vs Cursor",
    body:"Hi Ben,\n\nThanks, that is super helpful. $900 for a 60–90 second integration works well as a starting point.\n\nCould you send a quick screenshot of your YouTube Studio Audience tab (top countries and age, last 90 days) so we can match your channel against our November developer brand budgets and bring you a concrete offer this week?\n\nMoustafa",
    why:"P5 Fixed (INF-REPLY-18, EX-19): Accepts the rate as a starting point and states Gratovo's own matching purpose for the YouTube Studio screenshot without blaming 'brands ask for it'.", rules:["INF-REPLY-03","INF-REPLY-17","INF-REPLY-18"], gates:[]},
  {id:"q10", kind:"reply", to:{t:"creator", id:"c19"}, mailbox:"m1", created:at(-3,13,40), subject:"Re: paid integrations",
    body:"Hi Mia,\n\nTotally understood, congrats on the full Q4 schedule. I'll check back in early January when Q1 campaigns open up.\n\nMoustafa",
    why:"Not now. Keep it short and warm, and set a reminder for January.", rules:["INF-NOTNOW-01"], gates:[], after:{park:at(79)}}
];

/* today's search run */
var KW = [["ai agents for small business",14,4],["claude vs gpt coding",11,3],["ai note taker review",9,2],["best ai video editor 2026",16,5],["rag tutorial beginners",8,2],["ai automation zapier",12,4],["cursor ai tutorial",10,3],["ai voice cloning review",7,1],
  ["local llm setup",0,0],["ai for youtube creators",0,0],["midjourney vs flux",0,0],["ai sales tools",0,0],["notebooklm tutorial",0,0],["ai spreadsheet tools",0,0],["perplexity vs google",0,0],["ai coding agents",0,0],
  ["ai productivity stack",0,0],["agentic workflows explained",0,0],["ai image editing app",0,0],["whisper transcription tutorial",0,0],["llm fine tuning beginner",0,0],["ai email assistant",0,0],["ai meeting notes",0,0],["open source ai models",0,0]];
var runs = [
  {id:"r3", at:at(0,8,10), by:"u1", status:"paused", cur:8, kws:KW.map(function(k, i){ return {q:k[0], st:i < 8 ? "done" : "queued", found:k[1], kept:k[2]}; }), found:87, kept:24, gold:9, archived:61, videos:412,
    log:[[at(0,8,10,2),"Run started on this computer · 24 keywords"],[at(0,8,10,40),"\"ai agents for small business\" · 14 channels, 4 kept"],[at(0,8,13,5),"\"claude vs gpt coding\" · 11 channels, 3 kept"],[at(0,8,31,52),"Paused after keyword 8 by you · everything found is saved"]]},
  {id:"r2", at:at(-2,9,0), by:"u2", status:"done", cur:20, kws:[], found:240, kept:61, gold:17, archived:179, videos:1180},
  {id:"r1", at:at(-7,8,30), by:"u1", status:"done", cur:30, kws:[], found:362, kept:97, gold:31, archived:265, videos:1702}
];
var mateRun = {by:"u3", at:at(0,9,2), cur:12, total:40, kws:["ai agents for small business","ai sales tools","notion ai review","ai for real estate","chatgpt for teachers"]};

var POOL = [["Latent Space Lab","@latentspacelab","Inside a 70B training run",58000,77000],["Copilot Campus","@copilotcampus","Teaching CS with AI tutors",47000,61000],["Neural Kitchen","@neuralkitchen","AI meal planning for a month",52000,83000],
  ["Agent Atlas","@agentatlas","Mapping every agent framework",49000,70000],["Prompt Pilot","@promptpilot","Prompts for pilots and planners",13000,51000],["Synthetic Sam","@syntheticsam","AI avatars for YouTube, tested",61000,104000],
  ["Loop & Logic","@loopandlogic","n8n + AI for ops teams",46000,58000],["The Token Times","@tokentimes","AI news in 6 minutes",55000,99000],["Bits & Bots","@bitsandbots","Robot vacuums with LLM brains",21000,64000],["Model Garden","@modelgarden","Open models for small teams",48000,66000]];

var notifs = [
  {id:"n1", at:at(0,8,42), icon:"reply", text:"Copilot Corner replied with a rate and audience", sub:"Reach · Replies", go:{s:"today", item:"reply:q9"}, read:false},
  {id:"n2", at:at(0,8,31), icon:"pause", text:"Today's search paused after keyword 8", sub:"24 kept so far · everything is saved", go:{s:"find", tab:"search"}, read:false},
  {id:"n3", at:at(-1,17,0), icon:"alert", text:"outreach3 slowed to 20 sends a day", sub:"Bounces reached 3.2% this week", go:{s:"reach", tab:"mailboxes"}, read:false},
  {id:"n4", at:at(0,0,5), icon:"wallet", text:"Pagewise invoice GR-2026-024 is 1 day overdue", sub:"$2,200 · due 18 Oct", go:{s:"deliver", tab:"money"}, read:true},
  {id:"n5", at:at(-4,15,10), icon:"unlock", text:"Lumen AI paid $2,600, so The AI Desk can be paid", sub:"Payout $1,500 unlocked", go:{s:"deliver", tab:"money"}, read:true},
  {id:"n6", at:at(-1,11,0), icon:"forward", text:"Sara handed you Clipforge × Tensor Talk", sub:"\"Brand countered at $4,500, your call on price\"", go:{s:"close", tab:"negotiate"}, read:true}
];

var log = [
  {id:"l1", at:at(0,9,12), who:"u1", text:"Sent the first email to Diffusion Daily", ref:{t:"creator", id:"c24"}},
  {id:"l2", at:at(0,9,2), who:"u3", text:"Started a search: 40 keywords", ref:null},
  {id:"l3", at:at(0,8,31), who:"u1", text:"Paused today's search after keyword 8", ref:null},
  {id:"l4", at:at(-1,17,30), who:"u2", text:"Marked Lumen AI × Neural Notes draft as received", ref:{t:"deal", id:"d2"}},
  {id:"l5", at:at(-1,11,0), who:"u2", text:"Handed Clipforge × Tensor Talk to you", ref:{t:"deal", id:"d5"}},
  {id:"l6", at:at(-2,14,0), who:"u3", text:"Rejected Crypto AI Signals (not relevant)", ref:{t:"creator", id:"c37"}}
];

var team = [
  {id:"u1", name:"You", role:"Owner", status:"online", doing:"Today"},
  {id:"u2", name:"Sara", role:"Account manager", status:"online", doing:"Reach · replies"},
  {id:"u3", name:"Omar", role:"VA", status:"online", doing:"Search · keyword 12 of 40"},
  {id:"u4", name:"Lina", role:"VA · first week", status:"away", doing:"Away until 13:00"}
];
var mail = [
  {id:"m1", addr:"outreach1@gratovo.co", cap:35, sent:13, warm:{done:true, day:41}, bounce:.8, reply:6.1, inbox:9, status:"good", spfDkimDmarc:true},
  {id:"m2", addr:"outreach2@gratovo.co", cap:20, sent:4, warm:{done:false, day:9, of:14}, bounce:.4, reply:5.2, inbox:9, status:"warming", spfDkimDmarc:true},
  {id:"m3", addr:"outreach3@gratovo.co", cap:20, capNormal:35, sent:17, warm:{done:true, day:63}, bounce:3.2, reply:3.9, inbox:7, status:"slowed", spfDkimDmarc:true, note:"Bounces passed 3% this week, so sends are held at 20 a day until they fall under 2%."}
];

var hist = {sent:[], replies:[]};
for (var i = 29; i >= 0; i--){
  var dow = new Date(at(-i)).getDay(), weekend = dow === 0 || dow === 6;
  var s = weekend ? 4 + (W.hash("s"+i) % 6) : 28 + (W.hash("s"+i) % 22);
  hist.sent.push({at:at(-i), v:i === 0 ? 13 : s});
  hist.replies.push({at:at(-i), v:Math.round(s * (0.04 + (W.hash("r"+i) % 5) / 100))});
}
hist.months = [{m:"May", sent:610, replies:31, signed:2, revenue:4100},{m:"Jun", sent:780, replies:41, signed:3, revenue:7300},{m:"Jul", sent:920, replies:47, signed:4, revenue:9800},
  {m:"Aug", sent:1010, replies:52, signed:5, revenue:12600},{m:"Sep", sent:1040, replies:58, signed:6, revenue:15200},{m:"Oct", sent:690, replies:39, signed:2, revenue:8700}];

/* System 16: 50-Send Batch Diagnostic Metrics (FND-DLV-22 & BRD-FU-12) */
var batchDiagnostics = [
  {id:"bd1", batch:"Creator Batch #14 (AI Agents & Coding · 50 sends)", sent:50, openRate:64, replyRate:12.0, signed:2, status:"healthy", diagnosis:"Healthy batch (64% open, 12% reply, 2 signed). Keep subject lines and timestamped hooks."},
  {id:"bd2", batch:"Creator Batch #15 (Local LLMs · 50 sends)", sent:50, openRate:58, replyRate:2.0, signed:0, status:"hook_weak", diagnosis:"Open rate is strong (58%) but reply rate is 2% (<4% floor). Subject line works, but the video moment hook or brand bridge is not landing (FND-DLV-22)."},
  {id:"bd3", batch:"Brand Batch #06 (AI Productivity SaaS · 50 sends)", sent:50, openRate:34, replyRate:2.0, signed:0, status:"deliverability", diagnosis:"Open rate dropped to 34% (<40% floor). Check outreach3 bounce rate, domain warmup, and verify buyer titles match company headcount (BRD-FU-12)."}
];

/* System 16: First-Week Operator / VA Onboarding Checklist (QOL[210]) */
var vaOnboarding = [
  {k:"vo1", label:"Complete 20 Creator Triage decisions in Find › Review with ≥90% match to Gratovo 5-Star Rubric", done:true},
  {k:"vo2", label:"Verify 10 Creator business emails from About page / website footer (zero guessed @gmail sends)", done:true},
  {k:"vo3", label:"Pick 5 checkable timestamped video moments (MM:SS + why it matters, zero fanboy adjectives)", done:true},
  {k:"vo4", label:"Spot 5 active SaaS sponsors from creator descriptions and add to Close › Brands with headcount title routing", done:false},
  {k:"vo5", label:"Have 10 shadow-drafted first emails approved by Owner/AM with zero Playbook linter warnings", done:false}
];

W.seed = function(){
  return {
    version:"6.0",
    creators:creators, managers:managers, brands:brands, deals:deals, threads:threads, drafts:drafts, runs:runs, mateRun:mateRun, pool:POOL, poolI:0,
    notifs:notifs, log:log, team:team, mail:mail, hist:hist, batchDiagnostics:batchDiagnostics, vaOnboarding:vaOnboarding,
    me:"u1", snoozed:{}, handed:{}, done:[], notes:{}, calls:{},
    day:{budget:240, started:null},
    funnelTarget:{monthlyRevenue:20000, avgMarginPerDeal:1600, closeRatePct:25, brandReplyPct:8, creatorSignPct:15},
    rules:{countries:["US","GB","CA","AU"], minMedian:45000, minUploads:3, perKeyword:40, archiveDays:7, excludeFemaleCouple:true, excludeHaram:true, boycott:["Wix","Fiverr","Monday.com"], audience:{top3:["US","GB","CA","AU"], ages:["18–24","18–34","25–34","25–44"], minEng:3}, marginFloor:25, cpm:40, markup:60, sendWindow:"9:00–11:00 their time", emergencySocialProof:false},
    settings:{density:"comfortable", vaMoney:"hide", vaApproval:"shadow"}
  };
};
})();
