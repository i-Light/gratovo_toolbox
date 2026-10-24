import { emptyFacets } from "@gratovo/core/find";
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
}

/** A catalog with nothing in it, until the read model (B2) is wired in. */
export function createStubCatalog(): FindCatalog {
  return {
    query: () => Promise.resolve({ version: 0, total: 0, items: [], facets: emptyFacets }),
    item: () => Promise.resolve({ item: null }),
    runs: () => Promise.resolve({ runs: [] }),
  };
}
