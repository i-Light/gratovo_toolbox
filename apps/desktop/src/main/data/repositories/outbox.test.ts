import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { migrate } from "../../db/migrate";
import { migrations } from "../../db/migrations";
import { openDatabase } from "../../db/open-database";
import {
  cancelActivityAdd,
  dropEntry,
  enqueue,
  hasPending,
  head,
  headRun,
  noteFailure,
  pendingCount,
  pendingPayload,
  removeEntries,
  removeOtherUsers,
} from "./outbox";
import type { OutboxKind } from "./outbox";

let folder: string;
let db: DatabaseSync;

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "gratovo-outbox-"));
  db = openDatabase(join(folder, "test.db"));
});

afterEach(async () => {
  db.close();
  await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const now = Date.UTC(2026, 9, 20, 10, 0, 0);

function add(userId: string, kind: OutboxKind, payload: unknown = {}, key: string | null = null) {
  return enqueue(db, {
    userId,
    kind,
    payload,
    target: key === null ? null : { table: "brands", key },
    now,
  });
}

describe("local migration 3", () => {
  it("backfills at_ms on a version-2 database with log rows", () => {
    const old = new DatabaseSync(":memory:");
    migrate(old, migrations.slice(0, 2));
    old
      .prepare(
        "INSERT INTO activity_log (id, at, actor_name, actor_role, action, entity_type) VALUES (?, ?, 'A', 'basic', 'note', 'app')",
      )
      .run("l1", "2026-10-20T10:00:00.000Z");
    migrate(old);
    const row = old.prepare("SELECT at_ms, received_at FROM activity_log WHERE id = 'l1'").get();
    expect(row?.["at_ms"]).toBe(Date.UTC(2026, 9, 20, 10, 0, 0));
    expect(row?.["received_at"]).toBeNull();
    const money = old
      .prepare("SELECT COUNT(*) AS n FROM pragma_table_info('notifications') WHERE name = 'money'")
      .get();
    expect(money?.["n"]).toBe(1);
    old.close();
  });
});

describe("outbox", () => {
  it("round-trips a payload and numbers entries in order", () => {
    const a = add("u1", "profile.name", { name: 'Sara "S" Lee' });
    const b = add("u1", "notify.set", { switches: { a: true } });
    expect(b).toBeGreaterThan(a);
    const first = head(db, "u1");
    expect(first).toMatchObject({
      seq: a,
      userId: "u1",
      kind: "profile.name",
      payload: { name: 'Sara "S" Lee' },
      target: null,
      attempts: 0,
      createdAt: "2026-10-20T10:00:00.000Z",
    });
  });

  it("head and headRun filter by user and keep seq order", () => {
    add("u2", "activity.add", { row: { id: "x" } });
    add("u1", "activity.add", { row: { id: "a" } });
    add("u1", "activity.add", { row: { id: "b" } });
    add("u1", "notify.set");
    add("u1", "activity.add", { row: { id: "c" } });
    expect(head(db, "u1")?.payload).toEqual({ row: { id: "a" } });
    expect(head(db, "nobody")).toBeNull();
    const run = headRun(db, "u1", "activity.add", 200);
    expect(run.map((e) => (e.payload as { row: { id: string } }).row.id)).toEqual(["a", "b"]);
    expect(headRun(db, "u1", "activity.add", 1)).toHaveLength(1);
    expect(headRun(db, "u1", "notify.set", 5)).toHaveLength(0);
  });

  it("removes entries and counts pending, all or per user", () => {
    const a = add("u1", "profile.name");
    add("u1", "notify.set");
    add("u2", "notify.set");
    expect(pendingCount(db)).toBe(3);
    expect(pendingCount(db, "u1")).toBe(2);
    removeEntries(db, [a]);
    expect(pendingCount(db, "u1")).toBe(1);
  });

  it("drops an entry into _outbox_dropped inside the caller's transaction", () => {
    add("u1", "brand.set", { id: "b" }, "b");
    const entry = head(db, "u1");
    if (entry === null) {
      throw new Error("no entry");
    }
    db.exec("BEGIN");
    dropEntry(db, entry, "42501", now);
    db.exec("ROLLBACK");
    expect(pendingCount(db)).toBe(1);
    db.exec("BEGIN");
    dropEntry(db, entry, "42501", now);
    db.exec("COMMIT");
    expect(pendingCount(db)).toBe(0);
    const dropped = db.prepare("SELECT * FROM _outbox_dropped").all();
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toMatchObject({ code: "42501", kind: "brand.set", user_id: "u1" });
  });

  it("counts a failure on the entry", () => {
    const seq = add("u1", "profile.name");
    noteFailure(db, seq, "500");
    noteFailure(db, seq, "PGRST202");
    expect(head(db, "u1")?.attempts).toBe(2);
    expect(db.prepare("SELECT last_code FROM _outbox").get()?.["last_code"]).toBe("PGRST202");
  });

  it("knows which rows have a pending entry", () => {
    add("u1", "brand.set", {}, "b1");
    expect(hasPending(db, "brands", "b1")).toBe(true);
    expect(hasPending(db, "brands", "b2")).toBe(false);
    expect(hasPending(db, "deals", "b1")).toBe(false);
  });

  it("returns the newest pending payload of a kind", () => {
    expect(pendingPayload(db, "u1", "profile.name")).toBeNull();
    add("u1", "profile.name", { name: "Old" });
    add("u1", "profile.name", { name: "New" });
    add("u2", "profile.name", { name: "Other" });
    expect(pendingPayload(db, "u1", "profile.name")).toEqual({ name: "New" });
    expect(pendingPayload(db, "u1", "notify.set")).toBeNull();
  });

  it("cancels only an unsent activity.add whose row id matches", () => {
    add("u1", "activity.add", { row: { id: "line-1" } });
    add("u1", "notify.set", { row: { id: "line-1" } });
    expect(cancelActivityAdd(db, "line-2")).toBe(false);
    expect(cancelActivityAdd(db, "line-1")).toBe(true);
    expect(cancelActivityAdd(db, "line-1")).toBe(false);
    expect(pendingCount(db)).toBe(1);
    expect(head(db, "u1")?.kind).toBe("notify.set");
  });

  it("removes other users' entries", () => {
    add("u1", "profile.name");
    add("u2", "profile.name");
    add("u3", "notify.set");
    expect(removeOtherUsers(db, "u1")).toBe(2);
    expect(pendingCount(db)).toBe(1);
    expect(head(db, "u1")).not.toBeNull();
  });
});
