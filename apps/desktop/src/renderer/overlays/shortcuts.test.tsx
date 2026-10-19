// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
const sheet = () => screen.queryByRole("dialog", { name: strings.shortcuts.label });

describe("the shortcut sheet", () => {
  it("opens with ? as a dialog with the four groups, focused on itself", () => {
    render(<App />);
    expect(sheet()).toBeNull();
    press("?", { shiftKey: true });
    const dialog = sheet();
    expect(dialog).not.toBeNull();
    if (dialog === null) return;
    expect(document.activeElement).toBe(dialog);
    const titles = within(dialog)
      .getAllByRole("heading", { level: 4 })
      .map((h) => h.textContent);
    expect(titles).toEqual(strings.shortcuts.groups.map((g) => g.title));
    expect(titles).toHaveLength(4);
  });

  it("closes with ? and with Esc, and gives focus back", () => {
    render(<App />);
    const search = screen.getByRole("button", { name: new RegExp(strings.top.search) });
    search.focus();
    press("?");
    expect(sheet()).not.toBeNull();
    press("?");
    expect(sheet()).toBeNull();
    expect(document.activeElement).toBe(search);
    press("?");
    press("Escape");
    expect(sheet()).toBeNull();
  });

  it("closes with its Close button", () => {
    render(<App />);
    press("?");
    fireEvent.click(screen.getByRole("button", { name: strings.shortcuts.close }));
    expect(sheet()).toBeNull();
  });

  it("holds the keys: G then R does not navigate", () => {
    render(<App />);
    press("?");
    press("g");
    press("r");
    expect(selectRoute(appStore().getState()).screen).toBe("today");
    press("Escape");
    press("g");
    press("r");
    expect(selectRoute(appStore().getState()).screen).toBe("reach");
  });
});
