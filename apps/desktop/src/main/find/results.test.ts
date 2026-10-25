import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { FindState } from "@gratovo/ipc";

import { refetchKeyword } from "../pipeline/protocol";

import { channelId, writePipelineDb } from "./catalog-fixture";
import { readKept } from "./results";

/** No country rule and auto-clean off: every fetched channel counts. */
const open: FindState["rules"] = {
  countries: [],
  perKeyword: 200,
  sortBy: "upload_date",
  resultsType: "video",
  autoClean: {
    enabled: false,
    minSubscribers: 50_000,
    maxSubscribers: 2_000_000,
    belowMin: "sweep",
    aboveMax: "delay",
    label: "inactive",
  },
  minMedianViews: null,
  minUploads30: null,
  archiveDays: 7,
};

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
    expect(readKept(join(folder, "nope.db"), open)).toEqual([]);
  });

  it("lists fetched channels, newest first, with the latest keyword", () => {
    const kept = readKept(path, open);
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
    const kept = readKept(path, open);
    expect(kept[0]).toMatchObject({ name: "@agentsdaily", subscribers: null, country: null });
    expect(kept[2]).toMatchObject({ name: "UC_c", handle: null, country: null });
  });

  it("says nothing of a keyword the store doesn't name", () => {
    const db = new DatabaseSync(path);
    db.exec("DELETE FROM channel_keywords WHERE channel_id = 'UC_b'");
    db.close();
    expect(readKept(path, open)[0]).toMatchObject({ channelId: "UC_b", keyword: null });
  });

  it("keeps only what the run's rules keep, as during a run", () => {
    // The backlog also reads channels auto-clean left for later and ones outside the countries.
    const db = new DatabaseSync(path);
    db.exec(
      "INSERT INTO channels VALUES (" +
        "'UC_big', 'AI News Giant', '@ainewsgiant', '9000000', 1, 'US', '2026-10-22T10:00:00Z')",
    );
    db.close();
    const rules = {
      ...open,
      countries: ["US", "GB"],
      autoClean: { ...open.autoClean, enabled: true, minSubscribers: 10_000 },
    };
    // UC_b has no country, UC_c is under the minimum, UC_big over the maximum.
    expect(readKept(path, rules).map((c) => c.channelId)).toEqual(["UC_a"]);
    const offAbove = { ...rules, autoClean: { ...rules.autoClean, aboveMax: "off" as const } };
    expect(readKept(path, offAbove).map((c) => c.channelId)).toEqual(["UC_big", "UC_a"]);
  });

  it("never names the refetch keyword as the keyword that found a channel", () => {
    const file = join(folder, "refetch.db");
    const id = channelId("refetch");
    writePipelineDb(file, {
      channels: [{ id, name: "Agent Lab", handle: "@agentlab" }],
      keywords: [
        { channel: id, keyword: "ai agents", at: "2026-10-18 10:00:00" },
        // Newer than the real keyword: it would win if it were not skipped.
        { channel: id, keyword: refetchKeyword, at: "2026-10-22 10:00:00" },
      ],
    });
    expect(readKept(file, open)[0]).toMatchObject({ channelId: id, keyword: "ai agents" });
    const only = join(folder, "refetch-only.db");
    writePipelineDb(only, {
      channels: [{ id }],
      keywords: [{ channel: id, keyword: refetchKeyword, at: "2026-10-22 10:00:00" }],
    });
    expect(readKept(only, open)[0]).toMatchObject({ channelId: id, keyword: null });
  });

  it("honours the limit", () => {
    expect(readKept(path, open, 1)).toHaveLength(1);
  });

  it("opens the database read-only and closes it, so the file can be deleted", () => {
    readKept(path, open);
    expect(() => {
      rmSync(path);
    }).not.toThrow();
  });
});
