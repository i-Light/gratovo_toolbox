import { describe, expect, it } from "vitest";

import { exampleData } from "./example-data";
import { notifShown, notifyKind, searchSettings, settingsRows, settingsSections } from "./settings";
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
    ]);
  });

  it("says which step brings each section's rows", () => {
    const arrives = Object.fromEntries(settingsSections.map((s) => [s.key, s.arrives]));
    expect(arrives).toEqual({
      profile: null,
      appearance: null,
      day: 4,
      keyboard: null,
      notifications: null,
      search: 5,
      writing: 6,
      facts: 7,
      team: 9,
      connections: 9,
    });
  });

  it("marks facts, team and connections as owner sections", () => {
    expect(settingsSections.filter((s) => s.owner).map((s) => s.key)).toEqual([
      "facts",
      "team",
      "connections",
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
    expect(searchSettings("compact").rows.map((r) => r.id)).toEqual(["density"]);
    // The app is dark only for now, so there is no theme row to find.
    expect(searchSettings("dark").rows).toEqual([]);
    expect(searchSettings("sidebar").rows.map((r) => r.id)).toEqual(["rail"]);
    expect(searchSettings("appearance").rows.map((r) => r.id)).toEqual([
      "density",
      "size",
      "motion",
      "rail",
    ]);
  });

  it("finds sections by name, sub and words", () => {
    expect(searchSettings("gmail").sections.map((s) => s.key)).toEqual(["connections"]);
    expect(searchSettings("hours").sections.map((s) => s.key)).toEqual(["day"]);
    expect(searchSettings("snooze").sections.map((s) => s.key)).toEqual(["day"]);
    expect(searchSettings("Search rules").sections.map((s) => s.key)).toContain("search");
  });

  it("ignores case and trims the query", () => {
    expect(searchSettings("  DARK ")).toEqual(searchSettings("dark"));
  });

  it("finds nothing for words that are not there, and no rows for sections that arrive later", () => {
    expect(searchSettings("zzzz")).toEqual({ rows: [], sections: [] });
    expect(searchSettings("hours").rows).toEqual([]);
  });
});
