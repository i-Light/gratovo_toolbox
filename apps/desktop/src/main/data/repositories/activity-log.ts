import type { DatabaseSync } from "node:sqlite";

import type { LogEntry } from "@gratovo/core/data";

/** The most lines `newestLog` returns. */
export const logCap = 50;

/**
 * Adds a line to the log. The actor is the profile `me` (a missing profile logs an empty name
 * and the `unauthorized` role). `entry.at` is in ms; the table stores ISO text.
 */
export function addLogEntry(db: DatabaseSync, me: string, entry: LogEntry): void {
  const actor = db.prepare("SELECT display_name, role FROM profiles WHERE id = ?").get(me);
  db.prepare(
    `INSERT INTO activity_log (id, at, actor_id, actor_name, actor_role, action, entity_type)
     VALUES (?, ?, ?, ?, ?, ?, 'app')`,
  ).run(
    entry.id,
    new Date(entry.at).toISOString(),
    me,
    actor === undefined ? "" : String(actor["display_name"]),
    actor === undefined ? "unauthorized" : String(actor["role"]),
    entry.text,
  );
}

/** Removes a line; false when there is no such line. */
export function removeLogEntry(db: DatabaseSync, id: string): boolean {
  const result = db.prepare("DELETE FROM activity_log WHERE id = ?").run(id);
  return Number(result.changes) > 0;
}

/** The newest lines first (`who` is the member id; rows from the old app without one give the name), at most `limit` (never more than `logCap`). */
export function newestLog(db: DatabaseSync, limit: number = logCap): LogEntry[] {
  const count = Math.max(0, Math.min(Math.floor(limit), logCap));
  const rows = db
    .prepare(
      "SELECT id, at, actor_id, actor_name, action FROM activity_log ORDER BY at DESC, id DESC LIMIT ?",
    )
    .all(count);
  return rows.map((row) => {
    const at = Date.parse(String(row["at"]));
    return {
      id: String(row["id"]),
      at: Number.isNaN(at) ? 0 : at,
      who: String(row["actor_id"] ?? row["actor_name"]),
      text: String(row["action"]),
    };
  });
}
