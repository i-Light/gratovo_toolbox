> Build notes from 2026-10-19, kept for history. They were written when the prototype lived in a scratch folder named `wb/`; that folder is now `design/workbench-prototype/`, and `../shots_wb/` means any folder you choose for screenshots. The current state is in [../README.md](../README.md) and [docs/handoff.md](../../../docs/handoff.md).

# Workbench prototype — build plan

## Goal
A clickable prototype that makes the deep UX plan visible: Version A's pipeline (rail of IMA phases with boards and records) plus Version B's Today, deepened with feedback, undo, keyboard flow, background jobs, safety gates, team handoffs and a Plan page that explains every decision ("Why" pins).

## Acceptance (whole prototype)
- Every screen and tab renders with example data and no console errors (`python test/smoke.py <screen>`).
- Every record row opens the peek panel; every action gives a toast with what happened + Undo where reversible.
- Works at 1440×900 and at 400px wide without sideways page scroll; light and dark both readable.

## Contracts (already built — use, don't change)
- Data shapes: see `js/data.js` (creator, brand, deal, draft, thread message, run, notif, team, mail).
- Creator stages: new, shortlisted, contact, emailed, replied, kit, signed, rejected, parked, never.
- Brand status: found, qualified, pitched, negotiating, won, lost.
- Deal: `step` index into `W.DEAL_FLOW` (0 Negotiate … 9 Next deal), `checks[]` for the current step, `invoice{no,sent,due,paid}`, `paidCreator`, `neg{ask,offer,rate,floor,hist}`, `report{views,clicks,ctr,due,sent}`.
- Actions (`js/engine.js`, `W.A`): sendDraft, confirmGate, editDraft, setMailbox, steer, skipDraft, snooze, handOff, assign, shortlist(ids), reject(ids, reason), restore, never, confirmEmail(cid, email), saveFact, pasteReply, sign, declineKit, park, qualify(bid, patch), notFit, draftPitch(bid, cids), counter(dealId, amt), tick(dealId, i), advance, sendInvoice, markPaid, nudge, payCreator, sendReport, startRun(runId), pauseRun(runId).
- New actions a screen needs: define them in your own file as `W.A.<name> = function(){ W.act(label, fn, {ref, toast}) }`.
- Screen UI state namespace: `W.U().<screen>` (find, reach, close, deliver, insights, toolbox, team).

## Tasks

| id | title | tier | files | status |
|---|---|---|---|---|
| T1 | core, data, engine, ui, records | H | js/core.js js/data.js js/engine.js js/ui.js js/records.js | done |
| T2 | shell + Today | H | js/app.js js/today.js index.html | done |
| T3 | Find screen | H | js/find.js | done (built in the main session after the agent hit the usage limit) |
| T4 | Reach screen | N | js/reach.js | done |
| T5 | Close screen | N | js/close.js | done |
| T6 | Deliver screen | N | js/deliver.js | done |
| T7 | Insights, Toolbox, Team | N | js/more.js | done |
| T8 | Plan page + Why layer | H | js/plan.js | done |
| T9 | Integrate, review, polish | H | all | in progress |

Done-check for T3–T7: `node --check js/<file>.js` passes; `python test/smoke.py <screen> --shots ../shots_wb/<screen>` prints "no errors"; one look at each screenshot shows no overlap, clipping or empty areas; `--wide 400` shows no sideways scroll.

### T3 Find (`W.screens.find`, tabs search · triage · gallery · contacts)
Header: `W.PageHead` "Find creators", sub about searching YouTube and qualifying; right side shows today's run status (Running / Paused at keyword 9 of 24) with Resume/Pause. Tabs with `W.Tabs` hue `var(--find)`, counts: triage = new creators, contacts = shortlisted.
- **Search (console)**: run `r3` from `W.D().runs`. Left: keyword list (index, query, status: done ✓ with "14 found · 4 kept" and a tiny kept-rate bar; running with spinner; queued) with row actions Start here (set cur), Redo, Remove (all via W.act, undoable). Keywords also in `W.D().mateRun.kws` show a tag "Omar is searching this · will be skipped". Paste-many textarea + Add (dedupe; toast "Added 5 · 1 was already there"). "Suggest with Gemini" opens an inline panel of 8 AI-niche keyword suggestions with checkboxes and "Add selected". Right: rules card (chips for countries, min median views, min uploads, per keyword, archive days; "Edit rules" opens an inline form bound to `W.D().rules` through W.act); live panel: status line, `W.Meter` progress cur/total, 4 counters (channels found, kept by rules, archived, videos read), log (mono, newest at bottom) — all update live while the run is going (`W.A.startRun("r3")`, `W.A.pauseRun("r3")`; the engine ticks it). Teammate card for `mateRun`. Runs table (when, who avatar, keywords, found, kept, gold) with "Review results" → triage tab.
- **Review new (triage)**: `W.Triage` with creators in stage new, gold first then fit. A line above: "12 new · 5 look like gold mines" and a button "See them as a gallery" (gallery tab filtered to New).
- **Gallery**: the owner's favourite tool — filter channels by picture and latest video. Left facets (sticky, ~220px): Stage (multi), Signals (Gold mine via `W.gold`, Sponsored before, Has email, Email confirmed, Never emailed), Top-3 country chips (US GB CA AU IN), Median views at least (Any/25K/45K/80K), Uploads in 30 days (Any/3+/5+), Owner (team + nobody), Run. Each option shows its count. Toolbar: text filter (name, handle, video title, sponsor), sort (Fit, Median views, Subscribers, Recently found, Latest upload), Seg Gallery/Table, Seg S/M/L card size (`--card-w` 210/260/330), toggles Pictures / Latest video / Signals. Active filters as removable chips + Clear all; "Save view" stores named views in `W.U().find.views` and lists them as chips. Cards `.gcard`: `W.Thumb` of the latest video with the stage tag top-right; hovering the left/middle/right third of the thumbnail shows video 1/2/3 (scrub dots at the bottom); select box top-left (shift-click selects a range); body: avatar, name, handle · subs, one stats line (median · uploads · top country), signal tags (Gold, sponsor names, Email ✓), `W.Fit`. Click → `W.peek("creator", id, visibleIds)`. Bulk bar (`.bulkbar`) when selected: count, Shortlist, Reject (reason select), Assign to (menu), Compare (2–4), Clear. Compare shows an inline side-by-side panel above the grid (thumb, stats, countries, fit parts) with close. Table view: sortable columns. Empty state with "Clear filters".
- **Contacts**: creators in stage shortlisted. One card each: avatar, name, handle, a line on where the email came from, `W.ContactBlock`. Top: "Confirm all 90%+ addresses (N)" that confirms each top candidate ≥ 0.9.

### T4 Reach (`W.screens.reach`, tabs board · sequences · inbox · mailboxes)
Header "Reach out"; mailbox capacity summary on the right (sends left today across mailboxes).
- **Board**: lanes `.board/.lane/.kcard`: To draft (stage contact with no draft), Waiting for you (non-reply drafts), In sequence (emailed; next follow-up due chip), Replied (replied, reply drafts), Media kit in (kit), Signed (signed; first 6 + "and N more"). Each card: avatar, name, one sub line, due/age chip; click → peek. Lane header: count + one-line hint.
- **Sequences**: a timeline grid. Rows = creators with `seq` (emailed, replied, parked). Columns = days from 14 days ago to 14 days ahead, today highlighted, week separators. Dots: sent (filled reach colour), due today (warn ring), planned (hollow), skipped (×), reply (good colour) at the date of their last incoming message. Row label: avatar + name; right: next step text + a ⋯ menu (Send the due follow-up → go to Today with that item selected; Stop the sequence via W.act). Legend. Tooltips on dots (`data-tip`) with date and step. Sorted by next due. Horizontal scroll inside its own container on narrow screens.
- **Replies (inbox)**: filters (All, Needs an answer, Interested, Not now, Talks price) by `ai.intent` text. Left list: avatar, name, intent tag, first line of the message, age; right: `W.Thread` (+ AiRead) and the `W.DraftCard` for that record if a reply draft exists, else "Answered · waiting for them". Works for brands too.
- **Mailboxes**: card per mailbox with address, status tag, sends meter, warm-up progress, bounce %, reply %, inbox placement x/10, the note; actions: daily cap stepper (W.act on `cap`), Send a test (toast), Pause sending (toggle `paused`). One callout explaining the auto-slowdown rule (bounces over 3% → 20/day until under 2%).

### T5 Close (`W.screens.close`, tabs roster · brands · match · pitch · negotiate · contracts)
Header "Close".
- **Roster**: signed creators as a table: avatar+name, rate, median views, audience top 3 (`W.Countries` compact), active deals, last go-live, best next brand (`W.bestBrandFor`) with a "Pitch" button → pitch tab with that brand. Plus creators in stage kit shown above as "Waiting for an audience check" with `W.AudienceCheck` in an expandable row.
- **Brands**: kanban by status found → qualified → pitched → negotiating → won (lost behind a toggle). Card: `W.BAv`, name, sells, budget, "seen with N", and the next step from `W.nextFor`. Click → peek. "Add a brand" inline form (name, sells, website) → new brand in found via W.act.
- **Match**: matrix of brands (qualified, negotiating, won) × signed creators. Cell = `W.match(b,c).score`, background shaded on one hue by score (color-mix of `var(--close)` with the panel), warning icon when `warn` is non-empty, tooltip with `why` + `warn`. Click a cell → pitch tab with that brand and creator preselected. Legend for the shade.
- **Pitch**: brand picker (qualified + won) then `W.PitchPicker`. Below: pitches waiting to be approved (drafts kind pitch) with "Review in Today" links (set `todaySel` to `"send:"+id`).
- **Negotiate**: deals at step 0. For each: header (brand × creator), `W.Ladder` when `neg` exists, else `W.DealChecklist`; link to the brand thread (peek brand).
- **Contracts**: deals at step 1 with `W.DealChecklist`, plus a "documents" list (brand's contract received date, creator version, signatures) that makes the order visible: creator signs first, then the agency.

### T6 Deliver (`W.screens.deliver`, tabs board · money)
Header "Deliver and get paid".
- **Board**: 10 columns for `W.DEAL_FLOW`; header: name, count, total value. Card: deal name, owner avatar, due chip, checklist progress meter (done/total), lock icon when Pay creator is waiting on the brand. Click → peek deal. Filters: Mine / Everyone; Late only.
- **Money**: four tiles (Invoiced this month, Collected, Outstanding, Owed to creators). An aging bar (Not due · Due within 7 days · Late) built from invoices. Receivables table: invoice no, brand, amount, sent, due, Net 30 meter, status tag, action (Send invoice / Remind / Mark paid). Payables table: creator, amount, brand paid?, state (locked/unlocked/paid) with lock icon, action (Pay). Use `W.A.sendInvoice`, `nudge`, `markPaid`, `payCreator`. Explain the money order in one short line: creators are paid from money already received.

### T7 Insights, Toolbox, Team (`W.screens.insights`, `W.screens.toolbox`, `W.screens.team`)
- **Insights**: period Seg (7/30/90 days). Tiles: emails sent, reply rate, signed per 1,000 emails vs the course benchmark of about 5, revenue this month, average margin. Charts in plain SVG following the dataviz rules: one axis, thin marks, 2px lines, legend for 2+ series, hover tooltip with crosshair on the line chart, direct labels on ≤4 series, a "See the numbers" table toggle per chart. Series colours (validated): light `#0079ba` / `#cf6d14`, dark `#3a9ad3` / `#c8711f` — define them as tokens in `W.css` with the dark-theme blocks (`@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){…}}` and `:root[data-theme="dark"]{…}`). Charts: emails sent and replies per day (`W.D().hist`), funnel (found → shortlisted → emailed → replied → signed → deals, one hue), revenue by month (`hist.months`, bars), keyword yield table for run r3 (found, kept, kept-rate tier), channel analytics: median-views histogram and top-country bars across all creators where clicking a bar opens Find › Gallery filtered (set `W.U().find` facets then `W.go("find","gallery")`).
- **Toolbox**: two panes. Left: a list (not a card grid) of tools with one-line descriptions; right: the open tool. Tools: Price calculator (median views, niche CPM range, your CPM, markup → brand price, creator payout, margin), Archive (rejected creators with "archived in N days" and Bring back = `W.A.restore`), Never contact list (stage never), Scheduled emails (thread messages with `scheduled`), Activity log (`W.D().log`, filter by person), Notifications (`W.D().notifs`), Writing rules (house rule IDs with one-line meaning), Agency facts (audience rules, margin floor, send window; editable via W.act), Setup health (Gemini bridge, Python pipeline, Gmail accounts, team sync, updates — status tags).
- **Team**: people cards (avatar with presence, role, doing now, today's load from `W.items("team")` with a meter, done today), handoffs (`W.D().handed`), a permissions table (Owner / Account manager / VA: what each can see and do; VAs don't see money — marked as an open decision), and a "Rebalance" action that hands quick-win items from the busiest person to the least busy (confirm inline, then `W.A.handOff` per item).

