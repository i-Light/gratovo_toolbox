import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { exampleSeed } from "@gratovo/core/data";
import type { DataSource } from "@gratovo/core/data";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase } from "../db/open-database";

import { contractNow, describeDataSourceContract } from "./data-source-contract";
import { openLiveSource } from "./live-source";
import {
  listProfiles,
  replaceMemberAccess,
  upsertBrand,
  upsertCreator,
  upsertDeal,
  upsertNotification,
  upsertProfile,
} from "./repositories";

/** Fills a live file with the example records once, as the sync would. */
function seedLiveFile(file: string, now: number): void {
  const db = openDatabase(file);
  try {
    if (listProfiles(db).length > 0) {
      return;
    }
    const fixtures = exampleSeed(now);
    for (const profile of fixtures.profiles) {
      upsertProfile(db, profile, now);
    }
    const updatedAt = new Date(now).toISOString();
    replaceMemberAccess(
      db,
      fixtures.access.map((row) => ({ ...row, updatedAt })),
    );
    for (const creator of fixtures.creators) {
      upsertCreator(db, creator, now);
    }
    for (const brand of fixtures.brands) {
      upsertBrand(db, brand, now);
    }
    for (const deal of fixtures.deals) {
      upsertDeal(db, deal, now);
    }
    for (const notification of fixtures.notifications) {
      upsertNotification(db, notification);
    }
  } finally {
    db.close();
  }
}

describeDataSourceContract("live source", (file, now) => {
  seedLiveFile(file, now());
  return openLiveSource(file, "u1", now);
});

describe("live source", () => {
  let folder: string;
  let file: string;
  const open: DataSource[] = [];

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), "gratovo-live-"));
    file = join(folder, "gratovo.db");
  });

  afterEach(async () => {
    for (const source of open.splice(0)) {
      source.close();
    }
    await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it("is empty before anything syncs", async () => {
    const source = openLiveSource(file, "u1", () => contractNow);
    open.push(source);
    const frame = await source.frame();
    expect(frame).toEqual({
      me: "u1",
      myName: null,
      team: [],
      counts: { today: 0, plannedMinutes: 0, find: 0, reach: 0, close: 0, deliver: 0 },
      notifications: [],
      log: [],
      creators: [],
      brands: [],
      deals: [],
      conflicts: [],
      mateRun: null,
      notify: {},
      seesMoney: false,
    });
  });

  it("shows everyone as away", async () => {
    seedLiveFile(file, contractNow);
    const source = openLiveSource(file, "u1", () => contractNow);
    open.push(source);
    const frame = await source.frame();
    expect(frame.team).toHaveLength(4);
    for (const member of frame.team) {
      expect(member).toMatchObject({ status: "away", doing: "" });
      expect(member).not.toHaveProperty("title");
    }
    expect(frame.mateRun).toBeNull();
  });

  it("serves Omar (Scout · Outreach, no money) no price and no money notification", async () => {
    seedLiveFile(file, contractNow);
    const source = openLiveSource(file, "u3", () => contractNow);
    open.push(source);
    const frame = await source.frame();
    expect(frame.seesMoney).toBe(false);
    expect(frame.deals.length).toBeGreaterThan(0);
    expect(frame.deals.every((deal) => deal.price === null)).toBe(true);
    expect(frame.notifications.map((n) => n.icon)).not.toContain("wallet");
    expect(frame.notifications.map((n) => n.icon)).not.toContain("unlock");
    expect(frame.team.find((m) => m.id === "u3")?.roles).toEqual(["scout", "outreach"]);
  });

  it("ignores a name change when there is no profile for you", async () => {
    const source = openLiveSource(file, "ghost", () => contractNow);
    open.push(source);
    await source.write([{ kind: "me.name", name: "Ada" }]);
    const frame = await source.frame();
    expect(frame.myName).toBeNull();
    expect(frame.team).toEqual([]);
  });
});
