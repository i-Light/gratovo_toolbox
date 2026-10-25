import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import {
  emailMax,
  emailPattern,
  notesMax,
  type CreatorStage,
  type CreatorState,
} from "@gratovo/core/data";
import {
  emailConfidence,
  fitOf,
  foundEmailsMax,
  queryCatalog,
  sortFoundEmails,
  type CatalogItem,
  type CatalogVideo,
  type FoundEmail,
} from "@gratovo/core/find";

import { refetchKeyword } from "../pipeline/protocol";
import type { Catalog, CatalogDeps } from "./catalog-types";
import { parseTime, readRunWindows, readRuns, runAt, type RunWindow } from "./runs";

/**
 * The Find catalog (plan step 5, D1 and D2): `pipeline.db` joined to the open source's creator
 * states, built in memory and rebuilt on `invalidate()`. Python owns the database, so it is opened
 * read-only for each build and closed again, as `results.ts` does.
 */

const channelPattern = /^UC[A-Za-z0-9_-]{22}$/;
const videoPattern = /^[A-Za-z0-9_-]{11}$/;
const itemVideos = 15;
const listVideos = 3;
const sponsorMax = 50;
/** Failed reads after which the pipeline stops retrying a channel (`READ_GIVE_UP`). */
const readGiveUp = 3;
const descriptionMax = 5000;
/** Stages that mean someone has been in touch (D12). */
const contacted: ReadonlySet<CreatorStage> = new Set([
  "emailed",
  "replied",
  "kit",
  "audience",
  "signed",
]);
/** The old app's `pipeline_stage` values that mean it mailed the creator; never `new` or `lost`. */
const legacyContacted: ReadonlySet<string> = new Set([
  "contacted",
  "interested",
  "roster",
  "negotiating",
  "contract",
  "awaitingDelivery",
  "paid",
]);
const countryPattern = /^[A-Z]{2}$/;

/** A two-letter country code, upper case; anything else ("", "usa", "u s") is none. */
function countryOf(text: string | null): string | null {
  const code = (text ?? "").trim().toUpperCase();
  return countryPattern.test(code) ? code : null;
}

interface ChannelRow {
  channel_id: string;
  handle: string | null;
  name: string | null;
  subscribers: string | number | null;
  profile_picture: string | null;
  country: string | null;
  first_seen_at: string | null;
  /** Set once the channel's uploads have been read (D45). */
  videos_fetched_at: string | null;
  videos_last_30: number | null;
  median_views_last_30: number | null;
  latest_upload_at: string | null;
  seen_brands: string | null;
  found_emails: string | null;
  /** Null when the file is older than schema 3 and has no such column. */
  found_email_sources: string | null;
  read_failures: number | null;
}

interface VideoRow {
  channel_id: string;
  video_id: string;
  title: string | null;
  view_count: string | number | null;
  published_at: string | null;
}

interface KeywordRow {
  channel_id: string;
  keyword: string;
  discovered_at: string | null;
}

/** "48200" is a number; "Hidden" and anything else is none. */
function count(value: string | number | null): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
  }
  return value !== null && /^\d{1,12}$/.test(value.trim()) ? Number(value.trim()) : null;
}

function jsonList(text: string | null): unknown[] {
  if (text === null) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function sponsorsOf(text: string | null): string[] {
  const seen = new Set<string>();
  for (const entry of jsonList(text)) {
    if (typeof entry === "string" && entry.trim() !== "") {
      seen.add(entry.trim().slice(0, 100));
      if (seen.size >= sponsorMax) {
        break;
      }
    }
  }
  return [...seen];
}

/**
 * The finder's addresses (D27, D29). `sources` says where each was seen; an address only in
 * `found_emails` (an old row, or a database before schema 3) reads as found in the About text.
 * Entries not in an address's shape are dropped, repeats too; the list is sorted, then cut to
 * `foundEmailsMax`.
 */
function emailsOf(found: string | null, sources: string | null): FoundEmail[] {
  const seen = new Set<string>();
  const emails: FoundEmail[] = [];
  const add = (address: unknown, source: "about" | "video", videos: number, business: boolean) => {
    const email = typeof address === "string" ? address.trim() : "";
    if (email.length > emailMax || !emailPattern.test(email) || seen.has(email.toLowerCase())) {
      return;
    }
    seen.add(email.toLowerCase());
    emails.push({
      email,
      source,
      videos,
      business,
      confidence: emailConfidence({ email, source, videos, business }),
    });
  };
  for (const entry of jsonList(sources)) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const { email, source, videos, business } = entry as Record<string, unknown>;
    if (source !== "about" && source !== "video") {
      continue;
    }
    const n =
      typeof videos === "number" && Number.isFinite(videos) ? Math.max(0, Math.floor(videos)) : 0;
    // An About address keeps its video count too, so the card can say it is also in N videos.
    add(email, source, n, business === true);
  }
  for (const entry of jsonList(found)) {
    add(entry, "about", 0, false);
  }
  return sortFoundEmails(emails).slice(0, foundEmailsMax);
}

function videoOf(row: VideoRow): CatalogVideo {
  return {
    id: row.video_id,
    title: row.title ?? "",
    views: count(row.view_count),
    publishedAt: parseTime(row.published_at),
    pic: videoPattern.test(row.video_id) ? `v:${row.video_id}` : null,
  };
}

const videoColumns = "video_id, channel_id, title, view_count, published_at";

interface Built {
  readonly rows: readonly CatalogItem[];
  readonly pictures: ReadonlyMap<string, string>;
}

function emailedBefore(state: CreatorState | undefined): CatalogItem["emailedBefore"] {
  if (state === undefined) {
    return null;
  }
  // The legacy stage counts only while the app has no stage of its own: once it has, the legacy
  // field may be a leftover (a never then allow wrote "lost") and says nothing about mail.
  const legacy = !state.hasAppStage && legacyContacted.has(state.legacyPipelineStage.trim());
  if (!legacy && !contacted.has(state.stage)) {
    return null;
  }
  return { at: state.lastActivity?.at ?? null, who: state.lastActivity?.who ?? null };
}

function build(dbPath: string | null, states: readonly CreatorState[], now: number): Built {
  const channels: ChannelRow[] = [];
  const videos = new Map<string, CatalogVideo[]>();
  const keywords = new Map<string, KeywordRow>();
  /** `channel_archive.archived_at` as ms, by channel (D36); 0 for text that isn't a time. */
  const archived = new Map<string, number>();
  let windows: RunWindow[] = [];
  if (dbPath !== null && existsSync(dbPath)) {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      // Schema 3 added `found_email_sources`; an older file has no such column.
      const channelColumns = new Set(
        (db.prepare("PRAGMA table_info(channels)").all() as unknown as { name: string }[]).map(
          (column) => column.name,
        ),
      );
      const hasSources = channelColumns.has("found_email_sources");
      // The pipeline's own count of failed reads (schema 4+); an older file has none.
      const hasFailures = channelColumns.has("read_failures");
      channels.push(
        ...(db
          .prepare(
            `SELECT channel_id, handle, name, subscribers, profile_picture, country, first_seen_at,
               videos_fetched_at, videos_last_30, median_views_last_30, latest_upload_at, seen_brands, found_emails,
               ${hasSources ? "found_email_sources" : "NULL AS found_email_sources"},
               ${hasFailures ? "read_failures" : "NULL AS read_failures"}
             FROM channels`,
          )
          .all() as unknown as ChannelRow[]),
      );
      const videoRows = db
        .prepare(
          `SELECT ${videoColumns} FROM (
             SELECT ${videoColumns}, ROW_NUMBER() OVER
               (PARTITION BY channel_id ORDER BY published_at DESC, video_id) AS n FROM videos
           ) WHERE n <= ${String(listVideos)}`,
        )
        .all() as unknown as VideoRow[];
      for (const row of videoRows) {
        const list = videos.get(row.channel_id) ?? [];
        list.push(videoOf(row));
        videos.set(row.channel_id, list);
      }
      const keywordRows = db
        .prepare(
          `SELECT channel_id, keyword, discovered_at FROM (
             SELECT channel_id, keyword, discovered_at, ROW_NUMBER() OVER
               (PARTITION BY channel_id ORDER BY discovered_at, keyword) AS n FROM channel_keywords
             WHERE keyword <> ?
           ) WHERE n = 1`,
        )
        .all(refetchKeyword) as unknown as KeywordRow[];
      for (const row of keywordRows) {
        keywords.set(row.channel_id, row);
      }
      windows = readRunWindows(db);
      try {
        const tombstones = db
          .prepare("SELECT channel_id, archived_at FROM channel_archive")
          .all() as unknown as { channel_id: string; archived_at: string | null }[];
        for (const row of tombstones) {
          // A tombstone whose time can't be read is still one: as null it would sit in the
          // countdown and be swept again every pass.
          archived.set(row.channel_id, parseTime(row.archived_at) ?? 0);
        }
      } catch {
        // A file with no such table has no tombstones.
      }
    } finally {
      db.close();
    }
  }

  const byId = new Map(states.map((state) => [state.id, state]));
  const pictures = new Map<string, string>();
  const rows: CatalogItem[] = [];
  const seen = new Set<string>();

  for (const channel of channels) {
    const id = channel.channel_id;
    seen.add(id);
    const state = byId.get(id);
    const keyword = keywords.get(id);
    const foundAt = parseTime(keyword?.discovered_at ?? channel.first_seen_at);
    const picture = channel.profile_picture ?? "";
    if (picture !== "") {
      pictures.set(id, picture);
    }
    const handle = channel.handle ?? state?.handle ?? "";
    rows.push({
      id,
      name: channel.name?.trim() || state?.name || handle || id,
      handle,
      pic: picture !== "" && channelPattern.test(id) ? `c:${id}` : null,
      stage: state?.stage ?? "new",
      emailConfirmed: state?.emailConfirmed ?? false,
      email: state?.email ?? null,
      contactName: state?.contactName ?? null,
      subscribers: count(channel.subscribers),
      medianViews: channel.median_views_last_30 ?? 0,
      uploads30: channel.videos_last_30 ?? 0,
      country: countryOf(channel.country),
      sponsors: sponsorsOf(channel.seen_brands),
      emails: emailsOf(channel.found_emails, channel.found_email_sources),
      latestUploadAt: parseTime(channel.latest_upload_at),
      foundAt,
      run: runAt(windows, foundAt, now),
      keyword: keyword?.keyword ?? null,
      videos: videos.get(id) ?? [],
      engagement: state?.engagement ?? null,
      emailedBefore: emailedBefore(state),
      rejectReason: state?.rejectReason ?? null,
      rejectedAt: state?.rejectedAt ?? null,
      neverReason: state?.neverReason ?? null,
      archiveDueAt: state?.archiveDueAt ?? null,
      archivedAt: archived.get(id) ?? null,
      hasNumbers: true,
      uploadsRead: channel.videos_fetched_at !== null && channel.videos_fetched_at.trim() !== "",
      readFailed: (channel.read_failures ?? 0) >= readGiveUp,
    });
  }

  for (const state of states) {
    if (seen.has(state.id) || state.stage === "new") {
      continue;
    }
    rows.push({
      id: state.id,
      name: state.name ?? state.handle,
      handle: state.handle,
      pic: null,
      stage: state.stage,
      emailConfirmed: state.emailConfirmed,
      email: state.email,
      contactName: state.contactName,
      subscribers: null,
      medianViews: 0,
      uploads30: 0,
      country: null,
      sponsors: [],
      emails: [],
      latestUploadAt: null,
      foundAt: null,
      run: null,
      keyword: null,
      videos: [],
      engagement: state.engagement,
      emailedBefore: emailedBefore(state),
      rejectReason: state.rejectReason,
      rejectedAt: state.rejectedAt,
      neverReason: state.neverReason,
      archiveDueAt: state.archiveDueAt,
      archivedAt: archived.get(state.id) ?? null,
      hasNumbers: false,
      uploadsRead: false,
      readFailed: false,
    });
  }
  return { rows, pictures };
}

export function createCatalog(deps: CatalogDeps): Catalog {
  const now = deps.now ?? Date.now;
  const debounceMs = deps.debounceMs ?? 500;
  const listeners = new Set<(version: number) => void>();
  let built: Built | null = null;
  let version = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Resolves when the scheduled rebuild has finished, for queries that came while rows were stale. */
  let waiting: { promise: Promise<void>; done: () => void } | null = null;
  let running: Promise<void> | null = null;
  let closed = false;

  async function rebuild(): Promise<void> {
    try {
      const states = (await deps.source()?.creatorStates()) ?? [];
      built = build(deps.pipelineDbPath(), states, now());
      version += 1;
    } catch {
      // Keep the last good rows; the next change tries again.
      console.error("Find: the catalog could not be built.");
      built ??= { rows: [], pictures: new Map() };
    }
  }

  async function ready(): Promise<Built> {
    for (;;) {
      if (waiting !== null) {
        await waiting.promise;
      } else if (running !== null) {
        await running;
      } else if (built === null) {
        running = rebuild().finally(() => {
          running = null;
        });
      } else {
        return built;
      }
    }
  }

  function fire(): void {
    timer = null;
    const pending = waiting;
    waiting = null;
    running = rebuild()
      .then(() => {
        for (const listener of listeners) {
          listener(version);
        }
      })
      .finally(() => {
        running = null;
        pending?.done();
      });
  }

  return {
    invalidate(): void {
      if (closed || built === null || timer !== null) {
        return;
      }
      let done = (): void => undefined;
      const promise = new Promise<void>((resolve) => {
        done = resolve;
      });
      waiting = { promise, done };
      timer = setTimeout(fire, debounceMs);
    },
    onChange(listener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    channelPicture(id: string): string | null {
      return built?.pictures.get(id) ?? null;
    },
    async query({ filter, sort, offset, limit, facets }) {
      const { rows } = await ready();
      const page = queryCatalog(rows, filter, sort, offset, limit, { facets: facets !== false });
      return { version, total: page.total, items: [...page.items], facets: page.facets };
    },
    async snapshot() {
      const { rows } = await ready();
      return { version, rows };
    },
    peek() {
      return built?.rows ?? null;
    },
    async item(id: string) {
      const { rows } = await ready();
      const row = rows.find((candidate) => candidate.id === id);
      if (row === undefined) {
        return { item: null };
      }
      let description = "";
      let videos = row.videos;
      const path = deps.pipelineDbPath();
      if (row.hasNumbers && path !== null && existsSync(path)) {
        const db = new DatabaseSync(path, { readOnly: true });
        try {
          const text = db
            .prepare("SELECT description FROM channels WHERE channel_id = ?")
            .get(id) as { description: string | null } | undefined;
          description = (text?.description ?? "").slice(0, descriptionMax);
          videos = (
            db
              .prepare(
                `SELECT ${videoColumns} FROM videos WHERE channel_id = ?
                 ORDER BY published_at DESC, video_id LIMIT ?`,
              )
              .all(id, itemVideos) as unknown as VideoRow[]
          ).map(videoOf);
        } catch {
          // Keep the newest three from the build.
        } finally {
          db.close();
        }
      }
      // The notes are read here, for this one creator, rather than kept in the rows: a notes save
      // then needs no rebuild (D24). A note pulled from the server may be longer than the app
      // writes; the detail shows the start and says so, and the page shows it read-only.
      const full = (await deps.source()?.creatorNotes(id)) ?? "";
      return {
        item: {
          ...row,
          fit: fitOf(row),
          description,
          videos: [...videos],
          notes: full.slice(0, notesMax),
          notesCut: full.length > notesMax,
        },
      };
    },
    async runs() {
      const { rows } = await ready();
      return { runs: readRuns(deps.pipelineDbPath(), rows, 50, now()) };
    },
    close(): void {
      closed = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      listeners.clear();
      waiting?.done();
      waiting = null;
    },
  };
}
