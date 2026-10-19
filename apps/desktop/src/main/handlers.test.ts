import { exampleFrame, type DataSource, type DataWrite } from "@gratovo/core/data";
import { describe, expect, it, vi } from "vitest";

import { createHandlers } from "./handlers";
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

describe("createHandlers", () => {
  const handlers = createHandlers({
    version: "1.2.3",
    secrets: storeWith(["gemini.api-key"]),
    data: sourceWith(),
  });

  it("loads the frame from the data source", async () => {
    expect(await handlers["frame:load"]({})).toEqual(frame);
  });

  it("passes a batch of writes to the data source in order and answers with {}", async () => {
    const write = vi.fn<DataSource["write"]>(() => Promise.resolve());
    const mine = createHandlers({
      version: "1.2.3",
      secrets: storeWith([]),
      data: sourceWith({ write }),
    });
    const writes: DataWrite[] = [
      { kind: "notification.read", id: "n1", read: true },
      { kind: "me.name", name: "Sam" },
    ];
    expect(await mine["data:write"]({ writes })).toEqual({});
    expect(write).toHaveBeenCalledWith(writes);
  });

  it("lets a failed write reject", async () => {
    const mine = createHandlers({
      version: "1.2.3",
      secrets: storeWith([]),
      data: sourceWith({ write: () => Promise.reject(new Error("disk full")) }),
    });
    await expect(
      mine["data:write"]({ writes: [{ kind: "log.remove", id: "l1" }] }),
    ).rejects.toThrow("disk full");
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
