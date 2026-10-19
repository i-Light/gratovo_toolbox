import type { IconName } from "@gratovo/ui";

import { strings } from "../strings";
import type { AppData, Notification } from "./store";

/** The sections of the Settings screen, in the order the prototype lists them. */
export type SectionKey =
  | "profile"
  | "appearance"
  | "day"
  | "keyboard"
  | "notifications"
  | "search"
  | "facts"
  | "writing"
  | "team"
  | "connections";

/** One section of the Settings screen. */
export interface SettingsSection {
  readonly key: SectionKey;
  readonly group: "you" | "agency";
  readonly icon: IconName;
  /** The prototype's owner flag: only the owner changes these (enforced when accounts arrive, step 3d). */
  readonly owner: boolean;
  /** The plan step that brings its rows; null when they work now. */
  readonly arrives: number | null;
}

/** The sections, in the prototype's order. */
export const settingsSections: readonly SettingsSection[] = [
  { key: "profile", group: "you", icon: "user", owner: false, arrives: null },
  { key: "appearance", group: "you", icon: "moon", owner: false, arrives: null },
  { key: "day", group: "you", icon: "sun", owner: false, arrives: 4 },
  { key: "keyboard", group: "you", icon: "keyboard", owner: false, arrives: null },
  { key: "notifications", group: "you", icon: "bell", owner: false, arrives: null },
  { key: "search", group: "agency", icon: "scan", owner: false, arrives: 5 },
  { key: "facts", group: "agency", icon: "sliders", owner: true, arrives: 7 },
  { key: "writing", group: "agency", icon: "pen", owner: false, arrives: 6 },
  { key: "team", group: "agency", icon: "users", owner: true, arrives: 9 },
  { key: "connections", group: "agency", icon: "gauge", owner: true, arrives: 9 },
];

/** A setting that exists today. */
export type RowId =
  "name" | "role" | "theme" | "density" | "size" | "motion" | "rail" | "letters" | "notify";

/** A row that can be searched and reached from the palette. */
export interface SettingsRow {
  readonly section: SectionKey;
  readonly id: RowId;
}

/** The rows that exist now, in the prototype's order. */
export const settingsRows: readonly SettingsRow[] = [
  { section: "profile", id: "name" },
  { section: "profile", id: "role" },
  { section: "appearance", id: "theme" },
  { section: "appearance", id: "density" },
  { section: "appearance", id: "size" },
  { section: "appearance", id: "motion" },
  { section: "appearance", id: "rail" },
  { section: "keyboard", id: "letters" },
  { section: "notifications", id: "notify" },
];

/** What a notification is about; each kind can be turned off. */
export type NotifyKind = "reply" | "money" | "handoff" | "search";

/** The kind of a notification, from its icon. Problems cannot be turned off. */
export function notifyKind(icon: IconName): NotifyKind | "problem" {
  switch (icon) {
    case "reply":
      return "reply";
    case "wallet":
    case "unlock":
      return "money";
    case "forward":
      return "handoff";
    case "alert":
      return "problem";
    default:
      return "search";
  }
}

/** Whether the bell and its tray show this notification: problems always, other kinds unless turned off. */
export function notifShown(data: AppData, n: Notification): boolean {
  const kind = notifyKind(n.icon);
  return kind === "problem" || data.settings.notify[kind] !== false;
}

/**
 * Rows whose label, words or section name contain the query, and sections whose name, sub or words
 * do (case does not matter; the query is trimmed). Only listed sections and rows are searched.
 */
export function searchSettings(query: string): {
  readonly rows: readonly SettingsRow[];
  readonly sections: readonly SettingsSection[];
} {
  const q = query.trim().toLowerCase();
  const tabs = strings.screens.settings.tabs;
  const text = strings.settings;
  const rows = settingsRows.filter((row) => {
    const r = text.rows[row.id];
    return `${r.label} ${r.words} ${tabs[row.section]}`.toLowerCase().includes(q);
  });
  const sections = settingsSections.filter((s) => {
    const t = text.sections[s.key];
    return `${tabs[s.key]} ${t.sub} ${t.words}`.toLowerCase().includes(q);
  });
  return { rows, sections };
}
