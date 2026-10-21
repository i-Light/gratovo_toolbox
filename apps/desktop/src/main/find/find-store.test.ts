import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findRulesSchema } from "@gratovo/ipc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { rulesSchema } from "../pipeline/protocol";

import { defaultRules, findFileName, readFindFile, writeFindFile } from "./find-store";

describe("the find file", () => {
  let folder: string;

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), "gratovo-find-"));
  });
  afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  it("gives the owner's rules and an empty queue when there is no file", () => {
    const file = readFindFile(join(folder, "missing"));
    expect(file.queue).toEqual([]);
    expect(file.at).toBe(0);
    expect(file.rules.countries).toEqual(["AU", "CA", "GB", "IE", "NZ", "US"]);
    expect(file.rules.perKeyword).toBe(200);
    expect(file.rules.autoClean).toMatchObject({ minSubscribers: 50_000, label: "inactive" });
  });

  it("gives the defaults when the file is not JSON or fails the schema", () => {
    writeFileSync(join(folder, findFileName), "{ not json");
    expect(readFindFile(folder).queue).toEqual([]);
    writeFileSync(join(folder, findFileName), JSON.stringify({ queue: [], at: 9999 }));
    expect(readFindFile(folder).at).toBe(0);
  });

  it("round-trips a value, making the folder and leaving no temporary file", () => {
    const nested = join(folder, "a", "b");
    const value = {
      queue: [{ keyword: "ai agents", state: "done" as const, found: 5, kept: 2 }],
      at: 1,
      rules: { ...defaultRules(), countries: ["US"] },
    };
    writeFindFile(nested, value);
    expect(readFindFile(nested)).toEqual(value);
    expect(readdirSync(nested)).toEqual([findFileName]);
  });

  it("reads an entry left running as queued", () => {
    mkdirSync(folder, { recursive: true });
    writeFindFile(folder, {
      queue: [{ keyword: "ai news", state: "running", found: 0, kept: 0 }],
      at: 0,
      rules: defaultRules(),
    });
    expect(readFindFile(folder).queue[0]?.state).toBe("queued");
  });
});

describe("the rules schemas", () => {
  it("findRulesSchema and the pipeline's rulesSchema give the same JSON Schema", () => {
    expect(z.toJSONSchema(findRulesSchema)).toEqual(z.toJSONSchema(rulesSchema));
  });
});
