# PLAN: plan step 6, Reach (up to reading replies and their intent)

Written 2026-10-25 by the lead (tier H). Read `.router/CONTEXT.md` first. The prototype is the spec: `design/workbench-prototype/js/reach.js` (the screen), `records.js` (the draft card, thread, AI reading), `engine.js` (send, skip, steer, paste, confirm), `more.js` (Toolbox › Scheduled).

## Goal

From a confirmed contact to a drafted cold email, an approved send, the follow-up sequence, and a reply read and classified, all inside Reach, on live data. Nothing is ever sent without a person pressing Send.

## Non-goals (and where they go)

- Today, its buckets and focus mode: step 7. Until then the draft card lives in Reach (the record's Emails tab, opened in the peek) and in Reach › Replies.
- Media kit, audience check, Sign creator, the Media kit and Signed board lanes in live mode: step 8. Brand emails, pitches, price negotiation: step 8.
- Syncing drafts, threads and sequences to Supabase, hand-offs, teammates' mail: step T.
- Settings › Agency facts (step 8) and the Settings rows for caps and sender name beyond what step 4 built (step 9).
- DM drafts (parity 32): the owner's decision, not built.
- The four gaps on hold (`search-1`, `first-1`, `mail-1`, `mail-2`): not touched.

## Acceptance (the plan's step 6 checks)

1. Reach shows in the live rail with Board, Sequences, Replies and Mailboxes; Toolbox › Scheduled shows.
2. The loop works end to end on fakes: confirmed contact → first-email draft (Gemini through the comms engine) → approve → `mail.send` → sequence with follow-ups at +3, +7, +14 days → a reply read by `mail.replies`, stored, acknowledged, classified, the sequence stopped and the stage moved.
3. Parity rows *cold* (24–31), *followups* (33–38), *replies* (40–48), *mail* (123–125) answered; 32 (DMs) and 39 (brand follow-up, step 8) recorded as not built.
4. Tests prove no automatic send: no `mail.send` job starts without an `approved` or `scheduled` draft that a person's write put there, and approval needs a person's write.
5. One consolidated Playwright pass for Reach at the end (6e).

## Sub-steps (one pull request each)

| Sub-step | What |
|---|---|
| **6a** | The outreach store, the drafter (first emails), the draft card with gates and rewrites, Approve and Send with 10 s Undo, Board, the record's Emails tab. |
| **6b** | Mailboxes tab (capacity, warm-up, cap stepper, pause, bounces and replies, the slowdown rule, a test email), the header capacity summary, Send later and Toolbox › Scheduled. |
| **6c** | Sequences: follow-ups planned on the first send, drafted when due, the timeline tab, stop, park until a date, skip. |
| **6d** | Replies: the background sweep and ack, the thread, Gemini's reading, the 47-situation correction, facts saved to the record, Paste a reply, notifications, stage moves, Reach › Replies. |
| **6e** | The old mail history (old `mailbox.db` and the old outreach rows), the Reach flow suite, ADR 0018, the architecture and parity notes, the status table. |

## Decisions

### Storage and the data model

**D1. Outreach lives in the open data source's `gratovo.db`, not synced yet.** Migration 0004 adds three local tables. Example and live data never mix (each source has its own file). Step T maps them to the server's `outreach_threads` and `outreach_messages`. A creator's stage still syncs through `channel_state` as today. Python's `mailbox.db` stays the record of what Gmail did (send keys, conversations, inbound ids); the app's tables are what a person sees and approves.
*Why:* solo first (ground rule 8); new synced tables would need server migrations, grants and the owner's go for a team feature nobody uses yet.

**D2. Migration 0004 (`0004-outreach.ts`), STRICT tables:**

```sql
CREATE TABLE outreach_drafts (
  id TEXT PRIMARY KEY,                 -- UUID
  channel_id TEXT NOT NULL,            -- the creator
  kind TEXT NOT NULL CHECK (kind IN ('first','followUp','reply')),
  follow_up INTEGER,                   -- 1..3 for followUp, else NULL
  state TEXT NOT NULL CHECK (state IN ('drafting','ready','approved','scheduled','sending','sent','skipped','failed')),
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  mailbox TEXT,                        -- the address it goes from; NULL = not picked yet
  send_at INTEGER,                     -- ms: approved → the end of the 10 s hold; scheduled → the time
  approved_by TEXT,                    -- member id of the person who pressed Send
  proposal TEXT,                       -- JSON DraftProposal (D6), NULL while drafting
  gates_ok TEXT NOT NULL DEFAULT '[]', -- JSON string[]: engine gates a person confirmed
  edited INTEGER NOT NULL DEFAULT 0,   -- 1 once a person changed subject or body
  checked_text TEXT,                   -- hash of subject+body the last check ran on
  steer TEXT,                          -- JSON {how, note} of the last rewrite asked for
  reply_to TEXT,                       -- outreach_messages.id answered (kind reply)
  problem TEXT,                        -- DraftProblem code when state = failed (or a note on ready)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX outreach_drafts_open ON outreach_drafts (channel_id) WHERE state NOT IN ('sent','skipped');

CREATE TABLE outreach_messages (
  id TEXT PRIMARY KEY,                 -- UUID
  channel_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  kind TEXT CHECK (kind IN ('first','followUp','reply')),   -- out only
  follow_up INTEGER,
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  body_cut INTEGER NOT NULL DEFAULT 0,
  at INTEGER NOT NULL,                 -- ms
  mailbox TEXT,                        -- our address
  peer TEXT,                           -- their address
  peer_name TEXT,
  conversation_key TEXT,
  gmail_message_id TEXT UNIQUE,
  gmail_thread_id TEXT,
  draft_id TEXT,                       -- the draft it was sent from
  by TEXT,                             -- member id (out)
  source TEXT NOT NULL DEFAULT 'app' CHECK (source IN ('app','sweep','pasted','imported')),
  reading TEXT,                        -- JSON ReplyReading (D17), in only
  facts_saved TEXT NOT NULL DEFAULT '[]'  -- JSON fact keys saved to the record (in only)
) STRICT;
CREATE INDEX outreach_messages_thread ON outreach_messages (channel_id, at);

CREATE TABLE outreach_sequences (
  channel_id TEXT PRIMARY KEY,
  conversation_key TEXT NOT NULL,
  mailbox TEXT NOT NULL,
  started_at INTEGER NOT NULL,         -- ms of the first email
  steps TEXT NOT NULL,                 -- JSON SequenceStep[] (D13)
  stopped TEXT CHECK (stopped IN ('you','replied','bounced','finished')),
  park_until INTEGER,                  -- ms; with stage parked
  updated_at INTEGER NOT NULL
) STRICT;
```

The tables are created in 6a, all three, so later sub-steps add no migration for them.

**D3. The conversation key is per creator:** `c:<channelId>`. Every message to one creator threads in one Gmail conversation, and a reply maps back by the key or by the `channelId` the send recorded. Follow-ups and replies go from the mailbox of the creator's sequence (the conversation is per account); the From picker is locked for them, with a tip saying why.

**D4. Reach's read model in the renderer.** `AppData` gains `reach: ReachData`, filled from the frame (`Frame.reach`), changed by `act` (so undo works) and by `adoptServerData` when main changes it (a draft written, a send done, a reply in). Message bodies are not in the frame: `reach:thread {creatorId}` returns them.

```ts
// packages/core/src/data/types.ts
export const draftKinds = ["first", "followUp", "reply"] as const;
export const draftStates = ["drafting","ready","approved","scheduled","sending","sent","skipped","failed"] as const;
export interface DraftGate { readonly key: string; readonly kind: "price"|"terms"|"claim"|"ethics"|"fact_missing"|"other"|"blocked"; readonly text: string; }
export interface DraftProposal {
  readonly status: "ready"|"needs_human"|"blocked"|"no_message";
  readonly why: string;                 // decision.why
  readonly rules: readonly string[];    // decision.rules, at most 20
  readonly findings: readonly { readonly rule: string; readonly text: string; readonly blocking: boolean }[]; // at most 30
  readonly gates: readonly DraftGate[]; // the engine's gates a person must confirm
  readonly situation: { readonly side: string; readonly stage: string; readonly replyType: string|null; readonly summary: string } | null;
  readonly model: string | null;
}
export interface OutreachDraft {
  readonly id: string; readonly creator: string; readonly kind: DraftKind; readonly followUp: number|null;
  readonly state: DraftState; readonly subject: string; readonly body: string; readonly mailbox: string|null;
  readonly sendAt: number|null; readonly proposal: DraftProposal|null; readonly gatesOk: readonly string[];
  readonly edited: boolean; readonly checked: boolean; // checked: the last check ran on this exact text
  readonly rewriting: RewriteHow|null;                  // main is rewriting it now
  readonly replyTo: string|null; readonly problem: DraftProblem|null;
  readonly createdAt: number; readonly updatedAt: number;
}
export const rewriteHows = ["shorter","warmer","direct","redo"] as const;
export const draftProblems = ["bridge_off","no_sender","engine_failed","engine_blocked","send_failed","maybe_sent","mailbox_full","mailbox_signed_out","not_sent_closed","late"] as const;
export interface ThreadSummary { readonly creator: string; readonly count: number; readonly lastOutAt: number|null; readonly lastIn: { readonly id: string; readonly at: number; readonly reading: ReplyReading|null; readonly preview: string }|null; }
export interface ReachData {
  readonly drafts: readonly OutreachDraft[];     // every draft not sent or skipped, plus those sent or skipped in the last 24 h; at most 1000
  readonly sequences: readonly Sequence[];       // 6c fills it; [] before
  readonly threads: readonly ThreadSummary[];    // one per creator with any message; at most 5000
  readonly mailboxes: readonly MailboxView[];    // D9
  readonly gemini: "ready"|"off"|"busy";         // can drafts be written now
  readonly sender: string|null;                  // the name drafts are signed with; null blocks drafting
}
```

`Frame` gains `reach: ReachData`. `Sequence`, `MailboxView`, `ReplyReading` are defined in D9, D13, D17 (6a defines `MailboxView`; `Sequence` and `ReplyReading` are declared in 6a as types so the frame is stable, filled later).

**D5. Writes (DataWrite kinds), each applied in `sqlite-source.ts` in the one write transaction:**

| Kind | Fields | Main does |
|---|---|---|
| `draft.state` | `id, state: "ready"\|"approved"\|"scheduled"\|"skipped", sendAt: number\|null` | Only from `ready`/`failed`↔`approved`/`scheduled`/`skipped` and back. A change on a draft that is `sending` or `sent` is ignored (logged by kind), and main pushes `reach` so the page corrects itself. `approved`/`scheduled` record `approved_by = me`. |
| `draft.text` | `id, subject, body` | Stores, sets `edited`. Not sent while `sending`/`sent`. |
| `draft.mailbox` | `id, mailbox: string\|null` | Stores (refused for followUp/reply: D3). |
| `draft.gate` | `id, gate: string, ok: boolean` | Adds or removes the key in `gates_ok`. |
| `sequence.set` (6c) | `creator, stopped, parkUntil, skip: number[]` | |
| `mailbox.set` (6b) | `address, dailyCap, paused` | Stores in `mail.settings`. |
| `reply.fact` (6d) | see D18 | |

Typing in the draft card is not an undo step: the card keeps its text locally, writes `draft.text` straight through `data:write` 600 ms after the last key and on blur/send, then `adoptServerData` puts the text in the store (as Find's notes do). A rewrite's new text arrives as server data, and its Undo is an `act` that writes the old text back (`draft.text`).

### Drafting

**D6. The drafter (`main/reach/drafter.ts`).** One queue, one Gemini call at a time.
- It writes a **first email** for each creator at `contact` with `emailConfirmed`, no open draft, no sequence and no message out. It runs on start, on every frame change of creators (debounced 2 s) and when the bridge becomes ready.
- The draft row is created at once in state `drafting` (the board shows "Gemini is writing…"), then filled.
- Order: replies (6d), follow-ups due (6c), then first emails oldest-confirmed first.
- **Live:** `action.comms_propose` with `request = {kind, channelId, contactEmail, followUpNumber?, threadId: "c:<channelId>", steer?, timeoutS: 240}` and `facts` from D7. `newChat` is the bridge's own rule for comms (one fresh chat per proposal; check `gemini/actions.py` and pass what it needs).
- **Bridge off** (not listening or the add-on not connected): rows stay `drafting` with `problem: "bridge_off"`; `reach.gemini = "off"`; Reach shows one banner "Gemini is off: drafts wait" with **Start Gemini** (calls `GeminiControl.start()`; the only place besides Settings that starts it, and only on a click). Nothing else starts the bridge.
- **No sender** (no mail sender name and no profile name): `problem: "no_sender"`, banner links to Settings › Connections (the mail settings row).
- **Result mapping:** `proposal.message.subject/body` → subject/body; `status`, `decision.why`, `decision.rules`, `findings`, `gates`, `situation`, `model` → `DraftProposal`. Status `blocked` → state `ready` with gate `{key:"blocked", kind:"blocked"}` (not sendable; edit and check again). `no_message` for a first email → `failed` with `engine_blocked`. A failed call → `failed` with `engine_failed` (code only in the log) and **Try again** on the card.
- **Example data never calls Gemini:** a stand-in fills the draft 0.9 s later from the example creator's name, contact name and latest video title, with `why` and two rule ids, status `ready`. Example drafts exist in the seed too (a few `ready`, one with an unconfirmed gate).
- **Pacing lives in the bridge (D6a).** Main sends one call at a time and waits as long as the bridge may take, pacing included.
- A data-source switch (ADR 0016 D7) drops the queue; rows left `drafting` are picked up again when that source opens.

**D6a. The owner's Gemini pacing, enforced in the bridge.** The rule (owner-rules.md): at least 60 s between sends, one prompt per fresh chat, and a refusal or three generic errors in 15 minutes pause for 30 minutes or more. The engine ported in 3e-3a sent its format and repair turns in the same chat with no wait, and `actions._ask` retried a refusal at once. Drafting runs unattended, so the rule is enforced where every prompt passes:
- `gemini/client.py`: every `send` waits until 60 s after the previous send of this bridge process (monotonic clock, injectable for tests) and always opens a new chat (`newChat: true`, whatever the caller asked; a gem's own navigation counts as the new chat).
- `comms/engine.py`: each follow-up turn (format, JSON only, repair, the coach's rewrite) is a standalone prompt in a fresh chat: the original prompt, then "Your previous answer was:" with that answer, then the turn's instruction. The `WRONG_CHAT` ref check stays.
- A breaker in the bridge (`gemini/pause.py`): a refusal (`ActionRefused`, the `_REFUSAL` text) or the third `GeminiPageError` within 15 minutes pauses every prompt-sending method for 30 minutes; they fail at once with the new code `PAUSED` (`details.until`, ISO time). `bridge.status` reports `paused_until`. `actions._ask` no longer retries a refusal.
- Main adds `PAUSED` to its code list, and adds 60 s per possible prompt (6 for a proposal: moments, the draft, two format turns, two repairs) to its wait for `action.comms_propose`. The drafter shows "Gemini is paused until 14:32" and starts again after.

**D7. The facts main sends (`main/reach/facts.ts`).** `agency`: `{name: strings "Gratovo" constant until step 8's Agency facts, sender: mail.settings senderName ?? profile name, whatWeDo: null, website: null, trueClaims: [], pastCampaigns: [], incubator: true, boycott: {countries: ["IL"], brands: []}}` (the engine's own defaults, made explicit). `thread`: the creator's messages oldest first (at most 500, bodies cut to 100,000), id `c:<channelId>`. `creators`: `{[channelId]: {pipelineStage, mediaKit, creatorGender}}` from `channel_state`. `brand: null`, `deal: null` (step 8). `recentOutbound`: the newest 20 outbound bodies with their thread ids.

**D8. Rewrites (Shorter, Warmer, More direct, New angle).** `reach:rewrite {id, how}` re-proposes with `steer: {note: <the English instruction for how>}` (`main/reach/strings` has the four notes: "Make it shorter: keep only what matters.", "Make it warmer, without flattery.", "Make it more direct: get to the question.", "Write it again from a different angle, using another moment from their videos."). The draft shows `rewriting` until the answer; the old text is kept so the toast's Undo (and Ctrl Z) puts it back. Bridge off → the chips are disabled with the tip "Gemini is off. Edit the text by hand, or start it." Example data: a stand-in rewrite after 0.9 s (a deterministic edit of the text).

### Gates and sending

**D9. Mailboxes as Reach sees them (`MailboxView`):**
```ts
export interface MailboxView { readonly address: string; readonly connected: boolean; readonly signedOut: boolean;
  readonly dailyCap: number; readonly effectiveCap: number; readonly sentToday: number; readonly leftToday: number;
  readonly warmup: { readonly day: number; readonly of: number } | null; readonly paused: boolean;
  readonly status: "good"|"warming"|"slowed"|"paused"|"signed_out"; readonly bounceRate: number|null; readonly replyRate: number|null;
  readonly checkedAt: number|null; }
```
Main builds it from `mail.settings` plus the last `mail.status` result (run when Reach first opens, every 10 min while the app is on live data and a mailbox is connected, and after each send), plus the app's own counts (sends today by mailbox from `outreach_messages`, which is never older than the status). Example data: three example mailboxes in the seed (one healthy, one warming, one slowed), no job ever runs. Warm-up lasts 30 days from `warmupStartedOn`; during it the effective cap is at most 20. 6a needs `connected`, `leftToday`, `effectiveCap`, `status`; 6b adds the rest of the UI.

**D10. Gates (pure, `packages/core/src/reach/gates.ts`):** `draftGates(draft, creator, mailbox, now)` → `Gate[]` in this order:
1. `never` — stage `never`. Blocks; no override. (The drafter never drafts for them; a draft made before is skipped by main when the stage becomes `never`.)
2. `unconfirmed` — `!creator.emailConfirmed`. Blocks; the gate shows the creator's addresses with Confirm (Find's confirm action), so it clears in place.
3. `no_mailbox` / `mailbox_signed_out` / `mailbox_paused` / `mailbox_full` — Blocks Send (not Send later, except signed out). Shows "Send from <other> instead" when another can send.
4. `blocked` — engine status blocked or a blocking finding on the last check. Blocks until the text passes a check.
5. each engine gate not in `gatesOk` — "Confirm" clears it (`draft.gate`).
`canSend` = no gate from 1–5 left. The same function runs in main right before a send (D11); main's answer wins.

**D11. Approve and send (`main/reach/sender.ts`).**
- **Send** in the page is an `act` ("Sent the first email to X"): the draft becomes `approved` with `sendAt = now + 10 000`. The toast says "Sent to X" with Undo for 10 s (`ms: 10000`). Ctrl Enter on the focused draft card does the same.
- **Undo** within the hold puts it back to `ready`; main drops it from the timer. After the hold main has started the send, the undo write is ignored (D5), main pushes `reach`, and the page says "Too late to undo: it has gone" (a toast when the store sees the draft come back as `sending`/`sent` after an undo).
- **At `sendAt`**, main re-reads the row (still `approved`), re-checks the gates with D10 (failing → back to `ready` with the gate showing and a notification-free toast via `reach:changed`), marks it `sending`, and queues `mail.send` on the quick lane through the **quick queue** (`main/reach/quick-queue.ts`: one job at a time, waits while the lane runs another job, never drops a send). The message: `{to: creator email, subject, body, mailbox, conversationKey: "c:<id>", channelId, sendKey: "draft-<id>", approvedBy: me}`.
- **Edited text is checked first:** when `edited` and the text changed since the last check, main runs `action.comms_check` (no Gemini prompt; the bridge must be listening). Blocking findings → back to `ready` with the `blocked` gate. Bridge off → it sends and the draft's sent message carries "not checked again after your edit" in the log line. (The owner's rule is approval, not the check; the check is advice.)
- **Done** → in one transaction: an `outreach_messages` row (`out`, the result's ids, `by = approved_by`), the draft `sent`, the creator's stage `contact → emailed` for a first email (through the normal `creator.stage` write so it syncs, plus a log line "Sent the first email to X" by the approver), and the sequence (6c). Then `mail.status` refreshes.
- **Failures:** `daily_cap_reached` → `ready` with `mailbox_full`; `mail_auth` → `ready` with `mailbox_signed_out` (the mailbox shows signed out); `bad_start` / `mail_api` refused → `failed` with `send_failed`; `send_uncertain`, `network` after the request may have gone, a crash or a kill mid-send → `failed` with `maybe_sent`. A `maybe_sent` draft shows "It may have gone out. Check Gmail's Sent folder." with **It was sent** (records the message from the draft, no job) and **Send as new** (a fresh send key; asks first). Never an automatic retry of a send (lesson from 3e-3b).
- **App closed during the hold:** on start, an `approved` draft becomes `ready` with `problem: "not_sent_closed"` ("Not sent: the app closed before it went"). Scheduled drafts: D12.
- **Example data:** the same timer; at `sendAt` main fakes the send (no job), records the message and the stage, and adds 1 to the example mailbox's sent count.
- **No automatic send, proven:** a `mail.send` start is built only by `sender.ts`, only from a row in `approved` or `scheduled` whose `approved_by` is set, and only `data:write` sets those states. Tests: the drafter, the sweep and the sequence code never produce `approved`; a fake supervisor sees no `mail.send` without a person's write.

**D12. Send later (6b).** The Send button's arrow: "Their morning" (09:00 in the creator's channel country's main time zone, from a small table in core; unknown country → 09:00 the sender's), "Tomorrow, 09:00", "Monday, 09:00". `draft.state scheduled` with `sendAt`. Main's timer sends at the time like an approved draft. A scheduled draft more than 12 h late when the app starts goes back to `ready` with `late` ("Scheduled for … but the app was closed"). **Toolbox › Scheduled** lists them soonest first with Cancel (back to `ready`, undoable).

### Board and the record

**D13. Sequences (6c).** On a first email's send: steps `[{n:1, dueAt: sent+3d}, {n:2, +7d}, {n:3, +14d}]` each `{n, dueAt, state: "planned"|"drafted"|"sent"|"skipped", sentAt}`, mailbox and key of the first email. On the day a step is due (local midnight on), the drafter writes the follow-up (comms `followUp`, `followUpNumber`). Sending it marks the step `sent`. 7 days after the last step with no reply → `stopped: "finished"`. A reply → `stopped: "replied"` and open follow-up drafts are skipped. Stop → `stopped: "you"`, planned steps removed, open follow-up drafts skipped. Park until a date → stage `parked`, `park_until`; on that date the stage goes back to `emailed` and the next step is due then. The toast after a send names the next date.

**D14. Board lanes** (`packages/core/src/reach/board.ts`, pure): To draft (stage `contact`, no open draft; "Gemini is writing…" while `drafting`), Waiting for you (first emails and follow-ups `ready`/`failed`/`approved`, gates first), In sequence (`emailed`), Replied (`replied`, a reply draft or answered). Media kit in and Signed show on example data only (live: step 8). Each card opens the creator's peek on its **Emails** tab; J/K and the peek's arrows step through the lane.

**D15. The record's Emails tab** (`record/creator-emails.tsx`): the thread (newest at the bottom, "Show N earlier"), then the open draft card(s), then "Draft the first email" when the creator is at `contact` with no draft (queues it now), or the next step. Shown in live mode once 6a lands.

**D16. Live gate:** `liveWired.reach` = `["board"]` in 6a, then `mailboxes` (6b), `sequences` (6c), `inbox` (6d). Toolbox gains `scheduled` in 6b. The rail count for Reach = drafts waiting + replies to answer.

### Replies (6d)

**D17. The sweep (`main/reach/reply-sweep.ts`).** Live data, a connected mailbox, the app on: `mail.replies` every 10 minutes, at start (after 30 s) and on "Check now" in Replies. Each `reply` line → an `in` message (`source: "sweep"`, matched by `channelId`, else by the peer address equal to a creator's email, else kept unmatched for the log and skipped), stored in one transaction, then `mail.ack` for the stored ids only (a reply not stored is offered again next sweep). Then for each matched creator: stage `emailed`/`parked` → `replied`, the sequence `stopped: "replied"`, open follow-up drafts skipped, a notification "X replied" (icon `reply`, go `reach/inbox`, kind reply), a log line, and the drafter queues a reply draft. A bounce (from `mailer-daemon`/`postmaster`, or the engine's `any.bounce`) → the sequence `stopped: "bounced"`, the address marked not confirmed, a notification, no reply draft.
`ReplyReading = {replyType: string|null, label: string, summary: string, side: string, corrected: boolean, facts: ReplyFact[]}` comes from the reply draft's `situation` (the label from `situations.json`, which main reads like the writing rules). Until the draft exists the reading says "Gemini hasn't read it yet".

**D18. Facts and the correction.** `readReplyFacts(text)` in core (pure): a rate (`$1,200`, `1200 USD`, "my rate is 900"), top countries with shares, an age band. Each shows a chip "Save to record" → `reply.fact {message, key}` stores it in `channel_state.provided_data` (`{rate, countries, age}`, synced as a `channel.edit provided_data` with base) and in `facts_saved`. The stage stays `replied` (the kit move is step 8). **"That's not it"** opens a picker of the side's situations (20 creator, 22 brand, 5 any: 47) and re-proposes with steer note "Read their reply as: <label>"; the reading is marked `corrected`.
**Paste a reply** under any thread with an outbound message: an `in` message `source: "pasted"`, then exactly the sweep's path.

### Old history (6e)

**D19.** On live data, with the owner's click in Settings › Connections › Old data ("Bring in my old emails"): copy the old `mailbox.db` beside the old `gratovo.db` into `<userData>/mail/mailbox.db` only when none exists (read-only open of the source, `immutable=1`), and read the old `outreach_threads`/`outreach_messages` mirror tables from the old `gratovo.db` into `outreach_messages` (`source: "imported"`) by channel. Creators with old outbound mail and no sequence get none (old sequences are not resumed); "emailed before" reads them.

*As built (6e):*
- **No second button.** The old mail comes in as one more step of the existing import (Settings › Connections › Old data), after the pipeline's job has committed. A person who imported before 6e uses "Bring it in again", which adds nothing twice. A failure is the warning `old_mail`, and the rest of the import still stands.
- **The target is the pipeline's own `mailbox.db`** (`<dataDir>/mailbox.db`, where `mail.py` reads it), not `<userData>/mail/`. The copy is a `VACUUM INTO` from a read-only open to a temporary file, then put in place only if the path is still free. A mailbox already in use is kept.
- **The old email log:** only `method` email (DMs are not built, parity 32), only threads with a creator. Ids are `imported-<old id>`, so a second import adds nothing. Old messages have no mailbox, so they never count in a mailbox's sends or rates.
- **Old replies never wait in Replies:** a thread's `lastIn` ignores imported messages, so an old reply shows in the thread only. A reply in the old `mailbox.db` that was never reported comes in through the next sweep, where the 30-day rule (`oldReplyMs`) stores an old one with no effects.
- **Limit:** a reply logged by hand in the old app and also found by the sweep in the old `mailbox.db` shows twice in the thread.

## Tasks for 6e

| id | tier | what | done-check |
|---|---|---|---|
| E1 | H (lead) | D19 as built above: `main/import/old-mail.ts`, the import step, `importMessages`, the result's `mail` and the dialog lines. | vitest |
| E2 | N | The Reach flow suite: one Playwright file per flow, on example data. | e2e on Windows |
| E3 | H (lead) | ADR 0018, the architecture and parity notes, the status table; `.router/` removed. | docs read through |

## Contracts: IPC (packages/ipc/src/reach.ts)

Channels (request → response):
- `reach:thread` `{creatorId}` → `{ok:true, messages: ThreadMessage[]} | {ok:false, problem:"no_data"}`; `ThreadMessage = {id, direction, kind, followUp, subject, body, bodyCut, at, mailbox, peer, peerName, by, source, reading}`.
- `reach:draft-now` `{creatorId}` → `{ok:true} | {ok:false, problem: "not_ready"|"has_draft"|"no_data"}` (queues a first email now).
- `reach:rewrite` `{draftId, how}` → `{ok:true} | {ok:false, problem:"bridge_off"|"busy"|"not_found"}` (the answer arrives as `reach:changed`).
- `reach:retry` `{draftId}` → `{ok:true} | {ok:false, problem:"not_found"}`.
- `reach:mark-sent` `{draftId}` / `reach:send-new` `{draftId}` (maybe_sent only) → `{ok:true} | {ok:false, problem:"not_found"|"wrong_state"}`.
- `reach:gemini-start` `{}` → the `GeminiControl.start()` answer.
- `reach:mailboxes-refresh` `{}` → `{ok:true} | {ok:false, problem:"busy"|"no_mail"}`.
- 6c/6d add `reach:check-replies`, `reach:paste-reply`, `reach:reclassify`, `reach:situations`, `reach:send-test`.
Event: `reach:changed` `{}` → the page reads `frame:load` part `reach` (add `"reach"` to `frameParts`) and adopts it with `adoptServerData`.

## Tasks for 6a

Tiers per plan §10. Each task: edit only the listed files; never `git add`, `git stash`, `git reset` or `git checkout --`; report pass/fail, files, deviations.

| id | tier | depends | files | spec | done-check |
|---|---|---|---|---|---|
| A0 | H | – | `services/pipeline/src/gratovo_pipeline/gemini/client.py`, `gemini/pause.py` (new), `gemini/actions.py`, `gemini/server.py` (status, the breaker hook), `gemini/errors.py`, `gemini/gemini.schema.json`, `comms/engine.py`, their tests; `apps/desktop/src/main/pipeline/gemini-protocol.ts` (`PAUSED`, `paused_until`, the propose wait) + its tests | D6a. | pytest; vitest for gemini-protocol; the code-list test |
| A1 | H (lead) | – | `packages/core/src/data/types.ts`, `packages/core/src/reach/*.ts` (new: `types.ts` re-export, `gates.ts`, `board.ts`, `index.ts`), `packages/core/package.json` exports if needed, `packages/ipc/src/reach.ts`, `channels.ts`, `events.ts`, `data.ts`, `index.ts`, `bridge.ts` | The types of D4/D9, DataWrite kinds of D5 (6a's four), the IPC schemas, `frameParts` + `reach:changed`, `gates.ts` and `board.ts` pure with tests. | typecheck; core and ipc tests |
| A2 | N | A1 | `apps/desktop/src/main/db/migrations/0004-outreach.ts`, `index.ts`, `apps/desktop/src/main/data/repositories/outreach.ts` (new) + test, `repositories/index.ts` | D2 migration; repository: `listReach(db, now)` → ReachData parts, `insertDraft`, `updateDraft`, `insertMessage`, `listThread`, `setDraftState` with the D5 transition rule. | vitest on the repo and migrate tests |
| A3 | N | A2 | `sqlite-source.ts`, `example-source.ts`, `data-source-contract.ts`, `packages/core/src/data/example.ts`, `renderer/lib/example-data.ts` | Frame gains `reach`; the four writes applied; example seed: 3 mailboxes, 4 drafts (one unconfirmed), threads for two emailed creators. | contract tests |
| A4 | H | A0, A1 | `main/reach/facts.ts`, `main/reach/drafter.ts` (+tests) | D6, D7, D8. Fakes for the bridge; never a real prompt. | vitest |
| A5 | H | A2 | `main/reach/quick-queue.ts`, `main/reach/sender.ts`, `main/reach/mail-state.ts` (+tests) | D9 (6a part), D11. Fake supervisor; prove no automatic send. | vitest |
| A6 | N | A3–A5 | `main/reach/reach-service.ts`, `main/services.ts`, `stub-services.ts`, `handlers.ts`, `index.ts`, `handlers.test.ts`, ipc `dispatch.test.ts`, `data.test.ts` | Wire the channels and the event; source switch drops queues. | typecheck, vitest |
| A7 | N | A1 | `renderer/strings.ts` (reach block), `renderer/lib/persist.ts` (diff for drafts), `renderer/lib/store.ts`, `renderer/lib/reach-actions.ts` (+test), `renderer/lib/live.ts` (adopt on `reach:changed`) | Actions: send (approve), undo, skip, confirm gate, change mailbox, rewrite, retry. | vitest |
| A8 | N | A7 | `renderer/reach/reach-screen.tsx`, `board.tsx`, `reach.css`, `renderer/record/creator-emails.tsx`, `draft-card.tsx`, `thread.tsx`, `creator-record.tsx`, `app/app.tsx`, `lib/wired.ts` | The screen with Board only in live; the Emails tab; the draft card per the prototype (`records.js` DraftCard), keyboard (Ctrl Enter, O, J/K). Component tests. | vitest; screenshot at 1440 px |
| A9 | N | A6, A8 | `apps/desktop/e2e/reach-board.spec.ts` | One smoke: example data, Reach › Board shows lanes; open a Waiting card; Send; the toast; Undo; send again and the card leaves the lane. | e2e on Windows |
| A10 | H | all | review (router-reviewer) | Diff vs. this plan, security (no send without approval, no secret or mail body in logs). | findings fixed |

## Decisions added for 6b (2026-10-25)

**D20. The Mailboxes tab, in detail** (prototype `reach.js` MailCard and Mailboxes, parity 123–125).
- **Pause and the slowdown state** live in a local setting of the open source, `reach.mailboxes`: `{[address in lower case]: {paused: boolean, slowed: boolean}}`, read with zod and safe fallbacks. Not synced (D1).
- **The cap stepper** writes the `mail.settings` row's `dailyCap`, as Settings › Connections' `mailbox.update` does: 10 to 50 in steps of 5 (the pipeline's bounds). It is the normal cap. While warming or slowed the effective cap is at most 20, and the card says so ("20 a day until warm-up ends, then 30").
- **Not undo steps.** `reach:mailbox-set {address, dailyCap?, paused?}` writes at once, like Settings › Connections. The mailboxes come from main, and an undo step would need a field merge like 6a's drafts (finding 1). The stepper and Pause/Resume reverse themselves. The toast has no Undo.
- **Rates**, per mailbox, from the app's own messages:
  - `bounceRate`: the last 7 days. In-messages on that mailbox read as `any.bounce`, divided by out-messages from it, in %, one decimal. Null under 10 sends.
  - `replyRate`: the last 30 days. Creators who got a first email from the mailbox and later sent a message that is not a bounce, divided by creators who got one. Null under 10.
  - On live data the rates stay mostly null until 6d's sweep stores replies. The example seed gives outreach3 enough bounces to be slowed.
- **The slowdown rule** (core, pure, `slowedNext(was, rate)`): a rate over 3 slows the mailbox. A slowed mailbox stays slowed until the rate is under 2. A null rate keeps the last state.
  - Main applies it after each mailbox refresh, on live and example data.
  - It writes the setting only when the state changes, and adds an activity log line: "outreach3 slowed to 20 sends a day: 4.2% bounced this week" or "outreach3 is back to 30 a day".
  - The notification waits for 6d's notification path.
- **Status order:** signed_out, then paused, then slowed, then warming, then good.
- **Test email:** `reach:send-test {address}`.
  - Live: `mail.send` through the quick queue: `{to: address, mailbox: address, subject: "Gratovo test email", body: <a short fixed text from main's strings>, newThread: true, sendKey: "test-<uuid>", approvedBy: me}`. It is not stored in `outreach_messages`.
  - A paused or signed-out mailbox is refused.
  - Example data: a fake success after 0.6 s.
  - The toast: "Test email sent to <address>. Check that it reached the main inbox, not Promotions."
  - **Inbox placement** ("8/10") is not built: the app can't tell where a test landed without reading the mailbox. Recorded in the parity notes.
- **Warnings before a connection lapses (row 123)** need the token's age, which is not stored. The card shows "Signed out" with **Sign in again** (to Settings › Connections). Recorded as partial.
- The header's capacity summary becomes a button to the tab once `mailboxes` is in `liveWired.reach`. It is already built.

**D21. Send later and Toolbox › Scheduled, in detail** (D12; prototype `records.js` schedule and `more.js` ScheduledTool).
- **Core `reach/send-later.ts`** (pure):
  - `countryZones`: ISO-2 code to one IANA zone (the main city), for about 40 countries.
  - `morningIn(zone, now)`: the next 09:00 in that zone, at least 15 minutes away.
  - `tomorrowAt9(now)` and `mondayAt9(now)`: in the local zone. `mondayAt9` is next Monday, or a week on when today is Monday.
- **The creator's zone:** `ReachData.zones: Record<creatorId, zone>`, for creators with an open draft. Main's overlay fills it from the Find catalog's channel country through `countryZones`. With no zone, "Their morning" is 09:00 the sender's time, and the menu says so.
- **The page:**
  - The Send button gets an arrow (a split button). It opens a menu with the three choices and the time each one gives.
  - `canSchedule` (core) gates it.
  - `scheduleDraft(id, at)` is an `act` that writes `draft.state scheduled` with `sendAt`. The toast says "Scheduled for Tue 27 Oct, 09:00", with Undo.
  - Main already keeps `sendAt` at least now plus the hold, and sends at the time (D11, D12).
- **Toolbox › Scheduled:**
  - It lists scheduled drafts, soonest first: the creator, the first line, when, and from which mailbox.
  - **Cancel** sends the draft back to `ready`. It is an `act`, so it can be undone.
  - The empty state follows the prototype.
  - The count beside the tool comes from the store.
- **Live gate:** `liveWired.reach` adds `mailboxes`; `liveWired.toolbox` adds `scheduled`.

## Tasks for 6b

Same rules as 6a's tasks.

| id | tier | depends | files | spec | done-check |
|---|---|---|---|---|---|
| B1 | H (lead) | – | `packages/core/src/reach/send-later.ts`, `mailbox-health.ts` (new, + tests), `reach/index.ts`, `data/reach-types.ts` (`zones`), `packages/ipc/src/reach.ts`, `channels.ts`, `index.ts` (+ tests) | D20 and D21 contracts: `slowedNext`, `mailboxStatus`, cap bounds and steps, the send-later times, `reach:mailbox-set`, `reach:send-test`, `ReachData.zones`. | typecheck; core and ipc tests |
| B2 | N | B1 | `main/reach/mail-state.ts`, `main/reach/reach-service.ts`, `main/reach/strings.ts`, `main/data/repositories/outreach.ts` (`mailboxCounts`), `core/src/data/outreach-store.ts`, `sqlite-source.ts`/`example-source.ts` if needed, `handlers.ts`, `services.ts`, `stub-services.ts`, `packages/core/src/data/example.ts` (outreach3's bounces), the tests | D20 in main: the setting, the rates, the slowdown rule and its log line, mailbox-set, send-test (fake supervisor; never a real send), the zones overlay. | vitest; the contract tests |
| B3 | N | B1 | `renderer/reach/mailboxes.tsx` (new), `reach-screen.tsx`, `reach.css`, `renderer/record/draft-card.tsx` (Send later), `renderer/lib/reach-actions.ts` (`scheduleDraft`, `cancelScheduled`, `setMailbox`, `sendTest`), `renderer/toolbox/scheduled-tool.tsx` (new), `toolbox-screen.tsx`, `toolbox-list.tsx`, `lib/routes.ts` if needed, `lib/wired.ts`, `renderer/strings.ts`, the tests | D20 and D21 in the page, per the prototype. | vitest; screenshot at 1440 px |
| B4 | N | B2, B3 | `apps/desktop/e2e/reach-later.spec.ts` | One smoke on example data: a waiting draft, Send later › Tomorrow, the toast, Toolbox › Scheduled lists it, Cancel, the draft is back in Waiting. | e2e on Windows |
| B5 | H | all | review (router-reviewer) | The diff against this plan. Security: a test email or a scheduled send only on a person's click; no secret and no mail body in logs. | findings fixed |

## Decisions added for 6c (2026-10-25)

**D22. Sequences, in detail** (D13; prototype `reach.js` Sequences, `seqRows`, `seqEvents`, `seqNext`, `seqMenu`).
- **Core `reach/sequence.ts`** (pure, the one place the rules live):
  - `planSteps(sentAt)`: steps 1, 2 and 3 due at +3, +7 and +14 days, `planned`.
  - `dueSteps(sequence, now)`: the planned steps whose due day has begun (local midnight on), while the sequence runs (not stopped, not parked).
  - `isFinished(sequence, now)`: no step left planned or drafted, and 7 days since the last one sent.
  - `stopped(sequence, how)`, `resumed(sequence)`, `parked(sequence, until)`, `woken(sequence, now)`.
  - Waking re-times the steps still planned: when the first of them is due before `now`, all of them move by the same amount so the first is due now and the gaps stay.
- **Starting one:** when a first email is sent, the sender's one commit also writes the sequence: `planSteps(sentAt)`, the mailbox the email went from, key `c:<id>`. An old creator with old mail and no sequence gets none (D19).
- **Drafting a step:** the drafter's scan also writes a follow-up draft (`kind: followUp`, `followUp: n`, the sequence's mailbox) for each due step whose creator is `emailed`, has no open draft and is not never contact. The step becomes `drafted`. The draft is `drafting`, then `ready`: never `approved` (no automatic send).
- **Sending a step** marks it `sent` with `sentAt`, in the sender's commit. Skipping its draft marks it `skipped`, in the same write transaction (the repository's `draft.state` path).
- **The day timer:** reach-service wakes at each local midnight (and at start).
  - It kicks the drafter.
  - It stops finished sequences (`stopped: "finished"`, one log line each).
  - It wakes parked creators whose date came: the stage goes `parked` → `emailed` through the normal `creator.stage` write, and the steps are re-timed.
- **Stop, Resume, Park, Wake: commands, not undo steps.** These are `reach:sequence-stop`, `reach:sequence-resume`, `reach:park {creatorId, until}` and `reach:wake`. Each is one main commit, with its log line and any stage write.
  - The sequences come from main, and an undo step would need a field merge like 6a's drafts (finding 1). So, as with mailboxes (D20), each toast has an **Undo** button that runs the opposite command; Ctrl Z does not cover them.
  - **Stop:** `stopped: "you"`. Open follow-up drafts (`drafting`, `ready`, `failed`, `approved`, `scheduled`; not `sending`) are skipped, and their steps go back to `planned`, so Resume can draft them again.
  - **Resume:** clears `stopped` when it is `"you"`. Steps already due are drafted on the next scan (drafted only, never sent).
  - **Park until:** stage `parked`, `park_until` = local midnight of the chosen day. The choices are 2 weeks, 1 month and 3 months. Open follow-up drafts are skipped, as on Stop.
  - **Wake:** stage `emailed`, `park_until` cleared, the steps re-timed.
- **The page:**
  - **Reach › Sequences:** the timeline, 14 days back and 14 days ahead, one row per creator with a sequence, per the prototype.
    - Dots: sent, due, planned, skipped, and their reply (6d fills replies).
    - A "Next step" column, and the filter All, Running and Stopped.
    - A row's menu: Open, Stop (or Resume), Park until, Wake.
  - **Board cards:** In sequence says "Parked until <date>" and "Stopped by you". "Finished" shows when the sequence is finished.
  - **The send toast** names the next follow-up date ("Follow-up 1 on Wed 28 Oct"), from `planSteps` for a first email, or from the sequence for a follow-up.
  - **The record's Emails tab** shows the next step under the thread, with Stop and Park.
  - **Live gate:** `liveWired.reach` adds `sequences`.
- **Example data:** the seed gives the emailed creators c8 and c9 sequences (one with step 1 sent). No step is due at load, so the stand-in drafter writes nothing by itself. *As built:* no parked or stopped-by-you creator is seeded. Every other seed creator is held at its stage by a draft, a deal, a reply or Find's tests, and a new one would shift many counts. Park and Stop can be tried on c8 and c9.
- **Review of 6c:**
  - Stop and Park answer with the follow-up drafts they skipped, and their Undo brings exactly those back. An approved or scheduled draft comes back as `ready`, so an Undo never sends.
  - A step sent late moves the later ones, so the gaps between follow-ups stay.
  - A stage of `parked` with no day counts as parked, so Wake is always offered.
  - Park is offered only on a running sequence.

## Tasks for 6c

Same rules as 6a's tasks.

| id | tier | depends | files | spec | done-check |
|---|---|---|---|---|---|
| C1 | H (lead) | – | `packages/core/src/reach/sequence.ts` (+ test), `reach/index.ts`, `packages/ipc/src/reach.ts`, `channels.ts` (+ tests) | D22's pure rules; the four channels' schemas. | typecheck; core and ipc tests |
| C2 | N | C1 | `main/reach/sender.ts`, `drafter.ts`, `reach-service.ts`, `strings.ts`, `main/data/repositories/outreach.ts`, `sqlite-source.ts`/`example-source.ts` if needed, `handlers.ts`, `services.ts`, `stub-services.ts`, `packages/core/src/data/example.ts`, the tests | D22 in main: start, draft, send and skip a step, the day timer, finish, wake on the date, the four commands, the seed. | vitest; contract tests |
| C3 | N | C1 | `renderer/reach/sequences.tsx` (new, + test), `reach-screen.tsx`, `reach.css`, `reach-view.ts`, `renderer/record/creator-emails.tsx`, `renderer/lib/reach-actions.ts` (+ test), `lib/wired.ts` (+ test), `renderer/strings.ts`, `e2e/live-gate.spec.ts` expectations | D22 in the page, per the prototype. | vitest; screenshot at 1440 px |
| C4 | N | C2, C3 | `apps/desktop/e2e/reach-sequences.spec.ts` | One smoke on example data: Send a first email and let it go; Sequences shows its row with follow-up 1 in 3 days; Stop; the toast's Undo resumes it. | e2e on Windows |
| C5 | H | all | review (router-reviewer) | The diff against this plan. No automatic send (a follow-up is only ever drafted). The timer and wake paths. | findings fixed |

## Decisions added for 6d (2026-10-25)

**D23. Replies, in detail** (D17, D18; prototype `reach.js` Inbox and InboxRow, `records.js` thread, paste and `W.AiRead`, `engine.js` `A.pasteReply`).

**The sweep** (`main/reach/reply-sweep.ts`): live data only, with a connected mailbox. It runs 30 s after start, every 10 minutes, and on **Check now** (`reach:check-replies`). Example data never sweeps.

Each `reply` line of `mail.replies`:
- **Match:** by `channelId`, else by the conversation key `c:<id>`, else by the sender's address equal to a creator's address (case-insensitive). An unmatched reply is logged by its message id only and not stored, so it is offered again.
- **Store:** an `in` message (`source: "sweep"`), `gmail_message_id` unique (a reply stored twice is a no-op), mailbox = the account it reached. All of one sweep's replies go in one transaction. Then `mail.ack` for the stored ids only.
- **A bounce** is a reply from `mailer-daemon@` or `postmaster@`, or one the engine later reads as `any.bounce`. It stops the sequence (`stopped: "bounced"`), skips the creator's open follow-ups, marks the address not confirmed (through the contact write Find's Confirm uses), and adds a notification "X's email bounced" (icon `alert`). No answer is drafted.
- **A reply:** these all go in one commit:
  - the stage goes from `emailed` or `parked` to `replied` (the normal `creator.stage` write);
  - the sequence stops with `stopped: "replied"`, and open follow-ups are skipped;
  - a notification "X replied", with icon `reply`, that goes to Reach › Replies;
  - a log line;
  - an answer draft (`kind: "reply"`, `replyTo` = the message, mailbox = the account the reply reached), queued for the drafter. It is only ever drafted, never sent on its own.

**The reading:** when the answer draft's proposal arrives, its `situation` becomes the in-message's `reading`. That reading holds the reply type, the label from the situations map, the summary, the side, `corrected: false`, and the facts from core's `readReplyFacts`. No extra Gemini prompt. A reading of `any.bounce` turns the reply into a bounce, as above, and skips the answer draft. Example data uses a stand-in reading.

**Facts (D18):** core `readReplyFacts(text)` (pure) finds:
- a rate: `$1,200`, `1200 USD`, "my rate is 900";
- top countries with shares: "US 45%, UK 20%", "mostly US and Canada";
- an age band: "25-34", "18 to 24".

Each fact has **Save to record**. It sends the DataWrite `reply.fact {messageId, key}`: main merges it into `channel_state.provided_data` (`{rate, countries, age}`), queues a `channel.edit provided_data` with its base (it syncs), and adds the key to the message's `facts_saved`. The stage stays `replied`.

**That's not it:**
- It opens a picker of the side's situations: `reach:situations` serves them from the pipeline's `situations.json`, 20 creator, 22 brand and 5 for any, with id and label.
- Picking one sends `reach:reclassify {messageId, replyType}`. Main marks the reading `corrected` with that type and label at once, then re-proposes the open answer draft with the steer note "Read their reply as: <label>". It is like a rewrite: `rewriting` shows, and the old text is kept for the toast's Undo.
- Without an open answer draft, only the reading changes.

**Paste a reply** (`reach:paste-reply {creatorId, text}`, at most 20 000 characters) works only for a creator with an outbound email. It adds an `in` message (`source: "pasted"`, no Gmail ids) and does what a swept reply does, except the notification (the person did it). It is a command with no Undo, which is recorded as a limit.

**The page:**
- **Reach › Replies** (`inbox`, now in the live rail) lists every creator whose last message is theirs, or who has an open answer draft, newest first. Each row shows the reading's tag and the first line, with "Draft ready", "Answered" or "Your move".
  - *As built (deviation, review of 6d):* the list also keeps creators whose reply was answered, marked "Answered", so a conversation doesn't disappear from Replies the moment it is answered. A never-contact or rejected creator's reply shows as "Not contacting", with nothing waiting on the person. The rail's count counts only "Draft ready" and "Your move".
- **The detail** shows the thread, then Gemini's reading (the intent, the summary, the facts with Save to record, and That's not it), then the answer's draft card. Check now sits in the header.
- **The record's Emails tab** gets the reading under their last message, and **Paste a reply by hand** under the thread once there is an outbound email.
- **The Sequences empty state** says again that follow-ups "stop on their own when someone replies".
- **The 6b slowdown** also adds a notification ("outreach3 slowed to 20 sends a day", icon `alert`, go Reach › Mailboxes).
- **The live gate:** `liveWired.reach` adds `inbox`.

**Example data:** the replied creator c10 gets a stand-in reading with a rate and countries. Paste works on example data, with a stand-in reading and answer.

## Tasks for 6d

Same rules as 6a's tasks.

| id | tier | depends | files | spec | done-check |
|---|---|---|---|---|---|
| D1 | H (lead) | – | `packages/core/src/reach/reply-facts.ts`, `replies.ts` (+ tests), `reach/index.ts`, `data/types.ts` (`reply.fact`), `packages/ipc/src/reach.ts`, `data.ts`, `channels.ts` (+ tests) | `readReplyFacts`; the Replies list (pure); the write and the four channels. | typecheck; core and ipc tests |
| D2 | N | D1 | `main/reach/reply-sweep.ts` (new), `drafter.ts`, `reach-service.ts`, `mail-state.ts`, `strings.ts`, `main/data/repositories/outreach.ts`, `sqlite-source.ts`, `example-source.ts`, `data-source-contract.ts`, `handlers.ts`, `services.ts`, `stub-services.ts`, `index.ts`, `packages/core/src/data/example.ts`, the tests | D23 in main. | vitest; contract tests |
| D3 | N | D1 | `renderer/reach/replies.tsx` (new, + test), `reach-screen.tsx`, `reach.css`, `renderer/record/reading.tsx` (new), `creator-emails.tsx`, `thread.tsx`, `renderer/lib/reach-actions.ts`, `persist.ts` (the `reply.fact` diff, if it is an `act`), `lib/wired.ts`, `strings.ts`, the tests | D23 in the page. | vitest; screenshot at 1440 px |
| D4 | N | D2, D3 | `apps/desktop/e2e/reach-replies.spec.ts` | One smoke on example data: Paste a reply for an emailed creator; it moves to Replied, Replies lists it with a reading, and an answer draft appears. | e2e on Windows |
| D5 | H | all | review (router-reviewer) | The diff against the plan. No automatic send (an answer is only drafted). Ack only what is stored. The mailbox is read only by `mail.replies`. | findings fixed |
