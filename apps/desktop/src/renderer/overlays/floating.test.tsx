// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { App } from "../app/app";
import { toast } from "../lib/actions";
import { initPrefs } from "../lib/prefs";
import { resetAppStoreForTests } from "../lib/store";
import { strings } from "../strings";

beforeEach(() => {
  localStorage.clear();
  initPrefs();
  resetAppStoreForTests({ screen: "today", tab: null });
});

afterEach(cleanup);

describe("the floating container", () => {
  it("moves into the open palette and back out without remounting a toast", () => {
    render(<App />);
    act(() => {
      toast({ msg: "Saved the note" });
    });
    const shown = screen.getByText("Saved the note");
    expect(shown.closest("dialog")).toBeNull();

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    const palette = screen.getByRole("dialog", { name: strings.palette.label });
    expect(within(palette).getByText("Saved the note")).toBe(shown);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: strings.palette.label })).toBeNull();
    expect(screen.getByText("Saved the note")).toBe(shown);
    expect(shown.isConnected).toBe(true);
    expect(shown.closest("dialog")).toBeNull();
  });

  it("shows a toast made while the palette is open inside it", () => {
    render(<App />);
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    act(() => {
      toast({ msg: "While open" });
    });
    const palette = screen.getByRole("dialog", { name: strings.palette.label });
    expect(within(palette).getByText("While open")).toBeTruthy();
  });
});
