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
    sponsored_ratio REAL,
    seen_brands TEXT,
    found_emails TEXT,
    found_email_sources TEXT
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
`;

/** The archive as schema 3 had it: none of the facts schema 4 added (D42). */
const ddlSchema3Archive = ddl.replace(
  /subscribers TEXT,\n {4}median_views_last_30 INTEGER,[\s\S]*?latest_upload_at TEXT\n\);\nCREATE TABLE runs/,
  "subscribers TEXT\n);\nCREATE TABLE runs",
);

/** The tables as schema 2 had them: no `found_email_sources` column. */
const ddlSchema2 = ddl.replace(",\n    found_email_sources TEXT", "");

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
  }[];
  /** Build the archive as schema 3 had it, without the facts schema 4 added. */
  schema3?: boolean;
  /** Build the file as schema 2 had it, without `found_email_sources`. */
  schema2?: boolean;
}

/** Makes the file at `path` with the Python tables and `data` in them. */
export function writePipelineDb(path: string, data: FixtureData = {}): void {
  const db = new DatabaseSync(path);
  try {
    const old = data.schema2 === true;
    db.exec(old ? ddlSchema2 : data.schema3 === true ? ddlSchema3Archive : ddl);
    db.exec("BEGIN");
    const channel = db.prepare(
      `INSERT INTO channels (channel_id, handle, name, description, subscribers, profile_picture,
         country, first_seen_at, videos_fetched_at, videos_last_30, median_views_last_30, latest_upload_at,
         seen_brands, found_emails${old ? "" : ", found_email_sources"})
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?${old ? "" : ",?"})`,
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
          ? ", median_views_last_30, videos_found_count, found_via, name, country, videos_last_30, latest_upload_at"
          : ""
      }) VALUES (?,?,?,?,?${wide ? ",?,?,?,?,?,?,?" : ""})`,
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
              a.name ?? null,
              a.country ?? null,
              a.uploads30 ?? null,
              a.latestUpload ?? null,
            ]
          : []),
      );
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
