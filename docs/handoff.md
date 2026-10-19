# Hand-off

Where work stopped and exactly what to do next. Update this file at the end of every session, in the same commit as the work.

## Now

- **Date:** 2026-10-19
- **Plan step:** 0 done; **3a built** (toolchain and skeleton). Next is **CI confirmation for 3a** on the pull request, then **3b** (security baseline).
- **Branch:** `claude/pensive-bell-7fy7xz`. Not merged. No pull request opened unless the owner asks.
- **Owner actions still open:** A1 to A6 in [migration-plan.md §4](migration-plan.md#4-owner-actions). For 3a: **A2** (the GitHub repository must exist for CI to run) and **A4** (stack confirmation, recorded as accepted). Ask the owner about A1 (key rotation) before any step touches R2 or YouTube.
- **Owner setup for CI:** the secret scan uses `gitleaks/gitleaks-action`. If the repository belongs to an organisation, it needs a `GITLEAKS_LICENSE` secret. Branch protection on `main` is still to be set (step 3g).

## Verified in 3a (on Linux, 2026-10-19)

- On a fresh clone of the commit: `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck` and `xvfb-run -a pnpm test` (Vitest 12 tests, the Electron smoke test, pytest 1) all pass.
- **Not yet verified:** Windows, and the CI run itself. Check the Actions run on the pull request before calling 3a done.

## What exists

- `docs/`: the plan, architecture, conventions, workflow, decisions 0001 to 0007, and the product record ([product/README.md](product/README.md)).
- `design/workbench-prototype/`: the approved prototype and its Playwright checks (all green on 2026-10-19).
- `legacy/`: the old app's source, read only ([legacy/ABOUT.md](../legacy/ABOUT.md)).
- `apps/desktop/`: the Electron shell. A blank window with the secure settings and the design tokens. Electron test in `e2e/`.
- `packages/core`: the deal flow (`DEAL_FLOW`, ported from the prototype). `packages/ui`: the design tokens (`tokens.css`, copied from the prototype). `packages/ipc`: zod schemas for IPC channels (one: `app:ping`).
- `services/pipeline/`: a uv project with ruff, pyright and pytest, and one placeholder test.
- Root: pnpm workspace, ESLint, Prettier, Vitest, lefthook hooks (prettier, eslint, ruff, gitleaks if installed), `.github/workflows/ci.yml`.
- `.claude/`: 27 project skills, the five `router-*` agents, and settings (plugins, deny rules for secret files).

## Next

1. **Confirm CI for 3a.** Push the branch and check the Actions run on Ubuntu and Windows. If Windows fails, fix it in this branch. Do not call 3a done until both systems are green.
2. **Step 3b, security baseline** (migration plan §6). Start with `.router/`: write `PLAN.md` for 3b. Scope: the typed IPC bridge, the navigation and permission guards that already exist (check them against SECURITY.md), the `secrets` module on `safeStorage`, CSP and fuses, and the CI jobs for gitleaks, audit, CodeQL and Dependabot.
3. Keep the checks green on every change: `pnpm lint`, `pnpm typecheck`, `xvfb-run -a pnpm test` on Linux, and `uv run --directory services/pipeline pytest`.

**Open for the owner:** A2 (create the GitHub repository) and A4. Upgrades held back by version: [decisions/0007-toolchain-pins.md](decisions/0007-toolchain-pins.md).

## Notes for whoever picks this up

- **Cloud sessions run on Linux;** the product targets Windows. Build and test on Linux; anything Windows-only (the NSIS installer, signing, Windows notifications) is proven in CI on a Windows runner (step 3h).
- **The prototype is the spec.** Before building a screen, open it (or read its `js/<screen>.js`) and its design notes (`js/plan.js`, the `WHY` notes).
- **The owner's comments** on the published prototype live in the artifact's `comments` collection (https://claude.ai/artifact/96e8HtK58oyRqVcYdUcZNn). A session without the Artifact tools asks the owner to paste them ("Copy open for Claude" in the prototype's comment list).
- **Don't** build the four gaps on hold, send email, read the mailbox, or delete anything in `legacy/` ([product/owner-rules.md](product/owner-rules.md)).

## Session log

| Date | Session | What happened |
|---|---|---|
| 2026-10-19 | Local (Opus) | The old repo committed (`43596b8`) and backed up. This repository created: plan, docs, decisions, product record, prototype, project skills, `legacy/` with secrets excluded. A security finding: the old repo's tracked `data/.env` holds live keys, so the owner must rotate them (A1). |
| 2026-10-19 | Cloud (Haiku 5.5) | Step 3a: planned with `smart-task-router` (`.router/`), toolchain and skeleton built, pins recorded (ADR 0007). Local checks green on Linux; CI not yet confirmed. |
