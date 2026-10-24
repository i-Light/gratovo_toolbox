# Plan: step 4, live data import and operational connections

Written 2026-10-24 by the lead (Opus) on branch `feat/4-live-data-and-connections`, after the owner's pipeline-first realignment (PR #18). Recon: `.router/CONTEXT.md` (app side). The legacy findings are summarised under Decisions here. Replaces 3e-3's plan (in git history at de5feee).

One pull request. Testing follows ground rule 10: lint, typecheck, Vitest and pytest for every task, plus **one** new Electron smoke test.

## Goal

The owner's real data is in the new app, and every connection and setting that Find and Reach need works. In live mode only wired screens can be reached.

## Non-goals

- Today, Close, Deliver, Insights, Team and Toolbox screens (later steps). Find's triage, gallery and contacts tabs (step 5).
- Sending a Gemini prompt. Step 4 only starts the bridge and connects the add-on, so the owner's pacing rules aren't touched.
- Sending email or reading the mailbox. Connecting a mailbox is consent only; the health check is `mail.status` on a fake in tests.
- R2, a teammate's run, the installer (step T).
- Importing Supabase-mirrored tables (the sync brings them), Gmail token files, `.env`, news, `email_library.db`, `skills_library.db`.

## Acceptance

1. A dry run and a real import, tested against a copy of an old `gratovo.db` built in the tests from the legacy DDL, including an old copy that lacks `channels.found_emails`. The dry run writes nothing. The real one backs up first and never writes the old file. A written report (ADR 0016) of the rehearsal against the owner's real copy, run by the lead read-only.
2. Settings › Search rules, Writing rules and Connections save, survive a restart, and reach the pipeline and the bridge (start message, bridge options).
3. The add-on in `services/gemini-extension/` builds, and a test proves the bridge admits it with the per-launch token and refuses a wrong token or a web page.
4. Signed in (live), the rail, the palette, the G keys, links, the hash and back/forward reach only Find (Search tab), the record page and the wired Settings sections. On example data everything shows as before.
5. `pnpm lint`, `pnpm typecheck`, `pnpm test` green; one new Electron smoke test; the existing Electron suite green in CI.

## Decisions

**D1. The live gate.** The frame gains `source: "example" | "live"`. One module, `renderer/lib/wired.ts`, holds what live mode may show: `find: ["search"]`, `record`, and the Settings sections `profile, appearance, keyboard, notifications, search, writing, connections`. Example data shows everything (until prototype mode, step 7, takes it over). Every way in goes through it: rail, `screenOrder` for the palette, `goLetters`, `go()`, `routeFromHash`, `routeOf`, back/forward (skip a hidden entry), action and setting commands, Settings section list and search. Live default route: Settings › Connections while the import state is `never` (first run), otherwise Find › Search. The Settings shells' "Arrives with step N" numbers follow the new plan: Your day 7, Agency facts 8, Team and money 9.

**D2. What the import reads.** The old app kept the pipeline and its Supabase mirror in **one** `gratovo.db` (there is no old `pipeline.db`). Candidates: `%LOCALAPPDATA%\Gratovo IMA ToolBox\data\database\gratovo.db` if it exists, plus any file the owner picks (the newest copy is in the old dev checkout, `...\gratovo_code\data\database\`). Refused: a path inside the new app's data folder (its own `gratovo.db` has the same name), a file that isn't SQLite, or one with no `channels` table. Opened read-only (`mode=ro`), never written.

**D3. Where it goes.** A Python job, `import.legacy`, in the main lane: `store.open` creates or migrates `<userData>/pipeline/pipeline.db` (live only; refused on example data), `ATTACH` the old file read-only, and for each of `keywords, channels, channel_keywords, videos, channel_archive, runs, video_transcripts` copies the columns both sides have with `INSERT OR IGNORE`. Rows the new app already holds win. One transaction per table, a progress line per table. Not copied: `sync_state`, `_applied_segments`, `archive_keyword_pending` (R2 bookkeeping for the old worker name; step T1 starts its own), news tables, the mirror tables.

**D4. The dry run** is the same job with `dryRun: true`. It never creates or writes the destination (it attaches an existing one read-only). The report: per table, rows in the old file, rows to add, rows already here; the tables skipped and why ("the sync brings these", with counts); **unsent old work** (`_outbox` rows and `activity_log` rows with `synced = 0`): a warning that they won't move, so the owner opens the old app once to send them or redoes them by hand; the old settings files found beside the database.

**D5. Backup.** Before a real import, if `pipeline.db` exists: `VACUUM INTO <userData>/backups/pipeline-<UTC stamp>.db` (by the job, before it writes), and main copies `find.json` beside it. The report names the backup.

**D6. Main's part after the job.** Seed the local `channels (channel_id, name)` from the imported channels where the name is missing (the frame's names; R2 would have brought them, and that waits for T). If the owner ticked "Use my old search rules" in the dry-run dialog, map `run_config.json` and `settings.json` (`auto_clean`, `handles_to_search_limit`) from the old `data/` folder into `find.json` rules (sort_by→sortBy, results_type→resultsType, handle_limit→perKeyword, the subscriber band). Record `local_settings.import = {at, source, counts, backup}`.

**D7. Settings persistence.** Non-secret values in `local_settings` of the open source (so example and live never mix): `pipeline.settings` `{pacing, parallel, proxies: {enabled, includeDirect}}`; `mail.settings` `{label, senderName, mailboxes: [{address, dailyCap, warmupStartedOn}]}` (the start message's `settings.mail` shape); `course` `{courseDir, videoDir}`; `import`. Search rules stay in `find.json`. Secrets keep their 3e names (`mail.client`, `mail.mailboxes`, `pipeline.proxies`, `pipeline.gateways`, `aws.keys`) and get **set-only** channels: the renderer sends a value, never reads one back, and sees only "set" or a count. Find's and mail jobs' start messages fill `settings` from these (today Find sends `{}`).

**D8. Search rules.** `find.json` rules gain `minMedianViews: number | null`, `minUploads30: number | null` and `archiveDays` (default 7). The pipeline's `job.rules` gains the first two. After a kept channel's videos are fetched and its signals derived, a channel below either bound is archived like an auto-clean sweep, with the label the old app used (C1b checks `legacy/lib/.../auto_clean_controller.dart`). `archiveDays` is saved now and read by step 5's reject; Find's rules card shows it. Settings › Search rules edits all of it (the prototype's `Rules` card), and Find's rules card gets "Edit rules", which opens that section.

**D9. Writing rules.** Main reads the playbook rule files `services/pipeline/data/comms/playbook/rules/*.rules.json` (located beside the pipeline folder, as `python-path.ts` does; missing in a packaged build until T5, then "not found") and returns `[{id, area, stage, title, rule, level}]`. Settings › Writing rules is the prototype's `RulesTool`: search by id or words, grouped by area. No "N drafts now" counts until drafts exist (step 6).

**D10. Connecting a Gmail mailbox (main, security).** OAuth 2.0 for installed apps: a one-shot loopback server on `127.0.0.1:<random port>`, PKCE S256, a random `state`, the system browser through `shell.openExternal` (the external-link guard allows `https://accounts.google.com/` for this call only), five minutes to finish, one code accepted. Main exchanges the code at `https://oauth2.googleapis.com/token` (added to main's network allowlist). Scopes: `gmail.modify`, `gmail.send` (as the old app), plus `openid email` so the address comes from the token response's `id_token` `email` claim (received straight from Google over TLS, so no signature check). The refresh token goes into `mail.mailboxes` (replacing the same address); the mailbox row into `mail.settings` (cap 20, warm-up today). The client id and secret are entered once by the owner (`mail.client`). No code, token or address is logged. Tests use a fake token endpoint and a fake browser opener.

**D11. Connections status.** `connections:status` assembles one snapshot: Python (found or missing), YouTube (team key available or not; no quota spent), Gemini (bridge state, add-on connected and its version, browser), mailboxes (from `mail.settings` plus the last `mail.status` answer, kept in memory), Gmail app (set or not), proxies (count, switches), AWS (keys set, gateway regions, switch), course folder (set and exists), sync state, import state. "Check mailboxes" runs `mail.status`. Gateways deploy and remove through the existing `gateways.*` jobs. Folder pickers use main's dialog.

**D12. The Gemini bridge.** Started only by the owner from Connections ("Start" or "Open the Gemini window"). Options: `dataDir` = the open source's pipeline folder, `profileDir` = `<userData>/gemini-profile`, `extensionDir` = `<repo>/services/gemini-extension` (resolved like `python-path.ts`; null when packaged, reported missing), `courseDir` and `videoDir` from `course`. A switch of data source stops it (ADR 0014's open item). Main pushes `gemini:state` events from the daemon's events and `bridge.status`.

**D13. The per-launch token.** Main makes 32 random bytes (hex) per bridge start and passes them in the child's environment as `GRATOVO_BRIDGE_TOKEN` (never argv, never logged; the bare environment gains just this one variable). The bridge, when it builds the Firefox copy of the add-on, writes `bridge-token.js` (`self.GB_BRIDGE_TOKEN = "…";`) into the built folder, first in the background scripts. The add-on sends `token` in its `hello`. `_admit` compares it in constant time when a token is set and the browser is Firefox; a wrong or missing token closes with 4001 "wrong token". Chrome and Edge load the source folder unpacked, which can't carry a per-launch value, so for them the origin check and browser admission stay the guard (written in the ADR, and `architecture.md` and `SECURITY.md` say exactly this). `has_extension` becomes "`manifest.json` exists" (the folder held only a README).

**D14. The add-on port.** Copy `legacy/pipeline/gemini_extension/` into `services/gemini-extension/` keeping its layout (the bridge loads `tools/build_addon.py` from there). Fix the stale paths, bump to 0.4.0, add the token. Its `node --test` suite (jsdom) runs in `pnpm test` through a small workspace package. `test_build_addon.py` is ported to `services/pipeline/tests/`, plus `ADDON_ID == GEMINI_ADDON_ID`.

**D15. The smoke test.** One Electron test: signed in against the fake Supabase, the rail shows only Find and Settings; it opens Settings › Connections and sees the Python row (the status round trip).

## Contracts

C1a and C1b write the exact zod and Python shapes. The decisions above fix their content. Names:

- Frame: `source: "example" | "live"`.
- Channels (`domain:verb`): `import:candidates` → `{candidates: [{path, modifiedAt, size}]}`; `import:pick` → `{path | null}` (dialog); `import:dry-run {path}` → `ImportReport`; `import:run {path, useOldRules}` → `ImportReport & {backup | null}`; `rules:set {rules}` (find rules, validated); `writing:rules` → `{rules: [...]}`; `connections:status` → `ConnectionsStatus`; `connections:set` (a discriminated union by `kind`: `mail.client`, `mail.settings`, `mailbox.update`, `mailbox.remove`, `proxies.urls`, `pipeline.settings`, `aws.keys`, `gateways.enabled`, `course`); `connections:pick-folder {purpose: "course" | "videos"}` → `{path | null}`; `mail:connect` → `{ok: true, address} | {ok: false, reason}`; `mail:check` → mailbox health; `gateways:deploy {regions}`, `gateways:remove {region}`; `gemini:start`, `gemini:stop`, `gemini:open-window {browser}` → Gemini status.
- Events: `import:progress {table, done, total}`, `gemini:state`, `connections:changed`.
- Handlers delegate to service objects in `HandlerContext` (`importer`, `connections`, `gemini`, `writingRules`, `mailConsent`), typed in C1a, so later tasks don't touch `handlers.ts`.
- Pipeline protocol: job `import.legacy {source, dryRun, backupDir}` with progress lines and an `ImportReport` result; `job.rules.minMedianViews`, `job.rules.minUploads30`. Both sides plus `protocol.schema.json`.

## Tasks

| id | tier | depends | files (main ones) | spec | done-check |
|---|---|---|---|---|---|
| C1a | H | – | `packages/ipc/src/{channels,events,bridge,data}.ts` + tests; `main/handlers.ts` (delegation, `HandlerContext` service types); stub services wired in `main/index.ts` that answer "not built yet" | The IPC contracts above, exact zod; frame `source` filled by both sources | `pnpm typecheck`, ipc and handlers Vitest |
| C1b | H | – | `services/pipeline/src/gratovo_pipeline/protocol.py`, `protocol.schema.json`, `main/pipeline/protocol.ts` + schema tests | `import.legacy` job and the two rule fields; `ImportReport` shape on both sides; job lane = main | pytest protocol tests, Vitest protocol tests |
| B1 | N | C1a | `renderer/lib/{wired,routes,store,frame,settings}.ts`, `app/{rail,global-keys,start}.tsx`, `overlays/commands.ts`, settings screen list | D1 | Vitest for `wired.ts` and the reach points |
| B2 | N | C1b | `services/pipeline/src/gratovo_pipeline/jobs/import_legacy.py` + tests | D3, D4, D5 (backup by `VACUUM INTO`). Fixtures build old files from the legacy DDL (`legacy/pipeline/gratovo/store.py`, `legacy/lib/core/sync/mirror_schema.dart`), one without `found_emails` | pytest |
| B3 | N | C1b | `search/keyword.py`, `search/auto_clean.py` + tests | D8 pipeline side | pytest |
| B4 | N | C1a, C1b | `main/import/import-service.ts` + test; `main/find/find-store.ts` (rule fields, old-rules mapping) | D2, D5 (find.json copy), D6 | Vitest |
| B5 | N | C1a | `main/settings/{connections-service,writing-rules}.ts` + tests; `main/find/find-service.ts` (fill `settings`) | D7, D9, D11 (status snapshot, set-only secrets, pickers, `mail:check`, gateways) | Vitest |
| B6 | H | C1a | `main/mail/consent.ts` + test; `main/net/network.ts` allowlist; `main/external-links.ts` | D10 | Vitest with fake endpoint and opener |
| B7 | H | C1a | `gemini/server.py`, `gemini/browser/manager.py` + tests; `main/pipeline/gemini-service.ts` (env token) + test; `main/gemini/gemini-control.ts` + test | D12, D13 | pytest, Vitest |
| B8 | N | B7 | `services/gemini-extension/**`, `services/pipeline/tests/test_build_addon.py`, workspace package for its node tests | D14 (token in `hello`, `bridge-token.js` in the Firefox build) | pytest, its node tests in `pnpm test` |
| B9 | N | B1, B5 | `renderer/settings/{search-rules,writing-rules}-section.tsx`, `find/rules.tsx` link, strings | D8 UI, D9 UI | Vitest component tests |
| B10 | N | B9, B4, B6, B7 | `renderer/settings/connections-section.tsx` and its parts, import dialog, strings | D11 UI, D4 dialog, D10 button | Vitest component tests |
| W1 | N | B4–B7 | `main/index.ts` | Replace the C1a stubs with the real services | typecheck, Vitest |
| T1 | N | W1, B10 | `apps/desktop/e2e/live-gate.spec.ts` | D15 | runs in CI (Windows); locally after `pnpm build` |
| D1 | E | all | ADR 0016, `architecture.md`, `SECURITY.md`, pipeline README, plan §5, PROGRESS | Docs | read-through |
| L1 | lead | all | – | Full checks, the read-only rehearsal on a copy of the owner's `gratovo.db`, `router-reviewer`, fixes, PR, CI, merge | green CI, merged |

Order: C1a and C1b in parallel; then B1, B2, B3, B5, B6, B7 (no shared files); B4, B8; B9, B10; W1; T1; D1; L1.
