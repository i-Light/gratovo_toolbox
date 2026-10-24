import type { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase } from "../../db/open-database";
import { addLogEntry, logCap, newestLog, removeLogEntry } from "./activity-log";
import {
  getProfile,
  listProfiles,
  replaceProfiles,
  setDisplayName,
  upsertProfile,
} from "./profiles";

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

  it("replaces every profile, keeping the server's timestamps and order", () => {
    upsertProfile(db, { id: "old", displayName: "Gone", role: "basic" }, t0);
    upsertProfile(db, { id: "u2", displayName: "Sara", role: "basic" }, t0);
    const stamp = "2026-10-01T09:00:00.123456+00:00";
    replaceProfiles(db, [
      {
        id: "u2",
        displayName: "Sara K.",
        role: "full",
        color: "#FF0000",
        createdAt: stamp,
        updatedAt: stamp,
      },
      {
        id: "u1",
        displayName: "",
        role: "unauthorized",
        color: null,
        createdAt: stamp,
        updatedAt: stamp,
      },
    ]);
    expect(listProfiles(db)).toEqual([
      { id: "u2", displayName: "Sara K.", role: "full", color: "#FF0000" },
      { id: "u1", displayName: "", role: "unauthorized", color: "#3B82F6" },
    ]);
    const row = db.prepare("SELECT created_at, updated_at FROM profiles WHERE id = 'u1'").get();
    expect(row).toMatchObject({ created_at: stamp, updated_at: stamp });
    replaceProfiles(db, []);
    expect(listProfiles(db)).toEqual([]);
  });
});

describe("activity log", () => {
  beforeEach(() => {
    upsertProfile(db, { id: "u1", displayName: "Maya", role: "full" }, t0);
  });

  it("adds with the actor from me's profile and reads back", () => {
    addLogEntry(db, "u1", { id: "l1", at: t0, who: "ignored", text: "Marked Lina's deal paid" });
    expect(newestLog(db, { seesMoney: true })).toEqual([
      {
        id: "l1",
        at: t0,
        who: "u1",
        text: "Marked Lina's deal paid",
        ref: null,
        action: null,
        detail: null,
      },
    ]);
    const row = db.prepare("SELECT * FROM activity_log").get();
    expect(row).toMatchObject({
      actor_id: "u1",
      actor_name: "Maya",
      actor_role: "full",
      action: "note",
      entity_label: "Marked Lina's deal paid",
      detail: '{"text":"Marked Lina\'s deal paid"}',
      entity_type: "app",
      at: "2026-10-20T10:00:00.000Z",
    });
  });

  it("logs an empty name when me has no profile, and reads back the member id", () => {
    addLogEntry(db, "ghost", { id: "l1", at: t0, who: "", text: "Did a thing" });
    expect(newestLog(db, { seesMoney: true })[0]).toMatchObject({ who: "ghost" });
    expect(db.prepare("SELECT actor_role FROM activity_log").get()?.["actor_role"]).toBe(
      "unauthorized",
    );
  });

  it("lists newest first, with id descending on ties", () => {
    addLogEntry(db, "u1", { id: "a", at: t0, who: "", text: "old" });
    addLogEntry(db, "u1", { id: "b", at: t0 + 1000, who: "", text: "tie 1" });
    addLogEntry(db, "u1", { id: "c", at: t0 + 1000, who: "", text: "tie 2" });
    addLogEntry(db, "u1", { id: "d", at: t0 + 2000, who: "", text: "newest" });
    expect(newestLog(db, { seesMoney: true }).map((e) => e.id)).toEqual(["d", "c", "b", "a"]);
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
    const all = newestLog(db, { seesMoney: true });
    expect(all).toHaveLength(logCap);
    expect(all[0]?.id).toBe("l59");
    expect(all.at(-1)?.id).toBe("l10");
    expect(newestLog(db, { seesMoney: true, limit: 3 })).toHaveLength(3);
    expect(newestLog(db, { seesMoney: true, limit: 500 })).toHaveLength(logCap);
    expect(newestLog(db, { seesMoney: true, limit: 0 })).toEqual([]);
  });

  it("removes a line, and reports an unknown id", () => {
    addLogEntry(db, "u1", { id: "l1", at: t0, who: "", text: "x" });
    expect(removeLogEntry(db, "l1")).toBe(true);
    expect(newestLog(db, { seesMoney: true })).toEqual([]);
    expect(removeLogEntry(db, "l1")).toBe(false);
  });

  it("reads a legacy row written by the old app", () => {
    db.exec(
      `INSERT INTO activity_log (id, at, actor_id, actor_name, actor_role, action, entity_type, entity_id, entity_label)
       VALUES ('srv', '2026-10-20T11:00:00.500000+00:00', NULL, 'Sara', 'basic', 'tagsChanged', 'channel', 'c1', 'Lina')`,
    );
    expect(newestLog(db, { seesMoney: true })).toEqual([
      {
        id: "srv",
        at: Date.UTC(2026, 9, 20, 11, 0, 0, 500),
        who: "Sara",
        text: "Changed the tags of Lina",
        // The old app's channel lines name the creator too; their action is not one of ours.
        ref: "c1",
        action: null,
        detail: null,
      },
    ]);
  });

  it("files a creator line under the channel, named, with its action and reason", () => {
    upsertProfile(db, { id: "u1", displayName: "Maya", role: "full" }, t0);
    db.exec(
      `INSERT INTO channel_state (channel_id, handle, updated_at) VALUES ('UC1', '@promptlab', 'x');
       INSERT INTO channels (channel_id, name) VALUES ('UC1', 'Prompt Lab');
       INSERT INTO channel_state (channel_id, handle, updated_at) VALUES ('UC2', '@agentweekly', 'x');`,
    );
    const line = {
      at: t0,
      who: "",
      text: "Rejected Prompt Lab",
      action: "creator.reject" as const,
      detail: "views",
    };
    addLogEntry(db, "u1", { ...line, id: "l1", ref: "UC1" });
    addLogEntry(db, "u1", { ...line, id: "l2", at: t0 + 1, ref: "UC2", detail: null });
    addLogEntry(db, "u1", { ...line, id: "l3", at: t0 + 2, ref: "UC9", action: null });
    const rows = db.prepare("SELECT * FROM activity_log ORDER BY at_ms").all();
    expect(rows[0]).toMatchObject({
      action: "creator.reject",
      entity_type: "channel",
      entity_id: "UC1",
      entity_label: "Prompt Lab",
      detail: '{"text":"Rejected Prompt Lab","reason":"views"}',
    });
    // No name: the handle; no row at all: the id. No action: a note.
    expect(rows[1]).toMatchObject({
      entity_label: "@agentweekly",
      detail: '{"text":"Rejected Prompt Lab"}',
    });
    expect(rows[2]).toMatchObject({ action: "note", entity_type: "channel", entity_label: "UC9" });
    expect(newestLog(db, { seesMoney: true })).toEqual([
      {
        id: "l3",
        at: t0 + 2,
        who: "u1",
        text: "Rejected Prompt Lab",
        ref: "UC9",
        action: null,
        detail: "views",
      },
      {
        id: "l2",
        at: t0 + 1,
        who: "u1",
        text: "Rejected Prompt Lab",
        ref: "UC2",
        action: "creator.reject",
        detail: null,
      },
      {
        id: "l1",
        at: t0,
        who: "u1",
        text: "Rejected Prompt Lab",
        ref: "UC1",
        action: "creator.reject",
        detail: "views",
      },
    ]);
  });

  it("reads back a pulled line: an unknown action is null, a reason that isn't text is none", () => {
    db.exec(
      `INSERT INTO activity_log (id, at, at_ms, actor_id, actor_name, actor_role, action, entity_type, entity_id, entity_label, detail)
       VALUES ('p1', '2026-10-20T11:00:00+00:00', 1, 'u2', 'Sara', 'basic', 'creator.never', 'channel', 'UC1', 'Prompt Lab', '{"text":"Never contact Prompt Lab","reason":"spam"}'),
              ('p2', '2026-10-20T11:00:01+00:00', 2, 'u2', 'Sara', 'basic', 'creator.zap', 'channel', 'UC1', 'Prompt Lab', '{"text":"Zapped","reason":4}'),
              ('p3', '2026-10-20T11:00:02+00:00', 3, 'u2', 'Sara', 'basic', 'creator.reject', 'app', 'UC1', 'x', '{"text":"Odd"}'),
              ('p4', '2026-10-20T11:00:03+00:00', 4, 'u2', 'Sara', 'basic', 'creator.reject', 'channel', '', 'x', json_object('text', 'Long', 'reason', printf('%.600c', 'r')))`,
    );
    expect(
      newestLog(db, { seesMoney: true }).map(({ id, ref, action, detail }) => ({
        id,
        ref,
        action,
        detail,
      })),
    ).toEqual([
      // An empty id is no ref; a long reason is cut to what the frame carries.
      { id: "p4", ref: null, action: "creator.reject", detail: "r".repeat(500) },
      { id: "p3", ref: null, action: "creator.reject", detail: null },
      { id: "p2", ref: "UC1", action: null, detail: null },
      { id: "p1", ref: "UC1", action: "creator.never", detail: "spam" },
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
