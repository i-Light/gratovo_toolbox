import type { Bridge } from "@gratovo/ipc/bridge";

declare global {
  interface Window {
    /** The typed IPC bridge from the preload script: the page's only way to the main process. */
    readonly gratovo: Bridge;
  }
}
