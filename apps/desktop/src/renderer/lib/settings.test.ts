import { describe, expect, it } from "vitest";

import { exampleData } from "./example-data";
import {
  notifShown,
  notifyKind,
  searchSettings,
  sectionsFor,
  rowsFor,
  settingsRows,
  settingsSections,
} from "./settings";
import type { AppData, Notification } from "./store";

const now = new Date(2026, 9, 19, 10, 24, 0).getTime();

function note(icon: Notification["icon"]): Notification {
  return {
    id: "n",
    at: now,
    icon,
    text: "t",
    sub: "s",
    go: { screen: "today", tab: null },
    read: false,
  };
}

describe("settingsSections", () => {
  it("lists the prototype's sections in order, in two groups", () => {
    expect(settingsSections.map((s) => s.key)).toEqual([
      "profile",
      "appearance",
      "day",
      "keyboard",
      "notifications",
      "search",
      "facts",
      "writing",
      "team",
      "connections",
      "prototype",
    ]);
    expect(settingsSections.map((s) => s.group)).toEqual([
      "you",
      "you",
      "you",
      "you",
      "you",
      "agency",
      "agency",
      "agency",
      "agency",
      "agency",
      "owner",
    ]);
    expect(settingsSections.map((s) => s.icon)).toEqual([
      "user",
      "moon",
      "sun",
      "keyboard",
      "bell",
      "scan",
      "sliders",
      "pen",
      "users",
      "gauge",
      "flask",
    ]);
  });

  it("says which step brings each section's rows", () => {
    const arrives = Object.fromEntries(settingsSections.map((s) => [s.key, s.arrives]));
    expect(arrives).toEqual({
      profile: null,
      appearance: null,
      day: 7,
      keyboard: null,
      notifications: null,
      search: null,
      writing: null,
      facts: 8,
      team: 9,
      connections: null,
      prototype: null,
    });
  });

  it("marks facts, team, connections and prototype as owner sections", () => {
    expect(settingsSections.filter((s) => s.owner).map((s) => s.key)).toEqual([
      "facts",
      "team",
      "connections",
      "prototype",
    ]);
  });
});

describe("settingsRows", () => {
  it("holds only the rows that exist now, in the prototype's order", () => {
    expect(settingsRows.map((r) => `${r.section}/${r.id}`)).toEqual([
      "profile/name",
      "profile/role",
      "appearance/density",
      "appearance/size",
      "appearance/motion",
      "appearance/rail",
      "keyboard/letters",
      "notifications/notify",
      "search/rulesCountries",
      "search/rulesMedian",
      "search/rulesUploads",
      "search/rulesPerKeyword",
      "search/rulesArchive",
      "search/rulesBand",
      "writing/writingRules",
      "connections/connOld",
      "connections/connMailApp",
      "connections/connMailboxes",
      "connections/connMailSettings",
      "connections/connGemini",
      "connections/connCourse",
      "connections/connYoutube",
      "connections/connPython",
      "connections/connProxies",
      "connections/connPacing",
      "connections/connAws",
      "connections/connSync",
      "prototype/proto",
      "prototype/scenario",
      "prototype/comments",
    ]);
  });
});

describe("notifyKind and notifShown", () => {
  it("gets the kind from the icon", () => {
    expect(notifyKind("reply")).toBe("reply");
    expect(notifyKind("wallet")).toBe("money");
    expect(notifyKind("unlock")).toBe("money");
    expect(notifyKind("forward")).toBe("handoff");
    expect(notifyKind("alert")).toBe("problem");
    expect(notifyKind("pause")).toBe("search");
    expect(notifyKind("scan")).toBe("search");
  });

  it("shows a kind unless it is turned off, and always shows problems", () => {
    const base = exampleData(now);
    const off: AppData = {
      ...base,
      settings: { notify: { reply: false, money: true, search: false } },
    };
    expect(notifShown(base, note("reply"))).toBe(true);
    expect(notifShown(off, note("reply"))).toBe(false);
    expect(notifShown(off, note("wallet"))).toBe(true);
    expect(notifShown(off, note("pause"))).toBe(false);
    expect(notifShown(off, note("forward"))).toBe(true);
    const problemsOff: AppData = { ...base, settings: { notify: { reply: false, search: false } } };
    expect(notifShown(problemsOff, note("alert"))).toBe(true);
  });
});

describe("searchSettings", () => {
  it("finds rows by label, words and section name", () => {
    expect(searchSettings("compact", true).rows.map((r) => r.id)).toEqual(["density"]);
    // The app is dark only for now, so there is no theme row to find.
    expect(searchSettings("dark", true).rows).toEqual([]);
    expect(searchSettings("sidebar", true).rows.map((r) => r.id)).toEqual(["rail"]);
    expect(searchSettings("appearance", true).rows.map((r) => r.id)).toEqual([
      "density",
      "size",
      "motion",
      "rail",
    ]);
  });

  it("finds sections by name, sub and words", () => {
    expect(searchSettings("gmail", true).sections.map((s) => s.key)).toEqual(["connections"]);
    expect(searchSettings("hours", true).sections.map((s) => s.key)).toEqual(["day"]);
    expect(searchSettings("snooze", true).sections.map((s) => s.key)).toEqual(["day"]);
    expect(searchSettings("Search rules", true).sections.map((s) => s.key)).toContain("search");
  });

  it("ignores case and trims the query", () => {
    expect(searchSettings("  DARK ", true)).toEqual(searchSettings("dark", true));
  });

  it("finds nothing for words that are not there, and no rows for sections that arrive later", () => {
    expect(searchSettings("zzzz", true)).toEqual({ rows: [], sections: [] });
    expect(searchSettings("hours", true).rows).toEqual([]);
  });
});

describe("owner-only sections", () => {
  it("hides facts, team and connections from a member, in the list and in the search", () => {
    const keys = (owner: boolean) => sectionsFor(owner).map((s) => s.key);
    expect(keys(true)).toEqual(expect.arrayContaining(["facts", "team", "connections"]));
    expect(keys(false)).not.toEqual(expect.arrayContaining(["connections"]));
    expect(keys(false).some((k) => ["facts", "team", "connections"].includes(k))).toBe(false);
    expect(searchSettings("gmail", false).sections).toEqual([]);
    // The owner sees the Connections rows too; nobody else does.
    expect(rowsFor(false).some((r) => r.section === "connections")).toBe(false);
    expect(rowsFor(true).filter((r) => r.section !== "connections")).toEqual(rowsFor(false));
  });
});

describe("the live gate", () => {
  it("hides the sections and rows that are not wired", () => {
    const keys = sectionsFor(true, "live").map((s) => s.key);
    expect(keys).toEqual([
      "profile",
      "appearance",
      "keyboard",
      "notifications",
      "search",
      "writing",
      "connections",
    ]);
    expect(sectionsFor(true, "example")).toHaveLength(10);
    expect(rowsFor(true, "live")).toEqual(rowsFor(true, "example"));
    expect(searchSettings("day", true, "live").sections.map((s) => s.key)).not.toContain("day");
    expect(searchSettings("day", true, "example").sections.map((s) => s.key)).toContain("day");
  });
});
