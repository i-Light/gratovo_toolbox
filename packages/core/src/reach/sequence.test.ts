import { describe, expect, it } from "vitest";

import type { Sequence } from "../data";
import {
  dueSteps,
  isFinished,
  isRunning,
  parkChoices,
  parked,
  planSteps,
  resumed,
  stopped,
  wakeDue,
  withStep,
  woken,
} from "./sequence";

const day = 86_400_000;

/** `at` plus calendar days, as the app plans them. */
const plus = (at: number, days: number): number => {
  const d = new Date(at);
  d.setDate(d.getDate() + days);
  return d.getTime();
};

/** Runs `fn` with the machine's time zone set, then puts it back. */
function withZone(zone: string, fn: () => void): void {
  const before = process.env.TZ;
  process.env.TZ = zone;
  try {
    fn();
  } finally {
    if (before === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = before;
    }
  }
}
// Local times, so the day boundaries are the machine's, as the app's are.
const sent = new Date(2026, 9, 20, 15, 30).getTime();

const sequence = (over: Partial<Sequence> = {}): Sequence => ({
  creator: "c1",
  mailbox: "outreach1@gratovo.example",
  startedAt: sent,
  steps: planSteps(sent),
  stopped: null,
  parkUntil: null,
  ...over,
});

describe("planSteps", () => {
  it("plans follow-ups 3, 7 and 14 days after the first email", () => {
    expect(planSteps(sent)).toEqual([
      { n: 1, dueAt: plus(sent, 3), state: "planned", sentAt: null },
      { n: 2, dueAt: plus(sent, 7), state: "planned", sentAt: null },
      { n: 3, dueAt: plus(sent, 14), state: "planned", sentAt: null },
    ]);
  });
});

describe("planSteps across a clock change", () => {
  it("keeps the time of day, so the step stays on its calendar day", () => {
    withZone("Europe/Berlin", () => {
      // Clocks go back on 2026-10-25: that day has 25 hours.
      const first = new Date(2026, 9, 23, 18, 0).getTime();
      expect(planSteps(first).map((x) => x.dueAt)).toEqual([
        new Date(2026, 9, 26, 18, 0).getTime(),
        new Date(2026, 9, 30, 18, 0).getTime(),
        new Date(2026, 10, 6, 18, 0).getTime(),
      ]);
    });
    withZone("America/New_York", () => {
      // Clocks go back on 2026-11-01.
      const first = new Date(2026, 9, 30, 0, 30).getTime();
      expect(new Date(planSteps(first)[0]?.dueAt ?? 0).getDate()).toBe(2);
      expect(new Date(planSteps(first)[0]?.dueAt ?? 0).getHours()).toBe(0);
    });
  });
});

describe("dueSteps", () => {
  it("gives a step from local midnight of its day on", () => {
    const dueDay = new Date(2026, 9, 23, 0, 0).getTime();
    expect(dueSteps(sequence(), dueDay - 1)).toEqual([]);
    expect(dueSteps(sequence(), dueDay).map((s) => s.n)).toEqual([1]);
    expect(dueSteps(sequence(), sent + 8 * day).map((s) => s.n)).toEqual([1, 2]);
  });

  it("gives nothing drafted, sent or skipped, and nothing while stopped or parked", () => {
    const later = sent + 8 * day;
    expect(dueSteps(withStep(sequence(), 1, "drafted"), later).map((s) => s.n)).toEqual([2]);
    expect(dueSteps(sequence({ stopped: "you" }), later)).toEqual([]);
    expect(dueSteps(sequence({ parkUntil: later + day }), later)).toEqual([]);
    expect(isRunning(sequence({ parkUntil: later }))).toBe(false);
  });
});

describe("isFinished", () => {
  const allSent = (at: number) =>
    withStep(withStep(withStep(sequence(), 1, "sent", at), 2, "sent", at), 3, "sent", at);

  it("finishes on the local midnight 7 calendar days after the day the last step went", () => {
    const last = new Date(2026, 10, 3, 15, 30).getTime();
    const dayEight = new Date(2026, 10, 10).getTime();
    expect(isFinished(allSent(last), dayEight - 1)).toBe(false);
    expect(isFinished(allSent(last), dayEight)).toBe(true);
  });

  it("counts calendar days across a clock change", () => {
    withZone("Europe/Berlin", () => {
      const last = new Date(2026, 9, 21, 15, 30).getTime();
      const dayEight = new Date(2026, 9, 28).getTime();
      expect(isFinished(allSent(last), dayEight - 1)).toBe(false);
      expect(isFinished(allSent(last), dayEight)).toBe(true);
    });
  });

  it("counts a skipped last step from the last one sent, and never finishes a stopped one", () => {
    const s = withStep(
      withStep(withStep(sequence(), 1, "sent", sent + 3 * day), 2, "skipped"),
      3,
      "skipped",
    );
    expect(isFinished(s, sent + 10 * day)).toBe(true);
    expect(isFinished(sequence(), sent + 100 * day)).toBe(false);
    expect(isFinished({ ...allSent(sent), stopped: "replied" }, sent + 100 * day)).toBe(false);
  });
});

describe("stop, resume, park and wake", () => {
  it("stops with drafted steps back to planned, and resumes only a stop by you", () => {
    const s = stopped(withStep(sequence(), 1, "drafted"));
    expect(s.stopped).toBe("you");
    expect(s.steps[0]?.state).toBe("planned");
    expect(resumed(s, sent).stopped).toBeNull();
    expect(resumed(sequence({ stopped: "replied" }), sent).stopped).toBe("replied");
  });

  it("re-times the planned steps on resuming, unless told not to", () => {
    const s = stopped(sequence());
    const now = sent + 30 * day;
    const [a, b, c] = s.steps.map((x) => x.dueAt);
    expect(resumed(s, now).steps.map((x) => x.dueAt)).toEqual([
      now,
      now + (b ?? 0) - (a ?? 0),
      now + (c ?? 0) - (a ?? 0),
    ]);
    expect(resumed(s, null).steps).toEqual(s.steps);
    expect(woken(parked(sequence(), now), null).steps).toEqual(sequence().steps);
  });

  it("parks until local midnight, and wakes on that day", () => {
    const until = new Date(2026, 10, 3, 17, 45).getTime();
    const p = parked(withStep(sequence(), 1, "drafted"), until);
    expect(p.parkUntil).toBe(new Date(2026, 10, 3).getTime());
    expect(p.steps[0]?.state).toBe("planned");
    expect(wakeDue(p, new Date(2026, 10, 2, 23, 59).getTime())).toBe(false);
    expect(wakeDue(p, new Date(2026, 10, 3, 0, 1).getTime())).toBe(true);
    expect(wakeDue(sequence(), sent)).toBe(false);
  });

  it("moves the planned steps on waking so the first is due now, keeping the gaps", () => {
    const s = withStep(parked(sequence(), sent + 30 * day), 1, "sent", sent + 3 * day);
    const now = sent + 30 * day;
    const w = woken(s, now);
    expect(w.parkUntil).toBeNull();
    expect(w.steps.map((x) => x.dueAt)).toEqual([sent + 3 * day, now, now + 7 * day]);
  });

  it("leaves the steps alone when the first planned one is still ahead", () => {
    const s = parked(sequence(), sent + day);
    expect(woken(s, sent + day).steps).toEqual(sequence().steps);
  });
});

describe("a step sent late", () => {
  it("pushes the later planned steps so the next keeps its gap from the one before", () => {
    const sentLate = plus(sent, 10);
    const [d1, d2, d3] = planSteps(sent).map((x) => x.dueAt);
    const s = withStep(sequence(), 1, "sent", sentLate);
    expect(s.steps.map((x) => x.dueAt)).toEqual([
      d1,
      sentLate + (d2 ?? 0) - (d1 ?? 0),
      sentLate + (d3 ?? 0) - (d1 ?? 0),
    ]);
  });

  it("never moves a step earlier, and leaves earlier and drafted steps alone", () => {
    const early = withStep(sequence(), 1, "sent", plus(sent, 1));
    expect(early.steps.map((x) => x.dueAt)).toEqual(sequence().steps.map((x) => x.dueAt));
    const at = plus(sent, 10);
    const [d1, d2, d3] = planSteps(sent).map((x) => x.dueAt);
    const s = withStep(withStep(sequence(), 2, "drafted"), 1, "sent", at);
    expect(s.steps[1]?.dueAt).toBe(d2);
    expect(s.steps[2]?.dueAt).toBe(at + (d3 ?? 0) - (d1 ?? 0));
  });
});

describe("parkChoices", () => {
  it("clamps to the last day of the target month", () => {
    expect(parkChoices(new Date(2027, 0, 31, 9).getTime()).month1).toBe(
      new Date(2027, 1, 28).getTime(),
    );
    expect(parkChoices(new Date(2028, 0, 31).getTime()).month1).toBe(
      new Date(2028, 1, 29).getTime(),
    );
    expect(parkChoices(new Date(2026, 10, 30).getTime()).months3).toBe(
      new Date(2027, 1, 28).getTime(),
    );
    expect(parkChoices(new Date(2027, 10, 30).getTime()).months3).toBe(
      new Date(2028, 1, 29).getTime(),
    );
  });

  it("gives local midnights 2 weeks, 1 month and 3 months on", () => {
    const now = new Date(2026, 9, 25, 14, 0).getTime();
    expect(parkChoices(now)).toEqual({
      weeks2: new Date(2026, 10, 8).getTime(),
      month1: new Date(2026, 10, 25).getTime(),
      months3: new Date(2027, 0, 25).getTime(),
    });
  });
});
