import type { Channel, ChannelRequest, ChannelResponse } from "./channels";
import type { AppEventName, AppEventPayload } from "./events";

// Only types come from channels.ts, so the preload script can import this file without bundling
// zod: the sandboxed preload stays a few lines long.

/** The one Electron IPC channel the bridge uses. Each call names an app channel from `channels`. */
export const bridgeChannel = "gratovo:invoke";

/** The one Electron IPC channel main uses to tell the page something. Each message is `(name, payload)`. */
export const eventChannel = "gratovo:event";

/** The event names the page may listen for. A test keeps this equal to the keys of `appEvents`. */
export const appEventNames = [
  "frame:changed",
  "sync:status",
  "presence:changed",
  "find:changed",
  "find:catalog",
  "find:emails",
  "import:progress",
  "gemini:state",
  "connections:changed",
] as const;

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
  /** Listens for one event from main. Returns the function that stops listening. */
  readonly on: <E extends AppEventName>(
    event: E,
    listener: (payload: AppEventPayload<E>) => void,
  ) => () => void;
}
