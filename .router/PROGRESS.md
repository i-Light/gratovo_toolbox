# Progress: step 3d-1 (the local data layer)

Started 2026-10-20 on branch `feat/3d-data-layer`, after #9. `CONTEXT.md` is the recon (§1 to §8), `PLAN.md` the plan (decisions G1 to G16, tasks D1 to D10), approved by the owner on 2026-10-20.

Owner decisions (2026-10-20): 3d in two parts (3d-1 here, 3d-2 sign-in, sync and the team-keys function); A3 done (production has `schema.sql`); SQL tests in a Linux CI job with Docker; email and password sign-in (3d-2); keys not rotated, entered at run time only.

| Task | Tier | Commit | Note |
|---|---|---|---|
| Recon | scout | (this commit) | `.router/CONTEXT.md` |
| Plan | H | fbbd20b | `.router/PLAN.md`; `node:sqlite` checked inside Electron 44.9.0 (Node 24.22.0, SQLite 3.53.4, WAL) |
| D1 | N | 7440e5e | `@gratovo/core/data`: the contract, legacy mapping, example fixtures |
| D2 | N | a785ce8 | Supabase baseline migration (legacy `schema.sql` as is), SQL tests, CI job `sql` (green on its first run) |
| D3 | N | 12a7f26 | `main/db`: open, forward-only migrations, migration 1 (9 STRICT tables) |
| D4 | N | (this commit) | `main/data/repositories`: one file per table, 38 tests. STRICT `TEXT` columns turn numbers into text, so the STRICT tests write a blob or text into a number column |

Next: D5 (the two sources and the shared contract suite).
