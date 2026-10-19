import { describe, expect, it } from "vitest";

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

describe("createHandlers", () => {
  const handlers = createHandlers({ version: "1.2.3", secrets: storeWith(["gemini.api-key"]) });

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
