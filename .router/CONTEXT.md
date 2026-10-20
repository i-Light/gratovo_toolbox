# Recon for step 3d-2b (the sync engine)

Written 2026-10-20 on branch `feat/3d-2-sync`, after 3d-2a (#11, merged; R1 done). Read-only; no source changed. Replaces the 3d-2 recon. Paths are repo-relative unless absolute. `L` = legacy Dart line, `B` = baseline SQL line (`supabase/migrations/20261020120000_baseline.sql`). Legacy refs come from the 3d-2 recon; the ones marked (checked) were re-read on 2026-10-20. No `.env*` or `*.local.json` file was opened; no key value was read.

## 0. Headline

- Legacy sync = keyset pull over 21 tables plus a tombstone log, a strict FIFO outbox of **intent** (`channel.edit` RPC calls and row writes), server-side compare-and-set through `apply_channel_edit`, and a Realtime broadcast after each upload. Port the rules, not the Dart.
- The new app has no sync yet. 3d-2a built the transport (`Network`, auth client, `Session`, `Rest`), `Account`, a team refresh (profiles and member_access only) and the `me.name` PATCH. The page keeps no outbox, no cursors, no presence.
- **Biggest blocker:** `frameSchema` caps every list at 5000 (`packages/ipc/src/data.ts` L32). `readFrame` returns *all* `channel_state` rows as creators, with no LIMIT, and the dispatcher validates the response. Production's ~15.6k `channel_state` rows (brief figure, unverified; see §9) would make `frame:load` fail as soon as the pull lands.
- Realtime: `channel_state`, `deals`, `brands`, `activity_log` are **not** in the `supabase_realtime` publication (baseline L1262-1300 keeps only `scratchpads`). A teammate's edit reaches others by pull (20 s catch-up), not by push. Local config has Realtime off.
- No Phoenix or Realtime client is installed. `ws@8.22.0` is in the lock only as a dev dependency (happy-dom, vitest). Node 24.22.0 has a global `WebSocket` (checked: `typeof WebSocket === "function"`); the lint rule forbids it in main except `net/network.ts`.

## 1. Legacy sync engine (`legacy/lib/core/sync/`)

**Tables and cursors** (`mirror_tables.dart`, 21 tables, in order):
profiles (cursor `updated_at`, key `id`), channel_state (`updated_at`, key `channel_id`), edit_conflicts, brands, deals, outreach_threads, outreach_messages, email_templates, writing_rules, follow_up_reminders, activity_log (**cursor `at`**, key `id`; append-only, no `updated_at` on the server, L397-399), scratchpads (`updated_at`, key `user_id`), remote_search_requests, campaigns, campaign_shortlist (**`added_at`**, L499-501), deliverables, channel_rate_history (**`closed_at`**, L567-569), sequences, sequence_steps, agency_settings, comms_proposals. Plus `sync_tombstones` (cursor `deleted_at`, key `(table_name,row_id)`). `aws_gateway_credentials` is outside the mirror on purpose.

**Keyset pull** (`mirror_puller.dart`, `mirror_keyset.dart`):
- Page size 500 (L24); floor 25 (`mirror_network.dart` ~L171); shrinks on failure, stored per table in `_sync_meta` (`page_size.<table>`).
- Query: `select(cols).or(keysetFilter).order(cursor asc).order(key asc).limit(n)` (~L606-622). Filter = `cursor.gt.X OR (cursor.eq.X AND key.gt.Y)`. Cursor text = last row's cursor string verbatim; key = JSON list (`encodeCursorKey`).
- Cursor stored as `cursor.<table>` and `cursor.key.<table>` in `_sync_meta` after each page (~L439). A non-moving cursor stops the table with `pull.stalled` (~L422-435).
- Apply = `INSERT OR REPLACE INTO <table>` (L821, checked) inside one transaction. **No check for pending outbox rows.** Safety relies on drain-before-pull in the same tick (`mirror_engine_io.dart` ~L567 drain, ~L606 pull).
- Timeouts: request 45 s (`mirror_network.dart` L23, checked); per-page budget 20 s + 90 ms/row, ceiling 60 s; minimum page time 10 s (puller L32, checked). Attempts 3, back-off 1 s then 4 s (L147-148). Pass budget 2 min (`mirror_engine_io.dart` L64); defer max 20 min.

**Tombstones** (`mirror_puller.dart` ~L854-930; `mirror_tables.dart` ~L756+):
- Pulled after all data tables each pass (`_pullTombstones`, ~L195). `applyTombstone` = `DELETE FROM <table> WHERE <key> = ?`, one transaction per page.
- **Resurrection guard:** on the first pull the tombstone cursor is seeded to "now" before any data downloads (`_seedTombstoneCursor`, ~L352-360). Deletions older than the seed are never replayed.
- **Horizon:** if the tombstone cursor is older than `sync_control.tombstones_purged_before`, every table cursor resets and everything re-pulls (`_resyncIfBehindHorizon`, ~L278-300). Purge keeps 90 days (cron `gratovo-tombstone-purge`, `57 3 * * *`).

**Outbox** (`mirror_schema.dart` ~L428-434; `mirror_outbox.dart`; `mirror_uploader.dart`):
- Local `_outbox(seq INTEGER PK AUTOINCREMENT, kind TEXT, payload TEXT /*JSON*/, created_at TEXT)`. **No attempt, next-retry or base columns.** Stuck state in `_sync_meta` `outbox.head.stuck` = `{seq, kind, fails}`.
- Kinds (`mirror_outbox.dart` L21-64): `channel.edit`, `conflict.file`, `conflict.resolve`, `row.upsert`, `row.delete`, `row.upsert_many`, `row.delete_many`, plus `archive.channels` and `archive.restore` (pipeline-side, not Supabase).
- Table whitelist `OutboxKind.rowTables` (L70-88, 18 names; `activity_log` is not in it: it has its own `synced` flag). Key column: `channel_state`→`channel_id`, `scratchpads`→`user_id`, else `id` (L93-98).
- Enqueue: `enqueueOutbox` (L113), `enqueueRowUpsert/Delete/Many` (L127-180). `updated_at` is **not** sent; the server stamps it.
- Drain: strict FIFO; stops at the first retryable failure ("sending entry 7 after entry 6 failed would apply an edit on a state the server never reached", `mirror_uploader.dart` ~L113-115). Row upserts batched 200 (`_rowBatch`, ~L441). Activity log: batches of 200 (`kActivityLogBatchSize`, uploader L21, checked), `upsert(onConflict:'id', ignoreDuplicates:true)` (~L556), then `UPDATE activity_log SET synced=1`.
- **Refusal (drop) rule** (`isFinalUploadRefusal`, uploader L54-68, checked): PostgREST `42501` (RLS) and any `22xxx` (incl. our own 22023) or `23xxx` are **dropped** (recorded, not retried). `isServerSchemaBehind` (missing function, column or table) is **retried** (uploader L49-53 comment: a forgotten migration must not lose edits). Everything else is retried.
- Stuck: after `kOutboxStuckPasses = 4` passes on the same head (uploader L18, checked) → warn and show a Settings sentence; nothing is skipped.
- Retry ladder for a failing pass: 30 s, 2 min, 10 min, 30 min. Catch-up tick 20 s (`sync_providers.dart` L154, checked).

**Compare-and-set, client** (`data/repositories/edit_cas.dart`): `decideEdit` (L115-131): `noop` if base==next; `auto` if current==next; `conflict` if current!=base; else `applied` (write locally, enqueue `channel.edit` with `base`). `canonicalEditValue` (L54+): null==''; tags and criteria as sets; `contacts` order matters. `kEditableChannelFields` (L27-37): notes, vetting_status, pipeline_stage, channel_tags, relevance_criteria, provided_data, contacts, media_kit, creator_gender.

**Conflicts UX:** `features/conflicts/…`. A `conflict` outcome logs "The local value will revert on the next sync down" (uploader ~L320-330). Resolution → outbox `conflict.resolve` → `resolve_edit_conflict`. Client `conflict.file` falls back to updating the open conflict on `23505` (~L360-380).

**Realtime** (`core/presence/live_data_service.dart`, checked L136):
- Channel `gratovo:live`, `RealtimeChannelConfig(self: false)` (L135-141). `postgres_changes` on `public.scratchpads`, all events (L144-149; the only table in the publication).
- Broadcast event `data`, payload `{ tables: [string] }`, sent by `announce(tables)` after a successful upload (L93-96). Received at L151-161 → `domainsForTables`. `kScrapedTables` = channels, videos, channel_keywords, channel_archive, keywords (L251-257).
- Reconnect `15 s × 2^(n-1)`, n clamped 1..6. Teardown via `removeChannel` (L100-115).

**Presence** (`core/presence/presence_service.dart`): channel `gratovo:workspace` (L424, checked). Publish throttled to 1/s (`_publishInterval`, L287, checked). Track payload (L518-524): `user_id`, `display_name`, `color`, `editing` (JSON), `searching` (JSON). `client_rate_limit_exceeded` happened in practice (L273-285).

**What triggers a pull:** the engine tick (drain, then pull); the 20 s catch-up tick; a `gratovo:live` broadcast (`announce` on the sender side); sign-in (`mirror_engine_io.dart` start); a manual "sync now".

**Sign-out** (`features/auth/application/auth_controller.dart` `signOut` → `forgetSession()` → `wipeData()`, `mirror_database.dart` L194-200): DELETEs every row of `kAppPulledTables` (`mirror_schema.dart` ~L530), deletes synced activity_log rows and `cursor.*` meta. Unsent outbox and unsynced activity survive. The code comment says "the data stays", which contradicts the DELETEs; the DELETEs are the behaviour.

## 2. Legacy auth

- `auth_controller.dart`: `signInWithPassword(email, password)`; errors classified (~L120-150) into "not confirmed", "invalid credentials", offline (socket / `failed host lookup`), unknown. Its user-facing strings are the list to reuse.
- Session: supabase_flutter default persistence, unencrypted. Refresh automatic. No "remember me".
- Config: `core/config/supabase_config.dart` L83-88: `String.fromEnvironment` URL and anon key with a compiled-in fallback (public anon key, by design); per-device override in `shared_preferences` L118-119.
- Profile row created by trigger `on_auth_user_created` → `handle_new_user()` (B751-758, `security definer`); `role` defaults to `unauthorized`. A new sign-in reads nothing until promoted.
- Roles in SQL: enum `app_role` (`unauthorized|basic|full`); `app_current_role()` B731 (definer), `is_full()` B741 (defined, **used by no policy**), `is_authorized()` B745 (basic or full).
- RLS has no basic/full split: every `is_authorized()` policy treats both alike. No policy hides money: `deals.brand_price`, `deals.currency`, `brands.budget_currency`, `channel_rate_history.brand_price` are readable by every authorized member. Campaigns have no budget (baseline L276-278).

## 3. Supabase schema facts (`supabase/migrations/20261020120000_baseline.sql`; production = this file, marked applied in R1)

**Columns of the sync tables** (server types; `B` = create line):
- `profiles` (B89): `id uuid pk → auth.users on delete cascade`, `display_name text not null`, `color text default '#3B82F6'`, `role public.app_role not null default 'unauthorized'`, `created_at timestamptz default now()`, `updated_at timestamptz default now()`.
- `channel_state` (B117): `channel_id text pk`, `handle text not null`, `vetting_status` (newlyFound|shortlisted|rejected), `relevance_criteria jsonb`, `notes text`, `pipeline_stage` (new|contacted|interested|roster|negotiating|contract|awaitingDelivery|paid|lost), `channel_tags text[]` (closed vocabulary check), `contacts jsonb default '[]'`, `provided_data jsonb`, `archive_due_at timestamptz`, `last_deal_at timestamptz`, `last_edited_by uuid → profiles`, `last_edited_by_name text`, `updated_at`. Added later by ALTER (B392-426): `owner_id uuid`, `manual_engagement_rate numeric`, `manual_engagement_note text`, `manual_engagement_updated_at timestamptz`, `media_kit jsonb`, `creator_gender` (male|female|couple|unknown). **No `creator_stage` yet** (3d-2b additive).
- `brands` (B162): `id uuid pk default gen_random_uuid()`, `name`, `contact_name`, `contact_email`, `contact_phone`, `website`, `budget numeric`, `campaign_brief`, `preferred_criteria jsonb`, `notes`, `created_at`, `updated_at`; ALTER: `category`, `country`, `contacts`, `budget_currency`, `source`. **No `sells`, no `status` yet.**
- `deals` (B177): `id uuid`, `brand_id uuid not null → brands on delete cascade`, `channel_id text not null`, `stage` (proposed|negotiating|agreed|contractSent|signed|live|closed|lost), `brand_price numeric default 0`, `influencer_payout numeric default 0`, `deliverables`, `deadline timestamptz`, `contract_url`, `notes`, `working_days_estimate int`, `created_at`, `updated_at`; ALTER: `campaign_id`, `owner_id`, `currency`, invoice/payout timestamps, `payment_method`, `payment_reference`, and more (B377-426). **No `flow_step` yet.**
- `activity_log` (B568): `id uuid pk default gen_random_uuid()`, `at timestamptz default now()`, `actor_id uuid → profiles on delete set null`, `actor_name text not null`, `actor_role text not null`, `action text not null`, `entity_type text not null`, `entity_id text`, `entity_label text`, `field text`, `old_value text`, `new_value text`, `detail jsonb`. Indexes on `(at desc, id desc)`, actor, entity, trigram name/label.
- `edit_conflicts` (B534): `id uuid pk default gen_random_uuid()`, `channel_id text not null`, `channel_label text not null`, `field text not null`, `base_value jsonb`, `mine_value jsonb`, `theirs_value jsonb`, `mine_actor_id uuid → profiles on delete set null`, `mine_actor_name text not null`, `theirs_actor_name text`, `detected_at timestamptz`, `resolved_at timestamptz`, `resolved_by uuid`, `resolved_by_name text`, `resolution` (mine|theirs|merged), `updated_at`. Unique partial index `(channel_id, field, mine_actor_id) where resolved_at is null`.
- `sync_tombstones` (B661): `table_name text` (check: the 16 tables in §3 triggers), `row_id text`, `deleted_at timestamptz default now()`, `pk (table_name,row_id)`; index `(deleted_at, table_name, row_id)`.
- `sync_control` (B685): `id boolean pk default true check (id)`, `tombstones_purged_before timestamptz not null default '-infinity'`. Singleton; seeded by the baseline.
- `member_access` (3d-2a, `20261021090000_member_access.sql`): `profile_id uuid pk → profiles`, `roles text[]` (check subset of owner, scout, outreach, deal_lead, delivery), `sees_money boolean`, `updated_at`, `updated_by uuid`.

**Functions (exact signatures):**
- `public.canonical_edit_value(p_field text, p_value jsonb) returns jsonb` (B807) immutable, invoker.
- `public.apply_channel_edit(p_channel_id text, p_field text, p_base jsonb, p_new jsonb, p_force boolean default false, p_label text default null) returns text` (B843) plpgsql, invoker. Field whitelist = the 9 editable fields, else `22023`. Upserts the `channel_state` row first (handle = label or id). Returns, in order: `'noop'` (base == new), `'auto'` (current == new), `'conflict'` (current != base and not forced: upserts the OPEN `edit_conflicts` row on the unique index, returns; no channel write), else `'applied'` (UPDATE, sets `last_edited_by`, `last_edited_by_name`, `handle`). Dart sends the five named params (no `p_force`).
- `public.resolve_edit_conflict(p_id uuid, p_resolution text, p_value jsonb) returns text` (B943) plpgsql, invoker. Resolution must be `mine|theirs|merged` (`22023`). Returns `'missing'` or `'already_resolved'`; otherwise re-applies with `apply_channel_edit(..., null, p_value, true, channel_label)` and stamps `resolved_at/resolved_by/resolved_by_name/resolution`, returning the outcome.
- `public.record_sync_tombstone() returns trigger` (B993) `security definer`, `search_path=public`: `insert … on conflict do update set deleted_at = now()`.
- `public.purge_sync_tombstones(p_keep_days integer default 90) returns integer` (B1006) `security definer`; deletes older tombstones, raises `tombstones_purged_before` (greatest). Granted to `service_role` only.
- `public.is_authorized() returns boolean` (B745); `public.app_current_role()` (B731).
- `touch_updated_at()` (B766) BEFORE UPDATE trigger on 19 tables. `now()` is transaction time: batch inserts share one stamp (the key is the tie-break).

**Triggers:** `trg_tombstone_<t>` AFTER DELETE → `record_sync_tombstone()` on **16** tables: channel_state, deals, brands, outreach_threads, outreach_messages, email_templates, follow_up_reminders, writing_rules, campaigns, campaign_shortlist, deliverables, channel_rate_history, sequences, sequence_steps, agency_settings, comms_proposals (loop ~B1066-1070). **No tombstone** for profiles, edit_conflicts, scratchpads, remote_search_requests, activity_log, aws_*.

**RLS policies (`to authenticated`; `B` line in brackets):**
- profiles: `profiles_read` select `is_authorized() or id = auth.uid()` [B1100]; `profiles_self_update` update `using (id = auth.uid()) with check (id = auth.uid() and role = app_current_role())` [B1104]. Any column except `role` is self-writable.
- 16 tables `<t>_rw`: `for all` `using is_authorized() with check is_authorized()` (loop ~B1118-1127): channel_state, brands, deals, and the rest. Any authorized member may insert, update and delete.
- activity_log: `activity_log_read` select authorized [B1138]; `activity_log_append` insert `with check is_authorized() and (actor_id = auth.uid() or actor_id is null)` [B1142]. **No update, no delete**: append-only.
- edit_conflicts: `_read` select authorized [B1198]; `_write` insert authorized [B1202]; `_resolve` update authorized [B1206]. **No delete.**
- sync_tombstones: `_read` select authorized [B1213]. **No write policy**; writes only via the definer trigger.
- sync_control: `_read` select authorized [B1217]. No write.
- scratchpads: `scratchpads_read` (authorized), `scratchpads_write` (`user_id = auth.uid()`) [B1148-1153].
- member_access (3d-2a): `member_access_read` select only, no write policy; writes through `public.set_member_access(p_profile_id uuid, p_roles text[], p_sees_money boolean) returns void` (invoker wrapper over `private.set_member_access`, definer, Owner only).

**Grants and role limits:** `authenticated` has table CRUD on all public tables (B1218-1256); `anon` none; functions revoked from public/anon/authenticated and re-granted per name. `alter role authenticated set lock_timeout = '3s'` (B717) and `idle_in_transaction_session_timeout = '15s'` (B718): keep each pull page in one short transaction.

**Realtime publication** (`supabase_realtime`, B1262-1300): only `scratchpads` is kept; channel_state, deals, brands, outreach_* and others are dropped if present. Broadcast is the only push path for them.

**Other:** `pg_cron` jobs `gratovo-tombstone-purge` (57 3 * * *) and `gratovo-archive-sweep`. `pg_trgm` in `extensions`. No edge functions in the baseline; `supabase/functions/r2-access` is 3d-2a. Migrations 3d-2a: `20261021090000_member_access.sql` (128 lines), `20261021090100_team_keys.sql` (31 lines; `team_youtube_key()` over Vault, `private` schema).

**Legacy/ new app reads of the baseline:** the old app writes every column above except the new ones. Additive columns (3d-2b) must not change any column or policy the old app uses (ADR 0010 decision 4).

## 4. Team keys (3d-2a, done; names only)

- YouTube key: Vault secret `team_youtube_key`; `public.team_youtube_key()` (invoker) → `private.team_youtube_key()` (definer), 42501 unless `is_authorized()`. Main: `account/team-keys.ts` `createTeamKeys` (in memory, 1 h, `keyLifetimeMs` L14); not on disk; no IPC channel.
- R2: Edge Function `supabase/functions/r2-access/index.ts`, `verify_jwt = true`, reads `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` from function secrets. Signs 900 s links (`_shared/sigv4.ts`, `_shared/r2-rules.ts`). Deployed to production in R1 (version 1, ACTIVE).
- Legacy shipped these in the installer (`legacy/scripts/build_windows.ps1`); the new build does not.

## 5. The new app as built after 3d-2a

**Main process (`apps/desktop/src/main/`):**
- `index.ts`: `app.enableSandbox()`; `registerAppScheme()`; `web-contents-created` → `guardWebContents`; single-instance lock; `whenReady`: `denyAllPermissions`, `blockForeignRequests(session.defaultSession, devUrl?)`, `refuseDownloads`, `serveAppFiles`; `supabaseConfig()` (reads `import.meta.env.MAIN_VITE_SUPABASE_URL` / `_PUBLISHABLE_KEY` and `process.env`; logs the problem name only); `openSecretStore()`; `createAccount({config, userData, secrets, network: createNetwork({allowedOrigins: [config.origin]}), now: Date.now, reloadWindow})`; `will-quit` → `account.close()`; `await account.start()`; `registerBridge(createHandlers({version, secrets, account}))`; `createMainWindow()`. `reloadWindows()` = `webContents.reload()` on every window (the only main→page signal; **no `webContents.send` exists**).
- `handlers.ts` (`createHandlers` L15): `app:ping`, `secrets:status`, `frame:load` → `openSource().frame()`, `data:write` → `openSource().write(writes)`, `auth:status`, `auth:sign-in` → `account.signIn`, `auth:recheck`, `auth:sign-out`. `openSource()` throws when `account.source()` is null.
- `ipc-bridge.ts`: one `ipcMain.handle("gratovo:invoke")`; refuses unless `isTrustedSender`; `createDispatcher` (packages/ipc) validates request and **response** schemas.
- `account/account.ts` (670 lines): `createAccount(deps: AccountDeps)` L151; `Account` L52 = `{status(), source(), signIn(email,password), recheck(), signOut(), start(), close(), teamKeys}`; `AccountDeps` L68 = `{config, userData, secrets, network, now, reloadWindow, timers?, log?}`; `exampleFile = "example.db"`, `liveFile = "gratovo.db"` (L82-83); `_meta` keys `account.user_id`, `account.access`; `describeError` L98. States: `unconfigured` (no config → example source), `signed-out` (no source), `waiting` (profile role `unauthorized`), `signed-in` (live source). Start with a stored session opens the live copy offline-first, then `checkBehind` in the background; a changed/ended session → `reloadWindow`. Sign-in awaits the team refresh before answering. Sign-out: `session.end()`, close and delete `gratovo.db` (and -wal, -shm), clear keys, reload.
- `account/team-refresh.ts`: `profileColumns` L18 = `id,display_name,color,role,created_at,updated_at`; `toAppRole` L42; `toProfileRow` L46; `refreshTeam(rest, db)` L82 (both tables replaced in one `inTransaction`). Full replace each run; no cursor.
- `account/live-writes.ts`: `withServerWrites(source, {sendName})` L11: `me.name` PATCHes `profiles` first, then writes locally; everything else passes through.
- `account/team-keys.ts`: `createTeamKeys({fetchYoutubeKey, now})` L16; `clear()` bumps an epoch so in-flight answers are dropped.
- `supabase/config.ts`: `SupabaseConfig` L7 `{url, origin, publishableKey}`; `ConfigProblem` L13 = `missing|bad-url|secret-key|jwt-key|bad-key`; `readSupabaseConfig({packaged, built, env})` L25; `describeConfigProblem` L54. Test seam (unpackaged only): `GRATOVO_SUPABASE_URL`, `GRATOVO_SUPABASE_PUBLISHABLE_KEY`; empty URL = unconfigured.
- `supabase/auth-client.ts`: `AuthErrorKind` L28 = `invalid|unconfirmed|rate-limited|offline|ended|unavailable`; `AuthError(kind, code, status)` L32; `Tokens` L50 `{accessToken, refreshToken, expiresAt (ms), userId, email}`; `AuthClient` L59 = `signIn(email,password)`, `refresh(refreshToken)`, `signOut(accessToken)`; `classify(grant, status, code)` L115; `createAuthClient(network, config, {now?})` L149.
- `supabase/session.ts`: `sessionSecretName = "supabase.session"` L23 (value = `{userId, email, refreshToken}`); `Session` L30 = `{userId, email, accessToken(options?: {rejected?}), end()}`; `SessionManager` L48 = `{restore(), start(tokens), onEnded(fn), onRefreshed(fn), close()}`; `refreshDelay(expiresAt, now)` L82; `createSessionManager({auth, store, now, timers?})` L107. Single-flight refresh 60 s before expiry; back-off 30 s, 2 min, 10 min; ends only on `refresh_token_not_found`, `refresh_token_already_used`, `session_not_found`, `session_expired`, `user_banned`.
- `supabase/rest.ts`: `RestError(kind: "offline"|"http", status, code)` L17; `Rest` L35 = `select<T>(table, query)`, `rpc<T>(name, args?)`, `patch(table, filter, body)` (filter required); `createRest(network, config, session: Pick<Session,"accessToken">)` L68. Sends `apikey`, `Bearer` token, `Accept-Profile`/`Content-Profile` public; one refresh and retry on 401 (`accessToken({rejected})`). Table and function names must match `^[a-z_][a-z0-9_]{0,62}$`.
- `net/network.ts`: `NetworkRefusedError` L8; `Network` L15 = `request(url, init?: RequestInit & {timeoutMs?})`; `createNetwork({allowedOrigins, fetch?})` L54 (exact origin match, https only except the test seam's `127.0.0.1`, no user info, `redirect: "error"`, 30 s timeout); `checkWebSocketUrl(url, allowedOrigins): URL` L76 (wss, allowed origin; throws `NetworkRefusedError`). Nothing opens a socket yet.
- `security.ts`: `guardWebContents` L22, `refuseDownloads` L58, `denyAllPermissions` L65, `isAllowedRequest(url, devServerUrl?)` L77 (`app:` = built page; devtools and data allowed; dev server host only), `blockForeignRequests(session, devServerUrl?)` L100 (cancels every other request the page makes).
- `secrets.ts` `openSecretStore()` L16 → `secret-store.ts` `createSecretStore(file, cipher)` L71 (`safeStorage`, `secrets.json` in userData; `get` is main-only; `has`/`set`/`delete`/`names`; refuses when the cipher is unavailable).
- `csp.ts`: page `connect-src 'self'` (dev adds `ws://localhost:*`). All network from main.
- `strings.ts`: main-process strings only (startup failure dialog).

**Data layer (`main/data/`, `main/db/`):**
- `db/open-database.ts`: `node:sqlite` `DatabaseSync`, WAL, busy_timeout 5000, synchronous NORMAL, foreign_keys ON. `db/migrate.ts`: `PRAGMA user_version`, forward only, refuses a newer file; `db/migrations/index.ts` lists 0001 and 0002.
- Migration 1 (`0001-initial.ts`, all `STRICT`): `profiles` (id, display_name, color, role, created_at, updated_at); `channel_state` (channel_id pk, handle, vetting_status, relevance_criteria, notes, pipeline_stage, channel_tags, contacts, provided_data, archive_due_at, last_deal_at, last_edited_by, last_edited_by_name, updated_at, owner_id, manual_engagement_rate/note/updated_at, media_kit, creator_gender, **creator_stage** = NULL placeholder); `brands` (id, name, contact_name/email/phone, website, budget REAL, campaign_brief, preferred_criteria, notes, created_at, updated_at, category, country, contacts, budget_currency, source, **sells, status** = NULL placeholders); `deals` (id, brand_id, channel_id, stage, brand_price REAL, influencer_payout REAL, deliverables, deadline, contract_url, notes, working_days_estimate, created_at, updated_at, campaign_id, owner_id, currency, invoice/payout timestamps, payment_*, tracking_link, creator/brand contract fields, **flow_step** = NULL placeholder); `activity_log` (id, at TEXT, actor_id, actor_name, actor_role, action, entity_type, entity_id, entity_label, field, old_value, new_value, detail: **no `synced` column**); local-only `channels` (channel_id, name), `notifications` (id, at INTEGER, icon, text, sub, go_screen, go_tab, read), `local_settings` (key, value), `_meta` (key, value).
- Migration 2 (`0002-member-access.ts`): `member_access(profile_id TEXT pk, roles TEXT /*JSON*/, sees_money INTEGER, updated_at TEXT)`.
- `data/index.ts` exports `openExampleSource`, `openLiveSource`, `createSqliteSource`, `FrameExtras`, `SqliteSourceOptions`.
- `data/live-source.ts`: `openLiveSource(path, me, now?)` L16: empty presence (`away`), zero counts, `mateRun` null.
- `data/sqlite-source.ts`: `inTransaction(db, fn)` L46; `createSqliteSource(db, {me, extras, now?})` L68: `frame()` (one read; creators = **all** `channel_state` rows LEFT JOIN `channels`, no LIMIT; brands and deals all rows; `seesMoney` from `member_access`; prices nulled and money notifications dropped when not seen); `write(writes)` in one transaction.
- `data/example-source.ts`: `openExampleSource(path, now)` L41, seeded from `packages/core/src/data/example.ts` with a seed version.
- `data/data-source-contract.ts`: `describeDataSourceContract(name, make)` L47; run against both sources.
- `data/repositories/`: `activity-log.ts` (`addLogEntry` writes `action = text`, `entity_type = 'app'`; `removeLogEntry` is a local DELETE; `newestLog` LIMIT 50), `brands.ts`, `creators.ts` (`upsertCreator` also upserts `channels`), `deals.ts`, `notifications.ts` (`upsertNotification`, `setNotificationRead`, `listNotifications`), `profiles.ts` (`replaceProfiles` L53, `setDisplayName` L85), `member-access.ts` (`replaceMemberAccess` L21, `listMemberAccess` L36), `settings.ts` (`getNotify`, `setNotify`, `getSetting`, `setSetting`), `meta.ts` (`getMeta`, `setMeta`).

**Core contract (`packages/core/src/data/`):**
- `types.ts`: `AppRole` L9; `agencyRoles` L15 (owner, scout, outreach, deal_lead, delivery); `creatorStages` L20; `notifyKinds` L38 (reply, money, handoff, search); `notifyKind(icon)` L63 (wallet/unlock → money, alert → problem); `TeamMember` L83 (no `title`; `roles`); `FrameNotification` L95; `LogEntry` L117; `Creator` L126 `{id, name, handle, stage, email}`; `Brand` L135 `{id, name, sells, status}`; `Deal` L145 `{id, brand, creator, step, price: number|null}`; `Frame` L167 (`me, myName, team, counts, notifications, log, creators, brands, deals, mateRun, notify, seesMoney`); `DataWrite` L189 = `notification.read | notify.set | me.name | log.add | log.remove`; `DataSource` L202 = `{frame(), write(writes), close()}`.
- `access.ts`: `MemberAccess` L11, `noAccess`, `isAgencyRole` L20, `isOwner` L25, `seesMoney` L30, `sortRoles` L35.
- `legacy-mapping.ts`: `creatorStageFrom(row)` L22, `legacyCreatorFields(stage)` L55, `dealStepFrom(row)` L82, `legacyDealStage(step)` L106, `primaryEmail(contactsJson)` L128. These map the app's fields to the old app's (ADR 0010 decision 6).
- `example.ts`: AI-niche fixtures; `me = "u1"` (owner, sees money).

**IPC (`packages/ipc/src/`):** `channels.ts` (`channels` map L20; `secretName` L10; `isChannel`, `parseRequest`). `dispatch.ts` `createDispatcher` L36 (request and response validated; errors go to a reporter). `bridge.ts`: `gratovo:invoke`, global `gratovo`. `data.ts`: `idMax` 100, `textMax` 500, `listMax` 5000 (L32), `logMax` 50 (L34), `frameSchema` L118 (`team`, `notifications`, `creators`, `brands`, `deals` each `.max(listMax)`), `dataWriteSchema` L134, `data:write` takes 1 to 100 writes. `auth.ts`: `authStates` L9, `signInProblems` L13, `authStatusSchema` L40, `signInRequestSchema` L51 (email ≤ 254, password 1..1024), `signInResultSchema` L56. **No main-to-page event channel exists.** Preload `apps/desktop/src/preload/index.ts`: `contextBridge.exposeInMainWorld("gratovo", {invoke})` only.

**Renderer (`apps/desktop/src/renderer/`):**
- Boot: `app/start.tsx` asks `auth:status` (L96); `signed-out` → `app/sign-in.tsx` (`signIn` L52 → `auth:sign-in`); `waiting` → `app/waiting.tsx` ("Check again" → `auth:recheck` L75; sign out); `signed-in` or `unconfigured` → `invoke("frame:load", {})` (L33) → `initAppStore(toAppData(loaded.value), route)` (`lib/store.ts` L246) → `installPersistence(invoke)` (once) → render. A failed load shows `load-failed`.
- Persister `lib/persist.ts`: `diffData` L82 (only the five write kinds; a change in `unsupportedFields` L13 is logged and not written); `installPersistence(invoke)` L185: after each store change diffs by reference against the last-seen data; **a store that is not the current one is taken as the new baseline with nothing written** (the 3d-2b hook; ADR 0010 decision 11); batches in order, one in flight; a failed batch → toast (`strings.saveFailed`) and no retry (L163-164). `persistenceIdle()` L131 and `onPersistenceIdle(listener)` L139.
- Save bar: `app/top-bar.tsx`; strings `renderer/strings.ts` L92-97 ("Saved", "Not saved", "Saving…", tips that already say "synced" and "gone after a restart"). Failure state from `onPersistenceIdle(ok)`.
- Sign-out: `lib/account.ts` `signOut()` waits up to `signOutWaitMs` = 5000 for `persistenceIdle`, then `auth:sign-out`; `useAccount()` for the menu.
- Overlays, rail, settings: role label, owner checks and money hiding as in 3d-2a (`member.roles`, `frame.seesMoney`).

**Write kinds today and how each would reach a server (3d-2b):**

| Write kind | Local effect | Server target (3d-2b) |
|---|---|---|
| `me.name` | `profiles.display_name` | `profiles` PATCH (done in 3d-2a, `live-writes.ts`); becomes an outbox row |
| `log.add` | `activity_log` INSERT: `action = text`, `entity_type = 'app'` | `activity_log` INSERT with actor = `auth.uid()`; the legacy shape (`action`, `entity_type`, `entity_label`, `field`, old/new) must be mapped first, or the old app shows these lines wrongly |
| `log.remove` | local DELETE | **no server delete** (append-only): owner decided undo = a new `activity_log` line; the local row goes too, or is kept as the undone state |
| `notification.read` | `notifications.read` | local only (table is local; no server twin) |
| `notify.set` | `local_settings` `notify` | server per-person switch table (additive, 3d-2b); local copy stays |
| creators (`channel_state`), brands, deals edits | **no write kind**: `diffData` marks them unsupported | `apply_channel_edit` (channel fields), brands/deals writes (new kinds, outbox) |

**Not yet mirrored locally vs. the legacy pull:** edit_conflicts, outreach_threads, outreach_messages, email_templates, writing_rules, follow_up_reminders, scratchpads, remote_search_requests, campaigns, campaign_shortlist, deliverables, channel_rate_history, sequences, sequence_steps, agency_settings, comms_proposals, sync_tombstones; `_outbox`, cursors and the `activity_log` `synced` flag. The new app uses only profiles, member_access, channel_state, brands, deals, activity_log. Decide whether 3d-2b pulls only those (recommended; the rest stays for their steps), accepting that the old app writes the others.

## 6. Local vs. server field mapping (3d-2b additive work)

- Additive server columns (new migration, none exist yet): `channel_state.creator_stage`; `brands.sells`, `brands.status`; `deals.flow_step`; a per-person notification-switch table. Each is written beside the legacy field (ADR 0010 decision 6); `legacy-mapping.ts` already has the functions to fill both.
- Local `money` columns are REAL (`brand_price`, `budget`, `influencer_payout`); server is numeric. Keep as text or integer cents if CAS or equality on money is needed (low risk now; no CAS on money).
- Local TEXT for timestamps and `detail`: server `activity_log.detail` is jsonb; `activity_log.at` is timestamptz.

## 7. Realtime options (no install done)

- Installed: nothing Supabase-specific. `@supabase/supabase-js` and `@supabase/realtime-js` are not in `pnpm-lock.yaml`; `phoenix` is not either. `ws@8.22.0` is in the lock as a transitive **dev** dependency (`pnpm why ws`: happy-dom and vitest only).
- Node 24.22.0 (checked here): `typeof WebSocket === "function"` and `typeof fetch === "function"`; global WebSocket is unflagged. Electron 44.9.0's main process runs Node 24.x (ADR 0010 decision 3), so `WebSocket` should exist in main. Not verified inside Electron.
- Lint: `eslint.config.mjs` L53-110 blocks, in `apps/desktop/src/main/**` except `net/network.ts` and tests: globals `fetch`, `WebSocket`, `XMLHttpRequest`, `EventSource` (L55-61, also via `globalThis`/`global`, L62-71); `import()`/`require()` of http, https, net, tls, undici; `electron.net`; imports of `node:http`, `node:https`, `node:net`, `node:tls`, `node:dgram`, `undici` etc. So a socket must be opened in `net/network.ts` (e.g., `openRealtime(url)` after `checkWebSocketUrl`), or the ignore list grows with a reason.
- Protocol: Supabase Realtime is Phoenix-over-websocket (`wss://<ref>.supabase.co/realtime/v1/websocket?apikey=…&vsn=…`). Hand-rolling the small Phoenix subset (join, push, heartbeat, broadcast, presence) over the global `WebSocket` is about 200 lines; `@supabase/realtime-js` would add a runtime dependency and a transport option (per the plan). The Realtime key goes in the query string: `checkWebSocketUrl` must allow query params and forbid credentials in the URL.
- Server side: the local stack has Realtime **off** (`supabase/config.toml` `[realtime] enabled = false`); CI starts with `-x … realtime …` (ci.yml L128). Realtime tests need both turned on.
- Broadcast needs no table publication, so the legacy `gratovo:live` broadcast works without `channel_state` in the publication. (The REST broadcast endpoint was not checked; do not rely on it without a test.)

## 8. Tests and tooling

**Commands** (`package.json` scripts): `pnpm lint` = eslint, prettier --check, ruff check and format --check; `pnpm typecheck` = `tsc -b` and pyright; `pnpm test` = `vitest run` and pytest; `pnpm test:sql` = `node supabase/tests/run.ts`; `pnpm test:server` = `vitest run --config vitest.server.config.ts`; `pnpm test:e2e` = `pnpm --filter @gratovo/desktop test:e2e` (`install-electron && electron-vite build && playwright test`).

**SQL runner** `supabase/tests/run.ts`: needs Docker (`docker info`); pinned `postgres:17.11@sha256:…`; container `gratovo-sqltest-<pid>`; applies `00_supabase_stubs.sql`, the baseline twice (must re-run cleanly), then later migrations in name order, then each `test_*.sql` (8 files: test_12_conflicts, test_17_scratchpad, test_19_sync_shape, test_20_remote_search_requests, test_21_decisions_schema, test_30_grants, test_31_member_access, test_32_team_keys); checks the baseline equals `legacy/backend/schema.sql`; always `docker rm -f`. Stubs (`00_supabase_stubs.sql`): roles anon, authenticated, service_role; `auth.users`, `auth.uid()`; minimal `vault` (secrets table, `decrypted_secrets` view, `create_secret`); no `realtime` schema or publication (the baseline skips the publication step when missing).

**Server tests** (`supabase/server-tests/`, 38 tests, one file at a time, `fileParallelism: false`): `setup.test.ts` is Vitest `globalSetup` (reads `SUPABASE_URL` and keys from the environment that `supabase status -o env` provides; creates four made-up users via the Auth admin API: owner, member, waiting, unconfirmed; promotes via service role; passes `inject("fixture")`). `auth.test.ts`, `access.test.ts`, `team-keys.test.ts`, `r2-access.test.ts` (plain `fetch` to `/functions/v1/r2-access`). Tests use the app's `createNetwork`, `createAuthClient`, `createSessionManager` (in-memory store) and `createRest`. Timeouts: test 30 s, hook 60 s. `vitest.server.config.ts`: include `supabase/server-tests/*.test.ts`, exclude setup, globalSetup setup.

**Local stack** (`supabase/config.toml`): `[api]` on (port 54321); `[db]` port 54322, `major_version = 17`, pooler off; `[db.seed]` `./seed.sql` (fake Vault value `yt-test-000`, local only); `[realtime] enabled = false`; `[studio]`, `[local_smtp]`, `[storage]`, `[analytics]` all off; `[auth]` on, `enable_signup = false`, `enable_refresh_token_rotation = true`, `refresh_token_reuse_interval = 10`, `minimum_password_length = 6`, rate limits 1000; `[edge_runtime]` on, deno 2, `[edge_runtime.secrets]` fake R2 values; `[functions.r2-access] verify_jwt = true`. Note `[auth.email] enable_signup = true` sits beside `enable_signup = false` under `[auth]`; check which wins before 3d-2b relies on it.

**CI** (`.github/workflows/ci.yml`): `checks` (L28, Windows, lint, typecheck, unit, e2e with results kept); `sql` (L79, ubuntu-24.04, `node supabase/tests/run.ts`, L93-94); `server` (L103-157, ubuntu-24.04, timeout 20 min, not on schedule; `supabase/setup-cli` pinned by SHA v3.0.1; `supabase start -x studio,mailpit,storage-api,imgproxy,logflare,vector,supavisor,realtime,postgres-meta` (step at L128); keys to `$GITHUB_ENV` L29-; `pnpm test:server` L149; `supabase stop` L152); `secrets` (gitleaks, L159); `audit` (OSV, L187); `codeql` (L214).

**E2E fake** (`apps/desktop/e2e/fake-supabase.ts`, `node:http` on 127.0.0.1, random port; publishable key `sb_publishable_e2e000`): `POST /auth/v1/token` (grant password and refresh; refresh tokens rotate and are single-use), `POST /auth/v1/logout`, `GET /rest/v1/profiles`, `GET /rest/v1/member_access`, `PATCH /rest/v1/profiles`, `POST /rest/v1/rpc/team_youtube_key`; records requests (`requests` with `method`, `path`, `headers`, `body`). Nothing for sync tables, Realtime or `r2-access`; 3d-2b extends it (or adds a second fake). Specs in `apps/desktop/e2e/`: accessibility, access, auth, data, frame, fuses, overlays, security, settings, smoke (50 tests in total per PROGRESS).

**Running one e2e spec:** `export PATH="$HOME/.local/opt/node-v24.22.0-win-x64:$HOME/.local/bin:$PATH"; pnpm --filter @gratovo/desktop exec electron-vite build && pnpm --filter @gratovo/desktop exec playwright test e2e/auth.spec.ts` (the build step is what `test:e2e` runs first). Not run here.

## 9. Sizes and IPC limits

- **Production sizes: not verified in the repo.** The brief gives channel_state ~15.6k rows, sync_tombstones ~38k, activity_log 364. PROGRESS.md R1 step 1 records only: Postgres 17.6, 25 public tables matching the baseline, all with RLS, 3 users, 3 profiles. The old recon has no counts. Re-measure with read-only `select count(*)` (owner's go) before 3d-2b sets any limit.
- IPC: `listMax` = 5000 (`packages/ipc/src/data.ts` L32) applies to team, notifications, creators, brands, deals. `frameSchema` (L118) and the dispatcher response check make an over-limit frame a failed `frame:load`, which the page shows as "The app couldn't load its data." At ~15.6k creators a frame **will** exceed the limit. Options: raise `listMax` (and check the JSON size), page the creators list, or send creators per screen. The ADR 0010 decision 9 limit was set for 3d-1 data.
- `writes` max 100 per `data:write` (ADR 0010 decision 11: batches of 100 are separate transactions).
- `logMax` 50: the frame shows the newest 50 log lines; the local `activity_log` keeps all rows (fine at 364).
- Tombstone table ~38k rows (brief) is a pull cost, not a frame cost; the first pull reads all of it per device.

## 10. Risks and unknowns for 3d-2b (ordered by impact)

1. **Frame cap vs. real creators.** `listMax` 5000 and the single-read `frame()` (`sqlite-source.ts` `readFrame`) fail at production-sized `channel_state`. Decide the frame shape before the first real pull lands; a test with 15k rows through `frameSchema`.
2. **Pull overwrites unsent work** (carry-over 7.5). `INSERT OR REPLACE` with no outbox check; `installPersistence` takes a replaced store as clean. Require drain-before-pull in one tick **and** skip rows with a pending outbox entry; a replaced store must not discard queued writes. Test: an edit in the outbox survives a pull that carries an older copy.
3. **Cursor precision** (carry-over 7.7). Store the raw server text (µs) and compare as timestamps in SQL. The local `at` is written with `toISOString()` (ms) and server rows have µs: string comparison can misorder or skip. Test with same-transaction `now()` ties across a page boundary, and with `activity_log` (cursor `at`) and `campaign_shortlist`/`channel_rate_history` (not in 3d-2b's local set).
4. **Deletes that never sync** (carry-over 7.4). No tombstone on profiles, edit_conflicts, scratchpads, remote_search_requests, activity_log. `log.remove` must become a new server line, not a delete; a local delete of a pulled row resurrects on the next pull.
5. **Resurrection guard and the horizon.** Seed the tombstone cursor before the first data download (legacy `_seedTombstoneCursor`), and handle a cursor older than `tombstones_purged_before` by a full re-pull, without losing the outbox. A 38k-row tombstone pull per device is slow in one main-process transaction; chunk it.
6. **Compare-and-set parity.** The client canonicalisation (`edit_cas.dart` L54+) must equal `canonical_edit_value` (B807). A mismatch gives false conflicts or silent overwrites. Test each field through the RPC in `server-tests`. `apply_channel_edit` takes `p_label` (the handle); the app must pass it.
7. **Retry versus drop.** Port `isFinalUploadRefusal` exactly (42501, 22xxx, 23xxx drop; schema-behind retries). A new app edit that the server rejects with 22023 (a field the server doesn't yet accept) must not be silently dropped; decide and test. Dropped edits are the data-loss path.
8. **Realtime is broadcast-only and off locally.** No `channel_state`/`deals`/`brands` in the publication (B1262-1300): nothing pushes rows; a teammate sees edits within the 20 s catch-up. Owner accepts? (carry-over 7.19). Enabling Realtime in `config.toml` and CI is needed for tests. Presence quota (`client_rate_limit_exceeded`): keep the 1 s throttle and `removeChannel`-equivalent teardown (carry-over 7.13).
9. **Sign-out and unsent work** (carry-over 7.8). G6 deletes `gratovo.db`. 3d-2b must keep unsent outbox rows (separate file or refuse sign-out with pending rows) and key them to the user id, so another account never sends them. Decide and document; the owner's Q4 says sign-out deletes the local copy, and 3d-2b "keeps unsent changes".
10. **Main-process blocking.** `node:sqlite` is synchronous. A large pull transaction blocks IPC and the window's first frame. Use one transaction per page (500 rows), yielding between pages.
11. **Money in REAL.** `brand_price`, `budget`, `influencer_payout` are REAL locally, numeric on the server. No CAS on money yet; matters once deals write back (low).
12. **Activity log shape.** Local `log.add` writes `action = text` and `entity_type = 'app'`, unlike the legacy columns. The old app reads `action`, `entity_type`, `entity_label`; define the mapping before the first upload, and add the local `synced` flag (or an outbox row).
13. **Encryption of `gratovo.db`** (carry-over, owner decision). Contact data (emails, phones in `contacts`) first arrives in 3d-2b; the file is plain SQLite in userData (only the secret store is encrypted). Decide before the first pull.
14. **Old app keeps working** (carry-over 7.14). Additive columns must not change anything the old app reads or writes: the `apply_channel_edit` whitelist, `profiles_self_update`, `activity_log` policies. Re-check after each migration (R1 style).
15. **Refresh-token rotation under sync load.** Single-use refresh tokens with a 10 s reuse window (config.toml). Sync and REST must share the single-flight `accessToken()`; a second refresher ends the session (`refresh_token_already_used`). Test two concurrent pulls.
16. **Activity-log writes by actor.** The insert policy needs `actor_id = auth.uid()`; the sync must never upload another member's line (the local copy of others' lines is read-only). A line with a null actor is allowed by the policy; avoid creating one.
17. **Team refresh overlap.** `refreshTeam` replaces `profiles` and `member_access` wholesale; once the pull owns them, one writer only.
18. **Open owner decisions still unanswered:** Q6 (`aws_gateway_credentials` stores AWS secret keys in plain text; decide with 3e); whether the per-person notification switches belong to 3d-2b (the plan says yes); creators per screen versus one frame (risk 1).
19. **Unverified:** Realtime inside Electron (global WebSocket in main); the REST broadcast endpoint; PostgREST's handling of `or=(…)` keyset filters with timestamps containing µs and `+00:00` (needs a server test); production row counts (§9).

Carried over and closed by 3d-2a: team keys (7.1), secret storage and session (7.9), CSP and network allowlist (7.10, 7.11), waiting state (7.12), migration repair (7.16), team-key function decision (7.18). Still open: 7.2 and 7.3 (money readable in the database until steps 10 and 11, a UI promise only), 7.6 (undo as a new line: decided, not built), 7.15, 7.17 (Windows traps: Docker needed for `test:sql` and `test:server`).

## 11. Commands

Every Bash call starts with: `export PATH="$HOME/.local/opt/node-v24.22.0-win-x64:$HOME/.local/bin:$PATH";`

- Install: `pnpm install` (also sets git hooks).
- `pnpm lint`, `pnpm typecheck`, `pnpm test` (all three must pass before anything is called done).
- `pnpm test:sql` (Docker Desktop must run; runs all 8 files).
- `pnpm test:server` (needs a local stack: `npx supabase@2.119.0 start` with the CI excludes, `npx supabase@2.119.0 status -o env` for the keys; never commit them; see `docs/setup.md`). Vitest only: `pnpm exec vitest run --config vitest.server.config.ts <file>` for one file (files share users, so run them one at a time).
- `pnpm test:e2e` (Windows; builds, then Playwright). One spec: `pnpm --filter @gratovo/desktop exec electron-vite build && pnpm --filter @gratovo/desktop exec playwright test e2e/<spec>.spec.ts`.
- Unit tests for one folder: `pnpm exec vitest run apps/desktop/src/main/<folder>`.
- `pnpm dev`, `pnpm build`, `pnpm format`.
- Never open `apps/desktop/.env.local` or `legacy/data/.env`.
