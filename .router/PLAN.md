# Plan: step 3d-1, the local data layer

The first of two pull requests for step 3d (owner, 2026-10-20). **3d-1:** the local database, the `DataSource` interface and its two implementations as far as they go without a network, the renderer reading and writing through it, the Supabase baseline migration and the SQL tests in CI. **3d-2 (later):** email and password sign-in (session in `safeStorage`), the sync engine (pull, outbox, compare-and-set, tombstones), the main-process network allowlist, the team-keys server function. Read `.router/CONTEXT.md` first (§1, §2, §5, §8). Bash commands start with `export PATH=/c/Users/moust/.local/opt/node-v24.22.0-win-x64:$PATH;`. Never read `.env*` files. Nothing in 3d-1 touches the production Supabase project or needs a key.

## Goal

The app starts, loads everything the frame shows from a SQLite database in the main process through one IPC query, and every change the app makes today (mark read, the notification switches, your name, undo and redo of them) is written to that database, so it survives a restart. The same code serves an **example** database (seeded from AI-niche fixtures, what the app runs on until sign-in exists) and a **live** database (empty until 3d-2's sync fills it). The Supabase schema is a baseline migration, tested in Docker in a Linux CI job.

### Non-goals

Sign-in, sessions, the sync engine, `_outbox` and sync cursors, realtime and presence, the network allowlist, the team-keys function, `docs/setup.md` (all 3d-2). Prototype mode and switching sources at run time (3f). Tables for screens that don't exist yet (outreach, templates, campaigns… arrive with their steps). Any additive Supabase migration. Encrypting the SQLite file (CONTEXT §7.9: revisit in 3d-2 when real contact data arrives). The old `gratovo.db` import (step 9).

### Acceptance

1. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` pass on Windows; CI green.
2. Vitest: the migration runner (fresh, re-run, forward-only, refuses a newer database, a failed migration rolls back); each repository on a temp database; the mapping functions; one **contract suite** that the example source and the live source both pass; the persister (diff, queue, undo and redo, failure).
3. The app shows the same frame as today (existing component and e2e tests pass unchanged except where a decision below says why). New e2e: `example.db` is in the user data folder; marking all read and setting your name survive a restart with the same data folder.
4. `pnpm test:sql` passes locally with Docker Desktop, and the new **SQL tests (Linux, Docker)** CI job is green.
5. ADR 0010 written; architecture, supabase README and the plan's status updated.

## Decisions

- **G1. Where the contract lives.** The domain types, the `DataSource` interface, the write vocabulary, the legacy mapping and the example fixtures go in `packages/core/src/data/` (pure, no I/O; exported as `@gratovo/core/data` so the main process doesn't pull in immer). `packages/ipc` holds the zod schemas, each annotated `z.ZodType<CoreType>`, so TypeScript fails if schema and type drift. Reason: architecture puts entities in core and schemas in ipc; one source of each, checked against each other. `apps/desktop/tsconfig.node.json` and `packages/ipc/tsconfig.lib.json` gain a reference to core.
- **G2. Shape: one read, one write.** `frame()` returns everything the frame, palette, peek and record page show (one query per screen; the frame is the only screen that reads data today). `write(writes)` applies a batch in one transaction, all or none. Both return promises although `node:sqlite` is synchronous, so the database can move to a utility process later without touching callers. Five write kinds, exactly the changes the app makes today. No query for screens that don't exist; step 5 replaces the palette's record lists with a search query.
- **G3. Driver: `node:sqlite` `DatabaseSync`** (lead-verified in Electron 44.9.0's main: Node 24.22.0, SQLite 3.53.4, WAL). Plain Node 24.22.0 prints **no** ExperimentalWarning on `require` or `import` (planner checked). If Electron's main ever prints one, record it in the hand-off; never silence warnings globally. `node:module.builtinModules` lists `node:sqlite`, so Vite keeps it external; D6 checks the built `out/main` imports it. Pragmas at open: `journal_mode=WAL` (assert it answers `wal`), `busy_timeout=5000`, `synchronous=NORMAL`, `foreign_keys=ON`.
- **G4. Local schema (migration 1).** Mirror tables with **every remote column** listed in `legacy/lib/core/sync/mirror_tables.dart` for `profiles`, `channel_state`, `brands`, `deals`, `activity_log` (minus its legacy `synced` flag), so 3d-2's pull needs no migration for them. `STRICT` tables; types: text, uuid, timestamptz (ISO 8601 as the server sends it), jsonb and arrays (JSON text) are `TEXT`; numeric `REAL`; integer and boolean `INTEGER`. No foreign keys on mirror tables (the server owns integrity; pages and tombstones arrive in any order). **App columns** with no Supabase home yet (nullable, questions Q2 to Q4): `channel_state.creator_stage`, `brands.sells`, `brands.status`, `deals.flow_step`. **Local-only tables:** `channels` (`channel_id` PK, `name`: the scraped half, which lives in R2 and arrives with 3e), `notifications` (`id`, `at` ms, `icon`, `text`, `sub`, `go_screen`, `go_tab`, `read`), `local_settings` (`key` PK, `value` JSON), `_meta` (`key`, `value`). Indexes: `activity_log(at desc, id desc)`, `notifications(at desc)`, `deals(brand_id)`, `deals(channel_id)`. **No `_outbox` or cursor tables:** no write in 3d-1 reaches a server, and an unused table is untested; 3d-2 adds them as migration 2. One database file is one account's copy (3d-2 decides what happens when the account changes).
- **G5. Migration runner.** Forward-only, versioned by `PRAGMA user_version`. Migrations are TypeScript modules exporting SQL strings (`migrations/0001-initial.ts`), so electron-vite bundles them with no asset copying. Each runs in its own `BEGIN IMMEDIATE` transaction that also sets `user_version`; a failure rolls back and throws. A database newer than the app knows is refused (never downgraded). The list must be numbered 1..n with no gap (a test).
- **G6. Mapping** (read; the write side is used now only by the seeder, and by 3d-2's outbox). Pure functions in `packages/core/src/data/legacy-mapping.ts`, unit-tested exhaustively.

  | App field | Local column | Rule |
  |---|---|---|
  | `TeamMember.name` / `myName` | `profiles.display_name` (`me`'s row) | `""` means unset: `myName` null; the renderer shows "You" for `me` |
  | `TeamMember.role`, `title` | `profiles.role`; title from extras | the role label is `title ?? strings.team.roles[role]` (Q1) |
  | `status`, `doing` | none (presence is realtime, 3d-2) | from the source's extras |
  | `Creator.id`, `handle` | `channel_state.channel_id`, `handle` | as is |
  | `Creator.name` | `channels.name` | falls back to `handle` |
  | `Creator.stage` | `creator_stage`, else derived | rejected (vetting) → `rejected`; `new` → `new`, or `shortlisted` if vetting is; `contacted` → `emailed`; `interested` → `replied`; `roster`, `negotiating`, `contract`, `awaitingDelivery`, `paid` → `signed`; `lost` → `parked` |
  | `Creator.email` | `channel_state.contacts` | the primary `method:"email"` entry, else the first, else null |
  | `Brand.name`, `sells`, `status` | `brands.name`, `sells`, `status` | `sells` null → `""`; `status` null → `"found"` |
  | `Deal.brand`, `creator`, `price` | `deals.brand_id`, `channel_id`, `brand_price` | price in dollars, as the app's type says today |
  | `Deal.step` | `flow_step`, else derived from `stage` | `proposed`, `negotiating`, `lost` → 0; `agreed`, `contractSent` → 1; `signed` → 2; `live` → 5; `closed` → 9 |
  | `LogEntry` | `activity_log` | `action` = text, `actor_id` = `me`, `actor_name`/`actor_role` from `me`'s profile, `entity_type` = `"app"`, `at` ISO ↔ ms (Q5) |
  | `FrameNotification` | `notifications` | newest first (`at` desc, then `id`); the example fixtures' order changes to match |
  | `notify` | `local_settings` key `notify` | per device for now (Q6) |
  | `counts`, `mateRun` | none | derived (step 4) and realtime plus runs (3d-2, 3e): from extras |

  Write side (seeder now, outbox later): stage → (`vetting_status`, `pipeline_stage`): new (newlyFound, new), shortlisted and contact (shortlisted, new), emailed (contacted), replied, kit, audience (interested), signed (roster), rejected (rejected, new), parked and never (newlyFound, lost); step → `stage`: 0 negotiating, 1 contractSent, 2-4 signed, 5-8 live, 9 closed. The app column always holds the exact value.
- **G7. Two sources, one implementation.** `createSqliteSource(db, { me, extras, now })` does all reads and writes through the repositories. **Example** = `example.db` in `app.getPath("userData")`, seeded through the same repositories from `exampleSeed(now)` when `_meta.example_seed` is missing or older than `exampleSeedVersion` (one transaction: clear the tables, insert, stamp), with extras from the fixtures (presence, titles, counts, Omar's run). It persists across restarts, so writes survive like real data; a fixture change bumps the version and re-seeds. **Live** = `gratovo.db` beside it with empty extras (everyone away, zero counts, no run); it is built and contract-tested but **not opened by the app in 3d-1**.
- **G8. Which source runs.** In 3d-1 the main process always opens the example source: there is no account, so live has nothing to show. No environment switch (nothing to leave a trace, ADR 0004); e2e gets the example source by the same rule, each test in its fresh `GRATOVO_USER_DATA`. 3d-2 adds `pickSource(session)`; prototype mode (3f) switches at run time.
- **G9. IPC.** `frame:load` (request `{}`, response the frame) and `data:write` (request `{ writes: DataWrite[] }`, 1 to 100, response `{}`). No path, URL or secret crosses. Limits in the schemas: ids ≤ 100 characters, text ≤ 500, name ≤ 80, log ≤ 50 entries (the newest; nothing shows the log yet, step 9's Toolbox log gets its own query), lists ≤ 5000. A `go` route is plain strings; the renderer checks it against its routes (unknown → Today). No main-to-renderer events until 3d-2's sync.
- **G10. Start-up.** `main.tsx` awaits `frame:load` before the first render. The main process opens the database inside `whenReady` before the window, so the call answers in milliseconds and the dark window shows nothing else meanwhile; no loading state. If it fails, the page shows a plain message (strings: "The app couldn't load its data", "Close it and open it again.") and the error is logged in main. A database that fails to open goes to the existing start-up error dialog. The database closes on `will-quit`.
- **G11. Writes and undo: a persister diffs the data.** After every store change (act, undo, redo, bg) the persister compares the data with the last data it saved, by reference, and turns the difference into writes: a notification's `read` changed → `notification.read`; `settings.notify` changed → `notify.set`; `myName` changed → `me.name`; log lines added or removed → `log.add` / `log.remove`. So undo and redo write their inverse with no extra code, and a background change is saved like any other. A change the vocabulary can't express (creators, brands, deals, team, counts, a new notification) is reported with `console.error` and not written; tests assert today's actions cause none. Writes go out in order, one batch in flight at a time. A failed batch shows a toast ("That change wasn't saved", "It will be gone after a restart.") and is not retried. New rows get `crypto.randomUUID()` ids (log lines were `l1`, `l2`… and would collide after a restart). 3d-2's sync will load rows into the store and move the persister's baseline without writing.
- **G12. "Saved" tells the truth.** The top bar's save state stays on "Saving…" until the write queue is empty, and at least the 700 ms it shows today. The e2e tests wait for "Saved" before restarting.
- **G13. Your name moves to the account** (ADR 0009 decision 22 said 3d would): `profiles.display_name` of `me`. The `name` preference and `loadMyName` go; `setMyName` stays a background change (not undoable), now saved by the persister. No carry-over of an old `name` preference: no build has reached the team, and prefs are parsed field by field, so the old key is ignored. The rail's `me === "u1"` checks stay until 3d-2 brings accounts.
- **G14. Supabase baseline.** `supabase/migrations/20261020120000_baseline.sql` = a short header comment, then `legacy/backend/schema.sql` byte for byte: production is schema.sql (A3, owner 2026-10-20), and any edit would be drift. The SQL runner checks the copy still matches while `legacy/` exists (step 11 drops that check). No additive migration in 3d-1: the gaps are questions for 3d-2 (below). Notes for 3d-2: production never ran this file through the CLI, so it is marked applied there (`supabase migration repair`), never pushed; from 2026-10-30 every new table in a later migration needs explicit `grant` lines (schema.sql's blanket grants cover only tables that exist when it runs).
- **G15. SQL tests.** Ported to `supabase/tests/`: the stubs and the five `test_*.sql`, pass 1 only. Pass 2 is dropped: `migrate_v2.sql` isn't carried over (plan §7) and its old-schema commit isn't in this history. The runner is a Node script (`supabase/tests/run.ts`, run by Node 24's type stripping, no dependencies), so it works the same in Git Bash, PowerShell and Linux with no path or line-ending traps. It starts a throwaway `postgres:17` container (Supabase's current default major; pinned by tag and digest; legacy used 16), applies the stubs, the baseline, the baseline a second time (re-runnable, as legacy checked), the later migrations in name order (after the baseline's blanket grants, so a missing grant shows), then every test, and always removes the container. New `test_30_grants.sql`: every public table has row-level security, `authenticated` and `service_role` hold their four privileges, `anon` holds none (the guard for the 2026-10-30 change). `pnpm test:sql` runs it locally (needs Docker Desktop running; a plain message if not). CI: a new job **SQL tests (Linux, Docker)** on `ubuntu-24.04`, like the analysis jobs; it tests the database, not the app, so the Windows-only rule holds.
- **G16. Records.** ADR `docs/decisions/0010-data-layer.md` (G1 to G15, alternatives: better-sqlite3, patch-based writes, an in-memory example). `docs/setup.md` waits for 3d-2 (nothing to set up yet).

### Questions for 3d-2 (none blocks 3d-1)

Q1 Agency roles (owner, account manager, VA, "first week") have no column; `profiles.role` is only unauthorized, basic, full. Q2 The app's creator stages (contact, kit, audience, never…) don't fit `pipeline_stage`: add `channel_state.creator_stage`? Q3 Brands have no `sells` or `status`. Q4 Deals have no flow step (draft, prelive, report, pay can't be told apart), and lost deals have no place in the app. Recommendation for Q2 to Q4: additive columns named as the local app columns, the app also writing the legacy fields so the old app keeps working. Q5 `activity_log` is append-only on the server, but undo removes a log line; and the app's free-text action doesn't match the old app's vocabulary. Q6 Notification switches: per device (now) or a per-user table? Q7 Confirm production runs Postgres 17 (owner can read it in the dashboard).

## Contracts

```ts
// packages/core/src/data/types.ts  (exported from "@gratovo/core/data"; renderer store.ts re-exports the moved types)
export type AppRole = "unauthorized" | "basic" | "full";
export type CreatorStage = /* moved from renderer store.ts, unchanged */;
export const notifyKinds: readonly ["reply", "money", "handoff", "search"]; export type NotifyKind = (typeof notifyKinds)[number];
export type NotifySettings = Readonly<Partial<Record<NotifyKind, boolean>>>;
export const notificationIcons: readonly ["reply", "wallet", "unlock", "forward", "alert", "pause", "scan", "check"];
export type NotificationIcon = (typeof notificationIcons)[number]; // a renderer test checks each is an IconName
export const nameMax = 80; // moves from prefs.ts
export interface TeamMember { readonly id: string; readonly name: string; readonly role: AppRole; readonly title: string | null; readonly status: "online" | "away"; readonly doing: string }
export interface FrameNotification { readonly id: string; readonly at: number; readonly icon: NotificationIcon; readonly text: string; readonly sub: string; readonly go: { readonly screen: string; readonly tab: string | null }; readonly read: boolean }
// Creator, Brand, Deal, LogEntry, RailCounts, MateRun: moved from renderer store.ts unchanged.
export interface Frame {
  readonly me: string; readonly myName: string | null; readonly team: readonly TeamMember[]; readonly counts: RailCounts;
  readonly notifications: readonly FrameNotification[]; readonly log: readonly LogEntry[]; // newest first, at most 50
  readonly creators: readonly Creator[]; readonly brands: readonly Brand[]; readonly deals: readonly Deal[];
  readonly mateRun: MateRun | null; readonly notify: NotifySettings;
}
export type DataWrite =
  | { readonly kind: "notification.read"; readonly id: string; readonly read: boolean } // unknown id: no-op
  | { readonly kind: "notify.set"; readonly notify: NotifySettings } // replaces the whole map
  | { readonly kind: "me.name"; readonly name: string } // trimmed, ≤ nameMax; "" = unset; no profile row: no-op
  | { readonly kind: "log.add"; readonly id: string; readonly at: number; readonly text: string } // id is a UUID; the actor is always `me`
  | { readonly kind: "log.remove"; readonly id: string }; // unknown id: no-op
export interface DataSource {
  frame(): Promise<Frame>;
  /** In order, in one transaction: all or none. */
  write(writes: readonly DataWrite[]): Promise<void>;
  close(): void;
}
// packages/core/src/data/example.ts: the fixtures of today's renderer example-data.ts, unchanged in content
export const exampleSeedVersion: number;
export interface ExampleSeed { me; profiles: { id; displayName; role: AppRole }[]; presence: Record<string, { status; doing; title }>;
  counts: RailCounts; creators: Creator[]; brands: Brand[]; deals: Deal[]; notifications: FrameNotification[]; mateRun(now: number): MateRun }
export function exampleSeed(now: number): ExampleSeed;
export function exampleFrame(now: number): Frame; // what a freshly seeded example source returns at `now`
// packages/core/src/data/legacy-mapping.ts
export function creatorStageFrom(row: { creatorStage: string | null; vettingStatus: string; pipelineStage: string }): CreatorStage;
export function legacyCreatorFields(stage: CreatorStage): { vettingStatus: string; pipelineStage: string };
export function dealStepFrom(row: { flowStep: number | null; stage: string }): number;
export function legacyDealStage(step: number): string;
export function primaryEmail(contactsJson: string): string | null;
```

```ts
// packages/ipc/src/channels.ts (new entries; schemas in packages/ipc/src/data.ts, typed z.ZodType<…> against core)
"frame:load": { request: z.strictObject({}), response: frameSchema },
"data:write": { request: z.strictObject({ writes: z.array(dataWriteSchema).min(1).max(100) }), response: z.strictObject({}) },
// apps/desktop/src/main/handlers.ts: HandlerContext gains `data: DataSource`
// apps/desktop/src/main/db/: openDatabase(path | ":memory:"): DatabaseSync; migrate(db, migrations = all): void;
//   class DatabaseTooNewError; interface Migration { readonly version: number; readonly name: string; readonly sql: string }
// apps/desktop/src/main/data/: createSqliteSource(db, { me, extras, now }): DataSource;
//   openExampleSource(path, now?): DataSource; openLiveSource(path, me, now?): DataSource; interface FrameExtras { presence(id); counts(); mateRun() }
// apps/desktop/src/renderer/lib/frame.ts:   toAppData(frame: Frame): AppData
// apps/desktop/src/renderer/lib/persist.ts: diffData(before: AppData, after: AppData): { writes: DataWrite[]; unsupported: string[] }
//   installPersistence(invoke: Bridge["invoke"]): () => void; persistenceIdle(): boolean
// apps/desktop/src/renderer/lib/store.ts:   initAppStore(data: AppData, start: Route): void (before first render; the store starts empty)
```

## Tasks

| id | title | tier | depends_on | files |
|---|---|---|---|---|
| D1 | Core data contract, mapping, example fixtures | H | — | `packages/core/src/data/{types,legacy-mapping,example,index}.ts` + `legacy-mapping.test.ts`, `example.test.ts`; `packages/core/package.json` (`./data` export) |
| D2 | Supabase baseline, SQL tests, runner, CI job | N | — | `supabase/migrations/20261020120000_baseline.sql`; `supabase/tests/{00_supabase_stubs,test_12…,test_17…,test_19…,test_20…,test_21…,test_30_grants}.sql`, `supabase/tests/run.ts`, `supabase/README.md`; root `package.json` (`test:sql`), `tsconfig.tools.json`; `.github/workflows/ci.yml` |
| D3 | Local database: open, migrate, migration 1 | N | — | `apps/desktop/src/main/db/{open-database,migrate}.ts` + tests; `db/migrations/{0001-initial,index}.ts` |
| D4 | Repositories | N | D1, D3 | `apps/desktop/src/main/data/repositories/{profiles,creators,brands,deals,activity-log,notifications,settings,meta}.ts` + one test file each or grouped by two |
| D5 | The sources and their contract suite | N | D4 | `main/data/{sqlite-source,example-source,live-source,data-source-contract}.ts` + `example-source.test.ts`, `live-source.test.ts` |
| D6 | IPC channels, handlers, main wiring | N | D1, D5 | `packages/ipc/src/{data,channels,index}.ts` + tests, `packages/ipc/tsconfig.lib.json`; `main/{handlers,index}.ts` + `handlers.test.ts`; `apps/desktop/tsconfig.node.json` |
| D7 | Renderer reads through IPC | N | D6 | `renderer/lib/{frame,store,example-data}.ts` + tests, `renderer/main.tsx`, `renderer/strings.ts`, `renderer/lib/settings.ts` (re-export `NotifyKind`) |
| D8 | Renderer writes: persister, save state, your name | H | D7 | `renderer/lib/persist.ts` + test, `renderer/lib/{actions,prefs}.ts` + tests, `renderer/main.tsx`, `renderer/strings.ts` |
| D9 | Electron tests for the data layer | N | D8 | `apps/desktop/e2e/{data.spec,fixtures}.ts` |
| D10 | Verify, review, ADR 0010, docs, PR (lead) | H | D2, D9 | `docs/decisions/0010-data-layer.md`, `docs/architecture.md`, `docs/migration-plan.md`, `docs/decisions/0009-app-shell.md` (consequence answered), `apps/desktop/README.md`, `.router/*` |

**Parallel:** D1, D2 and D3 share no files and can run at once. D2 runs alongside everything up to D10. D4 to D9 are a chain.

### D1. Core data contract (H)
Spec: the Contracts block. Move `Creator`, `Brand`, `Deal`, `LogEntry`, `RailCounts`, `MateRun`, `CreatorStage` here unchanged (the renderer re-exports them in D7; D1 doesn't touch the renderer). Move the fixtures from `renderer/lib/example-data.ts` into `example.ts` with the same AI-niche content; team names and titles as today (u1 display name `""`, title "Owner"; Sara "Account manager"; Omar "VA"; Lina "VA · first week"), roles u1 `full`, others `basic`. `exampleFrame(now)` sorts notifications newest first. Mapping per G6, every branch tested (core aims at 100% branch coverage). No I/O: core's typecheck has no Node types.
done_check: `pnpm exec vitest run packages/core && pnpm typecheck`

### D2. Supabase (N)
Spec: G14, G15. Copy the stubs and tests from `legacy/backend/tests/` (update headers that name `backend/tests/run.sh`). `run.ts`: `node:child_process` `spawnSync("docker", …)`; container `gratovo-sqltest-<pid>`; wait for `select 1` (not `pg_isready`, as legacy explains) up to 60 s; `psql -U postgres -d gratovo -v ON_ERROR_STOP=1` with each file as stdin; check the baseline's body equals `legacy/backend/schema.sql` when that file exists; remove the container in `finally` and on SIGINT; exit 1 on any failure. Pin `postgres:17.x@sha256:…` (find the digest with `docker pull` and `docker inspect`; pick a release at least a few days old). CI job `sql`: same pinned `actions/checkout` and `actions/setup-node` (`node-version-file: .nvmrc`, no cache), skipped on `schedule`, `timeout-minutes: 15`, runs `node supabase/tests/run.ts`, with a comment that it tests the database, not the app; update the file's header comment ("Step 3g adds the SQL tests"). README: what each file holds, how to run, why pass 2 is gone.
done_check: `pnpm test:sql && pnpm lint && pnpm typecheck` (Docker Desktop running)

### D3. Local database (N)
Spec: G3, G4, G5. `openDatabase` sets the pragmas, then `migrate`. Migration 1 creates every table and index of G4 (column lists from `mirror_tables.dart`; comment the app columns "no Supabase column yet: 3d-2 Q2-Q4"). Tests on a temp folder (copy `secret-store.test.ts`'s `mkdtemp` and Windows-safe `rm` with retries; close the database before removing): fresh → `user_version` 1 and all tables; re-run → no change; a v1 database plus a v2 list applies only v2; `user_version` above the list → `DatabaseTooNewError`; a failing v2 leaves version 1 and no partial table; list numbered 1..n; WAL is on.
done_check: `pnpm exec vitest run apps/desktop/src/main/db && pnpm typecheck`

### D4. Repositories (N)
Spec: G4, G6. One module per table: prepared statements, rows in, app types out, through the D1 mapping. `profiles` (upsert, list, setDisplayName), `creators` (channel_state + channels: upsert from a `Creator`, writing app and legacy columns; list), `brands`, `deals` (same pattern), `activity-log` (add with actor from `me`'s profile, remove, newest(50)), `notifications` (upsert, setRead, list newest first), `settings` (get/set JSON by key), `meta` (get/set). Timestamps: mirror tables ISO, local tables ms. Tests on a temp database per repository: round trips, legacy rows written by hand (as the old app would) read back through the derived rules, `STRICT` rejects a wrong type.
done_check: `pnpm exec vitest run apps/desktop/src/main/data/repositories && pnpm typecheck`

### D5. Sources (N)
Spec: G2, G7, G11's write semantics. `createSqliteSource` runs a write batch inside one transaction (rollback on any throw). `data-source-contract.ts` exports `describeDataSourceContract(name, make)` run by both test files: frame round trip of seeded fixtures; each write kind and its read-back; `me.name` `""` → `myName` null; log newest first and capped at 50; unknown ids are no-ops; a batch with a duplicate `log.add` id applies nothing; close and reopen keeps everything. Example only: a fresh file equals `exampleFrame(now)` with an injected clock; reopening doesn't re-seed (a write survives); a higher `exampleSeedVersion` re-seeds. Live only: an empty file gives empty lists, null name, zero counts, no run; the live test seeds through the repositories with the example fixtures to share the contract.
done_check: `pnpm exec vitest run apps/desktop/src/main/data && pnpm typecheck`

### D6. IPC and main wiring (N)
Spec: G1, G8, G9, G10. Schemas in `packages/ipc/src/data.ts` with the G9 limits; `channels.test.ts` and `dispatch.test.ts` cover a valid frame, an over-long name, an empty or 101-write batch, an unknown write kind, a frame with an extra field refused by the response check. `handlers.ts` gains `frame:load` and `data:write` (test with a fake `DataSource`, as `storeWith` fakes secrets). `index.ts`: open `openExampleSource(join(app.getPath("userData"), "example.db"))` in `whenReady` before `registerBridge`; close on `will-quit`; failures reach the existing start-up dialog. Check the build keeps `node:sqlite` external.
done_check: `pnpm exec vitest run packages/ipc apps/desktop/src/main && pnpm typecheck && pnpm build && grep -q "node:sqlite" apps/desktop/out/main/index.js`

### D7. Renderer reads (N)
Spec: G10, the mapping's renderer half. `store.ts` re-exports the moved types (UI imports don't change), keeps `Member` (role is a label) and `Notification` (`icon: IconName`, `go: Route`); starts with empty data; `initAppStore` replaces it before the first render; `resetAppStoreForTests` builds from `exampleData(now)`, which becomes `toAppData(exampleFrame(now))`. `frame.ts`: `toAppData` (role label `title ?? strings.team.roles[role]`, "You" for `me` with no name, routes checked with `routes.ts`). `main.tsx`: await `frame:load`, show the G10 message on failure. Strings for all new words in `strings.ts`. Fix the tests that relied on the old notification order (G6), saying why.
done_check: `pnpm exec vitest run apps/desktop/src/renderer && pnpm typecheck && pnpm lint`

### D8. Renderer writes (H)
Spec: G11, G12, G13. `persist.ts`: pure `diffData` plus a queue that subscribes to the store, batches what one change produced, sends `data:write`, one batch in flight. Tests with a real store and a fake invoke: mark all read, then undo, then redo (writes `read` true, false, true); `setNotify` and its undo; `setMyName` (and `""`); a log line added by an act and removed by its undo; a `bg` change; a creators change is reported as unsupported and not sent; order kept while a batch is in flight; failure shows the toast. `actions.ts`: log ids from `crypto.randomUUID()`; `setMyName` without the pref; `loadMyName` removed; the save state waits for `persistenceIdle()`. `prefs.ts`: drop `name` (an old stored `name` is ignored, tested). `main.tsx` installs persistence after `initAppStore`.
done_check: `pnpm exec vitest run apps/desktop/src/renderer && pnpm typecheck && pnpm lint`

### D9. Electron tests (N)
Spec: acceptance 3. `fixtures.ts` gains a way to relaunch with the same data folder (a `launchApp(userData)` helper the fixture reuses; the folder is removed only at the end). `data.spec.ts`: `example.db` exists in the data folder after start; mark all read, wait for "Saved", restart → the bell shows no unread; set your name, wait for "Saved", restart → the rail shows it; no console errors on start (the unsupported-change report would show here). Then the whole suite.
done_check: `pnpm test:e2e`

### D10. Lead
Full `pnpm lint && pnpm typecheck && pnpm test && pnpm test:sql && pnpm test:e2e`; a look at the frame at 1440 px in dark (it must be unchanged); `router-reviewer` on the diff; `sentry-security-review` on the new channels and the SQL runner. Write ADR 0010; architecture: "Local-first data" (what 3d-1 built), Versions (`node:sqlite` with SQLite 3.53.4 inside Electron 44.9.0; `postgres:17.x` for the SQL tests); migration plan: status, 3d split into 3d-1 and 3d-2 with their acceptance, pass 2 dropped; ADR 0009's last consequence points to 0010; CLAUDE.md's Commands gains `pnpm test:sql` only if the owner agrees. PR, CI green, merge.
done_check: CI green on the pull request
