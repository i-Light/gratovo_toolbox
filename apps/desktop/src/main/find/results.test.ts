import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readKept } from "./results";

describe("readKept", () => {
  let folder: string;
  let path: string;

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), "gratovo-results-"));
    path = join(folder, "pipeline.db");
    const db = new DatabaseSync(path);
    db.exec(`
      CREATE TABLE channels (channel_id TEXT PRIMARY KEY, name TEXT, handle TEXT, subscribers TEXT,
        median_views_last_30 INTEGER, country TEXT, videos_fetched_at TEXT);
      CREATE TABLE channel_keywords (channel_id TEXT, keyword TEXT, discovered_at TEXT);
      INSERT INTO channels VALUES
        ('UC_a', 'Prompt Lab', '@promptlab', '48200', 9000, 'US', '2026-10-20T10:00:00Z'),
        ('UC_b', NULL, '@agentsdaily', 'Hidden', NULL, NULL, '2026-10-21T10:00:00Z'),
        ('UC_c', NULL, NULL, '1200', 5, 'gb', '2026-10-19T10:00:00Z'),
        ('UC_d', 'Not fetched', NULL, '10', 1, 'US', NULL);
      INSERT INTO channel_keywords VALUES
        ('UC_a', 'ai coding tools', '2026-10-18T10:00:00Z'),
        ('UC_a', 'ai agents', '2026-10-20T09:00:00Z'),
        ('UC_b', 'ai news', '2026-10-21T09:00:00Z'),
        ('UC_c', 'local llm', '2026-10-19T09:00:00Z');
    `);
    db.close();
  });
  afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  it("is empty when there is no database", () => {
    expect(readKept(join(folder, "nope.db"))).toEqual([]);
  });

  it("lists fetched channels, newest first, with the latest keyword", () => {
    const kept = readKept(path);
    expect(kept.map((c) => c.channelId)).toEqual(["UC_b", "UC_a", "UC_c"]);
    expect(kept[1]).toEqual({
      channelId: "UC_a",
      name: "Prompt Lab",
      handle: "@promptlab",
      subscribers: 48_200,
      medianViews: 9000,
      country: "US",
      keyword: "ai agents",
    });
  });

  it("turns hidden subscribers into null and names a channel by handle, then id", () => {
    const kept = readKept(path);
    expect(kept[0]).toMatchObject({ name: "@agentsdaily", subscribers: null, country: null });
    expect(kept[2]).toMatchObject({ name: "UC_c", handle: null, country: null });
  });

  it("honours the limit", () => {
    expect(readKept(path, 1)).toHaveLength(1);
  });

  it("opens the database read-only and closes it, so the file can be deleted", () => {
    readKept(path);
    expect(() => {
      rmSync(path);
    }).not.toThrow();
  });
});
