// The app's live client (`main/sync/live.ts`) against the local stack's Realtime: the real
// `RealtimeClient`, the guarded WebSocket over http://127.0.0.1 → ws://, the publishable key as
// `apikey` and each person's own session. It checks the private-channel rules of
// `20261022090200_realtime_private.sql` from the outside: two authorized members join
// `toolbox:sync` and `toolbox:team` on the first try, a broadcast reaches the other member only,
// presence shows the other member's screen, and a waiting member, a socket with no user token and
// a private join to another topic are refused. Every person and value is made up; no key is
// printed or stored.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { createNetwork } from "../../apps/desktop/src/main/net/network";
import type { SecretStore } from "../../apps/desktop/src/main/secret-store";
import { createAuthClient } from "../../apps/desktop/src/main/supabase/auth-client";
import { readSupabaseConfig } from "../../apps/desktop/src/main/supabase/config";
import { createSessionManager } from "../../apps/desktop/src/main/supabase/session";
import type { Session, SessionManager, Timers } from "../../apps/desktop/src/main/supabase/session";
import { createLive } from "../../apps/desktop/src/main/sync/live";
import type { Live, LiveDeps, RealtimeClientLike } from "../../apps/desktop/src/main/sync/live";

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

const network = createNetwork({ allowedOrigins: [config.origin], fetch });
const auth = createAuthClient(network, config);
const timers: Timers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};
const now = (): number => Date.now();

type ClientOptions = Parameters<NonNullable<LiveDeps["createClient"]>>[1];
type ClientClass = new (endpoint: string, options: ClientOptions) => RealtimeClientLike;

// The client is the desktop app's dependency, not the root's: load the copy the app resolves, so
// this is the same `RealtimeClient` that live.ts builds by default. The test only keeps a handle
// on it (for the join to another topic); live.ts still builds it, with its own options.
const desktopRequire = createRequire(new URL("../../apps/desktop/package.json", import.meta.url));
const { RealtimeClient } = (await import(
  pathToFileURL(desktopRequire.resolve("@supabase/realtime-js")).href
)) as { RealtimeClient: ClientClass };

function memoryStore(): SecretStore {
  const values = new Map<string, string>();
  return {
    get: (name) => Promise.resolve(values.get(name)),
    set: (name, value) => {
      values.set(name, value);
      return Promise.resolve();
    },
    delete: (name) => Promise.resolve(values.delete(name)),
    has: (name) => Promise.resolve(values.has(name)),
    names: () => Promise.resolve([...values.keys()].sort()),
  };
}

/** One person's live client, what it logged, and how often a teammate's broadcast reached it. */
interface Person {
  readonly live: Live;
  readonly lines: string[];
  readonly client: () => RealtimeClientLike;
  remoteChanges: number;
}

const managers: SessionManager[] = [];
const people: Person[] = [];

async function sessionOf(who: { email: string; password: string }): Promise<Session> {
  const manager = createSessionManager({ auth, store: memoryStore(), now });
  managers.push(manager);
  return manager.start(await auth.signIn(who.email, who.password));
}

/** Builds and starts the app's live client as main does, keeping a handle on the real client. */
function connect(session: Pick<Session, "accessToken">, userId: string): Person {
  let built: RealtimeClientLike | null = null;
  const lines: string[] = [];
  const live = createLive({
    config,
    network,
    session,
    userId,
    log: (line) => lines.push(line),
    now,
    timers,
    createClient: (endpoint, options) => {
      built = new RealtimeClient(endpoint, options);
      return built;
    },
  });
  const person: Person = {
    live,
    lines,
    client: () => {
      if (built === null) {
        throw new Error("the live client was not built");
      }
      return built;
    },
    remoteChanges: 0,
  };
  live.onRemoteChange(() => {
    person.remoteChanges += 1;
  });
  people.push(person);
  live.start();
  return person;
}

/** Waits until `check` holds, polling every 50 ms; fails after `ms`. */
async function until(check: () => boolean, ms: number, what: string): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Topic = "sync" | "team";
const has = (person: Person, line: string) => person.lines.includes(line);
const joined = (person: Person, topic: Topic) => has(person, `live.subscribed ${topic}`);
const refused = (person: Person, topic: Topic) => has(person, `live.channel_error ${topic}`);
const timedOut = (person: Person, topic: Topic) => has(person, `live.timed_out ${topic}`);

/**
 * Waits until a refused client's joins on both topics have ended without getting in. The server
 * answers a refused private join only after about 5 s, one join at a time per socket, so the
 * second topic's answer can come after the client's 10 s join timeout: that topic then ends in
 * TIMED_OUT before its retry is refused. At least one CHANNEL_ERROR shows a real refusal.
 */
async function refusedOnBoth(person: Person, what: string): Promise<void> {
  const ended = (topic: Topic) => refused(person, topic) || timedOut(person, topic);
  await until(() => ended("sync") && ended("team"), 11_000, what);
  expect(refused(person, "sync") || refused(person, "team")).toBe(true);
  expect(joined(person, "sync")).toBe(false);
  expect(joined(person, "team")).toBe(false);
}

/** Sends a broadcast from A and waits until B has it, so a refused client had its chance too. */
async function broadcastReachesB(tables: string[]): Promise<void> {
  const before = b.remoteChanges;
  a.live.announce(tables);
  await until(() => b.remoteChanges > before, 5_000, "the broadcast to reach B");
  // Give a stray copy to anyone else the same time to arrive before checking for none.
  await pause(500);
}

let a: Person;
let b: Person;

beforeAll(async () => {
  a = connect(await sessionOf(fixture.owner), fixture.owner.id);
  b = connect(await sessionOf(fixture.member), fixture.member.id);
  await until(
    () => joined(a, "sync") && joined(a, "team") && joined(b, "sync") && joined(b, "team"),
    15_000,
    "both members to join both topics",
  );
}, 30_000);

afterAll(async () => {
  for (const person of people) {
    await person.live.stop();
  }
  for (const manager of managers) {
    manager.close();
  }
});

describe("Realtime on private channels", () => {
  it("lets two authorized members join toolbox:sync and toolbox:team on the first try", () => {
    for (const person of [a, b]) {
      expect(joined(person, "sync")).toBe(true);
      expect(joined(person, "team")).toBe(true);
      // A first join sent without the member's token is refused as anon and only the retry
      // (about 10 s later) gets in: the member's first join must already carry the token.
      expect(person.lines.filter((line) => /^live\.(channel_error|timed_out) /.test(line))).toEqual(
        [],
      );
    }
    // Nothing the app logged carries a payload, a token or the socket's address.
    for (const line of [...a.lines, ...b.lines]) {
      expect(line).toMatch(/^live\.[a-z_]+( [a-z_]+)?$/);
    }
  });

  it("brings one member's broadcast to the other within 5 s, and not back to the sender", async () => {
    const aBefore = a.remoteChanges;
    await broadcastReachesB(["brands"]);
    // `self: false` on toolbox:sync.
    expect(a.remoteChanges).toBe(aBefore);
  }, 15_000);

  it("shows one member's presence, with their screen, to the other", async () => {
    a.live.setPresence({ screen: "reach", idle: false });
    await until(
      () => b.live.members().get(fixture.owner.id)?.screen === "reach",
      10_000,
      "A's presence on B's side",
    );
    expect(b.live.members().get(fixture.owner.id)).toEqual({ screen: "reach", idle: false });
    // A later change shows too (published at most once a second).
    a.live.setPresence({ screen: "deliver", idle: true });
    await until(
      () => b.live.members().get(fixture.owner.id)?.screen === "deliver",
      10_000,
      "A's next presence on B's side",
    );
    expect(b.live.members().get(fixture.owner.id)).toEqual({ screen: "deliver", idle: true });
  }, 15_000);

  it("refuses a waiting member on both topics, who then receives nothing", async () => {
    const waiting = connect(await sessionOf(fixture.waiting), fixture.waiting.id);
    await refusedOnBoth(waiting, "the waiting member's joins to be refused");

    await broadcastReachesB(["deals"]);
    expect(waiting.remoteChanges).toBe(0);
    expect(waiting.live.members().size).toBe(0);
    expect(b.live.members().has(fixture.waiting.id)).toBe(false);
    await waiting.live.stop();
  }, 20_000);

  it("refuses a socket with only the publishable key (no user token) on both topics", async () => {
    const tokenless = connect(
      { accessToken: () => Promise.reject(new Error("signed out")) },
      crypto.randomUUID(),
    );
    await refusedOnBoth(tokenless, "the token-less joins to be refused");

    await broadcastReachesB(["channel_state"]);
    expect(tokenless.remoteChanges).toBe(0);
    expect(tokenless.live.members().size).toBe(0);
    await tokenless.live.stop();
  }, 20_000);

  it("refuses a member's private join to another topic (the old app's gratovo:live)", async () => {
    // The member's own client, built by live.ts with the app's options, asked for another topic.
    const statuses: string[] = [];
    b.client()
      .channel("gratovo:live", { config: { private: true } })
      .subscribe((status) => statuses.push(status));
    await until(() => statuses.includes("CHANNEL_ERROR"), 10_000, "the join to be refused");
    expect(statuses).not.toContain("SUBSCRIBED");
  }, 15_000);
});
