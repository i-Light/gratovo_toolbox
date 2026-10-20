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
 * server behind it. When that check finds the session ended or the access changed, the window
 * reloads and the page starts over from `auth:status`. Signing out, a session the server ended, or
 * signing in as someone else deletes the live copy.
 *
 * Nothing here logs or returns a token, a password, an email or a key: log lines carry error
 * kinds and codes only.
 */

import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import type { AppRole, DataSource } from "@gratovo/core/data";
import { emailMax, type AuthStatus, type SignInResult } from "@gratovo/ipc";
import type { AuthState, SignInProblem } from "@gratovo/ipc";
import { z } from "zod";

import { createSqliteSource, openExampleSource, type FrameExtras } from "../data";
import { getMeta, setMeta } from "../data/repositories";
import { openDatabase } from "../db/open-database";
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

import { withServerWrites } from "./live-writes";
import { createTeamKeys } from "./team-keys";
import { refreshTeam, toAppRole } from "./team-refresh";

export type { AuthState };

export interface Account {
  status(): AuthStatus;
  /** The open data source: the example one, the live copy when signed in, else null. */
  source(): DataSource | null;
  signIn(email: string, password: string): Promise<SignInResult>;
  /** Asks the server for the access and the team again ("Check again"). */
  recheck(): Promise<AuthStatus>;
  /** Ends the session, deletes the live copy and the key cache, then reloads the window. */
  signOut(): Promise<void>;
  /** Opens what the app shows first. Call once, before the window opens. */
  start(): Promise<void>;
  /** At quit: closes the databases and stops the refresh timer. Deletes nothing. */
  close(): void;
  readonly teamKeys: { youtubeKey(): Promise<string | null> };
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
  timers?: Timers;
  log?: (line: string) => void;
}

export const exampleFile = "example.db";
export const liveFile = "gratovo.db";
const userKey = "account.user_id";
const accessKey = "account.access";

/** No presence, counts or run until the sync and the engines exist (3d-2b, step 4). */
const emptyExtras: FrameExtras = {
  presence: () => ({ status: "away", doing: "" }),
  counts: () => ({ today: 0, plannedMinutes: 0, find: 0, reach: 0, close: 0, deliver: 0 }),
  mateRun: () => null,
};

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

interface Live {
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
  let live: Live | null = null;
  let session: Session | null = null;
  let rest: Rest | null = null;
  // Bumped whenever the account changes, so an answer that arrives after it is dropped.
  let generation = 0;
  // The start's background check, while it runs.
  let background: Promise<void> | null = null;

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

  function closeLive(): void {
    live?.source.close();
    live = null;
  }

  /** Deletes the live copy. Throws when a file can't be deleted. */
  function wipeLive(): void {
    closeLive();
    for (const suffix of ["", "-wal", "-shm"]) {
      rmSync(`${livePath}${suffix}`, { force: true, maxRetries: 5, retryDelay: 50 });
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

  /** The live database for `userId`: the open one, or the file, emptied first if it was someone else's. */
  function holdLive(userId: string): DatabaseSync {
    if (live !== null && live.userId === userId && live.db.isOpen) {
      return live.db;
    }
    closeLive();
    let db = openLiveFile();
    const owner = getMeta(db, userKey);
    if (owner !== null && owner !== userId) {
      db.close();
      wipeLive();
      db = openDatabase(livePath);
    }
    setMeta(db, userKey, userId);
    return db;
  }

  function sendName(userId: string): (name: string) => Promise<void> {
    return (name) => {
      if (rest === null) {
        return Promise.reject(new RestError("offline"));
      }
      return rest.patch("profiles", `id=eq.${encodeURIComponent(userId)}`, {
        display_name: name,
      });
    };
  }

  /** Records the access in the live copy and enters `waiting` or `signed-in`. Synchronous. */
  function enter(userId: string, mail: string, role: AppRole): void {
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
    if (role === "unauthorized") {
      if (live?.db === db) {
        live = null;
      }
      db.close();
      state = "waiting";
      return;
    }
    if (live?.db !== db) {
      const local = createSqliteSource(db, { me: userId, extras: emptyExtras, now });
      live = { userId, db, source: withServerWrites(local, { sendName: sendName(userId) }) };
    }
    state = "signed-in";
  }

  /** Replaces the local team; a failure is logged and the old team stays. */
  async function refreshTeamNow(generationAtStart: number): Promise<void> {
    const target = live;
    if (target === null || rest === null) {
      return;
    }
    try {
      await refreshTeam(rest, target.db);
    } catch (error) {
      if (generationAtStart === generation) {
        log(`Account: the team refresh failed (${describeError(error)}).`);
      }
    }
  }

  /** Forgets the session and everything that came with it. The secret is the caller's business. */
  function endLocally(): void {
    session = null;
    rest = null;
    keys.clear();
    state = "signed-out";
    email = null;
    try {
      wipeLive();
    } catch (error) {
      log(`Account: the local copy couldn't be deleted (${describeError(error)}).`);
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

  /** Asks the server for the member's access, then updates the state and the team. */
  async function verify(generationAtStart: number, current: Session, client: Rest): Promise<void> {
    let role: AppRole;
    try {
      role = await fetchRole(client, current.userId);
    } catch (error) {
      // Offline: keep what the local copy says. Ended: onEnded has already signed out.
      log(`Account: the access check failed (${describeError(error)}).`);
      return;
    }
    if (generationAtStart !== generation) {
      return;
    }
    try {
      enter(current.userId, current.email, role);
    } catch (error) {
      log(`Account: the local copy couldn't be updated (${describeError(error)}).`);
      return;
    }
    if (state === "signed-in") {
      await refreshTeamNow(generationAtStart);
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
    const before = state;
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
    await verify(generationAtStart, restored, useSession(restored));
    if (generationAtStart === generation && state !== before) {
      deps.reloadWindow();
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
      await refreshTeamNow(generationAtStart);
    }
  }

  function currentState(): AuthState {
    return state;
  }

  function status(): AuthStatus {
    const own = state === "waiting" || state === "signed-in" ? email : null;
    return { state, email: own !== null && emailShape.safeParse(own).success ? own : null };
  }

  manager?.onEnded(() => {
    generation += 1;
    endLocally();
    deps.reloadWindow();
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
        await refreshTeamNow(generationAtStart);
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
      endLocally();
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
      deps.reloadWindow();
    },

    close() {
      generation += 1;
      manager?.close();
      keys.clear();
      closeLive();
      example?.close();
      example = null;
    },

    teamKeys: { youtubeKey: () => keys.youtubeKey() },
  };
}
