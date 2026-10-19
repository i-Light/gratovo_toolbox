// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../app/app";
import { initPrefs } from "../lib/prefs";
import { settingsSections } from "../lib/settings";
import { appStore, resetAppStoreForTests, selectRoute } from "../lib/store";
import { strings } from "../strings";

const text = strings.settings;
const { tabs } = strings.screens.settings;

beforeEach(() => {
  localStorage.clear();
  initPrefs();
  resetAppStoreForTests({ screen: "settings", tab: "profile" });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const press = (key: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(document, { key, ...init });
const route = () => selectRoute(appStore().getState());
const nav = () => screen.getByRole("navigation", { name: text.navLabel });
const search = () => screen.getByRole("textbox", { name: text.find });
/** The nav button of a section, found by its name. */
const navButton = (name: string): HTMLElement => {
  const button = within(nav()).getByText(name).closest("button");
  if (button === null) throw new Error(`no nav button for ${name}`);
  return button;
};
/** The buttons of the search results (the nav is not part of them), with their labels. */
const resultButtons = () =>
  screen
    .getAllByRole("button")
    .filter((b) => b.classList.contains("li") && !nav().contains(b))
    .map((el) => ({ el, label: el.querySelector("b")?.textContent ?? "" }));
const resultFor = (label: string): HTMLElement => {
  const found = resultButtons().find((r) => r.label === label);
  if (found === undefined) throw new Error(`no result ${label}`);
  return found.el;
};

describe("the settings screen", () => {
  it("lists You and Agency sections in the nav and marks the current one", () => {
    render(<App />);
    const groups = Array.from(nav().querySelectorAll(".bucket"), (g) => [
      g.querySelector(".bucket-h")?.textContent,
      Array.from(g.querySelectorAll("button b"), (b) => b.textContent),
    ]);
    expect(groups).toEqual([
      [
        text.groups.you,
        [tabs.profile, tabs.appearance, tabs.day, tabs.keyboard, tabs.notifications],
      ],
      [text.groups.agency, [tabs.search, tabs.facts, tabs.writing, tabs.team, tabs.connections]],
    ]);
    const current = within(nav())
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-current") === "page");
    expect(current).toEqual([navButton(tabs.profile)]);
  });

  it("goes to a section when its nav button is clicked, and moves the mark", async () => {
    render(<App />);
    await userEvent.click(navButton(tabs.keyboard));
    expect(route()).toMatchObject({ screen: "settings", tab: "keyboard" });
    expect(navButton(tabs.keyboard).getAttribute("aria-current")).toBe("page");
    expect(navButton(tabs.profile).hasAttribute("aria-current")).toBe(false);
  });

  it("shows the pane's heading and note, and ends an Agency note with the whole-team line", async () => {
    render(<App />);
    expect(screen.getByRole("heading", { level: 2, name: tabs.profile })).toBeTruthy();
    for (const section of settingsSections.filter((s) => s.group === "you")) {
      await userEvent.click(navButton(tabs[section.key]));
      expect(screen.getByRole("heading", { level: 2, name: tabs[section.key] })).toBeTruthy();
      const copy = text.sections[section.key];
      // The note is the section's line under its name when it has none of its own; the nav shows
      // the same line, so the pane's is the second.
      expect(screen.getAllByText(copy.note ?? copy.sub).length).toBeGreaterThanOrEqual(2);
      expect(document.body.textContent).not.toContain(text.agencyNote);
    }
    for (const section of settingsSections.filter((s) => s.group === "agency")) {
      await userEvent.click(navButton(tabs[section.key]));
      expect(screen.getByRole("heading", { level: 2, name: tabs[section.key] })).toBeTruthy();
      const copy = text.sections[section.key];
      expect(screen.getByText(`${copy.note ?? copy.sub} ${text.agencyNote}`)).toBeTruthy();
    }
  });

  it("has no Prototype mode anywhere", async () => {
    const { container } = render(<App />);
    for (const section of settingsSections) {
      await userEvent.click(navButton(tabs[section.key]));
      expect(container.textContent).not.toMatch(/prototype/i);
    }
  });

  it.each([
    ["day", 4],
    ["search", 5],
    ["writing", 6],
    ["facts", 7],
    ["team", 9],
    ["connections", 9],
  ] as const)("says the %s section arrives with step %i", async (key, step) => {
    render(<App />);
    await userEvent.click(navButton(tabs[key]));
    expect(screen.getByText(text.shell.title(step))).toBeTruthy();
    expect(screen.getByText(text.shell.line(step))).toBeTruthy();
  });
});

describe("the settings search", () => {
  it("is focused by Ctrl+F", () => {
    render(<App />);
    press("f", { ctrlKey: true });
    expect(document.activeElement).toBe(search());
  });

  it("lists the Density row and the Appearance section for 'compact'", async () => {
    render(<App />);
    await userEvent.type(search(), "compact");
    expect(resultButtons().map((r) => r.label)).toEqual([text.rows.density.label, tabs.appearance]);
    // The row says which section it lives in.
    expect(within(resultFor(text.rows.density.label)).getByText(tabs.appearance)).toBeTruthy();
    // While searching no nav button is the current page.
    expect(
      within(nav())
        .getAllByRole("button")
        .some((b) => b.hasAttribute("aria-current")),
    ).toBe(false);
  });

  it("says no setting matches a nonsense word", async () => {
    render(<App />);
    await userEvent.type(search(), "zzzqqq");
    expect(screen.getByText(text.noMatch("zzzqqq"))).toBeTruthy();
    expect(screen.getByText(text.noMatchHint)).toBeTruthy();
    expect(resultButtons()).toEqual([]);
  });

  it("clears with Esc and leaves the field", async () => {
    render(<App />);
    await userEvent.type(search(), "compact");
    expect(search()).toHaveProperty("value", "compact");
    await userEvent.type(search(), "{Escape}");
    expect(search()).toHaveProperty("value", "");
    expect(document.activeElement).not.toBe(search());
    expect(screen.getByRole("heading", { level: 2, name: tabs.profile })).toBeTruthy();
  });

  it("opens Appearance, highlights the Density row and focuses its first control when it is chosen", async () => {
    render(<App />);
    await userEvent.type(search(), "compact");
    await userEvent.click(resultFor(text.rows.density.label));
    expect(search()).toHaveProperty("value", "");
    expect(route()).toMatchObject({ screen: "settings", tab: "appearance" });
    expect(navButton(tabs.appearance).getAttribute("aria-current")).toBe("page");
    const row = document.getElementById("set-density");
    expect(row?.classList.contains("hl")).toBe(true);
    const first = row?.querySelector("button");
    expect(first?.textContent).toBe(text.options.comfortable);
    expect(document.activeElement).toBe(first);
    // The request is spent, so a later render doesn't highlight the row again.
    expect(appStore().getState().ui.settingTarget).toBeNull();
  });

  it("opens a section when the section is chosen, with no row highlighted", async () => {
    render(<App />);
    await userEvent.type(search(), "compact");
    await userEvent.click(resultFor(tabs.appearance));
    expect(search()).toHaveProperty("value", "");
    expect(route()).toMatchObject({ screen: "settings", tab: "appearance" });
    expect(screen.getByRole("heading", { level: 2, name: tabs.appearance })).toBeTruthy();
    expect(document.querySelector(".hl")).toBeNull();
  });
});

describe("saved in place", () => {
  it("shows Saved on the changed row and takes it away after 1700 ms", () => {
    vi.useFakeTimers();
    render(<App />);
    fireEvent.click(navButton(tabs.appearance));
    const row = document.getElementById("set-density");
    const other = document.getElementById("set-size");
    if (row === null || other === null) throw new Error("rows missing");
    expect(within(row).queryByRole("status")).toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: text.options.compact }));
    expect(within(row).getByRole("status").textContent).toBe(text.saved);
    // Other rows say nothing.
    expect(within(other).queryByRole("status")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1699);
    });
    expect(within(row).queryByRole("status")).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(within(row).queryByRole("status")).toBeNull();
  });
});
