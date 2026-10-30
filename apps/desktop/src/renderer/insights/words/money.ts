import { DEAL_FLOW } from "@gratovo/core";
import type { MoneyReport } from "@gratovo/core/insights";

import { ago, money } from "../../lib/format";
import { strings } from "../../strings";
import { dayLabel, decimal, moneyShort, monthName, num, pct } from "./format";
import type { Names } from "./names";
import type { Run } from "./overview";

const t = strings.insights.money;
const fmt = strings.insights.overview.fmt;
const day = 86_400_000;

type RosterRow = MoneyReport["roster"][number];

/** "a, b and c". */
export function listJoin(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1] ?? ""}`;
}

/** True when there is no money story yet: nothing paid, owed or due, and nobody signed. */
export function moneyIsEmpty(report: MoneyReport): boolean {
  return (
    report.months.every((m) => m.paid === 0) &&
    report.owed.buckets.every((b) => b.count === 0) &&
    report.payouts.due.length === 0 &&
    report.roster.length === 0
  );
}

export function dealStepName(step: number): string {
  return DEAL_FLOW[step]?.name ?? fmt.dash;
}

// ---------------------------------------------------------------------------------------------
// Revenue

/** The month still running, and where it ends at this pace. */
export function currentMonth(
  report: MoneyReport,
): { month: number; paid: number; projected: number | null } | null {
  const cur = report.months[report.months.length - 1];
  return cur === undefined ? null : { month: cur.month, paid: cur.paid, projected: cur.projected };
}

export function revenueHeadline(report: MoneyReport): string {
  const cur = currentMonth(report);
  if (cur === null || report.months.every((m) => m.paid === 0 && (m.projected ?? 0) === 0)) {
    return t.revenue.headlineNone;
  }
  const name = monthName(cur.month);
  // Too early for a pace: what is paid so far, with no claim about the month's end.
  if (cur.projected === null) return t.revenue.headlineEarly(name, money(cur.paid));
  if (report.goalPaid === null) return t.revenue.headlineNoGoal(name, money(cur.projected));
  return cur.projected >= report.goalPaid
    ? t.revenue.headlineOver(name, money(cur.projected), money(report.goalPaid))
    : t.revenue.headlineUnder(name, money(cur.projected), money(report.goalPaid));
}

/** The line under the chart: how the months went and where this one is. */
export function revenueSummary(report: MoneyReport): Run[] {
  const cur = currentMonth(report);
  const past = report.months.slice(0, -1).filter((m) => m.paid > 0);
  const first = past[0];
  const last = past[past.length - 1];
  const out: Run[] = [];
  if (first !== undefined && last !== undefined && first !== last) {
    const grew = past.every((m, i) => i === 0 || m.paid > (past[i - 1]?.paid ?? 0));
    const make = grew ? t.revenue.grew : t.revenue.was;
    out.push({
      text: make(
        monthName(first.month),
        money(first.paid),
        monthName(last.month),
        money(last.paid),
      ),
    });
  }
  if (cur !== null) {
    const days = Math.max(1, Math.floor((report.window.now - cur.month) / day));
    out.push(
      { text: t.revenue.at(monthName(cur.month)) },
      { text: money(cur.paid), bold: true },
      { text: t.revenue.after(fmt.daysLong(num(days))) },
    );
  }
  return out;
}

/** "goal $25K (net $10K at 40%)", or null without a money goal. */
export function goalLabel(report: MoneyReport): string | null {
  if (report.goalPaid === null) return null;
  if (report.goalNet === null || report.usualMargin === null) {
    return t.revenue.goalLabelPlain(moneyShort(report.goalPaid));
  }
  return t.revenue.goalLabel(
    moneyShort(report.goalPaid),
    moneyShort(report.goalNet),
    pct(report.usualMargin),
  );
}

// ---------------------------------------------------------------------------------------------
// Owed and payouts

/** Late money, and the part of it over 30 days. */
export function lateTotals(report: MoneyReport): { late: number; over30: number } {
  let late = 0;
  let over30 = 0;
  for (const b of report.owed.buckets) {
    if (b.bucket === "notDue") continue;
    late += b.amount;
    if (b.bucket !== "late30") over30 += b.amount;
  }
  return { late, over30 };
}

export function owedHeadline(report: MoneyReport): string {
  const { late, over30 } = lateTotals(report);
  if (late <= 0) return t.owed.headlineNone;
  return over30 > 0
    ? t.owed.headline(money(late), money(over30))
    : t.owed.headlineLate(money(late));
}

/** The most brands the pay-in sentence names; the rest are "and N more". */
const payDaysShown = 4;

/** "Brands usually pay in: Draftly AI 21 days, Tensorly 28. VoxNote has not paid at all yet." */
export function payDaysSentence(report: MoneyReport, names: Names): string {
  const withDays = report.owed.payDays.filter((p) => p.days !== null && !p.unpaid);
  const unpaid = report.owed.payDays.filter((p) => p.unpaid);
  // Brands with a late invoice first, then the fastest (the report lists the fastest first).
  const lateBrands = new Set(report.owed.late.map((l) => names.dealBrand(l.dealId)));
  const ordered = [
    ...withDays.filter((p) => lateBrands.has(names.brand(p.brandId))),
    ...withDays.filter((p) => !lateBrands.has(names.brand(p.brandId))),
  ];
  const shown = ordered.slice(0, payDaysShown);
  const parts: string[] = [];
  if (shown.length > 0) {
    const more = ordered.length - shown.length;
    const list = shown
      .map((p, i) => t.owed.payIn(names.brand(p.brandId), num(p.days ?? 0), i === 0))
      .join(", ");
    parts.push(t.owed.usually(more > 0 ? `${list}, ${t.owed.andMore(String(more))}` : list));
  }
  if (unpaid.length > 0) {
    parts.push(`${unpaid.map((p) => t.owed.notPaid(names.brand(p.brandId))).join(". ")}.`);
  }
  return parts.length === 0 ? t.owed.noPayData : parts.join(" ");
}

export interface PayoutWords {
  readonly headline: string;
  readonly context: string;
  /** The creator to pay when one creator is due; null otherwise. */
  readonly creator: string | null;
}

export function payoutWords(report: MoneyReport, names: Names): PayoutWords {
  const due = report.payouts.due;
  const first = due[0];
  if (first === undefined) {
    return { headline: t.payouts.headlineNone, context: t.payouts.noneContext, creator: null };
  }
  const creators = [...new Set(due.map((d) => names.dealCreator(d.dealId)))];
  const total = money(report.payouts.dueTotal);
  if (creators.length === 1) {
    const creator = creators[0] ?? "";
    return {
      headline: t.payouts.headlineOne(creator, total),
      context: t.payouts.dueContext(
        names.dealBrand(first.dealId),
        ago(first.brandPaidAt, names.now),
      ),
      creator,
    };
  }
  return {
    headline: t.payouts.headlineMany(total, num(creators.length)),
    context: t.payouts.dueContextMany(num(due.length)),
    creator: null,
  };
}

// ---------------------------------------------------------------------------------------------
// Margin, deal size, basket

export function marginHeadline(report: MoneyReport): string {
  const avg = report.margin.average;
  return avg === null ? t.margin.headlineNone : t.margin.headline(pct(avg));
}

export function sizeHeadline(report: MoneyReport): string {
  const { average, before } = report.dealSize;
  if (average === null) return t.size.headlineNone;
  if (before === null) return t.size.headlineFirst;
  return average > before
    ? t.size.headlineUp
    : average < before
      ? t.size.headlineDown
      : t.size.headlineSame;
}

export function sizeSentence(report: MoneyReport): string {
  const { average, before, per1000 } = report.dealSize;
  if (average === null) return "";
  const first =
    before === null
      ? t.size.noBefore
      : average > before
        ? t.size.up(money(before))
        : average < before
          ? t.size.down(money(before))
          : t.size.same(money(before));
  return per1000 === null ? first : `${first}${t.size.per1000(money(per1000))}`;
}

export function basketHeadline(report: MoneyReport): string {
  const brand = report.basket.brand;
  return brand === null ? t.basket.headlineNone : t.basket.headline(pct(brand.share));
}

export function basketSentence(report: MoneyReport, names: Names): string {
  const { brand, creator } = report.basket;
  if (brand === null) return "";
  const first = t.basket.brand(names.brand(brand.id));
  return creator === null
    ? first
    : `${first}${t.basket.creator(names.creator(creator.id), pct(creator.share))}`;
}

// ---------------------------------------------------------------------------------------------
// Roster, steps, repeat

/** The days since a creator's last deal (or signing), or null when neither is known. */
export function idleDays(row: RosterRow, now: number): number | null {
  const at = row.lastDealAt ?? row.signedAt;
  return at === null ? null : Math.max(0, Math.floor((now - at) / day));
}

export function rosterHeadline(report: MoneyReport, names: Names): string {
  const top = report.roster.find((r) => r.revenue > 0);
  const idle = report.roster.find((r) => r.idle);
  const days = idle === undefined ? null : idleDays(idle, report.window.now);
  const idleName = idle === undefined ? null : names.creator(idle.creatorId);
  const topName = top === undefined ? null : names.creator(top.creatorId);
  if (topName !== null && idleName !== null && days !== null) {
    return t.roster.headlineBoth(topName, idleName, fmt.daysLong(num(days)));
  }
  if (topName !== null) return t.roster.headlineTop(topName);
  if (idleName !== null && days !== null) {
    return t.roster.headlineIdle(idleName, fmt.daysLong(num(days)));
  }
  return t.roster.headlineNone;
}

export function rosterMeaning(report: MoneyReport, names: Names): string {
  const avg = report.deliveredAverage;
  if (avg === null) return t.roster.noReports;
  const base = avg >= 1 ? t.roster.deliveredStrong(pct(avg)) : t.roster.delivered(pct(avg));
  const lowest = report.roster
    .filter((r) => r.delivered !== null)
    .reduce<RosterRow | null>(
      (a, r) => (a === null || (r.delivered ?? 1) < (a.delivered ?? 1) ? r : a),
      null,
    );
  return lowest !== null && (lowest.delivered ?? 1) < 0.8
    ? `${base}${t.roster.lowest(names.creator(lowest.creatorId), pct(lowest.delivered ?? 0))}`
    : base;
}

export function lastDealText(row: RosterRow): string {
  if (row.lastDealAt !== null) return dayLabel(row.lastDealAt);
  return row.signedAt === null ? fmt.dash : t.roster.signed(dayLabel(row.signedAt));
}

/** The step with the most stuck deals, and how many are stuck there. */
export function topStuck(report: MoneyReport): { step: number; count: number } | null {
  const counts = new Map<number, number>();
  for (const d of report.stuckDeals) counts.set(d.step, (counts.get(d.step) ?? 0) + 1);
  let best: { step: number; count: number } | null = null;
  for (const [step, count] of counts) {
    if (best === null || count > best.count) best = { step, count };
  }
  return best;
}

export function stepsHeadline(report: MoneyReport): string {
  const top = topStuck(report);
  if (top === null) return t.steps.headlineNone;
  const name = dealStepName(top.step);
  const all = report.stuckDeals.length;
  if (all > top.count) return t.steps.headlineSpread(num(all), num(top.count), name);
  return top.count === 1 ? t.steps.headlineOne(name) : t.steps.headlineMany(num(top.count), name);
}

export function stepsMeaning(report: MoneyReport): string {
  const top = topStuck(report);
  const here = report.stuckDeals.filter((d) => d.step === top?.step);
  const first = here[0];
  if (top === null || first === undefined) return t.steps.long.trim();
  const list = here.map((d) => num(d.days));
  const days = list.length === 1 && list[0] === "1" ? "1 day" : `${listJoin(list)} days`;
  return `${t.steps.waited(dealStepName(top.step), days, decimal(first.usual))}${t.steps.long}`;
}

export function repeatHeadline(report: MoneyReport): string {
  const { n, d } = report.repeat.came;
  return d === 0 ? t.repeat.headlineNone : t.repeat.headline(num(n), num(d));
}

export function repeatSentence(report: MoneyReport, names: Names): string {
  const ids = report.repeat.noNext;
  if (ids.length === 0) return t.repeat.allProposed;
  if (ids.length > 3) return t.repeat.noNextMore(num(ids.length));
  return t.repeat.noNext(num(ids.length), listJoin(ids.map((id) => names.deal(id))));
}
