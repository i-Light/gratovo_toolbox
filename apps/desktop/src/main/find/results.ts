import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import type { FindState } from "@gratovo/ipc";

/** The channels a search kept, newest first, read from `pipeline.db` (which Python writes). */

type Kept = FindState["kept"][number];

interface Row {
  channel_id: string;
  name: string | null;
  handle: string | null;
  subscribers: string | number | null;
  median_views_last_30: number | null;
  country: string | null;
  keyword: string | null;
}

const query = `SELECT c.channel_id, c.name, c.handle, c.subscribers, c.median_views_last_30, c.country,
  (SELECT k.keyword FROM channel_keywords k WHERE k.channel_id = c.channel_id
   ORDER BY k.discovered_at DESC LIMIT 1) AS keyword
FROM channels c WHERE c.videos_fetched_at IS NOT NULL
ORDER BY c.videos_fetched_at DESC LIMIT ?`;

/** "48200" is a number; "Hidden" and anything else is none. */
function plainNumber(value: string | number | null): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0 ? value : null;
  }
  return value !== null && /^\d{1,9}$/.test(value.trim()) ? Number(value.trim()) : null;
}

function text(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed.slice(0, 200);
}

export function readKept(dbPath: string, limit = 100): Kept[] {
  if (!existsSync(dbPath)) {
    return [];
  }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db.prepare(query).all(limit) as unknown as Row[];
    return rows.map((row) => {
      const handle = text(row.handle);
      const views = row.median_views_last_30;
      return {
        channelId: row.channel_id,
        name: text(row.name) ?? handle ?? row.channel_id,
        handle,
        subscribers: plainNumber(row.subscribers),
        medianViews: views !== null && Number.isInteger(views) && views >= 0 ? views : null,
        country: row.country !== null && /^[A-Z]{2}$/.test(row.country) ? row.country : null,
        keyword: text(row.keyword) ?? "unknown",
      };
    });
  } catch {
    // A database mid-creation or from another version: show no results rather than fail the screen.
    return [];
  } finally {
    db.close();
  }
}
