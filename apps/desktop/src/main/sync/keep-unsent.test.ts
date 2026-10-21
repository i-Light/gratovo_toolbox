import type { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openExampleSource } from "../data";
import {
  addLogEntry,
  dropEntry,
  enqueue,
  head,
  pendingCount,
  replaceOpenConflicts,
  setMeta,
} from "../data/repositories";
import { openDatabase } from "../db/open-database";

import { accountUserKey, keepOnlyUnsent } from "./keep-unsent";

const now = Date.UTC(2026, 9, 20, 10, 0, 0);
const me = "00000000-0000-4000-8000-000000000001";

let folder = "";
let db: DatabaseSync;

/** Every table of the copy and how many rows it holds. */
function counts(): Record<string, number> {
  const names = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((row) => String(row["name"]));
  return Object.fromEntries(
    names.map((name) => [
      name,
      Number(db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get()?.["n"] ?? 0),
    ]),
  );
}

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "gratovo-keep-"));
  const path = join(folder, "gratovo.db");
  // The example seed fills the team, creators, brands, deals, notifications and settings.
  openExampleSource(path, () => now).close();
  db = openDatabase(path);
  setMeta(db, accountUserKey, me);
  addLogEntry(db, me, { id: "l1", at: now, who: me, text: "Moved @ai_tools_daily to Emailed" });
  setMeta(db, "account.access", "full");
  setMeta(
    db,
    "sync.cursor.brands",
    JSON.stringify({ at: "2026-10-20T10:00:00+00:00", key: ["b1"] }),
  );
  setMeta(db, "sync.seeded", "1");
  replaceOpenConflicts(db, [
    {
      id: "c1",
      channel_id: "ch1",
      channel_label: "@ai_tools_daily",
      field: "creator_stage",
      mine_actor_id: me,
    },
  ]);
  enqueue(db, {
    userId: me,
    kind: "profile.name",
    payload: { name: "Sam" },
    target: { table: "profiles", key: me },
    now,
  });
  enqueue(db, {
    userId: me,
    kind: "deal.step",
    payload: { id: "d1", step: 2 },
    target: { table: "deals", key: "d1" },
    now,
  });
  const refused = enqueue(db, { userId: me, kind: "brand.set", payload: {}, target: null, now });
  const entry = head(db, me);
  if (entry === null) {
    throw new Error("no head");
  }
  dropEntry(db, { ...entry, seq: refused }, "42501", now);
});

afterEach(async () => {
  if (db.isOpen) {
    db.close();
  }
  await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe("keepOnlyUnsent", () => {
  it("empties every table but the outbox, and keeps only whose copy it is", () => {
    const before = counts();
    for (const table of ["profiles", "channel_state", "brands", "activity_log", "notifications"]) {
      expect(before[table], table).toBeGreaterThan(0);
    }
    expect(before["edit_conflicts"]).toBe(1);
    expect(before["_outbox_dropped"]).toBe(1);
    const outbox = db.prepare("SELECT * FROM _outbox ORDER BY seq").all();

    keepOnlyUnsent(db);
    db.exec("VACUUM");

    const after = counts();
    for (const [table, n] of Object.entries(after)) {
      if (table !== "_outbox" && table !== "_meta") {
        expect(n, table).toBe(0);
      }
    }
    expect(db.prepare("SELECT * FROM _outbox ORDER BY seq").all()).toEqual(outbox);
    expect(pendingCount(db, me)).toBe(2);
    expect(db.prepare("SELECT key, value FROM _meta").all()).toEqual([
      { key: accountUserKey, value: me },
    ]);
  });

  it("keeps the outbox numbering, so a new entry comes after the kept ones", () => {
    keepOnlyUnsent(db);
    const next = enqueue(db, { userId: me, kind: "notify.set", payload: {}, target: null, now });
    const seqs = db
      .prepare("SELECT seq FROM _outbox ORDER BY seq")
      .all()
      .map((row) => Number(row["seq"]));
    expect(seqs.at(-1)).toBe(next);
    expect(seqs.slice(0, -1).every((seq) => seq < next)).toBe(true);
  });

  it("can run again on a copy it already emptied", () => {
    keepOnlyUnsent(db);
    keepOnlyUnsent(db);
    expect(pendingCount(db)).toBe(2);
  });
});
