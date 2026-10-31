import type { FrameSource } from "@gratovo/core/data";

import { routeFromHash, screens } from "./routes";
import type { Route, ScreenInfo, ScreenKey } from "./routes";
import type { SectionKey } from "./settings";

/**
 * The live gate (ground rule 9, decision D1). On live data the app shows only what is wired to
 * real data: a screen or tab that would show example numbers or a placeholder stays out of the
 * rail, the palette, the G-letters, the URL and the history. On example data everything is shown,
 * as before; prototype mode (step 7) takes example data over. This module is the one place that
 * says what is wired: every way into a screen goes through it.
 */

/** What the live app may show. A screen missing here is hidden; `tabs` lists the tabs it may show. */
export const liveWired = {
  find: ["search", "triage", "gallery", "contacts"],
  reach: ["board", "sequences", "inbox", "mailboxes"],
  close: ["roster"],
  insights: ["overview", "funnel", "emails", "search", "goal"],
  toolbox: ["archive", "never", "scheduled", "log"],
  record: [],
  settings: [
    "profile",
    "appearance",
    "keyboard",
    "notifications",
    "search",
    "writing",
    "connections",
    "prototype",
  ],
} as const satisfies Partial<Record<ScreenKey, readonly string[]>>;

/**
 * Parts inside a shown tab that wait for a later step: shown on example data, hidden on live.
 * Funnel's Brands view, the Overview's revenue tile and the Goal's money field and lines come with
 * deals and money (plan step 9, ADR 0021 D2). The Money tab itself is not in `liveWired`.
 * `record.deals` hides the creator record's Deals tab, and every link to a deal or brand record, until deals are wired (step 9).
 * `insights.deals` is the data side of the same wait: the `deals` table holds legacy deals on live,
 * so Insights reads none of them (deals, brands, their events) until then.
 */
export const liveHiddenParts = [
  "insights.deals",
  "insights.funnel.brands",
  "insights.overview.revenue",
  "insights.goal.money",
  "record.deals",
] as const;

export type GatedPart = (typeof liveHiddenParts)[number];

/** Whether a part of a tab may be shown. */
export function isPartShown(part: GatedPart, source: FrameSource): boolean {
  return source === "example" || !(liveHiddenParts as readonly string[]).includes(part);
}

/** Whether the first-run import has happened. "unknown" holds until the Connections status loads. */
export type ImportState = "unknown" | "never" | "imported";

function liveTabs(screen: ScreenKey): readonly string[] | undefined {
  return Object.hasOwn(liveWired, screen)
    ? (liveWired as Partial<Record<ScreenKey, readonly string[]>>)[screen]
    : undefined;
}

/** Whether the screen may be shown. */
export function isScreenShown(screen: ScreenKey, source: FrameSource): boolean {
  return source === "example" || liveTabs(screen) !== undefined;
}

/** Whether the tab may be shown; a null tab (a screen with no tab chosen) follows the screen. */
export function isTabShown(screen: ScreenKey, tab: string | null, source: FrameSource): boolean {
  if (!isScreenShown(screen, source)) {
    return false;
  }
  if (source === "example" || tab === null) {
    return true;
  }
  return liveTabs(screen)?.includes(tab) ?? false;
}

/** The screen's tabs that may be shown, in order. */
export function shownTabs(screen: ScreenKey, source: FrameSource): ScreenInfo["tabs"] {
  return screens[screen].tabs.filter((t) => isTabShown(screen, t.key, source));
}

/** Whether a Settings section may be shown. */
export function isSettingsSectionShown(section: SectionKey, source: FrameSource): boolean {
  return isTabShown("settings", section, source);
}

/** Whether a route may be shown. */
export function isRouteShown(route: Route, source: FrameSource): boolean {
  return isTabShown(route.screen, route.tab, source);
}

/** The first tab of a screen that may be shown, or null when it has none. */
export function firstShownTab(screen: ScreenKey, source: FrameSource): string | null {
  return shownTabs(screen, source)[0]?.key ?? null;
}

/**
 * Where the app opens, and where a hidden route goes. Example data: Today. Live data: Settings >
 * Connections on a first run (the import has never happened), else Find > Search. While the import
 * state is unknown, Find > Search.
 */
export function defaultRoute(source: FrameSource, importState: ImportState): Route {
  if (source === "example") {
    return { screen: "today", tab: null };
  }
  return importState === "never"
    ? { screen: "settings", tab: "connections" }
    : { screen: "find", tab: "search" };
}

/**
 * The route for a URL hash: `routeFromHash`, then the default route when the screen or tab is
 * hidden. The record page is never restored from a hash, so it also gives the default route.
 */
export function startRoute(hash: string, source: FrameSource, importState: ImportState): Route {
  const route = routeFromHash(hash);
  return isRouteShown(route, source) ? route : defaultRoute(source, importState);
}
