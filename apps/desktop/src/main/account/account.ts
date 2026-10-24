/**
 * Who is using the app, and which data they see (plan G5, G6). No Electron import: index.ts passes
 * the folder, the secret store, the network and how to reload the window.
 *
 * States:
 * - `unconfigured`: a build without Supabase settings. The example data; no sign-in.
 * - `signed-out`: no session. No data source is open.
 * - `waiting`: a session whose own `profiles.role` is `unauthorized`. No data source is open.
 * - `signed-in`: the live copy (`gratovo.db`) for this member.
 *
 * The live copy belongs to one account (`_meta` `account.user_id`); it also keeps the last known
 * access (`account.access`), so a start with a stored session opens it at once and checks with the
 * server behind it. When that check can't reach the server, it runs again after the session's next
 * successful refresh. When it finds the session ended or the access changed, the window reloads and
 * the page starts over from `auth:status`. Signing in as someone else, or an access dropped to
 * waiting, deletes the live copy.
 *
 * The sync (plan D2, D18, D19): a signed-in member with a session gets one sync engine over the
 * live copy and the account's one `Rest`. Every write the page makes is saved locally and queued
 * in the outbox in the same transaction, then the engine sends it. Sign-in waits for the whole
 * tables (the team) before it answers; the keyset pull runs behind it. Signing out gives the outbox
 * 5 s more to drain; then the copy is deleted, or, when changes are still unsent, it keeps only
 * them (and whose they are) until the same account signs in again. A session the server ended
 * keeps unsent changes the same way.
 *
 * Realtime (plan D2, D24-D26): beside each engine, one live client on the same session. A
 * teammate's broadcast schedules a pass; the engine's drains announce what they sent; presence
 * reaches the frame and the `presence:changed` event for the team's members only, with your own
 * entry from your own state. The live client goes down before the copy is kept or deleted.
 *
 * Nothing here logs or returns a token, a password, an email or a key: log lines carry error
 * kinds and codes only.
 */

import { randomUUID } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import type { AppRole, DataSource } from "@gratovo/core/data";
import { emailMax, type AuthStatus, type SignInResult } from "@gratovo/ipc";
import type { AuthState, PresenceScreen, SignInProblem, SyncStatus } from "@gratovo/ipc";
import { z } from "zod";

import { createSqliteSource, openExampleSource, type FrameExtras } from "../data";
import { getMeta, listProfiles, pendingCount, setMeta } from "../data/repositories";
import { openDatabase } from "../db/open-database";
import type { EventSender } from "../events";
import { NetworkRefusedError, type Network } from "../net/network";
import type { SecretStore } from "../secret-store";
import { AuthError, createAuthClient, type Tokens } from "../supabase/auth-client";
import type { SupabaseConfig } from "../supabase/config";
import { RestError, createRest, type Rest } from "../supabase/rest";
import {
  createSessionManager,
  sessionSecretName,
  type Session,
  type Timers,
} from "../supabase/session";
import { createSyncEngine, type SyncEngine } from "../sync";
import { recordIntent } from "../sync/intents";
import { accountUserKey, keepOnlyUnsent } from "../sync/keep-unsent";
import { createLive, type Live, type LiveDeps, type PresenceState } from "../sync/live";
import { presenceExtras, presenceMembers } from "../sync/presence-extras";
import { toAppRole } from "../sync/whole-tables";

import { createTeamKeys } from "./team-keys";

export type { AuthState };

export interface Account {
  status(): AuthStatus;
  /** The open data source: the example one, the live copy when signed in, else null. */
  source(): DataSource | null;
  signIn(email: string, password: string): Promise<SignInResult>;
  /** Asks the server for the access and the team again ("Check again"). */
  recheck(): Promise<AuthStatus>;
  /**
   * Ends the session and deletes the key cache, then reloads the window. The live copy is deleted,
   * or keeps only the changes still unsent after 5 s more of draining (D18).
   */
  signOut(): Promise<void>;
  /** The sync's state; `off` when signed out, with the changes kept from the last session. */
  syncStatus(): SyncStatus;
  /** Runs a sync pass now (or waits for the running one) and answers the state after it. */
  syncNow(): Promise<SyncStatus>;
  /** The page's screen and idleness, for presence (D26). Does nothing unless signed in. */
  setPresence(p: { screen: PresenceScreen; idle: boolean }): void;
  /** Opens what the app shows first. Call once, before the window opens. */
  start(): Promise<void>;
  /** At quit: closes the databases and stops the refresh timer. Deletes nothing. */
  close(): void;
  readonly teamKeys: { youtubeKey(): Promise<string | null> };
  /**
   * Which pipeline data the Find screen works on: the example folder when unconfigured, the live
   * one (named by the copy's user id) when signed in, else null.
   */
  findContext(): { mode: "example" | "live"; workerId: string } | null;
}

export interface AccountDeps {
  /** Null when the build has no Supabase settings. */
  config: SupabaseConfig | null;
  /** The app's user data folder. */
  userData: string;
  secrets: SecretStore;
  network: Network;
  now: () => number;
  /** Reloads the page after the current IPC answer has gone out. */
  reloadWindow: () => void;
  /** Sends main-to-page events (`main/events.ts`): the sync's status and the changed parts. */
  emit: EventSender;
  /** Makes the live client (Realtime) for a session; defaults to `createLive`. Tests pass a fake. */
  createLive?: (deps: LiveDeps) => Live;
  timers?: Timers;
  log?: (line: string) => void;
}

export const exampleFile = "example.db";
export const liveFile = "gratovo.db";
const userKey = accountUserKey;
const accessKey = "account.access";
/** Sign-out gives the outbox this long to drain before the copy is kept or deleted (D18). */
export const signOutDrainMs = 5_000;
/** `sync:status` counts up to this (its schema's limit). */
const countMax = 1_000_000;

const realTimers: Timers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

function offStatus(pending: number): SyncStatus {
  return { state: "off", pending: Math.min(pending, countMax), refused: 0, lastSyncedAt: null };
}

/** No counts or run until the engines exist (step 4); presence is set per copy, below. */
const emptyExtras: FrameExtras = {
  presence: () => ({ status: "away", doing: "" }),
  counts: () => ({ today: 0, plannedMinutes: 0, find: 0, reach: 0, close: 0, deliver: 0 }),
  mateRun: () => null,
};

/** Nobody present: Realtime is off or hasn't heard from anyone. */
const nobody: ReadonlyMap<string, PresenceState> = new Map();

/** The team's ids, in the frame's order: the only keys presence shows. */
function teamIds(db: DatabaseSync): string[] {
  return listProfiles(db).map((profile) => profile.id);
}

const storedAccount = z.object({ userId: z.string().min(1), email: z.string() });
const emailShape = z.email().max(emailMax);

/** What a log line may say about an error: its kind and code, never a value. */
export function describeError(error: unknown): string {
  if (
    error instanceof AuthError ||
    error instanceof RestError ||
    error instanceof NetworkRefusedError
  ) {
    return error.message;
  }
  if (error instanceof Error) {
    const code = "code" in error && typeof error.code === "string" ? ` (${error.code})` : "";
    return `${error.name}${code}`;
  }
  return "unknown error";
}

function isOffline(error: unknown): boolean {
  return (
    (error instanceof AuthError && error.kind === "offline") ||
    (error instanceof RestError && error.kind === "offline")
  );
}

function signInProblem(error: unknown): SignInProblem {
  if (error instanceof AuthError) {
    switch (error.kind) {
      case "invalid":
      case "unconfirmed":
      case "rate-limited":
      case "offline":
        return error.kind;
      case "ended":
      case "unavailable":
        return "unavailable";
    }
  }
  return isOffline(error) ? "offline" : "unavailable";
}

/** The member's own access, from their profile; no row reads as no access. */
async function fetchRole(rest: Rest, userId: string): Promise<AppRole> {
  const rows = await rest.select<{ role?: unknown }>(
    "profiles",
    `select=id,role&id=eq.${encodeURIComponent(userId)}`,
  );
  return toAppRole(rows[0]?.role);
}

interface LiveCopy {
  readonly userId: string;
  readonly db: DatabaseSync;
  readonly source: DataSource;
}

export function createAccount(deps: AccountDeps): Account {
  const { config, network, now, secrets } = deps;
  const log =
    deps.log ??
    ((line: string) => {
      console.error(line);
    });
  const livePath = join(deps.userData, liveFile);
  const timers = deps.timers ?? realTimers;

  const auth = config === null ? null : createAuthClient(network, config, { now });
  const manager =
    auth === null
      ? null
      : createSessionManager({
          auth,
          store: secrets,
          now,
          ...(deps.timers ? { timers: deps.timers } : {}),
        });

  let state: AuthState = config === null ? "unconfigured" : "signed-out";
  let email: string | null = null;
  let example: DataSource | null = null;
  let live: LiveCopy | null = null;
  let session: Session | null = null;
  let rest: Rest | null = null;
  // Bumped whenever the account changes, so an answer that arrives after it is dropped.
  let generation = 0;
  // The start's background check, while it runs.
  let background: Promise<void> | null = null;
  // The start's access check couldn't reach the server: run it after the next refresh.
  let unchecked = false;
  // The sync engine of the open live copy, and the `Rest` it was made with.
  let engine: SyncEngine | null = null;
  let engineRest: Rest | null = null;
  // The live client (Realtime) beside the engine, on the engine's session (D24).
  let realtime: Live | null = null;
  // Your own screen and idleness, as the page last said (D26); the app opens on Today.
  let ownPresence: PresenceState = { screen: "today", idle: false };
  // The last `presence:changed` sent, so an unchanged one isn't sent again.
  let lastPresence = "";
  // Unsent changes kept from a signed-out session (D18), for `sync:status` while signed out.
  let kept = 0;

  const keys = createTeamKeys({
    fetchYoutubeKey: () => {
      if (state !== "signed-in" || rest === null) {
        return Promise.reject(new Error("The team keys are for signed-in members."));
      }
      return rest.rpc<unknown>("team_youtube_key");
    },
    now,
  });

  // --- The live copy ---

  /**
   * Takes the live client down: from here it sends and reports nothing. The returned promise ends
   * when it has disconnected (at most 2 s per step, `live.ts`); it never rejects.
   */
  function stopRealtime(): Promise<void> {
    const current = realtime;
    realtime = null;
    lastPresence = "";
    if (current === null) {
      return Promise.resolve();
    }
    return current.stop().catch((error: unknown) => {
      log(`Account: the live connection didn't close cleanly (${describeError(error)}).`);
    });
  }

  /** Stops Realtime first, then the engine. */
  function stopEngine(): void {
    void stopRealtime();
    engine?.stop();
    engine = null;
    engineRest = null;
  }

  /**
   * Stops the sync, then closes the live copy. A source change made outside `signIn`, `recheck`
   * and `signOut` must still reach the source watch (`main/settings/source-switch.ts`) or a window
   * reload, or the Gemini bridge keeps running after the switch.
   */
  function closeLive(): void {
    stopEngine();
    live?.source.close();
    live = null;
  }

  /** Deletes the live copy. Throws when a file can't be deleted. */
  function wipeLive(): void {
    closeLive();
    kept = 0;
    for (const suffix of ["", "-wal", "-shm"]) {
      rmSync(`${livePath}${suffix}`, { force: true, maxRetries: 5, retryDelay: 50 });
    }
  }

  /** Deletes the live copy; a failure is logged. */
  function wipeLiveOrLog(): void {
    try {
      wipeLive();
    } catch (error) {
      log(`Account: the local copy couldn't be deleted (${describeError(error)}).`);
    }
  }

  /** Opens the live file; one that won't open is a damaged cache, so it starts again empty. */
  function openLiveFile(): DatabaseSync {
    try {
      return openDatabase(livePath);
    } catch (error) {
      log(`Account: the local copy couldn't be opened (${describeError(error)}); starting again.`);
      wipeLive();
      return openDatabase(livePath);
    }
  }

  /**
   * The live database for `userId`: the open one, or the file, emptied first if it was someone
   * else's. As with `closeLive`: a source change outside `signIn`, `recheck` and `signOut` must
   * still reach the source watch (`main/settings/source-switch.ts`) or a window reload, so the
   * Gemini bridge stops on a switch.
   */
  function holdLive(userId: string): DatabaseSync {
    if (live !== null && live.userId === userId && live.db.isOpen) {
      return live.db;
    }
    closeLive();
    let db = openLiveFile();
    const owner = getMeta(db, userKey);
    if (owner !== null && owner !== userId) {
      // Another account's unsent changes go with its copy (D18); only the count is logged.
      const unsent = pendingCount(db);
      db.close();
      wipeLive();
      if (unsent > 0) {
        log(`Account: deleted ${String(unsent)} unsent changes of another account.`);
      }
      db = openDatabase(livePath);
    }
    setMeta(db, userKey, userId);
    return db;
  }

  /**
   * D18: closes the live copy (or the file left on disk) as a signed-out one. With unsent changes
   * it keeps only them and returns true; without, it returns false and the caller deletes it.
   */
  function retireLive(): boolean {
    stopEngine();
    const open = live !== null && live.db.isOpen ? live.db : null;
    if (open === null && !existsSync(livePath)) {
      closeLive();
      return false;
    }
    let file: DatabaseSync | null = null;
    try {
      if (open === null) {
        file = openLiveFile();
      }
      const db = open ?? file;
      if (db === null) {
        return false;
      }
      const unsent = pendingCount(db);
      if (unsent === 0) {
        return false;
      }
      kept = unsent;
      try {
        keepOnlyUnsent(db);
        // Rewrites the file, so the deleted rows don't linger in free pages.
        db.exec("VACUUM");
        log(`Account: kept ${String(unsent)} unsent changes on this computer.`);
      } catch (error) {
        // The changes matter more than the trim: the next start trims the copy again.
        log(`Account: the unsent changes couldn't be kept apart (${describeError(error)}).`);
      }
      return true;
    } catch (error) {
      log(`Account: the local copy couldn't be read (${describeError(error)}).`);
      return false;
    } finally {
      file?.close();
      closeLive();
    }
  }

  /** How many unsent changes a signed-out copy on disk holds, for `sync:status`. */
  function noteKept(): void {
    kept = 0;
    if (live !== null || !existsSync(livePath)) {
      return;
    }
    try {
      const db = openDatabase(livePath);
      try {
        kept = pendingCount(db);
      } finally {
        db.close();
      }
    } catch (error) {
      log(`Account: the local copy couldn't be read (${describeError(error)}).`);
    }
  }

  /**
   * Enters `waiting` or `signed-in`; for `signed-in`, records the access in the live copy.
   * Synchronous. A member who is waiting keeps none of the team's data on disk: the live copy goes,
   * as on sign-out, and the session stays.
   */
  function enter(userId: string, mail: string, role: AppRole): void {
    if (role === "unauthorized") {
      email = mail;
      state = "waiting";
      wipeLiveOrLog();
      return;
    }
    const db = holdLive(userId);
    try {
      setMeta(db, accessKey, role);
    } catch (error) {
      if (live?.db !== db) {
        db.close();
      }
      throw error;
    }
    email = mail;
    if (live?.db !== db) {
      const source = createSqliteSource(db, {
        source: "live",
        me: userId,
        extras: {
          ...emptyExtras,
          // Read at each frame: who Realtime sees now, the team's members only (D26).
          presence: (id) =>
            presenceExtras(realtime?.members() ?? nobody, teamIds(db), userId, ownPresence)(id),
        },
        now,
        // Inside the batch's transaction: the local write and its outbox entry land together (D11).
        onWrite: (target, write, applyLocal) => {
          recordIntent(target, { userId, write, applyLocal, now: now(), newId: randomUUID });
          // After the transaction, so the engine counts only what was committed.
          queueMicrotask(() => {
            if (live?.db === target) {
              engine?.noteWrite();
            }
          });
        },
      });
      live = { userId, db, source };
    }
    kept = 0;
    state = "signed-in";
  }

  /** The engine of the open live copy for this `Rest`; made once per copy and session (D2). */
  function engineFor(client: Rest): SyncEngine | null {
    const target = live;
    if (state !== "signed-in" || target === null) {
      return null;
    }
    if (engine !== null && engineRest === client) {
      return engine;
    }
    stopEngine();
    const current = session;
    // The live client shares the engine's session, so one refresher serves both (D2).
    const rt =
      config === null || current === null
        ? null
        : (deps.createLive ?? createLive)({
            config,
            network,
            session: current,
            userId: target.userId,
            log,
            now,
            timers,
          });
    const made = createSyncEngine({
      db: target.db,
      rest: client,
      userId: target.userId,
      now,
      timers,
      emit: deps.emit,
      ...(rt === null
        ? {}
        : {
            announce: (tables: readonly string[]) => {
              rt.announce(tables);
            },
          }),
      log,
    });
    engine = made;
    engineRest = client;
    realtime = rt;
    if (rt !== null) {
      // A teammate's change: a pass in 1 s (the engine debounces).
      rt.onRemoteChange(() => {
        if (engine === made) {
          made.noteRemote();
        }
      });
      rt.onPresence(() => {
        if (realtime === rt) {
          publishPresence();
        }
      });
      rt.setPresence(ownPresence);
    }
    return made;
  }

  /** Starts the engine's passes and, beside it, Realtime. */
  function runSync(running: SyncEngine): void {
    running.start();
    if (engine === running) {
      realtime?.start();
    }
  }

  /** Sends `presence:changed` for the team's members when it differs from the last one sent. */
  function publishPresence(): void {
    const target = live;
    if (state !== "signed-in" || target === null || !target.db.isOpen) {
      return;
    }
    let payload: ReturnType<typeof presenceMembers>;
    try {
      payload = presenceMembers(
        realtime?.members() ?? nobody,
        teamIds(target.db),
        target.userId,
        ownPresence,
      );
    } catch (error) {
      log(`Account: presence couldn't be read (${describeError(error)}).`);
      return;
    }
    const key = JSON.stringify(payload);
    if (key !== lastPresence) {
      lastPresence = key;
      deps.emit("presence:changed", payload);
    }
  }

  /**
   * Reads the whole tables (the team, your switches and conflicts), then starts the engine's passes
   * (D19). A failed read is logged and the local team stays: sign-in never fails because of it.
   */
  async function startSync(generationAtStart: number, client: Rest): Promise<void> {
    const running = engineFor(client);
    if (running === null) {
      return;
    }
    try {
      await running.refreshWhole();
    } catch (error) {
      if (generationAtStart === generation) {
        log(`Account: the team refresh failed (${describeError(error)}).`);
      }
    }
    if (generationAtStart === generation && engine === running) {
      runSync(running);
    }
  }

  /** Forgets the session and everything that came with it, in memory, and closes the live copy. */
  function forget(): void {
    // Realtime first: nothing more arrives for a session that is going.
    void stopRealtime();
    session = null;
    rest = null;
    unchecked = false;
    keys.clear();
    state = "signed-out";
    email = null;
    closeLive();
  }

  /**
   * Forgets the session; the live copy keeps only its unsent changes, or is deleted when there are
   * none (D18). The secret is the caller's business.
   */
  function endLocally(): void {
    const keep = retireLive();
    forget();
    if (!keep) {
      wipeLiveOrLog();
    }
  }

  function useSession(next: Session): Rest {
    if (config === null) {
      throw new Error("Supabase is not configured.");
    }
    session = next;
    rest = createRest(network, config, next);
    return rest;
  }

  /**
   * Asks the server for the member's access, then updates the state and the team. False when the
   * server couldn't answer.
   */
  async function verify(
    generationAtStart: number,
    current: Session,
    client: Rest,
  ): Promise<boolean> {
    let role: AppRole;
    try {
      role = await fetchRole(client, current.userId);
    } catch (error) {
      // Offline: keep what the local copy says. Ended: onEnded has already signed out.
      log(`Account: the access check failed (${describeError(error)}).`);
      return false;
    }
    if (generationAtStart !== generation) {
      return true;
    }
    unchecked = false;
    try {
      enter(current.userId, current.email, role);
    } catch (error) {
      log(`Account: the local copy couldn't be updated (${describeError(error)}).`);
      return true;
    }
    if (state === "signed-in") {
      await startSync(generationAtStart, client);
    }
    return true;
  }

  /** Checks the access behind the open local copy; reloads the window when the state changed. */
  async function checkAndReload(
    generationAtStart: number,
    current: Session,
    client: Rest,
  ): Promise<void> {
    const before = state;
    const checked = await verify(generationAtStart, current, client);
    if (generationAtStart !== generation) {
      return;
    }
    unchecked = !checked;
    if (state !== before) {
      deps.reloadWindow();
    }
  }

  /** The stored account, or null when there is none. Throws when the store can't be read. */
  async function readStoredAccount(): Promise<{ userId: string; email: string } | null> {
    const raw = await secrets.get(sessionSecretName);
    if (raw === undefined) {
      return null;
    }
    try {
      return storedAccount.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  /** Opens the live copy as the last check left it, if it belongs to `userId`. */
  function openKnown(userId: string, mail: string): boolean {
    if (!existsSync(livePath)) {
      return false;
    }
    const db = openLiveFile();
    const access = getMeta(db, accessKey);
    if (getMeta(db, userKey) !== userId || access === null) {
      db.close();
      return false;
    }
    db.close();
    enter(userId, mail, toAppRole(access));
    return true;
  }

  /** The start's check behind the open local copy (offline first). */
  async function checkBehind(generationAtStart: number): Promise<void> {
    if (manager === null) {
      return;
    }
    let restored: Session | null;
    try {
      restored = await manager.restore();
    } catch (error) {
      log(`Account: the stored session couldn't be read (${describeError(error)}).`);
      return;
    }
    if (generationAtStart !== generation) {
      return;
    }
    if (restored === null) {
      // The server ended the session while the app was closed.
      generation += 1;
      endLocally();
      deps.reloadWindow();
      return;
    }
    const client = useSession(restored);
    await checkAndReload(generationAtStart, restored, client);
    // Offline, the check couldn't run: the copy is open on the known access, so its changes start
    // syncing as soon as the server answers.
    if (generationAtStart === generation && rest === client) {
      const running = engineFor(client);
      if (running !== null) {
        runSync(running);
      }
    }
  }

  /** A stored session but no local copy for it: ask the server before the window opens. */
  async function restoreFirst(generationAtStart: number): Promise<void> {
    if (manager === null) {
      return;
    }
    let restored: Session | null;
    try {
      restored = await manager.restore();
    } catch (error) {
      log(`Account: the stored session couldn't be read (${describeError(error)}).`);
      return;
    }
    if (restored === null || generationAtStart !== generation) {
      return;
    }
    const client = useSession(restored);
    let role: AppRole;
    try {
      role = await fetchRole(client, restored.userId);
    } catch (error) {
      // Without the access there is nothing safe to show: sign in again once online. The stored
      // session stays, so the next start can try again.
      log(`Account: the access check failed (${describeError(error)}); showing sign-in.`);
      manager.close();
      session = null;
      rest = null;
      return;
    }
    if (generationAtStart !== generation) {
      return;
    }
    try {
      enter(restored.userId, restored.email, role);
    } catch (error) {
      log(`Account: the local copy couldn't be opened (${describeError(error)}).`);
      manager.close();
      session = null;
      rest = null;
      state = "signed-out";
      email = null;
      return;
    }
    if (state === "signed-in") {
      await startSync(generationAtStart, client);
    }
  }

  function currentState(): AuthState {
    return state;
  }

  function status(): AuthStatus {
    const own = state === "waiting" || state === "signed-in" ? email : null;
    return { state, email: own !== null && emailShape.safeParse(own).success ? own : null };
  }

  function syncStatus(): SyncStatus {
    if (state === "signed-in" && live !== null) {
      if (engine !== null) {
        return engine.status();
      }
      try {
        return offStatus(pendingCount(live.db, live.userId));
      } catch {
        return offStatus(0);
      }
    }
    return offStatus(state === "signed-out" ? kept : 0);
  }

  manager?.onEnded(() => {
    generation += 1;
    endLocally();
    deps.reloadWindow();
  });

  // Offline at start the access check failed; the first refresh that gets through runs it again.
  manager?.onRefreshed(() => {
    const current = session;
    const client = rest;
    if (!unchecked || background !== null || current === null || client === null) {
      return;
    }
    unchecked = false;
    checkAndReload(generation, current, client).catch((error: unknown) => {
      log(`Account: the access check failed (${describeError(error)}).`);
    });
  });

  return {
    status,

    source() {
      if (state === "unconfigured") {
        return example;
      }
      return state === "signed-in" ? (live?.source ?? null) : null;
    },

    async start() {
      if (config === null) {
        example = openExampleSource(join(deps.userData, exampleFile), now);
        return;
      }
      let stored: { userId: string; email: string } | null;
      try {
        stored = await readStoredAccount();
      } catch (error) {
        log(`Account: the stored session couldn't be read (${describeError(error)}).`);
        return;
      }
      if (stored === null) {
        // A copy without a session: one a sign-out kept for its unsent changes stays, with only
        // them (D18); any other (a sign-out that stopped after deleting the session) is deleted.
        if (existsSync(livePath) && !retireLive()) {
          wipeLiveOrLog();
        }
        return;
      }
      const generationAtStart = generation;
      let known = false;
      try {
        known = openKnown(stored.userId, stored.email);
      } catch (error) {
        log(`Account: the local copy couldn't be opened (${describeError(error)}).`);
        state = "signed-out";
        email = null;
      }
      if (!known) {
        await restoreFirst(generationAtStart);
        if (currentState() === "signed-out") {
          noteKept();
        }
        return;
      }
      background = checkBehind(generationAtStart)
        .catch((error: unknown) => {
          log(`Account: the start-up check failed (${describeError(error)}).`);
        })
        .finally(() => {
          background = null;
        });
    },

    async signIn(address, password) {
      if (auth === null || manager === null) {
        return { ok: false, problem: "unavailable" };
      }
      // A start-up check still running must finish first: its session is about to be replaced.
      await background;
      generation += 1;
      const generationAtStart = generation;

      let tokens: Tokens;
      try {
        tokens = await auth.signIn(address, password);
      } catch (error) {
        return { ok: false, problem: signInProblem(error) };
      }
      if (generationAtStart !== generation) {
        return { ok: false, problem: "unavailable" };
      }

      // From here the previous account, if any, is gone.
      keys.clear();
      closeLive();
      state = "signed-out";
      email = null;
      let next: Session;
      try {
        next = await manager.start(tokens);
      } catch (error) {
        session = null;
        rest = null;
        log(`Account: the session couldn't be stored (${describeError(error)}).`);
        return { ok: false, problem: "no-safe-storage" };
      }
      const client = useSession(next);

      let role: AppRole;
      try {
        role = await fetchRole(client, next.userId);
        if (generationAtStart !== generation) {
          return { ok: false, problem: "unavailable" };
        }
        enter(next.userId, next.email, role);
      } catch (error) {
        log(`Account: the sign-in couldn't finish (${describeError(error)}).`);
        if (generationAtStart === generation) {
          session = null;
          rest = null;
          state = "signed-out";
          email = null;
          await next.end().catch(() => undefined);
        }
        return { ok: false, problem: isOffline(error) ? "offline" : "unavailable" };
      }
      // enter() moved the state on; read it afresh rather than as narrowed above.
      const reached = currentState();
      if (reached === "signed-in") {
        await startSync(generationAtStart, client);
      }
      if (generationAtStart !== generation) {
        return { ok: false, problem: "unavailable" };
      }
      return { ok: true, state: reached === "waiting" ? "waiting" : "signed-in" };
    },

    async recheck() {
      await background;
      const current = session;
      const client = rest;
      if ((state === "waiting" || state === "signed-in") && current !== null && client !== null) {
        await verify(generation, current, client);
      }
      return status();
    },

    async signOut() {
      if (manager === null) {
        return;
      }
      generation += 1;
      const current = session;
      const running = engine;
      const target = live;
      // Realtime goes down first (D18); it closes while the outbox drains, and before the copy is
      // touched. Its own steps are bounded, so it can't hold sign-out up for long.
      const down = stopRealtime();
      if (running !== null && target !== null) {
        // The page has asked for a pass already; the outbox gets up to 5 s more (D18). A pass still
        // running is waited for within the same 5 s; what is left stays unsent and is kept.
        await running.drainBefore(now() + signOutDrainMs);
      }
      await down;
      // Nothing more is sent. With changes still unsent the copy keeps only them, trimmed before the
      // session goes; else it is deleted below. A session that ended during the drain has already
      // settled the copy.
      const keep = live === target ? retireLive() : kept > 0;
      forget();
      // The stored session goes before the local copy: if the app stops in between, the next start
      // finds a copy without a session and deletes it, rather than a session that signs back in.
      // end() also logs out on the server (best effort).
      if (current !== null) {
        try {
          await current.end();
        } catch (error) {
          log(`Account: the session couldn't be ended cleanly (${describeError(error)}).`);
        }
      }
      // A session still being restored, or one end() couldn't delete.
      manager.close();
      try {
        await secrets.delete(sessionSecretName);
      } catch (error) {
        log(`Account: the stored session couldn't be deleted (${describeError(error)}).`);
      }
      if (!keep) {
        wipeLiveOrLog();
      }
      deps.reloadWindow();
    },

    syncStatus,

    async syncNow() {
      const running = state === "signed-in" ? engine : null;
      return running === null ? syncStatus() : running.syncNow();
    },

    setPresence(p) {
      if (state !== "signed-in") {
        return;
      }
      ownPresence = { screen: p.screen, idle: p.idle };
      realtime?.setPresence(ownPresence);
      publishPresence();
    },

    close() {
      void stopRealtime();
      generation += 1;
      manager?.close();
      keys.clear();
      closeLive();
      example?.close();
      example = null;
    },

    teamKeys: { youtubeKey: () => keys.youtubeKey() },

    findContext() {
      if (state === "unconfigured") {
        return { mode: "example", workerId: "example" };
      }
      return state === "signed-in" && live !== null
        ? { mode: "live", workerId: live.userId }
        : null;
    },
  };
}
