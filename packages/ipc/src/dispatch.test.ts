import { exampleFrame } from "@gratovo/core/data";
import { emptyFacets } from "@gratovo/core/find";
import { describe, expect, it, vi } from "vitest";

import { createDispatcher, type Handlers } from "./dispatch";

const gemini = {
  state: "stopped" as const,
  addon: { state: "missing" as const, version: null },
  browser: null,
  problem: null,
};

const connectionsStatus = {
  python: { state: "ready" as const },
  youtube: { state: "available" as const },
  gemini,
  mailApp: { set: false },
  mailboxes: [],
  mail: { label: "Gratovo", senderName: null },
  proxies: { count: 0, enabled: false, includeDirect: true },
  pacing: "normal" as const,
  parallel: { enabled: false, maxWorkers: 1 },
  aws: { keys: false, enabled: false, regions: [] },
  course: { courseDir: null, videoDir: null, courseFound: false },
  sync: { state: "off" as const },
  import: { state: "never" as const, at: null, backup: null },
};

function setup(overrides: Partial<Handlers> = {}) {
  const handlers: Handlers = {
    "app:ping": vi.fn(() => ({ ok: true as const, version: "1.2.3" })),
    "secrets:status": vi.fn(({ name }) => Promise.resolve({ set: name === "gemini.api-key" })),
    "frame:load": vi.fn(() => exampleFrame(0)),
    "data:write": vi.fn(() => ({})),
    "auth:status": vi.fn(() => ({ state: "unconfigured" as const, email: null })),
    "auth:sign-in": vi.fn(() => ({ ok: true as const, state: "signed-in" as const })),
    "auth:recheck": vi.fn(() => ({ state: "unconfigured" as const, email: null })),
    "auth:sign-out": vi.fn(() => ({})),
    "sync:status": vi.fn(() => ({
      state: "off" as const,
      pending: 0,
      refused: 0,
      lastSyncedAt: null,
    })),
    "sync:now": vi.fn(() => ({
      state: "off" as const,
      pending: 0,
      refused: 0,
      lastSyncedAt: null,
    })),
    "presence:set": vi.fn(() => ({})),
    "find:state": vi.fn(() => ({
      queue: [],
      at: 0,
      rules: {
        countries: [],
        perKeyword: 200,
        sortBy: "upload_date" as const,
        resultsType: "video" as const,
        autoClean: {
          enabled: true,
          minSubscribers: 50_000,
          maxSubscribers: 2_000_000,
          belowMin: "sweep" as const,
          aboveMax: "delay" as const,
          label: "inactive",
        },
        minMedianViews: null,
        minUploads30: null,
        archiveDays: 7,
      },
      run: { state: "ready" as const, found: 0, kept: 0, swept: 0, error: null },
      log: [],
      kept: [],
    })),
    "find:add": vi.fn(() => ({ added: 0, skipped: 0 })),
    "find:remove": vi.fn(() => ({ ok: true as const })),
    "find:start-at": vi.fn(() => ({ ok: true as const })),
    "find:start": vi.fn(() => ({ ok: true as const })),
    "find:stop": vi.fn(() => ({})),
    "find:query": vi.fn(() => ({ version: 0, total: 0, items: [], facets: emptyFacets })),
    "find:item": vi.fn(() => ({ item: null })),
    "find:runs": vi.fn(() => ({ runs: [] })),
    "find:views": vi.fn(() => ({ views: [] })),
    "find:views-set": vi.fn(() => ({ ok: true as const })),
    "log:for": vi.fn(() => ({ lines: [] })),
    "rules:set": vi.fn(() => ({})),
    "import:candidates": vi.fn(() => ({ candidates: [] })),
    "import:pick": vi.fn(() => ({ path: null })),
    "import:dry-run": vi.fn(() => ({ ok: false as const, reason: "not_built" as const })),
    "import:run": vi.fn(() => ({ ok: false as const, reason: "not_built" as const })),
    "writing:rules": vi.fn(() => ({ found: false, rules: [] })),
    "connections:status": vi.fn(() => connectionsStatus),
    "connections:set": vi.fn(() => ({ ok: true as const })),
    "connections:pick-folder": vi.fn(() => ({ path: null })),
    "mail:connect": vi.fn(() => ({ ok: false as const, reason: "not_built" as const })),
    "mail:check": vi.fn(() => ({ ok: false as const, reason: "not_built" as const })),
    "gateways:deploy": vi.fn(() => ({ ok: false as const, reason: "not_built" as const })),
    "gateways:remove": vi.fn(() => ({ ok: false as const, reason: "not_built" as const })),
    "gemini:start": vi.fn(() => gemini),
    "gemini:stop": vi.fn(() => gemini),
    "gemini:open-window": vi.fn(() => gemini),
    ...overrides,
  };
  const onError = vi.fn();
  return { handlers, onError, dispatch: createDispatcher(handlers, onError) };
}

describe("createDispatcher", () => {
  it("runs the channel's handler and returns its response", async () => {
    const { dispatch } = setup();
    expect(await dispatch("app:ping", {})).toEqual({
      ok: true,
      value: { ok: true, version: "1.2.3" },
    });
  });

  it("passes the parsed request to async handlers", async () => {
    const { dispatch, handlers } = setup();
    expect(await dispatch("secrets:status", { name: "gemini.api-key" })).toEqual({
      ok: true,
      value: { set: true },
    });
    expect(handlers["secrets:status"]).toHaveBeenCalledWith({ name: "gemini.api-key" });
  });

  it("refuses a channel that is not a string", async () => {
    const { dispatch } = setup();
    for (const channel of [undefined, 42, { name: "app:ping" }, ["app:ping"]]) {
      expect(await dispatch(channel, {})).toEqual({
        ok: false,
        reason: "The channel must be a name",
      });
    }
  });

  it("refuses unknown channels and bad requests without running a handler", async () => {
    const { dispatch, handlers } = setup();
    expect((await dispatch("fs:read", { path: "C:/Users" })).ok).toBe(false);
    expect((await dispatch("__proto__", {})).ok).toBe(false);
    expect((await dispatch("app:ping", { extra: true })).ok).toBe(false);
    expect((await dispatch("secrets:status", { name: "../keys" })).ok).toBe(false);
    expect(handlers["app:ping"]).not.toHaveBeenCalled();
    expect(handlers["secrets:status"]).not.toHaveBeenCalled();
  });

  it("reports a handler's error in the main process and tells the page only that it failed", async () => {
    const error = new Error("disk full at C:/Users/owner/secrets.json");
    const { dispatch, onError } = setup({
      "app:ping": () => {
        throw error;
      },
    });
    const result = await dispatch("app:ping", {});
    expect(result).toEqual({ ok: false, reason: "The call failed" });
    expect(JSON.stringify(result)).not.toContain("disk full");
    expect(onError).toHaveBeenCalledWith("app:ping", error);
  });

  it("reports a rejected promise the same way", async () => {
    const { dispatch, onError } = setup({
      "secrets:status": () => Promise.reject(new Error("locked")),
    });
    expect(await dispatch("secrets:status", { name: "gemini.api-key" })).toEqual({
      ok: false,
      reason: "The call failed",
    });
    expect(onError).toHaveBeenCalledOnce();
  });

  it("refuses a response with fields the contract doesn't declare", async () => {
    const leaky = () => ({ set: true, value: "sk-test-000" });
    const { dispatch, onError } = setup({ "secrets:status": leaky });
    const result = await dispatch("secrets:status", { name: "gemini.api-key" });
    expect(result).toEqual({ ok: false, reason: "The call failed" });
    expect(JSON.stringify(result)).not.toContain("sk-test-000");
    expect(onError).toHaveBeenCalledWith("secrets:status", expect.any(Error));
  });

  it("refuses a connections status that carries a secret", async () => {
    const leaky = () => ({ ...connectionsStatus, mailApp: { set: true, secret: "gocspx-000" } });
    const { dispatch, onError } = setup({ "connections:status": leaky });
    const result = await dispatch("connections:status", {});
    expect(result).toEqual({ ok: false, reason: "The call failed" });
    expect(JSON.stringify(result)).not.toContain("gocspx-000");
    expect(onError).toHaveBeenCalledWith("connections:status", expect.any(Error));
  });

  it("passes a parsed connections change to its handler, and refuses an unknown kind", async () => {
    const { dispatch, handlers } = setup();
    const change = { kind: "gateways.enabled", enabled: true };
    expect(await dispatch("connections:set", change)).toEqual({ ok: true, value: { ok: true } });
    expect(handlers["connections:set"]).toHaveBeenCalledWith(change);
    expect((await dispatch("connections:set", { kind: "youtube.key", key: "x" })).ok).toBe(false);
    expect(handlers["connections:set"]).toHaveBeenCalledOnce();
  });

  it("refuses a response of the wrong shape", async () => {
    const wrong = () => ({ ok: true as const, version: "" });
    const { dispatch, onError } = setup({ "app:ping": wrong });
    expect((await dispatch("app:ping", {})).ok).toBe(false);
    expect(onError).toHaveBeenCalledOnce();
  });
});
