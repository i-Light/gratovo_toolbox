# Supabase

The shared backend's schema and its tests.

- `migrations/`: ordered SQL migrations named `YYYYMMDDHHMMSS_short_description.sql`. Additive only until cutover, so the old app keeps working.
- `tests/`: SQL and row-level security tests, run in Docker in CI.

Empty for now. Step 3d moves `legacy/backend/schema.sql` here as the baseline migration and ports the tests (see the [migration plan](../docs/migration-plan.md#step-3-foundation)).
