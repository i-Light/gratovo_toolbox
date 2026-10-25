import type { MailboxStatus } from "../data/reach-types";

/**
 * A sending mailbox's health (plan step 6, D9 and D20): its caps, the slowdown rule and its
 * status. Pure; main builds each `MailboxView` with these, and the page reads the same numbers.
 */

/** The daily cap the owner can set: 10 to 50 in steps of 5 (the pipeline's bounds). */
export const capMin = 10;
export const capMax = 50;
export const capStep = 5;
/** How long warm-up lasts, from `warmupStartedOn`. */
export const warmupDays = 30;
/** The most a warming or slowed mailbox sends in a day, whatever its cap. */
export const limitedCap = 20;
/** Bounces over this share (in %) slow a mailbox down. */
export const slowAbove = 3;
/** A slowed mailbox goes back to its cap once bounces are under this share (in %). */
export const recoverBelow = 2;
/** A rate needs at least this many sends behind it; fewer give null. */
export const rateMinSends = 10;
/** The window of the bounce rate. */
export const bounceWindowMs = 7 * 86_400_000;
/** The window of the reply rate. */
export const replyWindowMs = 30 * 86_400_000;

/** `part` of `whole` in %, one decimal; null when `whole` is under `rateMinSends`. */
export function rateOf(part: number, whole: number): number | null {
  if (whole < rateMinSends) {
    return null;
  }
  return Math.round((1000 * Math.min(part, whole)) / whole) / 10;
}

/**
 * The slowdown rule: bounces over 3% slow a mailbox; a slowed one stays slowed until they are
 * under 2%. With no rate (too few sends) nothing changes.
 */
export function slowedNext(was: boolean, bounceRate: number | null): boolean {
  if (bounceRate === null) {
    return was;
  }
  return was ? bounceRate >= recoverBelow : bounceRate > slowAbove;
}

/** The cap that applies today: at most `limitedCap` while warming up or slowed. */
export function effectiveCap(dailyCap: number, warming: boolean, slowed: boolean): number {
  return warming || slowed ? Math.min(dailyCap, limitedCap) : dailyCap;
}

/** One status, the most pressing first: signed out, paused, slowed, warming, good. */
export function mailboxStatus(m: {
  readonly signedOut: boolean;
  readonly paused: boolean;
  readonly slowed: boolean;
  readonly warming: boolean;
}): MailboxStatus {
  if (m.signedOut) {
    return "signed_out";
  }
  if (m.paused) {
    return "paused";
  }
  if (m.slowed) {
    return "slowed";
  }
  return m.warming ? "warming" : "good";
}

/** A cap in bounds, on a step of 5. */
export function clampCap(cap: number): number {
  const stepped = Math.round(cap / capStep) * capStep;
  return Math.min(capMax, Math.max(capMin, stepped));
}

/** The stepper's next caps down and up; null at a bound. */
export function capSteps(cap: number): {
  readonly down: number | null;
  readonly up: number | null;
} {
  const now = clampCap(cap);
  return {
    down: now <= capMin ? null : clampCap(now - capStep),
    up: now >= capMax ? null : clampCap(now + capStep),
  };
}
