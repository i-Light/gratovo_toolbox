# Supabase

The shared backend's schema and its tests.

- `migrations/`: ordered SQL migrations named `YYYYMMDDHHMMSS_short_description.sql`. Additive only until cutover, so the old app keeps working.
  - `20261020120000_baseline.sql`: a short header comment, then `legacy/backend/schema.sql` byte for byte. Production runs that file, so any edit would drift from it. Production never ran it through the CLI: mark it applied there (`supabase migration repair`), never push it. From 2026-10-30 every new table in a later migration needs its own `grant` lines.
  - `20261021090000_member_access.sql`: schema `private`, the `member_access` table (agency roles, "sees money"; read-only for members) and `set_member_access` (owner only).
  - `20261021090100_team_keys.sql`: `team_youtube_key()`, which hands the Vault secret `team_youtube_key` to authorized members.
  - **If anyone re-runs the old `schema.sql`** (or the baseline), **re-apply the later migrations right after**, in name order. Its `revoke all on all functions in schema public from public, anon, authenticated` takes `execute` away from the new `public` wrappers, and its `grant ... on all tables in schema public to authenticated` gives write privileges on `member_access` (row-level security still refuses the writes). The later migrations are safe to re-run and put both back. `docs/setup.md` section 6 says the same for the owner.
  - The `private` schema rule: a `security definer` function lives in `private` (not exposed by the Data API, `set search_path = ''`), and a `security invoker` wrapper in `public` is the only thing the app calls. Every function revokes `execute` from `public` and `anon` and grants it explicitly.
- `tests/`: SQL tests, run against a throwaway Postgres in Docker.
  - `00_supabase_stubs.sql`: the minimum Supabase surface the migrations need (roles, `auth` schema, a minimal `vault`, extensions), so the real migrations run unedited on stock Postgres.
  - `test_12_conflicts.sql`, `test_17_scratchpad.sql`, `test_19_sync_shape.sql`, `test_20_remote_search_requests.sql`, `test_21_decisions_schema.sql`: ported from the old app.
  - `test_30_grants.sql`: every public table has row-level security, `authenticated` and `service_role` hold all four privileges, `anon` holds none (except the declared read-only tables, where `authenticated` holds `select` only).
  - `test_31_member_access.sql`, `test_32_team_keys.sql`: roles and money access, and the YouTube key.
  - `run.ts`: the runner.

## Run the tests

Start Docker Desktop, then run `pnpm test:sql` (or `node supabase/tests/run.ts`). It starts a pinned `postgres:17` container named `gratovo-sqltest-<pid>`, applies the stubs, the baseline, the baseline a second time (to prove it re-runs), then the later migrations in name order, and records every privilege in `public` and `private`. Then it plays out an old `schema.sql` re-run: the baseline once more and the later migrations again. The privileges must come back exactly as recorded (so the baseline's blanket grants can't hide a later migration that forgot its own), and the tests run on that repaired database. Then it runs each `test_*.sql`, and always removes the container. While `legacy/` exists it also checks the baseline still matches `legacy/backend/schema.sql`. Nothing touches a real Supabase project. CI runs it as the job "SQL tests (Linux, Docker)".

## Why there is no second pass

The old runner also built a database from the previous schema and carried it across with `migrate_v2.sql`. That file is not carried over (plan section 7), and the old schema's commit is not in this history, so only the fresh-database pass remains.
