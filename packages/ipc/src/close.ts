import { signingStages } from "@gratovo/core/close";
import { creatorStages } from "@gratovo/core/data";
import { z } from "zod";

import { sequenceRestoreMax } from "./reach";

/** The schemas of the Close channels (step 8, part 1): Decline kindly and Ask for what's missing. */

const id = z.string().min(1).max(100);
const stage = z.enum(creatorStages);
const signingStage = z.enum(signingStages as [string, ...string[]]);
const refused = (problems: readonly [string, ...string[]]) =>
  z.strictObject({ ok: z.literal(false), problem: z.enum(problems) });

/** `close:decline`, `close:ask`: one creator. */
export const closeCreatorRequestSchema = z.strictObject({ creatorId: id });

/** `close:decline`: the stage it was in, and the drafts it skipped, for the Undo. */
export const closeDeclineResultSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    draftId: id.nullable(),
    before: stage,
    skipped: z.array(id).max(sequenceRestoreMax),
  }),
  refused(["no_data", "not_found", "wrong_state"]),
]);

/** `close:decline-undo`: puts the stage back, skips the decline draft, brings back the skipped. */
export const closeDeclineUndoRequestSchema = z.strictObject({
  creatorId: id,
  draftId: id.nullable(),
  before: signingStage,
  skipped: z.array(id).max(sequenceRestoreMax),
});
export const closeDeclineUndoResultSchema = z.union([
  // `kept`: the decline draft was already sending or sent, so the Undo could not stop it.
  z.strictObject({ ok: z.literal(true), kept: z.enum(["sending", "sent"]).nullable() }),
  refused(["no_data", "not_found", "wrong_state"]),
]);

/** `close:ask`: the draft that asks for what is missing. */
export const closeAskResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), draftId: id }),
  refused(["no_data", "not_found", "wrong_state", "draft_open", "nothing_missing", "no_thread"]),
]);
