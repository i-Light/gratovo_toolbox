// @vitest-environment happy-dom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isTyping, keyStack, quietAnimations, useKeys } from "./keys";

const context = { typing: false, lettersOff: false };

function press(key: string): KeyboardEvent {
  return new KeyboardEvent("keydown", { key, cancelable: true });
}

afterEach(cleanup);

describe("useKeys", () => {
  it("pushes its layer on mount and removes it on unmount", () => {
    const run = vi.fn();
    const { unmount } = renderHook(() => {
      useKeys({ x: run });
    });
    expect(keyStack.dispatch(press("x"), context)).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    unmount();
    expect(keyStack.dispatch(press("x"), context)).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("runs the newest handler after a re-render", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ run }) => {
        useKeys({ x: run });
      },
      { initialProps: { run: first } },
    );
    rerender({ run: second });
    keyStack.dispatch(press("x"), context);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("pushes nothing while inactive, and joins when it turns active", () => {
    const run = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ active }) => {
        useKeys({ x: run }, { active });
      },
      { initialProps: { active: false } },
    );
    expect(keyStack.dispatch(press("x"), context)).toBe(false);
    rerender({ active: true });
    expect(keyStack.dispatch(press("x"), context)).toBe(true);
    rerender({ active: false });
    expect(keyStack.dispatch(press("x"), context)).toBe(false);
    unmount();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("stops keys it does not handle when it is a barrier", () => {
    const below = vi.fn();
    const above = vi.fn();
    const lower = renderHook(() => {
      useKeys({ x: below });
    });
    const upper = renderHook(() => {
      useKeys({ y: above }, { barrier: true });
    });
    expect(keyStack.dispatch(press("x"), context)).toBe(false);
    expect(below).not.toHaveBeenCalled();
    expect(keyStack.dispatch(press("y"), context)).toBe(true);
    upper.unmount();
    expect(keyStack.dispatch(press("x"), context)).toBe(true);
    lower.unmount();
  });
});

describe("isTyping", () => {
  it("is true for input, textarea, select and editable elements", () => {
    expect(isTyping(document.createElement("input"))).toBe(true);
    expect(isTyping(document.createElement("textarea"))).toBe(true);
    expect(isTyping(document.createElement("select"))).toBe(true);
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    expect(isTyping(editable)).toBe(true);
  });

  it("is false for buttons, plain elements and no target", () => {
    expect(isTyping(document.createElement("button"))).toBe(false);
    expect(isTyping(document.createElement("div"))).toBe(false);
    expect(isTyping(null)).toBe(false);
    expect(isTyping(window)).toBe(false);
  });
});

describe("quietAnimations", () => {
  afterEach(() => {
    vi.useRealTimers();
    delete document.documentElement.dataset["input"];
  });

  it("sets data-input for 400 ms and restarts the timer on each call", () => {
    vi.useFakeTimers();
    quietAnimations();
    expect(document.documentElement.dataset["input"]).toBe("kbd");
    vi.advanceTimersByTime(300);
    quietAnimations();
    vi.advanceTimersByTime(300);
    expect(document.documentElement.dataset["input"]).toBe("kbd");
    vi.advanceTimersByTime(100);
    expect(document.documentElement.dataset["input"]).toBeUndefined();
  });
});
