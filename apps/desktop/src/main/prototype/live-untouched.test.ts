import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { DataSource } from "@gratovo/core/data";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Account } from "../account/account";
import { openExampleSource } from "../data";
import { createHandlers, type HandlerContext } from "../handlers";

import { createPrototype, prototypeFile } from "./prototype";
import type { Prototype } from "./prototype";
import { withPrototype } from "./wrap";

/**
 * Prototype mode never touches the data that was open before it (plan acceptance 2 and 3): a write
 * while on lands in `prototype.db`, and the base database's rows are as they were, before and after.
 * Real sources in a temporary folder; the base stands in for the live account's local copy.
 */

const start = Date.UTC(2026, 9, 26, 9, 0, 0);

/** Every profile row of the database file, read through a connection of its own. */
function profiles(path: string): unknown[] {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return db.prepare("SELECT * FROM profiles ORDER BY id").all();
  } finally {
    db.close();
  }
}

/** A signed-in account on `source`, with only what prototype mode and `data:write` use. */
function accountOn(source: DataSource): Account {
  return {
    status: () => ({ state: "signed-in", email: "owner@gratovo.example" }),
    source: () => source,
    signIn: () => Promise.resolve({ ok: true, state: "signed-in" }),
    recheck: () => Promise.resolve({ state: "signed-in", email: null }),
    signOut: () => Promise.resolve(),
    syncStatus: () => ({ state: "synced", pending: 0, refused: 0, lastSyncedAt: null }),
    syncNow: () => Promise.resolve({ state: "synced", pending: 0, refused: 0, lastSyncedAt: null }),
    setPresence: () => undefined,
    start: () => Promise.resolve(),
    close: () => undefined,
    teamKeys: { youtubeKey: () => Promise.resolve("key") },
    findContext: () => ({ mode: "live", workerId: "u1", folder: "pipeline" }),
  };
}

describe("prototype mode leaves the base data untouched", () => {
  let folder: string;
  let baseFile: string;
  let base: DataSource;
  let proto: Prototype;

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), "gratovo-untouched-"));
    baseFile = join(folder, "gratovo.db");
    base = openExampleSource(baseFile, () => start);
  });

  afterEach(async () => {
    proto.close();
    base.close();
    await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it("stores a data:write in prototype.db, and the base file's rows don't change", async () => {
    const account = accountOn(base);
    proto = createPrototype({
      userData: folder,
      now: () => start,
      base: account,
      reloadWindow: () => undefined,
      beforeSwitch: () => Promise.resolve(),
    });
    const wrapped = withPrototype(account, proto);
    const afterWrite = vi.fn();
    const handlers = createHandlers({
      account: wrapped,
      prototype: proto,
      reach: { afterWrite },
    } as unknown as HandlerContext);
    const before = profiles(baseFile);
    const baseName = (await base.frame()).myName;

    await handlers["prototype:set"]({ on: true });
    expect(wrapped.source()).toBe(proto.source());
    expect(wrapped.source()).not.toBe(base);
    await handlers["data:write"]({ writes: [{ kind: "me.name", name: "Prototype Tester" }] });

    expect(afterWrite).toHaveBeenCalledOnce();
    expect((await wrapped.source()?.frame())?.myName).toBe("Prototype Tester");
    expect(JSON.stringify(profiles(join(folder, prototypeFile)))).toContain("Prototype Tester");
    expect(profiles(baseFile)).toEqual(before);
    expect((await base.frame()).myName).toBe(baseName);

    await handlers["prototype:set"]({ on: false });
    expect(wrapped.source()).toBe(base);
    expect(profiles(baseFile)).toEqual(before);
    expect((await base.frame()).myName).toBe(baseName);
  });
});
