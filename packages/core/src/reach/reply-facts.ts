import type { ReplyFact } from "../data/reach-types";

/**
 * The facts a creator's reply gives that the record keeps (plan step 6, D18 and D23): a rate,
 * their top countries, an age band. Pure and cautious: a fact is only read when the words around
 * it say what it is, since a wrong rate saved to the record is worse than none.
 */

/** The most countries a reply's fact lists. */
export const replyCountriesMax = 5;

const countryNames: readonly (readonly [RegExp, string])[] = [
  [/\b(?:u\.?s\.?a?\.?|united states|america)(?![a-z])/i, "US"],
  [/\b(?:u\.?k\.?|united kingdom|britain|england)(?![a-z])/i, "GB"],
  [/\bcanada\b/i, "CA"],
  [/\baustralia\b/i, "AU"],
  [/\bgermany\b/i, "DE"],
  [/\bfrance\b/i, "FR"],
  [/\bindia\b/i, "IN"],
  [/\bbrazil\b/i, "BR"],
  [/\bmexico\b/i, "MX"],
  [/\bspain\b/i, "ES"],
  [/\bitaly\b/i, "IT"],
  [/\bnetherlands\b/i, "NL"],
  [/\bphilippines\b/i, "PH"],
  [/\bindonesia\b/i, "ID"],
  [/\bjapan\b/i, "JP"],
  [/\bnigeria\b/i, "NG"],
  [/\bpakistan\b/i, "PK"],
  [/\bsouth africa\b/i, "ZA"],
  [/\bnew zealand\b/i, "NZ"],
  [/\bireland\b/i, "IE"],
];

/** Words that say a number is a price. */
const rateWords =
  /\b(?:rate|rates|price|pricing|charge|fee|cost|budget|per (?:video|integration|post)|for (?:a|one|the) (?:video|integration|dedicated|mention))\b/i;
/** Words that say countries or ages are about the audience. */
const audienceWords =
  /\b(?:audience|viewers|viewership|subscribers|watch|watched|countries|country|demographic|demographics|age|ages|aged|studio|analytics|top|mostly|majority)\b/i;

function amount(digits: string, cents: string | undefined, k: string | undefined): number | null {
  const value = Number(digits.replace(/,/g, "") + (cents ?? ""));
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  const full = k === undefined ? value : value * 1000;
  // A creator's rate per video; anything outside this is not one.
  return full >= 20 && full <= 1_000_000 ? Math.round(full) : null;
}

/** The first rate the reply names, in US dollars, or null. */
export function readRate(text: string): number | null {
  const dollar = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?\s?(k)?\b/gi;
  for (const m of text.matchAll(dollar)) {
    const value = amount(m[1] ?? "", m[2], m[3]);
    if (value !== null) {
      return value;
    }
  }
  const usd = /\b(\d{1,3}(?:,\d{3})+|\d+)\s?(k)?\s?(?:usd|us dollars|dollars)\b/gi;
  for (const m of text.matchAll(usd)) {
    const value = amount(m[1] ?? "", undefined, m[2]);
    if (value !== null) {
      return value;
    }
  }
  // "my rate is 900": a bare number only right after a price word.
  const bare =
    /\b(?:rate|price|fee|charge)\s+(?:is|of|would be|starts at|:)?\s*(\d{1,3}(?:,\d{3})+|\d+)\s?(k)?\b/gi;
  for (const m of text.matchAll(bare)) {
    const value = amount(m[1] ?? "", undefined, m[2]);
    if (value !== null && rateWords.test(m[0])) {
      return value;
    }
  }
  return null;
}

/** The share in % written right after or right before a country's name, or null. */
function shareNear(text: string, index: number, length: number): number | null {
  const after = /^\s*[:(-]?\s*(\d{1,3})(?:\.\d)?\s?%/.exec(
    text.slice(index + length, index + length + 12),
  );
  const before = /(\d{1,3})(?:\.\d)?\s?%\s*(?:from\s+|in\s+|are\s+)?(?:the\s+)?$/i.exec(
    text.slice(Math.max(0, index - 16), index),
  );
  const raw = after?.[1] ?? before?.[1];
  const share = raw === undefined ? null : Number(raw);
  return share !== null && share > 0 && share <= 100 ? share : null;
}

/** The audience's top countries, largest share first, or an empty list. */
export function readCountries(text: string): { code: string; share: number | null }[] {
  if (!audienceWords.test(text)) {
    return [];
  }
  const found = new Map<string, { code: string; share: number | null; at: number }>();
  for (const [pattern, code] of countryNames) {
    const global = new RegExp(pattern.source, "gi");
    for (const m of text.matchAll(global)) {
      const share = shareNear(text, m.index, m[0].length);
      const had = found.get(code);
      if (had === undefined) {
        found.set(code, { code, share, at: m.index });
      } else if (had.share === null && share !== null) {
        found.set(code, { ...had, share });
      }
    }
  }
  return [...found.values()]
    .sort((a, b) => (b.share ?? -1) - (a.share ?? -1) || a.at - b.at)
    .slice(0, replyCountriesMax)
    .map(({ code, share }) => ({ code, share }));
}

/** The audience's age band as "25-34", or null. */
export function readAgeBand(text: string): string | null {
  if (!audienceWords.test(text)) {
    return null;
  }
  const band = /\b(1[3-9]|[2-6]\d)\s?(?:-|–|to)\s?(1[4-9]|[2-6]\d)\b(?!\s?%)/g;
  for (const m of text.matchAll(band)) {
    const low = Number(m[1]);
    const high = Number(m[2]);
    if (high > low && high - low <= 30) {
      return `${String(low)}-${String(high)}`;
    }
  }
  return null;
}

/** Every fact the reply gives, none saved yet. */
export function readReplyFacts(text: string): ReplyFact[] {
  const facts: ReplyFact[] = [];
  const rate = readRate(text);
  if (rate !== null) {
    facts.push({ key: "rate", rate, saved: false });
  }
  const countries = readCountries(text);
  if (countries.length > 0) {
    facts.push({ key: "countries", countries, saved: false });
  }
  const band = readAgeBand(text);
  if (band !== null) {
    facts.push({ key: "age", band, saved: false });
  }
  return facts;
}
