import type { DatabaseSync } from "node:sqlite";

import { notifyKinds } from "@gratovo/core/data";
import type { NotifyKind, NotifySettings } from "@gratovo/core/data";

const notifyKey = "notify";

/** A setting parsed from its JSON, or undefined when it is missing or is not valid JSON. */
export function getSetting(db: DatabaseSync, key: string): unknown {
  const row = db.prepare("SELECT value FROM local_settings WHERE key = ?").get(key);
  if (row === undefined) return undefined;
  try {
    return JSON.parse(String(row["value"])) as unknown;
  } catch {
    return undefined;
  }
}

/** Stores a setting as JSON. */
export function setSetting(db: DatabaseSync, key: string, value: unknown): void {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    throw new Error(`The setting "${key}" cannot be stored as JSON`);
  }
  const json = JSON.stringify(value);
  db.prepare(
    "INSERT INTO local_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
  ).run(key, json);
}

/** The notification switches; anything that is not a known kind with a boolean is left out. */
export function getNotify(db: DatabaseSync): NotifySettings {
  const stored = getSetting(db, notifyKey);
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return {};
  const map = stored as Readonly<Record<string, unknown>>;
  const result: Partial<Record<NotifyKind, boolean>> = {};
  for (const kind of notifyKinds) {
    const value = map[kind];
    if (typeof value === "boolean") result[kind] = value;
  }
  return result;
}

/** Replaces the whole notification map. */
export function setNotify(db: DatabaseSync, notify: NotifySettings): void {
  setSetting(db, notifyKey, notify);
}
