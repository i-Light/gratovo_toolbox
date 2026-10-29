import { describe, expect, it } from "vitest";

import type { InsightsInputs } from "./inputs";
import { drillIds, insightsReport } from "./report";
import {
  creatorSteps,
  liveGroups,
  reportTabs,
  type EmailsReport,
  type FunnelReport,
  type OverviewReport,
  type SearchReport,
} from "./types";
import { ch, DAY, emptyArchive, ev, incoming, inputs, L, NOW, out } from "./test-inputs";

const TOMORROW = L(2026, 10, 29, 9);
const long = (i: number): number => NOW - i * DAY;

/** A catalog with something in every drill: groups, waiting, unconfirmed, ready, stuck, replies. */
function world(): InsightsInputs {
  const channels = [
    // Not reviewed.
    ...[1, 2, 3].map((n) => ch(`nr${String(n)}`, { foundAt: long(2), keywords: ["kw1"] })),
    // Shortlisted: two with an address that waits to be confirmed, one confirmed (ready).
    ch("sl1", { stage: "shortlisted", hasAddress: true, keywords: ["kw1"], country: "US" }),
    ch("sl2", { stage: "shortlisted", hasAddress: true, keywords: ["kw2"] }),
    ch("sl3", { stage: "shortlisted", hasAddress: true, confirmedAt: long(1) }),
    // Contact: ready.
    ch("ct1", { stage: "contact" }),
    // Emailed: 6 replied quickly (known gaps), 3 never answered and stuck.
    ...Array.from({ length: 6 }, (_, n) =>
      ch(`rp${String(n)}`, { stage: "replied", keywords: ["kw1"], country: "US" }),
    ),
    ...Array.from({ length: 3 }, (_, n) =>
      ch(`st${String(n)}`, { stage: "emailed", keywords: ["kw1"], country: "US" }),
    ),
    ch("sg1", { stage: "signed", keywords: ["kw1"], country: "US" }),
    ch("pk1", { stage: "parked" }),
    ch("nv1", { stage: "never" }),
    // Unreadable.
    ch("ur1", { read: "gaveUp", country: null }),
    ch("ur2", { read: "notRead", country: "US" }),
    ch("ur3", { read: "retrying", country: "US" }),
    // Waiting: two mistakes leaving tomorrow, one other dated, two undated.
    ch("w1", { stage: "rejected", rejectReason: "views", leavesAt: TOMORROW, fit: 90 }),
    ch("w2", { stage: "rejected", rejectReason: "ai", leavesAt: TOMORROW, fit: 88 }),
    ch("w3", { stage: "rejected", rejectReason: "views", leavesAt: L(2026, 10, 31, 9), fit: 40 }),
    ch("w4", { stage: "rejected", rejectReason: "views" }),
    ch("w5", { stage: "rejected" }),
    // A state with no catalog row.
    ch("gone", { stage: "emailed", inCatalog: false }),
  ];
  const messages = [
    ...Array.from({ length: 6 }, (_, n) => [
      out(`rp${String(n)}`, long(40)),
      incoming(`rp${String(n)}`, long(38), { reading: "interested" }),
      out(`rp${String(n)}`, long(37), { kind: "reply" }),
    ]).flat(),
    ...Array.from({ length: 3 }, (_, n) => out(`st${String(n)}`, long(30))),
    out("sg1", long(20)),
    incoming("sg1", long(19), { reading: "interested" }),
    // A reply waiting for us.
    out("sl1x", long(5)),
    incoming("sl1x", long(3)),
    out("gone", long(9)),
  ];
  const events = [
    ...Array.from({ length: 6 }, (_, n) => [
      ev(`rp${String(n)}`, "emailed", long(40)),
      ev(`rp${String(n)}`, "replied", long(38)),
    ]).flat(),
    ...Array.from({ length: 3 }, (_, n) => ev(`st${String(n)}`, "emailed", long(30))),
    ev("sg1", "signed", long(10)),
    ev("sl1", "shortlisted", long(4)),
  ];
  const log = [
    { channelId: "w1", action: "reject" as const, at: long(10), reason: "views" as const },
    { channelId: "back1", action: "reject" as const, at: long(30), reason: "ai" as const },
    { channelId: "back1", action: "restore" as const, at: long(20), reason: null },
    { channelId: "back2", action: "restore" as const, at: long(20), reason: null },
  ];
  return inputs({
    channels,
    messages,
    events,
    log,
    inSequence: [],
    archive: { ...emptyArchive, total: 100, byRules: 80, byPerson: 20 },
    keywords: [
      { keyword: "kw1", found: 60, sweptByRules: 0, lastRun: null },
      { keyword: "kw2", found: 10, sweptByRules: 0, lastRun: null },
    ],
  });
}

const i = world();

describe("insightsReport", () => {
  it("builds every tab for every period, on real and on empty inputs", () => {
    for (const data of [i, inputs()]) {
      for (const tab of reportTabs) {
        for (const period of ["7d", "30d", "90d", "month"] as const) {
          expect(insightsReport(tab, data, period).tab).toBe(tab);
        }
      }
    }
  });
});

const funnel = insightsReport("funnel", i, "30d") as FunnelReport;
const search = insightsReport("search", i, "30d") as SearchReport;
const overview = insightsReport("overview", i, "30d") as OverviewReport;
const ids = (drill: Parameters<typeof drillIds>[0]) => drillIds(drill, i, "30d");

describe("drillIds agrees with the number", () => {
  it("step: every funnel row (found and passed list the catalog only)", () => {
    for (const row of funnel.everyone) {
      const archivePart =
        row.step === "found"
          ? i.archive.total
          : row.step === "passed"
            ? i.archive.total - i.archive.byRules
            : 0;
      expect(ids({ kind: "step", step: row.step }).length, row.step).toBe(row.count - archivePart);
    }
    expect(creatorSteps).toHaveLength(funnel.everyone.length);
    expect(ids({ kind: "step", step: "replied" }).length).toBeGreaterThan(0);
  });

  it("stuck: the row's stuck number", () => {
    let seen = 0;
    for (const row of funnel.everyone) {
      if (row.stuck === null) continue;
      seen += 1;
      expect(ids({ kind: "stuck", step: row.step }).length, row.step).toBe(row.stuck);
    }
    expect(seen).toBeGreaterThan(0);
    expect(funnel.everyone.find((r) => r.step === "emailed")?.stuck).toBeGreaterThanOrEqual(3);
    expect(ids({ kind: "stuck", step: "found" })).toEqual([]);
  });

  it("keyword: live channels of the keyword", () => {
    for (const row of search.keywords) {
      expect(ids({ kind: "keyword", keyword: row.keyword }).length, row.keyword).toBe(row.live);
    }
    expect(search.keywords.find((k) => k.keyword === "kw1")?.live).toBeGreaterThan(0);
  });

  it("live group: each band", () => {
    for (const g of liveGroups) {
      expect(ids({ kind: "live", group: g }).length, g).toBe(search.live.groups[g]);
    }
  });

  it("leaving: each of the next 7 days", () => {
    search.waiting.leaving.forEach((day, n) => {
      expect(ids({ kind: "leaving", day: n }).length, String(n)).toBe(day.count);
    });
    expect(search.waiting.leaving[0]?.count).toBe(2);
  });

  it("mistakes and undated", () => {
    expect(ids({ kind: "mistakes" }).length).toBe(search.waiting.mistakes.total);
    expect(search.waiting.mistakes.total).toBe(2);
    expect(ids({ kind: "undated" }).length).toBe(search.waiting.undated);
    expect(search.waiting.undated).toBe(2);
  });

  it("rejected: each reason", () => {
    for (const r of search.waiting.reasons) {
      expect(ids({ kind: "rejected", reason: r.reason }).length, r.reason).toBe(r.count);
    }
  });

  it("secondLook: creators brought back, by reason", () => {
    expect(search.waiting.secondLooks.length).toBeGreaterThan(0);
    for (const s of search.waiting.secondLooks) {
      expect(ids({ kind: "secondLook", reason: s.reason }).length, s.reason).toBe(s.back);
    }
  });

  it("fuel, unconfirmed and replies waiting", () => {
    expect(ids({ kind: "fuel" }).length).toBe(overview.vitals.fuel.ready);
    expect(overview.vitals.fuel.ready).toBe(2);
    expect(ids({ kind: "unconfirmed" }).length).toBe(search.live.addresses.waiting);
    expect(search.live.addresses.waiting).toBe(2);
    expect(ids({ kind: "repliesWaiting" }).length).toBe(overview.vitals.repliesWaiting.count);
    expect(overview.vitals.repliesWaiting.count).toBe(2); // sl1x, and sg1 (its reply is the newest)
  });

  it("unreadable: each trust number", () => {
    for (const which of ["notRead", "retrying", "gaveUp", "noCountry"] as const) {
      expect(ids({ kind: "unreadable", which }).length, which).toBe(search.live.trust[which]);
    }
  });

  it("returns nothing on empty inputs", () => {
    const empty = inputs();
    expect(drillIds({ kind: "fuel" }, empty, "7d")).toEqual([]);
    expect(drillIds({ kind: "step", step: "signed" }, empty, "7d")).toEqual([]);
    expect(drillIds({ kind: "leaving", day: 3 }, empty, "7d")).toEqual([]);
  });

  it("the emails tab is built from the same data", () => {
    const e = insightsReport("emails", i, "90d") as EmailsReport;
    expect(e.sent).toBeGreaterThan(0);
  });
});
