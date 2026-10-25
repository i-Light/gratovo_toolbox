import { describe, expect, it } from "vitest";

import { channels, parseRequest } from "./channels";
import { archivedChannelSchema, toolboxItemSchema } from "./toolbox";

const ada = "UCaaaaaaaaaaaaaaaaaaaaaa";
const bo = "UCbbbbbbbbbbbbbbbbbbbbbb";

const item = {
  id: ada,
  name: "Prompt Lab",
  handle: "@promptlab",
  pic: `c:${ada}`,
  stage: "never",
  emailConfirmed: false,
  email: null,
  contactName: null,
  subscribers: 120_000,
  medianViews: 52_000,
  uploads30: 8,
  country: "US",
  sponsors: ["Codewell"],
  emails: [],
  latestUploadAt: 2,
  foundAt: 3,
  run: 4,
  keyword: "ai coding tools",
  videos: [],
  engagement: null,
  emailedBefore: null,
  rejectReason: null,
  rejectedAt: 5,
  neverReason: "Asked us to stop",
  archiveDueAt: null,
  archivedAt: null,
  hasNumbers: true,
  uploadsRead: true,
  dueAt: null,
};

const archived = {
  id: bo,
  handle: "@agentdaily",
  name: "Agent Daily",
  label: "rejected",
  archivedAt: 6,
  subscribers: 40_000,
  stage: "rejected",
  country: "US",
  medianViews: 52_000,
  uploads30: 6,
  latestUploadAt: 9,
  videos: 31,
  keywords: [
    { keyword: "ai coding tools", at: 3 },
    { keyword: "agent news", at: null },
  ],
};

describe("toolboxItemSchema", () => {
  it("takes a catalog item with its due date", () => {
    expect(toolboxItemSchema.safeParse(item).success).toBe(true);
    const due = { ...item, stage: "rejected", neverReason: null, dueAt: 7, archivedAt: 8 };
    expect(toolboxItemSchema.safeParse(due).success).toBe(true);
  });

  it("refuses a missing due date, a long never reason and an extra key", () => {
    const noDue = Object.fromEntries(Object.entries(item).filter(([key]) => key !== "dueAt"));
    expect(toolboxItemSchema.safeParse(noDue).success).toBe(false);
    const long = { ...item, neverReason: "x".repeat(501) };
    expect(toolboxItemSchema.safeParse(long).success).toBe(false);
    expect(toolboxItemSchema.safeParse({ ...item, extra: 1 }).success).toBe(false);
  });
});

describe("archivedChannelSchema", () => {
  it("takes a tombstone, with or without what the app knows of it", () => {
    expect(archivedChannelSchema.safeParse(archived).success).toBe(true);
    const bare = {
      id: bo,
      handle: null,
      name: null,
      label: null,
      archivedAt: null,
      subscribers: null,
      stage: null,
      country: null,
      medianViews: null,
      uploads30: null,
      latestUploadAt: null,
      videos: null,
      keywords: [],
    };
    expect(archivedChannelSchema.safeParse(bare).success).toBe(true);
  });

  it("refuses an empty or long id, long text, an unknown stage and an extra key", () => {
    const parse = (value: unknown) => archivedChannelSchema.safeParse(value).success;
    expect(parse({ ...archived, id: "" })).toBe(false);
    expect(parse({ ...archived, id: "x".repeat(101) })).toBe(false);
    expect(parse({ ...archived, label: "x".repeat(501) })).toBe(false);
    expect(parse({ ...archived, stage: "gone" })).toBe(false);
    expect(parse({ ...archived, extra: 1 })).toBe(false);
  });

  it("bounds what the tombstone kept", () => {
    const parse = (value: unknown) => archivedChannelSchema.safeParse(value).success;
    const word = (n: number) => ({ keyword: `ai tools ${String(n)}`, at: n });
    expect(parse({ ...archived, keywords: Array.from({ length: 50 }, (_, n) => word(n)) })).toBe(
      true,
    );
    expect(parse({ ...archived, keywords: Array.from({ length: 51 }, (_, n) => word(n)) })).toBe(
      false,
    );
    expect(parse({ ...archived, keywords: [{ keyword: "x".repeat(501), at: null }] })).toBe(false);
    expect(parse({ ...archived, country: "usa" })).toBe(false);
    expect(parse({ ...archived, medianViews: -1 })).toBe(false);
    expect(parse({ ...archived, videos: 1.5 })).toBe(false);
    const noKeywords: Record<string, unknown> = { ...archived };
    delete noKeywords.keywords;
    expect(parse(noKeywords)).toBe(false);
  });
});

describe("toolbox:list", () => {
  const request = { list: "archive", offset: 0, limit: 120 };

  it("takes a list and a page of at most 120", () => {
    expect(parseRequest("toolbox:list", request).ok).toBe(true);
    const last = { ...request, list: "never", offset: 100_000 };
    expect(parseRequest("toolbox:list", last).ok).toBe(true);
    expect(parseRequest("toolbox:list", { ...request, list: "log" }).ok).toBe(false);
    expect(parseRequest("toolbox:list", { ...request, limit: 0 }).ok).toBe(false);
    expect(parseRequest("toolbox:list", { ...request, limit: 121 }).ok).toBe(false);
    expect(parseRequest("toolbox:list", { ...request, offset: 100_001 }).ok).toBe(false);
    expect(parseRequest("toolbox:list", { ...request, q: "ai" }).ok).toBe(false);
  });

  it("answers at most 120 items with the version and total", () => {
    const parse = (value: unknown) => channels["toolbox:list"].response.safeParse(value).success;
    expect(parse({ version: 1, total: 1, items: [item] })).toBe(true);
    expect(parse({ version: 1, total: 121, items: Array(121).fill(item) })).toBe(false);
    expect(parse({ version: 1, total: 0, items: [], more: false })).toBe(false);
  });
});

describe("toolbox:archived", () => {
  const request = { q: "", offset: 0, limit: 50 };

  it("takes a search of at most 100 characters and a page of at most 100", () => {
    expect(parseRequest("toolbox:archived", request).ok).toBe(true);
    expect(parseRequest("toolbox:archived", { ...request, q: "x".repeat(100) }).ok).toBe(true);
    expect(parseRequest("toolbox:archived", { ...request, q: "x".repeat(101) }).ok).toBe(false);
    expect(parseRequest("toolbox:archived", { ...request, limit: 101 }).ok).toBe(false);
    expect(parseRequest("toolbox:archived", { ...request, limit: 0 }).ok).toBe(false);
    expect(parseRequest("toolbox:archived", { ...request, sort: "name" }).ok).toBe(false);
  });

  it("answers at most 100 tombstones", () => {
    const parse = (value: unknown) =>
      channels["toolbox:archived"].response.safeParse(value).success;
    expect(parse({ total: 1, items: [archived] })).toBe(true);
    expect(parse({ total: 101, items: Array(101).fill(archived) })).toBe(false);
    expect(parse({ total: -1, items: [] })).toBe(false);
  });
});

describe("toolbox:restore", () => {
  it("takes 1 to 50 YouTube channel ids, each once", () => {
    expect(parseRequest("toolbox:restore", { ids: [ada, bo] }).ok).toBe(true);
    const fifty = Array.from({ length: 50 }, (_, i) => `UC${String(i).padStart(22, "0")}`);
    expect(parseRequest("toolbox:restore", { ids: fifty }).ok).toBe(true);
    expect(parseRequest("toolbox:restore", { ids: [...fifty, ada] }).ok).toBe(false);
    expect(parseRequest("toolbox:restore", { ids: [] }).ok).toBe(false);
    expect(parseRequest("toolbox:restore", { ids: [ada, ada] }).ok).toBe(false);
    expect(parseRequest("toolbox:restore", { ids: ["not-a-channel"] }).ok).toBe(false);
    expect(parseRequest("toolbox:restore", { ids: [ada], refetch: true }).ok).toBe(false);
  });

  it("answers what came back, or why nothing did", () => {
    const parse = (value: unknown) => channels["toolbox:restore"].response.safeParse(value).success;
    expect(parse({ ok: true, restored: 2, refetch: true })).toBe(true);
    expect(parse({ ok: false, problem: "busy" })).toBe(true);
    expect(parse({ ok: false, problem: "no_python" })).toBe(true);
    expect(parse({ ok: true, restored: 51, refetch: false })).toBe(false);
    expect(parse({ ok: false, problem: "crash" })).toBe(false);
    expect(parse({ ok: true, restored: 1, refetch: false, extra: 1 })).toBe(false);
  });
});

describe("toolbox:sweep and toolbox:counts", () => {
  it("toolbox:sweep takes and answers nothing", () => {
    expect(parseRequest("toolbox:sweep", {}).ok).toBe(true);
    expect(parseRequest("toolbox:sweep", { now: true }).ok).toBe(false);
    expect(channels["toolbox:sweep"].response.safeParse({}).success).toBe(true);
  });

  it("toolbox:counts answers four counts and nothing else", () => {
    expect(parseRequest("toolbox:counts", {}).ok).toBe(true);
    const parse = (value: unknown) => channels["toolbox:counts"].response.safeParse(value).success;
    const counts = { archive: 3, never: 1, archived: 40, logToday: 12 };
    expect(parse(counts)).toBe(true);
    expect(parse({ ...counts, archive: -1 })).toBe(false);
    expect(parse({ ...counts, archive: 1.5 })).toBe(false);
    expect(parse({ ...counts, extra: 1 })).toBe(false);
  });
});
