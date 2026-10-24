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
    archived_at TEXT
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
  archive?: { id: string; at: string }[];
  /** Build the file as schema 2 had it, without `found_email_sources`. */
  schema2?: boolean;
}

/** Makes the file at `path` with the Python tables and `data` in them. */
export function writePipelineDb(path: string, data: FixtureData = {}): void {
  const db = new DatabaseSync(path);
  try {
    const old = data.schema2 === true;
    db.exec(old ? ddlSchema2 : ddl);
    db.exec("BEGIN");
    const channel = db.prepare(
      `INSERT INTO channels (channel_id, handle, name, description, subscribers, profile_picture,
         country, first_seen_at, videos_last_30, median_views_last_30, latest_upload_at,
         seen_brands, found_emails${old ? "" : ", found_email_sources"})
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?${old ? "" : ",?"})`,
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
    const archive = db.prepare(
      "INSERT INTO channel_archive (channel_id, handle, archived_at) VALUES (?,?,?)",
    );
    for (const a of data.archive ?? []) {
      archive.run(a.id, `@${a.id}`, a.at);
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
