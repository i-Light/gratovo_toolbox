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

## P1 task outline (its session writes the contracts first)

| id | Task | Tier |
|---|---|---|
| P1-0 | Contracts: the full `Brand`, `Deal`, creator extras and day-state types in `packages/core/src/data/types.ts`; the local tables (migration 0007); the frame and IPC shapes that carry them. Written into this file before building | H |
| P1-1 | Migration 0007: local-only `brand_details`, `deal_details`, `creator_details`, `day_state` (or columns, per P1-0), with migrate tests; confirm the sync never reads them | N |
| P1-2 | Core types and readers: main reads the new fields into the frame; live rows without them read as "not known", never 0 | N |
| P1-3 | The example seed at v6's size, the four scenarios, `example.test.ts` updated | N |
| P1-4 | Core engine ports with tests: `match`, `priceFor`, `payoutFor`, `buildPackagesFor`, `bestBrandFor`, `nextFor` (`engine.js:62-192`) | N |
| P1-5 | The no-drift check (D3) | E |
| P1-6 | Drift tests to v6 (D7) | N |
| P1-7 | Review, docs (architecture, status table, PROGRESS), pull request | H |

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

## P8b outline (after P1; its session writes the contracts first)

On P1's brands and deals: the Money tab (design 3.5), Funnel › Brands, the Overview's revenue tile (money viewers) and the pipeline's First deal and Paid steps, the Goal's money lines on top of P8a's chain (revenue → bookings → deals won → brand pitches → creators to sign) and its deal-size and brand-close levers, the alerts P8a left out (invoiceLate, payoutDue, dealStuck, behindGoal, basket, idleCreator, marginLow), the "brand pays fastest" win, `deal_events` (the same pattern as `stage_events`), and the history's brands, deals, invoices and payouts. They stay behind the live gate until step 9 wires deals and money.
