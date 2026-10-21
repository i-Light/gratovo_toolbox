import { exampleFrame } from "@gratovo/core/data";
import { describe, expect, it, vi } from "vitest";

import { createDispatcher, type Handlers } from "./dispatch";

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

  it("refuses a response of the wrong shape", async () => {
    const wrong = () => ({ ok: true as const, version: "" });
    const { dispatch, onError } = setup({ "app:ping": wrong });
    expect((await dispatch("app:ping", {})).ok).toBe(false);
    expect(onError).toHaveBeenCalledOnce();
  });
});
