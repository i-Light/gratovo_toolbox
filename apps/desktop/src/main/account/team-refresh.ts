/**
 * The team refresh (plan G7), a stopgap until 3d-2b's pull: reads every profile and every
 * `member_access` row the member may see, then replaces both local tables in one transaction.
 * Rows that don't fit the local contract are mended (a long name is cut, an odd colour gets the
 * default) or dropped (no id), so one surprising row can't break the frame.
 */

import type { DatabaseSync } from "node:sqlite";

import { nameMax, type AppRole } from "@gratovo/core/data";
import { z } from "zod";

import { replaceMemberAccess, replaceProfiles } from "../data/repositories";
import type { MemberAccessRow, ProfileRow } from "../data/repositories";
import { inTransaction } from "../data/sqlite-source";
import type { Rest } from "../supabase/rest";

export const profileColumns = "id,display_name,color,role,created_at,updated_at";
const accessColumns = "profile_id,roles,sees_money,updated_at";

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

/** Fetches the team and replaces the local copy of it. Throws `AuthError` or `RestError`. */
export async function refreshTeam(rest: Pick<Rest, "select">, db: DatabaseSync): Promise<void> {
  const [profiles, access] = await Promise.all([
    rest.select<unknown>("profiles", `select=${profileColumns}&order=created_at.asc,id.asc`),
    rest.select<unknown>("member_access", `select=${accessColumns}`),
  ]);
  const profileRows = profiles.map(toProfileRow).filter(present);
  const accessRows = access.map(toAccessRow).filter(present);
  if (!db.isOpen) {
    return;
  }
  inTransaction(db, () => {
    replaceProfiles(db, profileRows);
    replaceMemberAccess(db, accessRows);
  });
}
