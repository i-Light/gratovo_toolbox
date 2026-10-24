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
/** A channel's subscribers or views: the biggest pass 300 million subscribers and billions of views. */
const size = z.number().int().min(0).max(1_000_000_000_000);
const index = z.number().int().min(0).max(10_000);
const shortText = z.string().min(1).max(300);
/** What an error says. The pipeline cuts longer text to fit. */
const message = z.string().min(1).max(500);

const email = z
  .string()
  .min(3)
  .max(320)
  .regex(/^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/);
const handle = z.string().regex(/^@[A-Za-z0-9._-]{1,100}$/);
const region = z.string().regex(/^[a-z]{2}(-[a-z]+)+-\d$/);
const apiId = z.string().regex(/^[a-z0-9]{1,32}$/);
const gmailId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
/**
 * Text that goes into a mail header: a line break there would start a new header. Every line
 * boundary Python's email module refuses, not only CR and LF.
 */
const headerText = (max: number) =>
  z
    .string()
    .max(max)
    // eslint-disable-next-line no-control-regex -- the control characters are the point: they break lines
    .regex(/^[^\r\n\v\f\x1c-\x1e\x85\u2028\u2029]*$/);
const conversationKey = z.string().min(1).max(200);
const channelId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const secretUrl = z.string().min(1).max(2000);
/**
 * A full path: a drive (`C:\`), a share (`\\server`) or a POSIX root (`/`, the tests' temporary
 * folders on Linux). Never a NUL, which no file name can hold.
 */
const absolutePath = z
  .string()
  .min(1)
  .max(1024)
  // eslint-disable-next-line no-control-regex -- the NUL is the point: no path holds one
  .regex(/^(?:[A-Za-z]:[\\/]|[\\/])[^\x00]*$/);

/** True when no two values are the same once lowercased. */
function unique(values: readonly string[]): boolean {
  return new Set(values.map((value) => value.toLowerCase())).size === values.length;
}

// --- main → pipeline ---

const keyword = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => value === value.trim(), "no spaces around a keyword");

const autoCleanAction = z.enum(["sweep", "delay", "off"]);

const autoCleanSchema = z.strictObject({
  enabled: z.boolean(),
  minSubscribers: count,
  maxSubscribers: count,
  belowMin: autoCleanAction,
  aboveMax: autoCleanAction,
  label: z.string().min(1).max(40),
});

export const rulesSchema = z.strictObject({
  countries: z.array(z.string().regex(/^[A-Z]{2}$/)).max(250),
  perKeyword: z.number().int().min(1).max(1000),
  sortBy: z.enum(["relevance", "upload_date", "view_count", "rating"]),
  resultsType: z.enum(["video", "channel"]),
  autoClean: autoCleanSchema,
  /**
   * Plan D8: a kept channel whose median views fall below this, once its videos are read, is
   * archived as an auto-clean sweep would. Null or absent: no bound.
   */
  minMedianViews: count.nullable().optional(),
  /** The same for a channel with fewer uploads than this in the last 30 days. */
  minUploads30: index.nullable().optional(),
});

const searchJob = z
  .strictObject({
    kind: z.literal("search"),
    keywords: z.array(keyword).min(1).max(500),
    startAt: index,
    rules: rulesSchema,
    /**
     * Plan step 5, D7: channels the search treats as already known, so it never keeps them again
     * (never-contact creators). A YouTube channel id each.
     */
    skip: z
      .array(z.string().regex(/^UC[A-Za-z0-9_-]{22}$/))
      .max(20_000)
      .optional(),
  })
  .refine((job) => job.startAt < job.keywords.length, "startAt must name a keyword")
  .refine((job) => unique(job.keywords), "keywords must be unique");

// The other jobs (3e-3b). Each answers with one `result` line before its `end`; `mail.replies`
// also sends a `reply` line for each reply it finds.

const mailStatusJob = z.strictObject({ kind: z.literal("mail.status") });

const mailSendJob = z.strictObject({
  kind: z.literal("mail.send"),
  message: z.strictObject({
    to: email,
    subject: headerText(998),
    body: z.string().min(1).max(100_000),
    /** The connected mailbox that sends it: needed only when more than one is connected. */
    mailbox: email.optional(),
    conversationKey: conversationKey.optional(),
    newThread: z.boolean().optional(),
    channelId: channelId.optional(),
    labels: z.array(z.string().min(1).max(100)).max(10).optional(),
    /** One send per key: a second job with the same key reports the first send instead. */
    sendKey: z
      .string()
      .min(8)
      .max(200)
      .regex(/^[A-Za-z0-9_:.-]+$/),
    /** Who pressed Send. Nothing goes out without a person's approval. */
    approvedBy: z.string().min(1).max(100),
  }),
});

const mailRepliesJob = z.strictObject({
  kind: z.literal("mail.replies"),
  /** One mailbox; every connected one when absent. */
  mailbox: email.optional(),
  conversationKey: conversationKey.optional(),
  /** Messages checked per mailbox (60 when absent). */
  limit: z.number().int().min(1).max(500).optional(),
});

const mailAckJob = z.strictObject({
  kind: z.literal("mail.ack"),
  messageIds: z.array(gmailId).min(1).max(500),
});

const mailCancelJob = z.strictObject({ kind: z.literal("mail.cancel"), conversationKey });

const videoStatsJob = z.strictObject({
  kind: z.literal("video_stats"),
  videoUrl: z.string().min(1).max(2000),
});

const refetchJob = z
  .strictObject({
    kind: z.literal("refetch"),
    handles: z.array(handle).min(1).max(2000),
    /** The keyword the channels are filed under (`__manual_refetch__` when absent). */
    keyword: keyword.optional(),
    autoClean: autoCleanSchema.nullable(),
  })
  .refine((job) => unique(job.handles), "handles must be unique");

const backfillJob = z
  .strictObject({
    kind: z.literal("backfill"),
    only: z
      .array(z.enum(["channels", "videos", "backfill", "backlog"]))
      .min(1)
      .max(4),
    handles: z.array(handle).min(1).max(500).optional(),
    /** How far back `backfill` reads videos (2 when absent). */
    months: z.number().int().min(1).max(24).optional(),
    /** The Data API calls the job may make (100 when absent; 0 means no ceiling). */
    maxApiCalls: z.number().int().min(0).max(10_000).optional(),
    includeAbsent: z.boolean().optional(),
    limit: z.number().int().min(1).max(100_000).optional(),
  })
  .refine((job) => unique(job.only), "only must not repeat a part");

const gatewaysDeployJob = z
  .strictObject({
    kind: z.literal("gateways.deploy"),
    regions: z.array(region).min(1).max(20),
  })
  .refine((job) => unique(job.regions), "regions must be unique");

const gatewaysDestroyJob = z.strictObject({
  kind: z.literal("gateways.destroy"),
  gateways: z.array(z.strictObject({ region, apiId })).min(1).max(50),
});

const gatewaysTestJob = z.strictObject({ kind: z.literal("gateways.test") });

/**
 * Step 4 (plan D3 to D5): copy the old app's `gratovo.db` into this app's `pipeline.db`. The old
 * file is opened read-only. A dry run writes nothing; a real import first backs up an existing
 * `pipeline.db` into `backupDir`. It sends a `progress` line per table and an `ImportReport`.
 */
const importLegacyJob = z
  .strictObject({
    kind: z.literal("import.legacy"),
    source: absolutePath,
    dryRun: z.boolean(),
    backupDir: absolutePath.nullable(),
  })
  .refine((job) => job.dryRun || job.backupDir !== null, {
    message: "a real import needs backupDir",
    path: ["backupDir"],
  });

export const jobSchema = z.discriminatedUnion("kind", [
  searchJob,
  mailStatusJob,
  mailSendJob,
  mailRepliesJob,
  mailAckJob,
  mailCancelJob,
  videoStatsJob,
  refetchJob,
  backfillJob,
  gatewaysDeployJob,
  gatewaysDestroyJob,
  gatewaysTestJob,
  importLegacyJob,
]);

export const startSchema = z
  .strictObject({
    type: z.literal("start"),
    protocol: z.literal(protocolVersion),
    source: z.enum(["live", "example"]),
    dataDir: z.string().min(1).max(1024),
    worker: z.string().min(1).max(64),
    job: jobSchema,
    settings: z.strictObject({
      pacing: z.enum(["normal", "fast"]).optional(),
      parallel: z
        .strictObject({ enabled: z.boolean(), maxWorkers: z.number().int().min(1).max(16) })
        .optional(),
      proxies: z.strictObject({ enabled: z.boolean(), includeDirect: z.boolean() }).optional(),
      /** The mail jobs': the label sent mail gets, the sender's name, each mailbox's daily cap. */
      mail: z
        .strictObject({
          label: z.string().min(1).max(100),
          senderName: headerText(100).nullable(),
          mailboxes: z
            .array(
              z.strictObject({
                address: email,
                dailyCap: z.number().int().min(10).max(50),
                warmupStartedOn: day.nullable(),
              }),
            )
            .max(20),
        })
        .optional(),
    }),
    // The first three are sent with every job: null and [] when it needs none of them.
    secrets: z.strictObject({
      youtubeKey: z.string().min(1).max(200).nullable(),
      proxyUrls: z.array(secretUrl).max(100),
      gatewayUrls: z.array(secretUrl).max(100),
      /** The Gmail app's client and each connected mailbox's refresh token. */
      mail: z
        .strictObject({
          client: z.strictObject({
            id: z.string().min(1).max(300),
            secret: z.string().min(1).max(300),
          }),
          mailboxes: z
            .array(z.strictObject({ address: email, refreshToken: z.string().min(1).max(2000) }))
            .max(20),
        })
        .optional(),
      /** The AWS keys the gateway jobs sign their requests with. */
      aws: z
        .strictObject({
          accessKeyId: z.string().regex(/^[A-Z0-9]{16,128}$/),
          secretAccessKey: z.string().min(1).max(200),
        })
        .optional(),
    }),
  })
  // Example data fakes the other jobs on main's side (steps 5 to 9): only a search runs on it.
  // The import is refused there too: it writes the live pipeline.db (plan D3).
  .refine((start) => start.source === "live" || start.job.kind === "search", {
    message: "only a search runs on example data",
    path: ["source"],
  })
  // A mailbox's address is read from the settings, never the secrets (ADR 0015 §8).
  .refine(
    (start) => {
      const key = (address: string) => address.trim().toLowerCase();
      const listed = new Set((start.settings.mail?.mailboxes ?? []).map((m) => key(m.address)));
      return (start.secrets.mail?.mailboxes ?? []).every((m) => listed.has(key(m.address)));
    },
    {
      message: "every connected mailbox must be listed in settings.mail.mailboxes",
      path: ["settings"],
    },
  );

export const stopSchema = z.strictObject({ type: z.literal("stop") });

export const toPipelineSchema = z.discriminatedUnion("type", [startSchema, stopSchema]);

export type Rules = z.infer<typeof rulesSchema>;
export type Job = z.infer<typeof jobSchema>;
export type JobKind = Job["kind"];
export type SearchJob = Extract<Job, { kind: "search" }>;
export type ImportLegacyJob = Extract<Job, { kind: "import.legacy" }>;
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
  error: message.optional(),
});

const channelSchema = z.strictObject({
  type: z.literal("channel"),
  keyword,
  channelId,
  handle: shortText.nullable(),
  name: shortText,
  subscribers: size.nullable(),
  medianViews: size.nullable(),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullable(),
  outcome: z.enum(["kept", "swept", "delayed"]),
});

/**
 * How far `import.legacy` has got: one line after each table is copied (or counted, on a dry
 * run). `table` names it; `done` of `total` tables are finished, this one included.
 */
const progressSchema = z.strictObject({
  type: z.literal("progress"),
  table: z.string().min(1).max(64),
  done: index,
  total: index,
});

const logSchema = z.strictObject({
  type: z.literal("log"),
  level: z.enum(["info", "warn", "error"]),
  text: z.string().max(500),
});

/** One reply `mail.replies` found. A long body is cut so the line fits (`bodyCut`). */
const replySchema = z.strictObject({
  type: z.literal("reply"),
  account: email,
  conversationKey,
  channelId: channelId.nullable(),
  messageId: gmailId,
  from: z.string().max(320),
  fromName: z.string().max(300).nullable(),
  subject: z.string().max(998),
  body: z.string(),
  bodyCut: z.boolean(),
  receivedAt: z.string().nullable(),
  isFirstReply: z.boolean(),
  cancelledFollowUps: count,
});

// A job's answer: at most once, before its `end`, and never when it failed.

const mailError = z
  .strictObject({ code: z.enum(["mail_auth", "mail_api", "network"]), message })
  .nullable();

const mailStatusResult = z.strictObject({
  type: z.literal("result"),
  kind: z.literal("mail.status"),
  data: z.strictObject({
    configured: z.boolean(),
    label: z.string(),
    senderName: z.string().nullable(),
    accounts: z.array(
      z.strictObject({
        account: z.string().nullable(),
        connected: z.boolean(),
        counters: z
          .strictObject({
            conversations: count,
            sent: count,
            awaitingReply: count,
            replied: count,
            pendingSteps: count,
            dueSteps: count,
            failedSteps: count,
            unreportedReplies: count,
          })
          .nullable(),
        limits: z
          .strictObject({
            dailyCap: count,
            warmupStartedOn: z.string().nullable(),
            sentToday: count,
            leftToday: count,
          })
          .nullable(),
        lastSweepAt: z.string().nullable(),
        error: mailError,
      }),
    ),
  }),
});

const mailSendResult = z.strictObject({
  type: z.literal("result"),
  kind: z.literal("mail.send"),
  data: z.strictObject({
    /** True when the key had sent already: nothing new went out. */
    duplicate: z.boolean(),
    account: email,
    conversationKey,
    messageId: gmailId,
    threadId: gmailId.nullable(),
    rfcMessageId: z.string().max(998).nullable(),
    labelled: z.boolean(),
    threaded: z.boolean(),
    to: email,
    subject: z.string().nullable(),
    sentAt: z.string(),
  }),
});

const mailRepliesResult = z.strictObject({
  type: z.literal("result"),
  kind: z.literal("mail.replies"),
  data: z.strictObject({
    accounts: z.array(
      z.strictObject({
        account: email,
        checked: count,
        replies: count,
        cancelledQueued: count,
        error: mailError,
      }),
    ),
  }),
});

const mailAckResult = z.strictObject({
  type: z.literal("result"),
  kind: z.literal("mail.ack"),
  data: z.strictObject({ acknowledged: count }),
});

const mailCancelResult = z.strictObject({
  type: z.literal("result"),
  kind: z.literal("mail.cancel"),
  data: z.strictObject({ cancelled: count, closed: z.boolean() }),
});

const videoStatsResult = z.strictObject({
  type: z.literal("result"),
  kind: z.literal("video_stats"),
  data: z.strictObject({ videoId: z.string().length(11), views: size, fetchedAt: z.string() }),
});

const refetchResult = z.strictObject({
  type: z.literal("result"),
  kind: z.literal("refetch"),
  data: z.strictObject({
    processed: count,
    swept: count,
    deferred: count,
    failedCount: count,
    /** The first 200 handles that failed; `failedCount` counts them all. */
    failed: z.array(handle).max(200),
  }),
});

const targetsFilled = z.strictObject({ targets: count, filled: count }).nullable();

const backfillResult = z.strictObject({
  type: z.literal("result"),
  kind: z.literal("backfill"),
  data: z.strictObject({
    channels: targetsFilled,
    videos: targetsFilled,
    backfill: z.strictObject({ channels: count, saved: count }).nullable(),
    backlog: z.strictObject({ stamped: count }).nullable(),
    apiCalls: count,
    budgetReached: z.boolean(),
  }),
});

const gatewaysDeployResult = z.strictObject({
  type: z.literal("result"),
  kind: z.literal("gateways.deploy"),
  data: z.strictObject({
    // The URLs are secrets: main keeps them in `pipeline.gateways` and never logs them.
    deployed: z.array(z.strictObject({ region, apiId, url: secretUrl })),
    failed: z.array(z.strictObject({ region, message })),
  }),
});

const gatewaysDestroyResult = z.strictObject({
  type: z.literal("result"),
  kind: z.literal("gateways.destroy"),
  data: z.strictObject({
    deleted: z.array(z.strictObject({ region, apiId })),
    failed: z.array(z.strictObject({ region, apiId, message })),
  }),
});

const gatewaysTestResult = z.strictObject({
  type: z.literal("result"),
  kind: z.literal("gateways.test"),
  data: z.strictObject({
    results: z.array(
      z.strictObject({
        region: region.nullable(),
        status: z.number().int().min(0).max(999).nullable(),
        ok: z.boolean(),
        message: message.nullable(),
      }),
    ),
  }),
});

/** A table's name in the old file, as the import reports it. The pipeline cuts a longer one. */
const tableName = z.string().min(1).max(64);

/**
 * What the import found (a dry run) or did (a real import), plan D4. The same field names as
 * `ImportReport` in `packages/ipc`.
 */
export const importReportSchema = z.strictObject({
  source: z.string().min(1).max(1024),
  /** Each table copied: its rows in the old file, the rows to add (or added), the rows here already. */
  tables: z
    .array(z.strictObject({ name: tableName, inOld: count, toAdd: count, already: count }))
    .max(40),
  /** The tables left behind, and why: the sync brings them, old bookkeeping, or never ported. */
  skipped: z
    .array(
      z.strictObject({
        name: tableName,
        rows: count,
        why: z.enum(["synced", "bookkeeping", "not-ported"]),
      }),
    )
    .max(60),
  /** Old work never sent to Supabase (`_outbox` rows, `activity_log` rows with `synced = 0`). */
  unsent: z.strictObject({ outbox: count, activity: count }),
  /** The old settings files looked for beside the database. */
  settingsFiles: z
    .array(z.strictObject({ name: z.string().min(1).max(64), found: z.boolean() }))
    .max(20),
  dryRun: z.boolean(),
  /** The copy of `pipeline.db` made before a real import; null on a dry run or a first import. */
  backup: z.string().min(1).max(1024).nullable(),
});

const importLegacyResult = z.strictObject({
  type: z.literal("result"),
  kind: z.literal("import.legacy"),
  data: importReportSchema,
});

const resultSchema = z.discriminatedUnion("kind", [
  mailStatusResult,
  mailSendResult,
  mailRepliesResult,
  mailAckResult,
  mailCancelResult,
  videoStatsResult,
  refetchResult,
  backfillResult,
  gatewaysDeployResult,
  gatewaysDestroyResult,
  gatewaysTestResult,
  importLegacyResult,
]);

export const endErrorCodes = [
  "bad_start",
  "no_youtube_key",
  "blocked",
  "quota",
  "network",
  "crash",
  "mail_not_connected",
  "mail_auth",
  "mail_api",
  "daily_cap_reached",
  "send_uncertain",
  "not_a_video",
  "not_found",
  "no_aws_keys",
  "aws",
  // import.legacy: the old file is missing or can't be read, isn't SQLite, has no `channels`
  // table, or lies inside this app's data folder, or has an unfinished `-wal` beside
  // it (the old app is open); or pipeline.db is newer than this pipeline.
  "source_unreadable",
  "not_sqlite",
  "no_channels_table",
  "source_in_data_dir",
  "old_app_open",
  "store_too_new",
] as const;

/** For a job other than `search`, `at`, `found` and `kept` are 0: its answer is its `result`. */
const endSchema = z.strictObject({
  type: z.literal("end"),
  state: z.enum(["done", "stopped", "failed"]),
  at: index,
  found: count,
  kept: count,
  error: z.strictObject({ code: z.enum(endErrorCodes), message }).optional(),
});

export const fromPipelineSchema = z.discriminatedUnion("type", [
  readySchema,
  runSchema,
  keywordSchema,
  channelSchema,
  progressSchema,
  logSchema,
  replySchema,
  resultSchema,
  endSchema,
]);

export type PipelineMessage = z.infer<typeof fromPipelineSchema>;
export type EndErrorCode = (typeof endErrorCodes)[number];
export type ReplyMessage = z.infer<typeof replySchema>;
export type ProgressMessage = z.infer<typeof progressSchema>;
export type ImportReport = z.infer<typeof importReportSchema>;
export type ResultMessage = z.infer<typeof resultSchema>;
export type ResultKind = ResultMessage["kind"];
/** The `data` a job of this kind answers with. */
export type ResultData<K extends ResultKind> = Extract<ResultMessage, { kind: K }>["data"];

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
