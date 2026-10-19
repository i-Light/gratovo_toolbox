import type { DatabaseSync } from "node:sqlite";

/** A value in `_meta` (bookkeeping such as the example seed version), or null. */
export function getMeta(db: DatabaseSync, key: string): string | null {
  const row = db.prepare("SELECT value FROM _meta WHERE key = ?").get(key);
  return row === undefined ? null : String(row["value"]);
}

export function setMeta(db: DatabaseSync, key: string, value: string): void {
  db.prepare(
    "INSERT INTO _meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}
