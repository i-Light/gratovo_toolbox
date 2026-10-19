# Workflow

## Git

- `main` is always releasable and protected (from step 3g): changes land through pull requests with green CI.
- One branch per piece of work: `type/short-description` (`feat/`, `fix/`, `docs/`, `chore/`, `refactor/`, `test/`). Cloud sessions may use their own `claude/...` branch names.
- Commits are small and say why. The subject is in the imperative and under about 70 characters; the body says what changed and why. Commits made by Claude end with the co-author line.
- Never force-push a shared branch, never rewrite `main`, never commit secrets (see [SECURITY.md](../SECURITY.md)).
- Commits and pushes happen when the owner asks, or as the planned end of a plan step.

## How a plan step runs

1. **Start.** Read the [migration plan](migration-plan.md): its status table (§5) says which step is next, and the step says what done means. If `.router/PROGRESS.md` exists, a step is in progress: carry on from it. Write the step's working plan with the `smart-task-router` skill: `.router/CONTEXT.md` and `.router/PLAN.md`, with tasks, tiers and done-checks.
2. **Build** in small tasks, each with a check (a test, typecheck, lint, a screenshot). Use the skills listed in [CLAUDE.md](../CLAUDE.md).
3. **Verify** the step's acceptance checks, then look at the result yourself: dark, at desktop width (1440 px). No light-theme checks (the app is dark only for now) and no phone or narrow-width checks (owner, 2026-10-20).
4. **Review.** Run an independent reviewer (the `router-reviewer` agent, or a fresh agent), fix what it finds, and re-run the checks.
5. **Finish.** Update the plan's status table, and remove `.router/` if the step is complete (anything worth keeping moves into these docs first). Commit, push the branch, and open a pull request that lists what was checked and how.
6. **Merge.** When CI is green and the review findings are fixed, the session merges its own pull request. The owner doesn't merge or do anything by hand on GitHub (their rule of 2026-10-19).
7. **Owner check.** The owner tries it, with prototype mode on for new screens, and comments. Their comments start the next round.

**Stopping mid-step.** Commit the work in progress on the branch, with `.router/PROGRESS.md` saying exactly where you stopped and what is next. There is no hand-off file (the owner removed it on 2026-10-20). A cloud session sees only what is pushed.

## Continuous integration (from step 3g)

| Job | Runs |
|---|---|
| lint | ESLint, Prettier check, ruff |
| typecheck | `tsc --noEmit` on every package, pyright |
| unit | Vitest, pytest |
| e2e | Playwright against the Electron build on Windows, on example data |
| sql | Supabase migrations plus SQL and RLS tests in Docker |
| security | gitleaks, OSV-Scanner (dependency audit), CodeQL; also weekly |

## Releases (from step 3h)

- The version follows SemVer from commit types: `feat` → minor, `fix` → patch, breaking → major.
- A tag `vX.Y.Z` builds the Windows installer and publishes it to the private release location (migration plan §9 Q12). Builds are unsigned by the owner's choice.
- The release notes come from the merged pull requests.

## The prototype

`design/workbench-prototype/` stays runnable until step 11. Changes to the design are tried there first when that is faster than in the real app. The published copy is at https://claude.ai/artifact/96e8HtK58oyRqVcYdUcZNn. Republishing it needs a session with the Artifact tool, and the owner's comments on it live in its `comments` collection.

## Setting up and things to know

- **Cloud sessions run in Linux containers;** the app is Windows only. In a container, edit the code and run `pnpm lint`, `pnpm typecheck` and `pnpm test`. The Electron tests run on Windows in CI; don't set them up in the container.
- **On a Windows machine** (the owner's PC, 2026-10-20): Node 24.22.0 as a portable copy in `~/.local/opt/node-v24.22.0-win-x64` (put it first on `PATH`), with pnpm 12.14.0 installed into it; `uv`, `gitleaks` and `gh` in `~/.local/bin`, which is on the user's `PATH`. gh isn't logged in: git's stored login lacks the `read:org` scope `gh auth login` wants, so each gh command gets it as `GH_TOKEN` read from `git credential fill` (never printed). In Git Bash, `unset ELECTRON_RUN_AS_NODE` before the Electron tests (it was set in one shell, and every launch failed). One spec: `cd apps/desktop && pnpm exec playwright test e2e/<file>` after `pnpm build` (`pnpm test:e2e -- <file>` doesn't filter).
- **Tools a cloud container lacks** (it has Node 22, pnpm 10 and uv 0.11, and no gitleaks). Node 24.22.0 from nodejs.org (check `SHASUMS256.txt`) unpacked under `/root/.local/opt/`, then `npm i -g pnpm@12.14.0` with that Node first on `PATH`. uv: `UV_TOOL_BIN_DIR=/root/.local/opt/uv-bin uv tool install uv==0.13.1`. gitleaks: `GOBIN=/root/.local/bin go install github.com/zricethezav/gitleaks/v8@v8.30.1` (GitHub release downloads are blocked there; the Go proxy is not).
- **What step 3b left for later steps:**
  - Each Electron test gets a fresh data folder (`GRATOVO_USER_DATA`, read only by unpackaged builds), and `pnpm dev` uses "Gratovo Toolbox (dev)", so neither touches the installed app's data or its single-instance lock.
  - The fuse `EnableEmbeddedAsarIntegrityValidation` needs the packager (3h) to write the archive's hash into the app.
  - Dependabot's first run was due on the Monday after 3b merged. Check that it works with pnpm 12 (its runs appear under Actions as "Dependabot Updates"), then treat its pull requests like any other. As of 2026-10-19 21:10 UTC (that Monday) no Dependabot run or pull request had appeared yet: check again.
  - A CodeQL result or a new advisory turns CI red. Fix it, or record a reviewed exception (ADR 0008 says how).
- **Electron 44 downloads its binary on first use,** not at install. The `dev`, `preview` and `test:e2e` scripts run `install-electron` first (it checks the download against Electron's own checksums and exits at once when the binary is there).
- **`minimumReleaseAge` is one day.** A version published in the last 24 hours won't install: pick the one before it.
- **The prototype is the spec.** Before building a screen, open it (or read its `js/<screen>.js`) and its design notes (`js/plan.js`, the `WHY` notes). The token and `DEAL_FLOW` tests fail if the prototype and the port drift apart; change both together.
- **The owner's comments** on the published prototype live in the artifact's `comments` collection (https://claude.ai/artifact/96e8HtK58oyRqVcYdUcZNn). A session without the Artifact tools asks the owner to paste them ("Copy open for Claude" in the prototype's comment list).
- **Don't** build the four gaps on hold, send email, read the mailbox, or delete anything in `legacy/` ([owner-rules.md](product/owner-rules.md)).

## Lessons

Each of these cost a CI round or a review finding (step 3c).

- happy-dom doesn't check focus rules: an element inside something `visibility: hidden` can't take focus in Chromium, and component tests still pass. Cover focus in the Electron tests.
- Playwright's `getByText(…, { exact: true })` compares an element's whole text, children included ("Undone" plus its sub line never matches); find toasts by role and the words they contain. `keyboard.press("Shift+/")` sends `/`: press `"?"`.
- In Electron, `@axe-core/playwright` needs `setLegacyMode(true)`: its default mode opens a new page, which an Electron app can't.
- A modal `<dialog>` sits in the browser's top layer: what must show above it renders through `Floating` (overlays/floating.tsx). Moving an element restarts its CSS animations; the toasts put theirs back (`onFloatingMoved`).
- Run Windows CI by workflow_dispatch before opening a PR with new Electron tests: their first run has found a real bug or a wrong locator every time.
- Don't commit while a build agent is still writing files: one agent's staged files were swept into another task's commit (da9ceb1). Stage named paths and commit once agents are done.
- After a pull request is squash-merged, bring `main` into the branch with a merge commit before new work. CLAUDE.md forbids force-pushes, so don't reset and force-push the branch.
- Main's CI once timed out starting the app on a busy runner (the re-run passed); app start-up in the e2e fixture now has its own 60 s limit. A failure there again is worth a real look, not a re-run.
- Don't wait for the app's page with `page.waitForURL` in Electron: it waits for a load or navigation event that can fire before Playwright listens, and hung once with the frame on screen. Poll the URL (`expect(page).toHaveURL`), as the fixture now does.
- A role-and-name locator by prefix (`^Notifications`) also matched the Settings section button. Anchor names at both ends.
- lefthook on Windows can't run a multi-line `run:` script: put the script in a file (`tooling/hooks/`).
- The lead's screenshot scripts are in [lead-scripts.md](lead-scripts.md). Accessibility is checked by `e2e/accessibility.spec.ts`.
