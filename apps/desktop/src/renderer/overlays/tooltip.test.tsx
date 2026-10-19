// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../app/app";
import { initPrefs } from "../lib/prefs";
import { resetAppStoreForTests } from "../lib/store";
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
const tip = () => screen.queryByRole("tooltip");
const jobs = () => screen.getByRole("button", { name: strings.top.jobs });
const saveState = () => {
  const el = document.querySelector<HTMLElement>(".save");
  if (el === null) throw new Error("no save state");
  return el;
};

describe("the tooltip", () => {
  it("shows after 480 ms over an element with data-tip", () => {
    render(<App />);
    fireEvent.mouseOver(jobs());
    advance(479);
    expect(tip()).toBeNull();
    advance(1);
    expect(tip()?.textContent).toContain(strings.top.jobsNone);
  });

  it("shows the next one at once within 700 ms, and waits again after longer", () => {
    render(<App />);
    fireEvent.mouseOver(jobs());
    advance(480);
    fireEvent.mouseOut(jobs());
    expect(tip()).toBeNull();
    advance(300);
    fireEvent.mouseOver(saveState());
    expect(tip()).not.toBeNull();

    fireEvent.mouseOut(saveState());
    advance(800);
    fireEvent.mouseOver(jobs());
    expect(tip()).toBeNull();
    advance(480);
    expect(tip()).not.toBeNull();
  });

  it("hides on a key press", () => {
    render(<App />);
    fireEvent.mouseOver(jobs());
    advance(480);
    expect(tip()).not.toBeNull();
    fireEvent.keyDown(document, { key: "a" });
    expect(tip()).toBeNull();
  });

  it("never shows when the pointer leaves before the delay", () => {
    render(<App />);
    fireEvent.mouseOver(jobs());
    advance(200);
    fireEvent.mouseOut(jobs());
    advance(1000);
    expect(tip()).toBeNull();
  });
});
