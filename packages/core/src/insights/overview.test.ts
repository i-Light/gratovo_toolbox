import { describe, expect, it } from "vitest";

import { overviewReport, readyIds, repliesWaitingList } from "./overview";
import { reportWindow } from "./stats";
import { ch, DAY, deal, ev, incoming, inputs, L, NOW, out } from "./test-inputs";
import type { DealFact, InsightsInputs } from "./inputs";
import { creatorSteps } from "./types";

const win = reportWindow("30d", NOW);
const report = (i: InsightsInputs) => overviewReport(i, win);

/** `n` first emails spread over the last 10 days, each to its own creator. */
function sends(n: number, prefix = "s") {
  return Array.from({ length: n }, (_, i) =>
    out(`${prefix}${String(i)}`, NOW - (1 + (i % 9)) * DAY - 3_600_000),
  );
}

describe("overviewReport on empty inputs", () => {
  it("builds with early verdicts and no unknowns shown as zero", () => {
    const r = report(inputs());
    expect(r.vitals.emails).toMatchObject({ sent: 0, verdict: "early" });
    expect(r.vitals.replyRate.verdict).toBe("early");
    expect(r.vitals.replyRate.difference).toBe("early");
    expect(r.vitals.signedPer1000.verdict).toBe("early");
    expect(r.vitals.fuel).toMatchObject({ ready: 0, days: null, verdict: "early" });
    expect(r.vitals.repliesWaiting).toEqual({ count: 0, oldestAt: null, verdict: "good" });
    expect(r.summary.map((s) => s.kind)).toEqual(["sent", "replies", "quiet"]);
    expect(r.attention).toEqual([]);
    expect(r.hidden).toBe(0);
    expect(r.wins).toEqual([]);
    expect(r.pipeline).toHaveLength(creatorSteps.length);
    expect(r.vitals.emails.trend).toHaveLength(14);
    expect(r.vitals.replyRate.trend).toHaveLength(8);
    expect(r.vitals.replyRate.trend.every((p) => p.value === null)).toBe(true);
  });
});

describe("vitals", () => {
  it("emails: first emails a working day against what the goal needs", () => {
    const needed = report(inputs()).vitals.emails.neededPerDay;
    expect(needed).toBeGreaterThan(0);
    const few = report(inputs({ messages: sends(10) })).vitals.emails;
    expect(few.sent).toBe(10);
    expect(few.firstEmails).toBe(10);
    expect(few.firstPerDay).toBeCloseTo(10 / win.workingDays);
    expect(few.verdict).toBe("watch");
    const many = report(
      inputs({ messages: sends(Math.ceil((needed ?? 0) * win.workingDays) + 1) }),
    );
    expect(many.vitals.emails.verdict).toBe("good");
    expect(many.summary[0]).toMatchObject({ kind: "sent", onPace: true });
  });

  it("emails: before counts the previous span, and the change is the difference", () => {
    const messages = [...sends(4), out("old", NOW - 40 * DAY), out("old2", NOW - 41 * DAY)];
    const r = report(inputs({ messages }));
    expect(r.vitals.emails).toMatchObject({ sent: 4, before: 2 });
    expect(r.summary[0]).toMatchObject({ kind: "sent", sent: 4, change: 2 });
  });

  it("no goal: early", () => {
    const r = report(
      inputs({
        messages: sends(10),
        goal: { signsPerMonth: 0, revenuePerMonth: null, overrides: {} },
      }),
    );
    expect(r.vitals.emails.neededPerDay).toBeNull();
    expect(r.vitals.emails.verdict).toBe("early");
  });

  it("reply rate: replies over emails sent, with a verdict and a difference", () => {
    const messages = [
      ...sends(100),
      ...Array.from({ length: 2 }, (_, i) => incoming(`s${String(i)}`, NOW - DAY)),
    ];
    const r = report(inputs({ messages })).vitals.replyRate;
    expect(r.now).toEqual({ n: 2, d: 100 });
    expect(r.verdict).toBe("watch"); // 2% is under 4% but not under 2%
    expect(r.difference).toBe("early"); // nothing before
    expect(r.trend.some((p) => p.value !== null)).toBe(true);
  });

  it("signed per 1,000: early under 500 emails, then against 5", () => {
    const signed = (n: number) =>
      Array.from({ length: n }, (_, i) => ev(`g${String(i)}`, "signed", NOW - 2 * DAY));
    const few = report(inputs({ messages: sends(499), events: signed(5) })).vitals.signedPer1000;
    expect(few.verdict).toBe("early");
    expect(few.now).toEqual({ n: 5, d: 499 });
    const good = report(inputs({ messages: sends(500), events: signed(3) })).vitals.signedPer1000;
    expect(good.verdict).toBe("good"); // 6 per 1,000
    const low = report(inputs({ messages: sends(500), events: signed(2) })).vitals.signedPer1000;
    expect(low.verdict).toBe("watch");
    expect(low.ninety).toEqual({ n: 2, d: 500 });
  });

  it("fuel: ready creators as days of sending", () => {
    // 10 first emails in the last 14 days over 10 working days: one a working day.
    const base = sends(10);
    const ready = (n: number) =>
      Array.from({ length: n }, (_, i) => ch(`r${String(i)}`, { stage: "contact" }));
    const fuel = (n: number) => report(inputs({ messages: base, channels: ready(n) })).vitals.fuel;
    expect(fuel(0)).toMatchObject({ days: 0, verdict: "act" });
    expect(fuel(2)).toMatchObject({ days: 2, verdict: "watch" });
    expect(fuel(3)).toMatchObject({ days: 3, verdict: "good" });
    expect(fuel(5).firstPerDay).toBeCloseTo(1);
  });

  it("fuel: counts shortlisted with a confirmed address, not those already emailed", () => {
    const channels = [
      ch("a", { stage: "contact" }),
      ch("b", { stage: "shortlisted", confirmedAt: NOW - DAY }),
      ch("c", { stage: "shortlisted" }),
      ch("d", { stage: "contact" }),
      ch("e", { stage: "rejected", confirmedAt: NOW - DAY }),
    ];
    const messages = [out("d", NOW - 100 * DAY)];
    expect(readyIds(inputs({ channels, messages })).sort()).toEqual(["a", "b"]);
  });

  it("fuel: waiting to be confirmed comes from the search report", () => {
    const channels = [
      ch("a", { stage: "shortlisted", hasAddress: true }),
      ch("b", { stage: "shortlisted", hasAddress: true }),
    ];
    expect(report(inputs({ channels })).vitals.fuel.waitingConfirm).toBe(2);
  });

  it("replies waiting: newest message is a reply that is not a bounce", () => {
    const messages = [
      out("a", NOW - 5 * DAY),
      incoming("a", NOW - 3 * DAY),
      out("b", NOW - 5 * DAY),
      incoming("b", NOW - 3 * DAY),
      out("b", NOW - 2 * DAY, { kind: "reply" }),
      out("c", NOW - 5 * DAY),
      incoming("c", NOW - DAY, { bounce: true }),
      out("d", NOW - 5 * DAY),
      incoming("d", NOW - 2 * DAY),
    ];
    const i = inputs({ messages });
    expect(
      repliesWaitingList(i)
        .map((r) => r.id)
        .sort(),
    ).toEqual(["a", "d"]);
    expect(report(i).vitals.repliesWaiting).toEqual({
      count: 2,
      oldestAt: NOW - 3 * DAY,
      verdict: "watch",
    });
    const fresh = inputs({ messages: [incoming("z", NOW - 3_600_000)] });
    expect(report(fresh).vitals.repliesWaiting.verdict).toBe("good");
  });
});

describe("attention, summary and wins", () => {
  it("lists alerts, and puts the act-now ones in the summary", () => {
    // Fuel is out: sending a day, nothing ready.
    const r = report(inputs({ messages: sends(10) }));
    const fuel = r.attention.find((l) => l.alert.kind === "fuelLow");
    expect(fuel).toMatchObject({ verdict: "act", go: { screen: "find", tab: "search" } });
    const needs = r.summary[2];
    expect(needs?.kind).toBe("needs");
    expect(r.attention[0]?.verdict).toBe("act");
  });

  it("leaves hidden alerts out and counts them", () => {
    const i = inputs({ messages: sends(10), hidden: { fuelLow: NOW + DAY } });
    const r = report(i);
    expect(r.attention.some((l) => l.alert.kind === "fuelLow")).toBe(false);
    expect(r.hidden).toBe(1);
    expect(r.summary[2]?.kind).toBe("quiet");
  });

  it("the pipeline is the funnel's everyone rows", () => {
    const channels = [ch("a", { stage: "shortlisted" })];
    const r = report(inputs({ channels }));
    expect(r.pipeline.find((p) => p.step === "shortlisted")?.count).toBe(1);
    expect(r.pipeline[0]?.step).toBe("found");
  });

  it("a month period works the same way", () => {
    const m = overviewReport(
      inputs({ messages: sends(3) }),
      reportWindow("month", L(2026, 10, 28, 12)),
    );
    expect(m.vitals.emails.sent).toBe(3);
  });
});

describe("the revenue vital and the pipeline to First payout (P8b)", () => {
  const deal = (id: string, over: Partial<DealFact> = {}): DealFact => ({
    id,
    brandId: "b1",
    creatorId: "c1",
    step: 0,
    price: 5000,
    payout: 3000,
    createdAt: null,
    goLiveAt: null,
    invoiceSentAt: null,
    invoiceDueAt: null,
    invoicePaidAt: null,
    paidCreatorAt: null,
    reportViews: null,
    usualViews: null,
    reportSentAt: null,
    ...over,
  });
  const goal = (revenuePerMonth: number | null) => ({
    signsPerMonth: 4,
    revenuePerMonth,
    overrides: {},
  });

  it("is null for a viewer who doesn't see money", () => {
    const r = report(
      inputs({
        seesMoney: false,
        goal: goal(10_000),
        deals: [deal("d1", { invoicePaidAt: L(2026, 10, 5) })],
      }),
    );
    expect(r.vitals.revenue).toBeNull();
    expect(r.vitals.repliesWaiting).toBeDefined();
  });

  it("is zero and early with no deals", () => {
    const rev = report(inputs()).vitals.revenue;
    expect(rev).toMatchObject({
      month: L(2026, 10, 1),
      paid: 0,
      projected: 0,
      goal: null,
      verdict: "early",
    });
    expect(rev?.trend).toHaveLength(6);
    expect(rev?.trend.every((p) => p.value === 0)).toBe(true);
  });

  it("counts what brands paid this month, the pace, and six months of payments", () => {
    const deals = [
      deal("d1", { invoicePaidAt: L(2026, 10, 5) }),
      deal("d2", { price: 3000, invoicePaidAt: L(2026, 9, 10) }),
      deal("d3", { price: 7000, invoicePaidAt: L(2026, 5, 20) }), // before the six months
      deal("d4"), // not paid
    ];
    const rev = report(inputs({ deals, goal: goal(10_000) })).vitals.revenue;
    expect(rev?.paid).toBe(5000);
    // 20 working days in the month so far of 22: 5,000 at that pace is 5,500.
    expect(rev?.projected).toBeCloseTo(5500);
    // $10,000 net at the 40% course margin is $25,000 paid.
    expect(rev?.goal).toBeCloseTo(25_000);
    expect(rev?.verdict).toBe("watch");
    expect(rev?.trend.map((p) => p.at)).toEqual([5, 6, 7, 8, 9, 10].map((m) => L(2026, m, 1)));
    expect(rev?.trend.map((p) => p.value)).toEqual([7000, 0, 0, 0, 3000, 5000]);
  });

  it("is good on pace for the goal, and early with no goal", () => {
    const paid = [deal("d1", { price: 24_000, payout: 14_000, invoicePaidAt: L(2026, 10, 5) })];
    expect(report(inputs({ deals: paid, goal: goal(10_000) })).vitals.revenue?.verdict).toBe(
      "good",
    );
    expect(report(inputs({ deals: paid })).vitals.revenue).toMatchObject({
      goal: null,
      verdict: "early",
    });
  });

  it("is early in the first working days of a month", () => {
    const rev = report(inputs({ now: L(2026, 10, 2, 12), goal: goal(10_000) })).vitals.revenue;
    expect(rev?.verdict).toBe("early");
  });

  it("shows the pipeline from Found to First payout", () => {
    const r = report(inputs());
    expect(r.pipeline.map((p) => p.step)).toEqual([...creatorSteps]);
    expect(r.pipeline.at(-2)?.step).toBe("firstDeal");
    expect(r.pipeline.at(-1)?.step).toBe("firstPayout");
  });
});

describe("the revenue tile in a month too young for its pace", () => {
  it("gives no projection before paceMinDays working days, and an early verdict", () => {
    const now = new Date(2026, 9, 2, 12).getTime();
    const paid = deal("p", {
      price: 3000,
      payout: 1500,
      invoicePaidAt: new Date(2026, 9, 1, 9).getTime(),
    });
    const r = overviewReport(
      inputs({
        now,
        goal: { signsPerMonth: 4, revenuePerMonth: 10_000, overrides: {} },
        deals: [paid],
      }),
      reportWindow("30d", now),
    );
    expect(r.vitals.revenue).toMatchObject({ paid: 3000, projected: null, verdict: "early" });
  });
});
