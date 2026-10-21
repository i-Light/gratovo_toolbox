# Progress: step 3e-3 (the rest of the Python pipeline)

Branch `feat/3e-3-pipeline-rest`, from `main` at 11b3c7a. The plan is `.router/PLAN.md` (written 2026-10-21 by the lead on Opus; 3e-1's plan is in git history at dc13dd5).

**Solo first** (owner, 2026-10-21): 3e-2 (R2) is step T1. 3e-3 must not touch `r2.py`, `sync.py` or anything team-only.

## The owner's answers (2026-10-21)

1. **Two pull requests:** 3e-3a (the Gemini bridge and the comms engine, with the course data and transcripts) and 3e-3b (Gmail and the mailbox, video stats, refetch and backfill, the AWS gateway tool). One per session.
2. **The comms quality tools** (coach, graduate bar, pairwise, scenarios, call mining, quote review, Whisper check) are ported, under `comms/studio/`, as tools a session runs by hand.
3. **The course text for the copy check** comes from a folder path set in Settings on this computer (D8). Without it, that one check is skipped and the proposal says so.
4. **News and the Email library wait** for their parity §6 decision (step 9): `feeds.py`, `news.py` and `email_library.py` aren't ported.

## Tasks (3e-3a)

| id | state | tier used | note |
|---|---|---|---|
| A1 to A8, B1 to B5, L1 | not started | – | Plan written and answered; building starts with A1 |

## Rules carried from 3e-1

Secrets only in the start message (the bridge needs none); `python -I`; no network in tests (the bridge's tests may use `127.0.0.1` only, D5); pyright strict; each old test ported first and seen to fail; stage named paths and commit once agents are done.

Carried: the packaged build must ship `@supabase/realtime-js` with main (3h), and Deno for yt-dlp (3h, D12); the two known sync limits in ADR 0012. Code scanning isn't enabled for the repository, so CodeQL can't publish results (a repository setting, the owner's choice).
