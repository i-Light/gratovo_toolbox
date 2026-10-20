import type { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FrameNotification } from "@gratovo/core/data";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase } from "../../db/open-database";
import { listDeals, upsertDeal } from "./deals";
import { listNotifications, setNotificationRead, upsertNotification } from "./notifications";

let folder: string;
let db: DatabaseSync;

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "gratovo-repo-"));
  db = openDatabase(join(folder, "test.db"));
});

afterEach(async () => {
  db.close();
  await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const t0 = Date.UTC(2026, 9, 20, 10, 0, 0);

describe("deals", () => {
  it("round trips and writes the flow step and the legacy stage", () => {
    upsertDeal(db, { id: "d1", brand: "b1", creator: "UC1", step: 6, price: 4500 }, t0);
    expect(listDeals(db)).toEqual([
      { id: "d1", brand: "b1", creator: "UC1", step: 6, price: 4500 },
    ]);
    expect(db.prepare("SELECT stage, flow_step, brand_price FROM deals").get()).toMatchObject({
      stage: "live",
      flow_step: 6,
      brand_price: 4500,
    });
  });

  it("updates in place and keeps order", () => {
    upsertDeal(db, { id: "d1", brand: "b1", creator: "UC1", step: 0, price: 1000 }, t0);
    upsertDeal(db, { id: "d2", brand: "b1", creator: "UC2", step: 9, price: 2000 }, t0);
    upsertDeal(db, { id: "d1", brand: "b1", creator: "UC1", step: 3, price: 1200.5 }, t0 + 1000);
    expect(listDeals(db)).toEqual([
      { id: "d1", brand: "b1", creator: "UC1", step: 3, price: 1200.5 },
      { id: "d2", brand: "b1", creator: "UC2", step: 9, price: 2000 },
    ]);
    expect(db.prepare("SELECT stage FROM deals WHERE id = 'd2'").get()?.["stage"]).toBe("closed");
  });

  it("reads legacy rows (flow_step NULL) through the derived rules", () => {
    db.exec(
      `INSERT INTO deals (id, brand_id, channel_id, stage, brand_price, created_at, updated_at) VALUES
         ('a', 'b', 'c', 'proposed', 100, 'x', 'x'),
         ('b', 'b', 'c', 'contractSent', 200, 'x', 'x'),
         ('c', 'b', 'c', 'signed', 300, 'x', 'x'),
         ('d', 'b', 'c', 'live', 400, 'x', 'x'),
         ('e', 'b', 'c', 'closed', 500, 'x', 'x'),
         ('f', 'b', 'c', 'lost', 600, 'x', 'x')`,
    );
    expect(listDeals(db).map((d) => d.step)).toEqual([0, 1, 2, 5, 9, 0]);
    expect(listDeals(db).map((d) => d.price)).toEqual([100, 200, 300, 400, 500, 600]);
  });

  it("ignores an out-of-range flow_step", () => {
    db.exec(
      `INSERT INTO deals (id, brand_id, channel_id, stage, flow_step, created_at, updated_at)
       VALUES ('a', 'b', 'c', 'signed', 99, 'x', 'x')`,
    );
    expect(listDeals(db)[0]?.step).toBe(2);
  });

  it("is STRICT about types", () => {
    expect(() => {
      db.exec(
        "INSERT INTO deals (id, brand_id, channel_id, brand_price, created_at, updated_at) VALUES ('a', 'b', 'c', 'free', 'x', 'x')",
      );
    }).toThrow();
    expect(() => {
      db.exec(
        "INSERT INTO deals (id, brand_id, channel_id, flow_step, created_at, updated_at) VALUES ('a', 'b', 'c', 'two', 'x', 'x')",
      );
    }).toThrow();
  });
});

function note(id: string, at: number, extra: Partial<FrameNotification> = {}): FrameNotification {
  return {
    id,
    at,
    icon: "reply",
    text: `Text ${id}`,
    sub: `Sub ${id}`,
    go: { screen: "reach", tab: null },
    read: false,
    ...extra,
  };
}

describe("notifications", () => {
  it("round trips, including the go tab and the read flag", () => {
    const withTab = note("n1", t0, {
      icon: "wallet",
      go: { screen: "close", tab: "money" },
      read: true,
    });
    upsertNotification(db, withTab);
    upsertNotification(db, note("n2", t0 + 1));
    expect(listNotifications(db).find((n) => n.id === "n1")).toEqual(withTab);
    expect(listNotifications(db).find((n) => n.id === "n2")?.go.tab).toBeNull();
  });

  it("replaces a notification with the same id", () => {
    upsertNotification(db, note("n1", t0));
    upsertNotification(db, note("n1", t0 + 5, { text: "Changed" }));
    expect(listNotifications(db)).toEqual([note("n1", t0 + 5, { text: "Changed" })]);
  });

  it("sets read and unread, and reports an unknown id", () => {
    upsertNotification(db, note("n1", t0));
    expect(setNotificationRead(db, "n1", true)).toBe(true);
    expect(listNotifications(db)[0]?.read).toBe(true);
    expect(setNotificationRead(db, "n1", false)).toBe(true);
    expect(listNotifications(db)[0]?.read).toBe(false);
    expect(setNotificationRead(db, "ghost", true)).toBe(false);
  });

  it("lists newest first, with id ascending on ties", () => {
    upsertNotification(db, note("b", t0 + 10));
    upsertNotification(db, note("z", t0));
    upsertNotification(db, note("a", t0 + 10));
    upsertNotification(db, note("new", t0 + 20));
    expect(listNotifications(db).map((n) => n.id)).toEqual(["new", "a", "b", "z"]);
  });

  it("reads an unknown icon as a check", () => {
    db.exec(
      "INSERT INTO notifications (id, at, icon, text, sub, go_screen) VALUES ('x', 1, 'mystery', 't', 's', 'today')",
    );
    expect(listNotifications(db)[0]?.icon).toBe("check");
  });

  it("is STRICT about types", () => {
    expect(() => {
      upsertNotification(db, note("bad", 1.5));
    }).toThrow();
    expect(() => {
      db.exec(
        "INSERT INTO notifications (id, at, icon, text, sub, go_screen) VALUES ('x', 'later', 'reply', 't', 's', 'today')",
      );
    }).toThrow();
  });
});
