import type { DatabaseSync } from "node:sqlite";

import { logText, nameMax } from "@gratovo/core/data";
import type { DataWrite } from "@gratovo/core/data";

import {
  cancelActivityAdd,
  enqueue,
  getProfile,
  insertLogRow,
  logRowFor,
} from "../data/repositories";
import type { ActivityRow } from "../data/repositories";

// D11: what each write also puts in the outbox. Runs inside the batch's transaction, so a local
// effect and its entry commit together or not at all.

interface LineRow {
  readonly text: string;
  readonly hidden: boolean;
  readonly newestMarkerMs: number;
}

function optional(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseDetail(value: unknown): unknown {
  if (typeof value !== "string") {
    return null;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

/** The line with this id: its text, whether an undo hides it, and its newest marker's time. */
function findLine(db: DatabaseSync, id: string): LineRow | null {
  const row = db.prepare("SELECT * FROM activity_log WHERE id = ?").get(id);
  if (row === undefined) {
    return null;
  }
  const marker = db
    .prepare(
      `SELECT action, at_ms FROM activity_log
       WHERE entity_type = 'activity_log' AND entity_id = ? AND action IN ('undo', 'redo')
       ORDER BY at_ms DESC, id DESC LIMIT 1`,
    )
    .get(id);
  return {
    text: logText({
      action: String(row["action"]),
      entityType: String(row["entity_type"]),
      entityLabel: optional(row["entity_label"]),
      field: optional(row["field"]),
      oldValue: optional(row["old_value"]),
      newValue: optional(row["new_value"]),
      detail: parseDetail(row["detail"]),
    }),
    hidden: marker !== undefined && marker["action"] === "undo",
    newestMarkerMs: marker === undefined ? 0 : Number(marker["at_ms"]),
  };
}

export function recordIntent(
  db: DatabaseSync,
  o: {
    userId: string;
    write: DataWrite;
    applyLocal: () => void;
    now: number;
    newId: () => string;
  },
): void {
  const { userId, write, applyLocal, now } = o;

  function queueLine(row: ActivityRow): void {
    // Only the signed-in member's own lines go to the server.
    if (row.actor_id !== userId) {
      return;
    }
    enqueue(db, {
      userId,
      kind: "activity.add",
      payload: { row },
      target: { table: "activity_log", key: row.id },
      now,
    });
  }

  /** Adds a marker line for `lineId` and queues it. Its time is later than any earlier marker's. */
  function mark(action: "undo" | "redo", lineId: string, line: LineRow): void {
    const at = Math.max(now, line.newestMarkerMs + 1);
    const row: ActivityRow = {
      ...logRowFor(db, userId, { id: o.newId(), at, who: userId, text: line.text }),
      action,
      entity_type: "activity_log",
      entity_id: lineId,
      entity_label: line.text,
      detail: null,
    };
    insertLogRow(db, row);
    queueLine(row);
  }

  switch (write.kind) {
    case "me.name": {
      const exists = getProfile(db, userId) !== null;
      applyLocal();
      if (exists) {
        enqueue(db, {
          userId,
          kind: "profile.name",
          payload: { name: write.name.trim().slice(0, nameMax) },
          target: { table: "profiles", key: userId },
          now,
        });
      }
      return;
    }
    case "notify.set":
      applyLocal();
      enqueue(db, {
        userId,
        kind: "notify.set",
        payload: { switches: write.notify },
        target: { table: "notification_switches", key: userId },
        now,
      });
      return;
    case "log.add": {
      const line = findLine(db, write.id);
      if (line?.hidden === true) {
        // A redo: the line is still here and an undo hides it.
        mark("redo", write.id, line);
        return;
      }
      applyLocal();
      queueLine(
        logRowFor(db, userId, { id: write.id, at: write.at, who: userId, text: write.text }),
      );
      return;
    }
    case "log.remove": {
      if (cancelActivityAdd(db, write.id)) {
        // Never sent: the line and its entry both go.
        applyLocal();
        return;
      }
      const line = findLine(db, write.id);
      if (line === null) {
        applyLocal();
        return;
      }
      if (!line.hidden) {
        mark("undo", write.id, line);
      }
      return;
    }
    default:
      // notification.read stays local; the new kinds are S21's.
      applyLocal();
  }
}
