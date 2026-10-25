import { capMax, capMin, capStep } from "@gratovo/core/reach";
import {
  draftBodyMax,
  draftFindingsMax,
  draftGatesMax,
  draftKinds,
  draftProblems,
  draftRulesMax,
  draftStates,
  draftSubjectMax,
  engineGateKinds,
  mailboxStatuses,
  messageBodyMax,
  reachDraftsMax,
  reachGeminiStates,
  reachMailboxesMax,
  reachThreadsMax,
  rewriteHows,
  sequenceStops,
  threadMessagesMax,
  threadPreviewMax,
  type DraftProposal,
  type MailboxView,
  type OutreachDraft,
  type ReachData,
  type ReplyFact,
  type ReplyReading,
  type Sequence,
  type ThreadMessage,
  type ThreadSummary,
} from "@gratovo/core/data";
import { z } from "zod";

/**
 * Reach's schemas (plan step 6, `.router/PLAN.md` D4 and the IPC contract): the frame's `reach`
 * part and the `reach:*` channels. Typed against the core types, strict, and bounded.
 */

const id = z.string().min(1).max(100);
const text = z.string().max(500);
const longText = z.string().max(5000);
const time = z.number();
const count = z.number().int().nonnegative();
/** An address as main stores it: the pipeline's shape check already ran on it. */
const address = z.string().min(3).max(320);

const engineGateSchema = z.strictObject({ key: id, kind: z.enum(engineGateKinds), text: longText });

export const draftProposalSchema: z.ZodType<DraftProposal> = z.strictObject({
  status: z.enum(["ready", "needs_human", "blocked", "no_message"]),
  why: longText,
  rules: z.array(z.string().min(1).max(50)).max(draftRulesMax),
  findings: z
    .array(z.strictObject({ rule: z.string().max(50), text: longText, blocking: z.boolean() }))
    .max(draftFindingsMax),
  gates: z.array(engineGateSchema).max(draftGatesMax),
  situation: z
    .strictObject({
      side: z.string().max(50),
      stage: z.string().max(50),
      replyType: z.string().max(100).nullable(),
      summary: longText,
    })
    .nullable(),
  model: z.string().max(100).nullable(),
});

export const outreachDraftSchema: z.ZodType<OutreachDraft> = z.strictObject({
  id,
  creator: id,
  kind: z.enum(draftKinds),
  followUp: z.number().int().min(1).max(5).nullable(),
  state: z.enum(draftStates),
  subject: z.string().max(draftSubjectMax),
  body: z.string().max(draftBodyMax),
  mailbox: address.nullable(),
  sendAt: time.nullable(),
  proposal: draftProposalSchema.nullable(),
  gatesOk: z.array(id).max(draftGatesMax),
  edited: z.boolean(),
  checked: z.boolean(),
  rewriting: z.enum(rewriteHows).nullable(),
  replyTo: id.nullable(),
  problem: z.enum(draftProblems).nullable(),
  createdAt: time,
  updatedAt: time,
});

const replyFactSchema: z.ZodType<ReplyFact> = z.discriminatedUnion("key", [
  z.strictObject({ key: z.literal("rate"), rate: z.number().nonnegative(), saved: z.boolean() }),
  z.strictObject({
    key: z.literal("countries"),
    countries: z
      .array(
        z.strictObject({
          code: z.string().regex(/^[A-Z]{2}$/),
          share: z.number().min(0).max(100).nullable(),
        }),
      )
      .max(5),
    saved: z.boolean(),
  }),
  z.strictObject({ key: z.literal("age"), band: z.string().max(40), saved: z.boolean() }),
]);

export const replyReadingSchema: z.ZodType<ReplyReading> = z.strictObject({
  replyType: z.string().max(100).nullable(),
  label: text,
  summary: longText,
  side: z.string().max(50),
  corrected: z.boolean(),
  facts: z.array(replyFactSchema).max(10),
});

export const threadSummarySchema: z.ZodType<ThreadSummary> = z.strictObject({
  creator: id,
  count,
  lastOutAt: time.nullable(),
  lastIn: z
    .strictObject({
      id,
      at: time,
      reading: replyReadingSchema.nullable(),
      preview: z.string().max(threadPreviewMax),
      bounce: z.boolean(),
    })
    .nullable(),
  answered: z.boolean(),
});

export const sequenceSchema: z.ZodType<Sequence> = z.strictObject({
  creator: id,
  mailbox: address,
  startedAt: time,
  steps: z
    .array(
      z.strictObject({
        n: z.number().int().min(1).max(5),
        dueAt: time,
        state: z.enum(["planned", "drafted", "sent", "skipped"]),
        sentAt: time.nullable(),
      }),
    )
    .max(5),
  stopped: z.enum(sequenceStops).nullable(),
  parkUntil: time.nullable(),
});

export const mailboxViewSchema: z.ZodType<MailboxView> = z.strictObject({
  address,
  connected: z.boolean(),
  signedOut: z.boolean(),
  dailyCap: count,
  effectiveCap: count,
  sentToday: count,
  leftToday: count,
  warmup: z.strictObject({ day: count, of: count }).nullable(),
  paused: z.boolean(),
  status: z.enum(mailboxStatuses),
  bounceRate: z.number().min(0).max(100).nullable(),
  replyRate: z.number().min(0).max(100).nullable(),
  checkedAt: time.nullable(),
});

/** An IANA zone name, as `countryZones` gives them. */
const zone = z
  .string()
  .max(64)
  .regex(/^[A-Za-z]+(?:\/[A-Za-z_-]+){1,2}$/);

export const reachDataSchema: z.ZodType<ReachData> = z.strictObject({
  drafts: z.array(outreachDraftSchema).max(reachDraftsMax),
  sequences: z.array(sequenceSchema).max(reachThreadsMax),
  threads: z.array(threadSummarySchema).max(reachThreadsMax),
  mailboxes: z.array(mailboxViewSchema).max(reachMailboxesMax),
  gemini: z.enum(reachGeminiStates),
  geminiPausedUntil: time.nullable(),
  sender: z.string().max(100).nullable(),
  zones: z
    .record(id, zone)
    .refine((zones) => Object.keys(zones).length <= reachDraftsMax, "too many zones"),
});

export const threadMessageSchema: z.ZodType<ThreadMessage> = z.strictObject({
  id,
  direction: z.enum(["in", "out"]),
  kind: z.enum(draftKinds).nullable(),
  followUp: z.number().int().min(1).max(5).nullable(),
  subject: z.string().max(draftSubjectMax),
  body: z.string().max(messageBodyMax),
  bodyCut: z.boolean(),
  at: time,
  mailbox: address.nullable(),
  peer: z.string().max(320).nullable(),
  peerName: z.string().max(300).nullable(),
  by: id.nullable(),
  source: z.enum(["app", "sweep", "pasted", "imported"]),
  reading: replyReadingSchema.nullable(),
});

const noData = z.strictObject({ ok: z.literal(false), problem: z.literal("no_data") });
const done = z.strictObject({ ok: z.literal(true) });

/** `reach:thread`: one creator's messages, oldest first, the newest `threadMessagesMax`. */
export const reachThreadRequestSchema = z.strictObject({ creatorId: id });
export const reachThreadResultSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    messages: z.array(threadMessageSchema).max(threadMessagesMax),
  }),
  noData,
]);

/** `reach:draft-now`: queue a first email for a creator at `contact` now. */
export const reachDraftNowRequestSchema = z.strictObject({ creatorId: id });
export const reachDraftNowResultSchema = z.union([
  done,
  z.strictObject({
    ok: z.literal(false),
    problem: z.enum(["not_ready", "has_draft", "no_data"]),
  }),
]);

/** `reach:rewrite`: Shorter, Warmer, More direct or New angle; the text arrives as `reach`. */
export const reachRewriteRequestSchema = z.strictObject({ draftId: id, how: z.enum(rewriteHows) });
export const reachRewriteResultSchema = z.union([
  done,
  z.strictObject({
    ok: z.literal(false),
    problem: z.enum(["bridge_off", "paused", "no_sender", "busy", "not_found"]),
  }),
]);

/** `reach:retry`, `reach:mark-sent`, `reach:send-new`: one draft by id. */
export const reachDraftIdRequestSchema = z.strictObject({ draftId: id });
export const reachDraftActionResultSchema = z.union([
  done,
  z.strictObject({ ok: z.literal(false), problem: z.enum(["not_found", "wrong_state"]) }),
]);

/** `reach:mailboxes-refresh`: reads Gmail's numbers again (`mail.status`). */
export const reachRefreshResultSchema = z.union([
  done,
  z.strictObject({ ok: z.literal(false), problem: z.enum(["busy", "no_mail", "no_data"]) }),
]);

/**
 * `reach:mailbox-set` (D20): the daily cap (10 to 50 in steps of 5) or the pause, written at once,
 * not as an undo step.
 */
export const reachMailboxSetRequestSchema = z
  .strictObject({
    address,
    dailyCap: z.number().int().min(capMin).max(capMax).multipleOf(capStep).optional(),
    paused: z.boolean().optional(),
  })
  .refine((r) => r.dailyCap !== undefined || r.paused !== undefined, "nothing to change");
export const reachMailboxSetResultSchema = z.union([
  done,
  z.strictObject({ ok: z.literal(false), problem: z.enum(["not_found", "no_data"]) }),
]);

/** `reach:send-test` (D20): a test email from the mailbox to its own address, on a person's click. */
export const reachSendTestRequestSchema = z.strictObject({ address });
export const reachSendTestResultSchema = z.union([
  done,
  z.strictObject({
    ok: z.literal(false),
    problem: z.enum([
      "not_found",
      "not_connected",
      "signed_out",
      "paused",
      "busy",
      "failed",
      "no_data",
    ]),
  }),
]);
