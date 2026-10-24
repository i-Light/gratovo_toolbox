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
    minMedianViews: null,
    minUploads30: null,
    archiveDays: 7,
  };
}

// A plain (not strict) object drops the keys it doesn't name.
const pipelineRulesSchema = z.object(findRulesSchema.omit({ archiveDays: true }).shape);

/** The rules as the search job takes them: `archiveDays` stays in main. */
export function pipelineRules(rules: FindRules): Omit<FindRules, "archiveDays"> {
  return pipelineRulesSchema.parse(rules);
}

// A file written before step 4 has no median, uploads or archive rule: it keeps the rest of its
// rules and takes the defaults for those three.
const ruleShape = findRulesSchema.shape;
const fileSchema = z.strictObject({
  queue: findStateSchema.shape.queue,
  at: findStateSchema.shape.at,
  rules: findRulesSchema.extend({
    minMedianViews: ruleShape.minMedianViews.default(null),
    minUploads30: ruleShape.minUploads30.default(null),
    archiveDays: ruleShape.archiveDays.default(7),
  }),
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A value, or the `{"value": x}` the old settings.json wraps some of them in. */
function unwrap(value: unknown): unknown {
  const record = asRecord(value);
  return record !== null && "value" in record ? record["value"] : value;
}

function inRange(value: unknown, min: number, max: number): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? value
    : undefined;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return allowed.find((item) => item === value);
}

function cleanBand(source: unknown, into: FindRules["autoClean"]): FindRules["autoClean"] {
  const band = asRecord(source);
  if (band === null) {
    return into;
  }
  const actions = ["sweep", "delay", "off"] as const;
  const label = band["label"];
  const next = {
    ...into,
    enabled: typeof band["enabled"] === "boolean" ? band["enabled"] : into.enabled,
    minSubscribers: inRange(unwrap(band["min_subscribers"]), 0, 100_000_000) ?? into.minSubscribers,
    maxSubscribers: inRange(unwrap(band["max_subscribers"]), 0, 100_000_000) ?? into.maxSubscribers,
    belowMin: oneOf(band["below_min_action"], actions) ?? into.belowMin,
    aboveMax: oneOf(band["above_max_action"], actions) ?? into.aboveMax,
    label:
      typeof label === "string" && label.trim().length >= 1 && label.trim().length <= 40
        ? label.trim()
        : into.label,
  };
  // A band the wrong way round is not a band: keep what the rules already have.
  return next.minSubscribers > next.maxSubscribers ? into : next;
}

/**
 * The old app's `run_config.json` and `settings.json` mapped onto Find's rules (step 4, "use my old
 * search rules"). `run_config.json` wins over `settings.json`. Anything unknown, of the wrong type
 * or out of bounds is ignored and the current value stays; the median, uploads and archive rules
 * are never touched, the old files don't have them.
 */
export function rulesFromOldFiles(
  runConfig: unknown,
  settings: unknown,
  current: FindRules,
): FindRules {
  const config = asRecord(runConfig) ?? {};
  const old = asRecord(settings) ?? {};
  let rules: FindRules = { ...current, autoClean: { ...current.autoClean } };

  rules.autoClean = cleanBand(old["auto_clean"], rules.autoClean);
  rules.autoClean = cleanBand(config["auto_clean"], rules.autoClean);

  const perKeyword =
    inRange(unwrap(config["handle_limit"]), 1, 1000) ??
    inRange(unwrap(old["handles_to_search_limit"]), 1, 1000);
  const sortBy = oneOf(config["sort_by"], ["relevance", "upload_date", "view_count", "rating"]);
  const resultsType = oneOf(config["results_type"], ["video", "channel"]);
  const countries = config["countries"];
  const validCountries =
    Array.isArray(countries) &&
    countries.length <= 250 &&
    countries.every((c) => typeof c === "string" && /^[A-Z]{2}$/.test(c))
      ? [...new Set(countries as string[])]
      : undefined;

  rules = {
    ...rules,
    perKeyword: perKeyword ?? rules.perKeyword,
    sortBy: sortBy ?? rules.sortBy,
    resultsType: resultsType ?? rules.resultsType,
    countries: validCountries ?? rules.countries,
  };
  return findRulesSchema.safeParse(rules).success ? rules : current;
}
