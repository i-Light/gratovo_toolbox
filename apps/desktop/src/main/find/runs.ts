import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { isGold, type CatalogItem } from "@gratovo/core/find";

/**
 * The search run history (plan step 5, D10), read from the `runs` table of `pipeline.db`. A run
 * owns the channels first found inside its window; the counts come from the catalog rows.
 */

export interface RunWindow {
  readonly id: number;
  readonly startedAt: number;
  readonly finishedAt: number | null;
  readonly status: string;
  readonly keywords: number;
}

export interface RunRow extends RunWindow {
  readonly found: number;
  readonly kept: number;
  readonly gold: number;
}

/** Text from the store as ms. Text with no zone is UTC, which is how Python writes it. */
export function parseTime(text: unknown): number | null {
  if (typeof text !== "string" || text.trim() === "") {
    return null;
  }
  let value = text.trim().replace(" ", "T");
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(value)) {
    value += "Z";
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

interface RunRecord {
  run_id: number;
  started_at: string;
  finished_at: string | null;
  status: string;
  keywords_total: number;
}

/** The newest search runs first. A run with an unreadable start time is left out. */
export function readRunWindows(db: DatabaseSync, limit = 50): RunWindow[] {
  const rows = db
    .prepare(
      `SELECT run_id, started_at, finished_at, status, keywords_total FROM runs
       WHERE kind = 'search' ORDER BY started_at DESC, run_id DESC LIMIT ?`,
    )
    .all(limit) as unknown as RunRecord[];
  const windows: RunWindow[] = [];
  for (const row of rows) {
    const startedAt = parseTime(row.started_at);
    if (startedAt !== null) {
      windows.push({
        id: row.run_id,
        startedAt,
        finishedAt: parseTime(row.finished_at),
        status: row.status,
        keywords: row.keywords_total,
      });
    }
  }
  return windows;
}

/**
 * The id of the run whose window holds `at`: of the runs that started at or before it, the latest
 * one, provided it had not ended (an open run is still going at `now`). `windows` is newest first.
 */
export function runAt(
  windows: readonly RunWindow[],
  at: number | null,
  now: number,
): number | null {
  if (at === null) {
    return null;
  }
  for (const run of windows) {
    if (run.startedAt <= at) {
      return at <= (run.finishedAt ?? now) ? run.id : null;
    }
  }
  return null;
}

/**
 * The newest `limit` search runs with their counts. Every catalog row is kept: an archived channel
 * left `channels` for `channel_archive`, so the run's archived rows are added to `found` only.
 */
export function readRuns(
  dbPath: string | null,
  items: readonly CatalogItem[],
  limit = 50,
  now = Date.now(),
): RunRow[] {
  if (dbPath === null || !existsSync(dbPath)) {
    return [];
  }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const windows = readRunWindows(db, limit);
    const found = new Map<number, number>();
    const gold = new Map<number, number>();
    for (const item of items) {
      if (item.run !== null) {
        found.set(item.run, (found.get(item.run) ?? 0) + 1);
        if (isGold(item)) {
          gold.set(item.run, (gold.get(item.run) ?? 0) + 1);
        }
      }
    }
    const kept = new Map(found);
    const archived = db
      .prepare("SELECT archived_at FROM channel_archive WHERE archived_at IS NOT NULL")
      .all() as unknown as { archived_at: string }[];
    for (const row of archived) {
      const id = runAt(windows, parseTime(row.archived_at), now);
      if (id !== null) {
        found.set(id, (found.get(id) ?? 0) + 1);
      }
    }
    return windows.map((run) => ({
      ...run,
      found: found.get(run.id) ?? 0,
      kept: kept.get(run.id) ?? 0,
      gold: gold.get(run.id) ?? 0,
    }));
  } catch {
    // A database mid-creation or from another version: no history rather than a failed screen.
    return [];
  } finally {
    db.close();
  }
}
