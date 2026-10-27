// @vitest-environment happy-dom
import type { PrototypeStatus } from "@gratovo/ipc";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { exampleData } from "../lib/example-data";
import { stubFindBridge } from "../lib/find-test-bridge";
import { initPrefs } from "../lib/prefs";
import { getPrototype, loadPrototype, resetPrototypeForTests } from "../lib/prototype";
import { resetAppStoreForTests } from "../lib/store";
import { buildCommands } from "../overlays/commands";
import { strings } from "../strings";
import { App } from "./app";

const text = strings.prototype;

function bridge(status: PrototypeStatus) {
  const invoke = vi.fn((channel: string) =>
    Promise.resolve(
      channel === "comments:list"
        ? { ok: true, value: { comments: [] } }
        : { ok: true, value: status },
    ),
  );
  (globalThis as { gratovo?: unknown }).gratovo = { invoke };
  return invoke;
}

beforeEach(() => {
  stubFindBridge();
  localStorage.clear();
  initPrefs();
  resetPrototypeForTests();
  resetAppStoreForTests({ screen: "today", tab: null });
});
afterEach(cleanup);

describe("the top bar", () => {
  it("has no chip and no comment button while prototype mode is off", async () => {
    bridge({ available: true, on: false, scenario: "normal" });
    const { container } = render(<App />);
    await act(() => loadPrototype());
    expect(container.querySelector('[data-ui="frame.top.proto"]')).toBeNull();
    expect(container.querySelector("[data-cmt-ui]")).toBeNull();
    expect(screen.queryByRole("button", { name: text.commentOn })).toBeNull();
  });

  it("shows the chip and the comment button while on, and the chip opens the scenario menu", async () => {
    bridge({ available: true, on: true, scenario: "later" });
    const { container } = render(<App />);
    await act(() => loadPrototype());
    const chip = container.querySelector('[data-ui="frame.top.proto"]');
    expect(chip?.textContent).toContain(text.scenarios.later.short);
    expect(container.querySelector("[data-cmt-ui]")).not.toBeNull();
    await userEvent.click(screen.getByRole("button", { name: text.commentOn }));
    expect(getPrototype().commenting).toBe(true);
    await userEvent.click(chip as Element);
    expect(screen.getByText(text.menuHead)).toBeTruthy();
    expect(screen.getByText(text.turnOff)).toBeTruthy();
  });
});

describe("the palette", () => {
  it("has no Prototype entries while off, and two while on", async () => {
    bridge({ available: true, on: false, scenario: "normal" });
    await loadPrototype();
    const data = exampleData(Date.now());
    const labels = (query: string) => buildCommands(data, [], query).map((c) => c.label);
    expect(labels("comment")).not.toContain(text.paletteComment);
    expect(labels("comments")).not.toContain(text.paletteShowAll);
    bridge({ available: true, on: true, scenario: "normal" });
    await loadPrototype();
    expect(labels("comment")).toContain(text.paletteComment);
    expect(labels("all comments")).toContain(text.paletteShowAll);
  });
});
