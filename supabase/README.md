# Supabase

The shared backend's schema and its tests.

- `migrations/`: ordered SQL migrations named `YYYYMMDDHHMMSS_short_description.sql`. Additive only until cutover, so the old app keeps working.
  - `20261020120000_baseline.sql`: a short header comment, then `legacy/backend/schema.sql` byte for byte. Production runs that file, so any edit would drift from it. Production never ran it through the CLI: mark it applied there (`supabase migration repair`), never push it. From 2026-10-30 every new table in a later migration needs its own `grant` lines.
- `tests/`: SQL tests, run against a throwaway Postgres in Docker.
  - `00_supabase_stubs.sql`: the minimum Supabase surface the migrations need (roles, `auth` schema, extensions), so the real migrations run unedited on stock Postgres.
  - `test_12_conflicts.sql`, `test_17_scratchpad.sql`, `test_19_sync_shape.sql`, `test_20_remote_search_requests.sql`, `test_21_decisions_schema.sql`: ported from the old app.
  - `test_30_grants.sql`: every public table has row-level security, `authenticated` and `service_role` hold all four privileges, `anon` holds none.
  - `run.ts`: the runner.

## Run the tests

Start Docker Desktop, then run `pnpm test:sql` (or `node supabase/tests/run.ts`). It starts a pinned `postgres:17` container named `gratovo-sqltest-<pid>`, applies the stubs, the baseline, the baseline a second time (to prove it re-runs), then the later migrations in name order (so the baseline's blanket grants can't hide a later migration that forgot its own), runs each `test_*.sql`, and always removes the container. While `legacy/` exists it also checks the baseline still matches `legacy/backend/schema.sql`. Nothing touches a real Supabase project. CI runs it as the job "SQL tests (Linux, Docker)".

## Why there is no second pass

The old runner also built a database from the previous schema and carried it across with `migrate_v2.sql`. That file is not carried over (plan section 7), and the old schema's commit is not in this history, so only the fresh-database pass remains.
