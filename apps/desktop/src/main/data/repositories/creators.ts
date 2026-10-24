import type { DatabaseSync } from "node:sqlite";

import { creatorStageFrom, legacyCreatorFields, primaryEmail } from "@gratovo/core/data";
import type { Creator, CreatorStage } from "@gratovo/core/data";

/**
 * Adds a creator or updates the one with the same id: the name goes to `channels`, the rest to
 * `channel_state`, with the legacy `vetting_status` and `pipeline_stage` written beside the app's
 * `creator_stage`. The email replaces the primary email entry and keeps the other contacts (other emails too).
 * `now` is in ms; the table stores ISO text. The fields read from the log and the due date are not
 * written here.
 */
export function upsertCreator(
  db: DatabaseSync,
  creator: Pick<Creator, "id" | "name" | "handle" | "stage" | "email">,
  now: number,
): void {
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

/** Sets a creator's stage: `creator_stage` and nothing else. An unknown id is a no-op. */
export function setCreatorStage(db: DatabaseSync, id: string, stage: CreatorStage): void {
  db.prepare("UPDATE channel_state SET creator_stage = ? WHERE channel_id = ?").run(stage, id);
}

/** The most creators a frame carries (the IPC list limit, `listMax` in the ipc package). */
export const listMax = 5000;

/**
 * At most `limit` creators, in the order added. When there are more than that, the ones kept are:
 * every creator a deal names, then creators past `new` (the app stage set, or the legacy fields
 * not `newlyFound`/`new`), then the most recently pulled. The recency proxy is `rowid`, not
 * `updated_at`: pulled rows arrive in cursor order, and `updated_at` text with mixed offsets
 * (`Z` and `+00:00`) does not sort as time. The name falls back to the handle; stage and email
 * are derived, and only the kept rows have their email read.
 */
export function listCreators(db: DatabaseSync, o: { limit?: number } = {}): Creator[] {
  const limit = Math.max(0, Math.min(Math.floor(o.limit ?? listMax), listMax));
  const rows = db
    .prepare(
      `SELECT * FROM (
         SELECT s.rowid AS rid, s.channel_id, s.handle, s.vetting_status, s.pipeline_stage,
                s.creator_stage, s.contacts, c.name
         FROM channel_state s LEFT JOIN channels c ON c.channel_id = s.channel_id
         ORDER BY
           CASE
             WHEN EXISTS (SELECT 1 FROM deals d WHERE d.channel_id = s.channel_id) THEN 0
             WHEN s.creator_stage IS NOT NULL
               OR NOT (s.vetting_status = 'newlyFound' AND s.pipeline_stage = 'new') THEN 1
             ELSE 2
           END,
           s.rowid DESC
         LIMIT ?
       ) ORDER BY rid`,
    )
    .all(limit);
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
      emailConfirmed: primaryConfirmed(String(row["contacts"])),
      // Read from the log and the due date in plan step 5 (B3); unknown until then.
      rejectReason: null,
      rejectedAt: null,
      archiveDueAt: null,
    };
  });
}

/** Whether the contact `primaryEmail` picks is marked `confirmed: true`. Bad JSON reads as false. */
function primaryConfirmed(contactsJson: string): boolean {
  const email = primaryEmail(contactsJson);
  if (email === null) {
    return false;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(contactsJson);
  } catch {
    return false;
  }
  const contacts = Array.isArray(parsed) ? (parsed as readonly unknown[]) : [];
  const entry = contacts
    .filter(
      (item): item is Readonly<Record<string, unknown>> =>
        typeof item === "object" && item !== null,
    )
    .filter(
      (c) =>
        c["method"] === "email" && typeof c["value"] === "string" && c["value"].trim() === email,
    )
    // The primary one first, as `primaryEmail` chooses it.
    .sort((a, b) => Number(b["primary"] === true) - Number(a["primary"] === true))[0];
  return entry?.["confirmed"] === true;
}

function contactsWithEmail(existingJson: string, email: string | null): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(existingJson);
  } catch {
    parsed = [];
  }
  const oldPrimary = primaryEmail(existingJson);
  const others = (Array.isArray(parsed) ? (parsed as readonly unknown[]) : []).filter(
    (item) => !isPrimaryEmailEntry(item, oldPrimary),
  );
  const next: unknown[] =
    email === null ? others : [...others, { method: "email", value: email, primary: true }];
  return JSON.stringify(next);
}

/** The entry `primaryEmail` reads as the primary one: flagged primary, or a bare string that is the old primary. */
function isPrimaryEmailEntry(item: unknown, oldPrimary: string | null): boolean {
  if (typeof item === "string") {
    return oldPrimary !== null && item.trim() === oldPrimary;
  }
  if (typeof item !== "object" || item === null) {
    return false;
  }
  const contact = item as Readonly<Record<string, unknown>>;
  return contact["method"] === "email" && contact["primary"] === true;
}
