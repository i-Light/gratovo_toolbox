/**
 * Channel facts worked out from a channel's video views and medians (plan step P1, decision F5).
 * Pure: nothing here is stored.
 */

import type { ViewStability } from "./types";

/** How many of the newest known counts the facts read. */
const newestMax = 12;
/** Fewest known counts a fact needs. */
const knownMin = 3;
/** With this many known counts the highest and lowest are dropped from the average. */
const trimFrom = 5;

/** The newest `newestMax` known counts (the list is newest first), or null under `knownMin`. */
function newestKnown(views: readonly (number | null)[]): number[] | null {
  const known: number[] = [];
  for (const view of views) {
    if (view !== null) {
      known.push(view);
      if (known.length === newestMax) {
        break;
      }
    }
  }
  return known.length < knownMin ? null : known;
}

/** The mean of the newest 12 known counts, without the highest and lowest from 5 on; rounded. */
export function trimmedAverage(views: readonly (number | null)[]): number | null {
  const known = newestKnown(views);
  if (known === null) {
    return null;
  }
  const kept = known.length >= trimFrom ? [...known].sort((a, b) => a - b).slice(1, -1) : known;
  return Math.round(kept.reduce((sum, view) => sum + view, 0) / kept.length);
}

/** Volatile when the standard deviation of the newest 12 known counts is over half their mean. */
export function viewStability(views: readonly (number | null)[]): ViewStability | null {
  const known = newestKnown(views);
  if (known === null) {
    return null;
  }
  const mean = known.reduce((sum, view) => sum + view, 0) / known.length;
  const variance = known.reduce((sum, view) => sum + (view - mean) ** 2, 0) / known.length;
  return Math.sqrt(variance) > mean / 2 ? "volatile" : "stable";
}

/** One to five stars from a channel's median views, engagement (percent) and uploads in 30 days. */
export function starRating(facts: {
  readonly medianViews: number;
  readonly engagement: number | null;
  readonly uploads30: number;
}): 1 | 2 | 3 | 4 | 5 {
  const { medianViews, engagement, uploads30 } = facts;
  if (
    medianViews >= 60000 &&
    engagement !== null &&
    engagement >= 4.5 &&
    uploads30 >= 3 &&
    uploads30 <= 12
  ) {
    return 5;
  }
  if (medianViews >= 45000 && uploads30 >= 3) {
    return 4;
  }
  return medianViews >= 30000 ? 3 : 2;
}
