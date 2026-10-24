# Context: step 4, live data import and operational connections (app side)

Recon written 2026-10-24 on `docs/plan-pipeline-first`. Paths are under `apps/desktop/src/` unless shown. Plan: `docs/migration-plan.md` §6 "Step 4". The legacy side is covered elsewhere.

## 1. Commands

| Task | Command (source) |
|---|---|
| Lint | `pnpm lint` = `eslint . && prettier --check . && uv run --directory services/pipeline ruff check . && ruff format --check .` (root package.json) |
| Typecheck | `pnpm typecheck` = `tsc -b && uv run --directory services/pipeline pyright` |
| Unit tests | `pnpm test` = `vitest run && uv run --directory services/pipeline pytest` |
| One Vitest file | `pnpm exec vitest run apps/desktop/src/main/handlers.test.ts` (from root) |
| E2E, all | `pnpm test:e2e` = `pnpm --filter @gratovo/desktop test:e2e` = `install-electron && electron-vite build && playwright test` (apps/desktop/package.json) |
| E2E, one spec | `cd apps/desktop && pnpm build && pnpm exec playwright test e2e/smoke.spec.ts` (`pnpm test:e2e -- file` does not filter; docs/workflow.md l.51) |
| Server / SQL tests | `pnpm test:server` (needs local Supabase) / `pnpm test:sql` (Docker); not in `pnpm test` |

**CI** (`.github/workflows/ci.yml`): `checks` (windows-2025: `pnpm install --frozen-lockfile`, lint, typecheck, `pnpm test`, `pnpm test:e2e`); `sql` (ubuntu, `node supabase/tests/run.ts`); `server` (ubuntu, `supabase start`, `pnpm test:server`); `secrets` (gitleaks), `audit` (osv-scanner on both lockfiles), `codeql`.

## 2. Rail, screens, navigation

**Screen ids:** `ScreenKey` in `renderer/lib/routes.ts` l.6-16: `today find reach close deliver insights toolbox team settings record`. `record` is not in the rail.

| Where a screen is reached | File:line |
|---|---|
| Screen info (name, icon, hue, tabs) | `lib/routes.ts` l.62-73 `screens` (words in `strings.ts` `screens`, ~l.526-575) |
| Rail order (palette "Go to" uses it) | `lib/routes.ts` l.76-86 `screenOrder` |
| G-prefix letters: t f r c d i x m s | `lib/routes.ts` l.89-99 `goLetters`; `app/global-keys.ts` l.62-83 |
| Rail buttons (hard-coded per screen) | `app/rail.tsx` l.123-137 |
| Rail account menu (Settings, Connections for owner) | `app/rail.tsx` l.146-221 |
| Palette rows | `overlays/commands.ts` `actionCommands` l.39 (find triage/contacts), `goCommands` l.79, `settingCommands` l.96; `buildCommands` l.176 |
| Ctrl+, | `app/global-keys.ts` l.52-55 |
| Notification `go` | `lib/frame.ts` l.14-23 `routeOf` (unknown goes to Today) |
| Trays | `overlays/trays.tsx` l.101 (`go("find","search")`) |
| Settings links | `settings/sections.tsx` l.98 (`go("team")`), `settings-screen.tsx` l.139, `results.tsx` l.70 |
| Record page | `lib/actions.ts` l.205-210 `openRecord`; `openSetting` l.353-358 |
| Core navigator (every `go`) | `lib/store.ts` l.367-395 `go(screen, tab?, options?)` |
| Back / forward | `lib/store.ts` l.410-417 (can return to a hidden screen) |
| URL hash | `lib/routes.ts` l.134-141 `routeFromHash`; `lib/store.ts` l.234, l.438; `app/start.tsx` l.43 |
| Crumbs | `app/top-bar.tsx` l.18-40 |
| Content switch | `app/app.tsx` l.49-74 `Content` |
**How the current screen is chosen:** `store.ts` history (`ui.history`, `currentRoute`), first set from `routeFromHash(location.hash)` in `start.tsx` l.43. **Default: Today** (empty hash, unknown screen, or `#/record/...`; `routes.ts` l.134-141; `frame.ts` l.11 `todayRoute`).
**Tabs** (`strings.ts`): find: search, triage, gallery, contacts (only `search` built; `find/find-screen.tsx` l.59-63); reach: board, sequences, inbox, mailboxes; close: roster, brands, match, pitch, negotiate, contracts; deliver: board, money; settings: 10 sections. Today, insights, toolbox, team have no tabs.
**Built vs placeholder:** Find (Search tab) and Settings are built; Record page is built; Today, Reach, Close, Deliver, Insights, Toolbox, Team show `app/placeholder-screen.tsx`.
**Single-letter keys:** only the G-prefix letters (plus `/`, `?`, `[`). The "letters" pref turns them off (`global-keys.ts` l.76-77). Ctrl and Alt keys are unaffected.
**Live-mode gate (item 4):** one helper, e.g. `isScreenWired(screen, mode)` in `lib/routes.ts`, used by `go()`, `routeFromHash`, `frame.ts routeOf`, `goCommands`, `actionCommands`, and the rail `nav()` calls. Mode comes from §3.

## 3. Data source: example or live

- **Main** (`account/account.ts`): `status()` returns `{state, email}` (`packages/ipc/src/auth.ts` l.8-27): `unconfigured | signed-out | waiting | signed-in`.
  - `unconfigured` (no Supabase config) opens `userData/example.db` (`exampleFile` l.119, `openExampleSource` in `data/example-source.ts` l.41).
  - `signed-in` opens `userData/gratovo.db` (`liveFile` l.120, `openLiveSource` in `data/live-source.ts` l.16).
  - `source()` (l.74) is null when signed out or waiting. `findContext()` (l.1013-1023) gives `{mode:"example"}` or `{mode:"live", workerId}`.
  - `data/index.ts` re-exports the openers.
- **Renderer:** `frameSchema` (`packages/ipc/src/data.ts` l.133-147) has **no `source` or `mode` field**. `app/start.tsx` reads `auth:status`; `lib/account.ts` l.7-10 keeps only `{signedIn, email}`, so `unconfigured` and `signed-out` look the same. **Recommend** adding `source: "example" | "live"` to the frame or to `AuthStatus`.
- **Tests on example data, no Supabase:** `e2e/fixtures.ts` l.64-68 sets `GRATOVO_SUPABASE_URL` empty. `supabase/config.ts` honours the env seam only when unpackaged. `docs/setup.md` l.37-38: no `.env.local` means example data, no sign-in; a secret key also falls back to example.

## 4. Settings

**Shell:** `renderer/settings/settings-screen.tsx`. `SettingsScreen` (l.71): two groups (you, agency), search (Ctrl+F, l.83-91), a section pane. `SectionView` (l.23-36) picks a working section or `ShellSection`. The route tab is the section key; an owner-only section opened by a non-owner falls back to Profile (l.76).

**Sections** (`lib/settings.ts` l.9-44; `arrives` = the step that brings the rows):

| Section | Group | Owner | Now | Arrives |
|---|---|---|---|---|
| profile | you | no | Works: name, role, account row with sign-out | - |
| appearance | you | no | Works: density, text size, motion, sidebar | - |
| day (Your day) | you | no | Shell | 4 |
| keyboard | you | no | Works: single-letter switch, shortcut list | - |
| notifications | you | no | Works: 4 switches (money hidden without "sees money") + Problems (always on) | - |
| search (Search rules) | agency | no | Shell (rules read-only on Find › Search, `find/rules.tsx`) | 5 |
| facts (Agency facts) | agency | yes | Shell | 7 |
| writing (Writing rules) | agency | no | Shell | 6 |
| team (Team and money) | agency | yes | Shell | 9 |
| connections (Connections) | agency | yes | Shell (no Gemini status, mailboxes, course folder, YouTube key, proxies, gateways) | 9 |

Shell text: `ShellSection` (`settings/sections.tsx` l.295-303) and `strings.settings.shell` (`strings.ts` l.384-389) say "Arrives with step N". Step 4 replaces the `day`, `search`, `writing` and `connections` shells it covers.

**Rows** (`lib/settings.ts` l.47-65): `name role density size motion rail letters notify`. `settings/row.tsx` `Row` (l.25-47) renders `#set-<id>` and a "Saved" flag from `ui.settingFlash` (`flashSetting`, `lib/actions.ts` l.309-322).
**Persistence:**

| Row | Stored in | Path |
|---|---|---|
| density, size, motion, rail, letters | localStorage `gratovo.prefs` (JSON, field by field) | `lib/prefs.ts` l.16-71 `readPrefs`, l.110 `setPref`, l.136 `usePref` |
| name | SQLite `profiles` via `data:write {kind:"me.name"}` (synced) | `lib/actions.ts` l.326 `setMyName`; `data/sqlite-source.ts` l.126 |
| notify (4 kinds) | SQLite `local_settings` key `notify` via `notify.set` (undoable) | `lib/actions.ts` l.339 `setNotify`; `data/repositories/settings.ts` |

No IPC channel writes settings other than `data:write`. Step 4 needs new channels (§5, §11).

**Strings:** `renderer/strings.ts` (one module; settings words from ~l.231).

## 5. Persistence and secrets

**Data folder:** `app.getPath("userData")`, i.e. `%APPDATA%\Gratovo Toolbox` (productName). Unpackaged runs add ` (dev)`. `GRATOVO_USER_DATA` overrides it (dev and tests only; `main/index.ts` l.34-42).

| File (under userData) | Owner |
|---|---|
| `gratovo.db` (live copy, one account) | `account/account.ts` l.120, l.218 |
| `example.db` | `account.ts` l.119, l.823 |
| `secrets.json` (encrypted) | `main/secrets.ts` l.17 |
| `example-pipeline/` or `pipeline/`: `find.json`, `pipeline.db` | `find/find-service.ts` l.115-122; `find/find-store.ts` l.13; Python `jobs/search.py` l.34 |
| `<dataDir>/mailbox.db` (no main caller yet) | Python `jobs/mail.py` l.53 |
| `logs/` | `index.ts` l.123-157 |
| `gemini-profile/` (planned, nothing passes it) | `pipeline/gemini-service.ts` l.33 |
**Local SQLite:** `main/db/open-database.ts` l.8-31 (WAL, `synchronous=NORMAL`, `foreign_keys=ON`, busy timeout 5 s); `main/db/migrate.ts`; `main/db/migrations/index.ts` (forward-only, no gaps; add `0004-…` at the end).

| Migration | Tables |
|---|---|
| `0001-initial.ts` | `profiles`, `channel_state` (creator stage and contacts, joined to `channels`), `brands`, `deals`, `activity_log`, `channels` (channel_id, name), `notifications`, `local_settings` (key, JSON value), `_meta` |
| `0002-member-access.ts` | `member_access` |
| `0003-sync.ts` | `_outbox`, `_outbox_dropped`, `edit_conflicts` |

Repositories: `main/data/repositories/*.ts`, re-exported from `index.ts`.
**Secrets module:**
- `main/secret-store.ts`: `createSecretStore(file, cipher)` (l.71). `SecretStore` (l.16-25): `get`, `set`, `delete`, `has`, `names`. File: `{version:1, secrets:{name: base64}}`, written via temp file and rename. Names must match `secretName` (`packages/ipc/src/channels.ts` l.20-23: lowercase words joined by `.` or `-`).
- `main/secrets.ts`: `openSecretStore()` wires `safeStorage` (DPAPI on Windows).
- Renderer: only `secrets:status` (`channels.ts` l.40-43, returns `{set}`).
**Secret names in use:**

| Name | Holds | Read by |
|---|---|---|
| `supabase.session` | refresh token (`sessionSecretName`, `supabase/session.ts`) | `account/account.ts` l.661 |
| `pipeline.proxies` | JSON list of URLs | `find/find-service.ts` l.340 |
| `pipeline.gateways` | `{enabled, gateways:[{region, apiId, url}]}` | `pipeline/pipeline-secrets.ts` l.21, l.127 |
| `mail.client` | `{id, secret}` (Gmail app) | `pipeline-secrets.ts` l.18, l.113 `readMailSecrets` |
| `mail.mailboxes` | `[{address, refreshToken}]` | `pipeline-secrets.ts` l.19 |
| `aws.keys` | AWS keys | `pipeline-secrets.ts` l.20, l.123 `readAwsKeys` |

The YouTube key is not in the store: it comes from Supabase Vault via `account/team-keys.ts` (`youtubeKey()`).
**Start message** (`pipeline/protocol.ts` ~l.195-240): `type, protocol, source ("live"|"example"), dataDir, worker, job, settings, secrets`.
- `settings`: optional `pacing`, `parallel`, `proxies`, `mail:{label, senderName, mailboxes:[{address, dailyCap 10-50, warmupStartedOn}] max 20}`. Find sends `settings: {}` (`find/find-service.ts` ~l.355-365); nothing fills `settings` yet.
- `secrets`: `youtubeKey`, `proxyUrls`, `gatewayUrls` (every job), optional `mail` and `aws`.
- Search rules go in `job.rules` (from `find.json`), not in `settings`.
- Refinement (l.255-265): each connected mailbox must be listed in `settings.mail.mailboxes`.
- Course folder: only Gemini's `courseDir` option (`gemini-service.ts` l.38). Nothing sets it.

## 6. IPC: how to add a channel (pattern: `secrets:status`)

1. **Schema:** `packages/ipc/src/channels.ts` l.40-43, in the `channels` object (`request` and `response`, zod `strictObject`).
2. **Handler:** `main/handlers.ts` l.39 `"secrets:status": async ({ name }) => ({ set: await secrets.has(name) })`. The `Handlers` type (`packages/ipc/src/dispatch.ts` l.13) maps over `channels`, so a missing handler fails typecheck. Extra context goes in `HandlerContext` (`handlers.ts` l.9-24) and is passed from `main/index.ts` l.196.
3. **Dispatch:** `main/ipc-bridge.ts` `registerBridge` (l.12-24): one `gratovo:invoke` handler, sender check, request and response validated. Nothing per channel.
4. **Preload** (`preload/index.ts`) passes any channel through `window.gratovo.invoke`.
5. **Renderer:** `window.gratovo.invoke("secrets:status", { name })`.
6. **Events from main:** add to `appEvents` (`packages/ipc/src/events.ts` l.19-35) and `appEventNames` (`bridge.ts` l.14-19); a test keeps them equal.
7. **Tests:** `packages/ipc/src/channels.test.ts` (l.71 covers `secrets:status`); `apps/desktop/src/main/handlers.test.ts` (`storeWith` l.9-18, `findWith`, `sourceWith` fakes; extend for new context fields); `packages/ipc/src/dispatch.test.ts`.

## 7. Gemini bridge

- **Service:** `main/pipeline/gemini-service.ts`, `createGeminiService(deps)` (l.167). `GeminiService` (l.57-74): `state` (`stopped | starting | listening`, l.55), `start(options)`, `call(method, params, opts?)` (never rejects; `TIMEOUT` after the method's time plus 30 s), `onEvent(listener)`, `shutdown()`.
- `GeminiStartOptions` (l.28-40): `port?, dataDir, profileDir, extensionDir, courseDir?, videoDir?`. `bridgeArgs` (l.83-105): `python -I -u -m gratovo_pipeline.gemini --port 8765 --data-dir … --profile-dir … --extension-dir …`.
- **Port:** `geminiPort = 8765` (`pipeline/gemini-protocol.ts` l.17). Daemon states (`daemonStates`, l.179-188): `listening, failed, extension_connected, extension_disconnected, browser_launching, browser_ready, addon_installing, stopped`.
- **Status row:** call `bridge.status` (`gemini-protocol.ts` l.53; result l.459-465 with `status`, `statusError`). Combine with `state` and the `daemon` events. No channel exposes it yet.
- **Token: none.** `services/pipeline/src/gratovo_pipeline/gemini/server.py` binds `127.0.0.1` (`DEFAULT_HOST`, l.78) and refuses browser pages by `Origin` (l.624-644; extension schemes allowed; no-Origin clients let in). `docs/architecture.md` §4 and `SECURITY.md` promise a per-launch token. **Mismatch to resolve.**
- **Start:** nothing starts it. `main/index.ts` l.143-158 creates it (log kind `gemini`); quit stops it (l.172-188).
- **Extension:** `services/gemini-extension/` holds **only `README.md`** ("Empty for now"). Source is in `legacy/pipeline/gemini_extension/` (other agent).

## 8. Mail

- **Jobs:** `main/pipeline/jobs.ts` `laneFor` (l.13-30). `mail.status, mail.send, mail.replies, mail.ack, mail.cancel` run in the quick lane, with `video_stats` and `gateways.*`. Python `jobs/mail.py` owns `mailbox.db`.
- **Credentials:** `readMailSecrets(store)` (`pipeline-secrets.ts` l.113-121) returns `{client, mailboxes}` for `start.secrets.mail`. Nothing calls it yet.
- **OAuth consent:** **none in main** (no `oauth`, `consent` or `accounts.google` in `apps/desktop/src`). Connecting a Gmail mailbox is unbuilt.
- **`settings.mail` shape** (`protocol.ts` ~l.201-220): `{label 1-100, senderName ≤100 | null, mailboxes:[{address, dailyCap 10-50, warmupStartedOn | null}] (max 20)}`. **Not persisted.** Addresses and caps are not secret, so `local_settings` fits (as `notify` does).

## 9. E2E

- **Specs** (`apps/desktop/e2e/`, test counts): access 3, accessibility 2, auth 6, conflicts 2, data 4, find-search 1, frame 5, fuses 1, overlays 9, security 14, settings 3, smoke 4, sync 9. Helpers: `fake-supabase.ts` (`startFakeSupabase()` returns `{url, key, close}`), `fixtures.ts`.
- **Fresh data folder:** `fixtures.ts` `userData` fixture (l.126-138) makes `mkdtemp(tmpdir(), "gratovo-e2e-")` per test and removes it after.
- **Launch:** `launchApp(userData, errors, options)` (l.53-96) sets `GRATOVO_USER_DATA`, and `GRATOVO_SUPABASE_URL`/`KEY` from the fake or empty (example data). Waits for `app://gratovo/index.html` and the rail nav.
- **Fixtures:** `running`/`app`/`page` (example, one window), `errors`, `relaunch()` (same folder), `supabase`, `startSigned()`, `signedErrors`. `syncNow(page)` (l.209).
- **Smoke pattern:** `e2e/smoke.spec.ts` l.4-11: `test("…", async ({ app, page }) => { await expect(page).toHaveTitle(strings.appName); await expect(page.getByRole("navigation", {name: strings.rail.label})).toBeVisible(); })` with `import { expect, test } from "./fixtures"`.

## 10. Patterns to copy

- **React settings row:** `settings/row.tsx` `Row` (l.25-47) inside `NotificationsSection` (`settings/sections.tsx` l.257-293: `Switch`, `setNotify`, `useApp`). Pref-based: `AppearanceSection` (l.139) with `usePref`/`setPref`. Add an action in `lib/actions.ts` (`act` for undo, `bg` for not undoable, like `setMyName`). Add a `case` in `SectionView` (`settings-screen.tsx` l.23-36), the id in `lib/settings.ts`, and the words in `strings.ts`.
- **Main service + test:** `main/secret-store.ts` + `secret-store.test.ts` (factory with injected cipher, one queue, atomic write). File-backed JSON: `main/find/find-store.ts` + `find-store.test.ts` (`defaultRules`, `readFindFile`, `writeFindFile`). Checked secrets: `main/pipeline/pipeline-secrets.ts` + `pipeline-secrets.test.ts`.

## 11. Gaps and risks for step 4

1. **No import code.** Nothing reads the old `gratovo.db`, `pipeline.db` or `mailbox.db`. Migration `0001` must match the old schema, or the importer maps it.
2. **No channel sets any secret** (`mail.*`, `aws.keys`, `pipeline.proxies`, `pipeline.gateways`). Needs set-only channels that never return a value.
3. **No pipeline settings stored.** Search rules live in `find.json` (read-only UI). Mail settings, course folder, pacing and proxies have no home. Recommended: `local_settings` for non-secret settings, `find.json` for rules.
4. **Gemini:** token mismatch (§7); bridge not started; no status channel; extension empty.
5. **Live gate:** no `source` in the frame or account view (§3).
