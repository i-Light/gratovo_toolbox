# Progress: step 3d-2b-1 (the sync: pull, outbox, live events)

Started 2026-10-20 on branch `feat/3d-2-sync`, after #11 (3d-2a, merged; its progress record is in git history at b79911a). `CONTEXT.md` is the fresh 3d-2b recon; `PLAN.md` the 3d-2b-1 plan (decisions D1 to D24, tasks S1 to S16, R1, L1) with 3d-2b-2 outlined at the end.

| Task | Tier | Commit | Note |
|---|---|---|---|
| Recon | scout | (this commit) | `.router/CONTEXT.md`, 245 lines. Production sizes from the MCP's table list (2026-10-20): `channel_state` ~15.6k, `sync_tombstones` ~38k, `activity_log` 364 |
| Plan | H | (this commit) | `.router/PLAN.md`; waiting for the owner's approval and answers to Q1–Q4 |

Next: the owner approves the plan; then S1 to S5 in parallel.
