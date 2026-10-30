import { describe, expect, it } from "vitest";

import { batches, diagnose, emailsReport, patterns } from "./emails";
import type { ChannelFacts, InsightsInputs, MailboxFacts, MessageFact } from "./inputs";
import { reportWindow } from "./stats";

const L = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h).getTime();
const DAY = 86_400_000;
const HOUR = 3_600_000;
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

function mailbox(address: string, over: Partial<MailboxFacts> = {}): MailboxFacts {
  return {
    address,
    dailyCap: 30,
    warmupStartedAt: null,
    warmupDays: null,
    heldAt: null,
    paused: false,
    ...over,
  };
}

let seq = 0;
function out(channelId: string, at: number, over: Partial<MessageFact> = {}): MessageFact {
  seq += 1;
  return {
    id: `m${String(seq)}`,
    channelId,
    direction: "out",
    at,
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

function incoming(channelId: string, at: number, over: Partial<MessageFact> = {}): MessageFact {
  return out(channelId, at, { direction: "in", kind: null, mailbox: null, ...over });
}

const bounce = (channelId: string, at: number): MessageFact =>
  incoming(channelId, at, { bounce: true, reading: "bounce" });

const window7 = reportWindow("7d", NOW);

describe("empty inputs", () => {
  it("gives zeros and nulls and does not throw", () => {
    const r = emailsReport(inputsWith(), window7);
    expect(r.sent).toBe(0);
    expect(r.rate).toEqual({ n: 0, d: 0 });
    expect(r.rateVerdict).toBe("early");
    expect(r.daily.length).toBeGreaterThanOrEqual(7);
    expect(r.daily.every((d) => d.sent === 0 && d.replies === 0)).toBe(true);
    expect(r.bySteps).toHaveLength(4);
    expect(r.bySteps.every((s) => s.rate.n === 0 && s.share.d === 0)).toBe(true);
    expect(r.readings.map((x) => x.kind)).not.toContain("bounce");
    expect(r.readings.every((x) => x.count === 0)).toBe(true);
    expect(r.positive).toEqual({ n: 0, d: 0 });
    expect(r.batches).toEqual([]);
    expect(r.patterns).toEqual([]);
    expect(r.answer).toEqual({ medianHours: null, overDay: 0, verdict: "early" });
    expect(r.mailboxes).toEqual([]);
    expect(r.capacity).toEqual({ n: 0, d: 0 });
  });
});

describe("daily, rate and verdict", () => {
  it("counts sends and non-bounce replies per local day, and the rate of emails", () => {
    const day = L(2026, 10, 26, 9);
    const messages = [
      out("a", day),
      out("b", day + HOUR),
      out("c", day + DAY, { kind: "followUp", followUp: 1 }),
      out("d", day, { kind: "reply" }), // an answer, not a send
      incoming("a", day + 2 * HOUR, { reading: "interested" }),
      bounce("b", day + 3 * HOUR),
      out("old", NOW - 20 * DAY), // in the previous span? no: before it
    ];
    const r = emailsReport(inputsWith({ messages }), window7);
    const d26 = r.daily.find((x) => x.at === L(2026, 10, 26));
    const d27 = r.daily.find((x) => x.at === L(2026, 10, 27));
    expect(d26).toEqual({ at: L(2026, 10, 26), sent: 2, replies: 1 });
    expect(d27?.sent).toBe(1);
    expect(r.daily[r.daily.length - 1]?.at).toBe(L(2026, 10, 28));
    expect(r.sent).toBe(3);
    expect(r.rate).toEqual({ n: 1, d: 3 });
    expect(r.rateVerdict).toBe("early");
  });

  it("measures the previous span and judges against the floor", () => {
    const messages: MessageFact[] = [];
    for (let k = 0; k < 100; k += 1) messages.push(out(`c${String(k)}`, NOW - 2 * DAY));
    messages.push(incoming("c0", NOW - DAY)); // 1%: under half of 4%
    for (let k = 0; k < 50; k += 1) messages.push(out(`p${String(k)}`, NOW - 9 * DAY));
    for (let k = 0; k < 5; k += 1) messages.push(incoming(`p${String(k)}`, NOW - 8 * DAY));
    const r = emailsReport(inputsWith({ messages }), window7);
    expect(r.rate).toEqual({ n: 1, d: 100 });
    expect(r.rateBefore).toEqual({ n: 5, d: 50 });
    expect(r.rateVerdict).toBe("act");
  });
});

describe("bySteps and readings", () => {
  it("credits a reply to the latest email before it", () => {
    const t = NOW - 30 * DAY;
    const messages = [
      out("a", t),
      out("a", t + 3 * DAY, { kind: "followUp", followUp: 1 }),
      incoming("a", t + 4 * DAY, { reading: "interested" }), // credited to follow-up 1
      out("b", t),
      incoming("b", t + DAY, { reading: "no" }), // credited to the first email
      out("c", t),
      out("c", t + 3 * DAY, { kind: "followUp", followUp: 2 }),
      bounce("c", t + 4 * DAY), // not a reply
    ];
    const steps = emailsReport(inputsWith({ messages }), window7).bySteps;
    expect(steps.map((s) => s.step)).toEqual([0, 1, 2, 3]);
    expect(steps[0]).toEqual({ step: 0, rate: { n: 1, d: 3 }, share: { n: 1, d: 2 } });
    expect(steps[1]).toEqual({ step: 1, rate: { n: 1, d: 1 }, share: { n: 1, d: 2 } });
    expect(steps[2]?.rate).toEqual({ n: 0, d: 1 });
  });

  it("counts readings in order, leaves out bounces and old replies, and gives the positive rate", () => {
    const messages = [
      incoming("a", NOW - DAY, { reading: "interested" }),
      incoming("b", NOW - DAY, { reading: "question" }),
      incoming("c", NOW - DAY, { reading: "no" }),
      incoming("d", NOW - DAY, { reading: "no" }),
      incoming("e", NOW - DAY, { reading: null }),
      bounce("f", NOW - DAY),
      incoming("g", NOW - 100 * DAY, { reading: "rate" }),
    ];
    const r = emailsReport(inputsWith({ messages }), window7);
    expect(r.readings.map((x) => x.kind)).toEqual([
      "interested",
      "question",
      "rate",
      "notNow",
      "no",
      "manager",
      "auto",
      "other",
    ]);
    expect(r.readings.find((x) => x.kind === "no")?.count).toBe(2);
    expect(r.positive).toEqual({ n: 2, d: 4 });
  });
});

describe("diagnose", () => {
  const b = (over: Partial<Parameters<typeof diagnose>[0]>) =>
    diagnose({
      index: 1,
      from: 0,
      to: 0,
      sent: 50,
      bounced: 0,
      replied: 10,
      positive: 8,
      signed: 0,
      bounceMailbox: null,
      ...over,
    });
  it("follows the rules in order", () => {
    expect(b({ sent: 49, bounced: 20 })).toBe("early");
    expect(b({ sent: 0, replied: 0, positive: 0 })).toBe("early");
    expect(b({ bounced: 2 })).toBe("delivery"); // 4%
    expect(b({ bounced: 1 })).toBe("healthy"); // 2%
    expect(b({ replied: 1, positive: 1 })).toBe("writing"); // 2% under the floor
    expect(b({ replied: 10, positive: 4 })).toBe("targeting");
    expect(b({ replied: 10, positive: 5 })).toBe("healthy");
    expect(b({ replied: 0, positive: 0 })).toBe("writing");
  });
});

describe("batches", () => {
  function build() {
    const messages: MessageFact[] = [];
    const channels: ChannelFacts[] = [];
    for (let k = 0; k < 120; k += 1) {
      const id = `c${String(k)}`;
      const sent = NOW - (130 - k) * HOUR;
      messages.push(out(id, sent, { mailbox: k < 4 ? "bad@x.test" : "a@x.test" }));
      if (k < 4) messages.push(bounce(id, sent + HOUR)); // batch 1: 4 of 50 bounced
      if (k >= 50 && k < 60) {
        // batch 2: 10 replied, 3 positive
        messages.push(incoming(id, sent + HOUR, { reading: k < 53 ? "interested" : "no" }));
      }
      channels.push(channel(id, { stage: k === 60 ? "signed" : null }));
    }
    return inputsWith({ messages, channels });
  }

  it("cuts first emails into 50s, newest first, and counts each part", () => {
    const bs = batches(build());
    expect(bs.map((x) => [x.index, x.sent])).toEqual([
      [3, 20],
      [2, 50],
      [1, 50],
    ]);
    const [b3, b2, b1] = bs;
    expect(b1).toMatchObject({
      bounced: 4,
      replied: 0,
      diagnosis: "delivery",
      bounceMailbox: "bad@x.test",
    });
    expect(b2).toMatchObject({
      bounced: 0,
      replied: 10,
      positive: 3,
      signed: 1,
      diagnosis: "targeting",
      bounceMailbox: null,
    });
    expect(b3?.diagnosis).toBe("early");
    expect(b1?.from).toBeLessThan(b1?.to ?? 0);
  });

  it("gives no mailbox when no one mailbox has over half the bounces", () => {
    const messages: MessageFact[] = [];
    for (let k = 0; k < 50; k += 1) {
      messages.push(
        out(`c${String(k)}`, NOW - (60 - k) * HOUR, { mailbox: k % 2 === 0 ? "x@x" : "y@x" }),
      );
      if (k < 4) messages.push(bounce(`c${String(k)}`, NOW - (59 - k) * HOUR));
    }
    expect(batches(inputsWith({ messages }))[0]?.bounceMailbox).toBeNull();
  });

  it("keeps at most 12 batches", () => {
    const messages: MessageFact[] = [];
    for (let k = 0; k < 14 * 50; k += 1)
      messages.push(out(`c${String(k)}`, NOW - (1000 - k) * HOUR));
    const bs = batches(inputsWith({ messages }));
    expect(bs).toHaveLength(12);
    expect(bs[0]?.index).toBe(14);
  });
});

describe("patterns", () => {
  /** `n` first emails with the given flags; the first `replied` of them were answered. */
  function group(
    tag: string,
    n: number,
    replied: number,
    first: Partial<MessageFact>,
    channelOver: Partial<ChannelFacts> = {},
  ) {
    const messages: MessageFact[] = [];
    const channels: ChannelFacts[] = [];
    // Tuesday 20 Oct 2026, 10:00: one weekday and one hour band for everyone.
    const sent = L(2026, 10, 20, 10);
    for (let k = 0; k < n; k += 1) {
      const id = `${tag}${String(k)}`;
      messages.push(out(id, sent, first));
      if (k < replied) messages.push(incoming(id, sent + DAY, { reading: "interested" }));
      channels.push(channel(id, channelOver));
    }
    return { messages, channels };
  }
  const merge = (...parts: ReturnType<typeof group>[]) =>
    inputsWith({
      messages: parts.flatMap((p) => p.messages),
      channels: parts.flatMap((p) => p.channels),
    });

  it("finds a clear split, with the better group as best", () => {
    const i = merge(group("e", 100, 30, { edited: true }), group("w", 100, 10, { edited: false }));
    const edited = patterns(i).find((s) => s.kind === "edited");
    expect(edited?.result).toBe("clear");
    expect(edited?.best).toBe("edited");
    expect(edited?.groups).toEqual([
      { key: "edited", rate: { n: 30, d: 100 } },
      { key: "asWritten", rate: { n: 10, d: 100 } },
    ]);
  });

  it("calls a small gap chance and names no best", () => {
    const i = merge(group("e", 100, 10, { edited: true }), group("w", 100, 12, { edited: false }));
    const edited = patterns(i).find((s) => s.kind === "edited");
    expect(edited?.result).toBe("chance");
    expect(edited?.best).toBeNull();
  });

  it("drops groups under 20 emails and splits with fewer than 2 groups", () => {
    const i = merge(group("e", 100, 30, { edited: true }), group("w", 19, 10, { edited: false }));
    const kinds = patterns(i).map((s) => s.kind);
    expect(kinds).not.toContain("edited");
    expect(kinds).not.toContain("weekday"); // everyone sent on one weekday
    expect(kinds).not.toContain("hour");
  });

  it("skips unknown values, is early under 50 a side, and puts clear splits first", () => {
    const i = merge(
      group(
        "a",
        100,
        30,
        { edited: true, rewrite: "Shorter" },
        { medianViews: 20_000, country: "US" },
      ),
      group("b", 100, 10, { edited: false }, { medianViews: 90_000, country: "US" }),
      group("c", 30, 5, { edited: null }, { medianViews: 90_000, country: "GB" }),
      group("d", 30, 6, { edited: null }, { medianViews: 200_000, country: "GB" }),
    );
    const ps = patterns(i);
    const size = ps.find((s) => s.kind === "size");
    expect(size?.groups.map((g) => g.key)).toEqual(["under50k", "50kTo150k", "over150k"]);
    const country = ps.find((s) => s.kind === "country");
    expect(country?.groups.map((g) => g.key).sort()).toEqual(["GB", "US"]);
    const rewrite = ps.find((s) => s.kind === "rewrite");
    expect(rewrite?.groups.map((g) => g.key).sort()).toEqual(["Shorter", "none"]);
    const firstChance = ps.findIndex((s) => s.result !== "clear");
    const lastClear = ps.map((s) => s.result).lastIndexOf("clear");
    expect(lastClear).toBeLessThan(firstChance === -1 ? ps.length : firstChance);
    expect(ps.find((s) => s.kind === "edited")?.groups.map((g) => g.key)).toEqual([
      "edited",
      "asWritten",
    ]);
  });

  it("splits by weekday and send hour band", () => {
    const monday = L(2026, 10, 19, 9);
    const saturday = L(2026, 10, 24, 21);
    const messages: MessageFact[] = [];
    for (let k = 0; k < 25; k += 1) {
      messages.push(out(`m${String(k)}`, monday));
      messages.push(out(`s${String(k)}`, saturday));
    }
    const ps = patterns(inputsWith({ messages }));
    expect(
      ps
        .find((s) => s.kind === "weekday")
        ?.groups.map((g) => g.key)
        .sort(),
    ).toEqual(["mon", "sat"]);
    expect(
      ps
        .find((s) => s.kind === "hour")
        ?.groups.map((g) => g.key)
        .sort(),
    ).toEqual(["18to23", "6to11"]);
  });
});

describe("answer", () => {
  it("takes the median hours to our answer and counts those waiting over a day", () => {
    const t = NOW - 5 * DAY;
    const messages: MessageFact[] = [];
    [2, 4, 6].forEach((h, k) => {
      messages.push(incoming(`a${String(k)}`, t));
      messages.push(out(`a${String(k)}`, t + h * HOUR, { kind: "reply" }));
    });
    messages.push(incoming("late", t), out("late", t + 30 * HOUR, { kind: "reply" }));
    messages.push(incoming("none", t)); // never answered: waiting 5 days
    messages.push(bounce("bnc", t)); // not counted
    const a = emailsReport(inputsWith({ messages }), window7).answer;
    expect(a.medianHours).toBe(5); // 2, 4, 6, 30
    expect(a.overDay).toBe(2);
    expect(a.verdict).toBe("watch");
  });

  it("is good when quick and nobody waits, and early under 5 replies", () => {
    const t = NOW - 5 * DAY;
    const quick: MessageFact[] = [];
    for (let k = 0; k < 5; k += 1) {
      quick.push(
        incoming(`q${String(k)}`, t),
        out(`q${String(k)}`, t + 3 * HOUR, { kind: "reply" }),
      );
    }
    expect(emailsReport(inputsWith({ messages: quick }), window7).answer).toEqual({
      medianHours: 3,
      overDay: 0,
      verdict: "good",
    });
    expect(emailsReport(inputsWith({ messages: quick.slice(0, 4) }), window7).answer.verdict).toBe(
      "early",
    );
  });

  it("ignores replies older than 30 days", () => {
    const old = [incoming("o", NOW - 40 * DAY)];
    expect(emailsReport(inputsWith({ messages: old }), window7).answer.overDay).toBe(0);
  });
});

describe("mailboxes", () => {
  it("works out sent, room, bounces, replies, warm-up, verdict and capacity", () => {
    const messages: MessageFact[] = [];
    for (let k = 0; k < 25; k += 1) {
      messages.push(out(`a${String(k)}`, NOW - 2 * DAY, { mailbox: "a@x.test" }));
      if (k < 2) messages.push(incoming(`a${String(k)}`, NOW - DAY, { reading: "interested" }));
    }
    messages.push(bounce("a24", NOW - DAY)); // 1 bounce in reply to a@x.test's send
    for (let k = 0; k < 5; k += 1)
      messages.push(out(`b${String(k)}`, NOW - DAY, { mailbox: "b@x.test" }));
    messages.push(out("old", NOW - 20 * DAY, { mailbox: "a@x.test" })); // outside 7 days, inside 30
    messages.push(out("fu", NOW - DAY, { mailbox: "a@x.test", kind: "followUp", followUp: 1 }));
    const r = emailsReport(
      inputsWith({
        messages,
        mailboxes: [
          mailbox("a@x.test"),
          mailbox("b@x.test", { heldAt: 20, warmupStartedAt: NOW - 3 * DAY, warmupDays: 14 }),
          mailbox("c@x.test", { paused: true }),
        ],
      }),
      window7,
    );
    const [a, b, c] = r.mailboxes;
    expect(a).toMatchObject({
      address: "a@x.test",
      sent: 26,
      room: 210,
      bounced: { n: 1, d: 26 },
      replies: { n: 2, d: 26 },
      warmupDay: null,
      verdict: "act",
    });
    expect(b).toMatchObject({ sent: 5, room: 140, warmupDay: 4, warmupDays: 14, heldAt: 20 });
    expect(b?.verdict).toBe("early");
    expect(c).toMatchObject({ sent: 0, room: 0, verdict: "early" });
    expect(r.capacity).toEqual({ n: 31, d: 350 });
  });

  it("is good with enough sends and few bounces", () => {
    const messages: MessageFact[] = [];
    for (let k = 0; k < 40; k += 1) messages.push(out(`g${String(k)}`, NOW - DAY));
    messages.push(bounce("g0", NOW - HOUR));
    const r = emailsReport(inputsWith({ messages, mailboxes: [mailbox("a@x.test")] }), window7);
    expect(r.mailboxes[0]?.verdict).toBe("good"); // 1 of 40 is 2.5%
  });
});
