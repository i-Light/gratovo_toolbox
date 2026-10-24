import { describe, expect, it } from "vitest";

import { screenOrder, screens } from "./routes";
import type { ScreenKey } from "./routes";
import { settingsSections } from "./settings";
import {
  defaultRoute,
  firstShownTab,
  isRouteShown,
  isScreenShown,
  isSettingsSectionShown,
  isTabShown,
  liveWired,
  shownTabs,
  startRoute,
} from "./wired";

const hidden: readonly ScreenKey[] = [
  "today",
  "reach",
  "close",
  "deliver",
  "insights",
  "toolbox",
  "team",
];

describe("on example data", () => {
  it("shows every screen, tab and section", () => {
    for (const key of [...screenOrder, "record" as const]) {
      expect(isScreenShown(key, "example")).toBe(true);
      expect(shownTabs(key, "example")).toEqual(screens[key].tabs);
    }
    expect(isTabShown("find", "triage", "example")).toBe(true);
    expect(settingsSections.every((s) => isSettingsSectionShown(s.key, "example"))).toBe(true);
  });

  it("opens on Today", () => {
    expect(defaultRoute("example", "never")).toEqual({ screen: "today", tab: null });
    expect(defaultRoute("example", "unknown")).toEqual({ screen: "today", tab: null });
    expect(startRoute("#/reach/board", "example", "unknown")).toEqual({
      screen: "reach",
      tab: "board",
    });
    expect(startRoute("", "example", "unknown")).toEqual({ screen: "today", tab: null });
  });
});

describe("on live data", () => {
  it("shows only Find, Settings and the record page", () => {
    for (const key of hidden) {
      expect(isScreenShown(key, "live")).toBe(false);
      expect(isTabShown(key, null, "live")).toBe(false);
    }
    for (const key of ["find", "settings", "record"] as const) {
      expect(isScreenShown(key, "live")).toBe(true);
    }
  });

  it("shows only the wired tabs", () => {
    expect(shownTabs("find", "live").map((t) => t.key)).toEqual([
      "search",
      "triage",
      "gallery",
      "contacts",
    ]);
    expect(isTabShown("find", "triage", "live")).toBe(true);
    expect(isTabShown("find", "gallery", "live")).toBe(true);
    expect(isTabShown("find", "contacts", "live")).toBe(true);
    expect(isTabShown("find", "search", "live")).toBe(true);
    expect(isTabShown("find", null, "live")).toBe(true);
    expect(firstShownTab("find", "live")).toBe("search");
    expect(firstShownTab("reach", "live")).toBeNull();
    expect(shownTabs("settings", "live").map((t) => t.key)).toEqual(liveWired.settings);
  });

  it("hides the Settings sections that are not wired", () => {
    for (const hiddenSection of ["day", "facts", "team"] as const) {
      expect(isSettingsSectionShown(hiddenSection, "live")).toBe(false);
    }
    for (const section of liveWired.settings) {
      expect(isSettingsSectionShown(section, "live")).toBe(true);
    }
  });

  it("opens on Connections on a first run, else on Find > Search", () => {
    expect(defaultRoute("live", "never")).toEqual({ screen: "settings", tab: "connections" });
    expect(defaultRoute("live", "imported")).toEqual({ screen: "find", tab: "search" });
    expect(defaultRoute("live", "unknown")).toEqual({ screen: "find", tab: "search" });
  });

  it("sends a hidden hash to the default route and keeps a wired one", () => {
    expect(startRoute("#/today", "live", "never")).toEqual({
      screen: "settings",
      tab: "connections",
    });
    expect(startRoute("", "live", "unknown")).toEqual({ screen: "find", tab: "search" });
    expect(startRoute("#/reach", "live", "unknown")).toEqual({ screen: "find", tab: "search" });
    expect(startRoute("#/settings/day", "live", "unknown")).toEqual({
      screen: "find",
      tab: "search",
    });
    expect(startRoute("#/settings/writing", "live", "never")).toEqual({
      screen: "settings",
      tab: "writing",
    });
    expect(isRouteShown({ screen: "find", tab: "contacts" }, "live")).toBe(true);
    expect(isRouteShown({ screen: "close", tab: null }, "live")).toBe(false);
  });
});
