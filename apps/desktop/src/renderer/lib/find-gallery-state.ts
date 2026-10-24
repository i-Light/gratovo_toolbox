import {
  emptyFacets,
  emptyFindFilter,
  passes,
  type CatalogItem,
  type Facets,
  type FindFilter,
  type FindSort,
} from "@gratovo/core/find";
import { useCallback, useState } from "react";

import { shortDate } from "./format";
import { useCatalogQuery, useRuns } from "./find-catalog";
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
export function useRunLabels(): ReadonlyMap<number, string> {
  const { runs } = useRuns();
  const now = new Date();
  return new Map(runs.map((r) => [r.id, runLabel(r.startedAt, now)]));
}

/** What the paging hook holds for one request (a filter and a sort). */
interface Loaded {
  readonly key: string;
  readonly pages: Readonly<Record<number, readonly CatalogItem[]>>;
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
  readonly loadMore: () => void;
  readonly hasMore: boolean;
}

/**
 * The gallery's channels, a page of 120 at a time (D19). The next page is added when `loadMore()`
 * is called; a different filter or sort starts again at the first page. Facets are asked for with
 * the first page only and kept while later pages load. Earlier pages take the page's own creator
 * state again, so a shortlist on page one still shows once page two is in.
 */
export function useGalleryPages(filter: FindFilter, sort: FindSort): GalleryPages {
  const resetKey = JSON.stringify([filter, sort]);
  const [paging, setPaging] = useState({ key: resetKey, cursor: 0 });
  const cursor = paging.key === resetKey ? paging.cursor : 0;
  const query = useCatalogQuery({
    filter,
    sort,
    offset: cursor,
    limit: galleryPageSize,
    facets: cursor === 0,
  });
  const [loaded, setLoaded] = useState<Loaded>({
    key: "",
    pages: {},
    facets: null,
    total: 0,
    lastCount: 0,
  });
  const { status, items: pageItems, total: pageTotal, facets: pageFacets } = query;
  // Keep each answer as it arrives (state adjusted while rendering, not in an effect, so the page
  // never shows a frame without it). The guard stops once the stored page is this very answer.
  if (
    status === "ready" &&
    (loaded.key !== resetKey || loaded.pages[cursor] !== pageItems || loaded.total !== pageTotal)
  ) {
    const same = loaded.key === resetKey;
    setLoaded({
      key: resetKey,
      pages: { ...(same ? loaded.pages : {}), [cursor]: pageItems },
      facets: cursor === 0 ? pageFacets : same ? loaded.facets : null,
      total: pageTotal,
      lastCount: pageItems.length,
    });
  }

  const creators = useApp((s) => s.data.creators);
  const current = loaded.key === resetKey;
  const items: CatalogItem[] = [];
  if (current) {
    const mine = new Map(creators.map((c) => [c.id, c]));
    const seen = new Set<string>();
    const offsets = Object.keys(loaded.pages)
      .map(Number)
      .sort((a, b) => a - b);
    for (const offset of offsets) {
      for (const item of loaded.pages[offset] ?? []) {
        const creator = mine.get(item.id);
        const now =
          creator === undefined ||
          (creator.stage === item.stage && creator.rejectReason === item.rejectReason)
            ? item
            : { ...item, stage: creator.stage, rejectReason: creator.rejectReason };
        if (!seen.has(item.id) && passes(now, filter)) {
          seen.add(item.id);
          items.push(now);
        }
      }
    }
  }

  const hasMore = current && cursor + galleryPageSize < loaded.total && loaded.lastCount > 0;
  const ready = status === "ready";
  const loadMore = useCallback((): void => {
    if (ready && hasMore) {
      setPaging({ key: resetKey, cursor: cursor + galleryPageSize });
    }
  }, [ready, hasMore, resetKey, cursor]);

  // A later page failing leaves what is loaded in place; only the first page failing is a failure.
  const shownStatus = current ? "ready" : status === "failed" ? "failed" : "loading";
  return {
    items,
    total: current ? loaded.total : 0,
    facets: (current ? loaded.facets : null) ?? emptyFacets,
    status: shownStatus,
    loadMore,
    hasMore,
  };
}
