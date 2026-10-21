import { describe, expect, it } from "vitest";

import { parseRequest } from "./channels";
import { appEvents } from "./events";
import { findStateSchema } from "./find";

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
