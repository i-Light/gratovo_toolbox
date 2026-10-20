// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appStore, resetAppStoreForTests } from "../lib/store";
import { strings } from "../strings";
import { TopBar } from "./top-bar";

beforeEach(() => {
  resetAppStoreForTests({ screen: "today", tab: null });
});
afterEach(cleanup);

function setSync(sync: { state: string; pending: number; refused: number }): void {
  act(() => {
    appStore().ui((draft) => {
      draft.sync = { ...sync, lastSyncedAt: null } as typeof draft.sync;
    });
  });
}

const chip = (): HTMLElement => screen.getByRole("status");
/** The visible label (the unseen sizer is left out). */
const label = (): string => chip().querySelector("span > span > span")?.textContent ?? "";

describe("the sync chip in the top bar", () => {
  it("says Saved while synced", () => {
    render(<TopBar />);
    setSync({ state: "synced", pending: 0, refused: 0 });
    expect(label()).toBe(strings.top.saved);
  });

  it("says Not synced with the waiting tip when offline with changes waiting", () => {
    render(<TopBar />);
    setSync({ state: "offline", pending: 3, refused: 0 });
    expect(label()).toBe(strings.top.notSynced);
    expect(chip().getAttribute("data-tip")).toBe(strings.top.notSyncedOfflineTip(3));
  });

  it("says Not synced with the stuck tip when a change keeps failing", () => {
    render(<TopBar />);
    setSync({ state: "stuck", pending: 1, refused: 0 });
    expect(chip().getAttribute("data-tip")).toBe(strings.top.notSyncedStuckTip);
  });

  it("stays Saved when offline with nothing waiting", () => {
    render(<TopBar />);
    setSync({ state: "offline", pending: 0, refused: 0 });
    expect(label()).toBe(strings.top.saved);
  });

  it("lets the local states win", () => {
    render(<TopBar />);
    setSync({ state: "offline", pending: 2, refused: 0 });
    act(() => {
      appStore().ui((draft) => {
        draft.saveFailed = true;
      });
    });
    expect(label()).toBe(strings.top.notSaved);
  });

  it("shows a toast each time the refused count grows, not at start or when it falls", () => {
    render(<TopBar />);
    const toasts = (): number => appStore().getState().ui.toasts.length;
    expect(toasts()).toBe(0);
    setSync({ state: "synced", pending: 0, refused: 1 });
    expect(toasts()).toBe(1);
    expect(appStore().getState().ui.toasts[0]?.msg).toBe(strings.top.refusedToast);
    setSync({ state: "synced", pending: 0, refused: 1 });
    expect(toasts()).toBe(1);
    setSync({ state: "synced", pending: 0, refused: 0 });
    expect(toasts()).toBe(1);
  });
});
