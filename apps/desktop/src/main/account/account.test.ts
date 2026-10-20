import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { channels, createDispatcher } from "@gratovo/ipc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getMeta } from "../data/repositories";
import { openDatabase } from "../db/open-database";
import { createHandlers } from "../handlers";
import { createNetwork } from "../net/network";
import { createSecretStore, type Cipher } from "../secret-store";
import type { SupabaseConfig } from "../supabase/config";
import { sessionSecretName, type Timers } from "../supabase/session";

import { createAccount, exampleFile, liveFile, type Account } from "./account";
import { keyLifetimeMs } from "./team-keys";

const config: SupabaseConfig = {
  url: "https://abcdefghijklmnopqrst.supabase.co",
  origin: "https://abcdefghijklmnopqrst.supabase.co",
  publishableKey: "sb_publishable_test000",
};

const at = "2026-10-20T10:00:00.000Z";
const password = "pw-test-000-correct";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A Supabase stand-in: Auth's token and logout endpoints, the tables and the RPC the account uses. */
function fakeSupabase() {
  const users: { id: string; email: string; password: string }[] = [];
  const profiles = new Map<string, Record<string, unknown>>();
  const access = new Map<string, Record<string, unknown>>();
  const refreshTokens = new Map<string, string>();
  const accessTokens = new Map<string, string>();
  const issued: string[] = [];
  const requests: { method: string; path: string; body: string }[] = [];
  const server = {
    online: true,
    youtubeKey: "yt-test-000" as string | null,
    users,
    profiles,
    issued,
    requests,
  };

  function addUser(email: string, role: string, roles: string[] = [], seesMoney = false): string {
    const id = `00000000-0000-4000-8000-${String(users.length + 1).padStart(12, "0")}`;
    users.push({ id, email, password });
    profiles.set(id, {
      id,
      display_name: email.split("@")[0] ?? "",
      color: "#112233",
      role,
      created_at: at,
      updated_at: at,
    });
    access.set(id, { profile_id: id, roles, sees_money: seesMoney, updated_at: at });
    return id;
  }

  function issue(userId: string): Response {
    const accessToken = `at-${randomUUID()}`;
    const refreshToken = `rt-${randomUUID()}`;
    accessTokens.set(accessToken, userId);
    refreshTokens.set(refreshToken, userId);
    issued.push(accessToken, refreshToken);
    const email = users.find((user) => user.id === userId)?.email;
    return json({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 3600,
      token_type: "bearer",
      user: { id: userId, email },
    });
  }

  /** Ends every session of a member, as an admin would. */
  function revoke(userId: string): void {
    for (const tokens of [accessTokens, refreshTokens]) {
      for (const [token, owner] of tokens) {
        if (owner === userId) {
          tokens.delete(token);
        }
      }
    }
  }

  const fetchFake: typeof fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : "";
    requests.push({ method, path: `${url.pathname}${url.search}`, body });
    if (!server.online) {
      return Promise.reject(new TypeError("fetch failed"));
    }
    const headers = new Headers(init?.headers);
    if (headers.get("apikey") !== config.publishableKey) {
      return Promise.resolve(json({ message: "No API key" }, 401));
    }

    if (url.pathname === "/auth/v1/token") {
      const sent = JSON.parse(body) as Record<string, string>;
      if (url.searchParams.get("grant_type") === "password") {
        const user = users.find(
          (u) => u.email === sent["email"] && u.password === sent["password"],
        );
        return Promise.resolve(
          user === undefined
            ? json({ code: 400, error_code: "invalid_credentials", msg: "Invalid" }, 400)
            : issue(user.id),
        );
      }
      const owner = refreshTokens.get(sent["refresh_token"] ?? "");
      if (owner === undefined) {
        return Promise.resolve(
          json({ code: 400, error_code: "refresh_token_not_found", msg: "Gone" }, 400),
        );
      }
      refreshTokens.delete(sent["refresh_token"] ?? "");
      return Promise.resolve(issue(owner));
    }

    const caller = accessTokens.get((headers.get("Authorization") ?? "").replace(/^Bearer /, ""));
    if (url.pathname === "/auth/v1/logout") {
      if (caller !== undefined) {
        revoke(caller);
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (caller === undefined) {
      return Promise.resolve(json({ code: "PGRST301", message: "JWT expired" }, 401));
    }
    const role = profiles.get(caller)?.["role"];
    const authorized = role === "basic" || role === "full";
    const idFilter = url.searchParams.get("id")?.replace(/^eq\./, "");

    if (method === "GET" && url.pathname === "/rest/v1/profiles") {
      const rows = [...profiles.values()].filter(
        (row) => (authorized || row["id"] === caller) && (idFilter ?? row["id"]) === row["id"],
      );
      return Promise.resolve(json(rows));
    }
    if (method === "GET" && url.pathname === "/rest/v1/member_access") {
      const rows = [...access.values()].filter((row) => authorized || row["profile_id"] === caller);
      return Promise.resolve(json(rows));
    }
    if (method === "PATCH" && url.pathname === "/rest/v1/profiles") {
      const row = profiles.get(caller);
      if (row !== undefined && idFilter === caller) {
        row["display_name"] = (JSON.parse(body) as { display_name: string }).display_name;
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (method === "POST" && url.pathname === "/rest/v1/rpc/team_youtube_key") {
      return Promise.resolve(
        authorized ? json(server.youtubeKey) : json({ code: "42501", message: "No" }, 403),
      );
    }
    return Promise.resolve(json({ message: "Not found" }, 404));
  };

  return {
    ...server,
    get online() {
      return server.online;
    },
    set online(value: boolean) {
      server.online = value;
    },
    get youtubeKey() {
      return server.youtubeKey;
    },
    set youtubeKey(value: string | null) {
      server.youtubeKey = value;
    },
    fetch: fetchFake,
    addUser,
    revoke,
    setRole: (id: string, role: string) => {
      const row = profiles.get(id);
      if (row !== undefined) {
        row["role"] = role;
      }
    },
    count: (method: string, prefix: string) =>
      requests.filter((r) => r.method === method && r.path.startsWith(prefix)).length,
  };
}

type Fake = ReturnType<typeof fakeSupabase>;

/** A stand-in for safeStorage: reverses the text, or refuses when "unavailable". */
function fakeCipher(available = true): Cipher {
  // Byte reversal: enough to keep the text out of the file in clear, and to read it back.
  const flip = (bytes: Buffer) => Buffer.from(bytes).reverse();
  return {
    isAvailable: () => available,
    encrypt: (plainText) => flip(Buffer.from(plainText, "utf8")),
    decrypt: (cipherText) => flip(cipherText).toString("utf8"),
  };
}

// The refresh timer never fires in these tests; the session tests cover it.
const noTimers: Timers = { set: () => 0, clear: () => undefined };

let dir = "";
let opened: Account[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gratovo-account-"));
  opened = [];
});

afterEach(async () => {
  for (const account of opened) {
    account.close();
  }
  await rm(dir, { recursive: true, force: true });
});

function makeAccount(
  server: Fake,
  o: { configured?: boolean; cipher?: Cipher; now?: () => number } = {},
) {
  const logs: string[] = [];
  const reload = vi.fn();
  const secrets = createSecretStore(join(dir, "secrets.json"), o.cipher ?? fakeCipher());
  const account = createAccount({
    config: o.configured === false ? null : config,
    userData: dir,
    secrets,
    network: createNetwork({ allowedOrigins: [config.origin], fetch: server.fetch }),
    now: o.now ?? Date.now,
    reloadWindow: reload,
    timers: noTimers,
    log: (line) => logs.push(line),
  });
  opened.push(account);
  return { account, logs, reload, secrets };
}

const livePath = () => join(dir, liveFile);

/** Reads `_meta` from the live file, as a later start would. */
function liveMeta(key: string): string | null {
  const db = openDatabase(livePath());
  try {
    return getMeta(db, key);
  } finally {
    db.close();
  }
}

async function frameOf(account: Account) {
  const source = account.source();
  if (source === null) {
    throw new Error("no source");
  }
  return channels["frame:load"].response.parse(await source.frame());
}

describe("unconfigured", () => {
  it("shows the example data and offers no sign-in", async () => {
    const server = fakeSupabase();
    const { account } = makeAccount(server, { configured: false });
    await account.start();

    expect(account.status()).toEqual({ state: "unconfigured", email: null });
    expect((await frameOf(account)).me).toBe("u1");
    expect(existsSync(join(dir, exampleFile))).toBe(true);
    expect(await account.signIn("sam@example.com", password)).toEqual({
      ok: false,
      problem: "unavailable",
    });
    expect(server.requests).toEqual([]);
  });
});

describe("signing in", () => {
  it("starts signed out with no data open", async () => {
    const { account } = makeAccount(fakeSupabase());
    await account.start();
    expect(account.status()).toEqual({ state: "signed-out", email: null });
    expect(account.source()).toBeNull();
  });

  it("answers invalid for a wrong password and stores nothing", async () => {
    const server = fakeSupabase();
    server.addUser("sam@example.com", "full", ["owner"], true);
    const { account, secrets } = makeAccount(server);
    await account.start();

    expect(await account.signIn("sam@example.com", "wrong-000")).toEqual({
      ok: false,
      problem: "invalid",
    });
    expect(account.status().state).toBe("signed-out");
    expect(await secrets.has(sessionSecretName)).toBe(false);
  });

  it("answers offline when the server can't be reached", async () => {
    const server = fakeSupabase();
    server.online = false;
    const { account } = makeAccount(server);
    await account.start();
    expect(await account.signIn("sam@example.com", password)).toEqual({
      ok: false,
      problem: "offline",
    });
  });

  it("answers no-safe-storage when the session can't be stored, and stays signed out", async () => {
    const server = fakeSupabase();
    server.addUser("sam@example.com", "full", ["owner"], true);
    const { account } = makeAccount(server, { cipher: fakeCipher(false) });
    await account.start();
    expect(await account.signIn("sam@example.com", password)).toEqual({
      ok: false,
      problem: "no-safe-storage",
    });
    expect(account.status().state).toBe("signed-out");
    expect(existsSync(livePath())).toBe(false);
  });

  it("opens the member's live copy with the team already in it", async () => {
    const server = fakeSupabase();
    const sam = server.addUser("sam@example.com", "full", ["owner"], true);
    const omar = server.addUser("omar@example.com", "basic", ["scout", "outreach"]);
    const { account, secrets } = makeAccount(server);
    await account.start();

    expect(await account.signIn("sam@example.com", password)).toEqual({
      ok: true,
      state: "signed-in",
    });
    expect(account.status()).toEqual({ state: "signed-in", email: "sam@example.com" });
    const frame = await frameOf(account);
    expect(frame.me).toBe(sam);
    expect(frame.myName).toBe("sam");
    expect(frame.seesMoney).toBe(true);
    expect(frame.team.map((m) => [m.id, m.roles])).toEqual([
      [sam, ["owner"]],
      [omar, ["scout", "outreach"]],
    ]);
    expect(frame.creators).toEqual([]);
    expect(liveMeta("account.user_id")).toBe(sam);
    expect(liveMeta("account.access")).toBe("full");

    // Only the refresh token is stored: never the access token or the password.
    const stored = JSON.parse((await secrets.get(sessionSecretName)) ?? "{}") as object;
    expect(Object.keys(stored).sort()).toEqual(["email", "refreshToken", "userId"]);
    const file = await readFile(join(dir, "secrets.json"), "utf8");
    expect(file).not.toContain(password);
  });

  it("shows waiting for an unauthorized account, then lets it in on Check again", async () => {
    const server = fakeSupabase();
    const lina = server.addUser("lina@example.com", "unauthorized");
    const { account } = makeAccount(server);
    await account.start();

    expect(await account.signIn("lina@example.com", password)).toEqual({
      ok: true,
      state: "waiting",
    });
    expect(account.status()).toEqual({ state: "waiting", email: "lina@example.com" });
    expect(account.source()).toBeNull();
    expect(liveMeta("account.access")).toBe("unauthorized");

    expect(await account.recheck()).toEqual({ state: "waiting", email: "lina@example.com" });

    server.setRole(lina, "basic");
    expect(await account.recheck()).toEqual({ state: "signed-in", email: "lina@example.com" });
    const frame = await frameOf(account);
    expect(frame.me).toBe(lina);
    expect(frame.seesMoney).toBe(false);
  });

  it("deletes another account's live copy when someone else signs in", async () => {
    const server = fakeSupabase();
    server.addUser("sam@example.com", "full", ["owner"], true);
    const omar = server.addUser("omar@example.com", "basic", ["scout"]);
    const { account } = makeAccount(server);
    await account.start();
    await account.signIn("sam@example.com", password);
    await account.source()?.write([{ kind: "log.add", id: randomUUID(), at: 1, text: "Sam's" }]);
    expect((await frameOf(account)).log).toHaveLength(1);

    expect(await account.signIn("omar@example.com", password)).toEqual({
      ok: true,
      state: "signed-in",
    });
    const frame = await frameOf(account);
    expect(frame.me).toBe(omar);
    expect(frame.log).toEqual([]);
    expect(liveMeta("account.user_id")).toBe(omar);
  });
});

describe("signing out", () => {
  it("deletes the session, the live copy and the key cache, then reloads", async () => {
    const server = fakeSupabase();
    server.addUser("sam@example.com", "full", ["owner"], true);
    const { account, secrets, reload } = makeAccount(server);
    await account.start();
    await account.signIn("sam@example.com", password);
    expect(await account.teamKeys.youtubeKey()).toBe("yt-test-000");

    await account.signOut();

    expect(account.status()).toEqual({ state: "signed-out", email: null });
    expect(account.source()).toBeNull();
    expect(await secrets.has(sessionSecretName)).toBe(false);
    for (const suffix of ["", "-wal", "-shm"]) {
      expect(existsSync(`${livePath()}${suffix}`)).toBe(false);
    }
    expect(server.count("POST", "/auth/v1/logout?scope=local")).toBe(1);
    expect(reload).toHaveBeenCalledOnce();
    await expect(account.teamKeys.youtubeKey()).rejects.toThrow("signed-in members");
  });

  it("still deletes everything when the server can't be reached", async () => {
    const server = fakeSupabase();
    server.addUser("sam@example.com", "full", ["owner"], true);
    const { account, secrets, reload } = makeAccount(server);
    await account.start();
    await account.signIn("sam@example.com", password);
    server.online = false;

    await account.signOut();

    expect(await secrets.has(sessionSecretName)).toBe(false);
    expect(existsSync(livePath())).toBe(false);
    expect(reload).toHaveBeenCalledOnce();
  });
});

describe("starting with a stored session", () => {
  async function signedInBefore(server: Fake, email = "sam@example.com") {
    const first = makeAccount(server);
    await first.account.start();
    await first.account.signIn(email, password);
    first.account.close();
  }

  it("opens the local copy at once and checks behind it without a reload", async () => {
    const server = fakeSupabase();
    const sam = server.addUser("sam@example.com", "full", ["owner"], true);
    await signedInBefore(server);
    const before = server.count("GET", "/rest/v1/member_access");

    const { account, reload } = makeAccount(server);
    await account.start();
    expect(account.status()).toEqual({ state: "signed-in", email: "sam@example.com" });
    expect((await frameOf(account)).me).toBe(sam);

    await vi.waitFor(() => {
      expect(server.count("GET", "/rest/v1/member_access")).toBe(before + 1);
    });
    await account.recheck();
    expect(account.status().state).toBe("signed-in");
    expect(reload).not.toHaveBeenCalled();
  });

  it("opens the local copy offline and stays signed in", async () => {
    const server = fakeSupabase();
    server.addUser("sam@example.com", "full", ["owner"], true);
    await signedInBefore(server);
    server.online = false;

    const { account, reload, secrets } = makeAccount(server);
    await account.start();
    expect(account.status().state).toBe("signed-in");
    expect((await frameOf(account)).team).toHaveLength(1);

    expect(await account.recheck()).toEqual({ state: "signed-in", email: "sam@example.com" });
    expect(reload).not.toHaveBeenCalled();
    expect(await secrets.has(sessionSecretName)).toBe(true);
  });

  it("refuses a name change offline, so the page shows Not saved", async () => {
    const server = fakeSupabase();
    server.addUser("sam@example.com", "full", ["owner"], true);
    await signedInBefore(server);
    server.online = false;
    const { account } = makeAccount(server);
    await account.start();
    await account.recheck();

    await expect(account.source()?.write([{ kind: "me.name", name: "Samuel" }])).rejects.toThrow();
    expect((await frameOf(account)).myName).toBe("sam");
  });

  it("signs out, deletes the copy and reloads when the server has ended the session", async () => {
    const server = fakeSupabase();
    const sam = server.addUser("sam@example.com", "full", ["owner"], true);
    await signedInBefore(server);
    server.revoke(sam);

    const { account, reload, secrets } = makeAccount(server);
    await account.start();
    expect(account.status().state).toBe("signed-in");

    await vi.waitFor(() => {
      expect(reload).toHaveBeenCalledOnce();
    });
    expect(account.status()).toEqual({ state: "signed-out", email: null });
    expect(account.source()).toBeNull();
    expect(existsSync(livePath())).toBe(false);
    expect(await secrets.has(sessionSecretName)).toBe(false);
  });

  it("moves to waiting and reloads when the access was taken away", async () => {
    const server = fakeSupabase();
    const sam = server.addUser("sam@example.com", "full", ["owner"], true);
    await signedInBefore(server);
    server.setRole(sam, "unauthorized");

    const { account, reload } = makeAccount(server);
    await account.start();
    await vi.waitFor(() => {
      expect(reload).toHaveBeenCalledOnce();
    });
    expect(account.status()).toEqual({ state: "waiting", email: "sam@example.com" });
    expect(account.source()).toBeNull();
    expect(liveMeta("account.access")).toBe("unauthorized");
  });

  it("starts waiting when the last check said so, and lets the member in once promoted", async () => {
    const server = fakeSupabase();
    const lina = server.addUser("lina@example.com", "unauthorized");
    await signedInBefore(server, "lina@example.com");
    server.setRole(lina, "basic");

    const { account, reload } = makeAccount(server);
    await account.start();
    expect(account.status().state).toBe("waiting");
    await vi.waitFor(() => {
      expect(reload).toHaveBeenCalledOnce();
    });
    expect(account.status().state).toBe("signed-in");
  });

  it("asks the server first when there is no local copy, and shows sign-in offline", async () => {
    const server = fakeSupabase();
    const sam = server.addUser("sam@example.com", "full", ["owner"], true);
    await signedInBefore(server);
    await rm(livePath(), { force: true });

    const online = makeAccount(server);
    await online.account.start();
    expect(online.account.status().state).toBe("signed-in");
    expect((await frameOf(online.account)).me).toBe(sam);
    online.account.close();

    await rm(livePath(), { force: true });
    server.online = false;
    const offline = makeAccount(server);
    await offline.account.start();
    expect(offline.account.status().state).toBe("signed-out");
    expect(await offline.secrets.has(sessionSecretName)).toBe(true);
  });
});

describe("a session the server ends while the app runs", () => {
  it("signs out, deletes the copy and reloads", async () => {
    const server = fakeSupabase();
    const sam = server.addUser("sam@example.com", "full", ["owner"], true);
    const { account, reload } = makeAccount(server);
    await account.start();
    await account.signIn("sam@example.com", password);
    server.revoke(sam);

    expect(await account.recheck()).toEqual({ state: "signed-out", email: null });
    expect(reload).toHaveBeenCalledOnce();
    expect(existsSync(livePath())).toBe(false);
  });
});

describe("your name", () => {
  it("reaches the server before the local copy", async () => {
    const server = fakeSupabase();
    const sam = server.addUser("sam@example.com", "full", ["owner"], true);
    const { account } = makeAccount(server);
    await account.start();
    await account.signIn("sam@example.com", password);

    await account.source()?.write([{ kind: "me.name", name: "  Samuel  " }]);

    expect(server.profiles.get(sam)?.["display_name"]).toBe("Samuel");
    expect(server.requests.filter((r) => r.method === "PATCH")).toEqual([
      {
        method: "PATCH",
        path: `/rest/v1/profiles?id=eq.${sam}`,
        body: JSON.stringify({ display_name: "Samuel" }),
      },
    ]);
    expect((await frameOf(account)).myName).toBe("Samuel");
  });
});

describe("team keys", () => {
  it("fetches the YouTube key on demand and keeps it for an hour", async () => {
    let clock = Date.UTC(2026, 9, 20);
    const server = fakeSupabase();
    server.addUser("sam@example.com", "basic", ["scout"]);
    const { account } = makeAccount(server, { now: () => clock });
    await account.start();
    await account.signIn("sam@example.com", password);

    expect(await account.teamKeys.youtubeKey()).toBe("yt-test-000");
    expect(await account.teamKeys.youtubeKey()).toBe("yt-test-000");
    expect(server.count("POST", "/rest/v1/rpc/team_youtube_key")).toBe(1);
    clock += keyLifetimeMs;
    server.youtubeKey = null;
    expect(await account.teamKeys.youtubeKey()).toBeNull();
  });

  it("are refused while waiting or signed out", async () => {
    const server = fakeSupabase();
    server.addUser("lina@example.com", "unauthorized");
    const { account } = makeAccount(server);
    await account.start();
    await expect(account.teamKeys.youtubeKey()).rejects.toThrow("signed-in members");
    await account.signIn("lina@example.com", password);
    await expect(account.teamKeys.youtubeKey()).rejects.toThrow("signed-in members");
    expect(server.count("POST", "/rest/v1/rpc/team_youtube_key")).toBe(0);
  });
});

describe("nothing secret leaves", () => {
  it("no auth:* answer or log line carries a token, the password, the key or the email", async () => {
    const server = fakeSupabase();
    const sam = server.addUser("sam@example.com", "full", ["owner"], true);
    const { account, logs, secrets } = makeAccount(server);
    await account.start();
    const dispatch = createDispatcher(
      createHandlers({ version: "1.0.0", secrets, account }),
      (channel, error) => {
        logs.push(`${channel}: ${String(error)}`);
      },
    );
    const answers: unknown[] = [];
    const call = async (channel: string, input: unknown) => {
      const answer = await dispatch(channel, input);
      answers.push(answer);
      return answer;
    };

    await call("auth:status", {});
    await call("auth:sign-in", { email: "sam@example.com", password: "wrong-000" });
    await call("auth:sign-in", { email: "sam@example.com", password: "" });
    await call("auth:sign-in", { email: "sam@example.com", password });
    await call("auth:status", {});
    await call("auth:recheck", {});
    server.online = false;
    await call("auth:recheck", {});
    server.online = true;
    server.revoke(sam);
    await call("auth:recheck", {});
    await call("auth:sign-in", { email: "sam@example.com", password });
    await call("auth:sign-out", {});
    await call("auth:status", {});

    expect(answers[3]).toEqual({ ok: true, value: { ok: true, state: "signed-in" } });
    expect(answers[4]).toEqual({
      ok: true,
      value: { state: "signed-in", email: "sam@example.com" },
    });
    const text = JSON.stringify(answers);
    expect(server.issued.length).toBeGreaterThan(0);
    for (const secret of [...server.issued, password, "wrong-000", config.publishableKey]) {
      expect(text).not.toContain(secret);
    }
    const logText = logs.join("\n");
    for (const secret of [...server.issued, password, config.publishableKey, "sam@example.com"]) {
      expect(logText).not.toContain(secret);
    }
    expect(logText).not.toContain(config.url);
  });
});
