import { describe, expect, it } from "vitest";

import { alertKey, alerts, wins } from "./alerts";
import type { ReportParts } from "./alerts";
import { emailsReport } from "./emails";
import { funnelReport } from "./funnel";
import { goalReport } from "./goal";
import type { InsightsInputs } from "./inputs";
import { searchReport } from "./search";
import { reportWindow } from "./stats";
import { ch, DAY, inputs, NOW } from "./test-inputs";
import type {
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
