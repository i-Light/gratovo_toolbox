# Progress: step 3d-2a (sign-in, roles, network allowlist, team keys)

Started 2026-10-20 on branch `feat/3d-2-sync`, after #10 (3d-1). `CONTEXT.md` is the 3d-2 recon; `PLAN.md` the 3d-2a plan (decisions G1 to G18, tasks A1 to A11, R1, L1). 3d-2b (the sync) follows in its own pull request.

Owner decisions (2026-10-20): agency roles as a list per person, apart from access, with "sees money" its own switch; money hidden in the new app now and locked in the database when the old app retires; the YouTube key (Vault) and R2 signed links both built now; 3d-2 is two pull requests; production changes through the Supabase MCP with the owner's go before each one; the owner enters key values in Supabase themselves. Production runs Postgres 17.6.

| Task | Tier | Commit | Note |
|---|---|---|---|
| Recon | scout | db3dda3 | `.router/CONTEXT.md` |
| Plan | H | db3dda3 | `.router/PLAN.md`; approved by the owner 2026-10-20 with all four recommendations (Q1-Q4) |
| A2 | N | 19057c2 | `member_access` (RLS read only, no write policy; writes through `set_member_access`, Owner only, the last Owner stays) and `team_youtube_key()` (authorized only, from Vault), in schema `private` behind invoker wrappers; `test_31`, `test_32`, `test_30` read-only list; `test:sql` 8 files. For R1: confirm `vault.decrypted_secrets` and anon's execute revokes on the real stack |
| A3 | N | (this commit) | `supabase/functions`: SigV4 presign (matches AWS's published S3 example), R2 key rules (27 tests), `r2-access` (POST only, the caller's own token checked through `is_authorized`, 15-minute links, logs nothing, no service key). Root `tsconfig.json` and `vitest.config.ts` include the folder |
