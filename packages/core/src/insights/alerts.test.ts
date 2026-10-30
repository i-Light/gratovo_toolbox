import { describe, expect, it } from "vitest";

import { alertKey, alerts, wins } from "./alerts";
import type { ReportParts } from "./alerts";
import { emailsReport } from "./emails";
import { funnelReport } from "./funnel";
import { monthPace, paceVerdict } from "./deal-facts";
import { goalAsPaid, goalReport } from "./goal";
import type { DealEvent, DealFact, InsightsInputs } from "./inputs";
import { searchReport } from "./search";
import { reportWindow } from "./stats";
import { ch, DAY, ev, inputs, L, NOW } from "./test-inputs";
import type {
  Alert,
  Batch,
  EmailsReport,
  GoalLine,
  KeywordRow,
  MailboxRow,
  PatternSplit,
  SearchReport,
} from "./types";

const win = reportWindow("30d", NOW);

function base(i: InsightsInputs = inputs()): ReportParts {
  return {
    emails: emailsReport(i, win),
    search: searchReport(i, win),
    funnel: funnelReport(i, win),
    goal: goalReport(i, win),
    fuel: { ready: 100, firstPerDay: 10, days: 10, waitingConfirm: 0, verdict: "good" },
  };
}

/** Parts with some fields replaced (one level down for `search.live` and `search.waiting`). */
function parts(p: {
  emails?: Partial<EmailsReport>;
  search?: Partial<SearchReport>;
  live?: Partial<SearchReport["live"]>;
  waiting?: Partial<SearchReport["waiting"]>;
  goal?: Partial<ReportParts["goal"]>;
  fuel?: Partial<ReportParts["fuel"]>;
}): ReportParts {
  const b = base();
  return {
    ...b,
    emails: { ...b.emails, ...p.emails },
    search: {
      ...b.search,
      ...p.search,
      live: { ...b.search.live, ...p.live },
      waiting: { ...b.search.waiting, ...p.waiting },
    },
    goal: { ...b.goal, ...p.goal },
    fuel: { ...b.fuel, ...p.fuel },
  };
}

const kinds = (p: ReportParts, i: InsightsInputs = inputs()) =>
  alerts(i, p).lines.map((l) => l.alert.kind);

const mailbox = (bounced: [number, number], over: Partial<MailboxRow> = {}): MailboxRow => ({
  address: "outreach3@x",
  warmupDay: null,
  warmupDays: null,
  heldAt: null,
  sent: bounced[1],
  room: 100,
  bounced: { n: bounced[0], d: bounced[1] },
  replies: { n: 0, d: 0 },
  verdict: "good",
  ...over,
});

const batch = (index: number, sent: number, replied: number): Batch => ({
  index,
  from: 0,
  to: 0,
  sent,
  bounced: 0,
  replied,
  positive: replied,
  signed: 0,
  diagnosis: "healthy",
  bounceMailbox: null,
});

const kw = (keyword: string, over: Partial<KeywordRow> = {}): KeywordRow => ({
  keyword,
  found: 100,
  kept: { n: 0, d: 100 },
  live: 10,
  emailed: 100,
  replied: 10,
  signed: 0,
  verdict: "keep",
  why: null,
  lastRun: null,
  ...over,
});

describe("alertKey", () => {
  it("is the kind plus its subject", () => {
    expect(
      alertKey({ kind: "mailboxBounces", mailbox: "outreach3@x", bounced: { n: 1, d: 2 } }),
    ).toBe("mailboxBounces:outreach3@x");
    expect(
      alertKey({
        kind: "keywordWeak",
        keyword: "k",
        replied: { n: 0, d: 0 },
        others: { n: 0, d: 0 },
      }),
    ).toBe("keywordWeak:k");
    expect(alertKey({ kind: "stepShort", step: "triage", perDay: 1, needed: 2 })).toBe(
      "stepShort:triage",
    );
    expect(alertKey({ kind: "rejectsTooStrict", reason: "unknown", back: 1, replied: 1 })).toBe(
      "rejectsTooStrict:unknown",
    );
    expect(alertKey({ kind: "unreadable", count: { n: 1, d: 2 } })).toBe("unreadable");
  });
});

describe("alerts: nothing fires on empty inputs", () => {
  it("returns no lines and builds every part", () => {
    expect(alerts(inputs(), base())).toEqual({ lines: [], hidden: 0 });
    expect(wins(inputs(), base())).toEqual([]);
  });
});

describe("alerts: each kind at its threshold", () => {
  it("mailboxBounces: over 3% with 20 sends or more", () => {
    const fires = (n: number, d: number) =>
      kinds(parts({ emails: { mailboxes: [mailbox([n, d])] } })).includes("mailboxBounces");
    expect(fires(2, 20)).toBe(true); // 10%
    expect(fires(1, 33)).toBe(true); // 3.03%
    expect(fires(1, 34)).toBe(false); // 2.9%
    expect(fires(5, 19)).toBe(false); // too few sends
    const line = alerts(inputs(), parts({ emails: { mailboxes: [mailbox([2, 20])] } })).lines[0];
    expect(line).toMatchObject({
      verdict: "act",
      key: "mailboxBounces:outreach3@x",
      go: { kind: "route", screen: "reach", tab: "mailboxes" },
    });
  });

  it("repliesFell: newest full batch under the floor and clearly under the usual", () => {
    const fires = (batches: Batch[]) =>
      kinds(parts({ emails: { batches } })).includes("repliesFell");
    expect(fires([batch(3, 50, 0), batch(2, 50, 10), batch(1, 50, 10)])).toBe(true);
    expect(fires([batch(3, 50, 1), batch(2, 50, 2), batch(1, 50, 2)])).toBe(false); // 2% vs 4%: chance
    expect(fires([batch(3, 50, 3), batch(2, 50, 20), batch(1, 50, 20)])).toBe(false); // 6% is over the floor
    expect(fires([batch(3, 50, 0)])).toBe(false); // no usual
    expect(fires([batch(4, 20, 0), batch(3, 50, 0), batch(2, 50, 10), batch(1, 50, 10)])).toBe(
      true,
    );
  });

  it("fuelLow: act under 1 day, watch under 3, with the right button", () => {
    const f = (days: number, verdict: "act" | "watch" | "good", waitingConfirm = 0) =>
      alerts(
        inputs(),
        parts({
          fuel: { days, verdict, waitingConfirm },
          live: { addresses: { ...base().search.live.addresses, waiting: waitingConfirm } },
        }),
      ).lines;
    expect(f(0.5, "act")[0]).toMatchObject({
      verdict: "act",
      go: { screen: "find", tab: "search" },
    });
    expect(f(2, "watch", 4)[0]).toMatchObject({
      verdict: "watch",
      go: { screen: "find", tab: "contacts" },
    });
    expect(f(5, "good")).toEqual([]);
  });

  it("repliesFalling: 3 full batches each lower with 150 emails", () => {
    const fires = (batches: Batch[]) =>
      kinds(parts({ emails: { batches } })).includes("repliesFalling");
    expect(fires([batch(3, 50, 2), batch(2, 50, 4), batch(1, 50, 6)])).toBe(true);
    expect(fires([batch(3, 50, 2), batch(2, 50, 4), batch(1, 50, 4)])).toBe(false);
    expect(fires([batch(3, 50, 2), batch(2, 50, 4)])).toBe(false);
  });

  it("roomUnused: under 60% of capacity over 7 days", () => {
    const fires = (n: number, d: number, withMessages = true) => {
      const some = withMessages
        ? inputs({ channels: [ch("a")], messages: [msgOut("a")] })
        : inputs();
      return kinds(parts({ emails: { capacity: { n, d } } }), some).includes("roomUnused");
    };
    expect(fires(59, 100)).toBe(true);
    expect(fires(60, 100)).toBe(false);
    expect(fires(0, 40)).toBe(false); // under minEmails of room
    expect(fires(10, 100, false)).toBe(false); // nothing ever sent
  });

  it("keywordWeak and keywordWornOut and reFindsArchive", () => {
    const weak = kw("weak", { verdict: "drop", why: "noAnswers", replied: 1 });
    expect(kinds(parts({ search: { keywords: [weak, kw("ok", { replied: 20 })] } }))).toContain(
      "keywordWeak",
    );
    expect(kinds(parts({ search: { keywords: [{ ...weak, found: 49 }] } }))).not.toContain(
      "keywordWeak",
    );

    const run = (fresh: number, live: number, archived: number) => ({
      at: NOW,
      fresh,
      live,
      archived,
    });
    const worn = (r: ReturnType<typeof run>) =>
      kinds(parts({ search: { keywords: [kw("w", { lastRun: r })] } }));
    expect(worn(run(1, 79, 0))).toContain("keywordWornOut"); // 79 of 80 > 80%? 98%
    expect(worn(run(20, 80, 0))).not.toContain("keywordWornOut"); // exactly 80%
    expect(worn(run(19, 81, 0))).toContain("keywordWornOut");
    expect(worn(run(0, 10, 0))).not.toContain("keywordWornOut"); // fewer than 20
    expect(worn(run(60, 0, 31))).toContain("reFindsArchive"); // 31 of 91 > 30%
    expect(worn(run(70, 0, 30))).not.toContain("reFindsArchive"); // exactly 30%
  });

  it("stepShort: a line under 80% of what is needed a day", () => {
    const line = (actualPerDay: number): GoalLine => ({
      step: "triage",
      month: 440,
      rate: null,
      perDay: 20,
      actualPerDay,
      actualMonth: null,
      verdict: "watch",
      shortBy: null,
    });
    const g = (a: number) => kinds(parts({ goal: { lines: [line(a)] } }));
    expect(g(15)).toContain("stepShort");
    expect(g(16)).not.toContain("stepShort");
    const found = alerts(inputs(), parts({ goal: { lines: [line(10)] } })).lines[0];
    expect(found).toMatchObject({
      verdict: "watch",
      go: { kind: "insights", tab: "goal" },
      alert: { step: "triage", perDay: 10, needed: 20 },
    });
  });

  it("noSearch: 7 days without a run while fuel is under 5 days", () => {
    const fires = (runDaysAgo: number, days: number, runs = true) =>
      kinds(
        parts({ fuel: { days, verdict: "good" } }),
        inputs({ runs: runs ? [NOW - runDaysAgo * DAY] : [] }),
      ).includes("noSearch");
    expect(fires(7, 4)).toBe(true);
    expect(fires(6, 4)).toBe(false);
    expect(fires(7, 5)).toBe(false);
    expect(fires(7, 4, false)).toBe(false);
  });

  it("backlogGrowing: would take over 5 days", () => {
    const backlog = (count: number, days: number | null, reviewedPerDay: number) => ({
      count,
      oldestAt: null,
      foundPerDay: 5,
      reviewedPerDay,
      days,
      verdict: "watch" as const,
    });
    const f = (b: ReturnType<typeof backlog>) =>
      kinds(parts({ live: { backlog: b } })).includes("backlogGrowing");
    expect(f(backlog(100, 6, 10))).toBe(true);
    expect(f(backlog(100, 5, 10))).toBe(false);
    expect(f(backlog(100, null, 4))).toBe(true); // 100 / 4 = 25 days
    expect(f(backlog(10, 50, 1))).toBe(false); // too few
  });

  it("mistakesLeaving, rejectsTooStrict", () => {
    const m = (tomorrow: number) => ({
      total: tomorrow,
      tomorrow,
      top: [],
    });
    expect(kinds(parts({ waiting: { mistakes: m(1) } }))).toContain("mistakesLeaving");
    expect(kinds(parts({ waiting: { mistakes: m(0) } }))).not.toContain("mistakesLeaving");
    const look = (back: number, replied: number, signed: number) => ({
      secondLooks: [{ reason: "views" as const, back, emailed: back, replied, signed }],
    });
    expect(kinds(parts({ waiting: look(10, 1, 0) }))).toContain("rejectsTooStrict");
    expect(kinds(parts({ waiting: look(10, 0, 1) }))).toContain("rejectsTooStrict");
    expect(kinds(parts({ waiting: look(9, 5, 5) }))).not.toContain("rejectsTooStrict");
    expect(kinds(parts({ waiting: look(10, 0, 0) }))).not.toContain("rejectsTooStrict");
  });

  it("unreadable: over 5% of live channels", () => {
    const f = (gaveUp: number) =>
      kinds(
        parts({
          search: { counts: { live: 100, waiting: 0, archive: 0, everything: 100 } },
          live: { trust: { notRead: 0, retrying: 0, gaveUp, noCountry: 0 } },
        }),
      ).includes("unreadable");
    expect(f(6)).toBe(true);
    expect(f(5)).toBe(false);
    const few = parts({
      search: { counts: { live: 10, waiting: 0, archive: 0, everything: 10 } },
      live: { trust: { notRead: 5, retrying: 0, gaveUp: 0, noCountry: 0 } },
    });
    expect(kinds(few)).not.toContain("unreadable");
  });

  it("auditFailing: one check failing in over half of 10 or more", () => {
    const channels = (failed: number, passed: number) => [
      ...Array.from({ length: failed }, (_, i) =>
        ch(`f${String(i)}`, { audit: { top: true, age: false, engagement: true, rate: true } }),
      ),
      ...Array.from({ length: passed }, (_, i) =>
        ch(`p${String(i)}`, { audit: { top: true, age: true, engagement: true, rate: true } }),
      ),
    ];
    const f = (failed: number, passed: number) => {
      const i = inputs({ channels: channels(failed, passed) });
      return alerts(i, base(i)).lines.filter((l) => l.alert.kind === "auditFailing");
    };
    const found = f(6, 4);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      verdict: "watch",
      go: { kind: "route", screen: "settings", tab: "search" },
    });
    expect(f(5, 5)).toEqual([]);
    expect(f(5, 4)).toEqual([]); // under 10 checked
  });
});

const msgOut = (channelId: string) => ({
  id: "m",
  channelId,
  direction: "out" as const,
  at: NOW - DAY,
  kind: "first" as const,
  followUp: null,
  mailbox: null,
  reading: null,
  bounce: false,
  edited: null,
  rewrite: null,
});

describe("alerts: hiding and order", () => {
  const two = () =>
    parts({
      emails: { mailboxes: [mailbox([2, 20])] },
      waiting: { mistakes: { total: 3, tomorrow: 3, top: [] } },
    });

  it("skips alerts hidden until later and counts them", () => {
    const hidden = { "mailboxBounces:outreach3@x": NOW + DAY };
    const r = alerts(inputs({ hidden }), two());
    expect(r.hidden).toBe(1);
    expect(r.lines.map((l) => l.alert.kind)).toEqual(["mistakesLeaving"]);
  });

  it("shows an alert whose hiding has run out", () => {
    const r = alerts(inputs({ hidden: { "mailboxBounces:outreach3@x": NOW } }), two());
    expect(r.hidden).toBe(0);
    expect(r.lines).toHaveLength(2);
  });

  it("puts act before watch, and orders the same way every time", () => {
    const p = parts({
      emails: { mailboxes: [mailbox([2, 20]), mailbox([4, 40], { address: "a@x" })] },
      waiting: { mistakes: { total: 3, tomorrow: 3, top: [] } },
    });
    const lines = alerts(inputs(), p).lines;
    expect(lines.map((l) => l.verdict)).toEqual(["act", "act", "watch"]);
    expect(lines.map((l) => l.key)).toEqual([
      "mailboxBounces:a@x", // same share; key breaks the tie
      "mailboxBounces:outreach3@x",
      "mistakesLeaving",
    ]);
    expect(alerts(inputs(), p).lines).toEqual(lines);
  });
});

describe("wins", () => {
  const edited = (result: PatternSplit["result"], best: string | null): PatternSplit => ({
    kind: "edited",
    groups: [
      { key: "edited", rate: { n: 20, d: 100 } },
      { key: "asWritten", rate: { n: 5, d: 100 } },
    ],
    result,
    best,
  });

  it("edited: clear and edited better", () => {
    const w = wins(inputs(), parts({ emails: { patterns: [edited("clear", "edited")] } }));
    expect(w).toEqual([
      {
        result: "clear",
        win: { kind: "edited", edited: { n: 20, d: 100 }, asWritten: { n: 5, d: 100 } },
        go: { kind: "insights", tab: "emails", view: null },
      },
    ]);
    expect(wins(inputs(), parts({ emails: { patterns: [edited("clear", "asWritten")] } }))).toEqual(
      [],
    );
    expect(wins(inputs(), parts({ emails: { patterns: [edited("chance", null)] } }))).toEqual([]);
  });

  it("keyword: best by replied over emailed, clear against others, one signed", () => {
    const rows = [
      kw("best", { emailed: 200, replied: 40, signed: 2 }),
      kw("b", { emailed: 200, replied: 8 }),
      kw("c", { emailed: 200, replied: 8 }),
    ];
    const w = wins(inputs(), parts({ search: { keywords: rows } }));
    expect(w[0]).toMatchObject({
      result: "clear",
      win: { kind: "keyword", keyword: "best", signed: 2 },
    });
    expect(w[0]?.go).toEqual({ kind: "insights", tab: "search", view: "live" });
    const none = rows.map((r) => ({ ...r, signed: 0 }));
    expect(wins(inputs(), parts({ search: { keywords: none } }))).toEqual([]);
    const close = [
      kw("a", { emailed: 200, replied: 20, signed: 1 }),
      kw("b", { emailed: 200, replied: 19 }),
    ];
    expect(wins(inputs(), parts({ search: { keywords: close } }))).toEqual([]);
  });

  it("mailbox: best reply rate with enough sends and no bounce alert", () => {
    const box = (address: string, n: number, d: number, verdict: MailboxRow["verdict"] = "good") =>
      mailbox([0, 100], { address, replies: { n, d }, verdict });
    const w = wins(
      inputs(),
      parts({
        emails: {
          mailboxes: [
            box("a", 5, 100),
            box("b", 9, 100),
            box("c", 30, 100, "act"),
            box("d", 8, 10),
          ],
        },
      }),
    );
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({
      result: "good",
      win: { kind: "mailbox", mailbox: "b", replies: { n: 9, d: 100 } },
      go: { kind: "route", screen: "reach", tab: "mailboxes" },
    });
  });

  it("followUp: a follow-up within a point of the first email", () => {
    const step = (s: number, n: number, d: number) => ({
      step: s,
      rate: { n, d },
      share: { n, d: 40 },
    });
    const w = wins(
      inputs(),
      parts({
        emails: { bySteps: [step(0, 6, 100), step(1, 5, 100), step(2, 2, 100), step(3, 0, 100)] },
      }),
    );
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ result: "good", win: { kind: "followUp", step: 1 } });
    const low = wins(inputs(), parts({ emails: { bySteps: [step(0, 6, 100), step(1, 4, 100)] } }));
    expect(low).toEqual([]);
    const few = wins(inputs(), parts({ emails: { bySteps: [step(0, 6, 100), step(1, 3, 40)] } }));
    expect(few).toEqual([]);
  });

  it("returns at most 3, in order", () => {
    const rows = [
      kw("best", { emailed: 200, replied: 40, signed: 2 }),
      kw("b", { emailed: 200, replied: 8 }),
    ];
    const w = wins(
      inputs(),
      parts({
        emails: {
          patterns: [edited("clear", "edited")],
          mailboxes: [mailbox([0, 100], { replies: { n: 9, d: 100 } })],
          bySteps: [
            { step: 0, rate: { n: 6, d: 100 }, share: { n: 6, d: 10 } },
            { step: 1, rate: { n: 6, d: 100 }, share: { n: 4, d: 10 } },
          ],
        },
        search: { keywords: rows },
      }),
    );
    expect(w.map((x) => x.win.kind)).toEqual(["edited", "keyword", "mailbox"]);
  });
});

// ---------------------------------------------------------------------------------------------
// Deals and money (P8b)

const deal = (id: string, over: Partial<DealFact> = {}): DealFact => ({
  id,
  brandId: "b1",
  creatorId: "c1",
  step: 0,
  price: 4000,
  payout: 2400,
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

const dealStep = (dealId: string, step: number, at: number): DealEvent => ({ dealId, step, at });

/** The alerts of one kind for these inputs. */
const found = (i: InsightsInputs, kind: Alert["kind"]) =>
  alerts(i, base(i)).lines.filter((l) => l.alert.kind === kind);

describe("alerts: a late invoice", () => {
  const due = (days: number) =>
    deal("d1", { invoiceSentAt: NOW - (days + 30) * DAY, invoiceDueAt: NOW - days * DAY });

  it("is Watch from 1 day late, with its amount and a link to the late list", () => {
    const [line] = found(inputs({ deals: [due(5)] }), "invoiceLate");
    expect(line).toMatchObject({
      key: "invoiceLate:d1",
      verdict: "watch",
      alert: { kind: "invoiceLate", dealId: "d1", days: 5, amount: 4000 },
      go: { kind: "drill", drill: { kind: "lateInvoices" } },
    });
  });

  it("is Act now over 30 days late", () => {
    expect(found(inputs({ deals: [due(30)] }), "invoiceLate")[0]?.verdict).toBe("watch");
    expect(found(inputs({ deals: [due(31)] }), "invoiceLate")[0]?.verdict).toBe("act");
  });

  it("does not fire before it is a day late, once paid, or with no invoice", () => {
    expect(found(inputs({ deals: [due(0)] }), "invoiceLate")).toEqual([]);
    expect(
      found(inputs({ deals: [{ ...due(40), invoicePaidAt: NOW - DAY }] }), "invoiceLate"),
    ).toEqual([]);
    expect(found(inputs({ deals: [deal("d1")] }), "invoiceLate")).toEqual([]);
  });

  it("works the due date from Net 30 when none is stored", () => {
    const d = deal("d1", { invoiceSentAt: NOW - 36 * DAY });
    expect(found(inputs({ deals: [d] }), "invoiceLate")[0]?.alert).toMatchObject({ days: 6 });
  });

  it("is one alert for each late deal", () => {
    const deals = [due(5), { ...due(8), id: "d2" }];
    expect(found(inputs({ deals }), "invoiceLate").map((l) => l.key)).toEqual([
      "invoiceLate:d2",
      "invoiceLate:d1",
    ]);
  });
});

describe("alerts: a payout is due", () => {
  it("fires when the brand has paid and the creator hasn't been", () => {
    const d = deal("d1", { invoicePaidAt: NOW - 3 * DAY });
    const [line] = found(inputs({ deals: [d] }), "payoutDue");
    expect(line).toMatchObject({
      key: "payoutDue:d1",
      verdict: "watch",
      alert: { kind: "payoutDue", dealId: "d1", amount: 2400, since: NOW - 3 * DAY },
      go: { kind: "insights", tab: "money", view: null },
    });
  });

  it("does not fire when the creator is paid or the brand hasn't paid", () => {
    const paid = deal("d1", { invoicePaidAt: NOW - 3 * DAY, paidCreatorAt: NOW - DAY });
    expect(found(inputs({ deals: [paid, deal("d2")] }), "payoutDue")).toEqual([]);
  });
});

describe("alerts: a deal is stuck", () => {
  /** Five deals that spent 2 days at step 0 and moved on. */
  const usual = Array.from({ length: 5 }, (_, i) => dealStep(`u${String(i)}`, 0, NOW - 30 * DAY));
  const moved = usual.map((e) => dealStep(e.dealId, 1, NOW - 28 * DAY));
  const history = [...usual, ...moved];
  const movedDeals = usual.map((e) => deal(e.dealId, { step: 1 }));

  it("fires over twice the usual time at its step", () => {
    const stuck = deal("s1", { step: 0 });
    const i = inputs({
      deals: [...movedDeals, stuck],
      dealEvents: [...history, dealStep("s1", 0, NOW - 10 * DAY)],
    });
    const [line] = found(i, "dealStuck");
    expect(line).toMatchObject({
      key: "dealStuck:s1",
      verdict: "watch",
      alert: { kind: "dealStuck", dealId: "s1", step: 0, days: 10, usual: 2 },
      go: { kind: "drill", drill: { kind: "stuckDeals", step: 0 } },
    });
  });

  it("does not fire at twice the usual time or under", () => {
    const i = inputs({
      deals: [...movedDeals, deal("s1", { step: 0 })],
      dealEvents: [...history, dealStep("s1", 0, NOW - 4 * DAY)],
    });
    expect(found(i, "dealStuck")).toEqual([]);
  });

  it("needs minForMedian known times at the step", () => {
    const i = inputs({
      deals: [...movedDeals.slice(0, 4), deal("s1", { step: 0 })],
      dealEvents: [...history.filter((e) => e.dealId !== "u4"), dealStep("s1", 0, NOW - 10 * DAY)],
    });
    expect(found(i, "dealStuck")).toEqual([]);
  });

  it("also fires for a viewer who doesn't see money", () => {
    const i = inputs({
      seesMoney: false,
      deals: [...movedDeals, deal("s1", { step: 0, price: null, payout: null })],
      dealEvents: [...history, dealStep("s1", 0, NOW - 10 * DAY)],
    });
    expect(found(i, "dealStuck")).toHaveLength(1);
  });
});

describe("alerts: behind the monthly goal", () => {
  const goal = (revenuePerMonth: number | null) => ({
    signsPerMonth: 4,
    revenuePerMonth,
    overrides: {},
  });
  const paidThisMonth = (price: number) =>
    deal("d1", { price, payout: price * 0.6, invoicePaidAt: L(2026, 10, 5) });

  it("fires when the month's pace ends under 90% of the goal (as brand payments)", () => {
    // $10,000 net at the 40% course margin is $25,000 paid. $5,000 by the 28th is far behind.
    const [line] = found(
      inputs({ goal: goal(10_000), deals: [paidThisMonth(5000)] }),
      "behindGoal",
    );
    expect(line).toMatchObject({
      key: "behindGoal",
      verdict: "watch",
      go: { kind: "insights", tab: "goal", view: null },
    });
    const a = line?.alert;
    expect(a?.kind === "behindGoal" && a.goal).toBeCloseTo(25_000);
    expect(a?.kind === "behindGoal" && a.projected).toBeCloseTo((5000 * 22) / 20);
  });

  it("does not fire on pace, with no goal, or in the first working days of a month", () => {
    expect(
      found(inputs({ goal: goal(10_000), deals: [paidThisMonth(24_000)] }), "behindGoal"),
    ).toEqual([]);
    expect(found(inputs({ goal: goal(null), deals: [paidThisMonth(5000)] }), "behindGoal")).toEqual(
      [],
    );
    const early = inputs({ goal: goal(10_000), now: L(2026, 10, 2, 12) });
    expect(found(early, "behindGoal")).toEqual([]);
  });

  it("fires exactly when the shared pace verdict is Watch, as the tile and the chart say", () => {
    for (const paid of [1000, 5000, 20_000, 24_000, 40_000]) {
      const i = inputs({ goal: goal(10_000), deals: [paidThisMonth(paid)] });
      const watch = paceVerdict(monthPace(i), goalAsPaid(i)) === "watch";
      expect([paid, found(i, "behindGoal").length === 1]).toEqual([paid, watch]);
    }
  });
});

describe("alerts: too much in one basket", () => {
  const paid = (id: string, brandId: string, price = 5000) =>
    deal(id, { brandId, price, payout: 3000, invoicePaidAt: NOW - 20 * DAY });

  it("fires when the top brand is over 40% of the last 90 days' payments", () => {
    const deals = [paid("a", "b1"), paid("b", "b1"), paid("c", "b2")];
    const [line] = found(inputs({ deals }), "basket");
    expect(line).toMatchObject({
      key: "basket:b1",
      verdict: "watch",
      go: { kind: "insights", tab: "money", view: null },
    });
    expect(line?.alert.kind === "basket" && line.alert.share).toBeCloseTo(2 / 3);
  });

  it("does not fire on an even spread, a share of exactly the line, or too few deals", () => {
    const even = ["b1", "b2", "b3", "b4"].map((b, i) => paid(`e${String(i)}`, b));
    expect(found(inputs({ deals: even }), "basket")).toEqual([]);
    expect(found(inputs({ deals: [paid("a", "b1"), paid("b", "b1")] }), "basket")).toEqual([]);
    const old = [paid("a", "b1"), paid("b", "b1"), paid("c", "b2")].map((d) => ({
      ...d,
      invoicePaidAt: NOW - 120 * DAY,
    }));
    expect(found(inputs({ deals: old }), "basket")).toEqual([]);
  });
});

describe("alerts: an idle roster creator", () => {
  const signed = (id: string, daysAgo: number) => ({
    events: [ev(id, "signed", NOW - daysAgo * DAY)],
    channels: [ch(id, { stage: "signed" as const })],
  });

  it("fires when signed and no deal in 60 days, counted from signing when there is none", () => {
    const [line] = found(inputs({ ...signed("c1", 100) }), "idleCreator");
    expect(line).toMatchObject({
      key: "idleCreator:c1",
      verdict: "watch",
      alert: { kind: "idleCreator", creatorId: "c1", days: 100 },
      go: { kind: "route", screen: "close", tab: null },
    });
  });

  it("gives no days when no signing time is known, never a made-up number", () => {
    const i = inputs({ channels: [ch("c1", { stage: "signed" })] });
    expect(found(i, "idleCreator")[0]?.alert).toEqual({
      kind: "idleCreator",
      creatorId: "c1",
      days: null,
    });
  });

  it("counts from the creator's last deal", () => {
    const d = deal("d1", { createdAt: NOW - 70 * DAY });
    const i = inputs({ ...signed("c1", 200), deals: [d] });
    expect(found(i, "idleCreator")[0]?.alert).toMatchObject({ days: 70 });
    const recent = inputs({
      ...signed("c1", 200),
      deals: [deal("d1", { createdAt: NOW - 10 * DAY })],
    });
    expect(found(recent, "idleCreator")).toEqual([]);
  });

  it("does not fire for a creator signed under 60 days ago, or one not signed", () => {
    expect(found(inputs({ ...signed("c1", 59) }), "idleCreator")).toEqual([]);
    expect(
      found(inputs({ events: [ev("c1", "emailed", NOW - 100 * DAY)] }), "idleCreator"),
    ).toEqual([]);
  });

  it("also fires for a viewer who doesn't see money", () => {
    expect(found(inputs({ seesMoney: false, ...signed("c1", 100) }), "idleCreator")).toHaveLength(
      1,
    );
  });
});

describe("alerts: a deal under the margin floor", () => {
  const made = (id: string, payout: number, daysAgo = 10) =>
    deal(id, { price: 4000, payout, createdAt: NOW - daysAgo * DAY });

  it("fires for a deal made in the last 90 days with a margin under the floor", () => {
    const [line] = found(inputs({ deals: [made("d1", 3200)] }), "marginLow");
    expect(line).toMatchObject({
      key: "marginLow:d1",
      verdict: "watch",
      alert: { kind: "marginLow", dealId: "d1", floor: 0.25 },
      go: { kind: "drill", drill: { kind: "underFloor" } },
    });
    expect(line?.alert.kind === "marginLow" && line.alert.margin).toBeCloseTo(0.2);
  });

  it("does not fire at the floor, over it, or for a deal made over 90 days ago", () => {
    expect(found(inputs({ deals: [made("d1", 3000)] }), "marginLow")).toEqual([]);
    expect(found(inputs({ deals: [made("d1", 3200, 100)] }), "marginLow")).toEqual([]);
  });

  it("follows the floor in Agency facts", () => {
    expect(found(inputs({ deals: [made("d1", 3200)], marginFloorPct: 15 }), "marginLow")).toEqual(
      [],
    );
  });
});

describe("alerts: money stays with money viewers", () => {
  const everything = (seesMoney: boolean) => {
    const late = deal("late", {
      invoiceSentAt: NOW - 80 * DAY,
      createdAt: NOW - 85 * DAY,
      payout: 3500,
    });
    const payout = deal("pay", { invoicePaidAt: NOW - 3 * DAY, createdAt: NOW - 40 * DAY });
    const basket = ["x1", "x2", "x3"].map((id) =>
      deal(id, { brandId: "big", invoicePaidAt: NOW - 20 * DAY, paidCreatorAt: NOW - 19 * DAY }),
    );
    return inputs({
      seesMoney,
      goal: { signsPerMonth: 4, revenuePerMonth: 10_000, overrides: {} },
      deals: [late, payout, ...basket],
      events: [ev("idle", "signed", NOW - 100 * DAY)],
      channels: [ch("idle", { stage: "signed" })],
    });
  };

  it("gives a money viewer every one of the money alerts", () => {
    const got = alerts(everything(true), base(everything(true))).lines.map((l) => l.alert.kind);
    for (const kind of [
      "invoiceLate",
      "payoutDue",
      "behindGoal",
      "basket",
      "marginLow",
      "idleCreator",
    ]) {
      expect(got).toContain(kind);
    }
  });

  it("gives a viewer who doesn't see money none of them", () => {
    const i = everything(false);
    const got = alerts(i, base(i)).lines.map((l) => l.alert.kind);
    for (const money of ["invoiceLate", "payoutDue", "behindGoal", "basket", "marginLow"]) {
      expect(got).not.toContain(money);
    }
    expect(got).toContain("idleCreator");
  });

  it("puts Act now before Watch with the new alerts among the rest", () => {
    const i = everything(true);
    const lines = alerts(i, base(i)).lines;
    const verdicts = lines.map((l) => l.verdict);
    expect(verdicts).toEqual([...verdicts].sort((a, b) => (a === b ? 0 : a === "act" ? -1 : 1)));
    expect(lines[0]?.alert.kind).toBe("invoiceLate");
  });
});

describe("wins: the brand that pays fastest", () => {
  const paidIn = (id: string, brandId: string, days: number) =>
    deal(id, {
      brandId,
      invoiceSentAt: NOW - 60 * DAY,
      invoicePaidAt: NOW - 60 * DAY + days * DAY,
      paidCreatorAt: NOW - 20 * DAY,
    });
  const slow = [
    paidIn("s1", "b2", 30),
    paidIn("s2", "b2", 30),
    paidIn("s3", "b3", 32),
    paidIn("s4", "b3", 32),
  ];
  const fast = (i: InsightsInputs) => wins(i, base(i)).find((w) => w.win.kind === "brandPaysFast");

  it("names the brand clearly faster than the rest, with at least 2 paid invoices", () => {
    const i = inputs({ deals: [paidIn("f1", "b1", 10), paidIn("f2", "b1", 10), ...slow] });
    expect(fast(i)).toEqual({
      result: "good",
      win: { kind: "brandPaysFast", brandId: "b1", days: 10 },
      go: { kind: "insights", tab: "money", view: null },
    });
  });

  it("needs 2 paid invoices and at least 25% fewer days than the median of all", () => {
    expect(fast(inputs({ deals: [paidIn("f1", "b1", 10), ...slow] }))).toBeUndefined();
    const close = inputs({ deals: [paidIn("f1", "b1", 26), paidIn("f2", "b1", 26), ...slow] });
    expect(fast(close)).toBeUndefined();
  });

  it("leaves out an invoice paid before it was sent", () => {
    const i = inputs({ deals: [paidIn("f1", "b1", -5), paidIn("f2", "b1", -5), ...slow] });
    expect(fast(i)).toBeUndefined();
  });

  it("is left out for a viewer who doesn't see money", () => {
    const i = inputs({
      seesMoney: false,
      deals: [paidIn("f1", "b1", 10), paidIn("f2", "b1", 10), ...slow],
    });
    expect(fast(i)).toBeUndefined();
  });
});

describe("alertKey: the deal and money alerts", () => {
  it("names the subject, or just the kind", () => {
    expect(alertKey({ kind: "invoiceLate", dealId: "d9", days: 3, amount: 1 })).toBe(
      "invoiceLate:d9",
    );
    expect(alertKey({ kind: "payoutDue", dealId: "d9", amount: 1, since: 0 })).toBe("payoutDue:d9");
    expect(alertKey({ kind: "dealStuck", dealId: "d9", step: 1, days: 9, usual: 2 })).toBe(
      "dealStuck:d9",
    );
    expect(alertKey({ kind: "marginLow", dealId: "d9", margin: 0.1, floor: 0.25 })).toBe(
      "marginLow:d9",
    );
    expect(alertKey({ kind: "basket", brandId: "b7", share: 0.5 })).toBe("basket:b7");
    expect(alertKey({ kind: "idleCreator", creatorId: "c7", days: 70 })).toBe("idleCreator:c7");
    expect(alertKey({ kind: "behindGoal", projected: 1, goal: 2 })).toBe("behindGoal");
  });
});
