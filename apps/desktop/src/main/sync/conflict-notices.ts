import type { DatabaseSync } from "node:sqlite";

import { listConflicts } from "../data/repositories/conflicts";
import { upsertNotification } from "../data/repositories/notifications";
import { strings } from "../strings";
import { serverTimeMs } from "./server-time";

const prefix = "conflict:";

/** The words a notice is built from (the default is the app's own). */
export type ConflictWords = typeof strings.conflict;

/** The longest value a notice shows: notes can run to 50,000 characters, a notice line can't. */
const shownMax = 120;

/**
 * A value as a person reads it: a stage key becomes its name, anything else stays as it is, cut
 * to `shownMax` so the notice keeps inside its limits.
 */
function show(field: string, value: string, words: ConflictWords): string {
  const shown = field === "creator_stage" ? (words.stages[value] ?? value) : value;
  return shown.length > shownMax ? `${shown.slice(0, shownMax - 1)}…` : shown;
}

/**
 * Makes the local notifications match the open conflicts: one `conflict:<id>` for each open
 * conflict not settled here, and none for a conflict that is gone or settled. Joins the open
 * transaction when there is one, else makes its own. Returns whether anything changed.
 */
export function syncConflictNotices(
  db: DatabaseSync,
  words: ConflictWords = strings.conflict,
): boolean {
  const own = !isOpen(db);
  if (own) {
    db.exec("BEGIN IMMEDIATE");
  }
  try {
    const changed = sync(db, words);
    if (own) {
      db.exec("COMMIT");
    }
    return changed;
  } catch (error) {
    if (own && isOpen(db)) {
      db.exec("ROLLBACK");
    }
    throw error;
  }
}

function sync(db: DatabaseSync, w: ConflictWords): boolean {
  let changed = false;
  const times = new Map(
    db
      .prepare("SELECT id, detected_at FROM edit_conflicts")
      .all()
      .map((r) => [String(r["id"]), r["detected_at"]] as const),
  );
  const existing = new Map(
    db
      .prepare("SELECT id, at, text, sub, read FROM notifications WHERE id LIKE 'conflict:%'")
      .all()
      .map((r) => [String(r["id"]), r] as const),
  );
  const wanted = new Set<string>();
  for (const c of listConflicts(db)) {
    const id = prefix + c.id;
    wanted.add(id);
    const detected = times.get(c.id);
    const at = (typeof detected === "string" ? serverTimeMs(detected) : null) ?? 0;
    const text = w.text(c.label, c.theirName === "someone" ? w.someone : c.theirName);
    const sub = w.sub(
      w.fields[c.field] ?? c.field,
      show(c.field, c.mine, w),
      show(c.field, c.theirs, w),
    );
    const old = existing.get(id);
    if (
      old !== undefined &&
      Number(old["at"]) === at &&
      old["text"] === text &&
      old["sub"] === sub
    ) {
      continue;
    }
    upsertNotification(
      db,
      {
        id,
        at,
        icon: "alert",
        text,
        sub,
        go: { screen: "today", tab: null },
        // A notice already read stays read when only its words are refreshed.
        read: old !== undefined && Number(old["read"]) !== 0,
      },
      { money: false },
    );
    changed = true;
  }
  for (const id of existing.keys()) {
    if (!wanted.has(id)) {
      db.prepare("DELETE FROM notifications WHERE id = ?").run(id);
      changed = true;
    }
  }
  return changed;
}

function isOpen(db: DatabaseSync): boolean {
  return db.isTransaction;
}
