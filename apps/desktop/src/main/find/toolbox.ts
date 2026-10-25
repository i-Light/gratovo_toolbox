import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import type { CreatorStage } from "@gratovo/core/data";
import {
  archiveDate,
  type ArchivedChannel,
  type CatalogItem,
  type ToolboxItem,
  type ToolboxList,
} from "@gratovo/core/find";

import { parseTime } from "./runs";

/**
 * What the Toolbox tools read (plan step 5d, D34, D36 and D39): the countdown and never-contact
 * lists from the catalog's rows, the tombstones in `pipeline.db`'s `channel_archive`, and the
 * counts beside the tools. Python owns the database, so it is opened read-only for each read.
 */

/** The catalog's rows and version, as `FindCatalog.snapshot()` answers them. */
export interface CatalogSnapshot {
  readonly version: number;
  readonly rows: readonly CatalogItem[];
}

function byName(a: CatalogItem, b: CatalogItem): number {
  const x = a.name.toLowerCase();
  const y = b.name.toLowerCase();
  if (x !== y) {
    return x < y ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Larger first; a missing value goes last. */
function newestFirst(a: number | null, b: number | null): number {
  if (a === null || b === null) {
    return a === b ? 0 : a === null ? 1 : -1;
  }
  return b - a;
}

/** Smaller first; a missing value goes last. */
function soonestFirst(a: number | null, b: number | null): number {
  if (a === null || b === null) {
    return a === b ? 0 : a === null ? 1 : -1;
  }
  return a - b;
}

/**
 * One page of a Toolbox list. Archive (D36): creators at `rejected` that aren't archived for good,
 * soonest archive date first. Never contact (D39): creators at `never`, newest first.
 */
export function toolboxList(
  snapshot: CatalogSnapshot,
  list: ToolboxList,
  archiveDays: number,
  offset: number,
  limit: number,
): { version: number; total: number; items: ToolboxItem[] } {
  const shown: ToolboxItem[] =
    list === "archive"
      ? snapshot.rows
          .filter((row) => row.stage === "rejected" && row.archivedAt === null)
          .map((row) => ({ ...row, dueAt: archiveDate(row, archiveDays) }))
          .sort((a, b) => soonestFirst(a.dueAt, b.dueAt) || byName(a, b))
      : snapshot.rows
          .filter((row) => row.stage === "never")
          .map((row) => ({ ...row, dueAt: null }))
          .sort((a, b) => newestFirst(a.rejectedAt, b.rejectedAt) || byName(a, b));
  return {
    version: snapshot.version,
    total: shown.length,
    items: shown.slice(offset, offset + limit),
  };
}

/** The numbers beside the tools (D34). `logToday` is the activity lines since local midnight. */
export function toolboxCounts(
  rows: readonly CatalogItem[],
  archived: number,
  logToday: number,
): { archive: number; never: number; archived: number; logToday: number } {
  let archive = 0;
  let never = 0;
  for (const row of rows) {
    if (row.stage === "rejected" && row.archivedAt === null) {
      archive += 1;
    } else if (row.stage === "never") {
      never += 1;
    }
  }
  return { archive, never, archived, logToday };
}

/** What the app knows of a creator, by channel id: the name for the search, the stage to show. */
export type ArchivedNames = ReadonlyMap<
  string,
  { readonly name: string | null; readonly stage: CreatorStage | null }
>;

/** Opens the file read-only, or answers null when there is none. */
function openRead(dbPath: string | null): DatabaseSync | null {
  return dbPath !== null && existsSync(dbPath)
    ? new DatabaseSync(dbPath, { readOnly: true })
    : null;
}

/** How many channels are archived for good; 0 for a missing file or table. */
export function countArchived(dbPath: string | null): number {
  try {
    const db = openRead(dbPath);
    if (db === null) {
      return 0;
    }
    try {
      const row = db.prepare("SELECT COUNT(*) AS n FROM channel_archive").get() as { n: number };
      return row.n;
    } finally {
      db.close();
    }
  } catch {
    return 0;
  }
}

interface ArchiveRow {
  channel_id: string;
  handle: string | null;
  label: string | null;
  archived_at: string | null;
  subscribers: string | number | null;
}

/** "48200" is a number; "Hidden" and anything else is none. */
function subscribersOf(value: string | number | null): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
  }
  return value !== null && /^\d{1,12}$/.test(value.trim()) ? Number(value.trim()) : null;
}

/** A stored handle, or null for none: the sweep stores a channel with no handle as "". */
function handleOf(value: string | null): string | null {
  return value === null || value.trim() === "" ? null : value;
}

/** Makes text safe in a LIKE pattern that says `ESCAPE '\'`. */
function likeEscape(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * The tombstones, newest first, matching `q` on the handle or the app's name (D36). The names are
 * the app's, not the file's, so those matching `q` hand their ids to the query.
 */
export function readArchived(
  dbPath: string | null,
  request: { q: string; offset: number; limit: number },
  names: ArchivedNames,
): { total: number; items: ArchivedChannel[] } {
  const none = { total: 0, items: [] };
  try {
    const db = openRead(dbPath);
    if (db === null) {
      return none;
    }
    try {
      const columns = new Set(
        (
          db.prepare("PRAGMA table_info(channel_archive)").all() as unknown as { name: string }[]
        ).map((column) => column.name),
      );
      if (!columns.has("channel_id")) {
        return none;
      }
      // An older file may lack a column; it reads as none.
      const column = (name: string) => (columns.has(name) ? name : `NULL AS ${name}`);
      const q = request.q.trim().toLowerCase();
      let where = "";
      const args: string[] = [];
      if (q !== "") {
        const ids: string[] = [];
        for (const [id, known] of names) {
          if (known.name?.toLowerCase().includes(q) === true) {
            ids.push(id);
          }
        }
        where = `WHERE channel_id IN (SELECT value FROM json_each(?)) OR handle LIKE ? ESCAPE '\\'`;
        args.push(JSON.stringify(ids), `%${likeEscape(q)}%`);
      }
      const total = (
        db.prepare(`SELECT COUNT(*) AS n FROM channel_archive ${where}`).get(...args) as {
          n: number;
        }
      ).n;
      const rows = db
        .prepare(
          `SELECT channel_id, ${column("handle")}, ${column("label")}, ${column("archived_at")},
             ${column("subscribers")}
           FROM channel_archive ${where}
           ORDER BY archived_at DESC, channel_id LIMIT ? OFFSET ?`,
        )
        .all(...args, request.limit, request.offset) as unknown as ArchiveRow[];
      return {
        total,
        items: rows.map((row) => ({
          id: row.channel_id,
          handle: handleOf(row.handle),
          name: names.get(row.channel_id)?.name ?? null,
          label: row.label,
          archivedAt: parseTime(row.archived_at),
          subscribers: subscribersOf(row.subscribers),
          stage: names.get(row.channel_id)?.stage ?? null,
        })),
      };
    } finally {
      db.close();
    }
  } catch {
    return none;
  }
}
