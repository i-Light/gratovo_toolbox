import { eventChannel, type AppEventPayload } from "@gratovo/ipc";
import { describe, expect, it } from "vitest";

import { createEventSender, type WebContentsLike } from "./events";

const pageUrl = "app://gratovo/index.html";

function window(url: string, destroyed = false) {
  const sent: unknown[][] = [];
  const webContents: WebContentsLike = {
    isDestroyed: () => destroyed,
    getURL: () => url,
    send: (...args: unknown[]) => {
      sent.push(args);
    },
  };
  return { webContents, sent };
}

function setup(windows: { webContents: WebContentsLike }[]) {
  const logs: string[] = [];
  const emit = createEventSender({
    targets: () => windows,
    pageUrl,
    log: (line) => logs.push(line),
  });
  return { emit, logs };
}

const status: AppEventPayload<"sync:status"> = {
  state: "synced",
  pending: 0,
  refused: 0,
  lastSyncedAt: 1_000,
};

describe("createEventSender", () => {
  it("sends a valid event to the app's page, whatever its route", () => {
    const app = window(`${pageUrl}#/reach`);
    const { emit, logs } = setup([app]);

    emit("frame:changed", { parts: ["creators", "log"] });
    emit("sync:status", status);

    expect(app.sent).toEqual([
      [eventChannel, "frame:changed", { parts: ["creators", "log"] }],
      [eventChannel, "sync:status", status],
    ]);
    expect(logs).toEqual([]);
  });

  it("sends nothing to a foreign page or a destroyed window", () => {
    const foreign = window("https://example.com/index.html");
    const lookalike = window("app://gratovo.evil/index.html");
    const gone = window(pageUrl, true);
    const app = window(pageUrl);
    const { emit } = setup([foreign, lookalike, gone, app]);

    emit("presence:changed", { members: [{ id: "u1", status: "online", doing: "Reach" }] });

    expect(foreign.sent).toEqual([]);
    expect(lookalike.sent).toEqual([]);
    expect(gone.sent).toEqual([]);
    expect(app.sent).toHaveLength(1);
  });

  it("drops a bad payload and logs only the event name", () => {
    const app = window(pageUrl);
    const { emit, logs } = setup([app]);
    const send = emit as (event: string, payload: unknown) => void;

    send("sync:status", { ...status, pending: -1, secret: "tok-000" });
    send("frame:changed", { parts: [] });
    send("frame:changed", { parts: ["passwords"] });
    send("not:an-event", { text: "tok-000" });

    expect(app.sent).toEqual([]);
    expect(logs).toEqual([
      'Events: dropped a bad "sync:status" payload.',
      'Events: dropped a bad "frame:changed" payload.',
      'Events: dropped a bad "frame:changed" payload.',
      "Events: dropped an unknown event.",
    ]);
    expect(logs.join("\n")).not.toContain("tok-000");
  });

  it("keeps sending to the other windows when one throws", () => {
    const broken: WebContentsLike = {
      isDestroyed: () => false,
      getURL: () => pageUrl,
      send: () => {
        throw new Error("Object has been destroyed");
      },
    };
    const app = window(pageUrl);
    const { emit, logs } = setup([{ webContents: broken }, app]);

    emit("sync:status", status);

    expect(app.sent).toHaveLength(1);
    expect(logs).toEqual(['Events: "sync:status" couldn\'t be sent to a window.']);
  });
});
