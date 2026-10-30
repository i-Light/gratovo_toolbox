import type { DatabaseSync } from "node:sqlite";

import { creatorStageFrom, legacyCreatorFields, primaryEmail } from "@gratovo/core/data";
import { mergeKit } from "@gratovo/core/close";
import type { Creator, CreatorStage, DataWrite, RejectReason } from "@gratovo/core/data";

import { parseJson } from "./details";

/**
 * Adds a creator or updates the one with the same id: the name goes to `channels`, the rest to
 * `channel_state`, with the legacy `vetting_status` and `pipeline_stage` written beside the app's
 * `creator_stage`. The email replaces the primary email entry and keeps the other contacts (other emails too).
 * `now` is in ms; the table stores ISO text. The fields read from the log and the due date are not
 * written here.
 */
export function upsertCreator(
  db: DatabaseSync,
  creator: Pick<Creator, "id" | "name" | "handle" | "stage" | "email"> &
    Partial<
      Pick<Creator, "emailConfirmed" | "contactName" | "contactSource" | "contactConfidence">
    >,
  now: number,
): void {
  const fields = legacyCreatorFields(creator.stage);
  const existing = db
    .prepare("SELECT contacts FROM channel_state WHERE channel_id = ?")
    .get(creator.id);
  const existingJson = existing === undefined ? "[]" : String(existing["contacts"]);
  // A confirmed address (the example seed's) is stored as a person's confirm would store it.
  const contacts =
    creator.emailConfirmed === true && creator.email !== null
      ? contactsWithPrimary(existingJson, {
          id: creator.id,
          email: creator.email,
          confirmed: true,
          contactName: creator.contactName ?? null,
          source: creator.contactSource ?? null,
          confidence: creator.contactConfidence ?? null,
          handle: creator.handle,
          name: creator.name,
        })
      : contactsWithEmail(existingJson, creator.email);
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

/** The tags that start the server's archive countdown (its `channel_is_rejected`). */
export const rejectingTags: readonly string[] = ["haramStuff", "irrelevant", "inactive"];

/** How long the server's trigger gives a rejected channel before it is archived. */
const archiveDelayMs = 7 * 24 * 60 * 60 * 1000;

/** Stored tags as a list of strings; bad JSON or anything else reads as none. */
export function parseTags(json: unknown): string[] {
  if (typeof json !== "string") {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  return Array.isArray(parsed)
    ? (parsed as readonly unknown[]).filter((tag): tag is string => typeof tag === "string")
    : [];
}

/** A creator's stored tags, or null when the creator has no row. */
export function readTags(db: DatabaseSync, id: string): string[] | null {
  const row = db.prepare("SELECT channel_tags FROM channel_state WHERE channel_id = ?").get(id);
  return row === undefined ? null : parseTags(row["channel_tags"]);
}

/** A real YouTube channel id: the only kind of id a stage write may create a row for. */
const channelIdPattern = /^UC[A-Za-z0-9_-]{22}$/;

/**
 * Creates the row of a creator that has none, when its id is a real channel id; false (and
 * nothing written) otherwise. The handle is the id when it is empty, as the server names it; the
 * legacy fields are the old app's defaults (`newlyFound`, `new`), as the server writes them for a
 * channel it has never seen; `creator_stage` is `stage` (null leaves it unset); the name goes to
 * `channels` when there is one. `now` is in ms.
 */
function createCreatorRow(
  db: DatabaseSync,
  creator: { readonly id: string; readonly handle: string; readonly name: string },
  stage: CreatorStage | null,
  now: number,
): boolean {
  if (!channelIdPattern.test(creator.id)) {
    return false;
  }
  // The legacy fields stay at the old app's defaults: writing them from the stage would make a
  // never-then-allow channel read as "lost", and so as emailed before.
  db.prepare(
    `INSERT INTO channel_state
       (channel_id, handle, vetting_status, pipeline_stage, creator_stage, updated_at)
     VALUES (?, ?, 'newlyFound', 'new', ?, ?)`,
  ).run(
    creator.id,
    creator.handle === "" ? creator.id : creator.handle,
    stage,
    new Date(now).toISOString(),
  );
  if (creator.name !== "") {
    db.prepare(
      `INSERT INTO channels (channel_id, name) VALUES (?, ?)
       ON CONFLICT (channel_id) DO UPDATE SET name = excluded.name`,
    ).run(creator.id, creator.name);
  }
  return true;
}

/**
 * A creator's stage write (plan step 5, D4 and D5). A creator with no row gets one when its id is
 * a real channel id: the handle (the id when it is empty, as the server names it), the old app's
 * defaults (`newlyFound`, `new`) as the server writes them for a channel it has never seen, the
 * app's stage and the name. Any other unknown id does nothing. An existing row has only
 * `creator_stage` set, as before. Then the tags follow the stage, the way the server's archive
 * countdown reads them: a move to `rejected` adds `inactive` (reason `posting`) or `irrelevant`,
 * and sets the due date 7 days on when it has none, as the trigger will; a move away from
 * `rejected` takes the three rejecting tags off and clears the due date. `now` is in ms.
 */
export function writeCreatorStage(
  db: DatabaseSync,
  write: {
    readonly id: string;
    readonly stage: CreatorStage;
    readonly handle: string;
    readonly name: string;
    readonly reason?: RejectReason;
  },
  now: number,
): void {
  const row = db
    .prepare(
      `SELECT vetting_status, pipeline_stage, creator_stage, channel_tags, archive_due_at
       FROM channel_state WHERE channel_id = ?`,
    )
    .get(write.id);
  let before: CreatorStage;
  let tags: string[];
  let due: string | null;
  if (row === undefined) {
    if (!createCreatorRow(db, write, write.stage, now)) {
      return;
    }
    // A row the server has never seen has its defaults: stage new, no tags, no due date.
    before = "new";
    tags = [];
    due = null;
  } else {
    setCreatorStage(db, write.id, write.stage);
    before = creatorStageFrom({
      creatorStage: row["creator_stage"] === null ? null : String(row["creator_stage"]),
      vettingStatus: String(row["vetting_status"]),
      pipelineStage: String(row["pipeline_stage"]),
    });
    tags = parseTags(row["channel_tags"]);
    due = row["archive_due_at"] === null ? null : String(row["archive_due_at"]);
  }
  if (write.stage === "rejected") {
    const tag = write.reason === "posting" ? "inactive" : "irrelevant";
    if (!tags.includes(tag) || due === null) {
      setCreatorTags(db, write.id, tags.includes(tag) ? tags : [...tags, tag], now);
    }
  } else if (before === "rejected") {
    const kept = tags.filter((tag) => !rejectingTags.includes(tag));
    if (kept.length !== tags.length || due !== null) {
      setCreatorTags(db, write.id, kept, now);
    }
  }
}

/**
 * Sets a creator's tags and, as the server's trigger does, its due date: kept (or 7 days on from
 * `now` when there is none) while a rejecting tag is on, cleared when none is.
 */
export function setCreatorTags(
  db: DatabaseSync,
  id: string,
  tags: readonly string[],
  now: number,
): void {
  const rejected = tags.some((tag) => rejectingTags.includes(tag));
  db.prepare(
    `UPDATE channel_state SET channel_tags = ?,
       archive_due_at = CASE WHEN ? THEN COALESCE(archive_due_at, ?) ELSE NULL END
     WHERE channel_id = ?`,
  ).run(JSON.stringify(tags), rejected ? 1 : 0, new Date(now + archiveDelayMs).toISOString(), id);
}

/** Stored notes as the server keeps them: empty text is no notes (its `canonical_edit_value`). */
export function storedNotes(notes: string): string | null {
  return notes === "" ? null : notes;
}

/**
 * A creator's stored notes, or undefined when the creator has no row. One lookup by the primary
 * key; the Find detail reads them this way (D24).
 */
export function readNotes(db: DatabaseSync, id: string): string | null | undefined {
  const row = db.prepare("SELECT notes FROM channel_state WHERE channel_id = ?").get(id);
  if (row === undefined) {
    return undefined;
  }
  return typeof row["notes"] === "string" ? storedNotes(row["notes"]) : null;
}

/**
 * A creator's notes write (plan step 5, D24): `channel_state.notes`, with `""` stored as null as
 * the server stores it. A creator with no row gets one as a stage write makes it (D4), with no
 * stage of its own; any other unknown id does nothing. `now` is in ms.
 */
export function writeCreatorNotes(
  db: DatabaseSync,
  write: {
    readonly id: string;
    readonly notes: string;
    readonly handle: string;
    readonly name: string;
  },
  now: number,
): void {
  if (readNotes(db, write.id) === undefined && !createCreatorRow(db, write, null, now)) {
    return;
  }
  db.prepare("UPDATE channel_state SET notes = ? WHERE channel_id = ?").run(
    storedNotes(write.notes),
    write.id,
  );
}

/** A `creator.contact` write (plan step 5, D31). */
type ContactWrite = Omit<Extract<DataWrite, { kind: "creator.contact" }>, "kind">;

/**
 * A creator's primary email contact write (plan step 5, D31): the address becomes the primary
 * entry `{method: "email", value, label, primary: true, confirmed, source, confidence}`, the old
 * primary and every other contact kept (`contactsWithPrimary`); a null email removes the primary.
 * A creator with no row gets one as a stage write makes it (D4), with no stage of its own; any
 * other unknown id does nothing. `now` is in ms.
 */
export function writeCreatorContact(db: DatabaseSync, write: ContactWrite, now: number): void {
  const row = db.prepare("SELECT contacts FROM channel_state WHERE channel_id = ?").get(write.id);
  if (row === undefined && !createCreatorRow(db, write, null, now)) {
    return;
  }
  db.prepare("UPDATE channel_state SET contacts = ? WHERE channel_id = ?").run(
    contactsWithPrimary(row === undefined ? "[]" : String(row["contacts"]), write),
    write.id,
  );
}

/** A creator's stored contacts JSON text, or undefined when the creator has no row. */
export function readContacts(db: DatabaseSync, id: string): string | undefined {
  const row = db.prepare("SELECT contacts FROM channel_state WHERE channel_id = ?").get(id);
  return row === undefined ? undefined : String(row["contacts"]);
}

/** A `creator.kit` write. */
type KitWrite = Omit<Extract<DataWrite, { kind: "creator.kit" }>, "kind">;

/**
 * A creator's media kit write (step 8, D3): `mergeKit` of the stored `media_kit` and what was typed,
 * stored as JSON (unknown keys and other rate rows stay). A creator with no row gets one as a stage
 * write makes it, with no stage of its own; any other unknown id does nothing. `now` is in ms.
 */
export function writeCreatorKit(db: DatabaseSync, write: KitWrite, now: number): void {
  const row = db.prepare("SELECT media_kit FROM channel_state WHERE channel_id = ?").get(write.id);
  if (row === undefined && !createCreatorRow(db, write, null, now)) {
    return;
  }
  const merged = mergeKit(row === undefined ? null : parseJson(row["media_kit"]), write.kit);
  db.prepare("UPDATE channel_state SET media_kit = ? WHERE channel_id = ?").run(
    JSON.stringify(merged),
    write.id,
  );
}

/** Stored contacts as a list; bad JSON or anything but a list reads as none. */
function contactList(json: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  return Array.isArray(parsed) ? (parsed as unknown[]) : [];
}

/** The address an email entry holds, trimmed (a bare string with an "@" is one); null otherwise. */
function emailValue(item: unknown): string | null {
  if (typeof item === "string") {
    return item.includes("@") ? item.trim() : null;
  }
  if (typeof item !== "object" || item === null) {
    return null;
  }
  const contact = item as Readonly<Record<string, unknown>>;
  return contact["method"] === "email" && typeof contact["value"] === "string"
    ? contact["value"].trim()
    : null;
}

/**
 * The contacts with `write`'s address as the primary email (D31). Nothing else is lost: the old
 * primary stays where it was with `primary: false` (a bare string becomes an email entry), and
 * every other contact is kept as it is. Entries with the same address become the one new entry, at
 * the place of the first of them (or last), keeping its label when the write names nobody. So undo
 * can swap two addresses back, and writing the same contact again gives the same text: the sync
 * sees no change. A null email only removes the primary entry.
 */
function contactsWithPrimary(existingJson: string, write: ContactWrite): string {
  const oldPrimary = primaryEmail(existingJson);
  const email = write.email;
  if (email === null) {
    return JSON.stringify(
      contactList(existingJson).filter((item) => !isPrimaryEmailEntry(item, oldPrimary)),
    );
  }
  const next: unknown[] = [];
  let at: number | null = null;
  let label: string | null = null;
  for (const item of contactList(existingJson)) {
    if (emailValue(item) === email) {
      if (at === null) {
        at = next.length;
        // A bare string has no label; emailValue said anything else is an object.
        const stored = typeof item === "string" ? null : (item as Record<string, unknown>)["label"];
        label = typeof stored === "string" ? stored : null;
      }
      continue;
    }
    if (isPrimaryEmailEntry(item, oldPrimary)) {
      next.push(
        typeof item === "string"
          ? { method: "email", value: item.trim(), primary: false }
          : { ...(item as Readonly<Record<string, unknown>>), primary: false },
      );
      continue;
    }
    next.push(item);
  }
  next.splice(at ?? next.length, 0, {
    method: "email",
    value: email,
    label: write.contactName ?? label,
    primary: true,
    confirmed: write.confirmed,
    source: write.source,
    confidence: write.confidence,
  });
  return JSON.stringify(next);
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
