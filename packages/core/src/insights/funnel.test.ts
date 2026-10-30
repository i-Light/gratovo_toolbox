import { describe, expect, it } from "vitest";

import {
  biggestDrop,
  brandFunnel,
  brandReachedIds,
  brandStuckIds,
  cohorts,
  creatorFunnel,
  funnelExits,
  stepDays,
} from "./funnel";
import type { ChannelFacts, InsightsInputs, MessageFact, StageEvent } from "./inputs";
import { brand, deal } from "./test-inputs";
import { reportWindow } from "./stats";
import type { BrandFunnelRow, BrandStep, CreatorStep, FunnelRow } from "./types";

const L = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h).getTime();
const DAY = 86_400_000;
const NOW = L(2026, 10, 28, 12);

const emptyProfile = {
  medianViews: null,
  uploads30: null,
  subscribers: null,
  sponsored: null,
  inMarkets: null,
  addressFound: null,
};

/** A tiny builder: every field has a quiet default. */
function inputsWith(over: Partial<InsightsInputs> = {}): InsightsInputs {
  return {
    now: NOW,
    archiveDays: 90,
    channels: [],
    events: [],
    log: [],
    messages: [],
    inSequence: [],
    mailboxes: [],
    keywords: [],
    archive: {
      total: 0,
      byRules: 0,
      byPerson: 0,
      ruleLabels: [],
      personReasons: [],
      weekly: [],
      refoundThisWeek: 0,
      person: emptyProfile,
      rules: emptyProfile,
    },
    weeks: [],
    runs: [],
    goal: { signsPerMonth: 4, revenuePerMonth: null, overrides: {} },
    hidden: {},
    deals: [],
    brands: [],
    dealEvents: [],
    brandEvents: [],
    seesMoney: true,
    marginFloorPct: 25,
    ...over,
  };
}

function channel(id: string, over: Partial<ChannelFacts> = {}): ChannelFacts {
  return {
    id,
    name: id,
    handle: null,
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
    hasAddress: true,
    confirmedAt: null,
    addressSource: null,
    rejectReason: null,
    rejectedAt: null,
    leavesAt: null,
    audit: null,
    ...over,
  };
}

let seq = 0;
function msg(over: Partial<MessageFact> & Pick<MessageFact, "channelId" | "at">): MessageFact {
  seq += 1;
  return {
    id: `m${String(seq)}`,
    direction: "out",
    kind: "first",
    followUp: null,
    mailbox: "a@x.test",
    reading: null,
    bounce: false,
    edited: null,
    rewrite: null,
    ...over,
  };
}

const reply = (channelId: string, at: number, over: Partial<MessageFact> = {}): MessageFact =>
  msg({ channelId, at, direction: "in", kind: null, mailbox: null, ...over });

const window = reportWindow("30d", NOW);
const row = (rows: readonly FunnelRow[], step: CreatorStep): FunnelRow => {
  const r = rows.find((x) => x.step === step);
  if (!r) throw new Error(step);
  return r;
};

describe("empty inputs", () => {
  it("gives zeros and nulls and does not throw", () => {
    const empty = inputsWith();
    const rows = creatorFunnel(empty, window, "everyone");
    expect(rows).toHaveLength(12);
    expect(rows.every((r) => r.count === 0 && r.stuck === null && r.medianDays === null)).toBe(
      true,
    );
    expect(creatorFunnel(empty, window, "cohort").every((r) => r.count === 0)).toBe(true);
    expect(biggestDrop(rows)).toBeNull();
    const exits = funnelExits(empty, window);
    expect(exits.triage.every((t) => t.count === 0)).toBe(true);
    expect(exits.saidNo.every((t) => t.count === 0)).toBe(true);
    expect(exits.audience.every((t) => t.count === 0)).toBe(true);
    expect([exits.noAnswer, exits.stillInSequence, exits.bounced]).toEqual([0, 0, 0]);
    expect(stepDays(empty).every((s) => s.days === null)).toBe(true);
    expect(cohorts(empty)).toEqual({ rows: [], trend: "early" });
  });
});

describe("creatorFunnel membership", () => {
  it("counts found and passed from the catalog and the archive", () => {
    const i = inputsWith({
      channels: [channel("a"), channel("b"), channel("c", { inCatalog: false })],
      archive: { ...inputsWith().archive, total: 100, byRules: 90 },
    });
    const rows = creatorFunnel(i, window, "everyone");
    expect(row(rows, "found").count).toBe(102);
    expect(row(rows, "passed").count).toBe(12);
    expect(row(rows, "passed").byDesign).toBe(true);
    expect(row(rows, "found").byDesign).toBe(false);
    expect(row(rows, "found").fromPrev).toBeNull();
    expect(row(rows, "passed").fromPrev).toEqual({ n: 12, d: 102 });
  });

  it("counts a creator at a later stage as having passed the earlier ones", () => {
    const i = inputsWith({ channels: [channel("a", { stage: "replied" })] });
    const rows = creatorFunnel(i, window, "everyone");
    expect(rows.slice(2).map((r) => [r.step, r.count])).toEqual([
      ["shortlisted", 1],
      ["confirmed", 1],
      ["emailed", 1],
      ["replied", 1],
      ["interested", 0],
      ["kit", 0],
      ["audience", 0],
      ["signed", 0],
      ["firstDeal", 0],
      ["firstPayout", 0],
    ]);
  });

  it("takes confirmed from confirmedAt, and interested from the first reading", () => {
    const i = inputsWith({
      channels: [
        channel("a", { stage: "shortlisted", confirmedAt: NOW - DAY }),
        channel("b", { stage: "replied" }),
        channel("c", { stage: "replied" }),
        channel("d", { stage: "kit" }),
      ],
      messages: [
        msg({ channelId: "b", at: NOW - 3 * DAY }),
        reply("b", NOW - 2 * DAY, { reading: "question" }),
        msg({ channelId: "c", at: NOW - 3 * DAY }),
        reply("c", NOW - 2 * DAY, { reading: "no" }),
      ],
    });
    const rows = creatorFunnel(i, window, "everyone");
    expect(row(rows, "confirmed").count).toBe(4);
    expect(row(rows, "interested").count).toBe(2); // b by its reading, d by being at kit
    expect(row(rows, "kit").count).toBe(1);
  });

  it("does not count steps a rejected creator never reached", () => {
    const i = inputsWith({
      channels: [channel("a", { stage: "rejected" })],
      events: [{ channelId: "a", stage: "shortlisted", at: NOW - 5 * DAY }],
    });
    const rows = creatorFunnel(i, window, "everyone");
    expect(row(rows, "shortlisted").count).toBe(1);
    expect(row(rows, "confirmed").count).toBe(0);
  });

  it("shows the share, and the same share as of the end of the previous period", () => {
    const longAgo = window.previous.to - 10 * DAY;
    const recent = NOW - 2 * DAY;
    const channels = [0, 1, 2, 3].map((n) => channel(`c${String(n)}`, { stage: "emailed" }));
    const events: StageEvent[] = channels.flatMap((c, n) => [
      { channelId: c.id, stage: "shortlisted" as const, at: longAgo },
      { channelId: c.id, stage: "contact" as const, at: longAgo },
      { channelId: c.id, stage: "emailed" as const, at: n < 2 ? longAgo : recent },
    ]);
    const rows = creatorFunnel(inputsWith({ channels, events }), window, "everyone");
    expect(row(rows, "emailed").fromPrev).toEqual({ n: 4, d: 4 });
    expect(row(rows, "emailed").before).toEqual({ n: 2, d: 4 });
    expect(row(rows, "confirmed").before).toEqual({ n: 4, d: 4 });
    expect(row(rows, "shortlisted").before).toBeNull();
  });

  it("cohort mode follows only those first emailed in the period", () => {
    const channels = [
      channel("in1", { stage: "replied" }),
      channel("in2", { stage: "emailed" }),
      channel("old", { stage: "replied" }),
    ];
    const events: StageEvent[] = [
      { channelId: "in1", stage: "emailed", at: NOW - 5 * DAY },
      { channelId: "in2", stage: "emailed", at: NOW - 4 * DAY },
      { channelId: "old", stage: "emailed", at: NOW - 100 * DAY },
    ];
    const rows = creatorFunnel(inputsWith({ channels, events }), window, "cohort");
    expect(row(rows, "found").count).toBe(2);
    expect(row(rows, "shortlisted").count).toBe(2);
    expect(row(rows, "emailed").count).toBe(2);
    expect(row(rows, "replied").count).toBe(1);
    expect(row(rows, "replied").fromPrev).toEqual({ n: 1, d: 2 });
  });
});

describe("medianDays and stuck", () => {
  function population(): InsightsInputs {
    const channels: ChannelFacts[] = [];
    const events: StageEvent[] = [];
    for (let n = 0; n < 6; n += 1) {
      const id = `r${String(n)}`;
      channels.push(channel(id, { stage: "audience" }));
      events.push({ channelId: id, stage: "kit", at: NOW - 40 * DAY });
      events.push({ channelId: id, stage: "audience", at: NOW - 38 * DAY });
    }
    // Two creators waiting at "kit": one for 10 days (stuck), one for 3 days (not).
    channels.push(channel("old", { stage: "kit" }), channel("new", { stage: "kit" }));
    events.push({ channelId: "old", stage: "kit", at: NOW - 10 * DAY });
    events.push({ channelId: "new", stage: "kit", at: NOW - 3 * DAY });
    // A rejected creator is never stuck.
    channels.push(channel("gone", { stage: "rejected" }));
    events.push({ channelId: "gone", stage: "kit", at: NOW - 30 * DAY });
    return inputsWith({ channels, events });
  }

  it("takes the median days to the next step and counts those past twice that", () => {
    const rows = creatorFunnel(population(), window, "everyone");
    expect(row(rows, "kit").medianDays).toBe(2);
    expect(row(rows, "kit").stuck).toBe(1);
    // The follow-ups do the waiting at "emailed": never stuck there.
    expect(row(rows, "emailed").stuck).toBeNull();
    expect(row(rows, "audience").stuck).toBeNull(); // no median to the next step
    expect(row(rows, "found").stuck).toBeNull();
    expect(row(rows, "signed").stuck).toBeNull();
  });

  it("shows no median under 5 known times", () => {
    const i = inputsWith({
      channels: [channel("a", { stage: "replied" })],
      events: [
        { channelId: "a", stage: "emailed", at: NOW - 9 * DAY },
        { channelId: "a", stage: "replied", at: NOW - 7 * DAY },
      ],
    });
    const rows = creatorFunnel(i, window, "everyone");
    expect(row(rows, "emailed").medianDays).toBeNull();
    expect(row(rows, "emailed").stuck).toBeNull();
  });

  it("stepDays gives the median between consecutive steps", () => {
    const days = stepDays(population());
    expect(days).toHaveLength(9);
    expect(days.find((d) => d.from === "kit")).toEqual({
      from: "kit",
      to: "audience",
      days: 2,
    });
    expect(days[0]).toMatchObject({ from: "shortlisted", to: "confirmed" });
    expect(days[6]).toMatchObject({ from: "audience", to: "signed" });
  });
});

describe("biggestDrop", () => {
  const mk = (step: CreatorStep, n: number, d: number): FunnelRow => ({
    step,
    count: n,
    fromPrev: { n, d },
    before: null,
    medianDays: null,
    stuck: null,
    byDesign: step === "passed",
  });
  it("picks the lowest share with enough in the step above, never the rules or the review", () => {
    const rows = [
      mk("passed", 1, 1000), // lowest, but by design
      mk("shortlisted", 4, 1000), // lower than replied, but the review drops on purpose
      mk("emailed", 90, 100),
      mk("replied", 5, 90), // the pick
      mk("interested", 1, 5), // lower, but too few above
    ];
    expect(biggestDrop(rows)).toBe("replied");
  });
  it("returns null when no step has enough above it", () => {
    expect(biggestDrop([mk("replied", 1, 5)])).toBeNull();
    expect(biggestDrop([])).toBeNull();
  });
});

describe("funnelExits", () => {
  it("counts every exit", () => {
    const audit = { top: false, age: true, engagement: false, rate: null } as const;
    const said = (id: string, reading: MessageFact["reading"]) => [
      msg({ channelId: id, at: 1 }),
      reply(id, 2, { reading }),
    ];
    const i = inputsWith({
      channels: [
        channel("r1", { stage: "rejected" }),
        channel("r2", { stage: "rejected" }),
        channel("kit", { stage: "kit", audit }),
        channel("n1"),
        channel("n2"),
        channel("n3"),
        channel("n4"),
        channel("seq"),
        channel("bnc"),
        channel("noreply"),
      ],
      log: [
        { channelId: "r1", action: "reject", at: 1, reason: "views" },
        { channelId: "r1", action: "reject", at: 2, reason: "ai" }, // the latest wins
        { channelId: "r2", action: "reject", at: 1, reason: null },
      ],
      messages: [
        ...said("n1", "notNow"),
        ...said("n2", "no"),
        ...said("n3", "no"),
        ...said("n4", "manager"),
        msg({ channelId: "seq", at: 1 }),
        msg({ channelId: "bnc", at: 1 }),
        reply("bnc", 2, { bounce: true, reading: "bounce" }),
        msg({ channelId: "noreply", at: 1 }),
        msg({ channelId: "noreply", at: 5, kind: "followUp", followUp: 3 }),
      ],
      inSequence: ["seq"],
      archive: { ...inputsWith().archive, personReasons: [{ reason: "views", count: 7 }] },
    });
    const e = funnelExits(i, window);
    expect(Object.fromEntries(e.triage.map((t) => [t.reason, t.count]))).toEqual({
      ai: 1,
      views: 7,
      posting: 0,
      audience: 0,
      unknown: 1,
    });
    expect(Object.fromEntries(e.saidNo.map((t) => [t.kind, t.count]))).toEqual({
      notNow: 1,
      notInterested: 2,
      manager: 1,
      money: 0,
    });
    expect(Object.fromEntries(e.audience.map((t) => [t.check, t.count]))).toEqual({
      top: 1,
      age: 0,
      engagement: 1,
      rate: 0,
    });
    expect(e.noAnswer).toBe(1);
    expect(e.stillInSequence).toBe(1);
    expect(e.bounced).toBe(1);
  });
});

describe("cohorts", () => {
  const monday = (w: number) => L(2026, 8, 3) + w * 7 * DAY; // 3 Aug 2026 is a Monday

  /** `d` creators first emailed in a week; the first `n` replied `after` days later. */
  function week(w: number, d: number, n: number, tag: string, after = 1): MessageFact[] {
    const out: MessageFact[] = [];
    for (let k = 0; k < d; k += 1) {
      const sent = monday(w) + DAY + 3 * 3_600_000;
      out.push(msg({ channelId: `${tag}${String(w)}-${String(k)}`, at: sent }));
      if (k < n)
        out.push(
          reply(`${tag}${String(w)}-${String(k)}`, sent + after * DAY, {
            reading: "interested",
          }),
        );
    }
    return out;
  }

  it("groups by week, newest first, and leaves too-recent days null", () => {
    const thisWeek = L(2026, 10, 26);
    const i = inputsWith({
      messages: [
        ...week(5, 10, 4, "w", 2), // the week of 7 September: replies after 2 days
        ...[0, 1, 2].map((k) => msg({ channelId: `t${String(k)}`, at: thisWeek + DAY })),
      ],
    });
    const { rows } = cohorts(i);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.week).toBe(thisWeek);
    expect(rows[0]?.by).toEqual([null, null, null, null]);
    expect(rows[1]?.week).toBe(monday(5));
    expect(rows[1]?.emailed).toBe(10);
    expect(rows[1]?.by).toEqual([
      { n: 4, d: 10 },
      { n: 4, d: 10 },
      { n: 4, d: 10 },
      { n: 4, d: 10 },
    ]);
  });

  it("counts a reply by the day it came", () => {
    const { rows } = cohorts(inputsWith({ messages: week(5, 10, 4, "w", 5) }));
    expect(rows[0]?.by.map((r) => r?.n)).toEqual([0, 4, 4, 4]);
  });

  it("keeps at most 12 weeks", () => {
    const messages: MessageFact[] = [];
    for (let w = 0; w < 14; w += 1)
      messages.push(msg({ channelId: `c${String(w)}`, at: monday(w) + DAY }));
    expect(cohorts(inputsWith({ now: monday(30), messages })).rows).toHaveLength(12);
  });

  it("calls the trend clear when the newest weeks are worse, chance when better", () => {
    const worse: MessageFact[] = [];
    const better: MessageFact[] = [];
    for (let w = 0; w < 8; w += 1) {
      const recent = w >= 4;
      worse.push(...week(w, 50, recent ? 2 : 10, "a"));
      better.push(...week(w, 50, recent ? 10 : 2, "b"));
    }
    expect(cohorts(inputsWith({ messages: worse })).trend).toBe("clear");
    expect(cohorts(inputsWith({ messages: better })).trend).toBe("chance");
  });

  it("is early with fewer than 50 emails a side", () => {
    expect(cohorts(inputsWith({ messages: week(0, 10, 2, "a") })).trend).toBe("early");
  });
});

describe("first deal and first payout", () => {
  /** Six signed creators, each with a deal made 5 days after signing; two of them were paid. */
  function signed(): InsightsInputs {
    const channels: ChannelFacts[] = [];
    const events: StageEvent[] = [];
    const deals = [];
    for (let n = 0; n < 6; n += 1) {
      const id = `s${String(n)}`;
      channels.push(channel(id, { stage: "signed" }));
      events.push({ channelId: id, stage: "signed", at: NOW - 60 * DAY });
      deals.push(
        deal(`d${String(n)}`, {
          creatorId: id,
          createdAt: NOW - 55 * DAY,
          paidCreatorAt: n < 2 ? NOW - 20 * DAY : null,
        }),
      );
    }
    // Signed 40 days ago, still no deal; signed 5 days ago.
    channels.push(channel("idle", { stage: "signed" }), channel("fresh", { stage: "signed" }));
    events.push({ channelId: "idle", stage: "signed", at: NOW - 40 * DAY });
    events.push({ channelId: "fresh", stage: "signed", at: NOW - 5 * DAY });
    return inputsWith({ channels, events, deals });
  }

  it("counts creators with a deal, and with a deal the creator was paid for", () => {
    const rows = creatorFunnel(signed(), window, "everyone");
    expect(row(rows, "signed").count).toBe(8);
    expect(row(rows, "firstDeal").count).toBe(6);
    expect(row(rows, "firstDeal").fromPrev).toEqual({ n: 6, d: 8 });
    expect(row(rows, "firstPayout").count).toBe(2);
    expect(row(rows, "firstPayout").fromPrev).toEqual({ n: 2, d: 6 });
  });

  it("takes the usual days from signing to the first deal, and who is stuck", () => {
    const rows = creatorFunnel(signed(), window, "everyone");
    expect(row(rows, "signed").medianDays).toBe(5);
    expect(row(rows, "signed").stuck).toBe(1); // "idle": 40 days with no deal; "fresh": 5
    expect(row(rows, "firstPayout").stuck).toBeNull();
    expect(row(rows, "firstPayout").medianDays).toBeNull();
    expect(row(rows, "firstDeal").medianDays).toBeNull(); // only 2 deal-to-payout times known
  });

  it("a deal for a creator with no channel row still counts them", () => {
    const rows = creatorFunnel(
      inputsWith({ deals: [deal("x", { creatorId: "ghost" })] }),
      window,
      "everyone",
    );
    expect(row(rows, "firstDeal").count).toBe(1);
    expect(row(rows, "signed").count).toBe(1);
  });

  it("the previous period's share counts only what happened by then", () => {
    const rows = creatorFunnel(signed(), window, "everyone");
    // By the end of the previous period (60 days ago to 30 days ago ends at -30d) six deals existed.
    expect(row(rows, "firstDeal").before).toEqual({ n: 6, d: 7 });
  });
});

describe("the brand funnel", () => {
  const stepRow = (rows: readonly BrandFunnelRow[], step: BrandStep) =>
    rows.find((r) => r.step === step);

  /** Eight brands; six won with times known; a lost one that was pitched; a found one. */
  function brands(): InsightsInputs {
    const list = [];
    const events = [];
    const deals = [];
    for (let n = 0; n < 6; n += 1) {
      const id = `w${String(n)}`;
      list.push(brand(id, { status: "won", since: NOW - 80 * DAY }));
      events.push(
        { brandId: id, status: "qualified" as const, at: NOW - 78 * DAY },
        { brandId: id, status: "pitched" as const, at: NOW - 74 * DAY },
        { brandId: id, status: "negotiating" as const, at: NOW - 70 * DAY },
        { brandId: id, status: "won" as const, at: NOW - 66 * DAY },
      );
      if (n < 3)
        deals.push(deal(`b${String(n)}`, { brandId: id, step: 6, goLiveAt: NOW - 50 * DAY }));
      if (n < 1)
        deals.push(deal(`p${String(n)}`, { brandId: id, step: 9, invoicePaidAt: NOW - 10 * DAY }));
    }
    list.push(brand("lost1", { status: "lost", since: NOW - 60 * DAY }));
    events.push(
      { brandId: "lost1", status: "pitched" as const, at: NOW - 50 * DAY },
      { brandId: "lost1", status: "lost" as const, at: NOW - 20 * DAY },
    );
    // Qualified 40 days ago: stuck at qualified (the usual is 4 days).
    list.push(brand("slow", { status: "qualified", since: NOW - 50 * DAY }));
    events.push({ brandId: "slow", status: "qualified" as const, at: NOW - 40 * DAY });
    list.push(brand("new", { status: "found", since: NOW - 2 * DAY }));
    return inputsWith({ brands: list, brandEvents: events, deals });
  }

  const f = brandFunnel(brands(), window);

  it("counts a brand at every step up to the furthest it reached", () => {
    expect(f.rows.map((r) => [r.step, r.count])).toEqual([
      ["found", 9],
      ["qualified", 8],
      ["pitched", 7],
      ["replied", 6],
      ["negotiating", 6],
      ["won", 6],
      ["live", 3],
      ["paid", 1],
    ]);
    expect(stepRow(f.rows, "qualified")).toMatchObject({ fromPrev: { n: 8, d: 9 } });
    expect(f.rows[0]?.fromPrev).toBeNull();
  });

  it("works out the usual days and who is stuck", () => {
    expect(stepRow(f.rows, "qualified")).toMatchObject({ medianDays: 4, stuck: 1 });
    expect(brandStuckIds(brands(), "qualified")).toEqual(["slow"]);
    expect(stepRow(f.rows, "replied")?.stuck).toBeNull();
    expect(stepRow(f.rows, "paid")?.stuck).toBeNull();
    expect(stepRow(f.rows, "won")?.medianDays).toBeNull(); // won to live: only 3 known
  });

  it("compares with the end of the previous period", () => {
    // Previous period ends 30 days ago: the six won brands were all at "won" by then.
    expect(stepRow(f.rows, "won")?.before).toEqual({ n: 6, d: 6 });
    expect(stepRow(f.rows, "live")?.before).toEqual({ n: 3, d: 6 }); // their go-live was 50 days ago
    expect(f.rows[0]?.before).toBeNull();
  });

  it("lists lost brands by the last step they reached, and names the biggest drop", () => {
    expect(f.lost).toEqual([{ step: "pitched", count: 1 }]);
    expect(f.biggestDrop).toBeNull(); // under 20 brands above every step
    const many = Array.from({ length: 30 }, (_, n) =>
      brand(`m${String(n)}`, { status: n < 10 ? "qualified" : "found" }),
    );
    expect(brandFunnel(inputsWith({ brands: many }), window).biggestDrop).toBe("qualified");
  });

  it("lists the brands behind a count", () => {
    expect(brandReachedIds(brands(), "pitched")).toHaveLength(7);
    expect(brandReachedIds(brands(), "paid")).toEqual(["w0"]);
  });

  it("is empty without brands", () => {
    const e = brandFunnel(inputsWith(), window);
    expect(e.rows.every((r) => r.count === 0)).toBe(true);
    expect(e.biggestDrop).toBeNull();
    expect(e.lost).toEqual([]);
  });
});
