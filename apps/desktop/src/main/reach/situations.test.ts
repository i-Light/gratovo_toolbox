import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSituations, parseSituations, situationsFile } from "./situations";

let folder: string;
let lines: string[];

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "gratovo-situations-"));
  lines = [];
});

afterEach(async () => {
  await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const file = {
  about: "x",
  stages: { influencer: [] },
  replies: {
    influencer: [
      { id: "inf.gives_rate", label: "Gives their rate or rate card", signs: [] },
      { id: "inf.not_interested", label: "Not interested / no partnerships" },
    ],
    brand: [{ id: "brd.yes", label: "Says yes / wants to proceed" }],
    any: [{ id: "any.bounce", label: "Bounce / address does not exist" }],
  },
};

describe("parseSituations", () => {
  it("lists the creator, brand and any situations with their side, in that order", () => {
    expect(parseSituations(file)).toEqual([
      { id: "inf.gives_rate", label: "Gives their rate or rate card", side: "influencer" },
      { id: "inf.not_interested", label: "Not interested / no partnerships", side: "influencer" },
      { id: "brd.yes", label: "Says yes / wants to proceed", side: "brand" },
      { id: "any.bounce", label: "Bounce / address does not exist", side: "any" },
    ]);
  });

  it("leaves out an item that does not fit and a repeated id, and reads junk as none", () => {
    expect(
      parseSituations({
        replies: {
          influencer: [
            { id: "inf.ok", label: "Fine" },
            { id: "inf.ok", label: "Again" },
            { id: "NOT AN ID", label: "Bad id" },
            { id: "inf.nolabel", label: "  " },
            { id: 3, label: "x" },
            "text",
          ],
          brand: "nope",
        },
      }),
    ).toEqual([{ id: "inf.ok", label: "Fine", side: "influencer" }]);
    expect(parseSituations(null)).toEqual([]);
    expect(parseSituations({ replies: [] })).toEqual([]);
  });
});

describe("situationsFile", () => {
  it("is the playbook's file next to the app, and none when packaged or missing", () => {
    const appPath = resolve("repo", "apps", "desktop");
    const found = situationsFile({ packaged: false, appPath, exists: () => true });
    expect(found).toBe(
      resolve("repo", "services", "pipeline", "data", "comms", "playbook", "situations.json"),
    );
    expect(situationsFile({ packaged: true, appPath, exists: () => true })).toBeNull();
    expect(situationsFile({ packaged: false, appPath, exists: () => false })).toBeNull();
  });
});

describe("createSituations", () => {
  it("reads the file once and answers lists and labels", async () => {
    const path = join(folder, "situations.json");
    await writeFile(path, JSON.stringify(file));
    const situations = createSituations({ file: path, log: (line) => lines.push(line) });
    expect(await situations.list()).toHaveLength(4);
    expect(await situations.labelOf("any.bounce")).toBe("Bounce / address does not exist");
    expect(await situations.labelOf("inf.unknown")).toBeNull();
    // Changed on disk: the first read is kept.
    await writeFile(path, JSON.stringify({ replies: {} }));
    expect(await situations.list()).toHaveLength(4);
    expect(lines).toEqual([]);
  });

  it("serves the real playbook: 20 creator, 22 brand and 5 any, with bounce among them", async () => {
    const real = situationsFile({
      packaged: false,
      appPath: resolve(__dirname, "..", "..", ".."),
      exists: () => true,
    });
    const situations = createSituations({ file: real, log: (line) => lines.push(line) });
    const list = await situations.list();
    const count = (side: string): number => list.filter((s) => s.side === side).length;
    expect([count("influencer"), count("brand"), count("any")]).toEqual([20, 22, 5]);
    expect(await situations.labelOf("any.bounce")).toMatch(/bounce/i);
    expect(lines).toEqual([]);
  });

  it("has none, and says so without content, when the file is missing, damaged or not there", async () => {
    const missing = createSituations({
      file: join(folder, "none.json"),
      log: (line) => lines.push(line),
    });
    expect(await missing.list()).toEqual([]);
    const damaged = join(folder, "bad.json");
    await writeFile(damaged, "{ not json");
    const bad = createSituations({ file: damaged, log: (line) => lines.push(line) });
    expect(await bad.list()).toEqual([]);
    const none = createSituations({ file: null, log: (line) => lines.push(line) });
    expect(await none.list()).toEqual([]);
    expect(lines).toEqual([
      "Reach: the situations file couldn't be read.",
      "Reach: the situations file couldn't be read.",
    ]);
  });

  it("reads a file put in place after an empty answer", async () => {
    const path = join(folder, "late.json");
    const situations = createSituations({ file: path, log: (line) => lines.push(line) });
    expect(await situations.list()).toEqual([]);
    await writeFile(path, JSON.stringify(file));
    expect(await situations.list()).toHaveLength(4);
  });
});
