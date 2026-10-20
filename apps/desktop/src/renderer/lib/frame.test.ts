import { exampleFrame, notificationIcons } from "@gratovo/core/data";
import type { Frame } from "@gratovo/core/data";
import { icons } from "@gratovo/ui";
import { describe, expect, it } from "vitest";

import { strings } from "../strings";
import { toAppData } from "./frame";
import { appStore, initAppStore, resetAppStoreForTests } from "./store";

const now = new Date(2026, 9, 19, 10, 0).getTime();

function pick<T>(list: readonly T[], index: number): T {
  const item = list[index];
  if (item === undefined) {
    throw new Error("missing item");
  }
  return item;
}

function frameWith(patch: Partial<Frame>): Frame {
  return { ...exampleFrame(now), ...patch };
}

describe("toAppData", () => {
  it("shows a title as the role label, else the plain role", () => {
    const base = exampleFrame(now);
    const team = [
      { ...pick(base.team, 0), title: null, role: "full" as const },
      { ...pick(base.team, 1), title: "Account manager" },
      { ...pick(base.team, 2), title: null, role: "unauthorized" as const },
    ];
    const roles = toAppData(frameWith({ team })).team.map((m) => m.role);
    expect(roles).toEqual(["Full access", "Account manager", "Waiting for access"]);
  });

  it("always calls me 'You' in the team, named or not (the name is in myName)", () => {
    const base = exampleFrame(now);
    const me = pick(
      base.team.filter((m) => m.id === base.me),
      0,
    );
    const unnamed = toAppData(base).team.find((m) => m.id === base.me);
    expect(unnamed?.name).toBe(strings.team.you);
    const named = toAppData(
      frameWith({ team: base.team.map((m) => (m === me ? { ...m, name: "Ada" } : m)) }),
    );
    expect(named.team.find((m) => m.id === base.me)?.name).toBe(strings.team.you);
    const other = toAppData(frameWith({ team: [{ ...me, id: "u9", name: "" }], me: "u1" }));
    expect(other.team[0]?.name).toBe("");
  });

  it("keeps myName as it is", () => {
    expect(toAppData(frameWith({ myName: null })).myName).toBeNull();
    expect(toAppData(frameWith({ myName: "Ada" })).myName).toBe("Ada");
  });

  it("sends an unknown or incomplete route to Today, and keeps a good one", () => {
    const n = pick(exampleFrame(now).notifications, 0);
    const route = (go: { screen: string; tab: string | null }) =>
      toAppData(frameWith({ notifications: [{ ...n, go }] })).notifications[0]?.go;
    expect(route({ screen: "nowhere", tab: null })).toEqual({ screen: "today", tab: null });
    expect(route({ screen: "record", tab: null })).toEqual({ screen: "today", tab: null });
    expect(route({ screen: "toString", tab: null })).toEqual({ screen: "today", tab: null });
    expect(route({ screen: "reach", tab: "mailboxes" })).toEqual({
      screen: "reach",
      tab: "mailboxes",
    });
    expect(route({ screen: "reach", tab: "nope" })).toEqual({ screen: "reach", tab: null });
  });

  it("falls back to the bell for an unknown icon", () => {
    const n = pick(exampleFrame(now).notifications, 0);
    const out = toAppData(frameWith({ notifications: [{ ...n, icon: "nope" as never }] }));
    expect(out.notifications[0]?.icon).toBe("bell");
  });

  it("knows every notification icon", () => {
    for (const icon of notificationIcons) {
      expect(Object.hasOwn(icons, icon), icon).toBe(true);
    }
  });

  it("carries the example frame over, newest notification first", () => {
    const data = toAppData(exampleFrame(now));
    expect(data.counts.today).toBe(28);
    expect(data.team).toHaveLength(4);
    expect(data.notifications[0]?.id).toBe("n1");
    expect(data.settings.notify).toEqual({});
  });
});

describe("initAppStore", () => {
  it("replaces the data and starts on the given route", () => {
    resetAppStoreForTests({ screen: "today", tab: null }, now);
    initAppStore(toAppData(frameWith({ myName: "Ada" })), { screen: "find", tab: "search" });
    const state = appStore().getState();
    expect(state.data.myName).toBe("Ada");
    expect(state.ui.lastTab).toEqual({ find: "search" });
  });
});
