# Progress: step 4 (live data import and operational connections): done

**Step 4 is done** (2026-10-24, ADR 0016). **Next: step 5 (Find)**, in a fresh session, from the migration plan's §5 and §6. Start a new `.router/CONTEXT.md` and `.router/PLAN.md` for it and rewrite this file. Notes for step 5: the Find rail subtitle still says "Search, triage, contacts" while only Search is wired in live mode; Find › triage, gallery and contacts tabs, Toolbox › Archive, Never-contact and Activity log turn on in `renderer/lib/wired.ts`; `archiveDays` (find.json, kept in main) is read by the reject.

**Plan realigned** (owner, 2026-10-24): pipeline-first order and ground rules 9 and 10 are in the migration plan and `docs/workflow.md` (PR #18). 3e-3's lessons moved to `docs/workflow.md`.

Branch `feat/4-live-data-and-connections`, from `docs/plan-pipeline-first` at 8e2614f; `main` (#18, 59e9482) merged in. The plan is `.router/PLAN.md` (decisions D1 to D15, contracts, tasks). Recon in `.router/CONTEXT.md`.

**Rules for this step:** never send email or read the mailbox (fakes only); no Gemini prompt is sent (the bridge is only started and the add-on connected); the old `gratovo.db` is opened read-only and never written; no secret is printed, logged or copied (Gmail token files and `.env` are never read). Testing per ground rule 10: lint, typecheck, Vitest, pytest, plus one Electron smoke test.

## Tasks

| id | tier | state | note |
|---|---|---|---|
| C1a | H | done | IPC contracts (`packages/ipc/src/{import,connections,gemini,writing}.ts`), frame `source`, `main/services.ts` + `stub-services.ts`; failures are values; `rules:set` on the find service; `archiveDays` stays in main (`pipelineRules()`) |
| C1b | H | done | `import.legacy` in the `store` lane (there is no "main" lane); example data refused with `bad_start`; end codes `source_unreadable`, `not_sqlite`, `no_channels_table`, `source_in_data_dir`, `store_too_new`; `progress` line counts tables |
| B1 | N | done | `lib/wired.ts` (`startRoute`, `defaultRoute`, `isRouteShown`…); `ui.importState` + `setImportState` for B10 ("unknown" at start → Find › Search until B10 feeds it); Profile's "Roles in Team" hidden in live; `routeFromHash` wrapped by `startRoute` (circular import) |
| B2 | N | done | 18 tests; read-only proven (bytes + mtime); FK guard drops orphans; dry run never creates the destination. **Follow-up (lead):** open with `immutable=1` and refuse when a non-empty `-wal` sits beside the old file (`old_app_open`), so nothing is ever created beside it |
| B3 | N | done | `SignalBounds` in config, `signals_verdict`/`sweep_by_signals` in auto_clean, label = `autoClean.label`; on a bound = kept; no videos = 0; failed fetch untouched. Stale docstrings to fix in L1: `config.py` `AutoCleanRule`, `protocol.py` "B3 decides" |
| B4 | N | done | `createImporter`; ipc reasons `own_data`, `example_data`, `no_data`, `not_found`, `no_channels`; `runStoreJob(start, onProgress)` + `storeOutcomeOf`; `rulesFromOldFiles` in find-store; a stopped import reports `failed` |
| B5 | N | done | `DataSource.readSetting/writeSetting/seedChannelNames` (in `packages/core`); `createConnectionsService` + `addMailbox`, `startSettings`; `playbookRulesDir`, `createWritingRulesService`; method `removeGateways`. **W1 checks:** B5 reads `import` as `{at, backup}`, B4 writes `{at, source, counts, backup}` (must parse); `handlers.test.ts` `sourceWith()` needs the three new methods |
| B6 | H | done | `mail/consent.ts`, `listenOnLoopback` in `net/network.ts`, `isGoogleConsentUrl`; ipc reasons `bad_state`, `bad_response`, `exchange_failed`, `no_refresh_token`. **W1:** move the browser page words (`pageText`) to `main/strings.ts`; check the 20-mailbox cap before opening the browser; own `createNetwork` for `oauth2.googleapis.com` |
| B7 | H | done | token in env, removed from env on read, stripped from the hello before storing; `moz-extension://` origins always need it (an add-on can't claim "edge" to skip it); first `ensure_window` of a run reinstalls the add-on (stale token); `createGeminiControl`, `findExtensionDir`, `geminiLaunchOptions`; daemon `reason: bad_token`. **D1:** ADR 0014's "needs no secrets" no longer holds |
| B8 | N | done | copied tree, 0.4.0, token in hello and `bridge-token.js`; 45 pytest + 96 node tests (`pnpm test` runs them, ~1 min) |
| B9 | N | done | both sections real; Find's rules card has "Edit rules"; no Undo on save (`rules:set` is IPC, not `act`) |
| B10 | N | done | `connections-section.tsx` + `connections/` (12 rows), import dialog, `app/first-run.ts`; set-only secret inputs; inline confirms. Tidy later: `routing-rows.tsx` (493 lines) and `gmail-rows.tsx` (381) are over the ~300 guide |
| W1 | N | done | real services in `index.ts`; Gemini log blanks the token; `canAddMailbox` pre-check; consent page words in `main/strings.ts`; Gemini stops on every source switch via `reloadWindow`; `stub-services.ts` kept for tests only |
| F1 | N | done | rehearsal re-run on a fresh copy: only `gratovo.db` left beside it. Was: **after W1 and B10:** the old file opened `mode=ro&immutable=1`; a non-empty `-wal` beside it → end code `old_app_open` (Python, protocol both sides, ipc reason, B4 mapping, B10 words). Found by the rehearsal: `mode=ro` created `-shm`/`-wal` beside the copy |
| T1 | N | done | `e2e/live-gate.spec.ts` (owner, live): rail shows Find only (Settings is in the account menu), first-run lands on Connections, Python row and "Not brought in yet", palette has no Go to Today; plus smoke/settings/frame specs 13/13 locally |
| D1 | N | done | ADR 0016, architecture, SECURITY, pipeline README, parity note on the AWS row |
| R1 | H | done | review fixes: import path realpath + `data_dir.parent`, runs dedupe on (started_at, kind) and `running`→`interrupted`, import state written before best-effort steps, UNC refusal, `protocolVersion`, keyword.py `finally` |
| R2 | H | done | review fixes: consent ignores wrong state (404, no settle), `email_verified` must be true, revoke the token when saving fails, cheap `mailboxCount()`, no `mail` in search starts, Gemini stop tied to source open/close, split `connections-service.ts` |
| R3 | N | done | review fix: one component per file under `renderer/settings/connections/` and `search-rules-section.tsx` |
| L1 | lead | done | full checks green; rehearsal; review (0 blockers, 3 important, 9 minor: all fixed); import warnings shown in the dialog; the Connections callout says what isn't set up instead of "everything works"; looked at in dark at 1440 px (Connections, import dialog, Search rules view and edit, Writing rules, Find) |

## Rehearsal (lead, 2026-10-24)

On a copy (in the session scratchpad, deleted afterwards) of the owner's newest old database, `E:\IMA work\Code\Ze OLD CODE\gratovo_code\data\database\gratovo.db` (1.21 GB, 2026-10-19), with its four non-secret settings files beside it. The job was run directly (`import_legacy.run`), as its tests do.

- Dry run, 0.1 s: keywords 1,487, channels 2,373, channel_keywords 7,584, videos 35,448, channel_archive 104,341, runs 234, video_transcripts 1, all "to add"; destination not created. Skipped: 30 tables (channel_state 15,606, activity_log 365 and the rest "synced"; news 79 rows "not-ported"; R2 and sync bookkeeping). Unsent old work: 1 outbox row, 1 activity row. Settings files: all four found.
- Real import, 3.1 s: the same counts added. No backup (the destination was new).
- Second real import, 1.8 s: backup made (`pipeline-<stamp>.db`), 0 added, everything "already here".
- The source file's SHA-256 and mtime were unchanged. **But `gratovo.db-shm` and `gratovo.db-wal` appeared beside the copy** (the old file is in WAL mode and `mode=ro` still creates them): task F1.
