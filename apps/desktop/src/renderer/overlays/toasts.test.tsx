// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../app/app";
import { toast } from "../lib/actions";
import { initPrefs } from "../lib/prefs";
import { appStore, resetAppStoreForTests } from "../lib/store";
import { strings } from "../strings";

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  initPrefs();
  resetAppStoreForTests({ screen: "today", tab: null });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const advance = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};
const show = (msg: string, ms = 1000) => {
  act(() => {
    toast({ msg, ms });
  });
};
const dispatchMouse = (el: Element, type: "mouseenter" | "mouseleave") => {
  act(() => {
    el.dispatchEvent(new MouseEvent(type));
  });
};

describe("toasts", () => {
  it("shows at most three, dropping the oldest", () => {
    render(<App />);
    for (const msg of ["one", "two", "three", "four"]) {
      show(msg);
    }
    expect(screen.queryByText("one")).toBeNull();
    expect(["two", "three", "four"].every((msg) => screen.queryByText(msg) !== null)).toBe(true);
  });

  it("dismisses itself after its time", () => {
    render(<App />);
    show("Gone soon", 1000);
    advance(800);
    expect(screen.queryByText("Gone soon")).not.toBeNull();
    advance(400);
    expect(screen.queryByText("Gone soon")).toBeNull();
  });

  it("waits while the pointer is over it", () => {
    render(<App />);
    show("Hold on", 1000);
    const element = screen.getByText("Hold on").closest(".toast");
    if (element === null) throw new Error("no toast");
    advance(400);
    dispatchMouse(element, "mouseenter");
    advance(5000);
    expect(screen.queryByText("Hold on")).not.toBeNull();
    dispatchMouse(element, "mouseleave");
    advance(800);
    expect(screen.queryByText("Hold on")).toBeNull();
  });

  it("dismisses and then runs an action", () => {
    render(<App />);
    const order: string[] = [];
    act(() => {
      toast({
        msg: "Moved it",
        actions: [
          {
            label: "Take me there",
            run: () => {
              // The screen updates after the click; the store already has it gone.
              order.push(appStore().getState().ui.toasts.length === 0 ? "gone" : "shown");
            },
          },
        ],
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "Take me there" }));
    expect(order).toEqual(["gone"]);
    expect(screen.queryByText("Moved it")).toBeNull();
  });

  it("removes a toast with Dismiss", () => {
    render(<App />);
    show("Dismiss me", 60000);
    fireEvent.click(screen.getByRole("button", { name: strings.toasts.dismiss }));
    expect(screen.queryByText("Dismiss me")).toBeNull();
  });
});
