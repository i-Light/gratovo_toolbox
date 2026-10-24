import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CreatorState, DataSource } from "@gratovo/core/data";
import { emptyFacets, emptyFindFilter } from "@gratovo/core/find";

import { createCatalog } from "./catalog";
import {
  channelId,
  creatorState,
  writePipelineDb,
  type FixtureChannel,
  type FixtureData,
} from "./catalog-fixture";

const everything = { filter: { ...emptyFindFilter, stages: [] }, sort: "found" as const };

describe("the catalog", () => {
  let folder: string;
  let path: string;
  let states: CreatorState[];
  /** Each creator's stored notes, read one at a time by `item()`. */
  let notes: Map<string, string>;
  let closeables: { close(): void }[];

  const source = (): DataSource =>
    ({
      creatorStates: () => Promise.resolve(states),
      creatorNotes: (id: string) => Promise.resolve(notes.get(id) ?? null),
    }) as unknown as DataSource;

  function open(data: FixtureData, debounceMs = 500) {
    writePipelineDb(path, data);
    const catalog = createCatalog({
      pipelineDbPath: () => path,
      source,
      debounceMs,
      now: () => Date.parse("2026-10-20T00:00:00Z"),
    });
    closeables.push(catalog);
    return catalog;
  }

  async function all(catalog: ReturnType<typeof open>) {
    // The stages default hides rejected and never; ask for every stage so nothing is dropped.
    const stages = [
      "new",
      "shortlisted",
      "contact",
      "emailed",
      "replied",
      "kit",
      "audience",
      "signed",
      "rejected",
      "parked",
      "never",
    ] as const;
    const page = await catalog.query({
      ...everything,
      filter: { ...emptyFindFilter, stages: [...stages] },
      offset: 0,
      limit: 100_000,
    });
    return page.items;
  }

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), "gratovo-catalog-"));
    path = join(folder, "pipeline.db");
    states = [];
    notes = new Map();
    closeables = [];
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    for (const c of closeables) {
      c.close();
    }
    rmSync(folder, { recursive: true, force: true });
  });

  const a = channelId("alpha");
  const b = channelId("bravo");
  const c = channelId("charlie");

  it("joins pipeline channels to creator states, and adds state-only creators past new", async () => {
    const catalog = open({
      channels: [
        { id: a, name: "Alpha AI", subscribers: "48200", median: 52_000, uploads30: 6 },
        { id: b, name: "Bravo", subscribers: "Hidden" },
      ],
    });
    states = [
      creatorState(a, {
        stage: "shortlisted",
        email: "alpha@example.com",
        emailConfirmed: true,
        engagement: 3.2,
        archiveDueAt: 123,
        rejectReason: "views",
      }),
      creatorState(c, { stage: "signed", name: null, handle: "@charlie" }),
      creatorState(channelId("delta"), { stage: "new" }),
    ];
    const items = await all(catalog);
    expect(items.map((item) => item.id).sort()).toEqual([a, b, c].sort());
    const alpha = items.find((item) => item.id === a);
    expect(alpha).toMatchObject({
      name: "Alpha AI",
      stage: "shortlisted",
      email: "alpha@example.com",
      emailConfirmed: true,
      engagement: 3.2,
      archiveDueAt: 123,
      rejectReason: "views",
      subscribers: 48_200,
      medianViews: 52_000,
      uploads30: 6,
      hasNumbers: true,
    });
    const bravo = items.find((item) => item.id === b);
    expect(bravo).toMatchObject({ stage: "new", email: null, subscribers: null });
    expect(items.find((item) => item.id === c)).toMatchObject({
      name: "@charlie",
      stage: "signed",
      hasNumbers: false,
      subscribers: null,
      medianViews: 0,
      uploads30: 0,
      pic: null,
      videos: [],
    });
  });

  it("makes picture keys only for good ids with a stored picture", async () => {
    const goodNoPicture = channelId("nopic");
    const catalog = open({
      channels: [
        { id: a, picture: "https://yt3.example/a.jpg" },
        { id: "bad-id", picture: "https://yt3.example/bad.jpg" },
        { id: goodNoPicture },
      ],
      videos: [
        { id: "abcdefghijk", channel: a, publishedAt: "2026-10-02T00:00:00Z" },
        { id: "short", channel: a, publishedAt: "2026-10-01T00:00:00Z" },
      ],
    });
    const items = await all(catalog);
    expect(items.find((item) => item.id === a)?.pic).toBe(`c:${a}`);
    expect(items.find((item) => item.id === "bad-id")?.pic).toBeNull();
    expect(items.find((item) => item.id === goodNoPicture)?.pic).toBeNull();
    expect(items.find((item) => item.id === a)?.videos.map((video) => video.pic)).toEqual([
      "v:abcdefghijk",
      null,
    ]);
    expect(catalog.channelPicture(a)).toBe("https://yt3.example/a.jpg");
    expect(catalog.channelPicture("bad-id")).toBe("https://yt3.example/bad.jpg");
    expect(catalog.channelPicture(goodNoPicture)).toBeNull();
    expect(catalog.channelPicture("unknown")).toBeNull();
  });

  it("keeps the newest three videos per channel, with views as numbers", async () => {
    const videos = Array.from({ length: 5 }, (_, n) => ({
      id: `video00000${String(n)}`,
      channel: a,
      publishedAt: `2026-10-0${String(n + 1)}T00:00:00Z`,
      views: n === 4 ? "Hidden" : String(100 * (n + 1)),
    }));
    const catalog = open({ channels: [{ id: a }, { id: b }], videos });
    const items = await all(catalog);
    const alpha = items.find((item) => item.id === a);
    expect(alpha?.videos.map((video) => video.id)).toEqual([
      "video000004",
      "video000003",
      "video000002",
    ]);
    expect(alpha?.videos.map((video) => video.views)).toEqual([null, 400, 300]);
    expect(alpha?.videos[0]?.publishedAt).toBe(Date.parse("2026-10-05T00:00:00Z"));
    expect(items.find((item) => item.id === b)?.videos).toEqual([]);
  });

  it("takes the first keyword a channel was found by", async () => {
    const catalog = open({
      channels: [{ id: a }],
      keywords: [
        { channel: a, keyword: "later words", at: "2026-10-03 00:00:00" },
        { channel: a, keyword: "ai tools", at: "2026-10-02 00:00:00" },
      ],
    });
    const [item] = await all(catalog);
    expect(item?.keyword).toBe("ai tools");
    expect(item?.foundAt).toBe(Date.parse("2026-10-02T00:00:00Z"));
  });

  it("works out emailedBefore from the old stage, the stage and the last activity", async () => {
    const ids = ["e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8"].map(channelId);
    const catalog = open({ channels: ids.map((id) => ({ id })) });
    const who = { at: 5000, who: "Sara" };
    states = [
      creatorState(ids[0] ?? "", { legacyPipelineStage: "contacted", lastActivity: who }),
      creatorState(ids[1] ?? "", { stage: "replied" }),
      creatorState(ids[2] ?? "", { stage: "shortlisted" }),
      creatorState(ids[3] ?? "", { stage: "rejected", legacyPipelineStage: "lost" }),
      creatorState(ids[4] ?? "", { stage: "emailed", lastActivity: who }),
      // The app's own stage wins over a leftover legacy one.
      creatorState(ids[5] ?? "", { hasAppStage: true, legacyPipelineStage: "contacted" }),
      creatorState(ids[6] ?? "", { stage: "parked", legacyPipelineStage: "lost" }),
      creatorState(ids[7] ?? "", { stage: "signed", legacyPipelineStage: "paid" }),
    ];
    const items = await all(catalog);
    const before = (n: number) => items.find((item) => item.id === ids[n])?.emailedBefore;
    expect(before(0)).toEqual(who);
    expect(before(1)).toEqual({ at: null, who: null });
    expect(before(2)).toBeNull();
    // Lost is not a contacted stage.
    expect(before(3)).toBeNull();
    expect(before(4)).toEqual(who);
    expect(before(5)).toBeNull();
    expect(before(6)).toBeNull();
    expect(before(7)).toEqual({ at: null, who: null });
  });

  it("keeps a country only as a two-letter code, upper-cased", async () => {
    const ids = ["k1", "k2", "k3", "k4", "k5"].map(channelId);
    const countries = ["", "usa", "u s", "gb", " CA "];
    const catalog = open({
      channels: ids.map((id, n) => ({ id, country: countries[n] ?? null })),
    });
    const items = await all(catalog);
    const country = (n: number) => items.find((item) => item.id === ids[n])?.country;
    expect([0, 1, 2, 3, 4].map(country)).toEqual([null, null, null, "GB", "CA"]);
  });

  it("skips the facet counts when asked", async () => {
    const catalog = open({ channels: [{ id: a, country: "US" }] });
    const request = { ...everything, offset: 0, limit: 10 };
    const full = await catalog.query(request);
    expect(full.facets.countries).toEqual({ US: 1 });
    const light = await catalog.query({ ...request, facets: false });
    expect(light.facets).toEqual(emptyFacets);
    expect(light.total).toBe(1);
  });

  it("reads sponsors as deduped strings and bad JSON as empty", async () => {
    const catalog = open({
      channels: [
        {
          id: a,
          brands: JSON.stringify(["Notion", "Notion", 5, null, "Cursor"]),
          emails: '["x@y.co"]',
        },
        { id: b, brands: "{not json", emails: "{nope" },
        { id: c, brands: '{"a":1}', emails: '"text"' },
      ],
    });
    const items = await all(catalog);
    const find = (id: string) => items.find((item) => item.id === id);
    expect(find(a)).toMatchObject({ sponsors: ["Notion", "Cursor"], foundEmails: 1 });
    expect(find(b)).toMatchObject({ sponsors: [], foundEmails: 0 });
    expect(find(c)).toMatchObject({ sponsors: [], foundEmails: 0 });
  });

  it("caps sponsors at 50", async () => {
    const brands = JSON.stringify(Array.from({ length: 80 }, (_, n) => `Brand ${String(n)}`));
    const catalog = open({ channels: [{ id: a, brands }] });
    const [item] = await all(catalog);
    expect(item?.sponsors).toHaveLength(50);
  });

  it("gives each channel the run whose window holds its first find", async () => {
    const catalog = open({
      channels: [{ id: a }, { id: b }, { id: c }],
      keywords: [
        { channel: a, keyword: "k", at: "2026-10-01 10:30:00" },
        { channel: b, keyword: "k", at: "2026-10-02 10:30:00" },
        { channel: c, keyword: "k", at: "2026-10-01 20:00:00" },
      ],
      runs: [
        { start: "2026-10-01T10:00:00+00:00", end: "2026-10-01T11:00:00+00:00", keywords: 3 },
        { start: "2026-10-02T10:00:00+00:00", end: null, status: "running", keywords: 5 },
      ],
    });
    const items = await all(catalog);
    const run = (id: string) => items.find((item) => item.id === id)?.run;
    expect(run(a)).toBe(1);
    expect(run(b)).toBe(2);
    expect(run(c)).toBeNull();
    const { runs } = await catalog.runs();
    expect(runs.map((r) => [r.id, r.found, r.kept])).toEqual([
      [2, 1, 1],
      [1, 1, 1],
    ]);
  });

  it("answers an empty catalog when pipeline.db is missing", async () => {
    states = [creatorState(a, { stage: "contact", name: "Alpha" })];
    const catalog = createCatalog({ pipelineDbPath: () => path, source });
    closeables.push(catalog);
    expect((await all(catalog)).map((item) => item.id)).toEqual([a]);
    expect(await catalog.runs()).toEqual({ runs: [] });
    const none = createCatalog({ pipelineDbPath: () => null, source: () => null });
    closeables.push(none);
    expect((await none.query({ ...everything, offset: 0, limit: 10 })).total).toBe(0);
    expect(await none.item(a)).toEqual({ item: null });
  });

  it("gives item() the fit, the description cut to 5000 and up to 15 videos", async () => {
    const videos = Array.from({ length: 20 }, (_, n) => ({
      id: `vid${String(n).padStart(8, "0")}`,
      channel: a,
      publishedAt: `2026-10-${String(n + 1).padStart(2, "0")}T00:00:00Z`,
      views: "10",
    }));
    const catalog = open({
      channels: [{ id: a, description: "x".repeat(9000), median: 60_000 }],
      videos,
    });
    const { item } = await catalog.item(a);
    expect(item?.videos).toHaveLength(15);
    expect(item?.videos[0]?.id).toBe("vid00000019");
    expect(item?.description).toHaveLength(5000);
    expect(item?.fit.parts).toHaveLength(5);
    const listed = (await all(catalog))[0];
    expect(listed?.videos).toHaveLength(3);
    expect(await catalog.item("UCmissing")).toEqual({ item: null });
  });

  it("gives item() for a state-only creator with no description", async () => {
    states = [creatorState(a, { stage: "contact", name: "Alpha" })];
    const catalog = open({});
    const { item } = await catalog.item(a);
    expect(item).toMatchObject({ id: a, description: "", videos: [], hasNumbers: false });
  });

  it("gives item() the creator's notes, cut to the limit and flagged, and query items none", async () => {
    states = [creatorState(a), creatorState(b, { stage: "contact" })];
    notes = new Map([
      [a, "Wants a demo of the coding agent first."],
      [b, "y".repeat(50_001)],
    ]);
    const catalog = open({ channels: [{ id: a }, { id: c }] });
    expect((await catalog.item(a)).item?.notes).toBe("Wants a demo of the coding agent first.");
    // A state-only creator has notes too; a long one pulled from the server shows its start.
    expect((await catalog.item(b)).item?.notes).toHaveLength(50_000);
    expect((await catalog.item(b)).item?.notesCut).toBe(true);
    expect((await catalog.item(a)).item?.notesCut).toBe(false);
    expect((await catalog.item(c)).item?.notes).toBe("");
    for (const listed of await all(catalog)) {
      expect(listed).not.toHaveProperty("notes");
    }
  });

  it("reads one creator's notes on each item(), with no rebuild", async () => {
    const read = vi.fn(() => Promise.resolve(states));
    const one = vi.fn((id: string) => Promise.resolve(notes.get(id) ?? null));
    writePipelineDb(path, { channels: [{ id: a }, { id: b }] });
    const catalog = createCatalog({
      pipelineDbPath: () => path,
      source: () => ({ creatorStates: read, creatorNotes: one }) as unknown as DataSource,
    });
    closeables.push(catalog);
    expect((await catalog.item(a)).item?.notes).toBe("");
    notes.set(a, "Covers Claude Code weekly.");
    expect((await catalog.item(a)).item?.notes).toBe("Covers Claude Code weekly.");
    expect(read).toHaveBeenCalledTimes(1);
    expect(one.mock.calls).toEqual([[a], [a]]);
    // An unknown creator answers no item and reads nothing.
    expect(await catalog.item("UCmissing")).toEqual({ item: null });
    expect(one).toHaveBeenCalledTimes(2);
  });

  describe("keeping up", () => {
    it("coalesces many invalidations into one build, then bumps the version and tells listeners", async () => {
      vi.useFakeTimers();
      const catalog = open({ channels: [{ id: a }] });
      const first = await catalog.query({ ...everything, offset: 0, limit: 10 });
      expect(first.version).toBe(1);
      const seen: number[] = [];
      const stop = catalog.onChange((version) => seen.push(version));
      const read = vi.spyOn(source(), "creatorStates");
      const counting = createCatalog({
        pipelineDbPath: () => path,
        source: () => ({ creatorStates: read }) as unknown as DataSource,
        debounceMs: 500,
      });
      closeables.push(counting);
      await counting.query({ ...everything, offset: 0, limit: 10 });
      expect(read).toHaveBeenCalledTimes(1);

      for (let n = 0; n < 10; n += 1) {
        counting.invalidate();
        catalog.invalidate();
      }
      await vi.advanceTimersByTimeAsync(499);
      expect(read).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2);
      expect(read).toHaveBeenCalledTimes(2);
      expect(seen).toEqual([2]);

      stop();
      catalog.invalidate();
      await vi.advanceTimersByTimeAsync(600);
      expect(seen).toEqual([2]);
      expect((await catalog.query({ ...everything, offset: 0, limit: 10 })).version).toBe(3);
    });

    it("makes a query that comes while stale wait for the rebuild", async () => {
      vi.useFakeTimers();
      const catalog = open({ channels: [{ id: a }] });
      await catalog.query({ ...everything, offset: 0, limit: 10 });
      states = [creatorState(a, { stage: "contact" })];
      catalog.invalidate();
      const pending = catalog.query({
        filter: { ...emptyFindFilter, stages: ["contact"] },
        sort: "found",
        offset: 0,
        limit: 10,
      });
      await vi.advanceTimersByTimeAsync(600);
      const page = await pending;
      expect(page.version).toBe(2);
      expect(page.items.map((item) => item.id)).toEqual([a]);
    });

    it("sees rows added to pipeline.db after an invalidation", async () => {
      vi.useFakeTimers();
      const catalog = open({ channels: [{ id: a }] });
      expect((await catalog.query({ ...everything, offset: 0, limit: 10 })).total).toBe(1);
      const db = new DatabaseSync(path);
      db.prepare("INSERT INTO channels (channel_id, handle, first_seen_at) VALUES (?, ?, ?)").run(
        b,
        "@bravo",
        "2026-10-02",
      );
      db.close();
      catalog.invalidate();
      const next = catalog.query({ ...everything, offset: 0, limit: 10 });
      await vi.advanceTimersByTimeAsync(600);
      expect((await next).total).toBe(2);
    });

    it("logs a failed build by kind only and keeps the last good rows", async () => {
      vi.useFakeTimers();
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      let fail = false;
      writePipelineDb(path, { channels: [{ id: a, name: "Secret Name" }] });
      const catalog = createCatalog({
        pipelineDbPath: () => path,
        source: () =>
          ({
            creatorStates: () =>
              fail ? Promise.reject(new Error("disk says Secret Name")) : Promise.resolve([]),
          }) as unknown as DataSource,
      });
      closeables.push(catalog);
      expect((await catalog.query({ ...everything, offset: 0, limit: 10 })).total).toBe(1);
      fail = true;
      catalog.invalidate();
      const page = catalog.query({ ...everything, offset: 0, limit: 10 });
      await vi.advanceTimersByTimeAsync(600);
      const result = await page;
      expect(result.total).toBe(1);
      expect(result.version).toBe(1);
      expect(error).toHaveBeenCalledTimes(1);
      expect(String(error.mock.calls[0]?.[0])).not.toContain("Secret");
    });
  });

  it("handles a heavy owner: 3,000 channels with 15 videos and 16,000 states", async () => {
    const channels: FixtureChannel[] = [];
    const videos: FixtureData["videos"] = [];
    for (let n = 0; n < 3000; n += 1) {
      const id = channelId(`bulk${String(n)}`);
      channels.push({
        id,
        picture: "https://yt3.example/p.jpg",
        median: 1000 + n,
        uploads30: n % 20,
        brands: '["Notion","Cursor"]',
        country: "US",
      });
      for (let v = 0; v < 15; v += 1) {
        videos.push({
          id: `v${String(n).padStart(5, "0")}${String(v).padStart(4, "0")}`.slice(0, 11),
          channel: id,
          publishedAt: `2026-09-${String((v % 28) + 1).padStart(2, "0")}T00:00:00Z`,
          views: String(v * 10),
        });
      }
    }
    writePipelineDb(path, { channels, videos });
    states = Array.from({ length: 16_000 }, (_, n) =>
      creatorState(n < 3000 ? channelId(`bulk${String(n)}`) : channelId(`state${String(n)}`), {
        stage: n % 5 === 0 ? "contact" : "new",
      }),
    );
    const catalog = createCatalog({ pipelineDbPath: () => path, source });
    closeables.push(catalog);

    const t0 = performance.now();
    await catalog.query({ ...everything, offset: 0, limit: 1 });
    const build = performance.now() - t0;
    const t1 = performance.now();
    const page = await catalog.query({ ...everything, sort: "fit", offset: 0, limit: 120 });
    const query = performance.now() - t1;

    expect(page.items).toHaveLength(120);
    expect(page.total).toBeGreaterThan(3000);
    // The targets are a 1.5 s build and a 50 ms query on an idle machine. The whole suite runs in
    // parallel, so the bounds here are three times that: they still catch a slowdown of an order of
    // magnitude without failing on a busy machine.
    if (!process.env.CI) {
      expect(build).toBeLessThan(4500);
      expect(query).toBeLessThan(150);
    }
  });
});
