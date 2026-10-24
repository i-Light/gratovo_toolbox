# Context: step 5, Find (app side recon)

Recon written 2026-10-24 on `main` at b3b5397 (step 4 merged). Paths are under `apps/desktop/src/` unless shown. Plan: `docs/migration-plan.md` §6 "Step 5". Legacy and prototype refs are in §7 and §8.

## 1. Commands

| Task | Command (source) |
|---|---|
| Lint | `pnpm lint` = `eslint . && prettier --check . && uv run --directory services/pipeline ruff check . && ruff format --check .` (root package.json) |
| Typecheck | `pnpm typecheck` = `tsc -b && uv run --directory services/pipeline pyright` |
| Unit tests | `pnpm test` = `vitest run && uv run --directory services/pipeline pytest` |
| One Vitest file | `pnpm exec vitest run apps/desktop/src/main/handlers.test.ts` (from root) |
| E2E, all | `pnpm test:e2e` = `pnpm --filter @gratovo/desktop test:e2e` = `install-electron && electron-vite build && playwright test` (apps/desktop/package.json) |
| E2E, one spec | `cd apps/desktop && pnpm build && pnpm exec playwright test e2e/find-search.spec.ts` (`pnpm test:e2e -- file` does not filter; docs/workflow.md l.51) |
| Server / SQL tests | `pnpm test:server` (needs local Supabase) / `pnpm test:sql` (Docker); not in `pnpm test` |

**CI** (`.github/workflows/ci.yml`): `checks` (windows-2025: install, lint, typecheck, `pnpm test`, `pnpm test:e2e`); `sql`, `server`, `secrets` (gitleaks), `audit` (osv-scanner), `codeql`.

## 2. Find today

**Renderer** (`renderer/find/`):
- `find-screen.tsx` l.60 `FindScreen`: tab `search` renders `SearchTab` (l.16-57), any other tab renders `PlaceholderScreen`. Grid (l.45-51): `Keywords`, then `LiveRun`, `Rules`, `Kept`. Example hint l.39-44 when signed out.
- `keywords.tsx` l.100 `Keywords`: paste box (l.94), add l.36-63 (`find:add`), `edit()` l.10-22 (`find:start-at` / `find:remove`, index only). Row `Status`/`Row` l.21-98. No Gemini suggestions yet.
- `live-run.tsx` l.50 `LiveRun`: headline `headline()` l.28 and `shownState()` l.18 (ready/paused/done derived from queue). `press()` l.67-92: `find:stop` when running, else `find:start`; the start problem shows `strings.findSearch.startProblems`. Tallies l.127-140 (found, kept, swept). Log l.147-157. Error callout l.141-146 (`strings.findSearch.errors[code]`).
- `rules.tsx` l.30 `Rules`: read-only chips; "Edit rules" calls `openSetting("search")` (`lib/actions.ts` l.353). `archiveDays` chip l.71.
- `kept.tsx` l.11 `Kept`: list of the newest kept channels (name, handle, subs, median, country, keyword). It has no actions.
- `lib/find.ts`: `useFind()` l.38-80 reads `find:state` on mount, follows `find:changed`, drops stale answers by `version`. `keywordMax` 200, `addMax` 500 (l.5-6), `compactCount`.

**IPC** (`packages/ipc/src/channels.ts` l.111-146; schemas in `packages/ipc/src/find.ts`):

| Channel | Request | Response |
|---|---|---|
| `find:state` | `{}` | `findStateSchema` (find.ts l.47-96) |
| `find:add` | `{keywords: string[1..500]}` | `{added, skipped}` |
| `find:remove` | `{index 0..499}` | `{ok:true}` or `{ok:false, problem:"running"}` |
| `find:start-at` | `{index}` | same as remove |
| `find:start` | `{}` | `{ok:true}` or `{ok:false, problem: no_keywords\|running\|no_youtube_key\|no_python}` (find.ts l.112-118) |
| `find:stop` | `{}` | `{}` (this is Pause; there is no separate pause or resume channel) |
| `rules:set` | `{rules}` | `{}` (Settings › Search rules) |
| event `find:changed` | | `findStateSchema` whole (`packages/ipc/src/events.ts` l.33) |

`findStateSchema`: `queue[{keyword, state queued|running|done|failed, found, kept}]`, `at` (next keyword), `rules`, `run{state ready|running|stopping|paused|done|failed, found, kept, swept, error}`, `log[≤200]`, `kept[≤100]{channelId, name, handle, subscribers, medianViews, country, keyword}`. Error codes: `findErrors` (find.ts l.44). Handlers: `main/handlers.ts` l.72-80. Service created `main/index.ts` l.260, emit l.268.

**Main** (`main/find/`):
- `find-service.ts` l.105 `createFindService`. `open()` l.127: folder is `userData/example-pipeline` (example) or `userData/pipeline` (live), from `account.findContext()`.
- `start()` l.346-427: live needs the YouTube key (`teamKeys.youtubeKey`, l.357-367); proxies and gateways from the secret store (l.368-369); re-checks the account (l.372-384); `supervisor.start` (l.391) with job `{kind:"search", keywords: whole queue, startAt: at, rules: pipelineRules(rules)}` and `settings: searchSettings(...)` (no mail part). Run state reset l.419-420; `kept` read from `pipeline.db` l.421.
- Resume = `find:start` again: it starts at `at`, the first keyword not done (`firstUndone` l.193). Pause = `stop()` l.429: sets `stopping`, `supervisor.stop()`. The job ends `stopped` and `exit()` l.254 sets `paused`. A keyword in flight is set back to `queued`.
- Progress path: pipeline stdout line → `pipeline/supervisor.ts` (`createPipelineSupervisor` l.85) → `parseLine` (`pipeline/protocol.ts` l.671) → `message()` l.202 (`keyword` l.204, `channel` l.223, `log` l.241) → `notify()` l.176 (at most one emit per 250 ms, `throttleMs`) → `emitNow()` l.162 → `build()` l.151 → `index.ts` emit `find:changed`.
- `find-store.ts`: `find.json` in the same folder as `pipeline.db` (`findFileName` l.13). `defaultRules()` l.24-42 (AU CA GB IE NZ US; 200 per keyword; upload_date; video; auto-clean 50k/2M, sweep below, delay above; `archiveDays` 7). `readFindFile` l.70, `writeFindFile` l.102 (temp file then rename). `pipelineRules` l.48 drops `archiveDays` (main only). `rulesFromOldFiles` l.161 (step 4 import).
- `results.ts` l.69 `readKept(dbPath, rules, limit)`: opens `pipeline.db` read-only with `node:sqlite` (l.73). Query l.28-32: `channels` with `videos_fetched_at` set, newest 1000, latest keyword from `channel_keywords`. `keptByRules` l.43 applies countries and auto-clean bands, so the list matches what a run keeps.

**Run history and "Review what it found": not built.** Only the current run is in memory (`session.run`, `log`, `kept` in find-service). A restart shows the queue and the kept list from `pipeline.db`, not past runs. Nothing in the app reads the `runs` table. The words "Review what it found" appear nowhere in the app; the prototype's button is "Review results" (find.js l.222-233, the Runs table, opens the gallery filtered by run).

## 3. Where creator data lives

**Pipeline `pipeline.db`** (`services/pipeline/src/gratovo_pipeline/store.py`, DDL l.31-170; Python owns it):
- `channels` (l.44-78): `channel_id` PK, `handle`, `name`, `description`, `subscribers` TEXT (number or "Hidden"), `profile_picture`, `country` (ISO-2), `first_seen_at`, `videos_fetched_at`, `videos_last_30` (uploads, 30 days), `median_views_last_30`, `latest_upload_at`, `sponsored_ratio`, `seen_brands` JSON, `found_emails` JSON. Lines l.61-70 are R2 bookkeeping, not for UI.
- `channel_keywords` (l.87-97): `(channel_id, keyword)` PK, `discovered_at`. This is the "found by" keyword.
- `videos` (l.99-111): `title`, `thumbnail`, `published_at`, `view_count` TEXT. Card thumbnails and the last 3 videos come from here.
- `channel_archive` (l.113-130): `channel_id`, `handle`, `label`, `archived_at`, `subscribers`, `found_via` JSON, `median_views_last_30`, `median_basis`, `videos_found_count`. Written by auto-clean and refetch.
- `keywords` (l.31-42), `runs` (l.153-165: `started_at`, `finished_at`, `status`, `keywords_total`, `keywords_done`, `channels_upserted`, `kind` search|catch-up|re-enrich), `archive_keyword_pending` (l.145), `video_transcripts` (l.171).

**App `gratovo.db`** (`main/db/migrations/0001-initial.ts`; `0002-member-access`, `0003-sync`):
- `channel_state` (l.18-40): `channel_id` PK, `handle`, `vetting_status` (newlyFound|shortlisted|rejected), `pipeline_stage` (legacy), `creator_stage` (the app's stage), `contacts` JSON `[{method, value, label, primary}]`, `channel_tags` JSON, `archive_due_at`, `notes`, `owner_id`, `manual_engagement_rate` and note, `media_kit`, `creator_gender`, `provided_data`, `last_deal_at`.
- `channels` (l.115-118): `(channel_id, name)` only.
- `activity_log` (l.98-112), `local_settings` (l.131-134: JSON value by key), `notifications`, `profiles`, `brands`, `deals`, `_meta`.

**How they are joined today: they are not.** Creators in the app are `channel_state` rows (`repositories/creators.ts` `listCreators` l.60, LEFT JOIN `channels` for the name, email = primary contact; cap 5000 l.50). Pipeline channels never reach the frame. Who reads `pipeline.db` from TS:
- `find/results.ts` `readKept` (Find's kept list, read-only).
- `import/import-service.ts` l.134-143 `readPipelineChannels` (`channel_id, name`) → `seedChannelNames` (l.420), first-run import.
- `pipeline/gemini-service.ts` l.46 (comms actions read the folder).

**Sync** (`main/sync/`): `mirror-tables.ts` l.23-52 pulls `channel_state` (columns incl. `creator_stage`, `contacts`, `archive_due_at`, `channel_tags`, `manual_engagement_rate`; cursor `updated_at`, key `channel_id`). `uploader.ts` l.87-93 pushes the same columns. `intents.ts` l.174-198: `creator.stage` writes an outbox entry for `channel_state`. Mapping of stages to legacy fields: `packages/core/src/data/legacy-mapping.ts` l.55-76 (`rejected` → vetting `rejected`; `parked`/`never` → pipeline `lost`).

**Supabase** (`supabase/migrations/20261020120000_baseline.sql`): `channel_state` l.117-~150. `channel_tags` vocabulary l.133-136: `undecided, qualified, haramStuff, irrelevant, inactive`. Trigger `set_archive_due_at` l.784-800 sets `archive_due_at` = now + 7 days when a rejecting tag is set, and clears it when it goes. The app never writes `channel_tags`, so the countdown never starts from the app (see §10).

**DataSource** (`packages/core/src/data/types.ts` l.241-256):

| Method | Creators, channels, contacts, archive, activity, never-contact |
|---|---|
| `frame(): Promise<Frame>` | Yes, read: `creators` (l.126-132 `Creator {id, name, handle, stage, email}`), `log` (newest 50, `repositories/activity-log.ts` l.7 `logCap`), `conflicts`, `notify`, `team`, `deals`, `brands`. |
| `write(writes)` | Only `creator.stage` (l.227), `log.add` (l.223), `log.remove` (l.225), `conflict.resolve` (l.239). No write for contacts, archive, bring-back, never, reject reason, or shortlist (shortlist is a stage). |
| `readSetting` / `writeSetting` | `local_settings` (l.247-249). |
| `seedChannelNames(rows)` | Writes `channels.name` only (l.254). |
| `close()` | (l.255). |

`CreatorStage` (types.ts l.20-32): new, shortlisted, contact, emailed, replied, kit, audience, signed, rejected, parked, never. Implementations: `createSqliteSource` (`main/data/sqlite-source.ts` l.81; `readFrame` l.85-122; `apply()` l.124-165) is the one class for both. Example: `example-source.ts` l.41 `openExampleSource`, seeded from `packages/core/src/data/example.ts` l.56 `exampleSeed`. Live: `live-source.ts` l.16 `openLiveSource`, zero counts (l.9-13). Contract tests: `main/data/data-source-contract.ts` l.84 `describeDataSourceContract`, run by `example-source.test.ts` and `live-source.test.ts`.

**Renderer copy of creators:** `lib/store.ts` `AppData` (l.58), `Creator` re-exported (l.191), `findRecord` l.324, `recordName` l.339.

## 4. Pipeline jobs for Find

| Job | Protocol (TS `main/pipeline/protocol.ts`; Python `gratovo_pipeline/protocol.py`) | Lane (`main/pipeline/jobs.ts` l.13-30) | Python code | Main calls it? |
|---|---|---|---|---|
| `search` | TS `searchJob` l.94-106 (`keywords`, `startAt`, `rules`); Py `JobKind` l.105, search job l.151 | store | `jobs/search.py` `run()` l.88; per keyword `search/keyword.py` `process_keyword` l.32 | **Yes**: `find/find-service.ts` l.391 (only caller) |
| `search` messages | TS `keywordSchema` l.332-341 (`started\|done\|failed`, found, kept), `channelSchema` l.343-357 (`kept\|swept\|delayed`), `logSchema` l.369, `runSchema` l.325, `end` l.634 | | `Emitter` in `protocol.py` | Yes, `message()` l.202. `delayed` and `run` are ignored |
| `refetch` | TS l.154-163 (`handles`, `autoClean`, optional `keyword`) | store | `jobs/refetch.py` (`start_run(…, "re-enrich")` l.278) | **No** |
| `backfill` | TS l.164-175 (`only`: channels, videos, backfill, backlog) | store | `jobs/backfill.py` (the enrich port, §8) | **No** |
| `video_stats` | TS job l.150 | quick | `jobs/video_stats.py` | No |
| `import.legacy` | TS l.202 | store | `jobs/import_legacy.py` | Yes (`index.ts` l.299 `runStoreJob`) |
| `mail.*`, `gateways.*` | TS l.108-193 | quick | `jobs/mail.py`, `jobs/gateways.py` | Yes (`index.ts` l.329, `settings/connections-gateways.ts` l.76, l.133) |
| email finder | none. No job of its own | | `found_emails.py` `find_emails` l.123, run from `search/signals.py` `derive` l.94 (via `compute_found_emails` l.80) | Implicitly, in search and backfill |
| archive sweep (auto-clean) | rules in `rulesSchema` (TS l.80-95; Py l.137-150) | inside `search` | `search/auto_clean.py`: `sweep_by_signals` l.83, `apply_gate` l.135, `archive_channel_locally` l.114, l.165; store `archive_channel_locally` l.910 | Via search only |
| Gemini keyword ideas | `action.generate_keywords`: method list `gemini-protocol.ts` l.66; params l.353-362 (`topic`, `count`, `exclusions`, `styles`, `language`, `avoid`, `notes`, `chats`, `perChat`); result l.535-541 (`keywords`, `dropped`, `chats`) | the Gemini bridge, not a job | `gemini/actions.py` `generate_keywords` l.275; batch in `gemini/keywords_batch.py` (`chats` > 1) | Main has the method (`gemini-service.ts` l.133 timeout, l.166 case) but **no IPC channel** reaches it |

Notes:
- `run` line and `end` line: `find-service.ts` `exit()` l.254 maps `end.state` to paused, done or failed, and the error code to `findErrors`, else `crash` (l.264-268).
- Refetch and backfill write `pipeline.db` and read Supabase nothing; they need the YouTube key like search.
- A search job's start message: `settings` must not carry `mail` (find-service l.66-70).

**Is `enrich` ported?** Yes, in part. `legacy/pipeline/tools/enrich.py` (535 lines, read-only by default, a YouTube budget, three jobs: channels, videos, backfill) is `services/pipeline/src/gratovo_pipeline/jobs/backfill.py` (header l.1-25: "the old `enrich.py` without its report and its sync"), with `jobs/refetch.py` for the single-handle case. Tests: `services/pipeline/tests/test_enrich_job.py`, `test_refetch_job.py`. It is not in the UI and main never starts it.

## 5. Renderer frame patterns

- **Store:** `lib/store.ts` `createAppStore` l.212, `appStore()` l.248, `useApp(selector)` l.298, `selectRoute` l.318, `go(screen, tab, options)` l.376 (`record` takes `{record, from}`).
- **Undoable change:** `lib/actions.ts` `act(label, recipe, {log, toast})` l.81-137. The recipe runs on the data draft; a line goes to the activity log (`log.unshift`, l.87-89) unless `log: false`; `markSaving()`; toast with Undo, which only works while this is still the newest change (l.112-120), else "newer changes came first". `undo()` l.140, `redo()` l.158.
- **Saving:** `lib/persist.ts` l.283 sends each change through `data:write` in batches (max per call l.10); l.296 the persister. Non-undoable changes are `bg`-style (`setMyName` `actions.ts` l.326; `setNotify` l.339).
- **Toast:** `lib/toast.ts` `toast({msg, sub, icon, tone, ms, actions})` l.17, keeps the newest 3 (l.12). `overlays/toasts.tsx` `Toasts` l.106.
- **Peek:** `actions.ts` `peek(record, list)` l.173, `closePeek` l.184, `stepPeek` l.191 (Alt+Arrow). `overlays/peek.tsx` `Peek` l.16 (`aside`; keys Esc, Alt+Up/Down; not a barrier, so the screen still gets keys). `overlays/record-summary.tsx` `RecordSummary` l.24.
- **Record page:** `actions.ts` `openRecord` l.205. `app/record-page.tsx` `RecordPage` l.12 is a stub: a back button and `RecordSummary`. The prototype's record has tabs (Overview, Emails, Deals, Notes); none are built.
- **Keys:** `packages/core/src/keys.ts` `createKeyStack` l.79 (layers, `barrier`), `createGoPrefix` l.136 (1.2 s). `lib/keys.ts` `keyStack` l.6, `useKeys(map, {active, barrier})` l.13, `isTyping` l.31 (single letters do not fire while typing). `app/global-keys.ts` Ctrl+, l.52-55, G-prefix l.62-83, the "letters" pref l.76-77 turns single letters off. No single-letter keys are bound on Find yet (triage needs S, R, 1–4, arrows).
- **Live gate:** `lib/wired.ts` `liveWired` l.16-27 (`find: ["search"]`, `record: []`, Settings sections). `isScreenShown` l.40, `isTabShown` l.45, `defaultRoute` l.80. `FrameSource` is in the frame (`types.ts` l.186-191), so the gate can read it. `routes.ts` `routeFromHash` l.134-141; `screens` l.62-73 (Find tabs in `strings.ts` l.1036: search, triage "Review new", gallery, contacts).
- **Placeholders:** `app/placeholder-screen.tsx` `PlaceholderScreen` l.8. Find's non-search tabs (`find-screen.tsx` l.62) and Toolbox (`app.tsx` l.72-73) use it.
- **Strings:** one module, `renderer/strings.ts` (1133 lines): `peek` l.891, `toasts` l.899, `findSearch` l.922-1022, `placeholder` l.1023, `screens` l.1031, `actions` l.1081 (undo and newer-changes words), `record` l.1094.
- **Model to copy for a list screen:** `find/kept.tsx` (54 lines: a card, a count, an empty line, `aria-label` list). Its test: `find/find-screen.test.tsx` "the kept list" l.393-443, with the `happy-dom` setup and `setAccountView` (l.1-30). Fake bridge for tests: `lib/find-test-bridge.ts` `stubFindBridge`.

## 6. How to add an IPC channel (pattern: `secrets:status`)

1. **Schema:** `packages/ipc/src/channels.ts` l.62 (`"secrets:status"`), in the `channels` object (`request` and `response`, zod `strictObject`). Find's block is l.111-146.
2. **Handler:** `main/handlers.ts` l.47 `"secrets:status": async ({ name }) => ({ set: await secrets.has(name) })`. The `Handlers` type (`packages/ipc/src/dispatch.ts` l.13) maps over `channels`, so a missing handler fails typecheck. Extra context goes in `HandlerContext` (`handlers.ts` l.14-29) and is passed from `main/index.ts` l.391 (`createHandlers`).
3. **Dispatch:** `main/ipc-bridge.ts` `registerBridge` (l.12): one `gratovo:invoke` handler, sender check, request and response validated. Nothing per channel.
4. **Preload:** `preload/index.ts` passes any channel through `window.gratovo.invoke`.
5. **Renderer:** `window.gratovo.invoke("secrets:status", { name })`.
6. **Events from main:** add to `appEvents` (`packages/ipc/src/events.ts` l.27-37) and `appEventNames` (`packages/ipc/src/bridge.ts` l.14); a test keeps them equal.
7. **Tests:** `packages/ipc/src/channels.test.ts` l.70 (`secrets:status`); `apps/desktop/src/main/handlers.test.ts` l.160 (fakes `storeWith`, `findWith`, `sourceWith`; extend for new context fields); `packages/ipc/src/dispatch.test.ts`; `packages/ipc/src/find.test.ts` for find schemas.

## 7. Prototype map (`design/workbench-prototype/js/`)

**find.js** (445 lines; header l.1-3):
- l.55-60 `F()`/`X()`/`setF`/`setX`: filter and view state in `W.U().find` / `findui`.
- l.63-67 `SIGNALS` (Gold mine, Sponsored before, Has an email, …), `STAGES`, `COUNTRIES`, `MEDIANS`, `UPLOADS`.
- l.70-81 `passes(c, f, skip)`: the facet filter; stage defaults hide rejected and never.
- l.82 `results()` (sorted by `SORTS`, l.~69-81).
- l.113-124 `RunStatus` (topbar). l.125-164 `Keywords` (paste, Suggest with Gemini `openGen` l.130). l.165-189 `Rules`. l.190-213 `Live` (run card). l.214-221 `Mate` (teammate run, step T). l.222-233 `Runs` (history table, "Review results"). l.234-241 `Search` (tab).
- l.242-252 `Triage` (new finds, gold first). l.253-296 `Facet`, `Facets` (counts, l.259-274), `ActiveChips` l.275.
- l.297-322 `Card` (thumbnail flip on hover, l.301). l.323-344 `Compare`. l.345-358 `Bulk` (bulk bar). l.359-370 `Table`. l.371-418 `Gallery` (tab). l.419-434 `Contacts` (tab, "Confirm all 90%+"). l.436-445 `W.screens.find` (tabs).

**records.js** (436 lines):
- l.15-32 `Gate` (send gates). l.124-145 `W.ContactBlock` (addresses, confirm, primary). l.146-157 `W.AudienceCheck`. l.241-263 `W.TriageCard`; l.264-302 `W.Triage` (one channel at a time, keys S/R/1–4, `REJECT_REASONS` from `data.js` l.27: not relevant to AI tools, too few views, not posting enough, audience outside US/UK/CA/AU).
- l.347-358 `W.NextCard`. l.359-405 record bodies (`CreatorBody` l.359, `Notes` l.399). l.406-436 `W.Record` (peek and full page; tabs Overview, Emails, Deals, Notes).

**more.js** (918 lines): `TB_DEF` l.427; `TOOLS` l.428-~437 (Archive l.430, Never contact l.431, Activity log in History). `W.A.allowAgain` l.440. `ArchiveTool` l.519-538 (rejected, "archived for good after N days", Bring back). `NeverTool` l.539-569 (add a channel, reason, Allow again with a confirm). `ScheduledTool` l.570-586. `LogTool` l.587-607 (activity log by person, 30 at a time). `NotifsTool` l.608-642. `Toolbox` l.744-802.

**engine.js** (573 lines): `W.fit` l.39-46 (score 0-100 with reasons: median views 30, posting 15, US/UK/CA/AU share of top 3 25, engagement 15, sponsored before 15); `W.gold` l.48 (median ≥ 40k, median ≥ 40% of subs, 3–20 uploads in 30 days); `W.audience` l.49-~55; `A.shortlist` l.318; `A.reject(ids, reason, opts)` l.326; `A.restore` l.333; `A.never` l.334.

**data.js**: `W.REJECT_REASONS` l.27. **ui.js**: `W.Fit` l.87 (the fit chip). **core.js** l.146 `W.peek`.

**plan.js** (554 lines): parity rows `search` l.55, `qualify` l.56, `contacts` l.57 (each row: text, status, prototype screen). Find feature rows l.160-170 (run in background, yield per keyword, paste many keywords, teammate-run warning, run ends with a link, triage with last 3 videos, keys, fit with reasons, sara-emailed guard, gallery with facets and views, thumbnail flip). WHY notes: `W.WHY` l.309-345; Find keys: `jobs` l.312, `triage` l.324, `fit` l.325, `search` l.335, `gallery` l.336, `compare` l.338, `contacts` l.339.

**test/find_flow.py** (55 lines, a script, not asserts; §9).

## 8. Legacy (reference only)

- `legacy/lib/features/search/` (~9.5k lines Dart): `search_screen.dart`; `active_search_run_controller` (run state, Start, Pause); `search_progress_parser` (log lines); `search_resume_controller` (resume); `auto_clean_controller` and `auto_clean_panel` (archive bands); `generate_keywords_controller` (Gemini keywords, `chats`); `video_catchup_controller` and `backfill_run_controller` (the video backlog); `reenrich_run_controller` (refetch); `remote_search_intake_controller` (teammates, step T). Port: the progress parser's rules and the resume point.
- `legacy/lib/features/influencers/` (~9.3k lines): `influencer_list_screen`, `influencer_profile_screen`, `contact_discovery.dart` (l.1-25: an address noticed in a channel's own text is a suggestion; it never becomes a contact until a person adds it, through the compare-and-set path; `isBusinessInquiry` flag), `archive_countdown_badge`, `archive_pending_card`, `influencer_contacts_card`, `influencer_emails_card`, `pull_more_videos_card`. Port: suggest-then-confirm for contacts.
- `legacy/lib/features/archive/`: `archive_controller.dart` (paged list, `archiveCountProvider`, bulk clean with preview and apply, `BulkCleanController` l.206), `archive_screen.dart`, `bulk_clean_dialog.dart`. Rule from `influencer.dart` l.300-309: the due date is set by a database trigger 7 days after a rejecting tag, and the app only writes it to bring it forward ("archive now").
- **Never-contact:** no legacy feature. `influencer.dart` l.12 says "never contacted" is out of scope (HC-08). The prototype's `never` stage is new; the pipeline has no gate for it.
- `legacy/pipeline/tools/enrich.py` → `services/pipeline/.../jobs/backfill.py` (§4).
- `legacy/pipeline/gratovo/found_emails.py` (128 lines) → `services/pipeline/src/gratovo_pipeline/found_emails.py` (same `find_emails`: `(at)`, `[dot]`, full-width signs; refuses `logo@2x.png`). Used from `legacy/pipeline/gratovo/pipeline.py` l.201 (About text, then descriptions). **No legacy email finder has sources or confidence**; the "sources and confidence" in plan §6 step 5 is new design.
- `legacy/pipeline/gratovo/pipeline.py` (1197 lines) is the old search loop; `store.py` the old schema.

## 9. E2E and tests

- `apps/desktop/e2e/find-search.spec.ts`: one test (l.30-end), example data. Adds 3 keywords and a duplicate; start; pause during keyword 2 (`Resume at keyword N`); resume to the end; restart on the same folder (`relaunch`) and check rows and kept survive. Helpers: `openSearch` l.13-20, `rows`, `kept`, `headline` (l.22-27). Fixture: `e2e/fixtures.ts` `launchApp` l.53-96, `userData` l.126-138 (fresh folder per test), `relaunch`. No Find-specific fixture. The example run uses the Python example source (`services/pipeline/src/gratovo_pipeline/example/channels.json`).
- Main unit tests: `main/find/find-service.test.ts` (45 cases), `find-store.test.ts` (13), `results.test.ts` (7). Renderer: `renderer/find/find-screen.test.tsx` (sections: headline and button, start and pause, error callouts, log, keywords, rules, kept list, loading and example data, break-ui worst case l.477).
- `design/workbench-prototype/test/find_flow.py` (55 lines; Python Playwright script that prints, no asserts): (1) resume a search and read the log; (2) Suggest with Gemini and pick one; (3) gallery facets (Gold mine, US), multi-select with Shift, Compare, save a view; (4) Insights chart drill-in; (5) triage keys `s` then `3`; (6) Contacts "Confirm all 90%+"; (7) 400 px overflow on gallery and search. **Item 7 breaks the Windows-desktop-only rule; drop it when porting.** Port the rest as Playwright specs (one consolidated pass for Find, per plan step 5).

## 10. Gaps for step 5 (what is missing for triage, gallery, record, contacts, archive, never-contact and activity log on live data)

1. **No read path for channels.** Channel metrics, videos, thumbnails, keywords, sponsors and emails are only in `pipeline.db`. The frame and `DataSource` see `channel_state` (synced, edited creators) and `channels.name`. Need a read model (a repository on `pipeline.db`, read-only, like `results.ts`) and a way for the page to get pages of it: `find:state` pushes the whole state, which will not scale to a gallery. Also decide how a `pipeline.db` channel joins its `channel_state` row (same `channel_id`).
2. **No writes for triage, contacts, archive or never.** `DataWrite` (types.ts l.215-239) has only `creator.stage`. Missing: shortlist and reject with a reason (the four reasons; the reason has no column; `channel_tags` is the server's rule, so reject should set a tag, not only a stage), bring back, never contact with a reason, confirm an address (`contacts` primary plus a confirmed flag), and the activity line for each. Each is an outbox change with a `channel_state` target (`intents.ts` l.174-198 pattern).
3. **The 7-day archive does not run.** `archive_due_at` is set by the server trigger only when `channel_tags` gets `irrelevant`, `haramStuff` or `inactive`; the app never writes tags, and `archiveDays` (find.ts l.35-38) is main-only. Also two archives exist: pipeline `channel_archive` (sweep, read by nothing) and `channel_state` rejected (the prototype's Archive). Decide one source and the sweep (the server comment says the app runs it, and nothing does).
4. **No run history, no "Review what it found".** `runs` (pipeline.db) and `kept` per run are not kept or read. Channels have no `run_id`; `channel_keywords.discovered_at` is the only link. Needs a run list (from `runs`) and a filter by run or time window. Teammate runs and the overlap warning stay for step T.
5. **Email finder and keyword ideas have no path to the page.** No background job finds emails; `found_emails` is a regex result stored with the channel, with no source or confidence (the plan asks for both). `action.generate_keywords` exists in main but no IPC channel calls it, and it needs the Gemini bridge running (`gemini:start`, `channels.ts` l.207). Plan the one-prompt-per-fresh-chat and 60 s rules for any real call. Also `refetch` and `backfill` have no caller.
6. **Activity log and never-contact.** `frame.log` is capped at 50 (`activity-log.ts` l.7); Toolbox › Activity log needs paging and a person filter. Never-contact has no field the pipeline's send path reads (`stage: never` maps to pipeline `lost`, `legacy-mapping.ts` l.71-73), so a never channel could still be emailed. Pipeline gates must read it before step 6.
7. **Fit score inputs.** `W.fit` needs engagement, which the pipeline does not have (only `channel_state.manual_engagement_rate`, a manual entry). Decide the engagement source (or drop the term and say so) before the fit reasons are shown.
8. **Record page is a stub** (`app/record-page.tsx` l.12-28). Peek shows `RecordSummary` only. Find's record (tabs, emails, notes, activity) needs building in this step.
9. **Live gate.** `liveWired.find` is `["search"]` (`wired.ts` l.17); each tab added needs its entry, its tests, and the palette/rail checks (`overlays/commands.ts` l.50-60 already reads `isRouteShown`).
10. **Keyboard.** Triage keys (S, R, 1–4, arrows) need `useKeys` on the triage screen with `isTyping` respected (`lib/keys.ts` l.31) and the "letters" pref (`global-keys.ts` l.76-77) honoured.
11. **Test data.** E2E uses the example pipeline (`example/channels.json`). Gallery, triage and archive need example channels with videos, thumbnails and emails, all AI-niche (CLAUDE.md rule).
