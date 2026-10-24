import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import { isTyping, useKeys } from "./keys";
import { appStore } from "./store";

interface Held {
  readonly ids: ReadonlySet<string>;
  /** The id picked last: the other end of a Shift range. */
  readonly last: string | null;
  readonly compare: boolean;
}

const none: Held = { ids: new Set(), last: null, compare: false };

/** What a click on a card or row carries; only the Shift key changes the pick. */
export interface PickInput {
  readonly shiftKey: boolean;
}

export interface FindSelection {
  readonly ids: ReadonlySet<string>;
  readonly count: number;
  /** True while Compare is open and 2 to 4 channels are still selected. */
  readonly comparing: boolean;
  /** Toggles one id, or with Shift selects the range from the last pick (loaded order, D19). */
  readonly pick: (id: string, input: PickInput) => void;
  /** Selects every loaded id. */
  readonly selectAll: () => void;
  /** Empties the selection and closes Compare. */
  readonly clear: () => void;
  readonly openCompare: () => void;
  readonly closeCompare: () => void;
}

/** True while the creator peek is open: its keys and text are not the gallery's. */
function peekOpen(): boolean {
  return appStore().getState().ui.peek !== null;
}

/** True when the key press came from inside the peek panel. */
function inPeek(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(".peek") !== null;
}

/** Compare takes 2 to 4 channels. */
export const compareMin = 2;
export const compareMax = 4;

/**
 * The gallery's selection (D19), kept by id so it survives a re-sort. `order` is the loaded ids in
 * display order; ids that are no longer loaded drop out. Esc clears (and closes Compare) and Ctrl A
 * selects every loaded id, neither while a field has the focus.
 */
export function useFindSelection(order: readonly string[], ready = true): FindSelection {
  const [held, setHeld] = useState<Held>(none);
  const orderRef = useRef(order);
  useLayoutEffect(() => {
    orderRef.current = order;
  });

  // Drop what is no longer loaded (adjusted while rendering, so no frame shows a stale count).
  let current = held;
  if (ready && (held.ids.size > 0 || held.compare)) {
    const loaded = new Set(order);
    const kept = [...held.ids].filter((id) => loaded.has(id));
    if (kept.length !== held.ids.size) {
      current = {
        ids: new Set(kept),
        last: held.last !== null && loaded.has(held.last) ? held.last : null,
        compare: held.compare,
      };
      setHeld(current);
    }
  }

  // Compare shows only while 2 to 4 are selected: once the selection leaves that range it closes
  // (and stays closed if the selection comes back).
  if (current.compare && (current.ids.size < compareMin || current.ids.size > compareMax)) {
    current = { ...current, compare: false };
    setHeld(current);
  }

  const pick = useCallback((id: string, input: PickInput): void => {
    setHeld((cur) => {
      const order = orderRef.current;
      const ids = new Set(cur.ids);
      const from = cur.last === null ? -1 : order.indexOf(cur.last);
      const to = order.indexOf(id);
      if (input.shiftKey && from >= 0 && to >= 0) {
        for (let i = Math.min(from, to); i <= Math.max(from, to); i++) {
          const between = order[i];
          if (between !== undefined) {
            ids.add(between);
          }
        }
      } else if (ids.has(id)) {
        ids.delete(id);
      } else {
        ids.add(id);
      }
      return { ids, last: id, compare: cur.compare };
    });
  }, []);
  const selectAll = useCallback((): void => {
    setHeld((cur) => ({ ids: new Set(orderRef.current), last: cur.last, compare: cur.compare }));
  }, []);
  const clear = useCallback((): void => {
    setHeld(none);
  }, []);
  const openCompare = useCallback((): void => {
    setHeld((cur) => ({ ...cur, compare: true }));
  }, []);
  const closeCompare = useCallback((): void => {
    setHeld((cur) => ({ ...cur, compare: false }));
  }, []);

  const count = current.ids.size;
  useKeys({
    escape: (event) => {
      // An open peek has its own Esc: it closes first, and the selection waits for the next press.
      if (isTyping(event.target) || peekOpen() || (count === 0 && !current.compare)) {
        return false;
      }
      clear();
      return true;
    },
    "mod+a": (event) => {
      if (isTyping(event.target) || peekOpen() || inPeek(event.target)) {
        return false;
      }
      event.preventDefault();
      selectAll();
      return true;
    },
  });

  const comparing = current.compare && count >= compareMin && count <= compareMax;
  return useMemo(
    () => ({
      ids: current.ids,
      count,
      comparing,
      pick,
      selectAll,
      clear,
      openCompare,
      closeCompare,
    }),
    [current.ids, count, comparing, pick, selectAll, clear, openCompare, closeCompare],
  );
}
