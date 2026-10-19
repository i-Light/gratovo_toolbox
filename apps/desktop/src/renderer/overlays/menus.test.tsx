// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { App } from "../app/app";
import { initPrefs } from "../lib/prefs";
import { appStore, resetAppStoreForTests, selectRoute } from "../lib/store";
import { strings } from "../strings";

beforeEach(() => {
  localStorage.clear();
  initPrefs();
  resetAppStoreForTests({ screen: "today", tab: null });
});

afterEach(cleanup);

const press = (key: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(document, { key, ...init });
const route = () => selectRoute(appStore().getState());
const account = () => screen.getByRole("button", { name: /^Your account/ });
const items = () => within(screen.getByRole("menu")).getAllByRole("menuitem");
/** The menu listens for outside presses from the next tick on. */
const tick = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

async function openAccountMenu() {
  await userEvent.click(account());
  await tick();
  return screen.getByRole("menu");
}

describe("the account menu", () => {
  it("lists the who row, Settings, Appearance with the theme, shortcuts, Notifications, Connections", async () => {
    render(<App />);
    const menu = await openAccountMenu();
    const { menu: text } = strings;
    expect(items().map((item) => item.textContent)).toEqual([
      expect.stringContaining(strings.rail.addName),
      expect.stringContaining(text.settings),
      expect.stringContaining(`${text.appearance}${text.themeSystem}`),
      expect.stringContaining(text.shortcuts),
      expect.stringContaining(text.notifications),
      expect.stringContaining(text.connections),
    ]);
    expect(menu.querySelector("hr")).not.toBeNull();
  });

  it("focuses the first item and moves with the arrows, Home and End", async () => {
    render(<App />);
    await openAccountMenu();
    const all = items();
    expect(document.activeElement).toBe(all[0]);
    press("ArrowDown");
    expect(document.activeElement).toBe(all[1]);
    press("ArrowDown");
    expect(document.activeElement).toBe(all[2]);
    press("ArrowUp");
    expect(document.activeElement).toBe(all[1]);
    press("End");
    expect(document.activeElement).toBe(all.at(-1));
    press("ArrowDown");
    expect(document.activeElement).toBe(all.at(-1));
    press("Home");
    expect(document.activeElement).toBe(all[0]);
    press("ArrowUp");
    expect(document.activeElement).toBe(all[0]);
  });

  it("closes with Esc and gives focus back to the account button", async () => {
    render(<App />);
    await openAccountMenu();
    press("Escape");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(account());
  });

  it("closes when the page outside it is pressed", async () => {
    render(<App />);
    await openAccountMenu();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("stays open when the menu itself is pressed", async () => {
    render(<App />);
    const menu = await openAccountMenu();
    fireEvent.mouseDown(menu);
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("opens Settings > Profile from Settings", async () => {
    render(<App />);
    await openAccountMenu();
    await userEvent.click(
      screen.getByRole("menuitem", { name: new RegExp(`^${strings.menu.settings}`) }),
    );
    expect(screen.queryByRole("menu")).toBeNull();
    expect(route()).toEqual({ screen: "settings", tab: "profile" });
    const crumbs = screen.getByRole("navigation", { name: strings.top.crumbs });
    expect(within(crumbs).getByText(strings.screens.settings.tabs.profile)).toBeTruthy();
  });

  it("is named, tells its button it is open, and keeps its items out of the Tab order", async () => {
    render(<App />);
    expect(account().getAttribute("aria-expanded")).toBe("false");
    const menu = await openAccountMenu();
    expect(menu.getAttribute("aria-label")).toBe(strings.menu.account);
    expect(account().getAttribute("aria-expanded")).toBe("true");
    for (const item of items()) {
      expect(item.getAttribute("tabindex")).toBe("-1");
    }
    // The who row's avatar is hidden from screen readers, so the name is read once.
    expect(items()[0]?.querySelector('[role="img"]')).toBeNull();
  });

  it("closes on Tab and Shift+Tab, giving focus back to the account button", async () => {
    render(<App />);
    await openAccountMenu();
    press("Tab");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(account());
    expect(account().getAttribute("aria-expanded")).toBe("false");
    await openAccountMenu();
    press("Tab", { shiftKey: true });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens the shortcut sheet from Keyboard shortcuts", async () => {
    render(<App />);
    await openAccountMenu();
    await userEvent.click(
      screen.getByRole("menuitem", { name: new RegExp(`^${strings.menu.shortcuts}`) }),
    );
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("dialog", { name: strings.shortcuts.label })).toBeTruthy();
  });
});
