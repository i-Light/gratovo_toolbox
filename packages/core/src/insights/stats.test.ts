import { describe, expect, it } from "vitest";
import {
  compareRates,
  median,
  rateOf,
  rateVerdict,
  reportWindow,
  startOfDay,
  startOfWeek,
  workingDays,
} from "./stats";

const L = (y: number, m: number, d: number, h = 0, min = 0) =>
  new Date(y, m - 1, d, h, min).getTime();

describe("rateOf", () => {
  it("divides, and has no value for none counted", () => {
    expect(rateOf({ n: 1, d: 4 })).toBe(0.25);
    expect(rateOf({ n: 0, d: 0 })).toBeNull();
  });
});

describe("compareRates", () => {
  it("is clear at 90% for 28/410 against 31/720", () => {
    expect(compareRates({ n: 28, d: 410 }, { n: 31, d: 720 }, 50)).toBe("clear");
    expect(compareRates({ n: 31, d: 720 }, { n: 28, d: 410 }, 50)).toBe("clear");
  });
  it("is chance for 9/182 against 10/176", () => {
    expect(compareRates({ n: 9, d: 182 }, { n: 10, d: 176 }, 50)).toBe("chance");
  });
  it("is early when either side is under min", () => {
    expect(compareRates({ n: 5, d: 10 }, { n: 1, d: 500 }, 50)).toBe("early");
    expect(compareRates({ n: 1, d: 500 }, { n: 5, d: 49 }, 50)).toBe("early");
  });
  it("is chance when both rates are equal or zero", () => {
    expect(compareRates({ n: 0, d: 100 }, { n: 0, d: 100 }, 20)).toBe("chance");
    expect(compareRates({ n: 5, d: 100 }, { n: 5, d: 100 }, 20)).toBe("chance");
  });
});

describe("median", () => {
  it("handles odd, even and empty", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(median([7])).toBe(7);
  });
  it("does not change its input", () => {
    const xs = [3, 1, 2];
    median(xs);
    expect(xs).toEqual([3, 1, 2]);
  });
});

describe("startOfDay and startOfWeek", () => {
  it("finds midnight and Monday", () => {
    expect(startOfDay(L(2026, 10, 28, 15, 30))).toBe(L(2026, 10, 28));
    // 2026-10-28 is a Wednesday.
    expect(startOfWeek(L(2026, 10, 28, 15))).toBe(L(2026, 10, 26));
    expect(startOfWeek(L(2026, 10, 25, 9))).toBe(L(2026, 10, 19)); // Sunday
    expect(startOfWeek(L(2026, 10, 26))).toBe(L(2026, 10, 26)); // Monday
  });
});

describe("workingDays", () => {
  it("counts Monday to Friday days that start in the span", () => {
    expect(workingDays({ from: L(2026, 10, 26), to: L(2026, 11, 2) })).toBe(5);
    // Saturday and Sunday only.
    expect(workingDays({ from: L(2026, 10, 24), to: L(2026, 10, 26) })).toBe(0);
    // Friday 23:00 to Monday 01:00: only Monday starts inside.
    expect(workingDays({ from: L(2026, 10, 30, 23), to: L(2026, 11, 2, 1) })).toBe(1);
    expect(workingDays({ from: 5, to: 5 })).toBe(0);
  });
});

describe("reportWindow", () => {
  const now = L(2026, 10, 28, 14);
  it("7d, 30d and 90d end at now and look back whole days", () => {
    const w = reportWindow("7d", now);
    expect(w.current).toEqual({ from: L(2026, 10, 21, 14), to: now });
    expect(w.previous).toEqual({ from: L(2026, 10, 14, 14), to: L(2026, 10, 21, 14) });
    expect(reportWindow("30d", now).current.from).toBe(L(2026, 9, 28, 14));
    const w90 = reportWindow("90d", now);
    expect(w90.current.from).toBe(L(2026, 7, 30, 14));
    expect(w90.previous).toEqual({ from: L(2026, 5, 1, 14), to: L(2026, 7, 30, 14) });
  });
  it("month runs from the 1st to now, against the whole month before", () => {
    const w = reportWindow("month", now);
    expect(w.current).toEqual({ from: L(2026, 10, 1), to: now });
    expect(w.previous).toEqual({ from: L(2026, 9, 1), to: L(2026, 10, 1) });
    expect(w.workingDays).toBe(20);
  });
  it("month on the 1st at midnight has at least 1 working day", () => {
    const first = L(2026, 11, 1); // a Sunday
    const w = reportWindow("month", first);
    expect(w.current).toEqual({ from: first, to: first });
    expect(w.workingDays).toBe(1);
    expect(w.previous).toEqual({ from: L(2026, 10, 1), to: first });
  });
  it("month in January looks back to December", () => {
    const w = reportWindow("month", L(2026, 1, 15));
    expect(w.previous).toEqual({ from: L(2025, 12, 1), to: L(2026, 1, 1) });
  });
  it("keeps the time of day across the clock changes", () => {
    // Around the spring and autumn changes in the US and Europe.
    for (const at of [
      L(2026, 3, 10, 10),
      L(2026, 3, 31, 10),
      L(2026, 10, 28, 10),
      L(2026, 11, 5, 10),
    ]) {
      const w = reportWindow("7d", at);
      expect(new Date(w.current.from).getHours()).toBe(10);
      expect(new Date(w.previous.from).getHours()).toBe(10);
    }
  });
  it("counts working days over a weekend", () => {
    // Any 7 days hold 5 working days, whatever the hour.
    expect(reportWindow("7d", L(2026, 10, 26, 10)).workingDays).toBe(5);
    expect(reportWindow("7d", now).workingDays).toBe(5);
  });
});

describe("rateVerdict", () => {
  it("judges against the floor", () => {
    expect(rateVerdict({ n: 1, d: 10 }, 0.04, 50)).toBe("early");
    expect(rateVerdict({ n: 0, d: 0 }, 0.04, 0)).toBe("early");
    expect(rateVerdict({ n: 4, d: 100 }, 0.04, 50)).toBe("good");
    expect(rateVerdict({ n: 3, d: 100 }, 0.04, 50)).toBe("watch");
    expect(rateVerdict({ n: 2, d: 100 }, 0.04, 50)).toBe("watch");
    expect(rateVerdict({ n: 1, d: 100 }, 0.04, 50)).toBe("act");
  });
});
