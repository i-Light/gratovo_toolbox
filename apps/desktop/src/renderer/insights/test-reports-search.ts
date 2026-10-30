import type {
  GoalLine,
  GoalReport,
  KeywordRow,
  Mistake,
  ReportWindow,
  SearchReport,
} from "@gratovo/core/insights";

/** Small hand-built reports for the Search and Goal tab tests. Wednesday 28 Oct 2026, noon. */
export const NOW = new Date(2026, 9, 28, 12).getTime();
const DAY = 86_400_000;

export const window: ReportWindow = {
  period: "30d",
  now: NOW,
  current: { from: NOW - 30 * DAY, to: NOW },
  previous: { from: NOW - 60 * DAY, to: NOW - 30 * DAY },
  workingDays: 22,
};

export function keyword(name: string, over: Partial<KeywordRow> = {}): KeywordRow {
  return {
    keyword: name,
    found: 1000,
    kept: { n: 20, d: 1000 },
    live: 100,
    emailed: 60,
    replied: 6,
    signed: 0,
    verdict: "keep",
    why: null,
    lastRun: { at: NOW - 3 * DAY, fresh: 60, live: 20, archived: 20 },
    ...over,
  };
}

export function mistake(n: number, over: Partial<Mistake> = {}): Mistake {
  return {
    id: `UC-mistake-${String(n)}`,
    name: `Mistake ${String(n)}`,
    handle: `@mistake${String(n)}`,
    reason: "views",
    fit: 95 - (n % 10),
    medianViews: 41_000,
    leavesAt: NOW + DAY,
    ...over,
  };
}

const emptyProfile = {
  medianViews: null,
  uploads30: null,
  subscribers: null,
  sponsored: null,
  inMarkets: null,
  addressFound: null,
} as const;

const weeks = (): SearchReport["weeks"] =>
  Array.from({ length: 12 }, (_, i) => ({
    at: NOW - (11 - i) * 7 * DAY,
    live: 1900 + i * 10,
    waiting: 9000 + i * 100,
    archive: 100_000 + i * 4000,
  }));

/** A full report: 2,000 live, 10,200 waiting, 150,200 archived. */
export function searchReport(over: Partial<SearchReport> = {}): SearchReport {
  const top = Array.from({ length: 12 }, (_, i) => mistake(i + 1));
  return {
    tab: "search",
    window,
    counts: { live: 2000, waiting: 10_200, archive: 150_200, everything: 162_400 },
    weeks: weeks(),
    keywords: [
      keyword("local llm setup", { found: 12_400, kept: { n: 260, d: 12_400 }, signed: 3 }),
      keyword("ai agents tutorial", { found: 18_900, kept: { n: 300, d: 18_900 }, signed: 3 }),
      keyword("cursor ai coding", { signed: 1 }),
      keyword("ai news weekly", {
        found: 38_600,
        emailed: 180,
        replied: 2,
        signed: 0,
        verdict: "drop",
        why: "noAnswers",
      }),
      keyword("ai video tools", { emailed: 22, verdict: "early", why: "tooFew", signed: 0 }),
      keyword("chatgpt tips", { verdict: "watch", why: "wornOut", signed: 0 }),
      keyword("prompt engineering"),
      keyword("rag pipelines"),
    ],
    live: {
      groups: {
        notReviewed: 340,
        shortlisted: 290,
        outreach: 1180,
        signed: 16,
        parked: 70,
        never: 104,
      },
      joinedThisWeek: 65,
      leftThisWeek: 50,
      weekly: Array.from({ length: 12 }, (_, i) => ({
        at: NOW - (11 - i) * 7 * DAY,
        joined: 60 + (i % 5),
        left: 45 + (i % 4),
      })),
      backlog: {
        count: 340,
        oldestAt: NOW - 9 * DAY,
        foundPerDay: 74,
        reviewedPerDay: 62,
        days: 5.5,
        verdict: "watch",
      },
      addresses: {
        shortlisted: 300,
        found: { n: 273, d: 300 },
        confirmed: { n: 255, d: 300 },
        sources: { about: 61, video: 32, typed: 7, other: 0 },
        medianDaysToConfirm: 1.4,
        waiting: 24,
      },
      trust: { notRead: 120, retrying: 34, gaveUp: 18, noCountry: 410 },
    },
    waiting: {
      dated: 9000,
      undated: 1200,
      leaving: Array.from({ length: 7 }, (_, i) => ({
        at: NOW + (i + 1) * DAY,
        count: 1000 + i * 50,
      })),
      mistakes: { total: 37, tomorrow: 9, top },
      reasons: [
        { reason: "ai", count: 5300 },
        { reason: "views", count: 3100 },
        { reason: "posting", count: 1400 },
        { reason: "audience", count: 500 },
      ],
      topReasonKeywords: [
        { keyword: "ai news weekly", count: 2400 },
        { keyword: "chatgpt tips", count: 1200 },
      ],
      secondLooks: [
        { reason: "posting", back: 9, emailed: 6, replied: 2, signed: 1 },
        { reason: "views", back: 18, emailed: 7, replied: 0, signed: 0 },
      ],
    },
    archive: {
      byRules: 141_600,
      byPerson: 8600,
      ruleLabels: [
        { label: "inactive", count: 98_000 },
        { label: "irrelevant", count: 37_400 },
        { label: "tooBigAudience", count: 6200 },
      ],
      personReasons: [
        { reason: "ai", count: 4000 },
        { reason: "views", count: 3000 },
      ],
      refoundThisWeek: 412,
      broughtBack: { n: 40, d: 40 },
      growthPerWeek: 4800,
      growthByRulesPerWeek: 4500,
      profiles: [
        { ...emptyProfile, group: "live", medianViews: 52_000, uploads30: 6, subscribers: 90_000 },
        { ...emptyProfile, group: "waiting", medianViews: 20_000 },
        { ...emptyProfile, group: "person", medianViews: 9000, inMarkets: { n: 40, d: 100 } },
        { ...emptyProfile, group: "rules", medianViews: 800 },
      ],
    },
    everything: {
      found: 162_400,
      swept: 141_600,
      passed: 20_800,
      rejectedWaiting: 10_200,
      rejectedArchived: 8600,
      live: 2000,
    },
    ...over,
  };
}

/** A report for a catalog with nothing in it. */
export function emptySearchReport(): SearchReport {
  const none = { ratio: { n: 0, d: 0 } };
  return searchReport({
    counts: { live: 0, waiting: 0, archive: 0, everything: 0 },
    weeks: [],
    keywords: [],
    live: {
      groups: { notReviewed: 0, shortlisted: 0, outreach: 0, signed: 0, parked: 0, never: 0 },
      joinedThisWeek: 0,
      leftThisWeek: 0,
      weekly: [],
      backlog: {
        count: 0,
        oldestAt: null,
        foundPerDay: 0,
        reviewedPerDay: 0,
        days: null,
        verdict: "early",
      },
      addresses: {
        shortlisted: 0,
        found: none.ratio,
        confirmed: none.ratio,
        sources: { about: 0, video: 0, typed: 0, other: 0 },
        medianDaysToConfirm: null,
        waiting: 0,
      },
      trust: { notRead: 0, retrying: 0, gaveUp: 0, noCountry: 0 },
    },
    waiting: {
      dated: 0,
      undated: 0,
      leaving: [],
      mistakes: { total: 0, tomorrow: 0, top: [] },
      reasons: [],
      topReasonKeywords: [],
      secondLooks: [],
    },
    archive: {
      byRules: 0,
      byPerson: 0,
      ruleLabels: [],
      personReasons: [],
      refoundThisWeek: 0,
      broughtBack: none.ratio,
      growthPerWeek: 0,
      growthByRulesPerWeek: 0,
      profiles: [],
    },
    everything: { found: 0, swept: 0, passed: 0, rejectedWaiting: 0, rejectedArchived: 0, live: 0 },
  });
}

const line = (over: Partial<GoalLine> & Pick<GoalLine, "step">): GoalLine => ({
  month: 0,
  rate: null,
  perDay: null,
  actualPerDay: null,
  actualMonth: null,
  verdict: "good",
  shortBy: null,
  ...over,
});

/** A goal report where first emails fall short. */
export function goalReport(over: Partial<GoalReport> = {}): GoalReport {
  return {
    tab: "goal",
    window,
    settings: { signsPerMonth: 4, revenuePerMonth: null, overrides: {} },
    lines: [
      line({ step: "signed", month: 4 }),
      line({
        step: "replied",
        month: 24,
        rate: { value: 0.17, source: "yours", count: { n: 16, d: 96 } },
        verdict: "good",
      }),
      line({
        step: "firstEmails",
        month: 484,
        rate: { value: 0.049, source: "yours", count: { n: 61, d: 1240 } },
        perDay: 22,
        actualPerDay: 12,
        verdict: "watch",
        shortBy: 10,
      }),
      line({
        step: "triage",
        month: 1076,
        rate: { value: 0.45, source: "course", count: null },
        perDay: 49,
        actualPerDay: 60,
      }),
      line({
        step: "find",
        month: 8000,
        rate: { value: 0.13, source: "guess", count: null },
        perDay: 360,
        actualPerDay: 400,
      }),
    ],
    shortStep: "firstEmails",
    levers: [
      { kind: "replyRate", from: 0.049, to: 0.059, emailsFrom: 64, emailsTo: 54 },
      { kind: "signRate", from: 0.17, to: 0.22, emailsFrom: 64, emailsTo: 58 },
    ],
    room: { needed: 47, capacity: 75 },
    ...over,
  };
}
