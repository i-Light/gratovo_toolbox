// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { App } from "../app/app";
import { initPrefs } from "../lib/prefs";
import { appStore, resetAppStoreForTests, selectRoute } from "../lib/store";
import { strings } from "../strings";

const text = strings.settings;
const { groups } = strings.palette;

beforeEach(() => {
  localStorage.clear();
  initPrefs();
  resetAppStoreForTests({ screen: "today", tab: null });
});

afterEach(cleanup);

const input = () => screen.getByRole("combobox", { name: strings.palette.inputLabel });

describe("the palette's Settings group", () => {
  it("lists the rows that match, under a Settings heading", async () => {
    render(<App />);
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    await userEvent.type(input(), "compact");
    const group = screen.getByRole("group", { name: groups.settings });
    expect(
      within(group)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual([expect.stringContaining(text.rows.density.label)]);
  });

  it("opens Appearance with the Density row highlighted and focused when Density is chosen", async () => {
    render(<App />);
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    await userEvent.type(input(), "compact");
    const group = screen.getByRole("group", { name: groups.settings });
    await userEvent.click(within(group).getByRole("option"));
    expect(selectRoute(appStore().getState())).toMatchObject({
      screen: "settings",
      tab: "appearance",
    });
    expect(screen.queryByRole("dialog", { name: strings.palette.label })).toBeNull();
    const row = document.getElementById("set-density");
    expect(row?.classList.contains("hl")).toBe(true);
    expect(document.activeElement).toBe(row?.querySelector("button"));
  });
});
