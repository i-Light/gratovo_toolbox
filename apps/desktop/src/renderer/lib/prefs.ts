import { creatorStages } from "@gratovo/core/data";
import { emptyFindFilter, findSignals, type FindFilter } from "@gratovo/core/find";
import { useSyncExternalStore } from "react";
import { z } from "zod";

/** The settings that belong to this computer rather than to the team. An empty string means "default". */
export interface Prefs {
  readonly density: "" | "compact";
  readonly size: "" | "large";
  readonly motion: "" | "reduce";
  /** "off" turns single-letter keys off. */
  readonly letters: "" | "off";
  /** "min" collapses the rail. */
  readonly rail: "" | "min";
  /** The gallery's last filter, sort, view, card size and show toggles (step 5b, D20). */
  readonly findFilter: FindFilter;
  readonly findSort: "fit" | "median" | "subs" | "found" | "latest";
  readonly findView: "gallery" | "table";
  readonly findSize: "s" | "m" | "l";
  readonly findPics: boolean;
  readonly findLatest: boolean;
  readonly findSignals: boolean;
}

/** The one localStorage key that holds all preferences as JSON. */
export const prefsKey = "gratovo.prefs";

const defaults: Prefs = {
  density: "",
  size: "",
  motion: "",
  letters: "",
  rail: "",
  findFilter: emptyFindFilter,
  findSort: "fit",
  findView: "gallery",
  findSize: "m",
  findPics: true,
  findLatest: true,
  findSignals: true,
};

// One schema per field, so a bad value in one field cannot reset the others. A key that is not
// here is ignored: an old `name` (your name moved to your account in 3d) and an old `theme`.
const fields = {
  density: z.enum(["", "compact"]),
  size: z.enum(["", "large"]),
  motion: z.enum(["", "reduce"]),
  letters: z.enum(["", "off"]),
  rail: z.enum(["", "min"]),
  findFilter: z.object({
    stages: z.array(z.enum(creatorStages)),
    signals: z.array(z.enum(findSignals)),
    countries: z.array(z.string()),
    minMedian: z.number().nonnegative(),
    maxMedian: z.number().nonnegative().nullable(),
    minUploads: z.number().nonnegative(),
    runs: z.array(z.number().int().nonnegative()),
    q: z.string(),
  }),
  findSort: z.enum(["fit", "median", "subs", "found", "latest"]),
  findView: z.enum(["gallery", "table"]),
  findSize: z.enum(["s", "m", "l"]),
  findPics: z.boolean(),
  findLatest: z.boolean(),
  findSignals: z.boolean(),
} as const;

function parseStored(text: string | null): Record<string, unknown> {
  if (text === null) {
    return {};
  }
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function pick<K extends keyof Prefs>(key: K, stored: Record<string, unknown>): Prefs[K] {
  const parsed = fields[key].safeParse(stored[key]);
  return parsed.success ? (parsed.data as Prefs[K]) : defaults[key];
}

/** Reads the saved preferences. Anything missing, broken or unknown falls back to its default, field by field. */
export function readPrefs(storage: Pick<Storage, "getItem"> | null): Prefs {
  let text: string | null = null;
  try {
    text = storage === null ? null : storage.getItem(prefsKey);
  } catch {
    // Storage can throw (blocked site data); the defaults are fine.
  }
  const stored = parseStored(text);
  return {
    density: pick("density", stored),
    size: pick("size", stored),
    motion: pick("motion", stored),
    letters: pick("letters", stored),
    rail: pick("rail", stored),
    findFilter: pick("findFilter", stored),
    findSort: pick("findSort", stored),
    findView: pick("findView", stored),
    findSize: pick("findSize", stored),
    findPics: pick("findPics", stored),
    findLatest: pick("findLatest", stored),
    findSignals: pick("findSignals", stored),
  };
}

function setOrRemove(root: HTMLElement, name: string, value: string): void {
  if (value === "") {
    root.removeAttribute(`data-${name}`);
  } else {
    root.setAttribute(`data-${name}`, value);
  }
}

/** The one theme for now: the owner put the app on dark only (2026-10-20). The light tokens stay in
 * `tokens.css`, so a theme choice can come back later. */
export const theme = "dark";

/** Puts the look-and-feel preferences on the root element as data attributes (removed when empty). */
export function applyPrefs(prefs: Prefs, root: HTMLElement): void {
  root.setAttribute("data-theme", theme);
  setOrRemove(root, "density", prefs.density);
  setOrRemove(root, "size", prefs.size);
  setOrRemove(root, "motion", prefs.motion);
}

let current: Prefs = defaults;
const listeners = new Set<() => void>();

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** The preferences as they are now. */
export function getPrefs(): Prefs {
  return current;
}

/** Changes one preference: applies it, saves it (a storage error is ignored) and tells subscribers. */
export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
  if (current[key] === value) {
    return;
  }
  current = { ...current, [key]: value };
  if (typeof document !== "undefined") {
    applyPrefs(current, document.documentElement);
  }
  try {
    storage()?.setItem(prefsKey, JSON.stringify(current));
  } catch {
    // The change still holds for this session.
  }
  for (const listener of [...listeners]) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** One preference, kept current: the component re-renders only when this value changes. */
export function usePref<K extends keyof Prefs>(key: K): Prefs[K] {
  return useSyncExternalStore(subscribe, () => current[key]);
}

/** Reads the saved preferences and applies them. Called once before the first render. */
export function initPrefs(): void {
  current = readPrefs(storage());
  if (typeof document !== "undefined") {
    applyPrefs(current, document.documentElement);
  }
  for (const listener of [...listeners]) {
    listener();
  }
}
