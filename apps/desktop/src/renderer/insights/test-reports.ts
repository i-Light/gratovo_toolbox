import { brandSteps, creatorSteps } from "@gratovo/core/insights";
import type {
  Alert,
  AlertLine,
  CreatorStep,
  EmailsReport,
  FunnelReport,
  FunnelRow,
  OverviewReport,
  Ratio,
  ReportWindow,
  WinLine,
} from "@gratovo/core/insights";

/** Hand-made reports for the tab tests. Wednesday 28 Oct 2026, noon, in this computer's time. */
export const day = 86_400_000;
export const now = new Date(2026, 9, 28, 12).getTime();
const start = new Date(2026, 9, 29 - 30).getTime();

export const r = (n: number, d: number): Ratio => ({ n, d });

export const window30: ReportWindow = {
  period: "30d",
  now,
  current: { from: start, to: now },
  previous: { from: start - 30 * day, to: start },
  workingDays: 21,
};

const counts: Readonly<Record<CreatorStep, number>> = {
  found: 162_400,
  passed: 20_800,
  shortlisted: 1_480,
  confirmed: 1_260,
  emailed: 1_202,
  replied: 96,
  interested: 54,
  kit: 38,
  audience: 22,
  signed: 16,
  firstDeal: 11,
  firstPayout: 9,
};

export function funnelRows(over: Partial<Record<CreatorStep, number>> = {}): FunnelRow[] {
  const c = { ...counts, ...over };
  return creatorSteps.map((step, i) => {
    const above = i === 0 ? null : c[creatorSteps[i - 1] ?? "found"];
    return {
      step,
      count: c[step],
      fromPrev: above === null ? null : r(c[step], above),
      before: above === null ? null : r(Math.round(c[step] * 0.95), above),
      medianDays: i < 2 ? null : 1.2 + i,
      stuck: i < 2 ? null : step === "confirmed" ? 24 : step === "signed" ? 0 : 3,
      byDesign: step === "passed",
    };
  });
}

export const allZero: Partial<Record<CreatorStep, number>> = {
  found: 0,
  passed: 0,
  shortlisted: 0,
  confirmed: 0,
  emailed: 0,
  replied: 0,
  interested: 0,
  kit: 0,
  audience: 0,
  signed: 0,
  firstDeal: 0,
  firstPayout: 0,
};

const alertLine = (
  alert: Alert,
  verdict: "act" | "watch",
  key: string,
  go: AlertLine["go"],
): AlertLine => ({ key, verdict, alert, go });

export const fullAlerts: AlertLine[] = [
  alertLine(
    { kind: "mailboxBounces", mailbox: "outreach3@gratovo.co", bounced: r(3, 61) },
    "act",
    "mailboxBounces:outreach3@gratovo.co",
    { kind: "route", screen: "reach", tab: "mailboxes" },
  ),
  alertLine({ kind: "fuelLow", ready: 58, days: 2.6, waitingConfirm: 24 }, "watch", "fuelLow", {
    kind: "drill",
    drill: { kind: "fuel" },
  }),
  alertLine({ kind: "roomUnused", used: r(182, 375) }, "watch", "roomUnused", {
    kind: "route",
    screen: "reach",
    tab: "mailboxes",
  }),
  alertLine(
    { kind: "keywordWeak", keyword: "ai news weekly", replied: r(2, 180), others: r(74, 1000) },
    "watch",
    "keywordWeak:ai news weekly",
    { kind: "insights", tab: "search", view: "live" },
  ),
  alertLine(
    { kind: "stepShort", step: "firstEmails", perDay: 14, needed: 17 },
    "watch",
    "stepShort:firstEmails",
    { kind: "insights", tab: "goal", view: null },
  ),
  alertLine({ kind: "noSearch", days: 9, fuelDays: 3.2 }, "watch", "noSearch", {
    kind: "route",
    screen: "find",
    tab: null,
  }),
  alertLine({ kind: "backlogGrowing", count: 340, days: 8 }, "watch", "backlogGrowing", {
    kind: "drill",
    drill: { kind: "live", group: "notReviewed" },
  }),
  alertLine({ kind: "unreadable", count: r(120, 2000) }, "watch", "unreadable", {
    kind: "drill",
    drill: { kind: "unreadable", which: "notRead" },
  }),
];

/** One alert of every kind, for the words tests. */
export const everyAlert: Alert[] = [
  { kind: "mailboxBounces", mailbox: "outreach3@gratovo.co", bounced: r(3, 61) },
  { kind: "repliesFell", batch: 22, rate: r(2, 50), usual: r(5, 50) },
  { kind: "fuelLow", ready: 58, days: 2.6, waitingConfirm: 24 },
  { kind: "repliesFalling", batches: 3 },
  { kind: "roomUnused", used: r(182, 375) },
  { kind: "keywordWeak", keyword: "ai news weekly", replied: r(2, 180), others: r(74, 1000) },
  { kind: "keywordWornOut", keyword: "ai tools", known: r(90, 100) },
  { kind: "stepShort", step: "replied", perDay: 1.4, needed: 2.2 },
  { kind: "noSearch", days: 9, fuelDays: 3.2 },
  { kind: "backlogGrowing", count: 340, days: 8 },
  { kind: "reFindsArchive", keyword: "ai news", archived: r(40, 100) },
  { kind: "mistakesLeaving", count: 9 },
  { kind: "rejectsTooStrict", reason: "views", back: 12, replied: 5 },
  { kind: "unreadable", count: r(120, 2000) },
  { kind: "auditFailing", check: "top", failed: r(9, 16) },
];

export const fullWins: WinLine[] = [
  {
    result: "clear",
    win: { kind: "edited", edited: r(28, 410), asWritten: r(31, 720) },
    go: null,
  },
  {
    result: "clear",
    win: { kind: "keyword", keyword: "local llm setup", replied: r(11, 98), signed: 3 },
    go: { kind: "insights", tab: "search", view: "live" },
  },
  {
    result: "good",
    win: { kind: "followUp", step: 2, share: r(25, 100), rate: r(52, 1000) },
    go: null,
  },
];

const trend = (values: number[]): { at: number; value: number }[] =>
  values.map((value, i) => ({ at: start + i * day, value }));

export const overviewReport: OverviewReport = {
  tab: "overview",
  window: window30,
  summary: [
    { kind: "sent", sent: 182, change: 6, onPace: true },
    { kind: "replies", replied: 9, rate: r(9, 182), signed: 1 },
    { kind: "needs", alerts: fullAlerts.slice(0, 2) },
  ],
  vitals: {
    emails: {
      sent: 182,
      before: 176,
      firstEmails: 110,
      firstPerDay: 22,
      neededPerDay: 17,
      verdict: "good",
      trend: trend([20, 25, 22, 30, 28]),
    },
    replyRate: {
      now: r(9, 182),
      before: r(10, 175),
      difference: "chance",
      verdict: "good",
      trend: trend([3, 5, 4, 6, 5]),
    },
    signedPer1000: { now: r(1, 182), ninety: r(14, 3100), verdict: "early" },
    fuel: { ready: 58, firstPerDay: 22, days: 2.6, waitingConfirm: 24, verdict: "watch" },
    revenue: null,
    repliesWaiting: { count: 4, oldestAt: now - 3 * day, verdict: "watch" },
  },
  attention: fullAlerts,
  hidden: 1,
  wins: fullWins,
  pipeline: funnelRows(),
  biggestDrop: "replied",
};

export const emptyOverview: OverviewReport = {
  ...overviewReport,
  summary: [{ kind: "quiet" }],
  vitals: {
    ...overviewReport.vitals,
    emails: { ...overviewReport.vitals.emails, sent: 0, firstEmails: 0, trend: [] },
  },
  attention: [],
  hidden: 0,
  wins: [],
  pipeline: funnelRows(allZero),
  biggestDrop: null,
};

export const funnelReport: FunnelReport = {
  tab: "funnel",
  window: window30,
  everyone: funnelRows(),
  cohort: funnelRows({
    found: 1202,
    passed: 1202,
    shortlisted: 1202,
    confirmed: 1202,
    replied: 60,
  }),
  biggestDrop: "replied",
  exits: {
    triage: [
      { reason: "views", count: 5700 },
      { reason: "ai", count: 9000 },
      { reason: "posting", count: 2800 },
      { reason: "audience", count: 1300 },
    ],
    saidNo: [
      { kind: "notNow", count: 17 },
      { kind: "notInterested", count: 15 },
      { kind: "manager", count: 9 },
      { kind: "money", count: 1 },
    ],
    audience: [
      { check: "top", count: 9 },
      { check: "engagement", count: 4 },
      { check: "age", count: 2 },
      { check: "rate", count: 1 },
    ],
    noAnswer: 1020,
    stillInSequence: 86,
    bounced: 38,
  },
  stepDays: [
    { from: "found", to: "shortlisted", days: 1.2 },
    { from: "shortlisted", to: "confirmed", days: 1.4 },
    { from: "confirmed", to: "emailed", days: 2 },
    { from: "emailed", to: "replied", days: 6 },
    { from: "replied", to: "kit", days: 21 },
    { from: "kit", to: "signed", days: null },
  ],
  cohorts: [
    { week: new Date(2026, 9, 19).getTime(), emailed: 147, by: [r(3, 147), null, null, null] },
    {
      week: new Date(2026, 9, 12).getTime(),
      emailed: 158,
      by: [r(3, 158), r(6, 158), null, null],
    },
    {
      week: new Date(2026, 8, 28).getTime(),
      emailed: 155,
      by: [r(4, 155), r(7, 155), r(11, 155), r(13, 155)],
    },
  ],
  cohortTrend: "chance",
  brands: {
    rows: brandSteps.map((step, i) => {
      const counts = [140, 62, 48, 19, 12, 9, 7, 6];
      const count = counts[i] ?? 0;
      const above = i === 0 ? null : (counts[i - 1] ?? 0);
      return {
        step,
        count,
        fromPrev: above === null ? null : r(count, above),
        before: above === null ? null : r(Math.round(count * 0.95), above),
        medianDays: i < 2 ? null : 3 + i,
        stuck: i < 2 ? null : step === "replied" ? 3 : 0,
      };
    }),
    biggestDrop: "qualified",
    lost: [
      { step: "qualified", count: 4 },
      { step: "pitched", count: 2 },
    ],
  },
};

const days30 = Array.from({ length: 30 }, (_, i) => {
  const at = new Date(2026, 9, 29 - 30 + i).getTime();
  const weekend = [0, 6].includes(new Date(at).getDay());
  return { at, sent: weekend ? 4 : 28, replies: weekend ? 0 : 2 };
});

export const emailsReport: EmailsReport = {
  tab: "emails",
  window: window30,
  daily: days30,
  sent: 726,
  rate: r(35, 726),
  rateBefore: r(40, 700),
  rateVerdict: "good",
  bySteps: [
    { step: 0, rate: r(59, 1130), share: r(59, 131) },
    { step: 1, rate: r(30, 820), share: r(30, 131) },
    { step: 2, rate: r(36, 640), share: r(36, 131) },
    { step: 3, rate: r(9, 510), share: r(9, 131) },
  ],
  readings: [
    { kind: "interested", count: 46 },
    { kind: "question", count: 21 },
    { kind: "rate", count: 14 },
    { kind: "notNow", count: 17 },
    { kind: "no", count: 15 },
    { kind: "manager", count: 9 },
    { kind: "auto", count: 9 },
  ],
  positive: r(81, 131),
  batches: [
    {
      index: 22,
      from: new Date(2026, 9, 14).getTime(),
      to: new Date(2026, 9, 20).getTime(),
      sent: 50,
      bounced: 3,
      replied: 2,
      positive: 1,
      signed: 0,
      diagnosis: "delivery",
      bounceMailbox: "outreach3@gratovo.co",
    },
    {
      index: 21,
      from: new Date(2026, 9, 8).getTime(),
      to: new Date(2026, 9, 14).getTime(),
      sent: 50,
      bounced: 0,
      replied: 1,
      positive: 1,
      signed: 0,
      diagnosis: "writing",
      bounceMailbox: null,
    },
    {
      index: 20,
      from: new Date(2026, 9, 1).getTime(),
      to: new Date(2026, 9, 8).getTime(),
      sent: 50,
      bounced: 1,
      replied: 4,
      positive: 3,
      signed: 1,
      diagnosis: "healthy",
      bounceMailbox: null,
    },
    {
      index: 23,
      from: new Date(2026, 9, 20).getTime(),
      to: now,
      sent: 31,
      bounced: 1,
      replied: 1,
      positive: 1,
      signed: 0,
      diagnosis: "early",
      bounceMailbox: null,
    },
  ],
  patterns: [
    {
      kind: "edited",
      groups: [
        { key: "edited", rate: r(28, 410) },
        { key: "asWritten", rate: r(31, 720) },
      ],
      result: "clear",
      best: "edited",
    },
    {
      kind: "weekday",
      groups: [
        { key: "tue", rate: r(20, 400) },
        { key: "mon", rate: r(19, 410) },
      ],
      result: "chance",
      best: null,
    },
  ],
  answer: { medianHours: 5.2, overDay: 3, verdict: "good" },
  mailboxes: [
    {
      address: "outreach1@gratovo.co",
      warmupDay: null,
      warmupDays: null,
      heldAt: null,
      sent: 92,
      room: 175,
      bounced: r(1, 92),
      replies: r(26, 420),
      verdict: "good",
    },
    {
      address: "outreach2@gratovo.co",
      warmupDay: 9,
      warmupDays: 14,
      heldAt: null,
      sent: 29,
      room: 75,
      bounced: r(0, 29),
      replies: r(1, 15),
      verdict: "early",
    },
    {
      address: "outreach3@gratovo.co",
      warmupDay: null,
      warmupDays: null,
      heldAt: 20,
      sent: 61,
      room: 100,
      bounced: r(3, 61),
      replies: r(8, 200),
      verdict: "act",
    },
  ],
  capacity: r(182, 350),
};

export const emptyEmails: EmailsReport = {
  ...emailsReport,
  daily: days30.map((d) => ({ ...d, sent: 0, replies: 0 })),
  sent: 0,
  rate: r(0, 0),
  rateBefore: r(0, 0),
  rateVerdict: "early",
  bySteps: [],
  readings: [],
  positive: r(0, 0),
  batches: [],
  patterns: [],
  answer: { medianHours: null, overDay: 0, verdict: "early" },
  mailboxes: [],
  capacity: r(0, 0),
};

export const emptyFunnel: FunnelReport = {
  ...funnelReport,
  everyone: funnelRows(allZero),
  cohort: funnelRows(allZero),
  biggestDrop: null,
};
