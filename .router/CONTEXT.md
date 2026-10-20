# CONTEXT: step 3d (data layer) recon

Recon date 2026-10-20. Read-only recon; the only file written is this one. Paths are repo-relative unless absolute. `legacy/` = old Flutter app (reference only, deleted in step 11).

## 0. Status and rules that bind 3d
- Plan step 3 is "in progress"; 3c done; **3d is next** (`docs/migration-plan.md` §5 line 54; §3d lines 111-120).
- 3d acceptance (plan line 120): repository tests on a temp DB; sync tests against a local Supabase (CLI); the old app still works against the same Supabase project after migrations run.
- Open question Q11 (plan line 283): team keys (YouTube, R2) served after sign-in by a **server function**. Never in installer or repo. No such function exists anywhere in `legacy/` or the new repo.
- Ground rules: additive-only Supabase migrations until cutover (ADR 0006; architecture.md "Local-first data"); forward-only SQL migrations; Windows only (CLAUDE.md) so no Linux effort; no `.env*` reads; example data must be AI-niche.
- Prototype-mode: off by default, no trace when off (ADR 0004). `comments` table lives in the local DB (plan line 143), so 3d owns a local table that is not synced.

## 1. Old sync design (`legacy/lib/core/sync/`)
Source of truth for the design: `legacy/PROJECT_STRUCTURE.md` §1 (line 14-30), §9 (line 255-281). Both DBs: app reads/writes local SQLite (WAL, busy timeout; `mirror_schema.dart:10`). App never talks to R2; pipeline never talks to Supabase.

**Mirrored tables** (`mirror_tables.dart`, list at lines 55-640). Pull order = list order. Each row: name, cursor column, key(s), remote columns, local columns, `toLocal` mapping.
| table | cursor | key | line |
|---|---|---|---|
| profiles | updated_at | id | 56 |
| channel_state | updated_at | channel_id (text, YouTube handle/id) | 78 |
| edit_conflicts | updated_at | id | 130 |
| brands | updated_at | id | 172 |
| deals | updated_at | id | 217 |
| outreach_threads | updated_at | id | 289 |
| outreach_messages | updated_at | id | 317 |
| email_templates | updated_at | id | 352 |
| writing_rules | updated_at | id | 360 |
| follow_up_reminders | updated_at | id | 368 |
| activity_log | **at** | id | 398 |
| scratchpads | updated_at | user_id | 435 |
| remote_search_requests | updated_at | id | 443 |
| campaigns | updated_at | id | 469 |
| campaign_shortlist | **added_at** | id | 500 |
| deliverables | updated_at | id | 522 |
| channel_rate_history | **closed_at** | id | 568 |
| sequences | updated_at | id | 592 |
| sequence_steps | updated_at | id | 600 |
| agency_settings | updated_at | id | 623 |
| comms_proposals | updated_at | id | 631 |
Plus the tombstone pseudo-table `sync_tombstones` (`mirror_puller.dart:842, 923-928`): cursor `deleted_at`, key `(table_name, row_id)`, remote cols `table_name,row_id,deleted_at`.
Not mirrored: scraped tables (live in R2), `aws_gateway_credentials` (per-user, not in the mirror list), `sync_control`/`_meta` (read by RPC-ish select only, `mirror_puller.dart:289,738`).

**Pull** (`mirror_puller.dart`):
- Keyset paging on `(cursor, key)` (`mirror_keyset.dart`; `mirror_puller.dart:800-804` explains why: one transaction stamps many rows with same `updated_at`). Query built in `_pageQuery` (607-621): `select(remoteColumns)`, filter `cursor > c` or keyset tie, `order by`, `limit`.
- Cursor is written page by page (`mirror_puller.dart:406-413`), so a failed pass banks landed pages and resumes. Stop when a page is shorter than what was **requested** (447-449; a shrunk table asks less).
- Page size: default 500 (`mirror_puller.dart:24`), min 25 (`mirror_network.dart:171`). Per-table shrink on failure 500→125→31→25 persisted in `_sync_meta` key `page_size.<table>`; grows ×4 back on success (`mirror_puller.dart:84-130`).
- Timeouts: 45 s flat (`mirror_network.dart:23`), or per-rows `20 s + 90 ms/row`, ceiling 60 s (`mirror_network.dart:49-52`). Retries: 3 attempts, backoff 1 s then 4 s (`:147-152`). Probe-reserve 50 s before retry (`:185`). Min upload budget 8 s (`:192`). Min page time 10 s (`mirror_puller.dart:32`).
- Tombstones: pulled after data (`mirror_puller.dart:195`). Tombstone rows purged server-side after 90 days (`schema.sql:1001-1014`, pg_cron 03:57 UTC `schema.sql:1364`). Client keeps `sync_control.tombstones_purged_before`; if local cursor predates it, a full re-sync is needed (`mirror_puller.dart:271-300`). First backfill seeds the tombstone cursor to "now", not to the newest tombstone (`mirror_puller.dart:330-361`; reason: a re-added channel must not be deleted by an old tombstone).
- Deleted rows reach the client only as tombstones; the local delete runs per tombstone (`mirror_tables.dart` header line 1-3).

**Outbox** (`mirror_outbox.dart`, table `_outbox`):
- Row = `seq` (monotonic, the send order), `kind`, `payload` (JSON string). Written in the same transaction as the local change (ADR 0006; `PROJECT_STRUCTURE.md` §9).
- Kinds (`mirror_outbox.dart:27-64`): `channel.edit` (CAS on one `channel_state` field), `conflict.file`, `conflict.resolve`, `row.upsert`, `row.delete`, `row.upsert_many`, `row.delete_many` (LWW by `updated_at`, no CAS), `archive.channels` and `archive.restore` (go through the pipeline to R2).
- Drain (`mirror_uploader.dart:116-180`): one head entry at a time, `ORDER BY seq LIMIT 1`; delete after success; stop at first retryable failure. Unreadable payload is discarded with a log (`:139-150`).
- Permanent failures are swallowed inside `_guard` (`isFinalUploadRefusal`, `mirror_uploader.dart:54-61`): SQLSTATE `42501` (RLS), `22*` (data), `23*` (constraint). Retryable (`isTransientMirrorFailure`, `mirror_network.dart:200-250`): timeouts, `AuthException`, no-code transport errors, HTTP 5xx/408/429, SQLSTATE 57014, 55P03, 53300, 40001, 40P01, 08*, 53*, socket/TLS errors.
- Head stuck after `kOutboxStuckPasses = 4` failed passes → `OutboxStuckException` (`mirror_uploader.dart:18, 209-238`).
- Upload budget `_uploadShare = 45 s` per pass, so the pull gets time (`mirror_engine_io.dart:110`).

**Compare-and-set** (`mirror_uploader.dart:300-380`, `schema.sql:802-936`):
- RPC `apply_channel_edit(p_channel_id text, p_field text, p_base jsonb, p_new jsonb, p_force bool=false, p_label text)` returns text: `noop` (base == new), `auto` (current == new), applied, or `conflict`.
- CAS compares `base` (what the editor saw) against the current column value (canonicalised by `canonical_edit_value`). If they differ, the server writes an `edit_conflicts` row and refuses the write. The refused value is not written.
- The CAS column is the **field name** inside `channel_state` (one edit = one field). No version column. `updated_at` is the pull cursor, not the CAS token.
- Client-detected conflict: insert into `edit_conflicts`; a unique violation (`23505`, one open conflict per person+field+channel) updates the existing one (`mirror_uploader.dart:329-370`).
- Resolution: RPC `resolve_edit_conflict(uuid, text, jsonb)` (`schema.sql:938-976`), the only force-write, runs as `conflict.resolve`.
- Surfacing: the refused edit is logged `upload.refused` and "the local value will revert on the next sync down" (`mirror_uploader.dart:318-327`). The conflict itself is a row synced back to everyone and shown on the UI.

**Local ids vs server ids**:
- Local rows that the machine creates get a client-minted random v4 UUID (`local_id.dart:1-30`, `Random.secure`). Server `id` columns are `uuid default gen_random_uuid()`, so a supplied id is kept. Channel rows are keyed by the YouTube channel id (text), not a UUID.
- Per-row mirror `updated_at` is not sent by the client (`mirror_uploader.dart:381-383`); the server's trigger sets it.

**What runs when** (`mirror_engine_io.dart`, `sync_providers.dart`):
- Pass every `_interval = 3 h` (`:30`). Retry ladder after failure: 30 s, 2 min, 10 min, 30 min (`:46-50`, function at `:123`).
- Pass budget 2 min (`:64`); if the budget runs out, continue after 5 s (`:73`).
- Defer for a running search up to 20 min (`:80`), re-check each 1 min (`:88`).
- Local-fault recheck 45 s (`:101`): a pass is the only thing that clears a local DB fault.
- Catch-up after a realtime ping: 20 s (`sync_providers.dart:154`).
- Event-loop heartbeat 1 s (`mirror_engine_io.dart:819-833`, used for lag diagnostics only).
- Realtime: one Broadcast per human action on channel `gratovo:live`, event `data`, payload `{tables:[...]}` (`live_data_service.dart:10-93`; `mirror_uploader.dart:70`). Presence rides on the same channel.

**Error and fault handling**: `mirror_fault.dart` wraps the local DB in `GuardedMirrorDb` (`:71`). A broken local file is a "local fault" surfaced once per stretch (`mirror_engine_io.dart:428-443`). Logs go to `sync_log_file_io.dart` and `sync_diagnostics.dart` (`pull.page`, `upload.refused`, `upload.stuck`, `local.fault` events). Pages slower than a budget get `pull.page.slow`.

**Flutter-specific, will not port**: `dart:isolate` off-thread reads (`mirror_database.dart:117-123`, one isolate per read; in the new app this is a utility process or a worker), `supabase_flutter` client (`mirror_uploader.dart:9`), `dart:io` type checks by name (`mirror_network.dart:243-247`), `Riverpod` providers (`sync_providers.dart`), web-import constraints (`local_id.dart`). Logic (cursors, outbox, retry classification, page shrink) is what ports.

## 2. Supabase backend (`legacy/backend/`)
**schema.sql** (1368 lines) = "CURRENT STATE, not history"; safe to re-run (header lines 1-20). Sections: extensions (`pg_trgm` in `extensions`, line 62-63), tables, functions, triggers, security, realtime, retired.

Tables (line numbers in schema.sql):
- `profiles` (84): `id uuid → auth.users`, `display_name`, `color`, `role public.app_role` enum `unauthorized|basic|full` (default unauthorized, line 81), `updated_at`.
- `channel_state` (112): PK `channel_id text`, `handle`, `vetting_status` (check: newlyFound|shortlisted|rejected), `pipeline_stage` (check list), `channel_tags text[]` (vocabulary check), `contacts jsonb`, `provided_data jsonb`, `archive_due_at`, `last_deal_at`, `last_edited_by` (uuid), `owner_id`, manual engagement, `media_kit`, `creator_gender`, `updated_at`.
- `brands` (157): uuid PK, name, contact fields, status.
- `deals` (172): uuid PK, `brand_id uuid → brands` (cascade), `channel_id text`, `stage text` default `'proposed'`, check list `proposed|negotiating|agreed|contractSent|...` (line 175). Note: legacy stage vocabulary ≠ prototype `DEAL_FLOW` step index.
- `outreach_threads` (194): uuid PK, `channel_id text unique`, `deal_id`, `status` default `notContactedYet`, `owner_id`.
- `outreach_messages` (203): uuid PK, `thread_id`, `direction` (outbound|inbound), `method` default email, `at`.
- `email_templates` (226), `writing_rules` (238), `follow_up_reminders` (249, partial index on open items), `campaigns` (280), `campaign_shortlist` (298), `deliverables` (312), `channel_rate_history` (335), `sequences` (350), `sequence_steps` (359), `agency_settings` (474), `comms_proposals` (483, check status, decided_by).
- `edit_conflicts` (529): uuid PK, `channel_id`, `channel_label`, `field`, base/theirs/mine values, open/resolved state; partial unique index for one open per person+field+channel (line 548).
- `activity_log` (563): uuid PK, `at`, `actor_id → profiles`, `actor_name`, entity fields.
- `scratchpads` (591): PK `user_id`; the one realtime-published table (section 13, `schema.sql:1279-1295`; header line 37).
- `remote_search_requests` (603): from/to user ids, status.
- `aws_gateway_credentials` (626): PK `user_id`, `access_key_id`, `secret_access_key` **stored as text in a table** (RLS per user, line 1179-1181). Note `aws_gateway_credential_history` (638). Secret-at-rest risk; see §7.
- `sync_tombstones` (656): `(table_name, row_id)` key, `deleted_at`; check constraint of allowed table names (665-666).
- `sync_control` (680): singleton, `tombstones_purged_before timestamptz`.

**Triggers and functions**:
- `touch_updated_at` (761): BEFORE UPDATE on every copied table (`trg_touch_%` loop, lines 1043-1046). This is what makes `updated_at` the cursor.
- `record_sync_tombstone` (988): AFTER DELETE on every copied table (`trg_tombstone_%` loop, 1062-1066), SECURITY DEFINER, upserts a tombstone. `sync_tombstones` has RLS on and **no insert policy**, so clients cannot forge tombstones.
- `purge_sync_tombstones(p_keep_days int=90)` (1001): deletes old tombstones, raises the horizon. Granted to `service_role` only (1250). Scheduled by pg_cron job `gratovo-tombstone-purge` (1364) if pg_cron is enabled; else a NOTICE only (1358).
- `handle_new_user` (746) on `auth.users` insert (1025-1027): creates profile at `unauthorized`.
- `set_archive_due_at` (779) and `trg_channel_state_archive_due` (1049); `channel_is_rejected(text[])` (769).
- `canonical_edit_value` (802), `apply_channel_edit` (838), `resolve_edit_conflict` (938): described in §1.
- `app_current_role`, `is_authorized` (basic|full), `is_full` (726-745): security-definer helpers used by RLS.

**RLS summary** (lines 1077-1215): RLS on 24 tables (1077-1090). Pattern `*_rw` = `for all to authenticated using/with check is_authorized()` for: channel_state, brands, deals, outreach_threads/messages, follow_up_reminders, email_templates, writing_rules, campaigns, campaign_shortlist, deliverables, channel_rate_history, sequences, sequence_steps, agency_settings, comms_proposals (1111-1125). `profiles`: read if authorized or self; self-update cannot change `role` (1096-1103). `activity_log`: read by authorized; append-only (insert policy line 1138-1140; no update/delete). `scratchpads`: everyone authorized reads, owner writes (1144-1150). `remote_search_requests`: only from/to users. `aws_gateway_credentials`: own row only. `edit_conflicts`: read/write/resolve policies (1194-1202). `sync_tombstones`, `sync_control`: read-only (1206-1215). `unauthorized` sees nothing.

**Grants** (lines 1218-1256): `authenticated` gets select/insert/update/delete on all public tables (1220); `service_role` too (1228); all functions revoked from public/anon/authenticated, then re-granted per function (1234-1247). `anon` revoked from everything (1254-1256). **The 2026-10-30 deadline**: Supabase stops auto-granting new public tables to the Data API roles, so each new table in a later migration needs explicit `grant` lines. `schema.sql` already has the blanket grant; the new migrations must not rely on it.

**migrate_v2.sql** (127 lines): one-time conversion from the old "live-first" schema (channels, videos, keywords, runs…) to the typed-in-only one. Copies human-edited `channels` columns into `channel_state` (touched channels only), drops videos/channels/keywords/runs/etc. (lines 98-106), clears old tombstones, resets horizon. Needs an export step first (`search.py --export-supabase`, data/migration/*.jsonl).
- **What the docs claim:** `legacy/backend/SETUP.md:59,158` tells a new project to run it; `docs/migration-plan.md:242` says "Not carried over (one-off, already applied)"; the `migrate_v2.sql` header says "run ONCE". **Nothing in this repo proves production has it applied.** Check the production database (read-only query on `information_schema.tables` for `channels`/`videos`) before any 3d migration. Treat "applied" as an unverified claim.

**Tests** (`legacy/backend/tests/`):
- `run.sh` (135 lines, bash): builds `postgres:16` in Docker (`-e POSTGRES_DB=gratovo`, line 26), `psql` via `docker exec` (line 28). Pass 1: fresh DB, apply stubs, `schema.sql` **twice** (idempotency), run all `test_*.sql`. Pass 2: loads the **previous** schema from git with `git show $OLD_SCHEMA_REF:backend/schema.sql` (line 67; `OLD_SCHEMA_REF=14240e3`, line 19), seeds old data, runs `migrate_v2.sql` twice, then `schema.sql`, asserts, then all tests again.
- **Blocker:** `14240e3` is not in this repo's history (`git cat-file -t 14240e3` fails; repo has 11 commits). Pass 2 cannot run here. Fix: keep the old schema as a fixture file, or accept that pass 2 runs only where the legacy repo is available.
- Stubs `00_supabase_stubs.sql` (35 lines): creates roles `anon`, `authenticated`, `service_role`; `auth.users`; `auth.uid()` reads `current_setting('test.uid')`, so RLS can be tested under a fake JWT. Note the stub does not model `auth.jwt()`, `storage`, `realtime`, `cron` (pg_cron checked for existence only).
- Test files: `test_12_conflicts.sql` (CAS), `test_17_scratchpad.sql` (RLS pair), `test_19_sync_shape.sql` (no scraped table; `updated_at` on every copied table; tombstone on delete), `test_20_remote_search_requests.sql`, `test_21_decisions_schema.sql`. Pattern: `pg_temp.check(label, bool)` raises on failure (`tests/README.md`).
- Run it: needs Docker only. Local Docker 29.4.3 is installed (checked). `supabase` CLI is **not** installed.

**SETUP.md** (206 lines): project creation (lines 40-60), keys (69-77: anon key is public by design, service_role only in `data/.env`), user creation with "Auto Confirm" (81), role promotion SQL (84-99), pipeline export and the app's R2 key handling (173-176: the old build bakes R2 keys into each install).

**Auth model (old)**: Supabase Auth email + password (`legacy/lib/features/auth/application/auth_controller.dart:42-50`: `signInWithPassword`), roles enforced in RLS, not UI (SETUP.md:84). GitHub device-flow OAuth is used for release downloads only (`legacy/lib/core/github/github_auth.dart`).

**External services** (Supabase project, Realtime, R2 for pipeline, YouTube Data API, Gemini web via extension, Gmail OAuth, AWS gateway creds).

**Deadline:** A3 (plan line 42): "Paste `legacy/backend/schema.sql` into Supabase before 2026-10-30. After that date, new tables need explicit grants." Status: not done (owner action). 10 days from today. Owner-only action; the new app cannot do it.

## 3. How the old app authenticates and which keys it uses (names only)
- Init: `Supabase.initialize()` in `legacy/lib/core/supabase/supabase_client_provider.dart` (imported from `legacy/lib/main.dart`). Config: `legacy/lib/core/config/supabase_config.dart` (url + anon key; compiled-in defaults from a `--dart-define`; runtime override in SharedPreferences). Names: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (dart-define). No value recorded here.
- Auth: email+password (`auth_controller.dart`). Sign-out `:96`.
- Anon key: used by the Flutter app for PostgREST and Realtime. Public by design; access is decided by RLS.
- Service-role: `SUPABASE_SERVICE_KEY` and `SUPABASE_SERVICE_ROLE_KEY` appear in legacy docs/code, used only by the pipeline one-time export (SETUP.md:77). Never in the app. The new app must never have it.
- R2: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_API_TOKEN` (pipeline, `legacy/pipeline/gratovo/`). Shipped into each install via the build (SETUP.md:173-176). Plan A6 replaces this with a server function.
- YouTube: `YOUTUBE_API_KEY` (pipeline). Google: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` (Gmail, pipeline).
- GitHub: `GRATOVO_GITHUB_CLIENT_ID` (device flow), `GRATOVO_GITHUB_TOKEN` (**shared release token compiled into the binary**, `legacy/lib/core/github/shared_release_token.dart:1-30`; the file itself calls it "not secret"). Not carried into the new app (SECURITY.md "Known exposure" lists it).
- AWS: `AWS_IAM_ACCESS_KEY_ID`, `AWS_IAM_SECRET_ACCESS_KEY`, `AWS_GATEWAYS_PATH`; per-user copies in `aws_gateway_credentials` (RLS per user).
- Gemini: `GEMINI_URL`, `GEMINI_ORIGIN`, `GEMINI_ADDON_ID`, `GEMINI_APP_URL` (no key; browser session).
- Key delivery: env + `data/.env` on each PC; `.env` seeded into the installer and merged on first run (`legacy/lib/core/native/env_merge.dart`, `scraper_process_io_data_dir.dart:40-56`).
- Forbidden for new app (plan §7 line 246): `data/.env` is never carried over; A1 rotation deferred by owner 2026-10-20 (plan line 40): use existing keys, enter at run time, never in the repo.

## 4. Prototype data (`design/workbench-prototype/js/data.js`, 299 lines)
- Global `W` (`window.W`). Seed via `W.seed()` (line ~285-299): `creators, brands, deals, threads, drafts, runs, mateRun, pool, notifs, log, team, mail, hist, me:"u1", snoozed, handed, done, notes, day, rules, settings`.
- Ids are short strings: creators `c1…c40`, brands `b1…`, deals `d1…`, members `u1…`, drafts `q1…`, runs `r3…`.
- `DEAL_FLOW` (lines 8-18): 10 steps: negotiate, contracts, brief, draft, prelive, golive, invoice, report, pay (locked until paid), next. Deal has `step` (index), `checks[]` per step, `price`, `payout`, `invoice{no,sent,due,paid}`, `report`, `golive`, `due`, `terms`, `deliverable`.
- `CREATOR_STEPS` (20-23) and `STAGE_LABEL` (25): creator stages new, shortlisted, contact, emailed, replied, kit, audience, signed, rejected, parked, never.
- Creator (`C()` at 31-34): `id,name,handle,subs,median,up30,lastUp,videos[],sponsors[],email,emailSrc,emailConf,confirmed,contact,cands[],countries[],age,eng,stage,owner,rate,moment,run,found,tags,notes[],seq,kit,reject,before,pay`.
- Brand (143-155): `id,name,sells,cat,country,budget[min,max],contact,email,status (found|qualified|pitched|negotiating|won),seen[],since,site`.
- Threads (`threads` map keyed by creator id, 170+): arrays of `M(dir,at,text,ai,by)`.
- Runs (234+): `{id,at,by,status,cur,kws[{q,st,found,kept}],found,kept,gold,archived,log[]}`: scraped-search data.
- Also: `notifs`, `log` (activity), `team`, `mail` (mailboxes), `hist.months` (derived stats), `POOL`, `KW`.

**Mapping to Supabase / new app** (none of it exists yet as code):
| Prototype | Supabase table | Status |
|---|---|---|
| creators (c*) | `channel_state` (text `channel_id`, `handle`, `pipeline_stage`, `vetting_status`, `contacts`, `channel_tags`, `notes`, `owner_id`) + R2 for `subs/median/videos` | Partial: scraped fields are not in Supabase |
| brands (b*) | `brands` (uuid) | Name differs (`sells`, `cat`, `budget`, `seen` not in schema checked; verify) |
| deals (d*) | `deals` (uuid; `stage` text vocab differs from `step` index) | Mismatch: need mapping |
| threads/drafts | `outreach_threads`, `outreach_messages`, `comms_proposals` | Partial |
| runs, KW, POOL, mateRun | none (R2 + pipeline + local) | Step 3e |
| notifs, log | `activity_log` (local-only notifications) | Partial |
| team, me | `profiles` | Yes |
| mail | none (Gmail is pipeline) | Step 3e / on hold (mail-1, mail-2) |
| hist, day, snoozed, handed, done, notes | derived or device prefs | Not stored (architecture: nothing derived is stored) |
| rules, settings | `agency_settings`, `writing_rules` | Partial |
Example data must be AI-niche (CLAUDE.md). The prototype data already is.

## 5. The new app today
**packages/core** (pure TS, no I/O; `tsconfig` has no Node/DOM types, so I/O fails typecheck):
- `src/deal-flow.ts`: `DEAL_FLOW` (line 34-100), `DealStepKey`, `DealStep` (`key`, `name`, `items`…). Ported with `key` not `k`; a test keeps it in step with the prototype.
- `src/store.ts` (179): `createStore<D,U>(options)`, immer-based. `StoreState`, `UndoStep`. Business data `D` undoable; UI state `U` not. Recipes write with immer; patches are kept "for 3d" (ADR 0009 decision 2).
- `src/history.ts`: route history (`historyLimit=100`), `keys.ts`: key stack and Go-prefix (not data).
- `src/index.ts` (25 lines): public exports. `keys.test.ts`, `store.test.ts`, `deal-flow.test.ts`, `history.test.ts`.
- No `DataSource` interface exists anywhere in the repo (grep: none). No sqlite, no supabase-js in any package.json.

**apps/desktop/src/renderer/lib/store.ts** (460 lines):
- `AppData` (line 115-132): `me`, `myName`, `team: Member[]`, `counts: RailCounts`, `notifications`, `log`, `creators: Creator[]`, `brands: Brand[]`, `deals: Deal[]`, `mateRun`, `settings.notify`. Types: `Member` (21), `Notification` (30), `RailCounts` (42), `LogEntry` (52), `Creator` (74: id,name,handle,stage,email), `Brand` (83: id,name,sells,status), `Deal` (93: id,brand,creator,step,price), `MateRun` (106).
- `AppUi` (211), `createAppStore(start, now)` (243), `appStore()` (272), `useApp(selector)` (307), `go/back/forward/setRailOpen`, `installHashSync` (448). Routes in the URL hash (ADR 0009 decision 6).
- Counts and frame data are typed example constants "until the data layer replaces them" (ADR 0009 decision 10; store.ts:45-47).
- `apps/desktop/src/renderer/lib/example-data.ts` (170 lines): the AppData example constant. This is the thing the `example` DataSource seeds from.
- `actions.ts` (377 lines): the action layer that writes to the store. This is where `DataSource` calls would go.
- `prefs.ts` (156): device preferences in `localStorage` (name is a device pref until 3d; ADR 0009 decision 22).
- `settings.ts` (111): settings rows.

**packages/ipc** (zod contract):
- `src/channels.ts` (59): `channels` map is the only allowlist. Two channels today: `app:ping` (line 17-23, response `{ok:true, version}`), `secrets:status` (line 26-29, request `{name}`, response `{set}`). `secretName` regex (line 7-12). Names `domain:verb`.
- `src/bridge.ts` (23): `bridgeChannel = "gratovo:invoke"`, `bridgeGlobal = "gratovo"`, `InvokeResult`, `Bridge.invoke`.
- `src/dispatch.ts` (64): `createDispatcher(handlers, onError)` validates request with `parseRequest`, runs handler, validates response with `channels[c].response.safeParse` (line 49-58). Errors give `{ok:false, reason:"The call failed"}`.
- `src/index.ts` (12): exports.

**How to add a channel** (`apps/desktop/README.md` lines 13-18): (1) add `request` and `response` zod schemas in `packages/ipc/src/channels.ts`; (2) TypeScript then demands a handler in `apps/desktop/src/main/handlers.ts` (`createHandlers`, 17 lines; `Handlers` type from `@gratovo/ipc`); (3) renderer calls `window.gratovo.invoke("domain:verb", input)`. Preload: `apps/desktop/src/preload/`. Rule: a channel never returns a secret value and never takes a path or URL without an allowlist check.

**apps/desktop/src/main/**:
- `index.ts` (80): `separateDevelopmentData()` (line 16-25): `app.setPath("userData", …)`. Unpackaged: `GRATOVO_USER_DATA` env if set, else `"<userData> (dev)"`. Packaged ignores the env var. `app.enableSandbox()` (line 35). `registerAppScheme()`, `guardWebContents`, `requestSingleInstanceLock` (single instance, line 74; secrets and later the DB depend on it). `denyAllPermissions`, `refuseDownloads`, `serveAppFiles` (line 56-58). `registerBridge(createHandlers({version, secrets: openSecretStore()}))` (line 59). Menu removed (line 61).
- `handlers.ts` (17), `ipc-bridge.ts` (24): `registerBridge` on `ipcMain.handle`; sender check via `isTrustedSender(event.senderFrame, appPageUrl)` (`app-page.ts`).
- `secrets.ts` (18): `openSecretStore()` → `join(app.getPath("userData"), "secrets.json")`, cipher = `safeStorage` (DPAPI on Windows).
- `secret-store.ts` (173): JSON file, encrypted values, atomic write, one queue, retried rename. Test file 262 lines.
- `app-files.ts` (64), `app-protocol.ts` (52), `app-page.ts` (53), `window.ts` (58: `rendererRoot = join(__dirname, "../renderer")`), `security.ts` (70), `external-links.ts` (41: allowed hosts, YouTube and Gmail; `isAllowedExternalLink`), `csp.ts` (19), `strings.ts` (7).
- User data folder: Electron default `%APPDATA%\<productName>` (`productName` = "Gratovo Toolbox", `apps/desktop/package.json:4`), or `… (dev)` unpackaged. The DB should live beside `secrets.json` (same `userData`).

**Main-process network rules (ADR 0008)**: CSP (`csp.ts:8-17`) is `connect-src 'self'` for the renderer only. **Nothing restricts the main process's network.** There is no main-process allowlist or fetch wrapper in the repo. The external-links allowlist (`external-links.ts`) only governs what the page may open in the browser. If main gets Supabase and R2 access, add an explicit allowlist (`*.supabase.co`, the R2 host), or the rule ADR 0008 implies is not enforced.

**electron-vite** (`apps/desktop/electron.vite.config.ts`, 50 lines): `main: {}` and `preload: {}` with defaults (so the main process is bundled by Rollup/Vite with no `externalizeDepsPlugin` config; deps are bundled unless marked external). Renderer: react plugin + `cspMetaTag()`. Preload builds as CJS (comment line 37-38). A native module must be listed as external in main's config (not done yet). `apps/desktop/README.md` line 31-33 says a native module goes in `dependencies`.

**supabase/README.md** (8 lines): says `supabase/migrations/` and `supabase/tests/` (both absent; `supabase/` holds only the README). Step 3d creates them (plan §3d; architecture.md "Repository layout").

**CI** (`.github/workflows/ci.yml`, 182 lines):
- Job `checks` (line 28, "Checks (Windows)", `windows-2025`): `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` (line 56-66). Keeps `e2e-results` artifact.
- Job `secrets` (80, ubuntu-24.04): gitleaks 8.30.1 over git history.
- Job `audit` (108, ubuntu-24.04): OSV-Scanner v2.7.0 over `pnpm-lock.yaml` and `services/pipeline/uv.lock`.
- Job `codeql` (135, ubuntu-24.04), `upload: never`, fails on any result (`.github/codeql/codeql-config.yml`).
- **No Docker or SQL job.** The SQL tests (`legacy/backend/tests/run.sh`) run nowhere. Plan line 147 says "decide in 3d where they run". Ubuntu runners have Docker, but owner rule forbids Linux effort. Windows runners can run `postgres` installed natively (Chocolatey or the EDB zip) and bash via Git Bash, rewriting `run.sh` for Windows. Decide with the owner (grill).

**Root** (`package.json`): scripts `lint` (eslint, prettier, ruff check/format), `typecheck` (`tsc -b && pyright`), `test` (`vitest run && pytest`), `test:e2e`. `packageManager: pnpm@12.14.0`. `engines.node ^24.22.0`.
**pnpm-workspace.yaml** (23 lines): `saveExact`, `engineStrict`, `minimumReleaseAge: 1440` (one day), `allowBuilds: { lefthook: true }` (only install scripts listed here run; a native SQLite module needs its own entry), `peerDependencyRules` for jsx-a11y.

## 6. Tooling facts
- Electron: **44.9.0** (`apps/desktop/package.json` devDependency; `node_modules/electron/package.json` 44.9.0; binary installed under `node_modules/electron/dist`). Electron 44.9.0 bundles **Node 24.22.0** per `docs/architecture.md:Versions` (not verified from the binary). Node ABI for Node 24 is 137 (NODE_MODULE_VERSION). Check at runtime with `process.versions.modules` in the main process before choosing a native build.
- Node in shell: 24.22.0 pinned (`.nvmrc`). `@types/node` in repo is 24.19.2 (root devDependency).
- `better-sqlite3`: **not in the repo or lockfile**. Would need: (a) a `dependencies` entry in `apps/desktop` (per its README), (b) an `allowBuilds` entry in `pnpm-workspace.yaml` (pnpm 12) so its install script runs, (c) a rebuild against Electron's ABI (`@electron/rebuild` or electron-builder's `install-app-deps`), (d) `electron-vite` main config `external`. It needs a prebuilt binary for win32-x64 + Electron 44 or a local compile (MSVC + Python). Not verified here.
- `node:sqlite`: **built into Node 22.5+**, no native build, no rebuild. `@types/node` 24.19.2 `sqlite.d.ts` (1182 lines) says `@since v22.5.0` and `@experimental` (line 36-37). Whether Electron 44's embedded Node exposes it and whether it is stable enough is **unverified here**: no Electron docs or Node 24 release notes in the repo. Test it inside `electron` main before choosing. Cost of `node:sqlite`: experimental API churn, no `better-sqlite3`-style sync API parity (its API is similar: `DatabaseSync`, `prepare().run/all`).
- Docker: **installed**, `Docker version 29.4.3` (checked). Enough for `legacy/backend/tests/run.sh` pass 1 (`postgres:16`) and for a local Supabase stack once the CLI exists.
- Supabase CLI: **not installed** (`supabase --version` fails). Install via npm (`supabase` package has install scripts, so it needs an `allowBuilds` decision) or a Windows zip. `supabase start` needs Docker, which is present.

## 7. Open questions and risks for planning 3d
1. **Production migration safety.** Nothing in this repo proves `migrate_v2.sql` was applied to production. `docs/migration-plan.md:242` says "already applied"; `SETUP.md` tells a new project to run it. Before writing a baseline migration that "matches production exactly" (plan line 115), read the live schema (read-only), diff against `schema.sql`, and record the diff. Possible drift: `schema.sql` is "current state" and the live project may differ, plus the 2026-10-30 grants change.
2. **Schema drift, baseline.** The plan wants `supabase/migrations/<ts>_baseline.sql` to match production (plan §3d line 115). `schema.sql` is written as idempotent `CREATE IF NOT EXISTS` and `DO` blocks with `drop policy if exists`, not a migration. Converting it to a baseline must keep `drop table` guards out, and needs `supabase db diff` against prod or a `pg_dump -s` snapshot (read-only).
3. **Deadline A3 (2026-10-30).** New tables in later migrations need explicit grants to `anon`/`authenticated`/`service_role` (Supabase Data API change). The owner must paste `schema.sql` before that date. This is owner-only. 3d can't ship a new table before it without a manual step, so plan the first additive migration after A3.
4. **Auth model for the new app.** Old app: email+password via `signInWithPassword` (`auth_controller.dart:42-50`). The plan does not say which auth the new app uses. Keep email+password for parity, or add GitHub/magic-link. Needs an owner call or a recorded decision (grill-with-docs). Supabase session storage in the main process (not the renderer) matters: refresh tokens must go through `safeStorage`, like secrets (ADR 0008 decision 4).
5. **Team keys server function (Q11) does not exist.** No Edge Function in legacy. 3d's acceptance line 119-120 assumes it. Either build it (Supabase Edge Function + RLS-gated, a new migration, a new function secret) or defer to 3e. Note: the function must keep `YOUTUBE_API_KEY` and R2 keys out of the renderer and the installer.
6. **The main process has no network allowlist** (see §5). Adding the sync engine to main means main talks to Supabase. Add an allowlist (hosts + https only) in the same style as `external-links.ts`, with a test.
7. **Which data the renderer reads first.** `AppData` (store.ts:115) is an example constant today. 3d must decide: the renderer's first read is a `DataSource` query (IPC channel per screen query, one query per screen per the performance rules, architecture.md "Performance rules"), not a sync stream. Define the channels before the sync engine, so Today can render from local data (architecture.md performance rule 6).
8. **Secret at rest in Postgres.** `aws_gateway_credentials.secret_access_key` is a plain `text` column (schema.sql:626-629), RLS per user, and in the realtime publication maybe (line 623 comment, confused). Any sync of that table into SQLite stores the secret in the local DB, which is not `safeStorage`-encrypted. Do not mirror it. Confirm the publication state.
9. **Local DB encryption.** `secrets.json` is DPAPI-encrypted; the SQLite file is not (old app: plain `gratovo.db`, `PROJECT_STRUCTURE.md` line 17-19). Decide whether synced rows containing contact emails need encryption at rest.
10. **SQL tests in CI.** Pass 2 of `run.sh` needs `OLD_SCHEMA_REF=14240e3`, which is missing from this repo's history (checked). Also no CI job runs them; Windows runners can't run Docker Linux containers (plan line 147). Options: commit the old schema as `supabase/tests/fixtures/old-schema.sql`, and run the tests in a Windows-installed Postgres 16 via a job, or a local-only run. Decide in 3d (grill).
12. **Legacy sync used `supabase_flutter` helpers** (auth refresh, PostgREST). The new `@supabase/supabase-js` may behave differently for `AuthException` / `PostgrestException` mapping (`mirror_network.dart:200-250` relies on Dart types). The error classifier must be rewritten against supabase-js error codes. Test it.
13. **Test environment.** Plan wants "sync tests against a local Supabase (CLI)". CLI missing; Docker present. Local stack needs the CLI, Docker and ~several GB. Decide who installs it (cloud sessions cannot). `docs/handoff.md` says how to get tools (CLAUDE.md "Commands"); not read in this recon.

## Files likely touched for 3d
New:
- `supabase/migrations/<YYYYMMDDHHMMSS>_baseline.sql` (from `legacy/backend/schema.sql`, ADR/plan §3d); later additive migrations.
- `supabase/tests/*.sql`, plus a runner (`supabase/tests/run.sh` or `.ps1`; `legacy/backend/tests/run.sh` is the model; `00_supabase_stubs.sql` moves with it).
- `supabase/config.toml` (CLI, if chosen), `supabase/README.md` (currently 8 lines, to rewrite).
- `docs/setup.md` (rewritten from `legacy/backend/SETUP.md`, plan §7 line 241).
- `packages/core/src/data-source.ts` (or `apps/desktop/src/main/data/`): `DataSource` interface, pure types; `packages/core` has no I/O.
- `apps/desktop/src/main/db/` (new): `open-database.ts`, `migrate.ts` (forward-only SQL runner), `migrations/0001_*.sql`, repositories (typed queries per table), `database.test.ts` (temp DB).
- `apps/desktop/src/main/sync/` (new): `engine.ts`, `puller.ts`, `uploader.ts`, `outbox.ts`, `tables.ts` (the 21 tables + tombstones), `errors.ts` (retry classifier), `keyset.ts`, tests.
- `apps/desktop/src/main/supabase.ts` (client creation, session in `safeStorage`), network allowlist file (e.g. `network-allowlist.ts`, test beside it).
- `apps/desktop/src/main/example-source.ts` (example `DataSource`, seeds from `example-data.ts`).
- `packages/ipc/src/channels.ts`: channels for data queries and auth/sync status; `apps/desktop/src/main/handlers.ts`.
- `apps/desktop/src/main/index.ts`: open DB, start sync after sign-in (single-instance lock already in place).
- `apps/desktop/src/renderer/lib/store.ts` and `actions.ts`: read via IPC, write through the outbox.
- `apps/desktop/src/renderer/lib/example-data.ts`: source for the example DataSource (AI-niche only).
- `apps/desktop/electron.vite.config.ts`: externalize native module if `better-sqlite3` is chosen.
- `apps/desktop/package.json`: add `dependencies` (sqlite driver if native; supabase-js); `pnpm-workspace.yaml`: `allowBuilds` entry for a native module.
- `pnpm-lock.yaml`: updated by `pnpm install`.
- `.github/workflows/ci.yml`: a SQL test job (Windows-native Postgres or decide otherwise); keep gitleaks/OSV/CodeQL as is.
- `.router/PROGRESS.md` (state of 3d while in progress).

## 8. Facts added by the 3d-1 planner (2026-10-20)
- `node:sqlite` on plain Node 24.22.0: no ExperimentalWarning on `require` or `import` (checked with a `warning` listener); `node:module.builtinModules` lists `node:sqlite` (not `sqlite`), `isBuiltin("node:sqlite")` is true. Exports: `DatabaseSync, StatementSync, Session, constants, backup`; `DatabaseSync#isTransaction` exists.
- Supabase lacks fields the app shows: `brands` has no `sells` or `status` (only `category`, `country`, `contacts`, `budget`…); `channel_state` has no name (scraped half, R2); `deals.stage` is legacy vocabulary (proposed…lost), no flow step; `profiles.role` is only unauthorized|basic|full (no owner / account manager / VA); `profiles.display_name` is NOT NULL. `activity_log` columns: id, at, actor_id, actor_name, actor_role, action, entity_type, entity_id, entity_label, field, old_value, new_value, detail (append-only by RLS).
- Main tsconfig (`apps/desktop/tsconfig.node.json`) references only `packages/ipc`; main cannot import renderer files. `packages/ipc/tsconfig.lib.json` and core's have no Node or DOM types.
- The renderer never calls `window.gratovo.invoke` yet; `src/renderer/env.d.ts` types `window.gratovo` as `Bridge`.
- The notifications tray shows `data.notifications` in array order (the example fixtures are not sorted by time); the prototype's other list (`more.js:609`) sorts by `at` desc.
- Today's writes: `markAllRead` (act, no log), `readNotification` (bg), `setNotify` (act, no log), `setMyName` (name pref + bg). No current act writes a log line; `act` log ids come from a per-launch counter (`l1`…).
- Prefs are parsed field by field (`prefs.ts` `pick`), so dropping the `name` field leaves an old stored value harmlessly ignored.
- The top bar's save state reads `ui.saving` / `ui.savedAt`; `markSaving()` in `actions.ts` is a 700 ms cosmetic timer today.
- 20 renderer test files call `resetAppStoreForTests`; `lib/store.test.ts` and `lib/settings.test.ts` import `exampleData` directly.
