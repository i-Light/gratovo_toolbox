import type { FoundEmail } from "./types";

/** How sure we are of a found address (D28), and the order the finder lists them in. */

/** What the finder recorded about one address (D27); the confidence is worked out from it. */
export type FoundEmailSource = Pick<FoundEmail, "email" | "source" | "videos" | "business">;

/** Mail anyone can open: a creator's business address is less likely to be one (D28). */
const freeMailDomains: ReadonlySet<string> = new Set([
  "gmail.com",
  "outlook.com",
  "hotmail.com",
  "yahoo.com",
  "icloud.com",
  "proton.me",
  "protonmail.com",
]);

/** From 0 to 1, two decimals: where the address was seen, less 0.05 for a free-mail domain. */
export function emailConfidence(found: FoundEmailSource): number {
  let base: number;
  if (found.source === "about") {
    base = found.business ? 0.95 : 0.9;
  } else {
    base = found.videos >= 3 ? 0.8 : 0.6;
  }
  const domain = found.email.slice(found.email.lastIndexOf("@") + 1).toLowerCase();
  if (freeMailDomains.has(domain)) {
    base -= 0.05;
  }
  return Math.max(0, Math.round(base * 100) / 100);
}

/** Most sure first; ties put the About text first, then the address. Returns a new list. */
export function sortFoundEmails(list: readonly FoundEmail[]): FoundEmail[] {
  return [...list].sort(
    (a, b) =>
      b.confidence - a.confidence ||
      Number(a.source !== "about") - Number(b.source !== "about") ||
      (a.email < b.email ? -1 : a.email > b.email ? 1 : 0),
  );
}
