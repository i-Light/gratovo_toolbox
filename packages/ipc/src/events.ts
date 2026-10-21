import { z } from "zod";

import { findStateSchema } from "./find";
import { presenceMembersSchema } from "./presence";
import { syncStatusSchema } from "./sync";

/** The parts of the frame a pull or a teammate's change can touch. */
export const frameParts = [
  "team",
  "me",
  "creators",
  "brands",
  "deals",
  "log",
  "notify",
  "conflicts",
] as const;
export type FramePart = (typeof frameParts)[number];

/**
 * What main tells the page without being asked. Main checks each payload against its schema
 * before sending; the page's `on` hands the payload to the listener.
 */
export const appEvents = {
  "frame:changed": z.strictObject({
    parts: z.array(z.enum(frameParts)).min(1).max(frameParts.length),
  }),
  "sync:status": syncStatusSchema,
  "presence:changed": presenceMembersSchema,
  "find:changed": findStateSchema,
} as const;

export type AppEventName = keyof typeof appEvents;
export type AppEventPayload<E extends AppEventName> = z.output<(typeof appEvents)[E]>;
