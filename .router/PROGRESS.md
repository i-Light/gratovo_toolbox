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
| D4 | N | b817ca3 | `main/data/repositories`: one file per table, 38 tests. STRICT `TEXT` columns turn numbers into text, so the STRICT tests write a blob or text into a number column |
| D5 | N | 1b2aec7 | `main/data`: `createSqliteSource`, `openExampleSource` (seeds on a missing or older `_meta.example_seed`), `openLiveSource`; `describeDataSourceContract` run on both (11 tests each). The clock is `() => number`; `close()` twice is a no-op; the live source's team has no titles |
| D6 | N | 80dd27f | `@gratovo/ipc` `frame:load` and `data:write` (strict zod schemas typed against core; ids 1-100, text 500, names 80, log 50, lists 5000, 1-100 writes); handlers; main opens `example.db` in `whenReady` and closes it on `will-quit`. `node:sqlite` stays external (`require` in `out/main/index.js`); Electron prints no ExperimentalWarning, and the file opens in WAL |

For 3d-2: a live frame bigger than the limits (over 5000 creators, a profile name over 80) would fail `frame:load`; revisit when the sync brings real data.
| D7 | N | (this commit) | The renderer loads the frame through `frame:load` before its first render (`lib/frame.ts` `toAppData`, `initAppStore`); a failed load shows a plain message (`app/load-failed.css`, apart from `frame.css`, which must match the prototype). Notifications are newest first: one store test now finds them by id. 279 renderer tests, 36 e2e pass unchanged. Looked at in dark at 1440 px (Electron): the frame, the bell and the palette as before, and the failed-load page |

Next: D8 (renderer writes: persister, save state, your name).
