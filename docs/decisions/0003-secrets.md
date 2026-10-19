# 0003. Secrets never in git, never in the installer

- **Date:** 2026-10-19
- **Status:** accepted. Team keys reach machines through a server function after sign-in (owner's answer, migration plan §9 Q11).

## Context

The old app shipped a tracked `data/.env` with team keys inside the installer and in the repository, which is on GitHub. It held:

- a GitHub token;
- R2 keys;
- the YouTube API key;
- earlier, the Supabase service-role key and an AWS key pair.

Anyone with the installer or repository access had them.

## Decision

- No secret is committed or packaged. gitleaks runs before every commit and in CI.
- A person's own credentials are stored in the OS keychain through Electron `safeStorage`.
- Team keys are served to signed-in members by the backend:
  - **R2:** short-lived signed URLs from a server function (recommended);
  - **YouTube:** the key restricted to the YouTube Data API in Google Cloud, held in Supabase Vault and returned only to members by a security-definer function.
- The service-role key lives only server-side.
- Every key that was in the old repository is rotated (owner action A1).

## Consequences

- A new team member needs only to sign in; no keys are passed around in chat or files.
- Revoking a member's access revokes their access to team keys.
