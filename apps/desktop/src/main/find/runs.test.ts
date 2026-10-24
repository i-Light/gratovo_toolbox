import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CatalogItem } from "@gratovo/core/find";

import { channelId, writePipelineDb } from "./catalog-fixture";
import { parseTime, readRuns } from "./runs";

function item(over: Partial<CatalogItem>): CatalogItem {
  return {
    id: "a",
    name: "A",
    handle: "@a",
    pic: null,
    stage: "new",
    emailConfirmed: false,
    email: null,
    subscribers: 100_000,
    medianViews: 50_000,
    uploads30: 8,
    country: "US",
    sponsors: [],
    foundEmails: 0,
    latestUploadAt: null,
    foundAt: null,
    run: null,
    keyword: null,
    videos: [],
    engagement: null,
    emailedBefore: null,
    rejectReason: null,
    archiveDueAt: null,
    hasNumbers: true,
    ...over,
  };
}

describe("readRuns", () => {
  let folder: string;
  let path: string;

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), "gratovo-runs-"));
    path = join(folder, "pipeline.db");
  });
  afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  it("gives the newest search runs first, and leaves other kinds out", () => {
    writePipelineDb(path, {
      runs: [
        { start: "2026-10-01T10:00:00+00:00", end: "2026-10-01T11:00:00+00:00", keywords: 4 },
        { start: "2026-10-02T10:00:00+00:00", end: "2026-10-02T10:30:00+00:00", kind: "re-enrich" },
        { start: "2026-10-03T10:00:00+00:00", end: null, status: "running", keywords: 9 },
      ],
    });
    const runs = readRuns(path, [], 50, parseTime("2026-10-03T12:00:00Z") ?? 0);
    expect(runs.map((run) => [run.id, run.status, run.keywords])).toEqual([
      [3, "running", 9],
      [1, "done", 4],
    ]);
    expect(runs[0]?.finishedAt).toBeNull();
    expect(runs[1]?.startedAt).toBe(Date.parse("2026-10-01T10:00:00Z"));
  });

  it("counts found, kept and gold from the catalog rows and the archive window", () => {
    writePipelineDb(path, {
      runs: [
        { start: "2026-10-01T10:00:00+00:00", end: "2026-10-01T11:00:00+00:00" },
        { start: "2026-10-02T10:00:00+00:00", end: "2026-10-02T11:00:00+00:00" },
      ],
      archive: [
        { id: channelId("old1"), at: "2026-10-01 10:30:00" },
        { id: channelId("old2"), at: "2026-10-01 10:40:00" },
        { id: channelId("gap"), at: "2026-10-01 15:00:00" },
      ],
    });
    // Gold needs a median of 40,000, 40% of subscribers and 3 to 20 uploads in 30 days.
    const gold = item({ id: "g", run: 1, subscribers: 80_000, medianViews: 50_000, uploads30: 6 });
    const plain = item({ id: "p", run: 1, subscribers: 900_000, medianViews: 1000 });
    const other = item({ id: "o", run: 2, medianViews: 100 });
    const none = item({ id: "n", run: null });
    const runs = readRuns(path, [gold, plain, other, none], 50, Date.now());
    expect(runs.find((run) => run.id === 1)).toMatchObject({ found: 4, kept: 2, gold: 1 });
    expect(runs.find((run) => run.id === 2)).toMatchObject({ found: 1, kept: 1, gold: 0 });
  });

  it("answers nothing for a missing file, and respects the limit", () => {
    expect(readRuns(path, [])).toEqual([]);
    expect(readRuns(null, [])).toEqual([]);
    writePipelineDb(path, {
      runs: [
        { start: "2026-10-01T10:00:00Z", end: "2026-10-01T11:00:00Z" },
        { start: "2026-10-02T10:00:00Z", end: "2026-10-02T11:00:00Z" },
      ],
    });
    expect(readRuns(path, [], 1).map((run) => run.id)).toEqual([2]);
  });
});

describe("parseTime", () => {
  it("reads ISO text, SQLite text as UTC, and nothing else", () => {
    expect(parseTime("2026-10-01T10:00:00+00:00")).toBe(Date.parse("2026-10-01T10:00:00Z"));
    expect(parseTime("2026-10-01 10:00:00")).toBe(Date.parse("2026-10-01T10:00:00Z"));
    expect(parseTime("not a time")).toBeNull();
    expect(parseTime(null)).toBeNull();
    expect(parseTime("")).toBeNull();
  });
});
