import type { DatabaseSync } from "node:sqlite";

import { creatorStageFrom, legacyCreatorFields, primaryEmail } from "@gratovo/core/data";
import type { Creator } from "@gratovo/core/data";

/**
 * Adds a creator or updates the one with the same id: the name goes to `channels`, the rest to
 * `channel_state`, with the legacy `vetting_status` and `pipeline_stage` written beside the app's
 * `creator_stage`. The email replaces any email contact and keeps the other contacts.
 * `now` is in ms; the table stores ISO text.
 */
export function upsertCreator(db: DatabaseSync, creator: Creator, now: number): void {
  const fields = legacyCreatorFields(creator.stage);
  const existing = db
    .prepare("SELECT contacts FROM channel_state WHERE channel_id = ?")
    .get(creator.id);
  const contacts = contactsWithEmail(
    existing === undefined ? "[]" : String(existing["contacts"]),
    creator.email,
  );
  db.prepare(
    `INSERT INTO channels (channel_id, name) VALUES (?, ?)
     ON CONFLICT (channel_id) DO UPDATE SET name = excluded.name`,
  ).run(creator.id, creator.name);
  db.prepare(
    `INSERT INTO channel_state
       (channel_id, handle, vetting_status, pipeline_stage, creator_stage, contacts, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (channel_id) DO UPDATE SET
       handle = excluded.handle, vetting_status = excluded.vetting_status,
       pipeline_stage = excluded.pipeline_stage, creator_stage = excluded.creator_stage,
       contacts = excluded.contacts, updated_at = excluded.updated_at`,
  ).run(
    creator.id,
    creator.handle,
    fields.vettingStatus,
    fields.pipelineStage,
    creator.stage,
    contacts,
    new Date(now).toISOString(),
  );
}

/** Every creator in the order added. The name falls back to the handle; stage and email are derived. */
export function listCreators(db: DatabaseSync): Creator[] {
  const rows = db
    .prepare(
      `SELECT s.channel_id, s.handle, s.vetting_status, s.pipeline_stage, s.creator_stage,
              s.contacts, c.name
       FROM channel_state s LEFT JOIN channels c ON c.channel_id = s.channel_id
       ORDER BY s.rowid`,
    )
    .all();
  return rows.map((row) => {
    const handle = String(row["handle"]);
    return {
      id: String(row["channel_id"]),
      name: row["name"] === null ? handle : String(row["name"]),
      handle,
      stage: creatorStageFrom({
        creatorStage: row["creator_stage"] === null ? null : String(row["creator_stage"]),
        vettingStatus: String(row["vetting_status"]),
        pipelineStage: String(row["pipeline_stage"]),
      }),
      email: primaryEmail(String(row["contacts"])),
    };
  });
}

function contactsWithEmail(existingJson: string, email: string | null): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(existingJson);
  } catch {
    parsed = [];
  }
  const others = (Array.isArray(parsed) ? (parsed as readonly unknown[]) : []).filter(
    (item) => !isEmailContact(item),
  );
  const next: unknown[] =
    email === null ? others : [...others, { method: "email", value: email, primary: true }];
  return JSON.stringify(next);
}

function isEmailContact(item: unknown): boolean {
  return (
    typeof item === "object" &&
    item !== null &&
    (item as Readonly<Record<string, unknown>>)["method"] === "email"
  );
}
