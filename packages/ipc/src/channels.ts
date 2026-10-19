import { z } from "zod";

/**
 * Every IPC channel the renderer may call, with the schema of its request and of its response.
 * The main process checks each call against this map, so a channel that is not here does not
 * exist. Names follow `domain:verb`. Step 3b wires the bridge that uses it.
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
} as const;

export type Channel = keyof typeof channels;
export type ChannelRequest<C extends Channel> = z.input<(typeof channels)[C]["request"]>;
export type ChannelResponse<C extends Channel> = z.output<(typeof channels)[C]["response"]>;

export type ParsedRequest =
  | { [C in Channel]: { ok: true; channel: C; value: ChannelRequest<C> } }[Channel]
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
  return { ok: true, channel, value: result.data };
}
