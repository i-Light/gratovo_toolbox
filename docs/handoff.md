# Hand-off

Where work stopped and exactly what to do next. Update this file at the end of every session, in the same commit as the work.

## Now

- **Date:** 2026-10-19
- **Plan step:** **3b (security baseline) is done** (pull request #4). Before it: 3a ([#1](https://github.com/i-Light/gratovo_toolbox/pull/1)), TypeScript 7 with the linter on TypeScript 6 ([#2](https://github.com/i-Light/gratovo_toolbox/pull/2)), Windows only ([#3](https://github.com/i-Light/gratovo_toolbox/pull/3)). **3c (the app shell from the prototype) is next**, on a branch brought up to date with `main`.
- **Windows only** (the owner's rule, 2026-10-19): the app is built, tested and supported on Windows alone. Put no effort into Linux or macOS until the owner asks.
- **GitHub is the session's job.** Open the pull request, get CI green, fix the review findings, merge it. Never ask the owner to merge or do anything by hand on GitHub ([owner-rules.md](product/owner-rules.md)). That includes Dependabot's pull requests.
- **Owner actions still open:** A1 and A3 in [migration-plan.md §4](migration-plan.md#4-owner-actions). A2 is done (this repository is on GitHub); A4 is recorded as accepted; A5 and A6 are done: all twelve open questions were answered on 2026-10-19 ([migration-plan.md §9](migration-plan.md#9-open-questions)). Read the answers before steps 3d, 3f, 3h, 4, 5, 6, 7 and 8. Ask about A1 (key rotation) before any step touches R2 or YouTube; that is a migration question, not GitHub work.
- **Branch protection on `main`** (step 3g) is not set. The session's GitHub tools can't change repository settings, so 3g needs another way (for example a ruleset applied through the API, if a later session has it).

## What exists

- **Workspace:** pnpm 12 workspace (`apps/*`, `packages/*`, `tooling/*`), Node 24.22.0, TypeScript 7 (the linter alone runs on TypeScript 6, from `tooling/eslint-config`), every version pinned exactly. Versions and reasons: [architecture.md](architecture.md#versions) and [decisions/0007-toolchain-pins.md](decisions/0007-toolchain-pins.md).
- `packages/core`: `DEAL_FLOW`, ported from the prototype, with a test that compares it with the prototype's `data.js`.
- `packages/ui`: `tokens.css`, the prototype's tokens (light, both dark rules, density, size, motion), with a test that compares every value with the prototype's `index.html`.
- `packages/ipc`: the contract. `channels` (zod) holds `app:ping` and `secrets:status`; `createDispatcher` checks each request and each response; `bridge.ts` holds the bridge's types and names, with no zod, for the preload.
- `apps/desktop`: electron-vite app showing a blank frame with the tokens. The security baseline is in place ([decisions/0008-security-baseline.md](decisions/0008-security-baseline.md)):
  - the page runs isolated and sandboxed, loads from `app://gratovo/index.html`, and has a strict CSP as a meta tag and a header;
  - one bridge, `window.gratovo.invoke(channel, input)`, answered only for the app page's top frame;
  - every navigation guarded; links open in the browser only for allowlisted hosts (`src/main/external-links.ts`); downloads refused;
  - every permission denied; one copy of the app at a time; a startup error shows a message and quits;
  - `src/main/secret-store.ts`: secrets encrypted with `safeStorage` in `secrets.json` in the user data folder. The page can only ask whether one is set;
  - `scripts/release-fuses.ts`: the nine fuses for release builds (3h applies them).
  - Tests: unit tests for every pure module; Playwright `smoke` and `security` specs on the built app, and a `fuses` spec that flips the fuses on a copy of the Electron binary.
- `services/pipeline`: uv project (Python 3.14, `src/` layout, ruff, pyright strict, pytest) with one test. `services/gemini-extension/` and `supabase/` hold only a README.
- **Hooks:** lefthook runs lint-staged (Prettier, ESLint, ruff on staged files) and then gitleaks on the staged changes. Without gitleaks installed, a commit stops and says how to install it.
- **CI** (`.github/workflows/ci.yml`), on every pull request, on `main` and weekly:
  - lint, typecheck, unit tests and the end-to-end tests on Windows 2025;
  - on Linux runners, because they only read files: a gitleaks scan of the whole history, OSV-Scanner over both lockfiles, and CodeQL for JS/TS and Python.

  CodeQL can't upload results (the repository is private without Advanced Security), so its job fails on any result itself. Actions are pinned by commit.
- **Dependabot** (`.github/dependabot.yml`): weekly, npm, uv and Actions, minor and patch grouped, 3 days' cooldown (7 for majors).
- `.gitleaksignore`: five findings in the first commit, checked by hand and found to be fake (a mock token in a skill, a docstring example, a test fixture). Anything new still fails.
- Earlier material: `docs/` (decisions 0001 to 0008), `design/workbench-prototype/`, `legacy/` (read only), `.claude/`.

## Next: step 3c, the app shell

The goal and acceptance checks are in [migration-plan.md, step 3c](migration-plan.md#step-3-foundation). It is UI work, so use the UI skills listed in CLAUDE.md, and check the result in light and dark, at 1440 px and 400 px.

1. **Read the prototype first:** `design/workbench-prototype/index.html` (tokens and the frame's markup), `js/core.js` (`W.act`, `W.ui`, `W.bg`, the key stack), `js/settings.js`, and the `WHY` notes in `js/plan.js`.
2. **Tokens:** most are already in `packages/ui/src/tokens.css` (3a). Add the fonts (Readex Pro, IBM Plex Mono) as files served from `app://`. The CSP allows `font-src 'self'` only, so no Google Fonts link.
3. **Routing:** use hash routes (`#/today`). A `pushState` URL isn't a file, so a reload there would get a 404 from `app://` (ADR 0008).
4. **The frame:** rail, top bar, peek panel, toasts with Undo, menus, tooltips, the shortcut sheet and the problems bar, as React components in `apps/desktop/src/renderer/`. User-facing strings go in `strings.ts`.
5. **Keyboard system** and **store pattern** as the plan says. Pure logic (the key stack, undo snapshots) goes in `packages/core` with unit tests.
6. **Settings shell:** the sections and the search from `settings.js`.
7. **Data from the main process** goes through `window.gratovo.invoke`. To add a channel, see `apps/desktop/README.md`.
8. **Tests:** the Playwright tests the plan lists (palette, peek, undo, menus, Esc order, key barriers), using `e2e/fixtures.ts`, plus screenshot comparisons.

**Then:** 3d (the data layer), in its own pull request.

## Notes for whoever picks this up

- **Cloud sessions run in Linux containers;** the app is Windows only. In a container, edit the code and run `pnpm lint`, `pnpm typecheck` and `pnpm test`. The Electron tests run on Windows in CI; don't set them up in the container.
- **Tools a cloud container lacks** (it has Node 22, pnpm 10 and uv 0.11, and no gitleaks). Node 24.22.0 from nodejs.org (check `SHASUMS256.txt`) unpacked under `/root/.local/opt/`, then `npm i -g pnpm@12.14.0` with that Node first on `PATH`. uv: `UV_TOOL_BIN_DIR=/root/.local/opt/uv-bin uv tool install uv==0.13.1`. gitleaks: `GOBIN=/root/.local/bin go install github.com/zricethezav/gitleaks/v8@v8.30.1` (GitHub release downloads are blocked there; the Go proxy is not).
- **What 3b leaves for later steps:**
  - Each Electron test gets a fresh data folder (`GRATOVO_USER_DATA`, read only by unpackaged builds), and `pnpm dev` uses "Gratovo Toolbox (dev)", so neither touches the installed app's data or its single-instance lock.
  - The fuse `EnableEmbeddedAsarIntegrityValidation` needs the packager (3h) to write the archive's hash into the app.
  - Dependabot's first run is on the Monday after this merge. Check that it works with pnpm 12 (its runs appear under Actions as "Dependabot Updates"), then treat its pull requests like any other.
  - A CodeQL result or a new advisory turns CI red. Fix it, or record a reviewed exception (ADR 0008 says how).
- **Electron 44 downloads its binary on first use,** not at install. The `dev`, `preview` and `test:e2e` scripts run `install-electron` first (it checks the download against Electron's own checksums and exits at once when the binary is there).
- **`minimumReleaseAge` is one day.** A version published in the last 24 hours won't install: pick the one before it.
- **The prototype is the spec.** Before building a screen, open it (or read its `js/<screen>.js`) and its design notes (`js/plan.js`, the `WHY` notes). The token and `DEAL_FLOW` tests fail if the prototype and the port drift apart; change both together.
- **The owner's comments** on the published prototype live in the artifact's `comments` collection (https://claude.ai/artifact/96e8HtK58oyRqVcYdUcZNn). A session without the Artifact tools asks the owner to paste them ("Copy open for Claude" in the prototype's comment list).
- **Don't** build the four gaps on hold, send email, read the mailbox, or delete anything in `legacy/` ([product/owner-rules.md](product/owner-rules.md)).

## Session log

| Date | Session | What happened |
|---|---|---|
| 2026-10-19 | Local (Opus) | The old repo committed (`43596b8`) and backed up. This repository created: plan, docs, decisions, product record, prototype, project skills, `legacy/` with secrets excluded. A security finding: the old repo's tracked `data/.env` holds live keys, so the owner must rotate them (A1). |
| 2026-10-19 | Cloud | An earlier try at 3a (`5d42490`) had been reverted (`fc67b94`). Step 3a rebuilt from scratch rather than restored: the workspace, the three packages, the hardened desktop shell, the pipeline project, hooks, CI and ADR 0007. Checked: lint, typecheck, unit tests (24 Vitest, 1 pytest), the Electron smoke tests (as an unprivileged user locally; in CI on Ubuntu and Windows, where the OS sandbox check also runs), the hooks (a planted fake key is blocked), a full-history gitleaks scan, screenshots in light and dark at 1440 px and 400 px. A reviewer agent's findings were fixed: Electron is downloaded before `dev`, `preview` and the e2e tests; the token test also catches unported prototype rules; Playwright keeps the sandbox on; only a local dev server is trusted; CI pins Go. The owner's new rule recorded: sessions merge their own pull requests. Merged as pull request #1. |
| 2026-10-19 | Cloud | The owner asked for TypeScript 7 with TypeScript 6 only for the linter. Done: the root uses `typescript@7.0.2`; the lint plugins moved to `tooling/eslint-config`, whose `typescript` is `@typescript/typescript6` (6.0.3). pnpm `overrides` were tried first and don't reach peer dependencies. Checked: TypeScript 7 catches planted errors, the typed lint rules still fire, lint, typecheck and tests pass, and the Electron tests pass as the image's `ubuntu` user (no extra user needed). ADR 0007 updated. |
| 2026-10-19 | Cloud | The owner made the app Windows only. CI now runs its checks and Electron tests on Windows alone; the Ubuntu job, the Linux sandbox and virtual-display steps, the Linux-only test workaround and the cloud e2e instructions are gone. Rule recorded in owner-rules.md and CLAUDE.md. |
| 2026-10-19 | Cloud | Step 3b, the security baseline. Built: the typed bridge (one channel; requests and responses checked; calls only from the app page), the `app://` protocol with the CSP as a header, navigation guards, a link allowlist, the secrets store over `safeStorage`, one copy of the app at a time, the release fuses, and CI jobs for OSV-Scanner and CodeQL plus Dependabot. Agents built the secret store, the file and link checks, the fuses and the CI jobs from written contracts; each was checked again. Checked: lint, typecheck, unit tests (120 Vitest, 1 pytest), the Electron tests on Windows in CI. ADR 0008 records the choices. |
| 2026-10-19 | Cloud | The owner recorded answers to all twelve open questions (§9) on branch `owner-answers-section-9`. Merged here with the hand-off conflict resolved, and the lines the answers made stale brought in line: no code signing (SECURITY.md, architecture, the parity checklist), team keys by server function and comments as a repository file (steps 3d and 3f). |
