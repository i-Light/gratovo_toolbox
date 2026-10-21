// @vitest-environment happy-dom
import type { Bridge } from "@gratovo/ipc/bridge";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installPresenceReporting, idleAfterMs } from "./presence";
import type { Route } from "./routes";
import { go, resetAppStoreForTests } from "./store";

const today: Route = { screen: "today", tab: null };
let stop: (() => void) | null = null;
let sent: { screen: string; idle: boolean }[] = [];
let visibility: DocumentVisibilityState = "visible";

function install(): void {
  sent = [];
  const invoke = (channel: string, input: unknown): Promise<unknown> => {
    if (channel === "presence:set") {
      sent.push(input as { screen: string; idle: boolean });
    }
    return Promise.resolve({ ok: true, value: {} });
  };
  stop = installPresenceReporting(invoke as unknown as Bridge["invoke"]);
}

beforeEach(() => {
  vi.useFakeTimers();
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  resetAppStoreForTests(today);
  install();
});

afterEach(() => {
  stop?.();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("installPresenceReporting", () => {
  it("sends the screen once at the start, then only changes", () => {
    expect(sent).toEqual([{ screen: "today", idle: false }]);
    go("reach");
    expect(sent).toEqual([
      { screen: "today", idle: false },
      { screen: "reach", idle: false },
    ]);
    go("reach");
    document.dispatchEvent(new Event("pointerdown"));
    expect(sent).toHaveLength(2);
  });

  it("goes idle after five minutes and back on input", () => {
    vi.advanceTimersByTime(idleAfterMs - 1);
    expect(sent).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sent.at(-1)).toEqual({ screen: "today", idle: true });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(sent.at(-1)).toEqual({ screen: "today", idle: false });
    expect(sent).toHaveLength(3);
  });

  it("input keeps the person from going idle", () => {
    vi.advanceTimersByTime(idleAfterMs - 1000);
    document.dispatchEvent(new Event("pointerdown"));
    vi.advanceTimersByTime(idleAfterMs - 1000);
    expect(sent).toHaveLength(1);
  });

  it("counts a hidden window as idle and a shown one as back", () => {
    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(sent.at(-1)).toEqual({ screen: "today", idle: true });
    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(sent.at(-1)).toEqual({ screen: "today", idle: false });
    expect(sent).toHaveLength(3);
  });

  it("sends nothing after it is stopped", () => {
    stop?.();
    go("find");
    vi.advanceTimersByTime(idleAfterMs * 2);
    expect(sent).toHaveLength(1);
  });
});
