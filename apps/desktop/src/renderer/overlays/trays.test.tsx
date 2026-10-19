// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
const bell = () => screen.getByRole("button", { name: strings.top.notifications });
const jobsButton = () => screen.getByRole("button", { name: strings.top.jobs });
const notificationsTray = () => screen.queryByRole("dialog", { name: strings.top.notifications });
const markAll = () => screen.getByRole("button", { name: strings.trays.markAllRead });
const badge = () => within(bell()).queryByText(/^\d+$/)?.textContent;

describe("the notifications tray", () => {
  it("toggles with the bell and shows it pressed", async () => {
    render(<App />);
    expect(bell().getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(bell());
    expect(notificationsTray()).not.toBeNull();
    expect(bell().getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(bell());
    expect(notificationsTray()).toBeNull();
    expect(bell().getAttribute("aria-pressed")).toBe("false");
  });

  it("closes on a press outside, but a press on the bell leaves the toggle to its click", async () => {
    render(<App />);
    await userEvent.click(bell());
    fireEvent.mouseDown(bell());
    expect(notificationsTray()).not.toBeNull();
    fireEvent.click(bell());
    expect(notificationsTray()).toBeNull();

    await userEvent.click(bell());
    fireEvent.mouseDown(document.body);
    expect(notificationsTray()).toBeNull();
  });

  it("stays open when the tray itself is pressed", async () => {
    render(<App />);
    await userEvent.click(bell());
    const tray = notificationsTray();
    if (tray === null) throw new Error("no tray");
    fireEvent.mouseDown(tray);
    expect(notificationsTray()).not.toBeNull();
  });

  it("closes with Esc", async () => {
    render(<App />);
    await userEvent.click(bell());
    press("Escape");
    expect(notificationsTray()).toBeNull();
  });

  it("marks all read, and Ctrl+Z brings the badge back with an Undone toast", async () => {
    render(<App />);
    expect(badge()).toBe("3");
    await userEvent.click(bell());
    await userEvent.click(markAll());
    expect(badge()).toBeUndefined();
    press("Escape");
    press("z", { ctrlKey: true });
    expect(badge()).toBe("3");
    expect(screen.getByText(strings.actions.undone)).toBeTruthy();
  });

  it("reads a notification when it is clicked, closes and goes to its screen", async () => {
    render(<App />);
    await userEvent.click(bell());
    await userEvent.click(screen.getByRole("button", { name: /outreach3 slowed/ }));
    expect(badge()).toBe("2");
    expect(notificationsTray()).toBeNull();
    expect(route()).toEqual({ screen: "reach", tab: "mailboxes" });
  });
});

describe("the jobs tray", () => {
  it("says nothing of yours is running and shows Omar's search", async () => {
    render(<App />);
    await userEvent.click(jobsButton());
    const tray = screen.getByRole("dialog", { name: strings.top.jobs });
    expect(within(tray).getByText(strings.trays.noJobs)).toBeTruthy();
    expect(within(tray).getByText(strings.trays.mateRunning("Omar", 12, 40))).toBeTruthy();
  });

  it("swaps to the other tray when the other button is used", async () => {
    render(<App />);
    await userEvent.click(jobsButton());
    await userEvent.click(bell());
    expect(notificationsTray()).not.toBeNull();
    expect(screen.queryByRole("dialog", { name: strings.top.jobs })).toBeNull();
  });
});
