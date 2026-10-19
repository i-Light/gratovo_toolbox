// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { exampleData } from "./example-data";
import type { Route } from "./routes";
import {
  appStore,
  back,
  forward,
  go,
  installHashSync,
  memo,
  resetAppStoreForTests,
  selectProblems,
  selectRoute,
  setRailOpen,
  useApp,
} from "./store";

const today: Route = { screen: "today", tab: null };
const now = new Date(2026, 9, 19, 10, 24, 0).getTime();

const route = (): Route => selectRoute(appStore().getState());

beforeEach(() => {
  resetAppStoreForTests(today, now);
});

afterEach(cleanup);

describe("exampleData", () => {
  it("has the team, counts and six notifications with three unread", () => {
    const data = exampleData(now);
    expect(data.me).toBe("u1");
    expect(data.myName).toBeNull();
    expect(data.team.map((m) => m.id)).toEqual(["u1", "u2", "u3", "u4"]);
    expect(data.team.find((m) => m.id === "u4")?.status).toBe("away");
    expect(data.counts).toEqual({
      today: 28,
      plannedMinutes: 90,
      find: 15,
      reach: 10,
      close: 6,
      deliver: 7,
    });
    expect(data.notifications).toHaveLength(6);
    expect(data.notifications.filter((n) => !n.read)).toHaveLength(3);
    expect(data.log).toEqual([]);
  });

  it("puts notification times on the right calendar days", () => {
    const [first, , third] = exampleData(now).notifications;
    expect(new Date(first?.at ?? 0).getDate()).toBe(19);
    expect(new Date(first?.at ?? 0).getHours()).toBe(8);
    expect(new Date(third?.at ?? 0).getDate()).toBe(18);
    expect(new Date(third?.at ?? 0).getHours()).toBe(17);
  });
});

describe("go", () => {
  it("opens the first tab, then the last tab used", () => {
    go("find");
    expect(route()).toEqual({ screen: "find", tab: "search" });
    go("find", "gallery");
    go("today");
    go("find");
    expect(route()).toEqual({ screen: "find", tab: "gallery" });
  });

  it("uses an explicit tab, and the first tab for a bad or null one", () => {
    go("reach", "mailboxes");
    expect(route().tab).toBe("mailboxes");
    go("reach", "nope");
    expect(route().tab).toBe("board");
    go("reach", "mailboxes");
    go("reach", null);
    expect(route().tab).toBe("board");
  });

  it("gives screens without tabs a null tab", () => {
    go("team", "anything");
    expect(route()).toEqual({ screen: "team", tab: null });
  });

  it("closes the drawer", () => {
    setRailOpen(true);
    expect(appStore().getState().ui.railOpen).toBe(true);
    go("find");
    expect(appStore().getState().ui.railOpen).toBe(false);
  });

  it("adds no history entry for the same route", () => {
    go("find");
    const before = appStore().getState().ui.history;
    go("find", "search");
    expect(appStore().getState().ui.history).toBe(before);
  });
});

describe("back and forward", () => {
  it("move through the history and record the last tab", () => {
    go("find", "triage");
    go("reach", "inbox");
    go("today");
    back();
    expect(route()).toEqual({ screen: "reach", tab: "inbox" });
    back();
    expect(route()).toEqual({ screen: "find", tab: "triage" });
    expect(appStore().getState().ui.lastTab).toEqual({ find: "triage", reach: "inbox" });
    forward();
    expect(route()).toEqual({ screen: "reach", tab: "inbox" });
    forward();
    forward();
    expect(route()).toEqual(today);
  });

  it("do nothing at the ends", () => {
    const before = appStore().getState().ui.history;
    back();
    expect(appStore().getState().ui.history).toBe(before);
    forward();
    expect(appStore().getState().ui.history).toBe(before);
  });
});

describe("resetAppStoreForTests", () => {
  it("replaces the store, starting on the given route", () => {
    go("find");
    const old = appStore();
    resetAppStoreForTests({ screen: "close", tab: "brands" }, now);
    expect(appStore()).not.toBe(old);
    expect(route()).toEqual({ screen: "close", tab: "brands" });
    expect(appStore().getState().ui.history.entries).toHaveLength(1);
    expect(appStore().getState().ui.lastTab).toEqual({ close: "brands" });
  });
});

describe("installHashSync", () => {
  let stop: () => void = () => undefined;
  afterEach(() => {
    stop();
    vi.restoreAllMocks();
  });

  it("writes the hash when the route changes and not on other changes", () => {
    const spy = vi.spyOn(history, "replaceState");
    stop = installHashSync();
    expect(spy).toHaveBeenLastCalledWith(null, "", "#/today");
    spy.mockClear();
    go("find", "triage");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenLastCalledWith(null, "", "#/find/triage");
    spy.mockClear();
    setRailOpen(true);
    appStore().ui((ui) => {
      ui.saving = true;
    });
    go("find", "triage");
    expect(spy).not.toHaveBeenCalled();
    back();
    expect(spy).toHaveBeenLastCalledWith(null, "", "#/today");
    expect(location.hash).toBe("#/today");
  });

  it("follows a reset and stops when told", () => {
    const spy = vi.spyOn(history, "replaceState");
    stop = installHashSync();
    spy.mockClear();
    resetAppStoreForTests({ screen: "deliver", tab: "money" }, now);
    expect(spy).toHaveBeenLastCalledWith(null, "", "#/deliver/money");
    stop();
    spy.mockClear();
    go("today");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("useApp", () => {
  it("re-renders only when the selected value changes", () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useApp((state) => state.ui.railOpen);
    });
    const first = renders;
    act(() => {
      go("find");
    });
    expect(renders).toBe(first);
    act(() => {
      setRailOpen(true);
    });
    expect(result.current).toBe(true);
    expect(renders).toBe(first + 1);
  });

  it("keeps following after a reset", () => {
    const { result } = renderHook(() => useApp(selectRoute));
    act(() => {
      resetAppStoreForTests({ screen: "team", tab: null }, now);
    });
    expect(result.current).toEqual({ screen: "team", tab: null });
    act(() => {
      go("insights");
    });
    expect(result.current).toEqual({ screen: "insights", tab: null });
  });
});

describe("memo and problems", () => {
  it("recomputes only when the input reference changes", () => {
    const compute = vi.fn((list: readonly number[]) => list.map((n) => n * 2));
    const doubled = memo(compute);
    const input = [1, 2];
    expect(doubled(input)).toBe(doubled(input));
    expect(compute).toHaveBeenCalledTimes(1);
    doubled([1, 2]);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("returns the same empty problems array every time", () => {
    expect(selectProblems()).toEqual([]);
    expect(selectProblems()).toBe(selectProblems());
  });
});

describe("the store at boot", () => {
  afterEach(() => {
    history.replaceState(null, "", "#");
    vi.resetModules();
  });

  it.each([
    ["#/close/brands", { screen: "close", tab: "brands" }],
    ["#/find/nowhere", { screen: "find", tab: "search" }],
    ["#/nowhere", { screen: "today", tab: null }],
  ] as const)("starts from the URL hash %s", async (hash, expected) => {
    history.replaceState(null, "", hash);
    vi.resetModules();
    // A fresh copy of the module makes its store from the hash, as the app does when it loads.
    const fresh = await import("./store");
    expect(fresh.selectRoute(fresh.appStore().getState())).toEqual(expected);
  });
});
