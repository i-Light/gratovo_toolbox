# Security

This app holds creators' and brands' contact details, deal terms, money, and the keys to the agency's mailboxes and cloud accounts. This file is the policy. [docs/architecture.md](docs/architecture.md#security-model) describes how the app enforces it.

## Secrets never enter the repository

- No `.env` files, keys, tokens, passwords, OAuth client secrets or service-role keys in any commit, on any branch.
- `.gitignore` blocks the usual files. A secret scanner (gitleaks) runs before every commit and in CI from step 3 on. A finding fails the build.
- Configuration that isn't secret, such as the Supabase project URL and the publishable (anon) key, is passed at build time. It is never hard-coded in source.
- Example values in docs and tests are obviously fake, like `sk-test-000` or `https://example.supabase.co`.
- If a secret is committed by mistake, treat it as leaked: rotate it first, then remove it from history. Deleting the file is not enough.

## Where secrets live in the new app

| Secret | Where it lives |
|---|---|
| A person's own credentials (Gmail OAuth tokens, personal tokens, AI provider keys) | Encrypted with the Windows account's key through Electron `safeStorage`, in the app's data folder. Never in plain text. |
| Team keys (YouTube Data API, Cloudflare R2) | Never shipped in the installer. Served to signed-in team members only: short-lived R2 links from a server function, and the YouTube key through Supabase Vault behind a members-only function. The details are decided in step 3. |
| Supabase service-role key | Server side only (Edge Functions, CI secrets). Never on a team member's machine. |
| CI tokens and release credentials | GitHub Actions secrets. |

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
- Local services (the Gemini bridge daemon) bind to `127.0.0.1` only and require a per-launch token.
- Releases are not code-signed: the owner's choice, since the app is for the owner and a few trusted members (migration plan §9 Q12). To make up for it, installers and updates come only from the private release location through the server function, over https, and the updater checks each download against the hash published with the release.
- Dependencies are pinned through the lockfile, checked in CI by OSV-Scanner (on every pull request and weekly), updated through Dependabot, and reviewed before an upgrade. CodeQL checks the code itself.

How each of these is built, and why: [docs/decisions/0008-security-baseline.md](docs/decisions/0008-security-baseline.md).

## Reporting

This is a private, internal tool. Report a suspected leak or vulnerability to the owner directly, not in an issue.
