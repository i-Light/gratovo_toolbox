import type { DataSource } from "@gratovo/core/data";
import { describe, expect, it, vi } from "vitest";

import type { Account, FindContext } from "../account/account";

import type { Prototype } from "./prototype";
import { prototypeContext, withPrototype } from "./wrap";

const live = { name: "live" } as unknown as DataSource;
const copy = { name: "copy" } as unknown as DataSource;
const liveContext: FindContext = { mode: "live", workerId: "u1", folder: "pipeline" };

function accountWith(source: () => DataSource | null) {
  const teamKeys = { youtubeKey: () => Promise.resolve("key") };
  return {
    status: vi.fn(() => ({ state: "signed-in" as const, email: "maya@example.com" })),
    source: vi.fn(source),
    signIn: vi.fn(() => Promise.resolve({ ok: true as const, state: "signed-in" as const })),
    recheck: vi.fn(() => Promise.resolve({ state: "signed-in" as const, email: null })),
    signOut: vi.fn(() => Promise.resolve()),
    syncStatus: vi.fn(() => ({
      state: "synced" as const,
      pending: 0,
      refused: 0,
      lastSyncedAt: null,
    })),
    syncNow: vi.fn(() =>
      Promise.resolve({ state: "synced" as const, pending: 0, refused: 0, lastSyncedAt: null }),
    ),
    setPresence: vi.fn(),
    start: vi.fn(() => Promise.resolve()),
    close: vi.fn(),
    teamKeys,
    findContext: vi.fn(() => (source() === null ? null : liveContext)),
  } satisfies Account;
}

/** A prototype with only what the wrapper uses: the switch, the copy and `set` (a spy). */
function protoWith(on: boolean, answer?: Prototype["set"]) {
  let isOn = on;
  const set = vi.fn<Prototype["set"]>(
    answer ??
      ((next) => {
        isOn = next;
        return Promise.resolve({ available: true, on: next, scenario: "normal" });
      }),
  );
  const proto = { isOn: () => isOn, source: () => (isOn ? copy : null), set };
  return { proto: proto as unknown as Prototype, set };
}

describe("withPrototype", () => {
  it("is the base account while off", () => {
    const base = accountWith(() => live);
    const wrapped = withPrototype(base, protoWith(false).proto);
    expect(wrapped.source()).toBe(live);
    expect(wrapped.findContext()).toEqual(liveContext);
    wrapped.setPresence({ screen: "find", idle: false });
    expect(base.setPresence).toHaveBeenCalledWith({ screen: "find", idle: false });
  });

  it("answers the copy and example data in the prototype folder while on", () => {
    const base = accountWith(() => live);
    const wrapped = withPrototype(base, protoWith(true).proto);
    expect(wrapped.source()).toBe(copy);
    expect(wrapped.findContext()).toEqual({
      mode: "example",
      workerId: "prototype",
      folder: "prototype-pipeline",
    });
    expect(wrapped.findContext()).toBe(prototypeContext);
  });

  it("sends no presence while on", () => {
    const base = accountWith(() => live);
    const wrapped = withPrototype(base, protoWith(true).proto);
    wrapped.setPresence({ screen: "reach", idle: true });
    expect(base.setPresence).not.toHaveBeenCalled();
  });

  it("hands every other member to the base account", async () => {
    const base = accountWith(() => live);
    const wrapped = withPrototype(base, protoWith(true).proto);
    wrapped.status();
    await wrapped.signIn("maya@example.com", "pw");
    await wrapped.recheck();
    await wrapped.signOut();
    wrapped.syncStatus();
    await wrapped.syncNow();
    await wrapped.start();
    wrapped.close();
    expect(base.status).toHaveBeenCalledOnce();
    expect(base.signIn).toHaveBeenCalledWith("maya@example.com", "pw");
    expect(base.recheck).toHaveBeenCalledOnce();
    expect(base.signOut).toHaveBeenCalledOnce();
    expect(base.syncStatus).toHaveBeenCalledOnce();
    expect(base.syncNow).toHaveBeenCalledOnce();
    expect(base.start).toHaveBeenCalledOnce();
    expect(base.close).toHaveBeenCalledOnce();
    expect(wrapped.teamKeys).toBe(base.teamKeys);
  });

  it("turns itself off, once, when the base source goes away while on", () => {
    let open: DataSource | null = live;
    const base = accountWith(() => open);
    const { proto, set } = protoWith(true, () => new Promise(() => undefined));
    const wrapped = withPrototype(base, proto);
    expect(wrapped.source()).toBe(copy);
    open = null;
    expect(wrapped.source()).toBeNull();
    expect(wrapped.findContext()).toBeNull();
    expect(wrapped.source()).toBeNull();
    expect(set).toHaveBeenCalledOnce();
    expect(set).toHaveBeenCalledWith(false);
  });

  it("asks again after a turn-off that failed, and logs only the error's kind", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const base = accountWith(() => null);
    const failing = Object.assign(new Error("C:\\Users\\maya\\secret path"), { code: "EBUSY" });
    const { proto, set } = protoWith(true, () => Promise.reject(failing));
    const wrapped = withPrototype(base, proto);
    expect(wrapped.source()).toBeNull();
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledOnce();
    });
    expect(String(warn.mock.calls[0]?.[0])).toContain("EBUSY");
    expect(String(warn.mock.calls[0]?.[0])).not.toContain("maya");
    // The failed turn-off has settled: the next read asks again.
    await Promise.resolve();
    wrapped.source();
    expect(set).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
