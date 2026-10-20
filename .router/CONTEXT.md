# Recon for step 3d-2 (sign-in, sync, team keys)

Written 2026-10-20 on branch feat/3d-2-sync. Read-only recon; no source files changed. Replaces the 3d-1 recon. Paths are repo-relative unless absolute. `L` = legacy schema line, `B` = baseline line (baseline = `legacy/backend/schema.sql` + a 5-line header, so B = L + 5). No secret values were read or printed.

## 0. Headline

- Legacy sync = keyset pull over 21 tables plus a tombstone log, an FIFO outbox of intent (not row ops), server-side compare-and-set via `apply_channel_edit`, and a Realtime broadcast after each upload. Port it, but it is ~9k lines of Dart with many Windows/timeout-specific fixes; port the rules, not the code.
- Auth is plain Supabase email+password. No edge function, no Vault, no `functions/` folder exists anywhere. Team keys (YouTube, R2) live only in the Python pipeline's `data/.env` today, and the legacy Windows build ships them inside the installer. 3d-2's server function is greenfield.
- RLS has **no** role split: `basic` and `full` are identical in the database (`is_full()` is defined and granted but used by no policy). No policy hides money columns. "Sees money" needs new mechanics (column grants or a view), not just a flag.
- `profiles_self_update` lets a user update their own profile row. Any new column for "agency roles" or "sees money" on `profiles` is self-editable unless the migration closes it.
- Supabase CLI is **not installed**; Docker 29.4.3 (linux engine) **is** running. SQL tests run without the CLI.
- `@supabase/supabase-js` is **not** in `pnpm-lock.yaml` (no match). Electron main has no outbound HTTP and no `webRequest` filter.

## 1. Legacy sync engine (`legacy/lib/core/sync/`)

**Tables and cursors.** `mirror_tables.dart`: `mirrorTables` (L54 onward) is 21 pulled tables, in this order: profiles, channel_state (key `channel_id`), edit_conflicts, brands, deals, outreach_threads, outreach_messages, email_templates, writing_rules, follow_up_reminders, activity_log, scratchpads (key `user_id`), remote_search_requests, campaigns, campaign_shortlist, deliverables, channel_rate_history, sequences, sequence_steps, agency_settings, comms_proposals. Every table: cursor `updated_at`, key `id` (except the two above). `aws_gateway_credentials` is deliberately outside the mirror (`B 626-640`).

**Keyset pull** (`mirror_puller.dart`):
- Default page size 500 (L24, L62); floor 25 (`mirror_network.dart:171`). Per-table page size shrinks on failure and is stored in `_sync_meta` as `page_size.<table>` (puller L84-126).
- Query (L606-622): `select(remoteColumns).or(keysetFilter).order(updated_at asc).order(id asc).limit(n)`. Keyset filter built in `mirror_keyset.dart` `buildKeysetFilter` (cursor.gt OR and(cursor.eq, key.gt)). Cursor = last row's `updated_at` string, key = JSON list of key values (`mirror_keyset.dart` `encodeCursorKey`).
- Cursor advances per page, written to `_sync_meta` (`cursor.<table>`, `cursor.key.<table>`) (L439-440). A non-moving cursor stops the table with `pull.stalled` (L422-435).
- Applied with `INSERT OR REPLACE` (L821) inside a transaction. **No check for pending outbox rows.** Safety relies on the tick draining the outbox before pulling (`mirror_engine_io.dart` drain ~L567 before pull ~L606).
- Timeouts: request 45 s (`mirror_network.dart:23`); per-page budget `20 s + 90 ms/row`, ceiling 60 s (L49-52). Attempts: 3 (L152), delays 1 s then 4 s (L146-149). Page retry shrinks page size (L154-170). Minimum page time 10 s (puller L32).
- Pass budget 2 min (`mirror_engine_io.dart:64`); continue-after-budget delay 5 s (L73); defer max 20 min (L80).

**Tombstones** (`mirror_puller.dart` L854-930, `mirror_tables.dart` L756+):
- Pulled **after** all data tables in each pass (`_pullTombstones`, L195). Source table `sync_tombstones`, cursor `deleted_at`, key `(table_name, row_id)`.
- `applyTombstone` = `DELETE FROM <table> WHERE <key> = ?` per table (L756+). Applied in one transaction per page.
- **Resurrection guard:** on first pull the tombstone cursor is seeded to "now" before any data is downloaded (`_seedTombstoneCursor`, puller L352-360). Anything deleted before that is never re-applied.
- **Horizon:** if the tombstone cursor is older than `sync_control.tombstones_purged_before`, all table cursors reset and everything re-pulls (`_resyncIfBehindHorizon`, puller L278-300). Purge is 90 days (`purge_sync_tombstones`, L1001; cron `gratovo-tombstone-purge` `57 3 * * *`).

**Outbox** (`mirror_schema.dart` L428-434; `mirror_outbox.dart`):
- Local table `_outbox(seq INTEGER PK AUTOINCREMENT, kind TEXT, payload TEXT JSON, created_at TEXT)`. No attempt/next-retry columns. Head-stuck state is in `_sync_meta` key `outbox.head.stuck` = `{seq, kind, fails}` (uploader L25).
- Kinds (`mirror_outbox.dart` L21-64): `channel.edit`, `conflict.file`, `conflict.resolve`, `row.upsert`, `row.delete`, `row.upsert_many`, `row.delete_many`, `archive.channels`, `archive.restore` (the last two go to the pipeline, not Supabase).
- Table whitelist `OutboxKind.rowTables` (L70-88, 18 names; `activity_log` is not in it, it has its own `synced` flag). `keyColumn`: `channel_state`→`channel_id`, `scratchpads`→`user_id`, else `id` (L93-98).
- Enqueue API: `enqueueOutbox` (L113), `enqueueRowUpsert/Delete/Many` (L127-180). `updated_at` is **not** sent; the server stamps it (uploader comment ~L400).
- Drain (`mirror_uploader.dart` `drain`, from ~L116): strict FIFO; stops at the first retryable failure ("sending entry 7 after entry 6 failed would apply an edit on a state the server never reached", ~L113-115). Row upserts batched 200 (`_rowBatch`, L441). Activity log: batches of 200 (`kActivityLogBatchSize`, L21), `upsert(onConflict:'id', ignoreDuplicates:true)` (~L556), then `UPDATE activity_log SET synced=1`.
- Error policy: `isFinalUploadRefusal` (L54-68): PostgREST `42501` (RLS), `22xxx`, `23xxx` are **dropped** (recorded, not retried). Schema-behind errors (`isServerSchemaBehind`) are **retried**. Everything else retried.
- Stuck: after `kOutboxStuckPasses = 4` passes on the same head (L18), log warn and show a Settings sentence, but keep retrying. Nothing is skipped.
- Engine retry ladder for a failing pass: 30 s, 2 min, 10 min, 30 min (`mirror_engine_io.dart` L46-51). Catch-up tick 20 s (`sync_providers.dart:154`).

**Compare-and-set (client):** `data/repositories/edit_cas.dart` `decideEdit` (L115-131): `noop` if base==next; `auto` if current==next; `conflict` if current!=base; else `applied`. Canonicalisation (`canonicalEditValue`, L54+): null==''; tags and criteria compared as sets; `contacts` order matters. `kEditableChannelFields` (L27-37): notes, vetting_status, pipeline_stage, channel_tags, relevance_criteria, provided_data, contacts, media_kit, creator_gender. Local apply in `data/repositories/mirror/mirror_influencer_repository.dart` ~L640-700: on `applied` it writes locally and enqueues `channel.edit` with `base` (the value the editor saw).

**Compare-and-set (server):** see §3.

**Conflict UX:** `features/conflicts/presentation/conflicts_screen.dart`, `features/conflicts/application/conflict_controller.dart`. Local conflict row via `_recordConflict`; server conflict via `apply_channel_edit` filing a row. Resolution goes through outbox kind `conflict.resolve` → RPC `resolve_edit_conflict(p_id, p_resolution, p_value)`. Client-side `conflict.file` (uploader ~L336) falls back to updating the open conflict on `23505` (~L360-380). A `conflict` outcome logs "The local value will revert on the next sync down" (uploader ~L320-330).

**Realtime** (`features/…`→`core/presence/live_data_service.dart`):
- Channel `gratovo:live`, `RealtimeChannelConfig(self: false)` (L135-141).
- `postgres_changes` on `public.scratchpads`, all events (L144-149).
- Broadcast event `data`, payload `{ tables: [string,…] }`, sent by `announce(tables)` after a successful upload (L93-96); received at L151-161 → `domainsForTables` (L260+). `kScrapedTables` = channels, videos, channel_keywords, channel_archive, keywords (L251-257).
- Reconnect: `15 s × 2^(n-1)`, n clamped 1..6, so 15 s up to ~8 min (L~170-190). Teardown uses `removeChannel` (L100-115).

**Presence** (`core/presence/presence_service.dart`):
- Channel `gratovo:workspace` (L424). Publish throttled to 1 per second (`_publishInterval`, L287). Track payload (L518-524): `user_id`, `display_name`, `color`, `editing` (target JSON), `searching` (JSON). Reduced by `buildPresenceLists` (L200+). Retry ladder same as live (L472).

**Sign-out and session reset:** `features/auth/application/auth_controller.dart` `signOut`: `syncEngine.forgetSession()` then `client.auth.signOut()`. `forgetSession` (`mirror_engine_io.dart` ~L368) → `wipeData()` (`mirror_database.dart` L194-200): **DELETEs every row of every pulled table** (`kAppPulledTables`, `mirror_schema.dart:530`), deletes synced activity_log rows, and deletes `cursor.*` meta. Unsent outbox and unsynced activity survive. The code comment says "the data stays", which contradicts the DELETEs. Treat the actual behaviour as the spec.

## 2. Legacy auth

- `auth_controller.dart`: `client.auth.signInWithPassword(email: trimmed, password)`. Invalidates `currentProfileProvider` and `teamMembersProvider`. Errors classified (L~120-150): "not confirmed" → `emailNotConfirmed`; "invalid login"/"invalid credentials" → `invalidCredentials`; socket/`failed host lookup` text → `offline`; else `unknown`. Good list of user-facing messages to reuse (in one strings file).
- Session storage: `main.dart:118` `Supabase.initialize(url, anonKey)`, no `authOptions`, no custom storage found. So supabase_flutter's default session persistence (not encrypted by the app). Refresh is automatic (per the controller's doc comment). No "remember me".
- Config: `core/config/supabase_config.dart`: URL and anon key from `String.fromEnvironment('SUPABASE_URL' / 'SUPABASE_ANON_KEY')` (L83-84), with compiled-in team-project fallback constants (L87-88, public anon key, by design). Per-device override in `shared_preferences` (L118-119).
- Profile row: created by trigger. `on_auth_user_created` (`schema.sql` L1026-1029) → `public.handle_new_user()` (L746-758) inserts `profiles(id, display_name, color)`; `role` defaults to `unauthorized` (L89). **A new sign-in reads nothing until someone promotes the role.** The app needs a "waiting for access" state.
- Role gating (SQL): `app_role` enum `('unauthorized','basic','full')` (L81). Helpers: `app_current_role()` L726 (SECURITY DEFINER, reads own profile), `is_full()` L736, `is_authorized()` L740 (basic or full).
- Policies that read role (all via `is_authorized()`, none via `is_full()`): profiles_read L1096; the `<table>_rw` policies for 16 tables (L1119, via a DO loop); activity_log_read L1134; activity_log_append L1138; edit_conflicts_read L1194, _write L1198, _resolve L1202; sync_tombstones_read L1209; sync_control_read L1213.
- Policies with no role check: scratchpads_read L1144 (any authorized), scratchpads_write L1148 (`user_id = auth.uid()`), remote_search_requests_rw L1170 (sender or recipient), aws_gateway_credentials_rw L1179 (own), aws_gateway_credential_history_read/append L1184/1188 (own).
- Money columns (no policy hides any): `deals.brand_price` (L179), `deals.currency` (L374 add column), `brands.budget_currency` (L423), `channel_rate_history.brand_price` (L339). Campaigns deliberately have no budget (L276-278). Brand price is visible to every `basic` user.
- `profiles_self_update` (L1100): `using (id = auth.uid()) with check (id = auth.uid() and role = app_current_role())`. Users can update any column on their own row except changing `role`. New agency-role or sees-money columns on `profiles` would be self-writable unless the migration adds a column-level grant or a trigger.
- Header comment (L30-37) says `basic` hides the Outreach page in the UI only. The DB does not separate basic from full.

## 3. Supabase schema facts (`supabase/migrations/20261020120000_baseline.sql` = `legacy/backend/schema.sql` + header)

- Tombstones: `sync_tombstones(table_name, row_id, deleted_at, PK(table_name,row_id))` L656-665; check constraint lists 16 tables (L667-676); index `(deleted_at, table_name, row_id)`. RLS: read only for authorized; **no** write policy. Writer is `record_sync_tombstone()` (SECURITY DEFINER, L988-998) via AFTER DELETE triggers `trg_tombstone_*` on 16 tables (L1058-1070). **Not** recorded for: profiles, edit_conflicts, scratchpads, remote_search_requests, activity_log, aws_*. Deletes of those never reach other machines.
- Singleton `sync_control(id boolean PK check id, tombstones_purged_before timestamptz default -infinity)` L680-685; seeded L~1313.
- `purge_sync_tombstones(p_keep_days int default 90)` L1001-1017; granted to service_role only.
- `updated_at`: `touch_updated_at()` L761-763, BEFORE UPDATE trigger on 19 tables (L1036-1046). Inserts keep the default `now()`. Note: `now()` is transaction time, so batch inserts share a stamp (cursor tie-break by key, L~690-705 indexes).
- Indexes for the pull: `idx_<table>_sync_cursor (updated_at, id)` for each table (L690-710 region). `channel_state` has `(updated_at, channel_id)`. `campaign_shortlist` uses `(added_at, id)`, `channel_rate_history` uses `(closed_at, id)`. Nothing on `activity_log`, `profiles`(yes, exists), `scratchpads`, `aws`.
- `set_archive_due_at()` L779; trigger L1049 on channel_state.
- RPC `apply_channel_edit(p_channel_id text, p_field text, p_base jsonb, p_new jsonb, p_force boolean default false, p_label text default null) returns text` L838-936. Language plpgsql, SECURITY INVOKER. Field whitelist (9 fields, same as client) else `22023`. Upserts channel_state row first. Outcomes: `noop` (base==new), `auto` (current==new), `conflict` (current!=base and not forced; upserts an OPEN row in `edit_conflicts` on `(channel_id, field, mine_actor_id) where resolved_at is null`), otherwise `applied` (UPDATE + sets `last_edited_by*`, `handle`). Dart sends 5 named params (`p_force` omitted).
- RPC `resolve_edit_conflict(p_id uuid, p_resolution text, p_value jsonb) returns text` L938-986. Resolution must be `mine|theirs|merged` (`22023`). Returns `missing` / `already_resolved`, else re-applies with `p_force=true` and stamps `resolved_at/by/by_name/resolution`.
- `canonical_edit_value(p_field, p_value)` L802 (sorts tags/criteria, trims, null vs '').
- `edit_conflicts` table L529-561 (has `updated_at`, `resolved_at`, `base_value`, `mine_value`, `theirs_value`, `mine_actor_id`, `theirs_actor_name`, `detected_at`). Policies: read/insert/update for authorized, **no delete** (L1194-1202).
- `activity_log` L563-586; append-only: select and insert policies only (L1134-1142). Insert check pins `actor_id = auth.uid()` or null. **Undo cannot delete a line**; it must insert a new line (owner answer, already decided).
- `profiles` L84-96: `id uuid PK → auth.users`, `display_name not null`, `color`, `role public.app_role`, `created_at`, `updated_at`. `remote_search_requests` L603.
- Realtime publication (L1264-1298): the only table kept is `scratchpads`. `channels, keywords, runs, edit_claims, client_merge_status, channel_state, deals, brands, outreach_threads, outreach_messages` are removed if present. `powersync` publication dropped (L1301).
- Grants (L1218-1256): authenticated gets table CRUD on all public tables plus `usage` on sequences; `revoke all on all functions … from public, anon, authenticated`; re-grant EXECUTE on `apply_channel_edit`, `resolve_edit_conflict`, `is_authorized`, `is_full`, `app_current_role`, `canonical_edit_value`, `channel_is_rejected`. `purge_sync_tombstones` to service_role only. anon gets nothing. The `authenticated` role has `lock_timeout = 3s` and `idle_in_transaction_session_timeout = 15s` (L~690-700).
- Extensions: `pg_trgm` in `extensions` schema (L63). pg_cron used for two jobs (L1340s). **No `vault` usage, no edge functions, no `pgsodium` references** in the baseline (grep).
- Other secret-bearing table: `aws_gateway_credentials` (B 631-640) stores `secret_access_key` **as plain text**, plus `aws_gateway_credential_history` (B 645+). Owner-scoped RLS only. The sync must keep it out of the pull, which the mirror already does.
- Baseline vs production: production runs schema.sql (A3 done). Mark the migration applied with `supabase migration repair`, never push (`supabase/README.md`). Every new table in a later migration needs explicit `grant` lines (from 2026-10-30, per the header).
- `supabase/tests/test_30_grants.sql` checks RLS on all public tables and the grants (`supabase/tests/`).

### `legacy/backend/` other files
- `SETUP.md`: setup steps for the old project. Line 77: service_role key in `data/.env` (`SUPABASE_SERVICE_KEY`) for the one-time export. Line 191: the old SQL tests need Docker.
- `migrate_v2.sql`: old-shape migration. Not carried into `supabase/`. Do not run.
- `tests/`: legacy SQL tests (`run.sh`, `00_supabase_stubs.sql`, `test_12/17/19/20/21`). Already ported.
- **No `functions/` folder exists** (neither here nor in `supabase/`). No edge function for keys exists anywhere.

## 4. Where the old app gets the team keys (names only)

- **YouTube key:** `data/.env` → `YOUTUBE_API_KEY`. Read by `legacy/pipeline/gratovo/config.py` (env lookup ~L360) and used in `legacy/pipeline/gratovo/pipeline.py` and `legacy/pipeline/tools/video_stats.py`. The Flutter app does not read it directly.
- **R2 (4 values):** `data/.env` → `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. Read in `legacy/pipeline/gratovo/config.py` (~L363-371), `legacy/pipeline/gratovo/r2.py`, `legacy/pipeline/search.py`. Tests in `legacy/pipeline/tests/test_r2_sync.py`. Pipeline-owned; the app does not talk to R2 in legacy.
- **Other `data/.env` names (for the build exclusion list):** `SUPABASE_SERVICE_KEY`, `AWS_IAM_ACCESS_KEY_ID`, `AWS_IAM_SECRET_ACCESS_KEY`, `WORKER_NAME`, plus `SUPABASE_URL` (the URL is also read by Dart).
- **GitHub:** `GRATOVO_GITHUB_TOKEN` compiled into the app with `--dart-define` (`legacy/lib/core/github/shared_release_token.dart:48-49`), `GRATOVO_GITHUB_CLIENT_ID` (`github_auth.dart:22`).
- **How they reach the app/installer (the thing 3d-2 must not repeat):**
  - `legacy/scripts/build_windows.ps1` ~L199-201: `--dart-define-from-file=data\.env` (every key in `.env` becomes a compile-time define; only names read via `fromEnvironment` end up in the binary).
  - ~L224, ~L236: `GRATOVO_GITHUB_TOKEN` and `GRATOVO_GITHUB_CLIENT_ID` passed as defines.
  - ~L355-381: `data\.env` **copied into the installer's data folder** (`seedDst\.env`). A `neverShipped` list blanks `SUPABASE_SERVICE_KEY`, `AWS_IAM_ACCESS_KEY_ID`, `AWS_IAM_SECRET_ACCESS_KEY`, `WORKER_NAME` only. The 4 R2 values **ship**, and the script warns if they are missing. So the legacy installer carries live R2 keys.
- The owner's rule (`docs/product/owner-rules.md`, Keys): use the existing keys at run time only, in the app's secret store or Supabase function secrets. Never in the repo or the installer. ADR 0003 (`docs/decisions/0003-secrets.md`): R2 via short-lived signed URLs from a server function (recommended); YouTube key in Supabase Vault, returned to members only by a SECURITY DEFINER function.

## 5. New app's current state (`apps/desktop/`, `packages/`)

**Main process (`apps/desktop/src/main/`):**
- `index.ts`: `app.enableSandbox()` (L~35); `registerAppScheme()`; `web-contents-created` → `guardWebContents`; single-instance lock; in `whenReady`: `denyAllPermissions(session.defaultSession)`, `refuseDownloads`, `serveAppFiles(session.defaultSession, rendererRoot)`, then `openExampleSource(join(userData,'example.db'))` (L56) with a comment saying "Until there is an account (3d-2) the app always shows the example data" (L54-55). Then `registerBridge(createHandlers({version, secrets: openSecretStore(), data}))`. `Menu.setApplicationMenu(null)`. `window-all-closed` → quit.
- `handlers.ts` (25 lines): channels `app:ping`, `secrets:status`, `frame:load` (→ `data.frame()`), `data:write` (→ `data.write(writes)`). `HandlerContext = {version, secrets, data}`.
- `ipc-bridge.ts` L18-22: one `ipcMain.handle(bridgeChannel)`; refuses unless `isTrustedSender(event.senderFrame, appPageUrl)`; then `createDispatcher` (from `packages/ipc`).
- `security.ts`: `guardWebContents` (setWindowOpenHandler → deny + maybe open; `will-frame-navigate`, `will-navigate`, `will-redirect` blocked unless `isAppPage`; `will-attach-webview` prevented). `refuseDownloads` (`will-download` prevented). `denyAllPermissions` (request handler callback(false); check handler false).
- `csp.ts`: `default-src 'none'`; `script-src 'self'`; `connect-src 'self'` (dev adds ws://localhost:*); `img-src 'self' data:`; `form-action 'none'`. **The renderer CSP blocks any Supabase call from the page**, so sign-in and sync must run in main.
- `app-protocol.ts`: `registerSchemesAsPrivileged` (`app`, standard, secure, supportFetchAPI). `serveAppFiles` answers GET only, files under `root`, sends CSP + `nosniff` on every response (incl. 404). Reads with `fs.readFile`.
- `external-links.ts` L2-8: allowlist hosts `youtube.com, www.youtube.com, m.youtube.com, youtu.be, mail.google.com` (Gmail thread links only, L10-20). Used by `security.ts` `openOutside`.
- `app-page.ts`: `isAppPage`, `isTrustedSender`, `appScheme`. `window.ts`: `appPageUrl`, `createMainWindow`, `rendererRoot`.
- **No `webRequest` filter, no `net`/`fetch` use, no network allowlist exists.** The "main-process network allowlist" is a new module.
- `strings.ts`: main-process strings (startup failure dialog).

**Secrets:**
- `secrets.ts`: `openSecretStore()` → `createSecretStore(join(userData,'secrets.json'), cipher)` with `cipher` = `safeStorage.isEncryptionAvailable/encryptString/decryptString` (DPAPI on Windows, the signed-in user's key).
- `secret-store.ts`: `Cipher` (L9-13), `SecretStore` (L16-25): `get(name)` (main only), `set(name, value)`, `delete(name)`, `has`, `names`. `maxValueLength = 65536` (L27). `fileSchema` = `z.strictObject` (L29). Refuses when the cipher is unavailable (message at L35). Tests in `secret-store.test.ts` (262 lines).
- `packages/ipc/src/channels.ts`: `secretName` regex (lowercase words joined by `.`/`-`, max 100). `secrets:status` returns `{set: boolean}` only. **No IPC channel returns a secret value.** Session tokens for 3d-2 should follow this (stored by name, never sent to the page).

**Data layer (3d-1):**
- `main/data/index.ts` exports `openExampleSource`, `openLiveSource(path, me, now?)`, `createSqliteSource`.
- `main/data/live-source.ts`: `openLiveSource` opens `openDatabase(path)` and passes `emptyExtras` (presence `away`, counts 0, `mateRun` null) with the comment "No presence, counts or run until the sync and the engines exist (3d-2, step 4)". **Pick the live source from the session here.**
- `main/data/sqlite-source.ts` (142 lines): `createSqliteSource(db, {me, extras, now?})`, `frame()`, `write()`. Writes are a transaction (`all or none`).
- `main/data/example-source.ts` (86 lines): seeds `example.db` from `packages/core/src/data/example.ts`, seed version check.
- `main/data/data-source-contract.ts` (189 lines): shared contract tests (`describeDataSourceContract`), run against both sources.
- `main/data/repositories/`: `profiles.ts`, `activity-log.ts`, `brands.ts`, `creators.ts`, `deals.ts`, `notifications.ts`, `settings.ts`, `meta.ts`, `index.ts`. Tests alongside.
- `main/db/open-database.ts` (31 lines): `node:sqlite` `DatabaseSync`, WAL, busy_timeout 5000, synchronous NORMAL, foreign_keys ON. `main/db/migrate.ts` (55 lines): `PRAGMA user_version`, forward only, refuses newer DB. Migrations `main/db/migrations/0001-initial.ts`, `index.ts`.
- Local tables (`0001-initial.ts`): `profiles` L9-16, `channel_state` L18-40, `brands` L42-62, `deals` L64-96, `activity_log` L98-112, `channels` L115-118 (local only), `notifications` L120-129 (local only), `local_settings` L131-134, `_meta` L136-139. All `STRICT`. No outbox, no cursors yet (ADR 0010 decision 4).
- Note the mirror tables are a **subset** of the 21 legacy pulled tables. 3d-2 needs local tables for edit_conflicts, campaigns, scratchpads, remote_search_requests, etc., or it must restrict the pull to what the new app uses (decide this in the plan).

**Core contract (`packages/core/src/data/`):**
- `types.ts`: `AppRole` L9 (`unauthorized|basic|full`); `creatorStages` L12; `notifyKinds` L30 (`reply, money, handoff, search`; "money" here is a notification kind, not "sees money"); `DataWrite` L159-169 (`notification.read`, `notify.set`, `me.name`, `log.add`, `log.remove`); `DataSource` L171-177 (`frame()`, `write()`, `close()`); `Frame.me` L141.
- `example.ts` L93 `me = "u1"`, L104 owner `{id:"u1", role:"full", title:"Owner"}`.
- Persister: `renderer/lib/persist.ts`: `diffData` (L82), `installPersistence(invoke)` (L185), `persistenceIdle`/`onPersistenceIdle` (L131-139). The file's doc (L182) says a store replaced from the database becomes the new baseline with nothing written: the hook for sync.
- `renderer/lib/store.ts`: `initAppStore(data, start)` at L246.

**IPC (`packages/ipc/src/`):** `channels.ts` (map of `request`/`response` zod schemas; `isChannel`, `parseRequest`); `dispatch.ts`, `bridge.ts`, `data.ts` (`frameSchema`, `dataWriteSchema`), `index.ts`. Names follow `domain:verb`. Adding a channel = a schema here, a handler in `main/handlers.ts`, and a test in `channels.test.ts`.

**Renderer, sign-in and "me" checks:**
- No sign-in UI exists anywhere.
- Settings › Connections: `renderer/lib/settings.ts:42` `{key:"connections", group:"agency", owner:true, arrives: 9}`: a placeholder for step 9 (`arrives` = step number). Profile tab `arrives: null` (L33). Strings at `renderer/strings.ts` L155, L228, L397.
- `me === "u1"` hard-coded as owner in: `renderer/app/rail.tsx` L95, L97, L151, L210-211; `renderer/app/top-bar.tsx` L194; `renderer/settings/sections.tsx` L31 (`mine`). `data-source-contract.ts` L57, L99. These must become "the signed-in member" (and a role check for the rail's owner-only items).
- Rail menu item "Connections" → `go("settings","connections")` at `rail.tsx:194-197`.

**npm deps:**
- Desktop (`apps/desktop/package.json`): electron 44.9.0, electron-vite 6.0.0, vite 8.3.4, react 19.3.1, zod 4.6.7, @gratovo/core|ipc|ui (workspace), @playwright/test 1.64.1, @axe-core/playwright 4.14.0, @electron/fuses 2.1.3.
- Root: vitest 5.0.5, typescript 7.0.2, happy-dom 21.0.3, eslint 10.13.0, prettier 3.9.10, lefthook 2.2.2.
- **`@supabase/supabase-js`: not installed, not in lock.** `undici` 7.30.1 is only transitive (lock L1969). Node 24 global `fetch` is available in main. A fetch helper does not exist.
- Python: `services/pipeline` (uv, ruff, pyright, pytest). `pnpm lint` and `pnpm typecheck` call it.

## 6. Tooling

- **Node:** `~/.local/opt/node-v24.22.0-win-x64` (pnpm present there too). **Supabase CLI: not on PATH and not in `~/.local/bin`** (that folder has only claude, gh, gitleaks, uv). Install options: `npx supabase@<pinned>` (needs Docker, no global install) or a pinned binary. `supabase start` pulls about 10 images (GoTrue, PostgREST, Realtime, Studio…), which is heavy on Windows.
- **Docker:** `docker version` → server 29.4.3, `docker info` reports `OSType: linux` (WSL2 engine, running).
- **SQL runner** `supabase/tests/run.ts` (141 lines, Node TS, no deps): `docker info`; pinned image `postgres:17.11@sha256:…` (L14-15); creates container `gratovo-sqltest-<pid>`; waits on `select 1` (L85-92); `psql -U postgres -d gratovo` via `docker exec -i`; applies `00_supabase_stubs.sql`, the baseline twice, then later migrations in name order, then each `test_*.sql` (L99-115); checks baseline equals `legacy/backend/schema.sql` body (L44-52); always `docker rm -f` (L120-123). Runs with `node supabase/tests/run.ts` (Node 24 type stripping); `pnpm test:sql`.
- **To add sync tests against a real Supabase-shaped stack:** either (a) extend this runner to run GoTrue + PostgREST + Realtime in containers (a lot of work, and re-implements the CLI), or (b) use the Supabase CLI in a new Linux CI job (`supabase start` + `supabase db reset`, `supabase status -o env` for the local keys written to a temp env, never committed). Option (b) fits the owner's plan ("sync tests against a local Supabase (CLI)") and keeps the Windows-only rule, since it tests the server, not the UI. Pin the CLI version.
- **CI (`.github/workflows/ci.yml`):**
  - `checks` (L28): "Checks (Windows)", `windows-2025`. Install (`pnpm install --frozen-lockfile`, L53), `pnpm lint` (L56), `pnpm typecheck` (L59), `pnpm test` (L62), `pnpm test:e2e` (L65), keep e2e results (L68-76).
  - `sql` (L79): "SQL tests (Linux, Docker)", `ubuntu-24.04`, `node supabase/tests/run.ts` (L93-94).
  - `secrets` (L99): gitleaks v8.30.1 via `go install`, scan every commit (L116-121).
  - `audit` (L127): OSV-Scanner v2.7.0 on lockfiles (L142-146).
  - `codeql` (L154): matrix per language, fail on any finding (L182-185).
- Git hooks: `lefthook.yml` (lint-staged, gitleaks presumably; not read).
- `.gitignore`: `.env`, `.env.*`, `*.local.json`, `*.db`, `*.db-wal`, `*.db-shm`, `*.log`, keys/pem. `secrets.json` in the user data folder is outside the repo.

## 7. Risks and unknowns (ordered by impact)

1. **Team keys must not repeat the legacy leak.** The legacy build copies R2 values into the installer and compiles the GitHub token in. The 3d-2 function must return R2 access as **short-lived signed URLs** (ADR 0003) and YouTube only per call. Decide the Vault vs `function secrets` home for YouTube. Keys are at run time only (owner rule). Confirm the secret-scan job covers the new function code.
2. **Self-editable roles and money.** `profiles_self_update` lets a user change any column on their own profile. New "roles list" and "sees money" columns need column-level grants (`revoke update (col) … from authenticated`) or a separate table that only service_role writes. RLS cannot hide a column; `brand_price` and `budget_currency` are readable by every authorized user today. A "sees money" switch that does not restrict the data would be a false promise. Needs an owner decision on whether money is hidden from the UI only, as the header comment already says for Outreach.
3. **`basic` vs `full` is not enforced by the database.** If the owner expects `basic` to be unable to see money or outreach, that requires policies that call `is_full()`. Nothing does that today.
4. **Deletes that never sync:** edit_conflicts, scratchpads, remote_search_requests, profiles, and activity_log have no tombstone trigger. Deleting one locally leaves the server copy. A port that deletes locally would resurrect rows on the next pull. Decide per table.
5. **Pull can overwrite unsent local work.** The legacy pull uses `INSERT OR REPLACE` with no outbox check. The port must either guarantee drain-before-pull in the same tick or skip rows with a pending outbox entry.
6. **Undo and activity_log.** Append-only in the DB (no UPDATE/DELETE policy). Undo = insert a new line (owner answer, decided). The uploader's `upsert(ignoreDuplicates)` on `activity_log` needs the insert policy, and that policy requires `actor_id = auth.uid()`; a sync of other people's lines is fine (read-only), but the local `synced` flag and the `DELETE … WHERE synced = 1` cleanup must be kept.
7. **Cursor precision.** Cursors are text from JSON. A keyset compare on `updated_at` through PostgREST string filters may lose microseconds. Test with same-transaction batch stamps (`now()` ties) and with a page boundary inside a tie.
8. **Sign-out wipes.** `wipeData()` deletes all pulled rows. A port should decide whether sign-out clears the team's rows (privacy, yes) and keep unsent outbox rows (safe). Document it.
9. **Session storage.** Legacy kept the session in the SDK default (unencrypted). The new one must keep the refresh token in `safeStorage` via a custom storage adapter in main, never in the renderer or the file system in clear. `safeStorage` is unavailable before `app.whenReady` and on some systems returns false; the secret store already refuses in that case (surface a clear error).
10. **CSP vs network.** Any Supabase call from the page is blocked. Everything (auth, REST, Realtime websocket, the team-key function) must run in main. Realtime's websocket also belongs in main, which means presence and "tables changed" events cross IPC to the page.
11. **Network allowlist scope.** The app has no network allowlist yet. Define it as the Supabase project host(s) plus the function URL only. A user-entered server address (legacy allowed one in Settings) would need to be allowlisted or removed.
12. **`profiles` row for a new sign-up is `unauthorized`.** The app must show a waiting state, not an empty team. Also the trigger creates the row on `auth.users` insert, so the app must not insert a profile itself.
13. **Realtime quota.** Legacy learned the hard way: a presence burst hits `client_rate_limit_exceeded` (presence_service.dart L273-285). Keep the 1 s throttle. Every subscription must be `removeChannel`'d on teardown.
14. **Old app keeps working.** Production runs the legacy schema, so additive columns must not change any column the old app reads or writes (ADR 0010 decision 4: keep both the legacy and app fields). Check the old app's `apply_channel_edit` whitelist is not touched.
15. **`aws_gateway_credentials` stores secret keys as plain text** in Postgres (B 631-640). Out of scope for 3d-2, but it is the same class of risk; flag for the owner.
16. **`supabase migration repair` for the baseline** must run once against production (owner go required, per the plan). Not part of recon.
17. **Windows traps:** DPAPI tied to the Windows user (a second Windows account cannot read secrets; intended). Path length and `\\` in the `.env` copy paths. The legacy build script's `data\.env` path is Windows-only. Docker Desktop must be running for `pnpm test:sql` locally. Long `supabase start` on Windows (WSL2 memory) may need the owner's Docker settings.
18. **Unknown:** the owner's answer on whether the team-key function is a Supabase Edge Function (Deno, needs the CLI deploy) or a SECURITY DEFINER RPC plus a Vault secret (no function code at all for YouTube). ADR 0003 leaves both open. Also unknown: whether production Postgres is 17.6 (owner says so; not verified here).
19. **Unknown:** presence and Realtime for `apply_channel_edit`-driven changes. The legacy announces after upload; with no Realtime on channel_state, a teammate's edit reaches others only on their next pull (20 s catch-up). Confirm this is acceptable.
