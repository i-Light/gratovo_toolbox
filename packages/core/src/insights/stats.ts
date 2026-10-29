import { thresholds } from "./thresholds";
import type { Difference, Period, Ratio, ReportWindow, Span, Verdict } from "./types";

/**
 * The maths under every Insights number (design rules 2, 3 and 5). Pure and defensive: bad input
 * gives null or "early", never a throw. Days are counted with local calendar arithmetic, so a week
 * with a clock change still has 7 days.
 */

/** The value of a ratio, or null when nothing was counted. */
export function rateOf(r: Ratio): number | null {
  return Number.isFinite(r.n) && Number.isFinite(r.d) && r.d > 0 ? r.n / r.d : null;
}

/** The standard normal's cumulative share below `z` (Abramowitz and Stegun 7.1.26). */
function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly =
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  const erf = 1 - poly * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/**
 * Two-proportion z-test (pooled, two-sided). "early" when either group has fewer than `min`;
 * "clear" when p is under 1 - confidence; otherwise "chance".
 */
export function compareRates(a: Ratio, b: Ratio, min: number): Difference {
  if (!(a.d >= min) || !(b.d >= min) || a.d <= 0 || b.d <= 0) return "early";
  const pooled = (a.n + b.n) / (a.d + b.d);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / a.d + 1 / b.d));
  if (!(se > 0)) return "chance";
  const z = (a.n / a.d - b.n / b.d) / se;
  const p = 2 * (1 - normalCdf(Math.abs(z)));
  return p < 1 - thresholds.confidence ? "clear" : "chance";
}

/** The middle value; the mean of the two middle ones for an even count; null when empty. */
export function median(xs: readonly number[]): number | null {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? (v[mid] ?? 0) : ((v[mid - 1] ?? 0) + (v[mid] ?? 0)) / 2;
}

/** Midnight (local) at the start of the day `t` falls in. */
export function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Monday 00:00 (local) of the week `t` falls in. */
export function startOfWeek(t: number): number {
  const d = new Date(startOfDay(t));
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

/**
 * Monday to Friday days that start inside the span (local midnight in `[from, to)`), so a 7-day
 * window holds 5 whatever the hour. An empty span has none.
 */
export function workingDays(span: Span): number {
  if (!(span.to > span.from)) return 0;
  let count = 0;
  const d = new Date(startOfDay(span.from));
  if (d.getTime() < span.from) d.setDate(d.getDate() + 1);
  while (d.getTime() < span.to) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) count += 1;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

const periodDays: Readonly<Record<Exclude<Period, "month">, number>> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

function daysBefore(t: number, days: number): number {
  const d = new Date(t);
  d.setDate(d.getDate() - days);
  return d.getTime();
}

/** The period asked for, and the span of the same length (or the whole last month) before it. */
export function reportWindow(period: Period, now: number): ReportWindow {
  let current: Span;
  let previous: Span;
  if (period === "month") {
    const d = new Date(now);
    const first = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    const before = new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime();
    current = { from: first, to: now };
    previous = { from: before, to: first };
  } else {
    const n = periodDays[period];
    const from = daysBefore(now, n);
    current = { from, to: now };
    previous = { from: daysBefore(now, 2 * n), to: from };
  }
  return { period, now, current, previous, workingDays: Math.max(1, workingDays(current)) };
}

/**
 * The verdict of a rate against its floor: "early" under `min` counted, "good" at or above the
 * floor, "act" under half of it, otherwise "watch".
 */
export function rateVerdict(r: Ratio, floor: number, min: number): Verdict {
  const rate = rateOf(r);
  if (rate === null || r.d < min) return "early";
  if (rate >= floor) return "good";
  return rate < floor / 2 ? "act" : "watch";
}
