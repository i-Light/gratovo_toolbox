import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CatalogItem } from "@gratovo/core/find";

import { channelId, writePipelineDb } from "./catalog-fixture";
import { countArchived, readArchived, toolboxCounts, toolboxList } from "./toolbox";

const day = 86_400_000;
const t0 = Date.UTC(2026, 9, 1);

function row(id: string, over: Partial<CatalogItem> = {}): CatalogItem {
  return {
    id,
    name: id,
    handle: `@${id}`,
    pic: null,
    stage: "rejected",
    emailConfirmed: false,
    email: null,
    contactName: null,
    subscribers: null,
    medianViews: 0,
    uploads30: 0,
    country: null,
    sponsors: [],
    emails: [],
    latestUploadAt: null,
    foundAt: null,
    run: null,
    keyword: null,
    videos: [],
    engagement: null,
    emailedBefore: null,
    rejectReason: null,
    rejectedAt: null,
    neverReason: null,
    archiveDueAt: null,
    archivedAt: null,
    hasNumbers: true,
    uploadsRead: true,
    ...over,
  };
}

describe("toolboxList", () => {
  const rows = [
    row("late", { archiveDueAt: t0 + 6 * day }),
    row("zed", {}),
    row("soon", { archiveDueAt: t0 + 2 * day }),
    row("ann", {}),
    row("gone", { archiveDueAt: t0, archivedAt: t0 + 8 * day }),
    row("fresh", { rejectedAt: t0 + day }),
    row("old", { stage: "never", rejectedAt: t0 }),
    row("new", { stage: "never", rejectedAt: t0 + 5 * day }),
    row("nodate", { stage: "never", rejectedAt: null }),
    row("other", { stage: "shortlisted" }),
  ];
  const snapshot = { version: 3, rows };

  it("lists the countdown soonest first, no date last, and leaves out the archived", () => {
    const page = toolboxList(snapshot, "archive", 7, 0, 50);
    expect(page.version).toBe(3);
    expect(page.total).toBe(5);
    expect(page.items.map((i) => i.id)).toEqual(["soon", "late", "fresh", "ann", "zed"]);
    expect(page.items[0]?.dueAt).toBe(t0 + 2 * day);
    // The owner's days move the date: 7 more days than the server's.
    expect(toolboxList(snapshot, "archive", 14, 0, 1).items[0]?.dueAt).toBe(t0 + 9 * day);
    expect(page.items[3]?.dueAt).toBeNull();
  });

  it("lists never contact newest first, no date last, with no due date", () => {
    const page = toolboxList(snapshot, "never", 7, 0, 50);
    expect(page.items.map((i) => i.id)).toEqual(["new", "old", "nodate"]);
    expect(page.items.every((i) => i.dueAt === null)).toBe(true);
  });

  it("pages and keeps the total", () => {
    const page = toolboxList(snapshot, "archive", 7, 1, 2);
    expect(page.total).toBe(5);
    expect(page.items.map((i) => i.id)).toEqual(["late", "fresh"]);
  });

  it("counts the two lists", () => {
    expect(toolboxCounts(rows, 4, 9)).toEqual({ archive: 5, never: 3, archived: 4, logToday: 9 });
  });
});

describe("readArchived", () => {
  let folder: string;
  let path: string;
  const a = channelId("alpha");
  const b = channelId("bravo");
  const c = channelId("charlie");
  const none = new Map<string, { name: string | null; stage: null }>();

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), "toolbox-"));
    path = join(folder, "pipeline.db");
    writePipelineDb(path, {
      archive: [
        {
          id: a,
          at: "2026-10-02 00:00:00",
          handle: "@alpha_ai",
          label: "rejected",
          subscribers: "48200",
        },
        {
          id: b,
          at: "2026-10-05 00:00:00",
          handle: "@100%_bravo",
          label: "inactive",
          subscribers: "Hidden",
        },
        { id: c, at: "", handle: null },
      ],
    });
  });
  afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  it("lists newest first, with numbers, labels and the app's name and stage", () => {
    const names = new Map([[a, { name: "Alpha AI", stage: "rejected" as const }]]);
    const page = readArchived(path, { q: "", offset: 0, limit: 10 }, names);
    expect(page.total).toBe(3);
    expect(page.items.map((i) => i.id)).toEqual([b, a, c]);
    expect(page.items[0]).toMatchObject({
      subscribers: null,
      label: "inactive",
      name: null,
      stage: null,
    });
    expect(page.items[1]).toMatchObject({
      subscribers: 48_200,
      label: "rejected",
      name: "Alpha AI",
      stage: "rejected",
      archivedAt: Date.UTC(2026, 9, 2),
    });
    expect(page.items[2]).toMatchObject({ archivedAt: null, handle: null });
    const second = readArchived(path, { q: "", offset: 1, limit: 1 }, none);
    expect(second.items.map((i) => i.id)).toEqual([a]);
  });

  it("searches the handle and the app's name, ignoring case, and escapes LIKE", () => {
    const names = new Map([[c, { name: "Charlie Codes", stage: null }]]);
    const ids = (q: string) =>
      readArchived(path, { q, offset: 0, limit: 10 }, names).items.map((i) => i.id);
    expect(ids("ALPHA")).toEqual([a]);
    expect(ids("charlie")).toEqual([c]);
    expect(ids("100%")).toEqual([b]);
    expect(ids("%")).toEqual([b]);
    expect(ids("_")).toEqual([b, a]);
    expect(ids("\\")).toEqual([]);
    expect(readArchived(path, { q: "alpha", offset: 0, limit: 10 }, names).total).toBe(1);
  });

  it("reads what the tombstone kept: facts, keywords earliest first, no refetch link", () => {
    const d = channelId("delta");
    const other = join(folder, "kept.db");
    const via = (keyword: string, at: string | null) => ({ keyword, limit: 50, discovered_at: at });
    writePipelineDb(other, {
      archive: [
        {
          id: d,
          at: "2026-10-06 00:00:00",
          handle: "@delta_ai",
          subscribers: "9100",
          name: "Delta AI",
          country: "gb",
          median: 31_000,
          videos: 42,
          uploads30: 5,
          latestUpload: "2026-09-28 12:00:00",
          foundVia: JSON.stringify([
            via("agent news", "2026-09-03 00:00:00"),
            via("__manual_refetch__", "2026-10-07 00:00:00"),
            via("ai coding tools", "2026-09-01 00:00:00"),
            via("agent news", "2026-08-30 00:00:00"),
            via("no time", null),
            { limit: 5 },
          ]),
        },
      ],
    });
    const names = new Map([[d, { name: "App name", stage: null }]]);
    const [item] = readArchived(other, { q: "", offset: 0, limit: 10 }, names).items;
    expect(item).toMatchObject({
      name: "Delta AI",
      country: "GB",
      medianViews: 31_000,
      videos: 42,
      uploads30: 5,
      latestUploadAt: Date.UTC(2026, 8, 28, 12),
    });
    expect(item?.keywords).toEqual([
      { keyword: "agent news", at: Date.UTC(2026, 7, 30) },
      { keyword: "ai coding tools", at: Date.UTC(2026, 8, 1) },
      { keyword: "no time", at: null },
    ]);
    // The tombstone's own name is searchable too.
    expect(readArchived(other, { q: "delta ai", offset: 0, limit: 10 }, none).total).toBe(1);
  });

  it("falls back to the app's name, and reads bad found_via and unknown numbers as none", () => {
    const e = channelId("echo");
    const other = join(folder, "bad.db");
    writePipelineDb(other, {
      archive: [{ id: e, at: "2026-10-06 00:00:00", foundVia: "{not json", country: "usa" }],
    });
    const names = new Map([[e, { name: "Echo Agents", stage: null }]]);
    const [item] = readArchived(other, { q: "", offset: 0, limit: 10 }, names).items;
    expect(item).toMatchObject({
      name: "Echo Agents",
      country: null,
      medianViews: null,
      uploads30: null,
      latestUploadAt: null,
      videos: null,
      keywords: [],
    });
  });

  it("caps the keywords at 50", () => {
    const f = channelId("foxtrot");
    const other = join(folder, "many.db");
    const many = Array.from({ length: 60 }, (_, n) => ({
      keyword: `ai topic ${String(n).padStart(2, "0")}`,
      discovered_at: `2026-09-01 00:${String(n).padStart(2, "0")}:00`,
    }));
    writePipelineDb(other, {
      archive: [{ id: f, at: "2026-10-06 00:00:00", foundVia: JSON.stringify(many) }],
    });
    const [item] = readArchived(other, { q: "", offset: 0, limit: 10 }, none).items;
    expect(item?.keywords).toHaveLength(50);
    expect(item?.keywords[0]?.keyword).toBe("ai topic 00");
  });

  it("reads a schema-3 file (no fact columns) as none, without failing", () => {
    const old = join(folder, "schema3.db");
    writePipelineDb(old, {
      schema3: true,
      archive: [{ id: a, at: "2026-10-02 00:00:00", handle: "@alpha_ai", subscribers: "48200" }],
    });
    const names = new Map([[a, { name: "Alpha AI", stage: null }]]);
    const page = readArchived(old, { q: "alpha", offset: 0, limit: 10 }, names);
    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({
      name: "Alpha AI",
      subscribers: 48_200,
      country: null,
      medianViews: null,
      uploads30: null,
      latestUploadAt: null,
      videos: null,
      keywords: [],
    });
  });

  it("reads a blank handle as none", () => {
    const blank = channelId("blank");
    const spaces = channelId("spaces");
    const other = join(folder, "blank.db");
    writePipelineDb(other, {
      archive: [
        { id: blank, at: "2026-10-06 00:00:00", handle: "" },
        { id: spaces, at: "2026-10-07 00:00:00", handle: "   " },
      ],
    });
    const page = readArchived(other, { q: "", offset: 0, limit: 10 }, none);
    expect(page.items.find((i) => i.id === blank)?.handle).toBeNull();
    expect(page.items.find((i) => i.id === spaces)?.handle).toBeNull();
  });

  it("answers empty for a missing file or table, and counts", () => {
    const empty = { total: 0, items: [] };
    expect(readArchived(join(folder, "none.db"), { q: "", offset: 0, limit: 5 }, none)).toEqual(
      empty,
    );
    expect(readArchived(null, { q: "", offset: 0, limit: 5 }, none)).toEqual(empty);
    expect(countArchived(path)).toBe(3);
    expect(countArchived(join(folder, "none.db"))).toBe(0);
  });
});
