import type { DatabaseSync } from "node:sqlite";

import type { Brand } from "@gratovo/core/data";

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
 * Adds a brand (`created_at` and `updated_at` set to `now`) or sets the name, `sells` and
 * `status` of the one with that id, leaving its `updated_at`. `now` is in ms.
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
}

/**
 * Every brand in the order added. A brand the old app wrote has no `sells` (read as an empty
 * string) and no `status` (read as "found").
 */
export function listBrands(db: DatabaseSync): Brand[] {
  const rows = db.prepare("SELECT id, name, sells, status FROM brands ORDER BY rowid").all();
  return rows.map((row) => ({
    id: String(row["id"]),
    name: String(row["name"]),
    sells: row["sells"] === null ? "" : String(row["sells"]),
    status: row["status"] === null ? "found" : String(row["status"]),
  }));
}
