// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { App } from "../app/app";
import { peek } from "../lib/actions";
import { initPrefs } from "../lib/prefs";
import { appStore, resetAppStoreForTests, selectRoute } from "../lib/store";
import { strings } from "../strings";

const text = strings.palette;

beforeEach(() => {
  localStorage.clear();
  initPrefs();
  resetAppStoreForTests({ screen: "today", tab: null });
});

afterEach(cleanup);

const press = (key: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(document, { key, ...init });
const route = () => selectRoute(appStore().getState());
const openPalette = () => {
  press("k", { ctrlKey: true });
  return screen.getByRole("dialog", { name: text.label });
};
const input = () => screen.getByRole("combobox", { name: text.inputLabel });
const options = () => screen.getAllByRole("option");
const selectedOption = () => options().find((o) => o.getAttribute("aria-selected") === "true");
const headings = (dialog: HTMLElement) =>
  Array.from(dialog.querySelectorAll(".pal-g"), (el) => el.textContent);

describe("the command palette", () => {
  it("opens with Ctrl+K, focuses the input and lists Actions then Go to", () => {
    render(<App />);
    expect(screen.queryByRole("dialog", { name: text.label })).toBeNull();
    const dialog = openPalette();
    expect(document.activeElement).toBe(input());
    expect(headings(dialog)).toEqual([text.groups.actions, text.groups.goTo]);
    expect(within(dialog).getByRole("listbox")).toBeTruthy();
  });

  it("lists Recent first once a record was peeked", () => {
    render(<App />);
    act(() => {
      peek({ kind: "creator", id: "c1" });
    });
    const dialog = openPalette();
    expect(headings(dialog)).toEqual([text.groups.recent, text.groups.actions, text.groups.goTo]);
    expect(options()[0]?.textContent).toContain("Prompt Lab");
  });

  it("opens with / and from the search button in the top bar", async () => {
    render(<App />);
    press("/");
    expect(screen.getByRole("dialog", { name: text.label })).toBeTruthy();
    press("Escape");
    await userEvent.click(screen.getByRole("button", { name: new RegExp(strings.top.search) }));
    expect(screen.getByRole("dialog", { name: text.label })).toBeTruthy();
  });

  it("filters by a creator's name and a screen's name", async () => {
    render(<App />);
    openPalette();
    await userEvent.type(input(), "neural");
    expect(options().map((o) => o.textContent)).toEqual([
      expect.stringContaining("Neural Notes"),
      expect.stringContaining("Lumen AI × Neural Notes"),
    ]);
    await userEvent.clear(input());
    await userEvent.type(input(), "Insights");
    expect(options().map((o) => o.textContent)).toEqual([
      expect.stringContaining(strings.screens.insights.name),
    ]);
  });

  it("says Nothing matches for nonsense", async () => {
    render(<App />);
    openPalette();
    await userEvent.type(input(), "zzzqqq");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText(text.empty("zzzqqq"))).toBeTruthy();
    expect(input().hasAttribute("aria-activedescendant")).toBe(false);
  });

  it("shows at most 14 rows", async () => {
    render(<App />);
    openPalette();
    await userEvent.type(input(), "e");
    expect(options()).toHaveLength(14);
  });

  it("moves the selection with ArrowDown and ArrowUp", () => {
    render(<App />);
    openPalette();
    expect(selectedOption()).toBe(options()[0]);
    expect(input().getAttribute("aria-activedescendant")).toBe(options()[0]?.id);
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(selectedOption()).toBe(options()[2]);
    expect(input().getAttribute("aria-activedescendant")).toBe(options()[2]?.id);
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    expect(selectedOption()).toBe(options()[1]);
    for (let i = 0; i < 3; i += 1) {
      fireEvent.keyDown(input(), { key: "ArrowUp" });
    }
    expect(selectedOption()).toBe(options()[0]);
  });

  it("runs the selected command with Enter and closes", () => {
    render(<App />);
    openPalette();
    // The first Go to row is Today; the fourth action is the shortcut sheet.
    for (let i = 0; i < 3; i += 1) {
      fireEvent.keyDown(input(), { key: "ArrowDown" });
    }
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(screen.queryByRole("dialog", { name: text.label })).toBeNull();
    expect(screen.getByRole("dialog", { name: strings.shortcuts.label })).toBeTruthy();
  });

  it("runs a row that is clicked and closes", async () => {
    render(<App />);
    openPalette();
    await userEvent.click(
      screen.getByRole("option", { name: new RegExp(strings.screens.reach.name) }),
    );
    expect(screen.queryByRole("dialog", { name: text.label })).toBeNull();
    expect(route().screen).toBe("reach");
  });

  it("closes with Esc and with Ctrl+K", () => {
    render(<App />);
    openPalette();
    press("Escape");
    expect(screen.queryByRole("dialog", { name: text.label })).toBeNull();
    openPalette();
    press("k", { ctrlKey: true });
    expect(screen.queryByRole("dialog", { name: text.label })).toBeNull();
  });

  it("gives focus back to what had it before", () => {
    render(<App />);
    const search = screen.getByRole("button", { name: new RegExp(strings.top.search) });
    search.focus();
    openPalette();
    press("Escape");
    expect(document.activeElement).toBe(search);
  });

  it("holds the keys: G then R does not navigate and Ctrl+Z does not undo", () => {
    render(<App />);
    act(() => {
      appStore().act("Change", (data) => {
        data.myName = "Ada";
      });
    });
    openPalette();
    press("g");
    press("r");
    expect(route().screen).toBe("today");
    press("z", { ctrlKey: true });
    expect(appStore().getState().data.myName).toBe("Ada");
    expect(screen.queryByText(strings.actions.undone)).toBeNull();
  });

  it("opens the peek with a record that is chosen", async () => {
    render(<App />);
    openPalette();
    await userEvent.type(input(), "prompt lab");
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(screen.queryByRole("dialog", { name: text.label })).toBeNull();
    expect(document.body.querySelector(".body.has-peek")).not.toBeNull();
    const panel = screen.getByRole("complementary", { name: strings.peek.label });
    expect(within(panel).getByRole("heading", { name: "Prompt Lab" })).toBeTruthy();
  });
});
