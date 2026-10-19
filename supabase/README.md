# Supabase

The shared backend: migrations and the SQL and row-level-security tests.

- `migrations/` will hold the baseline (step 3d) and then only additive migrations until cutover (migration plan, ground rule 1).
- `tests/` will run in Docker in CI (step 3d).

Nothing is applied from here yet. The old app's schema is still in `legacy/backend/schema.sql`.
