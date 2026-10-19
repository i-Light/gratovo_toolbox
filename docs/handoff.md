# Hand-off

Where work stopped and exactly what to do next. Update this file at the end of every session, in the same commit as the work.

## Now

- **Date:** 2026-10-19
- **Plan step:** 0 done; **step 3 (foundation) is next, starting with 3a** (toolchain and skeleton).
- **Branch:** `main`. One commit: the fresh repository.
- **Owner actions still open:** A1 to A6 in [migration-plan.md §4](migration-plan.md#4-owner-actions). Before 3a, only **A2** (this repository on GitHub) and **A4** (stack confirmation, recorded as accepted) matter. Ask the owner about A1 (key rotation) before any step touches R2 or YouTube.

## What exists

- `docs/`: the plan, architecture, conventions, workflow, decisions 0001 to 0006, and the product record ([product/README.md](product/README.md)).
- `design/workbench-prototype/`: the approved prototype and its Playwright checks (all green on 2026-10-19).
- `legacy/`: the old app's source, read only ([legacy/ABOUT.md](../legacy/ABOUT.md)).
- `.claude/`: 27 project skills, the five `router-*` agents, and settings (plugins, deny rules for secret files).

## Next: step 3a, toolchain and repository skeleton

The goal and acceptance checks are in [migration-plan.md, step 3a](migration-plan.md#step-3-foundation). Concretely:

1. **Plan the step** with the `smart-task-router` skill. Write `.router/CONTEXT.md` (this repository is small: docs plus the prototype) and `.router/PLAN.md` for 3a.
2. **Workspace.**
   - `pnpm-workspace.yaml` covering `apps/*` and `packages/*`.
   - A root `package.json` with scripts `lint`, `typecheck`, `test`, `format`, `dev`, `build`.
   - `packageManager` pinned; `.npmrc` with `engine-strict=true` and `save-exact=true`; `.nvmrc` with the Node version.
3. **TypeScript:** a `tsconfig.base.json` with the strict options from [conventions.md](conventions.md#typescript); project references for each package.
4. **Packages:**
   - `packages/core`: an empty domain with one real export to prove the wiring, for example the `DEAL_FLOW` definition ported from the prototype's `data.js`, with a Vitest test.
   - `packages/ui`: the design tokens ported from `design/workbench-prototype/index.html` (`:root`, both dark blocks, density, sizes, motion) as `tokens.css`.
   - `packages/ipc`: zod, with one example channel schema.
5. **App:** `apps/desktop` via electron-vite (React and TypeScript) showing a blank frame that loads `tokens.css`. The secure `BrowserWindow` settings from [SECURITY.md](../SECURITY.md) go in from the first commit.
6. **Quality:** ESLint flat config (typescript-eslint strict-type-checked, react-hooks, jsx-a11y); Prettier; Vitest; Playwright with one Electron smoke test; lefthook (or simple-git-hooks) with lint-staged and gitleaks.
7. **Python:** `services/pipeline/` with `pyproject.toml` (uv), ruff, pyright, pytest and one placeholder test. The real port is step 3e.
8. **CI:** `.github/workflows/ci.yml` running lint, typecheck and tests on Ubuntu and Windows, plus gitleaks. Branch protection is set by the owner in GitHub settings; ask them.
9. **Record** the pinned versions in [architecture.md](architecture.md#versions).

**Done when:** a clean clone runs `pnpm install && pnpm lint && pnpm typecheck && pnpm test` and `uv run pytest` green; the Electron smoke test passes (on Linux CI use `xvfb-run`); CI is green on both systems.

**Then:** 3b (security baseline) and 3c (app shell from the prototype), each in its own pull request.

## Notes for whoever picks this up

- **Cloud sessions run on Linux;** the product targets Windows. Build and test on Linux; anything Windows-only (the NSIS installer, signing, Windows notifications) is proven in CI on a Windows runner (step 3h).
- **The prototype is the spec.** Before building a screen, open it (or read its `js/<screen>.js`) and its design notes (`js/plan.js`, the `WHY` notes).
- **The owner's comments** on the published prototype live in the artifact's `comments` collection (https://claude.ai/artifact/96e8HtK58oyRqVcYdUcZNn). A session without the Artifact tools asks the owner to paste them ("Copy open for Claude" in the prototype's comment list).
- **Don't** build the four gaps on hold, send email, read the mailbox, or delete anything in `legacy/` ([product/owner-rules.md](product/owner-rules.md)).

## Session log

| Date | Session | What happened |
|---|---|---|
| 2026-10-19 | Local (Opus) | The old repo committed (`43596b8`) and backed up. This repository created: plan, docs, decisions, product record, prototype, project skills, `legacy/` with secrets excluded. A security finding: the old repo's tracked `data/.env` holds live keys, so the owner must rotate them (A1). |
