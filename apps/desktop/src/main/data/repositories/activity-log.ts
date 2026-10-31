import type { DatabaseSync, SQLOutputValue } from "node:sqlite";

import { DEAL_FLOW } from "@gratovo/core";
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

/** The most lines `linesFor` returns (`logForMax` in the ipc package). */
export const linesForCap = 100;

/**
 * The newest lines first, by time (`at_ms`, then id), at most `limit` (never more than `logCap`).
 * Undo and redo markers are hidden, and so is every line whose newest marker is an undo. A member
 * without money (`seesMoney` false) gets no line with a money field or text that mentions money:
 * dropped, not edited. `who` is the member id; rows from the old app without one give the name.
 */
export function newestLog(db: DatabaseSync, o: { seesMoney: boolean; limit?: number }): LogEntry[] {
  return readLines(db, { seesMoney: o.seesMoney, count: capped(o.limit ?? logCap, logCap) });
}

/**
 * The lines about one creator (`entity_type 'channel'`, `entity_id = ref`), newest first, at most
 * `limit` (never more than `linesForCap`), hidden and mapped as `newestLog` does them: a record's
 * Activity tab (plan step 5, D23). One query, on `idx_activity_log_entity`.
 */
export function linesFor(
  db: DatabaseSync,
  ref: string,
  o: { seesMoney: boolean; limit: number },
): LogEntry[] {
  const count = capped(o.limit, linesForCap);
  const lines = readLines(db, { seesMoney: o.seesMoney, count, ref });
  const events = eventLines(db, ref, o.seesMoney, count);
  if (events.length === 0) {
    return lines;
  }
  return [...lines, ...events]
    .sort((x, y) => y.at - x.at || (x.id < y.id ? 1 : -1))
    .slice(0, count);
}

/** How a brand status reads in a line. */
const statusWords: Readonly<Record<string, string>> = {
  found: "Found",
  qualified: "Qualified",
  pitched: "Pitched",
  negotiating: "Negotiating",
  won: "Won",
  lost: "Not a fit",
};

/**
 * The step and status lines of a deal or a brand (R8), from `deal_events` and `brand_events`:
 * "Moved to Contracts", "Status set to Negotiating". The first row a backfill wrote has no real
 * time, so it makes no line. The events hold no author, so `who` is empty. An id that is neither
 * a deal nor a brand gives nothing. A member without money gets no line that mentions money.
 */
function eventLines(db: DatabaseSync, ref: string, seesMoney: boolean, count: number): LogEntry[] {
  const lines: LogEntry[] = [];
  const add = (kind: string, id: unknown, at: unknown, text: string): void => {
    if (seesMoney || !mentionsMoney(text)) {
      lines.push({
        id: `${kind}-event-${String(id)}`,
        at: Number(at),
        who: "",
        text,
        ref: null,
        action: null,
        detail: null,
      });
    }
  };
  const deals = db
    .prepare(
      "SELECT id, step, at FROM deal_events WHERE deal_id = ? AND source <> 'backfill' ORDER BY at DESC, id DESC LIMIT ?",
    )
    .all(ref, count);
  for (const row of deals) {
    const step = DEAL_FLOW[Number(row["step"])];
    if (step !== undefined) {
      add("deal", row["id"], row["at"], `Moved to ${step.name}`);
    }
  }
  const brands = db
    .prepare(
      "SELECT id, status, at FROM brand_events WHERE brand_id = ? AND source <> 'backfill' ORDER BY at DESC, id DESC LIMIT ?",
    )
    .all(ref, count);
  for (const row of brands) {
    const status = statusWords[String(row["status"])];
    if (status !== undefined) {
      add("brand", row["id"], row["at"], `Status set to ${status}`);
    }
  }
  return lines;
}

function capped(limit: number, cap: number): number {
  return Math.max(0, Math.min(Math.floor(limit), cap));
}

/** The most lines `logPage` returns (`logPageMax` in the ipc package). */
export const logPageCap = 100;

/** The most people `peopleInLog` returns. */
export const peopleCap = 50;

/** Where a line sits: the cursor for the next page is the last line's `{ at, id }`. */
export interface LogCursor {
  at: number;
  id: string;
}

/** A line's `who` as SQL: the member id, else the old app's name. */
const whoSql = "COALESCE(a.actor_id, a.actor_name)";

/**
 * The conditions that make a row visible, as SQL, with their parameters in order: not an undo or
 * redo marker, not undone by its newest marker, and (without money) no money field.
 */
function visibleSql(seesMoney: boolean): { sql: string; params: string[] } {
  return {
    sql: `NOT (a.entity_type = 'activity_log' AND a.action IN ('undo', 'redo'))
       AND COALESCE((SELECT m.action FROM activity_log m
                     WHERE m.entity_type = 'activity_log' AND m.entity_id = a.id
                       AND m.action IN ('undo', 'redo')
                     ORDER BY m.at_ms DESC, m.id DESC LIMIT 1), '') <> 'undo'
       ${seesMoney ? "" : `AND (a.field IS NULL OR a.field NOT IN (${moneyFieldList}))`}`,
    params: seesMoney ? [] : [...moneyFields],
  };
}

/**
 * One page of the whole log, newest first by `(at_ms, id)`, strictly after the `before` cursor,
 * at most `limit` (never more than `logPageCap`), hidden and mapped as `newestLog` does. `who`
 * keeps one person's lines (the member id, else the old app's name). `more` is whether at least
 * one further visible line exists.
 */
export function logPage(
  db: DatabaseSync,
  o: { seesMoney: boolean; before: LogCursor | null; limit: number; who: string | null },
): { lines: LogEntry[]; more: boolean } {
  const limit = capped(o.limit, logPageCap);
  if (limit === 0) {
    return { lines: [], more: false };
  }
  const read = readLines(db, {
    seesMoney: o.seesMoney,
    count: limit + 1,
    before: o.before,
    who: o.who,
  });
  return { lines: read.slice(0, limit), more: read.length > limit };
}

/** The longest `who` a person chip carries: the `log:page` request's `who` bound in the ipc package. */
export const whoMax = 100;

/** The longest name a person chip carries (`textMax` in the ipc package). */
export const personNameMax = 500;

/**
 * Who has lines in the log, with how many, most lines first and then by name, at most
 * `peopleCap`, and `total`: every visible line, for "Everyone", past the 50 people too. Counts use
 * the same undo-hiding as the pages. For a member without money they drop rows with a money field
 * but skip the text test (`mentionsMoney`), so a count can run a little high; the chips are a
 * guide, the page itself is exact. The name is the profile's display name, else the newest line's
 * `actor_name`, cut to `personNameMax`. A person whose `who` is longer than `whoMax` (an old app's
 * odd `actor_name`) gets no chip, since the page could not ask for their lines; their lines still
 * count in `total`.
 */
export function peopleInLog(
  db: DatabaseSync,
  o: { seesMoney: boolean },
): { people: { who: string; name: string; count: number }[]; total: number } {
  const visible = visibleSql(o.seesMoney);
  // One pass over the log: each person's newest line (for the name) and their visible lines.
  const rows = db
    .prepare(
      `SELECT x.who, x.n, x.actor_name, p.display_name AS profile_name
       FROM (
         SELECT ${whoSql} AS who, a.actor_id, a.actor_name,
                SUM(CASE WHEN ${visible.sql} THEN 1 ELSE 0 END)
                  OVER (PARTITION BY ${whoSql}) AS n,
                ROW_NUMBER() OVER (PARTITION BY ${whoSql} ORDER BY a.at_ms DESC, a.id DESC) AS r
         FROM activity_log a
       ) x
       LEFT JOIN profiles p ON p.id = x.actor_id
       WHERE x.r = 1 AND x.n > 0`,
    )
    .all(...visible.params);
  let total = 0;
  const people: { who: string; name: string; count: number }[] = [];
  for (const row of rows) {
    const count = Number(row["n"]);
    total += count;
    const who = optional(row["who"]);
    if (who === null || who.length > whoMax) {
      continue;
    }
    const profile = optional(row["profile_name"]);
    const name = profile !== null && profile !== "" ? profile : (optional(row["actor_name"]) ?? "");
    people.push({ who, name: name.slice(0, personNameMax), count });
  }
  people.sort((x, y) => y.count - x.count || x.name.localeCompare(y.name));
  return { people: people.slice(0, peopleCap), total };
}

/** How many visible lines were written at or after `since` (ms). Money text is not tested, as in `peopleInLog`. */
export function linesSince(db: DatabaseSync, o: { seesMoney: boolean; since: number }): number {
  const visible = visibleSql(o.seesMoney);
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM activity_log a WHERE a.at_ms >= ? AND ${visible.sql}`)
    .get(o.since, ...visible.params);
  return Number(row?.["n"] ?? 0);
}

function readLines(
  db: DatabaseSync,
  o: {
    seesMoney: boolean;
    count: number;
    ref?: string;
    before?: LogCursor | null;
    who?: string | null;
  },
): LogEntry[] {
  const { count } = o;
  if (count === 0) {
    return [];
  }
  const visible = visibleSql(o.seesMoney);
  const before = o.before ?? null;
  const who = o.who ?? null;
  const conditions: string[] = [];
  const filters: (string | number)[] = [];
  if (o.ref !== undefined) {
    conditions.push("a.entity_type = 'channel' AND a.entity_id = ?");
    filters.push(o.ref);
  }
  if (before !== null) {
    conditions.push("(a.at_ms < ? OR (a.at_ms = ? AND a.id < ?))");
    filters.push(before.at, before.at, before.id);
  }
  if (who !== null) {
    conditions.push(`${whoSql} = ?`);
    filters.push(who);
  }
  const statement = db.prepare(
    `SELECT a.id, a.at, a.at_ms, a.actor_id, a.actor_name, a.action, a.entity_type, a.entity_id,
            a.entity_label, a.field, a.old_value, a.new_value, a.detail
     FROM activity_log a
     WHERE ${conditions.map((c) => `${c} AND`).join(" ")}
       ${visible.sql}
     ORDER BY a.at_ms DESC, a.id DESC
     LIMIT ? OFFSET ?`,
  );
  const lines: LogEntry[] = [];
  // Without money, some rows are dropped after the query, so read on until `count` lines are kept.
  for (let offset = 0; lines.length < count; offset += pageSize) {
    const params = [...filters, ...visible.params];
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
