import type { IconName } from "@gratovo/ui";

import { strings } from "../strings";

/** Every screen the rail and the URL can name. */
export type ScreenKey =
  "today" | "find" | "reach" | "close" | "deliver" | "insights" | "toolbox" | "team" | "settings";

/** Where the user is: a screen and, for screens with tabs, one of its tabs. */
export interface Route {
  readonly screen: ScreenKey;
  readonly tab: string | null;
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
};

/** The screens in the order the rail lists them. */
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

/** True when both routes point at the same screen and tab. */
export function sameRoute(a: Route, b: Route): boolean {
  return a.screen === b.screen && a.tab === b.tab;
}

/** The URL hash for a route: "#/today" or "#/find/triage". */
export function routeToHash(route: Route): string {
  return route.tab === null ? `#/${route.screen}` : `#/${route.screen}/${route.tab}`;
}

/**
 * Reads a URL hash. Accepts "#/screen", "#/screen/tab" and the prototype's old "#screen". An unknown
 * screen gives Today; an unknown tab gives the screen's first tab.
 */
export function routeFromHash(hash: string): Route {
  const [first = "", second = ""] = hash.replace(/^#\/?/, "").split("/");
  if (!isScreenKey(first)) {
    return { screen: "today", tab: null };
  }
  const known = screens[first].tabs.some((tab) => tab.key === second);
  return { screen: first, tab: known ? second : firstTab(first) };
}
