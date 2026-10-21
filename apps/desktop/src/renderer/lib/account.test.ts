// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import { lastSyncWaitMs, signOut } from "./account";

describe("signOut", () => {
  it("asks for one last sync, then signs out", async () => {
    const calls: string[] = [];
    const invoke = ((channel: string) => {
      calls.push(channel);
      return Promise.resolve({ ok: true, value: {} });
    }) as never;
    await signOut(invoke);
    expect(calls).toEqual(["sync:now", "auth:sign-out"]);
  });

  it("signs out even when the last sync throws", async () => {
    const calls: string[] = [];
    const invoke = ((channel: string) => {
      calls.push(channel);
      return channel === "sync:now"
        ? Promise.reject(new Error("x"))
        : Promise.resolve({ ok: true });
    }) as never;
    await signOut(invoke);
    expect(calls).toEqual(["sync:now", "auth:sign-out"]);
  });

  it("doesn't wait more than a few seconds for a last sync that hangs", async () => {
    vi.useFakeTimers();
    try {
      const calls: string[] = [];
      const invoke = ((channel: string) => {
        calls.push(channel);
        return channel === "sync:now"
          ? new Promise(() => undefined)
          : Promise.resolve({ ok: true });
      }) as never;
      const done = signOut(invoke);
      await vi.advanceTimersByTimeAsync(10_000 + lastSyncWaitMs);
      await done;
      expect(calls).toEqual(["sync:now", "auth:sign-out"]);
    } finally {
      vi.useRealTimers();
    }
  });
});
