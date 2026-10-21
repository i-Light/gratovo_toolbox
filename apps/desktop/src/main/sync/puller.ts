/**
 * The keyset pull (plan D2 steps 3 and 5-8, D4, D6, D10), ported from the rules of the old app's
 * `mirror_puller.dart`, not its code.
 *
 * - Each of the four mirror tables is read in pages after its stored cursor. A page is applied in
 *   one transaction together with its new cursor, which is the last row's raw server text (it
 *   never passes through `Date`), so a failed page leaves neither rows nor cursor behind.
 * - A row with a pending outbox entry is skipped: unsent work is never overwritten (D10).
 * - Deletions come from `sync_tombstones`. Its cursor is seeded on the first pull, before any data
 *   page, to the newest tombstone, so old deletions (of rows the data pull won't bring) are never
 *   replayed. A tombstone deletes a local row only when the row has no pending entry and is older
 *   than the deletion (the resurrection guard).
 * - The purge horizon: when the stored tombstone cursor is older than the server's
 *   `tombstones_purged_before`, this copy may have missed deletions it can never learn about, so
 *   every cursor resets and the next pull is a full one that notes each key it sees; at its end,
 *   local rows that weren't seen and have no pending entry go. The outbox is never touched.
 * - `refetch()` reads again, by key, the rows the uploader marked after a conflict or a refusal.
 *
 * Log lines name the table and the page size only, never row data.
 */

import type { DatabaseSync } from "node:sqlite";

import type { FramePart } from "@gratovo/ipc";

import { getMeta, hasPending, setMeta } from "../data/repositories";
import { inTransaction } from "../data/sqlite-source";
import type { Rest } from "../supabase/rest";
import { RestError } from "../supabase/rest";

import { keysetQuery } from "./keyset";
import type { KeysetCursor } from "./keyset";
import { mirrorTables, toLocalRow, upsertRow } from "./mirror-tables";
import type { MirrorTable } from "./mirror-tables";
import { compareServerTime, parseServerTime } from "./server-time";
import { markRefetch, refetchKey } from "./uploader";

export interface PullResult {
  readonly changed: ReadonlySet<FramePart>;
  /** False when the budget ran out; the next pull carries on from the stored cursors. */
  readonly done: boolean;
  /** Tables whose cursor did not move this pass (`pull.stalled`). */
  readonly stalled: readonly string[];
}

export interface Puller {
  pull(budgetMs: number): Promise<PullResult>;
  /** Reads again the rows listed in `sync.refetch` (D10 (3)). */
  refetch(): Promise<ReadonlySet<FramePart>>;
}

export const pageMax = 500;
export const pageMin = 25;
export const requestTimeoutMs = 45_000;
/** Good pages in a row before a shrunk page size doubles again. */
const growAfter = 5;
/** Tries per page; each failed one halves the page size. */
const triesPerPage = 3;

export const tombstoneTable = "sync_tombstones";
export const seededKey = "sync.seeded";
/** Set while a full pull after the horizon is running; its end deletes the rows it didn't see. */
export const resyncKey = "sync.resync";
export const cursorKey = (table: string): string => `sync.cursor.${table}`;
export const pageKey = (table: string): string => `sync.page.${table}`;

/** The tables that have tombstones (D3). */
const tombstoned = mirrorTables.filter((t) => t.name !== "activity_log");
const tombstoneFilter = `table_name=in.${encodeURIComponent(
  `(${tombstoned.map((t) => t.name).join(",")})`,
)}`;
const tombstoneColumns = ["table_name", "row_id", "deleted_at"] as const;
/** The earliest cursor: what a tombstone cursor holds when there was nothing to seed it with. */
const beginning = "-infinity";
/** The connection's TEMP table of the keys a full pull has seen. */
const seenTable = "temp._sync_seen";

/** One keyset-paged source: a mirror table or the tombstones. */
interface Source {
  readonly name: string;
  readonly columns: readonly string[];
  readonly cursorColumn: string;
  readonly keyColumns: readonly string[];
  readonly filters: readonly string[];
  /** Runs inside the page's transaction. */
  readonly apply: (rows: readonly unknown[]) => void;
}

type Outcome = "done" | "stalled" | "budget";

function readCursor(db: DatabaseSync, name: string, keys: number): KeysetCursor | null {
  const raw = getMeta(db, cursorKey(name));
  if (raw === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      const { at, key } = parsed as Record<string, unknown>;
      if (
        typeof at === "string" &&
        Array.isArray(key) &&
        key.length === keys &&
        key.every((k) => typeof k === "string")
      ) {
        return { at, key };
      }
    }
  } catch {
    // A damaged cursor reads as none: the table is read again from the start.
  }
  return null;
}

function writeCursor(db: DatabaseSync, name: string, cursor: KeysetCursor): void {
  setMeta(db, cursorKey(name), JSON.stringify({ at: cursor.at, key: cursor.key }));
}

function sameCursor(a: KeysetCursor | null, b: KeysetCursor): boolean {
  return a !== null && a.at === b.at && a.key.join("\u0000") === b.key.join("\u0000");
}

/** The raw cursor of a server row, or null when it lacks the text values. */
function cursorOf(row: unknown, cursorColumn: string, keyColumns: readonly string[]) {
  if (typeof row !== "object" || row === null) {
    return null;
  }
  const r = row as Readonly<Record<string, unknown>>;
  const at = r[cursorColumn];
  const key = keyColumns.map((c) => r[c]);
  if (typeof at !== "string" || !key.every((k): k is string => typeof k === "string")) {
    return null;
  }
  return { at, key };
}

/** A timeout, a lost connection or a 5xx: worth asking again for a smaller page (D4). */
function shrinkable(error: unknown): boolean {
  return (
    error instanceof RestError &&
    (error.kind === "offline" || (error.status !== null && error.status >= 500))
  );
}

function isRefetchItem(item: unknown): item is { table: string; key: string } {
  return (
    typeof item === "object" &&
    item !== null &&
    typeof (item as Record<string, unknown>)["table"] === "string" &&
    typeof (item as Record<string, unknown>)["key"] === "string"
  );
}

function readRefetch(db: DatabaseSync): { table: string; key: string }[] {
  try {
    const parsed: unknown = JSON.parse(getMeta(db, refetchKey) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isRefetchItem) : [];
  } catch {
    return [];
  }
}

function writeRefetch(db: DatabaseSync, list: readonly { table: string; key: string }[]): void {
  if (list.length === 0) {
    db.prepare("DELETE FROM _meta WHERE key = ?").run(refetchKey);
  } else {
    setMeta(db, refetchKey, JSON.stringify(list));
  }
}

function deleteLocal(db: DatabaseSync, t: MirrorTable, key: string): boolean {
  return Number(db.prepare(`DELETE FROM ${t.name} WHERE ${t.key} = ?`).run(key).changes) > 0;
}

export function createPuller(o: {
  db: DatabaseSync;
  rest: Pick<Rest, "select">;
  now: () => number;
  yieldNow?: () => Promise<void>;
  onTableDone?: (part: FramePart) => void;
  log: (line: string) => void;
}): Puller {
  const { db, rest, now, log } = o;
  const yieldNow =
    o.yieldNow ??
    (() =>
      new Promise<void>((resolve) => {
        setImmediate(resolve);
      }));
  /** Good pages in a row, per source, toward doubling a shrunk page size. */
  const goodPages = new Map<string, number>();

  function pageSize(name: string): number {
    const stored = Number(getMeta(db, pageKey(name)));
    return Number.isInteger(stored) && stored >= pageMin && stored <= pageMax ? stored : pageMax;
  }

  function setPageSize(name: string, size: number): void {
    setMeta(db, pageKey(name), String(size));
  }

  function seenReady(): boolean {
    return (
      db.prepare("SELECT 1 AS one FROM temp.sqlite_master WHERE name = '_sync_seen'").get() !==
      undefined
    );
  }

  /** Every cursor goes and the next pull is a full one that sweeps what it didn't see (D6). */
  function startResync(): void {
    db.exec(
      `CREATE TEMP TABLE IF NOT EXISTS _sync_seen (
         table_name TEXT NOT NULL, row_key TEXT NOT NULL, PRIMARY KEY (table_name, row_key)
       ) WITHOUT ROWID`,
    );
    inTransaction(db, () => {
      db.exec(`DELETE FROM ${seenTable}`);
      db.prepare("DELETE FROM _meta WHERE key LIKE 'sync.cursor.%' OR key = ?").run(seededKey);
      setMeta(db, resyncKey, "1");
    });
  }

  /** Reads one page, halving the page size on a timeout or a 5xx (D4). */
  async function fetchPage(
    source: Source,
    cursor: KeysetCursor | null,
    deadline: number,
  ): Promise<{ rows: unknown[]; limit: number }> {
    for (let attempt = 1; ; attempt += 1) {
      const limit = pageSize(source.name);
      const query = keysetQuery({
        columns: source.columns,
        cursorColumn: source.cursorColumn,
        keyColumns: source.keyColumns,
        cursor,
        limit,
        filters: source.filters,
      });
      try {
        const rows = await rest.select<unknown>(source.name, query, {
          timeoutMs: requestTimeoutMs,
        });
        const good = (goodPages.get(source.name) ?? 0) + 1;
        if (good >= growAfter && limit < pageMax) {
          setPageSize(source.name, Math.min(pageMax, limit * 2));
          goodPages.set(source.name, 0);
        } else {
          goodPages.set(source.name, good);
        }
        return { rows: Array.isArray(rows) ? rows : [], limit };
      } catch (error) {
        if (!shrinkable(error)) {
          throw error;
        }
        const smaller = Math.max(pageMin, Math.floor(limit / 2));
        setPageSize(source.name, smaller);
        goodPages.set(source.name, 0);
        log(
          `pull.page.failed table=${source.name} size=${String(limit)} attempt=${String(attempt)}`,
        );
        if (attempt >= triesPerPage || now() >= deadline) {
          throw error;
        }
      }
    }
  }

  /** Pages through one source until it is caught up, stalls or the budget is spent. */
  async function pullSource(source: Source, deadline: number): Promise<Outcome> {
    for (;;) {
      if (now() >= deadline) {
        return "budget";
      }
      const stored = readCursor(db, source.name, source.keyColumns.length);
      const { rows, limit } = await fetchPage(source, stored, deadline);
      if (!db.isOpen) {
        return "budget";
      }
      if (rows.length === 0) {
        return "done";
      }
      const next = cursorOf(rows.at(-1), source.cursorColumn, source.keyColumns);
      if (next === null || sameCursor(stored, next)) {
        // The keyset is not moving: asking again would fetch the same page forever.
        log(`pull.stalled table=${source.name} rows=${String(rows.length)}`);
        return "stalled";
      }
      inTransaction(db, () => {
        source.apply(rows);
        writeCursor(db, source.name, next);
      });
      await yieldNow();
      if (rows.length < limit) {
        return "done";
      }
    }
  }

  function dataSource(t: MirrorTable, changed: Set<FramePart>, sweeping: boolean): Source {
    const markSeen =
      sweeping && t.name !== "activity_log"
        ? db.prepare(`INSERT OR IGNORE INTO ${seenTable} (table_name, row_key) VALUES (?, ?)`)
        : null;
    return {
      name: t.name,
      columns: t.columns,
      cursorColumn: t.cursor,
      keyColumns: [t.key],
      filters: [],
      apply(rows) {
        for (const raw of rows) {
          const row = toLocalRow(t, raw);
          if (row === null) {
            continue;
          }
          const key = row[t.key];
          if (typeof key !== "string") {
            continue;
          }
          markSeen?.run(t.name, key);
          if (hasPending(db, t.name, key)) {
            // The cursor moves past it; read it again by key once the pending change is sent, in
            // case the server's copy doesn't move on afterwards (an edit answered noop or auto).
            markRefetch(db, { table: t.name, key });
            continue;
          }
          try {
            upsertRow(db, t, row);
          } catch {
            // A row the local copy can't hold (a NOT NULL column arriving null, say) is skipped,
            // so one bad row can't stall its table forever. SQLite undoes only that statement.
            log(`pull.row_skipped ${t.name}`);
            continue;
          }
          changed.add(t.part);
        }
      },
    };
  }

  function tombstoneSource(changed: Set<FramePart>): Source {
    return {
      name: tombstoneTable,
      columns: tombstoneColumns,
      cursorColumn: "deleted_at",
      keyColumns: ["table_name", "row_id"],
      filters: [tombstoneFilter],
      apply(rows) {
        for (const raw of rows) {
          if (typeof raw !== "object" || raw === null) {
            continue;
          }
          const r = raw as Readonly<Record<string, unknown>>;
          const t = tombstoned.find((m) => m.name === r["table_name"]);
          const key = r["row_id"];
          const deletedAt = r["deleted_at"];
          if (t === undefined || typeof key !== "string" || typeof deletedAt !== "string") {
            continue;
          }
          if (hasPending(db, t.name, key)) {
            // Read it again by key once the change is sent: gone on the server, it goes here too.
            markRefetch(db, { table: t.name, key });
            continue;
          }
          const local = db.prepare(`SELECT updated_at FROM ${t.name} WHERE ${t.key} = ?`).get(key);
          if (local === undefined) {
            continue;
          }
          const updatedAt = typeof local["updated_at"] === "string" ? local["updated_at"] : "";
          // The resurrection guard: a row written again after its deletion stays.
          if (compareServerTime(updatedAt, deletedAt) < 0 && deleteLocal(db, t, key)) {
            changed.add(t.part);
          }
        }
      },
    };
  }

  /** The server's purge horizon, or null when it has none that can be compared. */
  async function readHorizon(): Promise<string | null> {
    const rows = await rest.select<unknown>(
      "sync_control",
      "select=tombstones_purged_before&limit=1",
      { timeoutMs: requestTimeoutMs },
    );
    const first: unknown = Array.isArray(rows) ? rows[0] : undefined;
    const value =
      typeof first === "object" && first !== null
        ? (first as Record<string, unknown>)["tombstones_purged_before"]
        : undefined;
    return typeof value === "string" && parseServerTime(value) !== null ? value : null;
  }

  /**
   * Seeds the tombstone cursor to the newest tombstone, before any data page (D6). With none, or
   * one older than the horizon, it starts at the horizon itself, so the horizon check can't send
   * a copy into a full pull again on the next pass.
   */
  async function seed(horizon: string | null): Promise<void> {
    const rows = await rest.select<unknown>(
      tombstoneTable,
      `select=${encodeURIComponent(tombstoneColumns.join(","))}&${tombstoneFilter}` +
        `&order=${encodeURIComponent("deleted_at.desc,table_name.desc,row_id.desc")}&limit=1`,
      { timeoutMs: requestTimeoutMs },
    );
    const newest = cursorOf(Array.isArray(rows) ? rows[0] : undefined, "deleted_at", [
      "table_name",
      "row_id",
    ]);
    let cursor: KeysetCursor = newest ?? { at: horizon ?? beginning, key: ["", ""] };
    if (horizon !== null && compareServerTime(cursor.at, horizon) < 0) {
      cursor = { at: horizon, key: ["", ""] };
    }
    if (!db.isOpen) {
      return;
    }
    inTransaction(db, () => {
      writeCursor(db, tombstoneTable, cursor);
      setMeta(db, seededKey, "1");
    });
  }

  /** At the end of a full pull: local rows it didn't see and with nothing pending go (D6). */
  function sweep(changed: Set<FramePart>): void {
    inTransaction(db, () => {
      for (const t of tombstoned) {
        const result = db
          .prepare(
            `DELETE FROM ${t.name}
             WHERE ${t.key} NOT IN (SELECT row_key FROM ${seenTable} WHERE table_name = ?)
               AND NOT EXISTS (SELECT 1 FROM _outbox
                               WHERE target_table = ? AND target_key = ${t.name}.${t.key})`,
          )
          .run(t.name, t.name);
        if (Number(result.changes) > 0) {
          changed.add(t.part);
          log(`pull.swept table=${t.name} rows=${String(result.changes)}`);
        }
      }
      db.exec(`DELETE FROM ${seenTable}`);
      db.prepare("DELETE FROM _meta WHERE key = ?").run(resyncKey);
    });
    db.exec(`DROP TABLE IF EXISTS ${seenTable}`);
  }

  async function pull(budgetMs: number): Promise<PullResult> {
    const deadline = now() + budgetMs;
    const changed = new Set<FramePart>();
    const stalled: string[] = [];
    const result = (done: boolean): PullResult => ({ changed, done, stalled });

    // The horizon (D6).
    const horizon = await readHorizon();
    if (!db.isOpen) {
      return result(false);
    }
    const tombstoneCursor = readCursor(db, tombstoneTable, 2);
    if (
      horizon !== null &&
      tombstoneCursor !== null &&
      compareServerTime(tombstoneCursor.at, horizon) < 0
    ) {
      log("pull.resync reason=horizon");
      startResync();
    } else if (getMeta(db, resyncKey) !== null && !seenReady()) {
      // A full pull that a restart cut short: its seen keys are gone, so it starts again.
      log("pull.resync reason=restart");
      startResync();
    }

    // The seed, before any data page (D6).
    if (getMeta(db, seededKey) === null) {
      await seed(horizon);
    }

    const sweeping = getMeta(db, resyncKey) !== null;
    let complete = true;
    for (const t of mirrorTables) {
      const before = changed.has(t.part);
      const outcome = await pullSource(dataSource(t, changed, sweeping), deadline);
      if (outcome === "stalled") {
        stalled.push(t.name);
      }
      if (outcome !== "done" && t.name !== "activity_log") {
        complete = false;
      }
      if (!before && changed.has(t.part)) {
        o.onTableDone?.(t.part);
      }
      if (outcome === "budget") {
        return result(false);
      }
    }
    if (sweeping && complete) {
      const before = new Set(changed);
      sweep(changed);
      for (const part of changed) {
        if (!before.has(part)) {
          o.onTableDone?.(part);
        }
      }
    }

    const before = new Set(changed);
    const outcome = await pullSource(tombstoneSource(changed), deadline);
    if (outcome === "stalled") {
      stalled.push(tombstoneTable);
    }
    for (const part of changed) {
      if (!before.has(part)) {
        o.onTableDone?.(part);
      }
    }
    return result(outcome !== "budget");
  }

  async function refetch(): Promise<ReadonlySet<FramePart>> {
    const changed = new Set<FramePart>();
    for (const item of readRefetch(db)) {
      const t = mirrorTables.find((m) => m.name === item.table);
      if (t !== undefined && hasPending(db, t.name, item.key)) {
        // Another entry for this row is still to be sent; read it again once that is done.
        continue;
      }
      // A plain filter value is taken as it is, so percent-encoding is all it needs.
      const rows =
        t === undefined
          ? []
          : await rest.select<unknown>(
              t.name,
              `select=${encodeURIComponent(t.columns.join(","))}&${t.key}=eq.${encodeURIComponent(
                item.key,
              )}&limit=1`,
              { timeoutMs: requestTimeoutMs },
            );
      if (!db.isOpen) {
        return changed;
      }
      inTransaction(db, () => {
        const handled = () => {
          writeRefetch(
            db,
            readRefetch(db).filter((i) => !(i.table === item.table && i.key === item.key)),
          );
        };
        if (t === undefined) {
          // Not a mirrored table: the whole-table refresh reads it every pass anyway.
          handled();
          return;
        }
        if (hasPending(db, t.name, item.key)) {
          return;
        }
        const row = (Array.isArray(rows) ? rows : [])
          .map((raw) => toLocalRow(t, raw))
          .find((r) => r !== null && r[t.key] === item.key);
        if (row !== undefined && row !== null) {
          upsertRow(db, t, row);
          changed.add(t.part);
        } else if (deleteLocal(db, t, item.key)) {
          changed.add(t.part);
        }
        handled();
      });
    }
    return changed;
  }

  return { pull, refetch };
}
