// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { exampleChannelId as ch } from "@gratovo/core/data";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { App } from "../app/app";
import { peek } from "../lib/actions";
import { stubFindBridge } from "../lib/find-test-bridge";
import { initPrefs } from "../lib/prefs";
import { appStore, resetAppStoreForTests, selectRoute } from "../lib/store";
import { strings } from "../strings";

/** The bell's name starts with "Notifications" and adds the unread count while there is one. */
const bellName = new RegExp(`^${strings.top.notifications}`);

beforeEach(() => {
  stubFindBridge();
  localStorage.clear();
  initPrefs();
  resetAppStoreForTests({ screen: "today", tab: null });
});

afterEach(cleanup);

const press = (key: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(document, { key, ...init });
const route = () => selectRoute(appStore().getState());
const panel = () => screen.queryByRole("complementary", { name: strings.peek.label });
const hasPeek = () => document.querySelector(".body.has-peek") !== null;
const openFromPalette = async (name: string) => {
  press("k", { ctrlKey: true });
  await userEvent.type(screen.getByRole("combobox", { name: strings.palette.inputLabel }), name);
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
};

describe("the peek", () => {
  it("shows the brand record for a brand", () => {
    render(<App />);
    act(() => {
      peek({ kind: "brand", id: "b4" });
    });
    const side = panel();
    if (side === null) throw new Error("no peek");
    expect(within(side).getByRole("tablist", { name: strings.brandRecord.tabsLabel })).toBeTruthy();
    expect(within(side).getByRole("heading", { name: "Pagewise" })).toBeTruthy();
  });

  it("gives focus back to what had it when Esc closes it with focus inside", () => {
    render(<App />);
    const bell = screen.getByRole("button", { name: bellName });
    bell.focus();
    act(() => {
      peek({ kind: "creator", id: ch("c1") });
    });
    const side = panel();
    if (side === null) throw new Error("no peek");
    within(side).getByRole("button", { name: strings.peek.close }).focus();
    press("Escape");
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(bell);
  });

  it("opens from the palette with the record's summary", async () => {
    render(<App />);
    expect(hasPeek()).toBe(false);
    await openFromPalette("neural notes");
    expect(hasPeek()).toBe(true);
    const side = panel();
    if (side === null) throw new Error("no peek");
    // The creator's id is a channel id now: the peek asks the catalog, then shows the summary.
    expect(await within(side).findByRole("heading", { name: "Neural Notes" })).toBeTruthy();
    expect(within(side).getByText(/@neuralnotes/)).toBeTruthy();
    expect(within(side).getByText(strings.record.fullRecordLater)).toBeTruthy();
  });

  it("steps through its list with Alt+ArrowDown and Alt+ArrowUp, and stops at the ends", async () => {
    render(<App />);
    act(() => {
      peek({ kind: "creator", id: ch("c1") }, [ch("c1"), ch("c2"), ch("c3")]);
    });
    const side = () => within(panel() as HTMLElement);
    expect(side().getByText(strings.peek.counter(1, 3))).toBeTruthy();
    expect(await side().findByRole("heading", { name: "Prompt Lab" })).toBeTruthy();
    press("ArrowDown", { altKey: true });
    expect(await side().findByRole("heading", { name: "Neural Notes" })).toBeTruthy();
    expect(side().getByText(strings.peek.counter(2, 3))).toBeTruthy();
    press("ArrowDown", { altKey: true });
    press("ArrowDown", { altKey: true });
    expect(await side().findByRole("heading", { name: "Code with Kai" })).toBeTruthy();
    press("ArrowUp", { altKey: true });
    expect(await side().findByRole("heading", { name: "Neural Notes" })).toBeTruthy();
  });

  it("steps with its Previous and Next buttons, disabled at the ends", async () => {
    render(<App />);
    act(() => {
      peek({ kind: "creator", id: ch("c1") }, [ch("c1"), ch("c2")]);
    });
    const previous = screen.getByRole("button", { name: strings.peek.previous });
    const next = screen.getByRole("button", { name: strings.peek.next });
    expect(previous).toHaveProperty("disabled", true);
    await userEvent.click(next);
    expect(next).toHaveProperty("disabled", true);
    expect(
      within(panel() as HTMLElement).getByRole("heading", { name: "Neural Notes" }),
    ).toBeTruthy();
  });

  it("does not step when it has no list", async () => {
    render(<App />);
    act(() => {
      peek({ kind: "creator", id: ch("c1") });
    });
    press("ArrowDown", { altKey: true });
    expect(
      await within(panel() as HTMLElement).findByRole("heading", { name: "Prompt Lab" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: strings.peek.next })).toBeNull();
  });

  it("opens the record page with Full page; Back returns", async () => {
    render(<App />);
    act(() => {
      peek({ kind: "brand", id: "b5" });
    });
    await userEvent.click(screen.getByRole("button", { name: strings.peek.fullPage }));
    expect(route().screen).toBe("record");
    const crumbs = screen.getByRole("navigation", { name: strings.top.crumbs });
    expect(within(crumbs).getByText(strings.screens.today.name)).toBeTruthy();
    expect(within(crumbs).getByText("Clipforge")).toBeTruthy();
    const main = screen.getByRole("main");
    expect(within(main).getByRole("heading", { name: "Clipforge" })).toBeTruthy();

    await userEvent.click(within(main).getByRole("button", { name: strings.record.back }));
    expect(route().screen).toBe("today");
  });

  it("closes with Esc and with its Close button", async () => {
    render(<App />);
    act(() => {
      peek({ kind: "deal", id: "d1" });
    });
    expect(panel()).not.toBeNull();
    press("Escape");
    expect(panel()).toBeNull();
    expect(hasPeek()).toBe(false);
    act(() => {
      peek({ kind: "deal", id: "d1" });
    });
    await userEvent.click(
      within(panel() as HTMLElement).getByRole("button", { name: strings.peek.close }),
    );
    expect(panel()).toBeNull();
  });
});
