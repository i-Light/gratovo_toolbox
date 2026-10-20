import { z } from "zod";

import { authStatusSchema, signInRequestSchema, signInResultSchema } from "./auth";
import { dataWriteSchema, frameSchema } from "./data";
import { presenceSetSchema } from "./presence";
import { syncStatusSchema } from "./sync";

/**
 * A secret's name: lowercase words joined by dots or hyphens, such as "gemini.api-key" or
 * "gmail.token.mailbox-1". Names are not secret; values never cross the bridge.
 */
export const secretName = z
  .string()
  .max(100)
  .regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/, "Use lowercase words joined by dots or hyphens");

/**
 * Every IPC channel the renderer may call, with the schema of its request and of its response.
 * The main process checks each call against this map, so a channel that is not here does not
 * exist. Names follow `domain:verb`.
 */
export const channels = {
  /** Checks that the bridge is up, and reports the app's version. */
  "app:ping": {
    request: z.strictObject({}),
    response: z.strictObject({
      ok: z.literal(true),
      version: z.string().min(1),
    }),
  },
  /** Whether a secret is set. The page can ask this; no channel ever returns a secret's value. */
  "secrets:status": {
    request: z.strictObject({ name: secretName }),
    response: z.strictObject({ set: z.boolean() }),
  },
  /** Everything the frame shows, in one read. */
  "frame:load": {
    request: z.strictObject({}),
    response: frameSchema,
  },
  /** Saves a batch of changes, in order, all or none. */
  "data:write": {
    request: z.strictObject({ writes: z.array(dataWriteSchema).min(1).max(100) }),
    response: z.strictObject({}),
  },
  /** Where the account stands, and its own email. The page asks this first. */
  "auth:status": {
    request: z.strictObject({}),
    response: authStatusSchema,
  },
  /** Signs in with email and password. The password is used once and never stored or echoed. */
  "auth:sign-in": {
    request: signInRequestSchema,
    response: signInResultSchema,
  },
  /** The waiting screen's "Check again": asks the server for the access and the team again. */
  "auth:recheck": {
    request: z.strictObject({}),
    response: authStatusSchema,
  },
  /** Signs out, deletes this computer's copy of the team's data, then reloads the window. */
  "auth:sign-out": {
    request: z.strictObject({}),
    response: z.strictObject({}),
  },
  /** How the sync stands right now. */
  "sync:status": {
    request: z.strictObject({}),
    response: syncStatusSchema,
  },
  /** Runs one sync pass now (or waits for the running one) and answers with the status. */
  "sync:now": {
    request: z.strictObject({}),
    response: syncStatusSchema,
  },
  /** Tells teammates which screen this person is on, and whether they are idle. */
  "presence:set": {
    request: presenceSetSchema,
    response: z.strictObject({}),
  },
} as const;

export type Channel = keyof typeof channels;
export type ChannelRequest<C extends Channel> = z.input<(typeof channels)[C]["request"]>;
export type ChannelResponse<C extends Channel> = z.output<(typeof channels)[C]["response"]>;
/** A request after its schema has parsed it: what a handler in the main process receives. */
export type ChannelInput<C extends Channel> = z.output<(typeof channels)[C]["request"]>;

export type ParsedRequest =
  | { [C in Channel]: { ok: true; channel: C; value: ChannelInput<C> } }[Channel]
  | { ok: false; reason: string };

export function isChannel(name: string): name is Channel {
  return Object.hasOwn(channels, name);
}

/** Checks a call from the renderer: the channel must exist and the input must match its schema. */
export function parseRequest(channel: string, input: unknown): ParsedRequest {
  if (!isChannel(channel)) {
    return { ok: false, reason: `Unknown channel "${channel}"` };
  }
  const result = channels[channel].request.safeParse(input);
  if (!result.success) {
    return { ok: false, reason: z.prettifyError(result.error) };
  }
  // TypeScript can't tie the schema chosen by `channel` to that channel's input type, but the
  // value was parsed by exactly that schema.
  return { ok: true, channel, value: result.data } as ParsedRequest;
}
