/**
 * Sign-out with unsent changes (plan D18, the owner's Q3 answer): the local copy keeps only the
 * outbox and whose it is. One transaction empties every other table (the mirror, the local tables,
 * `_outbox_dropped`) and every other `_meta` key, so the team's data doesn't stay on disk. The
 * caller then runs `VACUUM`, so the freed pages are rewritten, and closes the file.
 *
 * Signing back in as the same account keeps the file, pulls from scratch (the cursors are gone)
 * and sends the outbox first. Signing in as anyone else deletes it.
 */

import type { DatabaseSync } from "node:sqlite";

import { inTransaction } from "../data/sqlite-source";

/** The `_meta` key that says whose copy this is; the one key kept. */
export const accountUserKey = "account.user_id";

const keptTables: ReadonlySet<string> = new Set(["_outbox", "_meta"]);

/** Every row but the outbox's and `account.user_id` goes, in one transaction. */
export function keepOnlyUnsent(db: DatabaseSync): void {
  // Every table the migrations made, so a table added later is emptied too. SQLite's own tables
  // (`sqlite_sequence` keeps the outbox's next number) stay.
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'",
    )
    .all()
    .map((row) => String(row["name"]))
    .filter((name) => !keptTables.has(name));
  inTransaction(db, () => {
    for (const name of tables) {
      db.exec(`DELETE FROM "${name.replaceAll('"', '""')}"`);
    }
    db.prepare("DELETE FROM _meta WHERE key <> ?").run(accountUserKey);
  });
}
