import { emptyFacets, queryCatalog, type CatalogItem, type FindFilter } from "@gratovo/core/find";
import type { Bridge } from "@gratovo/ipc/bridge";

/** One row of `find:runs`. */
export interface TestRun {
  readonly id: number;
  readonly startedAt: number;
  readonly finishedAt: number | null;
  readonly status: string;
  readonly keywords: number;
  readonly found: number;
  readonly kept: number;
  readonly gold: number;
}

/** A catalog item about an AI channel, with sensible numbers; `over` changes any field. */
export function aiChannel(id: string, name: string, over: Partial<CatalogItem> = {}): CatalogItem {
  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return {
    id,
    name,
    handle: `@${slug}`,
    pic: null,
    stage: "new",
    emailConfirmed: false,
    email: null,
    contactName: null,
    subscribers: 120_000,
    medianViews: 41_000,
    uploads30: 6,
    country: "US",
    sponsors: ["Notion AI", "Descript"],
    emails: [
      { email: `biz@${slug}.ai`, source: "about", videos: 0, business: true, confidence: 0.95 },
      { email: `${slug}@gmail.com`, source: "video", videos: 3, business: false, confidence: 0.75 },
    ],
    latestUploadAt: Date.now() - 2 * 86_400_000,
    foundAt: Date.now() - 86_400_000,
    run: 2,
    keyword: "ai agents",
    videos: [
      {
        id: `${id}-v1`,
        title: "Build an AI agent in 20 minutes",
        views: 52_000,
        publishedAt: Date.now() - 2 * 86_400_000,
        pic: null,
      },
      {
        id: `${id}-v2`,
        title: "Claude Code vs Cursor",
        views: 39_000,
        publishedAt: Date.now() - 6 * 86_400_000,
        pic: null,
      },
      {
        id: `${id}-v3`,
        title: "Prompt tricks that still work",
        views: null,
        publishedAt: Date.now() - 12 * 86_400_000,
        pic: null,
      },
    ],
    engagement: null,
    emailedBefore: null,
    rejectReason: null,
    rejectedAt: null,
    neverReason: null,
    archiveDueAt: null,
    archivedAt: null,
    hasNumbers: true,
    uploadsRead: true,
    ...over,
  };
}

/** What `stubFindBridge` can be told to answer with. */
export interface FindBridgeFixture {
  readonly items?: readonly CatalogItem[];
  readonly runs?: readonly TestRun[];
}

/**
 * For tests that open Find without caring about it: a bridge whose `find:state` fails, whose
 * catalog channels answer empty (or with the fixture's items and runs, filtered and sorted as main
 * does), whose saved views and creator lines are none (a save is accepted), whose keyword ideas
 * answer `bridge_off`, and that has no events. Returns the calls made, in order.
 */
export function stubFindBridge(fixture: FindBridgeFixture = {}): [string, unknown][] {
  const calls: [string, unknown][] = [];
  const items = fixture.items ?? [];
  const invoke = (channel: string, input: unknown) => {
    calls.push([channel, input]);
    switch (channel) {
      case "find:query": {
        const q = input as {
          filter: FindFilter;
          sort: Parameters<typeof queryCatalog>[2];
          offset: number;
          limit: number;
        };
        if (items.length === 0) {
          return Promise.resolve({
            ok: true,
            value: { version: 0, total: 0, items: [], facets: emptyFacets },
          });
        }
        const page = queryCatalog(items, q.filter, q.sort, q.offset, q.limit);
        return Promise.resolve({ ok: true, value: { version: 1, ...page } });
      }
      case "find:item":
        return Promise.resolve({ ok: true, value: { item: null } });
      case "find:runs":
        return Promise.resolve({ ok: true, value: { runs: fixture.runs ?? [] } });
      case "find:views":
        return Promise.resolve({ ok: true, value: { views: [] } });
      case "find:views-set":
        return Promise.resolve({ ok: true, value: { ok: true } });
      case "log:for":
        return Promise.resolve({ ok: true, value: { lines: [] } });
      case "find:ideas":
        // As main's stub answers until the bridge is wired (B10).
        return Promise.resolve({ ok: true, value: { ok: false, problem: "bridge_off" } });
      default:
        return Promise.resolve({ ok: false, reason: "test" });
    }
  };
  (window as unknown as { gratovo: Bridge }).gratovo = {
    invoke: invoke as unknown as Bridge["invoke"],
    on: () => () => undefined,
  };
  return calls;
}
