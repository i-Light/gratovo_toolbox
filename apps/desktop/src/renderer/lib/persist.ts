import type { Store } from "@gratovo/core";
import type { DataWrite } from "@gratovo/core/data";
import type { Bridge } from "@gratovo/ipc/bridge";

import { strings } from "../strings";
import { appStore, subscribeApp } from "./store";
import type { AppData, AppUi, Notification } from "./store";
import { toast } from "./toast";

/** The most writes one `data:write` call takes (the IPC schema refuses more). */
const maxBatch = 100;

/** The fields the write vocabulary cannot express yet: a change to one is reported, not written. */
const unsupportedFields = [
  "me",
  "team",
  "counts",
  "mateRun",
  "conflicts",
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
      added.push({
        kind: "log.add",
        id: line.id,
        at: line.at,
        text: line.text,
        ref: line.ref,
        action: line.action,
        detail: line.detail,
      });
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

/** True when every key of `a` and `b` other than those in `skip` holds the same value. */
function sameBut<T extends object>(a: T, b: T, ...skip: (keyof T)[]): boolean {
  for (const key of Object.keys(a) as (keyof T)[]) {
    if (!skip.includes(key) && a[key] !== b[key]) {
      return false;
    }
  }
  return true;
}

/**
 * Turns a change to a list of records into writes: `change` gives the write for a record that
 * differs (or is new), or null when the difference cannot be written. A removed record cannot be
 * written. Returns false (and adds nothing) when any difference cannot be written.
 */
function diffRecords<T extends { readonly id: string }>(
  before: readonly T[],
  after: readonly T[],
  change: (was: T | undefined, now: T) => DataWrite | null | undefined,
  writes: DataWrite[],
): boolean {
  const old = new Map(before.map((r) => [r.id, r]));
  const found: DataWrite[] = [];
  const seen = new Set<string>();
  for (const now of after) {
    const was = old.get(now.id);
    seen.add(now.id);
    if (was === now) {
      continue;
    }
    const write = change(was, now);
    if (write === null) {
      return false;
    }
    if (write !== undefined) {
      found.push(write);
    }
  }
  if (before.some((r) => !seen.has(r.id))) {
    return false;
  }
  writes.push(...found);
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
  if (
    before.creators !== after.creators &&
    !diffRecords(
      before.creators,
      after.creators,
      (was, now) => {
        // The reject reason and time move with the stage; on their own they write nothing.
        if (was === undefined || !sameBut(was, now, "stage", "rejectReason", "rejectedAt")) {
          return null;
        }
        return was.stage === now.stage
          ? undefined
          : // The handle and the name let main create the row for a channel it has none for (D4).
            {
              kind: "creator.stage",
              id: now.id,
              stage: now.stage,
              handle: now.handle,
              name: now.name,
              ...(now.stage === "rejected" && now.rejectReason !== null
                ? { reason: now.rejectReason }
                : {}),
            };
      },
      writes,
    )
  ) {
    unsupported.push("creators");
  }
  if (
    before.brands !== after.brands &&
    !diffRecords(
      before.brands,
      after.brands,
      (was, now) =>
        was !== undefined &&
        was.name === now.name &&
        was.sells === now.sells &&
        was.status === now.status
          ? undefined
          : { kind: "brand.set", id: now.id, name: now.name, sells: now.sells, status: now.status },
      writes,
    )
  ) {
    unsupported.push("brands");
  }
  if (
    before.deals !== after.deals &&
    !diffRecords(
      before.deals,
      after.deals,
      (was, now) => {
        if (was === undefined || !sameBut(was, now, "step")) {
          return null;
        }
        return was.step === now.step
          ? undefined
          : { kind: "deal.step", id: now.id, step: now.step };
      },
      writes,
    )
  ) {
    unsupported.push("deals");
  }
  for (const field of unsupportedFields) {
    if (before[field] !== after[field]) {
      unsupported.push(field);
    }
  }
  // After the records: a line naming a creator is written once main holds that creator's row (D4),
  // so its label is the channel's name, not its id.
  if (before.log !== after.log && !diffLog(before.log, after.log, writes)) {
    unsupported.push("log");
  }
  return { writes, unsupported };
}

/** The editable view of the data a recipe receives (immer's draft, which the app does not import itself). */
export type DataDraft = Parameters<Parameters<Store<AppData, AppUi>["bg"]>[0]>[0];

/** True while `adoptServerData` runs: the persister takes the result as saved and writes nothing. */
let adopting = false;

/**
 * Applies data that came from the server (a teammate's change): to the current data and to every
 * undo and redo step (`bg`), so undoing an older change never removes it. The persister takes the
 * result as its baseline and writes nothing, so what main already holds is not sent back.
 */
export function adoptServerData(recipe: (draft: DataDraft) => void): void {
  adopting = true;
  try {
    appStore().bg(recipe);
  } finally {
    adopting = false;
  }
}

/** Batches waiting to go, oldest first; at most one more is in flight. */
const queue: DataWrite[][] = [];
let inFlight = false;
let idleListeners: ((ok: boolean) => void)[] = [];
/** True when a batch has failed since the last time the idle listeners were told. */
let failedSinceIdle = false;

/** Tells the listeners how the writes went, then forgets the failure they have been told about (a failure nobody is waiting for yet is kept). */
function reportIdle(listeners: readonly ((ok: boolean) => void)[]): void {
  const ok = !failedSinceIdle;
  failedSinceIdle = false;
  for (const listener of listeners) {
    listener(ok);
  }
}

/** True when no write is waiting or in flight. */
export function persistenceIdle(): boolean {
  return !inFlight && queue.length === 0;
}

/**
 * Runs `listener` once the writes are done: now when nothing is pending, else when the queue
 * empties. It gets `false` when a batch failed since the listeners were last told, else `true`.
 */
export function onPersistenceIdle(listener: (ok: boolean) => void): void {
  if (persistenceIdle()) {
    reportIdle([listener]);
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
    if (listeners.length > 0) {
      reportIdle(listeners);
    }
    return;
  }
  inFlight = true;
  const failed = (reason: unknown): void => {
    failedSinceIdle = true;
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
    if (adopting) {
      saved = data;
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
