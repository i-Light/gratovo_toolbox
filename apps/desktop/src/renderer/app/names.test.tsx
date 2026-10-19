// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initPrefs, setPref } from "../lib/prefs";
import { resetAppStoreForTests } from "../lib/store";
import { strings } from "../strings";
import { App } from "./app";

beforeEach(() => {
  localStorage.clear();
  initPrefs();
  resetAppStoreForTests({ screen: "today", tab: null });
});

afterEach(cleanup);

describe("names match what you see (WCAG 2.5.3)", () => {
  it("names the expanded account button by its text: the name and the role line", () => {
    render(<App />);
    const button = screen.getByRole("button", {
      name: new RegExp(`^${strings.rail.addName}.*${strings.rail.roleOnline("Owner")}$`),
    });
    expect(button.hasAttribute("aria-label")).toBe(false);
    expect(button.hasAttribute("data-tip")).toBe(false);
    expect(button.textContent).toContain(strings.rail.addName);
    expect(button.textContent).toContain(strings.rail.roleOnline("Owner"));
  });

  it("names the collapsed account button 'Your account: ...' and keeps the longer tip", () => {
    setPref("rail", "min");
    render(<App />);
    const button = screen.getByRole("button", { name: strings.rail.account("You") });
    expect(button.getAttribute("data-tip")).toBe(strings.rail.memberTip("You", "Owner"));
  });

  it("names the bell with the unread count and keeps 'Notifications' as its tooltip", () => {
    render(<App />);
    const bell = screen.getByRole("button", { name: strings.top.notificationsUnread(3) });
    expect(bell.getAttribute("aria-label")).toBe("Notifications, 3 unread");
    expect(bell.getAttribute("data-tip")).toBe(strings.top.notifications);
  });
});
