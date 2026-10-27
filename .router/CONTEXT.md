# Context: prototype mode and the comment tool (plan step 7, item 2)

Facts only, mapped 2026-10-27 at main (4c45a80). Paths are repo-relative. Not every line was read; items marked "check" need a look first.
Spec: `docs/decisions/0004-prototype-mode.md`. Owner rules: `CLAUDE.md`.
Stack: Electron 44, React 19, TypeScript, Vitest 5, Playwright (Electron), happy-dom. Windows only.

## 1. Commands

- Lint: `pnpm lint` (eslint, prettier --check, ruff). One file: `pnpm exec eslint <file>`.
- Typecheck: `pnpm typecheck` (`tsc -b` plus pyright).
- Unit tests: `pnpm test` (Vitest, gemini-extension, pytest).
- One Vitest file: `pnpm exec vitest run <path>.test.ts` (root `vitest.config.ts`; includes `apps/*/src` and `packages/*/src`).
- Electron e2e: `pnpm test:e2e` (`pnpm --filter @gratovo/desktop test:e2e`: install-electron, electron-vite build, playwright). Config `apps/desktop/playwright.config.ts`, `testDir: ./e2e`, `workers: 1`, 30 s timeout.
- One Electron spec (inferred from the config, not run): `pnpm --filter @gratovo/desktop exec playwright test e2e/live-gate.spec.ts`. Windows only, needs a build.
- Gate: `pnpm verify`. A sub-step PR needs lint, typecheck, unit tests, and at most one light Electron smoke test. The full e2e suite runs once per major step.

## 2. How the data source is chosen

Main process (`apps/desktop/src/main/`):

- `account/account.ts`, `createAccount(deps)`. Constants `exampleFile = "example.db"` (line 119) and `liveFile = "gratovo.db"` (line 120), both in `userData`.
  - States: `unconfigured` (no Supabase settings), `waiting`, `signed-in`, signed out.
  - `start()` (around line 830): when `config === null` it sets `example = openExampleSource(join(userData, exampleFile), now)`. Otherwise it reads the stored session.
  - `source()` (around lines 820-830): unconfigured returns `example`. Signed-in returns `live?.source`. Otherwise null.
  - So today example and live are exclusive. A signed-in user cannot open example data. `example = null` is set near line 1018.
  - `findContext()` returns `{mode: "example"|"live", workerId}`. Find and Reach read it.
- `data/index.ts` exports `openExampleSource`, `openLiveSource`, `createSqliteSource`.
- `data/example-source.ts`: `openExampleSource(path, now)`. Seeds from `exampleSeed(now)` in `packages/core/src/data/example.ts` (`exampleSeedVersion = 7`, line 34). A seed clears `dataTables` and refills. Meta key `example_seed` decides when to reseed.
- `data/live-source.ts`: `openLiveSource(path, me, now)`.
- `data/sqlite-source.ts`: `createSqliteSource`, the shared SQLite code.
- `data/data-source-contract.ts`: contract. The `DataSource` type is in `packages/core/src/data/types.ts` (`readSetting`/`writeSetting` at lines 476-478).
- `settings/source-switch.ts`: `createSourceWatch(source, onSwitch)` and `withSourceChecks(account, check)`. They wrap `signIn`, `recheck`, `signOut`. `onSwitch` fires when the open source object changes.
- `index.ts`:
  - `reloadWindows()` line 117. The `reloadWindow` callback (line 178) calls it, then `sourceWatch.check()`.
  - `sourceWatch` line 199; `withSourceChecks` line 205; `sourceWatch.prime()` line 599.
  - A switch calls `geminiControl.sourceChanged()` (line 290) and restarts Reach if a source is open (lines 283-287).
  - Pipeline folder is `example-pipeline` or `pipeline` under `userData` (line 252).
- `services.ts`: the service interfaces (`ImporterService`, `ConnectionsService`, `GeminiControl`, `WritingRulesService`, ...).
- `stub-services.ts`: `createStubServices()` answers "not built yet". Touches nothing. Connections default is `emptyConnectionsStatus()`.
- `handlers.ts`: `openSource()` (line 86) throws when no source is open. `"frame:load"` (line 120) returns `reach.overlay(await openSource().frame())`.

Renderer:

- `renderer/lib/store.ts`: `data.source` defaults to `"example"` (line 205). Store helpers at lines 390-430 use `isScreenShown` and `isTabShown`.
- `renderer/app/start.tsx` line 39 invokes `frame:load` at start. `renderer/lib/live.ts` line 323 does it again on a live update.
- `renderer/lib/frame.ts`: `routeOf(go, source = "example")`.
- `renderer/lib/example-data.ts`: a renderer-side `exampleData(now)` used by the store and tests.
- Today a "switch" is only the account state changing (sign in, sign out, recheck). `reloadWindow` then reloads every window. There is no toggle yet. Prototype mode must add one.

Outbound adapters in example mode:

- Reach send, `main/reach/sender.ts`: line 491 `if (mode === "example")` calls `recordSent(...)` locally. The live path calls `deps.send(message)` (line 515). So example does not call `mail.send`.
- Reach drafting, `main/reach/drafter.ts`: line 43 says the example data never calls Gemini. A stand-in fills the draft after 0.9 s (line 101). Branches at lines 433, 599, 862.
- Reach checks, sender.ts line 447: `mode === "live" ? deps.check(...) : {ok: false}`.
- Find, `main/find/find-service.ts`: `folderFor(mode)` uses `example-pipeline` (line 170). The YouTube key lookup runs only for `mode === "live"` (line 430). Refetch is live only (`email-finder.ts` line 16). Check whether a Python job starts in example mode before relying on it.
- Gemini bridge: no example branch found by grep in `main/gemini/`. Check.
- Archive sweep runs on both sources (`archive-service.ts` line 15).

## 3. The live gate

- `renderer/lib/wired.ts`:
  - `liveWired` (lines 19-30): find `[search, triage, gallery, contacts]`; reach `[board, sequences, inbox, mailboxes]`; toolbox `[archive, never, scheduled, log]`; record `[]`; settings `[profile, appearance, keyboard, notifications, search, writing, connections]`.
  - `isScreenShown(screen, source)` line 42: true on example, else the screen is in `liveWired`.
  - `isTabShown` line 47, `isSettingsSectionShown` line 63, `isRouteShown` line 68, `shownTabs` line 58, `firstShownTab`.
  - `defaultRoute(source, importState)` line 80: example gives Today; live gives Connections on first run, else Find > Search.
  - `startRoute(hash, source, importState)`.
- Callers of the gate:
  - `app/global-keys.ts` line 82 (G-letter keys).
  - `app/rail.tsx` lines 104, 187, 217 (rail screens, settings rows).
  - `lib/settings.ts` lines 7 and 128 (`sectionsFor`).
  - `lib/store.ts` lines 33, 392-402, 429.
  - `overlays/commands.ts` lines 7, 94 (palette).
  - `settings/sections.tsx` line 95 (`isScreenShown("team", source)`).
- `renderer/lib/routes.ts`: `ScreenKey` (line 6), `screens` with tabs (line 62), `screenOrder` (76), `goLetters` (89), `routeFromHash` (134).
- `renderer/app/placeholder-screen.tsx`: used by `app/app.tsx`, `find/find-screen.tsx`, `reach/reach-screen.tsx`. Today, Close, Deliver, Insights and Team are not in `liveWired`, so live hides them. Check `app/app.tsx` for how Today and Close render on example.
- No prototype flag exists in the gate. Prototype mode must open it only when on.

## 4. Settings

- Sections: `renderer/lib/settings.ts` lines 27-44, `SECTIONS` with `{key, group, icon, owner, arrives}`. Owner-only: `facts`, `team`, `connections`.
- Owner check: `meIsOwner(data)` line 119: `data.team.find(m => m.id === data.me)?.owner`.
- `sectionsFor(owner, source)` line 124 filters `(owner || !s.owner) && isSettingsSectionShown`.
- `rowsFor(owner, source)` line 133. `settings/settings-screen.tsx` line 83 and `settings/sections.tsx` line 34 read `data.source`.
- Section files: `renderer/settings/` (`sections.tsx`, `settings-screen.tsx`, `connections-section.tsx`, `writing-rules-section.tsx`, `search-rules-section.tsx`, `row.tsx`, `results.tsx`, `connections/`). `connections/use-connections.ts` line 30 returns early unless the source is live.
- Two kinds of persistence:
  - Renderer prefs: `renderer/lib/prefs.ts`. `prefsKey = "gratovo.prefs"` in localStorage. `setPref`, `usePref`, `readPrefs`. The theme is fixed to `"dark"`.
  - Data settings: `local_settings` (key, value) in migration 0001. `main/data/repositories/settings.ts`: `getSetting(db, key)`, `setSetting(db, key, value)`. Renderer side: `readSetting`/`writeSetting` on the source.
- Roles: `main/account/account.ts` `toAppRole` (around line 198) reads `profiles.role`. Fake Supabase users take `role` and `roles` (`supabase.addUser({role, roles: ["owner"]})`).
- IPC pattern to copy, `connections:status`:
  1. `packages/ipc/src/channels.ts` line 289: `"connections:status": {response: connectionsStatusSchema}`. Schemas in `packages/ipc/src/connections.ts`.
  2. `main/services.ts` `ConnectionsService.status()`. Stub in `main/stub-services.ts`.
  3. `main/handlers.ts` line 220: `"connections:status": () => connections.status()`.
  4. Preload `apps/desktop/src/preload/index.ts` line 16: `invoke(channel, input)` through `ipcRenderer.invoke(bridgeChannel, ...)`.
  5. `main/ipc-bridge.ts` lines 12-18: `registerBridge(handlers)` runs `createDispatcher`, which logs failures and tells the page only that the call failed.
  6. Renderer: `bridge.invoke("...")` (`renderer/lib/live.ts` line 323).
  - Also `packages/ipc/src/dispatch.ts` and `channels.test.ts`. Check whether a separate allowlist exists.

## 5. Local DB migrations

- `main/db/migrations/index.ts`: `migrations = [initial, memberAccess, sync, outreach]`. "Add new ones at the end." A new file is `0005-<name>.ts`, exporting a `Migration`, imported and appended.
- Pattern: `0004-outreach.ts` (header comment, then `const sql = \`CREATE TABLE ... STRICT;\``). Runner `main/db/migrate.ts`, test `main/db/migrate.test.ts`.
- Local SQLite tables need no grants. Supabase tables do: rule in `supabase/README.md#every-new-table-needs-its-own-grants-supabase-from-2026-10-30`.
- Repository to copy: `main/data/repositories/outreach.ts` (with `outreach.test.ts`). For a key-value setting use `main/data/repositories/settings.ts`.
- No comment table exists. Comments are to be exported to a file in the repo (ADR 0004).

## 6. Keys, bars, toasts, strings, data-ui

- `renderer/app/global-keys.ts`: `useGlobalKeys()` line 19. The typing barrier is `isTyping(event.target)` at lines 31 and 42.
- `renderer/lib/keys.ts`: `keyStack` line 6 (`createKeyStack`), `useKeys` line 13, `isTyping` line 31, `quietAnimations` line 52. Test: `keys.test.ts`.
- `renderer/app/top-bar.tsx`: `TopBar` line 283. Buttons with `onClick` at lines 65, 73 (back, forward), 92, 117, 267, 292. `menuButtonId` line 15. The comment button goes here, gated.
- `renderer/app/problems-bar.tsx`, strings `strings.problems` (line 1332).
- Toasts: `renderer/lib/toast.ts`, used by `lib/actions.ts`, `lib/store.ts`, `lib/persist.ts`, `app/app.tsx`. Clear them on every source switch (ADR). `strings.toasts.dismiss` line 927.
- `renderer/strings.ts`: one `export const strings = {...}` (line 5). Sections include `unread` (8), `auth` (22), `team` (70), `rail` (82), `top` (98), `keys` (124), `palette` (140), `shortcuts` (170), `menu` (219), `trays` (228), `settings` (246), `peek` (919), `toasts` (927), `conflicts` (929), `placeholder` (1328), `problems` (1332), `screens` (1336), `actions` (1399), `toolbox` (1433), `record` (1675), `reach` (1705), `time` (2307). Add a `prototype` block here.
- `data-ui`: 39 occurrences in 21 non-test files, all under `renderer/reach/` in the first hits (`board-card.tsx`, `board.tsx`, `cap-summary.tsx`, `gemini-banner.tsx`, `mailboxes.tsx`). Only the first five were listed; grep `apps/desktop/src/renderer` for the rest.
- Overlays: `renderer/overlays/` (`floating.tsx`, `commands.ts`, `overlays.css`). A pin or panel fits there.

## 7. E2E: example vs live

- `apps/desktop/e2e/fixtures.ts`:
  - `launchApp(userData, errors?, options)`. Env: `GRATOVO_USER_DATA`, `GRATOVO_SUPABASE_URL` (empty means unconfigured, so example), `GRATOVO_SUPABASE_PUBLISHABLE_KEY`.
  - Default tests run on example. A `supabase` option starts a fake one (`e2e/fake-supabase.ts`, `startFakeSupabase()`, `addUser`).
  - Fixtures: `app`, `page`, `relaunch`, `signedErrors`, `supabase`, `startSigned` (line 174-192).
- `e2e/live-gate.spec.ts`: signs in as owner `maya@example.com` (role `full`, roles `["owner"]`) through `strings.auth.signIn`. Checks the rail and the Connections landing.
- Other specs: `settings.spec.ts`, `access.spec.ts`, `frame.spec.ts`, `data.spec.ts`, `sync.spec.ts`, `reach-*.spec.ts`, `find-*.spec.ts`, `accessibility.spec.ts`, `security.spec.ts`.
- Rule: Electron tests run on the owner's PC only. Run them before the PR. The first run has found a real bug every time (`docs/workflow.md`).

## 8. Existing "prototype" or "proto" names

- No prototype-mode code exists. No `prototype` key in prefs, `local_settings`, IPC channels, or `packages/ipc`.
- Matches are design-prototype references: `packages/ui/src/testing/prototype-styles.ts`, `packages/ui/src/tokens.css`, `packages/core/src/data/example.ts`, `renderer/lib/settings.ts` line 27 ("The prototype's owner flag"), and comments in `renderer/lib/store.ts`, `renderer/reach/*`, `renderer/find/*`, `renderer/record/*`.
- `design/workbench-prototype/` is the static HTML prototype with its own README. It is not part of the app build.

## Open points to check before building

- Whether Find or the Gemini bridge start a Python process in example mode (`main/find/find-service.ts`, `main/gemini/`).
- How `app/app.tsx` renders Today and the placeholders for hidden screens.
- Owner check: `me.owner` in `data.team` versus the account role, and the `waiting` state.
- The example source cannot open while signed in (`account.ts` `source()`). Prototype mode needs a new open path or a second example copy.
