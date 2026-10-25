# PROGRESS: plan step 6 (Reach)

Plan: `.router/PLAN.md` (decisions D1–D21, D6a). Map: `.router/CONTEXT.md`.

## Where it stands (2026-10-25)

- **6a done** and merged (pull request #29).
- **6b done** on branch `feat/6b-reach-mailboxes`: D20 and D21 (Reach › Mailboxes, the slowdown rule, the test email, Send later, Toolbox › Scheduled). All checks pass: lint, typecheck, Vitest 2782, the Electron suite (74, with the new `e2e/reach-later.spec.ts`). Looked at in the built app at 1440 px: Mailboxes, the Send later menu, a scheduled card, Toolbox › Scheduled.
- **Next: 6c** (D13): sequences. Follow-ups planned on the first send (+3, +7, +14 days), drafted on the day they are due, the Sequences tab (the timeline), Stop, Park until a date, Skip. Plan its tasks in PLAN.md first (a "Tasks for 6c" table), as 6a's and 6b's.

## What 6b's review found and how it was fixed (keep for ADR 0018 in 6e)

The `router-reviewer` found no send without a person and no security problem, and twelve problems, all fixed with tests:

1. Medium: `zones` was missing from the page's merge lists (`live.ts`, `persist.ts`), so a draft written after the first load had no zone. Added; the merge test proves it (it fails without the fix).
2. Medium: a Redo of a Send later, or an Undo of its Cancel, after its time sent 10 s later. Main now refuses a `scheduled` write more than 60 s past (`scheduleGraceMs`): the draft stays `ready` with the new problem `time_passed`. Sending again clears it (and `late`, `not_sent_closed`).
3. A computer that slept past a Send later sent it on wake, days late. The 12 h rule now runs at fire time too (`sender.ts`).
4. Every live frame waited on a Find catalog rebuild for the zones. The catalog's new `peek()` gives the last build at once.
5. Rates: an unread bounce from `mailer-daemon@`/`postmaster@` counted as a reply; an answer counted for every mailbox that wrote to the creator; a statement was prepared per row. Fixed (`isBounce`, one prepared statement, answers matched by mailbox; a pasted answer with no mailbox counts for each).
6. The slowdown flag was written before its log line; a failed line lost it. The line goes first.
7. "Back to N a day" ignored warm-up. It names the cap that applies.
8. In sequence sorted a scheduled email last. It sorts by its time.
9. A Cancel that met a send already going said "Too late to undo". It says "Too late to cancel".
10. A cap changed in Settings › Connections reached Reach only on the next refresh. A Connections change now tells Reach.
11. A removed mailbox kept its pause and slowdown flags. They are forgotten on removal.
12. A damaged pause entry read as not paused. It reads as paused (one click to resume).

Found by the lead in 6b: a scheduled email sat in Waiting for you (it waits for its time, not for the person: it now shows in In sequence with its time); the "Send later" button broke 6a's smoke test locator; the Mailboxes callout wrapped its text under the icon; "Their morning" showed the local date with "09:00 their time" (it now shows the local time too); the stepper came back before main's new numbers arrived.

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

## Known limits after 6b

- Inbox placement ("8/10") is not built: the app can't see where a test landed without reading the mailbox. A warning before a mailbox's sign-in lapses needs the token's age, which isn't stored; the card shows Signed out with Sign in again.
- On live data the bounce and reply rates stay empty until 6d stores replies.
- The slowdown has no notification yet (6d builds that path); it shows on the card, the header and the activity log.
- The imported history threads (the example seed's `hist-ch-*`, live old mail in 6e) are in the frame's `reach.threads`; nothing lists them, but they cost frame size.

## Known limits after 6a

- `comms/pool.py` (a hand-run tool) paces in memory only, per run.
- Example creators (`c1`…) show the record summary in the peek, with the Emails section under it.
- The record page's Full page button doesn't carry the tab.
- "Send as new" asks with an inline Yes/Cancel.
- A send waiting in the quick queue at quit comes back `maybe_sent` (the safe side).
- Drafts and threads are local to this computer until step T.
- The pre-commit hook can't take ~100 files at once on Windows ("The command line is too long"): commit in batches of about 30 named paths.
