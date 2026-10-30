# Gap inventory: design/workbench-v6 vs the real app

Scope: v6 (`design/workbench-v6/index.html` + `js/*.js`) against `apps/desktop/src/renderer/` and `packages/{core,ipc,ui}`.
Marks: BUILT (matches) / PARTIAL (exists, pieces named missing) / MISSING / DIFFERS (app has it, v6 does it another way).
Ignored: light theme, Talent Managers, v6 prototype chrome the app re-did (proto switch, comment tool, scenario picker, Layout Switcher F1, Reset Demo F8, "Why is this here" design-notes layer `WhyLayer`/`data-why`).
Plan page (`plan.js`): the app has NO Plan page (`ScreenKey` has no `plan`, no rail item, no `G P`). Prototype-only; skip unless the owner wants it.
File refs: v6 file:line (js/ folder). "app" = renderer path. Method note: v6 was read by outline (function names, labels, keys), not line by line, so lesser sub-features inside big screens may be undercounted. Items marked (check) were not fully verified.

## Where the app stands (one paragraph)
In prototype mode (example data) every screen shows. Built for real: Find (all 4 tabs), Reach (all 4 tabs), Close > Roster only, Toolbox (4 of 9 tools), Settings (6 of 11 sections), the frame (rail, top bar, palette, shortcuts, trays, toasts, menus, tooltips, problems bar, peek, creator record). Placeholder "still being built" cards: Today, Deliver (both tabs), Insights, Team, and Close > Brands/Match/Pitch/Negotiate/Contracts (`close-screen.tsx:96`, `placeholder-screen.tsx`). Brand and deal records are only a one-paragraph summary (`overlays/record-summary.tsx`).

---
## 1. Conflicts (DIFFERS): the owner decides each
Each line: app does X / v6 does Y. Recommendation in brackets where one is clear.

C1. Where a draft is approved: app approves in the record's Emails tab / peek (`record/draft-card.tsx`; Reach board "Review"/"Answer" just opens the record, `reach/board-card.tsx:119`) / v6 approves in Today's work pane and every "Review" button jumps to Today (`reach.js:109 inToday`, `close.js:107 reviewInToday`, `today.js` Work). [Needs a decision: building Today as the approval home changes Reach and Close buttons. Keep both: Today embeds the same DraftCard.]
C2. Reach board contents: app lanes list creators only / v6 lanes also hold brands (replies and waiting drafts, `reach.js:179-196`), have an Everyone/Mine switch (`reach.js:259`), cap Signed at 6 with "Show all N" and "Roster →" (`reach.js:249`).
C3. Reach title: app "Reach out" page head, tab "Reach" in rail (`strings.ts:2343`) / v6 same title; sub line differs: v6 "N emails to approve, N follow-ups due today and N replies to answer. Nothing leaves until you press Send." (`reach.js:511`); app has `emailsToApprove`/`followUpsToApprove` (close, verify wording).
C4. Sequences: app lists creators only, filter Show (All/Running/Stopped) / v6 adds Target switch Creators 3-touch vs Brands 4-touch (HC-24) and a 14-day-back/ahead timeline with "2 wk earlier / Today / 2 wk later" paging (`reach.js:325-345`). (app has a timeline? verify `sequences.tsx` for the paging buttons.)
C5. Replies: app is a list + detail with arrows (`reach/replies.tsx:211`) / v6 adds a search box, 5 filter chips with counts (All, Needs an answer, Interested, Not now, Talks price), brand replies mixed in, J/K/arrows/O keys, and a "Next card" or "Answered, draft a follow-up" fallback (`reach.js:385-445`). The app has no search or chips (grep found none).
C6. Mailboxes: app has cap steppers, pause, test email, bounce tone (`reach/mailboxes.tsx`); connect a mailbox is in Settings > Connections (`settings/connections/mailboxes-row.tsx`) / v6 has an inline "Connect a mailbox" form on the tab, "Move queued drafts to healthy mailboxes", and the slowed-mailbox callout (`reach.js:487-495`, `reach.js` A.connectMailbox/A.moveMailboxDrafts). (Move drafts: not found in the app, check.)
C7. Triage keys and reject flow: app R opens a reason picker, 1-4 reject, O opens the record, 4 reasons (`find/triage.tsx:144`, `find/triage-card.tsx:14`) / v6 R rejects with the dropdown's chosen reason, N = Never (key and button), 1-5 (5th reason "Bot / fake engagement", INF-QUAL-08), Enter opens, Skip button (`records.js:564-590`, `data.js:34`). v6's own shortcut sheet says Enter opens (`app.js` SHORTCUTS); the app sheet says Enter but the code uses O: a bug in the app either way.
C8. Triage card content: app card (`find/triage-card.tsx`) / v6 card also shows star rating, content format tag, bot-risk tag or "Organic comments verified", "Another teammate emailed this channel N days ago" warning, Shorts/bot warning (fails INF-QUAL-08/10), 12-video trimmed average, view-stability, clickable "sponsors seen" chips that add the brand to Close > Brands (`W.A.spotBrand`), and a "How the fit score adds up" fold-out (`records.js:516-549`). Needs fields in the creator type (see Data gaps).
C9. Gallery signals: app has Gold mine and others (`find/gallery-chips.tsx`) / v6 list: Gold mine, 5-Star Priority, Stable views (HC-16), Long-form only, Sponsored before, Has an email, Email confirmed, Never emailed (`find.js:60-69`). App lacks the three that need starRating, viewStability, format. Also v6 adds a "Filters" toggle for narrow width only (ignore, no narrow checks).
C10. Creator record tabs: app Overview / Emails / Notes / Activity (`strings.ts:1933`) / v6 Overview / Emails (shown as "Talk") / Deals / Activity, with Notes as a block inside Overview (`records.js:810-820, 791`). v6 has a Deals tab on creator and brand; the app has none. A deal's tabs in v6: "Steps and money", "Dual Deal Room", "Activity".
C11. Brand and deal record: app = summary card only / v6 = full records (Brand: Qualify form, PitchPicker, Brand Talent Packet and Call Co-Pilot buttons; Deal: checklist per step, Money, negotiation Ladder, shipping, QC, Dual Deal Room). See section 9.
C12. Shortcut sheet and G chords: app sheet lists `G then I / X / M / S` (no P) and has no on-screen "Jump to: T Today . F Find ..." chord hint (`g-chord` not found); v6 shows the chord bar after G (`app.js` gChord) and lists P. [Add the chord bar; skip P if no Plan page.]
C13. Palette: app has screens, settings rows, creators; actions: shortcuts, settings, density (`overlays/commands.ts`, `strings.ts:161`) / v6 actions: Start focus, Wrap up the day, Resume today's search, Review new finds, Undo the last change, Show shortcuts, Open settings; group "Recent" (last 5 opened records); search also matches brands and deals; shows "Showing top 14 of N" (`app.js` Palette). App lacks Recent and brand/deal search (check `palette.tsx`), focus, wrap.
C14. Account menu: app has Settings, Appearance, Shortcuts, Notifications, Connections, Sign out / v6 has Export JSON Snapshot and Reset to Pristine Demo Seed, no sign out (prototype only; app already has proto-level persistence in Settings > Prototype). No action needed beyond ignoring.
C15. Toolbox layout: app has 4 tabs (Archive, Never contact, Scheduled, Log) (`strings.ts:1566`) / v6 is a master-detail list (J/K steps through tools) with Tools: Price & Package Calculator, Archive, Never contact, Scheduled; History: Activity log, Notifications; and a Settings link row. "Rules/Facts/Health" moved to Settings in v6 (`more.js:480-490, 826-862`). The v6 layout, not tabs, is the spec if the owner wants parity.
C16. Rail subtitle and live gating: app hides unwired screens in live mode (`lib/wired.ts`); v6 shows everything. Intended; keep. In prototype mode `shownTabs` already shows all tabs (source "example").
C17. Sub-line for Today on the rail: v6 "N planned" duration (`W.dur(planned)`) and counts per screen from `phaseCounts(items)` (`engine.js:303`); app takes `Frame.counts` from the seed ("Until the Today engine computes them", `core/data/types.ts:145`). Needs the Today engine.
C18. Undo/redo: app has `Ctrl Z / Ctrl Shift Z / Ctrl Y` and a toast "Undo" (BUILT); v6 `W.act(label, fn, {toast, log})` wraps every change in an undoable step with an activity-log line; app undo exists for its writes only (`lib/actions.ts`). Each new Today/Close/Deliver action must register with the same undo store.

C19. Deal step words (P1, 2026-10-30): v6's DEAL_FLOW items use rule codes and trade shorthand (IO, UTM, QC, ROI, Make-Good, Droplet, "-5d buffer"). The app keeps v6's ten steps and item counts but says them in plain words (the owner's writing rule): e.g. "Brand's order (insertion order) received and marked up", "Our 5-point check passed (no music, #ad shown)", step "Draft and checks". The full old-to-new list is the `rewritten` map in `packages/core/src/deal-flow.test.ts`. [Owner to check the wording in prototype mode.]
---
## 2. Frame and overlays
- Rail: BUILT. Collapse `[`, counts with bump animation (check), account block. v6 extras: "viewing as" line, "Add your name" prompt (BUILT in profile hero). `app.js:35-62`
- Top bar: BUILT (back/forward, crumbs, palette button, jobs tray, bell, save chip, presence, proto chip). Missing: Layout Switcher (skip), Reset Demo (skip), "Why" map button (skip). `app.js:80-110`
- Problems bar (SysBar, "+N more", action button): BUILT (`app/problems-bar.tsx`). v6 problem sources: `engine.js:1617 W.problems` (signed-out mailbox, bridge offline, YouTube daily limit, over-cap). Check the app computes the same set in example data (scenario "broke" exists: BUILT).
- ViewAsBar ("Seeing the app as Sara... Back to you"): MISSING (`app.js:112`). Needs `setViewAs`: swaps `me`, hides money for VA role, changes Today list. Owner-only; Team scope. Medium.
- Jobs tray + teammate search row: BUILT. Notifications tray (Mark all read, gear to settings, unread dot, click navigates and selects the Today item): BUILT except "selects Today item" (needs Today).
- Peek panel (Alt up/down through a list, "i of N", Full page, Esc): BUILT (`overlays/peek.tsx`). Missing: `peek-compact` class when peek is open over Today and Reach > Replies (split screens) (`app.js:230`).
- Record page (Back, prev/next in list with Alt arrows, "i of N"): PARTIAL: Alt arrows and list stepping only in peek; page has Back only (`app/record-page.tsx` vs `app.js:151-165`).
- Shortcuts sheet: BUILT; content out of date (C7, C12).
- Hand-off modal (note, Ctrl Enter, away warning): MISSING (`app.js:197`). Team scope.
- Menu (radio items, "who" header, arrow-key nav, danger): BUILT.
- Toasts (hover pause, actions, life bar): BUILT. Tooltips with kbd: BUILT.
- QuickDraftDock ("Inline Email Composer", minimise, close; opens a draft from toast/Reach without leaving the screen): MISSING (`ui.js:205`, `core.js:215`). Medium.
- AgencyModal (Brand Talent Roster & Media Kit Packet: Include 3-option pricing, Print/Save PDF, Copy 4-line blocks): MISSING (`ui.js:224`, opened with `W.openModal({kind:"mediakit"})` from Today warmth item, Brand record, Roster). Other modal kinds in v6: `call` (Call Script / Co-Pilot, `close.js:437`), `invoice` (PDF, `deliver.js:275`), `contract` (clause audit). No modal host in the app (`ui.modal` absent; check `overlays/modal-layer.tsx`: it exists, so it is a host, but none of these four contents exist). Large combined.
- First-day screen: Today's FirstRun card (4 steps with done ticks, buttons to Search rules, Find, Mailboxes, Team) MISSING (`today.js:225`). Scenario "first" exists in data. Small once Today exists.
- Focus mode (F, one item at a time, focus bar "i of N", meter, time left, minutes in, Leave focus, Esc): MISSING (`today.js:284`). Small after Today.
- Wrap up the day (Still open + Move all to tomorrow, Tomorrow list, Done today, Note for tomorrow, "Wrapped up" toast; note shows next day at top of Today as dismissable callout): MISSING (`today.js:199`). Small-medium.
- Welcome callout on Today ("Show design notes", "Open the plan"): skip (Plan/why chrome).
- Snooze menu (Later today 15:00, Tomorrow morning, Next Monday, In two weeks; return time = Settings "morning"): MISSING (`ui.js:174`). `strings.ts` has "Snooze" words; no action. Small.
- G-chord hint bar: MISSING (C12).

---
## 3. Today (all MISSING; `today.js`, `engine.js:231-312`)
Whole screen is a placeholder. v6 parts:
- DayBand: "Your N hours" budget card, stacked bar by bucket + done today + free, legend, "Fit to Nh" button (`A.fitDayBudget`, defers lowest-priority items to tomorrow 09:00) (`today.js:11-29, engine.js:1489`). Mail card: sends left today across mailboxes (`today.js:30-42`).
- Queue (list left, work pane right; split layout): filter chips (All / quick... `u.todayFilter`), rows grouped by 8 buckets in order: Get paid, Deal steps, Answer replies, Approve emails, Follow-ups due, Sign and pitch, Confirm contacts, Review new finds (`engine.js:220-228`); each row has time estimate, due, reason ("why"), owner avatar (`today.js:43-89`).
- Keys: J/K next/previous, Ctrl Enter main action, Z snooze, H hand off, O open record beside, F focus (`today.js:263`).
- Work pane per item kind (`today.js:123-198`): invoice (send invoice, Ctrl Enter), collect (nudge/mark paid), payout (pay creator), deal step (checklist ticks, Dual Deal Room button), nextdeal (pitch next creator), reply/send/followup (DraftCard primary), audience (AudienceCheck), contact (ContactBlock), qualify (Qualify form), pitch (PitchPicker), bnudge/stalled (draft nudge), warmth (3-week warmth update, Preview Media Kit), finds (Triage). Common header: Record, Snooze, Hand off buttons.
- TeamLoad card (minutes per person against 240, `today.js:90`) and Snapshot (creator quick stats, `today.js:99`).
- Empty states: AllClear ("Clear. Nothing else needs you today." + Wrap up), FirstRun.
- Engine pieces: `W.items(scope)` rules (money/deals/drafts/stalled/warmth/close/contacts/finds, `engine.js:231-300`), `W.itemTitle`, `W.nextFor(ref)` ("next action" for records, `engine.js:139-192`), snooze/hand-off state, `d.done` log with minutes, `d.day {budget, note, wrapped}`.
- What the app already has to reuse: DraftCard, AudienceCheck, ContactBlock, Triage, Thread, Roster kit editor. Today's Reach/Find/Close parts can mount those; money/deal/pitch/qualify parts need new screens first.
- Size: LARGE (screen + engine + 6 new item panels). Can ship in slices: queue + Reach/Find/Close items first, money/deal items after Deliver.

---
## 4. Find (mostly BUILT)
- Search tab: Keywords (list, add, suggestions "Keyword ideas", Gemini ideas) BUILT; Rules (edit rules) BUILT; Live run (status, pause/resume, progress) BUILT; teammate Mate card BUILT; Runs history BUILT. v6 also "Resume today's search" action and `W.A.startRun/pauseRun` (BUILT in live-run). 
- Review new: PARTIAL, see C7, C8. Also v6 header "N new, N look like gold mines, gold mines first then by fit" and "See them as a gallery" button (`find.js:256-263`): check app text. Tally "N shortlisted, N rejected this session" and progress meter (check `triage.tsx`).
- Gallery: BUILT (facets, chips, view Gallery/Table, size S/M/L, Show toggles, compare up to 4, bulk bar, saved views, shift-click range, select all, Esc clears). PARTIAL: signals (C9), facet "Added by hand" run label (`find.js:91`, check), `Ctrl A` select all (check `find-selection.ts`).
- Contacts: BUILT ("Confirm all 90%+ addresses", ContactBlock, finding state).
- Data used but absent from app creator type: starRating, viewStability, format, botRisk, trimmedAvgViews, gold rule uses trimmedAvgViews (C8).
- Size of remaining Find work: SMALL (5-star, stable, long-form signals + triage card extras + N key + reason 5), conditional on data fields.

---
## 5. Reach (mostly BUILT; see C1-C6)
- Board: PARTIAL (C2). Card actions: Draft it, Review, Answer, Check, Park 60d on finished sequence (`reach.js:212-233`): app has first four; "Park 60d" check.
- Sequences: PARTIAL (C4). Row menu (Stop, Resume, Park until, Wake now): BUILT (`reach/sequences.tsx:19`). Brand rows need brand sequences (`brands[].seq`).
- Replies: PARTIAL (C5).
- Mailboxes: PARTIAL (C6). MailCard fields in v6 (warm-up day x of 14, bounce, reply, inbox placement, SPF/DKIM/DMARC): app BUILT for most (check SPF row).
- Draft actions in v6 `engine.js:420-540` (send, confirm gate, emergency social proof, edit, steer Shorter/Warmer/More direct/New angle, schedule send later, skip): BUILT in `record/draft-*.tsx`, `lib/reach-actions.ts`.
- CapSummary: BUILT. GeminiBanner: BUILT.
- DM drafts (`A.draftDm` per platform, `engine.js:1279`): MISSING (check; no match for "draftDm"). Small.
- Size: SMALL-MEDIUM if brands outreach is in scope (needs brand drafts, brand threads, 4-touch brand sequence); SMALL otherwise (replies filters, board switch, show-all).

---
## 6. Close
### Roster: PARTIAL
- Waiting-for-audience-check list with KitRow and verdict tag: BUILT (`close/roster-kits.tsx`, `audience-check.tsx`, `kit-editor.tsx`).
- Signed table: PARTIAL. App columns: creator, rate, median, audience (`roster-signed.tsx`). v6 columns: Model & Warmth (Exclusive 25% / Brokered tag, "Nd since update" tag red at 21+), Rate, Median / Trimmed, Audience, Exclusivity & next open slot (lock tags), Best next brand with Pitch button / "No open brand fits yet, See matches" (`close.js:171-203`). Missing: filter box, sort (median/rate/name), row peeks list order.
- Needs: `relationshipModel`, `daysSinceUpdate`, `exclusivityLocks`, `nextOpenSlot`, `W.match` engine (below).
### Brands tab: MISSING (`close.js:251-280`, BrandCard 211-229, AddBrand 231-250)
- Kanban lanes Found / Qualified / Pitched / Negotiating / Won (+ "Not a fit" lane toggle chip with count); search box, Sort Recent/Name; N key opens "Add a brand" card (name, site, what it sells; duplicate warning "already on the board"); "Add to Found".
- Card actions by status: found = Qualify, Not a fit; qualified/won = Pitch / Pitch again; negotiating = Price talk, ...; lost = Move back to Found. Budget text hidden when money hidden ("Budget hidden").
- Actions: `A.qualify`, `A.notFit`, `A.reopenBrand`, `A.spotBrand`. Qualify form (`records.js:594`): contacts 1 and 2 with roles, headcount -> recommended title (BRD-QUAL-17), paid spender verified (BRD-QUAL-19), past campaign hook, budget range, personal-email warning, boycott-list warning, Ctrl Enter, "Qualify and pitch".
- Size: MEDIUM-LARGE (new brand model, board, forms, undo).
### Match tab: MISSING (`close.js:282-343`)
- Brand x signed-creator heatmap (score 0-100, shaded), status chips (Qualified, Negotiating, Won, Pitched), Sort Best fit/Name, legend, "best fit" ring, warning icon (over budget, competitor sponsor, full schedule), live-deal box icon, "Strongest pairings to pitch now" (top 4, one per brand) with Pitch buttons. Cell click opens Pitch.
- Engine: `W.match(b, c)` scoring (`engine.js:104-138`), `W.priceFor/payoutFor/buildPackagesFor` (`62-103`), `W.bestBrandFor`. Size: MEDIUM (pure functions to port + one table).
### Pitch tab: MISSING (`close.js:345-420`)
- Brand picker, PitchPicker (choose creators, mode cold/warm, packages), pending-pitch rows ("Review in Today", Discard), "Waiting for your approval", "Sent, waiting for a reply" with Nudge and Start deal, warnings (already negotiating, pitch already waiting). `A.draftPitch` (`engine.js:793`), `A.nudgeBrand`, `A.startDeal`. Size: LARGE (new draft kind "pitch" with brand recipients, 4-touch brand sequence, Gemini prompt).
### Negotiate tab: MISSING (`close.js:455-488`, `records.js:460 Ladder`)
- Deals at step 0 with "To agree" checks (price, payout, terms, exclusivity), brand's last message with AI intent tag, counter ladder (ask/offer/rate/floor history timeline, `A.counter`, `A.squeezeCreator`, `A.counterCreatorRate`, `A.replaceDealCreator`), Call Script modal, CPM cap/view guarantee, "Swap creator if rate stalls (HC-23)". Size: LARGE.
### Contracts tab: MISSING (`close.js:490-560`)
- Deals at step 1: Documents and signatures (numbered, locked order, "Generate Mirrored Contract & Email" `A.generateMirroredContract`, print), 7-clause and 6-redline audit (HC-14, BRD-LEGAL-01) with `contractClauses[]`, `redlineFlags[]` (`data.js:93-112`), flag clause (`A.flagContractClause`). Size: MEDIUM-LARGE.
- Tab counts on Close tabs and rail: partly (Roster count only).

---
## 7. Deliver (both tabs MISSING; `deliver.js`)
### Deal board (`deliver.js:99-175`)
- Ten lanes from DEAL_FLOW (BUILT in `core/deal-flow.ts`, ported, with a test), each lane shows step number, sum of prices, hint icon (lock for Pay creator, wallet for Invoice, info for ordered Contracts), count; horizontally scrolling with left/right buttons.
- Deal card: name, owner avatar, next-action text, price, checks meter "n/m", due, tags: Ready to pay / Waits for brand / Invoice N days late / Invoice not sent / Creator paid, shipping In transit/Shipped, QC n/5.
- Filters: Mine/Everyone seg, "Late only" chip with count, "Hide empty steps", "Pre-close only (Steps 1-2)", 3-column Dual Deal Room toggle (`records.js:213 DualDealRoom`, `ui.js:51 DealRibbon`), deal count and money total, footnote about Pay creator lock.
- Click opens peek of deal with list order (Alt arrows).
### Money tab (`deliver.js:176-356`)
- Five tiles: Invoiced this month, Collected, Outstanding (late), Owed to creators (ready vs locked), 30-day Net Agency Cashflow.
- Callouts (late invoice, unsent invoice with Send button), invoice aging bar (unsent/late/soon/ok) + "Invoices by due date & Accounting Export" (`A.exportLedgerCsv`, `engine.js:1460`).
- Receivables table: invoice number, state tag, Net 30 progress, Mark paid with split "choose when paid" menu and partial amount, PDF (invoice modal), Send invoice, Remind (`A.nudge`, draft kind "nudge").
- Payables table: Pay creator split button (`A.payCreator`, method and reference), locked rows (brand not paid yet), paid rows.
- Deal actions (`engine.js:1050-1230`): jumpDealStep, tick checklist, tickQc, updateShipping (tracking, delivered), advance, sendInvoice, markPaid, nudge, payCreator, sendReport (30-day report, verdict over/underperformed, make-good), sendHypeTouch (24h/7d/14d/30d cadence), sendPreLiveCheckin, slipGolive, draftStageEmail, startDeal.
- Size: LARGE (two screens, deal engine, invoice/payout logic, CSV, PDF modal). Money must honour `seesMoney` (already in Frame; `moneyFields` guard exists in core).

---
## 8. Insights (MISSING; `more.js:128-476`)

**Superseded (owner, 2026-10-27):** P8 builds `docs/product/insights-design.md`, not v6's Insights. The notes below describe v6 only.

- Period Seg 7/30/90 days; ChartCards each with a data-table toggle: line chart "Emails sent and replies per day" (two scales), channel funnel "Where channels drop out" (steps with % from step above), revenue by month (hidden without money; current month paler), keyword yield for today's run, median-views histogram, audience countries bars.
- Input-Driven Reverse Funnel Planner (FND-DLV-21): monthly revenue target -> daily inputs (`A.updateFunnelTarget`, `funnelSteps`).
- 50-Send Batch Ghosting Diagnostics (FND-DLV-22): cohorts of 50 sends.
- CSV export of each table (`more.js:123`), empty state "Insights fill in after your first week of sending".
- Data: `d.hist {sent[30], replies[30], months[6]}`, runs and keyword stats, creators for histogram. App has none of the history series; `outreach_messages` could supply sent/replies for live. Size: LARGE (SVG charts + 2 planner cards), MEDIUM if charts reuse a small helper.

---
## 9. Toolbox (PARTIAL; `more.js:478-862`)
- BUILT: Archive, Never contact, Scheduled emails, Activity log (`app/toolbox/*`).
- MISSING: Price & Package Calculator (views, CPM, deliverable format, whitelisting, relationship model -> quote, creator payout, 3-option package menu HC-26; shown only with money; `more.js:514-600`, `engine.js:62-103`). MISSING: Notifications tool (same list as bell with room to read, Mark read; `more.js:696`). Master-detail layout (C15), counts per tool, J/K to step.
- Size: MEDIUM (calculator) + SMALL (notifications tool).

---
## 10. Team (MISSING; `more.js:865-1023`)
- People cards (status, doing, load meter, "viewing as"), Invite teammate (owner), Rebalance today (route Contacts & Follow-ups to VA, Delivery & Kits to AM, pick items and "Hand N items to X", `A.rebalance`, `A.rebalanceByRole`), First-Week VA Onboarding checklist (5 milestones, `A.toggleVaOnboarding`) and VA Shadow-Approval gate (`A.setVaApproval`, first 50 drafts need Owner), Handoffs list, "Who can do what" roles table with "Keep money hidden / Visible" (`A.setVaMoney`; the app has this switch in Settings Team and money section? `settings` "team" section is a placeholder).
- Scope: settled by ADR 0021 D7. Prototype mode shows it on example data (P9); making it real waits for step T.
- Size: MEDIUM-LARGE.

---
## 11. Settings (PARTIAL; `settings.js`)
- BUILT: Profile, Appearance, Keyboard, Notifications, Search rules, Writing rules, Connections, Prototype.
- MISSING: Your day (day length Seg 2h...8h, "Snoozed items come back at" morning hour, Welcome note toggle; `settings.js:106-110`; app marks `arrives: 7`), Agency facts (owner: audience countries and ages, engagement floor, margin floor, CPM, markup, send window; `more.js:746 FactsTool`), Team and money (VAs see money: Hidden/Visible, roles; `settings.js:133`).
- Setup health (Gemini bridge, pipeline, Gmail, sync, updates; `more.js:796`): the app's Connections section covers this (check parity).
- v6 appearance rows: Theme, Density, Text size, Motion, Sidebar: check which the app has (skip theme).
- Size: SMALL each (3 sections).

---
## 12. Record pages (creator, brand, deal)
- Creator record: BUILT with different tabs (C10). Missing parts: stars, banner image (`ui.js:140 Banner`, hash-based generated art), "Send 14d Warmth Update" button, Creator Onboarding & Preferences profile (INF-ONB-06/08), Deals tab, Fit breakdown `FitParts` (BUILT in gallery-card as fit chip: check on record), AudienceCheck (BUILT when stage kit).
- Brand record: MISSING (`records.js:748-771`): Thread + drafts (Emails), Deals tab, Activity, contacts, budget, "Generate Brand Talent Packet" and "Call Co-Pilot" buttons, Pitch creators picker, status tag, owner.
- Deal record: MISSING (`records.js:772-790, 339-460`): Steps and money (DealChecklist per step with ordered ticks, QC 5 checks, shipping, hype cadence, Money card with invoice/paid/payout, report, NextDeal), Dual Deal Room (brand thread + creator thread side by side with relay buttons `A.relayBrandToCreator/CreatorToBrand`), Activity.
- Shared: Notes with @mention notifications (`records.js:791-808`; creator Notes tab BUILT, @mention check), Owner chip (reassign, `A.assign`), "viewers" presence on a record (`u.viewers`, check `lib/presence.ts`), `W.Timeline`/`eventsFor` (BUILT as activity).
- Size: MEDIUM for brand, LARGE for deal.

---
## 13. Data model gaps
App now (core `data/types.ts`): `Brand {id,name,sells,status}`, `Deal {id,brand,creator,step,price}`, `TeamMember {id,name,role,roles,status,doing}`, `Creator` (stage, email, kit, reject reasons), `CreatorState`, `Frame.counts` seeded. Example seed: 8 creators (v6 has 37), 5 brands (v6 10), 5 deals (v6 8), 4 team (BUILT same four people: You, Sara, Omar, Lina). Local DB (`main/db/migrations`): `brands`, `deals` (mirror of Supabase with price, payout, invoice sent/paid, payout due/paid, terms, contract status/urls, tracking link, `flow_step`), `channel_state`, `profiles`, `member_access`, `activity_log`, `notifications`, `outreach_drafts/messages/sequences`, `comments`, `_outbox`, `edit_conflicts`. So deals and brands have columns, but the renderer types and IPC read only the four fields above.
By screen:
- Today: tasks are derived (no table): needs the engine over creators, brands, deals, drafts, threads, sequences; new state: `snoozed {key: until}`, `done [{key,title,bucket,at,min}]`, `day {budget, note, wrapped}`, `settings.morning`, handoffs `{key, ref, to, note}`. Local table needed for snooze, done, day, handoff (no table today; `local_settings` key-value could hold day/morning). Estimates per item kind (`est` minutes).
- Brands (Close): v6 fields: cat, country, headcount, recommendedTitle, paidSpenderVerified, pastCampaignHook, budget [lo,hi], contact/role1/email, contact2/role2/email2, status (found, qualified, pitched, negotiating, won, lost), seen [creatorIds], since, site, pitched {at, creators, mode}, seq {steps[], stopped}, owner. DB has: contact_name/email/phone, website, budget (single), category, country, contacts JSON, source, sells, status. Missing columns: headcount, paid_spender_verified, past_campaign_hook, budget range (hi), pitched, seq, seen. Brand outreach uses `outreach_*` tables but those key on creators (verify recipient type).
- Deals (Close, Deliver): v6 fields: step, checks[], price, payout, dealModel (exclusive_25|brokered), videoCount/videosDelivered, cpmRate/cpmCap/viewGuarantee, owner, creatorDeadline, golive, due, deliverable, terms, created, invoice {no,sent,due,paid}, report {due,sent,views,targetViews,clicks,ctr,retentionPct,verdict,makeGoodOption}, paidCreator, payRef, live link, contractClauses[7], redlineFlags[], shipping {required,item,carrier,tracking,shippedAt,deliveredAt,promoCode,utmLink}, scriptApproved, placementWindow, qcChecks[5], hypeCadence {h24,d7,d14,d30}, whitelistingExpiry, neg {ask,offer,rate,floor,hist[]}. DB has: brand_price, influencer_payout, deliverables, deadline, contract status/urls, brand_invoice_sent_at/paid_at, creator_payout_due_at/paid_at, payment_method/reference/terms, tracking_link, flow_step. Missing: checks[], qc, shipping, report, hype cadence, negotiation history, invoice number, clause audit. Need a local migration (settled by ADR 0021 D5: local-only tables or columns, no Supabase change in step P; each wiring step decides its Supabase columns with grants).
- Invoices/payouts: derived from deal columns (no separate entity in v6). Money tab aggregates by month (needs `hist.months` for Insights revenue from invoice paid dates).
- Team: `TeamMember` exists; missing load per person (derived from Today items), VA onboarding steps, shadow-approval flag (settings), `settings.vaMoney` (member_access.sees_money exists), handoff log.
- Insights: `hist.sent/replies` per day (derive from `outreach_messages`), months table, funnel counts (derive from creators by stage), keyword yield (runs; `find` run data exists), channel histogram (derive).
- Creator fields v6 has that the app type lacks: starRating, viewStability (stable/volatile), format (Long-form/Talking-head/Shorts), botRisk {level,note}, trimmedAvgViews, up30 (app has uploads30), subs (app subscribers), relationshipModel, daysSinceUpdate, exclusivityLocks[{cat,brand,until,days}], nextOpenSlot, dreamBrands[], hardNos[], socials, moments[], tags, owner. Gold rule, signals and triage warnings depend on them.
- Mailbox fields: app already has cap, sent, warm-up, bounce, reply, status; v6 spfDkimDmarc, inbox placement (check).
- Engine functions to port into `packages/core` (pure, testable): `items`, `nextFor`, `match`, `priceFor`, `payoutFor`, `buildPackagesFor`, `bestBrandFor`, `phaseCounts`, `tomorrow`, deal `advance` rules (`engine.js:1106`), `problems` (BUILT as selectProblems, compare).

---
## 14. Size estimates (rough, one engineer, includes tests)
| Area | Size | Note |
|---|---|---|
| Today (queue, work pane, focus, wrap, first day, snooze, day band) | LARGE | engine + panels; slice it |
| Deliver Deal board | LARGE | deal model + engine first |
| Deliver Money | MEDIUM-LARGE | after deal model; CSV, PDF modal |
| Close Brands | MEDIUM-LARGE | brand model, qualify form |
| Close Match | MEDIUM | port scoring |
| Close Pitch | LARGE | new draft kind and brand sequence |
| Close Negotiate + Contracts | LARGE | ladder, clause audit |
| Close Roster extras | SMALL | columns, filter, sort |
| Insights | LARGE | charts + 2 planners |
| Toolbox: Price calculator + Notifications tool | MEDIUM | plus master-detail restyle SMALL |
| Team | MEDIUM-LARGE | scope question (step T) |
| Settings: Your day, Agency facts, Team and money | SMALL x3 | |
| Brand record | MEDIUM | |
| Deal record + Dual Deal Room | LARGE | |
| Modals: Media kit packet, Call script, Invoice PDF, QuickDraftDock | MEDIUM-LARGE | |
| Find remaining (signals, triage card, N key) | SMALL | blocked on creator fields |
| Reach remaining (board switch, replies filters, brand rows) | SMALL-MEDIUM | |
| Frame: chord bar, ViewAs bar, Recent in palette, record-page stepping | SMALL | |
| Example data: expand to v6 (37 creators, 10 brands, 8 deals with all fields) | MEDIUM | tests in `example.test.ts` assert sizes |
