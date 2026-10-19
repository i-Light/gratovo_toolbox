import { ipcMain } from "electron";

import { bridgeChannel, createDispatcher, type Handlers } from "@gratovo/ipc";

import { isTrustedSender } from "./app-page";
import { appPageUrl } from "./window";

/**
 * Answers the page's bridge calls on the one IPC channel the app listens to. A call from anywhere
 * but the app page's top frame is refused before its request is even read.
 */
export function registerBridge(handlers: Handlers): void {
  const dispatch = createDispatcher(handlers, (channel, error) => {
    // The channel and the error only: requests can carry personal details, so they aren't logged.
    console.error(`The handler for "${channel}" failed:`, error);
  });

  ipcMain.handle(bridgeChannel, (event, channel: unknown, input: unknown) => {
    if (!isTrustedSender(event.senderFrame, appPageUrl)) {
      return { ok: false, reason: "Refused: the call didn't come from the app's page" };
    }
    return dispatch(channel, input);
  });
}
