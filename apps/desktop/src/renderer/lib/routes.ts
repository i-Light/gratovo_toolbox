import type { IconName } from "@gratovo/ui";

import { strings } from "../strings";

/** Every screen the rail and the URL can name. */
export type ScreenKey =
  | "today"
  | "find"
  | "reach"
  | "close"
  | "deliver"
  | "insights"
  | "toolbox"
  | "team"
  | "settings"
  | "record";

/** The kinds of record the app keeps. */
export type RecordKind = "creator" | "brand" | "deal";

/** Names one record: its kind and its id. */
export interface RecordRef {
  readonly kind: RecordKind;
  readonly id: string;
}

/** Where the user is: a screen and, for screens with tabs, one of its tabs. */
export interface Route {
  readonly screen: ScreenKey;
  readonly tab: string | null;
  /** Only on the "record" screen: the record shown. */
  readonly record?: RecordRef;
  /** The screen a record was opened from. */
  readonly from?: ScreenKey;
}

/** What the frame knows about a screen. */
export interface ScreenInfo {
  readonly name: string;
  readonly sub: string | null;
  readonly icon: IconName;
  /** A CSS value, e.g. "var(--find)". */
  readonly hue: string;
  /** Empty when the screen has no tabs. */
  readonly tabs: readonly { readonly key: string; readonly name: string }[];
}

function tabList(tabs: Readonly<Record<string, string>>): ScreenInfo["tabs"] {
  return Object.entries(tabs).map(([key, name]) => ({ key, name }));
}

function screen(key: ScreenKey, icon: IconName, hue: string): ScreenInfo {
  const words: {
    readonly name: string;
    readonly sub: string | null;
    readonly tabs: Readonly<Record<string, string>>;
  } = strings.screens[key];
  return { name: words.name, sub: words.sub, icon, hue, tabs: tabList(words.tabs) };
}

/** Names and tabs come from strings.ts; icons and hues are the prototype's. */
export const screens: Readonly<Record<ScreenKey, ScreenInfo>> = {
  today: screen("today", "sun", "var(--accent)"),
  find: screen("find", "scan", "var(--find)"),
  reach: screen("reach", "send", "var(--reach)"),
  close: screen("close", "pen", "var(--close)"),
  deliver: screen("deliver", "box", "var(--deliver)"),
  insights: screen("insights", "chart", "var(--ink-2)"),
  toolbox: screen("toolbox", "wrench", "var(--ink-2)"),
  team: screen("team", "users", "var(--ink-2)"),
  settings: screen("settings", "gear", "var(--ink-2)"),
  record: screen("record", "user", "var(--ink-2)"),
};

/** The screens in the order the rail lists them (the record page is not one of them). */
export const screenOrder: readonly ScreenKey[] = [
  "today",
  "find",
  "reach",
  "close",
  "deliver",
  "insights",
  "toolbox",
  "team",
  "settings",
];

/** The letter that follows G to jump to a screen ("G then R" opens Reach). */
export const goLetters: Readonly<Record<string, ScreenKey>> = {
  t: "today",
  f: "find",
  r: "reach",
  c: "close",
  d: "deliver",
  i: "insights",
  x: "toolbox",
  m: "team",
  s: "settings",
};

function isScreenKey(value: string): value is ScreenKey {
  return Object.hasOwn(screens, value);
}

/** The first tab of a screen, or null when it has none. */
export function firstTab(screen: ScreenKey): string | null {
  return screens[screen].tabs[0]?.key ?? null;
}

/** True when both routes point at the same screen, tab and record. */
export function sameRoute(a: Route, b: Route): boolean {
  return (
    a.screen === b.screen &&
    a.tab === b.tab &&
    a.record?.kind === b.record?.kind &&
    a.record?.id === b.record?.id &&
    a.from === b.from
  );
}

/** The URL hash for a route: "#/today", "#/find/triage" or "#/record/creator/c1". */
export function routeToHash(route: Route): string {
  if (route.screen === "record" && route.record !== undefined) {
    return `#/record/${route.record.kind}/${route.record.id}`;
  }
  return route.tab === null ? `#/${route.screen}` : `#/${route.screen}/${route.tab}`;
}

/**
 * Reads a URL hash. Accepts "#/screen", "#/screen/tab" and the prototype's old "#screen". An unknown
 * screen gives Today; an unknown tab gives the screen's first tab. A record page is not restored
 * from the hash (as in the prototype), so "#/record/..." gives Today.
 */
export function routeFromHash(hash: string): Route {
  const [first = "", second = ""] = hash.replace(/^#\/?/, "").split("/");
  if (!isScreenKey(first) || first === "record") {
    return { screen: "today", tab: null };
  }
  const known = screens[first].tabs.some((tab) => tab.key === second);
  return { screen: first, tab: known ? second : firstTab(first) };
}
