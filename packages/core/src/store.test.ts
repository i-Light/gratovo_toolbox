import { describe, expect, it, vi } from "vitest";

import { createStore } from "./store";

interface Data {
  count: number;
  items: string[];
  job?: string;
}
interface Ui {
  tab: string;
}

function make(options: { undoLimit?: number; now?: () => number } = {}) {
  return createStore<Data, Ui>({ data: { count: 0, items: [] }, ui: { tab: "a" }, ...options });
}

describe("store.act", () => {
  it("records a step and returns the recipe's result", () => {
    const store = make({ now: () => 42 });
    const result = store.act("Add", (d) => {
      d.count += 1;
      return "done";
    });
    expect(result).toBe("done");
    expect(store.getState().data.count).toBe(1);
    expect(store.peekUndo()).toEqual({
      id: 1,
      label: "Add",
      data: { count: 0, items: [] },
      at: 42,
    });
  });

  it("drops draft edits and records nothing when the recipe returns false", () => {
    const store = make();
    const listener = vi.fn();
    store.subscribe(listener);
    const before = store.getState();
    const result = store.act("Nope", (d) => {
      d.count = 99;
      return false;
    });
    expect(result).toBe(false);
    expect(store.getState()).toBe(before);
    expect(store.getState().data.count).toBe(0);
    expect(store.peekUndo()).toBeUndefined();
    expect(listener).not.toHaveBeenCalled();
  });

  it("records nothing and notifies nobody when nothing changed, but returns the result", () => {
    const store = make();
    const listener = vi.fn();
    store.subscribe(listener);
    const before = store.getState();
    expect(store.act("Nothing", () => 7)).toBe(7);
    expect(store.getState()).toBe(before);
    expect(store.peekUndo()).toBeUndefined();
    expect(listener).not.toHaveBeenCalled();
  });

  it("passes the ui to the recipe", () => {
    const store = make();
    store.act("Copy tab", (d, ui) => {
      d.items.push(ui.tab);
    });
    expect(store.getState().data.items).toEqual(["a"]);
  });

  it("clears the redo list on a new act", () => {
    const store = make();
    store.act("One", (d) => void (d.count = 1));
    store.undo();
    expect(store.canRedo()).toBe(true);
    store.act("Two", (d) => void (d.count = 2));
    expect(store.canRedo()).toBe(false);
    expect(store.redo()).toBeUndefined();
  });

  it("drops the oldest step past the undo limit", () => {
    const store = make({ undoLimit: 3 });
    for (let i = 1; i <= 5; i += 1) {
      store.act(`Step ${String(i)}`, (d) => void (d.count = i));
    }
    const labels: string[] = [];
    for (let step = store.undo(); step !== undefined; step = store.undo()) {
      labels.push(step.label);
    }
    expect(labels).toEqual(["Step 5", "Step 4", "Step 3"]);
    expect(store.getState().data.count).toBe(2);
  });

  it("freezes the state objects", () => {
    const store = make();
    expect(Object.isFrozen(store.getState().data)).toBe(true);
    expect(Object.isFrozen(store.getState().ui)).toBe(true);
    store.act("Add", (d) => void d.items.push("x"));
    expect(Object.isFrozen(store.getState().data)).toBe(true);
    expect(Object.isFrozen(store.getState().data.items)).toBe(true);
    store.ui((u) => void (u.tab = "b"));
    expect(Object.isFrozen(store.getState().ui)).toBe(true);
  });
});

describe("store undo and redo", () => {
  it("restores data and returns the step", () => {
    const store = make();
    store.act("One", (d) => void (d.count = 1));
    store.act("Two", (d) => void (d.count = 2));
    const undone = store.undo();
    expect(undone?.label).toBe("Two");
    expect(store.getState().data.count).toBe(1);
    expect(store.canRedo()).toBe(true);
    const redone = store.redo();
    expect(redone?.label).toBe("Two");
    expect(store.getState().data.count).toBe(2);
    expect(store.canRedo()).toBe(false);
  });

  it("returns undefined with nothing to undo", () => {
    const store = make();
    const listener = vi.fn();
    store.subscribe(listener);
    expect(store.undo()).toBeUndefined();
    expect(listener).not.toHaveBeenCalled();
  });

  it("grows ids per recorded act and keeps them through undo and redo", () => {
    const store = make();
    store.act("One", (d) => void (d.count = 1));
    store.act("Two", (d) => void (d.count = 2));
    expect(store.peekUndo()?.id).toBe(2);
    expect(store.undo()?.id).toBe(2);
    expect(store.undo()?.id).toBe(1);
    expect(store.redo()?.id).toBe(1);
    expect(store.peekUndo()?.id).toBe(1);
    expect(store.redo()?.id).toBe(2);
    expect(store.peekUndo()?.id).toBe(2);
    store.act("Three", (d) => void (d.count = 3));
    expect(store.peekUndo()?.id).toBe(3);
  });

  it("does not use an id for an act that records nothing", () => {
    const store = make();
    store.act("Nothing", () => undefined);
    store.act("Real", (d) => void (d.count = 1));
    expect(store.peekUndo()?.id).toBe(1);
  });

  it("uses the injected clock for redo steps too", () => {
    let t = 10;
    const store = make({ now: () => t });
    store.act("One", (d) => void (d.count = 1));
    t = 20;
    store.undo();
    t = 30;
    expect(store.redo()?.at).toBe(20);
  });
});

describe("store.bg", () => {
  it("changes current data and every undo and redo step", () => {
    const store = make({ now: () => 5 });
    store.act("One", (d) => void (d.count = 1));
    store.act("Two", (d) => void (d.count = 2));
    store.undo(); // redo holds "Two"
    store.bg((d) => void (d.job = "result"));
    expect(store.getState().data.job).toBe("result");
    expect(store.peekUndo()).toMatchObject({ id: 1, label: "One", at: 5, data: { job: "result" } });
    const undone = store.undo();
    expect(undone?.data.job).toBe("result");
    expect(store.getState().data).toEqual({ count: 0, items: [], job: "result" });
    const redone = store.redo();
    expect(redone?.data.job).toBe("result");
    store.redo();
    expect(store.getState().data).toEqual({ count: 2, items: [], job: "result" });
  });

  it("notifies once, and not at all when nothing changed", () => {
    const store = make();
    store.act("One", (d) => void (d.count = 1));
    const listener = vi.fn();
    store.subscribe(listener);
    store.bg((d) => void (d.job = "x"));
    expect(listener).toHaveBeenCalledTimes(1);
    store.bg(() => undefined);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("doesn't notify when only older steps change", () => {
    const store = make();
    store.act("One", (d) => void (d.count = 1));
    const listener = vi.fn();
    store.subscribe(listener);
    // Only the step before "One" has count 0, so only it changes.
    store.bg((d) => {
      if (d.count === 0) {
        d.job = "x";
      }
    });
    expect(listener).not.toHaveBeenCalled();
    expect(store.peekUndo()?.data.job).toBe("x");
    expect(store.getState().data.job).toBeUndefined();
  });
});

describe("store.ui", () => {
  it("changes ui without touching the undo list", () => {
    const store = make();
    const data = store.getState().data;
    store.ui((u) => void (u.tab = "b"));
    expect(store.getState().ui.tab).toBe("b");
    expect(store.getState().data).toBe(data);
    expect(store.peekUndo()).toBeUndefined();
    expect(store.canRedo()).toBe(false);
  });

  it("gives the recipe the data, and ignores a change-free recipe", () => {
    const store = make();
    const listener = vi.fn();
    store.subscribe(listener);
    store.ui((u, d) => void (u.tab = `count ${String(d.count)}`));
    expect(store.getState().ui.tab).toBe("count 0");
    store.ui(() => undefined);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps the redo list", () => {
    const store = make();
    store.act("One", (d) => void (d.count = 1));
    store.undo();
    store.ui((u) => void (u.tab = "b"));
    expect(store.canRedo()).toBe(true);
  });
});

describe("store.subscribe", () => {
  it("notifies once per committed change, in subscription order, and unsubscribes", () => {
    const store = make();
    const calls: string[] = [];
    const offA = store.subscribe(() => calls.push("a"));
    store.subscribe(() => calls.push("b"));
    store.act("One", (d) => void (d.count = 1));
    expect(calls).toEqual(["a", "b"]);
    store.undo();
    store.redo();
    store.ui((u) => void (u.tab = "z"));
    expect(calls).toHaveLength(8);
    offA();
    calls.length = 0;
    store.act("Two", (d) => void (d.count = 2));
    expect(calls).toEqual(["b"]);
  });

  it("sees the new state when a listener runs", () => {
    const store = make();
    let seen = -1;
    store.subscribe(() => {
      seen = store.getState().data.count;
    });
    store.act("One", (d) => void (d.count = 5));
    expect(seen).toBe(5);
  });
});
