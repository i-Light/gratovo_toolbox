import { describe, expect, it } from "vitest";

import {
  countryZones,
  mondayAt9,
  morningIn,
  sendLaterLeadMs,
  theirMorning,
  tomorrowAt9,
  zoneOf,
} from "./send-later";

const hour = 3_600_000;

/** The wall clock in a zone, as "YYYY-MM-DD HH:mm". */
function wall(zone: string, at: number): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);
}

describe("zoneOf", () => {
  it("gives a country's zone, in any case, and null for an unknown one", () => {
    expect(zoneOf("US")).toBe("America/New_York");
    expect(zoneOf(" gb ")).toBe("Europe/London");
    expect(zoneOf("XX")).toBeNull();
    expect(zoneOf(null)).toBeNull();
    expect(zoneOf("toString")).toBeNull();
  });

  it("lists only zones the runtime knows", () => {
    for (const zone of Object.values(countryZones)) {
      expect(() => new Intl.DateTimeFormat("en-US", { timeZone: zone })).not.toThrow();
    }
  });
});

describe("morningIn", () => {
  it("gives today's 09:00 there when it is far enough ahead", () => {
    // 2026-01-15 06:00 in New York (UTC-5).
    const now = Date.UTC(2026, 0, 15, 11, 0);
    const at = morningIn("America/New_York", now);
    expect(at).toBe(Date.UTC(2026, 0, 15, 14, 0));
  });

  it("moves to tomorrow once 09:00 there is past or too near", () => {
    // 08:50 in New York: 09:00 is 10 minutes off, under the lead.
    const now = Date.UTC(2026, 0, 15, 13, 50);
    expect(morningIn("America/New_York", now)).toBe(Date.UTC(2026, 0, 16, 14, 0));
    expect((morningIn("America/New_York", now) ?? 0) - now).toBeGreaterThan(sendLaterLeadMs);
  });

  it("follows summer time and half-hour zones", () => {
    // July: New York is UTC-4.
    expect(morningIn("America/New_York", Date.UTC(2026, 6, 1, 10, 0))).toBe(
      Date.UTC(2026, 6, 1, 13, 0),
    );
    // India is UTC+5:30: 09:00 there is 03:30 UTC.
    expect(morningIn("Asia/Kolkata", Date.UTC(2026, 6, 1, 0, 0))).toBe(Date.UTC(2026, 6, 1, 3, 30));
  });

  it("lands on 09:00 there across a clock change", () => {
    // The night New York moves to summer time (2026-03-08).
    const now = Date.UTC(2026, 2, 8, 5, 0);
    const at = morningIn("America/New_York", now);
    expect(at === null ? null : wall("America/New_York", at)).toBe("2026-03-08 09:00");
  });

  it("gives null for a zone the runtime doesn't know", () => {
    expect(morningIn("Mars/Olympus_Mons", Date.UTC(2026, 0, 1))).toBeNull();
  });
});

describe("tomorrowAt9 and mondayAt9", () => {
  it("gives 09:00 tomorrow, local", () => {
    const now = new Date(2026, 9, 25, 22, 30).getTime();
    expect(tomorrowAt9(now)).toBe(new Date(2026, 9, 26, 9, 0).getTime());
  });

  it("gives next Monday, and a week on from a Monday", () => {
    // 2026-10-25 is a Sunday.
    expect(mondayAt9(new Date(2026, 9, 25, 12).getTime())).toBe(new Date(2026, 9, 26, 9).getTime());
    // A Monday morning before 09:00 still goes a week on.
    expect(mondayAt9(new Date(2026, 9, 26, 7).getTime())).toBe(new Date(2026, 10, 2, 9).getTime());
    expect(mondayAt9(new Date(2026, 9, 31, 12).getTime())).toBe(new Date(2026, 10, 2, 9).getTime());
  });
});

describe("theirMorning", () => {
  it("uses their zone when known", () => {
    const now = Date.UTC(2026, 0, 15, 11, 0);
    expect(theirMorning("America/New_York", now)).toEqual({
      at: Date.UTC(2026, 0, 15, 14, 0),
      theirs: true,
    });
  });

  it("falls back to the sender's next 09:00 without a zone", () => {
    const early = new Date(2026, 9, 26, 7, 0).getTime();
    expect(theirMorning(null, early)).toEqual({
      at: new Date(2026, 9, 26, 9, 0).getTime(),
      theirs: false,
    });
    const late = new Date(2026, 9, 26, 8, 50).getTime();
    expect(theirMorning(null, late).at).toBe(new Date(2026, 9, 27, 9, 0).getTime());
    expect(theirMorning("Mars/Olympus_Mons", late).theirs).toBe(false);
    expect(theirMorning(null, late).at - late).toBeGreaterThan(hour);
  });
});
