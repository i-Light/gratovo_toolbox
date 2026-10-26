# PROGRESS: plan step 6 (Reach)

Plan: `.router/PLAN.md` (decisions D1–D22, D6a). Map: `.router/CONTEXT.md`.

## Where it stands (2026-10-26)

- **6a**, **6b** and **6c** are done and merged (pull requests #29, #30 and #31).
- **6d done** on branch `feat/6d-reach-replies`: D23 (replies). The background sweep and ack, Gemini's reading with its facts and That's not it, Save to record, Paste a reply, notifications and stage moves, a reply or a bounce stopping the sequence, Reach › Replies in the live rail, and the slowdown's notification. Lint, typecheck and Vitest 3000 pass. The new smoke test `e2e/reach-replies.spec.ts` passes, with the other Reach smoke tests. I looked at Replies in the built app at 1440 px.
- **Next: 6e**, the last part of step 6:
  - The old mail history (D19): import the old `mailbox.db` and outreach rows; old replies come in with no effects (the sweep's 30-day rule, `oldReplyMs`).
  - The full Reach flow suite (two-tier testing: the end of a major step).
  - ADR 0018, from the review sections below.
  - The architecture and parity notes (rows 24–48 and 123–125; 32 DMs and 39 not built).
  - The status table; remove `.router/` once step 6 is complete.

## What 6d's review found and how it was fixed (keep for ADR 0018 in 6e)

The `router-reviewer` found no automatic send and no way to read the connected mailbox beyond the pipeline's own replies job, and fifteen points, all handled:

1. The facts reader read our own quoted email as theirs, and was loose. `ownWords` cuts the quoted history first. US and UK match only as written (never "us" or "America"). A rate is never a percentage or an engagement, open or click rate. An age band is never a length of time and needs an age or viewer word nearby. Shares like "40% of viewers in Germany" read.
2. A parked creator who replied kept a park day. Replies, bounces and the never-contact stop clear `parkUntil`; the page shows a sequence stopped by a reply or bounce as stopped whatever its park day.
3. A reply later read as a bounce left the creator at `replied`. With no other real reply in, the stage goes back to `emailed`, and the bounce notice replaces the "replied" one.
4. The rail's Reach count used its own rule. It uses `repliesToAnswer(replyItems(...))`, the same as the page.
5. A never-contact or rejected creator who replied kept getting follow-ups. Their sequence stops and open follow-ups are skipped, with no stage move, notice or answer. Replies shows them as "Not contacting".
6. Unconfirming a bounced address lost its source and confidence. Kept.
7. Reclassify always said "Writing the answer again". It answers `rewritten`; the toast says "Reading changed; the answer was not written again" when it wasn't, and a bounce leaves no stale undo entry.
8. A correction was lost on the next rewrite (Shorter and the like). Every proposal for that answer carries "Read their reply as: <label>".
9. Unmatched replies were never acked and logged every sweep. Ack covers every swept id; each unmatched id is logged once per run.
10. An address shared by two creators matched the first. It stays unmatched. A reply over 30 days old is stored and acked with no effects.
11. Rate facts reached a viewer who doesn't see money. Stripped from the frame.
12. No line when Gemini hadn't read a reply. It says "Gemini hasn't read it yet" (not for a bounce).
13. The paste toast promised an answer that wouldn't come. Its second line follows the creator's stage and any open answer.
14. Save to record could mark a newer reply's fact. It checks the message id. With no situations file the picker says so.
15. This file and the status table, updated in this commit.

## Known limits after 6d

- A pasted reply can't be undone, and a sequence stopped by a reply can't be resumed (Resume takes only the person's own stop).
- Replies keeps answered creators listed, marked "Answered" (a deviation from D23, recorded there).
- `reach:thread` still sends a reply's rate fact to a viewer who doesn't see money; only the frame strips it. It matters only for teammates, so it is fixed with step T.
- A packaged build has no situations file until step T ships it, so That's not it has nothing to pick there.

## What 6c's review found and how it was fixed (keep for ADR 0018 in 6e)

The `router-reviewer` found no automatic send and no security problem, and seventeen points, all handled:

1. High: the frame listed every sequence, capped at 5000 by the schema, so the data would stop loading after a few months. Now it lists running, parked, stopped by you, and those ended in the last 30 days, newest first, `LIMIT reachSequencesMax` (2000). The day timer reads running ones on its own.
2. Overdue steps went back to back. A step sent late moves the later ones; Resume re-times like Wake.
3. Stop or Park, then Undo, lost the follow-up draft. Stop and Park answer with the drafts they skipped, and their Undo brings them back (never as `approved` or `scheduled`, so an Undo never sends).
4. The stage and `park_until` could drift, leaving a creator stuck. A `parked` stage counts as parked on the page; Wake accepts either; the day tick writes the stage only when it is `parked` and skips never-contact creators.
5. Park was offered on a stopped sequence and always refused. Offered only on a running one.
6. The no-automatic-send test now runs live mode with a fake bridge and fake jobs, through the real skip path.
7. The park day had no bounds. It does, and main checks it is finite.
8. `parkChoices` overflowed month ends. Clamped.
9. `planSteps` used 24 h multiples (a step could land on the wrong day across a clock change). It adds calendar days.
10. `isFinished` counted milliseconds; it counts days.
11. A double-click on Wake, or a Wake during the day tick, could commit twice. Once only.
12. Undo out of `skipped` restores its step before any early return.
13. A follow-up row and its step `drafted` were written in two transactions. One now (`commit` takes `newDrafts`).
14. Until 6d a reply doesn't stop a sequence: recorded below, and the empty state no longer promises it.
15. The day tick reruns on resume from sleep (`powerMonitor`). Commands now tell the page's log and creators too.
16. The seed's comment fixed. The plan records that no parked or stopped creator is seeded.
17. This file and the status table, updated in this commit.

## Known limits after 6c

- On live data, until 6d stores replies, a creator who replies keeps getting follow-up drafts. None is sent without a person pressing Send.
- Example follow-ups use the stand-in text of a first email.
- Stop, Resume, Park and Wake are commands with an Undo button on their toast; Ctrl Z does not cover them (as with mailboxes in 6b).

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
