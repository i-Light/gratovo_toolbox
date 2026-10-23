# Progress: step 3e-3b (mail and the remaining jobs)

Branch `feat/3e-3b-mail-and-refetch`, from `main` at f5a9e7a (3e-3a merged as #16 on 2026-10-23). The plan is `.router/PLAN.md`, section "3e-3b" at the end of §Tasks (detailed 2026-10-23 by the lead on Opus: decisions D14 to D21, the contracts, tasks C1 to C7 and L1).

**Solo first** (owner, 2026-10-21): nothing here touches `r2.py`, `sync.py` or team work. **Never send an email, never read the mailbox**: every mail test runs on a fake client; no test reaches the network.

## Tasks

| id | tier | state | note |
|---|---|---|---|
| C1 | H | to do | the contracts on both sides |
| C2a | N | to do | |
| C2b | N | to do | |
| C2c | H | to do | |
| C3 | N | to do | |
| C4a | N | to do | |
| C4b | N | to do | |
| C5a | H | to do | |
| C5b | N | to do | |
| C6 | H | to do | |
| C7 | E | to do | |
| L1 | lead | to do | |

## Lessons carried from 3e-3a

- Shell heredocs eat backslashes: write patch scripts to a file, or use the editor.
- CodeQL fails CI on any result (py/log-injection hit the bridge): keep text from outside on one log line, never log a value from a request.
- Agents running at once must not share files; the lead commits named paths once each lands.
- `gh` isn't logged in on the owner's PC. The workflow doc's way (a token from `git credential fill`) was refused by the session's permission check on 2026-10-23, so pushing and the pull request may need the owner's go.

Carried: the packaged build must ship `@supabase/realtime-js` with main, and Deno plus `yt-dlp-ejs` for subtitles (3h); the two known sync limits in ADR 0012. Code scanning isn't enabled for the repository (the owner's choice). The owner's files under `design/` aren't part of this step.
