import { describe, expect, it } from "vitest";

import type {
  ArchiveFacts,
  ChannelFacts,
  InsightsInputs,
  KeywordFacts,
  LogFact,
  MessageFact,
  StageEvent,
} from "./inputs";
import { keywordRows, keywordVerdict, liveGroup, searchReport } from "./search";
import { reportWindow } from "./stats";

const L = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h).getTime();
/** Wednesday 28 Oct 2026, noon; the week starts Monday 26 Oct. */
const NOW = L(2026, 10, 28, 12);
const MON = L(2026, 10, 26);
const DAY = 86_400_000;

const profile = {
  medianViews: null,
  uploads30: null,
  subscribers: null,
  sponsored: null,
  inMarkets: null,
  addressFound: null,
};

const emptyArchive: ArchiveFacts = {
  total: 0,
  byRules: 0,
  byPerson: 0,
  ruleLabels: [],
  personReasons: [],
  weekly: [],
  refoundThisWeek: 0,
  person: profile,
  rules: profile,
};

function ch(id: string, over: Partial<ChannelFacts> = {}): ChannelFacts {
  return {
    id,
    name: `Name ${id}`,
    handle: `@${id}`,
    stage: null,
    inCatalog: true,
    foundAt: null,
    keywords: [],
    medianViews: null,
    uploads30: null,
    subscribers: null,
    country: null,
    sponsored: null,
    fit: 50,
    read: "ok",
    hasAddress: false,
    confirmedAt: null,
    addressSource: null,
    rejectReason: null,
    rejectedAt: null,
    leavesAt: null,
    audit: null,
    ...over,
  };
}

function inputs(over: Partial<InsightsInputs> = {}): InsightsInputs {
  return {
    now: NOW,
    archiveDays: 7,
    channels: [],
    events: [],
    log: [],
    messages: [],
    inSequence: [],
    mailboxes: [],
    keywords: [],
    archive: emptyArchive,
    weeks: [],
    runs: [],
    goal: { signsPerMonth: 4, overrides: {} },
    hidden: {},
    ...over,
  };
}

const report = (i: InsightsInputs) => searchReport(i, reportWindow("30d", NOW));
const ev = (channelId: string, stage: StageEvent["stage"], at: number): StageEvent => ({
  channelId,
  stage,
  at,
});
const logLine = (
  channelId: string,
  action: LogFact["action"],
  at: number,
  reason: LogFact["reason"] = null,
): LogFact => ({ channelId, action, at, reason });
const kw = (keyword: string, over: Partial<KeywordFacts> = {}): KeywordFacts => ({
  keyword,
  found: 100,
  sweptByRules: 0,
  lastRun: null,
  ...over,
});

describe("liveGroup", () => {
  it("maps stages to bands", () => {
    expect(liveGroup({ stage: null })).toBe("notReviewed");
    expect(liveGroup({ stage: "new" })).toBe("notReviewed");
    expect(liveGroup({ stage: "shortlisted" })).toBe("shortlisted");
    // Confirmed and waiting for the first email: still "Shortlisted" in the band.
    expect(liveGroup({ stage: "contact" })).toBe("shortlisted");
    for (const s of ["emailed", "replied", "kit", "audience"] as const) {
      expect(liveGroup({ stage: s })).toBe("outreach");
    }
    expect(liveGroup({ stage: "signed" })).toBe("signed");
    expect(liveGroup({ stage: "parked" })).toBe("parked");
    expect(liveGroup({ stage: "never" })).toBe("never");
    expect(liveGroup({ stage: "rejected" })).toBeNull();
  });
});

describe("empty inputs", () => {
  it("does not throw and fakes no zeros for unknowns", () => {
    const r = report(inputs());
    expect(r.counts).toEqual({ live: 0, waiting: 0, archive: 0, everything: 0 });
    expect(r.weeks).toHaveLength(12);
    expect(r.weeks.every((w) => w.live === null && w.waiting === null && w.archive === null)).toBe(
      true,
    );
    expect(r.keywords).toEqual([]);
    expect(r.live.backlog.oldestAt).toBeNull();
    expect(r.live.backlog.days).toBeNull();
    expect(r.live.backlog.verdict).toBe("early");
    expect(r.live.addresses.medianDaysToConfirm).toBeNull();
    expect(r.waiting.leaving).toHaveLength(7);
    expect(r.waiting.reasons).toEqual([]);
    expect(r.waiting.topReasonKeywords).toEqual([]);
    expect(r.archive.growthPerWeek).toBe(0);
    expect(r.archive.broughtBack).toEqual({ n: 0, d: 0 });
    for (const p of r.archive.profiles.slice(0, 2)) {
      expect(p.medianViews).toBeNull();
      expect(p.sponsored).toBeNull();
      expect(p.addressFound).toBeNull();
    }
  });
});

describe("counts, groups and everything", () => {
  const i = inputs({
    channels: [
      ch("a"),
      ch("b", { stage: "shortlisted" }),
      ch("c", { stage: "emailed" }),
      ch("d", { stage: "signed" }),
      ch("e", { stage: "rejected" }),
      ch("f", { stage: "rejected" }),
      ch("g", { stage: "never" }),
      ch("h", { stage: "emailed", inCatalog: false }),
    ],
    archive: { ...emptyArchive, total: 100, byRules: 80, byPerson: 20 },
  });
  const r = report(i);
  it("counts live, waiting, archive", () => {
    expect(r.counts).toEqual({ live: 5, waiting: 2, archive: 100, everything: 107 });
    expect(r.live.groups).toEqual({
      notReviewed: 1,
      shortlisted: 1,
      outreach: 1,
      signed: 1,
      parked: 0,
      never: 1,
    });
  });
  it("makes the everything funnel", () => {
    expect(r.everything).toEqual({
      found: 107,
      swept: 80,
      passed: 27,
      rejectedWaiting: 2,
      rejectedArchived: 20,
      live: 5,
    });
  });
});

describe("weeks", () => {
  it("reads live and waiting by Monday and runs the archive back from the total", () => {
    const r = report(
      inputs({
        weeks: [{ at: MON - 7 * DAY, live: 10, waiting: 3, archive: 500 }],
        archive: {
          ...emptyArchive,
          total: 1000,
          weekly: [
            { at: MON - 14 * DAY, all: 50, byRules: 40 },
            { at: MON - 7 * DAY, all: 100, byRules: 90 },
            { at: MON, all: 30, byRules: 20 },
          ],
        },
      }),
    );
    expect(r.weeks[11]?.at).toBe(MON);
    expect(r.weeks[0]?.at).toBe(L(2026, 8, 10));
    expect(r.weeks[11]).toMatchObject({ live: null, waiting: null, archive: 1000 });
    expect(r.weeks[10]).toMatchObject({ live: 10, waiting: 3, archive: 970 });
    expect(r.weeks[9]?.archive).toBe(870);
    expect(r.weeks[8]?.archive).toBe(820);
  });
});

describe("keywords", () => {
  const run = (fresh: number, live: number, archived: number) => ({
    at: NOW,
    fresh,
    live,
    archived,
  });
  const none = { n: 40, d: 800 };
  it("is early under 50 emailed", () => {
    expect(keywordVerdict({ emailed: 49, replied: 0, lastRun: null }, none)).toEqual({
      verdict: "early",
      why: "tooFew",
    });
  });
  it("is worn out when over 80% of the last run was known", () => {
    expect(keywordVerdict({ emailed: 100, replied: 10, lastRun: run(10, 50, 40) }, none)).toEqual({
      verdict: "watch",
      why: "wornOut",
    });
    expect(
      keywordVerdict({ emailed: 100, replied: 10, lastRun: run(20, 40, 40) }, none).verdict,
    ).toBe("keep");
  });
  it("drops a keyword clearly worse than the others, keeps one that is better", () => {
    expect(keywordVerdict({ emailed: 400, replied: 4, lastRun: null }, none)).toEqual({
      verdict: "drop",
      why: "noAnswers",
    });
    expect(keywordVerdict({ emailed: 400, replied: 60, lastRun: null }, none).verdict).toBe("keep");
  });

  it("builds a row from the channels", () => {
    const channels = [
      ch("a", { keywords: ["ai tools"], stage: "shortlisted" }),
      ch("b", { keywords: ["ai tools", "gpt news"], stage: "emailed" }),
      ch("c", { keywords: ["ai tools"], stage: "replied" }),
      ch("d", { keywords: ["ai tools"], stage: "signed" }),
      ch("e", { keywords: ["ai tools"], stage: "rejected" }),
      ch("f", { keywords: ["gpt news"] }),
    ];
    const rows = keywordRows(
      inputs({
        channels,
        keywords: [kw("gpt news", { found: 10 }), kw("ai tools", { found: 20, sweptByRules: 5 })],
      }),
    );
    expect(rows.map((r) => r.keyword)).toEqual(["ai tools", "gpt news"]);
    expect(rows[0]).toMatchObject({
      live: 4,
      emailed: 3,
      replied: 2,
      signed: 1,
      found: 20,
      // Kept: live and reviewed (a, b, c, d); e was rejected, the swept ones never passed.
      kept: { n: 4, d: 20 },
      verdict: "early",
      why: "tooFew",
    });
    // f is live but not reviewed yet, so only b is kept.
    expect(rows[1]).toMatchObject({ live: 2, emailed: 1, kept: { n: 1, d: 10 } });
  });
});

describe("live movement", () => {
  it("counts joined and left this week and by week", () => {
    const r = report(
      inputs({
        events: [
          ev("a", "shortlisted", MON + DAY),
          ev("b", "shortlisted", MON - 3 * DAY),
          ev("b", "rejected", MON + 2 * DAY),
          ev("c", "rejected", MON + 2 * DAY), // never shortlisted: not a leave
          ev("d", "shortlisted", MON - 10 * DAY),
          ev("d", "parked", MON - 9 * DAY),
        ],
      }),
    );
    expect(r.live.joinedThisWeek).toBe(1);
    expect(r.live.leftThisWeek).toBe(1);
    expect(r.live.weekly).toHaveLength(12);
    expect(r.live.weekly[10]).toMatchObject({ joined: 1, left: 0 });
    expect(r.live.weekly[9]).toMatchObject({ joined: 1, left: 1 });
  });
});

describe("backlog", () => {
  it("works out the pace and days", () => {
    const channels = [
      ...Array.from({ length: 60 }, (_, n) =>
        ch(`n${String(n)}`, { foundAt: NOW - (n % 7) * DAY }),
      ),
      ch("old", { foundAt: NOW - 30 * DAY }),
    ];
    const events = Array.from({ length: 140 }, (_, n) =>
      ev(`r${String(n)}`, "rejected", NOW - 2 * DAY),
    );
    const b = report(inputs({ channels, events })).live.backlog;
    expect(b.count).toBe(61);
    expect(b.oldestAt).toBe(NOW - 30 * DAY);
    expect(b.foundPerDay).toBeCloseTo(60 / 14);
    expect(b.reviewedPerDay).toBeCloseTo(10);
    // Days of reviewing at your pace: 61 waiting, 10 reviewed a day.
    expect(b.days).toBeCloseTo(61 / 10);
    expect(b.verdict).toBe("watch");
  });
  it("watches when the backlog holds over 5 days of reviewing", () => {
    const channels = Array.from({ length: 30 }, (_, n) =>
      ch(`n${String(n)}`, { foundAt: NOW - DAY }),
    );
    const b = report(inputs({ channels, events: [ev("x", "shortlisted", NOW - DAY)] })).live
      .backlog;
    // One review in 14 days: 30 waiting hold 420 days.
    expect(b.days).toBeCloseTo(30 / (1 / 14));
    expect(b.verdict).toBe("watch");
  });
  it("is early with a small backlog and no review", () => {
    expect(report(inputs({ channels: [ch("a")] })).live.backlog.verdict).toBe("early");
  });
});

describe("addresses and trust", () => {
  it("counts the last 30 days' shortlist", () => {
    const channels = [
      ch("a", {
        stage: "shortlisted",
        hasAddress: true,
        confirmedAt: NOW - DAY,
        addressSource: "about",
      }),
      ch("b", { stage: "shortlisted", hasAddress: true }),
      ch("c", {
        stage: "contact",
        hasAddress: true,
        confirmedAt: NOW - DAY,
        addressSource: "typed",
      }),
      ch("d", { stage: "shortlisted" }),
      ch("old", { stage: "shortlisted", hasAddress: true }),
    ];
    const events = [
      ev("a", "shortlisted", NOW - 3 * DAY),
      ev("b", "shortlisted", NOW - 3 * DAY),
      ev("c", "shortlisted", NOW - 5 * DAY),
      ev("d", "shortlisted", NOW - DAY),
      ev("old", "shortlisted", NOW - 40 * DAY),
    ];
    const a = report(inputs({ channels, events })).live.addresses;
    expect(a.shortlisted).toBe(4);
    expect(a.found).toEqual({ n: 3, d: 4 });
    expect(a.confirmed).toEqual({ n: 2, d: 4 });
    expect(a.sources).toEqual({ about: 1, video: 0, typed: 1, other: 0 });
    expect(a.medianDaysToConfirm).toBe(3);
    expect(a.waiting).toBe(2);
  });
  it("counts what can't be read", () => {
    const channels = [
      ch("a", { read: "notRead", country: "US" }),
      ch("b", { read: "retrying" }),
      ch("c", { read: "gaveUp" }),
      ch("d", { country: "GB" }),
      ch("e", { read: "gaveUp", stage: "rejected" }),
    ];
    expect(report(inputs({ channels })).live.trust).toEqual({
      notRead: 1,
      retrying: 1,
      gaveUp: 1,
      noCountry: 2,
    });
  });
});

describe("waiting", () => {
  const D = L(2026, 10, 29); // tomorrow, midnight
  const channels = [
    ch("u", { stage: "rejected" }),
    ch("t1", {
      stage: "rejected",
      leavesAt: D + 3600_000,
      fit: 90,
      rejectReason: "views",
      keywords: ["k1"],
    }),
    ch("t2", {
      stage: "rejected",
      leavesAt: D + 7200_000,
      fit: 60,
      rejectReason: "views",
      keywords: ["k1", "k2"],
    }),
    ch("d3", {
      stage: "rejected",
      leavesAt: L(2026, 11, 1, 23),
      fit: 95,
      rejectReason: "ai",
      keywords: ["k2"],
    }),
    ch("far", { stage: "rejected", leavesAt: L(2026, 11, 20), fit: 99 }),
    ch("today", { stage: "rejected", leavesAt: NOW + 1000, fit: 99 }),
  ];
  const w = report(inputs({ channels })).waiting;
  it("splits dated and undated", () => {
    expect(w.dated).toBe(5);
    expect(w.undated).toBe(1);
  });
  it("counts the next 7 days, tomorrow first", () => {
    expect(w.leaving.map((x) => x.at)[0]).toBe(D);
    expect(w.leaving.map((x) => x.count)).toEqual([2, 0, 0, 1, 0, 0, 0]);
  });
  it("lists mistakes by fit then date, with totals", () => {
    expect(w.mistakes.total).toBe(4);
    expect(w.mistakes.tomorrow).toBe(1);
    expect(w.mistakes.top.map((m) => m.id)).toEqual(["today", "far", "d3", "t1"]);
    expect(w.mistakes.top[0]?.reason).toBe("unknown");
    expect(w.mistakes.top[2]?.reason).toBe("ai");
  });
  it("counts reasons and the top reason's first keywords", () => {
    expect(w.reasons[0]).toEqual({ reason: "unknown", count: 3 });
    const r2 = report(
      inputs({
        channels: [
          ...channels,
          ch("x", { stage: "rejected", rejectReason: "views", keywords: ["k2"] }),
          ch("y", { stage: "rejected", rejectReason: "views", keywords: ["k2"] }),
        ],
      }),
    ).waiting;
    expect(r2.reasons[0]).toEqual({ reason: "views", count: 4 });
    expect(r2.topReasonKeywords).toEqual([
      { keyword: "k1", count: 2 },
      { keyword: "k2", count: 2 },
    ]);
  });
  it("caps mistakes at 50", () => {
    const many = Array.from({ length: 80 }, (_, n) =>
      ch(`m${String(n)}`, { stage: "rejected", fit: 85 + (n % 15), leavesAt: D + n * 1000 }),
    );
    const m = report(inputs({ channels: many })).waiting.mistakes;
    expect(m.total).toBe(80);
    expect(m.top).toHaveLength(50);
    expect(m.top[0]?.fit).toBe(99);
    expect(m.top.map((x) => x.fit)).toEqual([...m.top.map((x) => x.fit)].sort((a, b) => b - a));
  });
  it("groups second looks by the reason they left", () => {
    const channels2 = [
      ch("a", { stage: "emailed" }),
      ch("b", { stage: "signed" }),
      ch("c", { stage: "shortlisted" }),
      ch("d"),
    ];
    const log = [
      logLine("a", "reject", NOW - 50 * DAY, "views"),
      logLine("a", "restore", NOW - 20 * DAY),
      logLine("b", "reject", NOW - 60 * DAY, "views"),
      logLine("b", "restore", NOW - 10 * DAY),
      logLine("c", "reject", NOW - 60 * DAY, "ai"),
      logLine("c", "restore", NOW - 10 * DAY),
      logLine("d", "restore", NOW - 5 * DAY),
      logLine("a", "restore", NOW - 200 * DAY),
    ];
    const s = report(inputs({ channels: channels2, log })).waiting.secondLooks;
    expect(s[0]).toEqual({ reason: "views", back: 2, emailed: 2, replied: 1, signed: 1 });
    expect(s).toContainEqual({ reason: "ai", back: 1, emailed: 0, replied: 0, signed: 0 });
    expect(s).toContainEqual({ reason: "unknown", back: 1, emailed: 0, replied: 0, signed: 0 });
  });
});

describe("archive", () => {
  it("passes totals through and works out brought back and growth", () => {
    const msg = (channelId: string, at: number, bounce = false): MessageFact => ({
      id: `${channelId}${String(at)}`,
      channelId,
      direction: "in",
      at,
      kind: null,
      followUp: null,
      mailbox: null,
      reading: null,
      bounce,
      edited: null,
      rewrite: null,
    });
    const weekly = Array.from({ length: 13 }, (_, n) => ({
      at: MON - (12 - n) * 7 * DAY,
      all: 100,
      byRules: n === 12 ? 1000 : 60,
    }));
    const r = report(
      inputs({
        log: [
          logLine("a", "restore", NOW - 10 * DAY),
          logLine("b", "restore", NOW - 10 * DAY),
          logLine("c", "restore", NOW - 10 * DAY),
        ],
        messages: [msg("a", NOW - DAY), msg("b", NOW - DAY, true), msg("c", NOW - 20 * DAY)],
        archive: {
          ...emptyArchive,
          total: 1300,
          byRules: 1000,
          byPerson: 300,
          refoundThisWeek: 4,
          ruleLabels: [{ label: "no videos", count: 5 }],
          personReasons: [{ reason: "ai", count: 3 }],
          weekly,
        },
      }),
    ).archive;
    expect(r.broughtBack).toEqual({ n: 1, d: 3 });
    expect(r.growthPerWeek).toBe(100);
    expect(r.growthByRulesPerWeek).toBe(60);
    expect(r).toMatchObject({ byRules: 1000, byPerson: 300, refoundThisWeek: 4 });
    expect(r.ruleLabels).toEqual([{ label: "no videos", count: 5 }]);
  });
  it("profiles live and waiting from the channels, nulls for unknowns", () => {
    const channels = [
      ch("a", {
        medianViews: 1000,
        subscribers: 10,
        country: "US",
        sponsored: true,
        hasAddress: true,
      }),
      ch("b", { medianViews: 3000, country: "DE", sponsored: false }),
      ch("c", { medianViews: null, country: null }),
      ch("w", { stage: "rejected" }),
    ];
    const [live, waiting, person, rules] = report(
      inputs({ channels, archive: { ...emptyArchive, person: { ...profile, medianViews: 5 } } }),
    ).archive.profiles;
    expect(live).toMatchObject({
      group: "live",
      medianViews: 2000,
      uploads30: null,
      subscribers: 10,
      sponsored: { n: 1, d: 2 },
      inMarkets: { n: 1, d: 2 },
      addressFound: { n: 1, d: 3 },
    });
    expect(waiting).toMatchObject({ group: "waiting", medianViews: null, sponsored: null });
    expect(person).toMatchObject({ group: "person", medianViews: 5 });
    expect(rules?.group).toBe("rules");
  });
});

describe("speed", () => {
  it("handles 12,000 channels in under 300 ms", () => {
    const stages = [null, "shortlisted", "emailed", "replied", "rejected", "parked"] as const;
    const channels = Array.from({ length: 12_000 }, (_, n) =>
      ch(`c${String(n)}`, {
        stage: stages[n % stages.length] ?? null,
        keywords: [`k${String(n % 40)}`, `k${String((n + 7) % 40)}`],
        foundAt: NOW - (n % 60) * DAY,
        leavesAt: n % 3 === 0 ? NOW + (n % 9) * DAY : null,
        fit: n % 100,
        medianViews: n,
      }),
    );
    const events = Array.from({ length: 12_000 }, (_, n) =>
      ev(`c${String(n)}`, n % 2 ? "shortlisted" : "rejected", NOW - (n % 90) * DAY),
    );
    const keywords = Array.from({ length: 40 }, (_, n) => kw(`k${String(n)}`));
    const i = inputs({ channels, events, keywords });
    const t0 = performance.now();
    const r = report(i);
    expect(performance.now() - t0).toBeLessThan(300);
    expect(r.counts.live + r.counts.waiting).toBe(12_000);
  });
});
