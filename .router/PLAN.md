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
| P8 | Insights | L | P1 |
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
