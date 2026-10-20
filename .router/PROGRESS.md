# Progress: step 3d-2a (sign-in, roles, network allowlist, team keys)

Started 2026-10-20 on branch `feat/3d-2-sync`, after #10 (3d-1). `CONTEXT.md` is the 3d-2 recon; `PLAN.md` the 3d-2a plan (decisions G1 to G18, tasks A1 to A11, R1, L1). 3d-2b (the sync) follows in its own pull request.

Owner decisions (2026-10-20): agency roles as a list per person, apart from access, with "sees money" its own switch; money hidden in the new app now and locked in the database when the old app retires; the YouTube key (Vault) and R2 signed links both built now; 3d-2 is two pull requests; production changes through the Supabase MCP with the owner's go before each one; the owner enters key values in Supabase themselves. Production runs Postgres 17.6.

| Task | Tier | Commit | Note |
|---|---|---|---|
| Recon | scout | (this commit) | `.router/CONTEXT.md` |
| Plan | H | (this commit) | `.router/PLAN.md`; waiting for the owner's approval and answers to Q1-Q4 |
