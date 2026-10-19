import type { DatabaseSync } from "node:sqlite";

import { migrations } from "./migrations";

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

/** The database was written by a newer app; it is never downgraded. */
export class DatabaseTooNewError extends Error {
  constructor(
    readonly found: number,
    readonly known: number,
  ) {
    super(
      `The database is at version ${String(found)}, but this app only knows up to ${String(known)}`,
    );
    this.name = "DatabaseTooNewError";
  }
}

function userVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get();
  return Number(row?.["user_version"] ?? 0);
}

/**
 * Forward-only. Each pending migration runs in its own transaction that also
 * sets `user_version`; a failure rolls that one back and throws.
 */
export function migrate(db: DatabaseSync, list: readonly Migration[] = migrations): void {
  const known = list.length === 0 ? 0 : Math.max(...list.map((m) => m.version));
  const current = userVersion(db);
  if (current > known) throw new DatabaseTooNewError(current, known);

  const pending = list.filter((m) => m.version > current).sort((a, b) => a.version - b.version);
  for (const migration of pending) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(migration.sql);
      db.exec(`PRAGMA user_version = ${String(migration.version)}`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}
