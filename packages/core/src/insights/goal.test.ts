import { describe, expect, it } from "vitest";

import { goalLines, goalReport, levers, moneyRates, ownRates } from "./goal";
import type { BrandEvent, DealFact, MailboxFacts } from "./inputs";
import { reportWindow, workingDays } from "./stats";
import { ch, DAY, emptyArchive, ev, incoming, inputs, NOW, out } from "./test-inputs";

const win = reportWindow("30d", NOW);

/** `n` creators first emailed 20 days ago; the first `replied` answered; the first `signed` signed. */
function cohort(n: number, replied: number, signed: number) {
  const messages = [];
  const events = [];
  const channels = [];
  for (let i = 0; i < n; i += 1) {
    const id = `c${String(i)}`;
    channels.push(ch(id, { stage: i < signed ? "signed" : i < replied ? "replied" : "emailed" }));
    messages.push(out(id, NOW - 20 * DAY));
    if (i < replied) messages.push(incoming(id, NOW - 18 * DAY, { reading: "interested" }));
    if (i < signed) events.push(ev(id, "signed", NOW - 10 * DAY));
  }
  return { messages, events, channels };
}

const box = (address: string, over: Partial<MailboxFacts> = {}): MailboxFacts => ({
  address,
  dailyCap: 30,
  warmupStartedAt: null,
  warmupDays: null,
  heldAt: null,
  paused: false,
  ...over,
});

describe("ownRates", () => {
  it("uses guesses and the course floor when nothing is counted", () => {
    const r = ownRates(inputs());
    expect(r.replied).toEqual({ value: 0.15, source: "guess", count: null });
    expect(r.firstEmails).toEqual({ value: 0.04, source: "course", count: null });
    expect(r.triage).toEqual({ value: 0.45, source: "guess", count: null });
    expect(r.find).toEqual({ value: 0.13, source: "guess", count: null });
  });

  it("uses your own rate once the count reaches minOther", () => {
    const r = ownRates(inputs(cohort(40, 10, 5)));
    expect(r.firstEmails.source).toBe("yours");
    expect(r.firstEmails.value).toBeCloseTo(0.25);
    expect(r.firstEmails.count).toEqual({ n: 10, d: 40 });
    expect(r.replied.source).toBe("guess"); // only 10 replied
  });

  it("falls back below minOther", () => {
    expect(ownRates(inputs(cohort(19, 10, 5))).firstEmails.source).toBe("course");
  });

  it("finds the share that passed the rules from the catalog and archive", () => {
    const channels = Array.from({ length: 30 }, (_, i) => ch(`k${String(i)}`));
    const r = ownRates(inputs({ channels, archive: { ...emptyArchive, total: 70, byRules: 60 } }));
    expect(r.find.source).toBe("yours");
    expect(r.find.value).toBeCloseTo(0.4);
  });

  it("lets an override win", () => {
    const r = ownRates(
      inputs({
        ...cohort(40, 10, 5),
        goal: { signsPerMonth: 4, revenuePerMonth: null, overrides: { firstEmails: 0.1 } },
      }),
    );
    expect(r.firstEmails).toEqual({ value: 0.1, source: "override", count: null });
  });
});

describe("goalLines and goalReport", () => {
  const rates = ownRates(inputs());
  const settings = { signsPerMonth: 4, revenuePerMonth: null, overrides: {} };
  const actual = {
    signed: 0,
    replied: 0,
    firstPerDay: 0,
    triagePerDay: 0,
    findPerDay: 0,
    known: true,
  };

  it("works the chain back from the target", () => {
    const lines = goalLines(settings, rates, actual);
    expect(lines.map((l) => l.step)).toEqual([
      "signed",
      "replied",
      "firstEmails",
      "triage",
      "find",
    ]);
    expect(lines[0]).toMatchObject({ month: 4, rate: null, perDay: null });
    expect(lines[1]?.month).toBeCloseTo(4 / 0.15);
    expect(lines[2]?.month).toBeCloseTo(4 / 0.15 / 0.04);
    expect(lines[2]?.perDay).toBeCloseTo(4 / 0.15 / 0.04 / 22);
    expect(lines[4]?.month).toBeCloseTo(4 / 0.15 / 0.04 / 0.45 / 0.13);
  });

  it("marks verdicts: good, watch, act, with how short", () => {
    const need = goalLines(settings, rates, actual)[2]?.perDay ?? 0;
    const at = (firstPerDay: number) =>
      goalLines(settings, rates, { ...actual, firstPerDay, signed: 4, replied: 100 })[2];
    expect(at(need)?.verdict).toBe("good");
    expect(at(need * 0.7)?.verdict).toBe("watch");
    expect(at(need * 0.7)?.shortBy).toBeCloseTo(need * 0.3);
    expect(at(need * 0.4)?.verdict).toBe("act");
  });

  it("is early everywhere with no data", () => {
    const lines = goalLines(settings, rates, { ...actual, known: false });
    expect(lines.every((l) => l.verdict === "early")).toBe(true);
  });

  it("names the step that falls shortest", () => {
    const messages = Array.from({ length: 10 }, (_, i) => out(`x${String(i)}`, NOW - 5 * DAY));
    const r = goalReport(inputs({ messages }), win);
    expect(r.shortStep).not.toBeNull();
    const first = r.lines.find((l) => l.step === "firstEmails");
    expect(first?.verdict).not.toBe("good");
    expect(first?.actualPerDay).toBeGreaterThan(0);
  });

  it("has no short step when every line is met", () => {
    const messages = Array.from({ length: 2000 }, (_, i) => out(`x${String(i)}`, NOW - 5 * DAY));
    const events = [
      ...Array.from({ length: 2000 }, (_, i) => ev(`y${String(i)}`, "shortlisted", NOW - DAY)),
      ...Array.from({ length: 10 }, (_, i) => ev(`s${String(i)}`, "signed", NOW - 2 * DAY)),
    ];
    const channels = Array.from({ length: 5000 }, (_, i) =>
      ch(`z${String(i)}`, { foundAt: NOW - DAY }),
    );
    const replies = Array.from({ length: 200 }, (_, i) => incoming(`r${String(i)}`, NOW - 2 * DAY));
    const r = goalReport(inputs({ messages: [...messages, ...replies], events, channels }), win);
    expect(r.shortStep).toBeNull();
  });

  it("orders levers by the biggest cut and shows before and after", () => {
    const l = levers(settings, rates);
    expect(l).toHaveLength(2);
    const cut = (x: (typeof l)[number] | undefined) => (x ? x.emailsFrom - x.emailsTo : 0);
    expect(cut(l[0])).toBeGreaterThanOrEqual(cut(l[1]));
    const reply = l.find((x) => x.kind === "replyRate");
    expect(reply?.to).toBeCloseTo(0.05);
    expect(reply?.emailsTo).toBeLessThan(reply?.emailsFrom ?? 0);
  });

  it("works out room: follow-ups per first email, and capacity", () => {
    const r = goalReport(
      inputs({ mailboxes: [box("a@x"), box("b@x", { heldAt: 20 }), box("c@x", { paused: true })] }),
      win,
    );
    expect(r.room.capacity).toBe(50);
    const perDay = r.lines.find((l) => l.step === "firstEmails")?.perDay ?? 0;
    expect(r.room.needed).toBeCloseTo(perDay * 4); // 3 follow-ups when not known
  });

  it("builds from empty inputs", () => {
    const r = goalReport(inputs(), win);
    expect(r.shortStep).toBeNull();
    expect(r.room.capacity).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// The money goal (P8b)

const deal = (id: string, over: Partial<DealFact> = {}): DealFact => ({
  id,
  brandId: "b1",
  creatorId: "c1",
  step: 0,
  price: 4000,
  payout: 2000,
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

const pitched = (id: string, at: number): BrandEvent => ({ brandId: id, status: "pitched", at });

const moneyGoal = (over: Partial<ReturnType<typeof inputs>["goal"]> = {}) => ({
  signsPerMonth: 4,
  revenuePerMonth: 10_000,
  overrides: {},
  ...over,
});

/** 20 deals made and paid in the last 90 days at $4,000 / $2,000, 25 brands pitched, 20 signed. */
function ownMoney() {
  const deals = Array.from({ length: 20 }, (_, i) =>
    deal(`d${String(i)}`, {
      brandId: `b${String(i)}`,
      createdAt: NOW - 40 * DAY,
      invoicePaidAt: NOW - 10 * DAY,
      invoiceSentAt: NOW - 30 * DAY,
    }),
  );
  const brandEvents = Array.from({ length: 25 }, (_, i) =>
    pitched(`b${String(i)}`, NOW - 50 * DAY),
  );
  const events = Array.from({ length: 20 }, (_, i) =>
    ev(`s${String(i)}`, "signed", NOW - 20 * DAY),
  );
  return { deals, brandEvents, events };
}

describe("the money goal", () => {
  it("leads with revenue, bookings, deals, pitches and the signed it works out", () => {
    const r = goalReport(inputs({ goal: moneyGoal() }), win);
    expect(r.lines.map((l) => l.step)).toEqual([
      "revenue",
      "bookings",
      "deals",
      "pitches",
      "signed",
      "replied",
      "firstEmails",
      "triage",
      "find",
    ]);
    const month = (s: string) => r.lines.find((l) => l.step === s)?.month ?? NaN;
    expect(month("revenue")).toBe(10_000);
    expect(month("bookings")).toBeCloseTo(25_000); // 40% course margin
    expect(month("deals")).toBeCloseTo(10); // $2,500 course deal size
    expect(month("pitches")).toBeCloseTo(40); // 25% course close rate
    expect(month("signed")).toBe(5); // 10 deals x 0.5 guess
    expect(month("replied")).toBeCloseTo(5 / 0.15);
    expect(r.lines.find((l) => l.step === "bookings")?.rate).toMatchObject({ source: "course" });
    expect(r.lines.find((l) => l.step === "signed")?.rate).toMatchObject({ source: "guess" });
  });

  it("rounds the creators to sign up", () => {
    const r = goalReport(inputs({ goal: moneyGoal({ revenuePerMonth: 11_000 }) }), win);
    expect(r.lines.find((l) => l.step === "signed")?.month).toBe(6); // 11 deals x 0.5 = 5.5
  });

  it("counts money lines a month only, except pitches", () => {
    const r = goalReport(inputs({ goal: moneyGoal() }), win);
    for (const step of ["revenue", "bookings", "deals", "signed"]) {
      const l = r.lines.find((x) => x.step === step);
      expect([step, l?.perDay, l?.actualPerDay]).toEqual([step, null, null]);
    }
    const p = r.lines.find((l) => l.step === "pitches");
    expect(p?.perDay).toBeCloseTo(40 / 22);
    expect(p?.actualPerDay).toBe(0);
  });

  it("tells what the last 30 days did on the money lines, and nothing on the others", () => {
    const r = goalReport(inputs({ ...ownMoney(), goal: moneyGoal() }), win);
    const by = Object.fromEntries(r.lines.map((l) => [l.step, l.actualMonth]));
    expect(by.revenue).toEqual(expect.any(Number));
    expect(by.bookings).toEqual(expect.any(Number));
    expect(by.deals).toEqual(expect.any(Number));
    expect(by.pitches).toBeNull();
    expect(by.signed).toBeNull();
    expect(by.find).toBeNull();
    const plain = goalReport(inputs(), win);
    expect(plain.lines.every((l) => l.actualMonth === null)).toBe(true);
  });

  it("uses your own rates when enough are counted", () => {
    const rates = moneyRates(inputs({ ...ownMoney(), goal: moneyGoal() }));
    expect(rates.margin).toMatchObject({ source: "yours", value: 0.5 });
    expect(rates.dealSize).toMatchObject({ source: "yours", value: 4000 });
    expect(rates.closeRate).toMatchObject({ source: "yours", value: 0.8 });
    expect(rates.signsPerDeal).toMatchObject({ source: "yours", value: 1 });
    const r = goalReport(inputs({ ...ownMoney(), goal: moneyGoal() }), win);
    const month = (s: string) => r.lines.find((l) => l.step === s)?.month ?? NaN;
    expect(month("bookings")).toBeCloseTo(20_000);
    expect(month("deals")).toBeCloseTo(5);
    expect(month("pitches")).toBeCloseTo(6.25);
    expect(month("signed")).toBe(5);
  });

  it("falls back to the course figure below minOther", () => {
    const own = ownMoney();
    const rates = moneyRates(inputs({ ...own, deals: own.deals.slice(0, 19), goal: moneyGoal() }));
    expect(rates.margin.source).toBe("course");
    expect(rates.dealSize.source).toBe("course");
    expect(rates.signsPerDeal.source).toBe("guess");
  });

  it("counts a brand as pitched from its status when it has no events, and as won from it", () => {
    const brands = Array.from({ length: 20 }, (_, i) => ({
      id: `p${String(i)}`,
      name: `Brand ${String(i)}`,
      status: i < 10 ? ("won" as const) : ("negotiating" as const),
      since: NOW - 30 * DAY,
    }));
    const rates = moneyRates(inputs({ brands }));
    expect(rates.closeRate).toMatchObject({ source: "yours", count: { n: 10, d: 20 } });
  });

  it("counts a brand as won from a won event or a deal made after the pitch", () => {
    const brands = Array.from({ length: 20 }, (_, i) => ({
      id: `p${String(i)}`,
      name: `Brand ${String(i)}`,
      status: "pitched" as const,
      since: NOW - 30 * DAY,
    }));
    const brandEvents: BrandEvent[] = [
      ...brands.map((b) => pitched(b.id, NOW - 30 * DAY)),
      { brandId: "p0", status: "won", at: NOW - 10 * DAY },
    ];
    const deals = [
      deal("x1", { brandId: "p1", createdAt: NOW - 5 * DAY }),
      deal("x2", { brandId: "p2", createdAt: NOW - 40 * DAY }), // before the pitch: not a win
    ];
    const rates = moneyRates(inputs({ brands, brandEvents, deals }));
    expect(rates.closeRate.count).toEqual({ n: 2, d: 20 });
  });

  it("does not let repeat deals from old brands lift the close rate", () => {
    // 20 brands pitched 50 days ago, 6 of them won; and 40 repeat deals from a brand pitched long ago.
    const pitchedBrands = Array.from({ length: 20 }, (_, i) =>
      pitched(`n${String(i)}`, NOW - 50 * DAY),
    );
    const brandEvents = [...pitchedBrands, pitched("old", NOW - 400 * DAY)];
    const wonDeals = Array.from({ length: 6 }, (_, i) =>
      deal(`w${String(i)}`, { brandId: `n${String(i)}`, createdAt: NOW - 30 * DAY }),
    );
    const repeats = Array.from({ length: 40 }, (_, i) =>
      deal(`r${String(i)}`, { brandId: "old", createdAt: NOW - 20 * DAY }),
    );
    const rates = moneyRates(inputs({ brandEvents, deals: [...wonDeals, ...repeats] }));
    expect(rates.closeRate).toMatchObject({ source: "yours", value: 0.3, count: { n: 6, d: 20 } });
  });

  it("lets an override win, by the step it leads to, but never reads a rate as dollars", () => {
    const rates = moneyRates(
      inputs({ goal: moneyGoal({ overrides: { bookings: 0.5, deals: 0.9, pitches: 0.5 } }) }),
    );
    expect(rates.margin).toEqual({ value: 0.5, source: "override", count: null });
    // The deals override is a 0 to 1 rate: the deal size is your data or the course figure.
    expect(rates.dealSize).toEqual({ value: 2500, source: "course", count: null });
    expect(rates.closeRate.value).toBe(0.5);
  });

  it("gives a viewer without money no revenue goal and no money overrides in the settings", () => {
    const goal = moneyGoal({
      overrides: { bookings: 0.5, deals: 0.9, pitches: 0.5, replied: 0.2 },
    });
    const blind = goalReport(inputs({ goal, seesMoney: false }), win);
    expect(blind.settings).toEqual({
      signsPerMonth: 4,
      revenuePerMonth: null,
      overrides: { replied: 0.2 },
    });
    expect(goalReport(inputs({ goal }), win).settings).toEqual(goal);
  });

  it("never reads revenue below 0, whatever a deal's amounts say", () => {
    const paidOver = deal("o", {
      price: 1000,
      payout: 3000,
      invoicePaidAt: NOW - 3 * DAY,
      createdAt: NOW - 20 * DAY,
    });
    const r = goalReport(inputs({ goal: moneyGoal(), deals: [paidOver] }), win);
    expect(r.lines.find((l) => l.step === "revenue")?.actualMonth).toBe(0);
  });

  it("measures pitches a working day from brands that reached pitched in 30 days", () => {
    const brandEvents = Array.from({ length: 10 }, (_, i) =>
      pitched(`q${String(i)}`, NOW - 5 * DAY),
    );
    const r = goalReport(inputs({ goal: moneyGoal(), brandEvents }), win);
    const wd = workingDays({ from: NOW - 30 * DAY, to: NOW });
    expect(r.lines.find((l) => l.step === "pitches")?.actualPerDay).toBeCloseTo(10 / wd);
  });

  it("never names a lagging money line as the step falling short", () => {
    const r = goalReport(inputs({ goal: moneyGoal(), messages: [out("x", NOW - DAY)] }), win);
    expect(["revenue", "bookings", "deals"]).not.toContain(r.shortStep);
    expect(r.lines.find((l) => l.step === "revenue")?.verdict).toBe("watch");
  });

  it("adds the deal size lever, and no close-rate lever (it never changes first emails)", () => {
    const r = goalReport(inputs({ goal: moneyGoal({ revenuePerMonth: 20_000 }) }), win);
    const size = r.levers.find((l) => l.kind === "dealSize");
    expect(size).toMatchObject({ from: 2500, to: 3000 });
    expect(size?.emailsTo).toBeLessThan(size?.emailsFrom ?? 0);
    expect(r.levers.find((l) => l.kind === "closeRate")).toBeUndefined();
  });

  it("is exactly the email goal without money or without a money goal", () => {
    const plain = goalReport(inputs(), win);
    expect(plain.lines).toHaveLength(5);
    expect(plain.levers.map((l) => l.kind).sort()).toEqual(["replyRate", "signRate"]);
    const blind = goalReport(inputs({ goal: moneyGoal(), seesMoney: false }), win);
    expect(blind.lines).toEqual(plain.lines);
    expect(blind.levers).toEqual(plain.levers);
  });
});
