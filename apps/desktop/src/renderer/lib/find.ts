import type { FindState } from "@gratovo/ipc";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

/** The most a keyword may hold, and the most one paste may add: the Find channels' limits. */
export const keywordMax = 200;
export const addMax = 500;

let current: FindState | null = null;
/** Bumped by every state that arrives, so an older answer never replaces a newer event. */
let version = 0;
const listeners = new Set<() => void>();

function setFind(next: FindState | null): void {
  current = next;
  version += 1;
  for (const listener of listeners) {
    listener();
  }
}

export function resetFindForTests(): void {
  setFind(null);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export type FindLoad = "loading" | "ready" | "failed";

/**
 * The Find screen's state. Reads `find:state` when the screen opens, then follows `find:changed`.
 * `reload` asks again after a failure.
 */
export function useFind(): {
  readonly state: FindState | null;
  readonly load: FindLoad;
  readonly reload: () => void;
} {
  const state = useSyncExternalStore(subscribe, () => current);
  const [load, setLoad] = useState<FindLoad>(current === null ? "loading" : "ready");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let stopped = false;
    const off = window.gratovo.on("find:changed", (next) => {
      if (!stopped) {
        setFind(next);
        setLoad("ready");
      }
    });
    const asked = version;
    window.gratovo.invoke("find:state", {}).then(
      (result) => {
        if (stopped) {
          return;
        }
        if (!result.ok) {
          if (current === null) {
            setLoad("failed");
          }
          return;
        }
        if (version === asked) {
          setFind(result.value);
        }
        setLoad("ready");
      },
      () => {
        if (!stopped && current === null) {
          setLoad("failed");
        }
      },
    );
    return () => {
      stopped = true;
      off();
    };
  }, [attempt]);
  const reload = useCallback(() => {
    setLoad("loading");
    setAttempt((n) => n + 1);
  }, []);
  return { state, load, reload };
}

/** The keywords in pasted text: split on new lines and commas, trimmed, blanks dropped. */
export function parseKeywords(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

/** A count as a short word: 950, 50K, 1.2M. */
export function compactCount(n: number): string {
  const trim = (x: number): string => String(Math.round(x * 10) / 10);
  if (n >= 999_950) {
    return `${trim(n / 1_000_000)}M`;
  }
  if (n >= 1000) {
    return `${trim(n / 1000)}K`;
  }
  return String(n);
}
