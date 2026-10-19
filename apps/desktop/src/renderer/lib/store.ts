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

import { strings } from "../strings";
import { exampleData } from "./example-data";
import { getPrefs } from "./prefs";
import { firstTab, routeFromHash, routeToHash, sameRoute, screens } from "./routes";
import type { RecordRef, Route, ScreenKey } from "./routes";
import type { NotifyKind, RowId } from "./settings";

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

/** Where a creator is on the way to signing. */
export type CreatorStage =
  | "new"
  | "shortlisted"
  | "contact"
  | "emailed"
  | "replied"
  | "kit"
  | "audience"
  | "signed"
  | "rejected"
  | "parked"
  | "never";

/** A YouTube creator the agency finds and signs. */
export interface Creator {
  readonly id: string;
  readonly name: string;
  readonly handle: string;
  readonly stage: CreatorStage;
  readonly email: string | null;
}

/** A company that sponsors creators. */
export interface Brand {
  readonly id: string;
  readonly name: string;
  /** What the brand sells, in a few words. */
  readonly sells: string;
  /** Where the brand is: found, qualified, pitched, negotiating or won. */
  readonly status: string;
}

/** A sponsorship between one brand and one creator. */
export interface Deal {
  readonly id: string;
  /** A brand id. */
  readonly brand: string;
  /** A creator id. */
  readonly creator: string;
  /** An index into DEAL_FLOW. */
  readonly step: number;
  /** What the brand pays, in dollars. */
  readonly price: number;
}

/** A teammate's search that is running now. */
export interface MateRun {
  /** A member id. */
  readonly by: string;
  readonly at: number;
  readonly current: number;
  readonly total: number;
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
  readonly creators: readonly Creator[];
  readonly brands: readonly Brand[];
  readonly deals: readonly Deal[];
  readonly mateRun: MateRun | null;
  /** Team-wide settings. A notification kind is on unless it is false here. */
  readonly settings: { readonly notify: Readonly<Partial<Record<NotifyKind, boolean>>> };
}

/** A button on a toast. */
export interface ToastAction {
  readonly label: string;
  readonly kbd?: string;
  readonly run: () => void;
}

/** A short message at the corner of the window. */
export interface Toast {
  readonly id: string;
  readonly msg: string;
  readonly sub?: string;
  readonly icon: IconName;
  readonly tone: "good" | "info";
  /** Milliseconds before it goes away by itself. */
  readonly ms: number;
  readonly actions: readonly ToastAction[];
}

/** One row of a dropdown menu. */
export type MenuItem =
  | {
      readonly kind: "item";
      readonly label: string;
      readonly icon?: IconName;
      readonly hint?: string;
      readonly danger?: boolean;
      readonly checked?: boolean;
      readonly run: () => void;
    }
  | { readonly kind: "separator" }
  | { readonly kind: "heading"; readonly label: string }
  | {
      readonly kind: "who";
      readonly name: string;
      readonly sub: string;
      readonly color: string;
      readonly unnamed: boolean;
      readonly run: () => void;
    };

/** A dropdown menu that is open: where it sits and what it holds. */
export interface OpenMenu {
  /** The menu's accessible name; it also tells which menu is open (the account button's `aria-expanded`). */
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly right: number;
  readonly top: number;
  readonly align: "start" | "end";
  readonly items: readonly MenuItem[];
}

/** The side panel showing a record; `list` is the ids it can step through. */
export interface Peek {
  readonly record: RecordRef;
  readonly list: readonly string[] | null;
}

/** A background job shown in the jobs tray. */
export interface Job {
  readonly id: string;
  readonly kind: "search" | "contacts";
  readonly label: string;
  readonly progress: number;
  readonly total: number;
  readonly done: boolean;
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
  readonly palette: boolean;
  readonly shortcuts: boolean;
  readonly tray: "jobs" | "notifications" | null;
  readonly menu: OpenMenu | null;
  readonly peek: Peek | null;
  readonly toasts: readonly Toast[];
  /** Records opened lately, newest first, at most 8. */
  readonly recent: readonly RecordRef[];
  readonly jobs: readonly Job[];
  /** The setting that just saved, for its "Saved" mark. */
  readonly settingFlash: { readonly id: RowId; readonly at: number } | null;
  /** The setting to scroll to, highlight and focus once its section shows. */
  readonly settingTarget: RowId | null;
}

/** The whole state the app store holds. */
export type AppState = StoreState<AppData, AppUi>;

/** The data with `myName` taken from the saved `name` preference (null when none is saved). */
function withSavedName(data: AppData): AppData {
  const name = getPrefs().name;
  return name === "" ? data : { ...data, myName: name };
}

/** Makes a store holding the example data, starting on `start`. */
export function createAppStore(start: Route, now: number = Date.now()): Store<AppData, AppUi> {
  return createStore<AppData, AppUi>({
    data: withSavedName(exampleData(now)),
    ui: {
      history: startHistory(start),
      railOpen: false,
      saving: false,
      savedAt: now - 40000,
      lastTab: start.tab === null ? {} : { [start.screen]: start.tab },
      palette: false,
      shortcuts: false,
      tray: null,
      menu: null,
      peek: null,
      toasts: [],
      recent: [],
      jobs: [],
      settingFlash: null,
      settingTarget: null,
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

/**
 * Tests only: replaces the app store with a fresh one starting on `start`. The app itself makes its
 * store once, when this module loads, from the URL hash; replacing it would drop undo and history.
 */
export function resetAppStoreForTests(start: Route, now: number = Date.now()): void {
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

/**
 * The record a reference names, or undefined when there is none. Returns the object that is in the
 * state, so the answer is the same reference until that record changes.
 */
export function findRecord(data: AppData, ref: RecordRef): Creator | Brand | Deal | undefined {
  const list: readonly (Creator | Brand | Deal)[] =
    ref.kind === "creator" ? data.creators : ref.kind === "brand" ? data.brands : data.deals;
  return list.find((record) => record.id === ref.id);
}

/** A deal's name: "Codewell × Code with Kai" ("?" for a side that is missing). */
export function dealName(data: AppData, deal: Deal): string {
  const brand = data.brands.find((b) => b.id === deal.brand)?.name ?? strings.record.unknownName;
  const creator =
    data.creators.find((c) => c.id === deal.creator)?.name ?? strings.record.unknownName;
  return strings.record.dealName(brand, creator);
}

/** What to call a record: a creator's or brand's name, a deal's two names, or "?" when it is missing. */
export function recordName(data: AppData, ref: RecordRef): string {
  const record = findRecord(data, ref);
  if (record === undefined) {
    return strings.record.unknownName;
  }
  return "brand" in record ? dealName(data, record) : record.name;
}

const noProblems: readonly Problem[] = [];

/** The problems to show; none until features add them. Always the same empty array. */
export const selectProblems = (): readonly Problem[] => noProblems;

function recordLastTab(ui: { lastTab: Partial<Record<ScreenKey, string>> }, route: Route): void {
  if (route.tab !== null) {
    ui.lastTab[route.screen] = route.tab;
  }
}

/** Extras for `go`. */
export interface GoOptions {
  /** Leave the peek panel open (the default closes it). */
  readonly keepPeek?: boolean;
  /** For the "record" screen: the record to show. */
  readonly record?: RecordRef;
  /** For the "record" screen: the screen it was opened from. */
  readonly from?: ScreenKey;
}

/**
 * Opens a screen and adds it to the history (not when it is the route already). An explicit `tab`
 * is used if the screen has it, otherwise the first tab. With no `tab`, the last tab used on that
 * screen, else the first. Closes the narrow drawer; when the route changes it also closes any open
 * menu, and the peek unless `options.keepPeek` (staying put keeps them, as in the prototype).
 * `options.record` and `options.from` make the record page's route. The frame scrolls the content
 * to the top.
 */
export function go(screen: ScreenKey, tab?: string | null, options: GoOptions = {}): void {
  const store = current;
  const ui = store.getState().ui;
  const tabs = screens[screen].tabs;
  const wanted = tab === undefined ? ui.lastTab[screen] : tab;
  const chosen = wanted != null && tabs.some((t) => t.key === wanted) ? wanted : firstTab(screen);
  const route: Route = {
    screen,
    tab: chosen,
    ...(options.record === undefined ? {} : { record: options.record }),
    ...(options.from === undefined ? {} : { from: options.from }),
  };
  const history = pushRoute(ui.history, route, sameRoute);
  const moved = history !== ui.history;
  store.ui((draft) => {
    draft.history = history as typeof draft.history; // immer drafts drop `readonly` on arrays
    draft.railOpen = false;
    if (moved) {
      draft.menu = null;
      if (options.keepPeek !== true) {
        draft.peek = null;
      }
    }
    recordLastTab(draft, route);
  });
}

/** Moves through the app's own history; closes the peek when it actually moves. */
function stepHistory(step: typeof stepBack): void {
  const store = current;
  const before = store.getState().ui.history;
  const history = step(before);
  if (history === before) {
    return;
  }
  store.ui((draft) => {
    draft.history = history as typeof draft.history; // immer drafts drop `readonly` on arrays
    draft.peek = null;
    recordLastTab(draft, currentRoute(history));
  });
}

/** One step back in the app's own history (nothing at the start). Closes the peek. */
export function back(): void {
  stepHistory(stepBack);
}

/** One step forward in the app's own history (nothing at the end). Closes the peek. */
export function forward(): void {
  stepHistory(stepForward);
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
