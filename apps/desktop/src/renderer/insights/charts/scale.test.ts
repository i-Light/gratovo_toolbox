import { describe, expect, it } from "vitest";

import { niceTicks, scaleLinear, sqrtRadius } from "./scale";

describe("niceTicks", () => {
  it("gives round numbers that cover the range", () => {
    const t = niceTicks(0, 47, 4);
    expect(t[0]).toBe(0);
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(47);
    expect(t).toEqual([0, 20, 40, 60]);
    // Two ticks over 0 to 47 step by 25, as the Emails mockup shows.
    expect(niceTicks(0, 47, 2)).toEqual([0, 25, 50]);
  });

  it("handles small and large ranges", () => {
    expect(niceTicks(0, 4, 4)).toEqual([0, 1, 2, 3, 4]);
    expect(niceTicks(0, 150200, 4)).toEqual([0, 50000, 100000, 150000, 200000]);
    expect(niceTicks(0, 0.9, 3)).toEqual([0, 0.5, 1]);
  });

  it("never returns fewer than two ticks", () => {
    expect(niceTicks(0, 0, 4)).toEqual([0, 1]);
    expect(niceTicks(5, 5, 4).length).toBeGreaterThanOrEqual(2);
    expect(niceTicks(Number.NaN, 3, 4)).toEqual([0, 1]);
  });
});

describe("sqrtRadius", () => {
  it("stays between the bounds", () => {
    expect(sqrtRadius(0, 100, 10, 50)).toBe(10);
    expect(sqrtRadius(100, 100, 10, 50)).toBe(50);
    expect(sqrtRadius(500, 100, 10, 50)).toBe(50);
    expect(sqrtRadius(5, 0, 10, 50)).toBe(10);
  });

  it("keeps small groups visible next to huge ones", () => {
    const big = sqrtRadius(150200, 150200, 14, 56);
    const small = sqrtRadius(16, 150200, 14, 56);
    expect(big).toBe(56);
    expect(small).toBeGreaterThanOrEqual(14);
    expect(small).toBeLessThan(16);
    expect(big / small).toBeLessThan(5);
  });

  it("grows with the square root", () => {
    const quarter = sqrtRadius(25, 100, 0, 100);
    expect(quarter).toBeCloseTo(50);
  });
});

describe("scaleLinear", () => {
  it("maps a domain onto a range, also reversed", () => {
    expect(scaleLinear(0, 10, 0, 100)(5)).toBe(50);
    expect(scaleLinear(0, 10, 100, 0)(2)).toBe(80);
  });
  it("maps a flat domain to the middle", () => {
    expect(scaleLinear(3, 3, 0, 10)(3)).toBe(5);
  });
});
