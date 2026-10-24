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
import { readTags } from "../data/repositories/creators";

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

/** A stored conflict value is JSON text; text that isn't JSON stands for itself, nothing is null. */
function parseValue(stored: unknown): unknown {
  if (typeof stored !== "string") {
    return stored ?? null;
  }
  try {
    return JSON.parse(stored) as unknown;
  } catch {
    return stored;
  }
}

/** Whether two tag lists hold the same tags; the server compares them sorted, so order is no change. */
function sameTags(a: readonly string[], b: readonly string[]): boolean {
  const sorted = (tags: readonly string[]): string => JSON.stringify([...tags].sort());
  return sorted(a) === sorted(b);
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
        logRowFor(db, userId, {
          id: write.id,
          at: write.at,
          who: userId,
          text: write.text,
          ref: write.ref,
          action: write.action,
          detail: write.detail,
        }),
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
    case "creator.stage": {
      // The base is the stored column, read before the write: null when it was never set (or
      // there was no row: main creates it, D4, and so does the server), so a first edit isn't a
      // false conflict even though the frame showed a derived stage.
      const row = db
        .prepare("SELECT creator_stage FROM channel_state WHERE channel_id = ?")
        .get(write.id);
      const base = row === undefined ? null : optional(row["creator_stage"]);
      // A new row starts with no tags, here and on the server.
      const tagsBefore = readTags(db, write.id) ?? [];
      applyLocal();
      const label = db
        .prepare("SELECT handle FROM channel_state WHERE channel_id = ?")
        .get(write.id)?.["handle"];
      if (label === undefined) {
        return;
      }
      const edit = (field: string, before: unknown, next: unknown): void => {
        enqueue(db, {
          userId,
          kind: "channel.edit",
          payload: { channelId: write.id, field, base: before, next, label: String(label) },
          target: { table: "channel_state", key: write.id },
          now,
        });
      };
      // The stage first, then the tags it moved (D5): the server sees them in that order.
      if (base !== write.stage) {
        edit("creator_stage", base, write.stage);
      }
      const tagsAfter = readTags(db, write.id) ?? [];
      if (!sameTags(tagsBefore, tagsAfter)) {
        edit("channel_tags", tagsBefore, tagsAfter);
      }
      return;
    }
    case "brand.set":
      applyLocal();
      enqueue(db, {
        userId,
        kind: "brand.set",
        payload: { id: write.id, name: write.name, sells: write.sells, status: write.status },
        target: { table: "brands", key: write.id },
        now,
      });
      return;
    case "deal.step":
      applyLocal();
      enqueue(db, {
        userId,
        kind: "deal.step",
        payload: { id: write.id, step: write.step },
        target: { table: "deals", key: write.id },
        now,
      });
      return;
    case "conflict.resolve": {
      // Read the open conflict before applyLocal marks it settled.
      const row = db
        .prepare(
          `SELECT channel_id, mine_value, theirs_value FROM edit_conflicts
           WHERE id = ? AND resolved_at IS NULL AND resolved_locally = 0`,
        )
        .get(write.id);
      applyLocal();
      if (row === undefined) {
        return;
      }
      enqueue(db, {
        userId,
        kind: "conflict.resolve",
        payload: {
          id: write.id,
          resolution: write.choice,
          value: parseValue(row[write.choice === "mine" ? "mine_value" : "theirs_value"]),
        },
        target: { table: "channel_state", key: String(row["channel_id"]) },
        now,
      });
      return;
    }
    case "notification.read":
      // Stays local.
      applyLocal();
      return;
  }
}
