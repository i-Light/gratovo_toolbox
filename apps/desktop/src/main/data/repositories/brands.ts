import type { DatabaseSync, SQLInputValue } from "node:sqlite";

import { bareBrand, brandContactsMax, brandStatuses } from "@gratovo/core/data";
import type { Brand, BrandContact, BrandPitch, BrandStatus } from "@gratovo/core/data";

import {
  amountOf,
  countOf,
  countryCode,
  flag,
  idOrNull,
  isRecord,
  jsonOrNull,
  ms,
  num,
  oneOf,
  parseJson,
  strMax,
  strings,
  textMax,
} from "./details";
import type { Row } from "./details";

/** Adds a brand or updates the one with the same id. `now` is in ms; the table stores ISO text. */
export function upsertBrand(db: DatabaseSync, brand: Brand, now: number): void {
  const iso = new Date(now).toISOString();
  db.prepare(
    `INSERT INTO brands (id, name, sells, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       name = excluded.name, sells = excluded.sells, status = excluded.status,
       updated_at = excluded.updated_at`,
  ).run(brand.id, brand.name, brand.sells, brand.status, iso, iso);
}

/**
 * Adds a brand with every field known: the synced columns (name, sells, status, category, country,
 * website, contacts, the budget's low end) and its row in `brand_details` (the rest, and the full
 * status). For the example seed. `now` is in ms.
 */
export function upsertBrandDetails(db: DatabaseSync, brand: Brand, now: number): void {
  const iso = new Date(now).toISOString();
  const synced: SQLInputValue[] = [
    brand.id,
    brand.name,
    brand.sells,
    brand.status,
    brand.category,
    brand.country,
    brand.site,
    JSON.stringify(brand.contacts),
    brand.budget?.low ?? null,
    iso,
    iso,
  ];
  db.prepare(
    `INSERT INTO brands
       (id, name, sells, status, category, country, website, contacts, budget, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       name = excluded.name, sells = excluded.sells, status = excluded.status,
       category = excluded.category, country = excluded.country, website = excluded.website,
       contacts = excluded.contacts, budget = excluded.budget, updated_at = excluded.updated_at`,
  ).run(...synced);
  const detail: SQLInputValue[] = [
    brand.id,
    brand.headcount,
    brand.recommendedTitle,
    brand.paidSpenderVerified === null ? null : Number(brand.paidSpenderVerified),
    brand.pastCampaignHook,
    brand.budget?.high ?? null,
    JSON.stringify(brand.seen),
    brand.since,
    jsonOrNull(brand.pitched),
    brand.owner,
    brand.status,
  ];
  db.prepare(
    `INSERT OR REPLACE INTO brand_details
       (brand_id, headcount, recommended_title, paid_spender_verified, past_campaign_hook,
        budget_high, seen, since, pitched, owner_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(...detail);
}

/**
 * Adds a brand (`created_at` and `updated_at` set to `now`) or sets the name, `sells` and
 * `status` of the one with that id, leaving its `updated_at`. `now` is in ms. A status kept in
 * `brand_details` follows, or it would hide the new one (the reader prefers `brands.status`
 * anyway).
 */
export function setBrand(
  db: DatabaseSync,
  brand: { id: string; name: string; sells: string; status: string },
  now: number,
): void {
  // An existing brand keeps the server's `updated_at`: the deletion guard compares it with a
  // tombstone's time, and this computer's clock must not make a deleted brand look newer.
  const iso = new Date(now).toISOString();
  db.prepare(
    `INSERT INTO brands (id, name, sells, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       name = excluded.name, sells = excluded.sells, status = excluded.status`,
  ).run(brand.id, brand.name, brand.sells, brand.status, iso, iso);
  db.prepare("UPDATE brand_details SET status = ? WHERE brand_id = ? AND status IS NOT NULL").run(
    brand.status,
    brand.id,
  );
}

/** True when a stored contact is flagged as the primary one (the legacy app's `isPrimary`). */
function isPrimaryContact(item: Readonly<Record<string, unknown>>): boolean {
  return item["isPrimary"] === true || item["primary"] === true;
}

/**
 * The contacts a brand's synced `contacts` column holds: the ones with a name, the legacy primary
 * first, at most `brandContactsMax`, each cut to the schema's limits (F10). With none usable, the
 * single `contact_name` and `contact_email` columns stand in.
 */
function readContacts(json: unknown, columnName: unknown, columnEmail: unknown): BrandContact[] {
  const list = parseJson(json);
  const found: { contact: BrandContact; primary: boolean }[] = [];
  if (Array.isArray(list)) {
    for (const item of list as unknown[]) {
      if (!isRecord(item)) {
        continue;
      }
      const name = strMax(item["name"]);
      if (name === null || name === "") {
        continue;
      }
      found.push({
        contact: {
          name,
          role: strMax(item["role"]) ?? strMax(item["title"]),
          email: strMax(item["email"]),
        },
        primary: isPrimaryContact(item),
      });
    }
  }
  if (found.length === 0) {
    const name = strMax(columnName);
    if (name === null || name.trim() === "") {
      return [];
    }
    return [{ name, role: null, email: strMax(columnEmail) }];
  }
  // A stable sort: the primary first, the rest in the order stored.
  return [...found.filter((f) => f.primary), ...found.filter((f) => !f.primary)]
    .slice(0, brandContactsMax)
    .map((f) => f.contact);
}

function readPitch(json: unknown): BrandPitch | null {
  const value = parseJson(json);
  if (!isRecord(value)) {
    return null;
  }
  const at = num(value["at"]);
  const mode = oneOf(["cold", "warm"] as const, value["mode"]);
  if (at === null || mode === null) {
    return null;
  }
  const creators = strings(value["creators"])
    .filter((c) => idOrNull(c) !== null)
    .slice(0, seenMax);
  return { at, creators, mode };
}

/** The most creators a brand lists as seen or pitched (the schema's limit). */
const seenMax = 200;

function brandFromRow(row: Row, detail: Row | undefined): Brand {
  // `brands.status` is local too (no Supabase column): the newest write, so it comes first.
  const status: BrandStatus =
    oneOf(brandStatuses, row["status"]) ?? oneOf(brandStatuses, detail?.["status"]) ?? "found";
  const base = bareBrand({
    id: String(row["id"]),
    name: String(row["name"]).slice(0, textMax),
    sells: strMax(row["sells"]) ?? "",
    status,
  });
  const low = amountOf(row["budget"]);
  const highStored = amountOf(detail?.["budget_high"]);
  return {
    ...base,
    category: categoryOf(row["category"]),
    country: countryCode(row["country"]),
    site: strMax(row["website"]),
    contacts: readContacts(row["contacts"], row["contact_name"], row["contact_email"]),
    budget: low === null ? null : { low, high: highStored ?? low },
    budgetKnown: low !== null,
    ...(detail === undefined
      ? {}
      : {
          headcount: countOf(detail["headcount"]),
          recommendedTitle: strMax(detail["recommended_title"]),
          paidSpenderVerified: flag(detail["paid_spender_verified"]),
          pastCampaignHook: strMax(detail["past_campaign_hook"]),
          seen: strings(parseJson(detail["seen"]))
            .filter((id) => idOrNull(id) !== null)
            .slice(0, seenMax),
          since: ms(detail["since"]),
          pitched: readPitch(detail["pitched"]),
          owner: idOrNull(detail["owner_id"]),
        }),
  };
}

/** A category the schema takes (40 characters at most); longer is not known (F10). */
function categoryOf(value: unknown): string | null {
  return typeof value === "string" && value.length <= 40 ? value : null;
}

/**
 * Every brand in the order added, the synced columns merged with `brand_details` (F2, F3), each
 * value cleaned to the frame schema's limits (F10). A brand the old app wrote has no `sells` (read
 * as an empty string) and no `status` (read as "found"); a status the app does not know reads as
 * "found" too. A brand with no detail row is `bareBrand` over its synced columns.
 */
export function listBrands(db: DatabaseSync): Brand[] {
  const details = new Map<string, Row>();
  for (const row of db.prepare("SELECT * FROM brand_details").all()) {
    details.set(String(row["brand_id"]), row);
  }
  const rows = db
    .prepare(
      `SELECT id, name, sells, status, category, country, website, contacts, budget,
              contact_name, contact_email
       FROM brands ORDER BY rowid`,
    )
    .all();
  return rows.map((row) => brandFromRow(row, details.get(String(row["id"]))));
}

/** A brand as a viewer who does not see money gets it: no budget (`budgetKnown` stays; F4). */
export function brandWithoutMoney(brand: Brand): Brand {
  return { ...brand, budget: null };
}
