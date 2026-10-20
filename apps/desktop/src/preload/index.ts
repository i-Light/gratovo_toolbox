import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

import type { Channel, ChannelRequest } from "@gratovo/ipc";
import {
  appEventNames,
  bridgeChannel,
  bridgeGlobal,
  eventChannel,
  type Bridge,
  type InvokeResult,
} from "@gratovo/ipc/bridge";

// The page gets two functions. ipcRenderer itself never crosses into the page, so the page can't
// listen on or send to any other IPC channel; the main process checks every call it makes.
const bridge: Bridge = {
  invoke<C extends Channel>(channel: C, input: ChannelRequest<C>) {
    return ipcRenderer.invoke(bridgeChannel, channel, input) as Promise<InvokeResult<C>>;
  },
  on(event, listener) {
    const known: readonly string[] = appEventNames;
    if (!known.includes(event)) return () => undefined;
    // One handler per call, so the unsubscribe removes exactly this one. The listener gets the
    // payload only, never the Electron event.
    const handler = (_event: IpcRendererEvent, name: unknown, payload: unknown): void => {
      if (name === event) listener(payload as Parameters<typeof listener>[0]);
    };
    ipcRenderer.on(eventChannel, handler);
    return () => {
      ipcRenderer.removeListener(eventChannel, handler);
    };
  },
};

contextBridge.exposeInMainWorld(bridgeGlobal, bridge);
