import type { ChannelResponse } from "@gratovo/ipc";
import {
  passes,
  sortItems,
  type CatalogItem,
  type FindFilter,
  type FindSort,
} from "@gratovo/core/find";
import type { Creator } from "@gratovo/core/data";
import { useEffect, useMemo, useRef, useState } from "react";

import { useApp } from "./store";

/** What `find:query` takes (the schema types the filter as unknown on the way in, so it is spelled out here). */
interface QueryParams {
  readonly filter: FindFilter;
  readonly sort: FindSort;
  readonly offset: number;
  readonly limit: number;
  /** False when the page shows no facets: main then skips the counting and answers zeros. */
  readonly facets?: boolean;
}
type QueryResult = ChannelResponse<"find:query">;
type QueryItem = QueryResult["items"][number];
type ItemDetail = NonNullable<ChannelResponse<"find:item">["item"]>;

export type CatalogLoad = "loading" | "ready" | "failed";

/** Counts up each time main says the catalog was rebuilt, so the hooks ask again. */
export function useCatalogTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(
    () =>
      window.gratovo.on("find:catalog", () => {
        setTick((n) => n + 1);
      }),
    [],
  );
  return tick;
}

/**
 * Puts the page's own creator state over a catalog item (D2), so a key press shows at once while
 * main's counts catch up. Only what a page action changes: the stage and the reject reason. The
 * address and the archive date come from main. Keeps the item itself when nothing differs.
 */
function overlay<T extends CatalogItem>(item: T, creator: Creator | undefined): T {
  if (
    creator === undefined ||
    (creator.stage === item.stage && creator.rejectReason === item.rejectReason)
  ) {
    return item;
  }
  return { ...item, stage: creator.stage, rejectReason: creator.rejectReason };
}

/** How many items of earlier answers are kept so Undo can bring one back before the next rebuild. */
const keptMax = 200;

function byId(creators: readonly Creator[]): Map<string, Creator> {
  return new Map(creators.map((c) => [c.id, c]));
}

/** A page of the catalog as the hook keeps it. */
interface Shown extends QueryResult {
  readonly filter: FindFilter;
  /**
   * Items seen in earlier answers of this same request that this one no longer holds. A rebuild may
   * drop a shortlisted channel from main's answer; Undo then puts it back from here (at most
   * `keptMax`). Cleared when the request changes.
   */
  readonly earlier: readonly QueryItem[];
}

/** Adds an answer's items to what earlier answers showed; returns the ones this answer lacks. */
function remember(
  before: { key: string; items: Map<string, QueryItem> },
  key: string,
  items: readonly QueryItem[],
): { seen: { key: string; items: Map<string, QueryItem> }; earlier: QueryItem[] } {
  const kept = before.key === key ? new Map(before.items) : new Map<string, QueryItem>();
  const now = new Set(items.map((i) => i.id));
  const earlier = [...kept.values()].filter((i) => !now.has(i.id));
  for (const item of items) {
    kept.delete(item.id);
    kept.set(item.id, item);
  }
  while (kept.size > keptMax) {
    const oldest = kept.keys().next();
    if (oldest.done === true) break;
    kept.delete(oldest.value);
  }
  return { seen: { key, items: kept }, earlier };
}

/** What an answer remembers: the request it answers, and how it went. */
interface Answer<T> {
  readonly key: string;
  readonly value: T | null;
}

/**
 * One page of the catalog, with the page's own creator state laid over it. Asks again when
 * `find:catalog` arrives; an answer older than one already shown is dropped. Items that no longer
 * pass the filter once overlaid (a shortlisted channel in Review new) leave the page at once.
 */
export function useCatalogQuery(params: QueryParams): {
  readonly status: CatalogLoad;
  readonly total: number;
  readonly items: readonly QueryItem[];
  readonly facets: QueryResult["facets"] | null;
  readonly version: number;
} {
  const key = JSON.stringify(params);
  const tick = useCatalogTick();
  const [answer, setAnswer] = useState<Answer<Shown>>({
    key: "",
    value: null,
  });
  const newest = useRef(-1);
  // Items seen in earlier answers of this same request, by id (see `Shown.earlier`).
  const seen = useRef<{ key: string; items: Map<string, QueryItem> }>({
    key: "",
    items: new Map(),
  });
  useEffect(() => {
    let stopped = false;
    const request = JSON.parse(key) as QueryParams;
    const done = (value: Shown | null): void => {
      if (!stopped) {
        setAnswer({ key, value });
      }
    };
    window.gratovo.invoke("find:query", request).then(
      (result) => {
        if (!result.ok) {
          done(null);
        } else if (result.value.version >= newest.current) {
          newest.current = result.value.version;
          const remembered = remember(seen.current, key, result.value.items);
          seen.current = remembered.seen;
          done({ ...result.value, filter: request.filter, earlier: remembered.earlier });
        }
      },
      () => {
        done(null);
      },
    );
    return () => {
      stopped = true;
    };
  }, [key, tick]);
  const creators = useApp((s) => s.data.creators);
  const sort = params.sort;
  const shown = useMemo(() => {
    const value = answer.key === key ? answer.value : null;
    if (value === null) {
      return null;
    }
    const mine = byId(creators);
    const items = value.items
      .map((item) => overlay(item, mine.get(item.id)))
      .filter((item) => passes(item, value.filter));
    // Items that left main's answer come back when the page's own state makes them pass again.
    const back: QueryItem[] = [];
    for (const old of value.earlier) {
      const creator = mine.get(old.id);
      if (creator !== undefined) {
        const now = overlay(old, creator);
        if (passes(now, value.filter)) {
          back.push(now);
        }
      }
    }
    const merged = back.length === 0 ? items : sortItems([...items, ...back], sort);
    return {
      value,
      items: merged as QueryItem[],
      shift: back.length - (value.items.length - items.length),
    };
  }, [answer, key, creators, sort]);
  if (shown === null) {
    return {
      status: answer.key === key ? "failed" : "loading",
      total: 0,
      items: [],
      facets: null,
      version: 0,
    };
  }
  return {
    status: "ready",
    total: Math.max(0, shown.value.total + shown.shift),
    items: shown.items,
    facets: shown.value.facets,
    version: shown.value.version,
  };
}

/** One channel's detail, with the page's creator state laid over it; asks again on `find:catalog`. */
export function useCatalogItem(id: string): {
  readonly status: CatalogLoad;
  readonly item: ItemDetail | null;
} {
  const tick = useCatalogTick();
  const [answer, setAnswer] = useState<Answer<ItemDetail>>({ key: "", value: null });
  useEffect(() => {
    let stopped = false;
    const done = (value: ItemDetail | null): void => {
      if (!stopped) {
        setAnswer({ key: id, value });
      }
    };
    window.gratovo.invoke("find:item", { id }).then(
      (result) => {
        done(result.ok ? result.value.item : null);
      },
      () => {
        done(null);
      },
    );
    return () => {
      stopped = true;
    };
  }, [id, tick]);
  const creator = useApp((s) => s.data.creators.find((c) => c.id === id));
  const item = useMemo(
    () => (answer.key === id && answer.value !== null ? overlay(answer.value, creator) : null),
    [answer, id, creator],
  );
  return {
    status: answer.key !== id ? "loading" : answer.value === null ? "failed" : "ready",
    item,
  };
}

/** The newest search runs; asks again on `find:catalog`. */
export function useRuns(): {
  readonly status: CatalogLoad;
  readonly runs: ChannelResponse<"find:runs">["runs"];
} {
  const tick = useCatalogTick();
  const [answer, setAnswer] = useState<ChannelResponse<"find:runs">["runs"] | "failed" | null>(
    null,
  );
  useEffect(() => {
    let stopped = false;
    window.gratovo.invoke("find:runs", {}).then(
      (result) => {
        if (!stopped) {
          setAnswer(result.ok ? result.value.runs : "failed");
        }
      },
      () => {
        if (!stopped) {
          setAnswer("failed");
        }
      },
    );
    return () => {
      stopped = true;
    };
  }, [tick]);
  if (answer === null) {
    return { status: "loading", runs: [] };
  }
  return answer === "failed" ? { status: "failed", runs: [] } : { status: "ready", runs: answer };
}
