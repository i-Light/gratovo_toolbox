# Workflow

## Git

- `main` is always releasable: changes land through pull requests that passed `pnpm verify` on the owner's Windows PC (below). GitHub Actions is manual only (owner, 2026-10-25: the account's minutes ran out, and nothing should need GitHub to be checked). Branch protection isn't available on the free plan for a private repository.
- One branch per piece of work: `type/short-description` (`feat/`, `fix/`, `docs/`, `chore/`, `refactor/`, `test/`). Cloud sessions may use their own `claude/...` branch names.
- Commits are small and say why. The subject is in the imperative and under about 70 characters; the body says what changed and why. Commits made by Claude end with the co-author line.
- Never force-push a shared branch, never rewrite `main`, never commit secrets (see [SECURITY.md](../SECURITY.md)).
- Commits and pushes happen when the owner asks, or as the planned end of a plan step.

## How a plan step runs

1. **Start.** Read the [migration plan](migration-plan.md): its status table (§5) says which step is next, and the step says what done means. If `.router/PROGRESS.md` exists, a step is in progress: carry on from it. Write the step's working plan with the `smart-task-router` skill: `.router/CONTEXT.md` and `.router/PLAN.md`, with tasks, tiers and done-checks.
2. **Build** in small tasks, each with a check (a test, typecheck, lint, a screenshot). Use the skills listed in [CLAUDE.md](../CLAUDE.md). Build in pipeline order, and keep anything not wired to real data hidden in live mode (ground rule 9 of the plan).
3. **Verify** in two tiers (ground rule 10 of the plan, owner 2026-10-24):
   - **Every sub-step's pull request:** `pnpm lint`, `pnpm typecheck` and `pnpm test` (Vitest and pytest), plus at most one new, light Electron smoke test that the new screen renders and completes its main IPC round trip. The Electron tests that already exist still run, in `pnpm verify`.
   - **At the end of a major step:** the full Playwright flow suite for that stage (the keyboard matrix, undo edge cases, the parity flows) in one batch.

   Then look at the result yourself: dark, at desktop width (1440 px). No light-theme checks (the app is dark only for now) and no phone or narrow-width checks (owner, 2026-10-20).
4. **Review.** Run an independent reviewer (the `router-reviewer` agent, or a fresh agent), fix what it finds, and re-run the checks.
5. **Finish.** Update the plan's status table, and remove `.router/` if the step is complete (anything worth keeping moves into these docs first). Commit, push the branch, and open a pull request that lists what was checked and how.
6. **Merge.** When `pnpm verify --status` has passed on the branch's last commit (it marks that commit green on GitHub as "local verify", which costs no Actions minutes) and the review findings are fixed, the session merges its own pull request. The owner doesn't merge or do anything by hand on GitHub (their rule of 2026-10-19).
7. **Owner check.** The owner tries it in the real app (from step 7, with prototype mode on for screens not wired yet) and comments. Their comments start the next round.

**Stopping mid-step.** Commit the work in progress on the branch, with `.router/PROGRESS.md` saying exactly where you stopped and what is next. There is no hand-off file (the owner removed it on 2026-10-20). A cloud session sees only what is pushed.

## The local gate: `pnpm verify` (since 2026-10-25)

Every check CI used to run, on this computer, in this order (`tooling/verify.ts`). The first failure stops the run, and the summary says how long each step took.

| Step | Runs |
|---|---|
| deps | `pnpm install --frozen-lockfile` (the lockfile matches); uv runs with `UV_LOCKED=1` |
| secrets | gitleaks over every local branch's history (known false positives in `.gitleaksignore`) |
| audit | OSV-Scanner over `pnpm-lock.yaml` and `services/pipeline/uv.lock` |
| lint | ESLint, Prettier check, ruff |
| typecheck | `tsc -b`, pyright |
| test | Vitest, pytest |
| e2e | Playwright against the Electron build, on example data |
| sql | Supabase migrations plus SQL and RLS tests in Docker |
| server | the app's sign-in and sync against a throwaway local Supabase stack in Docker |

- **sql and server run only when they matter:** when the branch touches `supabase/`, `legacy/backend/schema.sql`, or the code the server tests import (`apps/desktop/src/main/` `supabase`, `sync`, `net`, `db`, `data`, `secret-store.ts`), or with `pnpm verify --server`. They start Docker Desktop when it isn't running. The Supabase CLI comes through `npx` at the pinned version, as in [setup.md](setup.md).
- **`--from=<step>`** starts again at a step after a fix. **`--status`** posts the green mark on GitHub; it needs a full run and a clean tree.
- **Not repeated locally:** CodeQL. Its workflow job still exists and runs only when started by hand (`workflow_dispatch`), so only on the owner's say. A security-sensitive change gets the `sentry-security-review` skill in its review instead.
- **About 10 minutes** without the Docker steps: lint, typecheck and tests about 5, the Electron build and tests about 2, the rest seconds.

## Releases (from step T5)

- The version follows SemVer from commit types: `feat` → minor, `fix` → patch, breaking → major.
- A tag `vX.Y.Z` builds the Windows installer and publishes it to the private release location (migration plan §9 Q12). Builds are unsigned by the owner's choice.
- The release notes come from the merged pull requests.

## The prototype

The spec is `design/workbench-v6/` since 2026-10-27 (ADR 0021). Open its `index.html` to run it. Another AI made it with little input from the owner, so question it, and ask the owner where it differs from what is built on a matter of taste. `design/workbench-prototype/` (v3, with its tests and notes) is the earlier version, kept for reference; the token, icon, avatar and `DEAL_FLOW` drift tests read v6. Both folders stay until step 11. Since step P the real app in prototype mode is where design changes are tried and commented on. The published copy at https://claude.ai/artifact/96e8HtK58oyRqVcYdUcZNn is v3. Republishing it needs a session with the Artifact tool, and the owner's comments on it live in its `comments` collection.

## Setting up and things to know

- **Cloud sessions run in Linux containers;** the app is Windows only. In a container, edit the code and run `pnpm lint`, `pnpm typecheck` and `pnpm test`. The Electron tests run only on the owner's Windows PC (`pnpm verify`); don't set them up in the container. A cloud session's pull request isn't merged until a Windows session has run `pnpm verify` on it.
- **On a Windows machine** (the owner's PC, 2026-10-20): Node 24.22.0 as a portable copy in `~/.local/opt/node-v24.22.0-win-x64` (put it first on `PATH`), with pnpm 12.14.0 installed into it; `uv`, `gitleaks`, `osv-scanner` and `gh` in `~/.local/bin`, which is on the user's `PATH`. OSV-Scanner is v2.7.0, `osv-scanner_windows_amd64.exe` from its GitHub release saved as `osv-scanner.exe`, checked against the release's `osv-scanner_SHA256SUMS`. Docker Desktop is installed for the sql and server steps. gh isn't logged in: git's stored login lacks the `read:org` scope `gh auth login` wants, so each gh command gets it as `GH_TOKEN` read from `git credential fill` (never printed). In Git Bash, `unset ELECTRON_RUN_AS_NODE` before the Electron tests (it was set in one shell, and every launch failed). One spec: `cd apps/desktop && pnpm exec playwright test e2e/<file>` after `pnpm build` (`pnpm test:e2e -- <file>` doesn't filter).
- **Tools a cloud container lacks** (it has Node 22, pnpm 10 and uv 0.11, and no gitleaks). Node 24.22.0 from nodejs.org (check `SHASUMS256.txt`) unpacked under `/root/.local/opt/`, then `npm i -g pnpm@12.14.0` with that Node first on `PATH`. uv: `UV_TOOL_BIN_DIR=/root/.local/opt/uv-bin uv tool install uv==0.13.1`. gitleaks: `GOBIN=/root/.local/bin go install github.com/zricethezav/gitleaks/v8@v8.30.1` (GitHub release downloads are blocked there; the Go proxy is not).
- **What step 3b left for later steps:**
  - Each Electron test gets a fresh data folder (`GRATOVO_USER_DATA`, read only by unpackaged builds), and `pnpm dev` uses "Gratovo Toolbox (dev)", so neither touches the installed app's data or its single-instance lock.
  - The fuse `EnableEmbeddedAsarIntegrityValidation` needs the packager (3h) to write the archive's hash into the app.
  - Dependabot's first run was due on the Monday after 3b merged. Check that it works with pnpm 12 (its runs appear under Actions as "Dependabot Updates"), then treat its pull requests like any other. As of 2026-10-19 21:10 UTC (that Monday) no Dependabot run or pull request had appeared yet: check again.
  - A new advisory fails the audit step of `pnpm verify`. Fix it, or record a reviewed exception (ADR 0008 says how).
- **A test run opens on the second screen** (owner, 2026-10-25): an unpackaged app started with `GRATOVO_USER_DATA` (every Electron test and the lead's screenshot scripts) opens at the top-left corner of the screen that isn't the main one, and doesn't take the keyboard (`showInactive`). With one screen, Windows places it. `pnpm dev` and the installed app are unchanged (`apps/desktop/src/main/window.ts`).
- **Electron 44 downloads its binary on first use,** not at install. The `dev`, `preview` and `test:e2e` scripts run `install-electron` first (it checks the download against Electron's own checksums and exits at once when the binary is there).
- **`minimumReleaseAge` is one day.** A version published in the last 24 hours won't install: pick the one before it.
- **The prototype is the spec.** Before building a screen, open `design/workbench-v6/` (or read its `js/<screen>.js`) and its design notes (`js/plan.js`, the `WHY` notes). The token and `DEAL_FLOW` tests fail if the prototype and the port drift apart; change both together.
- **The owner's comments** on the published prototype live in the artifact's `comments` collection (https://claude.ai/artifact/96e8HtK58oyRqVcYdUcZNn). A session without the Artifact tools asks the owner to paste them ("Copy open for Claude" in the prototype's comment list).
- **Don't** build the four gaps on hold, send email, read the mailbox, or delete anything in `legacy/` ([owner-rules.md](product/owner-rules.md)).

## Lessons

Each of these cost a CI round or a review finding (step 3c).

- happy-dom doesn't check focus rules: an element inside something `visibility: hidden` can't take focus in Chromium, and component tests still pass. Cover focus in the Electron tests.
- Playwright's `getByText(…, { exact: true })` compares an element's whole text, children included ("Undone" plus its sub line never matches); find toasts by role and the words they contain. `keyboard.press("Shift+/")` sends `/`: press `"?"`.
- In Electron, `@axe-core/playwright` needs `setLegacyMode(true)`: its default mode opens a new page, which an Electron app can't.
- A modal `<dialog>` sits in the browser's top layer: what must show above it renders through `Floating` (overlays/floating.tsx). Moving an element restarts its CSS animations; the toasts put theirs back (`onFloatingMoved`).
- Run the Electron tests (`pnpm verify`, or `pnpm test:e2e`) before opening a PR with new Electron tests: their first run has found a real bug or a wrong locator every time.
- Don't commit while a build agent is still writing files: one agent's staged files were swept into another task's commit (da9ceb1). Stage named paths and commit once agents are done. Tell agents not to stage at all: in step 5 an agent had `git add`ed its half-done tests, and the lead's `git add <paths> && git commit` took the whole index into another task's commit. Check `git diff --cached --stat` before each commit (5d-2).
- After a pull request is squash-merged, bring `main` into the branch with a merge commit before new work. CLAUDE.md forbids force-pushes, so don't reset and force-push the branch.
- Main's CI once timed out starting the app on a busy runner (the re-run passed); app start-up in the e2e fixture now has its own 60 s limit. A failure there again is worth a real look, not a re-run.
- Don't wait for the app's page with `page.waitForURL` in Electron: it waits for a load or navigation event that can fire before Playwright listens, and hung once with the frame on screen. Poll the URL (`expect(page).toHaveURL`), as the fixture now does.
- A role-and-name locator by prefix (`^Notifications`) also matched the Settings section button. Anchor names at both ends.
- lefthook on Windows can't run a multi-line `run:` script: put the script in a file (`tooling/hooks/`).
- The lead's screenshot scripts are in [lead-scripts.md](lead-scripts.md). Accessibility is checked by `e2e/accessibility.spec.ts`.
- Production rollouts through the Supabase MCP (3d-2a): the owner's MCP has no `get_project` or `get_advisors`, so check by SQL (owners, `has_function_privilege`, `has_table_privilege` for `anon` and `authenticated`) and ask the owner to look at the Data API's exposed schemas. Claude Code's permission check holds SQL that grants an account rights until the owner says "go" for that exact step. To prove a definer function works for a member without handling their token, run it as them inside a rolled-back transaction (`set_config('request.jwt.claims', …, true)`, `set local role authenticated`) and select only true or false.
- Python's `write_text` on Windows writes CRLF, and a heredoc or the editor can turn `\r`, `\n` and ` ` in a replacement into real characters. Patch with a script file that reads and writes bytes, then grep the result. A raw U+2028 ends a JavaScript regex literal. Shell heredocs also eat backslashes (3e-3).
- CodeQL fails CI on any result, and treats anything read out of a `secrets` object as secret, even a mailbox address. Keep values that go to stdout apart from the secrets at the protocol boundary, keep text from outside on one log line, and never log a value from a request (3e-3). The CI step prints each result's sources, so a result can be traced from the log.
- Git Bash finds Node 24.19 first: put `~/.local/opt/node-v24.22.0-win-x64` first on `PATH` before `pnpm install`.
- A send is not idempotent: never retry it after the request may have reached the server (3e-3b).
- Agents running at once must not share files, and the pre-commit hook (lint-staged) stashes unstaged changes while it runs: the lead commits named paths once every agent is done.
- Still owed by later steps: the packaged build ships `@supabase/realtime-js` with main, and Deno plus `yt-dlp-ejs` for subtitles (T5); the two known sync limits in ADR 0012. Code scanning isn't enabled for the repository (the owner's choice). The owner's files under `design/` aren't part of any step unless the owner says so.
- Tell every agent that shares the working tree never to run `git stash`, `git reset` or `git checkout -- <file>`: in step 4 one agent's stash and pop emptied every other agent's edits from the tree for a minute. Commit only from the lead, once no agent is running. Never park files in `git stash` around a commit either: when the pre-commit hook fails, lint-staged leaves its own backup stash, and a later pop takes the wrong entry (5d-2).
- A contracts task that stubs a job must not add a test asserting the stub's failure. The build task replaces the stub, and such a test can pass locally by accident (the job crashed on this machine's environment) and fail on CI (5d's C4).
- SQLite in WAL mode: a read-then-write transaction can't wait for the lock, so a parallel search crashed with "database is locked" (3 runs in 100 under load). Open write transactions with `BEGIN IMMEDIATE` (`_atomic` in `store.py`), and a two-connection test proves it waits (5d-2).
- A test that builds "today's" data from a time an hour back fails just after midnight (5c's gallery test). Build it from local midnight or a fixed clock.
- The import rehearsal must run on a copy of the old database: a read-only SQLite open of a WAL-mode file still creates `-shm` and `-wal` beside it (step 4, ADR 0016).
- CodeQL doesn't count `Math.min(x, cap)` or `Object.prototype.hasOwnProperty.call` as making a value safe: bound a timer with an explicit comparison (`x > 0 && x <= cap ? x : fallback`) and dispatch by name through a `Map` (step 4, the ported add-on).
