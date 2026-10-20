/**
 * The tables read whole on every pass (D3, D19): the team (`profiles`, `member_access`), your
 * notification switches and your open edit conflicts. They are tiny and have no tombstones, so
 * each pass replaces the local copy in one transaction. Rows that don't fit the local contract
 * are mended (a long name is cut, an odd colour gets the default) or dropped (no id), so one
 * surprising row can't break the frame. Unsent work wins (D10): a pending `profile.name` and a
 * pending `notify.set` are written back over what was read.
 */

import type { DatabaseSync, SQLInputValue } from "node:sqlite";

import { nameMax, notifyKinds } from "@gratovo/core/data";
import type { AppRole, NotifyKind, NotifySettings } from "@gratovo/core/data";
import type { FramePart } from "@gratovo/ipc";
import { z } from "zod";

import {
  getNotify,
  pendingPayload,
  replaceMemberAccess,
  replaceOpenConflicts,
  replaceProfiles,
  setNotify,
} from "../data/repositories";
import type { MemberAccessRow, ProfileRow } from "../data/repositories";
import { inTransaction } from "../data/sqlite-source";
import type { Rest } from "../supabase/rest";

export const profileColumns = "id,display_name,color,role,created_at,updated_at";
const accessColumns = "profile_id,roles,sees_money,updated_at";
const switchColumns = "profile_id,switches,updated_at";
const conflictColumns =
  "id,channel_id,channel_label,field,base_value,mine_value,theirs_value,mine_actor_id,mine_actor_name,theirs_actor_name,detected_at,resolved_at,updated_at";

const id = z.string().min(1).max(100);

const serverProfile = z.object({
  id,
  display_name: z.string().nullable(),
  color: z.string().nullable(),
  role: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const serverAccess = z.object({
  profile_id: id,
  roles: z.array(z.string()).nullable(),
  sees_money: z.boolean().nullable(),
  updated_at: z.string(),
});

const hexColor = /^#[0-9A-Fa-f]{6}$/;

/** A server role the app doesn't know reads as no access. */
export function toAppRole(value: unknown): AppRole {
  return value === "basic" || value === "full" ? value : "unauthorized";
}

export function toProfileRow(raw: unknown): ProfileRow | null {
  const parsed = serverProfile.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  const row = parsed.data;
  return {
    id: row.id,
    displayName: (row.display_name ?? "").trim().slice(0, nameMax),
    role: toAppRole(row.role),
    color: row.color !== null && hexColor.test(row.color) ? row.color : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toAccessRow(raw: unknown): MemberAccessRow | null {
  const parsed = serverAccess.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  const row = parsed.data;
  return {
    profileId: row.profile_id,
    // Unknown role names are kept here and dropped when read (repositories/member-access.ts).
    roles: row.roles ?? [],
    seesMoney: row.sees_money ?? false,
    updatedAt: row.updated_at,
  };
}

function present<T>(value: T | null): value is T {
  return value !== null;
}

/** Only known switches with a boolean value; anything else is left out. */
function cleanSwitches(value: unknown): NotifySettings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const map = value as Readonly<Record<string, unknown>>;
  const result: Partial<Record<NotifyKind, boolean>> = {};
  for (const kind of notifyKinds) {
    const flag = map[kind];
    if (typeof flag === "boolean") {
      result[kind] = flag;
    }
  }
  return result;
}

/** A jsonb value as the JSON text the mirror stores (null stays null). */
function jsonText(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toConflictRow(raw: unknown): Record<string, SQLInputValue> | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const r = raw as Readonly<Record<string, unknown>>;
  const conflictId = text(r["id"]);
  const channelId = text(r["channel_id"]);
  const field = text(r["field"]);
  if (conflictId === null || conflictId === "" || channelId === null || field === null) {
    return null;
  }
  return {
    id: conflictId,
    channel_id: channelId,
    channel_label: text(r["channel_label"]) ?? channelId,
    field,
    base_value: jsonText(r["base_value"]),
    mine_value: jsonText(r["mine_value"]),
    theirs_value: jsonText(r["theirs_value"]),
    mine_actor_id: text(r["mine_actor_id"]),
    mine_actor_name: text(r["mine_actor_name"]) ?? "",
    theirs_actor_name: text(r["theirs_actor_name"]),
    detected_at: text(r["detected_at"]),
    resolved_at: text(r["resolved_at"]),
    updated_at: text(r["updated_at"]),
  };
}

function readState(db: DatabaseSync, userId: string) {
  const dump = (sql: string, ...params: string[]) => JSON.stringify(db.prepare(sql).all(...params));
  return {
    me: dump("SELECT * FROM profiles WHERE id = ?", userId),
    team:
      dump("SELECT * FROM profiles WHERE id <> ? ORDER BY rowid", userId) +
      dump("SELECT * FROM member_access ORDER BY profile_id"),
    notify: JSON.stringify(getNotify(db)),
    conflicts: dump(
      "SELECT id, updated_at, resolved_at, resolved_locally FROM edit_conflicts ORDER BY id",
    ),
  };
}

/**
 * Reads the whole tables and replaces the local copy of them in one transaction. Returns the
 * frame parts that changed (`team`, `me`, `notify`, `conflicts`). Throws `AuthError` or
 * `RestError`; a failure changes nothing. `afterConflicts` runs inside the transaction and
 * returns true when the local notifications changed.
 */
export async function refreshWhole(
  rest: Pick<Rest, "select">,
  db: DatabaseSync,
  userId: string,
  o: { afterConflicts?: (db: DatabaseSync) => boolean } = {},
): Promise<ReadonlySet<FramePart>> {
  const me = encodeURIComponent(userId);
  const [profiles, access, switches, conflicts] = await Promise.all([
    rest.select<unknown>("profiles", `select=${profileColumns}&order=created_at.asc,id.asc`),
    rest.select<unknown>("member_access", `select=${accessColumns}`),
    rest.select<unknown>("notification_switches", `select=${switchColumns}&profile_id=eq.${me}`),
    rest.select<unknown>(
      "edit_conflicts",
      `select=${conflictColumns}&mine_actor_id=eq.${me}&resolved_at=is.null`,
    ),
  ]);
  const changed = new Set<FramePart>();
  if (!db.isOpen) {
    return changed;
  }
  const profileRows = profiles.map(toProfileRow).filter(present);
  const accessRows = access.map(toAccessRow).filter(present);
  const conflictRows = conflicts.map(toConflictRow).filter(present);
  const mine = switches.find(
    (row): row is Record<string, unknown> =>
      typeof row === "object" &&
      row !== null &&
      (row as Record<string, unknown>)["profile_id"] === userId,
  );
  const notices = { changed: false };

  const before = readState(db, userId);
  inTransaction(db, () => {
    replaceProfiles(db, profileRows);
    replaceMemberAccess(db, accessRows);
    if (mine !== undefined) {
      setNotify(db, cleanSwitches(mine["switches"]));
    }
    replaceOpenConflicts(db, conflictRows);
    if (o.afterConflicts !== undefined) {
      notices.changed = o.afterConflicts(db);
    }
    // Unsent work wins over what was just read (D10).
    const name = pendingPayload(db, userId, "profile.name") as { name?: unknown } | null;
    if (typeof name?.name === "string") {
      db.prepare("UPDATE profiles SET display_name = ? WHERE id = ?").run(name.name, userId);
    }
    const pending = pendingPayload(db, userId, "notify.set") as { switches?: unknown } | null;
    if (pending !== null) {
      setNotify(db, cleanSwitches(pending.switches));
    }
  });
  const after = readState(db, userId);

  if (before.me !== after.me) {
    changed.add("me");
  }
  if (before.team !== after.team) {
    changed.add("team");
  }
  if (before.notify !== after.notify) {
    changed.add("notify");
  }
  if (before.conflicts !== after.conflicts || notices.changed) {
    changed.add("conflicts");
  }
  return changed;
}
