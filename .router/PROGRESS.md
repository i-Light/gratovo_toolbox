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

**Stopped 2026-10-20 at the usage limit.** In flight when the session stopped (their files may be in the working tree, uncommitted and unverified): S9 (`main/sync/puller.ts`), S22 (`main/sync/uploader.ts` CAS branches), S23 (`main/sync/conflict-notices.ts`, `main/strings.ts`), S26 (`main/net/network.ts`, `apps/desktop/package.json`, `pnpm-lock.yaml`, `@supabase/realtime-js` 2.117.2). Next session: check `git status`; run each of those tasks' done_checks; commit what passes, re-run what doesn't. Then S11, S12, S16, S27 onward.
