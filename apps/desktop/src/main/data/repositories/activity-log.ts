import type { DatabaseSync, SQLOutputValue } from "node:sqlite";

import { logActions, logText, mentionsMoney, moneyFields } from "@gratovo/core/data";
import type { LogEntry } from "@gratovo/core/data";

/** The most lines `newestLog` returns. */
export const logCap = 50;

/** A log row with the server's columns (`at` is ISO text, `detail` is the parsed object). */
export interface ActivityRow {
  id: string;
  at: string;
  actor_id: string | null;
  actor_name: string;
  actor_role: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  entity_label: string | null;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  detail: Record<string, unknown> | null;
}

/** What a written line needs: the read-back fields (`ref`, `action`, `detail`) may be left out. */
export type LogLine = Pick<LogEntry, "id" | "at" | "who" | "text"> &
  Partial<Pick<LogEntry, "ref" | "action" | "detail">>;

/**
 * The row for a line this app writes. The text is always in `detail.text`, which `logText` reads
 * back first. A line about nothing in particular is `action = 'note'`, `entity_type = 'app'`, with
 * the text as the label. A line about a creator (`ref`) is `entity_type = 'channel'` (as the old
 * app files them), `entity_id` the creator, labelled with the creator's name (else the handle,
 * else the id); its `action` is the line's own when it has one, and its `detail` (a reject
 * reason) is `detail.reason`. The actor is the profile `me` (a missing profile logs an empty name
 * and the `unauthorized` role). `entry.at` is in ms; the row holds ISO text.
 */
export function logRowFor(db: DatabaseSync, me: string, entry: LogLine): ActivityRow {
  const actor = db.prepare("SELECT display_name, role FROM profiles WHERE id = ?").get(me);
  const ref = entry.ref ?? null;
  const detail = entry.detail ?? null;
  return {
    id: entry.id,
    at: new Date(entry.at).toISOString(),
    actor_id: me,
    actor_name: actor === undefined ? "" : String(actor["display_name"]),
    actor_role: actor === undefined ? "unauthorized" : String(actor["role"]),
    action: entry.action ?? "note",
    entity_type: ref === null ? "app" : "channel",
    entity_id: ref,
    entity_label: ref === null ? entry.text : creatorLabel(db, ref),
    field: null,
    old_value: null,
    new_value: null,
    detail: detail === null ? { text: entry.text } : { text: entry.text, reason: detail },
  };
}

/** A creator's name as a log line names it: the stored name, else the handle, else the id. */
function creatorLabel(db: DatabaseSync, id: string): string {
  const row = db
    .prepare(
      `SELECT (SELECT name FROM channels WHERE channel_id = ?1 AND name <> '') AS name,
              (SELECT handle FROM channel_state WHERE channel_id = ?1) AS handle`,
    )
    .get(id);
  const name = row?.["name"];
  const handle = row?.["handle"];
  return typeof name === "string" ? name : typeof handle === "string" ? handle : id;
}

/** Inserts a row (a duplicate id throws) and sets `at_ms` from `at`. */
export function insertLogRow(db: DatabaseSync, row: ActivityRow): void {
  const ms = Date.parse(row.at);
  db.prepare(
    `INSERT INTO activity_log
       (id, at, at_ms, actor_id, actor_name, actor_role, action, entity_type, entity_id,
        entity_label, field, old_value, new_value, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.at,
    Number.isNaN(ms) ? 0 : ms,
    row.actor_id,
    row.actor_name,
    row.actor_role,
    row.action,
    row.entity_type,
    row.entity_id,
    row.entity_label,
    row.field,
    row.old_value,
    row.new_value,
    row.detail === null ? null : JSON.stringify(row.detail),
  );
}

/** Adds a line to the log, in the app's own shape. */
export function addLogEntry(db: DatabaseSync, me: string, entry: LogLine): void {
  insertLogRow(db, logRowFor(db, me, entry));
}

/** Removes a line; false when there is no such line. */
export function removeLogEntry(db: DatabaseSync, id: string): boolean {
  const result = db.prepare("DELETE FROM activity_log WHERE id = ?").run(id);
  return Number(result.changes) > 0;
}

const pageSize = 200;
const moneyFieldList = moneyFields.map(() => "?").join(", ");

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

function optional(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * A row's `ref`, `action` and `detail` as the frame reads them, for this app's lines and pulled
 * ones alike: the creator a `channel` row is about (the old app's lines too), an action this app
 * knows (any other is null), and the reason in `detail.reason`. A pulled row can hold anything, so
 * an id outside the frame's bounds is no ref and a long reason is cut, as the IPC schema allows.
 */
function lineFields(
  row: Readonly<Record<string, SQLOutputValue>>,
  detail: unknown,
): Pick<LogEntry, "ref" | "action" | "detail"> {
  const reason =
    typeof detail === "object" && detail !== null && !Array.isArray(detail)
      ? (detail as Readonly<Record<string, unknown>>)["reason"]
      : null;
  const ref = row["entity_type"] === "channel" ? optional(row["entity_id"]) : null;
  return {
    ref: ref !== null && ref.length > 0 && ref.length <= refMax ? ref : null,
    action: logActions.find((known) => known === row["action"]) ?? null,
    detail: typeof reason === "string" ? reason.slice(0, detailMax) : null,
  };
}

/** The frame's bounds on a line's ref and detail (`idMax` and `detailMax` in the ipc package). */
const refMax = 100;
const detailMax = 500;

/**
 * The newest lines first, by time (`at_ms`, then id), at most `limit` (never more than `logCap`).
 * Undo and redo markers are hidden, and so is every line whose newest marker is an undo. A member
 * without money (`seesMoney` false) gets no line with a money field or text that mentions money:
 * dropped, not edited. `who` is the member id; rows from the old app without one give the name.
 */
export function newestLog(db: DatabaseSync, o: { seesMoney: boolean; limit?: number }): LogEntry[] {
  const count = Math.max(0, Math.min(Math.floor(o.limit ?? logCap), logCap));
  const statement = db.prepare(
    `SELECT a.id, a.at, a.at_ms, a.actor_id, a.actor_name, a.action, a.entity_type, a.entity_id,
            a.entity_label, a.field, a.old_value, a.new_value, a.detail
     FROM activity_log a
     WHERE NOT (a.entity_type = 'activity_log' AND a.action IN ('undo', 'redo'))
       AND COALESCE((SELECT m.action FROM activity_log m
                     WHERE m.entity_type = 'activity_log' AND m.entity_id = a.id
                       AND m.action IN ('undo', 'redo')
                     ORDER BY m.at_ms DESC, m.id DESC LIMIT 1), '') <> 'undo'
       ${o.seesMoney ? "" : `AND (a.field IS NULL OR a.field NOT IN (${moneyFieldList}))`}
     ORDER BY a.at_ms DESC, a.id DESC
     LIMIT ? OFFSET ?`,
  );
  const lines: LogEntry[] = [];
  // Without money, some rows are dropped after the query, so read on until `count` lines are kept.
  for (let offset = 0; lines.length < count; offset += pageSize) {
    const params: (string | number)[] = o.seesMoney ? [] : [...moneyFields];
    const page = statement.all(...params, o.seesMoney ? count : pageSize, offset);
    for (const row of page) {
      const detail = parseDetail(row["detail"]);
      const text = logText({
        action: String(row["action"]),
        entityType: String(row["entity_type"]),
        entityLabel: optional(row["entity_label"]),
        field: optional(row["field"]),
        oldValue: optional(row["old_value"]),
        newValue: optional(row["new_value"]),
        detail,
      });
      if (!o.seesMoney && mentionsMoney(text)) {
        continue;
      }
      const atMs = row["at_ms"] === null ? Date.parse(String(row["at"])) : Number(row["at_ms"]);
      lines.push({
        id: String(row["id"]),
        at: Number.isNaN(atMs) ? 0 : atMs,
        who: String(row["actor_id"] ?? row["actor_name"]),
        text,
        ...lineFields(row, detail),
      });
      if (lines.length >= count) {
        break;
      }
    }
    if (o.seesMoney || page.length < pageSize) {
      break;
    }
  }
  return lines;
}
