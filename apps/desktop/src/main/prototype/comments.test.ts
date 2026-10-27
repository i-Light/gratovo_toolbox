import type { DatabaseSync } from "node:sqlite";

import { commentIdSchema } from "@gratovo/ipc";
import type { Comment } from "@gratovo/ipc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openDatabase } from "../db/open-database";

import {
  countComments,
  deleteComment,
  getComment,
  insertComment,
  listComments,
  newCommentId,
  updateComment,
} from "./comments";

const now = Date.UTC(2026, 9, 26, 9, 0, 0);

function comment(id: string, at: number, overrides: Partial<Comment> = {}): Comment {
  return {
    id,
    at,
    status: "open",
    doneAt: null,
    kind: "fix",
    text: "The board's empty column needs a hint",
    scenario: "normal",
    place: {
      global: false,
      screen: "reach",
      tab: "board",
      record: { kind: "creator", id: "UC123" },
      peek: null,
    },
    anchor: {
      ui: "reach.board.column",
      path: "div:nth-of-type(2)",
      tag: "div",
      text: "Ready",
      label: "Ready column",
      rx: 0.25,
      ry: 0.5,
    },
    ...overrides,
  };
}

describe("comments repository", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = openDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  it("stores a comment and reads it back exactly, oldest first", () => {
    const second = comment("cbbbbbb2", now + 1000, { kind: "idea", status: "done", doneAt: now });
    const first = comment("caaaaaa1", now);
    insertComment(db, second, now);
    insertComment(db, first, now);
    expect(listComments(db)).toEqual([first, second]);
    expect(getComment(db, "cbbbbbb2")).toEqual(second);
    expect(getComment(db, "cmissing")).toBeNull();
    expect(countComments(db)).toBe(2);
    const row = db.prepare("SELECT body, done_at FROM comments WHERE id = ?").get("cbbbbbb2");
    expect(row).toEqual({ body: second.text, done_at: now });
  });

  it("updates the text, status and done time", () => {
    insertComment(db, comment("caaaaaa1", now), now);
    const next = comment("caaaaaa1", now, { text: "Better", status: "done", doneAt: now + 5 });
    expect(updateComment(db, next, now + 5)).toBe(true);
    expect(getComment(db, "caaaaaa1")).toEqual(next);
    expect(updateComment(db, comment("cnothere", now), now)).toBe(false);
  });

  it("deletes a comment", () => {
    insertComment(db, comment("caaaaaa1", now), now);
    expect(deleteComment(db, "caaaaaa1")).toBe(true);
    expect(deleteComment(db, "caaaaaa1")).toBe(false);
    expect(countComments(db)).toBe(0);
  });

  it("skips a row whose JSON doesn't read back, and logs only its kind", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    insertComment(db, comment("caaaaaa1", now), now);
    db.prepare(
      "INSERT INTO comments (id, at, status, done_at, kind, body, scenario, place, anchor, updated_at) VALUES (?, ?, 'open', NULL, 'question', ?, 'normal', ?, ?, ?)",
    ).run(
      "cbroken1",
      now + 1,
      "secret words",
      "{not json",
      JSON.stringify(comment("x", 0).anchor),
      now,
    );
    db.prepare(
      "INSERT INTO comments (id, at, status, done_at, kind, body, scenario, place, anchor, updated_at) VALUES (?, ?, 'open', NULL, 'idea', ?, 'normal', ?, ?, ?)",
    ).run(
      "cbroken2",
      now + 2,
      "more secret words",
      JSON.stringify({ ...comment("x", 0).place, extra: 1 }),
      JSON.stringify(comment("x", 0).anchor),
      now,
    );
    expect(listComments(db).map((c) => c.id)).toEqual(["caaaaaa1"]);
    expect(countComments(db)).toBe(3);
    expect(warn).toHaveBeenCalledTimes(2);
    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).toContain("question");
    expect(logged).not.toContain("secret");
  });

  it("makes ids the IPC accepts, different each time", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newCommentId(now)));
    expect(ids.size).toBe(50);
    for (const id of ids) {
      expect(commentIdSchema.safeParse(id).success).toBe(true);
    }
    expect(newCommentId(now).startsWith(`c${now.toString(36)}`)).toBe(true);
  });
});
