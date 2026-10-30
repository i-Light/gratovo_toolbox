import type { DatabaseSync, SQLInputValue } from "node:sqlite";

import { bareBrand, brandContactsMax, brandStatuses } from "@gratovo/core/data";
import type { Brand, BrandContact, BrandPitch, BrandStatus } from "@gratovo/core/data";

import { flag, isRecord, jsonOrNull, ms, num, oneOf, parseJson, str, strings } from "./details";
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
 * `brand_details` follows, or it would hide the new one.
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

/** The contacts a brand's synced `contacts` column holds: the ones with a name, at most four. */
function readContacts(json: unknown): BrandContact[] {
  const list = parseJson(json);
  if (!Array.isArray(list)) {
    return [];
  }
  return list
    .flatMap((item: unknown): BrandContact[] => {
      if (!isRecord(item)) {
        return [];
      }
      const name = str(item["name"]);
      return name === null || name === ""
        ? []
        : [{ name, role: str(item["role"]) ?? str(item["title"]), email: str(item["email"]) }];
    })
    .slice(0, brandContactsMax);
}

function readPitch(json: unknown): BrandPitch | null {
  const value = parseJson(json);
  if (!isRecord(value)) {
    return null;
  }
  const at = num(value["at"]);
  const mode = oneOf(["cold", "warm"] as const, value["mode"]);
  return at === null || mode === null ? null : { at, creators: strings(value["creators"]), mode };
}

function brandFromRow(row: Row, detail: Row | undefined): Brand {
  const status: BrandStatus =
    oneOf(brandStatuses, detail?.["status"] ?? null) ??
    oneOf(brandStatuses, row["status"]) ??
    "found";
  const base = bareBrand({
    id: String(row["id"]),
    name: String(row["name"]),
    sells: row["sells"] === null ? "" : String(row["sells"]),
    status,
  });
  const low = num(row["budget"]);
  const high = num(detail?.["budget_high"]);
  return {
    ...base,
    category: str(row["category"]),
    country: str(row["country"]),
    site: str(row["website"]),
    contacts: readContacts(row["contacts"]),
    budget: low === null ? null : { low, high: high ?? low },
    budgetKnown: low !== null,
    ...(detail === undefined
      ? {}
      : {
          headcount: ms(detail["headcount"]),
          recommendedTitle: str(detail["recommended_title"]),
          paidSpenderVerified: flag(detail["paid_spender_verified"]),
          pastCampaignHook: str(detail["past_campaign_hook"]),
          seen: strings(parseJson(detail["seen"])),
          since: ms(detail["since"]),
          pitched: readPitch(detail["pitched"]),
          owner: str(detail["owner_id"]),
        }),
  };
}

/**
 * Every brand in the order added, the synced columns merged with `brand_details` (F2, F3). A
 * brand the old app wrote has no `sells` (read as an empty string) and no `status` (read as
 * "found"); a status the app does not know reads as "found" too. A brand with no detail row is
 * `bareBrand` over its synced columns.
 */
export function listBrands(db: DatabaseSync): Brand[] {
  const details = new Map<string, Row>();
  for (const row of db.prepare("SELECT * FROM brand_details").all()) {
    details.set(String(row["brand_id"]), row);
  }
  const rows = db
    .prepare(
      `SELECT id, name, sells, status, category, country, website, contacts, budget
       FROM brands ORDER BY rowid`,
    )
    .all();
  return rows.map((row) => brandFromRow(row, details.get(String(row["id"]))));
}

/** A brand as a viewer who does not see money gets it: no budget (`budgetKnown` stays; F4). */
export function brandWithoutMoney(brand: Brand): Brand {
  return { ...brand, budget: null };
}
