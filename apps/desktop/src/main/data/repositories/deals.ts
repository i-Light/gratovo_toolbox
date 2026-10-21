import type { DatabaseSync } from "node:sqlite";

import { dealStepFrom, legacyDealStage } from "@gratovo/core/data";
import type { Deal } from "@gratovo/core/data";

/**
 * Adds a deal or updates the one with the same id. Writes the app's `flow_step` and the legacy
 * `stage` the old app reads. `now` is in ms; the table stores ISO text.
 */
export function upsertDeal(db: DatabaseSync, deal: Deal, now: number): void {
  const iso = new Date(now).toISOString();
  db.prepare(
    `INSERT INTO deals (id, brand_id, channel_id, stage, brand_price, flow_step, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       brand_id = excluded.brand_id, channel_id = excluded.channel_id, stage = excluded.stage,
       brand_price = excluded.brand_price, flow_step = excluded.flow_step,
       updated_at = excluded.updated_at`,
  ).run(
    deal.id,
    deal.brand,
    deal.creator,
    legacyDealStage(deal.step),
    deal.price,
    deal.step,
    iso,
    iso,
  );
}

/** Sets a deal's step: `flow_step` and nothing else. An unknown id is a no-op. */
export function setDealStep(db: DatabaseSync, id: string, step: number): void {
  db.prepare("UPDATE deals SET flow_step = ? WHERE id = ?").run(step, id);
}

/** Every deal in the order added. A deal without `flow_step` gets its step from the legacy stage. */
export function listDeals(db: DatabaseSync): Deal[] {
  const rows = db
    .prepare(
      "SELECT id, brand_id, channel_id, stage, brand_price, flow_step FROM deals ORDER BY rowid",
    )
    .all();
  return rows.map((row) => ({
    id: String(row["id"]),
    brand: String(row["brand_id"]),
    creator: String(row["channel_id"]),
    step: dealStepFrom({
      flowStep: row["flow_step"] === null ? null : Number(row["flow_step"]),
      stage: String(row["stage"]),
    }),
    price: Number(row["brand_price"]),
  }));
}
