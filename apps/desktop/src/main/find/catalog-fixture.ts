import { DatabaseSync } from "node:sqlite";

import type { CreatorState } from "@gratovo/core/data";

/** Test helpers for the catalog: a `pipeline.db` with the Python tables, and creator states. */

/** The tables the catalog reads, copied from `gratovo_pipeline/store.py` (unread columns left out). */
const ddl = `
CREATE TABLE channels (
    channel_id TEXT PRIMARY KEY,
    handle TEXT NOT NULL,
    name TEXT,
    description TEXT,
    subscribers TEXT,
    profile_picture TEXT,
    country TEXT,
    first_seen_at TEXT NOT NULL,
    videos_fetched_at TEXT,
    videos_last_30 INTEGER NOT NULL DEFAULT 0,
    median_views_last_30 INTEGER,
    latest_upload_at TEXT,
    main_language TEXT,
    main_language_basis TEXT,
    topic_counts TEXT,
    total_views INTEGER,
    video_count INTEGER,
    started_at TEXT,
    median_likes INTEGER,
    median_comments INTEGER,
    engagement_rate REAL,
    median_duration_s INTEGER,
    shorts_share REAL,
    paid_share REAL,
    sponsored_ratio REAL,
    seen_brands TEXT,
    found_emails TEXT,
    found_email_sources TEXT,
    read_failures INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE channel_keywords (
    channel_id TEXT NOT NULL REFERENCES channels(channel_id),
    keyword TEXT NOT NULL,
    discovered_at TEXT NOT NULL,
    PRIMARY KEY (channel_id, keyword)
);
CREATE TABLE videos (
    video_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL REFERENCES channels(channel_id),
    title TEXT,
    published_at TEXT,
    view_count TEXT
);
CREATE INDEX idx_videos_channel_published ON videos (channel_id, published_at DESC);
CREATE TABLE channel_archive (
    channel_id TEXT PRIMARY KEY,
    handle TEXT,
    label TEXT,
    archived_at TEXT,
    subscribers TEXT,
    median_views_last_30 INTEGER,
    videos_found_count INTEGER,
    found_via TEXT,
    found_at TEXT,
    seen_brands TEXT,
    found_emails TEXT,
    name TEXT,
    country TEXT,
    videos_last_30 INTEGER,
    latest_upload_at TEXT
);
CREATE TABLE runs (
    run_id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    keywords_total INTEGER NOT NULL DEFAULT 0,
    kind TEXT NOT NULL DEFAULT 'search'
);
CREATE TABLE keywords (
    keyword TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'pending',
    added_at TEXT NOT NULL DEFAULT '2026-01-01 00:00:00',
    started_at TEXT,
    completed_at TEXT,
    channels_found INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE archive_keyword_pending (
    channel_id TEXT NOT NULL,
    keyword TEXT NOT NULL,
    handles_limit INTEGER,
    discovered_at TEXT NOT NULL,
    PRIMARY KEY (channel_id, keyword)
);
`;

/** The channel columns schema 7 added (S3), as the DDL above lists them. */
const factColumns =
  /^ {4}(main_language|main_language_basis|topic_counts|total_views|video_count|started_at|median_likes|median_comments|engagement_rate|median_duration_s|shorts_share|paid_share) .*\n/gm;

/** The tables as schema 6 had them: no language or channel-fact columns. */
const ddlSchema6 = ddl.replace(/CREATE TABLE channels \([\s\S]*?\n\);/, (table) =>
  table.replace(factColumns, ""),
);

/** The archive as schema 3 had it: none of the facts schema 4 added (D42). */
const ddlSchema3Archive = ddlSchema6
  .replace(",\n    read_failures INTEGER NOT NULL DEFAULT 0", "")
  .replace(
    /subscribers TEXT,\n {4}median_views_last_30 INTEGER,[\s\S]*?latest_upload_at TEXT\n\);\nCREATE TABLE runs/,
    "subscribers TEXT\n);\nCREATE TABLE runs",
  );

/** The tables as schema 2 had them: no `found_email_sources` column. */
const ddlSchema2 = ddlSchema6.replace(
  ",\n    found_email_sources TEXT,\n    read_failures INTEGER NOT NULL DEFAULT 0",
  "",
);

export interface FixtureChannel {
  id: string;
  handle?: string;
  name?: string | null;
  description?: string | null;
  subscribers?: string | null;
  picture?: string | null;
  country?: string | null;
  firstSeen?: string;
  uploads30?: number;
  median?: number | null;
  latestUpload?: string | null;
  brands?: string | null;
  emails?: string | null;
  /** The JSON in `found_email_sources` (D27). */
  sources?: string | null;
  /** `videos_fetched_at`; a read channel by default, null for one never read (D45). */
  fetched?: string | null;
  /** `read_failures` (schema 4+); 3 or more means the pipeline gave up on it. */
  failures?: number;
  /** The schema 7 columns (S3); ignored in a file built with `schema6`. */
  language?: string | null;
  languageBasis?: string | null;
  /** The JSON in `topic_counts`, e.g. `{"Technology": 5}`. */
  topicCounts?: string | null;
  totalViews?: number | null;
  videoCount?: number | null;
  startedAt?: string | null;
  medianLikes?: number | null;
  medianComments?: number | null;
  engagementRate?: number | null;
  medianDuration?: number | null;
  shortsShare?: number | null;
  paidShare?: number | null;
}

export interface FixtureVideo {
  id: string;
  channel: string;
  title?: string;
  publishedAt?: string | null;
  views?: string | null;
}

export interface FixtureData {
  channels?: FixtureChannel[];
  videos?: FixtureVideo[];
  keywords?: { channel: string; keyword: string; at: string }[];
  runs?: { start: string; end: string | null; status?: string; keywords?: number; kind?: string }[];
  archive?: {
    id: string;
    at: string;
    handle?: string | null;
    label?: string | null;
    subscribers?: string | null;
    /** What schema 4 keeps (D42); ignored in a schema-3 file. */
    median?: number | null;
    videos?: number | null;
    foundVia?: string | null;
    name?: string | null;
    country?: string | null;
    uploads30?: number | null;
    latestUpload?: string | null;
    /** What schema 4 keeps for Insights: when it was found, sponsors and addresses (JSON text). */
    foundAt?: string | null;
    brands?: string | null;
    emails?: string | null;
  }[];
  /** The keyword queue, for Insights: its runs by keyword. */
  keywordRows?: {
    keyword: string;
    status?: string;
    startedAt?: string | null;
    completedAt?: string | null;
    found?: number;
  }[];
  /** Archived channels a search found again. */
  pending?: { channel: string; keyword: string; at: string }[];
  /** Build the archive as schema 3 had it, without the facts schema 4 added. */
  schema3?: boolean;
  /** Build the file as schema 6 had it, without the language and channel-fact columns. */
  schema6?: boolean;
  /** Build the file as schema 2 had it, without `found_email_sources`. */
  schema2?: boolean;
}

/** Makes the file at `path` with the Python tables and `data` in them. */
export function writePipelineDb(path: string, data: FixtureData = {}): void {
  const db = new DatabaseSync(path);
  try {
    const old = data.schema2 === true;
    const hasFailures = !old && data.schema3 !== true;
    db.exec(
      old
        ? ddlSchema2
        : data.schema3 === true
          ? ddlSchema3Archive
          : data.schema6 === true
            ? ddlSchema6
            : ddl,
    );
    const facts = !old && data.schema3 !== true && data.schema6 !== true;
    db.exec("BEGIN");
    const channel = db.prepare(
      `INSERT INTO channels (channel_id, handle, name, description, subscribers, profile_picture,
         country, first_seen_at, videos_fetched_at, videos_last_30, median_views_last_30, latest_upload_at,
         seen_brands, found_emails${old ? "" : ", found_email_sources"}${hasFailures ? ", read_failures" : ""}${
           facts
             ? ", main_language, main_language_basis, topic_counts, total_views, video_count, started_at, median_likes, median_comments, engagement_rate, median_duration_s, shorts_share, paid_share"
             : ""
         })
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?${old ? "" : ",?"}${hasFailures ? ",?" : ""}${facts ? ",?,?,?,?,?,?,?,?,?,?,?,?" : ""})`,
    );
    for (const c of data.channels ?? []) {
      channel.run(
        c.id,
        c.handle ?? `@${c.id.slice(0, 8)}`,
        c.name === undefined ? `Name ${c.id.slice(0, 8)}` : c.name,
        c.description ?? null,
        c.subscribers === undefined ? "1000" : c.subscribers,
        c.picture ?? null,
        c.country ?? null,
        c.firstSeen ?? "2026-10-01 00:00:00",
        c.fetched === undefined ? "2026-10-02 00:00:00" : c.fetched,
        c.uploads30 ?? 0,
        c.median ?? null,
        c.latestUpload ?? null,
        c.brands ?? null,
        c.emails ?? null,
        ...(old ? [] : [c.sources ?? null]),
        ...(hasFailures ? [c.failures ?? 0] : []),
        ...(facts
          ? [
              c.language ?? null,
              c.languageBasis ?? null,
              c.topicCounts ?? null,
              c.totalViews ?? null,
              c.videoCount ?? null,
              c.startedAt ?? null,
              c.medianLikes ?? null,
              c.medianComments ?? null,
              c.engagementRate ?? null,
              c.medianDuration ?? null,
              c.shortsShare ?? null,
              c.paidShare ?? null,
            ]
          : []),
      );
    }
    const video = db.prepare(
      "INSERT INTO videos (video_id, channel_id, title, published_at, view_count) VALUES (?,?,?,?,?)",
    );
    for (const v of data.videos ?? []) {
      video.run(
        v.id,
        v.channel,
        v.title ?? `Video ${v.id}`,
        v.publishedAt ?? null,
        v.views ?? null,
      );
    }
    const keyword = db.prepare(
      "INSERT INTO channel_keywords (channel_id, keyword, discovered_at) VALUES (?,?,?)",
    );
    for (const k of data.keywords ?? []) {
      keyword.run(k.channel, k.keyword, k.at);
    }
    const run = db.prepare(
      "INSERT INTO runs (started_at, finished_at, status, keywords_total, kind) VALUES (?,?,?,?,?)",
    );
    for (const r of data.runs ?? []) {
      run.run(r.start, r.end, r.status ?? "done", r.keywords ?? 0, r.kind ?? "search");
    }
    const wide = data.schema3 !== true;
    const archive = db.prepare(
      `INSERT INTO channel_archive (channel_id, handle, label, archived_at, subscribers${
        wide
          ? ", median_views_last_30, videos_found_count, found_via, found_at, seen_brands, found_emails, name, country, videos_last_30, latest_upload_at"
          : ""
      }) VALUES (?,?,?,?,?${wide ? ",?,?,?,?,?,?,?,?,?,?" : ""})`,
    );
    for (const a of data.archive ?? []) {
      archive.run(
        a.id,
        a.handle === undefined ? `@${a.id}` : a.handle,
        a.label ?? null,
        a.at,
        a.subscribers ?? null,
        ...(wide
          ? [
              a.median ?? null,
              a.videos ?? null,
              a.foundVia ?? null,
              a.foundAt ?? null,
              a.brands ?? null,
              a.emails ?? null,
              a.name ?? null,
              a.country ?? null,
              a.uploads30 ?? null,
              a.latestUpload ?? null,
            ]
          : []),
      );
    }
    const keywordQueue = db.prepare(
      "INSERT INTO keywords (keyword, status, started_at, completed_at, channels_found) VALUES (?,?,?,?,?)",
    );
    for (const k of data.keywordRows ?? []) {
      keywordQueue.run(
        k.keyword,
        k.status ?? "done",
        k.startedAt ?? null,
        k.completedAt ?? null,
        k.found ?? 0,
      );
    }
    const pending = db.prepare(
      "INSERT INTO archive_keyword_pending (channel_id, keyword, handles_limit, discovered_at) VALUES (?,?,?,?)",
    );
    for (const p of data.pending ?? []) {
      pending.run(p.channel, p.keyword, 200, p.at);
    }
    db.exec("COMMIT");
  } finally {
    db.close();
  }
}

/** A creator state with sensible defaults. */
export function creatorState(id: string, over: Partial<CreatorState> = {}): CreatorState {
  return {
    id,
    handle: `@${id.slice(0, 8)}`,
    name: null,
    stage: "new",
    email: null,
    emailConfirmed: false,
    contactName: null,
    rejectReason: null,
    rejectedAt: null,
    neverReason: null,
    archiveDueAt: null,
    engagement: null,
    kit: null,
    legacyPipelineStage: "new",
    hasAppStage: false,
    lastActivity: null,
    ...over,
  };
}

/** A valid YouTube channel id built from a short tag. */
export function channelId(tag: string): string {
  return `UC${tag.padEnd(22, "x").slice(0, 22)}`;
}
