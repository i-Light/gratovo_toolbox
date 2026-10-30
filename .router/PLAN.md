# Step P: the full prototype (working plan)

Owner's request, 2026-10-27. Decisions: [ADR 0021](../docs/decisions/0021-full-prototype.md). The step's text and its parts: migration plan, step P. The gap list and the conflicts with what's built: [GAPS.md](GAPS.md) (v6 file:line references for every item).

## Goal

Prototype mode is the full app: everything in `design/workbench-v6/` (as the owner settles it) on example data, in every scenario. Live mode shows what it showed before, plus Today from P4 and the ADR 0021 D6 additions to screens already wired; anything that needs data live mode doesn't have yet stays behind `liveWired`.

## Non-goals

- v6's Plan page, design-notes layer, layout switcher, demo reset and JSON export; the light theme; Talent Managers.
- The four gaps on hold (`search-1`, `first-1`, `mail-1`, `mail-2`).
- Supabase or sync changes. The real R2 sharing, hand-off sync and teammates' runs (step T).

## Decisions (step level)

- **D1. Built once.** Each piece is the real screen with its real local logic. Pure rules go to `packages/core` with unit tests; storage and anything with side effects go to main behind IPC (`packages/ipc` contracts first); screens live in `apps/desktop/src/renderer/<screen>/`. Copy the patterns of `close/` (ADR 0020), the most recent screen.
- **D2. The live gate decides what live shows** (`renderer/lib/wired.ts`). A part adds to `liveWired` only what reads and writes real data.
- **D3. The no-drift check** (P1): a Vitest test walks `apps/desktop/src/renderer/**` and fails when a file outside the allowlist imports `lib/prototype`. The allowlist is ADR 0021 D3's: `prototype/**`, `lib/prototype*.ts`, `app/start.tsx`, `app/app.tsx`, `app/top-bar.tsx`, `overlays/commands.ts`, `overlays/palette.tsx`, `lib/settings.ts`, `settings/settings-screen.tsx`, `settings/results.tsx`, `settings/prototype-section.tsx`. These are exactly the files that import it today (checked by grep on 2026-10-27), so the check passes from day one.
- **D4. Local-only data.** New fields live in local-only tables that the sync never lists (`mirror-tables.ts`, `whole-tables.ts`), or in local columns commented "no Supabase column yet". Each wiring step later decides Supabase columns with grants and the owner's go.
- **D5. Example data at v6's size.** `exampleSeed(now, scenario)` grows to v6's people, brands and deals (`design/workbench-v6/js/data.js`), every field the screens show filled, all from the AI niche (owner rule). All four scenarios keep working: "first" stays empty, "later" a week on, "broke" with its faults.
- **D6. Owner decisions on v6** are in ADR 0021 D6. New taste conflicts found while building go to the owner before the part builds them, one question each, with a recommendation.
- **D7. The drift tests move to v6.** `packages/core/src/deal-flow.test.ts`, `packages/ui/src/icons.test.ts`, `avatar.test.ts` and `testing/prototype-styles.ts` read `design/workbench-prototype/`; P1 points them at `design/workbench-v6/` and fixes what that turns up (tokens: dark only; light stays as it is).

## Parts

One part per session (plan §10 rule 5). Each part starts by writing its own contracts and task list below (Tier H), then builds (Tier N by default), then the review (`router-reviewer`), then a pull request through `pnpm verify --status`.

| Part | What | Size | Depends on |
|---|---|---|---|
| P1 | Foundations (D3, D4, D5, D7; core engine) | L | — |
| P2 | Records: creator (stage-aware Overview + 9 tabs), brand, deal frame | L | P1 |
| P3 | Find, Reach and frame additions (ADR 0021 D6) | M | P1 |
| P4 | Today, step 7 part 1 (wired live for its real buckets) | L | P1, P2 |
| P5 | Close: Brands, Match, Pitch, roster columns, media kit packet | L | P1, P2 |
| P6 | Close: Negotiate, Contracts, Calculator, Agency facts | L | P5 |
| P7 | Deliver: deal board, deal record, Money | L | P1, P2 |
| P8a | Insights without deals and money, and its six-month example history at the real scale; live on real data. **Done** 2026-10-29 | L | — |
| P8b | Insights' deals and money: Money, Funnel › Brands, the deal and money parts of Overview and Goal. **Runs right after P1** | M | P1, P8a |
| P9 | Team work on example data, Toolbox › Notifications | M | P4 |
| P10 | Full prototype flow suite, review, owner walk-through | M | all |

## P1: foundations (contracts written 2026-10-30)

Owner, 2026-10-30: "Finish step P". The parts run one after another, each its own pull request, in the plan's order (P1, P8b, P2 to P7, P9, P10).

### Decisions

- **F1. Contracts in code.** `packages/core/src/data/work-types.ts` (the full `Brand`, `Deal`, `CreatorDetails`, `AgencyFacts`, the clause and check lists, `bareBrand`/`bareDeal`), `packages/core/src/close/engine-types.ts` (pricing, packages, matching, `NextAction`), `packages/ipc/src/work.ts` (their schemas). Builders change them only by asking the lead.
- **F2. Local-only tables**, migration `0008-details.ts`: `brand_details`, `deal_details`, `creator_details` (columns below). The sync's lists (`mirror-tables.ts`, `whole-tables.ts`) never name them; a test says so. The synced columns stay the source for what they hold (name, sells, status, category, country, website, contacts, budget (the low end), brand_price, influencer_payout, deliverables, payment_terms, invoice sent and paid, payout paid, payment reference, tracking link, owner, created_at, flow_step); the detail tables hold the rest.
- **F3. Absent is "not known".** A brand or deal with no detail row reads as `bareBrand`/`bareDeal` over its synced columns; a creator with no detail row has no `details`. Never 0 or "".
- **F4. Money stripped in main.** For a viewer who doesn't see money: `Brand.budget`, `Deal.price`, `payout`, `cpm` and `negotiation` are null (the `*Known` flag stays), as `Deal.price` was.
- **F5. Channel facts are computed, not stored**, where the pipeline has the numbers: `trimmedAverage`, `viewStability` and `stars` come from the catalog's videos and medians in core (`find/channel-facts.ts`). `format` and `botRisk` can't be computed from what the pipeline reads, so they are stored in `creator_details` (example data now; the pipeline later).
- **F6. The seed's creators become catalog channels** in prototype mode: their ids change to the pipeline's shape (`UC` + 22 characters), and the history's `pipeline` part carries their channels and videos, so Find, the record and the Close engine see one creator, not two. The plain example copy (signed out, the Electron tests) keeps no pipeline rows, as before.
- **F7. v6's rule codes stay out of the app's words** ("(BRD-CONTRACT-09)", "HC-24" and the like): the owner's writing rule is plain words, no jargon. The DEAL_FLOW port and its drift test strip them.
- **F9. The engine's prices are money.** `Match.price`, `Package.price`, `priceFor` and `payoutFor` are worked out from views and the agency's CPM, so a screen shows them only when `Frame.seesMoney` (the renderer hides them; the engine stays pure). A viewer without money matches without budgets (they are stripped), so their best brand can differ: acceptable, because pitching a brand is the owner's and the deal lead's work, who see money (P1 review, 2026-10-30).
- **F10. Synced values are cleaned to the schema's limits when read** (P1 review): a country that isn't two letters, a category over 40 characters, an over-long text, a negative amount read as not known or cut, so one odd legacy row can never stop the frame from loading.
- **F8. Today's day state** (snooze, done, the day's budget and note, hand-offs) is P4's to design: P1 adds no table for it.

### Tables (migration 0008, local only)

```sql
CREATE TABLE brand_details (
  brand_id TEXT PRIMARY KEY,
  headcount INTEGER, recommended_title TEXT, paid_spender_verified INTEGER,
  past_campaign_hook TEXT, budget_high REAL, seen TEXT NOT NULL DEFAULT '[]',
  since INTEGER, pitched TEXT, owner_id TEXT, status TEXT
) STRICT;  -- status: the full BrandStatus ("lost" included); overrides brands.status when set
CREATE TABLE deal_details (
  deal_id TEXT PRIMARY KEY,
  model TEXT, checks TEXT NOT NULL DEFAULT '[]', video_count INTEGER NOT NULL DEFAULT 1,
  videos_delivered INTEGER NOT NULL DEFAULT 0, creator_deadline INTEGER, go_live_at INTEGER,
  due_at INTEGER, placement TEXT, invoice_number TEXT, invoice_due_at INTEGER, report TEXT,
  live_url TEXT, clauses TEXT NOT NULL DEFAULT '[]', redlines TEXT NOT NULL DEFAULT '[]',
  shipping TEXT, script_approved INTEGER NOT NULL DEFAULT 0, qc TEXT NOT NULL DEFAULT '[]',
  hype TEXT, whitelisting_until INTEGER, cpm TEXT, negotiation TEXT
) STRICT;  -- JSON in the TEXT columns, shaped as the core types
CREATE TABLE creator_details (
  channel_id TEXT PRIMARY KEY,
  owner_id TEXT, relationship TEXT, last_update_at INTEGER, locks TEXT NOT NULL DEFAULT '[]',
  next_open_slot INTEGER, onboarding TEXT, format TEXT, bot_risk TEXT, bot_note TEXT,
  socials TEXT NOT NULL DEFAULT '{}'
) STRICT;
```

Times in the new tables are ms integers. A JSON column that doesn't parse, or an enum value the app doesn't know, reads as not known (null or empty), never throws.

### Engine (`packages/core/src/close/`, types in `engine-types.ts`)

| File | Exports | From v6 |
|---|---|---|
| `pricing.ts` | `priceFor(c: PriceInput, facts, opts?): number`; `payoutFor(c: PriceInput, gross, facts): number`; `packagesFor(cs: readonly (PriceInput & { id: string })[], facts): Package[]` (single, bundle of 3, takeover) | `engine.js:62-102`; markup and commission from `facts`; round to $50 |
| `match.ts` | `matchOf(brand, c: MatchCreator, world: MatchWorld): Match`; `bestBrandFor(c, world): { brandId: string; match: Match } or null` (qualified or won brands, no warnings, best score) | `engine.js:104-136, 193-197` |
| `next.ts` | `nextFor(ref: RecordRef, world: NextWorld): NextAction or null` | `engine.js:139-192`; drafts and sequences from `ReachData` (creator drafts only until P5 adds brand drafts) |

### Channel facts (`packages/core/src/find/channel-facts.ts`)

- `trimmedAverage(views: readonly (number | null)[]): number | null`: the newest 12 known counts (the list is newest first); with 5 or more, drop the highest and the lowest; the mean, rounded. Null under 3 known.
- `viewStability(views): "stable" | "volatile" | null`: the same newest 12 known; volatile when the (population) standard deviation is over half the mean. Null under 3 known.
- `starRating({ medianViews, engagement, uploads30 }): 1 | 2 | 3 | 4 | 5`: 5 when median at least 60K, engagement at least 4.5% and 3 to 12 uploads; 4 when median at least 45K and 3+ uploads; 3 when median at least 30K; else 2. Unknown engagement is not 4.5% or more. `CatalogItem.stars` is null when its numbers aren't read (`hasNumbers` false or uploads unread).
- `CatalogItem` gains `trimmedAverage`, `viewStability`, `stars`, `format`, `botRisk` (the last two from the creator state's `details`; null without).

### Tasks

Tiers per plan §10. Agents don't stage, commit or stash; the lead commits named paths once no agent runs.

| id | Task | Tier | Depends | Files | Done-check |
|---|---|---|---|---|---|
| P1-0 | Contracts (F1) | H | — | core/data/work-types.ts, core/close/engine-types.ts, ipc/work.ts | typecheck: **done** |
| P1-1 | Migration 0008, repositories that read and write the detail tables, the frame's full brands and deals (money stripped, F4), creators' and creator states' `details`, the sync-lists test; fix the type fixtures this breaks in main and the renderer | N | P1-0 | main/db, main/data, main/sync test, renderer test fixtures | vitest on main/data, main/db, main/sync |
| P1-2 | Channel facts in core with tests; `CatalogItem`'s new fields filled in `main/find/catalog.ts` | N | P1-0 | core/find, main/find | vitest on core/find, main/find |
| P1-3 | The example seed at v6's size (F6): v6's creators (stages, details, videos), brands and deals with every field, the four scenarios, `example.test.ts`; the seed writes the detail tables; the history's pipeline part carries the seed's channels | N | P1-1, P1-6 | core/data/example*.ts, main/data/example-source.ts, main/insights/example-history.ts | vitest on core/data, main/data, main/insights |
| P1-4 | Engine ports with tests (pricing, match, next) | N | P1-0 | core/close | vitest on core/close, 100% branches |
| P1-5 | The no-drift check (ADR 0021 D3) | E | — | renderer/no-drift.test.ts | vitest |
| P1-6 | Drift tests to v6 (D7); DEAL_FLOW from v6 with F7 | N | — | core/deal-flow*, ui tests, ui/testing | vitest on core and ui |
| P1-7 | Review, docs (architecture, the status table, PROGRESS), `pnpm verify`, pull request, merge | H | all | docs | `pnpm verify --status` |

Done-check for P1: `pnpm lint`, `pnpm typecheck`, `pnpm test` pass; prototype mode opens all four scenarios with the larger seed; live mode unchanged (`wired.test.ts`, the existing Electron tests).

Order (owner, 2026-10-28): **P8a, then P1, then P8b**, then P2 onwards.

For P1: P8a builds the six-month history as a layer on today's seed. P1-3 grows the seed to v6's size; the history layer must still agree with the snapshot's creators afterwards (P8a's history tests say what must hold). P8b then adds the brands, deals, invoices and payouts to the history.

## P8a: Insights without deals and money (done 2026-10-29, ADR 0022)

Spec: `docs/product/insights-design.md` (sections 2, 2a, 3.1 to 3.4, 3.6, 4, 5, 6). Mockups: `design/insights/*.jpg` (look at the picture of the tab you build). Code map: `.router/CONTEXT.md`. P8b (after P1) adds Money, Funnel › Brands, and the deal and money parts.

### Scope

- **Built:** the Insights screen (header, period switch, Copy summary, six tabs) with Overview (no money tile: "Replies waiting for us" in its place), Funnel › Creators (Found to Signed; the Brands switch shows in prototype mode only, as "comes with deals", and is hidden live), Emails, Search (all four views), Goal in emails and creators (target: creators to sign a month). Money shows the existing "still being built" placeholder in prototype mode.
- **Alerts in P8a:** every rule in design section 4 that doesn't read deals or money (the `Alert` union in `types.ts`). Wins: edited, keyword, mailbox, follow-up.
- **The example history** (prototype mode only; not the plain example copy the Electron tests use).
- **Live** (owner, 2026-10-28: "all real-data tabs"): Overview, Funnel, Emails, Search and Goal join `liveWired`; Money stays hidden; Funnel's Brands switch is hidden live.

### Decisions

- **A1. Contracts in code.** `packages/core/src/insights/types.ts` (the report, drills, alerts, wins), `inputs.ts` (what main reads), `thresholds.ts`. Written by the planner; builders change them only by asking the lead.
- **A2. Words only in the strings file.** Core returns facts and keys (`SummaryPart`, `Alert`, `Win`, `Diagnosis`, `KeywordVerdict`…); `renderer/insights/words.ts` turns each into a sentence from `strings.insights`. The rules that pick a sentence are tested in core; the wording in the renderer.
- **A3. One read per tab.** `insights:read {tab, period}` → `InsightsReport`. Main builds `InsightsInputs` (one pass over both databases; the archive as SQL totals), then `insightsReport(tab, inputs, period)` in core. Search's four views come in one read (switching views doesn't read again).
- **A4. Numbers and lists agree.** `insights:list {drill, period, offset}` → `{ rows, total }`, worked out by `drillIds(drill, inputs, period)` in core, the same code that counts the number. A test per drill kind checks the count equals the list's total.
- **A5. Stage times.** Migration 0007 adds `stage_events` with two triggers on `channel_state` (insert with a stage; update of `creator_stage` to a different stage), so every write path (the app, the sync's upserts, the import) records the change when it lands. The same migration fills it backwards from the log (shortlist, reject, never) and the messages (first email out → emailed, first in → replied) where `NOT EXISTS`; the backfill SQL is also exported (`backfillStageEventsSql`) to run after a seed.
- **A6. Weekly catalog totals.** Migration 0007 adds `catalog_weeks`. The archive sweep (`main/find/archive-service.ts`) upserts the current week's live, waiting and archive counts after each sweep. Weeks before P8a are not known (null on the charts), except the archive's series, which comes from the tombstones' `archived_at`.
- **A7. The example history is one TypeScript generator.** `packages/core/src/data/example-history.ts`: `exampleHistory(anchor, scenario): ExampleHistory | null` (null for "first"), pure and seeded (`mulberry32`), so the story lives in one place. Main writes its `gratovo` part into the prototype copy, and hands its `pipeline` part to a new Python job, `example.load` (store lane, example data only), as a JSON file in the prototype pipeline folder: Python owns `pipeline.db`'s schema (architecture, step 5), so only Python writes it.
- **A8. Example archive days are 90** (Settings allows 1 to 90). With 7, the owner's scale (10,200 waiting) can't come from about 100 rejects a working day; with 90 it does, and the mockups' other numbers agree (18,800 rejected by a person = 10,200 waiting + 8,600 archived; 94% of the archive never seen by a person). The "To be archived" headline then reads about 700 leaving this week, not 10,200: tell the owner.
- **A9. Goal in P8a** targets creators to sign a month (`GoalSettings.signsPerMonth`, default 4), kept in `local_settings` `insights.goal`. P8b puts the money chain on top and derives it.
- **A10. Hidden alerts** in `local_settings` `insights.hidden` (key → until ms), through `insights:hide`.
- **A11. No drift:** no Insights file reads prototype state. Prototype and live differ only through the live gate (`lib/wired.ts`) and the data.

### IPC (`packages/ipc/src/insights.ts`, schemas typed `z.ZodType<T>` against the core types)

| Channel | Request | Response |
|---|---|---|
| `insights:read` | `{ tab: ReportTab, period: Period }` | `InsightsReport` |
| `insights:list` | `{ drill: Drill, period: Period, offset: int 0..100000 }` | `{ rows: DrillRow[] (≤ 100), total: int }` |
| `insights:hide` | `{ key: string ≤ 200, until: number \| null }` (null shows it again) | `{ hidden: HiddenAlerts }` |
| `insights:goal` | `{ signsPerMonth?: int 1..100, overrides?: Partial<Record<GoalStep, number in (0, 1] \| null>>, reset?: true }` | `GoalSettings` |

None is refused in prototype mode (local reads and local settings); add the audit line in `prototype/refused.ts`.

### Database (migration `0007-insights.ts`, local only; the sync lists don't change)

```sql
CREATE TABLE stage_events (
  id INTEGER PRIMARY KEY,
  channel_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  at INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('change','log','message','example'))
) STRICT;
CREATE INDEX stage_events_channel ON stage_events (channel_id, at);
CREATE INDEX stage_events_stage ON stage_events (stage, at);
-- triggers: AFTER INSERT ON channel_state WHEN NEW.creator_stage IS NOT NULL;
--           AFTER UPDATE OF creator_stage ON channel_state
--             WHEN NEW.creator_stage IS NOT NULL AND NEW.creator_stage IS NOT OLD.creator_stage;
--   both insert (NEW.channel_id, NEW.creator_stage, CAST(unixepoch('subsec') * 1000 AS INTEGER), 'change')
CREATE TABLE catalog_weeks (
  week TEXT PRIMARY KEY,            -- the local Monday, YYYY-MM-DD
  live INTEGER NOT NULL, waiting INTEGER NOT NULL, archive INTEGER NOT NULL,
  written_at INTEGER NOT NULL
) STRICT;
-- backfill (also exported as backfillStageEventsSql): see A5
```

### Core functions (`packages/core/src/insights/`)

| File | Exports |
|---|---|
| `stats.ts` | `rateOf(r: Ratio): number \| null`; `compareRates(a: Ratio, b: Ratio, min: number): Difference` (two-proportion z-test, two-sided, at `thresholds.confidence`; `early` when either `d < min`); `median(xs): number \| null`; `reportWindow(period, now): ReportWindow` (7d, 30d and 90d end at `now`; month = the 1st 00:00 local to now, previous = the whole month before); `workingDays(span): number`; `startOfDay(t)`, `startOfWeek(t)` (Monday, local); `rateVerdict(r: Ratio, floor: number, min: number): Verdict` |
| `readings.ts` | `readingKind(replyType: string \| null, bounce: boolean): ReadingKind \| null`, mapping the comms engine's ids (`inf.interested_vague`, `inf.gives_rate`, `inf.has_manager`, `inf.later`, `inf.not_interested`, `any.bounce`, the rest from the playbook) |
| `funnel.ts` | `creatorFunnel(inputs, window, mode: "everyone" \| "cohort"): FunnelRow[]`; `biggestDrop(rows): CreatorStep \| null`; `funnelExits(inputs, window): FunnelExits`; `stepDays(inputs): FunnelReport["stepDays"]`; `cohorts(inputs): { rows: CohortRow[]; trend: Difference }` |
| `emails.ts` | `emailsReport(inputs, window): EmailsReport`; `batches(inputs): Batch[]`; `diagnose(b: Omit<Batch, "diagnosis">): Diagnosis`; `patterns(inputs): PatternSplit[]` |
| `search.ts` | `searchReport(inputs, window): SearchReport`; `keywordRows(inputs): KeywordRow[]`; `keywordVerdict(row, others: Ratio): Pick<KeywordRow, "verdict" \| "why">`; `liveGroup(c: ChannelFacts): LiveGroup \| null` |
| `goal.ts` | `goalReport(inputs, window): GoalReport`; `goalLines(settings, rates, actual): GoalLine[]`; `levers(...)`; `ownRates(inputs): Record<GoalStep, GoalRate>` (yours over 90 days when the count passes `minOther`, else the course figure, else a marked guess; an override wins) |
| `alerts.ts` | `alerts(inputs, parts): AlertLine[]` (act before watch, then by size); `wins(inputs, parts): WinLine[]` (≤ 3); `summary(...): SummaryPart[]`; `alertKey(a: Alert): string` |
| `overview.ts` | `overviewReport(inputs, window): OverviewReport` |
| `report.ts` | `insightsReport(tab: ReportTab, inputs, period): InsightsReport`; `drillIds(drill, inputs, period): string[]` |

"Interested" counts creators whose first reply reads `interested`, `question` or `rate`. Funnel "everyone" counts creators who ever reached the step (`events`, plus the current stage for a creator with no event); `found` = live + waiting + archive, `passed` = found − archive.byRules. "Confirmed" = `confirmedAt` set.

### The example history (`exampleHistory`, normal scenario, at `anchor` = the seed's `now`)

Six months back (182 days). All names and keywords in the AI niche. Channel ids match `^UC[A-Za-z0-9_-]{22}$` and never clash with the seed's. Targets are approximate (tests allow ±15%); what must hold exactly is under "Invariants".

| What | Target |
|---|---|
| Catalog | found ≈ 162,400 = archive ≈ 150,200 (by rules ≈ 141,600: under 5K subscribers ≈ 98,000, too few views ≈ 37,400, over 2M ≈ 6,200, using the auto-clean gate's real labels from the pipeline) + waiting ≈ 10,200 (dated ≈ 9,000 over the last 90 days, undated 1,200) + live ≈ 2,000 |
| Live groups | not reviewed 340 (found in the last 9 days), shortlisted ≈ 290 (24 waiting for an address to be confirmed), in outreach ≈ 1,180, signed 16, parked 70, never contact 104 |
| Funnel, everyone | shortlisted ≈ 1,480, confirmed ≈ 1,260, emailed ≈ 1,202, replied 96, interested 54, kit 38, audience passed 22, signed 16 |
| Keywords | 41. Featured: `local llm setup` and `ai agents tutorial` (most signings), `cursor ai coding` (good), `ai news weekly` (finds the most, nobody answers: drop), `ai video tools` (first run 3 weeks ago: too early), `chatgpt tips` (last run 90% archived: worn out) |
| Runs | one search most working days |
| Emails | first emails ramp from about 3 a working day six months ago to about 22 now; follow-ups at days 3, 7 and 14 to those who didn't reply; replies at every step (follow-up 2 about as good as the first email); readings mixed (interested, question, rate, not now, no, manager, auto); bounces about 2%; edited drafts about 35% of first emails with a clearly better reply rate; rewrites on some; answers to replies after a median of about 5 hours |
| Mailboxes | the seed's mailboxes, using about half their room |
| Brought back | about 40 in the last 90 days, some emailed and a few replied |
| `catalog_weeks` | 26 rows that agree with the totals growing |

Scenarios: **first** → null (no history; every tab shows its empty state). **later** → the same history at the seed's later anchor. **broke** → normal plus: one mailbox bounces over 3% of its last 7 days with 20+ sends, fuel under 1 day (≤ 10 ready to email), a review backlog of about 1,200.

**Invariants (tested):** every event's channel exists; a channel's events are in time order and follow the stage order; each emailed creator's first email is at its `emailed` event; each reply follows an email to that creator; follow-ups go only to creators who hadn't replied; a live channel is in `pipeline.channels` and not in the archive; a waiting channel is rejected with a reason line in the log; tombstones are not in `channels`; `catalog_weeks`' last row equals the current counts; the same anchor and scenario give the same output.

**Shape:** `ExampleHistory = { gratovo: { creators, names, log, events, messages, drafts, sequences, weeks, settings }, pipeline: { channels, keywords, links, runs, archive, pending } }`, rows named by their tables' columns. `archive` holds compact tuples (about 150,000), not objects. Performance: the generator under 1.5 s, the gratovo write under 2 s, `example.load` under 5 s on the owner's PC. The prototype switch waits for the load (capped at 60 s; on failure prototype mode still opens and the problem is logged).

### Tasks

Tiers per plan §10. Agents don't stage or commit; the lead commits named paths once no agent runs.

| id | Task | Tier | Depends | Files | Done-check |
|---|---|---|---|---|---|
| A0 | Contracts (this section, `types.ts`, `inputs.ts`, `thresholds.ts`) | H | — | core/insights | typecheck: **done** |
| A1 | Migration 0007 (A5, A6), migrate tests, `backfillStageEventsSql`; the sweep writes `catalog_weeks` | N | A0 | `main/db/migrations/0007-insights.ts`, `index.ts`, `migrate.test.ts`, `find/archive-service.ts` (+ test) | vitest on those files |
| A2 | Core maths: `stats.ts`, `readings.ts`, with tests | N | A0 | core/insights | vitest |
| A3 | Core reports: `funnel.ts`, `emails.ts`, `search.ts`, with tests | N | A2 | core/insights | vitest |
| A4 | Core: `goal.ts`, `alerts.ts`, `overview.ts`, `report.ts` (with `drillIds`), tests incl. one per drill kind | N | A3 | core/insights | vitest |
| A5 | The history generator `example-history.ts` + invariant tests | N | A0 | core/data | vitest; a timing test under 1.5 s |
| A6 | Python `example.load` job (protocol line, the example-jobs set, pytest) | N | A5 | `services/pipeline/.../jobs/`, `main/pipeline/protocol.ts`, `jobs.ts` | pytest, vitest |
| A7 | Main: write the history into the prototype copy, run `example.load`, archive days 90 in the prototype `find.json`; the prototype switch waits | N | A1, A5, A6 | `main/insights/example-history.ts`, `main/prototype/prototype.ts`, `main/index.ts` | vitest |
| A8 | Main: the inputs reader (`main/insights/inputs.ts`) over both databases, the four handlers, `packages/ipc/src/insights.ts` + `channels.ts` + `index.ts`, the `refused.ts` audit line | N | A1, A4 | main/insights, ipc | vitest; a test that writes the history to temp databases and checks report numbers |
| A9 | Renderer base: tokens (series colours, the raised panel), `strings.insights`, the screen frame (head, period switch, Copy summary, tabs from `strings.screens.insights.tabs`), `Panel`, verdict tag and dot, Numbers with Copy as CSV, What is this?, the drill sheet, `lib/insights.ts` hooks, the `app.tsx` branch | N | A8 | renderer/insights, ui tokens | vitest (happy-dom) |
| A10 | Chart pieces (hand-drawn SVG): line with area, paired columns, bars, small multiples, the step line, the heat table, the flow band (circles by √count between a min and max radius, arrows, branches) | N | A9 | renderer/insights/charts | vitest |
| A11 | Tabs Overview, Funnel, Emails, and `words.ts` for them | N | A10 | renderer/insights | vitest; a screenshot at 1440 dark in prototype mode |
| A12 | Tabs Search (four views, the band, the panels, the archive search box → Toolbox › Archive) and Goal | N | A10 | renderer/insights | vitest; screenshots of each view |
| A13 | Live gate (`wired.ts`, `wired.test.ts`), one light Electron smoke test (`e2e/insights.spec.ts`: Insights opens on example data, Overview and Search render, a read round trip) | N | A11, A12 | renderer/lib, e2e | vitest; the spec |
| A14 | Review (`router-reviewer`), fixes, docs (architecture, ADR 0022, the status table, PROGRESS), `pnpm verify`, the pull request, merge | H | all | docs | `pnpm verify --status` |

Done-check for P8a: lint, typecheck and tests pass; prototype mode shows every P8a tab in all four scenarios with no empty card ("first" shows the empty state); live mode shows the five tabs on real data and hides Money; a number and its list agree (a test per drill kind); the screen looked at in dark at 1440 px.

## P8b: Insights' deals and money (contracts written 2026-10-30)

Spec: `docs/product/insights-design.md` 3.1 (the revenue tile, the pipeline to Paid), 3.2 (Brands), 3.5 (Money), 3.6 (the money lines), section 4 (the money alerts). Mockup: `design/insights/money.jpg` (look at it). Builds on P8a (above) and P1's brands and deals.

### Decisions

- **B1. Contracts in code.** `packages/core/src/insights/inputs.ts` (`DealFact`, `BrandFact`, `DealEvent`, `BrandEvent`, and `InsightsInputs`' `deals`, `brands`, `dealEvents`, `brandEvents`, `seesMoney`, `marginFloorPct`), `types.ts` (`MoneyReport`, `BrandFunnel`, the new drills, alerts, the win, the revenue vital, `GoalSettings.revenuePerMonth`, the money goal steps, the creator steps `firstDeal` and `firstPayout`), `thresholds.ts` (the money thresholds). Builders change them only by asking the lead.
- **B2. Revenue is what brands paid**, counted on the invoice's paid date; **net** is the price less the creator's payout. The Money chart shows what brands paid each month; the goal is set as net and drawn as paid (net over the usual margin), as the mockup does ("goal $25K (net $10K at 40%)"). Bookings are prices of deals made, counted on `createdAt`.
- **B3. Money stays with money viewers.** Main refuses `insights:read {tab: "money"}` for a viewer who doesn't see money (an `{ok: false}` the screen never meets, since the tab is hidden for them). Every report built for them has `seesMoney: false`: no revenue vital (`null`), no money goal lines, and none of the money alerts or the "pays fastest" win. Their deal amounts are null in the inputs.
- **B4. Step and status times.** Migration 0009 adds `deal_events (id, deal_id, step, at, source)` with triggers on `deals` (insert with a `flow_step`, update of `flow_step` to a different value) and `brand_events (id, brand_id, status, at, source)` with triggers on `brands` (insert with a `status`, update of `status`), `source` in ('change', 'backfill', 'example'), the same pattern as `stage_events`. Backfill where `NOT EXISTS`: a deal's current step at its `created_at`, a brand's current status at its `created_at`. Exported as `backfillDealEventsSql` for after a seed. Local only; the sync's lists don't change (the details-local-only test covers the new tables too).
- **B5. The creator funnel's last steps:** First deal = the creator has any deal; First payout = a deal with `paidCreatorAt`. Their times come from the deal's `createdAt` and `paidCreatorAt`. Shown to everyone (counts, not money).
- **B6. The brand funnel** (Found, Qualified, Pitched, Replied, Negotiating, Won, Live, Paid): a brand counts at every step up to the furthest it reached, from its status (found < qualified < pitched < negotiating < won; "replied" = negotiating or won, or a `brand_events` row past pitched), Live = a deal at step 5 (Go-live) or later, Paid = a deal with `invoicePaidAt`. `lost` brands count up to the last step their events show (or Found). Shown to everyone.
- **B7. The money goal.** When `revenuePerMonth` is set and the viewer sees money: revenue (net) → bookings (÷ usual margin) → deals (÷ average deal size) → pitches (÷ brand close rate: deals won ÷ brands pitched, 90 days) → creators to sign (deals × new signs per deal), each rate yours when there are enough (`minOther`), else the course figure (`courseMargin`, `courseDealSize`, `courseCloseRate`) or the marked guess (`guessSignsPerDeal`); then P8a's chain below. Levers gain `dealSize` (+$500) only: a better close rate cuts brand pitches, never the first emails a day that a lever is measured in, so it could only ever read "no change". The brand close rate is, of the brands pitched in the 90 days, the share that went on to win (status won, a won event, or a deal made after the pitch), so repeat deals from old brands don't lift it; the deal size is your data or the course figure, never a 0 to 1 override.
- **B8. Live mode is unchanged** (ADR 0021 D2; the synced legacy `deals` table is never read on live: `insights:read` and `insights:list` take `deals`, false on live by the gated part `insights.deals`, and main then builds the inputs with no deals, brands or their events): Money, Funnel › Brands and the revenue tile stay behind the live gate (`wired.ts`, `liveHiddenParts`) until step 9 wires deals and money; the creator funnel's two new steps and the deal alerts show live only when deals exist, which they don't before step 9.
- **B9. The example history gains brands and deals:** about 30 brands and 60 deals over the six months, the agency's revenue growing month by month to about $25K paid a month (v6's months), every deal moving through its steps with `deal_events`, invoices sent at go-live and paid after a brand-specific number of days (one slow payer), payouts after payment, 30-day reports with views against the creator's usual, a few under the margin floor, one brand with over 40% of 90 days' revenue, one idle roster creator. The seed's 10 brands and 8 deals stay as they are on top; the history uses its own ids and the seed's signed creators plus its own.

### IPC (`packages/ipc/src/insights.ts`)

`insights:read` takes `tab: ReportTab` (now with "money") and `deals: boolean` and returns the `InsightsReport` union with `MoneyReport`; `insights:list` takes the new drills and returns rows with the optional `record`; `insights:goal` takes `revenuePerMonth?: int 100..10,000,000 | null` (null clears it).

### Tasks

| id | Task | Tier | Depends | Files | Done-check |
|---|---|---|---|---|---|
| B0 | Contracts (B1) | H | — | core/insights types, inputs, thresholds | **done** |
| B-1 | IPC schemas for the new types; migration 0009 (B4) with migrate tests; main's inputs reader: deals, brands, both event tables, `seesMoney`, `marginFloorPct` (from `agency.facts`, default 25); the service: money refused without money (B3), the goal's `revenuePerMonth`; fix main and ipc tests | N | B0 | ipc/insights*, main/db, main/data/repositories/insights.ts, main/insights | **done** |
| B-2 | Core: `money.ts` (`moneyReport`), the brand funnel and the creator funnel's two steps (`funnel.ts`), the new drills in `report.ts` (`drillIds` for each, a count-equals-list test each), `insightsReport` for "money" | N | B0 | core/insights money*, funnel*, report* | **done** |
| B-3 | Core: the money goal lines and levers (`goal.ts`), the seven alerts and the win (`alerts.ts`), the revenue vital and the pipeline to First payout (`overview.ts`) | N | B0 | core/insights goal*, alerts*, overview* | **done** |
| B-4 | The history's brands and deals (B9) in `example-history.ts` with invariant tests; main writes them (brands, deals, both detail tables, `deal_events`, `brand_events`) into the prototype copy | N | B-1 | core/data/example-history*, main/insights/example-history.ts | **done** |
| B-5 | Renderer: the Money tab to the mockup, Funnel › Brands, the Overview's revenue tile, the Goal's money lines and goal field, words and strings, the drills' brand and deal rows; live gate unchanged (B8) | N | B-2, B-3 | renderer/insights, strings | **done** |
| B-6 | Review, `pnpm verify`, docs (ADR 0022 addendum, architecture, status, PROGRESS), PR, merge | H | all | docs | **done** |
