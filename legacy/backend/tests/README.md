# SQL tests

```
cd backend/tests
./run.sh
```

Needs Docker running. Nothing else — no local Postgres, no Supabase project, no
credentials. It builds a throwaway `postgres:16` container and runs two passes:

1. **A fresh project.** Applies `backend/schema.sql` **twice** (the second pass
   asserts the "safe to re-run" promise in `SETUP.md`), then every `test_*.sql`.
2. **A migrated project.** Applies the *previous* schema straight out of git
   (`OLD_SCHEMA_REF` in `run.sh`), seeds it with a touched channel, an untouched
   channel, videos, keywords, a deal, a thread, a template and a stale
   tombstone, runs `migrate_v2.sql` twice, then `schema.sql`, asserts the
   human-edited columns arrived in `channel_state` and the scraped tables are
   gone — and then runs every `test_*.sql` again on that database.

Both passes run with `ON_ERROR_STOP=1`, so anything that is not idempotent
stops the run.

## Why these exist

The Dart suite cannot reach any of this. `flutter analyze` reads the SQL as
opaque strings, and every widget test runs against the in-memory mock
repositories. Row level security in particular reads as obviously correct and
is quietly wrong (a missing WITH CHECK, a `for all` that forgot inserts), so it
is exercised under a real `authenticated` role rather than as the table owner,
who bypasses RLS entirely.

## What each file asserts

| | |
|---|---|
| `test_12_conflicts.sql` | the compare-and-set on `channel_state`: the first edit of a never-touched channel creates its row; sequential collaboration never conflicts, a stale base does, and the refused value is not written; a rejecting tag starts the 7-day countdown and removing it clears it; the field whitelist refuses anything else |
| `test_17_scratchpad.sql` | the team scratchpad's RLS pair: any authorized user reads every box, a person may only write their own row, an unauthorized user sees none, and the touch trigger wins over a backdated `updated_at` |
| `test_19_sync_shape.sql` | what the per-machine copy silently depends on: no scraped-data table or retired function exists; `updated_at` moves on every copied table; a DELETE on each leaves a tombstone keyed the way the client expects; `basic` reads outreach and deals (the page lock is UI-only) while `unauthorized` reads nothing; the activity log cannot be updated, deleted, or filed under a colleague's id; `scratchpads` is the only table in the realtime publication |

## Writing a test

`test_12_conflicts.sql` is the pattern. Assertion-based, not eyeball-based: each
check calls `pg_temp.check('what should be true', <boolean>)`, which raises on
failure, so the script either reaches `ALL … TESTS PASSED` or stops at the first
thing that is wrong. Name the check as the claim it makes, so a failure reads as
a sentence.
