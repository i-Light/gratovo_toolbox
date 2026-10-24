import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { writingRuleSchema, type WritingRules } from "@gratovo/ipc";
import { z } from "zod";

/**
 * Settings › Writing rules (plan D9): the course's playbook rules, read only. Main reads the
 * `*.rules.json` files of `services/pipeline/data/comms/playbook/rules`, keeps the six fields the
 * page shows and drops the rest (`dont`, `src` and anything new). A file or a rule that doesn't
 * fit is skipped and logged by file name only; one bad rule never hides the others.
 */

export interface WritingRulesOptions {
  /** The folder of `*.rules.json` files, or null when there is none (a packaged build). */
  rulesDir: string | null;
}

const maxRules = 2000;
const maxFileChars = 4_000_000;

const fileSchema = z.object({ area: z.string(), rules: z.array(z.unknown()) });

/**
 * The playbook's rules folder when unpackaged (`appPath` is `apps/desktop`, as for `findPython`);
 * null when packaged, until the build ships the rules (step T5), or when the folder is missing.
 */
export function playbookRulesDir(o: {
  packaged: boolean;
  appPath: string;
  exists: (path: string) => boolean;
}): string | null {
  if (o.packaged) {
    return null;
  }
  const dir = resolve(
    o.appPath,
    "..",
    "..",
    "services",
    "pipeline",
    "data",
    "comms",
    "playbook",
    "rules",
  );
  return o.exists(dir) ? dir : null;
}

/** Orders by code point, so the order never depends on the computer's language. */
function compare(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

type Rule = WritingRules["rules"][number];

/** Only the fields the page shows, so an unknown field never fails the strict schema. */
function pick(area: string, item: unknown): unknown {
  if (typeof item !== "object" || item === null) {
    return item;
  }
  const o = item as Record<string, unknown>;
  return {
    id: o["id"],
    area,
    stage: o["stage"],
    title: o["title"],
    rule: o["rule"],
    level: o["level"],
  };
}

async function readRuleFile(dir: string, name: string): Promise<Rule[]> {
  let json: unknown;
  try {
    const text = await readFile(join(dir, name), "utf8");
    if (text.length > maxFileChars) {
      throw new Error("too big");
    }
    json = JSON.parse(text);
  } catch {
    console.error(`Writing rules: "${name}" couldn't be read, so it is skipped.`);
    return [];
  }
  const file = fileSchema.safeParse(json);
  if (!file.success) {
    console.error(`Writing rules: "${name}" isn't in the expected shape, so it is skipped.`);
    return [];
  }
  const rules: Rule[] = [];
  let skipped = 0;
  for (const raw of file.data.rules) {
    const parsed = writingRuleSchema.safeParse(pick(file.data.area, raw));
    if (parsed.success) {
      rules.push(parsed.data);
    } else {
      skipped += 1;
    }
  }
  if (skipped > 0) {
    console.error(`Writing rules: ${String(skipped)} rule(s) in "${name}" were skipped.`);
  }
  return rules;
}

export function createWritingRulesService(options: WritingRulesOptions): {
  list(): Promise<WritingRules>;
} {
  return {
    async list() {
      const dir = options.rulesDir;
      if (dir === null) {
        return { found: false, rules: [] };
      }
      let names: string[];
      try {
        names = (await readdir(dir)).filter((name) => name.endsWith(".rules.json")).sort(compare);
      } catch {
        return { found: false, rules: [] };
      }
      const rules: Rule[] = [];
      const seen = new Set<string>();
      for (const name of names) {
        for (const rule of await readRuleFile(dir, name)) {
          if (!seen.has(rule.id)) {
            seen.add(rule.id);
            rules.push(rule);
          }
        }
      }
      rules.sort((a, b) => compare(a.area, b.area) || compare(a.id, b.id));
      return { found: true, rules: rules.slice(0, maxRules) };
    },
  };
}
