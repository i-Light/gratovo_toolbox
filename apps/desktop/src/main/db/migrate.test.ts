import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DatabaseTooNewError, migrate, type Migration } from "./migrate";
import { migrations } from "./migrations";

let db: DatabaseSync;

beforeEach(() => {
  db = new DatabaseSync(":memory:");
});

afterEach(() => {
  db.close();
});

function version(): number {
  return Number(db.prepare("PRAGMA user_version").get()?.["user_version"]);
}

function tables(): string[] {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => String(row["name"]));
}

const v2: Migration = { version: 2, name: "second", sql: "CREATE TABLE second (id TEXT) STRICT;" };

describe("migrate", () => {
  it("throws the migration's own error when its SQL ended the transaction first", () => {
    const ends: Migration = { version: 1, name: "ends", sql: "COMMIT; NOT VALID SQL;" };
    expect(() => {
      migrate(db, [ends]);
    }).toThrow(/syntax error/);
  });

  it("numbers the real migrations 1..n with no gap", () => {
    expect(migrations.map((m) => m.version)).toEqual(migrations.map((_, i) => i + 1));
  });

  it("builds a fresh database at the latest version", () => {
    migrate(db);
    expect(version()).toBe(migrations.length);
    expect(tables()).toEqual(
      expect.arrayContaining([
        "_meta",
        "activity_log",
        "brands",
        "channel_state",
        "channels",
        "deals",
        "local_settings",
        "notifications",
        "profiles",
      ]),
    );
  });

  it("changes nothing when run again", () => {
    migrate(db);
    const before = tables();
    migrate(db);
    expect(version()).toBe(migrations.length);
    expect(tables()).toEqual(before);
  });

  it("applies only the new migration to a version 1 database", () => {
    migrate(db);
    db.exec("INSERT INTO _meta (key, value) VALUES ('kept', 'yes')");
    migrate(db, [...migrations, v2]);
    expect(version()).toBe(2);
    expect(tables()).toContain("second");
    expect(db.prepare("SELECT value FROM _meta WHERE key = 'kept'").get()?.["value"]).toBe("yes");
  });

  it("refuses a database newer than the list", () => {
    migrate(db, [...migrations, v2]);
    expect(() => {
      migrate(db);
    }).toThrow(DatabaseTooNewError);
    expect(version()).toBe(2);
  });

  it("leaves version 1 and no partial table when a migration fails", () => {
    migrate(db);
    const bad: Migration = {
      version: 2,
      name: "bad",
      sql: "CREATE TABLE half (id TEXT) STRICT; CREATE TABLE half (id TEXT) STRICT;",
    };
    expect(() => {
      migrate(db, [...migrations, bad]);
    }).toThrow();
    expect(version()).toBe(1);
    expect(tables()).not.toContain("half");
  });

  it("makes the app columns nullable and the tables strict", () => {
    migrate(db);
    db.exec(
      "INSERT INTO channel_state (channel_id, handle, updated_at) VALUES ('c1', '@ai', '2026-01-01T00:00:00Z')",
    );
    const row = db.prepare("SELECT creator_stage FROM channel_state WHERE channel_id = 'c1'").get();
    expect(row?.["creator_stage"]).toBeNull();
    expect(() => {
      db.exec(
        "INSERT INTO notifications (id, at, icon, text, sub, go_screen) VALUES ('n', 'x', 'i', 't', 's', 'g')",
      );
    }).toThrow();
  });
});
