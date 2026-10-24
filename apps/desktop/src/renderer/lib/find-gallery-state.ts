import {
  emptyFacets,
  emptyFindFilter,
  passes,
  type CatalogItem,
  type Facets,
  type FindFilter,
  type FindSort,
} from "@gratovo/core/find";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { shortDate } from "./format";
import { useCatalogQuery } from "./find-catalog";
import { getPrefs, setPref, usePref, type Prefs } from "./prefs";
import { useApp } from "./store";
import { strings } from "../strings";

/** How many channels the gallery asks for at a time (D19). Main refuses more than this. */
export const galleryPageSize = 120;

/** The orders the gallery's Sort offers (`triage` belongs to Review new). */
export type GallerySort = Prefs["findSort"];
export const gallerySorts: readonly GallerySort[] = ["fit", "median", "subs", "found", "latest"];
export type GalleryView = Prefs["findView"];
export type GallerySize = Prefs["findSize"];
export type ShowToggle = "pics" | "latest" | "signals";

/** The three show toggles, as the results read them. */
export interface GalleryShow {
  readonly pics: boolean;
  readonly latest: boolean;
  readonly signals: boolean;
}

const showKeys = {
  pics: "findPics",
  latest: "findLatest",
  signals: "findSignals",
} as const;

/* The filter, sort, view, size and show toggles are device prefs (D20); `prefs.ts` checks each one
   when it reads them, so a bad stored value is the default here. */

/** The gallery's filter. */
export function useGalleryFilter(): FindFilter {
  return usePref("findFilter");
}
export function useGallerySort(): GallerySort {
  return usePref("findSort");
}
export function useGalleryView(): GalleryView {
  return usePref("findView");
}
export function useGallerySize(): GallerySize {
  return usePref("findSize");
}
export function useGalleryShow(): GalleryShow {
  const pics = usePref("findPics");
  const latest = usePref("findLatest");
  const signals = usePref("findSignals");
  return { pics, latest, signals };
}

export function setGalleryFilter(filter: FindFilter): void {
  setPref("findFilter", filter);
}
/** Changes some fields of the filter and keeps the rest. */
export function patchGalleryFilter(patch: Partial<FindFilter>): void {
  setPref("findFilter", { ...getPrefs().findFilter, ...patch });
}
/** Back to no filter at all. */
export function clearFilter(): void {
  setPref("findFilter", emptyFindFilter);
}
export function setGallerySort(sort: GallerySort): void {
  setPref("findSort", sort);
}
export function setGalleryView(view: GalleryView): void {
  setPref("findView", view);
}
export function setGallerySize(size: GallerySize): void {
  setPref("findSize", size);
}
export function setGalleryShow(toggle: ShowToggle, on: boolean): void {
  setPref(showKeys[toggle], on);
}

/** The list with the value added, or taken out when it is already there. */
export function toggleIn<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

/** True when any field narrows the list. */
export function filterIsActive(f: FindFilter): boolean {
  return (
    f.stages.length > 0 ||
    f.signals.length > 0 ||
    f.countries.length > 0 ||
    f.minMedian > 0 ||
    f.maxMedian !== null ||
    f.minUploads > 0 ||
    f.runs.length > 0 ||
    f.q !== ""
  );
}

/** A search run as people name it: "Today's search" for today's, else its date. */
export function runLabel(startedAt: number, now: Date = new Date()): string {
  return new Date(startedAt).toDateString() === now.toDateString()
    ? strings.findGallery.facets.todaysSearch
    : shortDate(startedAt);
}

/** Run labels by run id, from the newest runs main lists. */
export function runLabels(
  runs: readonly { readonly id: number; readonly startedAt: number }[],
  now: Date = new Date(),
): ReadonlyMap<number, string> {
  return new Map(runs.map((r) => [r.id, runLabel(r.startedAt, now)]));
}

/** What the paging hook holds for one request (a filter and a sort). */
interface Loaded {
  readonly key: string;
  /** The filter the pages were asked with (the shown list keeps it while a new request loads). */
  readonly filter: FindFilter;
  readonly pages: Readonly<Record<number, readonly CatalogItem[]>>;
  /** The catalog version each stored page came from; a newer one means a rebuild (D19). */
  readonly versions: Readonly<Record<number, number>>;
  readonly facets: Facets | null;
  readonly total: number;
  /** How many items the last page held; fewer than a full page means the end. */
  readonly lastCount: number;
}

export interface GalleryPages {
  readonly items: readonly CatalogItem[];
  readonly total: number;
  readonly facets: Facets;
  readonly status: "loading" | "ready" | "failed";
  /** True while a new filter loads and the last items are still shown. */
  readonly busy: boolean;
  readonly loadMore: () => void;
  readonly hasMore: boolean;
  /** The last "Show more" failed; calling `loadMore()` tries again. */
  readonly moreFailed: boolean;
}

const noLoaded: Loaded = {
  key: "",
  filter: emptyFindFilter,
  pages: {},
  versions: {},
  facets: null,
  total: 0,
  lastCount: 0,
};

/** The overlays made so far, by the catalog item they sit on (gone with the item). */
const overlays = new WeakMap<CatalogItem, CatalogItem>();

/**
 * The item with the page's own stage and reject reason over it. The same item and state give the
 * same object back, so a memoised card does not redraw when only other creators changed.
 */
function overlay(
  item: CatalogItem,
  stage: CatalogItem["stage"],
  reason: CatalogItem["rejectReason"],
): CatalogItem {
  const hit = overlays.get(item);
  if (hit !== undefined && hit.stage === stage && hit.rejectReason === reason) {
    return hit;
  }
  const out = { ...item, stage, rejectReason: reason };
  overlays.set(item, out);
  return out;
}

/**
 * The gallery's channels, a page of 120 at a time (D19). The first page comes from the catalog
 * query (which follows rebuilds); `loadMore()` asks for the next one. A different filter or sort
 * starts again at the first page, and the last items stay on screen (`busy`) until it answers.
 * Facets come with the first page only. Earlier pages take the page's own creator state again, so a
 * shortlist on page one still shows once page two is in. When a rebuild brings a newer catalog,
 * pages 0 to the last are asked again in order and swapped in together, so a channel that moved
 * across a page edge is neither lost nor shown twice.
 */
export function useGalleryPages(filter: FindFilter, sort: FindSort): GalleryPages {
  const resetKey = JSON.stringify([filter, sort]);
  const [paging, setPaging] = useState({ key: resetKey, cursor: 0 });
  const cursor = paging.key === resetKey ? paging.cursor : 0;
  const query = useCatalogQuery({
    filter,
    sort,
    offset: 0,
    limit: galleryPageSize,
    facets: true,
  });
  const [loaded, setLoaded] = useState<Loaded>(noLoaded);
  const [more, setMore] = useState<{ key: string; state: "idle" | "loading" | "failed" }>({
    key: "",
    state: "idle",
  });
  const keyRef = useRef(resetKey);
  const fetching = useRef(false);
  useLayoutEffect(() => {
    keyRef.current = resetKey;
  });
  const {
    status,
    items: pageItems,
    total: pageTotal,
    facets: pageFacets,
    version: pageVersion,
  } = query;
  const sameKey = loaded.key === resetKey;
  // A page other than the first that came from an older catalog than the first page's answer.
  const stale =
    sameKey &&
    status === "ready" &&
    Object.entries(loaded.versions).some(([o, v]) => Number(o) !== 0 && v < pageVersion);
  // Keep each first-page answer as it arrives (state adjusted while rendering, not in an effect, so
  // the page never shows a frame without it). Held back while later pages are being asked again,
  // and when it is older than what is stored.
  if (
    status === "ready" &&
    !stale &&
    (!sameKey ||
      ((loaded.pages[0] !== pageItems || loaded.total !== pageTotal) &&
        pageVersion >= (loaded.versions[0] ?? 0)))
  ) {
    setLoaded({
      key: resetKey,
      filter,
      pages: { ...(sameKey ? loaded.pages : {}), 0: pageItems },
      versions: { ...(sameKey ? loaded.versions : {}), 0: pageVersion },
      facets: pageFacets,
      total: pageTotal,
      lastCount: cursor === 0 || !sameKey ? pageItems.length : loaded.lastCount,
    });
  }

  // A rebuild came while later pages were loaded: ask for pages 0..cursor again, in order, and
  // swap them all in once they are in. The old list stays on screen meanwhile.
  const staleTo = stale ? pageVersion : null;
  useEffect(() => {
    if (staleTo === null) {
      return undefined;
    }
    const run = { stopped: false };
    const [f, s] = JSON.parse(resetKey) as [FindFilter, FindSort];
    void (async () => {
      const pages: Record<number, readonly CatalogItem[]> = {};
      const versions: Record<number, number> = {};
      let facets: Facets | null = null;
      let total = 0;
      let lastCount = 0;
      for (let offset = 0; offset <= cursor; offset += galleryPageSize) {
        const result = await window.gratovo
          .invoke("find:query", {
            filter: f,
            sort: s,
            offset,
            limit: galleryPageSize,
            facets: offset === 0,
          })
          .catch(() => null);
        if (run.stopped || result === null || !result.ok) {
          return;
        }
        pages[offset] = result.value.items;
        versions[offset] = result.value.version;
        if (offset === 0) {
          facets = result.value.facets;
        }
        total = result.value.total;
        lastCount = result.value.items.length;
      }
      setLoaded({ key: resetKey, filter: f, pages, versions, facets, total, lastCount });
    })();
    return () => {
      run.stopped = true;
    };
  }, [staleTo, cursor, resetKey]);

  const creators = useApp((s) => s.data.creators);
  // An item keeps its object while its overlay did not change, so memoised cards don't redraw.
  const shown = useMemo(() => {
    const mine = new Map(creators.map((c) => [c.id, c]));
    const items: CatalogItem[] = [];
    const seen = new Set<string>();
    const offsets = Object.keys(loaded.pages)
      .map(Number)
      .sort((a, b) => a - b);
    for (const offset of offsets) {
      for (const item of loaded.pages[offset] ?? []) {
        if (seen.has(item.id)) {
          continue;
        }
        const creator = mine.get(item.id);
        const stage = creator?.stage ?? item.stage;
        const reason = creator === undefined ? item.rejectReason : creator.rejectReason;
        let now = item;
        if (stage !== item.stage || reason !== item.rejectReason) {
          now = overlay(item, stage, reason);
        }
        if (passes(now, loaded.filter)) {
          seen.add(item.id);
          items.push(now);
        }
      }
    }
    return items;
  }, [loaded, creators]);

  const hasMore = sameKey && cursor + galleryPageSize < loaded.total && loaded.lastCount > 0;
  const ready = sameKey && status === "ready";
  const moreState = more.key === resetKey ? more.state : "idle";
  const loadMore = useCallback((): void => {
    if (!ready || !hasMore || fetching.current) {
      return;
    }
    fetching.current = true;
    const key = resetKey;
    const offset = cursor + galleryPageSize;
    setMore({ key, state: "loading" });
    const [f, s] = JSON.parse(key) as [FindFilter, FindSort];
    const fail = (): void => {
      fetching.current = false;
      if (keyRef.current === key) {
        setMore({ key, state: "failed" });
      }
    };
    window.gratovo
      .invoke("find:query", { filter: f, sort: s, offset, limit: galleryPageSize, facets: false })
      .then((result) => {
        if (!result.ok) {
          fail();
          return;
        }
        fetching.current = false;
        if (keyRef.current !== key) {
          return;
        }
        setMore({ key, state: "idle" });
        setPaging({ key, cursor: offset });
        setLoaded((cur) =>
          cur.key !== key
            ? cur
            : {
                ...cur,
                pages: { ...cur.pages, [offset]: result.value.items },
                versions: { ...cur.versions, [offset]: result.value.version },
                total: result.value.total,
                lastCount: result.value.items.length,
              },
        );
      }, fail);
  }, [ready, hasMore, resetKey, cursor]);

  // A later page failing leaves what is loaded in place; only the first page failing is a failure.
  // While a new request loads, the last items stay (busy); only the very first load is "loading".
  const shownStatus = sameKey
    ? "ready"
    : status === "failed"
      ? "failed"
      : loaded.key === ""
        ? "loading"
        : "ready";
  return useMemo(
    () => ({
      items: shown,
      total: loaded.total,
      facets: loaded.facets ?? emptyFacets,
      status: shownStatus,
      busy: !sameKey && shownStatus === "ready",
      loadMore,
      hasMore,
      moreFailed: moreState === "failed",
    }),
    [shown, loaded.total, loaded.facets, shownStatus, sameKey, loadMore, hasMore, moreState],
  );
}
