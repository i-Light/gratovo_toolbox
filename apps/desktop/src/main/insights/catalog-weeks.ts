import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

/** The local Monday of the week holding `at`, as `YYYY-MM-DD`. */
export function weekOf(at: number): string {
  const day = new Date(at);
  const monday = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${String(monday.getFullYear())}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
}

/**
 * Writes this week's catalog totals into `catalog_weeks` (plan P8a, A6): live = the catalog's
 * channels whose creator is not at `rejected`, waiting = those that are, archive = the tombstones.
 * `pipeline.db` is read-only. A missing file or table writes nothing, so a week is never recorded
 * as zero for want of data. Returns whether a row was written.
 */
export function recordCatalogWeek(db: DatabaseSync, pipelineDbPath: string, now: number): boolean {
  if (!existsSync(pipelineDbPath)) {
    return false;
  }
  const pipeline = new DatabaseSync(pipelineDbPath, { readOnly: true });
  let ids: string[];
  let archive: number;
  try {
    ids = pipeline
      .prepare("SELECT channel_id FROM channels")
      .all()
      .map((row) => String(row["channel_id"]));
    archive = Number(pipeline.prepare("SELECT COUNT(*) AS n FROM channel_archive").get()?.["n"]);
  } catch {
    return false;
  } finally {
    pipeline.close();
  }
  const rejected = new Set(
    db
      .prepare("SELECT channel_id FROM channel_state WHERE creator_stage = 'rejected'")
      .all()
      .map((row) => String(row["channel_id"])),
  );
  const waiting = ids.filter((id) => rejected.has(id)).length;
  db.prepare(
    `INSERT INTO catalog_weeks (week, live, waiting, archive, written_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (week) DO UPDATE SET live = excluded.live, waiting = excluded.waiting,
       archive = excluded.archive, written_at = excluded.written_at`,
  ).run(weekOf(now), ids.length - waiting, waiting, archive, now);
  return true;
}
