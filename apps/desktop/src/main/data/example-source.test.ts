import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { exampleFrame, exampleSeed, exampleSeedVersion, scenarios } from "@gratovo/core/data";
import type { DataSource } from "@gratovo/core/data";
import { rateOf } from "@gratovo/core/reach";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase } from "../db/open-database";

import { contractNow, describeDataSourceContract } from "./data-source-contract";
import { exampleHealthKey, openExampleSource, readExampleHealth } from "./example-source";
import type { ExampleOptions } from "./example-source";
import { getMeta, setMeta } from "./repositories";

describeDataSourceContract("example source", "example", (file, now) =>
  openExampleSource(file, now),
);

describe("example source", () => {
  let folder: string;
  let file: string;
  const open: DataSource[] = [];

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), "gratovo-example-"));
    file = join(folder, "example.db");
  });

  afterEach(async () => {
    for (const source of open.splice(0)) {
      source.close();
    }
    await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  function start(options?: ExampleOptions): DataSource {
    const source = openExampleSource(file, () => contractNow, options);
    open.push(source);
    return source;
  }

  it("serves exactly the example frame from a fresh file", async () => {
    expect(await start().frame()).toEqual(exampleFrame(contractNow));
  });

  it("seeds outreach3 as slowed, with a bounce rate over 3%", () => {
    const source = start();
    expect(source.readSetting("reach.mailboxes")).toEqual({
      "outreach3@gratovo.example": { paused: false, slowed: true },
    });
    const counts = source.outreach.mailboxCounts(contractNow).get("outreach3@gratovo.example");
    expect(counts?.sent7).toBeGreaterThanOrEqual(10);
    expect(counts?.bounced7).toBeGreaterThanOrEqual(1);
    expect(rateOf(counts?.bounced7 ?? 0, counts?.sent7 ?? 0) ?? 0).toBeGreaterThan(3);
    // The other two are healthy.
    expect(
      source.outreach.mailboxCounts(contractNow).get("outreach1@gratovo.example")?.bounced7,
    ).toBe(0);
  });

  it("does not seed again on a reopen", async () => {
    const first = start();
    await first.write([{ kind: "me.name", name: "Ada" }]);
    first.close();
    open.length = 0;
    const second = start();
    expect((await second.frame()).myName).toBe("Ada");
  });

  it("seeds again when the stored seed version is older", async () => {
    const first = start();
    await first.write([{ kind: "me.name", name: "Ada" }]);
    first.close();
    open.length = 0;

    const db = openDatabase(file);
    expect(getMeta(db, "example_seed")).toBe(String(exampleSeedVersion));
    setMeta(db, "example_seed", String(exampleSeedVersion - 1));
    db.close();

    const second = start();
    expect(await second.frame()).toEqual(exampleFrame(contractNow));
    second.close();
    open.length = 0;

    const check = openDatabase(file);
    try {
      expect(getMeta(check, "example_seed")).toBe(String(exampleSeedVersion));
    } finally {
      check.close();
    }
  });

  it("seeds again on a fresh open, even when the stored seed is current", async () => {
    const first = start();
    await first.write([{ kind: "me.name", name: "Ada" }]);
    first.close();
    open.length = 0;
    const second = start({ fresh: true });
    expect((await second.frame()).myName).toBeNull();
  });

  it.each(scenarios)("seeds the %s scenario's notifications", async (scenario) => {
    const source = start({ fresh: true, scenario });
    const expected = exampleSeed(contractNow, scenario).notifications.length;
    expect((await source.frame()).notifications).toHaveLength(expected);
  });

  it("gives the first day no notifications and something broke three more", async () => {
    const normal = (await start({ fresh: true }).frame()).notifications.length;
    const first = (await start({ fresh: true, scenario: "first" }).frame()).notifications;
    const broke = (await start({ fresh: true, scenario: "broke" }).frame()).notifications;
    expect(first).toHaveLength(0);
    expect(broke).toHaveLength(normal + 3);
  });

  it("writes the health for something broke, and none for a normal Monday", () => {
    const broke = start({ fresh: true, scenario: "broke" });
    const address = exampleSeed(contractNow, "broke").mailSettings.mailboxes[0]?.address;
    expect(broke.readSetting(exampleHealthKey)).toEqual({
      signedOut: [address],
      geminiOffline: true,
    });
    expect(readExampleHealth(broke)).toEqual({ signedOut: [address], geminiOffline: true });
    broke.close();
    open.length = 0;

    const normal = start({ fresh: true });
    expect(normal.readSetting(exampleHealthKey)).toBeUndefined();
    expect(readExampleHealth(normal)).toEqual({ signedOut: [], geminiOffline: false });
  });

  it.each([
    ["a string", "broken"],
    ["null", null],
    ["an array", []],
    ["a missing key", { signedOut: [] }],
    ["an extra key", { signedOut: [], geminiOffline: true, more: 1 }],
    ["a number address", { signedOut: [1], geminiOffline: false }],
    ["a string flag", { signedOut: [], geminiOffline: "yes" }],
    [
      "too many addresses",
      { signedOut: Array.from({ length: 21 }, () => "a@b.c"), geminiOffline: false },
    ],
  ])("reads %s as healthy", (_label, value) => {
    const source = start();
    source.writeSetting(exampleHealthKey, value);
    expect(readExampleHealth(source)).toEqual({ signedOut: [], geminiOffline: false });
  });
});
