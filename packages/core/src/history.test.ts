import { describe, expect, it } from "vitest";

import {
  canGoBack,
  canGoForward,
  currentRoute,
  historyLimit,
  pushRoute,
  startHistory,
  stepBack,
  stepForward,
} from "./history";

const same = (a: string, b: string): boolean => a === b;

describe("history", () => {
  it("starts with one entry", () => {
    const h = startHistory("a");
    expect(h.entries).toEqual(["a"]);
    expect(currentRoute(h)).toBe("a");
    expect(canGoBack(h)).toBe(false);
    expect(canGoForward(h)).toBe(false);
  });

  it("returns the same object when the route is the current one", () => {
    const h = startHistory("a");
    expect(pushRoute(h, "a", same)).toBe(h);
  });

  it("appends a new route", () => {
    const h = pushRoute(startHistory("a"), "b", same);
    expect(h.entries).toEqual(["a", "b"]);
    expect(currentRoute(h)).toBe("b");
  });

  it("drops forward entries when pushing after going back", () => {
    let h = pushRoute(pushRoute(startHistory("a"), "b", same), "c", same);
    h = stepBack(stepBack(h));
    h = pushRoute(h, "d", same);
    expect(h.entries).toEqual(["a", "d"]);
    expect(h.index).toBe(1);
    expect(canGoForward(h)).toBe(false);
  });

  it("drops the oldest past the limit and keeps the index on the new entry", () => {
    let h = startHistory("a");
    h = pushRoute(h, "b", same, 3);
    h = pushRoute(h, "c", same, 3);
    h = pushRoute(h, "d", same, 3);
    expect(h.entries).toEqual(["b", "c", "d"]);
    expect(h.index).toBe(2);
    expect(currentRoute(h)).toBe("d");
  });

  it("limits to historyLimit by default", () => {
    let h = startHistory("0");
    for (let i = 1; i <= historyLimit + 5; i += 1) {
      h = pushRoute(h, String(i), same);
    }
    expect(h.entries).toHaveLength(historyLimit);
    expect(h.index).toBe(historyLimit - 1);
    expect(currentRoute(h)).toBe(String(historyLimit + 5));
  });

  it("steps back and forward", () => {
    let h = pushRoute(startHistory("a"), "b", same);
    h = stepBack(h);
    expect(currentRoute(h)).toBe("a");
    expect(canGoBack(h)).toBe(false);
    expect(canGoForward(h)).toBe(true);
    h = stepForward(h);
    expect(currentRoute(h)).toBe("b");
    expect(canGoForward(h)).toBe(false);
    expect(canGoBack(h)).toBe(true);
  });

  it("returns the same object at the ends", () => {
    const start = startHistory("a");
    expect(stepBack(start)).toBe(start);
    expect(stepForward(start)).toBe(start);
    const two = pushRoute(start, "b", same);
    expect(stepForward(two)).toBe(two);
    const back = stepBack(two);
    expect(stepBack(back)).toBe(back);
  });
});
