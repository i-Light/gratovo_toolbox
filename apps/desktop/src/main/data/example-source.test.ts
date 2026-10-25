import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { exampleFrame, exampleSeedVersion } from "@gratovo/core/data";
import type { DataSource } from "@gratovo/core/data";
import { rateOf } from "@gratovo/core/reach";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase } from "../db/open-database";

import { contractNow, describeDataSourceContract } from "./data-source-contract";
import { openExampleSource } from "./example-source";
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

  function start(): DataSource {
    const source = openExampleSource(file, () => contractNow);
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
});
