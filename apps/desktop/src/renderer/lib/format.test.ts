import { describe, expect, it } from "vitest";

import { ago, duration, money } from "./format";

describe("duration", () => {
  it("writes minutes under an hour", () => {
    expect(duration(0)).toBe("0 min");
    expect(duration(45)).toBe("45 min");
    expect(duration(59)).toBe("59 min");
  });

  it("writes whole hours and hours with minutes", () => {
    expect(duration(60)).toBe("1 h");
    expect(duration(90)).toBe("1 h 30 min");
    expect(duration(120)).toBe("2 h");
    expect(duration(125)).toBe("2 h 5 min");
  });

  it("rounds to whole minutes first", () => {
    expect(duration(89.5)).toBe("1 h 30 min");
    expect(duration(44.4)).toBe("44 min");
    expect(duration(59.6)).toBe("1 h");
  });
});

describe("ago", () => {
  const now = Date.UTC(2026, 9, 19, 12, 0, 0);
  const before = (seconds: number): number => now - seconds * 1000;

  it("says just now under 45 seconds, and for the future", () => {
    expect(ago(before(0), now)).toBe("just now");
    expect(ago(before(44), now)).toBe("just now");
    expect(ago(now + 5000, now)).toBe("just now");
  });

  it("counts minutes from 45 seconds", () => {
    expect(ago(before(45), now)).toBe("1 min ago");
    expect(ago(before(5 * 60), now)).toBe("5 min ago");
    expect(ago(before(59 * 60), now)).toBe("59 min ago");
  });

  it("counts hours from an hour", () => {
    expect(ago(before(3600), now)).toBe("1 h ago");
    expect(ago(before(23 * 3600), now)).toBe("23 h ago");
  });

  it("says yesterday, then days", () => {
    expect(ago(before(86400), now)).toBe("yesterday");
    expect(ago(before(30 * 3600), now)).toBe("yesterday");
    expect(ago(before(3 * 86400), now)).toBe("3 days ago");
  });
});

describe("money", () => {
  it("writes dollars with thousands separators", () => {
    expect(money(0)).toBe("$0");
    expect(money(950)).toBe("$950");
    expect(money(1200)).toBe("$1,200");
    expect(money(1234567)).toBe("$1,234,567");
  });

  it("writes a negative amount with a real minus sign", () => {
    expect(money(-300)).toBe("\u2212$300");
  });

  it("rounds to whole dollars", () => {
    expect(money(1199.6)).toBe("$1,200");
    expect(money(-0.2)).toBe("$0");
  });
});
