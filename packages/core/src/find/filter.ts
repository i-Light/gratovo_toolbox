/**
 * Filtering, sorting and facet counts for the Find catalog, ported from the prototype's `passes`,
 * `SORTS` and `Facets` (plan step 5, D2). Pure: main feeds it rows, the page never sees them all.
 */

import { creatorStages, type CreatorStage } from "../data/types";
import { fitOf, fitScore, isGold } from "./fit";
import {
  emptyFacets,
  findSignals,
  type CatalogItem,
  type Facets,
  type FindFilter,
  type FindSort,
  type Fit,
  type Signal,
} from "./types";

/** Which facet to leave out, so its own counts show what picking another value would give. */
export type FilterSkip = "stages" | "signals" | "countries" | "median" | "uploads" | "runs";

/** Stages from which a creator has already been mailed or worked past that. */
const pastEmail: readonly CreatorStage[] = ["emailed", "replied", "kit", "audience", "signed"];

export function hasSignal(item: CatalogItem, signal: Signal): boolean {
  switch (signal) {
    case "gold":
      return isGold(item);
    case "sponsored":
      return item.sponsors.length > 0;
    case "email":
      return item.email !== null || item.foundEmails > 0;
    case "confirmed":
      return item.emailConfirmed;
    case "fresh":
      return item.emailedBefore === null && !pastEmail.includes(item.stage);
  }
}

function searchText(item: CatalogItem): string {
  return [
    item.name,
    item.handle,
    ...item.videos.map((video) => video.title),
    ...item.sponsors,
    item.email ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

export function passes(item: CatalogItem, filter: FindFilter, skip?: FilterSkip): boolean {
  if (skip !== "stages") {
    if (filter.stages.length > 0) {
      if (!filter.stages.includes(item.stage)) return false;
    } else if (item.stage === "rejected" || item.stage === "never") {
      return false;
    }
  }
  if (skip !== "signals" && filter.signals.some((signal) => !hasSignal(item, signal))) return false;
  if (
    skip !== "countries" &&
    filter.countries.length > 0 &&
    (item.country === null || !filter.countries.includes(item.country))
  ) {
    return false;
  }
  if (skip !== "median") {
    if (item.medianViews < filter.minMedian) return false;
    if (filter.maxMedian !== null && item.medianViews > filter.maxMedian) return false;
  }
  if (skip !== "uploads" && item.uploads30 < filter.minUploads) return false;
  if (skip !== "runs" && filter.runs.length > 0) {
    if (item.run === null || !filter.runs.includes(item.run)) return false;
  }
  const q = filter.q.trim().toLowerCase();
  if (q !== "" && !searchText(item).includes(q)) return false;
  return true;
}

/** Larger first; a missing value goes last. */
function desc(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

/** A sorted copy. Ties keep the input order, then fall back to the id. */
export function sortItems(items: readonly CatalogItem[], sort: FindSort): CatalogItem[] {
  const keyed = items.map((item, index) => ({
    item,
    index,
    fit: sort === "fit" || sort === "triage" ? fitScore(item) : 0,
    gold: sort === "triage" ? isGold(item) : false,
  }));
  keyed.sort((a, b) => {
    let order = 0;
    switch (sort) {
      case "fit":
        order = b.fit - a.fit;
        break;
      case "median":
        order = b.item.medianViews - a.item.medianViews;
        break;
      case "subs":
        order = desc(a.item.subscribers, b.item.subscribers);
        break;
      case "found":
        order = desc(a.item.foundAt, b.item.foundAt);
        break;
      case "latest":
        order = desc(a.item.latestUploadAt, b.item.latestUploadAt);
        break;
      case "triage":
        order = Number(b.gold) - Number(a.gold) || b.fit - a.fit;
        break;
    }
    if (order !== 0) return order;
    if (a.index !== b.index) return a.index - b.index;
    return a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0;
  });
  return keyed.map((entry) => entry.item);
}

/** For each option, how many items would show if the rest of the filter stayed as it is. */
export function facetCounts(items: readonly CatalogItem[], filter: FindFilter): Facets {
  const stages = Object.fromEntries(creatorStages.map((stage) => [stage, 0])) as Record<
    CreatorStage,
    number
  >;
  const signals = Object.fromEntries(findSignals.map((signal) => [signal, 0])) as Record<
    Signal,
    number
  >;
  const countries: Record<string, number> = {};
  const runs: Record<string, number> = {};

  // Every country and run seen gets a key, even when the other facets leave it at zero.
  for (const item of items) {
    if (item.country !== null) countries[item.country] ??= 0;
    if (item.run !== null) runs[String(item.run)] ??= 0;
  }

  for (const item of items) {
    if (passes(item, filter, "stages")) stages[item.stage] += 1;
    if (passes(item, filter, "signals")) {
      for (const signal of findSignals) {
        const rest = filter.signals.filter((other) => other !== signal);
        if (rest.every((other) => hasSignal(item, other)) && hasSignal(item, signal)) {
          signals[signal] += 1;
        }
      }
    }
    if (item.country !== null && passes(item, filter, "countries")) {
      countries[item.country] = (countries[item.country] ?? 0) + 1;
    }
    if (item.run !== null && passes(item, filter, "runs")) {
      const key = String(item.run);
      runs[key] = (runs[key] ?? 0) + 1;
    }
  }
  return { stages, signals, countries, runs };
}

export interface CatalogPage {
  readonly total: number;
  readonly items: readonly (CatalogItem & { readonly fit: Fit })[];
  readonly facets: Facets;
}

/** What else a query works out. `facets` false skips the counts and answers all zeros. */
export interface QueryOptions {
  readonly facets?: boolean;
}

/**
 * Filter, sort and slice; the fit is worked out only for the page that is returned. The facet
 * counts are the costly part, so a page that doesn't show them can ask for none.
 */
export function queryCatalog(
  items: readonly CatalogItem[],
  filter: FindFilter,
  sort: FindSort,
  offset: number,
  limit: number,
  options: QueryOptions = {},
): CatalogPage {
  const shown = sortItems(
    items.filter((item) => passes(item, filter)),
    sort,
  );
  return {
    total: shown.length,
    items: shown.slice(offset, offset + limit).map((item) => ({ ...item, fit: fitOf(item) })),
    facets: options.facets === false ? emptyFacets : facetCounts(items, filter),
  };
}
