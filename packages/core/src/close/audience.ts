import { kitCountriesMax } from "../data/types";
import type { AudienceShare, CreatorKit, CreatorStage, KitInput } from "../data/types";
import type { SequenceStop } from "../data/reach-types";

/**
 * The audience check and the media kit's views (plan step 8, D1 to D4, D9 and D11). Pure and
 * defensive: the stored JSON can have any shape, and a bad field counts as absent. Never throws.
 */

/** D1: the rule's numbers, fixed until Settings > Agency facts makes them editable. */
export const audienceRule = {
  leaders: ["US", "GB", "CA", "AU"],
  minAge: 18,
  maxAge: 44,
  minEngagement: 3,
} as const;

export const audienceKeys = ["top", "age", "engagement", "rate"] as const;

export type AudienceKey = (typeof audienceKeys)[number];

/** One check: yes, no, or not known (null). */
export interface AudienceRow {
  readonly key: AudienceKey;
  readonly ok: boolean | null;
}

export interface AudienceResult {
  /** In `audienceKeys` order. */
  readonly rows: readonly AudienceRow[];
  readonly verdict: "pass" | "fail" | "missing";
  /** The rows with `ok === null`. */
  readonly missing: readonly AudienceKey[];
  /** The first row that is `false`; null when none is. */
  readonly firstFail: AudienceKey | null;
}

/** The stages where Decline, Ask and a kit Park are allowed. */
export const signingStages: readonly CreatorStage[] = ["replied", "kit", "audience"];

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** "18-34", "18–34" or "18 - 34" as two numbers, 13 to 99, low below high; else null. */
export function parseAgeBand(band: string): { low: number; high: number } | null {
  if (typeof band !== "string") return null;
  const match = /^\s*(\d{2})\s*[-–]\s*(\d{2})\s*$/.exec(band);
  if (match === null) return null;
  const low = Number(match[1]);
  const high = Number(match[2]);
  if (low < 13 || high > 99 || low >= high) return null;
  return { low, high };
}

/** Reads `[{code, <shareKey>}]`; entries without a code, and repeated codes, are dropped. */
function readCountries(value: unknown, shareKey: string): AudienceShare[] {
  if (!Array.isArray(value)) return [];
  const out: AudienceShare[] = [];
  for (const entry of value as unknown[]) {
    if (!isRecord(entry) || typeof entry["code"] !== "string") continue;
    const code = entry["code"].trim().toUpperCase();
    if (code === "" || out.some((one) => one.code === code)) continue;
    out.push({ code, share: finite(entry[shareKey]) });
  }
  return out;
}

/** Largest share first, null last, ties in their order; at most `kitCountriesMax`. */
function sortedCountries(list: readonly AudienceShare[]): AudienceShare[] {
  const rank = (one: AudienceShare): number => one.share ?? Number.NEGATIVE_INFINITY;
  return list
    .map((one, index) => ({ one, index }))
    .sort((a, b) => {
      const ra = rank(a.one);
      const rb = rank(b.one);
      if (ra === rb) return a.index - b.index;
      return rb > ra ? 1 : -1;
    })
    .map((entry) => entry.one)
    .slice(0, kitCountriesMax);
}

function readBand(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const band = parseAgeBand(value);
  return band === null ? null : `${String(band.low)}-${String(band.high)}`;
}

function rateRows(kit: Json): Json[] {
  const rates = kit["rates"];
  return Array.isArray(rates) ? (rates as unknown[]).filter(isRecord) : [];
}

function kitRate(kit: Json): number | null {
  const rows = rateRows(kit);
  const integration = rows.find((row) => row["format"] === "integration");
  const fromIntegration = integration === undefined ? null : positive(integration["price"]);
  if (fromIntegration !== null) return fromIntegration;
  const first = rows[0];
  return first === undefined ? null : positive(first["price"]);
}

/**
 * D2: the merged view of the typed kit (`media_kit`) and what replies gave (`provided_data`),
 * field by field: the typed kit first, then the reply. Engagement falls back to `engagement`.
 * Null when every field is empty.
 */
export function kitView(
  mediaKit: unknown,
  provided: unknown,
  engagement: number | null,
): CreatorKit | null {
  const kit: Json = isRecord(mediaKit) ? mediaKit : {};
  const reply: Json = isRecord(provided) ? provided : {};

  const kitCountries = readCountries(kit["countries"], "pct");
  const replyCountries = readCountries(reply["countries"], "share");
  const kitAge = readBand(kit["ageBand"]);
  const replyAge = readBand(reply["age"]);
  const typedRate = kitRate(kit);
  const replyRate = positive(reply["rate"]);

  const countries = sortedCountries(kitCountries.length > 0 ? kitCountries : replyCountries);
  const ageBand = kitAge ?? replyAge;
  const rate = typedRate ?? replyRate;
  const kitLink = kit["link"];
  const link = typeof kitLink === "string" && kitLink.startsWith("https://") ? kitLink : null;
  const engagementValue = finite(kit["engagement"]) ?? finite(engagement);

  const kitGives = kitCountries.length > 0 || kitAge !== null || typedRate !== null;
  const replyGives = replyCountries.length > 0 || replyAge !== null || replyRate !== null;

  if (
    countries.length === 0 &&
    ageBand === null &&
    rate === null &&
    link === null &&
    engagementValue === null
  ) {
    return null;
  }
  return {
    countries,
    ageBand,
    engagement: engagementValue,
    rate,
    link,
    fromReply: !kitGives && replyGives,
  };
}

/** D1: the four checks and the verdict. No kit means every row is not known. */
export function checkAudience(kit: CreatorKit | null): AudienceResult {
  const leader = kit?.countries[0];
  const band = kit?.ageBand == null ? null : parseAgeBand(kit.ageBand);
  const engagement = kit?.engagement ?? null;
  const rate = kit?.rate ?? null;
  const ok: Record<AudienceKey, boolean | null> = {
    top:
      leader === undefined
        ? null
        : (audienceRule.leaders as readonly string[]).includes(leader.code),
    age: band === null ? null : band.low >= audienceRule.minAge && band.high <= audienceRule.maxAge,
    engagement: engagement === null ? null : engagement >= audienceRule.minEngagement,
    rate: rate !== null && rate > 0 ? true : null,
  };
  const rows = audienceKeys.map((key): AudienceRow => ({ key, ok: ok[key] }));
  const missing = rows.filter((row) => row.ok === null).map((row) => row.key);
  const failed = rows.find((row) => row.ok === false);
  const verdict = failed !== undefined ? "fail" : missing.length === 0 ? "pass" : "missing";
  return { rows, verdict, missing, firstFail: failed === undefined ? null : failed.key };
}

/** D3: the new `media_kit` JSON from the stored one and what a person typed. */
export function mergeKit(stored: unknown, input: KitInput): Record<string, unknown> {
  const out: Json = isRecord(stored) ? { ...stored } : {};

  if (input.countries.length > 0) {
    out["countries"] = input.countries.map((one) => ({ code: one.code, pct: one.share }));
  } else delete out["countries"];
  if (input.ageBand === null) delete out["ageBand"];
  else out["ageBand"] = input.ageBand;
  if (input.engagement === null) delete out["engagement"];
  else out["engagement"] = input.engagement;
  if (input.link === null) delete out["link"];
  else out["link"] = input.link;

  const rows: unknown[] = Array.isArray(out["rates"]) ? [...(out["rates"] as unknown[])] : [];
  const at = rows.findIndex((row) => isRecord(row) && row["format"] === "integration");
  const old = at === -1 ? undefined : rows[at];
  if (input.rate === null) {
    if (at !== -1) rows.splice(at, 1);
  } else {
    const next: Json = { format: "integration", price: input.rate };
    if (isRecord(old) && old["agreed"] !== undefined && old["price"] === input.rate) {
      next["agreed"] = old["agreed"];
    }
    if (at === -1) rows.push(next);
    else rows[at] = next;
  }
  if (rows.length > 0) out["rates"] = rows;
  else delete out["rates"];
  return out;
}

/** D11: the legacy-shaped kit for the comms engine; null when the view is null. */
export function engineKit(kit: CreatorKit | null, signed: boolean): Record<string, unknown> | null {
  if (kit === null) return null;
  return {
    countries: kit.countries.map((one) => ({ code: one.code, pct: one.share })),
    ageBand: kit.ageBand,
    engagement: kit.engagement,
    link: kit.link,
    rates: kit.rate === null ? [] : [{ format: "integration", price: kit.rate, agreed: signed }],
  };
}

/** D4: a replied creator whose numbers include a rate and a country moves to kit. */
export function movesToKit(stage: CreatorStage, kit: CreatorKit | null): boolean {
  return stage === "replied" && kit !== null && kit.rate !== null && kit.countries.length > 0;
}

/** D5: Sign is offered at kit or audience, when the check passes. */
export function canSign(stage: CreatorStage, kit: CreatorKit | null): boolean {
  return (stage === "kit" || stage === "audience") && checkAudience(kit).verdict === "pass";
}

/** D9: the stage a parked creator wakes to. */
export function wakeStage(stopped: SequenceStop | null, kit: CreatorKit | null): CreatorStage {
  if (stopped !== "replied") return "emailed";
  return kit !== null && kit.rate !== null && kit.countries.length > 0 ? "kit" : "replied";
}
