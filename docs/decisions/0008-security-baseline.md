# 0008. How the security baseline is built

- **Date:** 2026-10-19
- **Status:** accepted (step 3b)

## Context

[SECURITY.md](../../SECURITY.md#desktop-app-hardening-applies-from-step-3) lists what the desktop app must do: an isolated, sandboxed page with a strict CSP, one typed IPC bridge with an allowlist, navigation and permission guards, external links through an allowlist, secrets in `safeStorage`, fuses on release builds, and dependency and code checks in CI. Step 3b had to choose how. Two facts shaped the choices: the app is Windows only, and the repository is private without GitHub Advanced Security, so GitHub's code-scanning page isn't available.

## Decision

1. **One IPC channel, one allowlist.** The preload script gives the page a single function, `window.gratovo.invoke(channel, input)`, which sends everything over one Electron channel (`gratovo:invoke`). The main process refuses any call that doesn't come from the top frame on the app's origin. It checks the origin rather than the exact page because `history.pushState` changes the page's URL without a navigation. The navigation guards already keep that frame on the app's page. Then `createDispatcher` in `packages/ipc` checks the request against the channel's zod schema, runs the handler, and checks the response too, so a handler can't return a field the contract doesn't declare. The `channels` map is the whole allowlist, and adding a channel there makes TypeScript ask for its handler.
2. **The page loads from `app://gratovo/`, not `file://`.** The main process reads the built files from disk. It serves only known file types from inside the renderer folder, and only paths made of the characters the build emits. That rules out backslashes, colons (alternate data streams), dotfiles and `..`. It also refuses Windows device names such as `CON` or `NUL`. Every response, 404s included, carries the CSP as a header (the page also has it as a meta tag) and `nosniff`. It never goes through `file://`, so it keeps working when the release fuses take `file://`'s extra privileges away.
3. **Every navigation is guarded:** `will-frame-navigate` (Electron emits it first, so allowlisted links are opened from it), `will-navigate` and `will-redirect`. New windows and downloads are always refused. A link opens in the browser only if it is https, has no user name or password, uses the default port, and goes to a host on the allowlist in `src/main/external-links.ts` (YouTube and Gmail for now). Gmail links may only open a thread, never a compose window that a script has filled in. A feature that links somewhere new adds its host there.
4. **Secrets** live in one JSON file in the app's user data folder. Each value is encrypted with `safeStorage`, which on Windows uses the signed-in account's key. Writes are atomic and go through one queue, and there is no plain-text fallback. The temporary file is flushed to disk before the rename, and the rename is retried briefly when Windows refuses it (an antivirus scan, a sync tool). The page can only ask whether a secret is set (`secrets:status`). Only one copy of the app runs at a time, so two never write the file at once. Unpackaged runs (`pnpm dev`, the tests) use their own data folder, so they never share the installed app's lock or secrets.
5. **Fuses:** all nine are set explicitly in `apps/desktop/scripts/release-fuses.ts`, with `strictlyRequireAllFuses`, so an Electron upgrade that adds a fuse fails until someone decides it. A test flips them on a copy of the Electron binary and reads them back. Step 3h applies them to the packaged app.
6. **Dependency audit with OSV-Scanner** over `pnpm-lock.yaml` and `services/pipeline/uv.lock`: one tool for both ecosystems. It is built with `go install` at a pinned release, like gitleaks. It runs on every pull request and once a week.
7. **CodeQL without upload.** CodeQL analyses JS/TS and Python with the `security-extended` queries, keeps its report in the job (`upload: never`), and fails the job on any result.
8. **Dependabot** opens weekly pull requests for npm, uv and GitHub Actions. It groups minor and patch updates and waits 3 days before proposing a release (7 for a major). Sessions handle these pull requests like any other.
9. **Analysis jobs run on Linux runners.** The secret scan, the audit and CodeQL only read files, and Windows minutes count double on a private repository. Everything that runs the app runs on Windows.

## Alternatives considered

- **One Electron channel per app channel** (`ipcMain.handle("app:ping")`): the allowlist would be spread across registrations, and a forgotten handler or check would be easy to miss. Rejected.
- **`net.fetch(file://…)` inside the protocol handler** (the common example): it depends on `file://`, which the fuses restrict. Rejected for a direct file read.
- **`pnpm audit` plus `uv audit`:** two tools, and `uv audit` is still marked experimental. Kept as a fallback.
- **The OSV-Scanner and CodeQL GitHub Actions with SARIF upload:** both need code scanning, which this private repository doesn't have.
- **Electron's `safeStorage` async API** or a native keychain module: the sync API is enough for a handful of small values, and it adds no dependency.

## Consequences

- **Routing in the renderer (3c):** a URL the page sets with `pushState` isn't a file, so a reload there would get a 404. Use hash routes (`#/today`), or teach the protocol to answer every route with `index.html`.
- A new channel is one entry in `channels` plus its handler. Lint, typecheck and the dispatcher tests cover the rest.
- A new advisory can turn CI red on a pull request that didn't change dependencies. Fix it by upgrading, or record a reviewed exception in an `osv-scanner.toml` next to that lockfile (the repository root for `pnpm-lock.yaml`, `services/pipeline/` for `uv.lock`), with an expiry date and a reason.
- A CodeQL result fails CI. Fix the code, or exclude that query in `.github/codeql/codeql-config.yml` with a comment saying why.
- If the repository ever gets GitHub Advanced Security, switch CodeQL to upload results, and keep the failing step.
