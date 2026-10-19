import {
  createStore,
  currentRoute,
  pushRoute,
  startHistory,
  stepBack,
  stepForward,
} from "@gratovo/core";
import type { History, Store, StoreState } from "@gratovo/core";
import type { IconName } from "@gratovo/ui";
import { useSyncExternalStore } from "react";

import { exampleData } from "./example-data";
import { firstTab, routeFromHash, routeToHash, sameRoute, screens } from "./routes";
import type { Route, ScreenKey } from "./routes";

/** A person on the team. */
export interface Member {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly status: "online" | "away";
  readonly doing: string;
}

/** One line in the notifications tray. */
export interface Notification {
  readonly id: string;
  readonly at: number;
  readonly icon: IconName;
  readonly text: string;
  readonly sub: string;
  /** Where clicking it goes. */
  readonly go: Route;
  readonly read: boolean;
}

/** The numbers beside the rail items. */
export interface RailCounts {
  readonly today: number;
  readonly plannedMinutes: number;
  readonly find: number;
  readonly reach: number;
  readonly close: number;
  readonly deliver: number;
}

/** One line in the activity log. */
export interface LogEntry {
  readonly id: string;
  readonly at: number;
  readonly who: string;
  readonly text: string;
}

/** The business data: changes to it can be undone. */
export interface AppData {
  /** A member id. */
  readonly me: string;
  /** Null until set in Settings > Profile. */
  readonly myName: string | null;
  readonly team: readonly Member[];
  /** Until the Today engine (step 4) computes them. */
  readonly counts: RailCounts;
  readonly notifications: readonly Notification[];
  readonly log: readonly LogEntry[];
}

/** Something wrong that the problems bar shows. */
export interface Problem {
  readonly key: string;
  readonly text: string;
  readonly sub: string;
  readonly action?: { readonly label: string; readonly run: () => void };
}

/** Where you are and how the frame looks right now: not undoable. */
export interface AppUi {
  readonly history: History<Route>;
  /** The drawer at narrow widths. */
  readonly railOpen: boolean;
  readonly saving: boolean;
  readonly savedAt: number;
  readonly lastTab: Readonly<Partial<Record<ScreenKey, string>>>;
}

/** The whole state the app store holds. */
export type AppState = StoreState<AppData, AppUi>;

/** Makes a store holding the example data, starting on `start`. */
export function createAppStore(start: Route, now: number = Date.now()): Store<AppData, AppUi> {
  return createStore<AppData, AppUi>({
    data: exampleData(now),
    ui: {
      history: startHistory(start),
      railOpen: false,
      saving: false,
      savedAt: now - 40000,
      lastTab: start.tab === null ? {} : { [start.screen]: start.tab },
    },
  });
}

let current: Store<AppData, AppUi> = createAppStore(
  typeof location === "undefined" ? { screen: "today", tab: null } : routeFromHash(location.hash),
);
const resetListeners = new Set<() => void>();

/** The store the app is using now. */
export function appStore(): Store<AppData, AppUi> {
  return current;
}

/** Replaces the app store with a fresh one starting on `start`. Used once at boot (from the URL hash) and by tests. */
export function resetAppStore(start: Route, now: number = Date.now()): void {
  current = createAppStore(start, now);
  for (const listener of [...resetListeners]) {
    listener();
  }
}

/** Subscribes to whichever store is current, and keeps following after a reset. */
function subscribeApp(listener: () => void): () => void {
  let unsubscribe = current.subscribe(listener);
  const onReset = (): void => {
    unsubscribe();
    unsubscribe = current.subscribe(listener);
    listener();
  };
  resetListeners.add(onReset);
  return () => {
    unsubscribe();
    resetListeners.delete(onReset);
  };
}

/**
 * Reads a slice of the state. The component re-renders only when the selected value changes
 * (compared with Object.is), so selectors return primitives or objects already in the state;
 * a derived array or object must be memoized (see `memo`).
 */
export function useApp<T>(selector: (state: AppState) => T): T {
  return useSyncExternalStore(subscribeApp, () => selector(current.getState()));
}

/** Remembers the last answer: recomputes only when the input is a different reference. */
export function memo<A, T>(compute: (input: A) => T): (input: A) => T {
  let has = false;
  let lastInput: A;
  let lastResult: T;
  return (input) => {
    if (!has || !Object.is(lastInput, input)) {
      lastResult = compute(input);
      lastInput = input;
      has = true;
    }
    return lastResult;
  };
}

/** The route the user is on. */
export const selectRoute = (state: AppState): Route => currentRoute(state.ui.history);

const noProblems: readonly Problem[] = [];

/** The problems to show; none until features add them. Always the same empty array. */
export const selectProblems = (): readonly Problem[] => noProblems;

function recordLastTab(ui: { lastTab: Partial<Record<ScreenKey, string>> }, route: Route): void {
  if (route.tab !== null) {
    ui.lastTab[route.screen] = route.tab;
  }
}

/**
 * Opens a screen and adds it to the history (not when it is the route already). An explicit `tab`
 * is used if the screen has it, otherwise the first tab. With no `tab`, the last tab used on that
 * screen, else the first. Closes the narrow drawer. The frame scrolls the content to the top.
 */
export function go(screen: ScreenKey, tab?: string | null): void {
  const store = current;
  const ui = store.getState().ui;
  const tabs = screens[screen].tabs;
  const wanted = tab === undefined ? ui.lastTab[screen] : tab;
  const chosen = wanted != null && tabs.some((t) => t.key === wanted) ? wanted : firstTab(screen);
  const route: Route = { screen, tab: chosen };
  const history = pushRoute(ui.history, route, sameRoute);
  store.ui((draft) => {
    draft.history = history as typeof draft.history; // immer drafts drop `readonly` on arrays
    draft.railOpen = false;
    recordLastTab(draft, route);
  });
}

/** One step back in the app's own history. */
export function back(): void {
  const store = current;
  const history = stepBack(store.getState().ui.history);
  store.ui((draft) => {
    draft.history = history as typeof draft.history; // immer drafts drop `readonly` on arrays
    recordLastTab(draft, currentRoute(history));
  });
}

/** One step forward in the app's own history. */
export function forward(): void {
  const store = current;
  const history = stepForward(store.getState().ui.history);
  store.ui((draft) => {
    draft.history = history as typeof draft.history; // immer drafts drop `readonly` on arrays
    recordLastTab(draft, currentRoute(history));
  });
}

/** Opens or closes the narrow-width drawer. */
export function setRailOpen(open: boolean): void {
  current.ui((draft) => {
    draft.railOpen = open;
  });
}

/**
 * Keeps the URL hash equal to the current route: writes it with `history.replaceState` whenever
 * the route changes (and once now), never on other changes. Returns a function that stops it.
 */
export function installHashSync(): () => void {
  let written: Route | null = null;
  const sync = (): void => {
    const route = selectRoute(current.getState());
    if (written !== null && sameRoute(written, route)) {
      return;
    }
    written = route;
    history.replaceState(null, "", routeToHash(route));
  };
  sync();
  return subscribeApp(sync);
}
