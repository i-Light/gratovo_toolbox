/**
 * The sync engine (plan D2, D9, D15, D17, D18): one pass at a time over the account's one `Rest`
 * and the live copy's one database connection.
 *
 * A pass: (1) drop any other user's outbox rows, (2) drain the outbox, (3) read again the rows the
 * drain marked, (4) refresh the whole tables, (5-8) the keyset pull (the puller does the horizon,
 * the seed, the four tables and the tombstones). After a drain that sent anything, `announce`
 * names the tables teammates pull (D25; Realtime's, wired by the account).
 *
 * Single flight: a trigger during a pass queues exactly one more pass after it. Triggers: `start`,
 * a write or a teammate's broadcast (1 s after the last one), the 20 s tick and `syncNow`. After a
 * failed pass the next one waits 30 s, 2 min, 10 min, then 30 min; a good pass returns to the tick,
 * and `syncNow` resets the ladder. `stop()` clears every timer and turns a running pass's later
 * steps into no-ops. Logs name steps and codes only, never row data.
 */

import type { DatabaseSync } from "node:sqlite";

import type { FramePart, SyncState, SyncStatus } from "@gratovo/ipc";

import { getMeta, pendingCount, removeOtherUsers, setMeta } from "../data/repositories";
import type { EventSender } from "../events";
import { AuthError } from "../supabase/auth-client";
import { RestError } from "../supabase/rest";
import type { Rest } from "../supabase/rest";
import type { Timers } from "../supabase/session";

import { syncConflictNotices } from "./conflict-notices";
import { createPuller } from "./puller";
import type { PullResult } from "./puller";
import { createUploader } from "./uploader";
import type { DrainResult } from "./uploader";
import { refreshWhole } from "./whole-tables";

// `main/events.ts` defines it; re-exported so the engine's users can name it from here.
export type { EventSender };

export interface SyncEngine {
  /** Starts the timers and runs the first pass at once. */
  start(): void;
  /** Clears every timer; a running pass's later steps do nothing. Final. */
  stop(): void;
  status(): SyncStatus;
  /** Runs a pass now (or after the running one) with the ladder reset; the status after it. */
  syncNow(): Promise<SyncStatus>;
  /** Reads the whole tables once (sign-in waits for it, D19). Throws what `refreshWhole` throws. */
  refreshWhole(): Promise<void>;
  /** Drains the outbox (after any running pass) until the deadline; the entries still pending. */
  drainBefore(deadlineMs: number): Promise<number>;
  /** A local write was queued: a pass in 1 s (debounced). */
  noteWrite(): void;
  /** A teammate announced a change: a pass in 1 s (debounced). */
  noteRemote(): void;
}

/** The steps of a pass; the defaults are the real uploader, puller and whole-table refresh. */
export interface EngineSteps {
  drain(): Promise<DrainResult>;
  refetch(): Promise<ReadonlySet<FramePart>>;
  refreshWhole(): Promise<ReadonlySet<FramePart>>;
  pull(budgetMs: number): Promise<PullResult>;
}

export interface SyncEngineOptions {
  readonly db: DatabaseSync;
  readonly rest: Rest;
  readonly userId: string;
  readonly now: () => number;
  readonly timers: Timers;
  readonly emit: EventSender;
  /** Called after a drain that sent anything, with the touched tables teammates pull (D25). */
  readonly announce?: (tables: readonly string[]) => void;
  readonly log: (line: string) => void;
  /** The catch-up tick; 20 s. */
  readonly tickMs?: number;
  /** Test seam: replaces the pass's steps. `onTableDone` reports a part as soon as it changed. */
  readonly steps?: (hooks: { onTableDone: (part: FramePart) => void }) => EngineSteps;
}

/** The `_meta` key of the last good, complete pass (ms since the epoch). */
export const lastSyncedKey = "sync.last_synced_at";
export const tickMs = 20_000;
/** A write or a broadcast waits this long for the next one before a pass starts. */
export const debounceMs = 1_000;
/** The waits after the 1st, 2nd, 3rd and 4th-or-later failed pass in a row (D9). */
export const retryLadderMs: readonly number[] = [30_000, 120_000, 600_000, 1_800_000];
/** A pass's time for the pull; an unfinished pull carries on next pass. */
export const passBudgetMs = 120_000;
/** At most one `frame:changed` per this long during a pass (D15). */
export const frameEventMs = 2_000;
/** Failed passes on the same head before the status says `stuck` (D9). */
export const stuckAttempts = 4;

/** The tables a broadcast may name (D25): what teammates pull. */
const broadcastTables: readonly string[] = [
  "channel_state",
  "brands",
  "deals",
  "activity_log",
  "profiles",
  "member_access",
];

type FailureKind = "offline" | "session" | "other";

function errorCode(error: unknown): string {
  if (error instanceof RestError) {
    return (
      error.code ?? (error.kind === "offline" ? "offline" : `http_${String(error.status ?? 0)}`)
    );
  }
  if (error instanceof AuthError) {
    return `auth_${error.kind}`;
  }
  return error instanceof Error ? error.name : "error";
}

function failureKindOf(error: unknown): FailureKind {
  if (
    (error instanceof RestError && error.kind === "offline") ||
    (error instanceof AuthError && error.kind === "offline")
  ) {
    return "offline";
  }
  return error instanceof AuthError ? "session" : "other";
}

export function createSyncEngine(o: SyncEngineOptions): SyncEngine {
  const { db, rest, userId, now, timers, emit, log } = o;
  const tick = o.tickMs ?? tickMs;

  let started = false;
  let stopped = false;
  /** A pass or a drain is running. */
  let busy = false;
  /** Failed passes in a row (the ladder's step). */
  let failures = 0;
  /** How the last pass ended: null when it was good (or none ran yet). */
  let lastFailure: FailureKind | null = null;
  /** The last pull ran out of budget; the next pass carries on. */
  let behind = false;

  /** Every job (pass or drain) runs after the one before it. */
  let tail: Promise<void> = Promise.resolve();
  /** A pass in the queue that hasn't started: later triggers join it. */
  let queuedPass: Promise<void> | null = null;

  let nextTimer: unknown = null;
  let debounceTimer: unknown = null;
  let frameTimer: unknown = null;

  /** Parts changed and not yet announced to the page; the last `frame:changed` time. */
  const pendingParts = new Set<FramePart>();
  /** Parts already noted in this pass: the pull's summary doesn't send them twice. */
  const passParts = new Set<FramePart>();
  let lastFrameAt = Number.NEGATIVE_INFINITY;
  let lastStatusKey = "";

  const steps: EngineSteps = (o.steps ?? defaultSteps)({ onTableDone: noteParts });

  function defaultSteps(hooks: { onTableDone: (part: FramePart) => void }): EngineSteps {
    const uploader = createUploader({ db, rest, userId, now, log });
    const puller = createPuller({ db, rest, now, onTableDone: hooks.onTableDone, log });
    return {
      drain: () => uploader.drain(),
      refetch: () => puller.refetch(),
      // The conflict notices follow the open conflicts, in the same transaction (D27). They are
      // notifications, so the page reads them again only when the parts name `notify`.
      refreshWhole: async () => {
        const notices = { changed: false };
        const parts = await refreshWhole(rest, db, userId, {
          afterConflicts: (d) => {
            notices.changed = syncConflictNotices(d);
            return notices.changed;
          },
        });
        return notices.changed ? new Set<FramePart>([...parts, "notify"]) : parts;
      },
      pull: (budgetMs) => puller.pull(budgetMs),
    };
  }

  const live = (): boolean => !stopped && db.isOpen;

  // --- Status (D17) ---------------------------------------------------------------------------

  function head(): { attempts: number; code: string | null } | null {
    const row = db
      .prepare("SELECT attempts, last_code FROM _outbox WHERE user_id = ? ORDER BY seq ASC LIMIT 1")
      .get(userId);
    if (row === undefined) {
      return null;
    }
    const code = row["last_code"];
    return { attempts: Number(row["attempts"]), code: typeof code === "string" ? code : null };
  }

  function refusedCount(): number {
    const row = db
      .prepare("SELECT COUNT(*) AS n FROM _outbox_dropped WHERE user_id = ?")
      .get(userId);
    return Number(row?.["n"] ?? 0);
  }

  function lastSyncedAt(): number | null {
    const value = Number(getMeta(db, lastSyncedKey));
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  function state(): SyncState {
    if (!started || stopped) {
      return "off";
    }
    if (busy) {
      return "syncing";
    }
    if (lastFailure !== null) {
      const first = head();
      if (lastFailure !== "offline" && first !== null && first.attempts >= stuckAttempts) {
        return "stuck";
      }
      return "offline";
    }
    return behind || lastSyncedAt() === null ? "syncing" : "synced";
  }

  function status(): SyncStatus {
    if (!db.isOpen) {
      return { state: "off", pending: 0, refused: 0, lastSyncedAt: null };
    }
    return {
      state: state(),
      pending: pendingCount(db, userId),
      refused: refusedCount(),
      lastSyncedAt: lastSyncedAt(),
    };
  }

  /** Sends `sync:status` when it differs from the last one sent. */
  function publishStatus(): void {
    if (!live()) {
      return;
    }
    const current = status();
    const key = JSON.stringify(current);
    if (key !== lastStatusKey) {
      lastStatusKey = key;
      emit("sync:status", current);
    }
  }

  // --- frame:changed (D15) --------------------------------------------------------------------

  function flushParts(): void {
    if (frameTimer !== null) {
      timers.clear(frameTimer);
      frameTimer = null;
    }
    if (!live() || pendingParts.size === 0) {
      return;
    }
    const parts = [...pendingParts];
    pendingParts.clear();
    lastFrameAt = now();
    emit("frame:changed", { parts });
  }

  /** Notes changed parts; sends them now, or when the 2 s since the last event are up. */
  function noteParts(parts: FramePart | Iterable<FramePart>): void {
    if (!live()) {
      return;
    }
    for (const part of typeof parts === "string" ? [parts] : parts) {
      pendingParts.add(part);
      passParts.add(part);
    }
    if (pendingParts.size === 0 || frameTimer !== null) {
      return;
    }
    const wait = lastFrameAt + frameEventMs - now();
    if (wait <= 0) {
      flushParts();
    } else {
      frameTimer = timers.set(() => {
        frameTimer = null;
        flushParts();
      }, wait);
    }
  }

  // --- Timers ---------------------------------------------------------------------------------

  function clearNext(): void {
    if (nextTimer !== null) {
      timers.clear(nextTimer);
      nextTimer = null;
    }
  }

  function scheduleNext(ms: number): void {
    clearNext();
    if (!stopped) {
      nextTimer = timers.set(() => {
        nextTimer = null;
        void requestPass();
      }, ms);
    }
  }

  function debounce(): void {
    if (!started || stopped) {
      return;
    }
    if (debounceTimer !== null) {
      timers.clear(debounceTimer);
    }
    debounceTimer = timers.set(() => {
      debounceTimer = null;
      void requestPass();
    }, debounceMs);
  }

  // --- Jobs -----------------------------------------------------------------------------------

  /** Runs a job after every job before it; a job never rejects. */
  function enqueueJob(job: () => Promise<void>): Promise<void> {
    const run = tail.then(async () => {
      if (stopped) {
        return;
      }
      busy = true;
      try {
        await job();
      } catch (error) {
        log(`sync.job.failed code=${errorCode(error)}`);
      } finally {
        busy = false;
      }
    });
    tail = run;
    return run;
  }

  function requestPass(): Promise<void> {
    if (!started || stopped) {
      return Promise.resolve();
    }
    if (queuedPass !== null) {
      return queuedPass;
    }
    const pass = enqueueJob(async () => {
      queuedPass = null;
      await runPass();
    });
    queuedPass = pass;
    return pass;
  }

  function announceDrain(result: DrainResult): void {
    if (result.sent === 0 || o.announce === undefined) {
      return;
    }
    const tables = broadcastTables.filter((table) => result.tables.has(table));
    if (tables.length === 0) {
      return;
    }
    try {
      o.announce(tables);
    } catch (error) {
      log(`sync.announce.failed code=${errorCode(error)}`);
    }
  }

  /** The kind of failure the drain stopped on, read from the head it stopped at. */
  function drainFailure(result: DrainResult): FailureKind | null {
    if (result.stoppedOn === null || result.stoppedOn === "drop") {
      return null;
    }
    if (result.stoppedOn === "session") {
      return "session";
    }
    return head()?.code === "offline" ? "offline" : "other";
  }

  async function runPass(): Promise<void> {
    if (!live()) {
      return;
    }
    clearNext();
    passParts.clear();
    const startedAt = now();
    let failure: FailureKind | null = null;
    let done = false;
    publishStatus();
    try {
      // (1) Only the session user's rows are ever sent (D7).
      const removed = removeOtherUsers(db, userId);
      if (removed > 0) {
        log(`sync.outbox.other_users removed=${String(removed)}`);
      }

      // (2) Drain before pull, so a pull can't overwrite what is still to be sent (D10).
      const drained = await steps.drain();
      if (!live()) {
        return;
      }
      announceDrain(drained);
      failure = drainFailure(drained);
      publishStatus();
      if (failure === "session") {
        // The session is being refreshed or has ended: keep everything for the next pass (D8).
        log("sync.pass.stopped reason=session");
        return;
      }

      // (3) The rows the drain asked to read again.
      noteParts(await steps.refetch());
      if (!live()) {
        return;
      }

      // (4) The whole tables.
      noteParts(await steps.refreshWhole());
      if (!live()) {
        return;
      }

      // (5-8) The keyset pull, within what is left of the pass's budget.
      const budget = Math.max(0, startedAt + passBudgetMs - now());
      const pulled = await steps.pull(budget);
      if (!live()) {
        return;
      }
      // The puller reported each table as it finished; this catches any it didn't.
      noteParts([...pulled.changed].filter((part) => !passParts.has(part)));
      done = pulled.done;
    } catch (error) {
      if (!live()) {
        return;
      }
      failure = failureKindOf(error);
      log(`sync.pass.failed code=${errorCode(error)}`);
      if (error instanceof AuthError && error.kind === "ended") {
        stop();
        return;
      }
    } finally {
      if (live()) {
        finishPass(failure, done);
      }
    }
  }

  function finishPass(failure: FailureKind | null, done: boolean): void {
    lastFailure = failure;
    if (failure === null) {
      failures = 0;
      behind = !done;
      if (done) {
        setMeta(db, lastSyncedKey, String(now()));
      }
    } else {
      failures += 1;
    }
    busy = false;
    flushParts();
    publishStatus();
    if (failure !== null) {
      const step = Math.min(failures, retryLadderMs.length) - 1;
      scheduleNext(retryLadderMs[step] ?? tick);
    } else {
      // An unfinished pull carries on soon; otherwise the catch-up tick.
      scheduleNext(done ? tick : debounceMs);
    }
  }

  function stop(): void {
    if (stopped) {
      return;
    }
    stopped = true;
    for (const handle of [nextTimer, debounceTimer, frameTimer]) {
      if (handle !== null) {
        timers.clear(handle);
      }
    }
    nextTimer = null;
    debounceTimer = null;
    frameTimer = null;
    pendingParts.clear();
    queuedPass = null;
  }

  return {
    start(): void {
      if (started || stopped) {
        return;
      }
      started = true;
      publishStatus();
      void requestPass();
    },

    stop,

    status,

    async syncNow(): Promise<SyncStatus> {
      if (started && !stopped) {
        failures = 0;
        await requestPass();
      }
      return status();
    },

    async refreshWhole(): Promise<void> {
      const changed = await steps.refreshWhole();
      noteParts(changed);
      flushParts();
    },

    async drainBefore(deadlineMs: number): Promise<number> {
      const drain = enqueueJob(async () => {
        if (!live()) {
          return;
        }
        const drained = await steps.drain();
        if (live()) {
          announceDrain(drained);
        }
      });
      let timer: unknown = null;
      const deadline = new Promise<void>((resolve) => {
        timer = timers.set(resolve, Math.max(0, deadlineMs - now()));
      });
      await Promise.race([drain, deadline]);
      timers.clear(timer);
      if (!db.isOpen) {
        return 0;
      }
      publishStatus();
      return pendingCount(db, userId);
    },

    noteWrite(): void {
      publishStatus();
      debounce();
    },

    noteRemote(): void {
      debounce();
    },
  };
}
