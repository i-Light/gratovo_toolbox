import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { findRulesSchema, findStateSchema, type FindState } from "@gratovo/ipc";
import { z } from "zod";

/**
 * The Find screen's queue, next keyword and rules: `find.json` in the pipeline's data folder
 * (decision 1 of P11; the data source has no settings API). Main owns the file and writes it
 * atomically; `pipeline.db` in the same folder belongs to Python.
 */

export const findFileName = "find.json";

export type FindRules = FindState["rules"];

export interface FindFile {
  queue: FindState["queue"];
  at: number;
  rules: FindRules;
}

/** The owner's rules from `legacy/data/run_config.json` and `settings.json`. */
export function defaultRules(): FindRules {
  return {
    countries: ["AU", "CA", "GB", "IE", "NZ", "US"],
    perKeyword: 200,
    sortBy: "upload_date",
    resultsType: "video",
    autoClean: {
      enabled: true,
      minSubscribers: 50_000,
      maxSubscribers: 2_000_000,
      belowMin: "sweep",
      aboveMax: "delay",
      label: "inactive",
    },
  };
}

const fileSchema = z.strictObject({
  queue: findStateSchema.shape.queue,
  at: findStateSchema.shape.at,
  rules: findRulesSchema,
});

export function defaultFindFile(): FindFile {
  return { queue: [], at: 0, rules: defaultRules() };
}

/** Reads the file; the defaults when it is missing or invalid. An entry left `running` is `queued`. */
export function readFindFile(folder: string): FindFile {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(join(folder, findFileName), "utf8"));
  } catch {
    return defaultFindFile();
  }
  const parsed = fileSchema.safeParse(value);
  if (!parsed.success) {
    return defaultFindFile();
  }
  // The start message refuses keywords that aren't trimmed or repeat (in any case), so a file
  // edited by hand mustn't carry them: those entries are dropped.
  const seen = new Set<string>();
  const queue = parsed.data.queue.filter((entry) => {
    const key = entry.keyword.toLowerCase();
    if (entry.keyword !== entry.keyword.trim() || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  return {
    ...parsed.data,
    at: Math.min(parsed.data.at, queue.length),
    queue: queue.map((entry) =>
      entry.state === "running" ? { ...entry, state: "queued" as const } : entry,
    ),
  };
}

/** Writes to a temporary file, then renames it over the real one. */
export function writeFindFile(folder: string, value: FindFile): void {
  mkdirSync(folder, { recursive: true });
  const file = join(folder, findFileName);
  const temp = `${file}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temp, file);
}
