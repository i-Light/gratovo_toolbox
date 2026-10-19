# 0005. A read-only `legacy/` copy of the old source, deleted at the end

- **Date:** 2026-10-19
- **Status:** accepted

## Context

The work is ported from the old app: behaviour, edge cases, the sync design, the Python pipeline, the comms engine and its course data. Cloud sessions see only this repository, not `gratovo_code`. The owner wants a clean repository, and wants cleanup to happen only at the very end, after the 100% check.

## Decision

- Copy the old repository's **tracked** source into `legacy/`, keeping its layout so paths in its docs still work.
- Exclude the generated Flutter runners (`android/`, `ios/`, `web/`, `windows/`), editor folders, `.claude/` and `data/.env`.
- Scan the copy for secrets. Redact the Supabase URL and anon key that were compiled into `lib/core/config/supabase_config.dart`.
- `legacy/` is read-only: it is never built, edited, formatted or linted (`.editorconfig` and `.gitattributes` mark it).
- **Delete `legacy/` in step 11**, after step 10 proves parity.

## Consequences

- About 17 MB of reference source in the history of this repository. That is acceptable: it holds no secrets, and it is removed from the tree at the end. If the history should not carry it at all, the owner can later choose to squash the early history before the repository is shared beyond the team.
