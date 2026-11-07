// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { exampleChannelId as ch } from "@gratovo/core/data";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openRecord, peek } from "../lib/actions";
import { stubFindBridge } from "../lib/find-test-bridge";
import { initPrefs } from "../lib/prefs";
import { appStore, resetAppStoreForTests, selectRoute } from "../lib/store";
import { strings } from "../strings";
import { App } from "./app";

beforeEach(() => {
  stubFindBridge();
  localStorage.clear();
  initPrefs();
  resetAppStoreForTests({ screen: "today", tab: null });
});

afterEach(cleanup);

const c = (id: string) => ({ kind: "creator" as const, id: ch(id) });
const press = (key: string) => fireEvent.keyDown(document, { key, altKey: true });
const step = () => document.querySelector('[data-ui="record.page.step"]');
const at = () => selectRoute(appStore().getState()).record?.id;

describe("the record page list", () => {
  it("shows no stepper without a list or with one record", () => {
    render(<App />);
    act(() => {
      openRecord(c("c1"));
    });
    expect(step()).toBeNull();
    act(() => {
      openRecord(c("c1"), [c("c1")]);
    });
    expect(step()).toBeNull();
  });

  it("shows the counter and steps with the buttons and Alt+Up and Alt+Down", () => {
    render(<App />);
    act(() => {
      openRecord(c("c2"), [c("c1"), c("c2"), c("c3")]);
    });
    expect(step()?.textContent).toContain(strings.peek.counter(2, 3));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${strings.peek.next}`) }));
    expect(at()).toBe(ch("c3"));
    expect(step()?.textContent).toContain(strings.peek.counter(3, 3));
    act(() => {
      press("ArrowUp");
    });
    expect(at()).toBe(ch("c2"));
    act(() => {
      press("ArrowDown");
    });
    expect(at()).toBe(ch("c3"));
  });

  it("leaves the keys to the side panel while it is open", () => {
    render(<App />);
    act(() => {
      openRecord(c("c1"), [c("c1"), c("c2"), c("c3")]);
    });
    act(() => {
      peek(c("c2"), [ch("c1"), ch("c2"), ch("c3")]);
    });
    act(() => {
      press("ArrowDown");
    });
    expect(at()).toBe(ch("c1"));
    expect(appStore().getState().ui.peek?.record.id).toBe(ch("c3"));
  });
});
