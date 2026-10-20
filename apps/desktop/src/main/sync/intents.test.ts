import type { DatabaseSync } from "node:sqlite";

import type { DataSource } from "@gratovo/core/data";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSqliteSource } from "../data/sqlite-source";
import { pendingCount, upsertProfile } from "../data/repositories";
import { openDatabase } from "../db/open-database";

import { recordIntent } from "./intents";

const me = "11111111-1111-4111-8111-111111111111";
const line = "22222222-2222-4222-8222-222222222222";
const t0 = Date.parse("2026-10-21T10:00:00Z");

let db: DatabaseSync;
let source: DataSource;
let n: number;
let clock: number;

function entries(): { kind: string; payload: unknown; target: unknown }[] {
  return db
    .prepare("SELECT kind, payload, target_table, target_key FROM _outbox ORDER BY seq")
    .all()
    .map((r) => ({
      kind: String(r["kind"]),
      payload: JSON.parse(String(r["payload"])) as unknown,
      target: { table: r["target_table"], key: r["target_key"] },
    }));
}

function lineCount(): number {
  return Number(db.prepare("SELECT COUNT(*) AS c FROM activity_log").get()?.["c"]);
}

beforeEach(() => {
  db = openDatabase(":memory:");
  upsertProfile(db, { id: me, displayName: "Sam", role: "full", color: "#3B82F6" }, t0);
  n = 0;
  clock = t0;
  source = createSqliteSource(db, {
    me,
    now: () => clock,
    extras: {
      presence: () => ({ status: "online", doing: "" }),
      counts: () => ({}) as never,
      mateRun: () => null,
    },
    onWrite: (d, write, applyLocal) => {
      recordIntent(d, {
        userId: me,
        write,
        applyLocal,
        now: clock,
        newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
      });
    },
  });
});

afterEach(() => {
  db.close();
});

describe("recordIntent", () => {
  it("me.name writes locally and queues the cleaned name", async () => {
    await source.write([{ kind: "me.name", name: "  Sam K  " }]);
    expect((await source.frame()).myName).toBe("Sam K");
    expect(entries()).toEqual([
      {
        kind: "profile.name",
        payload: { name: "Sam K" },
        target: { table: "profiles", key: me },
      },
    ]);
  });

  it("notify.set queues the switches", async () => {
    await source.write([{ kind: "notify.set", notify: { money: false } }]);
    expect(entries()).toEqual([
      {
        kind: "notify.set",
        payload: { switches: { money: false } },
        target: { table: "notification_switches", key: me },
      },
    ]);
  });

  it("notification.read queues nothing", async () => {
    await source.write([{ kind: "notification.read", id: "x", read: true }]);
    expect(pendingCount(db)).toBe(0);
  });

  it("log.add writes the line and queues the same row", async () => {
    await source.write([{ kind: "log.add", id: line, at: t0, text: "Called Acme" }]);
    expect(lineCount()).toBe(1);
    const [entry] = entries();
    expect(entry?.kind).toBe("activity.add");
    expect(entry?.target).toEqual({ table: "activity_log", key: line });
    expect(entry?.payload).toMatchObject({
      row: {
        id: line,
        at: "2026-10-21T10:00:00.000Z",
        actor_id: me,
        actor_name: "Sam",
        action: "note",
        entity_type: "app",
        entity_label: "Called Acme",
        detail: { text: "Called Acme" },
      },
    });
  });

  it("rolls the local effect and the entry back together when a later write throws", async () => {
    await expect(
      source.write([
        { kind: "me.name", name: "Zed" },
        { kind: "log.add", id: line, at: t0, text: "a" },
        { kind: "log.add", id: line, at: t0, text: "a" },
      ]),
    ).rejects.toThrow();
    expect(pendingCount(db)).toBe(0);
    expect(lineCount()).toBe(0);
    expect((await source.frame()).myName).toBe("Sam");
  });

  it("undo of an unsent line deletes the line and its entry", async () => {
    await source.write([{ kind: "log.add", id: line, at: t0, text: "a" }]);
    await source.write([{ kind: "log.remove", id: line }]);
    expect(lineCount()).toBe(0);
    expect(pendingCount(db)).toBe(0);
  });

  it("undo of a sent line queues one undo marker; redo queues a redo marker", async () => {
    await source.write([{ kind: "log.add", id: line, at: t0, text: "a" }]);
    db.exec("DELETE FROM _outbox"); // as if sent
    clock += 1000;
    await source.write([{ kind: "log.remove", id: line }]);
    expect(lineCount()).toBe(2);
    expect((await source.frame()).log).toEqual([]);
    expect(entries()).toHaveLength(1);
    expect(entries()[0]?.payload).toMatchObject({
      row: {
        action: "undo",
        entity_type: "activity_log",
        entity_id: line,
        entity_label: "a",
        actor_id: me,
      },
    });
    // The same instant: the redo still sorts after the undo.
    await source.write([{ kind: "log.add", id: line, at: t0, text: "a" }]);
    expect(lineCount()).toBe(3);
    expect(entries()).toHaveLength(2);
    expect(entries()[1]?.payload).toMatchObject({ row: { action: "redo", entity_id: line } });
    expect((await source.frame()).log.map((l) => l.id)).toEqual([line]);
  });

  // S21 replaces this test when it adds the four new kinds.
  it("a kind it does not know only applies locally", () => {
    const applyLocal = vi.fn();
    recordIntent(db, {
      userId: me,
      write: { kind: "deal.step", id: "d", step: 1 },
      applyLocal,
      now: t0,
      newId: () => "x",
    });
    expect(applyLocal).toHaveBeenCalledOnce();
    expect(pendingCount(db)).toBe(0);
  });
});
