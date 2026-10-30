import type { DatabaseSync, SQLInputValue, SQLOutputValue } from "node:sqlite";

import {
  botRiskLevels,
  contractClauses,
  creatorFormats,
  qcChecks,
  redlineClauses,
  relationshipModels,
} from "@gratovo/core/data";
import type {
  BotRisk,
  CreatorDetails,
  CreatorOnboarding,
  ExclusivityLock,
  RedlineClause,
} from "@gratovo/core/data";

/**
 * Reading and writing the local-only detail tables (`brand_details`, `deal_details`,
 * `creator_details`, migration 0008; plan step P1, F2 and F3). Nothing here is synced. A JSON
 * column that does not parse, or an enum value the app does not know, reads as not known (null or
 * empty), never throws.
 */

export type Row = Readonly<Record<string, SQLOutputValue>>;

/** Stored JSON text as a value; bad JSON or a non-text column reads as null. */
export function parseJson(text: unknown): unknown {
  if (typeof text !== "string") {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function oneOf<T extends string>(list: readonly T[], value: unknown): T | null {
  return list.find((item) => item === value) ?? null;
}

export function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** An integer column as a boolean; null when the column is null. */
export function flag(value: unknown): boolean | null {
  return typeof value === "number" ? value !== 0 : null;
}

/** A JSON list of booleans, cut or filled with false to `length` when one is given. */
export function boolList(value: unknown, length: number | null): boolean[] {
  const list = Array.isArray(value) ? value.map((v) => v === true) : [];
  if (length === null) {
    return list;
  }
  return Array.from({ length }, (_, i) => list[i] ?? false);
}

export function clauseList(value: unknown): boolean[] {
  return boolList(value, contractClauses.length);
}

export function qcList(value: unknown): boolean[] {
  return boolList(value, qcChecks.length);
}

export function redlineList(value: unknown): RedlineClause[] {
  return Array.isArray(value)
    ? value.flatMap((v: unknown) => {
        const known = oneOf(redlineClauses, v);
        return known === null ? [] : [known];
      })
    : [];
}

/** A time in a synced column (ISO text) as ms; null when missing or not a date. */
export function isoMs(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : at;
}

/** A time in a detail column (ms integer). */
export function ms(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

/** JSON text for a TEXT column; null for no value. */
export function jsonOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

/** ms to the ISO text the synced tables store; null stays null. */
export function isoOrNull(at: number | null): string | null {
  return at === null ? null : new Date(at).toISOString();
}

/** One detail row of a creator, read whole. */
function readCreatorDetails(row: Row): CreatorDetails {
  const lockList = parseJson(row["locks"]);
  const locks: ExclusivityLock[] = Array.isArray(lockList)
    ? lockList.flatMap((item: unknown) => {
        if (!isRecord(item)) {
          return [];
        }
        const category = str(item["category"]);
        const brand = str(item["brand"]);
        const until = num(item["until"]);
        return category === null || brand === null || until === null
          ? []
          : [{ category, brand, until }];
      })
    : [];
  const onboardingJson = parseJson(row["onboarding"]);
  const onboarding: CreatorOnboarding | null = isRecord(onboardingJson)
    ? {
        dreamBrands: strings(onboardingJson["dreamBrands"]),
        hardNos: strings(onboardingJson["hardNos"]),
        paymentRail: str(onboardingJson["paymentRail"]),
        taxForm: str(onboardingJson["taxForm"]),
      }
    : null;
  const level = oneOf(botRiskLevels, row["bot_risk"]);
  const botRisk: BotRisk | null = level === null ? null : { level, note: str(row["bot_note"]) };
  const socialsJson = parseJson(row["socials"]);
  const socials: Record<string, string> = {};
  if (isRecord(socialsJson)) {
    for (const [platform, handle] of Object.entries(socialsJson)) {
      if (typeof handle === "string") {
        socials[platform] = handle;
      }
    }
  }
  return {
    owner: str(row["owner_id"]),
    relationship: oneOf(relationshipModels, row["relationship"]),
    lastUpdateAt: ms(row["last_update_at"]),
    locks,
    nextOpenSlot: ms(row["next_open_slot"]),
    onboarding,
    format: oneOf(creatorFormats, row["format"]),
    botRisk,
    socials,
  };
}

/** Every creator's details, by channel id. A creator with no row is not in the map (F3). */
export function creatorDetailsMap(db: DatabaseSync): Map<string, CreatorDetails> {
  const map = new Map<string, CreatorDetails>();
  for (const row of db.prepare("SELECT * FROM creator_details").all()) {
    map.set(String(row["channel_id"]), readCreatorDetails(row));
  }
  return map;
}

/** One creator's details, or null when there is no row. */
export function readCreatorDetailsRow(db: DatabaseSync, channelId: string): CreatorDetails | null {
  const row = db.prepare("SELECT * FROM creator_details WHERE channel_id = ?").get(channelId);
  return row === undefined ? null : readCreatorDetails(row);
}

/** `{ details }` for a creator that has a row, `{}` for one that does not (no undefined key). */
export function detailsPart(
  map: ReadonlyMap<string, CreatorDetails>,
  channelId: string,
): { details?: CreatorDetails } {
  const found = map.get(channelId);
  return found === undefined ? {} : { details: found };
}

/** Writes a creator's details row (the whole row is replaced). For the example seed. */
export function upsertCreatorDetails(
  db: DatabaseSync,
  channelId: string,
  details: CreatorDetails,
): void {
  const values: SQLInputValue[] = [
    channelId,
    details.owner,
    details.relationship,
    details.lastUpdateAt,
    JSON.stringify(details.locks),
    details.nextOpenSlot,
    jsonOrNull(details.onboarding),
    details.format,
    details.botRisk?.level ?? null,
    details.botRisk?.note ?? null,
    JSON.stringify(details.socials),
  ];
  db.prepare(
    `INSERT OR REPLACE INTO creator_details
       (channel_id, owner_id, relationship, last_update_at, locks, next_open_slot, onboarding,
        format, bot_risk, bot_note, socials)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(...values);
}
