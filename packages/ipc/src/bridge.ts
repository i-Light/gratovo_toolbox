import type { Channel, ChannelRequest, ChannelResponse } from "./channels";

// Only types come from channels.ts, so the preload script can import this file without bundling
// zod: the sandboxed preload stays a few lines long.

/** The one Electron IPC channel the bridge uses. Each call names an app channel from `channels`. */
export const bridgeChannel = "gratovo:invoke";

/** The name the preload script gives the bridge on the page's `window`. */
export const bridgeGlobal = "gratovo";

/** What every call resolves to. A refused or failed call is a value, never a thrown error. */
export type InvokeResult<C extends Channel> =
  { ok: true; value: ChannelResponse<C> } | { ok: false; reason: string };

/** The page's only way to reach the main process. */
export interface Bridge {
  // A property, not a method: contextBridge hands the page a bare function with no `this`.
  readonly invoke: <C extends Channel>(
    channel: C,
    input: ChannelRequest<C>,
  ) => Promise<InvokeResult<C>>;
}
