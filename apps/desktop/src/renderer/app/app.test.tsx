// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getPrefs, initPrefs, prefsKey, setPref } from "../lib/prefs";
import { appStore, go, resetAppStore, selectRoute } from "../lib/store";
import { strings } from "../strings";
import { App } from "./app";

beforeEach(() => {
  localStorage.clear();
  initPrefs();
  resetAppStore({ screen: "today", tab: null });
  delete document.documentElement.dataset["input"];
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const crumbs = () => screen.getByRole("navigation", { name: strings.top.crumbs });
const route = () => selectRoute(appStore().getState());
const press = (key: string, init: KeyboardEventInit = {}, target: Document | Element = document) =>
  fireEvent.keyDown(target, { key, ...init });
const appElement = (container: HTMLElement) => container.querySelector(".app");

describe("the top bar", () => {
  it("enables Back and Forward only when there is somewhere to go", async () => {
    render(<App />);
    const backButton = screen.getByRole("button", { name: strings.top.back });
    const forwardButton = screen.getByRole("button", { name: strings.top.forward });
    expect(backButton).toHaveProperty("disabled", true);
    expect(forwardButton).toHaveProperty("disabled", true);

    act(() => {
      go("find");
    });
    expect(backButton).toHaveProperty("disabled", false);

    await userEvent.click(backButton);
    expect(route().screen).toBe("today");
    expect(forwardButton).toHaveProperty("disabled", false);
    expect(backButton).toHaveProperty("disabled", true);
  });

  it("shows 3 unread notifications on the bell", () => {
    render(<App />);
    const bell = screen.getByRole("button", { name: strings.top.notifications });
    expect(within(bell).getByText("3")).toBeTruthy();
  });

  it("shows the teammates who are online, not the one who is away and not you", () => {
    render(<App />);
    const top = screen.getByRole("banner");
    expect(within(top).getByRole("img", { name: "Sara" })).toBeTruthy();
    expect(within(top).getByRole("img", { name: "Omar" })).toBeTruthy();
    expect(within(top).queryByRole("img", { name: "Lina" })).toBeNull();
    expect(within(top).queryByRole("img", { name: "You" })).toBeNull();
  });

  it("says Saving while a save is running", () => {
    render(<App />);
    expect(within(screen.getByRole("status")).getByText(strings.top.saved)).toBeTruthy();
    act(() => {
      appStore().ui((d) => {
        d.saving = true;
      });
    });
    expect(within(screen.getByRole("status")).getByText(strings.top.saving)).toBeTruthy();
  });
});

describe("the keys", () => {
  it("goes back and forward with Alt+Left and Alt+Right", () => {
    render(<App />);
    act(() => {
      go("find");
    });
    press("ArrowLeft", { altKey: true });
    expect(route().screen).toBe("today");
    press("ArrowRight", { altKey: true });
    expect(route().screen).toBe("find");
  });

  it("opens Reach with G then R", () => {
    render(<App />);
    press("g");
    press("r");
    expect(route().screen).toBe("reach");
    expect(within(crumbs()).getByText(strings.screens.reach.name)).toBeTruthy();
  });

  it("does nothing when the letter comes more than 1200 ms after G", () => {
    render(<App />);
    const start = Date.now();
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(start);
    press("g");
    now.mockReturnValue(start + 1300);
    press("r");
    expect(route().screen).toBe("today");
  });

  it("does nothing when G then R are typed into an input", () => {
    render(<App />);
    const input = document.createElement("input");
    document.body.append(input);
    press("g", {}, input);
    press("r", {}, input);
    input.remove();
    expect(route().screen).toBe("today");
  });

  it("ignores single letters and [ when letters are off, but still takes Alt+Left", () => {
    const { container } = render(<App />);
    act(() => {
      setPref("letters", "off");
    });
    press("g");
    press("r");
    expect(route().screen).toBe("today");
    press("[");
    expect(appElement(container)?.classList.contains("rail-min")).toBe(false);

    act(() => {
      go("find");
    });
    press("ArrowLeft", { altKey: true });
    expect(route().screen).toBe("today");
  });

  it("collapses and expands the rail with [ and saves it", () => {
    const { container } = render(<App />);
    press("[");
    expect(appElement(container)?.classList.contains("rail-min")).toBe(true);
    expect(getPrefs().rail).toBe("min");
    expect(localStorage.getItem(prefsKey)).toContain('"rail":"min"');
    press("[");
    expect(appElement(container)?.classList.contains("rail-min")).toBe(false);
    expect(getPrefs().rail).toBe("");
  });

  it("opens Settings > Profile with Ctrl+, and stays on the tab it is on", () => {
    render(<App />);
    press(",", { ctrlKey: true });
    expect(route()).toEqual({ screen: "settings", tab: "profile" });

    act(() => {
      go("settings", "appearance");
    });
    press(",", { ctrlKey: true });
    expect(route()).toEqual({ screen: "settings", tab: "appearance" });
    expect(within(crumbs()).getByText(strings.screens.settings.tabs.appearance)).toBeTruthy();
  });

  it("marks the page as keyboard-driven after a handled key", () => {
    render(<App />);
    expect(document.documentElement.dataset["input"]).toBeUndefined();
    press("[");
    expect(document.documentElement.dataset["input"]).toBe("kbd");
  });
});

describe("the narrow drawer", () => {
  const menu = () => screen.getByRole("button", { name: strings.top.menu });

  it("opens with the Menu button and closes with Esc", async () => {
    const { container } = render(<App />);
    await userEvent.click(menu());
    expect(appElement(container)?.classList.contains("rail-open")).toBe(true);
    press("Escape");
    expect(appElement(container)?.classList.contains("rail-open")).toBe(false);
  });

  it("closes when the scrim is clicked", async () => {
    const { container } = render(<App />);
    await userEvent.click(menu());
    const scrim = container.querySelector(".scrim");
    expect(scrim).not.toBeNull();
    await userEvent.click(scrim as Element);
    expect(appElement(container)?.classList.contains("rail-open")).toBe(false);
  });

  it("closes when a screen is chosen", async () => {
    const { container } = render(<App />);
    await userEvent.click(menu());
    await userEvent.click(
      within(screen.getByRole("navigation", { name: strings.rail.label })).getByRole("button", {
        name: new RegExp(`^${strings.screens.reach.name}`),
      }),
    );
    expect(route().screen).toBe("reach");
    expect(appElement(container)?.classList.contains("rail-open")).toBe(false);
  });
});
