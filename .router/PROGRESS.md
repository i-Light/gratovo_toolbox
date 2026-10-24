# Progress: step 4 (live data import and operational connections)

**Plan realigned** (owner, 2026-10-24): pipeline-first order and ground rules 9 and 10 are written into the migration plan (§2, §3, §5, §6) and `docs/workflow.md`. 3e-3b is done (PR #17). Its lessons moved to `docs/workflow.md`.

**Next: step 4**, from the migration plan's §6. Recon of `legacy/` (the `gratovo.db`, `pipeline.db` and `mailbox.db` schemas, `data/settings.json`, `data/keywords.json`, `pipeline/gemini_extension/`), then a new `.router/CONTEXT.md` and `.router/PLAN.md` with the contracts (Opus) and the build tasks (Sonnet). The `.router/PLAN.md` and `.router/CONTEXT.md` still on disk are 3e-3's and are replaced when step 4's plan is written.

**Testing for step 4** (ground rule 10): lint, typecheck, Vitest and pytest, plus at most one new Electron smoke test.
