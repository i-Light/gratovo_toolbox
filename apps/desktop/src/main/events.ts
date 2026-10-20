/**
 * Main-to-page events (plan D15). One Electron channel, `gratovo:event`, carries `(name, payload)`.
 * Every payload is checked against its schema in `@gratovo/ipc` before it goes out, and it goes
 * only to windows showing the app's own page: never to a destroyed window or a foreign page. A bad
 * payload is dropped and logged by its event name alone, never by its content.
 */

import { appEvents, eventChannel } from "@gratovo/ipc";
import type { AppEventName, AppEventPayload } from "@gratovo/ipc";

import { isAppPage } from "./app-page";

/** Sends one main-to-page event. */
export type EventSender = <E extends AppEventName>(event: E, payload: AppEventPayload<E>) => void;

/** The part of Electron's WebContents the sender uses. */
export interface WebContentsLike {
  isDestroyed(): boolean;
  getURL(): string;
  send(channel: string, ...args: unknown[]): void;
}

const knownEvents: readonly string[] = Object.keys(appEvents);

export function createEventSender(o: {
  /** The windows to consider (index.ts: `BrowserWindow.getAllWindows()`). */
  targets: () => readonly { readonly webContents: WebContentsLike }[];
  /** The app's page; a window showing anything else gets nothing. */
  pageUrl: string;
  log: (line: string) => void;
}): EventSender {
  return (event, payload) => {
    if (!knownEvents.includes(event)) {
      o.log("Events: dropped an unknown event.");
      return;
    }
    const parsed = appEvents[event].safeParse(payload);
    if (!parsed.success) {
      o.log(`Events: dropped a bad "${event}" payload.`);
      return;
    }
    for (const { webContents } of o.targets()) {
      try {
        if (webContents.isDestroyed() || !isAppPage(webContents.getURL(), o.pageUrl)) {
          continue;
        }
        webContents.send(eventChannel, event, parsed.data);
      } catch {
        // A window closing as the event goes out: the next event reaches the windows still open.
        o.log(`Events: "${event}" couldn't be sent to a window.`);
      }
    }
  };
}
