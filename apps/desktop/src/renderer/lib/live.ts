import type { FramePart, SyncStatus } from "@gratovo/ipc";
import type { Bridge } from "@gratovo/ipc/bridge";

import { toAppData } from "./frame";
import { adoptServerData, onPersistenceIdle, persistenceIdle } from "./persist";
import type { DataDraft } from "./persist";
import { appStore } from "./store";
import type { AppData } from "./store";

/** The most often the page asks main for a fresh frame. */
const askEveryMs = 1000;
/** The activity log keeps this many lines, newest first (the frame's size). */
const logKept = 50;
/** The frame lists at most this many creators; a creator missing from a full list may still exist. */
const listCap = 5000;

function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => sameValue(item, b[i]))
    );
  }
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = Object.keys(x);
  return keys.length === Object.keys(y).length && keys.every((k) => sameValue(x[k], y[k]));
}

/** The list to put in place of `current`, or null when it would not change; unchanged items keep their reference. */
function replaceList<T extends { readonly id: string }>(
  current: readonly T[],
  next: readonly T[],
  keepMissing: boolean,
): readonly T[] | null {
  const byId = new Map(current.map((item) => [item.id, item]));
  const merged = next.map((item) => {
    const was = byId.get(item.id);
    return was !== undefined && sameValue(was, item) ? was : item;
  });
  if (keepMissing) {
    const have = new Set(next.map((item) => item.id));
    for (const item of current) {
      if (!have.has(item.id)) {
        merged.push(item);
      }
    }
  }
  const same = merged.length === current.length && merged.every((item, i) => item === current[i]);
  return same ? null : merged;
}

function mergeLog(draft: DataDraft, next: AppData): void {
  const incoming = new Set(next.log.map((line) => line.id));
  // Your own lines stay as they are; a teammate's line the server no longer has goes.
  const kept = draft.log.filter((line) => line.who === draft.me || incoming.has(line.id));
  const have = new Set(kept.map((line) => line.id));
  const added = next.log.filter((line) => !have.has(line.id));
  const merged = [...kept, ...added].sort((a, b) => b.at - a.at).slice(0, logKept);
  const same =
    merged.length === draft.log.length && merged.every((line, i) => line === draft.log[i]);
  if (!same) {
    draft.log = merged;
  }
}

/**
 * Folds the server's answer into the page's data: the team, the conflicts and the money switch are
 * replaced; creators, brands and deals are replaced by id (a record missing from the answer goes,
 * except from a full creator list, which is cut off); the log gets the teammates' new lines and
 * loses their lines that are gone (yours stay); `myName` follows only when `parts` names `me`, and
 * the notifications and their switches only when it names `notify`. Unchanged values keep their
 * reference, so nothing re-renders for nothing.
 */
export function mergeServerData(
  draft: DataDraft,
  next: AppData,
  parts: ReadonlySet<FramePart>,
): void {
  if (draft.seesMoney !== next.seesMoney) {
    draft.seesMoney = next.seesMoney;
  }
  if (!sameValue(draft.team, next.team)) {
    draft.team = next.team as typeof draft.team;
  }
  if (!sameValue(draft.conflicts, next.conflicts)) {
    draft.conflicts = next.conflicts as typeof draft.conflicts;
  }
  const creators = replaceList(draft.creators, next.creators, next.creators.length >= listCap);
  if (creators !== null) {
    draft.creators = creators as typeof draft.creators;
  }
  const brands = replaceList(draft.brands, next.brands, false);
  if (brands !== null) {
    draft.brands = brands as typeof draft.brands;
  }
  const deals = replaceList(draft.deals, next.deals, false);
  if (deals !== null) {
    draft.deals = deals as typeof draft.deals;
  }
  if (parts.has("log")) {
    mergeLog(draft, next);
  }
  if (parts.has("me") && draft.myName !== next.myName) {
    draft.myName = next.myName;
  }
  if (parts.has("notify")) {
    if (!sameValue(draft.settings.notify, next.settings.notify)) {
      draft.settings.notify = next.settings.notify;
    }
    if (!sameValue(draft.notifications, next.notifications)) {
      draft.notifications = next.notifications as typeof draft.notifications;
    }
  }
}

/** Puts each listed member's status and what they are doing on the team; others stay as they are. */
export function mergePresence(
  draft: DataDraft,
  members: readonly {
    readonly id: string;
    readonly status: "online" | "away";
    readonly doing: string;
  }[],
): void {
  const byId = new Map(members.map((m) => [m.id, m]));
  draft.team.forEach((person, i) => {
    const seen = byId.get(person.id);
    if (seen !== undefined && (person.status !== seen.status || person.doing !== seen.doing)) {
      draft.team[i] = { ...person, status: seen.status, doing: seen.doing };
    }
  });
}

/**
 * Keeps the page in step with main: a `frame:changed` makes it ask for the frame (when the
 * persister is idle, at most once a second) and fold the answer in without writing it back; a
 * `sync:status` goes to the UI state; a `presence:changed` updates each listed member's status and
 * what they are doing (nothing is written). The answer is dropped, and asked for again, when the data
 * changed while it was on its way. Returns a function that stops it.
 */
export function installLiveUpdates(bridge: Pick<Bridge, "invoke" | "on">): () => void {
  let stopped = false;
  let wanted = new Set<FramePart>();
  let busy = false;
  let waiting = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastAskedAt = Number.NEGATIVE_INFINITY;

  const ask = async (): Promise<void> => {
    busy = true;
    lastAskedAt = Date.now();
    const parts = wanted;
    wanted = new Set();
    const store = appStore();
    const noted = store.getState().data;
    try {
      const loaded = await bridge.invoke("frame:load", {});
      if (stopped) {
        return;
      }
      if (!loaded.ok) {
        console.error("The page couldn't read the server's changes:", loaded.reason);
        return;
      }
      if (appStore() !== store || store.getState().data !== noted || !persistenceIdle()) {
        for (const part of parts) {
          wanted.add(part);
        }
        return;
      }
      const next = toAppData(loaded.value);
      adoptServerData((draft) => {
        mergeServerData(draft, next, parts);
      });
    } catch (reason) {
      console.error("The page couldn't read the server's changes:", reason);
    } finally {
      busy = false;
      later();
    }
  };

  function later(): void {
    if (stopped || busy || waiting || timer !== null || wanted.size === 0) {
      return;
    }
    if (!persistenceIdle()) {
      waiting = true;
      onPersistenceIdle(() => {
        waiting = false;
        later();
      });
      return;
    }
    const wait = lastAskedAt + askEveryMs - Date.now();
    if (wait > 0) {
      timer = setTimeout(() => {
        timer = null;
        later();
      }, wait);
      return;
    }
    void ask();
  }

  const offFrame = bridge.on("frame:changed", (payload) => {
    for (const part of payload.parts) {
      wanted.add(part);
    }
    later();
  });
  const setStatus = (status: SyncStatus): void => {
    appStore().ui((draft) => {
      draft.sync = status;
    });
  };
  const offStatus = bridge.on("sync:status", setStatus);
  const offPresence = bridge.on("presence:changed", (payload) => {
    if (!stopped) {
      adoptServerData((draft) => {
        mergePresence(draft, payload.members);
      });
    }
  });
  void bridge.invoke("sync:status", {}).then(
    (result) => {
      if (!stopped && result.ok) {
        setStatus(result.value);
      }
    },
    () => undefined,
  );

  return () => {
    stopped = true;
    offFrame();
    offStatus();
    offPresence();
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
}
