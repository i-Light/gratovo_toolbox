import { creatorStages, rejectReasons } from "@gratovo/core/data";
import {
  findSignals,
  findSorts,
  type CatalogItem,
  type CatalogVideo,
  type Facets,
  type FindFilter,
  type Fit,
  type FitPart,
} from "@gratovo/core/find";
import { z } from "zod";

/** A tally: found, kept or swept channels. */
const count = z.number().int().min(0).max(1_000_000);
/** The size a rule may name (a subscriber count): the pipeline's own limit. */
const ruleCount = z.number().int().min(0).max(100_000_000);
/** A channel's subscribers or views, as main's protocol allows them. */
const size = z.number().int().min(0).max(1_000_000_000_000);

const autoCleanAction = z.enum(["sweep", "delay", "off"]);

/**
 * What a search keeps. Without `archiveDays` it is the same shape as main's `rulesSchema`
 * (apps/desktop/src/main/pipeline/protocol.ts), which is the one the pipeline checks. A test in
 * main keeps the two equal.
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
  /** A kept channel whose median views fall below this is archived after its videos are read. */
  minMedianViews: ruleCount.nullable(),
  /** The same for its uploads in the last 30 days. */
  minUploads30: z.number().int().min(0).max(10_000).nullable(),
  /**
   * Days a rejected channel stays archived (step 5's reject reads it). Main's own: it is not
   * sent to the pipeline, so `pipelineRules` drops it from the search job.
   */
  archiveDays: z.number().int().min(1).max(90),
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

// The catalog channels (plan step 5, D1, D2 and D10). Each schema is typed against the core type
// it describes, so a schema and its type can't drift apart.

/** The most items one `find:query` page carries. */
export const findPageMax = 120;
/** The most videos on a query item (the newest) and on `find:item`'s detail. */
export const itemVideosMax = 3;
export const detailVideosMax = 15;
/** The most search runs `find:runs` lists: the newest. */
export const findRunsMax = 50;

const catalogId = z.string().min(1).max(100);
const catalogText = z.string().max(500);
const time = z.number();
const amount = z.number().nonnegative();
/** A country code as the pipeline stores it (ISO-2); kept loose so one odd row can't break a page. */
const country = z.string().min(1).max(10);
/** A run id: `runs.id` in `pipeline.db`. */
const runId = z.number().int().nonnegative();

export const catalogVideoSchema: z.ZodType<CatalogVideo> = z.strictObject({
  id: catalogId,
  title: catalogText,
  views: amount.nullable(),
  publishedAt: time.nullable(),
  pic: catalogId.nullable(),
});

const fitPartSchema: z.ZodType<FitPart> = z.strictObject({
  key: z.enum(["median", "posting", "audience", "engagement", "sponsored"]),
  points: amount,
  of: amount,
  note: catalogText,
});

export const fitSchema: z.ZodType<Fit> = z.strictObject({
  score: z.number().min(0).max(100),
  parts: z.array(fitPartSchema).max(5),
});

// The item's fields as a plain shape, so the query and the detail can each add theirs.
const catalogItemShape = {
  id: catalogId,
  name: catalogText,
  handle: catalogText,
  pic: catalogId.nullable(),
  stage: z.enum(creatorStages),
  emailConfirmed: z.boolean(),
  email: catalogText.nullable(),
  subscribers: amount.nullable(),
  medianViews: amount,
  uploads30: count,
  country: country.nullable(),
  sponsors: z.array(catalogText).max(50),
  foundEmails: count,
  latestUploadAt: time.nullable(),
  foundAt: time.nullable(),
  run: runId.nullable(),
  keyword: catalogText.nullable(),
  videos: z.array(catalogVideoSchema).max(itemVideosMax),
  engagement: z.number().nullable(),
  emailedBefore: z.strictObject({ at: time.nullable(), who: catalogText.nullable() }).nullable(),
  rejectReason: z.enum(rejectReasons).nullable(),
  archiveDueAt: time.nullable(),
  hasNumbers: z.boolean(),
};

export const catalogItemSchema: z.ZodType<CatalogItem> = z.strictObject(catalogItemShape);

/** A query item: the item and its fit. */
export const findQueryItemSchema: z.ZodType<CatalogItem & { fit: Fit }> = z.strictObject({
  ...catalogItemShape,
  fit: fitSchema,
});

/** `find:item`'s detail: the fit, the description and up to 15 videos. */
export const findItemDetailSchema: z.ZodType<
  CatalogItem & { fit: Fit; description: string; videos: CatalogVideo[] }
> = z.strictObject({
  ...catalogItemShape,
  fit: fitSchema,
  description: z.string().max(5000),
  videos: z.array(catalogVideoSchema).max(detailVideosMax),
});

export const findFilterSchema: z.ZodType<FindFilter, FindFilter> = z.strictObject({
  stages: z.array(z.enum(creatorStages)).max(creatorStages.length),
  signals: z.array(z.enum(findSignals)).max(findSignals.length),
  countries: z.array(country).max(250),
  minMedian: amount,
  maxMedian: amount.nullable(),
  minUploads: count,
  runs: z.array(runId).max(findRunsMax),
  q: z.string().max(200),
});

/** At most this many keys in an open-ended facet (countries, runs). */
const facetKeysMax = 1000;
const facetCount = z.number().int().nonnegative();
const openFacet = <K extends z.ZodString>(key: K) =>
  z
    .record(key, facetCount)
    .refine((counts) => Object.keys(counts).length <= facetKeysMax, "too many facet values");

export const facetsSchema: z.ZodType<Facets> = z.strictObject({
  stages: z.record(z.enum(creatorStages), facetCount),
  signals: z.record(z.enum(findSignals), facetCount),
  countries: openFacet(country),
  runs: openFacet(z.string().regex(/^\d{1,15}$/)),
});

export const findQueryRequestSchema = z.strictObject({
  filter: findFilterSchema,
  sort: z.enum(findSorts),
  offset: z.number().int().min(0).max(100_000),
  limit: z.number().int().min(1).max(findPageMax),
  /** Default true. False skips the facet counts (all zeros come back), for a page that hides them. */
  facets: z.boolean().optional(),
});

export const findQueryResultSchema = z.strictObject({
  /** The catalog's version: the page drops an answer older than one it already has. */
  version: z.number().int().nonnegative(),
  total: count,
  items: z.array(findQueryItemSchema).max(findPageMax),
  facets: facetsSchema,
});

export const findItemRequestSchema = z.strictObject({ id: catalogId });
export const findItemResultSchema = z.strictObject({ item: findItemDetailSchema.nullable() });

export const findRunSchema = z.strictObject({
  id: runId,
  startedAt: time,
  finishedAt: time.nullable(),
  status: z.string().max(40),
  keywords: count,
  found: count,
  kept: count,
  gold: count,
});
export const findRunsResultSchema = z.strictObject({
  runs: z.array(findRunSchema).max(findRunsMax),
});

/** `find:catalog`: the catalog was rebuilt; the page asks again. */
export const findCatalogEventSchema = z.strictObject({ version: z.number().int().nonnegative() });
