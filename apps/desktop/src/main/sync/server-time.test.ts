import { describe, expect, it } from "vitest";

import { compareServerTime, parseServerTime, serverTimeMs } from "./server-time";

describe("parseServerTime", () => {
  it("keeps microseconds past the millisecond", () => {
    expect(parseServerTime("2026-10-20T09:15:00.123456+00:00")).toEqual({
      ms: Date.UTC(2026, 9, 20, 9, 15, 0, 123),
      micros: 456,
    });
  });

  it.each([
    ["2026-10-20T09:15:00Z", 0, 0],
    ["2026-10-20T09:15:00.1Z", 100, 0],
    ["2026-10-20T09:15:00.12Z", 120, 0],
    ["2026-10-20T09:15:00.123Z", 123, 0],
    ["2026-10-20T09:15:00.1234Z", 123, 400],
    ["2026-10-20T09:15:00.12345Z", 123, 450],
    ["2026-10-20T09:15:00.123456Z", 123, 456],
  ])("reads %s", (text, ms, micros) => {
    const base = Date.UTC(2026, 9, 20, 9, 15, 0);
    expect(parseServerTime(text)).toEqual({ ms: base + ms, micros });
  });

  it("reads the space-separated form and offsets", () => {
    const utc = Date.UTC(2026, 9, 20, 9, 15, 0);
    expect(parseServerTime("2026-10-20 09:15:00+00")?.ms).toBe(utc);
    expect(parseServerTime("2026-10-20 11:15:00+02:00")?.ms).toBe(utc);
    expect(parseServerTime("2026-10-20T04:45:00-04:30")?.ms).toBe(utc);
    expect(serverTimeMs("2026-10-20T09:15:00Z")).toBe(utc);
  });

  it("refuses garbage", () => {
    for (const text of [
      "",
      "yesterday",
      "2026-10-20",
      "2026-13-40T00:00:00Z",
      "2026-10-20T09:15:00",
    ]) {
      expect(parseServerTime(text)).toBeNull();
    }
    expect(serverTimeMs("nope")).toBeNull();
  });
});

describe("compareServerTime", () => {
  it("separates two times in the same millisecond", () => {
    const a = "2026-10-20T09:15:00.123456+00:00";
    const b = "2026-10-20T09:15:00.123457+00:00";
    expect(compareServerTime(a, b)).toBe(-1);
    expect(compareServerTime(b, a)).toBe(1);
    expect(compareServerTime(a, a)).toBe(0);
  });

  it("compares across offsets and forms", () => {
    expect(compareServerTime("2026-10-20T11:15:00+02:00", "2026-10-20 09:15:00.000000Z")).toBe(0);
    expect(compareServerTime("2026-10-20T09:15:01Z", "2026-10-20T11:15:00+02:00")).toBe(1);
  });

  it("sorts unparsable text first", () => {
    expect(compareServerTime("junk", "2026-10-20T09:15:00Z")).toBe(-1);
    expect(compareServerTime("2026-10-20T09:15:00Z", "junk")).toBe(1);
    expect(compareServerTime("junk", "other")).toBe(0);
  });
});
