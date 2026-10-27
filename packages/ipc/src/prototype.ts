import { z } from "zod";

/**
 * The schemas of prototype mode and the comment tool (ADR 0004, step 7). Prototype mode is the
 * real app on an example copy, owner only and off by default; the comments are the owner's notes
 * pinned to parts of the app, kept on this computer and exported for Claude on demand.
 */

/** The example copies prototype mode can start from. The same list as core's `scenarios`. */
export const scenarioKeys = ["normal", "first", "later", "broke"] as const;
export type ScenarioKey = (typeof scenarioKeys)[number];
export const scenarioSchema = z.enum(scenarioKeys);

/** What `prototype:status`, `prototype:set` and `prototype:scenario` answer. */
export interface PrototypeStatus {
  /** The switch may be shown: the person is the owner, or prototype mode is on. */
  readonly available: boolean;
  readonly on: boolean;
  readonly scenario: ScenarioKey;
}

export const prototypeStatusSchema: z.ZodType<PrototypeStatus> = z.strictObject({
  available: z.boolean(),
  on: z.boolean(),
  scenario: scenarioSchema,
});

export const prototypeSetRequestSchema = z.strictObject({ on: z.boolean() });
export const prototypeScenarioRequestSchema = z.strictObject({ scenario: scenarioSchema });

export const commentKinds = ["fix", "idea", "question"] as const;
export type CommentKind = (typeof commentKinds)[number];
export const commentStatuses = ["open", "done"] as const;
export type CommentStatus = (typeof commentStatuses)[number];

/** The most comments kept; an add or restore past it is refused. */
export const commentsMax = 2000;
/** The longest comment text. */
export const commentTextMax = 4000;

/** A record or peek a comment was left on. */
export interface CommentRef {
  readonly kind: string;
  readonly id: string;
}

/** Where a comment was left: a screen, tab, record and peek, or everywhere (the rail, the top bar). */
export interface CommentPlace {
  readonly global: boolean;
  readonly screen: string | null;
  readonly tab: string | null;
  readonly record: CommentRef | null;
  readonly peek: CommentRef | null;
}

/**
 * The spot a comment is pinned to. `ui` is the nearest `data-ui` id, `path` the `:nth-of-type`
 * path from it to the element, `text` the element's first 60 characters, `rx` and `ry` where in
 * the element it was clicked (0 to 1).
 */
export interface CommentAnchor {
  readonly ui: string | null;
  readonly path: string;
  readonly tag: string;
  readonly text: string;
  readonly label: string;
  readonly rx: number;
  readonly ry: number;
}

export interface Comment {
  readonly id: string;
  /** When it was written, in ms. */
  readonly at: number;
  readonly status: CommentStatus;
  readonly doneAt: number | null;
  readonly kind: CommentKind;
  readonly text: string;
  /** The scenario on screen when it was written. */
  readonly scenario: ScenarioKey;
  readonly place: CommentPlace;
  readonly anchor: CommentAnchor;
}

const key = z.string().min(1).max(40);
const refSchema: z.ZodType<CommentRef> = z.strictObject({
  kind: z.string().min(1).max(20),
  id: z.string().min(1).max(200),
});
const textSchema = z.string().trim().min(1).max(commentTextMax);
const msSchema = z.number().int().nonnegative();
const unit = z.number().min(0).max(1);

export const commentIdSchema = z.string().regex(/^c[a-z0-9]{6,24}$/);

export const commentPlaceSchema: z.ZodType<CommentPlace> = z.strictObject({
  global: z.boolean(),
  screen: key.nullable(),
  tab: key.nullable(),
  record: refSchema.nullable(),
  peek: refSchema.nullable(),
});

export const commentAnchorSchema: z.ZodType<CommentAnchor> = z.strictObject({
  ui: z
    .string()
    .regex(/^[a-z0-9.-]{1,120}$/)
    .nullable(),
  path: z.string().max(1000),
  tag: z.string().regex(/^[a-z][a-z0-9]{0,19}$/),
  text: z.string().max(60),
  label: z.string().min(1).max(200),
  rx: unit,
  ry: unit,
});

export const commentSchema: z.ZodType<Comment> = z.strictObject({
  id: commentIdSchema,
  at: msSchema,
  status: z.enum(commentStatuses),
  doneAt: msSchema.nullable(),
  kind: z.enum(commentKinds),
  text: textSchema,
  scenario: scenarioSchema,
  place: commentPlaceSchema,
  anchor: commentAnchorSchema,
});

/** A new comment: main adds the id, the time, the open status and the current scenario. */
export type CommentNew = Pick<Comment, "kind" | "text" | "place" | "anchor">;
export const commentNewSchema: z.ZodType<CommentNew> = z.strictObject({
  kind: z.enum(commentKinds),
  text: textSchema,
  place: commentPlaceSchema,
  anchor: commentAnchorSchema,
});

/** A change to a comment: its text, or done and open again. */
export interface CommentPatch {
  readonly id: string;
  readonly text?: string | undefined;
  readonly status?: CommentStatus | undefined;
}
export const commentPatchSchema: z.ZodType<CommentPatch> = z.strictObject({
  id: commentIdSchema,
  text: textSchema.optional(),
  status: z.enum(commentStatuses).optional(),
});

export const commentIdRequestSchema = z.strictObject({ id: commentIdSchema });
export const commentRestoreRequestSchema = z.strictObject({ comment: commentSchema });
export const commentListSchema = z.strictObject({
  comments: z.array(commentSchema).max(commentsMax),
});
export const commentDeleteResultSchema = z.strictObject({ comment: commentSchema.nullable() });

/** Where the export goes, from the repository's root. */
export const commentsExportPath = "docs/feedback/comments.json";

export type CommentsExportResult =
  | { readonly ok: true; readonly path: typeof commentsExportPath; readonly count: number }
  | { readonly ok: false; readonly problem: "no_repo" | "failed" };

export const commentsExportResultSchema: z.ZodType<CommentsExportResult> = z.discriminatedUnion(
  "ok",
  [
    z.strictObject({
      ok: z.literal(true),
      path: z.literal(commentsExportPath),
      count: z.number().int().nonnegative(),
    }),
    z.strictObject({ ok: z.literal(false), problem: z.enum(["no_repo", "failed"]) }),
  ],
);
