/** The list of routes the user has visited, and where they are in it. */
export interface History<R> {
  readonly entries: readonly R[]; // never empty
  readonly index: number;
}

/** How many routes the history keeps; the oldest drops off. */
export const historyLimit = 100;

/** A history that holds one route, the starting one. */
export function startHistory<R>(route: R): History<R> {
  return { entries: [route], index: 0 };
}

/** The route the user is on now. */
export function currentRoute<R>(history: History<R>): R {
  // `index` always points inside `entries`, which is never empty.
  return history.entries[history.index] as R;
}

/** Same object back when `same(current, route)`; otherwise drops forward entries, appends, and drops the oldest past the limit. */
export function pushRoute<R>(
  history: History<R>,
  route: R,
  same: (a: R, b: R) => boolean,
  limit: number = historyLimit,
): History<R> {
  if (same(currentRoute(history), route)) {
    return history;
  }
  const kept = [...history.entries.slice(0, history.index + 1), route];
  const entries = kept.length > limit ? kept.slice(kept.length - limit) : kept;
  return { entries, index: entries.length - 1 };
}

/** One step back (Alt+Left); the same object when already at the start. */
export function stepBack<R>(history: History<R>): History<R> {
  return history.index > 0 ? { entries: history.entries, index: history.index - 1 } : history;
}

/** One step forward (Alt+Right); the same object when already at the end. */
export function stepForward<R>(history: History<R>): History<R> {
  return history.index < history.entries.length - 1
    ? { entries: history.entries, index: history.index + 1 }
    : history;
}

/** Whether there is an earlier route to go back to. */
export function canGoBack(history: History<unknown>): boolean {
  return history.index > 0;
}

/** Whether there is a later route to go forward to. */
export function canGoForward(history: History<unknown>): boolean {
  return history.index < history.entries.length - 1;
}
