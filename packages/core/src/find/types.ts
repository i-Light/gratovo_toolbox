/**
 * The Find catalog's shapes: one row per channel the pipeline found or the team works on, the fit
 * score, and the filter, sort and facet counts the page asks main for (plan step 5, D1 and D2).
 * Pure types and constants, exported as `@gratovo/core/find` so main and the page share them.
 */

import { creatorStages, type CreatorStage, type RejectReason } from "../data/types";

/** One of a channel's videos. */
export interface CatalogVideo {
  readonly id: string;
  readonly title: string;
  /** Null when YouTube hid the count or the store has none. */
  readonly views: number | null;
  /** In ms. */
  readonly publishedAt: number | null;
  /** A picture key, `v:<videoId>`; main turns it into an image (D9). */
  readonly pic: string | null;
}

/** One channel in the catalog: the pipeline's numbers joined to the team's creator state. */
export interface CatalogItem {
  readonly id: string;
  readonly name: string;
  readonly handle: string;
  /** A picture key, `c:<channelId>`. */
  readonly pic: string | null;
  readonly stage: CreatorStage;
  readonly emailConfirmed: boolean;
  readonly email: string | null;
  /** Null when the channel hides its count. */
  readonly subscribers: number | null;
  readonly medianViews: number;
  /** Uploads in the last 30 days. */
  readonly uploads30: number;
  /** ISO-2, the channel's own country. */
  readonly country: string | null;
  readonly sponsors: readonly string[];
  /** How many addresses the email finder found. */
  readonly foundEmails: number;
  /** In ms. */
  readonly latestUploadAt: number | null;
  /** In ms: when a search first found it. */
  readonly foundAt: number | null;
  /** The search run whose window holds `foundAt` (D10). */
  readonly run: number | null;
  /** The keyword that found it. */
  readonly keyword: string | null;
  /** The newest 3. */
  readonly videos: readonly CatalogVideo[];
  /** `manual_engagement_rate`; YouTube gives no engagement figure (D8). */
  readonly engagement: number | null;
  /** Set when someone emailed the creator before (D12), with who and when if known. */
  readonly emailedBefore: { readonly at: number | null; readonly who: string | null } | null;
  readonly rejectReason: RejectReason | null;
  /** In ms. */
  readonly archiveDueAt: number | null;
  /** False for a creator the team works on that has no pipeline channel on this computer. */
  readonly hasNumbers: boolean;
}

/** The parts of the fit score, each with its points out of its share. */
export interface FitPart {
  readonly key: "median" | "posting" | "audience" | "engagement" | "sponsored";
  readonly points: number;
  readonly of: number;
  /** Why it scored what it did, in plain words. */
  readonly note: string;
}

/** A channel's fit, 0 to 100, with the reasons. */
export interface Fit {
  readonly score: number;
  readonly parts: readonly FitPart[];
}

/** The signals a channel can show, in facet order. */
export const findSignals = ["gold", "sponsored", "email", "confirmed", "fresh"] as const;

export type Signal = (typeof findSignals)[number];

/** What the gallery and Review new filter by. An empty list means "any". */
export interface FindFilter {
  readonly stages: readonly CreatorStage[];
  readonly signals: readonly Signal[];
  readonly countries: readonly string[];
  readonly minMedian: number;
  /** Null means no upper bound. */
  readonly maxMedian: number | null;
  readonly minUploads: number;
  readonly runs: readonly number[];
  /** Free text, matched against the name, the handle and the keyword. */
  readonly q: string;
}

/** The filter that lets everything through its own fields (the stage defaults still apply). */
export const emptyFindFilter: FindFilter = {
  stages: [],
  signals: [],
  countries: [],
  minMedian: 0,
  maxMedian: null,
  minUploads: 0,
  runs: [],
  q: "",
};

/** A filter the person saved under a name, per data source (D16, D20). */
export interface SavedView {
  /** Trimmed, 1 to `viewNameMax` characters. */
  readonly name: string;
  readonly filter: FindFilter;
}

/** The most saved views a data source keeps. */
export const savedViewsMax = 20;
/** The longest saved view name. */
export const viewNameMax = 60;

/** The orders the catalog can be sorted in. `triage` is gold mines first, then fit. */
export const findSorts = ["fit", "median", "subs", "found", "latest", "triage"] as const;

export type FindSort = (typeof findSorts)[number];

/** How many items each facet value would show, given the rest of the filter. */
export interface Facets {
  readonly stages: Readonly<Record<CreatorStage, number>>;
  readonly signals: Readonly<Record<Signal, number>>;
  readonly countries: Readonly<Record<string, number>>;
  /** Keyed by the run id, as text. */
  readonly runs: Readonly<Record<string, number>>;
}

/** Facets with every count at zero: what an empty catalog answers. */
export const emptyFacets: Facets = {
  stages: Object.fromEntries(creatorStages.map((stage) => [stage, 0])) as Record<
    CreatorStage,
    number
  >,
  signals: Object.fromEntries(findSignals.map((signal) => [signal, 0])) as Record<Signal, number>,
  countries: {},
  runs: {},
};
