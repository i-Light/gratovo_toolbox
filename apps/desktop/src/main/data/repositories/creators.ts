import type { DatabaseSync, SQLOutputValue } from "node:sqlite";

import {
  contactNameMax,
  contactSources,
  creatorStageFrom,
  creatorStages,
  legacyCreatorFields,
  primaryEmail,
  rejectReasons,
} from "@gratovo/core/data";
import type {
  ContactSource,
  Creator,
  CreatorStage,
  CreatorState,
  DataWrite,
  RejectReason,
} from "@gratovo/core/data";

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
 * A creator's primary email contact write (plan step 5, D31): the primary email entry becomes
 * `{method: "email", value, label, primary: true, confirmed, source, confidence}` in its place,
 * every other contact kept; a null email removes it. A creator with no row gets one as a stage
 * write makes it (D4), with no stage of its own; any other unknown id does nothing. `now` is in ms.
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
      `WITH ${hiddenLines}, ${rejectLines}
       SELECT k.*, r.action AS reject_action, r.detail AS reject_detail, r.at_ms AS reject_at_ms,
              r.at AS reject_at
       FROM (
         SELECT s.rowid AS rid, s.channel_id, s.handle, s.vetting_status, s.pipeline_stage,
                s.creator_stage, s.contacts, s.archive_due_at, c.name
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
       ) k LEFT JOIN rejects r ON r.entity_id = k.channel_id
       ORDER BY k.rid`,
    )
    .all(limit);
  return rows.map((row) => {
    const handle = String(row["handle"]);
    return {
      id: String(row["channel_id"]),
      name: row["name"] === null ? handle : String(row["name"]),
      handle,
      ...storedFields(row),
      ...contactFacts(String(row["contacts"])),
    };
  });
}

/**
 * Every creator's stored state, for the Find catalog to join to the pipeline's channels (plan
 * step 5, D1): every `channel_state` row, not capped as the frame is, in the order added. `name`
 * is null when `channels` has none. `lastActivity` is the newest visible line about the creator.
 * Notes are left out: the detail reads one creator's with `readNotes`.
 */
export function creatorStates(db: DatabaseSync): CreatorState[] {
  const rows = db
    .prepare(
      `WITH ${hiddenLines}, ${rejectLines}, ${latestLines}
       SELECT s.channel_id, s.handle, s.vetting_status, s.pipeline_stage, s.creator_stage,
              s.contacts, s.archive_due_at, s.manual_engagement_rate, c.name,
              r.action AS reject_action, r.detail AS reject_detail, r.at_ms AS reject_at_ms,
              r.at AS reject_at, l.at_ms AS last_at_ms, l.at AS last_at, l.actor_name AS last_who
       FROM channel_state s
         LEFT JOIN channels c ON c.channel_id = s.channel_id
         LEFT JOIN rejects r ON r.entity_id = s.channel_id
         LEFT JOIN latest l ON l.entity_id = s.channel_id
       ORDER BY s.rowid`,
    )
    .all();
  return rows.map((row) => {
    const engagement = row["manual_engagement_rate"];
    return {
      id: String(row["channel_id"]),
      handle: String(row["handle"]),
      name: row["name"] === null ? null : String(row["name"]),
      ...storedFields(row),
      engagement: typeof engagement === "number" ? engagement : null,
      legacyPipelineStage: String(row["pipeline_stage"]),
      hasAppStage: isAppStage(row["creator_stage"]),
      lastActivity:
        row["last_who"] === null
          ? null
          : { at: lineMs(row["last_at_ms"], row["last_at"]), who: String(row["last_who"]) },
    };
  });
}

// The parts the two reads share. An undo hides a line while its newest undo or redo marker is an
// undo, as `newestLog` reads it; each window keeps one creator's newest line, in one pass.

/** `hidden(line)`: the ids of the lines an undo hides. */
const hiddenLines = `hidden AS (
  SELECT line FROM (
    SELECT entity_id AS line, action,
           ROW_NUMBER() OVER (PARTITION BY entity_id ORDER BY at_ms DESC, id DESC) AS n
    FROM activity_log
    WHERE entity_type = 'activity_log' AND action IN ('undo', 'redo')
  ) WHERE n = 1 AND action = 'undo'
)`;

/** `rejects`: each creator's newest visible reject or never line. */
const rejectLines = `rejects AS (
  SELECT entity_id, action, detail, at_ms, at FROM (
    SELECT a.entity_id, a.action, a.detail, a.at_ms, a.at,
           ROW_NUMBER() OVER (PARTITION BY a.entity_id ORDER BY a.at_ms DESC, a.id DESC) AS n
    FROM activity_log a
    WHERE a.entity_type = 'channel' AND a.action IN ('creator.reject', 'creator.never')
      AND a.id NOT IN (SELECT line FROM hidden)
  ) WHERE n = 1
)`;

/** `latest`: each creator's newest visible line of any kind. */
const latestLines = `latest AS (
  SELECT entity_id, at_ms, at, actor_name FROM (
    SELECT a.entity_id, a.at_ms, a.at, a.actor_name,
           ROW_NUMBER() OVER (PARTITION BY a.entity_id ORDER BY a.at_ms DESC, a.id DESC) AS n
    FROM activity_log a
    WHERE a.entity_type = 'channel' AND a.entity_id IS NOT NULL
      AND a.id NOT IN (SELECT line FROM hidden)
  ) WHERE n = 1
)`;

/** The fields both reads derive the same way from a row and its reject line. */
function storedFields(
  row: Readonly<Record<string, SQLOutputValue>>,
): Pick<
  Creator,
  | "stage"
  | "email"
  | "emailConfirmed"
  | "contactName"
  | "rejectReason"
  | "rejectedAt"
  | "archiveDueAt"
> {
  const contacts = String(row["contacts"]);
  const primary = primaryEntry(contacts);
  const confirmed = primary?.["confirmed"] === true;
  const label = primary?.["label"];
  const action = row["reject_action"];
  const due = row["archive_due_at"] === null ? NaN : Date.parse(String(row["archive_due_at"]));
  const stage = creatorStageFrom({
    creatorStage: row["creator_stage"] === null ? null : String(row["creator_stage"]),
    vettingStatus: String(row["vetting_status"]),
    pipelineStage: String(row["pipeline_stage"]),
  });
  // The line outlives the stage: once a creator is brought back, its old reason no longer holds.
  const rejected = stage === "rejected";
  return {
    stage,
    email: primaryEmail(contacts),
    emailConfirmed: confirmed,
    // A name on an address nobody confirmed is only a guess: it is not shown.
    contactName:
      confirmed && typeof label === "string" && label.trim() !== ""
        ? label.trim().slice(0, contactNameMax)
        : null,
    // A never line has no reason: only a reject line gives one.
    rejectReason: rejected && action === "creator.reject" ? reasonFrom(row["reject_detail"]) : null,
    rejectedAt:
      (rejected || stage === "never") && action !== null
        ? lineMs(row["reject_at_ms"], row["reject_at"])
        : null,
    archiveDueAt: Number.isNaN(due) ? null : due,
  };
}

/** Whether a stored `creator_stage` is one of the app's stages (one the stage is read from). */
function isAppStage(value: unknown): boolean {
  return typeof value === "string" && (creatorStages as readonly string[]).includes(value);
}

/** A line's time in ms: `at_ms`, else its ISO text (0 when that doesn't read either). */
function lineMs(atMs: unknown, at: unknown): number {
  if (typeof atMs === "number") {
    return atMs;
  }
  const ms = Date.parse(String(at));
  return Number.isNaN(ms) ? 0 : ms;
}

/** The reason in a line's stored detail (`{"reason": …}`); null when it isn't one of the four. */
function reasonFrom(detail: unknown): RejectReason | null {
  if (typeof detail !== "string") {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(detail);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const reason = (parsed as Readonly<Record<string, unknown>>)["reason"];
  return rejectReasons.find((known) => known === reason) ?? null;
}

/**
 * The contact `primaryEmail` picks, as stored: the email entry with its value, the primary one
 * first. Null when there is none, or for a bare string (it has no fields). Bad JSON reads as none.
 */
function primaryEntry(contactsJson: string): Readonly<Record<string, unknown>> | null {
  const email = primaryEmail(contactsJson);
  if (email === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(contactsJson);
  } catch {
    return null;
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
  return entry ?? null;
}

/**
 * Where the primary address came from and how sure the finder was, as stored on it (D31); null
 * for anything that isn't one of the sources or a number from 0 to 1.
 */
function contactFacts(contactsJson: string): Pick<Creator, "contactSource" | "contactConfidence"> {
  const primary = primaryEntry(contactsJson);
  const source = primary?.["source"];
  const confidence = primary?.["confidence"];
  return {
    contactSource: contactSources.find((known): known is ContactSource => known === source) ?? null,
    contactConfidence:
      typeof confidence === "number" && confidence >= 0 && confidence <= 1 ? confidence : null,
  };
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
 * The contacts with `write`'s address as the primary email (D31). The old primary entry goes, and
 * so does any other entry with the same address, so it is not listed twice; the new entry takes
 * the place of the first one removed (or goes last), so writing the same contact again gives the
 * same list and the sync sees no change. A null email only removes.
 */
function contactsWithPrimary(existingJson: string, write: ContactWrite): string {
  const oldPrimary = primaryEmail(existingJson);
  const kept: unknown[] = [];
  let at: number | null = null;
  for (const item of contactList(existingJson)) {
    const same = write.email !== null && emailValue(item) === write.email;
    if (isPrimaryEmailEntry(item, oldPrimary) || same) {
      at ??= kept.length;
      continue;
    }
    kept.push(item);
  }
  if (write.email !== null) {
    kept.splice(at ?? kept.length, 0, {
      method: "email",
      value: write.email,
      label: write.contactName,
      primary: true,
      confirmed: write.confirmed,
      source: write.source,
      confidence: write.confidence,
    });
  }
  return JSON.stringify(kept);
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
