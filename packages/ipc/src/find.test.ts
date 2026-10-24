import { emptyFacets, emptyFindFilter, queryCatalog, type CatalogItem } from "@gratovo/core/find";
import { describe, expect, it } from "vitest";

import { channels, parseRequest } from "./channels";
import { appEvents } from "./events";
import { findQueryResultSchema, findStateSchema } from "./find";

const state = {
  queue: [
    { keyword: "ai coding tools", state: "done", found: 12, kept: 4 },
    { keyword: "local llm tutorials", state: "queued", found: 0, kept: 0 },
  ],
  at: 1,
  rules: {
    countries: ["US", "GB"],
    perKeyword: 200,
    sortBy: "upload_date",
    resultsType: "video",
    autoClean: {
      enabled: true,
      minSubscribers: 50_000,
      maxSubscribers: 2_000_000,
      belowMin: "sweep",
      aboveMax: "delay",
      label: "inactive",
    },
    minMedianViews: 5_000,
    minUploads30: null,
    archiveDays: 7,
  },
  run: { state: "paused", found: 12, kept: 4, swept: 3, error: null },
  log: [{ at: 1_000, level: "info", text: "keyword done" }],
  kept: [
    {
      channelId: "UCexample_ai-1",
      name: "Prompt Lab",
      handle: "@promptlab",
      subscribers: 120_000,
      medianViews: null,
      country: "US",
      keyword: "ai coding tools",
    },
  ],
};

describe("findStateSchema", () => {
  it("accepts a full state, and the event carries the same schema", () => {
    expect(findStateSchema.safeParse(state).success).toBe(true);
    // Kept channels come in every size: past a million subscribers is common.
    const [first] = state.kept;
    const huge = { ...first, subscribers: 350_000_000, medianViews: 2_000_000_000 };
    expect(findStateSchema.safeParse({ ...state, kept: [huge] }).success).toBe(true);
    expect(appEvents["find:changed"]).toBe(findStateSchema);
  });

  it("refuses a bad state", () => {
    expect(findStateSchema.safeParse({ ...state, extra: 1 }).success).toBe(false);
    expect(findStateSchema.safeParse({ ...state, at: 501 }).success).toBe(false);
    expect(
      findStateSchema.safeParse({ ...state, run: { ...state.run, error: "boom text" } }).success,
    ).toBe(false);
    expect(
      findStateSchema.safeParse({
        ...state,
        queue: [{ keyword: "", state: "queued", found: 0, kept: 0 }],
      }).success,
    ).toBe(false);
    expect(
      findStateSchema.safeParse({
        ...state,
        kept: [{ ...state.kept[0], country: "usa" }],
      }).success,
    ).toBe(false);
    expect(
      findStateSchema.safeParse({ ...state, log: Array(201).fill(state.log[0]) }).success,
    ).toBe(false);
  });
});

describe("the find channels' requests", () => {
  it("limits find:add to 1..500 keywords of 1..200 characters", () => {
    expect(parseRequest("find:add", { keywords: ["ai agents"] }).ok).toBe(true);
    expect(parseRequest("find:add", { keywords: [] }).ok).toBe(false);
    expect(parseRequest("find:add", { keywords: Array(501).fill("a") }).ok).toBe(false);
    expect(parseRequest("find:add", { keywords: ["a".repeat(201)] }).ok).toBe(false);
    expect(parseRequest("find:add", { keywords: [""] }).ok).toBe(false);
    expect(parseRequest("find:add", { keywords: ["a"], extra: 1 }).ok).toBe(false);
  });

  it("limits the index of find:remove and find:start-at to 0..499", () => {
    for (const channel of ["find:remove", "find:start-at"]) {
      expect(parseRequest(channel, { index: 0 }).ok).toBe(true);
      expect(parseRequest(channel, { index: 499 }).ok).toBe(true);
      expect(parseRequest(channel, { index: 500 }).ok).toBe(false);
      expect(parseRequest(channel, { index: -1 }).ok).toBe(false);
      expect(parseRequest(channel, { index: 1.5 }).ok).toBe(false);
    }
  });

  it("takes no input on find:state, find:start and find:stop", () => {
    for (const channel of ["find:state", "find:start", "find:stop"]) {
      expect(parseRequest(channel, {}).ok).toBe(true);
      expect(parseRequest(channel, { force: true }).ok).toBe(false);
    }
  });
});

describe("the catalog channels", () => {
  const video = {
    id: "dQw4w9WgXcQ",
    title: "Claude Code in 10 minutes",
    views: 48_000,
    publishedAt: 1,
    pic: "v:dQw4w9WgXcQ",
  };
  const item = {
    id: "UCaaaaaaaaaaaaaaaaaaaaaa",
    name: "Prompt Lab",
    handle: "@promptlab",
    pic: "c:UCaaaaaaaaaaaaaaaaaaaaaa",
    stage: "new",
    emailConfirmed: false,
    email: null,
    contactName: null,
    subscribers: null,
    medianViews: 52_000,
    uploads30: 8,
    country: "US",
    sponsors: ["Codewell"],
    emails: [
      {
        email: "biz@promptlab.tv",
        source: "about",
        videos: 0,
        business: true,
        confidence: 0.95,
      },
    ],
    latestUploadAt: 2,
    foundAt: 3,
    run: 4,
    keyword: "ai coding tools",
    videos: [video],
    engagement: null,
    emailedBefore: null,
    rejectReason: null,
    rejectedAt: null,
    neverReason: null,
    archiveDueAt: null,
    archivedAt: null,
    hasNumbers: true,
  };
  const fit = {
    score: 70,
    parts: [{ key: "median", points: 30, of: 30, note: "52k median views" }],
  };
  const request = { filter: emptyFindFilter, sort: "triage", offset: 0, limit: 120 };

  it("find:query takes a filter, a sort and a page of at most 120", () => {
    expect(parseRequest("find:query", request).ok).toBe(true);
    expect(parseRequest("find:query", { ...request, limit: 121 }).ok).toBe(false);
    expect(parseRequest("find:query", { ...request, sort: "random" }).ok).toBe(false);
    expect(
      parseRequest("find:query", { ...request, filter: { ...emptyFindFilter, q: "x".repeat(201) } })
        .ok,
    ).toBe(false);
  });

  it("find:query may skip the facets, and nothing else rides along", () => {
    expect(parseRequest("find:query", { ...request, facets: false }).ok).toBe(true);
    expect(parseRequest("find:query", { ...request, facets: true }).ok).toBe(true);
    expect(parseRequest("find:query", { ...request, facets: "no" }).ok).toBe(false);
  });

  it("a channel with 50 long sponsor names still makes a valid page", () => {
    const sponsors = Array.from(
      { length: 50 },
      (_, i) => `${String(i)} ${"Agentic AI".repeat(10)}`,
    );
    const many = { ...item, sponsors } as CatalogItem;
    const page = queryCatalog([many], emptyFindFilter, "fit", 0, 120);
    const answer = { version: 1, total: page.total, items: [...page.items], facets: page.facets };
    expect(findQueryResultSchema.safeParse(answer).success).toBe(true);
  });

  it("find:query answers items with their fit, at most 3 videos each, and the facets", () => {
    const response = channels["find:query"].response;
    const ok = { version: 1, total: 1, items: [{ ...item, fit }], facets: emptyFacets };
    expect(response.safeParse(ok).success).toBe(true);
    const four = { ...item, fit, videos: Array(4).fill(video) };
    expect(response.safeParse({ ...ok, items: [four] }).success).toBe(false);
    expect(response.safeParse({ ...ok, items: [{ ...item }] }).success).toBe(false);
  });

  it("find:item takes one id and answers the detail with up to 15 videos, or null", () => {
    expect(parseRequest("find:item", { id: item.id }).ok).toBe(true);
    expect(parseRequest("find:item", { id: "x".repeat(101) }).ok).toBe(false);
    const response = channels["find:item"].response;
    const detail = {
      ...item,
      fit,
      description: "AI tools, weekly.",
      videos: Array(15).fill(video),
    };
    expect(response.safeParse({ item: detail }).success).toBe(false);
    const withNotes = { ...detail, notes: "Wants a demo of the agent first.", notesCut: false };
    expect(response.safeParse({ item: withNotes }).success).toBe(true);
    expect(response.safeParse({ item: null }).success).toBe(true);
    expect(
      response.safeParse({ item: { ...withNotes, description: "x".repeat(5001) } }).success,
    ).toBe(false);
    expect(response.safeParse({ item: { ...withNotes, notes: "x".repeat(50_000) } }).success).toBe(
      true,
    );
    expect(response.safeParse({ item: { ...withNotes, notes: "x".repeat(50_001) } }).success).toBe(
      false,
    );
  });

  it("find:runs takes nothing and answers at most 50 runs", () => {
    expect(parseRequest("find:runs", {}).ok).toBe(true);
    expect(parseRequest("find:runs", { limit: 5 }).ok).toBe(false);
    const run = {
      id: 4,
      startedAt: 1,
      finishedAt: null,
      status: "running",
      keywords: 12,
      found: 40,
      kept: 9,
      gold: 2,
    };
    const response = channels["find:runs"].response;
    expect(response.safeParse({ runs: [run] }).success).toBe(true);
    expect(response.safeParse({ runs: Array(51).fill(run) }).success).toBe(false);
  });

  it("find:views takes nothing and answers at most 20 views", () => {
    const view = { name: "Gold mines in the US", filter: emptyFindFilter };
    expect(parseRequest("find:views", {}).ok).toBe(true);
    expect(parseRequest("find:views", { limit: 5 }).ok).toBe(false);
    const response = channels["find:views"].response;
    expect(response.safeParse({ views: [] }).success).toBe(true);
    expect(response.safeParse({ views: Array(20).fill(view) }).success).toBe(true);
    expect(response.safeParse({ views: Array(21).fill(view) }).success).toBe(false);
  });

  it("find:views-set trims each name, bounds it to 1..60, and checks the filter", () => {
    const view = { name: "Gold mines in the US", filter: emptyFindFilter };
    const set = (views: unknown) => parseRequest("find:views-set", { views });
    expect(set([view]).ok).toBe(true);
    expect(set([]).ok).toBe(true);
    const trimmed = set([{ ...view, name: "  AI news  " }]);
    expect(trimmed.ok && trimmed.channel === "find:views-set" && trimmed.value.views[0]?.name).toBe(
      "AI news",
    );
    expect(set([{ ...view, name: "   " }]).ok).toBe(false);
    expect(set([{ ...view, name: "x".repeat(60) }]).ok).toBe(true);
    expect(set([{ ...view, name: "x".repeat(61) }]).ok).toBe(false);
    expect(set([{ ...view, filter: { ...emptyFindFilter, stages: ["won"] } }]).ok).toBe(false);
    expect(set([{ ...view, color: "gold" }]).ok).toBe(false);
    // More than 20 reaches main, which answers too_many; the call itself stays bounded.
    expect(set(Array(21).fill(view)).ok).toBe(true);
    expect(set(Array(101).fill(view)).ok).toBe(false);
  });

  it("find:views-set answers ok, or too_many and nothing else", () => {
    const response = channels["find:views-set"].response;
    expect(response.safeParse({ ok: true }).success).toBe(true);
    expect(response.safeParse({ ok: false, problem: "too_many" }).success).toBe(true);
    expect(response.safeParse({ ok: false, problem: "full" }).success).toBe(false);
    expect(response.safeParse({ ok: true, problem: "too_many" }).success).toBe(false);
  });

  it("an item carries at most 10 found addresses, each bounded and in an address's shape", () => {
    const response = channels["find:query"].response;
    const page = (over: Record<string, unknown>) => ({
      version: 1,
      total: 1,
      items: [{ ...item, fit, ...over }],
      facets: emptyFacets,
    });
    const found = item.emails[0];
    expect(response.safeParse(page({ emails: Array(10).fill(found) })).success).toBe(true);
    expect(response.safeParse(page({ emails: Array(11).fill(found) })).success).toBe(false);
    const bad = [
      { ...found, email: "not an address" },
      { ...found, email: "biz@promptlab" },
      { ...found, email: `${"a".repeat(250)}@x.tv` },
      { ...found, source: "typed" },
      { ...found, videos: -1 },
      { ...found, confidence: 1.2 },
      { ...found, confidence: -0.1 },
      { ...found, extra: true },
    ];
    for (const email of bad) {
      expect(response.safeParse(page({ emails: [email] })).success).toBe(false);
    }
    expect(response.safeParse(page({ contactName: "Maya" })).success).toBe(true);
    expect(response.safeParse(page({ contactName: "x".repeat(80) })).success).toBe(true);
    expect(response.safeParse(page({ contactName: "x".repeat(81) })).success).toBe(false);
    // The old count is gone.
    expect(response.safeParse(page({ foundEmails: 1 })).success).toBe(false);
  });

  it("find:ideas takes a count of 1..20 and answers keywords or a problem", () => {
    expect(parseRequest("find:ideas", { count: 1 }).ok).toBe(true);
    expect(parseRequest("find:ideas", { count: 20 }).ok).toBe(true);
    for (const count of [0, 21, 2.5, "8"]) {
      expect(parseRequest("find:ideas", { count }).ok).toBe(false);
    }
    expect(parseRequest("find:ideas", { count: 8, topic: "AI" }).ok).toBe(false);
    const response = channels["find:ideas"].response;
    const ok = {
      ok: true,
      keywords: ["claude code tutorial", "ai agents for beginners"],
      dropped: 1,
    };
    expect(response.safeParse(ok).success).toBe(true);
    expect(response.safeParse({ ...ok, keywords: Array(21).fill("ai news") }).success).toBe(false);
    expect(response.safeParse({ ...ok, keywords: [""] }).success).toBe(false);
    expect(response.safeParse({ ...ok, keywords: ["x".repeat(201)] }).success).toBe(false);
    for (const problem of ["bridge_off", "busy", "failed"]) {
      expect(response.safeParse({ ok: false, problem }).success).toBe(true);
    }
    expect(response.safeParse({ ok: false, problem: "quota" }).success).toBe(false);
    expect(response.safeParse({ ok: true, problem: "busy" }).success).toBe(false);
  });

  it("find:catalog carries the catalog's version and nothing else", () => {
    const schema = appEvents["find:catalog"];
    expect(schema.safeParse({ version: 3 }).success).toBe(true);
    expect(schema.safeParse({ version: -1 }).success).toBe(false);
    expect(schema.safeParse({ version: 3, items: [] }).success).toBe(false);
  });
});
