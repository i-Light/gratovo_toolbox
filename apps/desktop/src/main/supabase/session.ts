/**
 * The signed-in session, kept in the main process (plan G4). On disk: only the secret
 * `supabase.session` = JSON `{ userId, email, refreshToken }`, encrypted by the secret store. The
 * access token lives in memory only.
 *
 * Refresh: single flight, 60 s before the access token expires; after a failed attempt the timer
 * backs off 30 s, 2 min, then every 10 min. The stored refresh token is replaced after every
 * rotation, because Supabase refresh tokens are single-use: a stale one is refused with
 * `refresh_token_already_used` (https://supabase.com/docs/guides/auth/sessions). On the local
 * stack (CLI 2.119.0, 2026-10-20) that refusal left the newest token working; the docs say a
 * reuse can end the whole session, so a stale token is treated as ended either way.
 *
 * The session ends only when the Auth server says so (`AuthError` kind `ended`); network errors,
 * 5xx, 429 and the rest keep it. Nothing here logs.
 */

import { z } from "zod";

import type { SecretStore } from "../secret-store";
import type { AuthClient, Tokens } from "./auth-client";
import { AuthError } from "./auth-client";

export const sessionSecretName = "supabase.session";

const refreshAheadMs = 60_000;
const backOffMs: readonly number[] = [30_000, 120_000, 600_000];
const maxTimerMs = 2_147_483_647;

export interface Session {
  readonly userId: string;
  readonly email: string;
  /**
   * A valid access token, refreshed first when it expires within 60 s (one refresh at a time).
   * Pass `rejected` with a token the server just refused (a 401) to force a refresh, unless the
   * token has already changed since. Throws `AuthError`.
   */
  accessToken(options?: { rejected?: string }): Promise<string>;
  /** Signs out: deletes the stored session, then ends it on the server (best effort). */
  end(): Promise<void>;
}

export interface Timers {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface SessionManager {
  /** The stored session after one refresh; still returned when offline, null when ended or absent. */
  restore(): Promise<Session | null>;
  /** Stores a new sign-in's session; it replaces any current one. Throws when it can't be stored. */
  start(tokens: Tokens): Promise<Session>;
  /** Called once when the server ends the current session (never for `end()` or `close()`). */
  onEnded(listener: () => void): void;
  /** Stops the refresh timer at quit; the stored session stays for the next start. */
  close(): void;
}

const storedSession = z.strictObject({
  userId: z.string().min(1),
  email: z.string(),
  refreshToken: z.string().min(1),
});

const realTimers: Timers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

function asAuthError(error: unknown): AuthError {
  return error instanceof AuthError ? error : new AuthError("unavailable");
}

interface Live extends Session {
  /** Runs a refresh now, or joins the one in flight. */
  refresh(): Promise<string>;
  /** Stops it without touching the stored secret. */
  close(): void;
  /** From now on a server-side end is reported to the listeners. */
  announce(): void;
}

export function createSessionManager(o: {
  auth: Pick<AuthClient, "refresh" | "signOut">;
  store: SecretStore;
  now: () => number;
  timers?: Timers;
}): SessionManager {
  const timers = o.timers ?? realTimers;
  const listeners: (() => void)[] = [];
  let current: Live | null = null;

  function open(
    userId: string,
    email: string,
    firstRefreshToken: string,
    firstAccess: { token: string; expiresAt: number } | null,
  ): Live {
    let refreshToken = firstRefreshToken;
    let access = firstAccess;
    let state: "live" | "ended" | "closed" = "live";
    let announced = false;
    let inflight: Promise<string> | null = null;
    let timer: unknown = null;
    let failures = 0;

    function schedule(ms: number): void {
      if (timer !== null) {
        timers.clear(timer);
      }
      timer = timers.set(
        () => {
          timer = null;
          refresh().catch(() => undefined);
        },
        Math.min(Math.max(0, ms), maxTimerMs),
      );
    }

    function stop(next: "ended" | "closed"): void {
      state = next;
      access = null;
      if (timer !== null) {
        timers.clear(timer);
        timer = null;
      }
    }

    async function endedByServer(): Promise<void> {
      if (state !== "live") {
        return;
      }
      stop("ended");
      try {
        await o.store.delete(sessionSecretName);
      } catch {
        // The next restore refreshes it, is refused and deletes it then.
      }
      if (announced) {
        for (const listener of listeners) {
          listener();
        }
      }
    }

    async function persist(): Promise<void> {
      if (state !== "live") {
        return;
      }
      try {
        await o.store.set(sessionSecretName, JSON.stringify({ userId, email, refreshToken }));
      } catch {
        // Kept in memory; the next rotation tries again.
      }
    }

    async function run(): Promise<string> {
      try {
        const tokens = await o.auth.refresh(refreshToken);
        if (state !== "live") {
          throw new AuthError("ended");
        }
        // A refresh token that comes back as someone else is never accepted.
        if (tokens.userId !== userId) {
          throw new AuthError("ended", "user_changed");
        }
        refreshToken = tokens.refreshToken;
        access = { token: tokens.accessToken, expiresAt: tokens.expiresAt };
        failures = 0;
        await persist();
        schedule(tokens.expiresAt - refreshAheadMs - o.now());
        return tokens.accessToken;
      } catch (error) {
        const failure = asAuthError(error);
        if (failure.kind === "ended") {
          await endedByServer();
        } else if (state === "live") {
          schedule(backOffMs[Math.min(failures, backOffMs.length - 1)] ?? 600_000);
          failures += 1;
        }
        throw failure;
      } finally {
        inflight = null;
      }
    }

    function refresh(): Promise<string> {
      inflight ??= run();
      return inflight;
    }

    if (access !== null) {
      schedule(access.expiresAt - refreshAheadMs - o.now());
    }

    return {
      userId,
      email,

      async accessToken(options = {}) {
        if (state !== "live") {
          throw new AuthError("ended");
        }
        const held = access;
        const usable = held !== null && held.token !== options.rejected;
        if (usable && o.now() < held.expiresAt - refreshAheadMs) {
          return held.token;
        }
        try {
          return await refresh();
        } catch (error) {
          // Offline near the end of its life, a token that still works is better than none.
          const failure = asAuthError(error);
          if (failure.kind !== "ended" && usable && o.now() < held.expiresAt) {
            return held.token;
          }
          throw failure;
        }
      },

      async end() {
        if (state === "closed") {
          return;
        }
        const token = access !== null && o.now() < access.expiresAt ? access.token : null;
        stop("closed");
        await o.store.delete(sessionSecretName);
        if (token !== null) {
          await o.auth.signOut(token);
        }
      },

      refresh,

      close() {
        if (state === "live") {
          stop("closed");
        }
      },

      announce() {
        announced = true;
      },
    };
  }

  return {
    async restore() {
      const raw = await o.store.get(sessionSecretName);
      if (raw === undefined) {
        return null;
      }
      let saved: z.infer<typeof storedSession>;
      try {
        saved = storedSession.parse(JSON.parse(raw));
      } catch {
        await o.store.delete(sessionSecretName);
        return null;
      }
      current?.close();
      const session = open(saved.userId, saved.email, saved.refreshToken, null);
      current = session;
      try {
        await session.refresh();
      } catch (error) {
        if (asAuthError(error).kind === "ended") {
          // A `start()` that ran meanwhile has replaced it; leave the new session alone.
          if (current === session) {
            current = null;
          }
          return null;
        }
        // Offline or the server is unwell: the caller opens the local copy, the timer retries.
      }
      session.announce();
      return session;
    },

    async start(tokens) {
      // Close the old one first, so its refresh can't write its token over the new one.
      current?.close();
      current = null;
      await o.store.set(
        sessionSecretName,
        JSON.stringify({
          userId: tokens.userId,
          email: tokens.email,
          refreshToken: tokens.refreshToken,
        }),
      );
      const session = open(tokens.userId, tokens.email, tokens.refreshToken, {
        token: tokens.accessToken,
        expiresAt: tokens.expiresAt,
      });
      session.announce();
      current = session;
      return session;
    },

    onEnded(listener) {
      listeners.push(listener);
    },

    close() {
      current?.close();
      current = null;
    },
  };
}
