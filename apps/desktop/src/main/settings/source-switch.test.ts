import type { DataSource } from "@gratovo/core/data";
import { describe, expect, it, vi } from "vitest";

import type { Account } from "../account/account";

import { createSourceWatch, withSourceChecks } from "./source-switch";

const sourceA = { name: "a" } as unknown as DataSource;
const sourceB = { name: "b" } as unknown as DataSource;

/** An account whose calls open or close sources as a test says; nothing else is real. */
function fakeAccount() {
  const state: { open: DataSource | null; reload: () => void } = {
    open: null,
    reload: () => undefined,
  };
  const calls = {
    signIn: vi.fn<Account["signIn"]>(),
    recheck: vi.fn<Account["recheck"]>(),
    signOut: vi.fn<Account["signOut"]>(),
  };
  const account = {
    source: () => state.open,
    ...calls,
    findContext: () => ({ mode: "live", workerId: "user-1" }),
    teamKeys: { youtubeKey: () => Promise.resolve(null) },
  } as unknown as Account;
  return { state, account, calls };
}

/** As index.ts wires it: the account's reload and every source-changing call run the check. */
function wire() {
  const { state, account, calls } = fakeAccount();
  const onSwitch = vi.fn<() => void>();
  const watch = createSourceWatch(() => account.source(), onSwitch);
  state.reload = () => {
    watch.check();
  };
  return {
    state,
    raw: { ...calls, findContext: () => account.findContext(), teamKeys: account.teamKeys },
    account: withSourceChecks(account, watch.check),
    watch,
    onSwitch,
  };
}

describe("the source watch", () => {
  it("calls onSwitch once per change of the open source", () => {
    let open: DataSource | null = null;
    const onSwitch = vi.fn<() => void>();
    const watch = createSourceWatch(() => open, onSwitch);
    watch.check();
    expect(onSwitch).not.toHaveBeenCalled();
    open = sourceA;
    watch.check();
    watch.check();
    expect(onSwitch).toHaveBeenCalledTimes(1);
    open = sourceB;
    watch.check();
    open = null;
    watch.check();
    expect(onSwitch).toHaveBeenCalledTimes(3);
  });

  it("takes the source opened at start as seen", () => {
    let open: DataSource | null = sourceA;
    const onSwitch = vi.fn<() => void>();
    const watch = createSourceWatch(() => open, onSwitch);
    watch.prime();
    watch.check();
    expect(onSwitch).not.toHaveBeenCalled();
    open = null;
    watch.check();
    expect(onSwitch).toHaveBeenCalledOnce();
  });
});

describe("withSourceChecks", () => {
  it("notices a sign-in that opens a source, though sign-in never reloads the window", async () => {
    const { state, raw, account, watch, onSwitch } = wire();
    watch.prime();
    raw.signIn.mockImplementation(() => {
      state.open = sourceA;
      return Promise.resolve({ ok: true, state: "signed-in" });
    });
    expect(await account.signIn("sam@aiexplained.example", "pw")).toEqual({
      ok: true,
      state: "signed-in",
    });
    expect(raw.signIn).toHaveBeenCalledWith("sam@aiexplained.example", "pw");
    expect(onSwitch).toHaveBeenCalledOnce();
  });

  it("notices a second sign-in that replaces the open copy", async () => {
    const { state, raw, account, watch, onSwitch } = wire();
    state.open = sourceA;
    watch.prime();
    raw.signIn.mockImplementation(() => {
      state.open = sourceB;
      return Promise.resolve({ ok: true, state: "signed-in" });
    });
    await account.signIn("lee@aiexplained.example", "pw");
    expect(onSwitch).toHaveBeenCalledOnce();
  });

  it("notices a failed sign-in that closed the previous copy, and passes the throw on", async () => {
    const { state, raw, account, watch, onSwitch } = wire();
    state.open = sourceA;
    watch.prime();
    raw.signIn.mockImplementation(() => {
      state.open = null;
      return Promise.reject(new Error("boom"));
    });
    await expect(account.signIn("sam@aiexplained.example", "pw")).rejects.toThrow("boom");
    expect(onSwitch).toHaveBeenCalledOnce();
  });

  it("stays quiet when a call leaves the same source open", async () => {
    const { state, raw, account, watch, onSwitch } = wire();
    state.open = sourceA;
    watch.prime();
    raw.signIn.mockResolvedValue({ ok: false, problem: "invalid" });
    raw.recheck.mockResolvedValue({ state: "signed-in", email: null, role: null } as never);
    await account.signIn("sam@aiexplained.example", "wrong");
    await account.recheck();
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it("notices a recheck that opens the copy (waiting, then let in)", async () => {
    const { state, raw, account, watch, onSwitch } = wire();
    watch.prime();
    raw.recheck.mockImplementation(() => {
      state.open = sourceA;
      return Promise.resolve({ state: "signed-in" } as never);
    });
    await account.recheck();
    expect(onSwitch).toHaveBeenCalledOnce();
  });

  it("notices a sign-out once, though it also reloads the window", async () => {
    const { state, raw, account, watch, onSwitch } = wire();
    state.open = sourceA;
    watch.prime();
    raw.signOut.mockImplementation(() => {
      state.open = null;
      state.reload();
      return Promise.resolve();
    });
    await account.signOut();
    expect(onSwitch).toHaveBeenCalledOnce();
  });

  it("notices a session that ends on its own, through the reload", () => {
    const { state, watch, onSwitch } = wire();
    state.open = sourceA;
    watch.prime();
    state.open = null;
    state.reload();
    expect(onSwitch).toHaveBeenCalledOnce();
  });

  it("keeps the account's other members", async () => {
    const { raw, account } = wire();
    expect(account.findContext()).toEqual(raw.findContext());
    expect(account.teamKeys).toBe(raw.teamKeys);
    expect(await account.teamKeys.youtubeKey()).toBeNull();
  });
});
