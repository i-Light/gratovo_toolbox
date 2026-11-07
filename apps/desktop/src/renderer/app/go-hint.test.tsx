// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { exampleData } from "../lib/example-data";
import { appStore, initAppStore, selectRoute } from "../lib/store";
import { goLetters, screens } from "../lib/routes";
import { isScreenShown } from "../lib/wired";
import { useGlobalKeys, useKeyListener } from "./global-keys";
import { GoHint } from "./go-hint";

function Keys() {
  useGlobalKeys();
  useKeyListener();
  return null;
}

const bar = () => document.querySelector("[data-ui='frame.go-hint']");

function mount(source: "example" | "live"): void {
  initAppStore({ ...exampleData(Date.now()), source }, { screen: "find", tab: "search" });
  render(
    <>
      <Keys />
      <GoHint />
    </>,
  );
}

describe("GoHint", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows after G with only the screens shown to this person", () => {
    mount("live");
    expect(bar()).toBeNull();
    fireEvent.keyDown(document.body, { key: "g" });
    const el = bar();
    if (el === null) {
      throw new Error("no bar");
    }
    expect(el.getAttribute("data-ui")).toBe("frame.go-hint");
    for (const [letter, name] of Object.entries(goLetters)) {
      const shown = isScreenShown(name, "live");
      expect(el.textContent.includes(screens[name].name)).toBe(shown);
      expect(letter.length).toBe(1);
    }
  });

  it("hides when a letter jumps", () => {
    mount("example");
    fireEvent.keyDown(document.body, { key: "g" });
    expect(bar()).not.toBeNull();
    fireEvent.keyDown(document.body, { key: "r" });
    expect(bar()).toBeNull();
    expect(selectRoute(appStore().getState()).screen).toBe("reach");
  });

  it("hides on Escape", () => {
    mount("example");
    fireEvent.keyDown(document.body, { key: "g" });
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(bar()).toBeNull();
  });

  it("keeps a live region mounted and fills it while armed", () => {
    mount("example");
    const live = screen.getByRole("status");
    expect(live.textContent).toBe("");
    fireEvent.keyDown(document.body, { key: "g" });
    expect(live.textContent).not.toBe("");
  });

  it("Escape also disarms the prefix, so the next letter does not jump", () => {
    mount("example");
    fireEvent.keyDown(document.body, { key: "g" });
    fireEvent.keyDown(document.body, { key: "Escape" });
    fireEvent.keyDown(document.body, { key: "r" });
    expect(selectRoute(appStore().getState()).screen).toBe("find");
  });

  it("hides after the timeout", () => {
    mount("example");
    fireEvent.keyDown(document.body, { key: "g" });
    expect(bar()).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1300);
    });
    expect(bar()).toBeNull();
  });
});
