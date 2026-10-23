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
| A1 | done (cef52e7) | H (lead) | `gemini-protocol.ts`, `gemini.schema.json`; the extension's own codes added later |
| A2 | done | N | server, client (actions imported lazily), `tests/fake_extension.py`; the CLI tests dropped (D13). Also lead: `errors.py` (every class, code list = TS list), `progress.py`, the `loopback` test fixture, `json_reply.py`, `paths.py` |
| A3 | in progress | N | actions, keywords_batch, the three client tests A4 set aside, pyright clean on `gemini/`. Hit the usage limit 2026-10-21, resumed 2026-10-23 |
| A4 | done | N | gems, skills |
| A5 | done | N | `gemini/browser/` (profile folder passed in) |
| A6 | next, after A3 | H | daemon and `browser_manager.py` on `python -m gratovo_pipeline.gemini`; makes A7's real-process test pass |
| A7 | done, real test waits for A6 | H (lead) | `gemini-service.ts`, `lines.ts` shared with the supervisor, quit hook in `index.ts` |
| B1 | in progress | H | course (configured, no `E:` default), playbook, checks (`COURSE_CHECK_SKIPPED`), readiness written; engine and example_bank to go. Resumed 2026-10-23 |
| B2 to B5, A8, L1 | not started | – | – |

Data moved (lead): `services/pipeline/data/comms/` and `data/gemini-skills/`; the quote-review lease file is ignored. The owner's new files under `design/` (workbench v6) aren't part of this step.

## Rules carried from 3e-1

Secrets only in the start message (the bridge needs none); `python -I`; no network in tests (the bridge's tests may use `127.0.0.1` only, D5); pyright strict; each old test ported first and seen to fail; stage named paths and commit once agents are done.

Carried: the packaged build must ship `@supabase/realtime-js` with main (3h), and Deno for yt-dlp (3h, D12); the two known sync limits in ADR 0012. Code scanning isn't enabled for the repository, so CodeQL can't publish results (a repository setting, the owner's choice).
