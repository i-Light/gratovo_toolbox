import { existsSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { startOfWeek } from "@gratovo/core/insights";

import { refetchKeyword } from "../pipeline/protocol";
import { parseTime } from "../find/runs";

/**
 * What the Insights reports need from `pipeline.db` besides the catalog's rows (plan step P8a,
 * A8): the archive as SQL totals, the keywords' counts and last runs, the keyword links of the live
 * channels, the search runs. Python owns the file, so it is opened read-only. The archive and
 * keyword parts take seconds on 150,000 tombstones, so they are kept by the file's size and time
 * (and its write-ahead log's) and only read again when the file changed.
 */

const dayMs = 86_400_000;

export interface ProfileFacts {
  readonly medianViews: number | null;
  readonly uploads30: number | null;
  readonly subscribers: number | null;
  readonly sponsored: { readonly n: number; readonly d: number } | null;
  readonly inMarkets: { readonly n: number; readonly d: number } | null;
  readonly addressFound: { readonly n: number; readonly d: number } | null;
}

/** Tombstones archived in one hour (UTC), by who archived them. */
interface ArchiveHour {
  readonly at: number;
  readonly rules: boolean;
  readonly n: number;
}

/** A keyword's tombstone entries in one hour, split by whether it is the original find. */
interface KeywordHour {
  readonly keyword: string;
  readonly at: number | null;
  readonly original: boolean;
  readonly rules: boolean;
  readonly n: number;
}

export interface KeywordBase {
  readonly keyword: string;
  readonly startedAt: number | null;
  readonly completedAt: number | null;
}

export interface PipelineFacts {
  /** Channel id → every keyword that found it (earliest first), for the catalog's channels. */
  readonly links: ReadonlyMap<string, readonly string[]>;
  /** Channels whose uploads failed to read once or twice (the pipeline still retries). */
  readonly retrying: ReadonlySet<string>;
  readonly archive: {
    readonly total: number;
    readonly byRules: number;
    readonly ruleLabels: readonly { readonly label: string; readonly count: number }[];
    readonly hours: readonly ArchiveHour[];
    /** Tombstones a person's reject made (label "rejected"). */
    readonly personIds: readonly string[];
    readonly person: ProfileFacts;
    readonly rules: ProfileFacts;
  };
  readonly keywords: readonly KeywordBase[];
  readonly keywordHours: readonly KeywordHour[];
  /** Links by keyword: when each channel was found, in ms. */
  readonly linkTimes: ReadonlyMap<string, readonly number[]>;
  readonly pending: readonly {
    readonly channelId: string;
    readonly keyword: string;
    readonly at: number;
  }[];
  /** Search runs' start times, newest first. */
  readonly runs: readonly number[];
}

export const emptyProfile: ProfileFacts = {
  medianViews: null,
  uploads30: null,
  subscribers: null,
  sponsored: null,
  inMarkets: null,
  addressFound: null,
};

export const emptyPipeline: PipelineFacts = {
  links: new Map(),
  retrying: new Set(),
  archive: {
    total: 0,
    byRules: 0,
    ruleLabels: [],
    hours: [],
    personIds: [],
    person: emptyProfile,
    rules: emptyProfile,
  },
  keywords: [],
  keywordHours: [],
  linkTimes: new Map(),
  pending: [],
  runs: [],
};

/** The countries the fit score counts as the audience (`fit.ts`'s `homeCountries`). */
const markets = "('US','GB','CA','AU')";

type Db = DatabaseSync;

function count(db: Db, sql: string, ...args: (string | number)[]): number {
  return Number(db.prepare(sql).get(...args)?.["n"] ?? 0);
}

function columnsOf(db: Db, table: string): ReadonlySet<string> {
  return new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[]).map(
      (column) => column.name,
    ),
  );
}

/** The median of a numeric SQL expression over a group of tombstones; null with none. */
function median(db: Db, expr: string, where: string): number | null {
  const n = count(
    db,
    `SELECT COUNT(*) AS n FROM channel_archive WHERE ${where} AND (${expr}) IS NOT NULL`,
  );
  if (n === 0) {
    return null;
  }
  const rows = db
    .prepare(
      `SELECT (${expr}) AS v FROM channel_archive WHERE ${where} AND (${expr}) IS NOT NULL
       ORDER BY v LIMIT ? OFFSET ?`,
    )
    .all(n % 2 === 0 ? 2 : 1, Math.floor((n - 1) / 2));
  const values = rows.map((row) => Number(row["v"]));
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function share(n: number, d: number): { readonly n: number; readonly d: number } | null {
  return d === 0 ? null : { n, d };
}

/** The usual tombstone of one group: medians, and shares only where the tombstones knew. */
function profile(db: Db, where: string, has: ReadonlySet<string>): ProfileFacts {
  const subscribers = "CASE WHEN subscribers GLOB '[0-9]*' THEN CAST(subscribers AS INTEGER) END";
  const shares = (column: string, yes: string): { n: number; d: number } | null => {
    if (!has.has(column)) {
      return null;
    }
    const row = db
      .prepare(
        `SELECT COUNT(*) AS d, COALESCE(SUM(CASE WHEN ${yes} THEN 1 ELSE 0 END), 0) AS n
         FROM channel_archive WHERE ${where} AND ${column} IS NOT NULL AND ${column} <> ''`,
      )
      .get();
    return share(Number(row?.["n"] ?? 0), Number(row?.["d"] ?? 0));
  };
  return {
    medianViews: has.has("median_views_last_30") ? median(db, "median_views_last_30", where) : null,
    uploads30: has.has("videos_last_30") ? median(db, "videos_last_30", where) : null,
    subscribers: median(db, subscribers, where),
    sponsored: shares("seen_brands", "seen_brands NOT IN ('[]', 'null')"),
    inMarkets: shares("country", `upper(country) IN ${markets}`),
    addressFound: shares("found_emails", "found_emails NOT IN ('[]', 'null')"),
  };
}

function readArchive(db: Db): PipelineFacts["archive"] | null {
  let has: ReadonlySet<string>;
  try {
    has = columnsOf(db, "channel_archive");
  } catch {
    return null;
  }
  if (!has.has("channel_id")) {
    return null;
  }
  const label = has.has("label") ? "label" : "NULL";
  const byPerson = `${label} = 'rejected'`;
  const byRules = `${label} IS NOT 'rejected'`;
  const hours = db
    .prepare(
      `SELECT substr(archived_at, 1, 13) AS h, (${byRules}) AS r, COUNT(*) AS n
       FROM channel_archive WHERE archived_at IS NOT NULL GROUP BY h, r`,
    )
    .all()
    .flatMap((row): ArchiveHour[] => {
      const at = parseTime(`${String(row["h"])}:00:00`);
      return at === null ? [] : [{ at, rules: Number(row["r"]) === 1, n: Number(row["n"]) }];
    });
  return {
    total: count(db, "SELECT COUNT(*) AS n FROM channel_archive"),
    byRules: count(db, `SELECT COUNT(*) AS n FROM channel_archive WHERE ${byRules}`),
    ruleLabels: db
      .prepare(
        `SELECT COALESCE(${label}, 'unknown') AS l, COUNT(*) AS n FROM channel_archive
         WHERE ${byRules} GROUP BY l ORDER BY n DESC, l`,
      )
      .all()
      .map((row) => ({ label: String(row["l"]), count: Number(row["n"]) })),
    hours,
    personIds: db
      .prepare(`SELECT channel_id FROM channel_archive WHERE ${byPerson}`)
      .all()
      .map((row) => String(row["channel_id"])),
    person: profile(db, byPerson, has),
    rules: profile(db, byRules, has),
  };
}

/** Every keyword's tombstone entries by hour (one pass of `json_each` over `found_via`). */
function readKeywordHours(db: Db): KeywordHour[] {
  if (!columnsOf(db, "channel_archive").has("found_via")) {
    return [];
  }
  const label = columnsOf(db, "channel_archive").has("label") ? "a.label" : "NULL";
  return db
    .prepare(
      `SELECT json_extract(j.value, '$.keyword') AS k,
              substr(json_extract(j.value, '$.discovered_at'), 1, 13) AS h,
              (j.key = 0) AS o, (${label} IS NOT 'rejected') AS r, COUNT(*) AS n
       FROM channel_archive a,
            json_each(CASE WHEN json_valid(a.found_via) THEN a.found_via ELSE '[]' END) j
       WHERE json_type(j.value) = 'object' AND k IS NOT NULL AND k <> ?
       GROUP BY k, h, o, r`,
    )
    .all(refetchKeyword)
    .map((row) => ({
      keyword: String(row["k"]),
      at: row["h"] === null ? null : parseTime(`${String(row["h"])}:00:00`),
      original: Number(row["o"]) === 1,
      rules: Number(row["r"]) === 1,
      n: Number(row["n"]),
    }));
}

function readLinks(db: Db): Pick<PipelineFacts, "links" | "linkTimes"> {
  const links = new Map<string, string[]>();
  const linkTimes = new Map<string, number[]>();
  const rows = db
    .prepare(
      `SELECT channel_id, keyword, discovered_at FROM channel_keywords
       WHERE keyword <> ? ORDER BY discovered_at, keyword`,
    )
    .all(refetchKeyword);
  for (const row of rows) {
    const id = String(row["channel_id"]);
    const keyword = String(row["keyword"]);
    const list = links.get(id);
    if (list === undefined) {
      links.set(id, [keyword]);
    } else {
      list.push(keyword);
    }
    const at = parseTime(row["discovered_at"]);
    if (at !== null) {
      const times = linkTimes.get(keyword);
      if (times === undefined) {
        linkTimes.set(keyword, [at]);
      } else {
        times.push(at);
      }
    }
  }
  return { links, linkTimes };
}

/** Reads what the reports need from the file; each part that can't be read is left empty. */
function readFile(path: string): PipelineFacts {
  const db = new DatabaseSync(path, { readOnly: true });
  const part = <T>(read: () => T, empty: T): T => {
    try {
      return read();
    } catch {
      return empty;
    }
  };
  try {
    const failures = part(() => columnsOf(db, "channels").has("read_failures"), false);
    const runColumns = part(() => columnsOf(db, "runs"), new Set<string>());
    const archive = part(() => readArchive(db), null);
    return {
      ...part(() => readLinks(db), { links: new Map(), linkTimes: new Map() }),
      retrying: failures
        ? new Set(
            db
              .prepare("SELECT channel_id FROM channels WHERE read_failures BETWEEN 1 AND 2")
              .all()
              .map((row) => String(row["channel_id"])),
          )
        : new Set(),
      archive: archive ?? emptyPipeline.archive,
      keywords: part(
        () =>
          db
            .prepare("SELECT keyword, started_at, completed_at FROM keywords WHERE keyword <> ?")
            .all(refetchKeyword)
            .map((row) => ({
              keyword: String(row["keyword"]),
              startedAt: parseTime(row["started_at"]),
              completedAt: parseTime(row["completed_at"]),
            })),
        [],
      ),
      keywordHours: part(() => readKeywordHours(db), []),
      pending: part(
        () =>
          db
            .prepare("SELECT channel_id, keyword, discovered_at FROM archive_keyword_pending")
            .all()
            .flatMap((row) => {
              const at = parseTime(row["discovered_at"]);
              return at === null
                ? []
                : [{ channelId: String(row["channel_id"]), keyword: String(row["keyword"]), at }];
            }),
        [],
      ),
      runs: part(
        () =>
          db
            .prepare(
              `SELECT started_at FROM runs
               ${runColumns.has("kind") ? "WHERE kind = 'search'" : ""}`,
            )
            .all()
            .flatMap((row) => {
              const at = parseTime(row["started_at"]);
              return at === null ? [] : [at];
            })
            .sort((a, b) => b - a),
        [],
      ),
    };
  } finally {
    db.close();
  }
}

/** The file's size and time, and its write-ahead log's: Python's writes may sit in the log. */
function signature(path: string): string {
  const parts = [path];
  for (const file of [path, `${path}-wal`]) {
    try {
      const stat = statSync(file);
      parts.push(`${String(stat.size)}:${String(stat.mtimeMs)}`);
    } catch {
      parts.push("-");
    }
  }
  return parts.join("|");
}

const cache = new Map<string, { readonly sig: string; readonly facts: PipelineFacts }>();
const cacheMax = 4;

/**
 * `pipeline.db`'s facts, read again only when the file changed. A missing or unreadable file gives
 * nothing (never a throw): the reports then show an empty catalog and archive.
 */
export function readPipelineFacts(path: string): PipelineFacts {
  if (!existsSync(path)) {
    return emptyPipeline;
  }
  const sig = signature(path);
  const kept = cache.get(path);
  if (kept?.sig === sig) {
    return kept.facts;
  }
  let facts: PipelineFacts;
  try {
    facts = readFile(path);
  } catch {
    return emptyPipeline;
  }
  cache.delete(path);
  cache.set(path, { sig, facts });
  while (cache.size > cacheMax) {
    const oldest = cache.keys().next();
    if (oldest.done === true) {
      break;
    }
    cache.delete(oldest.value);
  }
  return facts;
}

/** Forgets what was kept (tests). */
export function forgetPipelineFacts(): void {
  cache.clear();
}

/** The archived-per-week totals of the last `weeks` weeks (Monday, local), oldest first. */
export function weeklyArchive(
  hours: readonly ArchiveHour[],
  now: number,
  weeks: number,
): { at: number; all: number; byRules: number }[] {
  const thisWeek = startOfWeek(now);
  const starts: number[] = [];
  for (let i = weeks - 1; i >= 0; i -= 1) {
    const d = new Date(thisWeek);
    d.setDate(d.getDate() - 7 * i);
    starts.push(d.getTime());
  }
  const out = starts.map((at) => ({ at, all: 0, byRules: 0 }));
  const first = starts[0] ?? thisWeek;
  for (const hour of hours) {
    if (hour.at < first || hour.at >= now + dayMs) {
      continue;
    }
    let index = -1;
    for (let i = starts.length - 1; i >= 0; i -= 1) {
      if (hour.at >= (starts[i] ?? Infinity)) {
        index = i;
        break;
      }
    }
    const bucket = out[index];
    if (bucket !== undefined) {
      bucket.all += hour.n;
      if (hour.rules) {
        bucket.byRules += hour.n;
      }
    }
  }
  return out;
}
