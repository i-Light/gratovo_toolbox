// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { App } from "../app/app";
import { peek } from "../lib/actions";
import { initPrefs } from "../lib/prefs";
import { resetAppStoreForTests } from "../lib/store";
import { strings } from "../strings";

beforeEach(() => {
  localStorage.clear();
  initPrefs();
  resetAppStoreForTests({ screen: "today", tab: null });
});

afterEach(cleanup);

const escape = () => fireEvent.keyDown(document, { key: "Escape" });
const peekPanel = () => screen.queryByRole("complementary", { name: strings.peek.label });
const tray = () => screen.queryByRole("dialog", { name: strings.top.notifications });
const palette = () => screen.queryByRole("dialog", { name: strings.palette.label });
const openPeek = () => {
  act(() => {
    peek({ kind: "creator", id: "c1" });
  });
};

describe("Esc closes the layer opened last (E2)", () => {
  it("closes the palette over the peek and leaves the peek", () => {
    render(<App />);
    openPeek();
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(palette()).not.toBeNull();
    escape();
    expect(palette()).toBeNull();
    expect(peekPanel()).not.toBeNull();
    escape();
    expect(peekPanel()).toBeNull();
  });

  it("closes a tray opened after the peek first", async () => {
    render(<App />);
    openPeek();
    await userEvent.click(screen.getByRole("button", { name: strings.top.notifications }));
    escape();
    expect(tray()).toBeNull();
    expect(peekPanel()).not.toBeNull();
    escape();
    expect(peekPanel()).toBeNull();
  });

  it("closes a peek opened after the tray first", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: strings.top.notifications }));
    openPeek();
    escape();
    expect(peekPanel()).toBeNull();
    expect(tray()).not.toBeNull();
    escape();
    expect(tray()).toBeNull();
  });
});
