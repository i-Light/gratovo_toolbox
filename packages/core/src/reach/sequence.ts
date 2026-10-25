import type { Sequence, SequenceStep } from "../data/reach-types";

/**
 * The follow-up sequence's rules (plan step 6, D13 and D22). Pure: main and the page both use
 * them, so the timeline, the drafter and the day timer agree.
 */

const dayMs = 86_400_000;

/** The follow-ups after a first email: days after it was sent. */
export const followUpDays = [3, 7, 14] as const;
/** A sequence whose last step went this long ago with no reply is finished. */
export const finishAfterMs = 7 * dayMs;

/** Local midnight of the day `at` falls on. */
function midnight(at: number): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** `at` plus whole calendar days, keeping the time of day (a clock change can't move the day). */
function addDays(at: number, days: number): number {
  const d = new Date(at);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/** The steps of a sequence whose first email went at `sentAt`, all planned. */
export function planSteps(sentAt: number): SequenceStep[] {
  return followUpDays.map((days, i) => ({
    n: i + 1,
    dueAt: addDays(sentAt, days),
    state: "planned",
    sentAt: null,
  }));
}

/** Whether the sequence is running: not stopped and not parked. */
export function isRunning(sequence: Sequence): boolean {
  return sequence.stopped === null && sequence.parkUntil === null;
}

/** The planned steps whose due day has begun, while the sequence runs. */
export function dueSteps(sequence: Sequence, now: number): SequenceStep[] {
  if (!isRunning(sequence)) {
    return [];
  }
  const today = midnight(now);
  return sequence.steps.filter((s) => s.state === "planned" && midnight(s.dueAt) <= today);
}

/** No step left to draft or send, and 7 calendar days since the day the last one went. */
export function isFinished(sequence: Sequence, now: number): boolean {
  if (sequence.stopped !== null) {
    return false;
  }
  if (sequence.steps.some((s) => s.state === "planned" || s.state === "drafted")) {
    return false;
  }
  const last = Math.max(sequence.startedAt, ...sequence.steps.map((s) => s.sentAt ?? 0));
  return midnight(now) >= addDays(midnight(last), finishAfterMs / dayMs);
}

/** Drafted steps go back to planned: their drafts are skipped, and Resume or Wake drafts them. */
function undrafted(steps: readonly SequenceStep[]): SequenceStep[] {
  return steps.map((s) => (s.state === "drafted" ? { ...s, state: "planned" } : s));
}

/** Stopped by the person: its open follow-up drafts are skipped by the caller. */
export function stopped(sequence: Sequence): Sequence {
  return { ...sequence, stopped: "you", steps: undrafted(sequence.steps) };
}

/**
 * Moves every planned step by the same amount, so the first is due no earlier than `now` and the
 * gaps stay. `null` leaves them where they are (an Undo bringing the drafts back).
 */
function retimed(steps: readonly SequenceStep[], now: number | null): SequenceStep[] {
  const planned = steps.filter((s) => s.state === "planned");
  const first = Math.min(...planned.map((s) => s.dueAt));
  const shift = now === null || planned.length === 0 || first >= now ? 0 : now - first;
  return steps.map((s) =>
    s.state === "planned" && shift > 0 ? { ...s, dueAt: s.dueAt + shift } : s,
  );
}

/**
 * Running again after the person stopped it; any other stop stays. The planned steps are re-timed
 * like a wake (not when `now` is `null`).
 */
export function resumed(sequence: Sequence, now: number | null): Sequence {
  return sequence.stopped === "you"
    ? { ...sequence, stopped: null, steps: retimed(sequence.steps, now) }
    : sequence;
}

/** Parked until the local midnight of `until`'s day. */
export function parked(sequence: Sequence, until: number): Sequence {
  return { ...sequence, parkUntil: midnight(until), steps: undrafted(sequence.steps) };
}

/**
 * Awake again. When the first planned step was due before `now`, every planned step moves by the
 * same amount, so the first is due now and the gaps stay. `null` re-times nothing.
 */
export function woken(sequence: Sequence, now: number | null): Sequence {
  return { ...sequence, parkUntil: null, steps: retimed(sequence.steps, now) };
}

/** Whether a parked sequence's day has come. */
export function wakeDue(sequence: Sequence, now: number): boolean {
  return sequence.parkUntil !== null && midnight(now) >= sequence.parkUntil;
}

/**
 * The step a follow-up draft is for, marked; other steps as they were. A step marked sent late
 * pushes the later planned steps by the lateness, so the next keeps its planned gap and the
 * follow-ups never go back to back (never earlier than planned).
 */
export function withStep(
  sequence: Sequence,
  n: number,
  state: SequenceStep["state"],
  sentAt: number | null = null,
): Sequence {
  const own = sequence.steps.find((s) => s.n === n);
  const late = state === "sent" && own !== undefined && sentAt !== null ? sentAt - own.dueAt : 0;
  return {
    ...sequence,
    steps: sequence.steps.map((s) => {
      if (s.n === n) {
        return { ...s, state, sentAt: state === "sent" ? sentAt : s.sentAt };
      }
      return late > 0 && s.n > n && s.state === "planned" ? { ...s, dueAt: s.dueAt + late } : s;
    }),
  };
}

/** The park choices: 2 weeks, 1 month, 3 months from today. */
export function parkChoices(now: number): {
  readonly weeks2: number;
  readonly month1: number;
  readonly months3: number;
} {
  const at = (add: (d: Date) => void): number => {
    const d = new Date(midnight(now));
    add(d);
    return d.getTime();
  };
  // Jan 31 plus a month is Feb 28 or 29, not March 3.
  const months = (d: Date, add: number): void => {
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + add);
    d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  };
  return {
    weeks2: at((d) => {
      d.setDate(d.getDate() + 14);
    }),
    month1: at((d) => {
      months(d, 1);
    }),
    months3: at((d) => {
      months(d, 3);
    }),
  };
}
