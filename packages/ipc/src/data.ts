import { DEAL_FLOW } from "@gratovo/core";
import {
  agencyRoles,
  creatorStages,
  frameSources,
  nameMax,
  notificationIcons,
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

const id = z.string().min(1).max(idMax);
const text = z.string().max(textMax);
const time = z.number();
const count = z.number().int().nonnegative();

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

export const logEntrySchema: z.ZodType<LogEntry> = z.strictObject({
  id,
  at: time,
  who: text,
  text,
});

export const creatorSchema: z.ZodType<Creator> = z.strictObject({
  id,
  name: text,
  handle: text,
  stage: z.enum(creatorStages),
  email: text.nullable(),
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
});

/** One change the app writes, told apart by `kind`. */
export const dataWriteSchema: z.ZodType<DataWrite> = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("notification.read"), id, read: z.boolean() }),
  z.strictObject({ kind: z.literal("notify.set"), notify: notifySettingsSchema }),
  z.strictObject({ kind: z.literal("me.name"), name: z.string().max(nameMax) }),
  z.strictObject({ kind: z.literal("log.add"), id, at: time, text }),
  z.strictObject({ kind: z.literal("log.remove"), id }),
  z.strictObject({ kind: z.literal("creator.stage"), id, stage: z.enum(creatorStages) }),
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
]);
