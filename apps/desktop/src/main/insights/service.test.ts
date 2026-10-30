import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { DataSource } from "@gratovo/core/data";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSqliteSource } from "../data/sqlite-source";
import { migrate } from "../db/migrate";
import { createCatalog } from "../find/catalog";
import { channelId, writePipelineDb } from "../find/catalog-fixture";

import { forgetPipelineFacts } from "./pipeline-facts";
import { createInsightsService, type InsightsService } from "./service";

const NOW = new Date(2026, 9, 28, 12).getTime();
const day = 86_400_000;

let dir: string;
let db: DatabaseSync;
let source: DataSource;
let service: InsightsService;
let open = true;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "service-"));
  db = new DatabaseSync(":memory:");
  migrate(db);
  forgetPipelineFacts();
  open = true;
  source = createSqliteSource(db, {
    source: "live",
    me: "u1",
    extras: {
      presence: () => ({ status: "away", doing: "" }),
      counts: () => ({ today: 0, find: 0, reach: 0, close: 0, deliver: 0, plannedMinutes: 0 }),
      mateRun: () => null,
    },
  });
  const path = join(dir, "pipeline.db");
  // 250 channels nobody has reviewed: more than two pages in one drill.
  const ids = Array.from({ length: 250 }, (_, i) => channelId(`n${String(i).padStart(3, "0")}`));
  writePipelineDb(path, {
    channels: ids.map((id, i) => ({ id, name: `AI Channel ${String(i).padStart(3, "0")}` })),
  });
  const catalog = createCatalog({
    pipelineDbPath: () => path,
    source: () => source,
    now: () => NOW,
  });
  service = createInsightsService({
    source: () => (open ? source : null),
    pipelineDbPath: () => path,
    catalog: async () => (await catalog.snapshot()).rows,
    archiveDays: () => 90,
    now: () => NOW,
  });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("read", () => {
  it("answers each tab with its own report", async () => {
    for (const tab of ["overview", "funnel", "emails", "search", "goal"] as const) {
      expect((await service.read(tab, "30d", true)).tab).toBe(tab);
    }
    const search = await service.read("search", "7d", true);
    if (search.tab !== "search") throw new Error("wrong tab");
    expect(search.counts).toMatchObject({ live: 250, waiting: 0, archive: 0 });
  });

  it("refuses with no data open", async () => {
    open = false;
    await expect(service.read("overview", "7d", true)).rejects.toThrow(/No data is open/);
    expect(() => service.hide("k", NOW + day)).toThrow(/No data is open/);
  });
});

describe("list", () => {
  const drill = { kind: "live", group: "notReviewed" } as const;

  it("pages the records behind a number, and the total is the number", async () => {
    const search = await service.read("search", "30d", true);
    if (search.tab !== "search") throw new Error("wrong tab");
    const first = await service.list(drill, "30d", 0, true);
    expect(first.total).toBe(search.live.groups.notReviewed);
    expect(first.total).toBe(250);
    expect(first.rows).toHaveLength(100);
    expect(first.rows[0]).toMatchObject({ handle: expect.stringMatching(/^@/) as string });
    expect(first.rows[0]?.note).toMatchObject({ kind: "fit", fit: expect.any(Number) as number });
    const last = await service.list(drill, "30d", 200, true);
    expect(last.rows).toHaveLength(50);
    expect(await service.list(drill, "30d", 300, true)).toEqual({ rows: [], total: 250 });
    const ids = new Set([
      ...first.rows.map((r) => r.id),
      ...(await service.list(drill, "30d", 100, true)).rows.map((r) => r.id),
      ...last.rows.map((r) => r.id),
    ]);
    expect(ids.size).toBe(250);
  });

  it("lists a creator known only from its history as gone, so the pages add up", async () => {
    db.prepare(
      "INSERT INTO stage_events (channel_id, stage, at, source) VALUES ('UCgone', 'shortlisted', ?, 'log')",
    ).run(NOW - day);
    const page = await service.list({ kind: "step", step: "shortlisted" }, "30d", 0, true);
    expect(page.total).toBe(page.rows.length);
    expect(page.rows).toContainEqual({
      id: "UCgone",
      name: "UCgone",
      handle: null,
      note: { kind: "gone" },
    });
  });

  it("lists nothing for a drill with no records", async () => {
    expect(await service.list({ kind: "mistakes" }, "30d", 0, true)).toEqual({
      rows: [],
      total: 0,
    });
  });
});

describe("hide", () => {
  it("keeps, replaces, shows again and drops what has run out", () => {
    expect(service.hide("a", NOW + day)).toEqual({ hidden: { a: NOW + day } });
    expect(service.hide("b", NOW + 2 * day).hidden).toEqual({ a: NOW + day, b: NOW + 2 * day });
    expect(source.readSetting("insights.hidden")).toEqual({ a: NOW + day, b: NOW + 2 * day });
    expect(service.hide("a", null).hidden).toEqual({ b: NOW + 2 * day });
    // A time that has passed hides nothing.
    expect(service.hide("c", NOW - 1).hidden).toEqual({ b: NOW + 2 * day });
  });

  it("keeps at most 500, dropping the ones that end soonest", () => {
    const many = Object.fromEntries(
      Array.from({ length: 500 }, (_, i) => [`k${String(i)}`, NOW + (i + 2) * day]),
    );
    source.writeSetting("insights.hidden", many);
    const { hidden } = service.hide("new", NOW + 1000 * day);
    expect(Object.keys(hidden)).toHaveLength(500);
    expect(hidden["new"]).toBe(NOW + 1000 * day);
    expect(hidden["k0"]).toBeUndefined();
  });

  it("shows in the Overview's count of hidden alerts", async () => {
    const before = await service.read("overview", "30d", true);
    if (before.tab !== "overview") throw new Error("wrong tab");
    expect(before.hidden).toBe(0);
    for (const line of before.attention) {
      service.hide(line.key, NOW + day);
    }
    const after = await service.read("overview", "30d", true);
    if (after.tab !== "overview") throw new Error("wrong tab");
    expect(after.hidden).toBe(before.attention.length);
    expect(after.attention).toEqual([]);
  });
});

describe("goal", () => {
  it("sets, overrides, clears and resets", async () => {
    expect(service.goal({})).toEqual({ signsPerMonth: 4, revenuePerMonth: null, overrides: {} });
    expect(service.goal({ signsPerMonth: 6 })).toEqual({
      signsPerMonth: 6,
      revenuePerMonth: null,
      overrides: {},
    });
    expect(service.goal({ overrides: { replied: 0.1, signed: 0.5 } })).toEqual({
      signsPerMonth: 6,
      revenuePerMonth: null,
      overrides: { replied: 0.1, signed: 0.5 },
    });
    expect(source.readSetting("insights.goal")).toEqual({
      signsPerMonth: 6,
      revenuePerMonth: null,
      overrides: { replied: 0.1, signed: 0.5 },
    });
    // Null goes back to your own rate.
    expect(service.goal({ overrides: { replied: null } })).toEqual({
      signsPerMonth: 6,
      revenuePerMonth: null,
      overrides: { signed: 0.5 },
    });
    const goal = await service.read("goal", "30d", true);
    if (goal.tab !== "goal") throw new Error("wrong tab");
    expect(goal.settings).toEqual({
      signsPerMonth: 6,
      revenuePerMonth: null,
      overrides: { signed: 0.5 },
    });
    expect(service.goal({ reset: true })).toEqual({
      signsPerMonth: 4,
      revenuePerMonth: null,
      overrides: {},
    });
    expect(service.goal({ reset: true, signsPerMonth: 9 })).toEqual({
      signsPerMonth: 9,
      revenuePerMonth: null,
      overrides: {},
    });
  });

  it("reads a damaged goal as the default", () => {
    source.writeSetting("insights.goal", { signsPerMonth: "many", overrides: { signed: 7, x: 1 } });
    expect(service.goal({})).toEqual({ signsPerMonth: 4, revenuePerMonth: null, overrides: {} });
  });
});
