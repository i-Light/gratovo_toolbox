/**
 * The JSON-lines protocol between main and the Python pipeline (version 1, ADR 0013).
 *
 * These zod schemas are the source. `protocol-schema.ts` turns them into the JSON Schema file the
 * pipeline's tests check every message against, so the two sides can't drift apart.
 */
import { z } from "zod";

export const protocolVersion = 1;

/** A line longer than this is refused unread: no message the pipeline sends comes near it. */
export const maxLineLength = 64 * 1024;

const count = z.number().int().min(0).max(100_000_000);
const index = z.number().int().min(0).max(10_000);
const shortText = z.string().min(1).max(300);

// --- main → pipeline ---

const keyword = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => value === value.trim(), "no spaces around a keyword");

const autoCleanAction = z.enum(["sweep", "delay", "off"]);

export const rulesSchema = z.strictObject({
  countries: z.array(z.string().regex(/^[A-Z]{2}$/)).max(250),
  perKeyword: z.number().int().min(1).max(1000),
  sortBy: z.enum(["relevance", "upload_date", "view_count", "rating"]),
  resultsType: z.enum(["video", "channel"]),
  autoClean: z.strictObject({
    enabled: z.boolean(),
    minSubscribers: count,
    maxSubscribers: count,
    belowMin: autoCleanAction,
    aboveMax: autoCleanAction,
    label: z.string().min(1).max(40),
  }),
});

const searchJob = z
  .strictObject({
    kind: z.literal("search"),
    keywords: z.array(keyword).min(1).max(500),
    startAt: index,
    rules: rulesSchema,
  })
  .refine((job) => job.startAt < job.keywords.length, "startAt must name a keyword")
  .refine(
    (job) => new Set(job.keywords.map((k) => k.toLowerCase())).size === job.keywords.length,
    "keywords must be unique",
  );

const secretUrl = z.string().min(1).max(2000);

export const startSchema = z.strictObject({
  type: z.literal("start"),
  protocol: z.literal(protocolVersion),
  source: z.enum(["live", "example"]),
  dataDir: z.string().min(1).max(1024),
  worker: z.string().min(1).max(64),
  job: searchJob,
  settings: z.strictObject({
    pacing: z.enum(["normal", "fast"]).optional(),
    parallel: z
      .strictObject({ enabled: z.boolean(), maxWorkers: z.number().int().min(1).max(16) })
      .optional(),
    proxies: z.strictObject({ enabled: z.boolean(), includeDirect: z.boolean() }).optional(),
  }),
  secrets: z.strictObject({
    youtubeKey: z.string().min(1).max(200).nullable(),
    proxyUrls: z.array(secretUrl).max(100),
    gatewayUrls: z.array(secretUrl).max(100),
  }),
});

export const stopSchema = z.strictObject({ type: z.literal("stop") });

export const toPipelineSchema = z.discriminatedUnion("type", [startSchema, stopSchema]);

export type Rules = z.infer<typeof rulesSchema>;
export type Start = z.infer<typeof startSchema>;
export type Stop = z.infer<typeof stopSchema>;

// --- pipeline → main ---

const readySchema = z.strictObject({
  type: z.literal("ready"),
  protocol: z.literal(protocolVersion),
  version: z.string().min(1).max(50),
});

const runSchema = z.strictObject({
  type: z.literal("run"),
  state: z.literal("running"),
  total: index,
  startAt: index,
});

const keywordSchema = z.strictObject({
  type: z.literal("keyword"),
  index,
  total: index,
  keyword,
  state: z.enum(["started", "done", "failed"]),
  found: count.optional(),
  kept: count.optional(),
  error: z.string().min(1).max(500).optional(),
});

const channelSchema = z.strictObject({
  type: z.literal("channel"),
  keyword,
  channelId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  handle: shortText.nullable(),
  name: shortText,
  subscribers: count.nullable(),
  medianViews: count.nullable(),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullable(),
  outcome: z.enum(["kept", "swept", "delayed"]),
});

const logSchema = z.strictObject({
  type: z.literal("log"),
  level: z.enum(["info", "warn", "error"]),
  text: z.string().max(500),
});

export const endErrorCodes = [
  "bad_start",
  "no_youtube_key",
  "blocked",
  "quota",
  "network",
  "crash",
] as const;

const endSchema = z.strictObject({
  type: z.literal("end"),
  state: z.enum(["done", "stopped", "failed"]),
  at: index,
  found: count,
  kept: count,
  error: z
    .strictObject({ code: z.enum(endErrorCodes), message: z.string().min(1).max(500) })
    .optional(),
});

export const fromPipelineSchema = z.discriminatedUnion("type", [
  readySchema,
  runSchema,
  keywordSchema,
  channelSchema,
  logSchema,
  endSchema,
]);

export type PipelineMessage = z.infer<typeof fromPipelineSchema>;
export type EndErrorCode = (typeof endErrorCodes)[number];

// --- lines ---

export type ParsedLine =
  | { ok: true; message: PipelineMessage }
  | { ok: false; problem: "too_long" | "not_json" | "bad_message" };

/** Reads one line the pipeline wrote. Never throws. */
export function parseLine(line: string): ParsedLine {
  if (line.length > maxLineLength) {
    return { ok: false, problem: "too_long" };
  }
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return { ok: false, problem: "not_json" };
  }
  const parsed = fromPipelineSchema.safeParse(value);
  return parsed.success
    ? { ok: true, message: parsed.data }
    : { ok: false, problem: "bad_message" };
}

/** The first line main writes. Throws if the message breaks the schema: that is main's bug. */
export function startLine(start: Start): string {
  return `${JSON.stringify(startSchema.parse(start))}\n`;
}

export function stopLine(): string {
  return `${JSON.stringify({ type: "stop" } satisfies Stop)}\n`;
}
