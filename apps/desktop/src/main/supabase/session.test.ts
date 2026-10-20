import { describe, expect, it, vi } from "vitest";

import type { SecretStore } from "../secret-store";
import type { AuthClient, Tokens } from "./auth-client";
import { AuthError } from "./auth-client";
import type { Timers } from "./session";
import { createSessionManager, sessionSecretName } from "./session";

const minute = 60_000;
const hour = 60 * minute;

/** An in-memory secret store that remembers every value it was given. */
function memoryStore() {
  const values = new Map<string, string>();
  const written: string[] = [];
  const store: SecretStore = {
    get: (name) => Promise.resolve(values.get(name)),
    set: (name, value) => {
      written.push(value);
      values.set(name, value);
      return Promise.resolve();
    },
    delete: (name) => Promise.resolve(values.delete(name)),
    has: (name) => Promise.resolve(values.has(name)),
    names: () => Promise.resolve([...values.keys()].sort()),
  };
  return { store, values, written };
}

/** Timers driven by hand: `due()` lists the pending delays, `fire()` runs them. */
function manualTimers() {
  let next = 0;
  const pending = new Map<number, { callback: () => void; ms: number }>();
  const timers: Timers = {
    set: (callback, ms) => {
      next += 1;
      pending.set(next, { callback, ms });
      return next;
    },
    clear: (handle) => {
      pending.delete(handle as number);
    },
  };
  return {
    timers,
    due: () => [...pending.values()].map((entry) => entry.ms),
    fire: () => {
      const entries = [...pending.values()];
      pending.clear();
      for (const entry of entries) {
        entry.callback();
      }
    },
  };
}

function setup(start = 1_000_000) {
  let clock = start;
  let counter = 1;
  const refresh = vi.fn<AuthClient["refresh"]>((): Promise<Tokens> => {
    counter += 1;
    return Promise.resolve({
      accessToken: `access-${String(counter)}`,
      refreshToken: `refresh-${String(counter)}`,
      expiresAt: clock + hour,
      userId: "user-1",
      email: "",
    });
  });
  const signOut = vi.fn<AuthClient["signOut"]>(() => Promise.resolve());
  const memory = memoryStore();
  const manual = manualTimers();
  const manager = createSessionManager({
    auth: { refresh, signOut },
    store: memory.store,
    now: () => clock,
    timers: manual.timers,
  });
  const tokens: Tokens = {
    accessToken: "access-1",
    refreshToken: "refresh-1",
    expiresAt: clock + hour,
    userId: "user-1",
    email: "lina@example.com",
  };
  return {
    ...memory,
    ...manual,
    manager,
    refresh,
    signOut,
    tokens,
    advance: (ms: number) => {
      clock += ms;
    },
    stored: () => {
      const raw = memory.values.get(sessionSecretName);
      return raw === undefined ? undefined : (JSON.parse(raw) as Record<string, string>);
    },
    /** No value the store ever received holds an access token. */
    noAccessTokenStored: () => {
      for (const value of memory.written) {
        expect(value).not.toMatch(/access-/);
      }
    },
  };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("start", () => {
  it("stores the user, the email and the refresh token, never the access token", async () => {
    const t = setup();
    const session = await t.manager.start(t.tokens);

    expect(session.userId).toBe("user-1");
    expect(session.email).toBe("lina@example.com");
    expect(t.stored()).toEqual({
      userId: "user-1",
      email: "lina@example.com",
      refreshToken: "refresh-1",
    });
    t.noAccessTokenStored();
  });

  it("hands out the access token while it is fresh, and refreshes 60 s before it expires", async () => {
    const t = setup();
    const session = await t.manager.start(t.tokens);

    expect(await session.accessToken()).toBe("access-1");
    expect(t.refresh).not.toHaveBeenCalled();
    expect(t.due()).toEqual([hour - minute]);

    t.advance(hour - minute);
    expect(await session.accessToken()).toBe("access-2");
    expect(t.refresh).toHaveBeenCalledOnce();
  });

  it("refreshes when the timer fires", async () => {
    const t = setup();
    const session = await t.manager.start(t.tokens);
    t.advance(hour - minute);
    t.fire();
    await flush();

    expect(t.refresh).toHaveBeenCalledWith("refresh-1");
    expect(t.stored()?.["refreshToken"]).toBe("refresh-2");
    expect(await session.accessToken()).toBe("access-2");
    expect(t.due()).toEqual([hour - minute]);
  });

  it("fails when the session can't be stored, and keeps nothing", async () => {
    const t = setup();
    t.store.set = () => Promise.reject(new Error("Secure storage is not available"));
    await expect(t.manager.start(t.tokens)).rejects.toThrow("Secure storage");
    expect(t.due()).toEqual([]);
  });
});

describe("accessToken", () => {
  it("runs one refresh for two calls at once", async () => {
    const t = setup();
    const session = await t.manager.start(t.tokens);
    t.advance(hour);

    const [a, b] = await Promise.all([session.accessToken(), session.accessToken()]);
    expect(a).toBe("access-2");
    expect(b).toBe("access-2");
    expect(t.refresh).toHaveBeenCalledOnce();
  });

  it("uses the rotated refresh token for the next refresh and stores it", async () => {
    const t = setup();
    const session = await t.manager.start(t.tokens);
    t.advance(hour);
    await session.accessToken();
    t.advance(hour);
    await session.accessToken();

    expect(t.refresh.mock.calls.map((call) => call[0])).toEqual(["refresh-1", "refresh-2"]);
    expect(t.stored()?.["refreshToken"]).toBe("refresh-3");
    t.noAccessTokenStored();
  });

  it("forces a refresh for a rejected token, but not once it has changed", async () => {
    const t = setup();
    const session = await t.manager.start(t.tokens);

    expect(await session.accessToken({ rejected: "access-1" })).toBe("access-2");
    expect(await session.accessToken({ rejected: "access-1" })).toBe("access-2");
    expect(t.refresh).toHaveBeenCalledOnce();
  });

  it("ends the session when the server says so: one event, the secret deleted", async () => {
    const t = setup();
    const ended = vi.fn();
    t.manager.onEnded(ended);
    const session = await t.manager.start(t.tokens);
    t.refresh.mockRejectedValue(new AuthError("ended", "refresh_token_already_used", 400));
    t.advance(hour);

    const results = await Promise.allSettled([session.accessToken(), session.accessToken()]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
    expect(ended).toHaveBeenCalledOnce();
    expect(t.values.has(sessionSecretName)).toBe(false);
    expect(t.due()).toEqual([]);
    await expect(session.accessToken()).rejects.toMatchObject({ kind: "ended" });
    expect(t.refresh).toHaveBeenCalledOnce();
  });

  it("keeps the session when offline and backs off 30 s, 2 min, then 10 min", async () => {
    const t = setup();
    const ended = vi.fn();
    t.manager.onEnded(ended);
    const session = await t.manager.start(t.tokens);
    t.refresh.mockRejectedValue(new AuthError("offline"));
    t.advance(hour);

    await expect(session.accessToken()).rejects.toMatchObject({ kind: "offline" });
    expect(t.due()).toEqual([30_000]);
    for (const expected of [120_000, 600_000, 600_000]) {
      t.fire();
      await flush();
      expect(t.due()).toEqual([expected]);
    }
    expect(ended).not.toHaveBeenCalled();
    expect(t.stored()?.["refreshToken"]).toBe("refresh-1");
  });

  it("keeps the session on a server error or a rate limit", async () => {
    const t = setup();
    const session = await t.manager.start(t.tokens);
    t.advance(hour);
    for (const kind of ["unavailable", "rate-limited"] as const) {
      t.refresh.mockRejectedValueOnce(new AuthError(kind));
      await expect(session.accessToken()).rejects.toMatchObject({ kind });
    }
    expect(t.values.has(sessionSecretName)).toBe(true);
    expect(await session.accessToken()).toBe("access-2");
  });

  it("offline near expiry, still hands out the token that works", async () => {
    const t = setup();
    const session = await t.manager.start(t.tokens);
    t.refresh.mockRejectedValue(new AuthError("offline"));
    t.advance(hour - 30_000);

    expect(await session.accessToken()).toBe("access-1");
  });

  it("ends the session if a refresh comes back as another user", async () => {
    const t = setup();
    const ended = vi.fn();
    t.manager.onEnded(ended);
    const session = await t.manager.start(t.tokens);
    t.refresh.mockResolvedValueOnce({ ...t.tokens, userId: "user-2" });
    t.advance(hour);

    await expect(session.accessToken()).rejects.toMatchObject({ kind: "ended" });
    expect(ended).toHaveBeenCalledOnce();
    expect(t.values.has(sessionSecretName)).toBe(false);
  });
});

describe("restore", () => {
  it("returns null when nothing is stored", async () => {
    const t = setup();
    expect(await t.manager.restore()).toBeNull();
    expect(t.refresh).not.toHaveBeenCalled();
  });

  it("deletes a damaged value", async () => {
    const t = setup();
    t.values.set(sessionSecretName, JSON.stringify({ userId: "user-1" }));
    expect(await t.manager.restore()).toBeNull();
    expect(t.values.has(sessionSecretName)).toBe(false);
  });

  it("refreshes once and stores the rotated token", async () => {
    const t = setup();
    await t.manager.start(t.tokens);
    t.manager.close();

    const session = await t.manager.restore();
    expect(session?.userId).toBe("user-1");
    expect(session?.email).toBe("lina@example.com");
    expect(t.refresh).toHaveBeenCalledExactlyOnceWith("refresh-1");
    expect(await session?.accessToken()).toBe("access-2");
    expect(t.stored()).toEqual({
      userId: "user-1",
      email: "lina@example.com",
      refreshToken: "refresh-2",
    });
    t.noAccessTokenStored();
  });

  it("returns null and deletes the secret when the session has ended, without an event", async () => {
    const t = setup();
    const ended = vi.fn();
    t.manager.onEnded(ended);
    await t.manager.start(t.tokens);
    t.manager.close();
    t.refresh.mockRejectedValue(new AuthError("ended", "session_expired", 400));

    expect(await t.manager.restore()).toBeNull();
    expect(t.values.has(sessionSecretName)).toBe(false);
    expect(ended).not.toHaveBeenCalled();
  });

  it("offline, keeps the secret and returns a session that catches up later", async () => {
    const t = setup();
    await t.manager.start(t.tokens);
    t.manager.close();
    t.refresh.mockRejectedValueOnce(new AuthError("offline"));

    const session = await t.manager.restore();
    expect(session?.userId).toBe("user-1");
    expect(t.stored()?.["refreshToken"]).toBe("refresh-1");
    expect(t.due()).toEqual([30_000]);
    await expect(session?.accessToken()).resolves.toBe("access-2");
  });

  it("lets the stored value outlive close()", async () => {
    const t = setup();
    await t.manager.start(t.tokens);
    t.manager.close();
    expect(t.due()).toEqual([]);
    expect(t.values.has(sessionSecretName)).toBe(true);
  });
});

describe("end", () => {
  it("deletes the secret, signs out on the server and fires no event", async () => {
    const t = setup();
    const ended = vi.fn();
    t.manager.onEnded(ended);
    const session = await t.manager.start(t.tokens);

    await session.end();
    expect(t.values.has(sessionSecretName)).toBe(false);
    expect(t.signOut).toHaveBeenCalledExactlyOnceWith("access-1");
    expect(ended).not.toHaveBeenCalled();
    expect(t.due()).toEqual([]);
    await expect(session.accessToken()).rejects.toMatchObject({ kind: "ended" });
  });

  it("skips the server when the access token has expired", async () => {
    const t = setup();
    const session = await t.manager.start(t.tokens);
    t.advance(2 * hour);
    await session.end();
    expect(t.signOut).not.toHaveBeenCalled();
  });

  it("is not undone by a refresh that was in flight", async () => {
    const t = setup();
    const session = await t.manager.start(t.tokens);
    let answer: (tokens: Tokens) => void = () => undefined;
    t.refresh.mockReturnValueOnce(
      new Promise<Tokens>((resolve) => {
        answer = resolve;
      }),
    );
    t.advance(hour);
    const pending = session.accessToken();
    await session.end();
    answer({ ...t.tokens, accessToken: "access-9", refreshToken: "refresh-9" });

    await expect(pending).rejects.toMatchObject({ kind: "ended" });
    expect(t.values.has(sessionSecretName)).toBe(false);
  });
});

describe("a new sign-in replaces the session", () => {
  it("and the old session's late refresh can't overwrite the new secret", async () => {
    const t = setup();
    const old = await t.manager.start(t.tokens);
    let answer: (tokens: Tokens) => void = () => undefined;
    t.refresh.mockReturnValueOnce(
      new Promise<Tokens>((resolve) => {
        answer = resolve;
      }),
    );
    t.advance(hour);
    const pending = old.accessToken();
    await t.manager.start({ ...t.tokens, refreshToken: "refresh-new", expiresAt: hour * 3 });
    answer({ ...t.tokens, refreshToken: "refresh-late" });

    await expect(pending).rejects.toMatchObject({ kind: "ended" });
    expect(t.stored()?.["refreshToken"]).toBe("refresh-new");
  });
});
