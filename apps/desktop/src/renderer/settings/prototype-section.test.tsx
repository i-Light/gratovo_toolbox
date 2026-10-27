// @vitest-environment happy-dom
import type { PrototypeStatus } from "@gratovo/ipc";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../app/app";
import { stubFindBridge } from "../lib/find-test-bridge";
import { initPrefs } from "../lib/prefs";
import { loadPrototype, resetPrototypeForTests } from "../lib/prototype";
import { takeSwitchToast } from "../lib/prototype-toast";
import { resetAppStoreForTests } from "../lib/store";
import { strings } from "../strings";

const text = strings.prototype;
const { tabs } = strings.screens.settings;

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
  sessionStorage.clear();
  initPrefs();
  resetPrototypeForTests();
  resetAppStoreForTests({ screen: "settings", tab: "profile" });
});
afterEach(cleanup);

const nav = () => screen.getByRole("navigation", { name: strings.settings.navLabel });
const scenarioButton = (key: keyof typeof text.scenarios) =>
  screen.queryByRole("button", { name: new RegExp(text.scenarios[key].name) });

describe("the Prototype section", () => {
  it("is hidden until main says it is available", async () => {
    render(<App />);
    expect(within(nav()).queryByText(tabs.prototype)).toBeNull();
    bridge({ available: false, on: false, scenario: "normal" });
    await act(() => loadPrototype());
    expect(within(nav()).queryByText(tabs.prototype)).toBeNull();
  });

  it("shows the switch when available and calls prototype:set; no scenario buttons while off", async () => {
    const invoke = bridge({ available: true, on: false, scenario: "normal" });
    render(<App />);
    await act(() => loadPrototype());
    await userEvent.click(within(nav()).getByText(tabs.prototype));
    expect(scenarioButton("broke")).toBeNull();
    await userEvent.click(screen.getByRole("switch", { name: text.switchLabel }));
    expect(invoke).toHaveBeenCalledWith("prototype:set", { on: true });
    expect(takeSwitchToast()?.msg).toBe(text.toastOn);
  });

  it("shows the scenarios and comment buttons while on, and a pick calls prototype:scenario", async () => {
    const invoke = bridge({ available: true, on: true, scenario: "normal" });
    render(<App />);
    await act(() => loadPrototype());
    expect(within(nav()).getByText(text.on)).toBeTruthy();
    await userEvent.click(within(nav()).getByText(tabs.prototype));
    expect(scenarioButton("normal")?.getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(scenarioButton("broke") as Element);
    expect(invoke).toHaveBeenCalledWith("prototype:scenario", { scenario: "broke" });
    expect(screen.getByRole("button", { name: new RegExp(text.startCommenting) })).toBeTruthy();
    expect(screen.getByRole("button", { name: text.exportAll })).toBeTruthy();
    expect(screen.getByRole("switch", { name: text.showPins })).toBeTruthy();
  });
});
