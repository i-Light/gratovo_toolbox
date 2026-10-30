import { audienceKeys } from "@gratovo/core/close";
import { rejectReasons } from "@gratovo/core/data";
import {
  brandSteps,
  creatorSteps,
  diagnoses,
  goalSteps,
  keywordVerdicts,
  liveGroups,
  noKinds,
  owedBuckets,
  patternKinds,
  periods,
  readingKinds,
  reportTabs,
  searchViews,
  verdicts,
} from "@gratovo/core/insights";
import type {
  Alert,
  AlertLine,
  Batch,
  BrandFunnel,
  BrandFunnelRow,
  CohortRow,
  Drill,
  DrillRow,
  EmailsReport,
  FunnelExits,
  FunnelReport,
  FunnelRow,
  GoalLine,
  GoalRate,
  GoalReport,
  GoalSettings,
  GroupProfile,
  HiddenAlerts,
  InsightsGo,
  InsightsReport,
  KeywordRow,
  Lever,
  MailboxRow,
  MoneyMonth,
  MoneyReport,
  Mistake,
  OverviewReport,
  PatternSplit,
  Period,
  Point,
  Ratio,
  ReportTab,
  ReportWindow,
  SearchReport,
  SummaryPart,
  Win,
  WinLine,
} from "@gratovo/core/insights";
import { z } from "zod";

// The Insights channels (plan step P8a, A3, A4, A10): one report per tab and period, the records
// behind a number, the hidden alerts and the goal. Each schema is typed against the core type it
// describes, so a schema and its type can't drift apart. Arrays and strings are bounded to what
// the reports can hold, so one odd value can't flood the page.

/** The most rows one `insights:list` page carries. */
export const insightsPageMax = 100;
/** The most keywords a report lists (the Search tab shows every one). */
export const insightsKeywordsMax = 2000;
/** The most alerts a report lists. */
export const insightsAlertsMax = 200;
/** The most rows one Money list carries (payouts due, under the floor, roster, stuck). */
export const insightsMoneyRowsMax = 2000;
/** The most alerts hidden at once (the service drops the soonest to end past it). */
export const insightsHiddenMax = 500;

const count = z.number().int().nonnegative();
const amount = z.number().nonnegative();
const num = z.number();
const time = z.number();
const short = z.string().min(1).max(200);
const address = z.string().min(1).max(320);
const text = z.string().max(500);

const period: z.ZodType<Period> = z.enum(periods);
const tab: z.ZodType<ReportTab> = z.enum(reportTabs);
const verdict = z.enum(verdicts);
const difference = z.enum(["clear", "chance", "early"]);
const reason = z.enum([...rejectReasons, "unknown"]);
const step = z.enum(creatorSteps);
const goalStep = z.enum(goalSteps);
const brandStep = z.enum(brandSteps);
const id = z.string().min(1).max(100);

const ratio: z.ZodType<Ratio> = z.strictObject({ n: count, d: count });
const nullableRatio = ratio.nullable();
const point: z.ZodType<Point> = z.strictObject({ at: time, value: num.nullable() });
const span = z.strictObject({ from: time, to: time });

const window: z.ZodType<ReportWindow> = z.strictObject({
  period,
  now: time,
  current: span,
  previous: span,
  workingDays: count,
});

// ---------------------------------------------------------------------------------------------
// Where a number leads

const drill: z.ZodType<Drill> = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("step"), step }),
  z.strictObject({ kind: z.literal("stuck"), step }),
  z.strictObject({ kind: z.literal("keyword"), keyword: short }),
  z.strictObject({ kind: z.literal("live"), group: z.enum(liveGroups) }),
  z.strictObject({ kind: z.literal("leaving"), day: z.number().int().min(0).max(6) }),
  z.strictObject({ kind: z.literal("mistakes") }),
  z.strictObject({ kind: z.literal("undated") }),
  z.strictObject({ kind: z.literal("rejected"), reason }),
  z.strictObject({ kind: z.literal("secondLook"), reason }),
  z.strictObject({ kind: z.literal("fuel") }),
  z.strictObject({ kind: z.literal("unconfirmed") }),
  z.strictObject({ kind: z.literal("repliesWaiting") }),
  z.strictObject({
    kind: z.literal("unreadable"),
    which: z.enum(["notRead", "retrying", "gaveUp", "noCountry"]),
  }),
  z.strictObject({ kind: z.literal("brandStep"), step: brandStep }),
  z.strictObject({ kind: z.literal("brandStuck"), step: brandStep }),
  z.strictObject({ kind: z.literal("lateInvoices") }),
  z.strictObject({ kind: z.literal("payoutsDue") }),
  z.strictObject({
    kind: z.literal("stuckDeals"),
    step: z.number().int().min(0).max(20).nullable(),
  }),
  z.strictObject({ kind: z.literal("underFloor") }),
  z.strictObject({ kind: z.literal("idleCreators") }),
  z.strictObject({ kind: z.literal("noNextDeal") }),
]);

const go: z.ZodType<InsightsGo> = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("route"), screen: short, tab: short.nullable() }),
  z.strictObject({
    kind: z.literal("insights"),
    tab: z.enum(["overview", "funnel", "emails", "search", "money", "goal"]),
    view: z.enum(searchViews).nullable(),
  }),
  z.strictObject({ kind: z.literal("drill"), drill }),
]);

export const drillRowSchema: z.ZodType<DrillRow> = z.strictObject({
  id,
  record: z.exactOptional(z.enum(["creator", "brand", "deal"])),
  name: text,
  handle: text.nullable(),
  note: z
    .discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("reason"), reason }),
      z.strictObject({ kind: z.literal("fit"), fit: amount }),
      z.strictObject({ kind: z.literal("gone") }),
      z.strictObject({ kind: z.literal("money"), amount, days: amount.nullable() }),
      z.strictObject({ kind: z.literal("days"), days: amount }),
      z.strictObject({ kind: z.literal("margin"), margin: num }),
    ])
    .nullable(),
});

// ---------------------------------------------------------------------------------------------
// Funnel

const funnelRow: z.ZodType<FunnelRow> = z.strictObject({
  step,
  count,
  fromPrev: nullableRatio,
  before: nullableRatio,
  medianDays: amount.nullable(),
  stuck: count.nullable(),
  byDesign: z.boolean(),
});

const funnelExits: z.ZodType<FunnelExits> = z.strictObject({
  triage: z.array(z.strictObject({ reason, count })).max(5),
  saidNo: z.array(z.strictObject({ kind: z.enum(noKinds), count })).max(noKinds.length),
  audience: z
    .array(z.strictObject({ check: z.enum(audienceKeys), count }))
    .max(audienceKeys.length),
  noAnswer: count,
  stillInSequence: count,
  bounced: count,
});

const cohortRow: z.ZodType<CohortRow> = z.strictObject({
  week: time,
  emailed: count,
  by: z.array(nullableRatio).max(4),
});

const brandFunnelRow: z.ZodType<BrandFunnelRow> = z.strictObject({
  step: brandStep,
  count,
  fromPrev: nullableRatio,
  before: nullableRatio,
  medianDays: amount.nullable(),
  stuck: count.nullable(),
});

const brandFunnel: z.ZodType<BrandFunnel> = z.strictObject({
  rows: z.array(brandFunnelRow).max(brandSteps.length),
  biggestDrop: brandStep.nullable(),
  lost: z.array(z.strictObject({ step: brandStep, count })).max(brandSteps.length),
});

const funnelReport: z.ZodType<FunnelReport> = z.strictObject({
  tab: z.literal("funnel"),
  window,
  everyone: z.array(funnelRow).max(creatorSteps.length),
  cohort: z.array(funnelRow).max(creatorSteps.length),
  biggestDrop: step.nullable(),
  exits: funnelExits,
  stepDays: z
    .array(z.strictObject({ from: step, to: step, days: amount.nullable() }))
    .max(creatorSteps.length),
  cohorts: z.array(cohortRow).max(12),
  cohortTrend: difference,
  brands: brandFunnel,
});

// ---------------------------------------------------------------------------------------------
// Emails

const batch: z.ZodType<Batch> = z.strictObject({
  index: count,
  from: time,
  to: time,
  sent: count,
  bounced: count,
  replied: count,
  positive: count,
  signed: count,
  diagnosis: z.enum(diagnoses),
  bounceMailbox: address.nullable(),
});

const patternSplit: z.ZodType<PatternSplit> = z.strictObject({
  kind: z.enum(patternKinds),
  groups: z.array(z.strictObject({ key: text, rate: ratio })).max(100),
  result: difference,
  best: text.nullable(),
});

const mailboxRow: z.ZodType<MailboxRow> = z.strictObject({
  address,
  warmupDay: count.nullable(),
  warmupDays: count.nullable(),
  heldAt: count.nullable(),
  sent: count,
  room: count,
  bounced: ratio,
  replies: ratio,
  verdict,
});

const emailsReport: z.ZodType<EmailsReport> = z.strictObject({
  tab: z.literal("emails"),
  window,
  daily: z.array(z.strictObject({ at: time, sent: count, replies: count })).max(120),
  sent: count,
  rate: ratio,
  rateBefore: ratio,
  rateVerdict: verdict,
  bySteps: z.array(z.strictObject({ step: count, rate: ratio, share: ratio })).max(4),
  readings: z.array(z.strictObject({ kind: z.enum(readingKinds), count })).max(readingKinds.length),
  positive: ratio,
  batches: z.array(batch).max(12),
  patterns: z.array(patternSplit).max(patternKinds.length),
  answer: z.strictObject({ medianHours: amount.nullable(), overDay: count, verdict }),
  mailboxes: z.array(mailboxRow).max(100),
  capacity: ratio,
});

// ---------------------------------------------------------------------------------------------
// Search

const keywordRow: z.ZodType<KeywordRow> = z.strictObject({
  keyword: short,
  found: count,
  kept: ratio,
  live: count,
  emailed: count,
  replied: count,
  signed: count,
  verdict: z.enum(keywordVerdicts),
  why: z.enum(["wornOut", "noAnswers", "tooFew"]).nullable(),
  lastRun: z.strictObject({ at: time, fresh: count, live: count, archived: count }).nullable(),
});

const mistake: z.ZodType<Mistake> = z.strictObject({
  id: z.string().min(1).max(100),
  name: text,
  handle: text.nullable(),
  reason,
  fit: amount,
  medianViews: amount.nullable(),
  leavesAt: time,
});

const groupProfile: z.ZodType<GroupProfile> = z.strictObject({
  group: z.enum(["live", "waiting", "person", "rules"]),
  medianViews: amount.nullable(),
  uploads30: amount.nullable(),
  subscribers: amount.nullable(),
  sponsored: nullableRatio,
  inMarkets: nullableRatio,
  addressFound: nullableRatio,
});

const reasonCount = z.strictObject({ reason, count });

const searchReport: z.ZodType<SearchReport> = z.strictObject({
  tab: z.literal("search"),
  window,
  counts: z.strictObject({ live: count, waiting: count, archive: count, everything: count }),
  weeks: z
    .array(
      z.strictObject({
        at: time,
        live: count.nullable(),
        waiting: count.nullable(),
        archive: count.nullable(),
      }),
    )
    .max(60),
  keywords: z.array(keywordRow).max(insightsKeywordsMax),
  live: z.strictObject({
    groups: z.record(z.enum(liveGroups), count),
    joinedThisWeek: count,
    leftThisWeek: count,
    weekly: z.array(z.strictObject({ at: time, joined: count, left: count })).max(60),
    backlog: z.strictObject({
      count,
      oldestAt: time.nullable(),
      foundPerDay: amount,
      reviewedPerDay: amount,
      days: amount.nullable(),
      verdict,
    }),
    addresses: z.strictObject({
      shortlisted: count,
      found: ratio,
      confirmed: ratio,
      sources: z.strictObject({ about: count, video: count, typed: count, other: count }),
      medianDaysToConfirm: amount.nullable(),
      waiting: count,
    }),
    trust: z.strictObject({ notRead: count, retrying: count, gaveUp: count, noCountry: count }),
  }),
  waiting: z.strictObject({
    dated: count,
    undated: count,
    leaving: z.array(z.strictObject({ at: time, count })).max(7),
    mistakes: z.strictObject({ total: count, tomorrow: count, top: z.array(mistake).max(50) }),
    reasons: z.array(reasonCount).max(5),
    topReasonKeywords: z.array(z.strictObject({ keyword: short, count })).max(3),
    secondLooks: z
      .array(z.strictObject({ reason, back: count, emailed: count, replied: count, signed: count }))
      .max(5),
  }),
  archive: z.strictObject({
    byRules: count,
    byPerson: count,
    ruleLabels: z.array(z.strictObject({ label: text, count })).max(200),
    personReasons: z.array(reasonCount).max(5),
    refoundThisWeek: count,
    broughtBack: ratio,
    growthPerWeek: amount,
    growthByRulesPerWeek: amount,
    profiles: z.array(groupProfile).max(4),
  }),
  everything: z.strictObject({
    found: count,
    swept: count,
    passed: count,
    rejectedWaiting: count,
    rejectedArchived: count,
    live: count,
  }),
});

// ---------------------------------------------------------------------------------------------
// Money

const moneyMonth: z.ZodType<MoneyMonth> = z.strictObject({
  month: time,
  paid: amount,
  net: num,
  projected: amount.nullable(),
});

const moneyReport: z.ZodType<MoneyReport> = z.strictObject({
  tab: z.literal("money"),
  window,
  names: z.record(id, z.string().max(300)).refine((r) => Object.keys(r).length <= 4000),
  months: z.array(moneyMonth).max(12),
  goalPaid: amount.nullable(),
  goalNet: amount.nullable(),
  usualMargin: num.nullable(),
  paceVerdict: verdict,
  owed: z.strictObject({
    buckets: z
      .array(z.strictObject({ bucket: z.enum(owedBuckets), amount, count }))
      .max(owedBuckets.length),
    late: z.array(z.strictObject({ dealId: id, amount, daysLate: amount })).max(10),
    payDays: z
      .array(z.strictObject({ brandId: id, days: amount.nullable(), unpaid: z.boolean() }))
      .max(insightsMoneyRowsMax),
    verdict,
  }),
  payouts: z.strictObject({
    due: z
      .array(z.strictObject({ dealId: id, amount, brandPaidAt: time }))
      .max(insightsMoneyRowsMax),
    dueTotal: amount,
    locked: amount,
    lockedCount: count,
  }),
  margin: z.strictObject({
    average: num.nullable(),
    floor: num,
    under: z.array(z.strictObject({ dealId: id, margin: num })).max(insightsMoneyRowsMax),
    verdict,
  }),
  dealSize: z.strictObject({
    average: amount.nullable(),
    before: amount.nullable(),
    per1000: amount.nullable(),
    trend: z.array(point).max(12),
  }),
  basket: z.strictObject({
    brand: z.strictObject({ id, share: num }).nullable(),
    creator: z.strictObject({ id, share: num }).nullable(),
    verdict,
  }),
  roster: z
    .array(
      z.strictObject({
        creatorId: id,
        deals: count,
        revenue: amount,
        lastDealAt: time.nullable(),
        signedAt: time.nullable(),
        delivered: num.nullable(),
        idle: z.boolean(),
      }),
    )
    .max(insightsMoneyRowsMax),
  deliveredAverage: num.nullable(),
  steps: z
    .array(z.strictObject({ step: count, medianDays: amount.nullable(), stuck: count }))
    .max(20),
  stuckDeals: z
    .array(z.strictObject({ dealId: id, step: count, days: amount, usual: amount }))
    .max(insightsMoneyRowsMax),
  repeat: z.strictObject({
    came: ratio,
    noNext: z.array(id).max(insightsMoneyRowsMax),
  }),
});

// ---------------------------------------------------------------------------------------------
// Goal

const goalRate: z.ZodType<GoalRate> = z.strictObject({
  value: amount,
  source: z.enum(["yours", "course", "guess", "override"]),
  count: nullableRatio,
});

const goalLine: z.ZodType<GoalLine> = z.strictObject({
  step: goalStep,
  month: amount,
  rate: goalRate.nullable(),
  perDay: amount.nullable(),
  actualPerDay: amount.nullable(),
  actualMonth: amount.nullable(),
  verdict,
  shortBy: amount.nullable(),
});

const lever: z.ZodType<Lever> = z.strictObject({
  kind: z.enum(["replyRate", "signRate", "dealSize", "closeRate"]),
  from: amount,
  to: amount,
  emailsFrom: amount,
  emailsTo: amount,
});

const revenueGoal = z.number().int().min(100).max(10_000_000);

/** The goal as kept in `local_settings` (key `insights.goal`). */
export const goalSettingsSchema: z.ZodType<GoalSettings> = z.strictObject({
  signsPerMonth: z.number().int().min(1).max(100),
  revenuePerMonth: revenueGoal.nullable(),
  overrides: z.partialRecord(goalStep, z.number().gt(0).max(1)),
});

const goalReport: z.ZodType<GoalReport> = z.strictObject({
  tab: z.literal("goal"),
  window,
  settings: goalSettingsSchema,
  lines: z.array(goalLine).max(goalSteps.length),
  shortStep: goalStep.nullable(),
  levers: z.array(lever).max(10),
  room: z.strictObject({ needed: amount, capacity: amount }),
});

// ---------------------------------------------------------------------------------------------
// Alerts, wins and the Overview

const alert: z.ZodType<Alert> = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("mailboxBounces"), mailbox: address, bounced: ratio }),
  z.strictObject({ kind: z.literal("repliesFell"), batch: count, rate: ratio, usual: ratio }),
  z.strictObject({
    kind: z.literal("fuelLow"),
    ready: count,
    days: amount,
    waitingConfirm: count,
  }),
  z.strictObject({ kind: z.literal("repliesFalling"), batches: count }),
  z.strictObject({ kind: z.literal("roomUnused"), used: ratio }),
  z.strictObject({
    kind: z.literal("keywordWeak"),
    keyword: short,
    replied: ratio,
    others: ratio,
  }),
  z.strictObject({ kind: z.literal("keywordWornOut"), keyword: short, known: ratio }),
  z.strictObject({ kind: z.literal("stepShort"), step: goalStep, perDay: amount, needed: amount }),
  z.strictObject({ kind: z.literal("noSearch"), days: amount, fuelDays: amount }),
  z.strictObject({ kind: z.literal("backlogGrowing"), count, days: amount }),
  z.strictObject({ kind: z.literal("reFindsArchive"), keyword: short, archived: ratio }),
  z.strictObject({ kind: z.literal("mistakesLeaving"), count }),
  z.strictObject({ kind: z.literal("rejectsTooStrict"), reason, back: count, replied: count }),
  z.strictObject({ kind: z.literal("unreadable"), count: ratio }),
  z.strictObject({
    kind: z.literal("auditFailing"),
    check: z.enum(audienceKeys),
    failed: ratio,
  }),
  z.strictObject({ kind: z.literal("invoiceLate"), dealId: id, days: amount, amount }),
  z.strictObject({ kind: z.literal("payoutDue"), dealId: id, amount, since: time }),
  z.strictObject({
    kind: z.literal("dealStuck"),
    dealId: id,
    step: count,
    days: amount,
    usual: amount,
  }),
  z.strictObject({ kind: z.literal("behindGoal"), projected: amount, goal: amount }),
  z.strictObject({ kind: z.literal("basket"), brandId: id, share: num }),
  z.strictObject({ kind: z.literal("idleCreator"), creatorId: id, days: amount.nullable() }),
  z.strictObject({ kind: z.literal("marginLow"), dealId: id, margin: num, floor: num }),
]);

const alertLine: z.ZodType<AlertLine> = z.strictObject({
  key: z.string().min(1).max(400),
  verdict: z.enum(["act", "watch"]),
  alert,
  go,
});

const win: z.ZodType<Win> = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("edited"), edited: ratio, asWritten: ratio }),
  z.strictObject({ kind: z.literal("keyword"), keyword: short, replied: ratio, signed: count }),
  z.strictObject({ kind: z.literal("mailbox"), mailbox: address, replies: ratio }),
  z.strictObject({ kind: z.literal("followUp"), step: count, share: ratio, rate: ratio }),
  z.strictObject({ kind: z.literal("brandPaysFast"), brandId: id, days: amount }),
]);

const winLine: z.ZodType<WinLine> = z.strictObject({
  result: z.enum(["clear", "chance", "early", "good"]),
  win,
  go: go.nullable(),
});

const summaryPart: z.ZodType<SummaryPart> = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("sent"),
    sent: count,
    change: num,
    onPace: z.boolean().nullable(),
  }),
  z.strictObject({ kind: z.literal("replies"), replied: count, rate: ratio, signed: count }),
  z.strictObject({ kind: z.literal("needs"), alerts: z.array(alertLine).max(insightsAlertsMax) }),
  z.strictObject({ kind: z.literal("quiet") }),
]);

const overviewReport: z.ZodType<OverviewReport> = z.strictObject({
  tab: z.literal("overview"),
  window,
  summary: z.array(summaryPart).max(10),
  vitals: z.strictObject({
    emails: z.strictObject({
      sent: count,
      before: count,
      firstEmails: count,
      firstPerDay: amount,
      neededPerDay: amount.nullable(),
      verdict,
      trend: z.array(point).max(120),
    }),
    replyRate: z.strictObject({
      now: ratio,
      before: ratio,
      difference,
      verdict,
      trend: z.array(point).max(120),
    }),
    signedPer1000: z.strictObject({ now: ratio, ninety: ratio, verdict }),
    fuel: z.strictObject({
      ready: count,
      firstPerDay: amount,
      days: amount.nullable(),
      waitingConfirm: count,
      verdict,
    }),
    revenue: z
      .strictObject({
        month: time,
        paid: amount,
        projected: amount.nullable(),
        goal: amount.nullable(),
        verdict,
        trend: z.array(point).max(12),
      })
      .nullable(),
    repliesWaiting: z.strictObject({ count, oldestAt: time.nullable(), verdict }),
  }),
  attention: z.array(alertLine).max(insightsAlertsMax),
  hidden: count,
  wins: z.array(winLine).max(10),
  pipeline: z.array(funnelRow).max(creatorSteps.length),
  biggestDrop: step.nullable(),
});

// ---------------------------------------------------------------------------------------------
// The four channels

/**
 * `insights:read`: one tab for a period. Money is refused for a viewer without money access.
 * `deals` says whether deals and money may be read at all: false on live data until step 9, when
 * the report is worked out as if there were no deals (B8).
 */
export const insightsReadRequestSchema = z.strictObject({ tab, period, deals: z.boolean() });

export const insightsReportSchema: z.ZodType<InsightsReport> = z.union([
  overviewReport,
  funnelReport,
  emailsReport,
  searchReport,
  moneyReport,
  goalReport,
]);

/** `insights:list`: one page of the records behind a number. */
export const insightsListRequestSchema = z.strictObject({
  drill,
  period,
  offset: z.number().int().min(0).max(100_000),
  /** As for `insights:read`. */
  deals: z.boolean(),
});

export const insightsListResultSchema = z.strictObject({
  rows: z.array(drillRowSchema).max(insightsPageMax),
  total: count,
});

/** `insights:hide`: hide an alert until a time; null shows it again. */
export const insightsHideRequestSchema = z.strictObject({
  key: z.string().min(1).max(400),
  until: time.nullable(),
});

export const hiddenAlertsSchema: z.ZodType<HiddenAlerts> = z
  .record(z.string().min(1).max(400), time)
  .refine((all) => Object.keys(all).length <= insightsHiddenMax, "Too many hidden alerts");

export const insightsHideResultSchema = z.strictObject({ hidden: hiddenAlertsSchema });

/** `insights:goal`: change the goal; an override of null goes back to your own rate. */
export const insightsGoalRequestSchema = z.strictObject({
  signsPerMonth: z.exactOptional(z.number().int().min(1).max(100)),
  revenuePerMonth: z.exactOptional(revenueGoal.nullable()),
  overrides: z.exactOptional(z.partialRecord(goalStep, z.number().gt(0).max(1).nullable())),
  reset: z.exactOptional(z.literal(true)),
});
