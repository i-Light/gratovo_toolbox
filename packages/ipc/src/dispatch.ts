import { z } from "zod";

import type { InvokeResult } from "./bridge";
import {
  channels,
  parseRequest,
  type Channel,
  type ChannelInput,
  type ChannelResponse,
} from "./channels";

/** One handler per channel. Adding a channel to `channels` makes this type ask for its handler. */
export type Handlers = {
  [C in Channel]: (input: ChannelInput<C>) => ChannelResponse<C> | Promise<ChannelResponse<C>>;
};

/** Called with what went wrong inside the main process. The page only learns that the call failed. */
export type DispatchErrorReporter = (channel: Channel, error: unknown) => void;

const failed = { ok: false, reason: "The call failed" } as const;

function run<C extends Channel>(
  handlers: Handlers,
  channel: C,
  input: ChannelInput<C>,
): ChannelResponse<C> | Promise<ChannelResponse<C>> {
  const handler: Handlers[C] = handlers[channel];
  return handler(input);
}

/**
 * Builds the main process's side of the bridge. Every call is checked twice: the request against
 * its channel's schema before the handler runs, and the handler's response against the response
 * schema before it goes back, so a handler can't leak a field the contract doesn't declare.
 */
export function createDispatcher(
  handlers: Handlers,
  onError: DispatchErrorReporter,
): (channel: unknown, input: unknown) => Promise<InvokeResult<Channel>> {
  return async (channel, input) => {
    if (typeof channel !== "string") {
      return { ok: false, reason: "The channel must be a name" };
    }
    const request = parseRequest(channel, input);
    if (!request.ok) {
      return request;
    }

    let value: unknown;
    try {
      value = await run(handlers, request.channel, request.value);
    } catch (error) {
      onError(request.channel, error);
      return failed;
    }

    const response = channels[request.channel].response.safeParse(value);
    if (!response.success) {
      onError(request.channel, new Error(z.prettifyError(response.error)));
      return failed;
    }
    return { ok: true, value: response.data };
  };
}
