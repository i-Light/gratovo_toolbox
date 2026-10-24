import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findRulesSchema } from "@gratovo/ipc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { rulesSchema } from "../pipeline/protocol";

import {
  defaultRules,
  findFileName,
  pipelineRules,
  readFindFile,
  rulesFromOldFiles,
  writeFindFile,
} from "./find-store";

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

  it("reads a file from before step 4 with the new rules at their defaults", () => {
    const oldRules: Record<string, unknown> = { ...defaultRules() };
    delete oldRules["minMedianViews"];
    delete oldRules["minUploads30"];
    delete oldRules["archiveDays"];
    writeFileSync(
      join(folder, findFileName),
      JSON.stringify({ queue: [], at: 0, rules: { ...oldRules, perKeyword: 50 } }),
    );
    expect(readFindFile(folder).rules).toEqual({
      ...defaultRules(),
      perKeyword: 50,
      minMedianViews: null,
      minUploads30: null,
      archiveDays: 7,
    });
  });

  it("keeps the new rules a file names", () => {
    const rules = { ...defaultRules(), minMedianViews: 5000, minUploads30: 2, archiveDays: 30 };
    writeFindFile(folder, { queue: [], at: 0, rules });
    expect(readFindFile(folder).rules).toEqual(rules);
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

  it("drops entries the start message would refuse (untrimmed, repeated in any case)", () => {
    writeFindFile(folder, {
      queue: [
        { keyword: "ai news", state: "done", found: 1, kept: 1 },
        { keyword: " ai agents", state: "queued", found: 0, kept: 0 },
        { keyword: "AI News", state: "queued", found: 0, kept: 0 },
      ],
      at: 3,
      rules: defaultRules(),
    });
    const file = readFindFile(folder);
    expect(file.queue.map((q) => q.keyword)).toEqual(["ai news"]);
    expect(file.at).toBe(1);
  });
});

describe("the rules schemas", () => {
  // The pipeline also takes a job without the two new rules (an older main); main always sends them.
  it("findRulesSchema without archiveDays and the pipeline's rulesSchema give the same JSON Schema", () => {
    expect(z.toJSONSchema(findRulesSchema.omit({ archiveDays: true }))).toEqual(
      z.toJSONSchema(rulesSchema.required({ minMedianViews: true, minUploads30: true })),
    );
  });

  it("pipelineRules drops archiveDays only", () => {
    const rules = { ...defaultRules(), minMedianViews: 1000 };
    const sent = pipelineRules(rules);
    expect(sent).not.toHaveProperty("archiveDays");
    expect({ ...sent, archiveDays: rules.archiveDays }).toEqual(rules);
  });
});

describe("rulesFromOldFiles", () => {
  // The shapes of the owner's legacy/data files (non-secret).
  const runConfig = {
    sort_by: "view_count",
    results_type: "channel",
    countries: ["US", "GB"],
    handle_limit: 120,
    auto_clean: {
      enabled: false,
      min_subscribers: 10000,
      max_subscribers: 900000,
      below_min_action: "delay",
      above_max_action: "off",
      label: "stale",
    },
  };
  const settings = {
    handles_to_search_limit: { value: 300 },
    auto_clean: {
      enabled: true,
      min_subscribers: 50000,
      max_subscribers: 2000000,
      below_min_action: "sweep",
      above_max_action: "delay",
      label: "inactive",
    },
    parallel_search: { enabled: false, max_workers: 4 },
  };

  it("maps the run config over the settings", () => {
    const current = { ...defaultRules(), minMedianViews: 500, minUploads30: 2, archiveDays: 14 };
    const rules = rulesFromOldFiles(runConfig, settings, current);
    expect(rules).toMatchObject({
      sortBy: "view_count",
      resultsType: "channel",
      countries: ["US", "GB"],
      perKeyword: 120,
      minMedianViews: 500,
      minUploads30: 2,
      archiveDays: 14,
    });
    expect(rules.autoClean).toEqual({
      enabled: false,
      minSubscribers: 10000,
      maxSubscribers: 900000,
      belowMin: "delay",
      aboveMax: "off",
      label: "stale",
    });
  });

  it("takes the settings alone, with the wrapped handle limit", () => {
    const rules = rulesFromOldFiles(null, settings, defaultRules());
    expect(rules.perKeyword).toBe(300);
    expect(rules.autoClean).toEqual(defaultRules().autoClean);
  });

  it("ignores unknown, wrong or out-of-bounds values", () => {
    const current = defaultRules();
    const rules = rulesFromOldFiles(
      {
        sort_by: "nope",
        results_type: 4,
        countries: ["usa"],
        handle_limit: 99999,
        auto_clean: { min_subscribers: -1, max_subscribers: 5, label: "" },
      },
      "junk",
      current,
    );
    expect(rules).toEqual(current);
  });
});
