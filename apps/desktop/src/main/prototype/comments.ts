import { randomInt } from "node:crypto";
import type { DatabaseSync, SQLOutputValue } from "node:sqlite";

import type { Scenario } from "@gratovo/core/data";
import { commentNewSchema, commentSchema, commentsMax } from "@gratovo/ipc";
import type {
  Comment,
  CommentAnchor,
  CommentNew,
  CommentPatch,
  CommentPlace,
  CommentsExportResult,
} from "@gratovo/ipc";

import { writeCommentsExport } from "./export";

/**
 * The owner's comments in `prototype.db` (table `comments`, migration 0005). The page never sees
 * the file: main reads and writes it here. `body` holds the comment's text, `place` and `anchor`
 * are JSON, read back through `commentPlaceSchema` and `commentAnchorSchema` (inside
 * `commentSchema`). A row that doesn't read back is skipped and logged by its kind only, never its text.
 */

type Row = Record<string, SQLOutputValue>;

function parseJson(text: unknown): unknown {
  if (typeof text !== "string") {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** The comment a row holds, checked as strictly as the IPC checks it; null when it doesn't read. */
function commentFrom(row: Row): Comment | null {
  const parsed = commentSchema.safeParse({
    id: row["id"],
    at: row["at"],
    status: row["status"],
    doneAt: row["done_at"],
    kind: row["kind"],
    text: row["body"],
    scenario: row["scenario"],
    place: parseJson(row["place"]),
    anchor: parseJson(row["anchor"]),
  });
  return parsed.success ? parsed.data : null;
}

function skipped(kind: unknown): void {
  const label = typeof kind === "string" && kind.length <= 20 ? kind : "unknown";
  console.warn(`A ${label} comment was skipped: its row does not read back.`);
}

/** Every comment that reads back, oldest first. */
export function listComments(db: DatabaseSync): Comment[] {
  const rows = db.prepare("SELECT * FROM comments ORDER BY at, id").all();
  const result: Comment[] = [];
  for (const row of rows) {
    const comment = commentFrom(row);
    if (comment === null) {
      skipped(row["kind"]);
    } else {
      result.push(comment);
    }
  }
  return result;
}

/** One comment, or null when there is none with that id (or it doesn't read back). */
export function getComment(db: DatabaseSync, id: string): Comment | null {
  const row = db.prepare("SELECT * FROM comments WHERE id = ?").get(id);
  if (row === undefined) {
    return null;
  }
  const comment = commentFrom(row);
  if (comment === null) {
    skipped(row["kind"]);
  }
  return comment;
}

function json(value: CommentPlace | CommentAnchor): string {
  return JSON.stringify(value);
}

/** Adds the comment as it is (its id included). `now` is the row's `updated_at`. */
export function insertComment(db: DatabaseSync, comment: Comment, now: number): void {
  db.prepare(
    "INSERT INTO comments (id, at, status, done_at, kind, body, scenario, place, anchor, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    comment.id,
    comment.at,
    comment.status,
    comment.doneAt,
    comment.kind,
    comment.text,
    comment.scenario,
    json(comment.place),
    json(comment.anchor),
    now,
  );
}

/** Stores the comment's text, status and done time; false when there is no row with its id. */
export function updateComment(db: DatabaseSync, comment: Comment, now: number): boolean {
  const result = db
    .prepare("UPDATE comments SET body = ?, status = ?, done_at = ?, updated_at = ? WHERE id = ?")
    .run(comment.text, comment.status, comment.doneAt, now, comment.id);
  return Number(result.changes) > 0;
}

/** Removes the comment; false when there was none. */
export function deleteComment(db: DatabaseSync, id: string): boolean {
  return Number(db.prepare("DELETE FROM comments WHERE id = ?").run(id).changes) > 0;
}

/** How many rows the table holds (the ones that don't read back included). */
export function countComments(db: DatabaseSync): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM comments").get();
  return Number(row?.["n"] ?? 0);
}

const base36 = "0123456789abcdefghijklmnopqrstuvwxyz";

/** A new comment id: `c`, the time in base 36, then six random base-36 characters. */
export function newCommentId(now: number): string {
  let tail = "";
  for (let i = 0; i < 6; i += 1) {
    tail += base36[randomInt(base36.length)] ?? "0";
  }
  return `c${Math.max(0, Math.trunc(now)).toString(36)}${tail}`;
}

/** The comment calls prototype mode answers (each throws while it is off). */
export interface CommentStore {
  list(): Comment[];
  add(c: CommentNew): Comment;
  update(p: CommentPatch): Comment;
  remove(id: string): Comment | null;
  restore(c: Comment): Comment;
  exportTo(repoRoot: string | null): CommentsExportResult;
}

/**
 * The comment calls on the open copy. `db` answers its database or throws while prototype mode is
 * off; `scenario` is the open copy's scenario, kept on each new comment.
 */
export function createCommentStore(deps: {
  db: () => DatabaseSync;
  now: () => number;
  scenario: () => Scenario;
}): CommentStore {
  const { db } = deps;

  function refuseAtMax(handle: DatabaseSync): void {
    if (countComments(handle) >= commentsMax) {
      throw new Error(`prototype mode keeps at most ${String(commentsMax)} comments`);
    }
  }

  return {
    list() {
      return listComments(db());
    },
    add(input) {
      const handle = db();
      const valid = commentNewSchema.parse(input);
      refuseAtMax(handle);
      const at = deps.now();
      const comment: Comment = {
        id: newCommentId(at),
        at,
        status: "open",
        doneAt: null,
        kind: valid.kind,
        text: valid.text,
        scenario: deps.scenario(),
        place: valid.place,
        anchor: valid.anchor,
      };
      insertComment(handle, comment, at);
      return comment;
    },
    update(patch) {
      const handle = db();
      const existing = getComment(handle, patch.id);
      if (existing === null) {
        throw new Error("There is no comment with that id");
      }
      const now = deps.now();
      const status = patch.status ?? existing.status;
      const text = patch.text === undefined ? existing.text : patch.text.trim();
      if (text === "") {
        throw new Error("A comment needs some text");
      }
      // Done again keeps the time it was first marked done; open clears it.
      const doneAt = status === "open" ? null : existing.status === "done" ? existing.doneAt : now;
      const next: Comment = { ...existing, text, status, doneAt };
      updateComment(handle, next, now);
      return next;
    },
    remove(id) {
      const handle = db();
      const existing = getComment(handle, id);
      // A row that doesn't read back still goes, so the list and the table agree.
      deleteComment(handle, id);
      return existing;
    },
    restore(input) {
      const handle = db();
      const comment = commentSchema.parse(input);
      const existing = getComment(handle, comment.id);
      if (existing !== null) {
        return existing;
      }
      refuseAtMax(handle);
      insertComment(handle, comment, deps.now());
      return comment;
    },
    exportTo(repoRoot) {
      const handle = db();
      return writeCommentsExport(() => listComments(handle), repoRoot, deps.now());
    },
  };
}
