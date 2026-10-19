// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { App } from "../app/app";
import { peek } from "../lib/actions";
import { getPrefs, initPrefs } from "../lib/prefs";
import { appStore, resetAppStoreForTests, selectRoute } from "../lib/store";
import { strings } from "../strings";

const text = strings.settings;
const { tabs } = strings.screens.settings;

beforeEach(() => {
  localStorage.clear();
  initPrefs();
  resetAppStoreForTests({ screen: "settings", tab: "profile" });
});

afterEach(cleanup);

const press = (key: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(document, { key, ...init });
const route = () => selectRoute(appStore().getState());
const ui = () => appStore().getState().ui;
/** Your name in the data (3d-1 moved it from a preference to the account, so tests read it here). */
const myName = () => appStore().getState().data.myName;
const html = () => document.documentElement;
const nameField = () => screen.getByRole("textbox", { name: text.rows.name.label });
/** The expanded account button is named by its text: the name (or "Add your name") and the role. */
const account = () =>
  screen.getByRole("button", { name: new RegExp(strings.rail.roleOnline("Owner")) });
const bell = () => screen.getByRole("button", { name: /^Notifications, \d+ unread$/ });
const openSection = (name: string) =>
  userEvent.click(within(screen.getByRole("navigation", { name: text.navLabel })).getByText(name));
const rowById = (id: string): HTMLElement => {
  const row = document.getElementById(id);
  if (row === null) throw new Error(`no row ${id}`);
  return row;
};
const group = (label: string) => screen.getByRole("group", { name: label });
const pick = (label: string, option: string) =>
  userEvent.click(within(group(label)).getByRole("button", { name: option }));

describe("Profile", () => {
  it("sets the name on Enter: the rail shows it and 'Add your name' goes", async () => {
    render(<App />);
    expect(account().textContent).toContain(strings.rail.addName);
    await userEvent.type(nameField(), "Maya Chen{Enter}");
    expect(account().textContent).toContain("Maya Chen");
    expect(screen.queryByText(strings.rail.addName)).toBeNull();
    expect(myName()).toBe("Maya Chen");
    expect(screen.getByText(text.profile.setHere)).toBeTruthy();
    // The row says Saved.
    expect(within(rowById("set-name")).getByRole("status").textContent).toBe(text.saved);
  });

  it("cancels on Esc: nothing is saved and the field is empty again", async () => {
    render(<App />);
    await userEvent.type(nameField(), "Maya Chen{Escape}");
    expect(nameField()).toHaveProperty("value", "");
    expect(myName()).toBeNull();
    expect(account().textContent).toContain(strings.rail.addName);
  });

  it("keeps Esc in the name field: an open peek stays open", async () => {
    render(<App />);
    act(() => {
      peek({ kind: "creator", id: "c1" });
    });
    expect(ui().peek).not.toBeNull();
    await userEvent.type(nameField(), "Maya{Escape}");
    expect(nameField()).toHaveProperty("value", "");
    expect(ui().peek).not.toBeNull();
  });

  it("takes at most 80 characters", () => {
    render(<App />);
    expect(nameField()).toHaveProperty("maxLength", 80);
  });

  it("saves when the field loses focus", async () => {
    render(<App />);
    await userEvent.type(nameField(), "Maya Chen");
    expect(account().textContent).toContain(strings.rail.addName);
    await userEvent.tab();
    expect(account().textContent).toContain("Maya Chen");
    expect(myName()).toBe("Maya Chen");
  });

  it("brings 'Add your name' back when the name is emptied", async () => {
    render(<App />);
    await userEvent.type(nameField(), "Maya{Enter}");
    expect(account().textContent).toContain("Maya");
    await userEvent.clear(nameField());
    await userEvent.type(nameField(), "{Enter}");
    expect(account().textContent).toContain(strings.rail.addName);
    expect(myName()).toBeNull();
    expect(screen.getByText(text.profile.notSet)).toBeTruthy();
  });

  it("shows the role as a tag and goes to Team from 'Roles in Team'", async () => {
    render(<App />);
    const tag = document.querySelector(".tag");
    expect(tag?.textContent).toBe("Owner");
    expect(screen.getByText(text.rows.role.descOwner)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: text.profile.rolesInTeam }));
    expect(route().screen).toBe("team");
  });
});

describe("Appearance", () => {
  it("is dark only: no theme row, and the page is dark", async () => {
    render(<App />);
    await openSection(tabs.appearance);
    expect(document.getElementById("set-theme")).toBeNull();
    expect(html().getAttribute("data-theme")).toBe("dark");
  });

  it("sets the density", async () => {
    render(<App />);
    await openSection(tabs.appearance);
    await pick(text.rows.density.label, text.options.compact);
    expect(html().getAttribute("data-density")).toBe("compact");
    await pick(text.rows.density.label, text.options.comfortable);
    expect(html().hasAttribute("data-density")).toBe(false);
  });

  it("sets the text size", async () => {
    render(<App />);
    await openSection(tabs.appearance);
    await pick(text.rows.size.label, text.options.large);
    expect(html().getAttribute("data-size")).toBe("large");
    await pick(text.rows.size.label, text.options.normal);
    expect(html().hasAttribute("data-size")).toBe(false);
  });

  it("sets the motion", async () => {
    render(<App />);
    await openSection(tabs.appearance);
    await pick(text.rows.motion.label, text.options.reduce);
    expect(html().getAttribute("data-motion")).toBe("reduce");
    await pick(text.rows.motion.label, text.options.followComputer);
    expect(html().hasAttribute("data-motion")).toBe(false);
  });

  it("collapses and expands the rail from the sidebar row", async () => {
    render(<App />);
    await openSection(tabs.appearance);
    expect(
      within(group(text.rows.rail.label))
        .getByRole("button", { name: text.options.expanded })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    await pick(text.rows.rail.label, text.options.collapsed);
    expect(getPrefs().rail).toBe("min");
    expect(screen.getByRole("button", { name: strings.rail.account("You") })).toBeTruthy();
    expect(screen.getByRole("button", { name: strings.rail.expand })).toBeTruthy();
    await pick(text.rows.rail.label, text.options.expanded);
    expect(getPrefs().rail).toBe("");
    expect(screen.getByRole("button", { name: strings.rail.collapse })).toBeTruthy();
  });
});

describe("Keyboard", () => {
  const letters = () => screen.getByRole("switch", { name: text.rows.letters.label });

  it("lists the shortcut groups and their keys", async () => {
    render(<App />);
    await openSection(tabs.keyboard);
    const headings = screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent);
    expect(headings).toEqual(strings.shortcuts.groups.map((g) => g.title));
    const first = strings.shortcuts.groups[0].rows[0];
    // The top bar also shows Ctrl K, so look inside the pane.
    const pane = within(document.querySelector<HTMLElement>(".set-pane") ?? document.body);
    expect(pane.getByText(first[0])).toBeTruthy();
    expect(pane.getByText(first[1])).toBeTruthy();
  });

  it("turns single-letter keys off and on; Ctrl+K works either way", async () => {
    render(<App />);
    await openSection(tabs.keyboard);
    expect(letters().getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText(text.on)).toBeTruthy();

    await userEvent.click(letters());
    expect(letters().getAttribute("aria-checked")).toBe("false");
    expect(getPrefs().letters).toBe("off");
    expect(screen.getByText(text.off)).toBeTruthy();
    press("g");
    press("r");
    expect(route().screen).toBe("settings");
    press("k", { ctrlKey: true });
    expect(ui().palette).toBe(true);
    press("Escape");
    expect(ui().palette).toBe(false);

    await userEvent.click(letters());
    expect(letters().getAttribute("aria-checked")).toBe("true");
    press("g");
    press("r");
    expect(route().screen).toBe("reach");
  });
});

describe("Notifications", () => {
  const sw = (label: string) => screen.getByRole("switch", { name: label });
  const tray = () => screen.queryByRole("dialog", { name: strings.top.notifications });
  const replyText = (): string => {
    const reply = appStore()
      .getState()
      .data.notifications.find((n) => n.icon === "reply");
    if (reply === undefined) throw new Error("no reply notification");
    return reply.text;
  };

  it("drops the bell's unread count and the tray's replies when Replies is off, and Ctrl+Z brings them back", async () => {
    render(<App />);
    await openSection(tabs.notifications);
    expect(bell().getAttribute("aria-label")).toBe(strings.top.notificationsUnread(3));
    expect(sw(text.notify.reply.label).getAttribute("aria-checked")).toBe("true");

    await userEvent.click(sw(text.notify.reply.label));
    expect(sw(text.notify.reply.label).getAttribute("aria-checked")).toBe("false");
    expect(bell().getAttribute("aria-label")).toBe(strings.top.notificationsUnread(2));
    await userEvent.click(bell());
    expect(tray()).not.toBeNull();
    expect(screen.queryByText(replyText())).toBeNull();
    await userEvent.click(bell());
    expect(tray()).toBeNull();

    press("z", { ctrlKey: true });
    expect(screen.getByText(strings.actions.undone)).toBeTruthy();
    expect(sw(text.notify.reply.label).getAttribute("aria-checked")).toBe("true");
    expect(bell().getAttribute("aria-label")).toBe(strings.top.notificationsUnread(3));
    await userEvent.click(bell());
    expect(screen.getByText(replyText())).toBeTruthy();
  });

  it("shows Saved on the row when a kind changes", async () => {
    render(<App />);
    await openSection(tabs.notifications);
    await userEvent.click(sw(text.notify.money.label));
    expect(within(rowById("set-notify")).getByRole("status").textContent).toBe(text.saved);
  });

  it("keeps Problems on: a disabled switch that does nothing", async () => {
    render(<App />);
    await openSection(tabs.notifications);
    const problems = sw(text.problems.label);
    expect(problems).toHaveProperty("disabled", true);
    expect(problems.getAttribute("aria-checked")).toBe("true");
    await userEvent.click(problems);
    expect(problems.getAttribute("aria-checked")).toBe("true");
    expect(appStore().getState().data.settings.notify).toEqual({});
  });
});
