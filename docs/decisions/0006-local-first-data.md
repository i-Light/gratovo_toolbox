# 0006. Local-first data with a sync engine, as in the old app

- **Date:** 2026-10-19
- **Status:** accepted

## Context

The old app reads and writes one local SQLite file and syncs typed-in rows with Supabase through an outbox and a pull cursor. Scraped data goes to R2 through the pipeline. This made the app work offline and kept clicks local. Its lag came from the UI layer, not from this design (see [0002](0002-stack.md)).

## Decision

- Keep local-first. SQLite in the Electron main process (off the UI thread), forward-only migrations, an outbox with compare-and-set edits, cursor pulls with tombstones, and one realtime channel for change broadcasts and presence.
- The new app uses **its own** data folder and imports the old local database on first run, after a backup. The old app's files are never modified.
- Until cutover, Supabase migrations are additive only, so both apps can run against the same project.

## Consequences

- The sync engine is ported carefully from `legacy/lib/core/sync/`, test first. It is the riskiest piece of the foundation.
- Every screen reads local data, so Today and the lists answer at once even when the network is slow.
