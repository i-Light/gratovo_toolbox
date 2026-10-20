import type { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase } from "../db/open-database";
import { markResolved, replaceOpenConflicts } from "../data/repositories/conflicts";
import { listNotifications } from "../data/repositories/notifications";
import { syncConflictNotices } from "./conflict-notices";

let folder: string;
let db: DatabaseSync;

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "gratovo-notices-"));
  db = openDatabase(join(folder, "test.db"));
});

afterEach(async () => {
  db.close();
  await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const k1 = "11111111-1111-4111-8111-111111111111";

function conflict(id: string, extra: Record<string, string | null> = {}) {
  return {
    id,
    channel_id: "UC1",
    channel_label: "@promptlab",
    field: "creator_stage",
    base_value: '"new"',
    mine_value: '"emailed"',
    theirs_value: '"replied"',
    mine_actor_id: "u1",
    mine_actor_name: "Ada",
    theirs_actor_name: "Sara",
    detected_at: "2026-10-20T10:00:00.000000+00:00",
    resolved_at: null,
    updated_at: "2026-10-20T10:00:00.000000+00:00",
    ...extra,
  };
}

describe("syncConflictNotices", () => {
  it("makes one notification for a new conflict, once", () => {
    replaceOpenConflicts(db, [conflict(k1)]);
    expect(syncConflictNotices(db)).toBe(true);
    const list = listNotifications(db);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: `conflict:${k1}`,
      icon: "alert",
      text: "Your change to @promptlab clashed with Sara's",
      sub: "Stage: yours Emailed, theirs Replied",
      at: Date.parse("2026-10-20T10:00:00Z"),
      go: { screen: "today", tab: null },
      read: false,
    });
    expect(syncConflictNotices(db)).toBe(false);
  });

  it("removes the notification when the conflict is settled or gone", () => {
    replaceOpenConflicts(db, [conflict(k1)]);
    syncConflictNotices(db);
    markResolved(db, k1);
    expect(syncConflictNotices(db)).toBe(true);
    expect(listNotifications(db)).toHaveLength(0);
    expect(syncConflictNotices(db)).toBe(false);
  });

  it("removes it when the server no longer lists the conflict", () => {
    replaceOpenConflicts(db, [conflict(k1)]);
    syncConflictNotices(db);
    replaceOpenConflicts(db, []);
    expect(syncConflictNotices(db)).toBe(true);
    expect(listNotifications(db)).toHaveLength(0);
  });

  it("reads a field other than stage by its name", () => {
    replaceOpenConflicts(db, [
      conflict(k1, { field: "notes", mine_value: '"call Fri"', theirs_value: null }),
    ]);
    syncConflictNotices(db);
    expect(listNotifications(db)[0]?.sub).toBe("Notes: yours call Fri, theirs empty");
  });

  it("joins an open transaction", () => {
    replaceOpenConflicts(db, [conflict(k1)]);
    db.exec("BEGIN IMMEDIATE");
    expect(syncConflictNotices(db)).toBe(true);
    db.exec("COMMIT");
    expect(listNotifications(db)).toHaveLength(1);
  });
});
