import type { DataWrite } from "@gratovo/core/data";
import type { Bridge } from "@gratovo/ipc/bridge";

import { strings } from "../strings";
import { appStore, subscribeApp } from "./store";
import type { AppData, Notification } from "./store";
import { toast } from "./toast";

/** The most writes one `data:write` call takes (the IPC schema refuses more). */
const maxBatch = 100;

/** The fields the write vocabulary cannot express yet: a change to one is reported, not written. */
const unsupportedFields = [
  "me",
  "team",
  "counts",
  "creators",
  "brands",
  "deals",
  "mateRun",
] as const satisfies readonly (keyof AppData)[];

/** True when two notifications differ in anything but `read` (the store keeps unchanged parts by reference). */
function changedBeyondRead(a: Notification, b: Notification): boolean {
  return (
    a.at !== b.at || a.icon !== b.icon || a.text !== b.text || a.sub !== b.sub || a.go !== b.go
  );
}

function diffNotifications(
  before: readonly Notification[],
  after: readonly Notification[],
  writes: DataWrite[],
): boolean {
  const old = new Map(before.map((n) => [n.id, n]));
  if (old.size !== after.length) {
    return false;
  }
  const reads: DataWrite[] = [];
  for (const n of after) {
    const was = old.get(n.id);
    if (was === undefined || changedBeyondRead(was, n)) {
      return false;
    }
    if (was.read !== n.read) {
      reads.push({ kind: "notification.read", id: n.id, read: n.read });
    }
  }
  writes.push(...reads);
  return true;
}

function diffLog(before: AppData["log"], after: AppData["log"], writes: DataWrite[]): boolean {
  const old = new Map(before.map((l) => [l.id, l]));
  const kept = new Set<string>();
  const added: DataWrite[] = [];
  for (const line of after) {
    const was = old.get(line.id);
    if (was === undefined) {
      added.push({ kind: "log.add", id: line.id, at: line.at, text: line.text });
    } else if (was !== line) {
      return false;
    } else {
      kept.add(line.id);
    }
  }
  for (const line of before) {
    if (!kept.has(line.id)) {
      writes.push({ kind: "log.remove", id: line.id });
    }
  }
  // The log is newest first; written oldest first, as the lines were made.
  writes.push(...added.reverse());
  return true;
}

/**
 * The writes that turn `before` into `after`, compared by reference (the store shares unchanged
 * parts, so nothing changed costs one comparison). A change the write vocabulary cannot express
 * is named in `unsupported` and not written.
 */
export function diffData(
  before: AppData,
  after: AppData,
): { writes: DataWrite[]; unsupported: string[] } {
  const writes: DataWrite[] = [];
  const unsupported: string[] = [];
  if (before === after) {
    return { writes, unsupported };
  }
  if (
    before.notifications !== after.notifications &&
    !diffNotifications(before.notifications, after.notifications, writes)
  ) {
    unsupported.push("notifications");
  }
  if (before.settings.notify !== after.settings.notify) {
    writes.push({ kind: "notify.set", notify: after.settings.notify });
  }
  if (before.myName !== after.myName) {
    writes.push({ kind: "me.name", name: after.myName ?? "" });
  }
  if (before.log !== after.log && !diffLog(before.log, after.log, writes)) {
    unsupported.push("log");
  }
  for (const field of unsupportedFields) {
    if (before[field] !== after[field]) {
      unsupported.push(field);
    }
  }
  return { writes, unsupported };
}

/** Batches waiting to go, oldest first; at most one more is in flight. */
const queue: DataWrite[][] = [];
let inFlight = false;
let idleListeners: (() => void)[] = [];

/** True when no write is waiting or in flight. */
export function persistenceIdle(): boolean {
  return !inFlight && queue.length === 0;
}

/** Runs `listener` once the writes are done: now when nothing is pending, else when the queue empties. */
export function onPersistenceIdle(listener: () => void): void {
  if (persistenceIdle()) {
    listener();
  } else {
    idleListeners.push(listener);
  }
}

function sendNext(invoke: Bridge["invoke"]): void {
  if (inFlight) {
    return;
  }
  const batch = queue.shift();
  if (batch === undefined) {
    const listeners = idleListeners;
    idleListeners = [];
    for (const listener of listeners) {
      listener();
    }
    return;
  }
  inFlight = true;
  const failed = (reason: unknown): void => {
    console.error("A change wasn't saved:", reason);
    toast({ msg: strings.saveFailed.title, sub: strings.saveFailed.sub, icon: "alert" });
  };
  invoke("data:write", { writes: batch })
    .then((result) => {
      if (!result.ok) {
        failed(result.reason);
      }
    }, failed)
    .finally(() => {
      inFlight = false;
      sendNext(invoke);
    });
}

/**
 * Saves every change to the data through `data:write`: after each store change (act, undo, redo,
 * bg) it diffs the data against the data it last saw and queues the writes. Batches go out in
 * order, one in flight at a time. A failed batch shows a toast and is not retried. The starting
 * data, and the data of a store that replaces it (`initAppStore`), count as saved. Returns a
 * function that stops listening (writes already queued still go out).
 */
export function installPersistence(invoke: Bridge["invoke"]): () => void {
  let store = appStore();
  let saved = store.getState().data;
  return subscribeApp(() => {
    const current = appStore();
    const data = current.getState().data;
    if (current !== store) {
      // A new store holds data that came from the database: nothing to write.
      store = current;
      saved = data;
      return;
    }
    if (data === saved) {
      return;
    }
    const { writes, unsupported } = diffData(saved, data);
    saved = data;
    if (unsupported.length > 0) {
      console.error(`Not saved: no write exists yet for a change to ${unsupported.join(", ")}`);
    }
    for (let i = 0; i < writes.length; i += maxBatch) {
      queue.push(writes.slice(i, i + maxBatch));
    }
    sendNext(invoke);
  });
}
