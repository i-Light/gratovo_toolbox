import { insightsReport, reportTabs } from "@gratovo/core/insights";
import type { ChannelFacts, InsightsInputs, MessageFact } from "@gratovo/core/insights";
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
  goal: { signsPerMonth: 4, overrides: { replied: 0.1 } },
  hidden: {},
};

describe("insights:read", () => {
  it("takes every report tab and every period", () => {
    for (const tab of reportTabs) {
      for (const period of ["7d", "30d", "90d", "month"]) {
        expect(parseRequest("insights:read", { tab, period }).ok).toBe(true);
      }
    }
  });

  it("refuses an unknown tab, the money tab, a bad period and extra keys", () => {
    const parse = (value: unknown) => parseRequest("insights:read", value).ok;
    expect(parse({ tab: "brands", period: "7d" })).toBe(false);
    expect(parse({ tab: "money", period: "7d" })).toBe(false);
    expect(parse({ tab: "overview", period: "year" })).toBe(false);
    expect(parse({ tab: "overview" })).toBe(false);
    expect(parse({ period: "7d" })).toBe(false);
    expect(parse({ tab: "overview", period: "7d", extra: 1 })).toBe(false);
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
      goal: { signsPerMonth: 4, overrides: {} },
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

  it("refuses a report with an extra key, a missing key or the wrong tab", () => {
    const report = insightsReport("goal", inputs, "30d");
    expect(insightsReportSchema.safeParse(report).success).toBe(true);
    expect(insightsReportSchema.safeParse({ ...report, extra: 1 }).success).toBe(false);
    expect(insightsReportSchema.safeParse({ ...report, tab: "money" }).success).toBe(false);
    const without: Record<string, unknown> = { ...report };
    delete without["lines"];
    expect(insightsReportSchema.safeParse(without).success).toBe(false);
  });
});

describe("insights:list", () => {
  const request = { drill: { kind: "live", group: "notReviewed" }, period: "30d", offset: 0 };

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
    expect(parse({ ...request, offset: -1 })).toBe(false);
    expect(parse({ ...request, offset: 100_001 })).toBe(false);
    expect(parse({ ...request, offset: 1.5 })).toBe(false);
    expect(parse({ ...request, period: "year" })).toBe(false);
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
  });

  it("refuses a bad count, a bad rate, an unknown step, reset: false and extra keys", () => {
    const parse = (value: unknown) => parseRequest("insights:goal", value).ok;
    expect(parse({ signsPerMonth: 0 })).toBe(false);
    expect(parse({ signsPerMonth: 101 })).toBe(false);
    expect(parse({ signsPerMonth: 2.5 })).toBe(false);
    expect(parse({ overrides: { replied: 0 } })).toBe(false);
    expect(parse({ overrides: { replied: 1.1 } })).toBe(false);
    expect(parse({ overrides: { paid: 0.5 } })).toBe(false);
    expect(parse({ reset: false })).toBe(false);
    expect(parse({ extra: 1 })).toBe(false);
  });

  it("answers the goal as kept", () => {
    expect(goalSettingsSchema.safeParse({ signsPerMonth: 4, overrides: {} }).success).toBe(true);
    expect(
      goalSettingsSchema.safeParse({ signsPerMonth: 4, overrides: { signed: 0.2 } }).success,
    ).toBe(true);
    expect(goalSettingsSchema.safeParse({ signsPerMonth: 4 }).success).toBe(false);
  });
});
