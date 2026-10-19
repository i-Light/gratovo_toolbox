import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { migrate } from "./migrate";

/** Opens (or creates) the database, sets the pragmas and migrates it. */
export function openDatabase(path: string): DatabaseSync {
  const inMemory = path === ":memory:";
  if (!inMemory) mkdirSync(dirname(path), { recursive: true });

  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    const row = db.prepare("PRAGMA journal_mode = WAL").get();
    const mode = String(row?.["journal_mode"] ?? "");
    // An in-memory database cannot use WAL; it answers "memory".
    if (!inMemory && mode !== "wal") {
      throw new Error(`The database would not switch to WAL mode (it said "${mode}")`);
    }
    db.exec("PRAGMA synchronous = NORMAL");
    db.exec("PRAGMA foreign_keys = ON");
    migrate(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
