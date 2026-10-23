/* plan.js — the UX plan, made visual. The Plan page (principles, the 127-task coverage against today's app,
   quality-of-life catalog, feedback map, speed rules, build order, open questions) and the Why layer: numbered
   pins over any screen that explain what each part does, why, and what today's app does instead. */
(function(){
"use strict";
var W = window.W, html = W.html, Icon = W.Icon, useState = W.useState, useEffect = W.useEffect, useRef = W.useRef;
var Btn = W.Btn, Tag = W.Tag;

W.css(`
.plan-nav{display:flex; flex-wrap:wrap; gap:6px; position:sticky; top:0; z-index:4; background:var(--bg); padding:8px 0}
.plan-sec{display:flex; flex-direction:column; gap:12px; scroll-margin-top:60px}
.plan-sec>h2{font-size:1.3rem}
.plan-sec>p.lead{color:var(--ink-2); max-width:78ch}
.covbar{display:flex; height:14px; border-radius:7px; overflow:hidden; gap:2px; background:var(--sunk-2)}
.covbar i{display:block; height:100%}
.step-acc{border:1px solid var(--line); border-radius:var(--r-l); background:var(--panel); overflow:hidden}
.step-acc>button{display:flex; align-items:center; gap:10px; width:100%; border:0; background:none; padding:12px 14px; text-align:start; color:inherit}
.step-acc>button:hover{background:var(--sunk)}
.step-acc .mini{display:flex; gap:2px; width:120px; height:8px; border-radius:4px; overflow:hidden; flex:none}
.step-acc .mini i{display:block; height:100%}
.task-row{display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:14px; padding:10px 14px; border-top:1px solid var(--line); font-size:13px}
.task-row .side{display:flex; flex-direction:column; gap:4px; min-width:0}
.task-row .side small{color:var(--muted); font-size:12px}
@media (max-width:760px){ .task-row{grid-template-columns:1fr} }
.st-ok{background:var(--good)} .st-buried{background:var(--warn)} .st-partial{background:var(--accent)} .st-missing{background:var(--crit)} .st-outside{background:var(--faint)}
.pl-in{background:var(--good)} .pl-part{background:var(--accent)} .pl-plan{background:var(--line-2)} .pl-decide{background:var(--warn)} .pl-out{background:var(--faint)}
.lg{display:inline-flex; align-items:center; gap:6px; font-size:12px; color:var(--ink-2); white-space:nowrap}
.lg i{width:10px; height:10px; border-radius:3px; display:inline-block}
.flow{display:grid; grid-template-columns:minmax(0,1fr) auto minmax(0,1fr) auto minmax(0,1fr); gap:10px; align-items:stretch}
.flow .fb{border-radius:12px; padding:14px; background:var(--panel); border:1px solid var(--line); display:flex; flex-direction:column; gap:6px; min-width:0}
.flow .fa{display:grid; place-items:center; color:var(--muted)}
@media (max-width:900px){ .flow{grid-template-columns:1fr} .flow .fa{transform:rotate(90deg)} }
.fbk{display:grid; grid-template-columns:150px minmax(0,1.4fr) minmax(0,1fr) 120px; gap:0}
.cause{display:grid; grid-template-columns:minmax(0,1fr) 24px minmax(0,1fr); gap:10px; align-items:center; padding:10px 0; border-bottom:1px solid var(--line); font-size:13px}
.cause:last-child{border-bottom:0}
@media (max-width:760px){ .cause{grid-template-columns:1fr} .cause .ic{display:none} }
`);

/* ---------- principles ---------- */
var P = [
  {id:"p1", t:"Start every day in one place", d:"Today gathers every next action across finding, reaching, closing and delivering, ordered by how close it is to money, with a time estimate and a reason on each.", how:["Money first, then deal steps, replies, approvals, follow-ups, signing, contacts, new finds","A 4-hour budget bar shows whether the day fits","The next item opens when you finish one"], was:"Home tells you the state, not the next thing to do. Unassigned items count as everyone's, drafts waiting for approval are not on Home, and four places disagree about follow-ups.", show:"today-queue"},
  {id:"p2", t:"Every record shows its one next step", d:"Creators, brands and deals each carry a step tracker and a single next action with a Do it button. Waiting states say what they are waiting for and until when.", how:["Step trackers on every record","\"Next: Approve the first email\" with one button","Waiting states: \"Follow-up 1 in 3 days\", \"Locked until the brand pays\""], was:"There is no Signed stage, the conversation status stays \"Replied\" after you answer, and any deal stage can be jumped to by hand.", show:"nextcard"},
  {id:"p3", t:"Routine work one at a time, judgment calls with everything", d:"High-volume work (finds, sends, follow-ups) runs as a queue you clear with the keyboard. Decisions that need judgment (negotiating, contracts, money) open the full record with all the context.", how:["Triage shows one channel with its last three videos","Focus mode hides everything but the current item","Negotiation shows the ladder, the thread and the draft together"], was:"Qualifying means opening every profile and scrolling to the 5th, 6th or 7th card; shortlisting and rejecting are right-click only.", show:"triage"},
  {id:"p4", t:"Never lose your place", d:"Records open beside the list instead of replacing it. Back and forward work across screens. Filters, tabs and drafts are remembered.", how:["Peek panel with Alt ↑ / Alt ↓ to walk the list","Back / forward and breadcrumbs","Tabs remembered per screen"], was:"The Comms queue cannot be linked to and has no link to the creator or the conversation; filters reset every session; the filter sheet hides the list.", show:"peek"},
  {id:"p5", t:"Every action answers four questions", d:"Did it work, where did it go, what happens next, and how do I take it back. Toasts say all four; counters move; the activity log records it.", how:["\"Sent to Ines from outreach1. Follow-up 1 is planned for Thu 22 Oct.\" with Undo","Undo and redo for every change, Ctrl Z","Save status in the top bar"], was:"Toasts are not clickable, a finished search run has no link to what it found, and a cap hit shows only as an error toast.", show:"draft"},
  {id:"p6", t:"Gates only where mistakes are expensive", d:"A wrong address, a price in writing, a full mailbox, a never-contact creator, paying a creator before the brand pays. Those stop you, inline, with the fix next to them. Everything else is undoable instead of confirmed.", how:["Unconfirmed address: pick and confirm right on the draft","Price in an email: confirm the number","Creator payout locked until the brand pays"], was:"There is no confirmed state for an address at all; the payout reminder follows a typed date, not the brand's payment.", show:"gates"},
  {id:"p7", t:"Hands stay on the keyboard", d:"Every frequent action has a key, every key is shown where it applies, and single-letter keys never fire while you type.", how:["Ctrl K to find anything or run any command","J / K, Ctrl Enter, Z, H, O in Today; S, R, 1–4 in triage","? shows them all"], was:"No global search or command bar; the composer's action bar is 6 to 8 icons with tooltips only.", show:"cmdk"},
  {id:"p8", t:"Explain the machine", d:"Whenever the app decides something (a Gemini draft, a fit score, the order of Today, a match), it says why in one line, in plain words.", how:["\"Why this email\" with the house rules it followed","Fit score with its five parts","Every Today item has a reason"], was:"Steering knobs use engine jargon and \"not ready\" appears with no reason, although the reasons exist on the profile.", show:"fit"},
  {id:"p9", t:"The team sees the same truth", d:"Every record has an owner, hand-offs carry a note, presence shows who is looking, and overlapping work is caught before it happens.", how:["Owner chip on every record, reassign in one click","\"Omar is searching this keyword\" before you search it twice","\"Sara emailed this channel 4 months ago\" in triage"], was:"No owner on list rows or conversations, no \"mine\" filter, and the team scorecard exists only in development builds.", show:"owner"},
  {id:"p10", t:"Fast and calm", d:"Every click answers within a tenth of a second; slow work runs in the background with visible progress. One accent colour, status colours only for status, nothing moves unless it means something.", how:["Searches and email finding live in the jobs tray","No spinner replaces a loaded screen","No animation on keyboard actions"], was:"The whole Search screen rebuilds on every log flush; the app frame rebuilds about once a second for presence; profiles swap to a spinner when any channel changes.", show:"jobs"}
];

/* ---------- the 127 tasks: today's status → the Workbench answer ---------- */
var COV = {
  search:[["Paste many keywords at once, duplicates removed; Gemini suggestions inline; the bridge status shows in Setup health","in","search"],["Rules sit beside the keywords, always visible, edited inline","in","search"],["Same rules card; the 7-day archive is explained where rejects happen, with Bring back","in","search"],["Start, Pause and Resume in the header and the console; pause says it finishes the current keyword","in","search"],["Live panel plus a tray ring that follows you to other screens; only the panel redraws","in","jobs"],["Every run ends with a notification and a Review button that opens exactly what it found","in","triage"],["A teammate's live run is shown, and overlapping keywords are flagged and skipped","in","search"],["Platform on runs and creators; YouTube first, Instagram and TikTok when you decide","decide",null]],
  qualify:[["Review new opens on today's finds, gold mines first; rejected channels are hidden","in","triage"],["Gallery facets with counts, remembered, beside the cards instead of over them","in","gallery"],["Cards show the latest thumbnail, median views, uploads, top country, sponsors, email state, fit and stage","in","gallery"],["Peek panel: videos, numbers, audience, contact, fit reasons and notes, in tabs instead of one long page","in","peek"],["Sponsor names on cards and records; brands they sponsor are found automatically","in","gallery"],["S in triage, a button on every card, and the bulk bar","in","triage"],["R with reasons 1–4; the toast explains the 7-day archive and offers Undo","in","triage"],["Multi-select with shift-click and a bulk bar","in","gallery"],["Toolbox › Archive shows the countdown; Bring back keeps the history","in","toolbox"],["Owner on every card and record, assign in bulk, a Mine filter","in","owner"]],
  contacts:[["The email finder runs in the background after shortlisting and keeps updating the record","in","contacts"],["Every address found is listed with where it came from and how sure it is","in","contacts"],["An explicit Confirm step; drafts to unconfirmed addresses are blocked with Confirm right on the card","in","gates"],["The contact name is asked for at confirm time and used in the greeting","part","contacts"],["The Contacts tab and a Today bucket list everyone still waiting for one","in","contacts"]],
  cold:[["Approve emails in Today and the Waiting for you lane, with full counts","in","today-queue"],["Drafted automatically the moment a contact is confirmed, with one rule set, in the background","in","draft"],["Why this email, the house rules it followed, and gates inline","in","draft"],["Edit in place; Ctrl Enter to send; 10 seconds to undo","in","draft"],["A From picker on every draft with the mailbox's capacity","in","draft"],["Live meters per mailbox in Today and on every draft; warming and slowed tags","in","today-mail"],["Every card opens its record beside the list (O)","in","peek"],["One draft card everywhere, so the checks always run","in","draft"],["A contact channel per creator (email or DM); DM drafts ready to copy","decide",null]],
  followups:[["The Follow-ups due bucket","in","today-queue"],["Same card; after sending, the toast names the next follow-up date","in","draft"],["Send later: their morning, tomorrow, next Monday","in","draft"],["Sequences: every creator and every step on one timeline","in","sequences"],["Every notification opens the exact item","in","notifs"],["Park until a date; it comes back to Today by itself","in","park"],["Pitched brands get a nudge after 5 quiet days","part","brands"]],
  replies:[["A reply lands in Answer replies, the notification links to it, and the rail count moves","in","today-queue"],["Replies are read in the background; Paste a reply covers anything that slips","in","paste"],["Their message sits right above the draft, with Gemini's reading of it","in","ai-read"],["Drafted for you","in","draft"],["Rewrite chips on the card: Shorter, Warmer, More direct, New angle","in","steer"],["Gemini labels the intent; rate and audience save to the record in one click and move the stage","in","ai-read"],["Paste a reply by hand: a quiet link under every thread","in","paste"],["Stages move themselves: a reply stops the sequence; answering waits for them","in","nextcard"],["Snooze, Skip and Never contact in the card's menu","in","draft"]],
  mediakit:[["Facts from the reply save to the record and trigger the audience check","in","ai-read"],["Suggested next step on every reply, with a drafted ask","in","ai-read"],["The kit file is attached to the creator","part","audience"],["One place for audience numbers","in","audience"],["Past rates on the record and in pricing","in","peek"]],
  audience:[["Saved from the reply or the kit, never typed twice","in","ai-read"],["Checks your rule: US/UK/CA/AU leads the top 3, buying age, engagement 3%+, rate agreed","in","audience"],["One field for engagement","in","audience"],["Only signed creators reach the roster; failing ones are declined kindly or parked","in","roster"]],
  sign:[["A Signed stage and a Sign button when the check passes","in","audience"],["Signed per 1,000 emails against the benchmark of about 5","in","insights"],["The audience check is the signing checklist; an agreement file comes later","part","audience"],["Funnel from found to deals","in","insights"]],
  brands:[["Sponsors seen on your creators become Found brands automatically","in","brands"],["Add a brand inline","in","brands"],["Qualify: sells an AI tool, budget known, contact found; or set aside as not a fit","in","qualify"],["Brands board and Ctrl K search","in","brands"],["Agency facts in Toolbox","in","toolbox"],["Not a fit sets a brand aside and keeps it searchable","in","qualify"]],
  pitch:[["A pitch picker per brand, ranked by fit","in","pitch"],["Pick one or two from the roster, each with reasons","in","pitch"],["Match scores with reasons and clash warnings","in","match"],["Drafted with numbers and a price, behind the price gate","in","pitch"],["The pitch waits in Approve emails; the brand shows Pitched with the date","in","brands"],["The brand record has an Emails tab with the same draft card","in","peek"],["Brand threads everywhere: the record, Replies, the negotiation","in","inbox"]],
  negotiate:[["The negotiation sits beside the reply: the ladder and the draft together","in","ladder"],["A deal starts from the accepted pitch with the price from the creator's rate","plan",null],["Price, payout and margin on every deal","in","money"],["Exclusivity and usage rights on the Negotiate checklist","in","checklist"],["Offer and counter history under the ladder","in","ladder"],["Steps move only when their checklist is done; money order enforced","in","checklist"]],
  contracts:[["Ordered checklist: the creator signs before the agency","in","contracts"],["A Mirrored for the creator step; a template comes with file handling","part","contracts"],["Documents list beside the checklist","in","contracts"],["The last tick moves the deal to Brief","in","checklist"]],
  brief:[["A Brief step; the brief message itself comes next","part","checklist"],["Draft review checklist","in","checklist"],["Checked against the brief; a side-by-side view comes next","part","checklist"],["Brand approved, with a message to the brand next","part","checklist"]],
  prelive:[["Pre-live checklist","in","checklist"],["Test the tracking link from the step","in","checklist"],["Promo code item on the checklist","in","checklist"]],
  golive:[["The video link is saved on the deal; the date can be corrected","part","checklist"],["A go-live email drafted for the brand","plan",null],["Ticking Go-live moves the deal to Invoice and starts the money clock","in","checklist"]],
  invoice:[["Sent and paid on the money panel","in","money"],["Net 30 computed from the send date, with a countdown","in","money"],["An invoice ready to send on go-live day, Ctrl Enter","in","invoice"],["Deliver › Money: every unpaid invoice with its age","in","receivables"]],
  report:[["The report step lands in Today when due","in","today-queue"],["Views, clicks and click rate on the step","in","checklist"],["Send the 30-day report in one click","in","checklist"]],
  payout:[["Payout amount, method and state on the deal","in","money"],["The payout appears the moment the brand pays, and stays locked before","in","payout"],["Payables: everything owed to creators","in","receivables"]],
  nextdeal:[["The Next deal step lands in Today with the best creators for that brand","in","nextdeal"],["Draft the next pitch from the deal","in","nextdeal"],["The roster shows the best next brand per creator","in","roster"],["A brand's deals and results on its record","part","brands"],["A lost reason on deals","plan",null]],
  daily:[["Today: yours by default, the team view for you as owner, ordered by money","in","today-queue"],["Approve emails bucket and rail counts","in","today-queue"],["Review new opens the channels themselves, one at a time","in","triage"],["A 4-hour budget bar and mailbox meters; everything clickable","in","today-budget"],["Ctrl K finds anything by name","in","cmdk"],["Focus mode","in","focus"]],
  teamops:[["Roles and what each can see","in","team"],["Owner everywhere; hand off with a note","in","owner"],["Per-person load and results","in","team"],["The activity log on every record and in Toolbox","in","toolbox"],["Presence in the top bar and on records","in","peek"],["Role-based Today: VAs get finds, contacts and follow-ups","decide","team"],["Setup health and a first-week checklist","part","toolbox"]],
  mail:[["Mailboxes tab with connection warnings before they lapse","part","mailboxes"],["Cap stepper on each mailbox","in","mailboxes"],["Meters and tags on every draft and in Today","in","draft"],["Warm-up happens outside the app","out",null],["Bounce rate, inbox placement and an automatic slowdown","in","mailboxes"]]
};
var STEP_NAMES = {search:"Search",qualify:"Qualify",contacts:"Get contacts",cold:"Cold outreach",followups:"2–3 follow-ups",replies:"Replies",mediakit:"Media kits and rates",audience:"Confirm the audience",sign:"Sign creators",brands:"Find and qualify brands",pitch:"Pitch 1–2 creators",negotiate:"Negotiate",contracts:"Contracts",brief:"Brief and draft review",prelive:"Pre-live checks",golive:"Go-live email",invoice:"Invoice (Net 30)",report:"30-day report",payout:"Pay the creator",nextdeal:"Pitch the next deal",daily:"Daily to-do",teamops:"Team and VAs",mail:"Mailbox health"};
var STEP_PH = {search:"find",qualify:"find",contacts:"find",cold:"reach",followups:"reach",replies:"reach",mediakit:"reach",audience:"reach",sign:"close",brands:"close",pitch:"close",negotiate:"close",contracts:"close",brief:"deliver",prelive:"deliver",golive:"deliver",invoice:"deliver",report:"deliver",payout:"deliver",nextdeal:"deliver",daily:"team",teamops:"team",mail:"team"};
/* today's status per task, from the UI map of the Flutter app (18 Oct) */
var TODAY = {
  search:[["ok","Enter or generate keywords"],["buried","Set search filters"],["buried","Set the auto-clean rule"],["ok","Start, stop or resume a run"],["ok","Watch progress"],["missing","See what the run found"],["ok","Hand keywords to a teammate"],["missing","Search Instagram or TikTok"]],
  qualify:[["buried","Look at the newest finds first"],["partial","Filter by the qualifying signals"],["missing","See the signals on the list row"],["partial","Read the channel in depth"],["buried","Check sponsors already seen"],["buried","Shortlist a creator"],["buried","Reject a creator"],["missing","Qualify or reject many at once"],["buried","Bring a channel back from the archive"],["partial","Give a creator to a teammate"]],
  contacts:[["partial","Find the creator's email"],["ok","Save contacts and pick the primary one"],["missing","Confirm an address is the right one"],["partial","Record the person's name"],["buried","Get from the list to the contacts"]],
  cold:[["buried","See who is ready to be emailed"],["partial","Draft the first email"],["ok","Review why, lessons, checks and recipient"],["ok","Edit and send"],["missing","Choose which mailbox it goes from"],["partial","See the daily cap and warm-up before sending"],["missing","Open the creator or conversation from the card"],["ok","Email one creator directly"],["partial","Reach creators who only take DMs"]],
  followups:[["ok","Get the follow-up when it is due"],["ok","Draft and send it"],["buried","Schedule one by hand"],["partial","See every due follow-up in one place"],["missing","Open the thread from a reminder notification"],["partial","Stop after three and come back later"],["missing","Follow up with a brand"]],
  replies:[["partial","Know that a reply arrived"],["buried","Check for replies now"],["missing","Read the reply while writing the answer"],["ok","Draft the answer"],["buried","Correct how the engine read the situation"],["partial","Label the reply"],["ok","Log a reply that came another way"],["missing","Trust the conversation status"],["missing","Skip a creator for good, or snooze"]],
  mediakit:[["buried","Record the media kit and rates"],["partial","Ask the creator for it"],["partial","Keep the file they sent"],["partial","Keep other numbers they sent"],["ok","See past rates"]],
  audience:[["buried","Enter top countries, age band and engagement"],["ok","See pass or fail, with the reasons"],["partial","Record engagement"],["ok","List only creators who pass"]],
  sign:[["missing","Mark a creator as signed"],["partial","Count signed creators against the target"],["missing","Check a signing checklist"],["missing","See the funnel"]],
  brands:[["buried","Find brands already sponsoring your creators"],["ok","Create a brand"],["missing","Mark a brand as qualified, or tier it"],["missing","Search, sort or filter brands"],["ok","Check the boycott list"],["missing","Archive or delete a brand"]],
  pitch:[["buried","Make a shortlist for a brand"],["partial","Add creators to the shortlist"],["partial","See which creators are ready, and why not"],["ok","Draft the pitch"],["buried","Find the pitch afterwards"],["missing","Email a brand from its page"],["missing","Read the conversation with a brand"]],
  negotiate:[["partial","Write the negotiation replies"],["partial","Start a deal"],["ok","Record agreed price and payout"],["missing","Record exclusivity and usage rights"],["missing","Keep the offer and counter history"],["partial","Move the deal forward"]],
  contracts:[["ok","Track both contracts and the signing order"],["missing","Mirror the brand's contract for the creator"],["partial","Open the contract"],["missing","Have the deal stage follow the contracts"]],
  brief:[["missing","Send the creator the brief"],["buried","Log draft received and approved"],["missing","Check the draft against the brief"],["partial","Get and record the brand's approval"]],
  prelive:[["missing","Check links, placement and promo code"],["buried","Find the tracking link"],["missing","Record the promo code"]],
  golive:[["partial","Mark the video published with its link"],["missing","Email the brand the live link"],["missing","Move the deal to Live"]],
  invoice:[["ok","Mark the invoice sent and paid"],["missing","Get the due date from the terms"],["missing","Create or send the invoice"],["missing","See every unpaid invoice"]],
  report:[["ok","Know when it is due"],["partial","Read the views, CPM and clicks"],["missing","Send the report to the brand"]],
  payout:[["ok","Record payout due, paid, method and reference"],["missing","Get told to pay once the brand has paid"],["missing","See everything owed to creators"]],
  nextdeal:[["buried","Remind yourself to pitch the brand again"],["missing","Pitch the same brand its next creator"],["partial","Offer the same creator to another brand"],["missing","See a brand's results"],["missing","Record why a deal was lost"]],
  daily:[["partial","See my list for today"],["missing","See drafts waiting for my approval"],["partial","Review new finds"],["partial","Track the daily target"],["missing","Jump to a creator, brand or deal by name"],["missing","Run a focused work block"]],
  teamops:[["ok","Give someone basic or full access"],["partial","Assign work to a person"],["missing","See each person's results"],["buried","See what teammates did"],["partial","See who is working on what now"],["partial","Give a VA a working view"],["partial","Set up a new teammate's machine"]],
  mail:[["buried","Connect mailboxes"],["buried","Set the daily cap and warm-up date"],["missing","See mailbox health where you send"],["outside","Warm the mailbox up"],["missing","Watch bounces and spam placement"]]
};
var ST_LABEL = {ok:"Works", buried:"Buried", partial:"Partial", missing:"Missing", outside:"Outside the app"};
var PL_LABEL = {in:"In the prototype", part:"Partly shown", plan:"Planned", decide:"Your decision", out:"Outside the app"};

/* ---------- quality of life ---------- */
var QOL = [
  ["Everywhere","Command palette: find any creator, brand or deal, run any command","Must","in","cmdk"],
  ["Everywhere","Shortcut sheet (?), keys in tooltips and on main buttons","Must","in","shortcuts"],
  ["Everywhere","G then a letter jumps to a screen","Should","in","shortcuts"],
  ["Everywhere","Records open beside the list; Alt ↑ / ↓ walks the list","Must","in","peek"],
  ["Everywhere","Back and forward across screens, tabs and records","Should","in","rail"],
  ["Everywhere","Undo and redo for every change, plus Undo on every toast","Must","in","undo"],
  ["Everywhere","Undo send: 10 seconds to take an email back","Must","part","draft"],
  ["Everywhere","A bar names anything broken, on every screen, with the fix one click away","Must","in","problems"],
  ["Settings","Your picture opens your account: your name, Settings, appearance, shortcuts","Must","in","account"],
  ["Settings","Your real name and picture, from your account or set once","Must","in","account"],
  ["Settings","Find any setting with a search box or Ctrl K","Should","in","settings"],
  ["Settings","Each setting says who it affects: just you, this computer, the whole team","Should","in","settings"],
  ["Settings","Settings apply at once, say Saved in place, and undo with Ctrl Z","Must","in","settings"],
  ["Settings","Theme, density, text size and motion per computer","Should","in","settings"],
  ["Settings","Single-letter keys can be turned off for screen readers and dictation","Must","in","settings"],
  ["Settings","Choose which alerts reach the bell; problems always do","Should","in","settings"],
  ["Settings","Agency rules use the same editors as the screens that use them","Should","in","settings"],
  ["Records","The channel's YouTube banner on its record, cropped the way YouTube crops it","Should","in","banner"],
  ["Prototype","Prototype mode: the real app on an example copy; live data set aside untouched","Must","in","proto"],
  ["Prototype","Off means off: no buttons, pins, keys or bars from prototype mode anywhere","Must","in","proto"],
  ["Prototype","Scenarios: a normal Monday, a first day, a week later, something broke","Should","in","proto"],
  ["Prototype","See the app as a teammate before they start","Should","in","proto"],
  ["Prototype","Comment on anything: press C, click, write; pinned to that exact element","Must","in","proto"],
  ["Prototype","Every comment in one list, and one click copies the open ones for Claude","Must","in","proto"],
  ["Everywhere","Save status: Saving…, Saved, Offline with changes queued","Must","part","save"],
  ["Everywhere","Background jobs tray with progress","Must","in","jobs"],
  ["Everywhere","Notifications that open the exact item","Should","in","notifs"],
  ["Everywhere","Notes with @mentions on any record","Should","part","peek"],
  ["Everywhere","Recent records in the palette","Should","in","cmdk"],
  ["Everywhere","Tabs, filters, sort and scroll remembered per screen","Must","part","rail"],
  ["Everywhere","Light or dark, comfortable or compact","Should","in","cmdk"],
  ["Everywhere","Copy buttons on addresses and payment details","Should","in","draft"],
  ["Everywhere","Empty states that say what to do next","Must","in","today-queue"],
  ["Everywhere","Collapsible sidebar ([ key)","Could","in","rail"],
  ["Everywhere","Skeletons, never a spinner over a loaded screen","Must","plan",null],
  ["Everywhere","Direction-neutral layout, ready for Arabic later","Could","part",null],
  ["Today","One list across the business, closest to money first, each with a reason","Must","in","today-queue"],
  ["Today","Time estimates and a 4-hour budget","Must","in","today-budget"],
  ["Today","The next item opens when you finish one","Must","in","today-work"],
  ["Today","Focus mode: one item, progress, time left","Must","in","focus"],
  ["Today","Snooze presets: later today, tomorrow, Monday, two weeks","Must","in","today-work"],
  ["Today","Hand off with a note; it lands in their Today","Should","in","today-work"],
  ["Today","Quick wins and Late filters","Could","in","today-queue"],
  ["Today","Done today, with Undo on the latest","Must","in","today-queue"],
  ["Today","Wrap up: summary, move the rest to tomorrow, a note for the morning","Should","in","wrap"],
  ["Today","Team view: everyone's list and load","Should","in","team-today"],
  ["Today","Mailbox capacity at a glance","Must","in","today-mail"],
  ["Today","Due dates in plain words: \"2 days late\", \"tomorrow\"","Must","in","today-queue"],
  ["Find","Searches run in the background; the tray follows you","Must","in","jobs"],
  ["Find","Per-keyword yield, so weak keywords stand out","Should","in","search"],
  ["Find","Paste many keywords; duplicates removed; Gemini suggestions","Should","in","search"],
  ["Find","Warning before searching a keyword a teammate is running","Must","in","search"],
  ["Find","Every run ends with a link to what it found","Must","in","triage"],
  ["Find","Triage one channel at a time with its last 3 videos","Must","in","triage"],
  ["Find","S, R, 1–4 and arrows in triage; no animation on keys","Must","in","triage"],
  ["Find","Fit score with its reasons","Should","in","fit"],
  ["Find","\"Sara emailed this channel 4 months ago\" guard","Must","in","triage"],
  ["Find","Gallery with facet counts, saved views and card sizes","Must","in","gallery"],
  ["Find","Hover a thumbnail to flip through the last 3 videos","Should","in","gallery"],
  ["Find","Shift-click multi-select and a bulk bar","Must","in","gallery"],
  ["Find","Compare 2–4 channels side by side","Should","in","gallery"],
  ["Find","Email finder after shortlisting, with source and confidence","Must","in","contacts"],
  ["Find","Confirm all addresses that are 90%+ sure in one click","Should","in","contacts"],
  ["Find","Never-contact list honoured everywhere","Must","in","toolbox"],
  ["Reach","One draft card everywhere: To, From, When, Why, gates, rewrite","Must","in","draft"],
  ["Reach","Send later, in their morning","Should","in","draft"],
  ["Reach","Mailbox picker with capacity and warm-up on every send","Must","in","draft"],
  ["Reach","Rewrite chips instead of a hidden Redo","Should","in","steer"],
  ["Reach","Sequence timeline for every creator","Must","in","sequences"],
  ["Reach","Gemini's reading of each reply: intent, summary, facts","Must","in","ai-read"],
  ["Reach","Save rate and audience from a reply in one click","Must","in","ai-read"],
  ["Reach","Paste a reply by hand, small and quiet","Must","in","paste"],
  ["Reach","A reply stops the sequence by itself","Must","in","sequences"],
  ["Reach","Park until a date (\"ping me in January\")","Should","in","park"],
  ["Reach","Automatic slowdown when bounces pass 3%","Must","in","mailboxes"],
  ["Reach","Replies inbox with intent filters","Should","in","inbox"],
  ["Close","Audience check with your exact rule","Must","in","audience"],
  ["Close","Decline kindly or park creators who fail","Should","in","audience"],
  ["Close","Roster with rates, load and best next brand","Should","in","roster"],
  ["Close","Match grid: brands × creators with clashes","Should","in","match"],
  ["Close","Pitch picker: 1–2 creators ranked with reasons","Must","in","pitch"],
  ["Close","Price gate on any email that names a price","Must","in","gates"],
  ["Close","Negotiation ladder: rate, floor, offer, ask, margin","Must","in","ladder"],
  ["Close","Contracts in order: the creator signs first","Must","in","contracts"],
  ["Close","Brand qualification: AI tool, budget, contact","Must","in","qualify"],
  ["Deliver","Deal board by step with due dates and progress","Must","in","dealboard"],
  ["Deliver","Checklists that move the deal when done","Must","in","checklist"],
  ["Deliver","Invoice on go-live day with a Net 30 countdown","Must","in","invoice"],
  ["Deliver","Payment reminders drafted for you","Should","in","money"],
  ["Deliver","Creator payout locked until the brand pays, then prompted","Must","in","payout"],
  ["Deliver","30-day report numbers on the step, one-click send","Should","in","checklist"],
  ["Deliver","Next deal suggested with the best creators","Should","in","nextdeal"],
  ["Deliver","Money: receivables and payables with their age","Must","in","receivables"],
  ["Team","Owner on every record; reassign in one click","Must","in","owner"],
  ["Team","Presence: who is looking at this record","Should","in","peek"],
  ["Team","Workload and rebalance","Should","in","team"],
  ["Team","Roles: what VAs can see and do","Must","decide","team"],
  ["Team","Activity log on every record and in Toolbox","Should","in","toolbox"],
  ["Team","First-week checklist and a practice mode for new VAs","Should","plan",null],
  ["Speed","Every click answers within 100 ms; slow work goes to the background","Must","plan","speed"],
  ["Speed","Lists draw only what is on screen","Must","plan","speed"],
  ["Speed","One query per screen, not one per row","Must","plan","speed"],
  ["Speed","The frame does not rebuild when presence or sync ticks","Must","plan","speed"],
  ["Speed","Screens you leave stop working","Must","plan","speed"],
  ["Speed","Database work off the drawing thread","Must","plan","speed"]
];

var FEEDBACK = [
  ["Send an email","The card leaves and the next item opens. Toast: \"Sent to Ines from outreach1. Follow-up 1 is planned for Thu 22 Oct.\"","Today count −1, mailbox meter +1, a new dot on the sequence","Undo for 10 s, or Ctrl Z"],
  ["Shortlist in triage","The next channel appears at once; the tally counts up","Confirm contacts; the tray shows \"Finding emails\", then \"2 emails found\"","Undo on the toast"],
  ["Reject","Toast names the reason and the 7-day archive","Toolbox › Archive","Undo, or Bring back for 7 days"],
  ["Confirm an address","The gate turns green; toast: \"Gemini drafted the first email\" with Review","Approve emails","Undo"],
  ["Save a fact from a reply","The chip says Saved; with rate and audience in, the stage moves to Media kit","The record and the audience check","Undo"],
  ["Tick a checklist item","The box fills; the last tick says \"Contracts done, moved to Brief\"","The next column of the deal board","Untick or Undo"],
  ["Send an invoice","Toast with the due date","Money › receivables; back in Today 3 days before it is due","Undo"],
  ["Mark the brand paid","The lock on the creator payout opens","Get paid: \"Pay The AI Desk $1,500\"","Undo"],
  ["Snooze","\"Back tomorrow at 09:00\"","The Snoozed list at the bottom of the queue","Bring back now"],
  ["Hand off","The owner chip changes; toast quotes your note","Their Today","Undo"],
  ["Start a search","The tray ring fills; the log runs","New finds in Review new; a notification when it stops","Pause"],
  ["Rewrite an email","The text shimmers while Gemini writes, then changes","Same card","Undo brings the old text back"],
  ["Make a mistake","A message beside the field says what is wrong and how to fix it","Nowhere else","Nothing to undo"],
  ["Any change","Top bar: Saving…, then Saved","Synced to the team","Ctrl Z"]
];

var CAUSES = [
  ["The app frame watches about 15 live sources, and teammate presence updates about once a second, so the whole frame rebuilds constantly","The frame listens only to what it shows; presence redraws only the avatars"],
  ["Every section stays alive in the background (Roster builds all three of its lists at once)","Screens you leave stop working and resume where you were"],
  ["My Day, the Comms queue, deals and conversations run one query per row","One query per screen, shaped for that screen"],
  ["The creator list queries on the drawing thread and re-reads every loaded row after any change","Database work off the drawing thread; only changed rows redraw"],
  ["Profiles build in one go and swap to a spinner when any channel changes anywhere","Records load in parts; a loaded screen never turns back into a spinner"],
  ["A new Python process starts for each Gmail status check","One long-running helper process for mail"],
  ["Heavy work at startup before anything shows","Today draws from the local copy first; sync catches up after"]
];

var ROADMAP = [
  ["1","Agree the design","This prototype. Settle the open questions below; mark anything that should change.","The plan and prototype approved"],
  ["2","Choose the stack","Rebuild in the new languages. Recommendation: Electron + React + TypeScript; the Python pipeline and Supabase stay.","Stack confirmed"],
  ["3","Foundation","Data layer (local copy, team sync, conflict handling) behind one switch for live or example data, the Python bridge, app frame, palette, peek, undo, toasts, jobs tray, Settings, the speed rules from day one, and prototype mode with the comment tool, so every later step is designed and checked on example data first.","Opens in under 2 s; every click under 100 ms; prototype mode off leaves no trace"],
  ["4","Today","The next-action engine, buckets, work panels for replies, sends and follow-ups, focus mode, wrap up.","A full day of outreach worked from Today alone"],
  ["5","Find","Search console in the background, triage, gallery, contacts and the email finder.","From a keyword to a confirmed contact without leaving Find"],
  ["6","Reach","Draft card, mailboxes, sequences, replies with Gemini's reading and the paste fallback.","Every send, follow-up and reply from one card"],
  ["7","Close","Audience check, roster, brands, match, pitch, negotiation ladder, contracts.","A creator signed and pitched with no side spreadsheets"],
  ["8","Deliver","Deal board, checklists, invoices with Net 30, payouts locked to payment, reports, next deal.","A deal from contract to the next pitch inside the app"],
  ["9","Insights, Toolbox, Team","Analytics with drill-downs, tools, roles, hand-offs, rebalancing.","Owner sees results and load without asking anyone"],
  ["10","Check it 100%","Walk the new app against today's app and this plan, item by item: the 127 tasks, the quality-of-life list, the feedback map. Nothing ships with a gap.","Every row green, with a note where a decision changed it"],
  ["11","Clean the repo, last","Only after step 10 passes: remove stale and unused files (for example the migrate v2 .sql and .env.example), merge overlapping docs, delete what the old app needed and the new one does not.","A lean repo and a list of what was removed"]
];

var QUESTIONS = [
  "Should VAs see money (invoices, payouts, margins)? The prototype assumes no.",
  "One 4-hour budget for everyone, or set per person?",
  "Which emails need a second pair of eyes: prices above an amount, first emails from a new VA?",
  "When do Instagram and TikTok come in, and are DMs drafted like emails?",
  "Invoices: sent from the app as a PDF, or from an accounting tool and only tracked here?",
  "Contracts: files kept in the app with a mirrored template, or a link to an e-signature service?",
  "Reply reading: which mailboxes may the app read, and how long are messages kept?",
  "The rebuild stack: confirm Electron + React + TypeScript before step 3.",
  "Prototype comments: kept as a file in the repo that Claude reads, or in the team database?",
  "Prototype mode: owner only, or also for training new VAs on example data?"
];

/* ---------- "show me": go to the place and light it up ---------- */
var SHOW = {
  "today-queue":{go:["today"], why:"today-queue"}, "today-budget":{go:["today"], why:"today-budget"}, "today-mail":{go:["today"], why:"today-mail"},
  "today-work":{go:["today"], sel:"reply:q1", why:"today-work"}, "team-today":{go:["today"], team:true, why:"today-queue"},
  focus:{go:["today"], focus:true, why:"focus"}, wrap:{go:["today"], wrap:true},
  draft:{go:["today"], sel:"reply:q1", why:"draft"}, gates:{go:["today"], sel:"send:q3", why:"gates"}, steer:{go:["today"], sel:"reply:q1", why:"steer"},
  "ai-read":{go:["today"], sel:"reply:q9", why:"ai-read"}, paste:{go:["today"], sel:"reply:q1", why:"paste"}, park:{go:["today"], sel:"reply:q10", why:"ai-read"},
  ladder:{go:["today"], sel:"reply:q2", why:"ladder"}, checklist:{go:["today"], sel:"deal:d1", why:"checklist"}, money:{go:["today"], sel:"collect:d4", why:"money"},
  invoice:{go:["today"], sel:"invoice:d3", why:"invoice"}, payout:{go:["today"], sel:"payout:d6", why:"money"}, nextdeal:{go:["today"], sel:"deal:d8", why:"checklist"},
  audience:{go:["today"], sel:"audience:c7", why:"audience"}, qualify:{go:["today"], sel:"qualify:b6", why:"qualify"},
  triage:{go:["find","triage"], why:"triage"}, fit:{go:["find","triage"], why:"fit"}, gallery:{go:["find","gallery"], why:"gallery"}, search:{go:["find","search"], why:"search"},
  contacts:{go:["find","contacts"], why:"contacts"}, jobs:{go:["find","search"], why:"jobs"},
  sequences:{go:["reach","sequences"], why:"reach-sequences"}, inbox:{go:["reach","inbox"], why:"reach-inbox"}, mailboxes:{go:["reach","mailboxes"], why:"reach-mailboxes"},
  roster:{go:["close","roster"], why:"roster"}, brands:{go:["close","brands"], why:"brand-board"}, match:{go:["close","match"], why:"match-grid"}, pitch:{go:["close","pitch"], why:"pitch"}, contracts:{go:["close","contracts"], why:"documents"},
  dealboard:{go:["deliver","board"], why:"dealboard"}, receivables:{go:["deliver","money"], why:"receivables"},
  insights:{go:["insights"], why:"insights"}, charts:{go:["insights"], why:"chart-countries"}, payables:{go:["deliver","money"], why:"payables"}, roles:{go:["team"], why:"roles"}, "reach-board":{go:["reach","board"], why:"reach-board"}, toolbox:{go:["toolbox"], why:"toolbox"}, team:{go:["team"], why:"team"},
  peek:{go:["today"], peek:["creator","c6"], why:"peek"}, nextcard:{go:["today"], peek:["creator","c7"], why:"nextcard"}, owner:{go:["today"], peek:["creator","c6"], why:"owner"},
  cmdk:{go:["today"], palette:true}, shortcuts:{go:["today"], shortcuts:true}, notifs:{go:["today"], tray:"notifs"}, undo:{go:["today"], why:"today-queue"},
  save:{go:["today"], why:"save"}, rail:{go:["today"], why:"rail"}, speed:{go:["plan"], anchor:"speed"},
  account:{go:["today"], why:"account"}, settings:{go:["settings","profile"], why:"settings"}, proto:{go:["settings","prototype"], why:"settings"}, banner:{go:["close","roster"], peek:["creator","c1"], why:"banner"}, problems:{go:["settings","connections"], why:"settings"}
};
W.showMe = function(key){
  var s = SHOW[key]; if (!s) return;
  if (s.anchor){ var a = document.getElementById("plan-" + s.anchor); if (a) a.scrollIntoView({behavior:"smooth", block:"start"}); return; }
  W.ui(function(u){ u.palette = !!s.palette; u.shortcuts = !!s.shortcuts; u.tray = s.tray || null; u.focus = !!s.focus; u.wrap = !!s.wrap; u.menu = null;
    if (s.sel || s.go[0] === "today"){ u.todayScope = s.team ? "team" : "me"; u.todayFilter = "all"; u.collapsed = {}; if (s.sel) u.todaySel = s.sel; } });
  W.go(s.go[0], s.go[1] || (W.SCREENS[s.go[0]].tabs ? W.SCREENS[s.go[0]].tabs[0][0] : null));
  if (s.peek) W.peek(s.peek[0], s.peek[1]);
  setTimeout(function(){
    if (s.why) W.ui(function(u){ u.why = true; u.whyOpen = s.why; });
    var el = s.why && document.querySelector('[data-why="' + s.why + '"]');
    if (el){ el.scrollIntoView({block:"center", behavior:"smooth"}); el.classList.add("flash-target"); setTimeout(function(){ el.classList.remove("flash-target"); }, 1700); }
  }, 260);
};

/* ---------- the Why notes ---------- */
W.WHY = {
  rail:{t:"The rail is the IMA framework", d:"Today, then the four phases in the order the money flows: Find, Reach, Close, Deliver. Each shows how many things wait for you there.", y:"You always know where you are in the journey and where work is piling up, without opening anything.", was:"The sidebar mixes phases with tools; Roster is a sidebar item, a section and a stage at once.", p:["p1","p2"]},
  cmdk:{t:"One box to find anything", d:"Ctrl K finds any creator, brand or deal by name, handle or email, jumps to any screen, and runs commands like Start focus or Resume the search.", y:"With hundreds of channels, typing three letters beats any menu.", was:"No global search; the Search item is the channel finder.", p:["p7","p4"]},
  jobs:{t:"Background work you can see", d:"Searches and email finding run here with a progress ring. You keep working anywhere and get a note when each finishes.", y:"Slow work never blocks you, and you never wonder whether it is still running.", was:"A run ends with \"Run complete\" and no link to what it found; the Search screen rebuilds on every log line.", p:["p10","p5"]},
  save:{t:"Saved, always", d:"Every change saves locally at once and then syncs to the team. This says which state you are in, and would say Offline with queued changes.", y:"Trust: you never need a Save button or wonder whether a teammate sees your change.", was:"Sync state shows only as a pill; Gmail trouble only as a dot on Settings.", p:["p5","p9"]},
  "today-budget":{t:"Your 4 hours, planned", d:"Each item carries an estimate. The bar shows how the day splits by kind of work, what is done, and what is still free.", y:"The framework's daily to-do is about four focused hours; this shows whether today fits before you start.", was:"Home tiles show counts that cannot be clicked, with no sense of time.", p:["p1"]},
  "today-mail":{t:"Sending capacity at a glance", d:"How many sends each mailbox has left today, with warm-up and slowdown states.", y:"Approving 30 emails when only 12 can go out wastes the morning.", was:"The cap counts the first mailbox only and goes stale after sends.", p:["p6"]},
  "today-queue":{t:"One list, closest to money first", d:"Get paid, deal steps, replies, emails to approve, follow-ups, signing and pitching, contacts, new finds. Each item has an estimate and a due chip; bolts mark quick wins.", y:"The order itself is advice: money already earned is never buried under 40 follow-ups.", was:"Home shows unassigned work as everyone's, has no approvals count, and four places disagree about follow-ups.", p:["p1","p2"]},
  "today-work":{t:"Exactly what this item needs", d:"The panel shows only what the selected item needs to be finished: the message and the draft, the checklist, the invoice. Snooze, hand off and the record are one key away.", y:"No hunting through a profile for the 7th card. Finish, and the next item opens.", was:"The Comms card shows the draft, not the message being answered, and cannot open the creator.", p:["p3","p4"]},
  focus:{t:"Focus: one thing at a time", d:"Hides the list and everything else. Shows where you are, how much is left and for how long you have been at it. J and K move; Esc leaves.", y:"Volume work feels lighter when you only ever see the next thing.", was:"No focused work block exists.", p:["p3","p7"]},
  draft:{t:"One draft card, everywhere", d:"To (with confirmed state), From (with capacity), Why (with the house rules it followed), the editable text, gates, rewrite chips, Send or Send later.", y:"The same card in Today, records and the inbox means the checks always run and you learn it once.", was:"Three ways to draft with two sets of rules; no mailbox picker, so with two mailboxes every send fails as ambiguous.", p:["p5","p6","p8"]},
  gates:{t:"Stops only where mistakes cost money", d:"An unconfirmed address, a price in writing, a slowed mailbox. The fix sits right in the warning: pick the address and confirm it here.", y:"A wrong address burns a mailbox; a wrong price burns a deal. Everything else is undoable instead.", was:"No confirmed state for an address exists; the queue warns but nothing lets you confirm.", p:["p6"]},
  steer:{t:"Rewrite in one click", d:"Shorter, warmer, more direct, or a new angle. Gemini rewrites in place; Undo brings the old text back.", y:"Steering should feel like editing, not configuring an engine.", was:"Steering exists only behind Redo, with knobs in engine jargon.", p:["p8"]},
  "ai-read":{t:"Gemini's reading of the reply", d:"Intent, a one-line summary, and the facts in it (rate, countries, age) with Save to record. Saving rate and audience moves the creator to Media kit by itself.", y:"Facts typed twice drift apart. Read once, save once, and the stage follows.", was:"Labelling a reply changes nothing else; media-kit numbers live seven cards down the profile.", p:["p8","p2"]},
  paste:{t:"Paste a reply by hand", d:"A small link under every thread. Paste the text and Gemini reads it like any other reply; the sequence stops and a draft answer appears.", y:"Replies are read automatically, but mail fails sometimes and people reply on other channels.", was:"Logging a reply works, but replies are not visible while you answer.", p:["p6"]},
  triage:{t:"Triage, one channel at a time", d:"The last three videos, the numbers that decide, the audience, and guards (a teammate already emailed them, Shorts-only). S shortlists, R rejects with the chosen reason, 1–4 pick a reason, arrows move.", y:"A decision every 20–30 seconds with no mouse and no profile to scroll.", was:"Shortlist and reject are right-click only; reject has no button at all; no multi-select.", p:["p3","p7"]},
  fit:{t:"A score with its reasons", d:"Fit out of 100 from median views, posting, US/UK/CA/AU audience, engagement and past sponsors. Hover or open it to see each part.", y:"A bare number gets ignored or blindly trusted. Reasons get used.", was:"Readiness says \"not ready\" with no reason.", p:["p8"]},
  peek:{t:"Records open beside the list", d:"The record slides in on the right. Alt ↑ and Alt ↓ walk the list without closing it; Full page opens it on its own.", y:"Context switching is the hidden cost of a CRM. You never lose the list you were working through.", was:"Opening a profile leaves the list; the conversation history sits under the selected row and disappears in narrow layouts.", p:["p4"]},
  nextcard:{t:"The next step, on every record", d:"What moves this creator, brand or deal forward, why, and a Do it button that opens the right item in Today.", y:"Nobody has to remember where a creator is up to.", was:"No Signed stage; conversation status never moves on its own.", p:["p2"]},
  owner:{t:"Who has it", d:"Every record shows its owner. One click hands it to someone else; their Today picks it up.", y:"Work without an owner is nobody's work.", was:"No owner on list rows or conversations, and no Mine filter.", p:["p9"]},
  checklist:{t:"Checklists move the deal", d:"Each step has its checklist. Steps that must run in order lock until the one above is done; the last tick moves the deal on and says where it went.", y:"Any jump allowed means steps get skipped. The checklist is the stage.", was:"Any stage jump is allowed (Live with no contract, Closed while unpaid) and nothing moves on its own.", p:["p2","p6"]},
  money:{t:"Money in the right order", d:"What the brand pays, what the creator gets, the margin; the invoice with its Net 30 clock; the creator payout locked until the brand pays, then unlocked and prompted.", y:"Paying creators from money not yet received is the one mistake an agency cannot afford.", was:"Payment terms are free text; payouts follow a date someone typed, not the brand's payment.", p:["p6"]},
  invoice:{t:"Invoice on go-live day", d:"The invoice is ready with the amount and the due date computed from today. Ctrl Enter sends it; a reminder comes back 3 days before it is due.", y:"Every day late sending is a day later you are paid.", was:"No invoice can be created or sent; nothing computes Net 30.", p:["p1","p6"]},
  ladder:{t:"The negotiation, on one line", d:"The creator's rate, your margin floor, their offer and your ask on one scale. Slide to a counter and see the margin before you write it; the history sits below.", y:"Negotiating in your head is how margins leak.", was:"No negotiation view: offers, counters and the brand's side are not shown together.", p:["p3","p8"]},
  audience:{t:"Your rule, checked", d:"US/UK/CA/AU leads the top 3, buying age, engagement 3%+, rate agreed. Pass signs; fail declines kindly or parks; missing asks for it.", y:"The check enforces the framework's rule, not a different one.", was:"The app checks \"20% in US/UK/CA\" and ignores Australia.", p:["p6","p2"]},
  qualify:{t:"Qualify a brand in a minute", d:"Sells an AI tool your creators use, budget known, contact found. Look on their site fills the contact; Qualified moves it to pitching.", y:"Brands are only worth a pitch with a person and a budget.", was:"No way to mark a brand qualified; no search or sort for brands.", p:["p2"]},
  search:{t:"The search console", d:"Keywords with their yield, rules always visible, a live log and counters, teammates' runs, and every past run with Review results.", y:"Your search tool, kept, with the missing link from a finished run to its results.", was:"Settings sit behind an icon labelled with the auto-clean summary; a run never hands you its results.", p:["p10","p5"]},
  gallery:{t:"The gallery", d:"Channels as their latest thumbnails. Facets with counts, saved views, sizes, hover to flip through the last three videos, multi-select and compare.", y:"Judging a channel by its videos is fastest by eye. This keeps your favourite view and adds the filters it lacked.", was:"No filter for gold mine, niche or cadence; filters reset every session; the filter sheet hides the list.", p:["p3","p4"]},
  "gallery-facets":{t:"Filters with counts, beside the cards", d:"Stage, signals, top-3 countries, views, uploads, owner and which run found them. Every option shows how many channels it would leave, and the cards stay in view while you filter.", y:"Counts stop dead-end filtering; keeping the list visible keeps your place.", was:"The filter sheet is modal, so the list is hidden while you filter, and filters reset every session.", p:["p4","p8"]},
  compare:{t:"Compare side by side", d:"Pick two to four channels and see them in columns, the best value in each row in green, with Shortlist right there.", y:"Choosing between similar channels is a comparison, not a memory test.", was:"No way to see two channels at once.", p:["p3"]},
  contacts:{t:"Contacts, confirmed", d:"Every address found, where it came from and how sure it is. Confirm one, type one, or confirm every 90%+ address at once.", y:"Confirming before the first email protects the mailboxes.", was:"Scan reads only the channel description, and no confirmed state exists.", p:["p6"]},
  "reach-sequences":{t:"Every sequence on one timeline", d:"Each creator's first email, follow-ups and reply as dots across the days, today marked.", y:"Follow-ups were split over four places that disagreed.", was:"Four places show follow-ups and \"Upcoming reminders\" cannot be clicked.", p:["p1","p2"]},
  "reach-inbox":{t:"Replies, sorted by what they mean", d:"Filter by intent; read the message and answer it in the same place, creators and brands alike.", y:"\"Interested\", \"not now\" and \"what's your price\" need different next steps.", was:"Brand threads are left out of the conversation list.", p:["p8"]},
  "reach-mailboxes":{t:"Mailbox health where you send", d:"Sends, warm-up, bounces, inbox placement; the cap per mailbox; an automatic slowdown when bounces pass 3%.", y:"A burned mailbox costs weeks of warm-up.", was:"No warm-up warning in Outreach; bounces and placement are not watched.", p:["p6","p10"]},
  roster:{t:"The roster", d:"Signed creators with their rate, audience, live deals and the best next brand for each.", y:"Signed creators are inventory; this shows what to sell next.", was:"No Signed stage; ready-to-pitch is counted instead.", p:["p2"]},
  "brand-board":{t:"Brands as a pipeline", d:"Found, qualified, pitched, negotiating, won, each card with its next step.", y:"Brands get the same next-step treatment as creators.", was:"No qualify state, no search, no sort.", p:["p2"]},
  "match-grid":{t:"Who fits whom", d:"Every qualified brand against every signed creator: a fit score with reasons, and clashes with live deals flagged. Click a cell to start the pitch.", y:"The best pitch is the one that fits; the grid makes it obvious.", was:"\"Not ready\" with no reason; readiness ignores the brand's country.", p:["p8","p3"]},
  pitch:{t:"Pitch one or two", d:"Signed creators ranked for this brand with reasons and warnings; pick one or two; the pitch drafts with numbers and a price.", y:"The framework says 1–2 creators per brand. The picker enforces it.", was:"The pitch exists four clicks deep and needs a campaign first.", p:["p3"]},
  documents:{t:"Contracts in order", d:"The brand's contract, the mirrored creator version, the creator's signature, then the agency's.", y:"The creator signs first so the agency is never committed alone.", was:"Order is enforced, but the deal stage does not follow the contracts.", p:["p6"]},
  dealboard:{t:"Every deal by step", d:"Ten columns from negotiate to next deal, with due dates, owners and checklist progress.", y:"Where every deal stands, at a glance.", was:"Deal pages have 11 sections; the draft log is the 9th.", p:["p2"]},
  receivables:{t:"Money owed, both ways", d:"Invoices with their Net 30 age and payouts with their lock state, with the next action on each row.", y:"Cash flow is the agency's oxygen.", was:"Release builds have no list of unpaid invoices.", p:["p6","p1"]},
  "reach-board":{t:"Every conversation by stage", d:"Six lanes from to-draft to signed. Each card has its next step and a one-click action; brands sit beside creators.", y:"The whole outreach funnel in one look, and every card is one click from done.", was:"The queue is a hidden view of Outreach that shows at most 20 creators, with no count of the rest.", p:["p2","p1"]},
  "kit-check":{t:"Audience checks first", d:"Creators whose media kit arrived wait here with the check against your rule, ready to sign or decline.", y:"Signing is the step that turns emails into inventory; nothing should wait behind the roster.", was:"The audience fields sit in the same dialog as the media kit, seven cards down the profile.", p:["p2","p6"]},
  "match-filters":{t:"Choose which brands to match", d:"Filter the grid by brand status and sort by best fit or name.", y:"Qualified brands need a pitch now; won brands need the next one.", was:"Campaigns can only be reached through a brand, one at a time.", p:["p4"]},
  "match-pairs":{t:"The strongest pairings, ready to pitch", d:"The best creator for each brand with no warning and no live deal between them, each with a Pitch button.", y:"The grid shows everything; this tells you what to do with it.", was:"No pitch suggestions anywhere.", p:["p8","p1"]},
  "pitch-waiting":{t:"Pitches waiting and sent", d:"Drafted pitches waiting for your Send, and pitches already out with their date.", y:"A pitch drafted and forgotten is worse than none.", was:"No link in the toast, and the campaign never shows which creators were pitched.", p:["p5"]},
  payables:{t:"Creator payouts, in the right order", d:"Every payout with its state: locked until the brand pays, ready, or paid. Pay from the row.", y:"Creators are paid from money already received, and quickly once it is.", was:"Payouts follow a date someone typed in, and nothing lists what is owed.", p:["p6"]},
  roles:{t:"Who can do what", d:"What the owner, an account manager and a VA can see and change, with the open decision about money marked.", y:"Scaling to VAs needs the rules written where everyone can see them.", was:"Access levels exist; a VA's working view still shows outreach items they cannot act on.", p:["p9"]},
  "chart-line":{t:"Sends and replies, day by day", d:"Two panels on the same days, each with its own scale so small reply numbers stay readable; hover for the exact day.", y:"Reply rate trends tell you when a keyword set or an opening line stopped working.", was:"The team scorecard exists only in development builds.", p:["p8"]},
  "chart-funnel":{t:"Where channels drop out", d:"Found, shortlisted, emailed, replied, signed, in a deal. Each bar opens those channels in the gallery.", y:"The weakest step is where the next hour of work pays most.", was:"No funnel anywhere in the team's builds.", p:["p8"]},
  "chart-hist":{t:"What your finds look like", d:"How many channels sit at each level of median views. Click a bar to see them in the gallery.", y:"Shows whether the search rules are too loose or too tight.", was:"Channel analytics exist, but nothing leads from a number to the channels behind it.", p:["p8"]},
  "chart-countries":{t:"Audience countries, with a way in", d:"How many channels have each country in their top 3. Click a bar and the gallery opens filtered to it.", y:"Numbers should end in an action, not a screenshot.", was:"Channel analytics cannot be drilled into.", p:["p8"]},
  "chart-rev":{t:"Revenue by month", d:"What brands paid the agency over six months, the current month still running.", y:"The one number the business lives on, without a spreadsheet.", was:"Release builds have no list of unpaid invoices, let alone revenue.", p:["p1"]},
  insights:{t:"Analytics that lead somewhere", d:"Sends, replies, the funnel, revenue, keyword yield and channel analytics. Bars drill into the gallery with the filter applied.", y:"Numbers should end in an action, not a screenshot.", was:"The team scorecard exists only in development builds.", p:["p8"]},
  toolbox:{t:"Tools, folded away", d:"Calculator, archive, never-contact list, scheduled emails, activity log, house rules, agency facts and setup health.", y:"Rarely used tools stay one click away without crowding the daily screens.", was:"Setup lives in Settings with a red dot as the only warning.", p:["p10"]},
  account:{t:"You, one click away", d:"Your picture at the foot of the sidebar opens your account: your name, Settings, appearance, shortcuts, what reaches the bell and connections. Collapsed, the sidebar keeps just the picture.", y:"People look for settings behind their own picture first, so that is where they are.", was:"Settings is a sidebar item; setup problems show only as a red dot.", p:["p4","p10"]},
  settings:{t:"One home for how the app behaves", d:"Every setting says what it changes and for whom: just you, this computer, or the whole team. Changes apply at once, say Saved in place and undo with Ctrl Z. A search box and Ctrl K find any of them; agency rules use the same editors as the screens that use them.", y:"Settings you can't find, or can't tell who they affect, stay on the wrong value for months.", was:"Settings mixes setup, rules and preferences on one page; a red dot is the only sign something needs fixing.", p:["p5","p10"]},
  proto:{t:"Prototype mode, owner only", d:"The real app on an example copy: pick a scenario, see it as a teammate, comment on anything. Your live data is set aside and comes back exactly as it was; nothing is sent while it is on. Off, it leaves no trace.", y:"You can design and check any state of the app without waiting for it to happen and without touching the real pipeline.", was:"Trying a change means using real data, or a separate mock that drifts from the app.", p:["p8"]},
  banner:{t:"The channel, as its audience sees it", d:"The channel's YouTube banner heads its record, cropped the way YouTube crops it: the full band on a wide page, the safe middle in the side panel.", y:"A banner tells you a channel's style and seriousness at a glance, before any number.", was:"Profiles show the avatar and numbers only.", p:["p2"]},
  problems:{t:"Problems can't hide", d:"When something behind the app breaks (a mailbox signed out, the Gemini bridge down, a search stopped) a bar names it on every screen with the fix one click away. It leaves when the problem does.", y:"A red dot on a settings screen gets missed for days while emails quietly don't send.", was:"Setup problems show as a red dot on Settings.", p:["p5","p10"]},
  team:{t:"The team", d:"Who is online, what each person is doing, their load against 4 hours, hand-offs and roles.", y:"Scaling to VAs needs visible load and clear roles.", was:"No per-person results in the team's builds; assigning is partial.", p:["p9"]}
};

/* ---------- the Why layer ---------- */
W.WhyLayer = function(){
  var st = W.useApp(), u = st.ui;
  var pins = useState([]), hover = useState(null);
  useEffect(function(){
    var raf = 0;
    function measure(){
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(function(){
        var seen = {}, out = [];
        Array.prototype.forEach.call(document.querySelectorAll("[data-why]"), function(el){
          var k = el.getAttribute("data-why"); if (seen[k] || !W.WHY[k]) return;
          var r = el.getBoundingClientRect(); if (r.width < 8 || r.height < 8 || r.bottom < 60 || r.top > window.innerHeight - 10) return;
          seen[k] = 1; out.push({k:k, x:r.right, y:r.top, w:r.width, h:r.height, l:r.left});
        });
        pins[1](out);
      });
    }
    measure();
    var iv = setInterval(measure, 500);
    window.addEventListener("scroll", measure, true); window.addEventListener("resize", measure);
    return function(){ clearInterval(iv); window.removeEventListener("scroll", measure, true); window.removeEventListener("resize", measure); cancelAnimationFrame(raf); };
  }, []);
  var list = pins[0], open = u.whyOpen, op = list.filter(function(p){ return p.k === open; })[0], note = open && W.WHY[open];
  var hv = list.filter(function(p){ return p.k === (hover[0] || open); })[0];
  function pinPos(p){ return {left:W.clamp(p.x - 28, 4, window.innerWidth - 28) + "px", top:W.clamp(p.y - 10, 58, window.innerHeight - 28) + "px"}; }
  var popW = Math.min(340, window.innerWidth - 24);
  var popPos = op ? {left:W.clamp(op.x - popW, 12, window.innerWidth - popW - 12) + "px", top:(op.y + 22 + 320 > window.innerHeight ? Math.max(64, op.y - 330) : op.y + 22) + "px"} : null;
  return html`<${W.Fragment}>
    ${hv ? html`<div class="why-outline" style=${{left:hv.l - 3 + "px", top:hv.y - 3 + "px", width:hv.w + 6 + "px", height:hv.h + 6 + "px"}}></div>` : null}
    ${list.map(function(p, i){ return html`<button key=${p.k} type="button" class="why-pin" style=${pinPos(p)} aria-expanded=${String(open === p.k)} aria-label=${"Design note " + (i + 1) + ": " + W.WHY[p.k].t}
      onMouseEnter=${function(){ hover[1](p.k); }} onMouseLeave=${function(){ hover[1](null); }} onClick=${function(){ W.ui(function(uu){ uu.whyOpen = uu.whyOpen === p.k ? null : p.k; }); }}>${i + 1}</button>`; })}
    ${note && op ? html`<div class="why-pop" style=${Object.assign({width:popW + "px"}, popPos)} role="dialog" aria-label=${note.t}>
      <div class="row"><span class="lbl grow">Design note ${list.indexOf(op) + 1}</span><button type="button" class="iconbtn" style=${{width:"26px", height:"26px"}} onClick=${function(){ W.ui(function(uu){ uu.whyOpen = null; }); }} aria-label="Close"><${Icon} n="x" s=${14} /></button></div>
      <h3>${note.t}</h3><p>${note.d}</p><p class="ink2"><b style=${{fontWeight:600}}>Why:</b> ${note.y}</p>
      <div class="now"><b style=${{fontWeight:600}}>Today's app:</b> ${note.was}</div>
      <div class="row wrap" style=${{gap:"4px"}}>${(note.p || []).map(function(pid){ var pr = P.filter(function(x){ return x.id === pid; })[0]; return html`<button key=${pid} type="button" class="tag line" style=${{cursor:"pointer"}} onClick=${function(){ W.ui(function(uu){ uu.why = false; uu.whyOpen = null; uu.planOpen = pid; }); W.go("plan"); setTimeout(function(){ var el = document.getElementById("plan-principles"); if (el) el.scrollIntoView({behavior:"smooth"}); }, 120); }}>${pr.t}</button>`; })}</div>
    </div>` : null}
    <aside class="why-side" aria-label="Design notes on this screen">
      <div class="row" style=${{padding:"12px 14px", borderBottom:"1px solid var(--line)"}}><${Icon} n="map" style=${{color:"var(--close)"}} /><b class="grow" style=${{fontWeight:600}}>Design notes on this screen</b><button type="button" class="iconbtn" style=${{width:"28px", height:"28px"}} onClick=${function(){ W.ui(function(uu){ uu.why = false; uu.whyOpen = null; }); }} aria-label="Hide design notes"><${Icon} n="x" s=${14} /></button></div>
      <div style=${{overflowY:"auto", padding:"6px"}}>
        ${list.length ? list.map(function(p, i){ return html`<button key=${p.k} type="button" class="tray-i" onMouseEnter=${function(){ hover[1](p.k); }} onMouseLeave=${function(){ hover[1](null); }} onClick=${function(){ W.ui(function(uu){ uu.whyOpen = p.k; }); }} style=${open === p.k ? {background:"var(--close-soft)"} : null}>
          <span class="why-pin" style=${{position:"static", animation:"none", flex:"none"}}>${i + 1}</span><div class="tx"><b style=${{fontWeight:500}}>${W.WHY[p.k].t}</b><small>${W.WHY[p.k].y}</small></div></button>`; })
        : html`<p class="hint" style=${{padding:"10px"}}>No notes for what is on screen right now. Scroll, or open another screen.</p>`}
      </div>
      <div class="row" style=${{padding:"10px 14px", borderTop:"1px solid var(--line)"}}><${Btn} size="sm" kind="ghost" icon="map" onClick=${function(){ W.ui(function(uu){ uu.why = false; uu.whyOpen = null; }); W.go("plan"); }}>Read the whole plan</${Btn}></div>
    </aside>
  </${W.Fragment}>`;
};

/* ---------- the Plan page ---------- */
function count(obj, field){ var c = {}; Object.keys(obj).forEach(function(k){ obj[k].forEach(function(t){ var v = field(t); c[v] = (c[v] || 0) + 1; }); }); return c; }
function CovBar(p){
  var total = W.sum(p.order, function(k){ return p.c[k] || 0; });
  return html`<div class="col tight">
    <div class="covbar" role="img" aria-label=${p.label}>${p.order.map(function(k){ return p.c[k] ? html`<i key=${k} class=${p.prefix + k} style=${{flexGrow:p.c[k]}} data-tip=${p.labels[k] + ": " + p.c[k] + " of " + total}></i>` : null; })}</div>
    <div class="row wrap" style=${{gap:"4px 14px"}}>${p.order.map(function(k){ return p.c[k] ? html`<span key=${k} class="lg"><i class=${p.prefix + k}></i>${p.labels[k]} <b class="num">${p.c[k]}</b></span>` : null; })}</div>
  </div>`;
}
function ShowBtn(p){ return p.k && SHOW[p.k] ? html`<button type="button" class="btn ghost sm" onClick=${function(){ W.showMe(p.k); }} data-tip="Go there and highlight it"><${Icon} n="eye" />${p.label || "Show me"}</button>` : null; }

function Hero(){
  var tc = count(TODAY, function(t){ return t[0]; }), pc = count(COV, function(t){ return t[1]; });
  var ready = (pc.in || 0) + (pc.part || 0);
  return html`<div class="plan-hero" data-why-x="hero">
    <div class="col" style=${{gap:"12px"}}>
      <h1>One place to start. One next step for everything. An answer for every click.</h1>
      <p class="ink2" style=${{maxWidth:"62ch"}}>Your framework needs 127 tasks across 23 steps. Today's app does 24 of them well; the rest are buried, half-done or missing, spread over screens that do not link to each other. This plan rebuilds the experience around the work, in the order the money flows, and this prototype shows every part of it working with example data.</p>
      <div class="row wrap"><${Btn} kind="pri" icon="sun" onClick=${function(){ W.go("today"); }}>Open Today</${Btn}><${Btn} icon="map" onClick=${function(){ W.go("today"); W.ui(function(u){ u.why = true; }); }}>Show the design notes on screen</${Btn}><span class="hint">Or press the map button in the top bar on any screen.</span></div>
    </div>
    <div class="col" style=${{gap:"14px"}}>
      <div class="col tight"><span class="small b">Today's app, task by task</span><${CovBar} c=${tc} order=${["ok","buried","partial","missing","outside"]} labels=${ST_LABEL} prefix="st-" label="Today's app coverage" /></div>
      <div class="col tight"><span class="small b">This plan, task by task</span><${CovBar} c=${pc} order=${["in","part","plan","decide","out"]} labels=${PL_LABEL} prefix="pl-" label="Plan coverage" /></div>
      <p class="hint">${ready} of 127 are already clickable in this prototype. The rest are planned or wait on a decision from you.</p>
    </div>
  </div>`;
}
function Complaints(){
  var rows = [["Lag","The causes are in how the app is built, not the framework. Seven rules fix them, from the first day of the rebuild.","speed"],["Unclear workflow","Today orders the whole business; every record shows its one next step.","today-queue"],["Missing actions","Every task in your framework has a home; the 45 missing ones are built in.","checklist"],["Hard to understand","The same card, the same row and the same keys everywhere; every automated decision says why.","draft"]];
  return html`<div class="grid2">${rows.map(function(r){ return html`<div key=${r[0]} class="card tight"><div class="row"><${Icon} n="alert" style=${{color:"var(--warn)"}} /><h3 class="grow">${r[0]}</h3><${ShowBtn} k=${r[2]} /></div><p class="small ink2">${r[1]}</p></div>`; })}</div>`;
}
function Model(){
  var ph = [["Find","var(--find)","Search, triage, contacts","Creators: found → qualified → contact"],["Reach","var(--reach)","Emails, follow-ups, replies","Creators: emailed → replied → media kit"],["Close","var(--close)","Audience, brands, pitch, terms","Creators signed · brands qualified → won"],["Deliver","var(--deliver)","Deals and money","Deals: negotiate → paid → next deal"]];
  return html`<div class="col" style=${{gap:"10px"}}>
    <div class="model" style=${{gridTemplateColumns:"repeat(4,minmax(0,1fr))"}}>${ph.map(function(p){ return html`<div key=${p[0]} class="mph" style=${{"--hue":p[1]}}><b>${p[0]}</b><small>${p[2]}</small><small class="muted">${p[3]}</small></div>`; })}</div>
    <div class="flow">
      <div class="fb"><b>Three kinds of record</b><span class="small ink2">Creators, brands and deals. Emails, notes, files and money always belong to one of them.</span></div>
      <div class="fa"><${Icon} n="arrowR" s=${20} cls="flip" /></div>
      <div class="fb"><b>Each has one next step</b><span class="small ink2">Worked out from its stage, its emails and its dates, with a reason and a time estimate.</span></div>
      <div class="fa"><${Icon} n="arrowR" s=${20} cls="flip" /></div>
      <div class="fb"><b>Today collects them all</b><span class="small ink2">Closest to money first. Do one, the record moves, its next step appears, the next item opens.</span></div>
    </div>
  </div>`;
}
function Principles(){
  var u = W.U(), openId = u.planOpen;
  return html`<div class="princ">${P.map(function(p){ return html`<div key=${p.id} class="pcard" style=${openId === p.id ? {borderColor:"var(--close)", boxShadow:"0 0 0 3px var(--close-soft)"} : null}>
    <h3>${p.t}</h3><p>${p.d}</p>
    <ul style=${{margin:0, paddingInlineStart:"18px", fontSize:"12.5px", color:"var(--ink-2)", display:"flex", flexDirection:"column", gap:"3px"}}>${p.how.map(function(h, i){ return html`<li key=${i}>${h}</li>`; })}</ul>
    <p class="was">Today's app: ${p.was}</p>
    <div class="row"><${ShowBtn} k=${p.show} /></div>
  </div>`; })}</div>`;
}
function Coverage(){
  var u = W.U(), openSt = u.planStep || {}, phases = [["find","Find creators","var(--find)"],["reach","Reach out","var(--reach)"],["close","Close","var(--close)"],["deliver","Deliver and get paid","var(--deliver)"],["team","Across everything","var(--ink-2)"]];
  var f = u.planCovFilter || "all";
  function toggle(k){ W.ui(function(uu){ uu.planStep = Object.assign({}, uu.planStep); uu.planStep[k] = !uu.planStep[k]; }); }
  return html`<div class="col">
    <div class="row wrap">${[["all","All tasks"],["fixed","Missing or buried today"],["open","Planned or yours to decide"]].map(function(x){ return html`<button key=${x[0]} type="button" class="chip" aria-pressed=${String(f === x[0])} onClick=${function(){ W.ui(function(uu){ uu.planCovFilter = x[0]; }); }}>${x[1]}</button>`; })}
      <span class="sp"></span><button type="button" class="btn ghost sm" onClick=${function(){ W.ui(function(uu){ var all = {}; Object.keys(COV).forEach(function(k){ all[k] = true; }); uu.planStep = Object.keys(uu.planStep || {}).length ? {} : all; }); }}>${Object.keys(openSt).filter(function(k){ return openSt[k]; }).length ? "Fold all" : "Open all"}</button></div>
    ${phases.map(function(ph){ return html`<div key=${ph[0]} class="col tight">
      <h3 style=${{color:ph[2]}}>${ph[1]}</h3>
      ${Object.keys(COV).filter(function(k){ return STEP_PH[k] === ph[0]; }).map(function(k){
        var rows = COV[k].map(function(c, i){ return {now:TODAY[k][i], plan:c}; }).filter(function(r){ return f === "all" ? true : f === "fixed" ? (r.now[0] === "missing" || r.now[0] === "buried") : (r.plan[1] === "plan" || r.plan[1] === "decide"); });
        if (!rows.length) return null;
        var isOpen = !!openSt[k];
        return html`<div key=${k} class="step-acc">
          <button type="button" onClick=${function(){ toggle(k); }} aria-expanded=${String(isOpen)}>
            <${Icon} n=${isOpen ? "chevD" : "chevR"} cls="flip" /><b class="grow" style=${{fontWeight:600}}>${STEP_NAMES[k]}</b>
            <span class="mini" aria-hidden="true">${TODAY[k].map(function(t, i){ return html`<i key=${i} class=${"st-" + t[0]} style=${{flex:1}}></i>`; })}</span>
            <${Icon} n="arrowR" s=${13} cls="flip" />
            <span class="mini" aria-hidden="true">${COV[k].map(function(t, i){ return html`<i key=${i} class=${"pl-" + t[1]} style=${{flex:1}}></i>`; })}</span>
            <span class="small muted num" style=${{width:"62px", textAlign:"end"}}>${rows.length} ${rows.length === 1 ? "task" : "tasks"}</span>
          </button>
          ${isOpen ? rows.map(function(r, i){ return html`<div key=${i} class="task-row">
            <div class="side"><span class="row" style=${{gap:"6px"}}><span class="lg"><i class=${"st-" + r.now[0]}></i>${ST_LABEL[r.now[0]]}</span></span><b style=${{fontWeight:500}}>${r.now[1]}</b></div>
            <div class="side"><span class="row" style=${{gap:"6px"}}><span class="lg"><i class=${"pl-" + r.plan[1]}></i>${PL_LABEL[r.plan[1]]}</span><span class="sp"></span><${ShowBtn} k=${r.plan[2]} /></span><span>${r.plan[0]}</span></div>
          </div>`; }) : null}
        </div>`; })}
    </div>`; })}
  </div>`;
}
function Qol(){
  var u = W.U(), area = u.planArea || "All", prio = u.planPrio || "All";
  var areas = ["All"].concat(QOL.map(function(q){ return q[0]; }).filter(function(v, i, a){ return a.indexOf(v) === i; }));
  var rows = QOL.filter(function(q){ return (area === "All" || q[0] === area) && (prio === "All" || q[2] === prio); });
  var inProto = QOL.filter(function(q){ return q[3] === "in" || q[3] === "part"; }).length;
  return html`<div class="col qol">
    <div class="row wrap"><${W.Seg} label="Area" cur=${area} onPick=${function(v){ W.ui(function(uu){ uu.planArea = v; }); }} opts=${areas.map(function(a){ return [a, a]; })} />
      <${W.Seg} label="Priority" cur=${prio} onPick=${function(v){ W.ui(function(uu){ uu.planPrio = v; }); }} opts=${[["All","All"],["Must","Must"],["Should","Should"],["Could","Could"]]} />
      <span class="sp"></span><span class="hint">${QOL.length} items · ${inProto} clickable in this prototype</span></div>
    <div class="tw"><table class="tbl"><thead><tr><th>Area</th><th>What it does</th><th>Priority</th><th>Status</th><th></th></tr></thead><tbody>
      ${rows.map(function(q, i){ return html`<tr key=${i}><td class="muted">${q[0]}</td><td>${q[1]}</td><td><span class=${"prio " + q[2].toLowerCase()}>${q[2]}</span></td><td><span class="lg"><i class=${"pl-" + q[3]}></i>${PL_LABEL[q[3]]}</span></td><td style=${{textAlign:"end"}}><${ShowBtn} k=${q[4]} /></td></tr>`; })}
    </tbody></table></div>
  </div>`;
}
function Feedback(){
  return html`<div class="tw"><table class="tbl"><thead><tr><th>When you…</th><th>You see</th><th>It goes to</th><th>To take it back</th></tr></thead><tbody>
    ${FEEDBACK.map(function(f, i){ return html`<tr key=${i}><td><b style=${{fontWeight:500}}>${f[0]}</b></td><td>${f[1]}</td><td class="ink2">${f[2]}</td><td class="ink2">${f[3]}</td></tr>`; })}
  </tbody></table></div>`;
}
function Speed(){
  return html`<div class="card"><div class="row small muted"><b class="grow" style=${{fontWeight:600, color:"var(--ink)"}}>Why it lags today</b><b class="grow" style=${{fontWeight:600, color:"var(--ink)"}}>The rule that prevents it</b></div>
    ${CAUSES.map(function(c, i){ return html`<div key=${i} class="cause"><span class="ink2">${c[0]}</span><${Icon} n="arrowR" cls="flip" /><span>${c[1]}</span></div>`; })}
    <p class="hint">Budget for every screen: interactive in under 100 ms from a click; Today visible within 2 s of opening the app; no spinner over something already on screen.</p></div>`;
}
function Roadmap(){
  return html`<div class="roadmap">${ROADMAP.map(function(r){ var last = +r[0] >= 10; return html`<div key=${r[0]} class="rm" style=${last ? {borderColor:"var(--close)", background:"color-mix(in srgb, var(--close) 5%, var(--panel))"} : null}>
    <span class="w">Step ${r[0]}</span><h3>${r[1]}</h3><p class="small ink2">${r[2]}</p><span class="small"><${Icon} n="checkc" s=${13} style=${{color:"var(--good)", verticalAlign:"-2px"}} /> ${r[3]}</span></div>`; })}</div>`;
}
function Questions(){
  return html`<div class="card"><ol style=${{margin:0, paddingInlineStart:"20px", display:"flex", flexDirection:"column", gap:"8px"}}>${QUESTIONS.map(function(q, i){ return html`<li key=${i}>${q}</li>`; })}</ol>
    <p class="hint">Decided already: you are the main user for now; English only; the app reads replies, with a quiet paste-by-hand fallback.</p></div>`;
}

var SECTIONS = [["why","Why"],["model","How it fits"],["principles","Principles"],["coverage","Every task"],["qol","Quality of life"],["feedback","Feedback"],["speed","Speed"],["roadmap","Build order"],["questions","Open questions"]];
W.screens.plan = function(){
  W.useApp();
  function jump(id){ var el = document.getElementById("plan-" + id); if (el) el.scrollIntoView({behavior:"smooth", block:"start"}); }
  return html`<div class="page" style=${{gap:"28px"}}>
    <nav class="plan-nav" aria-label="Plan sections">${SECTIONS.map(function(s){ return html`<button key=${s[0]} type="button" class="chip" onClick=${function(){ jump(s[0]); }}>${s[1]}</button>`; })}</nav>
    <section class="plan-sec" id="plan-why"><${Hero} /><${Complaints} /></section>
    <section class="plan-sec" id="plan-model"><h2>How it fits together</h2><p class="lead">The framework's four phases are the rail. Three kinds of record move through them. Today is where you work them.</p><${Model} /></section>
    <section class="plan-sec" id="plan-principles"><h2>Ten principles</h2><p class="lead">Every screen in the prototype follows these. Each card says what changes from today's app and takes you to it.</p><${Principles} /></section>
    <section class="plan-sec" id="plan-coverage"><h2>Every task in your framework</h2><p class="lead">All 127 tasks from the UI map of today's app (18 October). Left: what the app does now. Right: how the Workbench handles it, with a link to see it. The two mini bars on each step compare before and after.</p><${Coverage} /></section>
    <section class="plan-sec" id="plan-qol"><h2>Quality of life</h2><p class="lead">The small things that make a daily tool feel good to use, with a priority and where to see each one.</p><${Qol} /></section>
    <section class="plan-sec" id="plan-feedback"><h2>Feedback for every action</h2><p class="lead">What you see, where the thing went, and how to take it back.</p><${Feedback} /></section>
    <section class="plan-sec" id="plan-speed"><h2>Speed: fixing the lag at the root</h2><p class="lead">The lag comes from how the current app is built. These rules go into the rebuild from day one, so it cannot come back.</p><${Speed} /></section>
    <section class="plan-sec" id="plan-roadmap"><h2>Build order</h2><p class="lead">Your sequence: design, rebuild in the new languages, check the result against today's app and this plan until every item is done, and only then clean the repo.</p><${Roadmap} /></section>
    <section class="plan-sec" id="plan-questions"><h2>Open questions for you</h2><${Questions} /></section>
  </div>`;
};
})();
