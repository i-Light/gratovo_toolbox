import { canSend, draftGates, findMailbox } from "@gratovo/core/reach";
import type { Gate } from "@gratovo/core/reach";
import type {
  DraftState,
  MailboxView,
  OutreachDraft,
  ReachData,
  RewriteHow,
  ThreadMessage,
} from "@gratovo/core/data";

import { strings } from "../strings";
import { act } from "./actions";
import { adoptServerData } from "./persist";
import { appStore } from "./store";
import { toast } from "./toast";

const t = strings.reach;

/** How long a sent email can still be taken back, in ms (D11). */
const holdMs = 10_000;
/** How long a rewrite is waited for before it is forgotten, in ms. */
const rewriteWaitMs = 10 * 60_000;
/** The states a person may skip a draft from (D5). */
const skippable: readonly DraftState[] = ["ready", "scheduled", "failed"];

const reachNow = (): ReachData => appStore().getState().data.reach;
const draftOf = (id: string): OutreachDraft | undefined =>
  reachNow().drafts.find((d) => d.id === id);
const mailboxOf = (address: string | null): MailboxView | null =>
  findMailbox(reachNow().mailboxes, address);
const creatorOf = (id: string) =>
  appStore()
    .getState()
    .data.creators.find((c) => c.id === id) ?? null;
const nameOf = (draft: OutreachDraft): string => creatorOf(draft.creator)?.name ?? "";

/** The open gates of a draft, in order (the page's own view; main checks again before a send). */
export function gatesOf(draft: OutreachDraft): Gate[] {
  return draftGates({
    draft,
    creator: creatorOf(draft.creator),
    mailbox: mailboxOf(draft.mailbox),
  });
}

/** The words for one gate. */
export function gateText(gate: Gate, draft: OutreachDraft): string {
  const address = draft.mailbox ?? "";
  switch (gate.key) {
    case "mailbox_signed_out":
      return t.gates.mailbox_signed_out(address);
    case "mailbox_paused":
      return t.gates.mailbox_paused(address);
    case "mailbox_full":
      return t.gates.mailbox_full(address, mailboxOf(draft.mailbox)?.effectiveCap ?? 0);
    case "engine":
      return gate.engine?.text ?? t.gatesShort.engine;
    default:
      return t.gates[gate.key];
  }
}

/** The label of a draft's kind: "First email", "Follow-up 2 of 3", "Reply". */
export function kindLabel(draft: Pick<OutreachDraft, "kind" | "followUp">): string {
  return draft.kind === "followUp" ? t.kinds.followUp(draft.followUp ?? 1) : t.kinds[draft.kind];
}

function sentLabel(draft: OutreachDraft): string {
  const name = nameOf(draft);
  if (draft.kind === "first") {
    return t.sentLabel.first(name);
  }
  return draft.kind === "followUp"
    ? t.sentLabel.followUp(draft.followUp ?? 1, name)
    : t.sentLabel.reply(name);
}

/**
 * Sends a draft: refuses, with a toast, while a gate holds it; else it becomes `approved` with the
 * 10 s hold, and the toast carries Undo. Main sends at `sendAt` (D11).
 */
export function sendDraft(id: string): boolean {
  const draft = draftOf(id);
  if (draft?.state !== "ready") {
    return false;
  }
  const gates = gatesOf(draft);
  if (!canSend(gates)) {
    const first = gates.find((g) => g.holdsSend);
    toast({
      msg: t.stillNeedsYou,
      ...(first === undefined ? {} : { sub: gateText(first, draft) }),
      icon: "alert",
    });
    return false;
  }
  const sendAt = Date.now() + holdMs;
  const done = act(
    sentLabel(draft),
    (data) => {
      const target = data.reach.drafts.find((d) => d.id === id);
      if (target?.state !== "ready") {
        return false;
      }
      target.state = "approved";
      target.sendAt = sendAt;
      return true;
    },
    {
      log: false,
      toast: {
        msg: t.sentTo(nameOf(draft)),
        sub: draft.mailbox === null ? t.sentSubNoMailbox : t.sentSub(draft.mailbox),
        icon: "send",
        ms: holdMs,
      },
    },
  );
  return done;
}

/** Skips a draft. A follow-up skipped leaves the next one planned. */
export function skipDraft(id: string): boolean {
  const draft = draftOf(id);
  if (draft === undefined || !skippable.includes(draft.state)) {
    return false;
  }
  const done = act(
    t.skippedLabel(kindLabel(draft).toLowerCase(), nameOf(draft)),
    (data) => {
      const target = data.reach.drafts.find((d) => d.id === id);
      if (target === undefined) {
        return false;
      }
      target.state = "skipped";
      target.sendAt = null;
      return true;
    },
    {
      log: false,
      toast: {
        msg: t.skipped,
        sub: draft.kind === "followUp" ? t.skippedSubFollowUp : t.skippedSub,
        icon: "arrowR",
        tone: "info",
        // Main sets `failed`, not a person: a skip from it can't be taken back by a write.
        undo: draft.state !== "failed",
      },
    },
  );
  return done;
}

/** Confirms one engine gate of a draft. */
export function confirmGate(id: string, key: string): boolean {
  const draft = draftOf(id);
  if (
    draft === undefined ||
    draft.gatesOk.includes(key) ||
    !(draft.proposal?.gates ?? []).some((g) => g.key === key)
  ) {
    return false;
  }
  return (
    act(
      t.confirmedGate,
      (data) => {
        data.reach.drafts.find((d) => d.id === id)?.gatesOk.push(key);
      },
      { log: false },
    ) !== false
  );
}

/** Picks the mailbox a first email goes from; follow-ups and answers keep the sequence's (D3). */
export function setDraftMailbox(id: string, address: string): boolean {
  const draft = draftOf(id);
  if (
    draft?.kind !== "first" ||
    draft.mailbox === address ||
    mailboxOf(address) === null ||
    (draft.state !== "ready" && draft.state !== "failed")
  ) {
    return false;
  }
  return (
    act(
      t.changedMailbox,
      (data) => {
        const target = data.reach.drafts.find((d) => d.id === id);
        if (target !== undefined) {
          target.mailbox = address;
        }
      },
      { log: false },
    ) !== false
  );
}

/** What a rewrite replaced, until its new text arrives. */
const rewrites = new Map<
  string,
  { readonly how: RewriteHow; readonly subject: string; readonly body: string; readonly at: number }
>();

/** Asks Gemini to rewrite a draft; the new text comes back as server data. */
export async function rewriteDraft(id: string, how: RewriteHow): Promise<boolean> {
  const draft = draftOf(id);
  if (draft === undefined || draft.rewriting !== null) {
    return false;
  }
  rewrites.set(id, { how, subject: draft.subject, body: draft.body, at: Date.now() });
  const result = await window.gratovo.invoke("reach:rewrite", { draftId: id, how });
  if (result.ok && result.value.ok) {
    return true;
  }
  rewrites.delete(id);
  if (result.ok && !result.value.ok) {
    const problem = result.value.problem;
    const sub = t.rewriteProblemSub[problem];
    toast({ msg: t.rewriteProblems[problem], ...(sub === "" ? {} : { sub }), icon: "alert" });
  }
  return false;
}

/** Puts a draft's earlier text back (an act, so Redo and Ctrl Z work); written as `draft.text`. */
export function undoRewrite(id: string, subject: string, body: string): boolean {
  const draft = draftOf(id);
  if (draft === undefined || (draft.subject === subject && draft.body === body)) {
    return false;
  }
  return (
    act(
      t.undidRewrite,
      (data) => {
        const target = data.reach.drafts.find((d) => d.id === id);
        if (target !== undefined) {
          target.subject = subject;
          target.body = body;
        }
      },
      { log: false },
    ) !== false
  );
}

/**
 * Writes typed text straight through, not an undo step (like Find's notes): the store takes it
 * as saved. Debouncing is the card's job.
 */
export async function typeDraft(id: string, subject: string, body: string): Promise<boolean> {
  const draft = draftOf(id);
  if (draft === undefined || (draft.subject === subject && draft.body === body)) {
    return false;
  }
  adoptServerData((data) => {
    const target = data.reach.drafts.find((d) => d.id === id);
    if (target !== undefined) {
      target.subject = subject;
      target.body = body;
      target.edited = true;
    }
  });
  try {
    const result = await window.gratovo.invoke("data:write", {
      writes: [{ kind: "draft.text", id, subject, body }],
    });
    if (result.ok) {
      return true;
    }
    console.error("A change wasn't saved:", result.reason);
  } catch (reason) {
    console.error("A change wasn't saved:", reason);
  }
  toast({ msg: strings.saveFailed.title, sub: strings.saveFailed.sub, icon: "alert" });
  return false;
}

async function onDraft(
  channel: "reach:retry" | "reach:mark-sent" | "reach:send-new",
  id: string,
  done: string,
  sub?: string,
): Promise<boolean> {
  const result = await window.gratovo.invoke(channel, { draftId: id });
  if (result.ok && result.value.ok) {
    toast({ msg: done, ...(sub === undefined ? {} : { sub }), icon: "check", tone: "good" });
    return true;
  }
  if (result.ok && !result.value.ok) {
    toast({ msg: t.actionProblems[result.value.problem], icon: "alert" });
  }
  return false;
}

/** Tries a failed draft again. */
export function retryDraft(id: string): Promise<boolean> {
  return onDraft("reach:retry", id, t.retryStarted);
}

/** Records a "maybe sent" draft as sent, without sending. */
export function markSent(id: string): Promise<boolean> {
  return onDraft("reach:mark-sent", id, t.markedSent, t.markedSentSub);
}

/** Sends a "maybe sent" draft again as a new email. */
export function sendAsNew(id: string): Promise<boolean> {
  return onDraft("reach:send-new", id, t.sendAsNewStarted);
}

/** Asks for a first email for a creator at Contact now. */
export async function draftNow(creatorId: string): Promise<boolean> {
  const result = await window.gratovo.invoke("reach:draft-now", { creatorId });
  if (result.ok && result.value.ok) {
    toast({ msg: t.draftNowStarted, icon: "sparkle", tone: "info" });
    return true;
  }
  if (result.ok && !result.value.ok) {
    toast({ msg: t.draftNowProblems[result.value.problem], icon: "alert" });
  }
  return false;
}

/** One creator's messages, oldest first; null when they can't be read. */
export async function loadThread(creatorId: string): Promise<readonly ThreadMessage[] | null> {
  try {
    const result = await window.gratovo.invoke("reach:thread", { creatorId });
    return result.ok && result.value.ok ? result.value.messages : null;
  } catch {
    return null;
  }
}

/**
 * Looks at what the server changed in Reach (called from the live updates, with the page's Reach
 * before the answer and the answer's). Two things are said once:
 * - a draft the page holds as `ready` (the person's Undo put it back) that the server says is
 *   `sending` or `sent`: "Too late to undo: it has gone";
 * - a draft being rewritten whose new text arrived: "Rewritten <how>", with an Undo that puts the
 *   old text back.
 */
export function noticeReachChange(before: ReachData, after: ReachData): void {
  const was = new Map(before.drafts.map((d) => [d.id, d]));
  for (const now of after.drafts) {
    if (was.get(now.id)?.state === "ready" && (now.state === "sending" || now.state === "sent")) {
      toast({ msg: t.tooLate, sub: t.tooLateSub, icon: "alert", tone: "info" });
    }
  }
  const at = Date.now();
  for (const [id, old] of rewrites) {
    const now = after.drafts.find((d) => d.id === id);
    if (now === undefined || at - old.at > rewriteWaitMs) {
      rewrites.delete(id);
    } else if (now.rewriting === null && (now.subject !== old.subject || now.body !== old.body)) {
      rewrites.delete(id);
      toast({
        msg: old.how === "redo" ? t.newVersion : t.rewritten(t.hows[old.how]),
        sub: t.rewrittenSub,
        icon: "sparkle",
        tone: "info",
        ms: 4000,
        actions: [
          {
            label: strings.actions.undo,
            run: () => {
              undoRewrite(id, old.subject, old.body);
            },
          },
        ],
      });
    }
  }
}
