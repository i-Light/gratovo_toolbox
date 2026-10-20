import { exampleFrame, type DataSource, type DataWrite } from "@gratovo/core/data";
import type { AuthStatus, SyncStatus } from "@gratovo/ipc";
import { describe, expect, it, vi } from "vitest";

import { createHandlers, type HandlerContext } from "./handlers";
import type { SecretStore } from "./secret-store";

function storeWith(names: string[]): SecretStore {
  const fail = () => Promise.reject(new Error("Not used by the handlers"));
  return {
    get: fail,
    set: fail,
    delete: fail,
    has: (name) => Promise.resolve(names.includes(name)),
    names: () => Promise.resolve([...names]),
  };
}

const frame = exampleFrame(Date.UTC(2026, 9, 20));

function sourceWith(overrides: Partial<DataSource> = {}): DataSource {
  return {
    frame: () => Promise.resolve(frame),
    write: () => Promise.resolve(),
    close: () => undefined,
    ...overrides,
  };
}

const signedIn: AuthStatus = { state: "signed-in", email: "sam@example.com" };
const synced: SyncStatus = { state: "synced", pending: 0, refused: 0, lastSyncedAt: 1_000 };

function accountWith(
  overrides: Partial<HandlerContext["account"]> = {},
  source: DataSource | null = sourceWith(),
): HandlerContext["account"] {
  return {
    status: () => signedIn,
    source: () => source,
    signIn: () => Promise.resolve({ ok: true, state: "signed-in" }),
    recheck: () => Promise.resolve(signedIn),
    signOut: () => Promise.resolve(),
    syncStatus: () => synced,
    syncNow: () => Promise.resolve(synced),
    ...overrides,
  };
}

function handlersWith(account: HandlerContext["account"], names: string[] = []) {
  return createHandlers({ version: "1.2.3", secrets: storeWith(names), account });
}

describe("createHandlers", () => {
  const handlers = handlersWith(accountWith(), ["gemini.api-key"]);

  it("loads the frame from the account's source", async () => {
    expect(await handlers["frame:load"]({})).toEqual(frame);
  });

  it("passes a batch of writes to the account's source in order and answers with {}", async () => {
    const write = vi.fn<DataSource["write"]>(() => Promise.resolve());
    const mine = handlersWith(accountWith({}, sourceWith({ write })));
    const writes: DataWrite[] = [
      { kind: "notification.read", id: "n1", read: true },
      { kind: "me.name", name: "Sam" },
    ];
    expect(await mine["data:write"]({ writes })).toEqual({});
    expect(write).toHaveBeenCalledWith(writes);
  });

  it("lets a failed write reject", async () => {
    const mine = handlersWith(
      accountWith({}, sourceWith({ write: () => Promise.reject(new Error("disk full")) })),
    );
    await expect(
      mine["data:write"]({ writes: [{ kind: "log.remove", id: "l1" }] }),
    ).rejects.toThrow("disk full");
  });

  it("refuses frame:load and data:write while no source is open", async () => {
    const mine = handlersWith(
      accountWith({ status: () => ({ state: "waiting", email: null }) }, null),
    );
    await expect(Promise.resolve().then(() => mine["frame:load"]({}))).rejects.toThrow(
      "No data is open",
    );
    await expect(
      mine["data:write"]({ writes: [{ kind: "log.remove", id: "l1" }] }),
    ).rejects.toThrow("No data is open");
  });

  it("answers a ping with the app's version", async () => {
    expect(await handlers["app:ping"]({})).toEqual({ ok: true, version: "1.2.3" });
  });

  it("says whether a secret is set without reading it", async () => {
    expect(await handlers["secrets:status"]({ name: "gemini.api-key" })).toEqual({ set: true });
    expect(await handlers["secrets:status"]({ name: "gmail.token.mailbox-1" })).toEqual({
      set: false,
    });
  });
});

describe("the auth handlers", () => {
  it("pass status, sign-in, recheck and sign-out to the account", async () => {
    const signIn = vi.fn<HandlerContext["account"]["signIn"]>(() =>
      Promise.resolve({ ok: false, problem: "invalid" }),
    );
    const recheck = vi.fn(() => Promise.resolve<AuthStatus>({ state: "waiting", email: null }));
    const signOut = vi.fn(() => Promise.resolve());
    const mine = handlersWith(accountWith({ signIn, recheck, signOut }));

    expect(await mine["auth:status"]({})).toEqual(signedIn);
    expect(await mine["auth:sign-in"]({ email: "sam@example.com", password: "pw-000" })).toEqual({
      ok: false,
      problem: "invalid",
    });
    expect(signIn).toHaveBeenCalledWith("sam@example.com", "pw-000");
    expect(await mine["auth:recheck"]({})).toEqual({ state: "waiting", email: null });
    expect(recheck).toHaveBeenCalledOnce();
    expect(await mine["auth:sign-out"]({})).toEqual({});
    expect(signOut).toHaveBeenCalledOnce();
  });
});

describe("the sync handlers", () => {
  it("answer the account's sync state, and run a pass on sync:now", async () => {
    const waiting: SyncStatus = { state: "offline", pending: 3, refused: 1, lastSyncedAt: null };
    const syncNow = vi.fn(() => Promise.resolve(synced));
    const mine = handlersWith(accountWith({ syncStatus: () => waiting, syncNow }));

    expect(await mine["sync:status"]({})).toEqual(waiting);
    expect(syncNow).not.toHaveBeenCalled();
    expect(await mine["sync:now"]({})).toEqual(synced);
    expect(syncNow).toHaveBeenCalledOnce();
  });

  it("accept presence:set and answer {} until presence is wired in", async () => {
    expect(
      await handlersWith(accountWith())["presence:set"]({ screen: "reach", idle: false }),
    ).toEqual({});
  });
});
