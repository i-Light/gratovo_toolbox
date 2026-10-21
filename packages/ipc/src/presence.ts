import { z } from "zod";

import { idMax, textMax } from "./data";

/** The screens a member can be on, as the rail and Team show them. */
export const presenceScreens = [
  "today",
  "find",
  "reach",
  "close",
  "deliver",
  "insights",
  "toolbox",
  "team",
  "settings",
  "record",
] as const;
export type PresenceScreen = (typeof presenceScreens)[number];

/** What the page tells main: the screen it is on, and whether the person is idle. */
export const presenceSetSchema = z.strictObject({
  screen: z.enum(presenceScreens),
  idle: z.boolean(),
});

/** Who is online, sent from main to the page. */
export const presenceMembersSchema = z.strictObject({
  members: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(idMax),
        status: z.enum(["online", "away"]),
        doing: z.string().max(textMax),
      }),
    )
    .max(50),
});
