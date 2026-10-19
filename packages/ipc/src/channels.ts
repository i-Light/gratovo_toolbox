import { z } from "zod";

/**
 * Every IPC channel is declared here, with a schema for its input and its output.
 * The main process validates each call against these schemas (step 3b adds the rest of the bridge).
 */
export const channelSchemas = {
  "app:ping": {
    input: z.strictObject({}),
    output: z.object({ ok: z.literal(true), version: z.string().min(1) }),
  },
} as const;

export type ChannelName = keyof typeof channelSchemas;
export type ChannelInput<C extends ChannelName> = z.infer<(typeof channelSchemas)[C]["input"]>;
export type ChannelOutput<C extends ChannelName> = z.infer<(typeof channelSchemas)[C]["output"]>;

export function isChannelName(name: string): name is ChannelName {
  return Object.prototype.hasOwnProperty.call(channelSchemas, name);
}

/** Parse untrusted input for a channel. Throws a ZodError when the input does not match. */
export function parseChannelInput<C extends ChannelName>(
  channel: C,
  input: unknown,
): ChannelInput<C> {
  return channelSchemas[channel].input.parse(input) as ChannelInput<C>;
}
