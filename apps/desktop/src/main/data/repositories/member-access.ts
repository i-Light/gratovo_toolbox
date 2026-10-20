import type { DatabaseSync } from "node:sqlite";

import { isAgencyRole, sortRoles } from "@gratovo/core/data";
import type { MemberAccess } from "@gratovo/core/data";

/** A `member_access` row as the server (or the example seed) sends it. */
export interface MemberAccessRow {
  /** A member id. */
  readonly profileId: string;
  /** Role names; ones the app doesn't know are kept here and dropped on read. */
  readonly roles: readonly string[];
  readonly seesMoney: boolean;
  /** ISO 8601 text, kept as it came. */
  readonly updatedAt: string;
}

/**
 * Replaces every row with `rows`. Not a transaction itself: run it inside one with whatever else
 * must change at the same time (the team refresh replaces the profiles too).
 */
export function replaceMemberAccess(db: DatabaseSync, rows: readonly MemberAccessRow[]): void {
  db.exec("DELETE FROM member_access");
  const insert = db.prepare(
    "INSERT INTO member_access (profile_id, roles, sees_money, updated_at) VALUES (?, ?, ?, ?)",
  );
  for (const row of rows) {
    insert.run(row.profileId, JSON.stringify(row.roles), row.seesMoney ? 1 : 0, row.updatedAt);
  }
}

/**
 * Every member's access, by member id. Roles come in display order, each once; an unknown role, or
 * a `roles` value that isn't a JSON array, is dropped rather than refused, as server rows may
 * surprise.
 */
export function listMemberAccess(db: DatabaseSync): ReadonlyMap<string, MemberAccess> {
  const rows = db.prepare("SELECT profile_id, roles, sees_money FROM member_access").all();
  return new Map(
    rows.map((row) => [
      String(row["profile_id"]),
      { roles: toRoles(row["roles"]), seesMoney: Number(row["sees_money"]) !== 0 },
    ]),
  );
}

function toRoles(value: unknown): MemberAccess["roles"] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(value));
  } catch {
    return [];
  }
  return Array.isArray(parsed) ? sortRoles((parsed as unknown[]).filter(isAgencyRole)) : [];
}
