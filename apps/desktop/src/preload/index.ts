import { contextBridge, ipcRenderer } from "electron";

import type { Channel, ChannelRequest } from "@gratovo/ipc";
import { bridgeChannel, bridgeGlobal, type Bridge, type InvokeResult } from "@gratovo/ipc/bridge";

// The page gets one function. ipcRenderer itself never crosses into the page, so the page can't
// listen on or send to any other IPC channel; the main process checks every call it makes.
const bridge: Bridge = {
  invoke<C extends Channel>(channel: C, input: ChannelRequest<C>) {
    return ipcRenderer.invoke(bridgeChannel, channel, input) as Promise<InvokeResult<C>>;
  },
};

contextBridge.exposeInMainWorld(bridgeGlobal, bridge);
