import type { BrandFact, DealFact, InsightsInputs } from "./inputs";
import { workingDays } from "./stats";
import { thresholds } from "./thresholds";
import type { Verdict } from "./types";

/**
 * Small readings of deals and brands shared by the money goal, the alerts and the Overview's
 * revenue tile (plan step P8b). Pure. A deal's amounts are null for a viewer who doesn't see money,
 * and every function here leaves such a deal out rather than counting it as 0.
 */

export const DAY = 86_400_000;

export function daysBefore(t: number, days: number): number {
  const d = new Date(t);
  d.setDate(d.getDate() - days);
  return d.getTime();
}

/** The 1st of the month `offset` months from the one `t` falls in, 00:00 local. */
export function monthStart(t: number, offset = 0): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth() + offset, 1).getTime();
}

export function inSpan(t: number | null, from: number, to: number): t is number {
  return t !== null && t >= from && t < to;
}

/** What the agency kept of a deal: the price less the creator's payout; null when not known. */
export function netOf(d: DealFact): number | null {
  return d.price !== null && d.payout !== null ? d.price - d.payout : null;
}

const reachedPitched: ReadonlySet<BrandFact["status"]> = new Set(["pitched", "negotiating", "won"]);

/**
 * When each brand first reached "pitched" (or further): from its status events, else, with no
 * events at all, its added date when its status is past "found". Brands that never did are left out.
 */
export function pitchedTimes(inputs: InsightsInputs): Map<string, number | null> {
  const byBrand = new Map<string, number>();
  const hasEvents = new Set<string>();
  for (const e of inputs.brandEvents) {
    hasEvents.add(e.brandId);
    if (!reachedPitched.has(e.status)) continue;
    const seen = byBrand.get(e.brandId);
    if (seen === undefined || e.at < seen) byBrand.set(e.brandId, e.at);
  }
  const out = new Map<string, number | null>(byBrand);
  for (const b of inputs.brands) {
    if (out.has(b.id) || hasEvents.has(b.id)) continue;
    if (reachedPitched.has(b.status)) out.set(b.id, b.since);
  }
  return out;
}

/** Brands that reached "pitched" in `[from, to)`. */
export function pitchedIn(inputs: InsightsInputs, from: number, to: number): number {
  let n = 0;
  for (const at of pitchedTimes(inputs).values()) if (inSpan(at, from, to)) n += 1;
  return n;
}

/**
 * Of the brands that reached "pitched" in `[from, to)`, how many went on to win: their status is
 * "won", a status event says "won", or a deal was made for them after the pitch. Repeat deals from
 * brands pitched long ago are not counted: a brand is judged once, on its own pitch.
 */
export function pitchOutcomes(
  inputs: InsightsInputs,
  from: number,
  to: number,
): { readonly pitched: number; readonly won: number } {
  const status = new Map(inputs.brands.map((b) => [b.id, b.status]));
  const wonByEvent = new Set(
    inputs.brandEvents.filter((e) => e.status === "won").map((e) => e.brandId),
  );
  let pitched = 0;
  let won = 0;
  for (const [id, at] of pitchedTimes(inputs)) {
    if (!inSpan(at, from, to)) continue;
    pitched += 1;
    const dealt = inputs.deals.some(
      (d) => d.brandId === id && d.createdAt !== null && d.createdAt >= at,
    );
    if (status.get(id) === "won" || wonByEvent.has(id) || dealt) won += 1;
  }
  return { pitched, won };
}

/** Deals made in `[from, to)`. */
export function dealsMade(inputs: InsightsInputs, from: number, to: number): DealFact[] {
  return inputs.deals.filter((d) => inSpan(d.createdAt, from, to));
}

/** Deals the brand paid in `[from, to)`. */
export function dealsPaid(inputs: InsightsInputs, from: number, to: number): DealFact[] {
  return inputs.deals.filter((d) => inSpan(d.invoicePaidAt, from, to));
}

export function sum(xs: readonly (number | null)[]): number {
  let s = 0;
  for (const x of xs) if (x !== null) s += x;
  return s;
}

// ---------------------------------------------------------------------------------------------
// The basket

/** A paid basket needs at least this many deals in 90 days before one brand's share means much. */
export const basketMinDeals = 3;

/** The biggest brand's share of what brands paid in the last 90 days. */
export interface BasketShare {
  readonly brandId: string;
  readonly share: number;
  readonly total: number;
  /** Deals brands paid in the window. */
  readonly deals: number;
}

/**
 * One brand's share of the last 90 days' payments, or null with fewer than `minDeals` deals paid
 * or nothing paid. A deal with no known price is left out.
 */
export function basketShare(inputs: InsightsInputs, minDeals: number): BasketShare | null {
  const paid = dealsPaid(inputs, daysBefore(inputs.now, 90), inputs.now + 1).filter(
    (d) => d.price !== null,
  );
  if (paid.length < minDeals) return null;
  const byBrand = new Map<string, number>();
  for (const d of paid) byBrand.set(d.brandId, (byBrand.get(d.brandId) ?? 0) + (d.price ?? 0));
  const total = sum([...byBrand.values()]);
  if (!(total > 0)) return null;
  let top: [string, number] | null = null;
  for (const entry of byBrand) {
    if (top === null || entry[1] > top[1] || (entry[1] === top[1] && entry[0] < top[0]))
      top = entry;
  }
  return top === null
    ? null
    : { brandId: top[0], share: top[1] / total, total, deals: paid.length };
}

/** Early below `basketMinDeals`; Watch when the top brand's share is over `basketShare`. */
export function basketVerdict(inputs: InsightsInputs): Verdict {
  const top = basketShare(inputs, basketMinDeals);
  if (top === null) return "early";
  return top.share > thresholds.basketShare ? "watch" : "good";
}

// ---------------------------------------------------------------------------------------------
// Months

export interface PaidMonth {
  /** The 1st of the month. */
  readonly month: number;
  /** What brands paid that month (gross). */
  readonly paid: number;
  readonly net: number;
}

/** The last `count` months of brand payments, oldest first; the last is the month of `now`. */
export function paidMonths(inputs: InsightsInputs, count = 6): PaidMonth[] {
  const out: PaidMonth[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const from = monthStart(inputs.now, -i);
    const to = monthStart(inputs.now, -i + 1);
    const paid = dealsPaid(inputs, from, to);
    out.push({
      month: from,
      paid: sum(paid.map((d) => d.price)),
      net: sum(paid.map(netOf)),
    });
  }
  return out;
}

/** Working days of a month that must have started before its pace says anything. */
export const paceMinDays = 5;

/**
 * Brand payments so far this month, and where the month ends at the pace of its working days (the
 * same as the paid so far until `paceMinDays` working days have started).
 */
export function monthPace(inputs: InsightsInputs): {
  readonly month: number;
  readonly paid: number;
  readonly projected: number;
  /** Working days of the month that have started. */
  readonly elapsed: number;
} {
  const month = monthStart(inputs.now);
  const next = monthStart(inputs.now, 1);
  const paid = sum(dealsPaid(inputs, month, inputs.now + 1).map((d) => d.price));
  const elapsed = workingDays({ from: month, to: inputs.now + 1 });
  const total = workingDays({ from: month, to: next });
  // Before `paceMinDays` working days the month says nothing: it is what was paid, not a guess.
  const projected = elapsed < paceMinDays ? paid : (paid * total) / Math.max(1, elapsed);
  return { month, paid, projected: Math.max(paid, projected), elapsed };
}

/**
 * The month's pace against the goal (as brand payments), the same on Overview and Money: too early
 * without a goal or before `paceMinDays` working days; on track at or above the goal; Watch below
 * it (design section 4 rates "behind the monthly goal" as Watch).
 */
export function paceVerdict(
  pace: { readonly projected: number; readonly elapsed: number },
  goal: number | null,
): "early" | "good" | "watch" {
  if (goal === null || goal <= 0 || pace.elapsed < paceMinDays) return "early";
  return pace.projected >= goal ? "good" : "watch";
}
