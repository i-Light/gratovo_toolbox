import { z } from "zod";

/** A tally: found, kept or swept channels. */
const count = z.number().int().min(0).max(1_000_000);
/** The size a rule may name (a subscriber count): the pipeline's own limit. */
const ruleCount = z.number().int().min(0).max(100_000_000);
/** A channel's subscribers or views, as main's protocol allows them. */
const size = z.number().int().min(0).max(1_000_000_000_000);

const autoCleanAction = z.enum(["sweep", "delay", "off"]);

/**
 * What a search keeps: the same shape as main's `rulesSchema` (apps/desktop/src/main/pipeline/
 * protocol.ts), which is the one the pipeline checks. A test in main keeps the two equal.
 */
export const findRulesSchema = z.strictObject({
  countries: z.array(z.string().regex(/^[A-Z]{2}$/)).max(250),
  perKeyword: z.number().int().min(1).max(1000),
  sortBy: z.enum(["relevance", "upload_date", "view_count", "rating"]),
  resultsType: z.enum(["video", "channel"]),
  autoClean: z.strictObject({
    enabled: z.boolean(),
    minSubscribers: ruleCount,
    maxSubscribers: ruleCount,
    belowMin: autoCleanAction,
    aboveMax: autoCleanAction,
    label: z.string().min(1).max(40),
  }),
});

export const findKeywordStates = ["queued", "running", "done", "failed"] as const;
export const findRunStates = ["ready", "running", "stopping", "paused", "done", "failed"] as const;
/** Why a run failed. A code, never the pipeline's own text: the page words it. */
export const findErrors = ["no_youtube_key", "blocked", "quota", "network", "crash"] as const;

/** Everything the Find screen shows, in one read; `find:changed` carries it whole. */
export const findStateSchema = z.strictObject({
  queue: z
    .array(
      z.strictObject({
        keyword: z.string().min(1).max(200),
        state: z.enum(findKeywordStates),
        found: count,
        kept: count,
      }),
    )
    .max(500),
  /** The next keyword to run. */
  at: z.number().int().min(0).max(500),
  rules: findRulesSchema,
  run: z.strictObject({
    state: z.enum(findRunStates),
    found: count,
    kept: count,
    swept: count,
    error: z.enum(findErrors).nullable(),
  }),
  /** Oldest first, the newest 200. */
  log: z
    .array(
      z.strictObject({
        at: z.number().int().nonnegative(),
        level: z.enum(["info", "warn", "error"]),
        text: z.string().max(500),
      }),
    )
    .max(200),
  /** Newest first. */
  kept: z
    .array(
      z.strictObject({
        channelId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
        name: z.string().min(1).max(200),
        handle: z.string().min(1).max(200).nullable(),
        subscribers: size.nullable(),
        medianViews: size.nullable(),
        country: z
          .string()
          .regex(/^[A-Z]{2}$/)
          .nullable(),
        /** The keyword that found it; null when the store doesn't say. */
        keyword: z.string().min(1).max(200).nullable(),
      }),
    )
    .max(100),
});
export type FindState = z.output<typeof findStateSchema>;

const queueIndex = z.number().int().min(0).max(499);

export const findAddRequestSchema = z.strictObject({
  keywords: z.array(z.string().min(1).max(200)).min(1).max(500),
});
export const findAddResultSchema = z.strictObject({ added: count, skipped: count });

export const findIndexRequestSchema = z.strictObject({ index: queueIndex });
export const findEditResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true) }),
  z.strictObject({ ok: z.literal(false), problem: z.literal("running") }),
]);

export const findStartResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true) }),
  z.strictObject({
    ok: z.literal(false),
    problem: z.enum(["no_keywords", "running", "no_youtube_key", "no_python"]),
  }),
]);
