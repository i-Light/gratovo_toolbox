import { channels } from "@gratovo/ipc";
import type { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase } from "../../db/open-database";
import {
  addLogEntry,
  insertLogRow,
  linesSince,
  logPage,
  peopleInLog,
  type ActivityRow,
} from "./activity-log";
import { upsertProfile } from "./profiles";

let folder: string;
let db: DatabaseSync;

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "gratovo-log-"));
  db = openDatabase(join(folder, "test.db"));
  upsertProfile(db, { id: "u1", displayName: "Maya", role: "full" }, t0);
  upsertProfile(db, { id: "u2", displayName: "Sara", role: "full" }, t0);
});

afterEach(async () => {
  db.close();
  await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const t0 = Date.UTC(2026, 9, 20, 10, 0, 0);

function line(me: string, id: string, at: number, text = "Shortlisted Agent Lab"): void {
  addLogEntry(db, me, { id, at, who: "", text });
}

/** A row as the server writes it, for the cases `addLogEntry` cannot make. */
function raw(id: string, at: number, extra: Partial<ActivityRow>): void {
  insertLogRow(db, {
    id,
    at: new Date(at).toISOString(),
    actor_id: "u1",
    actor_name: "Maya",
    actor_role: "full",
    action: "update",
    entity_type: "deal",
    entity_id: "d1",
    entity_label: "Lina",
    field: "stage",
    old_value: "a",
    new_value: "b",
    detail: null,
    ...extra,
  });
}

/** An undo marker for the line `target`. */
function undo(id: string, target: string, at: number, action = "undo"): void {
  raw(id, at, { entity_type: "activity_log", entity_id: target, action, field: null });
}

const ids = (lines: { id: string }[]): string[] => lines.map((l) => l.id);
const all = { seesMoney: true, before: null, who: null };

describe("logPage", () => {
  it("pages across equal timestamps without a gap or a repeat", () => {
    line("u1", "a", t0);
    line("u1", "b", t0 + 1000);
    line("u1", "c", t0 + 1000);
    line("u1", "d", t0 + 1000);
    line("u1", "e", t0 + 2000);
    const first = logPage(db, { ...all, limit: 2 });
    expect(ids(first.lines)).toEqual(["e", "d"]);
    expect(first.more).toBe(true);
    const cursor = { at: t0 + 1000, id: "d" };
    const second = logPage(db, { ...all, before: cursor, limit: 2 });
    expect(ids(second.lines)).toEqual(["c", "b"]);
    expect(second.more).toBe(true);
    const third = logPage(db, { ...all, before: { at: t0 + 1000, id: "b" }, limit: 2 });
    expect(ids(third.lines)).toEqual(["a"]);
    expect(third.more).toBe(false);
  });

  it("says no more when the page ends exactly at the last line, and caps the limit at 100", () => {
    line("u1", "a", t0);
    line("u1", "b", t0 + 1);
    expect(logPage(db, { ...all, limit: 2 }).more).toBe(false);
    for (let i = 0; i < 120; i += 1) {
      line("u2", `x${String(i).padStart(3, "0")}`, t0 + 10 + i);
    }
    const page = logPage(db, { ...all, limit: 500 });
    expect(page.lines).toHaveLength(100);
    expect(page.more).toBe(true);
    expect(logPage(db, { ...all, limit: 0 })).toEqual({ lines: [], more: false });
  });

  it("filters by member id, and by name for an old-app row without an id", () => {
    line("u1", "a", t0);
    line("u2", "b", t0 + 1);
    raw("old", t0 + 2, { actor_id: null, actor_name: "Omar" });
    expect(ids(logPage(db, { ...all, who: "u1", limit: 10 }).lines)).toEqual(["a"]);
    const omar = logPage(db, { ...all, who: "Omar", limit: 10 });
    expect(ids(omar.lines)).toEqual(["old"]);
    expect(omar.lines[0]?.who).toBe("Omar");
    expect(logPage(db, { ...all, who: "Maya", limit: 10 }).lines).toEqual([]);
  });

  it("skips undo markers and undone lines in a page, and brings a redone line back", () => {
    line("u1", "a", t0);
    line("u1", "b", t0 + 1);
    line("u1", "c", t0 + 2);
    undo("m1", "b", t0 + 3);
    undo("m2", "c", t0 + 4);
    undo("m3", "c", t0 + 5, "redo");
    const page = logPage(db, { ...all, limit: 10 });
    expect(ids(page.lines)).toEqual(["c", "a"]);
    expect(logPage(db, { ...all, limit: 1 }).more).toBe(true);
    expect(logPage(db, { ...all, limit: 2 }).more).toBe(false);
  });

  it("drops money lines for a member without money and keeps paging full", () => {
    line("u1", "a", t0);
    raw("m", t0 + 1, { field: "brand_price" });
    raw("n", t0 + 2, { field: null });
    line("u1", "t", t0 + 3, "Marked Lina's deal paid, $500");
    line("u1", "b", t0 + 4);
    const page = logPage(db, { seesMoney: false, before: null, who: null, limit: 2 });
    expect(ids(page.lines)).toEqual(["b", "n"]);
    expect(page.more).toBe(true);
    const next = logPage(db, {
      seesMoney: false,
      before: { at: t0 + 2, id: "n" },
      who: null,
      limit: 5,
    });
    expect(ids(next.lines)).toEqual(["a"]);
    expect(next.more).toBe(false);
    expect(ids(logPage(db, { ...all, limit: 10 }).lines)).toEqual(["b", "t", "n", "m", "a"]);
  });
});

describe("peopleInLog", () => {
  it("counts visible lines per person, most first then by name, with profile names", () => {
    line("u1", "a", t0);
    line("u1", "b", t0 + 1);
    line("u2", "c", t0 + 2);
    line("u2", "d", t0 + 3);
    line("u2", "e", t0 + 4);
    raw("o1", t0 + 5, { actor_id: null, actor_name: "Omar" });
    raw("o2", t0 + 6, { actor_id: null, actor_name: "Omar" });
    raw("z", t0 + 7, { actor_id: null, actor_name: "Ali" });
    raw("z2", t0 + 8, { actor_id: null, actor_name: "Ali" });
    undo("m1", "e", t0 + 9);
    expect(peopleInLog(db, { seesMoney: true })).toEqual({
      people: [
        { who: "Ali", name: "Ali", count: 2 },
        { who: "u1", name: "Maya", count: 2 },
        { who: "Omar", name: "Omar", count: 2 },
        { who: "u2", name: "Sara", count: 2 },
      ],
      total: 8,
    });
  });

  it("uses the newest actor name when the profile is gone, and drops money-field lines from the count", () => {
    raw("a", t0, { actor_id: "ghost", actor_name: "Old name" });
    raw("b", t0 + 1, { actor_id: "ghost", actor_name: "New name", field: "budget" });
    expect(peopleInLog(db, { seesMoney: true })).toEqual({
      people: [{ who: "ghost", name: "New name", count: 2 }],
      total: 2,
    });
    expect(peopleInLog(db, { seesMoney: false })).toEqual({
      people: [{ who: "ghost", name: "New name", count: 1 }],
      total: 1,
    });
  });

  it("returns at most 50 people, and every visible line in the total", () => {
    for (let i = 0; i < 60; i += 1) {
      raw(`p${i.toString()}`, t0 + i, {
        actor_id: null,
        actor_name: `Person ${i.toString().padStart(2, "0")}`,
      });
    }
    const { people, total } = peopleInLog(db, { seesMoney: true });
    expect(people).toHaveLength(50);
    expect(total).toBe(60);
  });

  it("gives no chip to a name too long to ask for, cuts a long profile name, and still counts their lines", () => {
    const long = "A".repeat(101);
    raw("x1", t0, { actor_id: null, actor_name: long });
    raw("x2", t0 + 1, { actor_id: null, actor_name: long });
    upsertProfile(db, { id: "u3", displayName: "B".repeat(600), role: "full" }, t0);
    raw("y1", t0 + 2, { actor_id: "u3", actor_name: "Bea" });
    const { people, total } = peopleInLog(db, { seesMoney: true });
    expect(people).toEqual([{ who: "u3", name: "B".repeat(500), count: 1 }]);
    expect(total).toBe(3);
    expect(
      channels["log:page"].response.safeParse({ lines: [], more: false, people, total }),
    ).toMatchObject({ success: true });
  });
});

describe("linesSince", () => {
  it("counts visible lines at or after the time", () => {
    line("u1", "a", t0);
    line("u1", "b", t0 + 1000);
    line("u1", "c", t0 + 2000);
    raw("m", t0 + 3000, { field: "budget" });
    undo("m1", "c", t0 + 4000);
    expect(linesSince(db, { seesMoney: true, since: t0 + 1000 })).toBe(2);
    expect(linesSince(db, { seesMoney: false, since: t0 + 1000 })).toBe(1);
    expect(linesSince(db, { seesMoney: true, since: t0 + 99999 })).toBe(0);
  });
});
