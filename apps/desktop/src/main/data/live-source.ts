import type { DataSource } from "@gratovo/core/data";

import { openDatabase } from "../db/open-database";

import { createSqliteSource } from "./sqlite-source";
import type { FrameExtras } from "./sqlite-source";

/** No presence, counts or run until the sync and the engines exist (3d-2, step 4). */
const emptyExtras: FrameExtras = {
  presence: () => ({ status: "away", doing: "", title: null }),
  counts: () => ({ today: 0, plannedMinutes: 0, find: 0, reach: 0, close: 0, deliver: 0 }),
  mateRun: () => null,
};

/** Opens the live database at `path` for member `me`. It starts empty; the sync fills it. */
export function openLiveSource(path: string, me: string, now?: () => number): DataSource {
  const db = openDatabase(path);
  return createSqliteSource(db, { me, extras: emptyExtras, ...(now ? { now } : {}) });
}
