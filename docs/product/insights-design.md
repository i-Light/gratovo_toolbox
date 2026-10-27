# Insights: the design

Written 2026-10-27 and settled with the owner the same day. Redesigned with the owner on 2026-10-28: the look, and the Search tab around the size of the archive. Their answers are in section 10. It replaces v6's Insights (`design/workbench-v6/js/more.js:128-476`) as the spec for plan step P, part P8.

**The mockups** are in [design/insights/](../../design/insights/README.md): one page and one screenshot per tab and Search view, dark, 1440 px. They are also on the owner's canvas at https://claude.ai/artifact/BHuQ9Y5GU49kzJaRtRqRtD, page "Insights (final)", next to the directions that weren't chosen. Section 2a says how it looks; the rest of this document says what each part does.

## 1. Why this screen exists

The owner asked for an Insights screen that lets the owner, their teammates and outside experts understand the agency's data **without a data analyst**: see whether the business is on track, catch problems early, spot what works, and know what to do next.

So Insights is not a wall of charts. Every part of it answers a question in plain words and ends in an action.

## 2. The rules every part follows

1. **The finding as the headline.** A panel's headline states what the numbers say, written by rules from them: "Two keywords bring almost every signing.", not "Keyword yield". The line under it says what is counted. The tab and the view each still answer one question (the tables below).
2. **A verdict on everything.** Each number carries one of four marks, always as an icon plus a word, never colour alone:
   - **On track** (good)
   - **Watch** (warn): drifting the wrong way, not urgent yet
   - **Act now** (crit): hurting results today
   - **Too early to tell** (muted): not enough data yet, with how much more is needed ("12 of 50 emails")
3. **Compared with something.** Each number is set against (a) your own previous period, (b) your goal from the Goal tab, and (c) a course figure where the course gives one: a reply-rate floor of 4% and about 5 creators signed per 1,000 emails (the owner confirmed both on 2026-10-27). Your own past is the default comparison, since it is always fair.
4. **One sentence that says what it means** under every chart (v6's "take" line), and, when the verdict is Watch or Act now, **what to do**, with a button that opens the exact records behind the number (the Gallery with a filter, the Reach board, the roster, a deal).
5. **Honest about small numbers.** A rate always shows its count ("4.9%, 9 of 182"). Below a minimum (50 emails for reply rates, the course's batch size; 20 for other rates) the verdict is "Too early to tell". A difference between two groups is called **"Clear difference"** only when a simple statistical test agrees (a two-proportion test at 90%). Otherwise it says **"Could be chance, keep going"**. No red alarm ever fires on a handful of emails.
6. **Nothing hidden behind hover.** Every chart has "See the numbers" (a table) and "Copy as CSV" (v6). Every bar or row can be clicked to open the records.
7. **"What is this?" on every number.** A small info button opens a plain explanation: what it counts, how, why it matters, and what good looks like. All of these texts live in the strings file, like every user-facing string.
8. **Made from the real records.** Every number is counted from the app's own records (messages, stage changes, runs, deals, invoices), never from a separate history table. A number and the list it opens therefore always agree. The example data goes through the same code.
9. **Money stays hidden** from anyone who doesn't see money (`seesMoney`). For them the Money tab and every money tile are gone, not greyed out, and the Goal tab speaks in emails and creators, not dollars.
10. **Two reply rates, never mixed up.** The **reply rate of emails** (replies ÷ emails sent, first emails and follow-ups) judges the emails: the Overview tile, the Emails tab, the batches. The **reply rate of creators** (creators who replied ÷ creators emailed) judges the funnel and the planner. Each is always labelled with what it divides by.
11. **Fast.** Each tab is one read, worked out in main. Charts are hand-drawn SVG as in v6 (no chart library).
12. **Safe at any scale** (owner, 2026-10-28). The groups differ hugely in size: about 150,000 archived against 10,000 to be archived and 2,000 live, and the archive keeps growing. No chart puts groups of such different sizes on one scale, because the small ones would vanish. Where they appear together, each gets its own scale (small multiples) and the chart says so, or the number is a rate ("kept per 1,000 found", "1 in 81 finds stays live"). A share bar is used only inside one group.

## 2a. How it looks (owner, 2026-10-28)

The owner rejected a polish of the first mockups ("flat", "boxes in boxes") and chose a redesign: the depth of the "control room" direction, finding-first headlines from the "briefing", and a meaning and an action on every panel from the "spotlight". The mockups in `design/insights/` are the reference.

- **The frame is the app's.** The rail, top bar, page header, period switch and tabs stay as they are. Dark only, Readex Pro only, numbers with tabular figures, no monospace.
- **Raised panels instead of bordered boxes.** A panel is lit from the top (a gradient from `#10293d` to the panel colour, a faint inner top highlight, a soft shadow below), 16 px corners, no border. **Never a box inside a box:** inside a panel, items are separated by space and hairlines.
- **The first panel of a tab is its hero**, with a larger headline (26–28 px). On Search the hero is the flow band (section 3.4).
- **Every panel has the same anatomy:** the finding as the headline, a line saying what is counted, the chart or table, then a footer with one sentence on what it means and at most two actions on the right. "Numbers" (the table and Copy as CSV) and "What is this?" sit at the top right.
- **Verdicts:** a tag (icon and word) in headers and footers; a coloured dot and word in tables.
- **Series colours**, checked for contrast and colour blindness on the dark panel: live `#3a9ad3`, to be archived `#c8711f`, archived `#8a7ae6`, swept by rules `#4a4380`, neutral `#3d5a72`. They are new tokens in `tokens.css`. Status colours (good, warn, crit) mean state only.
- **Charts:** one scale per chart, direct labels where they fit, faint grid lines, 4 px rounded bar ends, hollow dot for "today so far".
- **Big numbers** (30–46 px, semibold, tight letter spacing) only where one number is the answer: the backlog, the deal size, the mailbox room.

## 3. The screen

Header: **Insights** and a period switch (**7 days · 30 days · 90 days · This month**), always compared with the period just before it. On the right: **Copy summary** (a short plain-text report of the Overview to paste to a teammate or an expert).

Six tabs. Each one answers one question.

| Tab | The question | Who it's for |
|---|---|---|
| **Overview** | How are we doing, and what needs me? | Everyone, every morning or week |
| **Funnel** | Where do creators and brands drop out or get stuck? | The owner and whoever runs outreach |
| **Emails** | Are our emails arriving and working? | Outreach |
| **Search** | What are we finding, what do we keep, and what do we throw away? Four views, each with its own question | Scouts and the owner |
| **Money** | Is money coming in, and is it safe? | Money viewers only |
| **Goal** | What do we need to do each day to hit our goal? | The owner; everyone sees the daily targets |

### 3.1 Overview: "How are we doing, and what needs me?"

From top to bottom:

1. **This period in a few sentences.** Generated by rules, not by Gemini, so it is free, instant and testable. Example: "You sent 182 emails, 6 more than the week before, and first emails are on pace for your goal. 9 creators replied (4.9%) and 1 signed. Net revenue is at $7,360, on pace for $8,450 of your $10,000 goal: money trails the work by about two months, and brand pitches are the step falling short. Two things need you now: outreach3 is bouncing, and VoxNote's invoice is 34 days late."
2. **Vital signs:** five tiles, each with its verdict, the number, the change against the previous period, and a small trend line.
   - **Emails sent**, with first emails a working day against the number the Goal tab says you need.
   - **Reply rate** (first emails and follow-ups to creators).
   - **Creators signed per 1,000 emails**, against the course figure of about 5.
   - **Ready to email** ("fuel"): creators with a confirmed address not yet emailed, as days of sending at your current pace. Under 3 days is Watch, under 1 is Act now. It is the earliest warning there is.
   - Money viewers: **Revenue this month**, against the goal, with the pace ("at this pace, $17.4k by 31 Oct"). Others: **Replies waiting for us**.
3. **Needs attention:** the early-warning list (section 4), most urgent first, at most 6 with "Show all". Each line has the verdict, a plain title, why it matters, the evidence in numbers, one button that goes to the fix, and **Hide for 7 days**.
4. **What's working:** up to 3 wins found the same way: the best keyword, the best mailbox, the follow-up step that earns the most replies, the brand that pays fastest. Each win says what to do more of.
5. **The pipeline at a glance:** one line of steps from Found to Paid (Found, Passed your rules, Shortlisted, Confirmed, Emailed, Replied, Kit in, Signed, First deal, Paid), with the count at each step, the share from the step before on the line between them, and how many are stuck there. No bars, so the 162,400 found don't squash the 9 paid. Click a step to open the Funnel tab at that step.

### 3.2 Funnel: "Where do creators and brands drop out, and where are they stuck?"

A switch: **Creators · Brands**.

**Creators:** Found → Kept by your rules → Shortlisted → Address confirmed → Emailed → Replied → Interested → Media kit in → Audience check passed → Signed → First deal → First payout.

- Each row shows: how many, the share that made it from the step above (the bar shows this share, never the count, so the huge first step can't squash the rest), the change against the previous period, **the usual time at this step** (median days), and **how many are stuck** (in the step for more than twice the usual time). A click opens those creators.
- "Passed your rules" is marked **By design**: the rules drop most finds on purpose.
- A second view, **"Only those emailed in this period"**, follows one group forward (a cohort). Recent groups haven't had time to finish, so it says "still running" where that applies.
- **The biggest drop you control** is named in one sentence and marked on its row, with a button. The rules step never counts as it.
- **Why they dropped:** one small breakdown per exit.
  - Rejected in triage: the four reasons (not AI, views, posting, audience).
  - Replied no: what Gemini read in the reply (not interested, has a manager, too busy, wants more money, not now).
  - Audience check failed: which of the four checks failed.
  - Never answered after the last follow-up.
  - The address bounced.
- **How long each step takes:** bars of the median days between steps. Long bars are where work waits.
- **Cohorts** (for experts, folded by default): one row per week of first emails, with the share that replied by day 3, 7, 14 and 30, shaded light to dark. It shows whether recent weeks do worse than older ones.

**Brands:** Found → Qualified → Pitched → Replied → Negotiating → Won → Live → Paid, with the same columns and the reasons brands were lost.

### 3.3 Emails: "Are our emails arriving and working?"

1. **Emails sent and replies per day.** v6's two stacked panels, each with its own scale (two charts, never one chart with two axes), weekends shaded, today hollow.
2. **Which email gets the replies:** the reply rate of the first email and of follow-ups 1, 2 and 3, and each one's share of all replies. It shows whether the follow-ups earn their keep.
3. **What the replies say:** the readings over the period (Interested, Question, Wants their rate, Not now, No, Has a manager, Auto-reply, Bounced), as one bar per kind, and the **positive reply rate**.
4. **Batches of 50** (the course's 50-send check, FND-DLV-22). First emails in send order, cut into batches of 50. Each batch shows bounced, replied, positive and signed, then one diagnosis from three plain rules:
   - **Bounces over 3%:** "Emails aren't arriving. Check the addresses and this mailbox."
   - **Bounces fine, replies under your floor:** "Emails arrive but don't land. The first line or the video moment isn't working."
   - **Replies fine, few positive:** "People answer but say no. Look at who you pick, or the offer."
   - Otherwise **Healthy**.

   **Replies are tracked; opens and clicks are not** (owner, 2026-10-27: "only for replies" unless another kind is sure not to hurt delivery). A reply comes back in the same thread, which the app already reads (step 6d), so tracking it changes nothing in the email. Opens need a tracking pixel and clicks need rewritten links. Both change the email itself, spam filters weigh them, and opens are unreliable anyway, since many mail apps load images on their own. Nobody can promise that's safe, so neither goes in (v6 showed open rates). Bounces and replies are enough to tell the three problems apart.
5. **Mailboxes:** each one's sends, bounce rate, reply rate and verdict, plus **capacity used**: what you sent against what the mailboxes allowed. Unused room is lost sends.
6. **What helps replies (patterns):** the reply rate split by things the app already knows. Only splits with enough data show, the clearest first.
   - The draft was edited by a person, or sent as written.
   - Which rewrite was used (Shorter, Warmer, More direct, New angle).
   - The creator's size (median-view bands).
   - The creator's main country.
   - The keyword that found them.
   - The day of the week, and the hour in the creator's own time.

   Each split says "Clear difference" or "Could be chance", and a clear one comes with "Try this".
7. **How fast we answer:** the median hours from a creator's reply to our answer, and how many waited over a day.

### 3.4 Search: "What are we finding, what do we keep, and what do we throw away?"

The owner asked (2026-10-27) for this tab to cover the whole catalog, live and archived, and (2026-10-28) for it to be designed around one fact: **the archive is always far bigger than the rest.** A real catalog holds something like 150,000 archived, 10,000 to be archived and 2,000 live channels, and the archive grows by thousands a week. So:

- **Search opens on the Live view,** where the work is. The archive is a memory you query, not a place to browse.
- **Each view answers its own question with its own panels.** Archived channels will never be shortlisted, emailed or signed, so the Archive view never shows those steps. It is not one set of cards with a filter applied.
- **Nothing puts the views on one scale** (rule 12). Keywords are judged by **kept per 1,000 found**, never by a bar of "where their finds are now", which at this scale would be solid archive colour.

The views, as the app already stores them:

| View | What is in it | Where it lives today |
|---|---|---|
| **Live** | In the catalog and not rejected: not reviewed yet, shortlisted, in outreach, signed, parked, never contact. | `pipeline.db` `channels` joined to the creator stage |
| **To be archived** | Rejected by a person and waiting out the archive days (Settings, 7 by default). They can still be brought back. **Rejected before dates were kept** is its own group: those are never swept (`archiveDate` returns null). | The creator stage `rejected`, `archive_due_at`, the reject reason in the log |
| **Archive** | Tombstones, split by **how they got there**: rejected by a person after the countdown, or **swept by your search rules** (the auto-clean gate: too few or too many subscribers, the signal bounds) before any person saw them. A tombstone keeps every fact, so the panels still work. | `channel_archive`, with `label` (`rejected` or the rule's label), `archived_at`, `found_via`, and the frozen numbers |
| **Everything** | All three together, for the catalog-wide picture. | All of the above |

#### The flow band (the hero of every view)

The owner chose it from three options on 2026-10-28. It is one wide raised panel, and its left part changes with the view. Its right part is the view switch: a list of the four views, each with its count and **the question it answers**, so you know what you'll learn before you switch. The flow is drawn as circles joined by arrows. Each circle is sized by the square root of its count, between a minimum and a maximum radius, so small groups stay visible. Every circle opens its channels, and steps with work carry their action ("Review →").

| View | Its question | The flow | Headline (example) | Footer (example) |
|---|---|---|---|---|
| Live | Where is the work? | Not reviewed → Shortlisted → In outreach → Signed, with "Set aside: 70 parked · 104 never contact". "Not reviewed" is in amber. Actions: Review, Draft emails, Open Reach, Roster. | "2,000 live channels. 340 wait for your review." | Joined and left Live this week; how much faster searches add than you review. Button: Open Live in Find |
| To be archived | What leaves, and what should I rescue? | Waiting (10,200) → one circle per day for the next 7 days, sized by how many leave that day, tomorrow highlighted → Archived (a dashed circle). A green branch: "37 look like mistakes · fit 85 or more · 9 leave tomorrow · Bring back". A dashed branch: "1,200 have no date and never leave on their own". | "10,200 leave for good this week. 37 look like mistakes." | The top reject reason and what it says about the keywords. Button: Open the archive |
| Archive | How did they get here, and what leaks back out? | Two ways in: **swept by your rules** (with the rule reasons) and **rejected by a person** (after the 7 days) → the Archive → two ways out: **found again this week** (wasted search results, amber) and **brought back** in 30 days (green), with how many of those replied. | "150,200 archived. No person saw 94% of them." | How fast the archive grows, and how much of that is the rules. Button: Search the archive |
| Everything | How does the catalog split? | Found → swept by your rules / passed your rules → rejected by a person (split into waiting and archived) / Live. | "Of 162,400 found, 1 in 81 is live." | How much of the work the rules do before anyone looks |

**"Likely mistakes"** are rejected channels still waiting whose fit score (`packages/core` fit, as in Find) is 85 or more. With thousands leaving a week nobody can look at them one by one, so the app picks these out.

#### The panels under the band

**Live**
1. **Joining and leaving Live:** channels kept from review against channels that left Live (rejected later, parked for good, never contact), week by week for 12 weeks, as paired columns.
2. **The review backlog:** not reviewed, the oldest one's age, found a day against reviewed a day, and how many days the backlog lasts at that pace (Watch over 5). Button: Review now.
3. **Keyword scorecard:** the keywords that found the most live channels (6, with "All N keywords"): found, **kept per 1,000 found** (a bar), live now, emailed, replied, signed, and **Keep, Watch, Drop** or **Too early**. Sortable; each row opens its channels. The footer names the best keywords and the one to drop, with a button.
4. **Addresses:** found and confirmed (shares of shortlisted), where they came from (About page, a video, typed), the usual time from shortlist to confirmed, and how many wait to be confirmed (the fuel's source). Button: Confirm N.
5. **Can we trust the numbers?** Live channels not read yet, couldn't be read (retrying, given up after 3 tries), and with no audience country. Unknown is shown as unknown, never 0 (step 5d-2). Button: Read them again.

**To be archived**
1. **The likely mistakes:** the ranked list: the channel, why it was rejected, its fit (a bar), median views, and when it leaves (tomorrow in amber). Buttons: Open all N, Bring back all N.
2. **Why they were rejected:** the reasons (not about AI, too few views, not posting enough, audience outside, and bot or fake engagement once P3 adds it), with the keywords behind the top one. If most are "not about AI", the keywords are too broad, and the footer says so.
3. **Second looks:** channels brought back in 90 days, by why they left, and what happened after (emailed, replied, signed). If one reason's channels keep replying or signing once brought back, that rule may be too strict.

**Archive**
1. **The archive search**, directly under the band: find any archived channel by name, handle or the keyword that found it, then bring it back.
2. **Live, to be archived and the archive over 12 weeks:** three small charts side by side, **each with its own scale**, each with its count and change ("+180 in 12 weeks", "+58,000 in 12 weeks").
3. **Searches that re-find the archive:** each keyword's last run split into new, already live and already archived (`archive_keyword_pending`, `found_via`). Over 80% already known is worn out. Button: Get new keyword ideas.
4. **Why channels were archived:** your rules' sweeps by rule, and people's rejects by reason, each group with its own scale.
5. **Archived channels against live ones:** the usual channel in Live, To be archived, Archived by a person and Swept by rules: median views, uploads in 30 days, subscribers, has sponsors, audience in your markets, address found. "Not known" where a tombstone never had it. If the archive starts to look like Live, the rules are too strict.

**Everything**
1. Live, to be archived and the archive over 12 weeks (as in Archive).
2. The keyword scorecard (as in Live).
3. Archived channels against live ones (as in Archive).

Never contact has no panel of its own: it is a step in the Live band ("Set aside"), and its list is in Toolbox.

### 3.5 Money (money viewers only): "Is money coming in, and is it safe?"

1. **Revenue by month** (v6), the current month paler with its projected end dotted, and a line at your goal.
2. **Owed to us:** unpaid invoices by age (not due yet, 1–30 days late, 31–60, over 60, all Net 30), the late ones listed with Open deal, and how many days each brand usually takes to pay.
3. **Owed by us:** creator payouts, locked until the brand pays, with the next due dates.
4. **Margin:** each deal's margin against your floor, with the deals under it listed.
5. **Deal size:** the average deal price over time, and the price per 1,000 views.
6. **Too much in one basket:** the share of the last 90 days' revenue from the top brand and from the top creator. Over 40% is Watch.
7. **Who on the roster earns:** each signed creator's deals, revenue and last deal date. **Idle**: signed with no deal in 60 days, with Pitch them.
8. **Where deals slow down:** the median days at each of the 10 deal steps, and the deals stuck now.
9. **Repeat business:** the share of brands that came back for a second deal, and finished reports with no next deal proposed.
10. **Did videos deliver:** views at 30 days against the creator's usual views, from the 30-day reports. It is the case for the next deal.

### 3.6 Goal: "What do we need to do each day to hit our goal?"

The reverse funnel planner (FND-DLV-21), done properly.

1. **Your goal:** monthly net revenue (money viewers). Others see the goal only as daily targets, in emails and creators.
2. **The rates it uses:** for each step, **your own rate** over the last 90 days when there is enough data, labelled with its count ("yours: 4.9%, 61 of 1,240"). Otherwise the course figure, or a marked starting guess. Any rate can be overridden. v6 used fixed multipliers (×12, ×16), which this replaces.
3. **The chain**, from the goal back to a working day: net revenue → bookings → deals won → brand pitches → new creators signed → creators who reply → creators to email (first emails; their follow-ups follow by themselves) → channels to triage → channels to find, and then **per working day**: first emails, brand pitches and channels.
4. **Against your pace:** every line shows what you actually do, marked **On track** or **Short by N a day**. The card's sentence names **the step falling short**. In the mockup's example the creator outreach is enough and brand pitching is the gap, which no single chart would show.
5. **Mailbox room:** the mailboxes' daily total against the emails needed: "add a mailbox", or "you have room for 14 more a day".
6. **The biggest lever:** the one improvement that cuts the daily work most, worked out for each lever (reply rate +1 point, signing rate +5 points, deal size +$500, brand close rate +5 points). Example: "Raising replies from 4.9% to 5.9% cuts emails needed from 64 to 54 a day." For a non-expert, this is the most useful number on the screen: it says where to put effort.

The goal is kept as a local setting. It feeds the Overview's revenue tile and the alerts.

## 4. The early-warning list

Pure rules in `packages/core/src/insights/`, each with a test. Every rule has a minimum sample, so it can't cry wolf. The thresholds that are business choices sit in **Settings › Agency facts** with their defaults.

| Rule | Mark | Fires when (default) | The button |
|---|---|---|---|
| A mailbox bounces | Act now | Over 3% of its last 7 days' sends, 20 sends or more (the slowdown rule already in the app) | Open Mailboxes |
| Replies fell | Act now | The last batch of 50 is under the reply floor (4%) and clearly under your usual rate | Open Emails › Batches |
| Running out of creators to email | Act now under 1 day, Watch under 3 | Fuel, in days at your pace | Open the search |
| An invoice is late | Act now over 30 days late, Watch from 1 | Net 30 passed | Open the deal |
| A payout is due | Watch | The brand has paid and the creator hasn't been | Open Money |
| A deal is stuck | Watch | More than twice the usual time at its step | Open the deal |
| Replies keep falling | Watch | 3 batches in a row each lower, with at least 150 emails | Open Emails |
| Mailbox room unused | Watch | Under 60% of capacity used over 7 working days | Open the Goal tab |
| A keyword is weak | Watch | 50+ found and its funnel clearly under the rest | Open the keyword scorecard |
| A keyword is worn out | Watch | Over 80% of its last run already known | Open the search |
| Behind the monthly goal | Watch | The month's pace ends under 90% of the goal | Open the Goal tab |
| A step is short of the plan | Watch | A Goal line's last 30 days is under 80% of what is needed a day | Open the Goal tab |
| Too much in one basket | Watch | Top brand over 40% of 90 days' revenue | Open Money |
| An idle roster creator | Watch | Signed, no deal in 60 days | Pitch them |
| A deal under the margin floor | Watch | Margin under the floor in Agency facts | Open the deal |
| No search in a week | Watch | No run for 7 days and fuel under 5 days | Open the search |
| Review backlog growing | Watch | New finds not reviewed would take over 5 days at your triage pace | Open Review new |
| Searches re-find the archive | Watch | Over 30% of a keyword's last run was already archived | Open the keyword scorecard |
| Likely mistakes leave soon | Watch | Rejected channels with fit 85 or more leave for good within a day | Open the To be archived view |
| Rejects may be too strict | Watch | 10+ brought back for one reason in 90 days, and some of them later replied or signed | Open Second looks |
| Many channels can't be read | Watch | Over 5% of live channels couldn't be read | Open Can we trust the numbers |
| The same audience check keeps failing | Watch | One check fails in over half of 10+ checks | Open Search rules |

Wins (What's working) use the same machinery, the other way round: a "Clear difference" for the better.

Later, not in P8: the Act now alerts could also feed Today's problems bar.

## 5. Data: where every number comes from

| Numbers | Source today | Needs |
|---|---|---|
| Sends, replies, readings, bounces, follow-up steps, mailboxes, edits, rewrites | `gratovo.db` outreach tables (step 6) | Nothing new |
| Keywords, runs, found, kept, known before | `pipeline.db` runs and keyword links (step 5) | Nothing new |
| The archive: what is counting down, what is archived, by a person or by a rule, re-found by a search, brought back, read failures | The creator stage and `archive_due_at`, `channel_archive` (its `label`, `archived_at`, `found_via`), `archive_keyword_pending`, `read_failures`, the log's `creator.restore` lines (step 5) | Nothing new, except the catalog over time, which needs a weekly count: kept as a small local table of weekly totals, written by the sweep (a tombstone has `archived_at`, but a live channel's history isn't kept) |
| Median views, countries, reject reasons | The catalog and the log | Nothing new |
| Likely mistakes (rejected channels still waiting, fit 85 or more) | The fit score in `packages/core/src/find`, read for rejected channels | Nothing new; at archive scale, rank in main and send only the top ones |
| Joining and leaving Live each week | `stage_events` (below) | Comes with `stage_events` |
| Kits, audience checks, signed | Step 8 part 1 | Nothing new |
| **When a creator entered each stage** | Only partly: the log records shortlist and reject, the messages record emails and replies | **A local-only `stage_events` table** (creator, stage, time), written on every stage change from now on and filled backwards from the log and the messages where the time is known. Without it, "usual time at a step" and "stuck" can't be counted |
| Brands, deals, deal steps, invoices, payouts | P1 (local tables), P5–P7 (the screens) | P1 first; deal step times need a `deal_events` table in the same pattern |
| The goal, hidden alerts | — | Local settings |

Everything new is local only (ADR 0021 D4): no Supabase or sync change.

Main computes a typed **`InsightsReport`** for a tab and period (`insights:read`, contract in `packages/ipc`). The maths (rates, the test, batches, the planner, the alert rules) is pure functions in `packages/core/src/insights/`, unit-tested.

**The example history.** Today the example data is a snapshot of one day: some creators, drafts, a few emails from the last days, and no runs, deals or invoices from the past. Insights looks back over weeks and months (revenue by month, weekly cohorts, the catalog over time), so in prototype mode almost every chart would be empty. P8 therefore makes up a believable past for the example data: six months of searches and keyword runs, channels found, rejected, counted down and archived (some by your rules), emails and replies day by day, signings, deals with their steps, invoices and payouts. It follows the same rules the real app follows, so the numbers agree with each other and with the records they open. All of it stays in the AI niche, **at the real scale** (owner, 2026-10-28): a catalog of about 160,000 found, 150,000 archived (most swept by rules), 10,000 to be archived and 2,000 live. Seed the archive as aggregate tombstones fast enough to load, not 150,000 hand-made records. In the scenarios, "First day" has no history and shows the empty state. "A week later" is the same history a week on. "Something broke" adds what fires the alerts: a bouncing mailbox, a late invoice, low fuel and a big review backlog.

## 6. Prototype mode and live mode

**Prototype mode shows the whole of Insights, exactly as the finished product:** all six tabs, every card, all four views of Search, on example data (owner, 2026-10-27: "showing the full product … without relying on real data"). It is the same screen live mode uses, not a copy (ADR 0021 D1).

**Live mode shows the parts with real data as soon as they are built** (owner, 2026-10-27), before step 9: Overview (without money), Funnel › Creators up to Signed, Emails, Search (all four views) and Goal in emails and creators. Money, Funnel › Brands and the deal parts stay behind the live gate until steps 8 and 9 wire them. Inside a live tab, a card whose data isn't wired is hidden, not shown empty (ground rule 9).

## 7. Not in this design

- Open or click tracking.
- Summaries written by Gemini: rules write the text (free, instant, testable, no Gemini quota).
- A custom report builder or a link to BI tools: CSV per table and Copy summary are enough.
- Per-person results ("Insights per person", parity §6): step T. The design leaves room for a "Whose work" filter.
- Instagram and TikTok; the light theme; narrow widths.
- Forecasting beyond the month's pace and the planner.

**What would make it a failure even if it works:** a wall of charts with no verdicts; a rate without its count; alarms on tiny samples; a number that disagrees with the list it opens; anything an owner who isn't an analyst can't read in ten seconds.

## 8. Where it differs from v6 (for the owner)

| v6 | This design | Why |
|---|---|---|
| One long page | Six tabs, each one question | Easier to read and to point a teammate at |
| Open rates in the 50-send batches | Bounces, replies and positive replies | Replies only: a pixel or rewritten links can't be promised safe for delivery |
| Search: keyword yield and two charts | Four views, each with its own flow band and panels, opening on Live | The owner asked to see what we keep and what we let go, and the archive dwarfs the rest |
| Bordered cards in one flat stack | Raised panels, finding-first headlines, a meaning and an action on every panel | The owner found the first look flat (2026-10-28) |
| Planner with fixed multipliers | Your own rates, the course figure, or a marked guess | The plan should match your real business |
| Keyword yield for today's run only | Every keyword, through the whole funnel | A keyword is only good if its channels reply and sign |
| Titles with framework codes ("FND-DLV-21") | Plain questions | The owner's rule: plain words |
| A history blob separate from the records | Counted from the records | Numbers and lists always agree |
| No alerts or actions | The early-warning list, What's working, a button on every Watch | Numbers should end in an action |

## 9. Builder's calls (made in this design, open to change)

- The tab names and order.
- The minimum samples: 50 for reply rates, 20 for other rates; the 90% test.
- "Stuck" is twice the usual time at a step.
- Fuel's levels: under 3 days Watch, under 1 Act now.
- The levers' step sizes in the planner.
- The alerts' default thresholds, all editable in Agency facts.
- Search shows the top 6 keywords with "All N keywords"; likely mistakes are fit 85 or more.
- The flow band sizes circles by the square root of the count, between a minimum and a maximum radius.
- The series colours in section 2a.

## 10. The owner's answers

On 2026-10-27:

1. **Tracking:** replies only, unless another kind is sure not to hurt delivery. No other kind is sure, so it is replies only (section 3.3).
2. **When:** P1 first, then Insights (P8), ahead of P2 to P7. Insights is part of the app's prototype mode as the full product.
3. **Live early:** yes, for the parts with real data. Prototype mode always shows the full product (section 6).
4. **Course figures:** the 4% reply-rate floor and about 5 signed per 1,000 emails are course numbers.
5. **Search** covers the whole catalog, with views for live, to be archived and archived for good (section 3.4).

On 2026-10-28:

6. **The look:** the first mockups were "ugly" and "flat", and a polish didn't fix it. The owner wanted a real rethink of the UI and the UX, and chose the mix in section 2a after seeing three directions.
7. **The scale:** "the archived will always be a huge ratio": about 150,000 archived against 10,000 to be archived and 2,000 live. Every part is designed around it (rule 12, section 3.4).
8. **No shared map across views:** a "zoom ladder" at the top of every Search view was rejected. Each view answers its own question; archived channels never show steps they can't reach.
9. **The flow band** (option 2 of 3) is the top of every Search view.
10. **When:** P8 builds this design, right after P1.
