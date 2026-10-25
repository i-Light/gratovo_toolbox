/**
 * The English words the fit notes are built from, in one place so other languages can come later.
 * Pure: no I/O. (The page's own words live in the renderer's `strings.ts`.)
 */

function trimZero(text: string): string {
  return text.replace(/\.0$/, "");
}

/** 41000 -> "41K", 1250000 -> "1.3M", 950 -> "950". Like the prototype's `fmtK`. */
export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${trimZero((n / 1_000_000).toFixed(1))}M`;
  if (n >= 1_000) return `${trimZero((n / 1_000).toFixed(n >= 10_000 ? 0 : 1))}K`;
  return String(Math.round(n));
}

export const fitWords = {
  noNumbers: "No numbers yet",
  uploadsUnread: "Uploads not read yet",
  perVideo: (median: number) => `${formatCount(median)} per video`,
  uploads: (count: number, mostlyShorts: boolean) =>
    `${String(count)} ${count === 1 ? "upload" : "uploads"} in 30 days${mostlyShorts ? " (mostly Shorts)" : ""}`,
  audienceHome: (country: string) =>
    `Channel country: ${country}. The audience split comes with the media kit`,
  audienceAway: (country: string) =>
    `Channel country: ${country}, outside the US, UK, CA and AU. The audience split comes with the media kit`,
  audienceUnknown: "Channel country not known yet",
  engagement: (rate: number) => `${String(rate)}%`,
  engagementUnknown: "Not known yet",
  sponsorsNone: "No sponsors seen",
  /** The first few sponsors by name, and how many more there are. */
  sponsors: (named: readonly string[], more: number) =>
    `${named.join(", ")}${more > 0 ? ` +${String(more)} more` : ""}`,
} as const;
