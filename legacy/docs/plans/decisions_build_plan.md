# Building the owner's decisions — plan (2026-10-18)

The owner answered the workflow map (https://claude.ai/artifact/LUSLCFTNvQVj3iTVQVJgXJ): 12 decisions and all 34
house choices. This plan builds every one of them except the gaps the owner marked **Noted**, which wait for their
input. Four of the ticked fixes overlap noted gaps (#1 follow-ups, #4 media kit, #10's sponsorship signals, #11
contacts); the owner said on 2026-10-18 to build those now. Still waiting, untouched:

| Noted gap | What it is |
|---|---|
| search-1 | only the latest 15 videos per channel are fetched |
| first-1 | only the Gemini path is checked; other send paths go out unchecked |
| mail-1 | two or more mailboxes break sending (From picker, per-mailbox reply check) |
| mail-2 | no bounce handling or do-not-contact list |

Rules that hold throughout: every outgoing message waits for a person; course-only sources for anything the engine
says; never read the connected mailbox; YouTube only (decision `platforms`); commit only when the owner asks.

## Done on 2026-10-18 (before building)

- Skills for this work, found with `find-skills` and read before install (user level, `~/.claude/skills`):
  `ui-ux-pro-max`, `sentry-security-review`, `supabase`, `supabase-postgres-best-practices`,
  `flutter-fix-layout-issues`, `flutter-build-responsive-layout`, `flutter-add-widget-test`.
- Decision `commit`: the comms work committed (bf6f20b bridge and outreach cards, c6d5d38 comms engine and plans).
- All 34 house choices written to `data/comms/playbook/house_choices.json` (`pick`, the owner's note verbatim in
  `owner_said`, what the drafter applies in `owner_note`, rendered into the skill as "Owner's rule"). Two answers
  were notes, so each got an owner option: HC-05 the owner's CPM table, HC-08 "avoid female creators entirely,
  couples included". HC-01 (2-3 touches) and HC-17 (3-4 follow-ups) meet at **three follow-ups, then stop**.
- Decision `auto-default`: `engine.propose`, `scenarios` and `gradbar` default to variant `auto`.
- Decision `blind-review`: the owner asked for it to be done for them by Claude Opus 5.5 (extra high) in a sealed
  temporary folder; the result is compared with the hidden key afterwards.

## Build order

Each step ends with its tests green (`flutter analyze --fatal-infos`, `dart format`, `flutter test`, pipeline
`pytest`, and `backend/tests/run.sh` when the server schema changes).

### 1. Stop the canned follow-ups (fix #1) and put the follow-up button back where it was
- Sending no longer queues the two canned follow-ups (`_seedFollowUps`, `app_en.arb` 2423-2424) in `mailbox.db`;
  a follow-up only goes out after a person approves its text (in the Comms queue, step 6).
- The "Schedule follow-up" alarm button leaves the composer's action bar and returns to the thread's **Follow-ups**
  section, as in `a8d4a21` (owner's note on `fix-order`), with the next follow-up's due time counting down there.
- Follow-up timing from the house choices: creators 1 working day, then 2 after a stalled exchange (HC-12); brands
  2-3 days, then about 3, then a week (HC-24); never on a weekend (INF-FU-01); at most three (HC-01/HC-17).

### 2. One schema change for everything (local mirror v4 + `backend/schema.sql`)
- `agency_settings` (new synced table, one row): agency name, sender, what we do, website, true claims, past
  campaigns, the incubator line (HC-07), boycott list (HC-09: countries, starting with Israel, and brand names),
  daily target (decision `daily-target`: 50).
- `channel_state.media_kit` (JSON: top three audience countries with %, main age band, engagement, media-kit link,
  rate card rows) and `channel_state.creator_gender` (HC-08), both editable like the other channel fields.
- `channels.found_emails` (pipeline-derived, fix #11) and the existing `sponsored_ratio` / `seen_brands` reach the
  app's view and model.
- `brands`: category, country, contacts (several, HC-25), budget currency, source (seen sponsoring).
- `deals`: payment terms (no default, decision `payment-terms`), tracking link, and two contracts — creator and
  brand — each with link, status and signed date (decision `contract-order`: the brand's contract is the template,
  the creator signs first, the brand after).
- `deliverables`: published date and the 30-day report (views, when fetched, clicks).
- `outreach_threads.brand_id` so a thread can belong to a brand contact.
- `comms_proposals` (new synced table): the Comms queue's items.
- The owner pastes `backend/schema.sql` into Supabase once; until then the sync card says so and nothing is lost.

### 3. Agency facts and roster in Settings (fix #9)
- A Settings card for the facts above; the engine's claim gate reads them instead of test fixtures.
- Mailboxes: daily cap per mailbox, 35 by default, adjustable 10-50 (HC-02), enforced by the send tool and shown as
  "N left today"; warm-up start date and days warmed, 14-day minimum (HC-03; warm-up itself runs in Instantly).

### 4. Creators: pre-screen, contacts, media kit (fixes #10, #11, #4)
- Pipeline: emails from the About text and the stored video descriptions, including spelled-out forms
  ("name (at) gmail (dot) com", "[at]", "at ... dot", spaced or full-width @); stored on the channel; recomputed
  with the sponsorship signals after every fetch and after a channel is pulled from R2; a one-off backfill.
- Profile **Pre-screen** card: views against HC-18 (about 50k average, no cap), uploads in the last 30 days,
  "sponsored in N of 15 videos" with the brand names, country, the creator flag for HC-08, and the gold-mine badge
  (HC-04: no agent, strong views or engagement for their size; after 2-3 good deals, a person may propose exclusive
  management at 20-40%, INF-MGR-05).
- Profile **Contacts found** (one click to add to contacts) and a **Media kit** card with the rate card and a
  **Ready to pitch** flag: analytics held, an agreed rate, audience check against HC-27 (about 30% in the brand's
  countries; 20%+ is fine in tech). Only ready creators can go into a brand pitch (BRD-PRES-15).
- List: filters for has email, sponsored, shortlisted, ready to pitch; right-click Shortlist and Add to campaign;
  Auto-clean preset from HC-18.

### 5. Brands and deals (fixes #5, #6)
- New brand and Edit (contacts, country, category, budget); the boycott check (HC-09) blocks a pitch and says why.
- **Brands seen sponsoring** in Roster: brands found in the creators' videos, how many channels, which, last seen,
  one click to create the brand.
- Start deal from a thread, a profile or a shortlist row, prefilled; price, payout, currency, deliverables, deadline,
  payment terms and links editable, each change logged; the two contracts in the course's order; the channel's stage
  follows its latest deal.

### 6. The Comms queue (fix #3)
- A daemon action `comms_propose` builds the case from `gratovo.db` (thread, creator facts, the latest video and its
  moments, deal, brand, agency facts, recent messages) and calls `engine.propose` (variant auto).
- Subtitles (decision `subtitles`): fetched only when a first email is drafted, stored per video so a redo or a later
  draft reuses them; a separate skill, `gratovo-moments`, picks the usable moments from them.
- Outreach gets a **Comms** view with four sections — New replies, Follow-ups due, Decisions, New outreach — each
  item with its why-line and cited lessons, Send / Edit / Redo / Skip, and a **Steer** panel (the old knobs, kept as
  optional corrections prefilled from what the engine read; a hidden per-case switch for a straight cash offer,
  HC-10). Edited text is re-checked before it goes. "N of 50 today" and the mailbox's "left today".
- When it works end to end: delete `cards.json` and the old skill files (decision `old-files`), keeping the knobs as
  the Steer panel.

### 7. The 30-day report (fix #12)
- Marking a deliverable published records the date; 30 days later My Day asks for the report; one click re-fetches
  the video's views (stored as a snapshot, not overwritten) and builds a one-page result: views, CPM achieved,
  clicks if a tracking link is set; copy for email or save as a page to print.
- After the report, a reminder to pitch the brand its next creator once results are in (HC-19).

### 8. Home
- "N of 50 today" (decision `daily-target`) and "Roster: N of 5 ready to pitch" (HC-16).

### 9. Live checks
- Rebuild and deploy the `gratovo-comms` skill (house choices) and the new `gratovo-moments` skill to both Gemini
  accounts; re-run a sample of the scenario suite on variant auto; one real thread through `comms_propose`.

## Log

- 2026-10-18: plan written; steps 0 done (skills, commits, house choices, auto default); blind review running.
- 2026-10-18: step 1 done and verified (dart format clean, flutter analyze --fatal-infos clean, flutter test 1985
  passed): no follow-up is queued behind any send, the inbox sweep only checks for replies, a send sets the next
  follow-up reminder from HC-12/HC-24 (max three, no weekends), and the thread's Follow-ups card has the alarm button,
  a countdown and "nothing is sent by itself". The composer's planner and the canned follow-up texts are gone.
- 2026-10-18: step 2 started test-first: backend/tests/test_21_decisions_schema.sql. Supabase's changelog: from
  2026-10-30 new public tables are not exposed to the Data API without explicit grants, so schema.sql must grant them
  (authenticated is already granted on every run; a service_role grant is still to be added). Progress ledger and a full handoff:
  .superpowers/sdd/decisions_build_plan/ (progress.md, handoff.md; git-ignored).
- 2026-10-18: step 2 done and verified (backend/tests/run.sh both passes green incl. test_21; flutter test 2000 passed;
  analyze --fatal-infos and format clean). backend/schema.sql section 4.6 (1.4): media kit + creator flag on
  channel_state (editable via apply_channel_edit), brand contacts/country/category/currency/source, payment terms
  (no default) + tracking link + two contracts on deals, publish date + 30-day report on deliverables, brand threads,
  new tables agency_settings (one row) and comms_proposals, both with RLS, touch/tombstone triggers and sync cursors;
  explicit service_role grants. Local mirror v4 (columns, two pulled tables, sponsorship/found-email columns in the
  influencer view). Until the owner pastes schema.sql, queued changes wait (never dropped) and the sync card says to
  paste backend/schema.sql.
- 2026-10-18: step 3 done and verified (flutter test 2027 passed; analyze/format clean; pytest 777 passed + the 2
  known drafting-rules failures). Settings has an Agency facts card (the shared agency_settings row, in the engine's
  own keys; incubator line on per HC-07; boycott starts with IL per HC-09; daily target 50). Each mailbox shows
  "N cold emails a day · N left today" and its warm-up day count (warning under 14 days); the cap (10-50, default
  35) and warm-up date are set per mailbox and kept in this machine's settings.local.json; email_send.py refuses a
  cold email over the cap (daily_cap_reached) and holds due follow-ups for tomorrow; replies are never capped.
- 2026-10-18: step 4 done and verified (flutter test 2071 passed; analyze/format clean; pytest 796 passed + the 2
  known failures). Pipeline: found emails (plain and spelled-out forms) from the About text and stored video
  descriptions, derived with the sponsorship signals on every fetch path and on R2 downloads; backfill run on the
  local database (2373 channels, 866 with a published email). App: Pre-screen card (HC-18 bar, uploads,
  sponsorships, brands, country, HC-08 creator flag, HC-04 gold mine, agent), found emails shown one click from
  Contacts, Media kit card with Ready to pitch (BRD-PRES-15, HC-27), list quick filters (email, sponsored,
  shortlisted, ready), right-click Shortlist and Add to campaign, the HC-18 auto-clean preset, the HC-05 CPM table
  and slider.
- 2026-10-18: step 5 done and verified (flutter test 2114 passed; analyze/format clean). Brands: several contacts,
  country, category, currency and source; New brand / Edit brand form with the HC-09 boycott check shown live, on the
  list and on the profile; "Brands seen sponsoring" (cleaned of promo codes) with one click to a brand record; brand
  threads in the data layer. Deals: Start deal from a creator's Deals card, a thread or a campaign shortlist row
  (refused for boycotted brands and HC-08 creators); terms editable and logged (payment terms have no default); two
  contracts in the course's order (the brand's signature waits for the creator's); the channel's stage follows its
  latest deal; each shortlist row says whether the creator is ready to pitch.
