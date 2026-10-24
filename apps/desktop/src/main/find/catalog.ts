import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import type { CreatorStage, CreatorState } from "@gratovo/core/data";
import { fitOf, queryCatalog, type CatalogItem, type CatalogVideo } from "@gratovo/core/find";

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
  videos_last_30: number | null;
  median_views_last_30: number | null;
  latest_upload_at: string | null;
  seen_brands: string | null;
  found_emails: string | null;
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
  let windows: RunWindow[] = [];
  if (dbPath !== null && existsSync(dbPath)) {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      channels.push(
        ...(db
          .prepare(
            `SELECT channel_id, handle, name, subscribers, profile_picture, country, first_seen_at,
               videos_last_30, median_views_last_30, latest_upload_at, seen_brands, found_emails
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
           ) WHERE n = 1`,
        )
        .all() as unknown as KeywordRow[];
      for (const row of keywordRows) {
        keywords.set(row.channel_id, row);
      }
      windows = readRunWindows(db);
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
      subscribers: count(channel.subscribers),
      medianViews: channel.median_views_last_30 ?? 0,
      uploads30: channel.videos_last_30 ?? 0,
      country: countryOf(channel.country),
      sponsors: sponsorsOf(channel.seen_brands),
      foundEmails: jsonList(channel.found_emails).length,
      latestUploadAt: parseTime(channel.latest_upload_at),
      foundAt,
      run: runAt(windows, foundAt, now),
      keyword: keyword?.keyword ?? null,
      videos: videos.get(id) ?? [],
      engagement: state?.engagement ?? null,
      emailedBefore: emailedBefore(state),
      rejectReason: state?.rejectReason ?? null,
      archiveDueAt: state?.archiveDueAt ?? null,
      hasNumbers: true,
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
      subscribers: null,
      medianViews: 0,
      uploads30: 0,
      country: null,
      sponsors: [],
      foundEmails: 0,
      latestUploadAt: null,
      foundAt: null,
      run: null,
      keyword: null,
      videos: [],
      engagement: state.engagement,
      emailedBefore: emailedBefore(state),
      rejectReason: state.rejectReason,
      archiveDueAt: state.archiveDueAt,
      hasNumbers: false,
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
      return { item: { ...row, fit: fitOf(row), description, videos: [...videos] } };
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
