import type { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase } from "../../db/open-database";
import { addLogEntry, logCap, newestLog, removeLogEntry } from "./activity-log";
import { getProfile, listProfiles, setDisplayName, upsertProfile } from "./profiles";

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

describe("profiles", () => {
  it("round trips and updates in place", () => {
    upsertProfile(db, { id: "u1", displayName: "Maya Chen", role: "full" }, t0);
    upsertProfile(db, { id: "u2", displayName: "Sara", role: "basic", color: "#FF0000" }, t0);
    upsertProfile(db, { id: "u1", displayName: "Maya C.", role: "full" }, t0 + 1000);
    expect(listProfiles(db)).toEqual([
      { id: "u1", displayName: "Maya C.", role: "full", color: "#3B82F6" },
      { id: "u2", displayName: "Sara", role: "basic", color: "#FF0000" },
    ]);
    expect(getProfile(db, "u2")?.displayName).toBe("Sara");
    expect(getProfile(db, "nobody")).toBeNull();
  });

  it("stores ISO timestamps", () => {
    upsertProfile(db, { id: "u1", displayName: "", role: "full" }, t0);
    const row = db.prepare("SELECT created_at, updated_at FROM profiles").get();
    expect(row?.["created_at"]).toBe("2026-10-20T10:00:00.000Z");
    expect(row?.["updated_at"]).toBe("2026-10-20T10:00:00.000Z");
  });

  it("sets the display name, and reports an unknown id", () => {
    upsertProfile(db, { id: "u1", displayName: "", role: "full" }, t0);
    expect(setDisplayName(db, "u1", "Maya", t0 + 5000)).toBe(true);
    expect(getProfile(db, "u1")?.displayName).toBe("Maya");
    expect(db.prepare("SELECT updated_at FROM profiles").get()?.["updated_at"]).toBe(
      "2026-10-20T10:00:05.000Z",
    );
    expect(setDisplayName(db, "ghost", "X", t0)).toBe(false);
  });

  it("reads a legacy row (server timestamps, unknown role) tolerantly", () => {
    db.exec(
      `INSERT INTO profiles (id, display_name, role, created_at, updated_at)
       VALUES ('p1', 'Omar', 'weird', '2026-10-01T09:00:00.123456+00:00', '2026-10-01T09:00:00.123456+00:00')`,
    );
    expect(getProfile(db, "p1")).toEqual({
      id: "p1",
      displayName: "Omar",
      role: "unauthorized",
      color: "#3B82F6",
    });
  });

  it("is STRICT about types", () => {
    expect(() => {
      db.exec(
        "INSERT INTO profiles (id, display_name, created_at, updated_at) VALUES (x'00', 'x', 'a', 'b')",
      );
    }).toThrow();
  });
});

describe("activity log", () => {
  beforeEach(() => {
    upsertProfile(db, { id: "u1", displayName: "Maya", role: "full" }, t0);
  });

  it("adds with the actor from me's profile and reads back", () => {
    addLogEntry(db, "u1", { id: "l1", at: t0, who: "ignored", text: "Marked Lina's deal paid" });
    expect(newestLog(db)).toEqual([
      { id: "l1", at: t0, who: "u1", text: "Marked Lina's deal paid" },
    ]);
    const row = db.prepare("SELECT * FROM activity_log").get();
    expect(row).toMatchObject({
      actor_id: "u1",
      actor_name: "Maya",
      actor_role: "full",
      action: "Marked Lina's deal paid",
      entity_type: "app",
      at: "2026-10-20T10:00:00.000Z",
    });
  });

  it("logs an empty name when me has no profile, and reads back the member id", () => {
    addLogEntry(db, "ghost", { id: "l1", at: t0, who: "", text: "Did a thing" });
    expect(newestLog(db)[0]).toMatchObject({ who: "ghost" });
    expect(db.prepare("SELECT actor_role FROM activity_log").get()?.["actor_role"]).toBe(
      "unauthorized",
    );
  });

  it("lists newest first, with id descending on ties", () => {
    addLogEntry(db, "u1", { id: "a", at: t0, who: "", text: "old" });
    addLogEntry(db, "u1", { id: "b", at: t0 + 1000, who: "", text: "tie 1" });
    addLogEntry(db, "u1", { id: "c", at: t0 + 1000, who: "", text: "tie 2" });
    addLogEntry(db, "u1", { id: "d", at: t0 + 2000, who: "", text: "newest" });
    expect(newestLog(db).map((e) => e.id)).toEqual(["d", "c", "b", "a"]);
  });

  it("caps the list at 50 and at the limit asked for", () => {
    for (let i = 0; i < 60; i += 1) {
      addLogEntry(db, "u1", {
        id: `l${String(i).padStart(2, "0")}`,
        at: t0 + i,
        who: "",
        text: "x",
      });
    }
    const all = newestLog(db);
    expect(all).toHaveLength(logCap);
    expect(all[0]?.id).toBe("l59");
    expect(all.at(-1)?.id).toBe("l10");
    expect(newestLog(db, 3)).toHaveLength(3);
    expect(newestLog(db, 500)).toHaveLength(logCap);
    expect(newestLog(db, 0)).toEqual([]);
  });

  it("removes a line, and reports an unknown id", () => {
    addLogEntry(db, "u1", { id: "l1", at: t0, who: "", text: "x" });
    expect(removeLogEntry(db, "l1")).toBe(true);
    expect(newestLog(db)).toEqual([]);
    expect(removeLogEntry(db, "l1")).toBe(false);
  });

  it("reads a legacy row written by the old app", () => {
    db.exec(
      `INSERT INTO activity_log (id, at, actor_id, actor_name, actor_role, action, entity_type, entity_id)
       VALUES ('srv', '2026-10-20T11:00:00.500000+00:00', NULL, 'Sara', 'basic', 'edited tags', 'channel', 'c1')`,
    );
    expect(newestLog(db)).toEqual([
      { id: "srv", at: Date.UTC(2026, 9, 20, 11, 0, 0, 500), who: "Sara", text: "edited tags" },
    ]);
  });

  it("is STRICT about types", () => {
    expect(() => {
      db.exec(
        `INSERT INTO activity_log (id, at, actor_name, actor_role, action, entity_type)
         VALUES ('z', 'a', 'n', 'r', x'00', 'app')`,
      );
    }).toThrow();
  });
});
