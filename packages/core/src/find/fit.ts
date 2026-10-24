/**
 * The fit score and the gold-mine test, ported from the prototype's `W.fit` and `W.gold` (plan
 * step 5, D8). Pure. YouTube gives no audience split or engagement figure, so audience scores the
 * channel's own country and engagement uses the figure someone typed in.
 */

import type { CatalogItem, Fit, FitPart } from "./types";
import { fitWords } from "./words";

/** Countries whose channels score the audience points. */
const homeCountries: readonly string[] = ["US", "GB", "CA", "AU"];

const medianShare = 30;
const postingShare = 15;
const audienceShare = 25;
const engagementShare = 15;
const sponsoredShare = 15;

function postingPoints(uploads30: number): number {
  if (uploads30 > 20) return 6;
  if (uploads30 >= 4) return 15;
  if (uploads30 === 3) return 10;
  if (uploads30 >= 1) return 4;
  return 0;
}

function audiencePart(country: string | null): FitPart {
  if (country === null) {
    return { key: "audience", points: 0, of: audienceShare, note: fitWords.audienceUnknown };
  }
  const home = homeCountries.includes(country);
  return {
    key: "audience",
    points: home ? audienceShare : 0,
    of: audienceShare,
    note: home ? fitWords.audienceHome(country) : fitWords.audienceAway(country),
  };
}

/** Five parts, each with the reason for its points, so the score is never a black box. */
export function fitOf(item: CatalogItem): Fit {
  const numbers = item.hasNumbers;
  const parts: FitPart[] = [
    {
      key: "median",
      points: numbers ? Math.round(Math.min(1, item.medianViews / 90000) * medianShare) : 0,
      of: medianShare,
      note: numbers ? fitWords.perVideo(item.medianViews) : fitWords.noNumbers,
    },
    {
      key: "posting",
      points: numbers ? postingPoints(item.uploads30) : 0,
      of: postingShare,
      note: numbers ? fitWords.uploads(item.uploads30, item.uploads30 > 20) : fitWords.noNumbers,
    },
    audiencePart(item.country),
    {
      key: "engagement",
      points:
        item.engagement === null
          ? 0
          : Math.round(Math.min(1, item.engagement / 6) * engagementShare),
      of: engagementShare,
      note:
        item.engagement === null
          ? fitWords.engagementUnknown
          : fitWords.engagement(item.engagement),
    },
    {
      key: "sponsored",
      points: item.sponsors.length > 0 ? sponsoredShare : 0,
      of: sponsoredShare,
      note: item.sponsors.length > 0 ? item.sponsors.join(", ") : fitWords.sponsorsNone,
    },
  ];
  return { score: parts.reduce((sum, part) => sum + part.points, 0), parts };
}

/** A gold mine: views at least 40% of subscribers, 3 to 20 uploads a month, 40K+ views. */
export function isGold(item: CatalogItem): boolean {
  if (item.subscribers === null) return false;
  return (
    item.medianViews >= 40000 &&
    item.medianViews / Math.max(item.subscribers, 1) >= 0.4 &&
    item.uploads30 >= 3 &&
    item.uploads30 <= 20
  );
}
