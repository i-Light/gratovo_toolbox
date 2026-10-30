import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { bareDeal, type DataSource } from "@gratovo/core/data";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSqliteSource } from "../data/sqlite-source";
import { setBrand } from "../data/repositories/brands";
import { setDealStep, upsertDealDetails } from "../data/repositories/deals";
import { replaceMemberAccess } from "../data/repositories/member-access";
import { migrate } from "../db/migrate";
import { createCatalog } from "../find/catalog";
import { writePipelineDb } from "../find/catalog-fixture";

import { readInputs } from "./inputs";
import { forgetPipelineFacts } from "./pipeline-facts";
import { createInsightsService } from "./service";

// Plan step P8b, B-1: the deals, brands, their event tables, the viewer's money access and the
// margin floor, as the reader puts them in the inputs, and the money tab's refusal.

const NOW = new Date(2026, 9, 28, 12).getTime();
const day = 86_400_000;

let dir: string;
let db: DatabaseSync;
let source: DataSource;
let pipelinePath: string;

function openSource(): DataSource {
  return createSqliteSource(db, {
    source: "live",
    me: "u1",
    extras: {
      presence: () => ({ status: "away", doing: "" }),
      counts: () => ({ today: 0, find: 0, reach: 0, close: 0, deliver: 0, plannedMinutes: 0 }),
      mateRun: () => null,
    },
  });
}

function read() {
  return readInputs({
    source,
    pipelineDbPath: pipelinePath,
    catalog: [],
    archiveDays: 90,
    now: NOW,
  });
}

function dealOf(id: string, step: number) {
  const base = bareDeal({ id, brand: "b1", creator: "UCcreator", step, price: 4000 });
  return {
    ...base,
    payout: 2400,
    createdAt: NOW - 40 * day,
    goLiveAt: NOW - 30 * day,
    invoice: {
      number: "INV-1",
      sentAt: NOW - 30 * day,
      dueAt: NOW - 1 * day,
      paidAt: NOW - 5 * day,
    },
    paidCreatorAt: null,
    report: {
      dueAt: NOW,
      sentAt: NOW - day,
      views: 30_000,
      targetViews: 40_000,
      clicks: null,
      ctr: null,
      retention: null,
      verdict: null,
      makeGood: null,
    },
  };
}

function grantMoney(): void {
  replaceMemberAccess(db, [
    { profileId: "u1", roles: ["owner"], seesMoney: true, updatedAt: "2026-10-01T00:00:00Z" },
  ]);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "inputs-deals-"));
  db = new DatabaseSync(":memory:");
  migrate(db);
  source = openSource();
  pipelinePath = join(dir, "pipeline.db");
  forgetPipelineFacts();
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("the event tables", () => {
  it("record a deal's step change through the trigger", () => {
    upsertDealDetails(db, dealOf("d1", 2), NOW);
    setDealStep(db, "d1", 3);
    setDealStep(db, "d1", 3);
    setDealStep(db, "d1", 5);
    const steps = db.prepare("SELECT step, source FROM deal_events ORDER BY id").all();
    expect(steps).toEqual([
      { step: 2, source: "change" },
      { step: 3, source: "change" },
      { step: 5, source: "change" },
    ]);
  });

  it("record a brand's status change through the trigger", () => {
    setBrand(db, { id: "b1", name: "Prompt Labs", sells: "AI tools", status: "found" }, NOW);
    setBrand(db, { id: "b1", name: "Prompt Labs", sells: "AI tools", status: "pitched" }, NOW);
    expect(db.prepare("SELECT status FROM brand_events ORDER BY id").all()).toEqual([
      { status: "found" },
      { status: "pitched" },
    ]);
  });
});

describe("readInputs: deals and brands", () => {
  it("returns the deals with their amounts, report facts and events to a viewer with money", () => {
    grantMoney();
    setBrand(db, { id: "b1", name: "Prompt Labs", sells: "AI tools", status: "won" }, NOW);
    upsertDealDetails(db, dealOf("d1", 7), NOW);
    setDealStep(db, "d1", 8);
    const inputs = read();
    expect(inputs.seesMoney).toBe(true);
    expect(inputs.deals).toEqual([
      {
        id: "d1",
        brandId: "b1",
        creatorId: "UCcreator",
        step: 8,
        price: 4000,
        payout: 2400,
        createdAt: NOW - 40 * day,
        goLiveAt: NOW - 30 * day,
        invoiceSentAt: NOW - 30 * day,
        invoiceDueAt: NOW - day,
        invoicePaidAt: NOW - 5 * day,
        paidCreatorAt: null,
        reportViews: 30_000,
        usualViews: 40_000,
        reportSentAt: NOW - day,
      },
    ]);
    expect(inputs.brands).toMatchObject([{ id: "b1", name: "Prompt Labs", status: "won" }]);
    expect(inputs.dealEvents.map((e) => [e.dealId, e.step])).toEqual([
      ["d1", 7],
      ["d1", 8],
    ]);
    expect(inputs.brandEvents.map((e) => [e.brandId, e.status])).toEqual([["b1", "won"]]);
  });

  it("gives a viewer without money null amounts, and says so", () => {
    upsertDealDetails(db, dealOf("d1", 7), NOW);
    const inputs = read();
    expect(inputs.seesMoney).toBe(false);
    expect(inputs.deals).toHaveLength(1);
    expect(inputs.deals[0]).toMatchObject({ price: null, payout: null, step: 7 });
  });

  it("reads the margin floor from the agency facts, else the default of 25", () => {
    expect(read().marginFloorPct).toBe(25);
    source.writeSetting("agency.facts", { marginFloorPct: 30 });
    expect(read().marginFloorPct).toBe(30);
    source.writeSetting("agency.facts", { marginFloorPct: "high" });
    expect(read().marginFloorPct).toBe(25);
  });

  it("reads the money goal, and anything damaged as none", () => {
    expect(read().goal.revenuePerMonth).toBeNull();
    source.writeSetting("insights.goal", { signsPerMonth: 4, revenuePerMonth: 25_000 });
    expect(read().goal.revenuePerMonth).toBe(25_000);
    source.writeSetting("insights.goal", { signsPerMonth: 4, revenuePerMonth: 5 });
    expect(read().goal.revenuePerMonth).toBeNull();
  });
});

describe("the service: money", () => {
  function service() {
    writePipelineDb(pipelinePath, { channels: [] });
    const catalog = createCatalog({
      pipelineDbPath: () => pipelinePath,
      source: () => source,
      now: () => NOW,
    });
    return createInsightsService({
      source: () => source,
      pipelineDbPath: () => pipelinePath,
      catalog: async () => (await catalog.snapshot()).rows,
      archiveDays: () => 90,
      now: () => NOW,
    });
  }

  it("refuses the money tab to a viewer without money, and answers the others", async () => {
    const s = service();
    await expect(s.read("money", "30d", true)).rejects.toThrow(/Money/);
    expect((await s.read("overview", "30d", true)).tab).toBe("overview");
  });

  it("answers the money tab to a viewer with money", async () => {
    grantMoney();
    // Core's money report may not be finished while this is written: only the tab is checked.
    expect((await service().read("money", "30d", true)).tab).toBe("money");
  });

  it("lists the brands and deals behind a number as brand and deal rows", async () => {
    grantMoney();
    setBrand(db, { id: "b1", name: "Prompt Labs", sells: "AI tools", status: "won" }, NOW);
    const late = dealOf("d1", 6);
    upsertDealDetails(
      db,
      {
        ...late,
        invoice: { ...late.invoice, sentAt: NOW - 40 * day, dueAt: NOW - 10 * day, paidAt: null },
      },
      NOW,
    );
    const paid = dealOf("d2", 8);
    upsertDealDetails(db, paid, NOW);
    const s = service();
    const lateRows = await s.list({ kind: "lateInvoices" }, "30d", 0, true);
    expect(lateRows.rows).toEqual([
      {
        id: "d1",
        record: "deal",
        name: "Prompt Labs × UCcreator",
        handle: null,
        note: { kind: "money", amount: 4000, days: 10 },
      },
    ]);
    const due = await s.list({ kind: "payoutsDue" }, "30d", 0, true);
    expect(due.rows[0]).toMatchObject({
      id: "d2",
      record: "deal",
      note: { kind: "money", amount: 2400, days: 5 },
    });
    const brandRows = await s.list({ kind: "brandStep", step: "won" }, "30d", 0, true);
    expect(brandRows.rows).toEqual([
      { id: "b1", record: "brand", name: "Prompt Labs", handle: null, note: null },
    ]);
    const margin = await s.list({ kind: "underFloor" }, "30d", 0, true);
    expect(margin.total).toBe(margin.rows.length);
  });

  it("stores the money goal, keeps it when not given, and clears it with null", () => {
    grantMoney();
    const s = service();
    expect(s.goal({}).revenuePerMonth).toBeNull();
    expect(s.goal({ revenuePerMonth: 25_000 })).toMatchObject({
      signsPerMonth: 4,
      revenuePerMonth: 25_000,
    });
    expect(s.goal({ signsPerMonth: 6 })).toMatchObject({
      signsPerMonth: 6,
      revenuePerMonth: 25_000,
    });
    expect(source.readSetting("insights.goal")).toMatchObject({ revenuePerMonth: 25_000 });
    expect(s.goal({ revenuePerMonth: null }).revenuePerMonth).toBeNull();
    expect(s.goal({ revenuePerMonth: 9000, reset: true }).revenuePerMonth).toBe(9000);
    expect(s.goal({ reset: true }).revenuePerMonth).toBeNull();
  });
  it("refuses a money goal from a viewer without money, and lets the rest through", () => {
    const s = service();
    expect(() => s.goal({ revenuePerMonth: 25_000 })).toThrow(/money goal/);
    expect(() => s.goal({ revenuePerMonth: null })).toThrow(/money goal/);
    expect(s.goal({ signsPerMonth: 6 })).toMatchObject({ signsPerMonth: 6, revenuePerMonth: null });
  });
});

describe("the service: live, before deals are wired (B8)", () => {
  function service() {
    writePipelineDb(pipelinePath, { channels: [] });
    const catalog = createCatalog({
      pipelineDbPath: () => pipelinePath,
      source: () => source,
      now: () => NOW,
    });
    return createInsightsService({
      source: () => source,
      pipelineDbPath: () => pipelinePath,
      catalog: async () => (await catalog.snapshot()).rows,
      archiveDays: () => 90,
      now: () => NOW,
    });
  }

  /** Synced deals: a late invoice, a payout due, a thin margin, and a fast and a slow payer. */
  function syncDeals(): void {
    const paid = (id: string, brand: string, sent: number, paidAt: number, over = {}) => ({
      ...dealOf(id, 8),
      brand,
      invoice: {
        number: id,
        sentAt: NOW - sent * day,
        dueAt: NOW - 1 * day,
        paidAt: NOW - paidAt * day,
      },
      ...over,
    });
    const late = dealOf("late", 6);
    upsertDealDetails(
      db,
      {
        ...late,
        invoice: { ...late.invoice, sentAt: NOW - 40 * day, dueAt: NOW - 10 * day, paidAt: null },
      },
      NOW,
    );
    upsertDealDetails(db, paid("f1", "b1", 40, 38), NOW);
    upsertDealDetails(db, paid("f2", "b1", 30, 28), NOW);
    upsertDealDetails(db, paid("s1", "b2", 60, 20, { payout: 3900 }), NOW);
    upsertDealDetails(db, paid("s2", "b2", 50, 10, { payout: 3900 }), NOW);
  }

  const kinds = async (s: ReturnType<typeof service>, deals: boolean): Promise<string[]> => {
    const report = await s.read("overview", "30d", deals);
    if (report.tab !== "overview") throw new Error("not the overview");
    return report.attention.map((l) => l.alert.kind);
  };

  it("reads no deal or money alert, win or drill when deals are not shown", async () => {
    grantMoney();
    syncDeals();
    const s = service();
    // With deals shown the same data does raise them, so the test can tell.
    expect(await kinds(s, true)).toEqual(expect.arrayContaining(["invoiceLate", "payoutDue"]));
    const none = new Set([
      "invoiceLate",
      "payoutDue",
      "marginLow",
      "basket",
      "dealStuck",
      "behindGoal",
    ]);
    const live = await kinds(s, false);
    expect(live.filter((k) => none.has(k))).toEqual([]);
    const shown = await s.read("overview", "30d", true);
    if (shown.tab !== "overview") throw new Error("not the overview");
    expect(shown.wins.some((w) => w.win.kind === "brandPaysFast")).toBe(true);
    const report = await s.read("overview", "30d", false);
    if (report.tab !== "overview") throw new Error("not the overview");
    expect(report.wins.some((w) => w.win.kind === "brandPaysFast")).toBe(false);
    expect(report.vitals.revenue?.paid ?? 0).toBe(0);
    expect(await s.list({ kind: "lateInvoices" }, "30d", 0, false)).toEqual({ rows: [], total: 0 });
    expect((await s.list({ kind: "lateInvoices" }, "30d", 0, true)).total).toBe(1);
  });

  it("refuses the money tab even to a money viewer", async () => {
    grantMoney();
    await expect(service().read("money", "30d", false)).rejects.toThrow(/Money/);
  });
});
