# CONTEXT: codebase map for plan step 6 (Reach)

Paths are from `E:\IMA work\Code\gratovo_toolbox`. Read `CLAUDE.md`, `docs/migration-plan.md` (Step 6 at line ~177) and `docs/conventions.md` first. Windows only. Dark only. English only, strings in one module. Example data is AI creators and AI sponsors only.

## 1. Commands

- `pnpm lint` ESLint, Prettier check, ruff check and format check.
- `pnpm typecheck` runs `tsc -b` then pyright.
- `pnpm test` runs Vitest (root), the gemini-extension test, then pytest.
- One Vitest file: `pnpm vitest run apps/desktop/src/main/find/ideas.test.ts`.
- One pytest file: `uv run --directory services/pipeline pytest tests/test_comms_actions.py`.
- One Electron spec: `cd apps/desktop && pnpm exec playwright test e2e/<file>` after `pnpm build` (see `docs/workflow.md`, "Setting up"). `pnpm test:e2e -- <file>` does not filter.
- `pnpm test:e2e` = `install-electron` + `electron-vite build` + Playwright. Runs only on the owner's Windows PC; cloud sessions can't run it.
- `pnpm verify` is the PR gate (`tooling/verify.ts`): secrets, audit, lint, typecheck, test, e2e, plus sql/server when `supabase/` or the sync code changes. `pnpm verify --status` marks the commit green.
- Per-sub-step PR needs lint, typecheck, unit tests, at most one new light Electron smoke test. Full Playwright suite runs once at the end of a major step.
- Snapshot of Node 24.22.0, pnpm 12.14.0, uv. Never run `git stash`, `git reset` or `git checkout -- <file>` in the shared tree.

## 2. One IPC channel, end to end (worked example: `toolbox:counts`, and `find:views` for a write)

Pieces, in order:

1. **Schema:** `packages/ipc/src/toolbox.ts` exports `toolboxCountsSchema` (zod, typed against the core type). Find channels: `packages/ipc/src/find.ts` (`findViewsResultSchema`, `findViewsSetRequestSchema`, `findViewsSetResultSchema`). Shared bits: `packages/ipc/src/data.ts` (`dataWriteSchema`, `frameSchema`).
2. **Channel list:** `packages/ipc/src/channels.ts`, the `channels` object. Each entry is `{ request, response }` with a doc comment. Example: `"toolbox:counts": { request: z.strictObject({}), response: toolboxCountsSchema }` (line ~228). Add the schema import at the top of the file. `packages/ipc/src/index.ts` re-exports names: add new schema and type exports there too.
3. **Events (main to page, no request):** `packages/ipc/src/events.ts`, the `appEvents` object (`"find:changed"`, `"gemini:state"`, ...). `frameParts` lists the frame parts `frame:changed` may name. `appEventNames` in `packages/ipc/src/bridge.ts`. Main sends with `createEventSender` in `apps/desktop/src/main/events.ts`: it checks the payload against the schema and drops a bad one.
4. **Dispatch:** `packages/ipc/src/dispatch.ts`. `createDispatcher(handlers, onError)` checks the request with `parseRequest` (channels.ts), calls the handler, checks the response, and answers the page with `{ok:false, reason:"The call failed"}` on throw. `Handlers` is a mapped type over `Channel`: every channel in `channels` must have a handler, or typecheck fails.
5. **Handler map:** `apps/desktop/src/main/handlers.ts`, `createHandlers(context)`. Examples: `"find:views": () => ({ views: readViews(openSource()) })` (~line 176), `"toolbox:counts": async () => toolboxCounts(...)` (~line 201), `"find:ideas": ({ count }) => ideas.suggest(count)` (~line 178). `HandlerContext extends HandlerServices`.
6. **Services:** `apps/desktop/src/main/services.ts` declares one interface per service (`ImporterService`, `ConnectionsService`, `GeminiControl`, ...), each method answering one channel. A missing service is answered by `apps/desktop/src/main/stub-services.ts` ("not built yet", `{ok:false, reason:"not_built"}`). Build the real one in its own folder (for example `main/find/`), then pass it in `main/index.ts` (`createHandlers({...})` near line 504; ideas wiring at ~line 380).
7. **Bridge:** `apps/desktop/src/main/ipc-bridge.ts` calls `ipcMain.handle(bridgeChannel, ...)` with `createDispatcher`. Nothing per channel here.
8. **Preload:** `apps/desktop/src/preload/index.ts`. Generic: exposes `window.gratovo` with `invoke(channel, input)` and `on(event, listener)`. It checks event names only. Add nothing per channel.
9. **Renderer caller:** `apps/desktop/src/renderer/lib/toolbox.ts` `useToolboxCounts()` uses `window.gratovo.invoke("toolbox:counts", {}).then((result) => result.ok ? ... : ...)`. Find's: `apps/desktop/src/renderer/lib/find.ts`. Each call returns `InvokeResult`, check `result.ok`.

**Tests that enumerate or pin channels (update them when you add one):**
- `packages/ipc/src/channels.test.ts`: `parseRequest` accepts/refuses; `app:ping` response.
- `packages/ipc/src/events.test.ts`: "equals the keys of appEvents" (`appEventNames`).
- `packages/ipc/src/dispatch.test.ts` (~line 85-94) and `packages/ipc/src/data.test.ts` (~line 529-538): full fake handler maps typed as `Handlers`. A new channel must be added here or typecheck fails.
- `packages/ipc/src/toolbox.test.ts`, `find.test.ts`: per-channel schema tests (`parseRequest("find:views", {...})`).
- `apps/desktop/src/main/handlers.test.ts`: calls `mine["toolbox:counts"]({})` and checks it parses against `channels[...]`.
- `apps/desktop/src/renderer/lib/toolbox-test-bridge.ts` (~line 93): a `switch` on channel names for component tests.
- `apps/desktop/src/main/events.test.ts`: event sender.

## 3. Renderer actions, undo, persistence, and writes to main

- **Store:** `packages/core/src/store.ts` `createStore<D, U>` (immer-like `bg`, `ui`, `act`, `peekUndo`, undo/redo stacks). App store: `apps/desktop/src/renderer/lib/store.ts` (`appStore()`, `useApp(selector)`, `AppData`, `Job`, `Notification`, `go`, `selectRoute`).
- **`act` (undoable change):** `apps/desktop/src/renderer/lib/actions.ts` `act(label, recipe, {log?, logRef?, toast?})`. The recipe gets `(data, ui)`. Returning `false` means no change. Otherwise: an undo step is recorded, an activity-log line is unshifted into `data.log` (unless `log: false`), "Saving..." shows (`markSaving`), and a toast shows with Undo (only while that change is newest, else "newer changes came first"). Also `undo()`, `redo()`, `markAllRead()`, `readNotification(id)`, `setNotify`, `setMyName`.
- **Domain actions:** `apps/desktop/src/renderer/lib/find-actions.ts` (`shortlist`, `reject`, `bringBack`, `neverContact`, `confirmAddress`, `ensureCreators`). Pattern: a private `change(items, {from, action, set, line, detail, msg, sub})` builds one `act()` with `log: false` and one log line per creator. Copy that pattern for Reach.
- **Persister:** `apps/desktop/src/renderer/lib/persist.ts`. `diffData(before, after)` turns the store change into `DataWrite[]` (`diffLog`, `diffNotifications`, `diffRecords`). `unsupportedFields` (`me`, `team`, `counts`, `mateRun`, `conflicts`) are reported, not written. `installPersistence(invoke)` queues batches (max 100) and sends `data:write`; `onPersistenceIdle(ok => ...)` reports the save state; `adoptServerData` takes server data without making an undo step.
- **Non-undoable calls:** `creator.notes` goes straight through the page (not in the frame, not undoable), per the `DataWrite` comment.

**DataWrite:** `packages/core/src/data/types.ts` (~line 321), the union: `notification.read`, `notify.set`, `me.name`, `log.add`, `log.remove`, `creator.stage`, `creator.notes`, `creator.contact`, `brand.set`, `deal.step`, `conflict.resolve`. The IPC schema for it is `dataWriteSchema` in `packages/ipc/src/data.ts`. Adding a kind means: the type, the schema, `diffData` in `persist.ts`, the `apply` switch in `sqlite-source.ts`, and `main/data/data-source-contract.ts` tests.

**How main applies a write:** `apps/desktop/src/main/data/sqlite-source.ts` `apply(write)` is a `switch (write.kind)` inside one transaction (all or none), called from `DataSource.write(writes)`. Row writers live in `apps/desktop/src/main/data/repositories/` (`creators.ts` `writeCreatorStage`, `writeCreatorNotes`, `writeCreatorContact`; `brands.ts`; `deals.ts`; `notifications.ts` `upsertNotification`, `setNotificationRead`; `activity-log.ts` `addLogEntry`). `DataSource` interface: `packages/core/src/data/types.ts` (~line 400). Contract tests for any source: `apps/desktop/src/main/data/data-source-contract.ts`, used by `sqlite-source`, `example-source` and `live-source` tests.

**Outbox (queued sync edit):** the sync writer `apps/desktop/src/main/sync/intents.ts` `recordIntent(...)` (line ~102) runs in the same transaction as the local write. It calls `enqueue(db, {userId, kind, payload, target, now})` from `apps/desktop/src/main/data/repositories/outbox.ts`. `OutboxKind` in that file lists the kinds the sync engine knows (`profile.name`, `activity.add`, `notify.set`, `channel.edit`, `conflict.resolve`, `brand.set`, `deal.step`). A new synced kind needs an `OutboxKind`, an intent builder in `intents.ts`, and a case the sync engine (`apps/desktop/src/main/sync/engine.ts`) can push. Mail sends are not outbox items: they go to the pipeline (section 8).

## 4. The live gate: wired.ts and routes.ts

- `apps/desktop/src/renderer/lib/routes.ts`: `ScreenKey` (today, find, reach, close, deliver, insights, toolbox, team, settings, record); `screens` record with `{name, tabs, icon, hue}` built by `screen(key, icon, hue)`; `routeFromHash` / `routeToHash` (`#/find/triage`). Tab names come from `strings.screens[key]`.
- `apps/desktop/src/renderer/lib/wired.ts`: `liveWired` object lists the tabs shown in live mode. Today: `find: ["search","triage","gallery","contacts"]`, `toolbox: ["archive","never","log"]`, `record: []`, `settings: [...]`. **`reach` is absent, so Reach is hidden in live mode.** To show a Reach tab, add it here in the step that wires it.
- Functions: `isScreenShown(screen, source)`, `isTabShown(screen, tab, source)`, `shownTabs(screen, source)`, `isRouteShown(route, source)`, `firstShownTab`, `defaultRoute(...)`. Example source (`source === "example"`) shows everything. Live hides anything not in `liveWired`.
- The rail, palette, G-letter keys, URL and history all go through these. Components: `apps/desktop/src/renderer/app/rail.tsx`, `overlays/commands.ts`, `renderer/app/app.tsx`.
- Tests: `apps/desktop/src/renderer/lib/wired.test.ts`, `routes.test.ts`, `renderer/app/rail.test.tsx`, `e2e/live-gate.spec.ts`.
- **Toolbox tools:** `apps/desktop/src/renderer/toolbox/toolbox-list.tsx` `useShownTools()` filters `toolOrder` by `shownTabs("toolbox", source)`. `toolbox-screen.tsx` shows the open tool (route tab). Tool names and copy: `strings.toolbox.tools[key].long`. The left list is in `toolbox-list.tsx`; `toolbox.css` styles it.
- Example data: `apps/desktop/src/renderer/lib/example-data.ts` `exampleData(now)` builds the renderer's `AppData` for the example source.

## 5. Local DB migrations

- Folder: `apps/desktop/src/main/db/migrations/`. Files `0001-initial.ts`, `0002-member-access.ts`, `0003-sync.ts`. Index `index.ts`: `export const migrations: readonly Migration[] = [initial, memberAccess, sync];` (append at the end, numbered without gaps).
- Shape (`apps/desktop/src/main/db/migrate.ts`): `interface Migration { version: number; name: string; sql: string }`. Each file exports `const sql = \`...\`` and `export const sync: Migration = { version: 3, name: "sync", sql };`. Comments above the SQL say why.
- Example to copy: `apps/desktop/src/main/db/migrations/0003-sync.ts` (new tables `STRICT`, `ALTER TABLE ... ADD COLUMN`, indexes).
- The runner `migrate(db, list)` runs each migration in a transaction, sets `PRAGMA user_version`, refuses a newer DB (`DatabaseTooNewError`) and never downgrades.
- Test: `apps/desktop/src/main/db/migrate.test.ts` (in-memory `DatabaseSync`; a fake migration "one past the real ones"; checks "numbers the real migrations 1..n", "builds a fresh database at the latest version", "changes nothing when run again"). Add the new migration's table to its own repository test (see `main/data/repositories/*.test.ts`).
- Local DB is `node:sqlite` (`DatabaseSync`), opened by `apps/desktop/src/main/db/open-database.ts` (WAL; write transactions with `BEGIN IMMEDIATE` per the lessons in `docs/workflow.md`).
- Pipeline DB (creators, channels, mail rows) is `pipeline.db`, written by Python in `services/pipeline` (`store.py`). Mailbox DB: `mailbox.db`, one writer (quick lane).
- Supabase: any new table needs its own grants in the same migration (`supabase/README.md`), and nothing for `anon`.

## 6. Example data

- `packages/core/src/data/example.ts`: `exampleSeed(now)` (`ExampleSeed` type, `exampleSeedVersion = 2`) and `exampleFrame(now)`. Team: `me = "u1"` (display name unset), `u2` Sara, `u3` Omar, `u4` Lina (roles and money switch in `team`). Creators (~line 237): Prompt Lab `@promptlab`, Neural Notes `@neuralnotes`, Code with Kai `@codewithkai`, Tensor Talk `@tensortalk`, The AI Desk `@theaidesk`, Model Matters `@modelmatters`, Prompt Daily `@promptdaily`. Brands (~line 345): Codewell (AI code review), Lumen AI, VoxCraft, Pagewise, Clipforge. Deals (~line 353). `mateRun(now)` is a teammate's search. Notifications: `notifications(now)` (~line 175).
- `apps/desktop/src/main/data/example-source.ts`: seeds an example SQLite DB (`seedKey = "example_seed"`, `dataTables` cleared before re-seed) through the repositories (`upsertCreator`, `upsertBrand`, `upsertNotification`, ...).
- `apps/desktop/src/main/find/catalog-fixture.ts`: `writePipelineDb(path, data: FixtureData)` writes a `pipeline.db` with `FixtureChannel[]` (`id`, `handle`, `name`, `subscribers`, `uploads30`, `median`, `fetched`, `failures`), `videos`, `keywords`, `runs`, `archive`. Helpers: `channelId(tag)` (valid `UC...` id), `creatorState(id, over)`. Used by most `main/find/*.test.ts` and the contract test. Test names: "Alpha AI", "Bravo".
- `apps/desktop/src/renderer/lib/example-data.ts` for the renderer.
- Rule: example data is AI creators and AI sponsors only (no woodworking, travel, etc.).

## 7. Gemini bridge (main)

- `apps/desktop/src/main/pipeline/gemini-service.ts`: `createGeminiService(...)` returns `GeminiService`: `start(options)`, `call(method, params, {timeoutMs?})` resolves with `GeminiCall<M>` (a result or an error with a code, or `TIMEOUT`) and **never rejects**, `onEvent`, `onExit`, `shutdown()`. One bridge at a time on port 8765. `callTimeoutMs(method, params)` gives each method's own time. Methods: `apps/desktop/src/main/pipeline/gemini-protocol.ts` (`geminiMethods`: `status`, `action.generate_keywords`, `action.classify_channel`, `action.gem_*`, `action.skill_*`, `action.comms_propose`, `action.comms_check`, ...). Param and result schemas are `*Schema` in the same file (for example `"action.generate_keywords": z.strictObject({...})` ~line 353). Reach's likely calls: `action.comms_propose` and `action.comms_check` (check their schemas before use).
- `apps/desktop/src/main/gemini/gemini-control.ts`: `createGeminiControl(deps)` implements `GeminiControl` (`status()`, `start()`, `stop()`, `openWindow(browser)`). **Never sends a prompt.** The owner starts the bridge in Settings > Connections. Status: `GeminiStatus` (`state: stopped|starting|listening`, `addon.state`, `browser`, `problem`). Pushed as `gemini:state`.
- **Caller check:** `apps/desktop/src/main/find/ideas.ts` `createIdeas(deps)`. Wiring in `main/index.ts` (~line 380): `bridgeReady` = `status.state === "listening" && status.addon.state === "connected"`. In `live()`: not ready gives `{ok:false, problem:"bridge_off"}`; `now() - lastSend < sendGapMs (60_000)` gives `{ok:false, problem:"busy"}`; then `deps.generate({...})` with `chats: 1, newChat: true` (one prompt per fresh chat); a failed call logs only `error.code` and gives `problem:"failed"`. `asking` flag gives `busy` for overlapping calls.
- **Example data:** `suggest()` checks `deps.mode()` (`"example" | "live" | null`). Example mode never calls Gemini: `standIn()` waits `standInMs` (900 ms) and returns fixed AI keywords. `createStubIdeas()` always says `bridge_off` (for tests).
- Reach should copy this shape: `mode` check, `bridgeReady` check giving `bridge_off`, own gap timer (60 s between sends), `busy` for overlap, example stand-in, `GeminiService.call` result handling. Put the gap in the Reach service, not the renderer.
- Tests: `apps/desktop/src/main/find/ideas.test.ts` (fake `generate`, fake `wait` and `now`), `main/gemini/gemini-control.test.ts`, `main/pipeline/gemini-service.test.ts`.

## 8. Pipeline jobs from main (mail.status / mail.send)

- Protocol: `apps/desktop/src/main/pipeline/protocol.ts`. `mailStatusJob` (`{kind:"mail.status"}`, line ~116), `mailSendJob` (`message: {to, subject, body, mailbox?, conversationKey?, newThread?, channelId?, labels?}`, a key per send), `mailRepliesJob`, `mailAckJob`, `mailCancelJob`. Results: `mailStatusResult`, `mailSendResult` (`duplicate`, `account`, `conversationKey`, `messageId`, `threadId`, `rfcMessageId`) (~line 444-490). `jobSchema` (~line 251) is the union of all jobs. `startSchema` (~line 272) is the start message. `parseLine`, `startLine` for the JSON-lines.
- Python side: `services/pipeline/src/gratovo_pipeline/protocol.py` (`mail.send` line ~93, ~185) and `services/pipeline/src/gratovo_pipeline/mail/`, `comms/` (`engine.py`, `checks.py`, `coach.py`, `readiness.py`). Python tests: `services/pipeline/tests/test_comms_*.py`, plus fakes in `tests/fakes.py`. `protocol.schema.json` is generated by `pnpm pipeline:schema` (the vitest `protocol-schema.test.ts`).
- Lanes: `apps/desktop/src/main/pipeline/jobs.ts` `laneFor(kind)`. `mail.status`, `mail.send`, `mail.replies`, `mail.ack`, `mail.cancel` are the **quick lane**. `runJob(supervisor, start, {onMessage})` resolves `JobOutcome` = `{ok:true, exit, replies}` or `{ok:false, problem:"running"|"no_python"}`. Replies (`reply` lines) are collected.
- Supervisor: `apps/desktop/src/main/pipeline/supervisor.ts` `createPipelineSupervisor({...})`: one job at a time per lane; `PipelineExit` = `{kind:"ended", end, result}` or `{kind:"failed", reason}`. `end.state` is `"done"` on success. `result` is the job's `result` line (`result.kind === "mail.send"`, `result.data`).
- Index wiring: `apps/desktop/src/main/index.ts` ~line 407 (`runStoreJob`) and ~line 439 (`runQuickJob: (start) => runJob(quickLane, start)`).
- **How mail.status runs today:** `apps/desktop/src/main/settings/connections-mail.ts` `createMailboxes(deps, publish)` `check()`: checks source, python, client secret, mailboxes; `buildQuickStart(deps, source, {kind:"mail.status"}, {mail:true})` from `settings/connections-jobs.ts`; `deps.runQuickJob(start)`; then `if (exit.kind !== "ended" || exit.end.state !== "done" || exit.result?.kind !== "mail.status") return failed`. Per-mailbox health map. Reach's `mail.send` should do the same: `buildQuickStart(..., {mail: true})`, `runQuickJob`, check `exit.result?.kind === "mail.send"`, and never retry after a request may have reached the server (send is not idempotent, though `key` makes a repeat report `duplicate`).
- Secrets: `apps/desktop/src/main/pipeline/pipeline-secrets.ts`: `pipelineSecretNames` (names only), `readMailSecrets(store)` (client and mailboxes, only the mailboxes listed in settings), `readAwsKeys`, `readGateways`. Values never cross the IPC bridge or get logged (`secret-store.ts`, `secrets.ts`).
- `buildQuickStart` returns null when no live data is open (`jobContext()`), so the caller must handle null (`no_data`).
- Tests: `apps/desktop/src/main/settings/connections-mail.test.ts` (fake `runQuickJob`), `main/pipeline/jobs.test.ts`, `supervisor.test.ts`, `protocol.test.ts`, `pipeline-secrets.test.ts`.

## 9. Notifications and trays

- Repo: `apps/desktop/src/main/data/repositories/notifications.ts`: `upsertNotification(db, n: FrameNotification, {money?})` (adds or replaces by id; `money` column derives from text unless given) and `setNotificationRead(db, id, read)`. Listing: `listNotifications` in the same file.
- Raising one from main: example `apps/desktop/src/main/sync/conflict-notices.ts` (~line 87). Id with a fixed prefix (a conflict notice), `icon: "alert"`, `go: {screen, tab}`, `read` kept when refreshed, `{money: false}`. Then return the part `notify` so the page re-reads. Sync engine: `apps/desktop/src/main/sync/engine.ts` (~line 168-177) adds `"notify"` to the changed parts when notices changed.
- To tell the page: main's `events.ts` sender with `frame:changed` `{parts: ["notify", ...]}` (parts in `packages/ipc/src/events.ts`). Renderer reads again through `frame:load`.
- Icons: `notificationIcons` in `packages/core/src/data/types.ts` (`reply`, `wallet`, `unlock`, `forward`, `alert`, `pause`, `scan`, `check`). Kinds (`notifyKind(icon)`): `reply`, `money`, `handoff`, `search`, or `problem` for `alert`. Team switches: `notify.set` DataWrite.
- Renderer tray: `apps/desktop/src/renderer/overlays/trays.tsx`: `JobsTray` (background jobs), `NotificationsTray` (list with `readNotification`, `markAllRead`), `Trays()` (the component). `Job` type in `renderer/lib/store.ts` (`kind: "search" | "contacts"`, `label`, `progress`, `total`, `done`, `note?`, `failed?`). Open with `toggleTray("jobs" | "notifications")` in `actions.ts`. A new background kind (for example `"mail"`) means extending `Job["kind"]` and `JobRow` in `trays.tsx`. Job state is pushed through the store (see `main/find/find-service.ts` for search progress).
- Toasts: `apps/desktop/src/renderer/overlays/toasts.tsx`, `renderer/lib/toast.ts` `toast({msg, sub, icon, tone, actions})`; `act()` uses it for Undo.

## 10. Strings, CSS, UI kit

- Renderer strings: `apps/desktop/src/renderer/strings.ts`, one `export const strings = {...}` object with sections: `screens` (~line 1322), `actions` (~1378, Undo/View/newer-changes), `toolbox` (~1412), `findActions`, `findSearch`, `findTriage`, `trays`, `toasts`, `conflicts`, `rail`, `top`, `keys`, `palette`, `record`, `time`. Add a `reach` block here. Use `strings.x.y` in TSX, never a literal. Function values for sentences with parts, for example `conflict.text(label, theirName)`.
- Main strings: `apps/desktop/src/main/strings.ts` (`mailConsent`, `startupFailed`, `conflict`). Only text the main process shows (pages, tray text sent from main).
- CSS: `apps/desktop/src/renderer/**/*.css`: per-screen files `find/find.css`, `toolbox/toolbox.css`, `record/record.css`, `settings/settings.css`, and app-wide `app/frame.css`, `app/save-state.css`, `app/auth.css`, `overlays/overlays.css`. Tokens: `packages/ui/src/tokens.css` (dark values; light tokens also there, not checked). Screen colour via `screens[k].hue` (`var(--find)`, `var(--reach)`, `var(--close)`, `var(--deliver)`). Components use tokens only, no colour literals. Motion: `packages/ui/src/motion.css`. Tests: `renderer/overlays/overlays-css.test.ts`, `renderer/app/frame-css.test.ts`, `packages/ui/src/tokens.test.ts`, `packages/ui/src/styles.test.ts`.
- UI kit: `packages/ui/src/index.ts` exports `Btn`, `IconBtn`, `Icon` (`IconName` from `icons.ts`, add an icon there), `Kbd`, `Seg`, `Switch`, `Tag`, `Avatar` / `avatarColor` (`avatar.ts`), `PageHead` (`page-head.tsx`), `Empty` (`empty.tsx`), `cx` (`cx.ts`). Styles: `base.css`, `controls.css`, `fonts.css`.
- Data-ui ids: `screen.part.thing` (for example `reach.draft.send`) on elements that the comment tool will pin.

## 11. Test conventions

- **Vitest config:** root `vitest.config.ts` (includes `packages/*/src`, `apps/*/src`, `supabase/functions`; `testTimeout` 10 s). Server tests: `vitest.server.config.ts` (`pnpm test:server`).
- **Component test (happy-dom):** first line `// @vitest-environment happy-dom`. Example `apps/desktop/src/renderer/find/triage.test.tsx`: RTL `render`/`screen`/`fireEvent`, `resetAppStoreForTests()`, `selectRoute(...)`, `stubFindBridge` from `renderer/lib/find-test-bridge.ts` (fake `Bridge` for `window.gratovo`), `setPref`. Another: `apps/desktop/src/renderer/toolbox/toolbox-screen.test.tsx` (counts calls through `bridge.calls`).
- **Pure lib test:** `apps/desktop/src/renderer/lib/actions.test.ts`, `persist.test.ts`, `wired.test.ts` (no DOM).
- **Main-process service test:** `apps/desktop/src/main/find/archive-service.test.ts`: `createArchiveService(deps)` with fake lanes (`FakeLane`), `vi.fn`, `Date.UTC` fixed clock, `channelId` from fixtures, `afterEach` cleanup. Also `main/find/ideas.test.ts` (injected `generate`, `wait`, `now`). DB tests use `openDatabase(tmpfile)` on a temp dir (`mkdtempSync`, `tmpdir()`, see `handlers.test.ts`).
- **Source contract:** `apps/desktop/src/main/data/data-source-contract.ts` runs one suite against each `DataSource` (sqlite, example, live) with `MakeSource`.
- **IPC tests:** `packages/ipc/src/*.test.ts` (schema accept and refuse cases).
- **Electron smoke / e2e:** `apps/desktop/e2e/*.spec.ts` with `apps/desktop/e2e/fixtures.ts` exporting `test` (`base.extend`) with `page`, `errors`, and `appPage = "app://gratovo/index.html"`. The fixture launches the built app with `GRATOVO_USER_DATA` (fresh folder each test), `GRATOVO_SUPABASE_URL`, and example data. `fake-supabase.ts` is the fake server. Example spec: `apps/desktop/e2e/find-triage.spec.ts` (role-and-name locators with `strings`, `expect(...).toBeVisible()`, `test.setTimeout`). Smoke: `e2e/smoke.spec.ts`. Live gate: `e2e/live-gate.spec.ts`. Accessibility: `e2e/accessibility.spec.ts` (axe, `setLegacyMode(true)`). Config: `apps/desktop/playwright.config.ts` (workers 1, timeout 30 s).
- Lessons (from `docs/workflow.md`): use `getByRole` with anchored names (`^...$`); happy-dom doesn't check focus; `waitForURL` hangs in Electron (poll with `toHaveURL`); tests built from "today" use a fixed clock.

## Key files to touch for Reach (likely)

- `packages/ipc/src/channels.ts`, `reach.ts` (new), `events.ts`, `index.ts`, `data.ts` (DataWrite schema if any kind is added)
- `packages/core/src/data/types.ts` (DataWrite, Creator fields), `packages/core/src/reach/` (new, pure logic, if needed)
- `apps/desktop/src/main/handlers.ts`, `services.ts`, `stub-services.ts`, `index.ts`, `handlers.test.ts`, `ipc/src/dispatch.test.ts`, `ipc/src/data.test.ts`
- `apps/desktop/src/main/find/ideas.ts` (pattern for Gemini calls), `main/pipeline/protocol.ts` (`mail.*`), `main/settings/connections-mail.ts` (pattern for quick jobs)
- `apps/desktop/src/main/db/migrations/0004-*.ts` (new, appended to `index.ts`)
- `apps/desktop/src/renderer/lib/wired.ts` (add `reach` tabs to `liveWired` in the step that wires them), `routes.ts` (`reach` tabs), `actions.ts`, `store.ts`, `persist.ts`
- `apps/desktop/src/renderer/reach/` (new screen; copy `find/` layout), `reach.css`, `renderer/strings.ts` (`reach` block)
- `apps/desktop/e2e/reach-*.spec.ts` (one light smoke per sub-step; full pass at the end of step 6)

## Open facts to check before building

- No `mail.send` caller exists in main yet (only `mail.status` in `connections-mail.ts`). Verify `buildQuickStart` supports `{mail: true}` for `mail.send`, and its secret needs.
- `OutboxKind` has no reach kinds; mail sends are pipeline jobs, not outbox items (check the plan before adding one).
- `apps/desktop/src/renderer/lib/wired.ts` has no `reach` entry: Reach is hidden in live mode until added.
- The Gemini bridge's `action.comms_propose`/`action.comms_check` schemas were not read in full; read `gemini-protocol.ts` before use.
