import {
  canSchedule,
  canSend,
  draftGates,
  findMailbox,
  isOpenDraft,
  parkChoices,
  planSteps,
} from "@gratovo/core/reach";
import type { Gate } from "@gratovo/core/reach";
import type {
  DraftState,
  MailboxView,
  OutreachDraft,
  ReachData,
  ReplyFactKey,
  RewriteHow,
  ThreadMessage,
} from "@gratovo/core/data";

import { strings } from "../strings";
import { act, openMenu } from "./actions";
import { adoptServerData } from "./persist";
import { appStore } from "./store";
import type { MenuItem } from "./store";
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

/** The send toast's line on what follows (D13): the next follow-up's day, or that it was the last. */
function nextLine(draft: OutreachDraft, sendAt: number): string | null {
  if (draft.kind === "first") {
    const first = planSteps(sendAt)[0];
    return first === undefined ? null : t.nextFollowUp(first.n, dayWords(first.dueAt));
  }
  if (draft.kind === "followUp") {
    const sequence = reachNow().sequences.find((s) => s.creator === draft.creator);
    const after = (sequence?.steps ?? []).find(
      (s) => s.n > (draft.followUp ?? 0) && (s.state === "planned" || s.state === "drafted"),
    );
    return after === undefined ? t.lastFollowUp : t.nextFollowUp(after.n, dayWords(after.dueAt));
  }
  return null;
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
        sub: [
          nextLine(draft, sendAt),
          draft.mailbox === null ? t.sentSubNoMailbox : t.sentSub(draft.mailbox),
        ]
          .filter((line) => line !== null)
          .join(". "),
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
/** Drafts whose Send later the person cancelled, and when: their too-late notice says "cancel". */
const cancels = new Map<string, number>();
/** How long a cancel is remembered for that notice. */
const cancelNoticeMs = 60_000;

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
 *   `sending` or `sent`: "Too late to undo: it has gone" ("Too late to cancel" after a Cancel);
 * - a draft being rewritten whose new text arrived: "Rewritten <how>", with an Undo that puts the
 *   old text back.
 */
export function noticeReachChange(before: ReachData, after: ReachData): void {
  const was = new Map(before.drafts.map((d) => [d.id, d]));
  for (const now of after.drafts) {
    if (was.get(now.id)?.state === "ready" && (now.state === "sending" || now.state === "sent")) {
      const cancelledAt = cancels.get(now.id);
      cancels.delete(now.id);
      const cancelled = cancelledAt !== undefined && Date.now() - cancelledAt < cancelNoticeMs;
      toast(
        cancelled
          ? { msg: t.tooLateCancel, sub: t.tooLateCancelSub, icon: "alert", tone: "info" }
          : { msg: t.tooLate, sub: t.tooLateSub, icon: "alert", tone: "info" },
      );
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

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const months = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** A day in the sender's time as "Tue 27 Oct". */
export function dayWords(at: number): string {
  const d = new Date(at);
  return `${weekdays[d.getDay()] ?? ""} ${String(d.getDate())} ${months[d.getMonth()] ?? ""}`;
}

/** A moment in the sender's time as "Tue 27 Oct, 09:00". */
export function whenWords(at: number): string {
  const d = new Date(at);
  const two = (n: number): string => String(n).padStart(2, "0");
  return `${dayWords(at)}, ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/**
 * Schedules a draft (D12, D21): `ready` becomes `scheduled` with `sendAt`; main sends at that
 * time like an approved draft. Refused, with a toast, while a gate holds it. Undo puts it back.
 */
export function scheduleDraft(id: string, at: number): boolean {
  const draft = draftOf(id);
  if (draft?.state !== "ready" || at <= Date.now()) {
    return false;
  }
  const gates = gatesOf(draft);
  if (!canSchedule(gates)) {
    const first = gates.find((g) => g.holdsSchedule);
    toast({
      msg: t.stillNeedsYou,
      ...(first === undefined ? {} : { sub: gateText(first, draft) }),
      icon: "alert",
    });
    return false;
  }
  const name = nameOf(draft);
  const label =
    draft.kind === "first"
      ? t.later.scheduledLabel.first(name)
      : draft.kind === "followUp"
        ? t.later.scheduledLabel.followUp(draft.followUp ?? 1, name)
        : t.later.scheduledLabel.reply(name);
  return act(
    label,
    (data) => {
      const target = data.reach.drafts.find((d) => d.id === id);
      if (target?.state !== "ready") {
        return false;
      }
      target.state = "scheduled";
      target.sendAt = at;
      return true;
    },
    {
      log: false,
      toast: {
        msg: t.later.toast(whenWords(at)),
        sub: t.later.toastSub,
        icon: "clock",
      },
    },
  );
}

/** Cancels a scheduled email: `scheduled` goes back to `ready`. Undo schedules it again. */
export function cancelScheduled(id: string): boolean {
  const draft = draftOf(id);
  if (draft?.state !== "scheduled") {
    return false;
  }
  const name = nameOf(draft);
  cancels.set(id, Date.now());
  const label =
    draft.kind === "first"
      ? t.later.cancelledLabel.first(name)
      : draft.kind === "followUp"
        ? t.later.cancelledLabel.followUp(name)
        : t.later.cancelledLabel.reply(name);
  return act(
    label,
    (data) => {
      const target = data.reach.drafts.find((d) => d.id === id);
      if (target?.state !== "scheduled") {
        return false;
      }
      target.state = "ready";
      target.sendAt = null;
      return true;
    },
    {
      log: false,
      toast: { msg: t.later.cancelled, sub: t.later.cancelledSub, icon: "undo" },
    },
  );
}

const localPart = (address: string): string => address.split("@")[0] ?? address;

/**
 * Sets a mailbox's normal daily limit or pauses or resumes it (D20). Written at once through main,
 * not an undo step, so the toast has no Undo. Main's new numbers arrive by `reach:changed`.
 */
export async function setMailbox(
  address: string,
  patch: { readonly dailyCap?: number; readonly paused?: boolean },
): Promise<boolean> {
  const name = localPart(address);
  let result;
  try {
    result = await window.gratovo.invoke("reach:mailbox-set", { address, ...patch });
  } catch {
    toast({ msg: t.mailboxes.setProblems.no_data, icon: "alert" });
    return false;
  }
  if (!result.ok) {
    toast({ msg: t.mailboxes.setProblems.no_data, icon: "alert" });
    return false;
  }
  if (!result.value.ok) {
    toast({ msg: t.mailboxes.setProblems[result.value.problem], icon: "alert" });
    return false;
  }
  if (patch.paused === true) {
    toast({
      msg: t.mailboxes.pausedToast(name),
      sub: t.mailboxes.pausedSub,
      icon: "pause",
      tone: "info",
    });
  } else if (patch.paused === false) {
    toast({ msg: t.mailboxes.resumedToast(name), icon: "play", tone: "info" });
  } else if (patch.dailyCap !== undefined) {
    toast({
      msg: t.mailboxes.capToast(name, patch.dailyCap),
      icon: "gauge",
      tone: "info",
      ms: 3500,
    });
  }
  return true;
}

/** Sends a short test email from a mailbox to its own address, on a person's click (D20). */
export async function sendTest(address: string): Promise<boolean> {
  let result;
  try {
    result = await window.gratovo.invoke("reach:send-test", { address });
  } catch {
    toast({ msg: t.mailboxes.testProblems.failed, icon: "alert" });
    return false;
  }
  if (!result.ok) {
    toast({ msg: t.mailboxes.testProblems.failed, icon: "alert" });
    return false;
  }
  if (!result.value.ok) {
    toast({ msg: t.mailboxes.testProblems[result.value.problem], icon: "alert" });
    return false;
  }
  toast({
    msg: t.mailboxes.testSent(address),
    sub: t.mailboxes.testSentSub,
    icon: "mail",
    tone: "good",
    ms: 5500,
  });
  return true;
}

type SequenceChannel =
  "reach:sequence-stop" | "reach:sequence-resume" | "reach:park" | "reach:wake";

/**
 * Runs one sequence command in main (D22). Commands, not undo steps: the toast carries an Undo
 * button that runs the opposite command. A refusal gets a plain toast. Gives the follow-up drafts
 * a Stop or Park skipped (none for Resume and Wake), or null when it didn't run.
 */
async function sequenceCommand(
  channel: SequenceChannel,
  input: {
    readonly creatorId: string;
    readonly until?: number;
    readonly restore?: readonly string[];
  },
): Promise<readonly string[] | null> {
  let result;
  try {
    result = await window.gratovo.invoke(channel, input);
  } catch {
    toast({ msg: t.sequences.problems.no_data, icon: "alert" });
    return null;
  }
  if (!result.ok) {
    toast({ msg: t.sequences.problems.no_data, icon: "alert" });
    return null;
  }
  const value = result.value as {
    readonly ok: boolean;
    readonly problem?: string;
    readonly skipped?: readonly string[];
  };
  if (!value.ok) {
    const problem = (value.problem ?? "no_data") as keyof typeof t.sequences.problems;
    toast({ msg: t.sequences.problems[problem], icon: "alert" });
    return null;
  }
  return value.skipped ?? [];
}

const sequenceOf = (creatorId: string) =>
  reachNow().sequences.find((s) => s.creator === creatorId) ?? null;
const undoAction = (run: () => void) => [{ label: strings.actions.undo, run }];

/**
 * Stops a creator's sequence. Undo resumes it and brings back the follow-up drafts the stop
 * skipped, as they were (review of 6c, finding 3).
 */
export async function stopSequence(creatorId: string, withUndo = true): Promise<boolean> {
  const name = creatorOf(creatorId)?.name ?? "";
  const skipped = await sequenceCommand("reach:sequence-stop", { creatorId });
  if (skipped === null) {
    return false;
  }
  toast({
    msg: t.sequences.toasts.stopped(name),
    sub: t.sequences.toasts.stoppedSub,
    icon: "pause",
    ...(withUndo
      ? {
          actions: undoAction(() => {
            void resumeSequence(creatorId, false, skipped);
          }),
        }
      : {}),
  });
  return true;
}

/** Runs a sequence that the person stopped; `restore` is a Stop's skipped drafts. Undo stops it again. */
export async function resumeSequence(
  creatorId: string,
  withUndo = true,
  restore: readonly string[] = [],
): Promise<boolean> {
  const name = creatorOf(creatorId)?.name ?? "";
  const input = restore.length > 0 ? { creatorId, restore } : { creatorId };
  if ((await sequenceCommand("reach:sequence-resume", input)) === null) {
    return false;
  }
  toast({
    msg: t.sequences.toasts.resumed(name),
    sub: t.sequences.toasts.resumedSub,
    icon: "play",
    ...(withUndo
      ? {
          actions: undoAction(() => {
            void stopSequence(creatorId, false);
          }),
        }
      : {}),
  });
  return true;
}

/** Parks a creator until the day `until` falls on. Undo wakes them, with the drafts it skipped. */
export async function parkCreator(
  creatorId: string,
  until: number,
  withUndo = true,
): Promise<boolean> {
  const name = creatorOf(creatorId)?.name ?? "";
  const skipped = await sequenceCommand("reach:park", { creatorId, until });
  if (skipped === null) {
    return false;
  }
  toast({
    msg: t.sequences.toasts.parked(name, dayWords(until)),
    sub: t.sequences.toasts.parkedSub,
    icon: "alarm",
    ...(withUndo
      ? {
          actions: undoAction(() => {
            void wakeCreator(creatorId, false, skipped);
          }),
        }
      : {}),
  });
  return true;
}

/**
 * Wakes a parked creator now; `restore` is a Park's skipped drafts. Undo parks them again, to the
 * day they were parked until.
 */
export async function wakeCreator(
  creatorId: string,
  withUndo = true,
  restore: readonly string[] = [],
): Promise<boolean> {
  const name = creatorOf(creatorId)?.name ?? "";
  const was = sequenceOf(creatorId)?.parkUntil ?? null;
  const input = restore.length > 0 ? { creatorId, restore } : { creatorId };
  if ((await sequenceCommand("reach:wake", input)) === null) {
    return false;
  }
  const back = was !== null && was > Date.now() ? was : null;
  toast({
    msg: t.sequences.toasts.woke(name),
    sub: t.sequences.toasts.wokeSub,
    icon: "alarm",
    ...(withUndo && back !== null
      ? {
          actions: undoAction(() => {
            void parkCreator(creatorId, back, false);
          }),
        }
      : {}),
  });
  return true;
}

/** The park choices as menu rows: a heading, then 2 weeks, 1 month and 3 months. */
export function parkItems(creatorId: string): MenuItem[] {
  const choices = parkChoices(Date.now());
  const item = (label: string, at: number): MenuItem => ({
    kind: "item",
    label,
    icon: "alarm",
    hint: dayWords(at),
    run: () => {
      void parkCreator(creatorId, at);
    },
  });
  return [
    { kind: "heading", label: t.sequences.parkHead },
    item(t.sequences.parkChoices.weeks2, choices.weeks2),
    item(t.sequences.parkChoices.month1, choices.month1),
    item(t.sequences.parkChoices.months3, choices.months3),
  ];
}

/** Opens the menu of park choices under `anchor`. */
export function openParkMenu(
  anchor: { left: number; right: number; top: number; bottom: number },
  creatorId: string,
): void {
  openMenu(anchor, parkItems(creatorId), t.sequences.parkHead, "end");
}

const rr = strings.reach.replies;
const rd = strings.reach.reading;
const paste = strings.reach.emails.paste;

/**
 * Reads new replies now (Reach › Replies, D23) and says what came of it. Returns how many replies
 * came in, or null when the check did not run.
 */
export async function checkReplies(): Promise<number | null> {
  try {
    const result = await window.gratovo.invoke("reach:check-replies", {});
    if (result.ok && result.value.ok) {
      const n = result.value.stored;
      toast(
        n === 0
          ? { msg: rr.toasts.none, icon: "inbox", tone: "info" }
          : { msg: rr.toasts.some(n), icon: "reply", tone: "good" },
      );
      return n;
    }
    const problem = result.ok && !result.value.ok ? result.value.problem : "failed";
    toast({ msg: rr.toasts.problems[problem], icon: "alert" });
  } catch {
    toast({ msg: rr.toasts.problems.failed, icon: "alert" });
  }
  return null;
}

/**
 * Pastes a reply the person got elsewhere into a creator's thread. A command with no Undo (D23).
 * True when it was added.
 */
export async function pasteReply(creatorId: string, text: string): Promise<boolean> {
  const creator = creatorOf(creatorId);
  const name = creator?.name ?? "";
  // What the second line can promise depends on where the creator stands now (review of 6d).
  const closed = creator?.stage === "never" || creator?.stage === "rejected";
  const answering = reachNow().drafts.some(
    (d) => d.creator === creatorId && d.kind === "reply" && isOpenDraft(d),
  );
  try {
    const result = await window.gratovo.invoke("reach:paste-reply", { creatorId, text });
    if (result.ok && result.value.ok) {
      toast({
        msg: paste.added(name),
        sub: closed ? paste.addedClosed : answering ? paste.addedAnswering : paste.addedSub,
        icon: "paste",
      });
      return true;
    }
    toast({
      msg:
        result.ok && !result.value.ok
          ? paste.problems[result.value.problem]
          : paste.problems.failed,
      icon: "alert",
    });
  } catch {
    toast({ msg: paste.problems.failed, icon: "alert" });
  }
  return false;
}

/**
 * Saves one fact of a reply to the creator's record. It goes straight through as `reply.fact`, like
 * `takeBack`, not as an undo step: the write only ever adds a fact to the record, and an Undo
 * could not take it out again (main merges it into the synced channel data). The page shows
 * "Saved" at once (`adoptServerData`), which main's next frame confirms.
 */
export async function saveReplyFact(
  creatorId: string,
  messageId: string,
  key: ReplyFactKey,
): Promise<boolean> {
  const name = creatorOf(creatorId)?.name ?? "";
  const mark = (saved: boolean): void => {
    adoptServerData((data) => {
      const lastIn = data.reach.threads.find((x) => x.creator === creatorId)?.lastIn;
      // Only the reply the fact came from: a newer one may have the same kind of fact.
      const fact =
        lastIn?.id === messageId ? lastIn.reading?.facts.find((f) => f.key === key) : undefined;
      if (fact !== undefined) {
        (fact as { saved: boolean }).saved = saved;
      }
    });
  };
  mark(true);
  try {
    const result = await window.gratovo.invoke("data:write", {
      writes: [{ kind: "reply.fact", messageId, key }],
    });
    if (result.ok) {
      toast({
        msg: rd.savedAct(rd.factName[key], name),
        sub: rd.savedSub[key],
        icon: "check",
        tone: "good",
        ms: 3500,
        actions: [],
      });
      return true;
    }
    console.error("A change wasn't saved:", result.reason);
  } catch (reason) {
    console.error("A change wasn't saved:", reason);
  }
  mark(false);
  toast({ msg: rd.saveFailed, icon: "alert" });
  return false;
}

/** The reply situations of both sides, fetched once and kept. */
export interface Situation {
  readonly id: string;
  readonly label: string;
  readonly side: "influencer" | "brand" | "any";
}
let situationsCache: Promise<readonly Situation[] | null> | null = null;
/** The situation that says the reply was a mail server's bounce. */
const bounceSituation = "any.bounce";

/** The situations for "That's not it": one fetch for the whole session; a failure is tried again. */
export function loadSituations(): Promise<readonly Situation[] | null> {
  if (situationsCache === null) {
    situationsCache = window.gratovo
      .invoke("reach:situations", {})
      .then((result) => (result.ok && result.value.ok ? result.value.situations : null))
      .catch(() => null)
      .then((list) => {
        if (list === null) {
          situationsCache = null;
        }
        return list;
      });
  }
  return situationsCache;
}

/** Forgets the kept situations (tests). */
export function resetSituationsForTests(): void {
  situationsCache = null;
}

/**
 * "That's not it": reads a reply as another situation. Main marks the reading corrected and, if an
 * answer draft is open, writes it again; that draft's new text gets the same toast and Undo as any
 * rewrite (`noticeReachChange`).
 */
export async function reclassifyReply(
  creatorId: string,
  messageId: string,
  situation: Pick<Situation, "id" | "label">,
): Promise<boolean> {
  // A bounce has nobody to answer, so main sets the answer aside rather than writing it again.
  const draft =
    situation.id === bounceSituation
      ? undefined
      : reachNow().drafts.find(
          (d) =>
            d.creator === creatorId && d.kind === "reply" && d.rewriting === null && isOpenDraft(d),
        );
  if (draft !== undefined) {
    rewrites.set(draft.id, {
      how: "redo",
      subject: draft.subject,
      body: draft.body,
      at: Date.now(),
    });
  }
  try {
    const result = await window.gratovo.invoke("reach:reclassify", {
      messageId,
      replyType: situation.id,
    });
    if (result.ok && result.value.ok) {
      const { rewritten } = result.value;
      if (!rewritten && draft !== undefined) {
        rewrites.delete(draft.id);
      }
      toast({
        msg: rd.reread(situation.label),
        ...(rewritten
          ? { sub: rd.rereadSub }
          : draft === undefined && situation.id !== bounceSituation
            ? {}
            : { sub: rd.rereadKept }),
        icon: "sparkle",
        tone: "info",
        ms: 4000,
      });
      return true;
    }
    if (result.ok && !result.value.ok) {
      toast({ msg: rd.problems[result.value.problem], icon: "alert" });
    }
  } catch {
    toast({ msg: rd.problems.no_data, icon: "alert" });
  }
  if (draft !== undefined) {
    rewrites.delete(draft.id);
  }
  return false;
}
