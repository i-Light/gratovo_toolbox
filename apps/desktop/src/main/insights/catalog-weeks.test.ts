import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { migrate } from "../db/migrate";
import { channelId, writePipelineDb } from "../find/catalog-fixture";

import { recordCatalogWeek, weekOf } from "./catalog-weeks";

let dir: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "weeks-"));
  db = new DatabaseSync(":memory:");
  migrate(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const rows = (): Record<string, unknown>[] =>
  db.prepare("SELECT week, live, waiting, archive, written_at FROM catalog_weeks").all();

describe("weekOf", () => {
  it("names the local Monday", () => {
    // Wed 28 Oct 2026, local noon.
    expect(weekOf(new Date(2026, 9, 28, 12).getTime())).toBe("2026-10-26");
    expect(weekOf(new Date(2026, 9, 26, 0, 0, 1).getTime())).toBe("2026-10-26");
    expect(weekOf(new Date(2026, 10, 1, 23, 59).getTime())).toBe("2026-10-26");
    expect(weekOf(new Date(2026, 10, 2).getTime())).toBe("2026-11-02");
  });
});

describe("recordCatalogWeek", () => {
  it("counts live, waiting and archive, and updates the same week", () => {
    const path = join(dir, "pipeline.db");
    const [a, b, c, d] = ["a", "b", "c", "d"].map(channelId) as [string, string, string, string];
    writePipelineDb(path, {
      channels: [{ id: a }, { id: b }, { id: c }],
      archive: [{ id: d, at: "2026-09-01 00:00:00" }],
    });
    // b is rejected and in the catalog (waiting); d is rejected but archived (not counted).
    for (const [id, stage] of [
      [a, "shortlisted"],
      [b, "rejected"],
      [d, "rejected"],
    ] as const) {
      db.prepare(
        "INSERT INTO channel_state (channel_id, handle, creator_stage, updated_at) VALUES (?, '@x', ?, 'x')",
      ).run(id, stage);
    }
    const now = new Date(2026, 9, 28, 12).getTime();
    expect(recordCatalogWeek(db, path, now)).toBe(true);
    expect(rows()).toEqual([
      { week: "2026-10-26", live: 2, waiting: 1, archive: 1, written_at: now },
    ]);
    db.exec("DELETE FROM channel_state WHERE channel_id = '" + b + "'");
    recordCatalogWeek(db, path, now + 1000);
    expect(rows()).toEqual([
      { week: "2026-10-26", live: 3, waiting: 0, archive: 1, written_at: now + 1000 },
    ]);
  });

  it("writes nothing for a missing file", () => {
    expect(recordCatalogWeek(db, join(dir, "none.db"), Date.now())).toBe(false);
    expect(rows()).toEqual([]);
  });
});
