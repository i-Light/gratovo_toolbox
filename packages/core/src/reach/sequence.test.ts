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
      { n: 1, dueAt: sent + 3 * day, state: "planned", sentAt: null },
      { n: 2, dueAt: sent + 7 * day, state: "planned", sentAt: null },
      { n: 3, dueAt: sent + 14 * day, state: "planned", sentAt: null },
    ]);
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

  it("finishes 7 days after the last step went", () => {
    const last = sent + 14 * day;
    expect(isFinished(allSent(last), last + 7 * day - 1)).toBe(false);
    expect(isFinished(allSent(last), last + 7 * day)).toBe(true);
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
    expect(resumed(s).stopped).toBeNull();
    expect(resumed(sequence({ stopped: "replied" })).stopped).toBe("replied");
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

describe("parkChoices", () => {
  it("gives local midnights 2 weeks, 1 month and 3 months on", () => {
    const now = new Date(2026, 9, 25, 14, 0).getTime();
    expect(parkChoices(now)).toEqual({
      weeks2: new Date(2026, 10, 8).getTime(),
      month1: new Date(2026, 10, 25).getTime(),
      months3: new Date(2027, 0, 25).getTime(),
    });
  });
});
