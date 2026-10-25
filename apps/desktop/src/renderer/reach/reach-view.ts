import type { MailboxView, OutreachDraft, ReachData } from "@gratovo/core/data";
import { nextStep } from "@gratovo/core/reach";
import type { BoardItem, BoardLaneKey } from "@gratovo/core/reach";

import { ago } from "../lib/format";
import { kindLabel } from "../lib/reach-actions";
import { strings } from "../strings";

const t = strings.reach;

/** The drafts that wait for a person: ready, or failed and needing a look. */
export function waitingDrafts(reach: ReachData): OutreachDraft[] {
  return reach.drafts.filter((d) => d.state === "ready" || d.state === "failed");
}

/** The page's sub line: what is waiting, in the prototype's words. */
export function subLine(reach: ReachData): string {
  const waiting = waitingDrafts(reach);
  const count = (kind: OutreachDraft["kind"]): number =>
    waiting.filter((d) => d.kind === kind).length;
  const parts: string[] = [];
  const first = count("first");
  const followUps = count("followUp");
  const replies = count("reply");
  if (first > 0) {
    parts.push(t.screen.emailsToApprove(first));
  }
  if (followUps > 0) {
    parts.push(t.screen.followUpsToApprove(followUps));
  }
  if (replies > 0) {
    parts.push(t.screen.repliesToAnswer(replies));
  }
  if (parts.length === 0) {
    return t.screen.nothingWaiting;
  }
  const last = parts.pop();
  const joined = parts.length === 0 ? (last ?? "") : `${parts.join(", ")} and ${last ?? ""}`;
  return `${joined}. ${t.screen.nothingLeaves}`;
}

/** Sends left today across the mailboxes that can send, and how many are slowed or paused. */
export function capacity(mailboxes: readonly MailboxView[]): {
  readonly left: number;
  readonly cap: number;
  readonly sent: number;
  readonly live: number;
  readonly slowed: number;
  readonly paused: number;
} {
  const live = mailboxes.filter((m) => m.connected && !m.signedOut && !m.paused);
  const sum = (pick: (m: MailboxView) => number): number =>
    live.reduce((total, m) => total + pick(m), 0);
  return {
    left: sum((m) => Math.max(0, m.leftToday)),
    cap: sum((m) => m.effectiveCap),
    sent: sum((m) => Math.min(m.sentToday, m.effectiveCap)),
    live: live.length,
    slowed: live.filter((m) => m.status === "slowed").length,
    paused: mailboxes.length - live.length,
  };
}

/** How soon something is due: "due now", "in 40 min", "tomorrow", "in 5 days". */
export function dueWords(at: number, now: number): string {
  const minutes = Math.round((at - now) / 60_000);
  const due = t.board.due;
  if (minutes <= 0) {
    return due.now;
  }
  if (minutes < 60) {
    return due.minutes(minutes);
  }
  if (minutes < 24 * 60) {
    return due.hours(Math.round(minutes / 60));
  }
  const days = Math.round(minutes / (24 * 60));
  return days <= 1 ? due.tomorrow : due.days(days);
}

/** The button on a card; `writing` is Gemini at work, shown but not pressable. */
export type CardAction = "draftIt" | "writing" | "review" | "answer";

export interface CardInfo {
  readonly sub: string;
  /** A gate or a failure holds the draft: the sub line shows the alert icon. */
  readonly need: boolean;
  readonly chip:
    | { readonly kind: "age"; readonly at: number }
    | { readonly kind: "due"; readonly at: number }
    | { readonly kind: "finished" }
    | null;
  readonly action: CardAction | null;
}

/** What a card says and offers, per lane (the prototype's `cardInfo`). `gateShort` is the first open gate's words. */
export function cardInfo(
  item: BoardItem,
  lane: BoardLaneKey,
  now: number,
  gateShort: string | null,
): CardInfo {
  const { draft, sequence, thread } = item;
  const sub = t.board.sub;
  if (lane === "todraft") {
    return draft?.state === "drafting"
      ? { sub: sub.drafting, need: false, chip: null, action: "writing" }
      : { sub: sub.todraft, need: false, chip: null, action: "draftIt" };
  }
  if (lane === "waiting" && draft !== null) {
    const failed = draft.state === "failed";
    const why = failed
      ? t.problems[draft.problem ?? "send_failed"]
      : (gateShort ?? sub.readyToSend);
    return {
      sub: `${kindLabel(draft)} · ${why}`,
      need: failed || gateShort !== null,
      chip: { kind: "age", at: draft.createdAt },
      action: "review",
    };
  }
  if (lane === "seq") {
    if (draft?.state === "drafting") {
      return { sub: sub.drafting, need: false, chip: null, action: "writing" };
    }
    if (sequence?.stopped != null) {
      return { sub: sub.stopped[sequence.stopped], need: false, chip: null, action: null };
    }
    if (sequence === null) {
      // No sequence (none before step 6c, or an old email): say when the email went, and
      // promise no follow-up.
      const out = thread?.lastOutAt ?? null;
      return {
        sub: out === null ? sub.emailedEarlier : sub.emailed(ago(out, now)),
        need: false,
        // The line already says when; a chip would say it again.
        chip: null,
        action: null,
      };
    }
    const next = nextStep(sequence);
    const first = sequence.startedAt;
    const emailed = sub.emailed(ago(first, now));
    return {
      sub:
        next === null
          ? `${emailed} · ${sub.lastSent}`
          : `${emailed} · ${sub.next(t.kinds.followUp(next.n).toLowerCase())}`,
      need: false,
      chip: next === null ? { kind: "finished" } : { kind: "due", at: next.dueAt },
      action: null,
    };
  }
  if (lane === "replied") {
    const lastIn = thread?.lastIn ?? null;
    const answered = draft === null && thread?.answered === true;
    return {
      sub: answered ? sub.answered : (lastIn?.reading?.label ?? lastIn?.preview ?? sub.replied),
      need: false,
      chip: lastIn === null ? null : { kind: "age", at: lastIn.at },
      action: draft === null ? null : draft.state === "drafting" ? "writing" : "answer",
    };
  }
  return { sub: strings.record.stages[item.creator.stage], need: false, chip: null, action: null };
}
