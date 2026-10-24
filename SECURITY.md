# Security

This app holds creators' and brands' contact details, deal terms, money, and the keys to the agency's mailboxes and cloud accounts. This file is the policy. [docs/architecture.md](docs/architecture.md#security-model) describes how the app enforces it.

## Secrets never enter the repository

- No `.env` files, keys, tokens, passwords, OAuth client secrets or service-role keys in any commit, on any branch.
- `.gitignore` blocks the usual files. A secret scanner (gitleaks) runs before every commit and in CI from step 3 on. A finding fails the build.
- Configuration that isn't secret is passed at build time and is never hard-coded in source. For Supabase that is two values, `MAIN_VITE_SUPABASE_URL` and `MAIN_VITE_SUPABASE_PUBLISHABLE_KEY`, read from the environment or from `apps/desktop/.env.local` (ignored by Git). The app refuses a secret key (`sb_secret_…`) and any key shaped like a legacy JWT (`anon`, `service_role`). Steps: [docs/setup.md](docs/setup.md).
- Example values in docs and tests are obviously fake, like `sk-test-000` or `https://example.supabase.co`.
- If a secret is committed by mistake, treat it as leaked: rotate it first, then remove it from history. Deleting the file is not enough.

## Where secrets live in the new app

| Secret | Where it lives |
|---|---|
| A person's own credentials (Gmail OAuth tokens, personal tokens, AI provider keys) | Encrypted with the Windows account's key through Electron `safeStorage`, in the app's data folder. Never in plain text. |
| Team keys (YouTube Data API, Cloudflare R2) | Never shipped in the installer. Served to signed-in team members only: short-lived R2 links from a server function, and the YouTube key through Supabase Vault behind a members-only function. The YouTube key is fetched on demand and kept in memory for at most an hour, never on disk. R2 links last 15 minutes. A member may read and write the `channels/` files and read all of `catalog/`, but writes catalog files only under their own folder (`catalog/<their id>/`), and nobody can delete a catalog file through the app. The rules are in `supabase/functions/_shared/r2-rules.ts`. The main process talks only to the project's Supabase host. Where to enter the values: [docs/setup.md](docs/setup.md). Why: [ADR 0011](docs/decisions/0011-accounts-roles-team-keys.md). |
| Supabase service-role key | Server side only (Edge Functions, CI secrets). Never on a team member's machine. |
| CI tokens and release credentials | GitHub Actions secrets. |

## The pipeline's rules (step 3e-1)

- Secrets reach the Python pipeline only on stdin, in the start message. Never in argv, the environment or a file.
- The pipeline runs with a bare environment (`SystemRoot`, `PATH`, `TEMP`, `TMP`) and `-I`, so nothing from the user's shell reaches it.
- The pipeline makes requests only to HTTPS hosts on its allow list (YouTube, Google's API, AWS gateway hosts, and the configured proxies). The YouTube key goes in a header, never a URL.
- Logs are blanked of the job's secrets in main, before they reach the page or a file. The pipeline logs a status or an error's kind, never a URL.
- The Gemini bridge (step 3e-3a) listens on 127.0.0.1 only, refuses any connection from a web page (only the browser add-on and programs on this computer get in), and gets no key, proxy or password. It runs with the same bare environment plus one variable: a random per-launch token (step 4, [ADR 0016](docs/decisions/0016-live-data-and-connections.md)), which main passes in its environment and blanks from its logs. The Firefox build of the add-on must show that token; Chrome and Edge load the add-on unpacked and cannot carry it, so for them the guard is the origin check and browser admission.
- Connecting a Gmail mailbox (step 4) uses a one-shot listener on 127.0.0.1, PKCE and a random `state`. A request without our `state` gets an empty 404 and can't end the connect, so a web page can't cancel it. Main exchanges the code only with `oauth2.googleapis.com`, accepts only an address Google marks as verified, revokes a refresh token it couldn't store, and logs no code, token or address.
- The import of the old `gratovo.db` (step 4) opens the old file read-only and immutable, and never writes it.
- The one exception to the host rule: subtitles run yt-dlp, which makes its own requests, so `net.check_url` can't check them. yt-dlp runs only as a module of the pipeline's Python, with no config, plugins or cache, only on a watch URL built from a checked 11-character video id, and it is stopped after 120 s.

Why: [ADR 0013](docs/decisions/0013-pipeline.md), [ADR 0014](docs/decisions/0014-gemini-bridge-and-comms.md) and [ADR 0016](docs/decisions/0016-live-data-and-connections.md).

## Known exposure in the old repository (action for the owner)

The old repository `i-Light/gratovo_code` tracked `data/.env`, and it is on GitHub. It holds live values for these keys:

- `GRATOVO_GITHUB_TOKEN` and `GRATOVO_GITHUB_CLIENT_ID`
- `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_API_TOKEN` (plus the account id, bucket and endpoint)
- `YOUTUBE_API_KEY`

Earlier commits also held the Supabase service-role key and an AWS IAM key pair (commit `60b5d60` removed them from the file, but not from history).

**Rotate all of these.** That means issuing new keys and revoking the old ones, whether or not the repository is private. *The owner deferred this on 2026-10-20 (migration plan, A1): until they rotate, the new app uses the existing keys, entered at run time into the app's secret store or Supabase's function secrets.* Don't copy any of them into this repository. Nothing from `data/.env` was copied into `legacy/`. Supabase's URL and anon key were redacted from the legacy copy too.

## Desktop app hardening (applies from step 3)

- Renderer: `contextIsolation: true`, `sandbox: true` and `nodeIntegration: false`, a strict Content Security Policy (in the page and as a header), the page served from `app://` rather than `file://`, no remote content and no navigation away from the app.
- One typed IPC bridge in the preload script. Every message, and every answer, is validated with a schema in the main process. Nothing outside the allowlist gets through, and only the app's own page may call.
- External links open in the browser through an allowlist. The app denies permission requests (camera, location and others) by default.
- Electron fuses are set for release builds: `RunAsNode` off, `NODE_OPTIONS` off, `--inspect` off, cookie encryption on, the app loaded only from its archive and that archive's integrity checked, and no extra privileges for `file://`.
- Local services (the Gemini bridge daemon) bind to `127.0.0.1` only, refuse web pages, and require a per-launch token from the Firefox add-on (Chrome and Edge are guarded by the origin check and browser admission instead).
- Releases are not code-signed: the owner's choice, since the app is for the owner and a few trusted members (migration plan §9 Q12). To make up for it, installers and updates come only from the private release location through the server function, over https, and the updater checks each download against the hash published with the release.
- Dependencies are pinned through the lockfile, checked in CI by OSV-Scanner (on every pull request and weekly), updated through Dependabot, and reviewed before an upgrade. CodeQL checks the code itself.

How each of these is built, and why: [docs/decisions/0008-security-baseline.md](docs/decisions/0008-security-baseline.md).

## Reporting

This is a private, internal tool. Report a suspected leak or vulnerability to the owner directly, not in an issue.
