import type {
  Creator,
  CreatorStage,
  MailboxView,
  OutreachDraft,
  ReachData,
  Sequence,
  SequenceStep,
  ThreadSummary,
} from "@gratovo/core/data";
import { isFinished, isRunning, nextStep, repliesToAnswer, replyItems } from "@gratovo/core/reach";
import type { BoardItem, BoardLaneKey } from "@gratovo/core/reach";
import type { IconName } from "@gratovo/ui";

import { ago } from "../lib/format";
import { dayWords, kindLabel, whenWords } from "../lib/reach-actions";
import { strings } from "../strings";

const t = strings.reach;

/** The drafts that wait for a person: ready, or failed and needing a look. */
export function waitingDrafts(reach: ReachData): OutreachDraft[] {
  return reach.drafts.filter((d) => d.state === "ready" || d.state === "failed");
}

/**
 * The page's sub line: what is waiting, in the prototype's words. With the creators, the replies to
 * answer are counted as Replies counts them (D14, D16): an answer draft to send, or a reply nobody
 * has answered yet.
 */
export function subLine(reach: ReachData, creators?: readonly Creator[]): string {
  const waiting = waitingDrafts(reach);
  const count = (kind: OutreachDraft["kind"]): number =>
    waiting.filter((d) => d.kind === kind).length;
  const parts: string[] = [];
  const first = count("first");
  const followUps = count("followUp");
  const replies =
    creators === undefined
      ? count("reply")
      : repliesToAnswer(replyItems(creators, reach.threads, reach.drafts));
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
    if (draft?.state === "scheduled" && draft.sendAt !== null) {
      return {
        sub: `${kindLabel(draft)} · ${sub.scheduled}`,
        need: false,
        chip: { kind: "due", at: draft.sendAt },
        action: null,
      };
    }
    if (sequence?.parkUntil != null || item.creator.stage === "parked") {
      return {
        sub:
          sequence?.parkUntil == null
            ? t.sequences.next.parkedNoDay
            : sub.parked(dayWords(sequence.parkUntil)),
        need: false,
        chip: null,
        action: null,
      };
    }
    if (sequence?.stopped != null) {
      return {
        sub: sub.stopped[sequence.stopped],
        need: false,
        chip: sequence.stopped === "finished" ? { kind: "finished" } : null,
        action: null,
      };
    }
    if (sequence !== null && isFinished(sequence, now)) {
      return { sub: sub.stopped.finished, need: false, chip: { kind: "finished" }, action: null };
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

const dayMs = 86_400_000;
const seq = t.sequences;

/** Local midnight of the day `at` falls on. */
function midnight(at: number): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Whole days from `now`'s day to `at`'s day (local); negative for a day gone. */
export function dayDiff(at: number, now: number): number {
  return Math.round((midnight(at) - midnight(now)) / dayMs);
}

/** How many days the timeline shows on each side of today. */
export const timelineSpan = 14;

/** Where a sequence stands. */
export type SeqState = "running" | "parked" | "stopped" | "finished" | "done";

export interface SeqRow {
  readonly creator: Creator;
  readonly sequence: Sequence;
  readonly thread: ThreadSummary | null;
  readonly next: SequenceStep | null;
  readonly state: SeqState;
  /** Running: its next step is waiting. Everything else counts as stopped in the filter. */
  readonly running: boolean;
}

/**
 * The sequence's state: parked, stopped (by whom), finished, done (last step sent, waiting), or
 * running. A creator whose stage is `parked` counts as parked even with no day stored, so Wake is
 * always there to put it right (review of 6c, finding 4).
 */
export function seqState(sequence: Sequence, now: number, stage?: CreatorStage): SeqState {
  if (sequence.parkUntil !== null || stage === "parked") {
    return "parked";
  }
  if (sequence.stopped === "finished" || isFinished(sequence, now)) {
    return "finished";
  }
  if (sequence.stopped !== null) {
    return "stopped";
  }
  return nextStep(sequence) === null ? "done" : "running";
}

/** One row per creator with a sequence: running ones first by next step, then the rest by last activity. */
export function sequenceRows(
  creators: readonly Creator[],
  sequences: readonly Sequence[],
  threads: readonly ThreadSummary[],
  now: number,
): SeqRow[] {
  const byCreator = new Map(creators.map((c) => [c.id, c]));
  const byThread = new Map(threads.map((th) => [th.creator, th]));
  const rows: SeqRow[] = [];
  for (const sequence of sequences) {
    const creator = byCreator.get(sequence.creator);
    if (creator === undefined) {
      continue;
    }
    const state = seqState(sequence, now, creator.stage);
    rows.push({
      creator,
      sequence,
      thread: byThread.get(sequence.creator) ?? null,
      next: state === "running" ? nextStep(sequence) : null,
      state,
      running: state === "running",
    });
  }
  const activity = (r: SeqRow): number =>
    Math.max(r.thread?.lastIn?.at ?? 0, r.thread?.lastOutAt ?? 0, r.sequence.startedAt);
  return rows.sort((a, b) => {
    if (a.running !== b.running) {
      return a.running ? -1 : 1;
    }
    if (a.running) {
      return (a.next?.dueAt ?? 0) - (b.next?.dueAt ?? 0);
    }
    return activity(b) - activity(a);
  });
}

/** The words for when a step is due: "due today", "tomorrow", "in 3 days", "on Nov 12". */
export function whenWord(at: number, now: number): string {
  const n = dayDiff(at, now);
  if (n === 0) {
    return seq.next.dueToday;
  }
  if (n < 0) {
    return seq.next.wasDue(-n);
  }
  if (n === 1) {
    return seq.next.tomorrow;
  }
  return n < 7 ? seq.next.inDays(n) : seq.next.on(dayWords(at));
}

/** The "Next step" column: words, an icon, and whether the step is due. */
export function nextWords(
  row: Pick<SeqRow, "sequence" | "state" | "next">,
  now: number,
): { readonly text: string; readonly icon: IconName; readonly due: boolean } {
  const { sequence, state, next } = row;
  if (state === "parked") {
    return {
      text:
        sequence.parkUntil === null
          ? seq.next.parkedNoDay
          : seq.next.parked(dayWords(sequence.parkUntil)),
      icon: "alarm",
      due: false,
    };
  }
  if (state === "finished") {
    return { text: seq.next.finished, icon: "check", due: false };
  }
  if (state === "stopped") {
    const how = sequence.stopped ?? "you";
    return {
      text: seq.next[how === "finished" ? "finished" : how],
      icon: how === "replied" ? "reply" : "pause",
      due: false,
    };
  }
  if (next === null) {
    return { text: seq.next.last, icon: "check", due: false };
  }
  const due = dayDiff(next.dueAt, now) <= 0;
  return {
    text: seq.next.step(next.n, whenWord(next.dueAt, now)),
    icon: due ? "alarm" : "clock",
    due,
  };
}

export interface SeqDot {
  readonly type: "sent" | "due" | "plan" | "skip" | "reply";
  /** Also the dot's accessible name. */
  readonly text: string;
}

/** The dots of one row, by day column (0 is 14 days back), and the first and last event's columns. */
export function sequenceEvents(
  row: SeqRow,
  now: number,
): { readonly days: SeqDot[][]; readonly lo: number; readonly hi: number } {
  const { sequence, thread } = row;
  const days: SeqDot[][] = Array.from({ length: 2 * timelineSpan + 1 }, () => []);
  const raw: { readonly col: number; readonly dot: SeqDot }[] = [];
  const add = (at: number, dot: SeqDot): void => {
    raw.push({ col: dayDiff(at, now) + timelineSpan, dot });
  };
  const running = isRunning(sequence);
  add(sequence.startedAt, { type: "sent", text: seq.dots.first(whenWords(sequence.startedAt)) });
  for (const s of sequence.steps) {
    if (s.state === "sent") {
      const at = s.sentAt ?? s.dueAt;
      add(at, { type: "sent", text: seq.dots.sent(s.n, whenWords(at)) });
    } else if (s.state === "skipped") {
      add(s.dueAt, { type: "skip", text: seq.dots.skipped(s.n, dayWords(s.dueAt)) });
    } else if (s.state === "drafted" || (running && dayDiff(s.dueAt, now) <= 0)) {
      add(s.dueAt, {
        type: "due",
        text: seq.dots.due(s.n, dayWords(s.dueAt), dayDiff(s.dueAt, now) < 0),
      });
    } else {
      add(s.dueAt, { type: "plan", text: seq.dots.planned(s.n, dayWords(s.dueAt)) });
    }
  }
  if (thread?.lastIn != null) {
    add(thread.lastIn.at, { type: "reply", text: seq.dots.reply(whenWords(thread.lastIn.at)) });
  }
  for (const { col, dot } of raw) {
    days[col]?.push(dot);
  }
  const cols = raw.map((r) => r.col);
  return { days, lo: Math.min(...cols), hi: Math.max(...cols) };
}

/** The timeline's days: 14 back to 14 ahead, as local midnights. */
export function timelineDays(now: number): number[] {
  return Array.from({ length: 2 * timelineSpan + 1 }, (_, i) => {
    const d = new Date(midnight(now));
    d.setDate(d.getDate() + i - timelineSpan);
    return d.getTime();
  });
}

/** The tag colour of a reply's reading, by its type (D23; prototype `intentTone`). */
export function replyTone(
  type: string | null,
  bounce: boolean,
): "good" | "warn" | "crit" | "info" | undefined {
  if (bounce || type === "any.bounce") {
    return "crit";
  }
  switch (type?.split(".")[1]) {
    case "interested_vague":
    case "gives_rate":
    case "media_kit":
    case "agrees":
      return "good";
    case "asks_price_from_us":
    case "counter":
    case "has_manager":
      return "info";
    case "later":
    case "not_interested":
    case "out_of_office":
      return "warn";
    case "angry":
    case "unsubscribe":
      return "crit";
    default:
      return undefined;
  }
}

/** The part of a reading's label before " · ", for the list's tag. */
export function shortReading(label: string): string {
  return label.split(" · ")[0] ?? label;
}
