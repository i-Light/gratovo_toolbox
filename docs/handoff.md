# Hand-off

Where work stopped and exactly what to do next. Update this file at the end of every session, in the same commit as the work.

## Now

- **Date:** 2026-10-19
- **Plan step:** **3a (toolchain and skeleton) is done**: [pull request #1](https://github.com/i-Light/gratovo_toolbox/pull/1), green on Ubuntu and Windows. **3b (security baseline) is next**, on a fresh branch from `main`.
- **GitHub is the session's job.** Open the pull request, get CI green, fix the review findings, merge it. Never ask the owner to merge or do anything by hand on GitHub ([owner-rules.md](product/owner-rules.md)).
- **Owner actions still open:** A1, A3, A5 and A6 in [migration-plan.md §4](migration-plan.md#4-owner-actions). A2 is done (this repository is on GitHub); A4 is recorded as accepted. Ask about A1 (key rotation) before any step touches R2 or YouTube; that is a migration question, not GitHub work.
- **Branch protection on `main`** (step 3g) is not set. The session's GitHub tools can't change repository settings, so 3g needs another way (for example a ruleset applied through the API, if a later session has it).

## What exists

- **Workspace:** pnpm 12 workspace (`apps/*`, `packages/*`), Node 24.22.0, every version pinned exactly. Versions and reasons: [architecture.md](architecture.md#versions) and [decisions/0007-toolchain-pins.md](decisions/0007-toolchain-pins.md).
- `packages/core`: `DEAL_FLOW`, ported from the prototype, with a test that compares it with the prototype's `data.js`.
- `packages/ui`: `tokens.css`, the prototype's tokens (light, both dark rules, density, size, motion), with a test that compares every value with the prototype's `index.html`.
- `packages/ipc`: the `channels` map (zod) with one channel, `app:ping`, and `parseRequest`, which refuses unknown channels and unexpected keys.
- `apps/desktop`: electron-vite app showing a blank frame with the tokens. Hardened from the start: `contextIsolation`, `sandbox` (and `app.enableSandbox()`), no Node, no webviews, new windows and navigation away refused, every permission denied, a strict CSP written into the page at build time. Five Playwright smoke tests (six on Windows and macOS, which also report the OS sandbox).
- `services/pipeline`: uv project (Python 3.14, `src/` layout, ruff, pyright strict, pytest) with one test. `services/gemini-extension/` and `supabase/` hold only a README.
- **Hooks:** lefthook runs lint-staged (Prettier, ESLint, ruff on staged files) and then gitleaks on the staged changes. Without gitleaks installed, a commit stops and says how to install it.
- **CI:** `.github/workflows/ci.yml`. Lint, typecheck, unit tests and the end-to-end tests on Ubuntu 24.04 and Windows 2025, and a gitleaks scan of the whole history. Actions are pinned by commit.
- `.gitleaksignore`: five findings in the first commit, checked by hand and found to be fake (a mock token in a skill, a docstring example, a test fixture). Anything new still fails.
- Earlier material: `docs/` (now with decisions 0001 to 0007), `design/workbench-prototype/`, `legacy/` (read only), `.claude/`.

## Next: step 3b, security baseline

The goal and acceptance checks are in [migration-plan.md, step 3b](migration-plan.md#step-3-foundation). What 3a already did and what is left:

1. **Let the app import the packages.** `apps/desktop` doesn't import any package's TypeScript yet. The first import fails `tsc -b` until the importing project lists the package: add `"references": [{ "path": "../../packages/ipc/tsconfig.lib.json" }]` to `tsconfig.node.json` (and `tsconfig.web.json` if the renderer imports it), and `"@gratovo/ipc": "workspace:*"` to `apps/desktop/package.json`. Do the same for `core` when it is used.
2. **The typed IPC bridge.** Add `src/preload/index.ts` (a `sandbox: true` preload must build as CommonJS; electron-vite does this when the package has no `"type": "module"`). It exposes one `invoke(channel, input)` through `contextBridge`. The main process registers one handler that calls `parseRequest` from `@gratovo/ipc`, validates the response too, and refuses anything else. Wire `app:ping` end to end.
3. **A custom protocol** (for example `app://`) instead of `file://`, with the CSP also sent as a header. Update `appPageUrl` in `src/main/window.ts` and the navigation guard in `src/main/security.ts`, and guard `will-redirect` and `will-frame-navigate` the same way as `will-navigate`.
4. **External links** open in the browser through an allowlist (`shell.openExternal`), from `setWindowOpenHandler`.
5. **Fuses** for release builds (`@electron/fuses`): RunAsNode off, NODE_OPTIONS off, cookie encryption on, load only from the archive.
6. **The `secrets` module** over `safeStorage`: get, set, delete and list key names. The renderer can ask whether a secret is set, never read one.
7. **CI:** dependency audit (pnpm audit or OSV), CodeQL for JS/TS and Python, Dependabot (with a cooldown of at least a day, to match `minimumReleaseAge`).
8. **The acceptance test:** a Playwright test that proves the page cannot reach Node or any channel outside the allowlist.

**Then:** 3c (the app shell from the prototype), in its own pull request.

## Notes for whoever picks this up

- **Cloud sessions run on Linux as root;** the product targets Windows. Build and test on Linux; anything Windows-only is proven in CI.
- **Tools a cloud container lacks** (it has Node 22, pnpm 10 and uv 0.11, and no gitleaks). Node 24.22.0 from nodejs.org (check `SHASUMS256.txt`) unpacked under `/root/.local/opt/`, then `npm i -g pnpm@12.14.0` with that Node first on `PATH`. uv: `UV_TOOL_BIN_DIR=/root/.local/opt/uv-bin uv tool install uv==0.13.1`. gitleaks: `GOBIN=/root/.local/bin go install github.com/zricethezav/gitleaks/v8@v8.30.1` (GitHub release downloads are blocked there; the Go proxy is not).
- **End-to-end tests in a cloud container:** Chromium won't run sandboxed as root, and the app forces the sandbox on. As root, download Electron and build; then run the tests as the `nobody` user with the image's Node 22 (the Playwright runner is fine on it):
  ```
  pnpm --filter @gratovo/desktop exec install-electron && pnpm build
  mkdir -p /tmp/gratovo-e2e/home && chmod -R 777 /tmp/gratovo-e2e
  cd apps/desktop && setpriv --reuid=65534 --regid=65534 --clear-groups env HOME=/tmp/gratovo-e2e/home PATH=/usr/local/bin:/usr/bin:/bin xvfb-run -a node_modules/.bin/playwright test --output /tmp/gratovo-e2e/results
  ```
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
