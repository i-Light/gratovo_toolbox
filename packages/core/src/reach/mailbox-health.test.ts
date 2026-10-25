import { describe, expect, it } from "vitest";

import {
  capSteps,
  clampCap,
  effectiveCap,
  limitedCap,
  mailboxStatus,
  rateOf,
  slowedNext,
} from "./mailbox-health";

describe("rateOf", () => {
  it("gives a share in % with one decimal, and null under 10 sends", () => {
    expect(rateOf(1, 24)).toBe(4.2);
    expect(rateOf(0, 10)).toBe(0);
    expect(rateOf(3, 9)).toBeNull();
    expect(rateOf(12, 10)).toBe(100);
  });
});

describe("slowedNext", () => {
  it("slows a mailbox over 3% and keeps it slowed until under 2%", () => {
    expect(slowedNext(false, 3)).toBe(false);
    expect(slowedNext(false, 3.1)).toBe(true);
    expect(slowedNext(true, 2.5)).toBe(true);
    expect(slowedNext(true, 2)).toBe(true);
    expect(slowedNext(true, 1.9)).toBe(false);
  });

  it("changes nothing without a rate", () => {
    expect(slowedNext(true, null)).toBe(true);
    expect(slowedNext(false, null)).toBe(false);
  });
});

describe("effectiveCap and mailboxStatus", () => {
  it("holds a warming or slowed mailbox at 20", () => {
    expect(effectiveCap(40, false, false)).toBe(40);
    expect(effectiveCap(40, true, false)).toBe(limitedCap);
    expect(effectiveCap(40, false, true)).toBe(limitedCap);
    expect(effectiveCap(15, true, true)).toBe(15);
  });

  it("names the most pressing state", () => {
    const base = { signedOut: false, paused: false, slowed: false, warming: false };
    expect(mailboxStatus(base)).toBe("good");
    expect(mailboxStatus({ ...base, warming: true })).toBe("warming");
    expect(mailboxStatus({ ...base, warming: true, slowed: true })).toBe("slowed");
    expect(mailboxStatus({ ...base, slowed: true, paused: true })).toBe("paused");
    expect(mailboxStatus({ ...base, paused: true, signedOut: true })).toBe("signed_out");
  });
});

describe("the cap stepper", () => {
  it("steps by 5 between 10 and 50", () => {
    expect(capSteps(30)).toEqual({ down: 25, up: 35 });
    expect(capSteps(10)).toEqual({ down: null, up: 15 });
    expect(capSteps(50)).toEqual({ down: 45, up: null });
  });

  it("puts a cap off the steps back on them", () => {
    expect(clampCap(33)).toBe(35);
    expect(clampCap(3)).toBe(10);
    expect(clampCap(99)).toBe(50);
    expect(capSteps(12)).toEqual({ down: null, up: 15 });
  });
});
