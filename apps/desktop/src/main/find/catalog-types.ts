import type { DataSource } from "@gratovo/core/data";
import { emptyFacets, type CatalogItem } from "@gratovo/core/find";
import type { ChannelInput, ChannelResponse } from "@gratovo/ipc";

/**
 * What the `find:*` catalog handlers ask of main's read model (plan step 5, D1, D2 and D10): one
 * page with its facets, one channel's detail, and the run history. Each answer is a value; a
 * missing `pipeline.db` is an empty catalog, not an error.
 */
export interface FindCatalog {
  query(request: ChannelInput<"find:query">): Promise<ChannelResponse<"find:query">>;
  item(id: string): Promise<ChannelResponse<"find:item">>;
  runs(): Promise<ChannelResponse<"find:runs">>;
  /** Every row with the catalog's version, for the Toolbox lists (plan step 5d, D36 and D39). */
  snapshot(): Promise<{ version: number; rows: readonly CatalogItem[] }>;
  /**
   * The rows of the last build, at once, without waiting for a build that is due; null before the
   * first build. For reads that can live with rows a moment old (Reach's zones, plan step 6b).
   */
  peek(): readonly CatalogItem[] | null;
}

/** A catalog with nothing in it, until the read model (B2) is wired in. */
export function createStubCatalog(): FindCatalog {
  return {
    query: () => Promise.resolve({ version: 0, total: 0, items: [], facets: emptyFacets }),
    item: () => Promise.resolve({ item: null }),
    runs: () => Promise.resolve({ runs: [] }),
    snapshot: () => Promise.resolve({ version: 0, rows: [] }),
    peek: () => [],
  };
}

/** What `createCatalog` reads from: the open source's pipeline folder and creator states. */
export interface CatalogDeps {
  /** The `pipeline.db` path; null when no source is open. */
  readonly pipelineDbPath: () => string | null;
  readonly source: () => DataSource | null;
  readonly now?: () => number;
  /** Rebuilds are coalesced to at most one per this many ms; default 500. */
  readonly debounceMs?: number;
}

/** The catalog with the cache controls the wiring (W1) and the image service (B4) use. */
export interface Catalog extends FindCatalog {
  /** Marks the rows stale; one rebuild follows after the debounce, however many calls came. */
  invalidate(): void;
  /** Called with the new version after each scheduled rebuild; returns the way to stop. */
  onChange(listener: (version: number) => void): () => void;
  /** The stored profile picture URL for a channel, from the last build; null when none. */
  channelPicture(id: string): string | null;
  close(): void;
}
