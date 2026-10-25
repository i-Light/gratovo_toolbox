import { DEAL_FLOW } from "@gratovo/core";
import {
  agencyRoles,
  draftBodyMax,
  draftSubjectMax,
  personDraftStates,
  contactNameMax,
  contactSources,
  creatorStages,
  emailMax,
  emailPattern,
  frameSources,
  logActions,
  nameMax,
  neverReasonMax,
  notesMax,
  notificationIcons,
  rejectReasons,
  replyFactKeys,
  type Brand,
  type Creator,
  type DataWrite,
  type Deal,
  type EditConflict,
  type Frame,
  type FrameNotification,
  type LogEntry,
  type MateRun,
  type NotifyKind,
  type NotifySettings,
  type RailCounts,
  type TeamMember,
} from "@gratovo/core/data";
import { z } from "zod";

import { reachDataSchema } from "./reach";

/**
 * The schemas of the data channels. Each is typed against the core type it describes, so the
 * typecheck fails if a schema and its type drift apart. Objects are strict: an extra field is
 * refused. The limits keep one call small; nothing here is a path, a URL or a secret.
 */

/** The longest id. */
export const idMax = 100;
/** The longest free text (a line of text, a title, a handle). */
export const textMax = 500;
/** The most entries in a list of records. */
export const listMax = 5000;
/** The most log lines in a frame: the newest. */
export const logMax = 50;
/** The longest detail on a log line (a reject reason today). */
export const detailMax = 500;

const id = z.string().min(1).max(idMax);
const text = z.string().max(textMax);
const time = z.number();
const count = z.number().int().nonnegative();

/** An email address: at most 254 characters, in the basic shape (`emailPattern`). */
export const emailAddressSchema = z.string().max(emailMax).regex(emailPattern);
/** The longest address taken back unconfirmed: the old app stored any text as the email. */
const storedEmailMax = 1000;
/** Who reads a creator's inbox (plan step 5, D31). */
const contactName = z.string().max(contactNameMax);
/** How sure the email finder is of an address, 0 to 1. */
export const confidenceSchema = z.number().min(0).max(1);

const roleSchema = z.enum(["unauthorized", "basic", "full"]);

export const teamMemberSchema: z.ZodType<TeamMember> = z.strictObject({
  id,
  name: z.string().max(nameMax),
  role: roleSchema,
  roles: z.array(z.enum(agencyRoles)).max(agencyRoles.length),
  status: z.enum(["online", "away"]),
  doing: text,
});

// A kind that is absent is on; `exactOptional` keeps "absent" apart from "undefined".
export const notifySettingsSchema: z.ZodType<NotifySettings> = z.strictObject({
  reply: z.exactOptional(z.boolean()),
  money: z.exactOptional(z.boolean()),
  handoff: z.exactOptional(z.boolean()),
  search: z.exactOptional(z.boolean()),
} satisfies Record<NotifyKind, unknown>);

export const frameNotificationSchema: z.ZodType<FrameNotification> = z.strictObject({
  id,
  at: time,
  icon: z.enum(notificationIcons),
  text,
  sub: text,
  go: z.strictObject({ screen: text, tab: text.nullable() }),
  read: z.boolean(),
});

export const railCountsSchema: z.ZodType<RailCounts> = z.strictObject({
  today: count,
  plannedMinutes: count,
  find: count,
  reach: count,
  close: count,
  deliver: count,
});

const logRef = {
  ref: id.nullable(),
  action: z.enum(logActions).nullable(),
  detail: z.string().max(detailMax).nullable(),
};

export const logEntrySchema: z.ZodType<LogEntry> = z.strictObject({
  id,
  at: time,
  who: text,
  text,
  ...logRef,
});

/** The most lines `log:for` answers with. */
export const logForMax = 100;

/** `log:for`: one creator's lines (plan step 5, D17 and D23). */
export const logForRequestSchema = z.strictObject({
  ref: id,
  limit: z.number().int().min(1).max(logForMax),
});

/** Newest first. */
export const logForResultSchema = z.strictObject({
  lines: z.array(logEntrySchema).max(logForMax),
});

/** The most lines one `log:page` answers with (plan step 5, D40). */
export const logPageMax = 100;
/** The most people `log:page` counts lines for. */
export const logPeopleMax = 50;

/**
 * `log:page`: the whole activity log, newest first (Toolbox › Activity log, D40). `before` is the
 * last line already shown, so the next page starts after it; `who` keeps one person's lines.
 */
export const logPageRequestSchema = z.strictObject({
  before: z.strictObject({ at: time, id }).nullable(),
  limit: z.number().int().min(1).max(logPageMax),
  who: z.string().max(100).nullable(),
});

/**
 * The page, whether more lines follow, each person who has lines (most lines first), and `total`:
 * every visible line, for "Everyone", past the first 50 people too.
 */
export const logPageResultSchema = z.strictObject({
  lines: z.array(logEntrySchema).max(logPageMax),
  more: z.boolean(),
  people: z
    .array(z.strictObject({ who: z.string().max(100), name: text, count }))
    .max(logPeopleMax),
  total: count,
});

export const creatorSchema: z.ZodType<Creator, Creator> = z.strictObject({
  id,
  name: text,
  handle: text,
  stage: z.enum(creatorStages),
  // Loose here: a stored address from the old app is shown as it is, whatever its shape.
  email: text.nullable(),
  emailConfirmed: z.boolean(),
  contactName: contactName.nullable(),
  contactSource: z.enum(contactSources).nullable(),
  contactConfidence: confidenceSchema.nullable(),
  rejectReason: z.enum(rejectReasons).nullable(),
  rejectedAt: time.nullable(),
  neverReason: z.string().max(neverReasonMax).nullable(),
  archiveDueAt: time.nullable(),
});

export const brandSchema: z.ZodType<Brand> = z.strictObject({
  id,
  name: text,
  sells: text,
  status: text,
});

export const dealSchema: z.ZodType<Deal> = z.strictObject({
  id,
  brand: id,
  creator: id,
  step: count,
  // Null when the member may not see money: the main process strips it before the frame leaves.
  price: z.number().nonnegative().nullable(),
});

export const mateRunSchema: z.ZodType<MateRun> = z.strictObject({
  by: id,
  at: time,
  current: count,
  total: count,
});

export const editConflictSchema: z.ZodType<EditConflict> = z.strictObject({
  id,
  creator: id,
  label: text,
  field: text,
  mine: text,
  theirs: text,
  theirName: text,
});

/** The most open conflicts in a frame. */
export const conflictsMax = 100;

/** What `frame:load` answers: everything the frame, palette, peek and record page show. */
export const frameSchema: z.ZodType<Frame> = z.strictObject({
  source: z.enum(frameSources),
  me: id,
  myName: z.string().max(nameMax).nullable(),
  team: z.array(teamMemberSchema).max(listMax),
  counts: railCountsSchema,
  notifications: z.array(frameNotificationSchema).max(listMax),
  log: z.array(logEntrySchema).max(logMax),
  creators: z.array(creatorSchema).max(listMax),
  brands: z.array(brandSchema).max(listMax),
  deals: z.array(dealSchema).max(listMax),
  mateRun: mateRunSchema.nullable(),
  conflicts: z.array(editConflictSchema).max(conflictsMax),
  notify: notifySettingsSchema,
  seesMoney: z.boolean(),
  reach: reachDataSchema,
});

/** One change the app writes, told apart by `kind`. */
export const dataWriteSchema: z.ZodType<DataWrite> = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("notification.read"), id, read: z.boolean() }),
  z.strictObject({ kind: z.literal("notify.set"), notify: notifySettingsSchema }),
  z.strictObject({ kind: z.literal("me.name"), name: z.string().max(nameMax) }),
  z.strictObject({ kind: z.literal("log.add"), id, at: time, text, ...logRef }),
  z.strictObject({ kind: z.literal("log.remove"), id }),
  z.strictObject({
    kind: z.literal("creator.stage"),
    id,
    stage: z.enum(creatorStages),
    handle: text,
    name: text,
    reason: z.exactOptional(z.enum(rejectReasons)),
  }),
  z.strictObject({
    kind: z.literal("creator.notes"),
    id,
    base: z.string().max(notesMax),
    notes: z.string().max(notesMax),
    handle: text,
    name: text,
  }),
  z
    .strictObject({
      kind: z.literal("creator.contact"),
      id,
      email: z.string().min(1).max(storedEmailMax).nullable(),
      confirmed: z.boolean(),
      contactName: contactName.nullable(),
      source: z.enum(contactSources).nullable(),
      confidence: confidenceSchema.nullable(),
      handle: text,
      name: text,
    })
    // A confirmed address must look like one. An unconfirmed one may be whatever the old app
    // stored ("a@x.com,b@y.com", "hello@x"): undoing a confirm writes it back as it was.
    .refine(
      (write) =>
        !write.confirmed ||
        write.email === null ||
        emailAddressSchema.safeParse(write.email).success,
      { path: ["email"], message: "A confirmed address must be an email address." },
    ),
  z.strictObject({
    kind: z.literal("brand.set"),
    id,
    name: z.string().min(1).max(textMax),
    sells: z.string().max(500),
    status: z.string().max(40),
  }),
  z.strictObject({
    kind: z.literal("deal.step"),
    id,
    step: z
      .number()
      .int()
      .min(0)
      .max(DEAL_FLOW.length - 1),
  }),
  z.strictObject({ kind: z.literal("conflict.resolve"), id, choice: z.enum(["mine", "theirs"]) }),
  z
    .strictObject({
      kind: z.literal("draft.state"),
      id,
      state: z.enum(personDraftStates),
      sendAt: time.nullable(),
    })
    // Send and Send later say when; Undo, Cancel and Skip don't.
    .refine(
      (write) =>
        (write.state === "approved" || write.state === "scheduled") === (write.sendAt !== null),
      { path: ["sendAt"], message: "Only an approved or scheduled draft has a send time." },
    ),
  z.strictObject({
    kind: z.literal("draft.text"),
    id,
    subject: z.string().max(draftSubjectMax),
    body: z.string().max(draftBodyMax),
  }),
  z.strictObject({
    kind: z.literal("draft.mailbox"),
    id,
    mailbox: emailAddressSchema.nullable(),
  }),
  z.strictObject({ kind: z.literal("draft.gate"), id, gate: id, ok: z.boolean() }),
  z.strictObject({ kind: z.literal("reply.fact"), messageId: id, key: z.enum(replyFactKeys) }),
]);
