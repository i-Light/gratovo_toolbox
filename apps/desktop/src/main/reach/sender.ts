import { randomUUID } from "node:crypto";

import {
  draftFindingsMax,
  type CreatorState,
  type DataSource,
  type DataWrite,
  type DraftFinding,
  type DraftPatch,
  type DraftProblem,
  type DraftState,
  type MailboxView,
  type Sequence,
  type StoredDraft,
} from "@gratovo/core/data";
import {
  canSend,
  draftGates,
  findMailbox,
  planSteps,
  withStep,
  type Gate,
} from "@gratovo/core/reach";

import { textHash } from "../data/repositories/outreach";
import type { JobOutcome } from "../pipeline/jobs";
import { jobSchema, type Job, type ResultData } from "../pipeline/protocol";

import { senderStrings } from "./sender-strings";

/**
 * The sender (plan step 6, D11): the only code in the app that builds a `mail.send`.
 *
 * A person's Send writes the draft `approved` with `sendAt` 10 s ahead (the hold, so Undo can take
 * it back), or `scheduled` with its time; `DataSource.write` records who pressed it in
 * `approvedBy`. Nothing else sets those states. The sender keeps one timer for the soonest of
 * them. At the time it reads the row again, and sends only when it is still `approved` or
 * `scheduled` with `approvedBy` set, the gates (D10) still pass, and an edited text passed the
 * check. One send at a time, and never a second try on its own: a send that may have gone out
 * waits for a person ("It was sent" or "Send as new").
 *
 * Example data runs no job: at the time the message is recorded as sent, with no Gmail ids.
 */
export interface Sender {
  /** The drafts changed: arm the timer for the soonest approved or scheduled one. */
  afterWrite(): void;
  /** The app started or a source opened: settle what an earlier run left, then arm. */
  start(): void;
  /** A `maybe_sent` draft did go out: record it as sent, with no job. */
  markSent(id: string): Promise<DraftActionResult>;
  /** A `maybe_sent` draft did not go out: a fresh copy to send again, the old one skipped. */
  sendNew(id: string): Promise<DraftActionResult>;
  /** The source is closing: no timer survives it. A send under way still finishes. */
  drop(): void;
  /** Resolves once no send is under way. */
  idle(): Promise<void>;
}

export type DraftActionResult = { ok: true } | { ok: false; problem: "not_found" | "wrong_state" };

/** What a `mail.send` job carries. */
export type SendMessage = Extract<Job, { kind: "mail.send" }>["message"];

/** A send's outcome; `not_started` when main couldn't build the start (nothing went out). */
export type SendOutcome = JobOutcome | { ok: false; problem: "not_started" };

/** The bridge's `action.comms_check` on a draft's text; `{ok: false}` when the bridge is off. */
export type CheckOutcome =
  { ok: true; blocking: boolean; findings: readonly DraftFinding[] } | { ok: false };

export interface SenderDeps {
  mode(): "example" | "live" | null;
  source(): DataSource | null;
  /** The member using the app. */
  me(): string;
  /** Runs a `mail.send` through the quick queue. */
  send(message: SendMessage): Promise<SendOutcome>;
  check(draftId: string, subject: string, body: string): Promise<CheckOutcome>;
  mailboxes(): readonly MailboxView[];
  /** A send finished: the mailbox numbers should be read again. */
  afterSend(): void;
  /** Reach changed: tell the page. */
  changed(): void;
  now?: () => number;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  newId?: () => string;
  /** Kinds and codes only: never an address, a subject or a body. */
  log?: (line: string) => void;
}

/** The hold after Send, so Undo can take it back. */
export const holdMs = 10_000;
/** A scheduled draft this late when the app starts goes back to the person (D12). */
export const lateMs = 12 * 3_600_000;
/** The longest timer: a far-off schedule is re-armed rather than overflow `setTimeout`. */
const maxTimerMs = 3_600_000;

const sendable: readonly DraftState[] = ["approved", "scheduled"];

/** When an approved or scheduled draft leaves: its `sendAt`, else a hold from its last change. */
const dueAt = (draft: StoredDraft): number => draft.sendAt ?? draft.updatedAt + holdMs;

const isSendable = (draft: StoredDraft): boolean => sendable.includes(draft.state);

/** Whether a person changed anything that matters to the send since `before` was read. */
function unchanged(before: StoredDraft, after: StoredDraft): boolean {
  return (
    before.state === after.state &&
    before.sendAt === after.sendAt &&
    before.updatedAt === after.updatedAt &&
    before.subject === after.subject &&
    before.body === after.body &&
    before.mailbox === after.mailbox &&
    before.approvedBy === after.approvedBy &&
    before.gatesOk.join("\n") === after.gatesOk.join("\n") &&
    JSON.stringify(before.proposal) === JSON.stringify(after.proposal)
  );
}

/** The problem a draft goes back with when a gate holds Send. */
function gateProblem(gates: readonly Gate[]): DraftProblem {
  const first = gates.find((g) => g.holdsSend)?.key;
  if (first === "mailbox_full" || first === "mailbox_signed_out") {
    return first;
  }
  return "gates_changed";
}

type Verdict =
  | { kind: "sent"; data: ResultData<"mail.send"> }
  | { kind: "ready" | "failed"; problem: DraftProblem; code: string };

/** Gmail's words when a send may have gone out (`mail/gmail.py`, `jobs/mail.py`). */
const mayHaveGone = (text: string): boolean => /\bmay\b[^.]*\bgone out\b/i.test(text);

/** How a send ended, for the draft. `null`: the call threw, so nobody knows. */
export function sendVerdict(outcome: SendOutcome | null): Verdict {
  if (outcome === null) {
    return { kind: "failed", problem: "maybe_sent", code: "threw" };
  }
  if (!outcome.ok) {
    // The job never started: nothing went out.
    return { kind: "failed", problem: "send_failed", code: outcome.problem };
  }
  const exit = outcome.exit;
  if (exit.kind === "failed") {
    return exit.reason === "spawn"
      ? { kind: "failed", problem: "send_failed", code: exit.reason }
      : { kind: "failed", problem: "maybe_sent", code: exit.reason };
  }
  if (exit.end.state === "done" && exit.result?.kind === "mail.send") {
    return { kind: "sent", data: exit.result.data };
  }
  const error = exit.end.error;
  if (exit.end.state === "done" || error === undefined) {
    return { kind: "failed", problem: "maybe_sent", code: exit.end.state };
  }
  switch (error.code) {
    case "daily_cap_reached":
      return { kind: "ready", problem: "mailbox_full", code: error.code };
    case "mail_auth":
      return { kind: "ready", problem: "mailbox_signed_out", code: error.code };
    case "bad_start":
    case "mail_not_connected":
      return { kind: "failed", problem: "send_failed", code: error.code };
    case "network":
    case "mail_api":
      return mayHaveGone(error.message)
        ? { kind: "failed", problem: "maybe_sent", code: error.code }
        : { kind: "failed", problem: "send_failed", code: error.code };
    default:
      // `send_uncertain`, `crash` and anything unknown: it may have gone.
      return { kind: "failed", problem: "maybe_sent", code: error.code };
  }
}

interface Sent {
  readonly at: number;
  readonly mailbox: string | null;
  /** Their address; null: the creator's address. */
  readonly peer: string | null;
  readonly conversationKey: string;
  readonly messageId: string | null;
  readonly threadId: string | null;
  readonly subject: string;
  readonly by: string;
}

export function createSender(deps: SenderDeps): Sender {
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? ((run: () => void, ms: number) => setTimeout(run, ms));
  const clearTimer =
    deps.clearTimer ??
    ((handle: unknown) => {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    });
  const newId = deps.newId ?? randomUUID;
  const log =
    deps.log ??
    ((line: string) => {
      console.info(line);
    });

  let timer: unknown = null;
  /** Set by `start()`, cleared by `drop()`: the timer arms only in between. */
  let started = false;
  // The send under way: its source and draft, and its end.
  let current: { source: DataSource; id: string; done: Promise<void> } | null = null;
  // The drafts "It was sent" is recording now: a second click must not record it twice.
  const marking = new Set<string>();

  function disarm(): void {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  }

  function arm(): void {
    disarm();
    const source = deps.source();
    // Before `start()` has settled what an earlier run left approved, nothing may fire: a row the
    // app left mid-hold would otherwise go out on the first write after opening (review of 6a,
    // finding 2).
    if (!started || current !== null || deps.mode() === null || source === null) {
      return;
    }
    const waiting = source.outreach.draftsIn(sendable);
    if (waiting.length === 0) {
      return;
    }
    const soonest = Math.min(...waiting.map(dueAt));
    const delay = Math.min(maxTimerMs, Math.max(0, soonest - now()));
    timer = setTimer(() => {
      timer = null;
      fire();
    }, delay);
  }

  function fire(): void {
    const source = deps.source();
    const mode = deps.mode();
    if (current !== null || source === null || mode === null) {
      return;
    }
    const at = now();
    // The app stayed open but the computer slept past a Send later: it goes back to the person,
    // as it would at start (D12; review of 6b).
    const late = source.outreach
      .draftsIn(["scheduled"])
      .filter((d) => dueAt(d) < at - lateMs)
      .map((d) => ({ id: d.id, patch: { state: "ready", problem: "late" } as const }));
    if (late.length > 0) {
      log(
        `Reach: ${String(late.length)} scheduled draft(s) were too late and went back to a person.`,
      );
      source.outreach.commit({ at, drafts: late });
      deps.changed();
    }
    const due = source.outreach
      .draftsIn(sendable)
      .filter((d) => dueAt(d) <= at)
      .sort((a, b) => dueAt(a) - dueAt(b))[0];
    if (due === undefined) {
      arm();
      return;
    }
    const entry: { source: DataSource; id: string; done: Promise<void> } = {
      source,
      id: due.id,
      done: Promise.resolve(),
    };
    current = entry;
    entry.done = sendOne(source, mode, due.id)
      .catch(() => {
        log("Reach: a send stopped on an error; the draft is left as it was.");
      })
      .finally(() => {
        if (current === entry) {
          current = null;
        }
        arm();
      });
  }

  function creatorOf(creators: readonly CreatorState[], id: string): CreatorState | null {
    return creators.find((c) => c.id === id) ?? null;
  }

  function mailboxOf(address: string | null): MailboxView | null {
    return findMailbox(deps.mailboxes(), address);
  }

  function settle(source: DataSource, id: string, patch: DraftPatch): void {
    source.outreach.commit({ at: now(), drafts: [{ id, patch }] });
    deps.changed();
  }

  /** The writes a first email to a creator at `contact` brings: the stage and its log line. */
  function sentWrites(
    draft: StoredDraft,
    creator: CreatorState | null,
    at: number,
    unchecked: boolean,
  ): DataWrite[] {
    if (draft.kind !== "first" || creator === null || creator.stage !== "contact") {
      return [];
    }
    const name = creator.name ?? creator.handle;
    return [
      { kind: "creator.stage", id: creator.id, stage: "emailed", handle: creator.handle, name },
      {
        kind: "log.add",
        id: newId(),
        at,
        text: unchecked ? senderStrings.firstSentUnchecked(name) : senderStrings.firstSent(name),
        ref: creator.id,
        action: null,
        detail: null,
      },
    ];
  }

  /**
   * The sequence a sent email brings (D22): a first email starts one, from the mailbox it went
   * from, unless the creator has one; a follow-up marks its step sent. Nothing for a reply.
   */
  function sequenceWrites(source: DataSource, draft: StoredDraft, sent: Sent): Sequence[] {
    const have = source.outreach.sequence(draft.creator);
    if (draft.kind === "first") {
      const mailbox = sent.mailbox ?? draft.mailbox;
      return have !== null || mailbox === null
        ? []
        : [
            {
              creator: draft.creator,
              mailbox,
              startedAt: sent.at,
              steps: planSteps(sent.at),
              stopped: null,
              parkUntil: null,
            },
          ];
    }
    if (draft.kind === "followUp" && draft.followUp !== null && have !== null) {
      return [withStep(have, draft.followUp, "sent", sent.at)];
    }
    return [];
  }

  /** One commit: the message out, the draft `sent`, and the stage move of a first email. */
  async function recordSent(
    source: DataSource,
    draft: StoredDraft,
    sent: Sent,
    unchecked: boolean,
    patch: DraftPatch = {},
  ): Promise<void> {
    // Read again: the stage may have moved while the send ran.
    const creator = creatorOf(await source.creatorStates(), draft.creator);
    source.outreach.commit({
      at: now(),
      drafts: [{ id: draft.id, patch: { ...patch, state: "sent", problem: null } }],
      messages: [
        {
          id: newId(),
          creator: draft.creator,
          direction: "out",
          kind: draft.kind,
          followUp: draft.followUp,
          subject: sent.subject,
          body: draft.body,
          bodyCut: false,
          at: sent.at,
          mailbox: sent.mailbox,
          peer: sent.peer ?? creator?.email ?? null,
          peerName: creator?.contactName ?? null,
          conversationKey: sent.conversationKey,
          gmailMessageId: sent.messageId,
          gmailThreadId: sent.threadId,
          draftId: draft.id,
          by: sent.by,
          source: "app",
          reading: null,
        },
      ],
      sequences: sequenceWrites(source, draft, sent),
      writes: sentWrites(draft, creator, sent.at, unchecked),
    });
  }

  async function sendOne(source: DataSource, mode: "example" | "live", id: string): Promise<void> {
    const draft = source.outreach.draft(id);
    if (draft === null || !isSendable(draft) || dueAt(draft) > now()) {
      return;
    }
    if (draft.approvedBy === null) {
      // Only a person's write approves a draft, and it records who. One without is a bug
      // somewhere: it is never sent.
      log(`Reach: a ${draft.kind} draft was ${draft.state} with no approver; it was not sent.`);
      settle(source, id, { state: "ready", sendAt: null, problem: null });
      return;
    }
    const approvedBy = draft.approvedBy;
    const creator = creatorOf(await source.creatorStates(), draft.creator);
    // A person's change that came in while the creators were read wins: the timer reads it again.
    const still = (): boolean => {
      const row = source.outreach.draft(id);
      return row !== null && unchanged(draft, row);
    };
    if (!still()) {
      return;
    }
    const gates = draftGates({ draft, creator, mailbox: mailboxOf(draft.mailbox) });
    if (!canSend(gates) || creator === null || creator.email === null || draft.mailbox === null) {
      const problem = gateProblem(gates);
      log(`Reach: a ${draft.kind} draft went back at send time (${problem}).`);
      settle(source, id, { state: "ready", sendAt: null, problem });
      return;
    }
    const message: SendMessage = {
      to: creator.email,
      subject: draft.subject,
      body: draft.body,
      mailbox: draft.mailbox,
      conversationKey: `c:${creator.id}`,
      channelId: creator.id,
      sendKey: `draft-${draft.id}`,
      approvedBy,
    };
    if (!jobSchema.safeParse({ kind: "mail.send", message }).success) {
      log(`Reach: a ${draft.kind} draft can't be sent: the message doesn't fit the send job.`);
      settle(source, id, { state: "failed", sendAt: null, problem: "send_failed" });
      return;
    }

    // An edited text is checked first. The check is advice, and the person's approval is the
    // rule, so with the bridge off it goes and the log says it wasn't checked again. Except a text
    // the checks had blocked: that one waits for a check that passes (D10).
    let unchecked = false;
    let patch: DraftPatch = {};
    if (draft.edited && !draft.checked && draft.proposal !== null) {
      const wasBlocked =
        draft.proposal.status === "blocked" || draft.proposal.findings.some((f) => f.blocking);
      const result: CheckOutcome =
        mode === "live" ? await deps.check(draft.id, draft.subject, draft.body) : { ok: false };
      if (!result.ok) {
        if (wasBlocked) {
          if (!still()) {
            return;
          }
          log(`Reach: a ${draft.kind} draft the checks had blocked went back: no check could run.`);
          settle(source, id, { state: "ready", sendAt: null, problem: "needs_check" });
          return;
        }
        unchecked = true;
      } else {
        const proposal = {
          ...draft.proposal,
          // A pass lifts the engine's own "blocked": the checks are what blocked it.
          status:
            !result.blocking && draft.proposal.status === "blocked"
              ? ("ready" as const)
              : draft.proposal.status,
          findings: result.findings.slice(0, draftFindingsMax),
        };
        patch = { proposal, checkedHash: textHash(draft.subject, draft.body) };
        if (result.blocking) {
          if (!still()) {
            return;
          }
          log(`Reach: a ${draft.kind} draft went back: the check found a blocking problem.`);
          settle(source, id, { ...patch, state: "ready", sendAt: null, problem: "gates_changed" });
          return;
        }
      }
    }

    // The last look, in the same tick as the `sending` mark: an Undo or an edit that came in
    // while the gates or the check ran wins (the timer reads the row again).
    if (!still()) {
      return;
    }
    source.outreach.commit({
      at: now(),
      drafts: [{ id, patch: { ...patch, state: "sending", problem: null } }],
    });
    deps.changed();

    if (mode === "example") {
      await recordSent(
        source,
        draft,
        {
          at: now(),
          mailbox: draft.mailbox,
          peer: creator.email,
          conversationKey: message.conversationKey ?? `c:${creator.id}`,
          messageId: null,
          threadId: null,
          subject: draft.subject,
          by: approvedBy,
        },
        unchecked,
      );
      log(`Reach: an example ${draft.kind} draft was recorded as sent (no job).`);
      deps.afterSend();
      deps.changed();
      return;
    }

    let outcome: SendOutcome | null;
    try {
      outcome = await deps.send(message);
    } catch {
      outcome = null;
    }
    const verdict = sendVerdict(outcome);
    if (verdict.kind === "sent") {
      const data = verdict.data;
      const at = Date.parse(data.sentAt);
      await recordSent(
        source,
        draft,
        {
          at: Number.isNaN(at) ? now() : at,
          mailbox: data.account,
          peer: data.to,
          conversationKey: data.conversationKey,
          messageId: data.messageId,
          threadId: data.threadId,
          subject: data.subject ?? draft.subject,
          by: approvedBy,
        },
        unchecked,
      );
      const notes = [
        data.duplicate ? "it had gone already" : null,
        unchecked ? "not checked again after the edit" : null,
      ].filter((n) => n !== null);
      log(
        `Reach: a ${draft.kind} draft was sent${notes.length > 0 ? ` (${notes.join("; ")})` : ""}.`,
      );
    } else {
      log(`Reach: a ${draft.kind} send ended ${verdict.code}; the draft is ${verdict.problem}.`);
      source.outreach.commit({
        at: now(),
        drafts: [{ id, patch: { state: verdict.kind, sendAt: null, problem: verdict.problem } }],
      });
    }
    deps.afterSend();
    deps.changed();
  }

  /** The draft for "It was sent" or "Send as new": only one that may have gone. */
  function maybeSent(id: string): { source: DataSource; draft: StoredDraft } | DraftActionResult {
    const source = deps.source();
    const draft = source?.outreach.draft(id) ?? null;
    if (source === null || draft === null) {
      return { ok: false, problem: "not_found" };
    }
    if (draft.state !== "failed" || draft.problem !== "maybe_sent") {
      return { ok: false, problem: "wrong_state" };
    }
    return { source, draft };
  }

  return {
    afterWrite: arm,

    start() {
      const source = deps.source();
      if (deps.mode() === null || source === null) {
        return;
      }
      const at = now();
      const drafts: { id: string; patch: DraftPatch }[] = [];
      for (const draft of source.outreach.draftsIn(["approved", "scheduled", "sending"])) {
        if (current !== null && current.source === source && current.id === draft.id) {
          continue;
        }
        if (draft.state === "approved") {
          drafts.push({
            id: draft.id,
            patch: { state: "ready", sendAt: null, problem: "not_sent_closed" },
          });
        } else if (draft.state === "sending") {
          // The app stopped mid-send: nobody knows whether it went.
          drafts.push({ id: draft.id, patch: { state: "failed", problem: "maybe_sent" } });
        } else if (draft.sendAt !== null && draft.sendAt < at - lateMs) {
          drafts.push({ id: draft.id, patch: { state: "ready", problem: "late" } });
        }
      }
      if (drafts.length > 0) {
        log(
          `Reach: ${String(drafts.length)} draft(s) left by an earlier run went back to a person.`,
        );
        source.outreach.commit({ at, drafts });
        deps.changed();
      }
      started = true;
      arm();
    },

    async markSent(id) {
      const found = maybeSent(id);
      if (!("source" in found)) {
        return found;
      }
      if (marking.has(id)) {
        return { ok: false, problem: "wrong_state" };
      }
      const { source, draft } = found;
      marking.add(id);
      try {
        await recordSent(
          source,
          draft,
          {
            at: now(),
            mailbox: draft.mailbox,
            peer: null,
            conversationKey: `c:${draft.creator}`,
            messageId: null,
            threadId: null,
            subject: draft.subject,
            by: draft.approvedBy ?? deps.me(),
          },
          false,
        );
      } finally {
        marking.delete(id);
      }
      log(`Reach: a ${draft.kind} draft was marked as sent by a person.`);
      deps.afterSend();
      deps.changed();
      return { ok: true };
    },

    sendNew(id) {
      const found = maybeSent(id);
      if (!("source" in found)) {
        return Promise.resolve(found);
      }
      const { source, draft } = found;
      const at = now();
      const fresh = newId();
      source.outreach.insertDraft({
        id: fresh,
        creator: draft.creator,
        kind: draft.kind,
        followUp: draft.followUp,
        mailbox: draft.mailbox,
        replyTo: draft.replyTo,
        at,
      });
      source.outreach.updateDraft(
        fresh,
        {
          state: "ready",
          subject: draft.subject,
          body: draft.body,
          proposal: draft.proposal,
          gatesOk: draft.gatesOk,
          checkedHash: draft.checkedHash,
          problem: null,
        },
        at,
      );
      source.outreach.commit({ at, drafts: [{ id: draft.id, patch: { state: "skipped" } }] });
      log(`Reach: a ${draft.kind} draft was copied to send as new.`);
      deps.changed();
      return Promise.resolve({ ok: true });
    },

    drop() {
      started = false;
      disarm();
    },

    idle: () => current?.done ?? Promise.resolve(),
  };
}
