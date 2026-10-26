# 0018. Reach

- **Date:** 2026-10-26
- **Status:** accepted for step 6 (Reach, up to reading replies and their intent; Toolbox › Scheduled). It records the plan's decisions (D1 to D23 and D6a of the step's `.router/PLAN.md`, removed when the step ended and kept in the git history before the 6e merge) as built, over the pull requests #29 to #32 and 6e. Where the build differs from the plan, the build is written here and the difference is said. It uses the comms engine and the Gemini bridge of ADR 0014, the mail jobs of ADR 0015, and the live gate and old-data import of ADR 0016; it tightens ADR 0014's Gemini use (item 8). Those records otherwise stand.

## Context

Step 6 takes a creator with a confirmed address to a drafted first email, an approved send, the follow-ups, and a reply read and classified, all inside Reach, on live data.

It was built in five pull requests: 6a (the outreach store, the drafter, the draft card, Send with Undo, the Board, the record's Emails tab), 6b (Mailboxes, Send later, Toolbox › Scheduled), 6c (the follow-up sequences), 6d (replies) and 6e (the old mail history, the flow suite and this record).

Three things shaped it. The owner's rule that nothing is sent without a person pressing Send. The owner's Gemini pacing (one prompt per fresh chat, 60 s between sends), which drafting in the background would otherwise break. And solo first: outreach stays on this computer until step T.

## Decision

### Storage

1. **Outreach lives in the open data source's `gratovo.db`, not synced yet.** Migration 0004 adds three STRICT tables: `outreach_drafts` (every draft a person sees and approves), `outreach_messages` (every email in or out, per creator) and `outreach_sequences` (the follow-up plan per creator). Example and live data never mix: each source has its own file. Step T maps them to the server. A creator's stage still syncs through `channel_state`. Python's `mailbox.db` stays the record of what Gmail did (send keys, conversations, inbound ids).
   *Why:* new synced tables would need server migrations and grants for a team feature nobody uses yet.
2. **One conversation per creator,** key `c:<channelId>`. Follow-ups and answers go from the mailbox of the creator's sequence, and the From picker is locked for them.
3. **Reach's read model is part of the frame** (`Frame.reach`: drafts, sequences, thread summaries, mailboxes, zones, the Gemini state, the sender name). Message bodies are not in the frame: `reach:thread` returns them. Main changes it with `frame:changed` part `reach`, and the page adopts it with `adoptServerData`.
4. **Drafts merge field by field** (`mergeDrafts`, `renderer/lib/live.ts`). A person's field counts as news only when main's value differs from what the page showed. *Why:* 6a's review found that main's own copy of an approved draft (its `sendAt`, `updatedAt`) went into every undo step, so Undo wrote nothing and the email went.
5. **Writes:** `draft.state`, `draft.text`, `draft.mailbox`, `draft.gate` and `reply.fact` go through `data:write`. A state change on a draft that is `sending` or `sent` is ignored and main pushes `reach`, so the page corrects itself. Typing in the card is not an undo step: it writes `draft.text` 600 ms after the last key, on blur and before a send. A rewrite's Undo is an act that writes the old text back.

### Drafting

6. **The drafter** (`main/reach/drafter.ts`) runs one queue and one Gemini call at a time: answers first, then follow-ups due, then first emails, oldest confirmed first. A first email is written for each creator at `contact` with a confirmed address, no open draft, no sequence and no message out. The row is created `drafting` at once, then filled from `action.comms_propose`. Status `blocked` becomes `ready` with the `blocked` gate; a failed call becomes `failed` with Try again. With the bridge off, drafts wait and Reach shows one banner with **Start Gemini**, the only place besides Settings that starts it, and only on a click.
7. **Example data never calls Gemini.** A stand-in fills each draft, rewrite, reading and answer 0.9 s later.
8. **The owner's Gemini pacing is enforced in the bridge** (D6a), for every prompt. `gemini/client.py` waits until 60 s after the previous send and always opens a new chat. The engine's follow-up turns (format, repair, the coach's rewrite) are each a standalone prompt in a fresh chat. A refusal, or the third page error in 15 minutes, pauses every prompt-sending method for 30 minutes (`gemini/pause.py`, code `PAUSED`), kept across bridge restarts in `<profile-dir>/gemini-pacing.json`. `actions._ask` no longer retries a refusal. Main waits 60 s per possible prompt.
9. **The facts main sends** (`main/reach/facts.ts`): the agency (name, the sender, the engine's defaults made explicit), the thread oldest first, the creator's stage, and the newest 20 outbound bodies (so the engine can refuse a templated email).
10. **Rewrites:** Shorter, Warmer, More direct and New angle re-propose with a steer note. The old text is kept for the toast's Undo and Ctrl Z. A corrected reading is added to every answer's steer (item 31).

### Gates and sending

11. **Gates are pure** (`packages/core/src/reach/gates.ts`), in this order: never contact (no override); an unconfirmed address (Confirm in place); no mailbox, signed out, paused or full ("Send from <other> instead"); `blocked`; each engine gate not yet confirmed. Main runs the same function right before a send, and main's answer wins.
12. **Send holds 10 s, and only a person's write approves.** Send is an act: the draft becomes `approved` with `sendAt` set by main, never by the page. Undo within the hold puts it back. At `sendAt` main re-reads the row, re-checks the gates, checks edited text with `action.comms_check` (no Gemini prompt), marks it `sending` and queues `mail.send` on the quick lane through the quick queue, which never drops a send. *Proven by tests:* a `mail.send` start is built only by `sender.ts`, only from a row in `approved` or `scheduled` with `approved_by` set, and only `data:write` sets those states. The drafter, the sweep and the sequence code never produce `approved`; a fake supervisor sees no `mail.send` without a person's write.
13. **A send that may have gone is never retried.** `send_uncertain`, a network error after the request, a crash or a kill mid-send make the draft `failed` with `maybe_sent`: "It may have gone out. Check Gmail's Sent folder", with **It was sent** and **Send as new** (asks first, new send key).
14. **The app closed during the hold:** on start an `approved` draft becomes `ready` with `not_sent_closed`. A Redo, or an Undo of a Cancel, that would set a time more than 60 s past is refused (`time_passed`).
15. **Done:** one transaction writes the message, the draft `sent`, the stage `contact → emailed` (through the normal stage write, so it syncs), a log line by the approver, and the sequence.

### Send later and mailboxes

16. **Send later:** their morning (09:00 in the creator's channel country's zone, from a table of about 40 countries in core; unknown → the sender's time), tomorrow 09:00, Monday 09:00. A scheduled draft more than 12 h late when it comes due (at start, or after a sleep) goes back to `ready` with `late`. **Toolbox › Scheduled** lists them soonest first, with Cancel (an act).
17. **Mailboxes** (Reach › Mailboxes): each mailbox's sends today, warm-up (30 days, at most 20 a day), the daily limit from 10 to 50 in steps of 5, Pause and Resume, bounce rate (7 days) and reply rate (30 days, creators who answered a first email), both null under 10 sends. A test email to its own address on a click (`reach:send-test`, never stored as outreach).
18. **The slowdown rule** (`slowedNext`): bounces over 3% hold a mailbox at 20 a day until they are under 2%. A change writes a log line and a notification.
19. **Mailbox settings, Stop, Resume, Park and Wake are commands, not undo steps.** They come from main, and an undo step would need a field merge like item 4. Each toast has an Undo button that runs the opposite command; Ctrl Z does not cover them.

### Sequences

20. **A sent first email plans three follow-ups** at +3, +7 and +14 calendar days (`planSteps`), in the sender's commit. On the day a step is due the drafter writes it, and it waits for a person to send it. A step sent late moves the later ones, so the gaps stay. Seven days after the last step with no reply, the sequence is finished.
21. **Stop** skips the open follow-ups and puts their steps back to planned; **Resume** re-times them. **Park until** (2 weeks, 1 month, 3 months) sets the stage `parked`; on that day the stage goes back to `emailed` and the steps are re-timed. Stop and Park answer with the drafts they skipped, and their Undo brings exactly those back, never as `approved` or `scheduled`, so an Undo never sends.
22. **The day timer** runs at each local midnight, at start, and after the computer wakes from sleep (`powerMonitor`).
23. **The frame lists** running, parked and stopped-by-you sequences, and those ended in the last 30 days, at most 2,000. *Why:* 6c's review found the frame would stop loading after a few months.
24. **Reach › Sequences** shows every creator on a timeline, 14 days back and 14 ahead, with the next step. The Board, the record's Emails tab and the send toast name the next follow-up.

### Replies

25. **The sweep** (`main/reach/reply-sweep.ts`) runs `mail.replies` on live data with a connected mailbox: 30 s after start, every 10 minutes and on **Check now**. It matches each reply by `channelId`, then by the conversation key, then by the sender's address when exactly one creator has it. An unmatched reply is logged by its message id once per run and not stored. Each reply is stored once (`gmail_message_id` unique), all of one sweep in one transaction, then `mail.ack` covers every swept id. The mailbox is read only by `mail.replies`; example data never sweeps.
26. **A reply:** in one commit, the stage `emailed` or `parked` → `replied`, the sequence stops as `replied` (its park day cleared), open follow-ups are skipped, a notification "X replied" goes to Reach › Replies, a log line, and an answer draft is queued. The answer is only ever drafted. A reply over 30 days old (`oldReplyMs`) is stored and acked with no effects. A never-contact or rejected creator's reply stops their sequence and skips follow-ups, with no stage move, notice or answer.
27. **A bounce** (from `mailer-daemon@` or `postmaster@`, or read as `any.bounce`) stops the sequence as `bounced`, skips the follow-ups, marks the address not confirmed (keeping its source and confidence), and tells the person. Nothing is answered. A reply later read as a bounce, with no other real reply in, moves the stage back to `emailed`, and the bounce notice replaces the "replied" one.
28. **The reading comes free with the answer.** When the answer's proposal arrives, its `situation` becomes the reply's reading: the type, the label from the pipeline's `situations.json`, the summary, the side, and the facts. No extra Gemini prompt. Until then the page says "Gemini hasn't read it yet".
29. **Facts** (`readReplyFacts`, pure, in core): a rate, top countries with shares, an age band. The reader is cautious, because a wrong rate on the record is worse than none: our quoted email is cut off first; US and UK match only as written; a rate is never a percentage or an engagement, open or click rate; an age band is never a length of time and needs an age or viewer word near it. **Save to record** writes `reply.fact`, which merges into `channel_state.provided_data` and syncs as `channel.edit provided_data` with its base. A rate fact is stripped from the frame for a viewer who doesn't see money.
30. **That's not it** opens the side's situations and `reach:reclassify` marks the reading corrected. An open answer that is ready is written again; the answer says whether (`rewritten`), and the toast says so. A drafting, approved or scheduled answer is left as it is.
31. **A correction steers every later rewrite** of that answer ("Read their reply as: <label>").
32. **Paste a reply** (at most 20,000 characters) works for a creator with an email out. It does what a swept reply does, except the notification.
33. **Reach › Replies** lists every creator who wrote back, newest first, with the reading's tag and "Draft ready", "Your move", "Answered", "Bounced" or "Not contacting". *Differs from the plan:* answered creators stay listed, so a conversation doesn't vanish the moment it is answered. The rail's count is drafts waiting plus "Draft ready" and "Your move", from the same pure function the page uses.

### The old mail history

34. **The old data import also brings in the old mail** (D19), in two steps after the pipeline's job has committed, each with its own warning (`old_mail`, `old_mailbox`); the rest of the import stands either way. *Differs from the plan:* there is no second button; a person who imported before 6e uses "Bring it in again", which adds nothing twice.
    - **The email log** (`outreach_threads` and `outreach_messages` of the old `gratovo.db`, opened read-only and immutable, so SQLite writes nothing beside it; emails only) becomes messages with `source: "imported"` and ids `imported-<old id>`. It brings in the newest 50,000 and says so when it cut. Subjects, addresses, ids and creator ids are cut or skipped to the frame's limits.
    - **The old `mailbox.db`** beside it is merged, not copied, by the pipeline's quick-lane job `mail.import`, in turn with the mail jobs. *Differs from the plan:* a copy "only when none exists" would almost never happen, since any mail job creates the file (review of 6e, finding 2). The job attaches the old file read-only and immutable and adds its rows with `INSERT OR IGNORE`, so rows this app has win. Old conversations come in already checked, and those quiet for 60 days are closed, so the reply sweep (60 conversations a run, least recently checked first) never stalls behind them. Old follow-up steps are never sent. The path is held to the same checks as the picked file.
35. **Old mail never acts.** An imported reply shows in the thread but never counts as a reply to answer. Imported messages have no mailbox and are left out of the reply rate, so they never count in a mailbox's sends or rates. The drafter's "no message out" rule ignores them, so a creator the old app mailed and Find shortlists again gets a first email, as Find promises; Paste a reply accepts them as the email out. Old sequences are not resumed: a creator with old mail and no sequence gets none. Find's "emailed before" still reads the stages only (the legacy stage and this app's), not the imported messages.

### The page and the live gate

36. **Reach in the live rail** has Board, Sequences, Replies and Mailboxes (`liveWired.reach`), and Toolbox has Scheduled. The Board's lanes are pure (`reach/board.ts`): To draft, Waiting for you, In sequence, Replied. Media kit and Signed show on example data only, until step 8. Each card opens the creator's peek on its Emails tab.
37. **The record's Emails tab:** the thread ("Show N earlier"), Gemini's reading under their last message, Paste a reply, the open draft cards, and the next step or "Draft the first email".
38. **Strings** are all in `renderer/strings.ts` (main's own in `main/reach/strings.ts`, such as the rewrite notes and the test email).

### Testing

39. Each sub-step added one light smoke test: `reach-board`, `reach-later`, `reach-sequences` and `reach-replies`. 6e added the Reach flow suite, one file with six flows (`e2e/reach-flows.spec.ts`; the plan said a file per flow): the rail and tabs, a rewrite and its Undo, pausing a mailbox, Park and Wake, a reply's reading with Save to record and That's not it, and Check now. Every sub-step had a `router-reviewer` review, and every finding was fixed or recorded here.

## Consequences

- Until step T, outreach is on one computer. A teammate sees a creator's stage move, not the emails.
- Ctrl Z covers drafts and stage moves, but not mailbox settings or sequence commands, which have an Undo button on their toast instead.
- Drafting stays slow by design: at most one prompt a minute through the bridge.

## Known limits and follow-ups

- **A pasted reply has no Undo,** and a sequence stopped by a reply can't be resumed (Resume takes only the person's own stop).
- **`reach:thread` still sends a reply's rate fact** to a viewer who doesn't see money; only the frame strips it. It matters only for teammates: fix it with step T.
- **A packaged build has no `situations.json`** until step T ships it, so That's not it has nothing to pick there, and says so.
- **Inbox placement** (where a test email landed) is not built: the app can't tell without reading the mailbox.
- **A warning before a mailbox's sign-in lapses** is not built: the token's age isn't stored. The card says "Signed out" with Sign in again.
- **A reply logged by hand in the old app** and also found by the sweep in the old `mailbox.db` shows twice in the thread.
- **Example follow-ups** use the stand-in text of a first email.
- **Old times with no zone** in the old app's log are read as local time.
- **Imported threads take frame slots.** The frame keeps at most 5,000 thread summaries, newest first, and a large old log can fill them with old creators. The summaries are found over small columns only, so the frame stays quick (review of 6e, finding 3).
- **Two flaky tests outside Reach** each failed once in `pnpm verify` during 6d and passed on a rerun: the Supabase refresh-token reuse test (a time window) and `e2e/find-search.spec.ts` (a 60 s wait under full-suite load).

## Parity rows this step answers

Numbers are from `docs/product/parity-checklist.md`. Step 10 ticks the boxes.

**Cold emails**
- 24 Who is ready: built (the Waiting for you lane and the rail count; the Today bucket is step 7).
- 25 Draft the first email: built (drafted in the background once a contact is confirmed).
- 26 Why, rules, checks, recipient: built (Why this email, the house rules, the gates inline).
- 27 Edit and send: built (edit in place, Ctrl Enter, 10 s Undo).
- 28 Which mailbox: built (the From picker with each mailbox's capacity).
- 29 The cap and warm-up before sending: built (on the card and in Mailboxes; Today is step 7).
- 30 Open the creator from the card: built (every card opens the peek, O opens the record).
- 31 Email one creator: built (one draft card everywhere).
- 32 DMs: not built (the owner's decision).

**Follow-ups**
- 33 The follow-up when due: built (drafted on its day, in Waiting for you; the Today bucket is step 7).
- 34 Draft and send it: built (the same card; the toast names the next date).
- 35 Schedule by hand: built (Send later).
- 36 Every follow-up in one place: built (Reach › Sequences).
- 37 Open the thread from a notification: built for replies and bounces (the notification opens Replies).
- 38 Stop and come back later: built (Stop, Park until, Wake; the return to Today is step 7).
- 39 Brand follow-ups: not built here, step 8.

**Replies**
- 40 Know a reply came: built (a notification, Replies, the rail count).
- 41 Check now: built (the background sweep, Check now, Paste a reply).
- 42 Read the reply while answering: built (their message above the answer, with Gemini's reading).
- 43 Draft the answer: built.
- 44 Correct the reading: built (That's not it, plus the four rewrites).
- 45 Label the reply: built (the reading, facts saved to the record in one click). The stage move to the media kit is step 8.
- 46 A reply that came another way: built (Paste a reply).
- 47 Trust the status: built (a reply moves the stage and stops the sequence).
- 48 Skip or snooze: in part (Skip on the card, Park until, Never contact from Find and Toolbox; snoozing a single card is step 7's Today).

**Mail**
- 123 Connect mailboxes: in part (Settings › Connections connects; Mailboxes shows signed out with Sign in again; no warning before a sign-in lapses).
- 124 The cap and warm-up: built (the stepper and the warm-up on each mailbox).
- 125 Mailbox health where you send: built (on every draft card and in Mailboxes; Today is step 7).
