# Progress: step 3e-3 (the rest of the Python pipeline)

Prepared 2026-10-21, after 3e-1 merged (#14, dc13dd5; its task-by-task record is in git history at dc13dd5). Nothing of 3e-3 is built yet.

**Change of plan (owner, 2026-10-21): solo first.** All team work waits until the app is fully functional for one person; it is collected in the migration plan's step T (after step 9). That moved **3e-2 (R2 sharing) into T1**, so 3e-3 is next. 3e-3 must not touch `r2.py`, `sync.py` or anything team-only. Ground rule 8 and `docs/product/owner-rules.md` say the same.

## Where 3e stands

| Part | State |
|---|---|
| 3e-1 search on this computer | Done (#14). ADR 0013. 1469 Vitest, 350 pytest, e2e 63 passed |
| 3e-2 R2 sharing | Moved to step T1 (its outline stays in `PLAN.md`) |
| 3e-3 the rest | **Next.** Only the outline in `PLAN.md` exists. The full plan is not written yet: a `router-hard` run for it hit the usage limit on 2026-10-21 before it wrote anything. Start in a fresh session (§10 rule 5) |

## How to start 3e-3

1. **Write the plan first** (tier H, `router-hard`, plan §10 rule 1): recon `legacy/pipeline/` (comms, gemini_bridge with DAEMON.md and PROTOCOL.md, gmail, mailbox, feeds, tools and their tests) and `legacy/data/comms/`; replace the outline in `PLAN.md` with decisions, contracts (new job types on protocol v1), a task table in 3e-1's shape, and the questions only the owner can answer. Propose a split (3e-3a, 3e-3b) if it is too big for one pull request. Skip R2 and sync (step T1). Then get the owner's answers before building.
2. Branch `feat/3e-3-pipeline-rest` from `main`. Tiers follow plan §10; the lead reviews each task and runs `router-reviewer` over the diff before the PR.
3. Keep the 3e-1 rules: secrets only in the start message, `python -I`, no network in tests, pyright strict, each old test ported first and seen to fail.
4. Left for 3e-3 by 3e-1: the manual refetch (`run_manual_refetch`, used by import_handles) and the catch-up job's thread pool with its `[catchup-io]` lines; news, transcripts and the enrichment queries in `store.py`.
5. On hold, not built: `search-1`, `first-1`, `mail-1`, `mail-2`. Never send an email, never read the mailbox, one Gemini bridge run at a time.

Carried: the packaged build must ship `@supabase/realtime-js` with main (3h); the two known sync limits in ADR 0012. GitHub notes that code scanning isn't enabled for the repository, so CodeQL can't publish results (a repository setting, the owner's choice).
