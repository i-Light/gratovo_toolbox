// The app's own auth client and session manager against a real Auth server (GoTrue), not a fake.
// This is also where the facts the client assumes are checked: error bodies, codes and statuses.
import { describe, expect, inject, it } from "vitest";

import { createNetwork } from "../../apps/desktop/src/main/net/network";
import type { SecretStore } from "../../apps/desktop/src/main/secret-store";
import { AuthError, createAuthClient } from "../../apps/desktop/src/main/supabase/auth-client";
import { readSupabaseConfig } from "../../apps/desktop/src/main/supabase/config";
import { createSessionManager } from "../../apps/desktop/src/main/supabase/session";

const fixture = inject("fixture");

const read = readSupabaseConfig({
  packaged: false,
  built: {},
  env: {
    GRATOVO_SUPABASE_URL: fixture.url,
    GRATOVO_SUPABASE_PUBLISHABLE_KEY: fixture.publishableKey,
  },
});
if (!read.ok) {
  throw new Error(`The local stack's address or key was refused: ${read.problem}`);
}
const config = read.config;
const network = createNetwork({ allowedOrigins: [config.origin] });
const auth = createAuthClient(network, config);

/** A secret store in memory that remembers every value it was ever given. */
function memoryStore(): SecretStore & { readonly everWritten: string[] } {
  const values = new Map<string, string>();
  const everWritten: string[] = [];
  return {
    everWritten,
    get: (name) => Promise.resolve(values.get(name)),
    set: (name, value) => {
      values.set(name, value);
      everWritten.push(value);
      return Promise.resolve();
    },
    delete: (name) => Promise.resolve(values.delete(name)),
    has: (name) => Promise.resolve(values.has(name)),
    names: () => Promise.resolve([...values.keys()].sort()),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rejection(promise: Promise<unknown>): Promise<AuthError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AuthError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected the call to fail.");
}

describe("what the Auth server answers (the facts the client relies on)", () => {
  it("a wrong password: 400, a body with error_code, and the x-sb-error-code header", async () => {
    const response = await fetch(`${fixture.url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: fixture.publishableKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email: fixture.member.email, password: "not-the-password" }),
    });
    const body = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(400);
    expect(body["error_code"]).toBe("invalid_credentials");
    expect(typeof body["msg"]).toBe("string");
    // Without an X-Supabase-Api-Version header, `code` is the HTTP status, not the error code.
    expect(body["code"]).toBe(400);
    expect(response.headers.get("x-sb-error-code")).toBe("invalid_credentials");
  });

  it("a refresh token that does not exist: 400 refresh_token_not_found", async () => {
    const response = await fetch(`${fixture.url}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: fixture.publishableKey, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: "abcdefghijkl" }),
    });
    const body = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(400);
    expect(body["error_code"]).toBe("refresh_token_not_found");
    expect(response.headers.get("x-sb-error-code")).toBe("refresh_token_not_found");
  });

  it("logout with scope=local answers 204", async () => {
    const tokens = await auth.signIn(fixture.member.email, fixture.member.password);
    const response = await fetch(`${fixture.url}/auth/v1/logout?scope=local`, {
      method: "POST",
      headers: { apikey: fixture.publishableKey, Authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(response.status).toBe(204);
  });
});

describe("the auth client", () => {
  it("signs in with a password and returns tokens for that user", async () => {
    const tokens = await auth.signIn(fixture.member.email, fixture.member.password);
    expect(tokens.userId).toBe(fixture.member.id);
    expect(tokens.email).toBe(fixture.member.email);
    expect(tokens.accessToken.split(".")).toHaveLength(3);
    expect(tokens.refreshToken.length).toBeGreaterThan(0);
    expect(tokens.expiresAt).toBeGreaterThan(Date.now() + 30 * 60_000);
  });

  it("ignores spaces around the email", async () => {
    const tokens = await auth.signIn(` ${fixture.member.email} `, fixture.member.password);
    expect(tokens.userId).toBe(fixture.member.id);
  });

  it("maps a wrong password and an unknown email to invalid, with the code and status", async () => {
    const wrong = await rejection(auth.signIn(fixture.member.email, "not-the-password"));
    expect(wrong).toMatchObject({ kind: "invalid", code: "invalid_credentials", status: 400 });
    const unknown = await rejection(auth.signIn("nobody@example.test", "not-the-password"));
    expect(unknown).toMatchObject({ kind: "invalid", code: "invalid_credentials", status: 400 });
    // The message names no password and no email.
    expect(wrong.message).not.toContain("not-the-password");
    expect(wrong.message).not.toContain(fixture.member.email);
  });

  it("maps an account whose email is not confirmed to unconfirmed", async () => {
    const error = await rejection(
      auth.signIn(fixture.unconfirmed.email, fixture.unconfirmed.password),
    );
    expect(error).toMatchObject({ kind: "unconfirmed", code: "email_not_confirmed" });
  });

  it("refreshes and the refresh token rotates", async () => {
    const first = await auth.signIn(fixture.member.email, fixture.member.password);
    const second = await auth.refresh(first.refreshToken);
    expect(second.userId).toBe(fixture.member.id);
    expect(second.refreshToken).not.toBe(first.refreshToken);
  });

  it("maps an unknown refresh token to ended", async () => {
    const error = await rejection(auth.refresh("abcdefghijkl"));
    expect(error).toMatchObject({ kind: "ended", code: "refresh_token_not_found" });
  });

  it("reports offline when nothing answers", async () => {
    const dead = "http://127.0.0.1:1";
    const offline = createAuthClient(createNetwork({ allowedOrigins: [dead] }), {
      ...config,
      url: dead,
      origin: dead,
    });
    const error = await rejection(offline.signIn(fixture.member.email, fixture.member.password));
    expect(error.kind).toBe("offline");
  });

  it("signOut ends only that session: its refresh token no longer works", async () => {
    const tokens = await auth.signIn(fixture.member.email, fixture.member.password);
    const other = await auth.signIn(fixture.member.email, fixture.member.password);
    await auth.signOut(tokens.accessToken);
    const error = await rejection(auth.refresh(tokens.refreshToken));
    expect(error.kind).toBe("ended");
    // The other device's session is untouched (scope=local).
    expect((await auth.refresh(other.refreshToken)).userId).toBe(fixture.member.id);
  });

  it("signOut with a bad token does not throw", async () => {
    await expect(auth.signOut("not-a-token")).resolves.toBeUndefined();
  });
});

describe("the session manager", () => {
  it("restores a stored session after a restart, rotates it, and never stores the access token", async () => {
    const store = memoryStore();
    const first = createSessionManager({ auth, store, now: Date.now });
    const tokens = await auth.signIn(fixture.member.email, fixture.member.password);
    const session = await first.start(tokens);
    expect(session.userId).toBe(fixture.member.id);
    first.close();

    const second = createSessionManager({ auth, store, now: Date.now });
    const restored = await second.restore();
    expect(restored?.userId).toBe(fixture.member.id);
    const access = await restored?.accessToken();
    expect(access?.split(".")).toHaveLength(3);
    second.close();

    expect(store.everWritten.length).toBeGreaterThan(0);
    for (const written of store.everWritten) {
      expect(written).not.toContain(tokens.accessToken);
      expect(written).not.toContain(access ?? "no access token");
    }
    // The refresh token in the store changed when the server rotated it.
    expect(store.everWritten.at(-1)).not.toContain(tokens.refreshToken);
  });

  it("two accessToken() calls at once cause one refresh", async () => {
    const store = memoryStore();
    // A clock 59 minutes ahead makes the token look about to expire, so a call refreshes.
    const manager = createSessionManager({ auth, store, now: () => Date.now() + 59 * 60_000 });
    const session = await manager.start(
      await auth.signIn(fixture.member.email, fixture.member.password),
    );
    const writes = store.everWritten.length;
    const [a, b] = await Promise.all([session.accessToken(), session.accessToken()]);
    expect(a).toBe(b);
    expect(store.everWritten.length).toBe(writes + 1);
    manager.close();
  });

  it("after sign-out on the server, restore() gives null and deletes the stored secret", async () => {
    const store = memoryStore();
    const manager = createSessionManager({ auth, store, now: Date.now });
    const tokens = await auth.signIn(fixture.member.email, fixture.member.password);
    await manager.start(tokens);
    manager.close();
    await auth.signOut(tokens.accessToken);

    const restarted = createSessionManager({ auth, store, now: Date.now });
    expect(await restarted.restore()).toBeNull();
    expect(await store.names()).toEqual([]);
  });

  it("end() signs out on the server and forgets the secret", async () => {
    const store = memoryStore();
    const manager = createSessionManager({ auth, store, now: Date.now });
    const tokens = await auth.signIn(fixture.member.email, fixture.member.password);
    const session = await manager.start(tokens);
    await session.end();
    expect(await store.names()).toEqual([]);
    const error = await rejection(auth.refresh(tokens.refreshToken));
    expect(error.kind).toBe("ended");
  });

  it("reusing an old refresh token after the reuse window is refused as ended", async () => {
    const first = await auth.signIn(fixture.member.email, fixture.member.password);
    const second = await auth.refresh(first.refreshToken);
    const third = await auth.refresh(second.refreshToken);
    // config.toml: refresh_token_reuse_interval = 10 seconds.
    await sleep(11_000);
    const reuse = await rejection(auth.refresh(first.refreshToken));
    expect(reuse).toMatchObject({
      kind: "ended",
      code: "refresh_token_already_used",
      status: 400,
    });
    // Checked on CLI 2.119.0: the newest token of that session still works. The plan assumed the
    // whole session would end; it does not, so a lost rotation only costs the stale token.
    expect((await auth.refresh(third.refreshToken)).userId).toBe(fixture.member.id);
  }, 40_000);
});
