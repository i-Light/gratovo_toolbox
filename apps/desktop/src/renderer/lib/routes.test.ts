import { describe, expect, it } from "vitest";

import {
  firstTab,
  goLetters,
  routeFromHash,
  routeToHash,
  sameRoute,
  screenOrder,
  screens,
} from "./routes";
import type { Route } from "./routes";

describe("routes", () => {
  it("round-trips every screen and tab through the hash", () => {
    for (const key of screenOrder) {
      const info = screens[key];
      const routes: Route[] =
        info.tabs.length === 0
          ? [{ screen: key, tab: null }]
          : info.tabs.map((tab) => ({ screen: key, tab: tab.key }));
      for (const route of routes) {
        expect(routeFromHash(routeToHash(route))).toEqual(route);
      }
    }
  });

  it("writes #/screen and #/screen/tab", () => {
    expect(routeToHash({ screen: "today", tab: null })).toBe("#/today");
    expect(routeToHash({ screen: "find", tab: "triage" })).toBe("#/find/triage");
  });

  it("reads the prototype's old #find form", () => {
    expect(routeFromHash("#find")).toEqual({ screen: "find", tab: "search" });
    expect(routeFromHash("#today")).toEqual({ screen: "today", tab: null });
  });

  it("gives Today for an unknown screen or an empty hash", () => {
    for (const hash of [
      "",
      "#",
      "#/",
      "#/nowhere",
      "#/plan",
      "#rec",
      "#/toString",
      "#/__proto__",
    ]) {
      expect(routeFromHash(hash)).toEqual({ screen: "today", tab: null });
    }
  });

  it("gives the first tab for an unknown tab", () => {
    expect(routeFromHash("#/reach/nope")).toEqual({ screen: "reach", tab: "board" });
    expect(routeFromHash("#/settings")).toEqual({ screen: "settings", tab: "profile" });
    expect(routeFromHash("#/team/anything")).toEqual({ screen: "team", tab: null });
  });

  it("compares routes by screen and tab", () => {
    expect(sameRoute({ screen: "find", tab: "search" }, { screen: "find", tab: "search" })).toBe(
      true,
    );
    expect(sameRoute({ screen: "find", tab: "search" }, { screen: "find", tab: "triage" })).toBe(
      false,
    );
    expect(sameRoute({ screen: "find", tab: null }, { screen: "reach", tab: null })).toBe(false);
  });

  it("finds the first tab, or null", () => {
    expect(firstTab("find")).toBe("search");
    expect(firstTab("close")).toBe("roster");
    expect(firstTab("today")).toBeNull();
    expect(firstTab("team")).toBeNull();
  });

  it("has a name for every screen and every tab", () => {
    for (const key of screenOrder) {
      const info = screens[key];
      expect(info.name.length).toBeGreaterThan(0);
      expect(info.sub === null || info.sub.length > 0).toBe(true);
      for (const tab of info.tabs) {
        expect(tab.key.length).toBeGreaterThan(0);
        expect(tab.name.length).toBeGreaterThan(0);
      }
    }
  });

  it("lists every screen once, and maps the go letters to screens", () => {
    expect(new Set(screenOrder).size).toBe(screenOrder.length);
    expect(screenOrder).toEqual(Object.keys(screens).filter((key) => key !== "record"));
    expect(screenOrder).not.toContain("record");
    expect(goLetters).toEqual({
      t: "today",
      f: "find",
      r: "reach",
      c: "close",
      d: "deliver",
      i: "insights",
      x: "toolbox",
      m: "team",
      s: "settings",
    });
    for (const screen of Object.values(goLetters)) {
      expect(screens[screen]).toBeDefined();
    }
  });

  it("writes a record route as #/record/kind/id and reads it back as Today", () => {
    const route: Route = {
      screen: "record",
      tab: null,
      record: { kind: "creator", id: "c1" },
      from: "find",
    };
    expect(routeToHash(route)).toBe("#/record/creator/c1");
    expect(routeFromHash("#/record/creator/c1")).toEqual({ screen: "today", tab: null });
    expect(routeFromHash("#/record")).toEqual({ screen: "today", tab: null });
  });

  it("tells records and the screen they came from apart", () => {
    const a: Route = {
      screen: "record",
      tab: null,
      record: { kind: "creator", id: "c1" },
      from: "find",
    };
    expect(sameRoute(a, { ...a })).toBe(true);
    expect(sameRoute(a, { ...a, record: { kind: "creator", id: "c2" } })).toBe(false);
    expect(sameRoute(a, { ...a, record: { kind: "brand", id: "c1" } })).toBe(false);
    expect(sameRoute(a, { ...a, from: "reach" })).toBe(false);
  });

  it("names the record screen from strings and keeps it out of the go letters", () => {
    expect(screens.record.name).toBe("Record");
    expect(screens.record.tabs).toEqual([]);
    expect(Object.values(goLetters)).not.toContain("record");
  });
});
