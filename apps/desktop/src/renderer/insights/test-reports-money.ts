import type {
  Alert,
  AlertLine,
  GoalReport,
  MoneyReport,
  OverviewReport,
} from "@gratovo/core/insights";

import { namesFrom } from "./words/names";
import { goalReport } from "./test-reports-search";
import { day, now, overviewReport, r, window30 } from "./test-reports";

/** The Money mockup's October: 27 days in, on pace for $21,100 against a goal of $25,000 paid. */
const month = (m: number): number => new Date(2026, m, 1).getTime();

export const moneyReport: MoneyReport = {
  tab: "money",
  window: window30,
  names: {},
  months: [
    { month: month(4), paid: 9_800, net: 3_900, projected: null },
    { month: month(5), paid: 14_200, net: 5_700, projected: null },
    { month: month(6), paid: 18_100, net: 7_200, projected: null },
    { month: month(7), paid: 21_600, net: 8_600, projected: null },
    { month: month(8), paid: 24_900, net: 9_900, projected: null },
    { month: month(9), paid: 18_400, net: 7_300, projected: 21_100 },
  ],
  goalPaid: 25_000,
  goalNet: 10_000,
  usualMargin: 0.4,
  paceVerdict: "watch",
  owed: {
    buckets: [
      { bucket: "notDue", amount: 9_600, count: 3 },
      { bucket: "late30", amount: 3_100, count: 1 },
      { bucket: "late60", amount: 4_200, count: 1 },
      { bucket: "over60", amount: 0, count: 0 },
    ],
    late: [
      { dealId: "d1", amount: 4_200, daysLate: 34 },
      { dealId: "d2", amount: 3_100, daysLate: 12 },
    ],
    payDays: [
      { brandId: "b1", days: 21, unpaid: false },
      { brandId: "b2", days: 28, unpaid: false },
      { brandId: "b3", days: null, unpaid: true },
    ],
    verdict: "act",
  },
  payouts: {
    due: [{ dealId: "d3", amount: 1_860, brandPaidAt: now - 3 * day }],
    dueTotal: 1_860,
    locked: 5_480,
    lockedCount: 4,
  },
  margin: {
    average: 0.4,
    floor: 0.25,
    under: [{ dealId: "d2", margin: 0.22 }],
    verdict: "watch",
  },
  dealSize: { average: 3_100, before: 2_600, per1000: 34, trend: [] },
  basket: {
    brand: { id: "b1", share: 0.46 },
    creator: { id: "c1", share: 0.31 },
    verdict: "watch",
  },
  roster: [
    {
      creatorId: "c1",
      deals: 4,
      revenue: 13_200,
      lastDealAt: now - 19 * day,
      signedAt: null,
      delivered: 1.24,
      idle: false,
    },
    {
      creatorId: "c2",
      deals: 3,
      revenue: 8_900,
      lastDealAt: now - 26 * day,
      signedAt: null,
      delivered: 1.31,
      idle: false,
    },
    {
      creatorId: "c3",
      deals: 0,
      revenue: 0,
      lastDealAt: null,
      signedAt: now - 74 * day,
      delivered: null,
      idle: true,
    },
  ],
  deliveredAverage: 1.18,
  steps: Array.from({ length: 10 }, (_, step) => ({
    step,
    medianDays: [6, 4, 3, 5, 1, 2, 1, 30, 3, 12][step] ?? null,
    stuck: step === 3 ? 2 : 0,
  })),
  stuckDeals: [
    { dealId: "d4", step: 3, days: 11, usual: 5 },
    { dealId: "d5", step: 3, days: 9, usual: 5 },
  ],
  repeat: { came: r(4, 9), noNext: ["d3", "d4"] },
};

export const emptyMoney: MoneyReport = {
  ...moneyReport,
  months: moneyReport.months.map((m) => ({
    ...m,
    paid: 0,
    net: 0,
    projected: m.projected === null ? null : 0,
  })),
  goalPaid: null,
  goalNet: null,
  usualMargin: null,
  owed: {
    ...moneyReport.owed,
    buckets: moneyReport.owed.buckets.map((b) => ({ ...b, amount: 0, count: 0 })),
    late: [],
    payDays: [],
  },
  payouts: { due: [], dueTotal: 0, locked: 0, lockedCount: 0 },
  margin: { ...moneyReport.margin, average: null, under: [] },
  dealSize: { average: null, before: null, per1000: null, trend: [] },
  basket: { brand: null, creator: null, verdict: "early" },
  roster: [],
  deliveredAverage: null,
  stuckDeals: [],
  repeat: { came: r(0, 0), noNext: [] },
};

export const names = namesFrom(
  {
    brands: [
      { id: "b1", name: "Draftly AI" },
      { id: "b2", name: "Tensorly" },
      { id: "b3", name: "VoxNote" },
    ],
    creators: [
      { id: "c1", name: "Cyber Sage" },
      { id: "c2", name: "LLM Lab" },
      { id: "c3", name: "Byte Sized AI" },
    ],
    deals: [
      { id: "d1", brand: "b3", creator: "c1" },
      { id: "d2", brand: "b2", creator: "c3" },
      { id: "d3", brand: "b2", creator: "c2" },
      { id: "d4", brand: "b1", creator: "c1" },
      { id: "d5", brand: "b1", creator: "c2" },
    ],
  } as never,
  now,
);

/** The Overview for a money viewer: this month's payments in the fifth tile. */
export const moneyOverview: OverviewReport = {
  ...overviewReport,
  vitals: {
    ...overviewReport.vitals,
    revenue: {
      month: month(9),
      paid: 7_360,
      projected: 8_450,
      goal: 10_000,
      verdict: "watch",
      trend: [],
    },
  },
};

/** One alert of each money kind. */
export const moneyAlerts: Alert[] = [
  { kind: "invoiceLate", dealId: "d1", days: 34, amount: 4_200 },
  { kind: "payoutDue", dealId: "d3", amount: 1_860, since: now - 3 * day },
  { kind: "dealStuck", dealId: "d4", step: 3, days: 11, usual: 5 },
  { kind: "behindGoal", projected: 21_100, goal: 25_000 },
  { kind: "basket", brandId: "b1", share: 0.46 },
  { kind: "idleCreator", creatorId: "c3", days: 74 },
  { kind: "marginLow", dealId: "d2", margin: 0.22, floor: 0.25 },
];

export const moneyAlertLines: AlertLine[] = moneyAlerts.map((alert, i) => ({
  key: `${alert.kind}:${String(i)}`,
  verdict: i < 2 ? "act" : "watch",
  alert,
  go: { kind: "insights", tab: "money", view: null },
}));

/** The Goal for a money viewer: the money lines on top of the chain. */
export function moneyGoalReport(): GoalReport {
  const base = goalReport();
  const top = base.lines[0];
  return {
    ...base,
    settings: { ...base.settings, revenuePerMonth: 10_000 },
    lines: [
      {
        step: "revenue",
        month: 10_000,
        rate: null,
        perDay: null,
        actualPerDay: null,
        actualMonth: 8_400,
        verdict: "watch",
        shortBy: null,
      },
      {
        step: "bookings",
        month: 25_000,
        rate: { value: 0.4, source: "yours", count: r(40, 100) },
        perDay: null,
        actualPerDay: null,
        actualMonth: 21_100,
        verdict: "watch",
        shortBy: null,
      },
      {
        step: "deals",
        month: 8,
        rate: { value: 3_100, source: "yours", count: r(9, 9) },
        perDay: null,
        actualPerDay: null,
        actualMonth: 6,
        verdict: "watch",
        shortBy: null,
      },
      {
        step: "pitches",
        month: 48,
        rate: { value: 0.19, source: "yours", count: r(9, 48) },
        perDay: 2.2,
        actualPerDay: 1.4,
        actualMonth: null,
        verdict: "act",
        shortBy: 0.8,
      },
      ...(top === undefined
        ? []
        : [{ ...top, rate: { value: 0.5, source: "yours" as const, count: null } }]),
      ...base.lines.slice(1),
    ],
    levers: [
      ...base.levers,
      { kind: "dealSize", from: 3_100, to: 3_600, emailsFrom: 17, emailsTo: 14 },
    ],
  };
}
