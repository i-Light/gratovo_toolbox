# PROGRESS: plan step 6 (Reach)

Plan: `.router/PLAN.md` (decisions D1–D19, D6a). Map: `.router/CONTEXT.md`.

## Where it stands (2026-10-25)

- **6a done** on branch `feat/6a-reach-drafts` (pull request opened from it). All checks pass: lint, typecheck, Vitest 2708, pytest 1636, the Electron suite (the Reach smoke test `e2e/reach-board.spec.ts` included).
- **Next: 6b** (D9 and D12): the Mailboxes tab (capacity, warm-up, the cap stepper 10–50, pause, bounce and reply rates, the slowdown rule, a test email to the mailbox's own address), the header capacity summary as a button to it, Send later (their morning, tomorrow 09:00, Monday 09:00) and Toolbox › Scheduled. Plan its tasks in PLAN.md first (a "Tasks for 6b" table), as 6a's.

## What 6a's review found and how it was fixed (keep for ADR 0018 in 6e)

The `router-reviewer` found no way to send without approval, and nine problems, all fixed:

1. Critical: main's copy of an approved draft (its own `sendAt`, `updatedAt`) counted as news and went into every undo step, so Undo wrote nothing and the email went. Now `mergeDrafts` in `renderer/lib/live.ts` merges field by field: a person's field is news only when main's value differs from what the page showed. A test echoes main's own times.
2. High: a write while `opened()` awaited the mailbox status could fire a draft left approved by an earlier run. The sender now arms only after `start()` (`started` flag; `drop()` clears it).
3. Medium: the Gemini pause and the 60 s gap were in memory only. `gemini/pacing_state.py` keeps the pause end, the last send and the recent page errors in `<profile-dir>/gemini-pacing.json` (atomic writes; malformed reads as empty; clamped).
4. Medium: a blocked draft could never be sent. The `blocked` gate steps aside once the person edits; the send-time check sends it back if it still blocks, and with no check possible it comes back `needs_check`. A pass lifts the engine's `blocked`.
5. Medium: an ignored write (Undo after the send started) didn't reach the page: `afterWrite` now always tells the page.
6. Low: `approved`/`scheduled` refused on a `maybe_sent` draft.
7. Low: the page matched mailboxes with `===`: `findMailbox` in core, used by page and main.
8. Low: rows going back to `ready`/`skipped`/`drafting` clear `approved_by` and `send_at` (in `updateDraft`).
9. Low: no Gemini answer text in a log line (`actions.py`, `server.py`).

Other fixes found by the lead in 6a: the page took main's frame changes only when signed in (example data never updated); `takeBack` was an undo step (Ctrl Z could re-approve); main now gives every approval its own 10 s hold (`sendHoldMs`); the drafter started "ready" before checking the bridge; the seed's shortlisted c14 broke Find's flows (removed, seed version 4).

## Known limits after 6a

- `comms/pool.py` (a hand-run tool) paces in memory only, per run.
- Example creators (`c1`…) show the record summary in the peek, with the Emails section under it.
- The record page's Full page button doesn't carry the tab.
- "Send as new" asks with an inline Yes/Cancel.
- A send waiting in the quick queue at quit comes back `maybe_sent` (the safe side).
- Drafts and threads are local to this computer until step T.
- The pre-commit hook can't take ~100 files at once on Windows ("The command line is too long"): commit in batches of about 30 named paths.
