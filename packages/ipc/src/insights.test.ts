import { insightsReport, reportTabs } from "@gratovo/core/insights";
import type {
  ChannelFacts,
  InsightsInputs,
  MessageFact,
  MoneyReport,
} from "@gratovo/core/insights";
import { describe, expect, it } from "vitest";

import { channels, parseRequest } from "./channels";
import {
  hiddenAlertsSchema,
  insightsListResultSchema,
  insightsReportSchema,
  goalSettingsSchema,
} from "./insights";

const NOW = new Date(2026, 9, 28, 12).getTime();
const day = 86_400_000;

const profile = {
  medianViews: null,
  uploads30: null,
  subscribers: null,
  sponsored: null,
  inMarkets: null,
  addressFound: null,
};

function channel(id: string, over: Partial<ChannelFacts> = {}): ChannelFacts {
  return {
    id,
    name: `AI Channel ${id}`,
    handle: `@${id}`,
    stage: null,
    inCatalog: true,
    foundAt: NOW - 3 * day,
    keywords: ["ai agents"],
    medianViews: 40_000,
    uploads30: 5,
    subscribers: 60_000,
    country: "US",
    sponsored: true,
    fit: 70,
    read: "ok",
    hasAddress: true,
    confirmedAt: null,
    addressSource: "about",
    rejectReason: null,
    rejectedAt: null,
    leavesAt: null,
    audit: null,
    ...over,
  };
}

function message(id: string, over: Partial<MessageFact>): MessageFact {
  return {
    id,
    channelId: "c1",
    direction: "out",
    at: NOW - 10 * day,
    kind: "first",
    followUp: null,
    mailbox: "a@x.test",
    reading: null,
    bounce: false,
    edited: false,
    rewrite: null,
    ...over,
  };
}

const inputs: InsightsInputs = {
  now: NOW,
  archiveDays: 90,
  channels: [
    channel("c1", { stage: "replied", confirmedAt: NOW - 20 * day }),
    channel("c2", { stage: "emailed", confirmedAt: NOW - 20 * day }),
    channel("c3"),
    channel("c4", {
      stage: "rejected",
      rejectReason: "views",
      rejectedAt: NOW - 5 * day,
      leavesAt: NOW + 2 * day,
      fit: 90,
    }),
  ],
  events: [
    { channelId: "c1", stage: "shortlisted", at: NOW - 25 * day },
    { channelId: "c1", stage: "emailed", at: NOW - 10 * day },
    { channelId: "c1", stage: "replied", at: NOW - 8 * day },
    { channelId: "c2", stage: "emailed", at: NOW - 9 * day },
  ],
  log: [{ channelId: "c4", action: "reject", at: NOW - 5 * day, reason: "views" }],
  messages: [
    message("m1", {}),
    message("m2", { channelId: "c2", at: NOW - 9 * day, mailbox: "b@x.test" }),
    message("m3", { direction: "in", kind: null, reading: "interested", at: NOW - 8 * day }),
    message("m4", {
      channelId: "c2",
      direction: "in",
      kind: null,
      reading: "bounce",
      bounce: true,
    }),
  ],
  inSequence: ["c2"],
  mailboxes: [
    {
      address: "a@x.test",
      dailyCap: 30,
      warmupStartedAt: null,
      warmupDays: null,
      heldAt: null,
      paused: false,
    },
  ],
  keywords: [{ keyword: "ai agents", found: 20, sweptByRules: 5, lastRun: null }],
  archive: {
    total: 100,
    byRules: 90,
    byPerson: 10,
    ruleLabels: [{ label: "under 5k subscribers", count: 90 }],
    personReasons: [{ reason: "views", count: 10 }],
    weekly: [{ at: NOW - 7 * day, all: 10, byRules: 9 }],
    refoundThisWeek: 3,
    person: profile,
    rules: profile,
  },
  weeks: [{ at: NOW - 7 * day, live: 3, waiting: 1, archive: 100 }],
  runs: [NOW - day],
  goal: { signsPerMonth: 4, revenuePerMonth: 20_000, overrides: { replied: 0.1 } },
  hidden: {},
  deals: [
    {
      id: "d1",
      brandId: "b1",
      creatorId: "c1",
      step: 7,
      price: 4000,
      payout: 2400,
      createdAt: NOW - 60 * day,
      goLiveAt: NOW - 40 * day,
      invoiceSentAt: NOW - 40 * day,
      invoiceDueAt: NOW - 10 * day,
      invoicePaidAt: NOW - 20 * day,
      paidCreatorAt: null,
      reportViews: 30_000,
      usualViews: 40_000,
      reportSentAt: null,
    },
  ],
  brands: [{ id: "b1", name: "Prompt Labs", status: "won", since: NOW - 90 * day }],
  dealEvents: [{ dealId: "d1", step: 7, at: NOW - 40 * day }],
  brandEvents: [{ brandId: "b1", status: "won", at: NOW - 60 * day }],
  seesMoney: true,
  marginFloorPct: 25,
};

/** A money report as the schema must take it (built by hand, so it does not lean on core). */
const money: MoneyReport = {
  tab: "money",
  names: { c1: "Dana" },
  window: {
    period: "30d",
    now: NOW,
    current: { from: NOW - 30 * day, to: NOW },
    previous: { from: NOW - 60 * day, to: NOW - 30 * day },
    workingDays: 22,
  },
  months: [{ month: NOW - 30 * day, paid: 18_000, net: 7000, projected: null }],
  goalPaid: 25_000,
  goalNet: 10_000,
  usualMargin: 0.4,
  paceVerdict: "watch",
  owed: {
    buckets: [{ bucket: "late30", amount: 4000, count: 1 }],
    late: [{ dealId: "d1", amount: 4000, daysLate: 12 }],
    payDays: [{ brandId: "b1", days: 31, unpaid: false }],
    verdict: "watch",
  },
  payouts: {
    due: [{ dealId: "d1", amount: 2400, brandPaidAt: NOW - 20 * day }],
    dueTotal: 2400,
    locked: 0,
    lockedCount: 0,
  },
  margin: { average: 0.4, floor: 0.25, under: [{ dealId: "d1", margin: 0.2 }], verdict: "good" },
  dealSize: { average: 4000, before: null, per1000: 95, trend: [{ at: NOW, value: 4000 }] },
  basket: { brand: { id: "b1", share: 0.5 }, creator: null, verdict: "good" },
  roster: [
    {
      creatorId: "c1",
      deals: 1,
      revenue: 4000,
      lastDealAt: NOW - 60 * day,
      signedAt: null,
      delivered: 0.75,
      idle: false,
    },
  ],
  deliveredAverage: 0.75,
  steps: [{ step: 0, medianDays: 3, stuck: 0 }],
  stuckDeals: [{ dealId: "d1", step: 7, days: 20, usual: 7 }],
  repeat: { came: { n: 0, d: 1 }, noNext: ["d1"] },
};

describe("insights:read", () => {
  it("takes every report tab and every period", () => {
    for (const tab of reportTabs) {
      for (const period of ["7d", "30d", "90d", "month"]) {
        expect(parseRequest("insights:read", { tab, period, deals: true }).ok).toBe(true);
      }
    }
  });

  it("refuses an unknown tab, a bad period and extra keys", () => {
    const parse = (value: unknown) => parseRequest("insights:read", value).ok;
    expect(parse({ tab: "brands", period: "7d", deals: true })).toBe(false);
    expect(parse({ tab: "overview", period: "year", deals: true })).toBe(false);
    expect(parse({ tab: "overview", deals: true })).toBe(false);
    expect(parse({ period: "7d", deals: true })).toBe(false);
    // The deals flag is required: a read that forgets it is refused, not read with deals.
    expect(parse({ tab: "overview", period: "7d" })).toBe(false);
    expect(parse({ tab: "overview", period: "7d", deals: "yes" })).toBe(false);
    expect(parse({ tab: "overview", period: "7d", deals: true, extra: 1 })).toBe(false);
    expect(parse(null)).toBe(false);
  });

  it("accepts the report the core builds for each tab, empty or full", () => {
    const empty: InsightsInputs = {
      ...inputs,
      channels: [],
      events: [],
      log: [],
      messages: [],
      inSequence: [],
      mailboxes: [],
      keywords: [],
      weeks: [],
      runs: [],
      goal: { signsPerMonth: 4, revenuePerMonth: null, overrides: {} },
      deals: [],
      brands: [],
      dealEvents: [],
      brandEvents: [],
    };
    for (const data of [empty, inputs]) {
      for (const tab of reportTabs) {
        for (const period of ["7d", "30d", "90d", "month"] as const) {
          const report = insightsReport(tab, data, period);
          const parsed = channels["insights:read"].response.safeParse(report);
          if (!parsed.success) {
            throw new Error(`${tab} ${period}: ${parsed.error.message}`);
          }
        }
      }
    }
  });

  it("accepts every report built from mis-dated deals and an unknown idle time", () => {
    const day = 86_400_000;
    const at = (days: number): number => inputs.now - days * day;
    const odd = (id: string, over: Partial<InsightsInputs["deals"][number]>) => ({
      id,
      brandId: "b1",
      creatorId: "c1",
      step: 8,
      price: 1000,
      payout: 3000,
      createdAt: at(30),
      goLiveAt: null,
      invoiceSentAt: at(10),
      invoiceDueAt: null,
      invoicePaidAt: at(20), // paid before it was sent
      paidCreatorAt: at(40), // and the creator before the brand
      reportViews: null,
      usualViews: null,
      reportSentAt: null,
      ...over,
    });
    const world: InsightsInputs = {
      ...inputs,
      seesMoney: true,
      channels: inputs.channels.map((c, i) =>
        i === 0 ? { ...c, id: "c1", stage: "signed" as const } : c,
      ),
      goal: { signsPerMonth: 4, revenuePerMonth: 10_000, overrides: {} },
      deals: [odd("d1", {}), odd("d2", { brandId: "b2" }), odd("d3", { brandId: "b2" })],
    };
    for (const tab of reportTabs) {
      const parsed = channels["insights:read"].response.safeParse(
        insightsReport(tab, world, "30d"),
      );
      if (!parsed.success) throw new Error(`${tab}: ${parsed.error.message}`);
    }
    const idle = {
      key: "idleCreator:c1",
      verdict: "watch",
      alert: { kind: "idleCreator", creatorId: "c1", days: null },
      go: { kind: "route", screen: "close", tab: null },
    };
    const overview = insightsReport("overview", world, "30d");
    expect(insightsReportSchema.safeParse({ ...overview, attention: [idle] }).success).toBe(true);
  });

  it("refuses a report with an extra key, a missing key or the wrong tab", () => {
    const report = insightsReport("goal", inputs, "30d");
    expect(insightsReportSchema.safeParse(report).success).toBe(true);
    expect(insightsReportSchema.safeParse({ ...report, extra: 1 }).success).toBe(false);
    expect(insightsReportSchema.safeParse({ ...report, tab: "elsewhere" }).success).toBe(false);
    const without: Record<string, unknown> = { ...report };
    delete without["lines"];
    expect(insightsReportSchema.safeParse(without).success).toBe(false);
  });
});

describe("the money report", () => {
  it("takes the money tab and parses a valid report", () => {
    expect(parseRequest("insights:read", { tab: "money", period: "30d", deals: true }).ok).toBe(
      true,
    );
    expect(insightsReportSchema.safeParse(money).success).toBe(true);
    expect(
      insightsReportSchema.safeParse({ ...money, goalPaid: null, goalNet: null }).success,
    ).toBe(true);
  });

  it("refuses a bad one: an extra key, a missing part, a wrong bucket, too many late invoices", () => {
    const parse = (value: unknown) => insightsReportSchema.safeParse(value).success;
    expect(parse({ ...money, extra: 1 })).toBe(false);
    const without: Record<string, unknown> = { ...money };
    delete without["payouts"];
    expect(parse(without)).toBe(false);
    expect(
      parse({
        ...money,
        owed: { ...money.owed, buckets: [{ bucket: "soon", amount: 1, count: 1 }] },
      }),
    ).toBe(false);
    const late = { dealId: "d1", amount: 1, daysLate: 1 };
    expect(
      parse({ ...money, owed: { ...money.owed, late: Array.from({ length: 11 }, () => late) } }),
    ).toBe(false);
    expect(parse({ ...money, months: [{ month: 1, paid: -5, net: 0, projected: null }] })).toBe(
      false,
    );
  });
});

describe("the brand funnel in the funnel report", () => {
  it("is required and strict", () => {
    const funnel = insightsReport("funnel", inputs, "30d");
    expect(insightsReportSchema.safeParse(funnel).success).toBe(true);
    expect(insightsReportSchema.safeParse({ ...funnel, brands: { rows: [] } }).success).toBe(false);
  });
});

describe("insights:list", () => {
  const request = {
    drill: { kind: "live", group: "notReviewed" },
    period: "30d",
    offset: 0,
    deals: true,
  };

  it("takes each kind of drill and a page start up to 100,000", () => {
    const drills = [
      { kind: "step", step: "emailed" },
      { kind: "stuck", step: "replied" },
      { kind: "keyword", keyword: "ai agents" },
      { kind: "live", group: "outreach" },
      { kind: "leaving", day: 6 },
      { kind: "mistakes" },
      { kind: "undated" },
      { kind: "rejected", reason: "unknown" },
      { kind: "secondLook", reason: "ai" },
      { kind: "fuel" },
      { kind: "unconfirmed" },
      { kind: "repliesWaiting" },
      { kind: "unreadable", which: "noCountry" },
      { kind: "brandStep", step: "negotiating" },
      { kind: "brandStuck", step: "pitched" },
      { kind: "lateInvoices" },
      { kind: "payoutsDue" },
      { kind: "stuckDeals", step: 4 },
      { kind: "stuckDeals", step: null },
      { kind: "underFloor" },
      { kind: "idleCreators" },
      { kind: "noNextDeal" },
    ];
    for (const drill of drills) {
      expect(parseRequest("insights:list", { ...request, drill }).ok).toBe(true);
    }
    expect(parseRequest("insights:list", { ...request, offset: 100_000 }).ok).toBe(true);
  });

  it("refuses an unknown drill, a bad day, long text, a bad offset and extra keys", () => {
    const parse = (value: unknown) => parseRequest("insights:list", value).ok;
    expect(parse({ ...request, drill: { kind: "everything" } })).toBe(false);
    expect(parse({ ...request, drill: { kind: "leaving", day: 7 } })).toBe(false);
    expect(parse({ ...request, drill: { kind: "step", step: "paid" } })).toBe(false);
    expect(parse({ ...request, drill: { kind: "keyword", keyword: "x".repeat(201) } })).toBe(false);
    expect(parse({ ...request, drill: { kind: "mistakes", extra: 1 } })).toBe(false);
    expect(parse({ ...request, drill: { kind: "brandStep", step: "emailed" } })).toBe(false);
    expect(parse({ ...request, drill: { kind: "stuckDeals" } })).toBe(false);
    expect(parse({ ...request, offset: -1 })).toBe(false);
    expect(parse({ ...request, offset: 100_001 })).toBe(false);
    expect(parse({ ...request, offset: 1.5 })).toBe(false);
    expect(parse({ ...request, period: "year" })).toBe(false);
    expect(parse({ drill: request.drill, period: "30d", offset: 0 })).toBe(false);
    expect(parse({ ...request, extra: 1 })).toBe(false);
  });

  it("answers a page of at most 100 rows", () => {
    const row = {
      id: "UCaaaaaaaaaaaaaaaaaaaaaa",
      name: "AI Lab",
      handle: "@ailab",
      note: { kind: "fit", fit: 80 },
    };
    const parse = (value: unknown) => insightsListResultSchema.safeParse(value).success;
    expect(parse({ rows: Array.from({ length: 100 }, () => row), total: 250 })).toBe(true);
    expect(parse({ rows: Array.from({ length: 101 }, () => row), total: 250 })).toBe(false);
    expect(parse({ rows: [{ ...row, id: "" }], total: 1 })).toBe(false);
    expect(parse({ rows: [{ ...row, extra: 1 }], total: 1 })).toBe(false);
    expect(parse({ rows: [], total: -1 })).toBe(false);
    expect(parse({ rows: [{ ...row, handle: null, note: null }], total: 1 })).toBe(true);
    expect(parse({ rows: [{ ...row, note: { kind: "reason", reason: "views" } }], total: 1 })).toBe(
      true,
    );
    expect(parse({ rows: [{ ...row, note: { kind: "gone" } }], total: 1 })).toBe(true);
    expect(parse({ rows: [{ ...row, note: "fit 80" }], total: 1 })).toBe(false);
    // P8b: brand and deal records, and the notes their lists carry.
    expect(parse({ rows: [{ ...row, record: "deal", handle: null }], total: 1 })).toBe(true);
    expect(parse({ rows: [{ ...row, record: "brand" }], total: 1 })).toBe(true);
    expect(parse({ rows: [{ ...row, record: "team" }], total: 1 })).toBe(false);
    for (const note of [
      { kind: "money", amount: 4000, days: 12 },
      { kind: "money", amount: 4000, days: null },
      { kind: "days", days: 9 },
      { kind: "margin", margin: 0.2 },
    ]) {
      expect(parse({ rows: [{ ...row, note }], total: 1 })).toBe(true);
    }
    expect(
      parse({ rows: [{ ...row, note: { kind: "money", amount: -1, days: 1 } }], total: 1 }),
    ).toBe(false);
    expect(parse({ rows: [{ ...row, note: { kind: "reason", reason: "x" } }], total: 1 })).toBe(
      false,
    );
  });
});

describe("insights:hide", () => {
  it("takes a key with a time, or null to show it again", () => {
    expect(parseRequest("insights:hide", { key: "mailboxBounces:a@x.test", until: NOW }).ok).toBe(
      true,
    );
    expect(parseRequest("insights:hide", { key: "fuelLow", until: null }).ok).toBe(true);
  });

  it("refuses an empty or long key, a missing time and extra keys", () => {
    const parse = (value: unknown) => parseRequest("insights:hide", value).ok;
    expect(parse({ key: "", until: null })).toBe(false);
    // An alert's key can be as long as 400 (a mailbox address, a keyword), so it can be hidden.
    expect(parse({ key: "x".repeat(400), until: null })).toBe(true);
    expect(parse({ key: "x".repeat(401), until: null })).toBe(false);
    expect(parse({ key: "fuelLow" })).toBe(false);
    expect(parse({ key: "fuelLow", until: "tomorrow" })).toBe(false);
    expect(parse({ key: "fuelLow", until: null, extra: 1 })).toBe(false);
  });

  it("answers the hidden alerts, bounded", () => {
    expect(hiddenAlertsSchema.safeParse({ fuelLow: NOW }).success).toBe(true);
    expect(hiddenAlertsSchema.safeParse({ fuelLow: "x" }).success).toBe(false);
    const many = Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`k${String(i)}`, NOW]));
    expect(hiddenAlertsSchema.safeParse(many).success).toBe(false);
  });
});

describe("insights:goal", () => {
  it("takes any part of a goal change", () => {
    const parse = (value: unknown) => parseRequest("insights:goal", value).ok;
    expect(parse({})).toBe(true);
    expect(parse({ signsPerMonth: 1 })).toBe(true);
    expect(parse({ signsPerMonth: 100 })).toBe(true);
    expect(parse({ overrides: { replied: 0.05, signed: null } })).toBe(true);
    expect(parse({ overrides: { find: 1 } })).toBe(true);
    expect(parse({ reset: true })).toBe(true);
    expect(parse({ revenuePerMonth: 100 })).toBe(true);
    expect(parse({ revenuePerMonth: 10_000_000 })).toBe(true);
    expect(parse({ revenuePerMonth: null })).toBe(true);
    expect(parse({ overrides: { revenue: 0.4, pitches: null } })).toBe(true);
  });

  it("refuses a bad count, a bad rate, an unknown step, reset: false and extra keys", () => {
    const parse = (value: unknown) => parseRequest("insights:goal", value).ok;
    expect(parse({ signsPerMonth: 0 })).toBe(false);
    expect(parse({ signsPerMonth: 101 })).toBe(false);
    expect(parse({ signsPerMonth: 2.5 })).toBe(false);
    expect(parse({ overrides: { replied: 0 } })).toBe(false);
    expect(parse({ overrides: { replied: 1.1 } })).toBe(false);
    expect(parse({ overrides: { paid: 0.5 } })).toBe(false);
    expect(parse({ revenuePerMonth: 99 })).toBe(false);
    expect(parse({ revenuePerMonth: 10_000_001 })).toBe(false);
    expect(parse({ revenuePerMonth: 2500.5 })).toBe(false);
    expect(parse({ reset: false })).toBe(false);
    expect(parse({ extra: 1 })).toBe(false);
  });

  it("answers the goal as kept", () => {
    expect(
      goalSettingsSchema.safeParse({ signsPerMonth: 4, revenuePerMonth: null, overrides: {} })
        .success,
    ).toBe(true);
    expect(
      goalSettingsSchema.safeParse({
        signsPerMonth: 4,
        revenuePerMonth: null,
        overrides: { signed: 0.2 },
      }).success,
    ).toBe(true);
    expect(goalSettingsSchema.safeParse({ signsPerMonth: 4 }).success).toBe(false);
    expect(
      goalSettingsSchema.safeParse({ signsPerMonth: 4, revenuePerMonth: 25_000, overrides: {} })
        .success,
    ).toBe(true);
    expect(
      goalSettingsSchema.safeParse({ signsPerMonth: 4, revenuePerMonth: 5, overrides: {} }).success,
    ).toBe(false);
  });
});
