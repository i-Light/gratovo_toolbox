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
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.keyDown(document.body, { key: "g" });
    const bar = screen.getByRole("status");
    expect(bar.getAttribute("data-ui")).toBe("frame.go-hint");
    for (const [letter, name] of Object.entries(goLetters)) {
      const shown = isScreenShown(name, "live");
      expect(bar.textContent.includes(screens[name].name)).toBe(shown);
      expect(letter.length).toBe(1);
    }
  });

  it("hides when a letter jumps", () => {
    mount("example");
    fireEvent.keyDown(document.body, { key: "g" });
    expect(screen.getByRole("status")).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "r" });
    expect(screen.queryByRole("status")).toBeNull();
    expect(selectRoute(appStore().getState()).screen).toBe("reach");
  });

  it("hides on Escape", () => {
    mount("example");
    fireEvent.keyDown(document.body, { key: "g" });
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("hides after the timeout", () => {
    mount("example");
    fireEvent.keyDown(document.body, { key: "g" });
    expect(screen.getByRole("status")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1300);
    });
    expect(screen.queryByRole("status")).toBeNull();
  });
});
