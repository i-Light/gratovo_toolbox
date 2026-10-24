import type { DatabaseSync, SQLInputValue } from "node:sqlite";

import { primaryEmail } from "@gratovo/core/data";
import type { EditConflict } from "@gratovo/core/data";

/** The most conflicts the frame carries (the IPC limit). */
const listLimit = 100;

const columns = [
  "id",
  "channel_id",
  "channel_label",
  "field",
  "base_value",
  "mine_value",
  "theirs_value",
  "mine_actor_id",
  "mine_actor_name",
  "theirs_actor_name",
  "detected_at",
  "resolved_at",
  "updated_at",
] as const;

/**
 * Makes the mirror hold exactly `rows`, your open conflicts as the server has them: a row is
 * added or updated by id, and a conflict the server no longer lists is removed. A conflict you
 * already settled here keeps that mark while the server still lists it (the settling is still on
 * its way). Returns the ids now in the mirror.
 */
export function replaceOpenConflicts(
  db: DatabaseSync,
  rows: readonly Record<string, SQLInputValue>[],
): ReadonlySet<string> {
  const ids = new Set<string>();
  const insert = db.prepare(
    `INSERT INTO edit_conflicts (${columns.join(", ")})
     VALUES (${columns.map(() => "?").join(", ")})
     ON CONFLICT (id) DO UPDATE SET ${columns
       .filter((c) => c !== "id")
       .map((c) => `${c} = excluded.${c}`)
       .join(", ")}`,
  );
  for (const row of rows) {
    const id = row["id"];
    if (typeof id !== "string" || id === "") {
      continue;
    }
    ids.add(id);
    insert.run(...columns.map((c) => row[c] ?? (c === "mine_actor_name" ? "" : null)));
  }
  const existing = db.prepare("SELECT id FROM edit_conflicts").all();
  const remove = db.prepare("DELETE FROM edit_conflicts WHERE id = ?");
  for (const row of existing) {
    const id = String(row["id"]);
    if (!ids.has(id)) {
      remove.run(id);
    }
  }
  return ids;
}

/** Your open conflicts you haven't settled here, in the order they arrived, at most 100. */
export function listConflicts(db: DatabaseSync): EditConflict[] {
  const rows = db
    .prepare(
      `SELECT id, channel_id, channel_label, field, mine_value, theirs_value, theirs_actor_name
       FROM edit_conflicts
       WHERE resolved_at IS NULL AND resolved_locally = 0
       ORDER BY rowid LIMIT ?`,
    )
    .all(listLimit);
  return rows.map((row) => ({
    id: String(row["id"]),
    creator: String(row["channel_id"]),
    label: String(row["channel_label"]),
    field: String(row["field"]),
    mine: displayValue(row["mine_value"], String(row["field"])),
    theirs: displayValue(row["theirs_value"], String(row["field"])),
    theirName:
      row["theirs_actor_name"] === null || String(row["theirs_actor_name"]) === ""
        ? "someone"
        : String(row["theirs_actor_name"]),
  }));
}

/**
 * Marks an open conflict as settled on this computer. Returns what it held, or null when there is
 * no such open conflict (or it is already settled here).
 */
export function markResolved(
  db: DatabaseSync,
  id: string,
): { channelId: string; field: string; mine: unknown; theirs: unknown } | null {
  const row = db
    .prepare(
      `SELECT channel_id, field, mine_value, theirs_value FROM edit_conflicts
       WHERE id = ? AND resolved_at IS NULL AND resolved_locally = 0`,
    )
    .get(id);
  if (row === undefined) {
    return null;
  }
  db.prepare("UPDATE edit_conflicts SET resolved_locally = 1 WHERE id = ?").run(id);
  return {
    channelId: String(row["channel_id"]),
    field: String(row["field"]),
    mine: parseValue(row["mine_value"]),
    theirs: parseValue(row["theirs_value"]),
  };
}

/** A stored value is JSON text; text that isn't JSON stands for itself. */
function parseValue(stored: unknown): unknown {
  if (stored === null || stored === undefined) {
    return null;
  }
  if (typeof stored !== "string") {
    return stored;
  }
  const text = stored;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** The longest value a conflict carries (`textMax` in the ipc package): notes can be longer. */
const valueMax = 500;

/**
 * A value as the person reads it: a stage key as it is, contacts as their primary address, arrays
 * joined, nothing as "empty", cut to `valueMax` so a long note can't push the frame past its
 * limits.
 */
function displayValue(stored: unknown, field: string): string {
  const value = parseValue(stored);
  const shown =
    field === "contacts" && Array.isArray(value)
      ? (primaryEmail(JSON.stringify(value)) ?? "empty")
      : display(value);
  return shown.length > valueMax ? `${shown.slice(0, valueMax - 1)}…` : shown;
}

function display(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "empty";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const parts = (value as readonly unknown[]).map(display);
    return parts.length === 0 ? "empty" : parts.join(", ");
  }
  return JSON.stringify(value);
}
