# Context for Insights (plan step P8a)

Map for the Insights work. Paths are repo-relative from `E:\IMA work\Code\gratovo_toolbox`. Facts checked 2026-10-28 by reading the code; no code was changed.

## 1. Commands and setup

- `pnpm lint`: eslint, prettier --check, ruff check and format --check.
- `pnpm typecheck`: `tsc -b` then pyright.
- `pnpm test`: `vitest run` (root), the gemini-extension tests, then `pytest` in `services/pipeline`.
- One Vitest file: `pnpm exec vitest run packages/core/src/find/fit.test.ts`. Filter by name with `-t "text"`.
- One pytest file: `uv run --directory services/pipeline pytest tests/test_store_migration.py`.
- One Electron spec (Windows only): `pnpm build`, then `cd apps/desktop && pnpm exec playwright test e2e/smoke.spec.ts`. `pnpm test:e2e -- <file>` does not filter.
- Before a PR: `pnpm verify` (the local gate), then `pnpm verify --status`. Pull requests need lint, typecheck, unit tests and at most one new light Electron smoke test.
- Node: put `~/.local/opt/node-v24.22.0-win-x64` first on `PATH` (Git Bash finds 24.19 first otherwise). pnpm 12.14.0. `uv`, `gitleaks`, `osv-scanner`, `gh` live in `~/.local/bin`.
- In Git Bash, `unset ELECTRON_RUN_AS_NODE` before Electron tests.
- Source: `docs/workflow.md` (setup and lessons), `CLAUDE.md`.

## 2. IPC: declare, handle, call

Declare (`packages/ipc/src/`):
- `channels.ts`: the `channels` object. Key `domain:verb`, value `{ request: zod, response: zod }`. Types `Channel`, `ChannelRequest`, `ChannelResponse`. `"toolbox:*"` entries are at ~line 254; `"close:*"` at ~446.
- `close.ts`: small example. Schemas per channel (`closeCreatorRequestSchema`, `closeDeclineResultSchema`), refusals as `{ ok: false, problem }`.
- `toolbox.ts`: the better model for reads. Schemas typed against core types (`toolboxItemSchema: z.ZodType<ToolboxItem>`), a page with `offset`/`limit` capped by constants, `version` in results.
- `index.ts`: re-exports every schema and type the app uses. A new schema must be re-exported here.
- `bridge.ts`: `bridgeChannel = "gratovo:invoke"`, `appEventNames` (the events main may push), `Bridge` type, `InvokeResult` (`{ok, value}` or `{ok:false, reason}`).
- `events.ts`: `appEvents` map (push events such as `find:catalog`). Add an event here and in `bridge.ts` only if the screen must refresh on a push.

Main (`apps/desktop/src/main/`):
- `handlers.ts`: `buildHandlers(context)` returns an object with one entry per channel (e.g. `"toolbox:list"` ~line 226, `"close:decline"` ~288). Type `Handlers` (in `packages/ipc/src/dispatch.ts`) makes TypeScript require a handler for every channel. `HandlerContext` (~line 37) lists what handlers may use. `createHandlers` (~line 111) wraps `refuseWhileOn`.
- `services.ts`: `HandlerServices` interface, one typed service per area (`ReachService`, `ConnectionsService`, ...).
- `stub-services.ts`: stand-ins that answer "not built" until a service exists. Touch nothing.
- `index.ts` ~line 628: `registerBridge(createHandlers({ ... }))`, where each service is passed in. Services are created earlier in the file (`createArchiveService` ~line 390).
- `ipc-bridge.ts`: `registerBridge` handles `gratovo:invoke`, refuses calls not from the app's top frame, and calls the dispatcher.
- `dispatch.ts` (packages/ipc): checks each request against its schema before the handler, and each response after it. A thrown error is logged and the page gets "The call failed".
- `prototype/refused.ts`: `refusedWhileOn` set (channels blocked in prototype mode). A read like `insights:read` is NOT added. Add one audit line in the comment above the set; a test (`refused.test.ts`) checks the channel names are real.

Renderer:
- `apps/desktop/src/preload/index.ts` exposes `window.gratovo` with `invoke` and `on`. No change for a new channel.
- Calls look like `window.gratovo.invoke("toolbox:counts", {})` (`renderer/lib/toolbox.ts`, `useToolboxCounts`). Result is an `InvokeResult`; a failed read keeps the last value.
- Refresh on change: `renderer/lib/find-catalog.ts` (`useCatalogTick`) re-reads on `find:catalog`.

Files a new `insights:read` channel would touch:
1. `packages/ipc/src/insights.ts` (new) and `insights.test.ts` (new): request and response schemas.
2. `packages/ipc/src/channels.ts`: import and one entry.
3. `packages/ipc/src/index.ts`: re-export.
4. `apps/desktop/src/main/insights/` (new): the reader, reading `gratovo.db` and `pipeline.db`.
5. `apps/desktop/src/main/handlers.ts`: `HandlerContext` field and handler entry.
6. `apps/desktop/src/main/index.ts`: create the service and pass it to `createHandlers`.
7. `apps/desktop/src/main/prototype/refused.ts`: audit comment only.
8. `packages/core/src/insights/` (new): the pure maths, with tests.
9. Renderer: `renderer/lib/insights.ts` (hook), `renderer/insights/` (screen), `renderer/app/app.tsx` (branch), `renderer/strings.ts`, `renderer/lib/wired.ts`.

## 3. Local database `gratovo.db`

- File name: `gratovo.db` for live data (`apps/desktop/src/main/account/account.ts` `liveFile`, line ~128). Example copy is `example.db` (`exampleFile`). Prototype copy is `prototype.db` (`apps/desktop/src/main/prototype/prototype.ts`, `prototypeFile`).
- Opened with `node:sqlite` `DatabaseSync` through `apps/desktop/src/main/db/open-database.ts`.
- Migrations: `apps/desktop/src/main/db/migrations/`. Files `0001-initial.ts` to `0006-draft-goal.ts`; `index.ts` lists them in order. Latest is **6**. A new one is `0007-<name>.ts` with `version: 7`, appended to `index.ts`. Runner: `db/migrate.ts` (uses `PRAGMA user_version`; `DatabaseTooNewError`).
- Migration tests: `db/migrate.test.ts`. It uses `new DatabaseSync(":memory:")`, checks numbering with no gap, and checks each new table and its constraints by name.
- Tables:
  - Team and sync: `profiles`, `member_access` (0002), `_outbox`, `_outbox_dropped`, `edit_conflicts` (0003).
  - Creators: `channel_state` (one row per creator: `channel_id`, `handle`, `creator_stage` (the app's stage), `pipeline_stage` (legacy, written beside it), `archive_due_at`, `contacts`, `media_kit`, `provided_data`, `manual_engagement_rate`, `channel_tags`, `notes`). `channels` (local only: `channel_id`, `name`).
  - Brands and deals: `brands`, `deals` (small; used by P8b).
  - Activity: `activity_log` (`id`, `at` text, actor fields, `action`, `entity_type`, `entity_id`, `field`, `old_value`, `new_value`, `detail`). Repo: `data/repositories/activity-log.ts` (`newestLog`, `linesSince`, `logPage`).
  - Outreach (0004, 0006): `outreach_drafts` (`kind` first/followUp/reply, `state`, `goal`, `send_at`, `mailbox`), `outreach_messages` (`direction` in/out, `at` integer ms, `mailbox`, `peer`, `conversation_key`, `gmail_message_id` UNIQUE, `source` app/sweep/pasted/imported, `reading`), `outreach_sequences` (`channel_id` PK, `steps` JSON, `stopped` you/replied/bounced/finished, `park_until`). Repo: `data/repositories/outreach.ts` (`createOutreachStore`).
  - Mailboxes: no table. Sender settings are in `local_settings` key `mail.settings` (label, senderName, mailboxes with dailyCap and warmupStartedOn). Pause and slowdown flags are `local_settings` key `reach.mailboxes` (`reach/mailbox-settings.ts`). Real send and reply history for live data is in Python's `mailbox.db` (`services/pipeline/src/gratovo_pipeline/mail/mailbox.py`: `conversations`, `sent_messages`, `sequence_steps`, `inbound_messages`, `send_keys`, `mailbox_state`).
  - Settings: `local_settings` (key/value; `data/repositories/settings.ts`: `getSetting`, `setSetting`, `getNotify`). `notifications`, `_meta` (e.g. `example_seed` version stamp, `prototype_scenario`), `comments` (0005, prototype only).
- Sync lists:
  - `apps/desktop/src/main/sync/mirror-tables.ts`: `mirrorTables` = `channel_state`, `brands`, `deals`, `activity_log` (keyset pull).
  - `apps/desktop/src/main/sync/whole-tables.ts`: `profiles`, `member_access`, notification switches, open `edit_conflicts` (read whole each pass).
  - Not synced (local only): `channels`, `notifications`, `local_settings`, `_meta`, all `outreach_*`, `comments`.

## 4. `pipeline.db` (Python writes, main reads)

- Schema and version: `services/pipeline/src/gratovo_pipeline/store.py`. `SCHEMA_VERSION = 4` (line 33), `SCHEMA` string (tables), `MIGRATIONS` steps for 2 and up, `init_db(conn)` (~line 338) stamps `PRAGMA user_version`. Tests: `services/pipeline/tests/test_store_migration.py`. Other Python-owned file: `mailbox.db` (`mail/mailbox.py`, `SCHEMA_VERSION = 1`).
- Tables (from `store.py`):
  - `channels` (PK `channel_id`): `handle`, `name`, `country`, `subscribers` (TEXT), `first_seen_at`, `videos_last_30`, `median_views_last_30`, `latest_upload_at`, `unreadable_until`, `median_known`, `videos_last_30_known`, `sponsored_ratio`, `seen_brands` (JSON), `found_emails` (JSON). **`read_failures` is a column on `channels`, not a table.**
  - `channel_keywords` (PK `channel_id`, `keyword`; `discovered_at`, `source`, `announced`): the keyword links.
  - `keywords` (PK `keyword`): `status` pending/in_progress/done, `channels_found`, `search_settings` (JSON).
  - `channel_archive` (the tombstone, PK `channel_id`): `archived_at`, `found_at`, `found_via` (JSON), `median_views_last_30`, `videos_found_count`, `name`, `country`, `videos_last_30`, `latest_upload_at`, `seen_brands`, `found_emails`.
  - `archive_keyword_pending` (PK `channel_id`, `keyword`): keywords a search re-found on an archived channel.
  - `runs` (`run_id` autoincrement): `started_at`, `finished_at`, `status` running/done/stopped/interrupted, `keywords_total`, `keywords_done`, `channels_upserted`, `videos_upserted`, `kind`.
  - `videos`, `video_transcripts` (v2), `sync_state`, `_applied_segments`.
- Main reads it read-only with `new DatabaseSync(path, { readOnly: true })`:
  - `find/catalog.ts` (the catalog build, `readRuns`), `find/toolbox.ts` (`openRead`, `countArchived`, `readArchived`, `toolboxCounts`), `find/results.ts` (`readKept`), `find/runs.ts` (`readRunWindows`, `readRuns`).
  - Path: `apps/desktop/src/main/handlers.ts` `pipelineDb()` (~line 129) = `join(find.folder(), "pipeline.db")`. Also `index.ts` ~line 345 (`pipelineDbPath`).
  - Folders: `example-pipeline` (example data), `prototype-pipeline` (prototype), `pipeline` (live). `account/account.ts` `findContext()` ~line 1028.
- Test helper: `apps/desktop/src/main/find/catalog-fixture.ts` `writePipelineDb(path, {channels, ...})` writes a `pipeline.db` with the Python tables.

Archive sweep:
- Main: `apps/desktop/src/main/find/archive-service.ts` `createArchiveService` (wired in `index.ts` ~line 390). It picks `rejected` creators whose `archiveDate` has passed, at most `sweepMax = 2000` per job, and runs the Python job `archive.sweep` on the store lane. First sweep 30 s after start, then hourly (`sweepEveryMs`), and on `toolbox:sweep` (`handlers.ts` ~line 233).
- Restore: `archive.restore` via `toolbox:restore`.
- Python job: `services/pipeline/src/gratovo_pipeline/jobs/archive.py` (`_sweep`, dispatched from `jobs/__init__.py` line 46). Tests: `tests/test_archive.py`, `tests/test_archive_job.py`.

## 5. Prototype mode and example data

- Seed: `packages/core/src/data/example.ts`.
  - `exampleSeed(now: number, scenario: Scenario = "normal"): ExampleSeed` (line 135).
  - `scenarios = ["normal", "first", "later", "broke"]` (line 39). `first` = `firstSeed`, `broke` = `brokeSeed` (both in `example-scenarios.ts`), `later` = normal shifted back 7 days.
  - `exampleSeedVersion = 8` (line 36). Bump it when the seed changes, so stored copies reseed.
  - `exampleFrame(now)` (line ~177) for the frame.
- Writing it: `apps/desktop/src/main/data/example-source.ts`. `openExampleSource` and `openExampleCopy(path, now, { fresh, scenario })`. Clears `dataTables` (activity_log, notifications, deals, brands, channel_state, channels, profiles, local_settings, member_access, outreach_*) and reseeds if the stored version is old. `_meta.example_seed` holds the version.
- Prototype copy: `apps/desktop/src/main/prototype/prototype.ts`. `prototype.db` plus the `prototype-pipeline` folder. `openCopy` = `openExampleCopy`. Scenario kept in `_meta.prototype_scenario`. Turning it off leaves no trace (its folder is emptied by its own call only).
- **Pipeline data is not in the seed as rows.** No `pipeline.db` is shipped. Example data for Find comes from the Python example source: `services/pipeline/src/gratovo_pipeline/example/__init__.py` reads `channels.json` (30 made-up AI channels, 6 keywords, ids `UCexampleAiCreator000000`-style, `READ_PAUSE` 0.15 s). A search writes `pipeline.db` in `example-pipeline` or `prototype-pipeline`. A fresh copy has no catalog, runs or archive until a search runs.
- Seed size today (counted from the source, approximate):
  - 4 team profiles (`u1` to `u4`).
  - 7 creators (`c1` to `c5`, `c11`, `c12`), each with a kit.
  - 5 brands, 5 deals.
  - About 10 drafts (`drafts()`, example.ts ~658).
  - Messages: hand-written ones in `messages()` (~831) plus `history()` (~996): 30 channels (`hist-ch-0..29`), 5 replies and a bounce. Roughly 70 to 80 in all.
  - Sequences (~953), notifications (~277).
- Implication for P8a: the six-month history and the archive of about 150,000 must reach `pipeline.db` and `gratovo.db` at real scale. No fixture writer exists beyond the test helper. Plan P8a says P1-3 grows the seed to v6's size afterwards.
- Rules: example data is about AI creators and sponsors only. No screen reads prototype-mode state.

## 6. Renderer

- Placeholder: `apps/desktop/src/renderer/app/placeholder-screen.tsx` `PlaceholderScreen({ screen })`. `renderer/app/app.tsx` (~line 82) falls through to it, so Insights shows it today. Add an `insights` branch next to `close` and `toolbox` (~lines 76-82).
- Routes: `renderer/lib/routes.ts`. `ScreenKey` includes `"insights"`. `screens.insights` icon `chart`, hue `var(--ink-2)`. Tabs come from `strings.ts` `screens.insights.tabs` (line ~1565, currently `{}`). Six tabs per the design: Overview, Funnel, Emails, Search, Money, Goal. `goLetters` maps `i` to insights.
- Live gate: `renderer/lib/wired.ts` `liveWired`. Insights is absent, so it is hidden on live data. Add `insights: [...]` with only the P8a tabs (Money waits for P8b). `renderer/lib/wired.test.ts` line 17 lists `"insights"` in `hidden` for live data and must change with it.
- Strings: `renderer/strings.ts` (one large object, per-feature blocks such as `closeScreen` (~1713), `toolbox` (~1763), `reach` (~2035), `placeholder` (~1522), `screens` (~1530)). Plain sentences, functions for counts (`(name: string) => ...`). Put Insights words in a new block there, keyed.
- Tokens: `packages/ui/src/tokens.css`. Light values in `:root`; the dark values sit in `@media (prefers-color-scheme: dark)`. The app is dark only, so use the dark values. No colour literals in components. Useful: `--ink`, `--ink-2`, `--muted`, `--faint`, `--line`, `--sunk`, `--panel`, `--accent`, `--find`, `--reach`, `--close`, `--deliver`, `--money`, `--good`, `--warn`, `--crit`, `--r-m`, `--gap`, `--pad`. Fonts: `--f-ui`, `--f-mono`.
- UI kit (`packages/ui/src/index.ts`): `Avatar`, `Btn` (props `kind`, `size="sm"`, `icon`, `kbd`, `tip`, `label`, `disabled`, `expanded`, `onClick`), `cx`, `Empty` (`icon`, `title`), `Icon`, `IconBtn`, `IconName` (includes `chart`), `Kbd`, `PageHead` (`dataUi`, `title`, `sub`, `hue`), `Seg` (`label`, `value`, `options`, `onPick`), `Switch`, `Tag`. Classes in `packages/ui/src/controls.css`: `.tabs` (~line 301), `.seg`, and `.card`, `.num`, `.muted` in the frame CSS.
- Tabs pattern: `renderer/close/close-screen.tsx` `CloseTabs`: a `role="tablist"` with buttons, arrow keys move focus, `go(screen, tab)`.
- Tooltip: `renderer/overlays/tooltip.tsx`, one global tip driven by a `data-tip` attribute. `Btn`'s `tip` prop sets it.
- Existing hand-drawn SVG: `renderer/find/fit-chip.tsx` (a ring with `ring-bg` and `ring-fg` circles, `viewBox 0 0 22 22`). No chart library and no bar or line chart component exist. Insights charts are new SVG, hand-drawn.
- Copy this screen: `renderer/close/`. `close-screen.tsx` (`.page` div, `data-ui="close.page"`, `PageHead`, `CloseTabs`, `role="tabpanel"`), `roster.tsx`, `close.css`, `close-fixtures.ts` for tests.
- State: `renderer/lib/store.ts` (`useApp`, `selectRoute`, `go`). Data hooks: `renderer/lib/find-catalog.ts`, `renderer/lib/toolbox.ts`. Clock: `renderer/lib/use-now.ts`.
- Design spec: `docs/product/insights-design.md` (sections 2a, 3.4, 10); mockups in `design/insights/` (`overview.html`, `funnel.html`, `emails.html`, `money.html`, `goal.html`, `README.md`).

## 7. Fit score, rejects and archive date

- `packages/core/src/find/fit.ts`:
  - `fitScore(item: CatalogItem): number` sums five parts, max 100: median views (30), postings in the last 30 days (15, only when `hasNumbers && uploadsRead`), audience (25, by `country` in US, GB, CA, AU), engagement (15, `engagement` typed by the owner), sponsors (15, `sponsors` list).
  - `fitOf(item): Fit` gives the same parts with notes. `isGold(item)` is the gold-mine test.
  - Inputs come from `CatalogItem` (`packages/core/src/find/types.ts` line ~39): `medianViews`, `uploads30`, `country`, `subscribers`, `engagement`, `sponsors`, `hasNumbers`, `uploadsRead`, `latestUploadAt`, `rejectReason`, `rejectedAt`, `archiveDueAt`, `archivedAt`.
- Reject reasons: `packages/core/src/data/types.ts` line 44, `rejectReasons = ["ai", "views", "posting", "audience"]`. `RejectReason` type.
- `packages/core/src/find/archive.ts` `archiveDate(c, archiveDays)`: if `archiveDueAt` is set, it returns `archiveDueAt + (archiveDays - 7) days`; else `rejectedAt + archiveDays days`; else null. `serverArchiveDays = 7`. `archiveDays` comes from Settings › Search rules (`find.state().rules.archiveDays`).

## 8. Tests

- Config: root `vitest.config.ts` (one config for every package). Includes `packages/*/src/**/*.test.{ts,tsx}` and `apps/*/src/**/*.test.{ts,tsx}`; `maxWorkers: "50%"`, `testTimeout: 10000`. Server tests use `vitest.server.config.ts` (`pnpm test:server`). Packages have `tsconfig.test.json`.
- Component test: `packages/ui/src/components.test.tsx` shows the header `// @vitest-environment happy-dom`, `@testing-library/react` `render`/`cleanup` in `afterEach`, `vi` from vitest. Renderer examples: `renderer/close/close-screen.test.tsx`, `renderer/overlays/tooltip.test.tsx`.
- Main side with a temp SQLite file: `apps/desktop/src/main/find/toolbox.test.ts`. It uses `mkdtempSync(join(tmpdir(), ...))`, `writePipelineDb` from `catalog-fixture.ts`, and `DatabaseSync`, and removes the folder in `afterEach`. In-memory variant: `db/migrate.test.ts`.
- Example data: `packages/core/src/data/example.test.ts` (fixed `now` = 20 Oct 2026 10:30 local; checks the team, counts, scenarios and `exampleSeedVersion`).
- Wired: `apps/desktop/src/renderer/lib/wired.test.ts` (example shows all; live hides `insights` until wired).
- IPC: `packages/ipc/src/channels.test.ts` (`parseRequest`, refusals of unknown and extra keys); per-area files such as `toolbox.test.ts`, `close.test.ts`.
- Electron: `apps/desktop/e2e/fixtures.ts` exports `test` with fixtures `app`, `page`, `errors`. Each test gets its own user-data folder through `GRATOVO_USER_DATA`, and a fake Supabase. `e2e/smoke.spec.ts` checks the window and the frame. `e2e/close-roster.spec.ts` shows the flow style: click the rail button by role and name (`strings.screens.<key>.name`), locate by `data-ui` ids inside a named region, read words from `strings`. A new light smoke test for Insights follows this pattern.
- Python: `services/pipeline/tests/` (pytest, no network; `test_store_migration.py`).

## Risks to plan for

- Adding a migration or changing `exampleSeedVersion` changes stored example copies. Prototype data reseeds when the version rises.
- `refused.ts` comment is an audit: keep it true when a channel is added.
- `wired.test.ts` will fail on purpose when `insights` is wired for live data.
- Pipeline and archive numbers at real scale must come from writing `pipeline.db` directly or by a search; do not put them in the renderer.
