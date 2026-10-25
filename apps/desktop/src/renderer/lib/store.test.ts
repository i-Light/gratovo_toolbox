// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { exampleData } from "./example-data";
import type { Route } from "./routes";
import {
  appStore,
  back,
  dealName,
  findRecord,
  forward,
  go,
  initAppStore,
  installHashSync,
  memo,
  recordName,
  resetAppStoreForTests,
  selectProblems,
  selectRoute,
  setImportState,
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
    // The list is newest first now (G6), so n1 and n3 are found by id, not by position.
    const list = exampleData(now).notifications;
    const first = list.find((n) => n.id === "n1");
    const third = list.find((n) => n.id === "n3");
    expect(list.map((n) => n.at)).toEqual([...list.map((n) => n.at)].sort((a, b) => b - a));
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

describe("example records", () => {
  it("has the prototype's creators, brands, deals and teammate run", () => {
    const data = exampleData(now);
    // c6 to c10 and c13 are Reach's (plan step 6): contacts, emailed creators and a reply.
    expect(data.creators.map((c) => c.id)).toEqual([
      "c1",
      "c2",
      "c3",
      "c4",
      "c5",
      "c11",
      "c12",
      "c6",
      "c7",
      "c13",
      "c8",
      "c9",
      "c10",
    ]);
    expect(data.creators.filter((c) => c.stage === "new")).toHaveLength(2);
    expect(data.creators[0]).toEqual({
      id: "c1",
      name: "Prompt Lab",
      handle: "@promptlab",
      stage: "signed",
      email: "hello@promptlab.tv",
      emailConfirmed: false,
      contactName: null,
      contactSource: null,
      contactConfidence: null,
      rejectReason: null,
      rejectedAt: null,
      neverReason: null,
      archiveDueAt: null,
    });
    expect(data.creators.find((c) => c.id === "c12")?.email).toBeNull();
    expect(data.brands.map((b) => b.name)).toEqual([
      "Codewell",
      "Lumen AI",
      "VoxCraft",
      "Pagewise",
      "Clipforge",
    ]);
    expect(data.brands[4]).toMatchObject({ sells: "AI video editor", status: "negotiating" });
    expect(data.deals.map((d) => [d.id, d.step, d.price])).toEqual([
      ["d1", 1, 4800],
      ["d2", 3, 2600],
      ["d3", 6, 3400],
      ["d4", 7, 2200],
      ["d5", 0, 5200],
    ]);
    expect(data.mateRun).toMatchObject({ by: "u3", current: 12, total: 40 });
    expect(new Date(data.mateRun?.at ?? 0).getHours()).toBe(9);
  });

  it("starts with every overlay closed", () => {
    const ui = appStore().getState().ui;
    expect(ui).toMatchObject({
      palette: false,
      shortcuts: false,
      tray: null,
      menu: null,
      peek: null,
      toasts: [],
      recent: [],
      jobs: [],
    });
  });
});

describe("findRecord and names", () => {
  const data = exampleData(now);

  it("finds each kind of record, and nothing for a missing id", () => {
    expect(findRecord(data, { kind: "creator", id: "c3" })).toBe(data.creators[2]);
    expect(findRecord(data, { kind: "brand", id: "b2" })).toBe(data.brands[1]);
    expect(findRecord(data, { kind: "deal", id: "d1" })).toBe(data.deals[0]);
    expect(findRecord(data, { kind: "creator", id: "nope" })).toBeUndefined();
    expect(findRecord(data, { kind: "deal", id: "c1" })).toBeUndefined();
  });

  it("names a deal after its brand and creator", () => {
    expect(dealName(data, data.deals[0] as (typeof data.deals)[number])).toBe(
      "Codewell \u00d7 Code with Kai",
    );
    expect(recordName(data, { kind: "deal", id: "d5" })).toBe("Clipforge \u00d7 Tensor Talk");
    expect(recordName(data, { kind: "creator", id: "c1" })).toBe("Prompt Lab");
    expect(recordName(data, { kind: "brand", id: "b4" })).toBe("Pagewise");
    expect(recordName(data, { kind: "brand", id: "zzz" })).toBe("?");
  });
});

describe("go with overlays", () => {
  const ref = { kind: "creator", id: "c1" } as const;

  function openOverlays(): void {
    appStore().ui((ui) => {
      ui.peek = { record: ref, list: null };
      ui.menu = { label: "Account", x: 1, y: 2, right: 3, top: 0, align: "start", items: [] };
    });
  }

  it("closes the menu and the peek", () => {
    openOverlays();
    go("find");
    expect(appStore().getState().ui.menu).toBeNull();
    expect(appStore().getState().ui.peek).toBeNull();
  });

  it("keeps the peek with keepPeek, but still closes the menu", () => {
    openOverlays();
    go("find", undefined, { keepPeek: true });
    expect(appStore().getState().ui.menu).toBeNull();
    expect(appStore().getState().ui.peek?.record).toEqual(ref);
  });

  it("closes the peek on back and forward", () => {
    go("find");
    openOverlays();
    back();
    expect(appStore().getState().ui.peek).toBeNull();
    appStore().ui((ui) => {
      ui.peek = { record: ref, list: null };
    });
    forward();
    expect(appStore().getState().ui.peek).toBeNull();
  });

  it("keeps the menu and the peek when the route doesn't change, as the prototype does", () => {
    go("find", "search");
    openOverlays();
    go("find", "search");
    expect(appStore().getState().ui.menu).not.toBeNull();
    expect(appStore().getState().ui.peek?.record).toEqual(ref);
  });

  it("keeps the peek when back or forward has nowhere to go", () => {
    openOverlays();
    back();
    expect(appStore().getState().ui.peek?.record).toEqual(ref);
    forward();
    expect(appStore().getState().ui.peek?.record).toEqual(ref);
  });

  it("opens a record route with its record and origin", () => {
    go("record", null, { record: ref, from: "find" });
    expect(route()).toEqual({ screen: "record", tab: null, record: ref, from: "find" });
    go("record", null, { record: { kind: "creator", id: "c2" }, from: "find" });
    expect(appStore().getState().ui.history.entries).toHaveLength(3);
  });
});

describe("the live gate", () => {
  const live = () => {
    initAppStore({ ...exampleData(now), source: "live" }, { screen: "find", tab: "search" });
  };

  it("sends a hidden screen or tab to the default route", () => {
    live();
    go("close");
    expect(route()).toEqual({ screen: "find", tab: "search" });
    go("reach", "mailboxes");
    expect(route()).toEqual({ screen: "find", tab: "search" });
    go("settings", "day");
    expect(route()).toEqual({ screen: "find", tab: "search" });
    go("settings", "writing");
    expect(route()).toEqual({ screen: "settings", tab: "writing" });
  });

  it("uses Connections as the default while the import has never happened", () => {
    live();
    setImportState("never");
    go("today");
    expect(route()).toEqual({ screen: "settings", tab: "connections" });
  });

  it("steps over hidden history entries", () => {
    live();
    appStore().ui((ui) => {
      ui.history = {
        entries: [
          { screen: "find", tab: "search" },
          { screen: "close", tab: "roster" },
          { screen: "settings", tab: "profile" },
        ],
        index: 2,
      } as never;
    });
    back();
    expect(route()).toEqual({ screen: "find", tab: "search" });
    forward();
    expect(route()).toEqual({ screen: "settings", tab: "profile" });
  });

  it("changes nothing on example data", () => {
    go("reach");
    expect(route().screen).toBe("reach");
    go("find", "triage");
    expect(route()).toEqual({ screen: "find", tab: "triage" });
  });
});
