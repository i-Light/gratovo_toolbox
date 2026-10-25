import { creatorStages } from "@gratovo/core/data";
import { toolboxLists, type ArchivedChannel, type ToolboxItem } from "@gratovo/core/find";
import { z } from "zod";

import { catalogItemShape, findPageMax } from "./find";

// The Toolbox channels (plan step 5d, D34 to D40): the archive countdown and never-contact lists,
// the channels archived for good, Bring back from there, the sweep, and the tool counts. Each
// schema is typed against the core type it describes, so a schema and its type can't drift apart.

/** The most tombstones one `toolbox:archived` page carries. */
export const archivedPageMax = 100;
/** The most channels one `toolbox:restore` brings back. */
export const restoreMax = 50;

/** The most keywords one tombstone shows (D46 keeps up to 50). */
export const archivedKeywordsMax = 50;

const time = z.number();
const amount = z.number().nonnegative();
const count = z.number().int().nonnegative();
const offset = z.number().int().min(0).max(100_000);
/** A YouTube channel id, the shape the pipeline's `archive.restore` job takes. */
const channelId = z.string().regex(/^UC[A-Za-z0-9_-]{22}$/);
/** A tombstone's id is shown as stored, so one odd row can't break a page. */
const archivedId = z.string().min(1).max(100);
const archivedText = z.string().max(500);

/** A row in a Toolbox list: the catalog item and when it is archived for good (null for never). */
export const toolboxItemSchema: z.ZodType<ToolboxItem> = z.strictObject({
  ...catalogItemShape,
  dueAt: time.nullable(),
});

/** A tombstone in `channel_archive`, with the app's name and stage for it when known (D36). */
export const archivedChannelSchema: z.ZodType<ArchivedChannel, ArchivedChannel> = z.strictObject({
  id: archivedId,
  handle: archivedText.nullable(),
  name: archivedText.nullable(),
  label: archivedText.nullable(),
  archivedAt: time.nullable(),
  subscribers: amount.nullable(),
  stage: z.enum(creatorStages).nullable(),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullable(),
  medianViews: amount.nullable(),
  uploads30: count.nullable(),
  latestUploadAt: time.nullable(),
  videos: count.nullable(),
  keywords: z
    .array(z.strictObject({ keyword: archivedText, at: time.nullable() }))
    .max(archivedKeywordsMax),
  keywordsTotal: count,
});

/** `toolbox:list`: one page of the countdown or the never-contact list (D36, D39). */
export const toolboxListRequestSchema = z.strictObject({
  list: z.enum(toolboxLists),
  offset,
  limit: z.number().int().min(1).max(findPageMax),
});

export const toolboxListResultSchema = z.strictObject({
  /** The catalog's version, as `find:query` answers it. */
  version: z.number().int().nonnegative(),
  total: count,
  items: z.array(toolboxItemSchema).max(findPageMax),
});

/** `toolbox:archived`: the tombstones, newest first, matching `q` on the handle or name. */
export const toolboxArchivedRequestSchema = z.strictObject({
  q: z.string().max(100),
  offset,
  limit: z.number().int().min(1).max(archivedPageMax),
});

export const toolboxArchivedResultSchema = z.strictObject({
  total: count,
  items: z.array(archivedChannelSchema).max(archivedPageMax),
});

/** `toolbox:restore`: bring channels back from "Archived for good" (D38), each id once. */
export const toolboxRestoreRequestSchema = z.strictObject({
  ids: z
    .array(channelId)
    .min(1)
    .max(restoreMax)
    .refine((ids) => new Set(ids).size === ids.length, "each channel once"),
});

/** Why nothing came back: a search holds the lane, Python can't be run, or the job ended without a result. */
export const toolboxRestoreProblems = ["busy", "no_python", "failed"] as const;

export const toolboxRestoreResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    restored: z.number().int().min(0).max(restoreMax),
    /** Whether main looks the restored channels up again (live data only). */
    refetch: z.boolean(),
  }),
  z.strictObject({ ok: z.literal(false), problem: z.enum(toolboxRestoreProblems) }),
]);

/** `toolbox:counts`: the numbers beside the tools (D34), and the tombstones' total. */
export const toolboxCountsSchema = z.strictObject({
  archive: count,
  never: count,
  archived: count,
  logToday: count,
});
