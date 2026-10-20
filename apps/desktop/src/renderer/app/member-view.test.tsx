// @vitest-environment happy-dom
import { exampleFrame } from "@gratovo/core/data";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { peek } from "../lib/actions";
import { toAppData } from "../lib/frame";
import { initPrefs } from "../lib/prefs";
import { appStore, initAppStore, selectRoute } from "../lib/store";
import { buildCommands } from "../overlays/commands";
import { strings } from "../strings";
import { App } from "./app";

/** The example data seen as Omar (Scout, Outreach; no money): prices are held back, as main does. */
function memberData(now: number) {
  const frame = exampleFrame(now);
  return toAppData({
    ...frame,
    me: "u3",
    seesMoney: false,
    deals: frame.deals.map((d) => ({ ...d, price: null })),
    notifications: frame.notifications.filter((n) => n.icon !== "wallet" && n.icon !== "unlock"),
  });
}
const ownerData = (now: number) => toAppData(exampleFrame(now));

function start(
  as: "owner" | "member",
  screen: "today" | "settings" = "today",
  tab: string | null = null,
) {
  localStorage.clear();
  initPrefs();
  const now = Date.now();
  initAppStore(as === "owner" ? ownerData(now) : memberData(now), { screen, tab });
}

beforeEach(() => {
  start("owner");
});
afterEach(cleanup);

const route = () => selectRoute(appStore().getState());
const nav = () => within(screen.getByRole("navigation", { name: strings.settings.navLabel }));
const openAccountMenu = async () => {
  await userEvent.click(screen.getByRole("button", { name: /online/ }));
  return screen.getByRole("menu");
};

describe("what the owner sees", () => {
  it("has the owner sections, the Connections menu item and the money switch", async () => {
    start("owner", "settings", "notifications");
    render(<App />);
    for (const key of ["facts", "team", "connections"] as const) {
      expect(nav().getByText(strings.screens.settings.tabs[key])).toBeTruthy();
    }
    expect(screen.getByRole("switch", { name: strings.settings.notify.money.label })).toBeTruthy();
    const menu = await openAccountMenu();
    expect(within(menu).getByText(strings.menu.connections)).toBeTruthy();
  });
});

describe("what a member without money sees", () => {
  it("shows Omar's roles, no owner sections and no Connections menu item", async () => {
    start("member", "settings", "profile");
    render(<App />);
    expect(screen.getAllByText("Scout \u00b7 Outreach").length).toBeGreaterThan(0);
    for (const key of ["facts", "team", "connections"] as const) {
      expect(nav().queryByText(strings.screens.settings.tabs[key])).toBeNull();
    }
    expect(nav().getByText(strings.screens.settings.tabs.writing)).toBeTruthy();
    const menu = await openAccountMenu();
    expect(within(menu).queryByText(strings.menu.connections)).toBeNull();
    expect(within(menu).getByText(strings.menu.settings)).toBeTruthy();
  });

  it("lands on Profile from an owner-only address", () => {
    start("member", "settings", "connections");
    render(<App />);
    expect(
      screen.getByRole("heading", { level: 2, name: strings.screens.settings.tabs.profile }),
    ).toBeTruthy();
  });

  it("hides the Money switch in Notifications but keeps the others", () => {
    start("member", "settings", "notifications");
    render(<App />);
    expect(screen.queryByRole("switch", { name: strings.settings.notify.money.label })).toBeNull();
    expect(screen.getByRole("switch", { name: strings.settings.notify.reply.label })).toBeTruthy();
  });

  it("does not offer owner sections in the settings search", () => {
    start("member", "settings", "profile");
    render(<App />);
    fireEvent.change(screen.getByRole("textbox", { name: strings.settings.find }), {
      target: { value: "gmail" },
    });
    expect(screen.queryByText(strings.screens.settings.tabs.connections)).toBeNull();
  });

  it("shows a deal in the peek and the palette without an amount", () => {
    start("member");
    render(<App />);
    act(() => {
      peek({ kind: "deal", id: "d1" });
    });
    expect(document.body.textContent).not.toMatch(/\$\d/);
    const data = appStore().getState().data;
    expect(buildCommands(data, [], "").every((c) => !/\$\d/.test(c.sub ?? ""))).toBe(true);
    const deals = buildCommands(data, [], "a").filter(
      (c) => c.group === strings.palette.groups.deals,
    );
    expect(deals.every((c) => !(c.sub ?? "").includes("$"))).toBe(true);
    expect(route().screen).toBe("today");
  });
});
