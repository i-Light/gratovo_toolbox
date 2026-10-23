# Progress: step 3e-3 (the rest of the Python pipeline)

Branch `feat/3e-3-pipeline-rest`, from `main` at 11b3c7a. The plan is `.router/PLAN.md` (written 2026-10-21 by the lead on Opus; 3e-1's plan is in git history at dc13dd5).

**Solo first** (owner, 2026-10-21): 3e-2 (R2) is step T1. 3e-3 must not touch `r2.py`, `sync.py` or anything team-only.

## The owner's answers (2026-10-21)

1. **Two pull requests:** 3e-3a (the Gemini bridge and the comms engine, with the course data and transcripts) and 3e-3b (Gmail and the mailbox, video stats, refetch and backfill, the AWS gateway tool). One per session.
2. **The comms quality tools** are ported, as tools a session runs by hand (in the flat `comms/` package, D1).
3. **The course text for the copy check** comes from a folder path set in Settings on this computer (D8). Without it, that one check is skipped and the proposal says so.
4. **News and the Email library wait** for their parity §6 decision (step 9): `feeds.py`, `news.py` and `email_library.py` aren't ported.

## 3e-3a: done (2026-10-23), in its pull request

Every task of PLAN.md's 3e-3a table is done: A1 to A8, B1 to B5, L1. Decisions in ADR 0014. Checks at the end: 1,501 Vitest, 855 pytest (3 skipped: the owner's course and mined calls), lint and typecheck clean, 63 Electron tests, Windows CI. `router-reviewer` found 12 points; all were fixed (the bridge now refuses web pages, main's timeouts match the bridge's, a check opens pipeline.db read-only, the real-process test uses a free port, recent emails are filtered by thread) or recorded in ADR 0014's consequences.

For the owner (in the PR): two old bugs fixed (the opener check, verify's "50k"); the shipped `gratovo-comms` skill is older than the playbook (rebuild and deploy it); 41 video quotes wait for a check by ear.

## Next: 3e-3b, in a fresh session (plan §10 rule 5)

1. Branch from `main` after 3e-3a merges. Detail PLAN.md's 3e-3b outline first (tier H): C1 the job additions in `protocol.ts` and the Python mirror (the contract is in PLAN.md "Job additions"), C2 mail (gmail over urllib, mailbox.db, send with `sendKey` and `approvedBy`, never automatic; ports test_mailbox and test_email_send_no_auto_send), C3 video_stats, C4 refetch and backfill (the manual refetch and import_handles, enrich without its sync; 3e-1 left the catch-up thread pool and `[catchup-io]` lines), C5 `aws_sign.py` and the gateways job, C6 main's `result` handling and the secret-store keys (`mail.client`, `mail.mailboxes`, `aws.keys`), C7 ADR 0015 and the status table; L1.
2. Rules: D9, D11, D12 and D13 of PLAN.md; never send an email, never read the mailbox; the consent flow to connect a mailbox is step 6 (main), so no refresh token ever goes to stdout.
3. Lessons from 3e-3a: shell heredocs eat backslashes (write patch scripts to a file, or use the editor); CodeQL fails CI on any result (py/log-injection hit the bridge); agents running at once must not share files, and the lead commits named paths once each lands.

Carried: the packaged build must ship `@supabase/realtime-js` with main, and Deno plus `yt-dlp-ejs` for subtitles (3h); the two known sync limits in ADR 0012. Code scanning isn't enabled for the repository, so CodeQL can't publish results (a repository setting, the owner's choice). The owner's new files under `design/` (workbench v6) aren't part of this step and aren't committed.
