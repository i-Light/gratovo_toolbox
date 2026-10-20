import type { DatabaseSync } from "node:sqlite";

import type { AppRole } from "@gratovo/core/data";

/** A person's profile row, as the app reads it. */
export interface Profile {
  readonly id: string;
  /** Empty while the person has not set a name. */
  readonly displayName: string;
  readonly role: AppRole;
  readonly color: string;
}

export interface ProfileInput {
  readonly id: string;
  readonly displayName: string;
  readonly role: AppRole;
  readonly color?: string;
}

const defaultColor = "#3B82F6";

/** Adds a profile or updates the one with the same id. `now` is in ms; the table stores ISO text. */
export function upsertProfile(db: DatabaseSync, input: ProfileInput, now: number): void {
  const iso = new Date(now).toISOString();
  db.prepare(
    `INSERT INTO profiles (id, display_name, color, role, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       display_name = excluded.display_name,
       color = excluded.color,
       role = excluded.role,
       updated_at = excluded.updated_at`,
  ).run(input.id, input.displayName, input.color ?? defaultColor, input.role, iso, iso);
}

/** Every profile, in the order they were added. */
export function listProfiles(db: DatabaseSync): Profile[] {
  const rows = db
    .prepare("SELECT id, display_name, color, role FROM profiles ORDER BY rowid")
    .all();
  return rows.map(toProfile);
}

export function getProfile(db: DatabaseSync, id: string): Profile | null {
  const row = db.prepare("SELECT id, display_name, color, role FROM profiles WHERE id = ?").get(id);
  return row === undefined ? null : toProfile(row);
}

/** Sets a profile's display name; false when there is no such profile. */
export function setDisplayName(db: DatabaseSync, id: string, name: string, now: number): boolean {
  const result = db
    .prepare("UPDATE profiles SET display_name = ?, updated_at = ? WHERE id = ?")
    .run(name, new Date(now).toISOString(), id);
  return Number(result.changes) > 0;
}

function toProfile(row: Readonly<Record<string, unknown>>): Profile {
  return {
    id: String(row["id"]),
    displayName: String(row["display_name"]),
    role: toRole(row["role"]),
    color: String(row["color"]),
  };
}

function toRole(value: unknown): AppRole {
  return value === "basic" || value === "full" ? value : "unauthorized";
}
