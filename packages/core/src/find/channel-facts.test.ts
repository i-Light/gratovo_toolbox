import { describe, expect, it } from "vitest";

import { starRating, trimmedAverage, viewStability } from "./channel-facts";

describe("trimmedAverage", () => {
  it("is null under 3 known counts", () => {
    expect(trimmedAverage([])).toBeNull();
    expect(trimmedAverage([100, null, 200, null])).toBeNull();
  });
  it("is the plain rounded mean with 3 or 4 known", () => {
    expect(trimmedAverage([100, 200, 301])).toBe(200);
    expect(trimmedAverage([10, null, 20, 30, 1000])).toBe(265);
  });
  it("drops the highest and lowest from exactly 5 known", () => {
    expect(trimmedAverage([1, 100, 200, 300, 100000])).toBe(200);
  });
  it("reads only the newest 12 known, skipping nulls", () => {
    const views = [null, ...Array<number>(12).fill(100), 99999];
    expect(trimmedAverage(views)).toBe(100);
  });
});

describe("viewStability", () => {
  it("is null under 3 known counts", () => {
    expect(viewStability([1, null, 2])).toBeNull();
  });
  it("is stable when the spread is small", () => {
    expect(viewStability([100, 110, 90])).toBe("stable");
  });
  it("is volatile when the deviation is over half the mean", () => {
    expect(viewStability([10, 10, 1000])).toBe("volatile");
  });
  it("is stable at exactly half", () => {
    // mean 100, deviation 50
    expect(viewStability([50, 50, 150, 150])).toBe("stable");
  });
  it("reads only the newest 12 known", () => {
    expect(viewStability([...Array<number>(12).fill(100), 1_000_000])).toBe("stable");
  });
});

describe("starRating", () => {
  const base = { medianViews: 70000, engagement: 5, uploads30: 6 };
  it("gives 5 for the full set", () => {
    expect(starRating(base)).toBe(5);
    expect(starRating({ medianViews: 60000, engagement: 4.5, uploads30: 3 })).toBe(5);
    expect(starRating({ ...base, uploads30: 12 })).toBe(5);
  });
  it("falls to 4 when engagement is unknown or low, or uploads are out of range", () => {
    expect(starRating({ ...base, engagement: null })).toBe(4);
    expect(starRating({ ...base, engagement: 4.4 })).toBe(4);
    expect(starRating({ ...base, uploads30: 13 })).toBe(4);
  });
  it("gives 3 for a median of 30K up, or 45K with too few uploads", () => {
    expect(starRating({ ...base, uploads30: 2 })).toBe(3);
    expect(starRating({ medianViews: 30000, engagement: null, uploads30: 0 })).toBe(3);
  });
  it("gives 2 below that", () => {
    expect(starRating({ medianViews: 29999, engagement: 9, uploads30: 9 })).toBe(2);
  });
});
