import { describe, expect, it } from "vitest";

import { monthPace, paceVerdict } from "./deal-facts";
import { moneyReport } from "./money";
import { reportWindow } from "./stats";
import { DAY, deal, inputs, moneyWorld as world, NOW } from "./test-inputs";

const ago = (days: number): number => NOW - days * DAY;
const window = reportWindow("30d", NOW);
const goal = (revenuePerMonth: number | null) => ({
  signsPerMonth: 4,
  revenuePerMonth,
  overrides: {},
});

describe("the month's pace before it says anything", () => {
  const early = (paid: number) =>
    inputs({
      now: new Date(2026, 9, 2, 12).getTime(), // 2 working days in
      goal: goal(10_000),
      deals: [
        deal("p", {
          price: paid,
          payout: paid / 2,
          invoicePaidAt: new Date(2026, 9, 1, 9).getTime(),
        }),
      ],
    });

  it("projects no more than what is paid until paceMinDays working days have started", () => {
    const pace = monthPace(early(3000));
    expect(pace).toMatchObject({ paid: 3000, projected: 3000, elapsed: 2 });
    expect(paceVerdict(pace, 25_000)).toBe("early");
    const r = moneyReport(early(3000), window);
    expect(r.months[5]).toMatchObject({ paid: 3000, projected: null });
    expect(r.paceVerdict).toBe("early");
  });
});

describe("moneyReport", () => {
  const r = moneyReport(world(), window);

  it("revenue by month: six months, the current one projected", () => {
    expect(r.months).toHaveLength(6);
    const oct = r.months[5];
    expect(new Date(oct?.month ?? 0).getMonth()).toBe(9);
    expect(oct?.paid).toBe(10000);
    expect(oct?.net).toBe(4000);
    // The same pace as the Overview's revenue tile: working days, never under what is paid.
    expect(oct?.projected).toBe(monthPace(world()).projected);
    expect(oct?.projected ?? 0).toBeGreaterThan(10000);
    expect(r.months[4]).toMatchObject({ paid: 3000, net: 1000, projected: null });
    expect(r.months.slice(0, 4).every((m) => m.paid === 0 && m.projected === null)).toBe(true);
  });

  it("the goal as brand payments, and the pace", () => {
    expect(r.goalNet).toBe(5000);
    // Too few paid deals for a margin of your own: the Goal tab's course margin (40%).
    expect(r.usualMargin).toBeCloseTo(0.4, 9);
    expect(r.goalPaid).toBeCloseTo(12500, 5);
    expect(r.paceVerdict).toBe("watch"); // the month's pace ends under 12,500
    const none = moneyReport(world({ goal: goal(null) }), window);
    expect(none.paceVerdict).toBe("early");
    expect(none.goalPaid).toBeNull();
    expect(moneyReport(world({ goal: goal(2000) }), window).paceVerdict).toBe("good");
    const watch = moneyReport(world({ goal: goal(6000) }), window);
    expect(watch.goalPaid).toBeCloseTo(15000, 5);
    expect(watch.paceVerdict).toBe("watch");
  });

  it("falls back to the course margin without paid deals", () => {
    const x = moneyReport(inputs({ goal: goal(4000) }), window);
    expect(x.usualMargin).toBeCloseTo(0.4, 9);
    expect(x.goalPaid).toBeCloseTo(10000, 5);
  });

  it("owed to us: buckets, the late list, pay days", () => {
    expect(r.owed.buckets).toEqual([
      { bucket: "notDue", amount: 1000, count: 1 },
      { bucket: "late30", amount: 4000, count: 1 },
      { bucket: "late60", amount: 0, count: 0 },
      { bucket: "over60", amount: 2000, count: 1 },
    ]);
    expect(r.owed.late.map((l) => [l.dealId, l.daysLate])).toEqual([
      ["d4", 70],
      ["d3", 10],
    ]);
    // b1 paid in 30 and 16 days: median 23. b2 and b3 have late invoices and never paid.
    expect(r.owed.payDays).toEqual([
      { brandId: "b1", days: 23, unpaid: false },
      { brandId: "b2", days: null, unpaid: true },
      { brandId: "b3", days: null, unpaid: true },
    ]);
    expect(r.owed.verdict).toBe("act");
  });

  it("a due date of its own wins over the terms; late from the day after", () => {
    const x = moneyReport(
      inputs({
        deals: [
          deal("a", { price: 100, invoiceSentAt: ago(10), invoiceDueAt: ago(3) }),
          deal("b", { price: 100, invoiceSentAt: ago(30.5) }),
          deal("c", { price: 100, invoiceSentAt: ago(29.5) }),
        ],
      }),
      window,
    );
    expect(x.owed.late.map((l) => [l.dealId, l.daysLate])).toEqual([["a", 3]]);
    expect(x.owed.buckets[0]).toMatchObject({ count: 2 }); // b is 12 hours past due: not a whole day late yet
    expect(x.owed.verdict).toBe("watch");
  });

  it("payouts: due oldest first; locked on unpaid invoices", () => {
    expect(r.payouts.due).toEqual([{ dealId: "d1", amount: 6000, brandPaidAt: ago(20) }]);
    expect(r.payouts.dueTotal).toBe(6000);
    expect(r.payouts.locked).toBe(4500); // d3 and d4; d5 has no payout yet
    expect(r.payouts.lockedCount).toBe(3);
  });

  it("margin: the average over the last 90 days, the deals under the floor", () => {
    expect(r.margin.floor).toBe(0.25);
    expect(r.margin.average).toBeCloseTo((0.4 + 1 / 3 + 0.125) / 3, 9);
    expect(r.margin.under).toEqual([{ dealId: "d3", margin: 0.125 }]);
    expect(r.margin.verdict).toBe("watch");
  });

  it("deal size: now, before, per 1,000 views, by month", () => {
    expect(r.dealSize.average).toBe(4500);
    expect(r.dealSize.before).toBe(2000);
    expect(r.dealSize.per1000).toBeCloseTo(65000, 5); // 10,000 and 3,000 over 100 views: 100,000 and 30,000
    expect(r.dealSize.trend).toHaveLength(6);
    expect(r.dealSize.trend[5]?.value).toBe(1000); // d5 is the only deal made in October
    expect(r.dealSize.trend[4]?.value).toBe(4000); // d3, made on 28 September
  });

  it("the basket: the top brand and creator over the last 90 days' revenue", () => {
    expect(r.basket.brand).toEqual({ id: "b1", share: 1 });
    expect(r.basket.creator).toEqual({ id: "c1", share: 1 });
    // Only 2 deals were paid in the window: too few for a verdict, as for the alert.
    expect(r.basket.verdict).toBe("early");
  });

  it("the basket verdict uses the alert's rule: 3 paid deals, a top share over 40%", () => {
    const paid = (id: string, brandId: string) =>
      deal(id, { brandId, price: 5000, payout: 3000, invoicePaidAt: ago(20) });
    const watch = moneyReport(
      inputs({ deals: [paid("a", "b1"), paid("b", "b1"), paid("c", "b2")] }),
      window,
    );
    expect(watch.basket.verdict).toBe("watch");
    const even = moneyReport(
      inputs({ deals: [paid("a", "b1"), paid("b", "b2"), paid("c", "b3")] }),
      window,
    );
    expect(even.basket.verdict).toBe("good");
  });

  it("leaves out an invoice paid before it was sent from the pay days", () => {
    const x = moneyReport(
      inputs({
        deals: [
          deal("ok", { brandId: "b1", price: 100, invoiceSentAt: ago(20), invoicePaidAt: ago(10) }),
          deal("bad", {
            brandId: "b1",
            price: 100,
            invoiceSentAt: ago(10),
            invoicePaidAt: ago(20),
          }),
          deal("bad2", {
            brandId: "b2",
            price: 100,
            invoiceSentAt: ago(10),
            invoicePaidAt: ago(20),
          }),
        ],
      }),
      window,
    );
    expect(x.owed.payDays).toEqual([{ brandId: "b1", days: 10, unpaid: false }]);
  });

  it("the roster: signed creators and anyone with a deal, most revenue first", () => {
    expect(r.roster.map((x) => x.creatorId)).toEqual(["c1", "c2", "c4", "c5"]);
    const c1 = r.roster[0];
    expect(c1).toMatchObject({ deals: 3, revenue: 13000, signedAt: ago(120), idle: false });
    expect(c1?.lastDealAt).toBe(ago(5));
    expect(c1?.delivered).toBeCloseTo(0.9, 9);
    const byId = Object.fromEntries(r.roster.map((x) => [x.creatorId, x]));
    expect(byId.c2?.idle).toBe(false); // d3 is 30 days old
    expect(byId.c4?.idle).toBe(true); // signed 90 days ago, no deal
    expect(byId.c5?.idle).toBe(false);
    expect(r.deliveredAverage).toBeCloseTo(0.9, 9);
  });

  it("names every creator and brand the report mentions", () => {
    expect(r.names.c1).toBeDefined();
    for (const row of r.roster) expect(r.names[row.creatorId]).toBeDefined();
    for (const p of r.owed.payDays) expect(r.names[p.brandId]).toBeDefined();
    expect(r.names[r.basket.brand?.id ?? ""]).toBeDefined();
    // Nothing the report does not mention.
    expect(Object.keys(r.names).length).toBeLessThanOrEqual(10);
    expect(moneyReport(world({ seesMoney: false }), window).names).toEqual({});
  });

  it("repeat business", () => {
    expect(r.repeat.came).toEqual({ n: 2, d: 3 }); // b1 (d1, d2) and b2 (d3, d5)
    expect(r.repeat.noNext).toEqual(["d1"]);
    const x = moneyReport(
      world({
        deals: [
          deal("d1", { brandId: "b1", createdAt: ago(60), reportSentAt: ago(23) }),
          deal("d9", { brandId: "b1", createdAt: ago(10) }),
        ],
      }),
      window,
    );
    expect(x.repeat.noNext).toEqual([]);
  });

  it("where deals slow down: medians from the events, the deals stuck now", () => {
    const deals = Array.from({ length: 7 }, (_, n) =>
      deal(`s${String(n)}`, { step: n === 6 ? 0 : 1 }),
    );
    const dealEvents = deals.flatMap((d, n) =>
      n < 6
        ? [
            { dealId: d.id, step: 0, at: ago(30) },
            { dealId: d.id, step: 1, at: ago(28) },
          ]
        : [{ dealId: d.id, step: 0, at: ago(10) }],
    );
    const x = moneyReport(inputs({ deals, dealEvents }), window);
    expect(x.steps).toHaveLength(10);
    expect(x.steps[0]).toEqual({ step: 0, medianDays: 2, stuck: 1 });
    expect(x.steps[1]?.medianDays).toBeNull();
    expect(x.stuckDeals).toEqual([{ dealId: "s6", step: 0, days: 10, usual: 2 }]);
  });

  it("a viewer who doesn't see money gets an empty report, never a throw", () => {
    const x = moneyReport(world({ seesMoney: false }), window);
    expect(x.months.every((m) => m.paid === 0)).toBe(true);
    expect(x.roster).toEqual([]);
    expect(x.goalPaid).toBeNull();
    expect(moneyReport(inputs(), window).owed.verdict).toBe("good");
  });
});
