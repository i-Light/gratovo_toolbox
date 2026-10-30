import { DEAL_FLOW } from "../deal-flow";

import type { DealFact, InsightsInputs } from "./inputs";
import {
  basketVerdict,
  inSpan,
  monthPace,
  monthStart,
  paceMinDays,
  paceVerdict,
  sum,
} from "./deal-facts";
import { goalAsPaid, moneyPlan } from "./goal";
import { median } from "./stats";
import { thresholds } from "./thresholds";
import type { MoneyMonth, MoneyReport, OwedBucket, Point, ReportWindow, Verdict } from "./types";

/**
 * The Money tab (design 3.5, plan P8b): what brands paid, what is owed to us and by us, margin,
 * deal size, the basket, the roster, where deals slow down and repeat business. Pure; facts and
 * keys only. Revenue is what brands paid, counted on the invoice's paid date (B2). The small
 * predicates below are exported because the drill-downs (`report.ts`) list the records with the
 * very same code that counts the numbers (A4).
 */

const DAY = 86_400_000;

type Money = MoneyReport;

const mean = (xs: readonly number[]): number | null => (xs.length > 0 ? sum(xs) / xs.length : null);

// ---------------------------------------------------------------------------------------------
// Predicates (shared with the drills)

/** When an invoice is due: its own date, else the day it was sent plus the terms. */
function dueAt(d: DealFact): number | null {
  if (d.invoiceDueAt !== null) return d.invoiceDueAt;
  return d.invoiceSentAt === null ? null : d.invoiceSentAt + thresholds.netDays * DAY;
}

/** Whole days past due for a sent, unpaid invoice; 0 or less when not late; null when not unpaid. */
function daysLate(d: DealFact, now: number): number | null {
  if (d.invoiceSentAt === null || d.invoicePaidAt !== null) return null;
  const due = dueAt(d);
  return due === null ? null : Math.floor((now - due) / DAY);
}

function isUnpaid(d: DealFact): boolean {
  return d.invoiceSentAt !== null && d.invoicePaidAt === null;
}

/** Deals whose invoice is past due, most days late first. */
export function lateInvoiceDeals(inputs: InsightsInputs): { deal: DealFact; days: number }[] {
  const out: { deal: DealFact; days: number }[] = [];
  for (const deal of inputs.deals) {
    const days = daysLate(deal, inputs.now);
    if (days !== null && days >= 1) out.push({ deal, days });
  }
  return out.sort((a, b) => b.days - a.days || a.deal.id.localeCompare(b.deal.id));
}

/** Deals the brand paid and the creator hasn't been paid for, oldest payment first. */
export function payoutDueDeals(inputs: InsightsInputs): DealFact[] {
  return inputs.deals
    .filter((d) => d.invoicePaidAt !== null && d.paidCreatorAt === null && d.payout !== null)
    .sort((a, b) => (a.invoicePaidAt ?? 0) - (b.invoicePaidAt ?? 0) || a.id.localeCompare(b.id));
}

function margin(d: DealFact): number | null {
  return d.price !== null && d.price > 0 && d.payout !== null
    ? (d.price - d.payout) / d.price
    : null;
}

/** Deals made in the last 90 days that have a margin. */
function marginDeals(inputs: InsightsInputs): { deal: DealFact; margin: number }[] {
  const from = inputs.now - 90 * DAY;
  const out: { deal: DealFact; margin: number }[] = [];
  for (const deal of inputs.deals) {
    const m = margin(deal);
    if (m !== null && inSpan(deal.createdAt, from, inputs.now + 1)) out.push({ deal, margin: m });
  }
  return out;
}

/** Deals under the margin floor, made in the last 90 days, lowest margin first. */
export function underFloorDeals(inputs: InsightsInputs): { deal: DealFact; margin: number }[] {
  const floor = inputs.marginFloorPct / 100;
  return marginDeals(inputs)
    .filter((x) => x.margin < floor)
    .sort((a, b) => a.margin - b.margin || a.deal.id.localeCompare(b.deal.id));
}

/** Per deal, its step changes in time order. */
function eventsByDeal(inputs: InsightsInputs): Map<string, { step: number; at: number }[]> {
  const map = new Map<string, { step: number; at: number }[]>();
  for (const e of inputs.dealEvents) {
    const list = map.get(e.dealId);
    if (list) list.push({ step: e.step, at: e.at });
    else map.set(e.dealId, [{ step: e.step, at: e.at }]);
  }
  for (const list of map.values()) list.sort((a, b) => a.at - b.at);
  return map;
}

/** The usual days at each deal step (null under `minForMedian` stays), from consecutive events. */
export function dealStepMedians(inputs: InsightsInputs): (number | null)[] {
  const stays: number[][] = DEAL_FLOW.map(() => []);
  for (const list of eventsByDeal(inputs).values()) {
    for (let i = 0; i + 1 < list.length; i += 1) {
      const a = list[i];
      const b = list[i + 1];
      if (!a || !b) continue;
      stays[a.step]?.push((b.at - a.at) / DAY);
    }
  }
  return stays.map((s) => (s.length >= thresholds.minForMedian ? median(s) : null));
}

/** Deals now at a step for more than `stuckFactor` times the usual days there, longest first. */
export function stuckDealRows(
  inputs: InsightsInputs,
): { dealId: string; step: number; days: number; usual: number }[] {
  const medians = dealStepMedians(inputs);
  const events = eventsByDeal(inputs);
  const out: { dealId: string; step: number; days: number; usual: number }[] = [];
  for (const deal of inputs.deals) {
    const usual = medians[deal.step] ?? null;
    if (usual === null) continue;
    const list = events.get(deal.id) ?? [];
    let since: number | null = null;
    for (const e of list) if (e.step === deal.step) since = e.at;
    if (since === null) continue;
    const days = (inputs.now - since) / DAY;
    if (days > thresholds.stuckFactor * usual)
      out.push({ dealId: deal.id, step: deal.step, days, usual });
  }
  return out.sort((a, b) => b.days - a.days || a.dealId.localeCompare(b.dealId));
}

export interface RosterRow {
  readonly creatorId: string;
  readonly deals: number;
  readonly revenue: number;
  readonly lastDealAt: number | null;
  readonly signedAt: number | null;
  readonly delivered: number | null;
  readonly idle: boolean;
}

/** Every signed creator and anyone with a deal, most revenue first. */
export function rosterRows(inputs: InsightsInputs): RosterRow[] {
  const signedIds = new Set(inputs.channels.filter((c) => c.stage === "signed").map((c) => c.id));
  const signedAt = new Map<string, number>();
  for (const e of inputs.events) {
    if (e.stage !== "signed") continue;
    const seen = signedAt.get(e.channelId);
    if (seen === undefined || e.at < seen) signedAt.set(e.channelId, e.at);
  }
  const byCreator = new Map<string, DealFact[]>();
  for (const d of inputs.deals) {
    const list = byCreator.get(d.creatorId);
    if (list) list.push(d);
    else byCreator.set(d.creatorId, [d]);
  }
  const ids = new Set<string>([...signedIds, ...byCreator.keys()]);
  const rows: RosterRow[] = [];
  for (const id of ids) {
    const deals = byCreator.get(id) ?? [];
    let lastDealAt: number | null = null;
    for (const d of deals) {
      if (d.createdAt !== null && (lastDealAt === null || d.createdAt > lastDealAt)) {
        lastDealAt = d.createdAt;
      }
    }
    const signed = signedAt.get(id) ?? null;
    const ratios = deals
      .filter((d) => d.reportViews !== null && d.usualViews !== null && d.usualViews > 0)
      .map((d) => (d.reportViews ?? 0) / (d.usualViews ?? 1));
    const reference = lastDealAt ?? signed;
    rows.push({
      creatorId: id,
      deals: deals.length,
      revenue: sum(deals.filter((d) => d.invoicePaidAt !== null).map((d) => d.price ?? 0)),
      lastDealAt,
      signedAt: signed,
      delivered: mean(ratios),
      idle:
        signedIds.has(id) &&
        (reference === null || inputs.now - reference > thresholds.idleDays * DAY),
    });
  }
  return rows.sort(
    (a, b) => b.revenue - a.revenue || b.deals - a.deals || a.creatorId.localeCompare(b.creatorId),
  );
}

/** Signed creators with no deal in `idleDays` (counted from signing when they have none). */
export function idleCreatorIds(inputs: InsightsInputs): string[] {
  return rosterRows(inputs)
    .filter((r) => r.idle)
    .map((r) => r.creatorId);
}

/** Deals with a finished 30-day report whose brand has no newer deal. */
export function noNextDeals(inputs: InsightsInputs): DealFact[] {
  const out: DealFact[] = [];
  for (const d of inputs.deals) {
    const sent = d.reportSentAt;
    if (sent === null) continue;
    const newer = inputs.deals.some(
      (o) => o.brandId === d.brandId && o.createdAt !== null && o.createdAt > sent,
    );
    if (!newer) out.push(d);
  }
  return out.sort(
    (a, b) => (a.reportSentAt ?? 0) - (b.reportSentAt ?? 0) || a.id.localeCompare(b.id),
  );
}

// ---------------------------------------------------------------------------------------------
// The report

function bucketOf(days: number): OwedBucket {
  if (days <= 0) return "notDue";
  if (days <= 30) return "late30";
  if (days <= 60) return "late60";
  return "over60";
}

function emptyMoney(window: ReportWindow, inputs: InsightsInputs): Money {
  const months: MoneyMonth[] = [];
  for (let k = -5; k <= 0; k += 1) {
    months.push({ month: monthStart(inputs.now, k), paid: 0, net: 0, projected: null });
  }
  return {
    tab: "money",
    window,
    names: {},
    months,
    goalPaid: null,
    goalNet: null,
    usualMargin: null,
    paceVerdict: "early",
    owed: {
      buckets: (["notDue", "late30", "late60", "over60"] as const).map((bucket) => ({
        bucket,
        amount: 0,
        count: 0,
      })),
      late: [],
      payDays: [],
      verdict: "early",
    },
    payouts: { due: [], dueTotal: 0, locked: 0, lockedCount: 0 },
    margin: { average: null, floor: inputs.marginFloorPct / 100, under: [], verdict: "early" },
    dealSize: {
      average: null,
      before: null,
      per1000: null,
      trend: months.map((m) => ({ at: m.month, value: null })),
    },
    basket: { brand: null, creator: null, verdict: "early" },
    roster: [],
    deliveredAverage: null,
    steps: DEAL_FLOW.map((_, step) => ({ step, medianDays: null, stuck: 0 })),
    stuckDeals: [],
    repeat: { came: { n: 0, d: 0 }, noNext: [] },
  };
}

function topShare(
  deals: readonly DealFact[],
  key: (d: DealFact) => string,
): { id: string; share: number } | null {
  const totals = new Map<string, number>();
  let all = 0;
  for (const d of deals) {
    const price = d.price ?? 0;
    all += price;
    totals.set(key(d), (totals.get(key(d)) ?? 0) + price);
  }
  if (!(all > 0)) return null;
  let best: { id: string; total: number } | null = null;
  for (const [id, total] of totals) {
    if (best === null || total > best.total || (total === best.total && id < best.id)) {
      best = { id, total };
    }
  }
  return best === null ? null : { id: best.id, share: best.total / all };
}

export function moneyReport(inputs: InsightsInputs, window: ReportWindow): MoneyReport {
  if (!inputs.seesMoney) return emptyMoney(window, inputs);
  const { now, deals } = inputs;
  const last90 = now - 90 * DAY;

  // Revenue by month.
  const months: MoneyMonth[] = [];
  for (let k = -5; k <= 0; k += 1) {
    const from = monthStart(now, k);
    const to = monthStart(now, k + 1);
    const paidDeals = deals.filter((d) => inSpan(d.invoicePaidAt, from, to));
    const paid = sum(paidDeals.map((d) => d.price ?? 0));
    const net = sum(paidDeals.map((d) => (d.price ?? 0) - (d.payout ?? 0)));
    // The current month's end at this pace: the same figure the Overview's revenue tile shows.
    // Nothing is projected while the month is too young for its pace to say anything.
    const pace = monthPace(inputs);
    const projected = k === 0 && pace.elapsed >= paceMinDays ? pace.projected : null;
    months.push({ month: from, paid, net, projected });
  }

  // The goal, as brand payments.
  const goalNet = inputs.goal.revenuePerMonth;
  const recentPaid = deals.filter(
    (d) => inSpan(d.invoicePaidAt, last90, now + 1) && d.price !== null,
  );
  const recentGross = sum(recentPaid.map((d) => d.price ?? 0));
  const recentNet = sum(recentPaid.map((d) => (d.price ?? 0) - (d.payout ?? 0)));
  // The goal as brand payments comes from the Goal tab's own margin, so both tabs agree.
  const plan = moneyPlan(inputs);
  const usualMargin =
    plan?.rates.margin.value ?? (recentGross > 0 ? recentNet / recentGross : null);
  const goalPaid = goalAsPaid(inputs);
  const pace: Verdict = paceVerdict(monthPace(inputs), goalPaid);

  // Owed to us.
  const bucketAmounts: Record<OwedBucket, { amount: number; count: number }> = {
    notDue: { amount: 0, count: 0 },
    late30: { amount: 0, count: 0 },
    late60: { amount: 0, count: 0 },
    over60: { amount: 0, count: 0 },
  };
  for (const d of deals) {
    const days = daysLate(d, now);
    if (days === null) continue;
    const b = bucketAmounts[bucketOf(days)];
    b.amount += d.price ?? 0;
    b.count += 1;
  }
  const late = lateInvoiceDeals(inputs);
  const paidDays = new Map<string, number[]>();
  const lateBrands = new Set(late.map((x) => x.deal.brandId));
  for (const d of deals) {
    // An invoice paid before it was sent is a wrong date: it says nothing about how fast they pay.
    if (d.invoiceSentAt === null || d.invoicePaidAt === null || d.invoicePaidAt < d.invoiceSentAt) {
      continue;
    }
    const list = paidDays.get(d.brandId);
    const days = (d.invoicePaidAt - d.invoiceSentAt) / DAY;
    if (list) list.push(days);
    else paidDays.set(d.brandId, [days]);
  }
  const payDays: Money["owed"]["payDays"][number][] = [];
  for (const [brandId, list] of paidDays) {
    payDays.push({ brandId, days: median(list), unpaid: false });
  }
  for (const brandId of lateBrands) {
    if (!paidDays.has(brandId)) payDays.push({ brandId, days: null, unpaid: true });
  }
  payDays.sort(
    (a, b) =>
      Number(a.unpaid) - Number(b.unpaid) ||
      (a.days ?? 0) - (b.days ?? 0) ||
      a.brandId.localeCompare(b.brandId),
  );
  const worst = late[0]?.days ?? 0;
  const owedVerdict: Verdict =
    worst > thresholds.invoiceAct ? "act" : late.length > 0 ? "watch" : "good";

  // Owed by us.
  const due = payoutDueDeals(inputs);
  const locked = deals.filter(isUnpaid);

  // Margin.
  const withMargin = marginDeals(inputs);
  const under = underFloorDeals(inputs);
  const avgMargin = mean(withMargin.map((x) => x.margin));

  // Deal size.
  const priced = (from: number, to: number): number[] =>
    deals.filter((d) => d.price !== null && inSpan(d.createdAt, from, to)).map((d) => d.price ?? 0);
  const perThousand = deals
    .filter(
      (d) =>
        d.price !== null &&
        d.usualViews !== null &&
        d.usualViews > 0 &&
        inSpan(d.createdAt, last90, now + 1),
    )
    .map((d) => (d.price ?? 0) / ((d.usualViews ?? 1) / 1000));
  const trend: Point[] = months.map((m, k) => ({
    at: m.month,
    value: mean(priced(m.month, monthStart(now, k - 4))),
  }));

  // The basket.
  const basketDeals = deals.filter((d) => inSpan(d.invoicePaidAt, last90, now + 1));
  const topBrand = topShare(basketDeals, (d) => d.brandId);
  const topCreator = topShare(basketDeals, (d) => d.creatorId);

  // The roster and what the videos delivered.
  const roster = rosterRows(inputs);
  const reported = deals
    .filter((d) => d.reportViews !== null && d.usualViews !== null && d.usualViews > 0)
    .map((d) => (d.reportViews ?? 0) / (d.usualViews ?? 1));

  // Where deals slow down.
  const medians = dealStepMedians(inputs);
  const stuckDeals = stuckDealRows(inputs);

  // Repeat business.
  const perBrand = new Map<string, number>();
  for (const d of deals) perBrand.set(d.brandId, (perBrand.get(d.brandId) ?? 0) + 1);

  const mentioned = new Set<string>();
  const dealById = new Map(deals.map((d) => [d.id, d]));
  const mention = (...ids: (string | null | undefined)[]): void => {
    for (const x of ids) if (x) mentioned.add(x);
  };
  const mentionDeal = (dealId: string): void => {
    const d = dealById.get(dealId);
    if (d) mention(d.brandId, d.creatorId);
  };
  for (const r of roster) mention(r.creatorId);
  for (const x of late.slice(0, 10)) mentionDeal(x.deal.id);
  for (const x of payDays) mention(x.brandId);
  for (const x of due) mentionDeal(x.id);
  for (const x of under) mentionDeal(x.deal.id);
  for (const x of stuckDeals) mentionDeal(x.dealId);
  mention(topBrand?.id, topCreator?.id);
  const noNext = noNextDeals(inputs);
  for (const d of noNext) mentionDeal(d.id);
  const known = new Map<string, string>();
  for (const c of inputs.channels) known.set(c.id, c.name);
  for (const b of inputs.brands) known.set(b.id, b.name);
  const names: Record<string, string> = {};
  for (const x of mentioned) {
    const n = known.get(x);
    if (n !== undefined) names[x] = n;
  }

  return {
    tab: "money",
    window,
    names,
    months,
    goalPaid,
    goalNet,
    usualMargin,
    paceVerdict: pace,
    owed: {
      buckets: (["notDue", "late30", "late60", "over60"] as const).map((bucket) => ({
        bucket,
        amount: bucketAmounts[bucket].amount,
        count: bucketAmounts[bucket].count,
      })),
      late: late.slice(0, 10).map((x) => ({
        dealId: x.deal.id,
        amount: x.deal.price ?? 0,
        daysLate: x.days,
      })),
      payDays,
      verdict: owedVerdict,
    },
    payouts: {
      due: due.map((d) => ({
        dealId: d.id,
        amount: d.payout ?? 0,
        brandPaidAt: d.invoicePaidAt ?? 0,
      })),
      dueTotal: sum(due.map((d) => d.payout ?? 0)),
      locked: sum(locked.map((d) => d.payout ?? 0)),
      lockedCount: locked.length,
    },
    margin: {
      average: avgMargin,
      floor: inputs.marginFloorPct / 100,
      under: under.map((x) => ({ dealId: x.deal.id, margin: x.margin })),
      verdict: withMargin.length === 0 ? "early" : under.length > 0 ? "watch" : "good",
    },
    dealSize: {
      average: mean(priced(last90, now + 1)),
      before: mean(priced(now - 180 * DAY, last90)),
      per1000: mean(perThousand),
      trend,
    },
    basket: { brand: topBrand, creator: topCreator, verdict: basketVerdict(inputs) },
    roster,
    deliveredAverage: mean(reported),
    steps: DEAL_FLOW.map((_, step) => ({
      step,
      medianDays: medians[step] ?? null,
      stuck: stuckDeals.filter((s) => s.step === step).length,
    })),
    stuckDeals,
    repeat: {
      came: {
        n: [...perBrand.values()].filter((n) => n >= 2).length,
        d: perBrand.size,
      },
      noNext: noNext.map((d) => d.id),
    },
  };
}
