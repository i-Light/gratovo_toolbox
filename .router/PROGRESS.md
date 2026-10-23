# Progress: step 3e-3b (mail and the remaining jobs)

Branch `feat/3e-3b-mail-and-refetch`, from `main` at f5a9e7a (3e-3a merged as #16 on 2026-10-23). The plan is `.router/PLAN.md`, section "3e-3b" at the end of §Tasks (detailed 2026-10-23 by the lead on Opus: decisions D14 to D21, the contracts, tasks C1 to C7 and L1).

**Solo first** (owner, 2026-10-21): nothing here touches `r2.py`, `sync.py` or team work. **Never send an email, never read the mailbox**: every mail test runs on a fake client; no test reaches the network.

## Tasks

| id | tier | state | note |
|---|---|---|---|
| C1 | H | done | the contracts on both sides (resumed once after a session restart). Beyond the contract: deploy `url` is `secretUrl`; test `status` 0..999; Python regexes use `[0-9]`; `Emitter.reply(sender=, sender_name=)` measures the line in UTF-8 bytes; `allow_job_hosts` replaces, not adds; defaults are constants in protocol.py (`REPLIES_LIMIT`, `REFETCH_KEYWORD`, `BACKFILL_MONTHS`, `BACKFILL_MAX_API_CALLS`, `MAX_REPLY_BODY`, `MAX_FAILED_HANDLES`), not filled in by `parse_start`; the stub test skips a module whose docstring no longer says "A stub". The lead fixed four callers outside its list (find-service's error mapping now `findErrors` or `crash`; three tests narrow to `SearchJob`) |
| C2a | N | done | `mail/gmail.py`, 60 tests; extra `MessageTooLargeError` (`bad_start`); a failed `rfcMessageId` read-back after a send returns null instead of raising (no double send); the token refresh retries too |
| C2b | N | done | `mail/mailbox.py`, 28 tests; `approved_by` by guarded ALTER, `user_version` 1, `MailboxTooNewError`; four `# noqa: S608` for placeholder SQL (store.py has a per-file ignore instead) |
| C2c | H | done | `jobs/mail.py`, 51 + no-auto-send tests. Changes from the old tool: unacknowledged replies are offered on every sweep until `mail.ack` (the old sweep lost them once the conversation closed); `isFirstReply` is the conversation's earliest reply; the key is kept (so a retry is `send_uncertain`) when the send may have gone out (network drop, unreadable answer, unexpected error), freed only on a clear refusal; an empty subject no longer blanks the stored one; a duplicate reports `labelled`/`threaded` false |
| C3 | N | done | `jobs/video_stats.py`, 20 tests; old `youtube_error` gone (YouTubeError codes pass through); a non-decimal `ViewCount` is `not_found` |
| C4a | N | done | `jobs/refetch.py`, `YouTubeApi.channel_for_handle` (shares a `_query` helper with `_list`); an unknown handle costs one API call (its lookup's details are saved); no `run` line; a sweep archives with `found_via` limit 0 |
| C4b | N | done | `jobs/backfill.py` + enrich's store queries and `set_run_kind`; resumed once so the sweep takes a `limit` (search keeps 15, backfill asks up to 200; `example/__init__.py` and `fakes.py` follow); `backlog` isn't budgeted; `budgetReached` only when the ceiling refused a batch; signals derived after stamping |
| C5a | H | done (e69cea2) | `aws_sign.py`: SigV4, 42 tests incl. AWS's IAM example and four suite vectors; `sign(..., content_sha256_header=False)`, `SigningError`, both keys hidden from repr, no session token |
| C5b | N | done | `jobs/gateways.py`, 13 tests; ends `aws` only when nothing deployed and every failure was an auth refusal; AWS ids checked before use in a URL; a half-built API is deleted best effort |
| C6 | H | done | supervisor passes `result`/`reply`, `ended.result`; bad-line codes `wrong_result`, `extra_result`, `unexpected_reply`; result and reply text never logged, even on a bad line; `secretsOf` covers mail, AWS and destroy apiIds; quick lane logs `quick-<stamp>.log`; `pipeline-secrets.ts` (gateway changes queued per store; old list read strictly) and `jobs.ts` (`laneFor`, `runJob`); `index.ts` builds both lanes and shuts both on quit |
| C7 | E | to do | |
| L1 | lead | to do | |

## Lessons carried from 3e-3a

- Shell heredocs eat backslashes: write patch scripts to a file, or use the editor.
- CodeQL fails CI on any result (py/log-injection hit the bridge): keep text from outside on one log line, never log a value from a request.
- Agents running at once must not share files; the lead commits named paths once each lands.
- The pre-commit hook (lint-staged) stashes unstaged changes while it runs: don't commit while an agent is editing the same tree.
- `gh` isn't logged in on the owner's PC. The workflow doc's way (a token from `git credential fill`) was refused by the session's permission check on 2026-10-23, so pushing and the pull request may need the owner's go.

Carried: the packaged build must ship `@supabase/realtime-js` with main, and Deno plus `yt-dlp-ejs` for subtitles (3h); the two known sync limits in ADR 0012. Code scanning isn't enabled for the repository (the owner's choice). The owner's files under `design/` aren't part of this step.
