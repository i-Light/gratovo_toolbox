// @vitest-environment happy-dom
import type { Comment, CommentNew, PrototypeStatus } from "@gratovo/ipc";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../app/app";
import { stubFindBridge } from "../lib/find-test-bridge";
import { initPrefs } from "../lib/prefs";
import {
  getPrototype,
  loadPrototype,
  resetPrototypeForTests,
  setPanel,
  toggleCommenting,
} from "../lib/prototype";
import { resetAppStoreForTests } from "../lib/store";
import { strings } from "../strings";

const t = strings.prototype.cmt;
const cardUi = "today.placeholder.card";

function make(n: number, over: Partial<Comment> = {}): Comment {
  return {
    id: `c${n.toString().padStart(6, "0")}`,
    at: 1_000 * n,
    status: "open",
    doneAt: null,
    kind: "fix",
    text: `Note number ${String(n)}`,
    scenario: "normal",
    place: { global: false, screen: "today", tab: null, record: null, peek: null },
    anchor: {
      ui: cardUi,
      path: "",
      tag: "div",
      text: "",
      label: `Card ${String(n)}`,
      rx: 0.5,
      ry: 0.5,
    },
    ...over,
  };
}

/** A bridge that answers the prototype channels; `seed` is what `comments:list` returns. */
function bridge(status: PrototypeStatus, seed: readonly Comment[] = []) {
  const invoke = vi.fn((channel: string, input: unknown) => {
    if (channel === "comments:list") {
      return Promise.resolve({ ok: true, value: { comments: seed } });
    }
    if (channel === "comments:add") {
      const saved: Comment = { ...make(9), ...(input as CommentNew), id: "cnew001", at: 9_000 };
      return Promise.resolve({ ok: true, value: saved });
    }
    return Promise.resolve({ ok: true, value: status });
  });
  (globalThis as { gratovo?: unknown }).gratovo = { invoke };
  return invoke;
}

const boxed = {
  left: 100,
  top: 100,
  width: 200,
  height: 60,
  right: 300,
  bottom: 160,
  x: 100,
  y: 100,
  toJSON: () => ({}),
};

beforeEach(() => {
  stubFindBridge();
  localStorage.clear();
  initPrefs();
  resetPrototypeForTests();
  resetAppStoreForTests({ screen: "today", tab: null });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(boxed);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.documentElement.classList.remove("cmt-mode");
});

describe("with prototype mode off", () => {
  it("renders no layer, and C does nothing", async () => {
    const invoke = bridge({ available: true, on: false, scenario: "normal" });
    const { container } = render(<App />);
    await act(() => loadPrototype());
    fireEvent.keyDown(document, { key: "c" });
    expect(getPrototype().commenting).toBe(false);
    expect(container.querySelector("[data-cmt-ui]")).toBeNull();
    expect(document.documentElement.classList.contains("cmt-mode")).toBe(false);
    expect(invoke.mock.calls.some(([channel]) => channel.startsWith("comments:"))).toBe(false);
  });
});

describe("with prototype mode on", () => {
  it("starts commenting on C, opens the composer on a click, saves, and shows the pin", async () => {
    const invoke = bridge({ available: true, on: true, scenario: "normal" });
    const { container } = render(<App />);
    await act(() => loadPrototype());

    fireEvent.keyDown(document, { key: "c" });
    expect(getPrototype().commenting).toBe(true);
    expect(document.documentElement.classList.contains("cmt-mode")).toBe(true);
    expect(screen.getByText(t.barHead)).toBeTruthy();

    const card = container.querySelector(`[data-ui="${cardUi}"]`);
    expect(card).not.toBeNull();
    fireEvent.click(card as Element, { clientX: 150, clientY: 130 });
    const dialog = screen.getByRole("dialog", { name: t.newComment });
    const field = within(dialog).getByRole("textbox", { name: t.commentLabel });
    await userEvent.type(field, "Make this clearer");
    await userEvent.click(within(dialog).getByRole("button", { name: new RegExp(`^${t.save}`) }));

    const add = invoke.mock.calls.find(([channel]) => channel === "comments:add");
    expect(add).toBeDefined();
    const sent = add?.[1] as CommentNew;
    expect(sent.anchor.ui).toBe(cardUi);
    expect(sent.text).toBe("Make this clearer");
    expect(sent.kind).toBe("fix");
    expect(sent.place.screen).toBe("today");
    expect(screen.queryByRole("dialog", { name: t.newComment })).toBeNull();
    expect(await screen.findByRole("button", { name: /^Comment 1:/ })).toBeTruthy();
  });

  it("stops commenting on Esc and takes the page class away", async () => {
    bridge({ available: true, on: true, scenario: "normal" });
    render(<App />);
    await act(() => loadPrototype());
    act(() => {
      toggleCommenting(true);
    });
    expect(document.documentElement.classList.contains("cmt-mode")).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(getPrototype().commenting).toBe(false);
    expect(document.documentElement.classList.contains("cmt-mode")).toBe(false);
    expect(screen.queryByText(t.barHead)).toBeNull();
  });

  it("filters the list by state", async () => {
    bridge({ available: true, on: true, scenario: "normal" }, [
      make(1),
      make(2, { status: "done", doneAt: 3_000 }),
    ]);
    render(<App />);
    await act(() => loadPrototype());
    act(() => {
      setPanel(true);
    });
    const list = screen.getByRole("complementary", { name: t.listLabel });
    expect(within(list).queryByText("Note number 1")).not.toBeNull();
    expect(within(list).queryByText("Note number 2")).toBeNull();
    await userEvent.click(within(list).getByRole("button", { name: t.filterDone }));
    expect(within(list).queryByText("Note number 1")).toBeNull();
    expect(within(list).queryByText("Note number 2")).not.toBeNull();
    await userEvent.click(within(list).getByRole("button", { name: t.filterAll }));
    expect(within(list).queryByText("Note number 1")).not.toBeNull();
    expect(within(list).queryByText("Note number 2")).not.toBeNull();
  });
});
