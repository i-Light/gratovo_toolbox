import { describe, expect, it } from "vitest";

import { DEAL_FLOW } from "../deal-flow";
import { exampleFrame, exampleSeed, exampleSeedVersion } from "./example";
import { creatorStages, notificationIcons } from "./types";

/** 20 October 2026, 10:30 local time. */
const now = new Date(2026, 9, 20, 10, 30).getTime();

/** A time on the day of `now` plus `dayOffset` days, at that hour and minute (local time). */
const on = (dayOffset: number, hours: number, minutes: number): number =>
  new Date(2026, 9, 20 + dayOffset, hours, minutes).getTime();

describe("exampleSeed", () => {
  const seed = exampleSeed(now);

  it("has a positive whole version", () => {
    expect(Number.isInteger(exampleSeedVersion)).toBe(true);
    expect(exampleSeedVersion).toBeGreaterThan(0);
  });

  it("seeds the team: your name unset, you with full access, the others basic", () => {
    expect(seed.me).toBe("u1");
    expect(seed.profiles).toEqual([
      { id: "u1", displayName: "", role: "full" },
      { id: "u2", displayName: "Sara", role: "basic" },
      { id: "u3", displayName: "Omar", role: "basic" },
      { id: "u4", displayName: "Lina", role: "basic" },
    ]);
  });

  it("gives every member presence and a title", () => {
    expect(seed.presence).toEqual({
      u1: { status: "online", doing: "Today", title: "Owner" },
      u2: { status: "online", doing: "Reach · replies", title: "Account manager" },
      u3: { status: "online", doing: "Search · keyword 12 of 40", title: "VA" },
      u4: { status: "away", doing: "Away until 13:00", title: "VA · first week" },
    });
  });

  it("dates the notifications from `now`, newest first", () => {
    expect(seed.notifications.map((n) => [n.id, n.at])).toEqual([
      ["n1", on(0, 8, 42)],
      ["n2", on(0, 8, 31)],
      ["n4", on(0, 0, 5)],
      ["n3", on(-1, 17, 0)],
      ["n6", on(-1, 11, 0)],
      ["n5", on(-4, 15, 10)],
    ]);
  });

  it("uses only notification icons the contract knows", () => {
    for (const n of seed.notifications) {
      expect(notificationIcons).toContain(n.icon);
    }
  });

  it("starts Omar's run at 09:02 on the day it is asked about", () => {
    expect(seed.mateRun(now)).toEqual({ by: "u3", at: on(0, 9, 2), current: 12, total: 40 });
    expect(seed.mateRun(on(1, 12, 0))).toEqual({
      by: "u3",
      at: on(1, 9, 2),
      current: 12,
      total: 40,
    });
  });

  it("keeps its records consistent: known stages, steps and links, unique ids", () => {
    for (const c of seed.creators) {
      expect(creatorStages).toContain(c.stage);
    }
    const creatorIds = new Set(seed.creators.map((c) => c.id));
    const brandIds = new Set(seed.brands.map((b) => b.id));
    expect(creatorIds.size).toBe(seed.creators.length);
    expect(brandIds.size).toBe(seed.brands.length);
    expect(new Set(seed.deals.map((d) => d.id)).size).toBe(seed.deals.length);
    for (const d of seed.deals) {
      expect(brandIds.has(d.brand)).toBe(true);
      expect(creatorIds.has(d.creator)).toBe(true);
      expect(d.step).toBeGreaterThanOrEqual(0);
      expect(d.step).toBeLessThan(DEAL_FLOW.length);
    }
    expect(new Set(seed.notifications.map((n) => n.id)).size).toBe(seed.notifications.length);
  });

  it("is about AI creators and the brands that sponsor them", () => {
    expect(seed.brands.every((b) => b.sells.startsWith("AI "))).toBe(true);
    expect(seed.creators.map((c) => c.name)).toEqual([
      "Prompt Lab",
      "Neural Notes",
      "Code with Kai",
      "Tensor Talk",
      "The AI Desk",
      "Model Matters",
      "Prompt Daily",
    ]);
  });
});

describe("exampleFrame", () => {
  const seed = exampleSeed(now);
  const frame = exampleFrame(now);

  it("is the seed as a fresh example source serves it", () => {
    expect(frame).toEqual({
      me: "u1",
      myName: null,
      team: [
        {
          id: "u1",
          name: "",
          role: "full",
          title: "Owner",
          status: "online",
          doing: "Today",
        },
        {
          id: "u2",
          name: "Sara",
          role: "basic",
          title: "Account manager",
          status: "online",
          doing: "Reach · replies",
        },
        {
          id: "u3",
          name: "Omar",
          role: "basic",
          title: "VA",
          status: "online",
          doing: "Search · keyword 12 of 40",
        },
        {
          id: "u4",
          name: "Lina",
          role: "basic",
          title: "VA · first week",
          status: "away",
          doing: "Away until 13:00",
        },
      ],
      counts: { today: 28, plannedMinutes: 90, find: 15, reach: 10, close: 6, deliver: 7 },
      notifications: seed.notifications,
      log: [],
      creators: seed.creators,
      brands: seed.brands,
      deals: seed.deals,
      mateRun: seed.mateRun(now),
      notify: {},
    });
  });

  it("lists the notifications newest first", () => {
    const times = frame.notifications.map((n) => n.at);
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("gives the same frame for the same `now`", () => {
    expect(exampleFrame(now)).toEqual(frame);
  });
});
