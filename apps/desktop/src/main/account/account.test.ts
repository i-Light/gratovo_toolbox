import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { channels, createDispatcher, type AppEventName } from "@gratovo/ipc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getMeta, pendingCount } from "../data/repositories";
import { openDatabase } from "../db/open-database";
import { createHandlers, type HandlerContext } from "../handlers";
import { createNetwork } from "../net/network";
import { createSecretStore, type Cipher } from "../secret-store";
import type { SupabaseConfig } from "../supabase/config";
import { sessionSecretName, type Timers } from "../supabase/session";
import type { Live, LiveDeps, PresenceState } from "../sync/live";

import { createAccount, exampleFile, liveFile, type Account } from "./account";
import { keyLifetimeMs } from "./team-keys";

/** The find service is not under test here: sign-out has no search to end. */
const noFind: HandlerContext["find"] = {
  shutdown: () => Promise.resolve(),
} as unknown as HandlerContext["find"];

const config: SupabaseConfig = {
  url: "https://abcdefghijklmnopqrst.supabase.co",
  origin: "https://abcdefghijklmnopqrst.supabase.co",
  publishableKey: "sb_publishable_test000",
};

const at = "2026-10-20T10:00:00.000Z";
const password = "pw-test-000-correct";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const syncTables = [
  "notification_switches",
  "edit_conflicts",
  "channel_state",
  "brands",
  "deals",
  "activity_log",
  "sync_tombstones",
  "sync_control",
];

/** A Supabase stand-in: Auth's token and logout endpoints, the tables and the RPC the account uses. */
function fakeSupabase() {
  const users: { id: string; email: string; password: string }[] = [];
  const profiles = new Map<string, Record<string, unknown>>();
  const access = new Map<string, Record<string, unknown>>();
  const refreshTokens = new Map<string, string>();
  const accessTokens = new Map<string, string>();
  const issued: string[] = [];
  const requests: { method: string; path: string; body: string }[] = [];
  /** Log lines and switches the app sent. */
  const posted: Record<string, unknown[]> = { activity_log: [], notification_switches: [] };
  const server = {
    online: true,
    youtubeKey: "yt-test-000" as string | null,
    users,
    profiles,
    issued,
    requests,
    posted,
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
    // The tables the sync reads: nothing on the server yet, beyond the team.
    const table = url.pathname.replace(/^\/rest\/v1\//, "");
    if (method === "GET" && syncTables.includes(table)) {
      return Promise.resolve(json([]));
    }
    if (
      method === "POST" &&
      authorized &&
      (table === "activity_log" || table === "notification_switches")
    ) {
      posted[table]?.push(...(JSON.parse(body) as unknown[]));
      return Promise.resolve(new Response(null, { status: 201 }));
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

// The refresh timer never fires in most of these tests; the session tests cover it.
const noTimers: Timers = { set: () => 0, clear: () => undefined };

/** Timers fired by hand with `fire()`. */
function manualTimers() {
  let next = 0;
  const pending = new Map<number, () => void>();
  const delays = new Map<number, number>();
  const timers: Timers = {
    set: (callback, ms) => {
      next += 1;
      pending.set(next, callback);
      delays.set(next, ms);
      return next;
    },
    clear: (handle) => {
      pending.delete(handle as number);
      delays.delete(handle as number);
    },
  };
  return {
    timers,
    /** The waits of the timers still pending. */
    delays: () => [...delays.values()],
    fire: () => {
      const callbacks = [...pending.values()];
      pending.clear();
      delays.clear();
      for (const callback of callbacks) {
        callback();
      }
    },
  };
}

/** A live client stand-in: records what the account asks of it; the test plays the server. */
interface FakeLive {
  readonly deps: LiveDeps;
  starts: number;
  stops: number;
  readonly presence: PresenceState[];
  readonly announced: (readonly string[])[];
  members: ReadonlyMap<string, PresenceState>;
  /** While set, `stop()` waits for it. */
  stopGate: Promise<void> | null;
  /** A teammate's broadcast arrives. */
  remote(): void;
  /** The presence on `toolbox:team` changes to these members. */
  present(members: Record<string, PresenceState>): void;
}

function fakeLives() {
  const made: FakeLive[] = [];
  /** Every start and stop, in order, with what was on disk at the time. */
  const order: string[] = [];
  const create = (deps: LiveDeps): Live => {
    const remotes: (() => void)[] = [];
    const watchers: (() => void)[] = [];
    const fake: FakeLive = {
      deps,
      starts: 0,
      stops: 0,
      presence: [],
      announced: [],
      members: new Map(),
      stopGate: null,
      remote: () => {
        for (const fn of remotes) {
          fn();
        }
      },
      present: (members) => {
        fake.members = new Map(Object.entries(members));
        for (const fn of watchers) {
          fn();
        }
      },
    };
    made.push(fake);
    return {
      start: () => {
        fake.starts += 1;
        order.push("start");
      },
      stop: async () => {
        fake.stops += 1;
        order.push("stop");
        await fake.stopGate;
        order.push(`stopped file=${String(existsSync(join(dir, liveFile)))}`);
      },
      announce: (tables) => {
        fake.announced.push(tables);
      },
      setPresence: (p) => {
        fake.presence.push(p);
      },
      members: () => fake.members,
      onRemoteChange: (fn) => {
        remotes.push(fn);
      },
      onPresence: (fn) => {
        watchers.push(fn);
      },
    };
  };
  return { made, order, create };
}

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
  // Windows can still be letting go of a file a test's last write touched (ENOTEMPTY under a
  // loaded full run, seen 2026-10-21): retry briefly rather than fail the test in cleanup.
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

function makeAccount(
  server: Fake,
  o: { configured?: boolean; cipher?: Cipher; now?: () => number; timers?: Timers } = {},
) {
  const logs: string[] = [];
  const events: { name: AppEventName; payload: unknown }[] = [];
  const reload = vi.fn();
  const lives = fakeLives();
  const secrets = createSecretStore(join(dir, "secrets.json"), o.cipher ?? fakeCipher());
  const account = createAccount({
    config: o.configured === false ? null : config,
    userData: dir,
    secrets,
    network: createNetwork({ allowedOrigins: [config.origin], fetch: server.fetch }),
    now: o.now ?? Date.now,
    reloadWindow: reload,
    emit: (name, payload) => {
      events.push({ name, payload });
    },
    // Never a real socket in these tests: S31's server tests run the real client.
    createLive: lives.create,
    timers: o.timers ?? noTimers,
    log: (line) => logs.push(line),
  });
  opened.push(account);
  return { account, logs, reload, secrets, events, lives };
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

/** The row count of each table in the live file, and its `_meta` keys, as a later start would see. */
function liveTables(): { rows: Record<string, number>; meta: string[]; pending: number } {
  const db = openDatabase(livePath());
  try {
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((row) => String(row["name"]));
    const rows = Object.fromEntries(
      names.map((name) => [
        name,
        Number(db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get()?.["n"] ?? 0),
      ]),
    );
    const meta = db
      .prepare("SELECT key FROM _meta ORDER BY key")
      .all()
      .map((row) => String(row["key"]));
    return { rows, meta, pending: pendingCount(db) };
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
    // Waiting keeps none of the team's data on disk.
    expect(existsSync(livePath())).toBe(false);

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

describe("an access that drops to waiting", () => {
  it("deletes the local copy but keeps the session", async () => {
    const server = fakeSupabase();
    const omar = server.addUser("omar@example.com", "basic", ["scout"]);
    const { account, secrets } = makeAccount(server);
    await account.start();
    await account.signIn("omar@example.com", password);
    await account.source()?.write([{ kind: "log.add", id: randomUUID(), at: 1, text: "Omar's" }]);
    expect(existsSync(livePath())).toBe(true);

    server.setRole(omar, "unauthorized");
    expect(await account.recheck()).toEqual({ state: "waiting", email: "omar@example.com" });

    expect(account.source()).toBeNull();
    for (const suffix of ["", "-wal", "-shm"]) {
      expect(existsSync(`${livePath()}${suffix}`)).toBe(false);
    }
    expect(await secrets.has(sessionSecretName)).toBe(true);

    // Let back in, the member starts from an empty copy and the team.
    server.setRole(omar, "basic");
    expect(await account.recheck()).toEqual({ state: "signed-in", email: "omar@example.com" });
    const frame = await frameOf(account);
    expect(frame.log).toEqual([]);
    expect(frame.team.map((m) => m.id)).toEqual([omar]);
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

  it("deletes the stored session before the local copy", async () => {
    const server = fakeSupabase();
    server.addUser("sam@example.com", "full", ["owner"], true);
    const { account, secrets } = makeAccount(server);
    await account.start();
    await account.signIn("sam@example.com", password);

    const copyThere: boolean[] = [];
    const remove = secrets.delete.bind(secrets);
    secrets.delete = (name) => {
      copyThere.push(existsSync(livePath()));
      return remove(name);
    };
    await account.signOut();

    expect(copyThere[0]).toBe(true);
    expect(await secrets.has(sessionSecretName)).toBe(false);
    expect(existsSync(livePath())).toBe(false);
  });

  it("a copy left without a session is deleted at the next start", async () => {
    const server = fakeSupabase();
    server.addUser("sam@example.com", "full", ["owner"], true);
    const first = makeAccount(server);
    await first.account.start();
    await first.account.signIn("sam@example.com", password);
    first.account.close();
    // As if the app stopped right after deleting the session.
    await first.secrets.delete(sessionSecretName);
    expect(existsSync(livePath())).toBe(true);

    const { account } = makeAccount(server);
    await account.start();
    expect(account.status().state).toBe("signed-out");
    expect(existsSync(livePath())).toBe(false);
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
      expect(server.count("GET", "/rest/v1/member_access")).toBeGreaterThan(before);
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

  it("offline at start, checks the access once a refresh gets through", async () => {
    const server = fakeSupabase();
    const sam = server.addUser("sam@example.com", "full", ["owner"], true);
    await signedInBefore(server);
    server.online = false;

    const manual = manualTimers();
    const { account, reload, logs } = makeAccount(server, { timers: manual.timers });
    await account.start();
    await vi.waitFor(() => {
      expect(logs.some((line) => line.includes("access check failed"))).toBe(true);
    });
    const checks = server.count("GET", "/rest/v1/profiles?select=id,role");

    server.online = true;
    server.setRole(sam, "unauthorized");
    manual.fire();

    await vi.waitFor(() => {
      expect(reload).toHaveBeenCalledOnce();
    });
    expect(server.count("GET", "/rest/v1/profiles?select=id,role")).toBe(checks + 1);
    expect(account.status()).toEqual({ state: "waiting", email: "sam@example.com" });
    expect(existsSync(livePath())).toBe(false);

    // Checked once: the next refresh doesn't ask again.
    manual.fire();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(server.count("GET", "/rest/v1/profiles?select=id,role")).toBe(checks + 1);
  });

  it("saves a name change offline and sends it once the server is back", async () => {
    const server = fakeSupabase();
    const sam = server.addUser("sam@example.com", "full", ["owner"], true);
    await signedInBefore(server);
    server.online = false;
    const { account } = makeAccount(server);
    await account.start();
    await account.recheck();

    await account.source()?.write([{ kind: "me.name", name: "Samuel" }]);
    expect((await frameOf(account)).myName).toBe("Samuel");
    expect(await account.syncNow()).toMatchObject({ state: "offline", pending: 1 });
    expect(server.profiles.get(sam)?.["display_name"]).toBe("sam");

    server.online = true;
    expect(await account.syncNow()).toMatchObject({ state: "synced", pending: 0 });
    expect(server.profiles.get(sam)?.["display_name"]).toBe("Samuel");
    expect((await frameOf(account)).myName).toBe("Samuel");
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
    expect(existsSync(livePath())).toBe(false);
  });

  it("asks the server first for a waiting member, who has no local copy", async () => {
    const server = fakeSupabase();
    const lina = server.addUser("lina@example.com", "unauthorized");
    await signedInBefore(server, "lina@example.com");
    expect(existsSync(livePath())).toBe(false);

    const waiting = makeAccount(server);
    await waiting.account.start();
    expect(waiting.account.status().state).toBe("waiting");
    waiting.account.close();

    server.setRole(lina, "basic");
    const { account, reload } = makeAccount(server);
    await account.start();
    expect(account.status().state).toBe("signed-in");
    expect((await frameOf(account)).me).toBe(lina);
    expect(reload).not.toHaveBeenCalled();
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
  it("is saved locally at once and reaches the server on the next pass", async () => {
    const server = fakeSupabase();
    const sam = server.addUser("sam@example.com", "full", ["owner"], true);
    const { account } = makeAccount(server);
    await account.start();
    await account.signIn("sam@example.com", password);
    await account.syncNow();

    await account.source()?.write([{ kind: "me.name", name: "  Samuel  " }]);
    expect((await frameOf(account)).myName).toBe("Samuel");
    expect(account.syncStatus().pending).toBe(1);

    await account.syncNow();
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

describe("the sync", () => {
  it("starts after sign-in has read the whole tables", async () => {
    const server = fakeSupabase();
    server.addUser("sam@example.com", "full", ["owner"], true);
    const { account, events } = makeAccount(server);
    await account.start();
    expect(account.syncStatus()).toEqual({
      state: "off",
      pending: 0,
      refused: 0,
      lastSyncedAt: null,
    });

    await account.signIn("sam@example.com", password);
    const paths = server.requests.map((r) => `${r.method} ${r.path.split("?")[0] ?? ""}`);
    const firstPull = paths.indexOf("GET /rest/v1/channel_state");
    for (const whole of ["profiles", "member_access", "notification_switches", "edit_conflicts"]) {
      const at = paths.indexOf(`GET /rest/v1/${whole}`);
      expect(at, whole).toBeGreaterThanOrEqual(0);
      if (firstPull >= 0) {
        expect(at, whole).toBeLessThan(firstPull);
      }
    }

    const after = await account.syncNow();
    expect(after.state).toBe("synced");
    expect(after.lastSyncedAt).not.toBeNull();
    expect(server.count("GET", "/rest/v1/channel_state")).toBeGreaterThan(0);
    expect(events.some((e) => e.name === "sync:status")).toBe(true);
  });

  it("queues a write in the outbox and schedules a pass a second later", async () => {
    const server = fakeSupabase();
    const sam = server.addUser("sam@example.com", "full", ["owner"], true);
    const manual = manualTimers();
    const { account } = makeAccount(server, { timers: manual.timers });
    await account.start();
    await account.signIn("sam@example.com", password);
    await account.syncNow();
    expect(manual.delays()).not.toContain(1_000);

    const id = randomUUID();
    await account
      .source()
      ?.write([{ kind: "log.add", id, at: Date.now(), text: "Emailed @ai_daily" }]);
    expect(account.syncStatus().pending).toBe(1);
    await vi.waitFor(() => {
      expect(manual.delays()).toContain(1_000);
    });

    manual.fire();
    await vi.waitFor(() => {
      expect(server.posted["activity_log"]).toEqual([
        expect.objectContaining({ id, actor_id: sam, entity_label: "Emailed @ai_daily" }),
      ]);
    });
    await vi.waitFor(() => {
      expect(account.syncStatus().pending).toBe(0);
    });
  });

  it("signing out with an unsent change keeps only the outbox", async () => {
    const server = fakeSupabase();
    const sam = server.addUser("sam@example.com", "full", ["owner"], true);
    const { account, secrets, reload, logs } = makeAccount(server);
    await account.start();
    await account.signIn("sam@example.com", password);
    await account.syncNow();
    server.online = false;
    await account.source()?.write([{ kind: "me.name", name: "Samuel" }]);

    await account.signOut();

    expect(await secrets.has(sessionSecretName)).toBe(false);
    expect(reload).toHaveBeenCalledOnce();
    expect(account.status().state).toBe("signed-out");
    expect(account.syncStatus()).toEqual({
      state: "off",
      pending: 1,
      refused: 0,
      lastSyncedAt: null,
    });
    const { rows, meta, pending } = liveTables();
    expect(pending).toBe(1);
    for (const [table, n] of Object.entries(rows)) {
      expect(n, table).toBe(table === "_outbox" ? 1 : table === "_meta" ? 1 : 0);
    }
    expect(meta).toEqual(["account.user_id"]);
    expect(liveMeta("account.user_id")).toBe(sam);
    expect(logs).toContain("Account: kept 1 unsent changes on this computer.");
  });

  it("keeps that copy at the next start without a session, and says how many wait", async () => {
    const server = fakeSupabase();
    server.addUser("sam@example.com", "full", ["owner"], true);
    const first = makeAccount(server);
    await first.account.start();
    await first.account.signIn("sam@example.com", password);
    await first.account.syncNow();
    server.online = false;
    await first.account.source()?.write([{ kind: "me.name", name: "Samuel" }]);
    await first.account.signOut();
    first.account.close();

    const { account, secrets } = makeAccount(server);
    await account.start();
    expect(account.status().state).toBe("signed-out");
    expect(existsSync(livePath())).toBe(true);
    const dispatch = createDispatcher(
      createHandlers({ version: "1.0.0", secrets, account, find: noFind }),
      () => {
        throw new Error("no handler should fail");
      },
    );
    expect(await dispatch("sync:status", {})).toEqual({
      ok: true,
      value: { state: "off", pending: 1, refused: 0, lastSyncedAt: null },
    });
    expect(await dispatch("sync:now", {})).toEqual({
      ok: true,
      value: { state: "off", pending: 1, refused: 0, lastSyncedAt: null },
    });
  });

  it("the same account signing back in sends the kept change first", async () => {
    const server = fakeSupabase();
    const sam = server.addUser("sam@example.com", "full", ["owner"], true);
    const first = makeAccount(server);
    await first.account.start();
    await first.account.signIn("sam@example.com", password);
    await first.account.syncNow();
    server.online = false;
    await first.account.source()?.write([{ kind: "me.name", name: "Samuel" }]);
    await first.account.signOut();
    first.account.close();

    server.online = true;
    const { account } = makeAccount(server);
    await account.start();
    const from = server.requests.length;
    await account.signIn("sam@example.com", password);
    // While it is unsent, the kept name wins over the server's.
    expect((await frameOf(account)).myName).toBe("Samuel");
    expect(await account.syncNow()).toMatchObject({ state: "synced", pending: 0 });

    expect(server.profiles.get(sam)?.["display_name"]).toBe("Samuel");
    const later = server.requests
      .slice(from)
      .map((r) => `${r.method} ${r.path.split("?")[0] ?? ""}`);
    const patch = later.indexOf("PATCH /rest/v1/profiles");
    expect(patch).toBeGreaterThanOrEqual(0);
    expect(patch).toBeLessThan(later.indexOf("GET /rest/v1/channel_state"));
  });

  it("another account signing in deletes the kept change and logs the count", async () => {
    const server = fakeSupabase();
    const sam = server.addUser("sam@example.com", "full", ["owner"], true);
    const omar = server.addUser("omar@example.com", "basic", ["scout"]);
    const first = makeAccount(server);
    await first.account.start();
    await first.account.signIn("sam@example.com", password);
    await first.account.syncNow();
    server.online = false;
    await first.account.source()?.write([{ kind: "me.name", name: "Samuel" }]);
    await first.account.signOut();
    first.account.close();

    server.online = true;
    const { account, logs } = makeAccount(server);
    await account.start();
    const from = server.requests.length;
    await account.signIn("omar@example.com", password);
    await account.syncNow();

    expect(logs).toContain("Account: deleted 1 unsent changes of another account.");
    expect(server.requests.slice(from).filter((r) => r.method === "PATCH")).toEqual([]);
    expect(server.profiles.get(sam)?.["display_name"]).toBe("sam");
    expect((await frameOf(account)).me).toBe(omar);
    expect(account.syncStatus().pending).toBe(0);
  });

  it("a session the server ends keeps unsent changes the same way", async () => {
    const server = fakeSupabase();
    const sam = server.addUser("sam@example.com", "full", ["owner"], true);
    const { account, reload } = makeAccount(server);
    await account.start();
    await account.signIn("sam@example.com", password);
    await account.syncNow();
    server.online = false;
    await account.source()?.write([{ kind: "me.name", name: "Samuel" }]);

    server.online = true;
    server.revoke(sam);
    expect(await account.recheck()).toEqual({ state: "signed-out", email: null });

    expect(reload).toHaveBeenCalledOnce();
    expect(liveTables().pending).toBe(1);
    expect(liveTables().meta).toEqual(["account.user_id"]);
    expect(account.syncStatus().pending).toBe(1);
  });
});

describe("Realtime and presence", () => {
  const presenceEvents = (events: { name: AppEventName; payload: unknown }[]) =>
    events.filter((e) => e.name === "presence:changed").map((e) => e.payload);

  it("starts Realtime beside the engine, on the member's session", async () => {
    const server = fakeSupabase();
    const sam = server.addUser("sam@example.com", "full", ["owner"], true);
    const { account, lives } = makeAccount(server);
    await account.start();
    expect(lives.made).toEqual([]);

    await account.signIn("sam@example.com", password);
    expect(lives.made).toHaveLength(1);
    const [live] = lives.made;
    expect(live?.deps.userId).toBe(sam);
    expect(live?.deps.config).toBe(config);
    expect(live?.starts).toBe(1);
    // The page hasn't said where it is yet: the app opens on Today.
    expect(live?.presence).toEqual([{ screen: "today", idle: false }]);
    // The same session as the engine: its token is the one the server issued last.
    const token = await live?.deps.session.accessToken();
    expect(server.issued).toContain(token);
  });

  it("a teammate's change schedules a pass a second later", async () => {
    const server = fakeSupabase();
    server.addUser("sam@example.com", "full", ["owner"], true);
    const manual = manualTimers();
    const { account, lives } = makeAccount(server, { timers: manual.timers });
    await account.start();
    await account.signIn("sam@example.com", password);
    await account.syncNow();
    expect(manual.delays()).not.toContain(1_000);
    const pulls = server.count("GET", "/rest/v1/channel_state");

    lives.made[0]?.remote();
    expect(manual.delays()).toContain(1_000);
    manual.fire();
    await vi.waitFor(() => {
      expect(server.count("GET", "/rest/v1/channel_state")).toBeGreaterThan(pulls);
    });
  });

  it("announces what a drain sent through Realtime", async () => {
    const server = fakeSupabase();
    server.addUser("sam@example.com", "full", ["owner"], true);
    const { account, lives } = makeAccount(server);
    await account.start();
    await account.signIn("sam@example.com", password);
    await account.syncNow();
    expect(lives.made[0]?.announced).toEqual([]);

    await account
      .source()
      ?.write([{ kind: "log.add", id: randomUUID(), at: Date.now(), text: "Emailed @ai_daily" }]);
    await account.syncNow();
    expect(lives.made[0]?.announced).toEqual([["activity_log"]]);
  });

  it("shows the team's presence in the frame and the event, with your own from your state", async () => {
    const server = fakeSupabase();
    const sam = server.addUser("sam@example.com", "full", ["owner"], true);
    const omar = server.addUser("omar@example.com", "basic", ["scout"]);
    const lena = server.addUser("lena@example.com", "basic", ["outreach"]);
    const { account, events, lives } = makeAccount(server);
    await account.start();
    await account.signIn("sam@example.com", password);
    const live = lives.made[0];

    live?.present({
      // The server's echo of you doesn't count: your own state does.
      [sam]: { screen: "team", idle: true },
      [omar]: { screen: "reach", idle: false },
      [lena]: { screen: "find", idle: true },
      "not-on-the-team": { screen: "close", idle: false },
    });
    const expected = [
      { id: sam, status: "online", doing: "Today" },
      { id: omar, status: "online", doing: "Reach" },
      { id: lena, status: "away", doing: "Idle" },
    ];
    expect(presenceEvents(events)).toEqual([{ members: expected }]);
    const frame = await frameOf(account);
    expect(frame.team.map((m) => ({ id: m.id, status: m.status, doing: m.doing }))).toEqual(
      expected,
    );

    account.setPresence({ screen: "record", idle: false });
    expect(live?.presence.at(-1)).toEqual({ screen: "record", idle: false });
    expect(presenceEvents(events).at(-1)).toEqual({
      members: [{ id: sam, status: "online", doing: "Looking at a record" }, ...expected.slice(1)],
    });

    // Omar leaves; the same presence again sends nothing new.
    live?.present({ [lena]: { screen: "find", idle: true } });
    live?.present({ [lena]: { screen: "find", idle: true } });
    const last = presenceEvents(events);
    expect(last).toHaveLength(3);
    expect(last.at(-1)).toEqual({
      members: [
        { id: sam, status: "online", doing: "Looking at a record" },
        { id: omar, status: "away", doing: "" },
        { id: lena, status: "away", doing: "Idle" },
      ],
    });
  });

  it("presence:set while signed out does nothing", async () => {
    const server = fakeSupabase();
    server.addUser("sam@example.com", "full", ["owner"], true);
    const { account, events, lives, secrets } = makeAccount(server);
    await account.start();
    const handlers = createHandlers({ version: "1.0.0", secrets, account, find: noFind });

    expect(await handlers["presence:set"]({ screen: "reach", idle: false })).toEqual({});
    expect(events).toEqual([]);
    expect(lives.made).toEqual([]);

    // Signing in afterwards still starts from Today, not from what was sent while signed out.
    await account.signIn("sam@example.com", password);
    expect(lives.made[0]?.presence).toEqual([{ screen: "today", idle: false }]);
  });

  it("sign-out takes Realtime down before the copy is wiped", async () => {
    const server = fakeSupabase();
    server.addUser("sam@example.com", "full", ["owner"], true);
    const { account, lives, events } = makeAccount(server);
    await account.start();
    await account.signIn("sam@example.com", password);
    const live = lives.made[0];
    let open = (): void => undefined;
    if (live !== undefined) {
      live.stopGate = new Promise<void>((resolve) => {
        open = resolve;
      });
    }

    let done = false;
    const signingOut = account.signOut().then(() => {
      done = true;
    });
    // Down first: nothing more is sent or reported for this session.
    expect(live?.stops).toBe(1);
    live?.present({ x: { screen: "reach", idle: false } });
    expect(presenceEvents(events)).toEqual([]);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 20);
    });
    expect(done).toBe(false);
    expect(existsSync(livePath())).toBe(true);

    open();
    await signingOut;
    expect(lives.order).toEqual(["start", "stop", "stopped file=true"]);
    expect(existsSync(livePath())).toBe(false);
    expect(live?.stops).toBe(1);
  });

  it("stops Realtime when the account closes and when someone else signs in", async () => {
    const server = fakeSupabase();
    const sam = server.addUser("sam@example.com", "full", ["owner"], true);
    const omar = server.addUser("omar@example.com", "basic", ["scout"]);
    const { account, lives } = makeAccount(server);
    await account.start();
    await account.signIn("sam@example.com", password);
    await account.signIn("omar@example.com", password);
    expect(lives.made.map((l) => [l.deps.userId, l.starts, l.stops])).toEqual([
      [sam, 1, 1],
      [omar, 1, 0],
    ]);

    account.close();
    expect(lives.made[1]?.stops).toBe(1);
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
    const { account, logs, secrets, events } = makeAccount(server);
    await account.start();
    const dispatch = createDispatcher(
      createHandlers({ version: "1.0.0", secrets, account, find: noFind }),
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
    await call("sync:now", {});
    await call("sync:status", {});
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
    expect(events.length).toBeGreaterThan(0);
    const text = JSON.stringify([answers, events]);
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
