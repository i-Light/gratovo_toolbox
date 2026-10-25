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
/** Sponsors named in the note; the rest are counted. */
const sponsorsNamed = 3;
/** The longest a note gets, well inside the page's 500-character bound, whatever the data holds. */
const noteMax = 200;

function capped(note: string): string {
  return note.length > noteMax ? note.slice(0, noteMax) : note;
}

/**
 * True for a pipeline channel whose uploads were never read (deferred, restored, failed): the page
 * says "not read yet" and never shows a made-up 0 (D45). A state-only row has no numbers at all.
 */
export function uploadsUnread(item: CatalogItem): boolean {
  return item.hasNumbers && !item.uploadsRead;
}

function medianPoints(item: CatalogItem): number {
  return item.hasNumbers && item.uploadsRead
    ? Math.round(Math.min(1, item.medianViews / 90000) * medianShare)
    : 0;
}

function postingPoints(uploads30: number): number {
  if (uploads30 > 20) return 6;
  if (uploads30 >= 4) return 15;
  if (uploads30 === 3) return 10;
  if (uploads30 >= 1) return 4;
  return 0;
}

function audiencePoints(country: string | null): number {
  return country !== null && homeCountries.includes(country) ? audienceShare : 0;
}

function engagementPoints(engagement: number | null): number {
  return engagement === null ? 0 : Math.round(Math.min(1, engagement / 6) * engagementShare);
}

function sponsoredPoints(sponsors: readonly string[]): number {
  return sponsors.length > 0 ? sponsoredShare : 0;
}

function sponsorsNote(sponsors: readonly string[]): string {
  if (sponsors.length === 0) return fitWords.sponsorsNone;
  return fitWords.sponsors(
    // Each name is shortened, so three long names still leave room for "+N more" under the cap.
    sponsors
      .slice(0, sponsorsNamed)
      .map((name) => (name.length > 40 ? `${name.slice(0, 39)}…` : name)),
    Math.max(0, sponsors.length - sponsorsNamed),
  );
}

function audiencePart(country: string | null): FitPart {
  if (country === null) {
    return { key: "audience", points: 0, of: audienceShare, note: fitWords.audienceUnknown };
  }
  const home = homeCountries.includes(country);
  return {
    key: "audience",
    points: audiencePoints(country),
    of: audienceShare,
    note: home ? fitWords.audienceHome(country) : fitWords.audienceAway(country),
  };
}

/** Five parts, each with the reason for its points, so the score is never a black box. */
export function fitOf(item: CatalogItem): Fit {
  const numbers = item.hasNumbers && item.uploadsRead;
  const noteFor = (read: string): string => {
    if (!item.hasNumbers) return fitWords.noNumbers;
    return item.uploadsRead ? read : fitWords.uploadsUnread;
  };
  const parts: FitPart[] = [
    {
      key: "median",
      points: medianPoints(item),
      of: medianShare,
      note: noteFor(fitWords.perVideo(item.medianViews)),
    },
    {
      key: "posting",
      points: numbers ? postingPoints(item.uploads30) : 0,
      of: postingShare,
      note: noteFor(fitWords.uploads(item.uploads30, item.uploads30 > 20)),
    },
    audiencePart(item.country),
    {
      key: "engagement",
      points: engagementPoints(item.engagement),
      of: engagementShare,
      note:
        item.engagement === null
          ? fitWords.engagementUnknown
          : fitWords.engagement(item.engagement),
    },
    {
      key: "sponsored",
      points: sponsoredPoints(item.sponsors),
      of: sponsoredShare,
      note: sponsorsNote(item.sponsors),
    },
  ];
  return {
    score: parts.reduce((sum, part) => sum + part.points, 0),
    parts: parts.map((part) => ({ ...part, note: capped(part.note) })),
  };
}

/** The same total as `fitOf(item).score`, without building the notes: sorting needs only this. */
export function fitScore(item: CatalogItem): number {
  return (
    medianPoints(item) +
    (item.hasNumbers && item.uploadsRead ? postingPoints(item.uploads30) : 0) +
    audiencePoints(item.country) +
    engagementPoints(item.engagement) +
    sponsoredPoints(item.sponsors)
  );
}

/** A gold mine: views at least 40% of subscribers, 3 to 20 uploads a month, 40K+ views. */
export function isGold(item: CatalogItem): boolean {
  if (item.subscribers === null || !item.uploadsRead) return false;
  return (
    item.medianViews >= 40000 &&
    item.medianViews / Math.max(item.subscribers, 1) >= 0.4 &&
    item.uploads30 >= 3 &&
    item.uploads30 <= 20
  );
}
