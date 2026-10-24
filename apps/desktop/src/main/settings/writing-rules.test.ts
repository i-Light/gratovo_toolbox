import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { writingRulesSchema } from "@gratovo/ipc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createWritingRulesService, playbookRulesDir } from "./writing-rules";

const sample = {
  area: "influencer",
  rules: [
    {
      id: "INF-AIT-02",
      stage: "first_contact",
      title: "Name the AI tool you use",
      rule: "Say which AI tool you watched them use, and what it did for the viewer.",
      dont: ["Say you love their content"],
      level: "should",
      src: [{ doc: "invented", quote: "x" }],
      extra: 1,
    },
    {
      id: "INF-AIT-01",
      stage: "qualify",
      title: "Check the channel covers AI news",
      rule: "Skip channels that stopped covering AI tools.",
      level: "must",
    },
    { id: "bad id", stage: "qualify", title: "x", rule: "x", level: "must" },
  ],
};

describe("the writing rules service", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "gratovo-rules-"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it("is not found with no folder or a missing one", async () => {
    expect(await createWritingRulesService({ rulesDir: null }).list()).toEqual({
      found: false,
      rules: [],
    });
    expect(await createWritingRulesService({ rulesDir: join(dir, "nope") }).list()).toEqual({
      found: false,
      rules: [],
    });
  });

  it("reads, validates and sorts by area then id, dropping unknown fields", async () => {
    await writeFile(join(dir, "influencer.rules.json"), JSON.stringify(sample));
    await writeFile(
      join(dir, "brand.rules.json"),
      JSON.stringify({
        area: "brand",
        rules: [
          {
            id: "BRD-AI-01",
            stage: "pricing",
            title: "Quote a flat fee for an AI tool review",
            rule: "Give one number.",
            level: "tip",
          },
        ],
      }),
    );
    await writeFile(join(dir, "notes.txt"), "ignored");
    const answer = await createWritingRulesService({ rulesDir: dir }).list();
    expect(writingRulesSchema.safeParse(answer).success).toBe(true);
    expect(answer.found).toBe(true);
    expect(answer.rules.map((r) => r.id)).toEqual(["BRD-AI-01", "INF-AIT-01", "INF-AIT-02"]);
    expect(Object.keys(answer.rules[2] ?? {}).sort()).toEqual(
      ["area", "id", "level", "rule", "stage", "title"].sort(),
    );
  });

  it("skips a damaged file and keeps the rest", async () => {
    await writeFile(join(dir, "a.rules.json"), "{not json");
    await writeFile(join(dir, "b.rules.json"), JSON.stringify({ area: "x" }));
    await writeFile(join(dir, "influencer.rules.json"), JSON.stringify(sample));
    const answer = await createWritingRulesService({ rulesDir: dir }).list();
    expect(answer.rules).toHaveLength(2);
  });

  it("finds the rules folder only when unpackaged and present", async () => {
    const appPath = join(dir, "apps", "desktop");
    const rules = resolve(dir, "services", "pipeline", "data", "comms", "playbook", "rules");
    await mkdir(rules, { recursive: true });
    expect(playbookRulesDir({ packaged: true, appPath, exists: existsSync })).toBeNull();
    expect(playbookRulesDir({ packaged: false, appPath, exists: existsSync })).toBe(rules);
    expect(playbookRulesDir({ packaged: false, appPath, exists: () => false })).toBeNull();
  });

  it("reads every rule of the repository's real rules folder", async () => {
    const real = playbookRulesDir({
      packaged: false,
      appPath: resolve(__dirname, "..", "..", ".."),
      exists: existsSync,
    });
    expect(real).not.toBeNull();
    const answer = await createWritingRulesService({ rulesDir: real }).list();
    expect(answer.found).toBe(true);
    expect(answer.rules.length).toBeGreaterThan(100);
    expect(writingRulesSchema.safeParse(answer).success).toBe(true);
    expect(vi.mocked(console.error)).not.toHaveBeenCalled();
  });
});
