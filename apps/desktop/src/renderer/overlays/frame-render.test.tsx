// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../app/app";
import { Rail } from "../app/rail";
import { setPalette, toast } from "../lib/actions";
import { initPrefs } from "../lib/prefs";
import { appStore, resetAppStoreForTests } from "../lib/store";
import { strings } from "../strings";
import { Palette } from "./palette";
import { Toasts } from "./toasts";

beforeEach(() => {
  localStorage.clear();
  initPrefs();
  resetAppStoreForTests({ screen: "today", tab: null });
});

afterEach(cleanup);

describe("text fields keep their own undo (E3)", () => {
  it("does not undo the app with Ctrl+Z typed in an input, but does elsewhere", () => {
    render(<App />);
    act(() => {
      appStore().act("Rename", (data) => {
        data.myName = "Ada";
      });
    });
    const field = document.createElement("input");
    document.body.append(field);
    field.focus();
    fireEvent.keyDown(field, { key: "z", ctrlKey: true });
    fireEvent.keyDown(field, { key: "y", ctrlKey: true });
    expect(appStore().getState().data.myName).toBe("Ada");
    expect(screen.queryByText(strings.actions.undone)).toBeNull();
    field.remove();

    fireEvent.keyDown(document, { key: "z", ctrlKey: true });
    expect(appStore().getState().data.myName).toBeNull();
    expect(screen.getByText(strings.actions.undone)).toBeTruthy();
  });
});

describe("the frame", () => {
  it("does not re-render the rail when the palette opens or a toast shows", () => {
    const onRender = vi.fn();
    render(
      <>
        <Profiler id="rail" onRender={onRender}>
          <Rail />
        </Profiler>
        <Palette />
        <Toasts />
      </>,
    );
    onRender.mockClear();
    act(() => {
      setPalette(true);
    });
    expect(screen.getByRole("dialog", { name: strings.palette.label })).toBeTruthy();
    act(() => {
      toast({ msg: "Hello" });
    });
    expect(screen.getByText("Hello")).toBeTruthy();
    expect(onRender).not.toHaveBeenCalled();
  });
});
