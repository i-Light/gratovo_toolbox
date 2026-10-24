import { z } from "zod";

import { geminiStatusSchema } from "./gemini";
import { isoTime, localPath } from "./import";
import { syncStates } from "./sync";

/**
 * Settings › Connections (plan step 4, D7, D10, D11). The status is one snapshot with no secret
 * in it: a secret shows only as "set" or a count. Secrets travel one way, in `connections:set`,
 * and no channel ever returns one.
 *
 * The mail, pacing and AWS bounds mirror the pipeline's start message in
 * apps/desktop/src/main/pipeline/protocol.ts (this package can't import the app). Keep the two
 * equal: what is saved here is what main sends.
 */

// As protocol.ts.
const email = z
  .string()
  .min(3)
  .max(320)
  .regex(/^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const region = z.string().regex(/^[a-z]{2}(-[a-z]+)+-\d$/);
/** Text that goes into a mail header: no line break of any kind. */
const headerText = (max: number) =>
  z
    .string()
    .max(max)
    // eslint-disable-next-line no-control-regex -- the control characters are the point: they break lines
    .regex(/^[^\r\n\v\f\x1c-\x1e\x85\u2028\u2029]*$/);

/** As protocol.ts: a mailbox's daily cap, the most mailboxes, the label and the sender's name. */
export const mailboxCapMin = 10;
export const mailboxCapMax = 50;
export const mailboxesMax = 20;
const dailyCap = z.number().int().min(mailboxCapMin).max(mailboxCapMax);
const mailLabel = z.string().min(1).max(100);
const senderName = headerText(100).nullable();

const pacing = z.enum(["normal", "fast"]);
const parallel = z.strictObject({
  enabled: z.boolean(),
  maxWorkers: z.number().int().min(1).max(16),
});
const proxySwitches = z.strictObject({ enabled: z.boolean(), includeDirect: z.boolean() });

/** A proxy as the owner pastes it: one token, no spaces. As `pipeline.proxies` keeps them. */
const proxyUrl = z.string().min(1).max(2000).regex(/^\S+$/);
const proxiesMax = 100;
const regionsMax = 100;

export const mailboxHealths = ["ok", "signed-out", "error", "unknown"] as const;

/** A connected mailbox: its settings, and how the last `mail.status` found it. */
export const mailboxStatusSchema = z.strictObject({
  address: email,
  dailyCap,
  warmupStartedOn: day.nullable(),
  health: z.enum(mailboxHealths),
  checkedAt: isoTime.nullable(),
});

/** Everything Settings › Connections shows, in one read. `connections:changed` carries it whole. */
export const connectionsStatusSchema = z.strictObject({
  python: z.strictObject({ state: z.enum(["ready", "missing"]) }),
  /** Whether the team's YouTube key can be had; asking spends no quota. */
  youtube: z.strictObject({ state: z.enum(["available", "unavailable"]) }),
  gemini: geminiStatusSchema,
  /** The Gmail app's client id and secret are stored. */
  mailApp: z.strictObject({ set: z.boolean() }),
  mailboxes: z.array(mailboxStatusSchema).max(mailboxesMax),
  mail: z.strictObject({ label: mailLabel, senderName }),
  proxies: z.strictObject({
    count: z.number().int().min(0).max(proxiesMax),
    enabled: z.boolean(),
    includeDirect: z.boolean(),
  }),
  pacing,
  parallel,
  aws: z.strictObject({
    keys: z.boolean(),
    enabled: z.boolean(),
    regions: z.array(region).max(regionsMax),
  }),
  course: z.strictObject({
    courseDir: localPath.nullable(),
    videoDir: localPath.nullable(),
    /** The course folder is set and exists. */
    courseFound: z.boolean(),
  }),
  sync: z.strictObject({ state: z.enum(syncStates) }),
  import: z.strictObject({
    state: z.enum(["never", "done"]),
    at: isoTime.nullable(),
    backup: localPath.nullable(),
  }),
});
export type ConnectionsStatus = z.output<typeof connectionsStatusSchema>;

/**
 * One change from Settings › Connections, told apart by `kind`. Secrets (`mail.client`,
 * `proxies.urls`, `aws.keys`) are set only: main stores them and never sends them back.
 */
export const connectionsChangeSchema = z.discriminatedUnion("kind", [
  /** The Gmail app the owner made in Google Cloud. Secret. */
  z.strictObject({
    kind: z.literal("mail.client"),
    id: z.string().min(1).max(300),
    secret: z.string().min(1).max(300),
  }),
  z.strictObject({ kind: z.literal("mail.settings"), label: mailLabel, senderName }),
  /** A connected mailbox's cap and warm-up start. Connecting one is `mail:connect`. */
  z.strictObject({
    kind: z.literal("mailbox.update"),
    address: email,
    dailyCap,
    warmupStartedOn: day.nullable(),
  }),
  /** Forgets a mailbox: its settings row and its stored token. */
  z.strictObject({ kind: z.literal("mailbox.remove"), address: email }),
  /** Replaces the whole proxy list. Secret: the URLs may carry a password. */
  z.strictObject({ kind: z.literal("proxies.urls"), urls: z.array(proxyUrl).max(proxiesMax) }),
  z.strictObject({
    kind: z.literal("pipeline.settings"),
    pacing,
    parallel,
    proxies: proxySwitches,
  }),
  /** The AWS keys the gateway jobs sign with, as `aws.keys` keeps them. Secret. */
  z.strictObject({
    kind: z.literal("aws.keys"),
    accessKeyId: z.string().regex(/^[A-Z0-9]{16,128}$/),
    secretAccessKey: z.string().min(1).max(200),
  }),
  z.strictObject({ kind: z.literal("gateways.enabled"), enabled: z.boolean() }),
  z.strictObject({
    kind: z.literal("course"),
    courseDir: localPath.nullable(),
    videoDir: localPath.nullable(),
  }),
]);
export type ConnectionsChange = z.output<typeof connectionsChangeSchema>;

/** `not_built` (here and below) is the step 4 stub's answer until the real service is wired. */
export const connectionsSetResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true) }),
  z.strictObject({
    ok: z.literal(false),
    reason: z.enum(["not_built", "no_data", "unknown_mailbox", "failed"]),
  }),
]);
export type ConnectionsSetResult = z.output<typeof connectionsSetResultSchema>;

export const pickFolderRequestSchema = z.strictObject({ purpose: z.enum(["course", "videos"]) });
export type FolderPurpose = z.output<typeof pickFolderRequestSchema>["purpose"];

/** Connecting a Gmail mailbox through Google's consent page in the system browser (D10). */
export const mailConnectResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), address: email }),
  z.strictObject({
    ok: z.literal(false),
    reason: z.enum([
      "not_built",
      /** No Gmail app (client id and secret) is stored. */
      "no_client",
      "no_data",
      /** Already 20 mailboxes. */
      "too_many",
      /** Another consent is waiting. */
      "busy",
      "denied",
      "timeout",
      /** Google's answer came back with the wrong `state`: a stale tab or a forged request. */
      "bad_state",
      /** Google's answer, or its token response, was not what the flow expects. */
      "bad_response",
      /** Google refused to exchange the code for tokens. */
      "exchange_failed",
      /** Google gave no refresh token, so the mailbox could not be used later. */
      "no_refresh_token",
      "failed",
    ]),
  }),
]);
export type MailConnectResult = z.output<typeof mailConnectResultSchema>;

/** "Check mailboxes": runs `mail.status` and answers each mailbox's health. */
export const mailCheckResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    mailboxes: z.array(mailboxStatusSchema).max(mailboxesMax),
  }),
  z.strictObject({
    ok: z.literal(false),
    reason: z.enum(["not_built", "no_client", "no_mailboxes", "no_data", "no_python", "failed"]),
  }),
]);
export type MailCheckResult = z.output<typeof mailCheckResultSchema>;

export const gatewaysDeployRequestSchema = z.strictObject({
  regions: z
    .array(region)
    .min(1)
    .max(20)
    .refine((list) => new Set(list).size === list.length, "regions must be unique"),
});

const gatewayProblems = z.enum([
  "not_built",
  /** No AWS keys stored. */
  "no_keys",
  "no_data",
  /** Deploying would pass the gateways' cap. */
  "too_many",
  /** A gateway job is running. */
  "running",
  "no_python",
  "failed",
]);

export const gatewaysDeployResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    deployed: z.array(region).max(20),
    failed: z.array(region).max(20),
  }),
  z.strictObject({ ok: z.literal(false), reason: gatewayProblems }),
]);
export type GatewaysDeployResult = z.output<typeof gatewaysDeployResultSchema>;

/** Removes every gateway in one region. */
export const gatewaysRemoveRequestSchema = z.strictObject({ region });
export const gatewaysRemoveResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), removed: z.number().int().min(0).max(regionsMax) }),
  z.strictObject({ ok: z.literal(false), reason: gatewayProblems }),
]);
export type GatewaysRemoveResult = z.output<typeof gatewaysRemoveResultSchema>;
