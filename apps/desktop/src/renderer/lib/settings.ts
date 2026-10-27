import { notifyKind } from "@gratovo/core/data";
import type { FrameSource, NotifyKind } from "@gratovo/core/data";
import type { IconName } from "@gratovo/ui";

import { strings } from "../strings";
import { getPrototype } from "./prototype";
import type { AppData, Notification } from "./store";
import { isSettingsSectionShown } from "./wired";

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
  | "connections"
  | "prototype";

/** One section of the Settings screen. */
export interface SettingsSection {
  readonly key: SectionKey;
  readonly group: "you" | "agency" | "owner";
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
  { key: "day", group: "you", icon: "sun", owner: false, arrives: 7 },
  { key: "keyboard", group: "you", icon: "keyboard", owner: false, arrives: null },
  { key: "notifications", group: "you", icon: "bell", owner: false, arrives: null },
  { key: "search", group: "agency", icon: "scan", owner: false, arrives: null },
  { key: "facts", group: "agency", icon: "sliders", owner: true, arrives: 8 },
  { key: "writing", group: "agency", icon: "pen", owner: false, arrives: null },
  { key: "team", group: "agency", icon: "users", owner: true, arrives: 9 },
  { key: "connections", group: "agency", icon: "gauge", owner: true, arrives: null },
  { key: "prototype", group: "owner", icon: "flask", owner: true, arrives: null },
];

/** A setting that exists today. */
export type RowId =
  | "name"
  | "role"
  | "density"
  | "size"
  | "motion"
  | "rail"
  | "letters"
  | "notify"
  | "rulesCountries"
  | "rulesMedian"
  | "rulesUploads"
  | "rulesPerKeyword"
  | "rulesArchive"
  | "rulesBand"
  | "writingRules"
  | "connOld"
  | "connMailApp"
  | "connMailboxes"
  | "connMailSettings"
  | "connGemini"
  | "connCourse"
  | "connYoutube"
  | "connPython"
  | "connProxies"
  | "connPacing"
  | "connAws"
  | "connSync"
  | "proto"
  | "scenario"
  | "comments";

/** A row that can be searched and reached from the palette. */
export interface SettingsRow {
  readonly section: SectionKey;
  readonly id: RowId;
}

/** The rows that exist now, in the prototype's order. */
export const settingsRows: readonly SettingsRow[] = [
  { section: "profile", id: "name" },
  { section: "profile", id: "role" },
  { section: "appearance", id: "density" },
  { section: "appearance", id: "size" },
  { section: "appearance", id: "motion" },
  { section: "appearance", id: "rail" },
  { section: "keyboard", id: "letters" },
  { section: "notifications", id: "notify" },
  { section: "search", id: "rulesCountries" },
  { section: "search", id: "rulesMedian" },
  { section: "search", id: "rulesUploads" },
  { section: "search", id: "rulesPerKeyword" },
  { section: "search", id: "rulesArchive" },
  { section: "search", id: "rulesBand" },
  { section: "writing", id: "writingRules" },
  { section: "connections", id: "connOld" },
  { section: "connections", id: "connMailApp" },
  { section: "connections", id: "connMailboxes" },
  { section: "connections", id: "connMailSettings" },
  { section: "connections", id: "connGemini" },
  { section: "connections", id: "connCourse" },
  { section: "connections", id: "connYoutube" },
  { section: "connections", id: "connPython" },
  { section: "connections", id: "connProxies" },
  { section: "connections", id: "connPacing" },
  { section: "connections", id: "connAws" },
  { section: "connections", id: "connSync" },
  { section: "prototype", id: "proto" },
  { section: "prototype", id: "scenario" },
  { section: "prototype", id: "comments" },
];

export type { NotifyKind };
export { notifyKind };

/** Whether you hold the Owner role. */
export function meIsOwner(data: AppData): boolean {
  return data.team.find((m) => m.id === data.me)?.owner ?? false;
}

/** The sections you may open: the owner-only ones are for the owner; live data hides unwired ones. */
export function sectionsFor(
  owner: boolean,
  source: FrameSource = "example",
): readonly SettingsSection[] {
  const { status } = getPrototype();
  return settingsSections.filter(
    (s) =>
      (owner || !s.owner || s.key === "prototype") &&
      isSettingsSectionShown(s.key, source) &&
      // Main decides who may see the Prototype section; hidden until it has answered.
      (s.key !== "prototype" || status?.available === true),
  );
}

/** The setting rows you may reach: those in a section you may open. */
export function rowsFor(owner: boolean, source: FrameSource = "example"): readonly SettingsRow[] {
  const keys = new Set(sectionsFor(owner, source).map((s) => s.key));
  const on = getPrototype().status?.on === true;
  // The scenario and comments rows exist only while prototype mode is on.
  return settingsRows.filter(
    (row) => keys.has(row.section) && (row.section !== "prototype" || row.id === "proto" || on),
  );
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
export function searchSettings(
  query: string,
  owner: boolean,
  source: FrameSource = "example",
): {
  readonly rows: readonly SettingsRow[];
  readonly sections: readonly SettingsSection[];
} {
  const q = query.trim().toLowerCase();
  const tabs = strings.screens.settings.tabs;
  const text = strings.settings;
  const rows = rowsFor(owner, source).filter((row) => {
    const r = text.rows[row.id];
    return `${r.label} ${r.words} ${tabs[row.section]}`.toLowerCase().includes(q);
  });
  const sections = sectionsFor(owner, source).filter((s) => {
    const t = text.sections[s.key];
    return `${tabs[s.key]} ${t.sub} ${t.words}`.toLowerCase().includes(q);
  });
  return { rows, sections };
}
