# Progress: step 3d-2b (the sync: pull, outbox, compare-and-set, conflicts, Realtime and presence)

Started 2026-10-20 on branch `feat/3d-2-sync`, after #11 (3d-2a, merged; its progress record is in git history at b79911a). `CONTEXT.md` is the fresh 3d-2b recon; `PLAN.md` the 3d-2b plan, one pull request (tasks S1 to S33, R1, L1).

| Task | Tier | Commit | Note |
|---|---|---|---|
| Recon | scout | 784fa01 | `.router/CONTEXT.md`, 245 lines. Production sizes from the MCP's table list (2026-10-20): `channel_state` ~15.6k, `sync_tombstones` ~38k, `activity_log` 364 |
| Plan | H | 610d173 | `.router/PLAN.md`: one pull request, 33 build tasks (26 N, 7 H), R1, L1. Q1 (money lock in a follow-up 3d-3) and Q2 (Realtime public access off, an R1 step) to ask the owner; neither blocks building |
| S1 | N | 165ff56 | Migration `20261022090000_sync_columns.sql` and `test_33` (27 checks); `test:sql` 9 files, second-pass privileges unchanged |
| S2 | N | 969b7cc | Core `logText`, `moneyFields`, `mentionsMoney` (159 core tests). Committed with `--no-verify` by mistake; gitleaks, prettier and eslint run by hand afterwards, clean |
| S3 | N | e924239 | IPC `sync:status`, `sync:now`, `presence:set`, `events.ts`, bridge `on`, preload. Lead: the three channels added to the full `Handlers` objects in two ipc tests, and placeholders in `main/handlers.ts` until S12/S28 |
| S4 | N | a2c9358 | Local migration 3 and the outbox repository (103 tests). `edit_conflicts` has the spec's columns only: S20/S6 add `resolved_by`, `resolved_by_name`, `resolution` if needed |
| S5 | N | 2ace7c5 | `server-time`, `keyset`, `refusal`; `rest.select` timeout, `rest.upsert` (142 tests). A `RestError` 401 maps to `session` too |

Owner answers (2026-10-20): **one pull request** for all of 3d-2b (3d-2b-2 folded in); `gratovo.db` unencrypted with BitLocker advised; unsent changes kept for the same account only; the 5,000 most relevant creators in the frame; **private Realtime channels now**, with the new app's own presence (not the old app's fields, which "don't make sense anymore"). Then: **"I don't care about the old app at all, no one is or will use it"**: no old-app compatibility (no legacy fields written, no shared channels, no old-app check); existing production data is still never destroyed; `legacy/` and docs cleanup stay in step 11. To record in owner-rules and the migration plan at L1. The owner said "continue": build after the re-plan without another approval round.

| S19 | N | 1332a58 | `EditConflict`, `Frame.conflicts`, four new `DataWrite` kinds, their schemas, `conflictsMax` 100. `renderer/lib/frame.ts` untouched: `AppData` has no `conflicts` until S13 |
| S7 | N | 42b8086 | Frame cap (rank with `rowid DESC`, then shown in `rowid` order), server log rows, money filter in the notification and log reads (example n6 now hidden from a member: its sub says "$4,500"), the `onWrite` hook. Lead asked for `conflicts: []` and throwing placeholders for the four new kinds until S20. `listMax` 5000 defined again in `creators.ts` (ipc doesn't export it) |
| S10 | H | 1b45dee | Uploader, 13 tests. Deviations: a refused batch of log rows is re-sent one row at a time, so only refused rows drop; a known kind with an unreadable payload drops as `bad_payload` and is marked for re-fetch. Seam for S22: `onOutcome`, `markRefetch`, `refetchKey = "sync.refetch"`. For S11/S27: `tables` lists every table touched (filter to D25's list before broadcasting); `stoppedOn: "session"` carries no error |
| S17 | N | a8bc1ca | `creator_stage` in `apply_channel_edit`'s whitelist; replaces `apply_channel_edit` and `canonical_edit_value` in place (same signatures; grants re-stated). R1: its own step |
| S18 | N | 5347084 | Policies `toolbox_realtime_receive`/`_send` on `realtime.messages` (topics `toolbox:sync`, `toolbox:team`, authorized members); RLS not enabled by the migration; stubs gain a `realtime` schema. R1: then the owner turns "Allow public access" off |

Checked after wave 2: typecheck, 454 main + 729 packages/data/renderer Vitest, `test:sql` (11 files).

| S8 | N | b08eabb | Write intents for the 3d-1 kinds; a marker's time is `max(now, newest marker + 1 ms)`; `me.name` queues nothing without a local profile row |
| S20 | N | c3f1127 | `setCreatorStage`, `setBrand`, `setDealStep`, `repositories/conflicts.ts`, `conflicts: listConflicts(db)`; no change to `0003-sync.ts` needed |
| S13 | N | a14744c | `renderer/lib/live.ts`, `adoptServerData`, `AppData.conflicts`, `AppUi.sync`. Outside its list: `lib/frame.ts` (copies `conflicts`), `start.test.tsx`. `on` read from `globalThis.gratovo` in `start.tsx`. A creator missing from a full (5000) answer is kept |
| S21 | N | 6226a55 | Intents for `creator.stage`, `brand.set`, `deal.step`, `conflict.resolve` (nothing queued when the row or open conflict is missing) |
| S24 | N | 40b3632 | Persister diffs for the new kinds; `conflicts` read-only in the page |
| S6 | N | e9ab6bd | `mirror-tables.ts` (a test checks the columns against the migrations), `whole-tables.ts` (old team-refresh cases moved). Open: a missing `notification_switches` on the server fails the whole refresh (fine once R1 is applied; consider tolerating schema-behind codes in L1). `team-refresh.ts` deleted in S12 |
| S14 | N | 6dca714 | Sync chip ("Not synced"), refused toast, sign-in waiting line, sign-out sends first. Inline styles for the chip's dot and width (CSS files not in its list: tidy in L1). Open: the refused toast can fire on a count carried over from before the page loaded (fix in `live.ts`) |

| S22 | H | 07b8ba3 | CAS, conflict and resolve answers; `editableFields` (10, checked against S17's whitelist); a `channel.edit` on a field outside it drops as `bad_field` and marks a re-fetch; unknown answers retry as `bad_outcome` |
| S26 | N | 975391b | `createGuardedWebSocket`; `@supabase/realtime-js` 2.117.2 (+ `tslib` 2.8.1, `@supabase/phoenix` 0.4.5). The `package.json` and lockfile changes went into 6dca714 (S14) by mistake: no history rewrite, noted in 975391b's message. Since then the lead checks `git diff --cached --stat` before each commit. Versions table row: L1 |
| S23 | N | 87bcd92 | `syncConflictNotices` (joins an open transaction); conflict and presence words in `main/strings.ts` |
| S25 | N | d132930 | `renderer/lib/conflicts.ts`, the tray's conflict choice. Lead added `installConflictToasts(invoke)` in `start.tsx` (outside S25's list). The toast stays 30 s; a conflict open at start also toasts |
| S9 | H | 79eaf2d | Puller, 17 tests. Deviations: re-fetch uses a plain `eq.` filter (S16 to confirm with real PostgREST); the tombstone seed falls back to the horizon; `sync.resync` marks a full pull spanning passes; a page that fails to apply (e.g. a NOT NULL column arriving null) is retried every pass — **look at in L1** (could stall a table) |
| S27 | H | 465c936 | Live client, 28 tests: private `toolbox:sync`/`toolbox:team`, D25's six tables only, presence republished after rejoin, `stop()` waits at most 2 s per step, logs `live.<word>` only. The real `RealtimeClient` is only typechecked here: S31 runs it |
| S29 | N | b6747a4 | Presence reporting (route, 5 min idle or hidden window), `mergePresence` through `adoptServerData`; `start.test.tsx` call order updated |

| S16 | N | 4cfeb9e | Server tests for pull and outbox (13). Confirmed on real PostgREST: the plain `eq.` re-fetch of a key with reserved characters; keyset paging across same-transaction rows. Lead follow-up 32bd6ea: `tsconfig.tools.json` includes the main folders the server tests import |
| S11 | H | 16efe52 | Engine, 27 tests. A drain stopping on `session` ends the pass as `offline`; an unfinished pull brings the next pass in 1 s; `sync.last_synced_at` only after a good, finished pass. Open: `drainBefore` waits behind a running pass |
| S12 | H | 0c253e7 | Account wiring, `events.ts`, `keep-unsent.ts`; `team-refresh`/`live-writes` deleted. Sign-in survives a failing whole-table refresh (logged); until R1 every pass fails at `notification_switches` (tolerate schema-behind codes: L1) |
| S27 fix | lead | 6d8df9f | Found by S31: the first joins went out before the token, refused as anon (live updates ~10 s late after every connect). Now `setAuth()` first, then join; a test holds `setAuth` and checks nothing joins before it |
| S28 | H | 44ac7d4 | Realtime and presence in the account and engine; conflict notices through `afterConflicts` (adds the `notify` part); sign-out stops Realtime alongside the 5 s drain (≤ ~6 s); `createLive` injectable |
| S31 | H | c58950d | `[realtime] enabled = true`, CI excludes without `realtime`, `realtime.test.ts`. With Realtime on, its own migrations run before the repo's, so `realtime.messages` exists. Lead: the same fix in `docs/setup.md` §7. Full `pnpm test:server`: 6 files, 57 tests, after the S27 fix. R1: check `live.subscribed` after the owner turns public access off |

| S30 | N | 38491dc | Server tests for compare-and-set and conflicts (2): first edit `applied`; a stale edit gets `conflict`, the re-fetch brings theirs, the conflict and its notice arrive, `mine` resolves through `resolve_edit_conflict`. Full `pnpm test:server`: 7 files, 59 tests |

## R1 (production rollout)

1. **Measure** (2026-10-21, read-only, counts only): `channel_state` 15,605 (15,604 `newlyFound`/`new`, 1 `newlyFound`/`contacted`); `brands` 0; `deals` 0; `activity_log` 364; open conflicts 0; tombstones 38,050 `channel_state`, 1 `sequences`, 1 `sequence_steps`; horizon `2026-09-13 06:53:09.109665+00`; history holds the three 3d-2a rows; none of S1's objects exist; no policy in schema `realtime`. `md5(prosrc)` of `apply_channel_edit` (042ff6b5…) and `canonical_edit_value` (22a6c0d0…) equal the baseline's bodies with CRLF line ends (production was created from a CRLF file): no drift. D13's cap holds (15,605 > 5,000; one creator past `new`).

2. **`sync_columns`** (owner's go for steps 2–4, 2026-10-21): the file's SQL in one transaction with its history row. Checked: the five columns exist, no log row without `received_at`, `notification_switches` owned by `postgres` with RLS and three policies, `anon` holds nothing; as the owner (rolled back) their own row inserts and another member's is refused.
3. **`creator_stage_edit`**: both functions owned by `postgres`, `authenticated` may execute, `anon` may not; as the owner (rolled back) a `creator_stage` and a `notes` edit on a throwaway channel both answer `applied`. The file's stray half-comment (lines 40–41, from the baseline copy) was removed before applying; comments only.
4. **`realtime_private`**: the two policies exist with the expected rules (topics `toolbox:sync`/`toolbox:team`, broadcast and presence, `is_authorized()`), roles `authenticated`. History: six rows, matching the file names.

Built by the lead after the owner asked for fewer agents (2026-10-21):

| Task | Tier | Commit | Note |
|---|---|---|---|
| S15 | lead | 406fa26 | Took over the agent's half-done work (cut off at the usage limit): fixed a test that read the wrong request and two lint errors; the bridge test now expects `invoke` and `on`. The rename of `save-failed.css` went into this commit by mistake (`git mv` stages it); f5a60d1 completes it |
| S14 fix | lead | f5a60d1 | The chip's width-keeping text was a real element, so it read "SavedNot synced": now a pseudo-element in `save-state.css`; the not-synced dot colour moved there too |
| S32 | lead | (this commit) | `conflicts.spec.ts`: stage edits send the base (null, then the previous), a brand upserts only its columns, a deal step PATCHes `flow_step`; a scripted `conflict` shows the toast and notification, the creator shows theirs, Use mine sends `resolve_edit_conflict` and the notification goes. The fake needed no change |
| S33 | lead | (this commit) | The no-Realtime case also checks the socket was refused, your own presence shows online, and with the server gone a rename waits as "Not synced" with no alert or dialog |
| L1 fixes | lead | (this commit) | A row the local copy can't hold is skipped and logged (`pull.row_skipped <table>`) instead of failing its page every pass; the refused toast ignores the count carried in the first status after start |

Checked: lint, typecheck, 1313 Vitest + 1 pytest, `test:sql` 11 files, `test:server` 7 files / 59 tests (before S32), `test:e2e` 62, sync and conflict specs `--repeat-each 3` (33). Docs: ADR 0012; ADR 0010 and 0011 consequences; architecture (3d-2b built, Security model, Versions); setup (new-app check, public access off, BitLocker, sign-out); migration plan ground rule 1 and status; owner-rules (nobody uses the old app). The owner chose (2026-10-21) to keep the money lock for steps 10–11.

5. **The owner's sign-in** (2026-10-21, "all good"): creators show, a rename and a notification switch made in the app; checked by SQL afterwards (true/false only): the owner's `notification_switches` row exists and their profile changed that day.
6. **"Allow public access" off** (the owner, by hand, under Realtime › Settings › Channel Restrictions; the plan's "Project Settings › Realtime" path was wrong, corrected in `docs/setup.md`): after a restart the app logs `live.subscribed sync`. R1 done.

L1 after the build: looked at in dark at 1440 px (the synced chip, "Not synced" with its tip, the conflict toast, the sign-in line about kept changes); a stage showed as its raw key in the conflict toast and notification, fixed (420163b). One `router-reviewer` pass: no blocker, 5 should-fix and 5 minor; fixed in b7b6597: Undo kept for your own changes when server data arrives (a test fails on the old merge), an undo during an upload adds a marker, rows skipped for a pending change are re-fetched, a refused conflict choice shows the conflict again, sign-out waits at most 5 s for the last sync, the whole-table refresh is queued, writes respect the back-off, a brand edit keeps the server's time. Two minor ones (out-of-order commits, the 90-day tombstone horizon) are recorded in ADR 0012 for later. The owner's Supabase email about explicit grants (from 2026-10-30) is recorded in `supabase/README.md` and `CLAUDE.md` (a6ca2ae). Checked after the fixes: lint, typecheck, 1318 Vitest, `test:sql` 11 files, `test:e2e` 62.

**Done (2026-10-21).** CI green on #12 at 7dd0619 (after fixing a CodeQL `js/polynomial-redos` finding in the e2e fake's filter parser and giving the sync specs' sign-in 15 s on the Windows runner), squash-merged as 72d644b, `main` merged back into the branch (44f10e8). Step 3d is complete.

Next session: step 3e (the Python pipeline), per `docs/migration-plan.md`. Start it with a fresh recon and plan; this file and `PLAN.md`/`CONTEXT.md` are 3d-2b's and can be replaced then (they stay in git history). Carried to 3e: an `r2-access` call with a real member's token and a presigned list against the real bucket (ADR 0011); the packaged build must ship `@supabase/realtime-js` with main (3h); the two known sync limits in ADR 0012.
