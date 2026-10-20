import { afterEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import type { RealtimeChannelOptions, RealtimeClientOptions } from "@supabase/realtime-js";

import { NetworkRefusedError } from "../net/network";
import type { Network } from "../net/network";
import type { SupabaseConfig } from "../supabase/config";
import type { Timers } from "../supabase/session";
import {
  changedEvent,
  createLive,
  presenceGapMs,
  realtimeEndpoint,
  reconnectAfterMs,
  syncTopic,
  teamTopic,
} from "./live";
import type { LiveDeps, RealtimeChannelLike, RealtimeClientLike } from "./live";

/** Lets start() fetch the token and join (a few microtasks). */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

const me = "11111111-1111-4111-8111-111111111111";
const mate = "22222222-2222-4222-8222-222222222222";
const key = "sb_publishable_live000";
const config: SupabaseConfig = {
  url: "https://abcdefghijklmnopqrst.supabase.co",
  origin: "https://abcdefghijklmnopqrst.supabase.co",
  publishableKey: key,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A clock and timers that only move when the test says so. */
function fakeClock(): { timers: Timers; now: () => number; advance: (ms: number) => void } {
  let time = 1_000_000;
  let next = 1;
  const pending = new Map<number, { at: number; run: () => void }>();
  return {
    now: () => time,
    timers: {
      set(run, ms) {
        const id = next++;
        pending.set(id, { at: time + ms, run });
        return id;
      },
      clear(handle) {
        pending.delete(handle as number);
      },
    },
    advance(ms) {
      const until = time + ms;
      for (;;) {
        const due = [...pending.entries()]
          .filter(([, t]) => t.at <= until)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (due === undefined) {
          break;
        }
        pending.delete(due[0]);
        time = due[1].at;
        due[1].run();
      }
      time = until;
    },
  };
}

class FakeChannel implements RealtimeChannelLike {
  readonly bindings: {
    type: string;
    event: string;
    callback: (m: { payload?: unknown }) => void;
  }[] = [];
  readonly tracks: Record<string, unknown>[] = [];
  readonly sends: { type: string; event: string; payload: unknown }[] = [];
  untracks = 0;
  state: Record<string, readonly unknown[]> = {};
  trackAnswer: () => Promise<string> = () => Promise.resolve("ok");
  untrackAnswer: () => Promise<string> = () => Promise.resolve("ok");
  private status: ((status: string, error?: Error) => void) | null = null;

  constructor(
    readonly topic: string,
    readonly options: RealtimeChannelOptions,
    private readonly order: string[],
  ) {}

  on(
    type: "broadcast" | "presence",
    filter: { event: string },
    callback: (m: { payload?: unknown }) => void,
  ): RealtimeChannelLike {
    this.bindings.push({ type, event: filter.event, callback });
    return this;
  }

  subscribe(callback: (status: string, error?: Error) => void): RealtimeChannelLike {
    this.status = callback;
    return this;
  }

  presenceState(): Record<string, readonly unknown[]> {
    return this.state;
  }

  track(payload: Record<string, unknown>): Promise<string> {
    this.tracks.push(payload);
    return this.trackAnswer();
  }

  untrack(): Promise<string> {
    this.untracks += 1;
    this.order.push(`untrack ${this.topic}`);
    return this.untrackAnswer();
  }

  send(message: { type: "broadcast"; event: string; payload: unknown }): Promise<string> {
    this.sends.push(message);
    return Promise.resolve("ok");
  }

  emitStatus(status: string): void {
    this.status?.(status, status === "SUBSCRIBED" ? undefined : new Error("secret detail"));
  }

  emit(type: string, event: string, message: { payload?: unknown } = {}): void {
    for (const binding of this.bindings) {
      if (binding.type === type && binding.event === event) {
        binding.callback(message);
      }
    }
  }
}

interface Harness {
  readonly live: ReturnType<typeof createLive>;
  readonly lines: string[];
  readonly made: { endpoint: string; options: RealtimeClientOptions }[];
  readonly order: string[];
  readonly clock: ReturnType<typeof fakeClock>;
  readonly network: { request: Mock<Network["request"]> };
  sync(): FakeChannel;
  team(): FakeChannel;
  client: {
    removeAll: () => Promise<unknown>;
    disconnect: () => Promise<unknown>;
    setAuth: () => Promise<void>;
  };
}

function harness(over: Partial<LiveDeps> = {}): Harness {
  const lines: string[] = [];
  const made: { endpoint: string; options: RealtimeClientOptions }[] = [];
  const order: string[] = [];
  const channels = new Map<string, FakeChannel>();
  const clock = fakeClock();
  const network = {
    request: vi.fn<Network["request"]>(() => Promise.resolve(new Response("{}"))),
  };
  const behaviour = {
    removeAll: (): Promise<unknown> => Promise.resolve([]),
    disconnect: (): Promise<unknown> => Promise.resolve("ok"),
    setAuth: (): Promise<void> => Promise.resolve(),
  };
  const createClient = (endpoint: string, options: RealtimeClientOptions): RealtimeClientLike => {
    made.push({ endpoint, options });
    return {
      channel(topic, channelOptions) {
        const channel = new FakeChannel(topic, channelOptions, order);
        channels.set(topic, channel);
        return channel;
      },
      removeAllChannels() {
        order.push("removeAllChannels");
        return behaviour.removeAll();
      },
      disconnect() {
        order.push("disconnect");
        return behaviour.disconnect();
      },
      setAuth: () => behaviour.setAuth(),
    };
  };
  const live = createLive({
    config,
    network,
    session: { accessToken: () => Promise.resolve("access-token-value") },
    userId: me,
    createClient,
    log: (line) => lines.push(line),
    now: clock.now,
    timers: clock.timers,
    ...over,
  });
  const get = (topic: string): FakeChannel => {
    const channel = channels.get(topic);
    if (channel === undefined) {
      throw new Error(`no channel ${topic}`);
    }
    return channel;
  };
  return {
    live,
    lines,
    made,
    order,
    clock,
    network,
    sync: () => get(syncTopic),
    team: () => get(teamTopic),
    client: behaviour,
  };
}

/** The value, or a failed test when it is missing. */
function need<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) {
    throw new Error("missing");
  }
  return value;
}

/** The options the only client was built with. */
function madeOptions(h: Harness): RealtimeClientOptions {
  return need(h.made[0]).options;
}

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe("the client options (D24)", () => {
  it("always builds the client with the guarded transport, the Network's fetch and the key", async () => {
    const h = harness();
    h.live.start();
    await settle();
    expect(h.made).toHaveLength(1);
    const { endpoint, options } = need(h.made[0]);
    expect(endpoint).toBe("wss://abcdefghijklmnopqrst.supabase.co/realtime/v1");
    expect(options.params).toEqual({ apikey: key });
    expect(options.worker).toBe(false);
    expect(typeof options.transport).toBe("function");
    expect(typeof options.fetch).toBe("function");
    expect(typeof options.accessToken).toBe("function");
    expect(typeof options.logger).toBe("function");

    // The transport refuses anything off the allowlist before a socket exists.
    const Transport = need(options.transport);
    const send = need(options.fetch);
    expect(() => new Transport("wss://evil.example.com/realtime/v1/websocket")).toThrow(
      NetworkRefusedError,
    );
    expect(() => new Transport("https://abcdefghijklmnopqrst.supabase.co/realtime")).toThrow(
      NetworkRefusedError,
    );
    expect(() => new Transport("wss://abcdefghijklmnopqrst.supabase.co.evil.com/x")).toThrow(
      NetworkRefusedError,
    );

    // Fetch goes through the Network, a string or a Request alike.
    await send("https://abcdefghijklmnopqrst.supabase.co/realtime/v1/api/broadcast", {
      method: "POST",
    });
    await send(new Request("https://abcdefghijklmnopqrst.supabase.co/x"));
    expect(h.network.request.mock.calls.map((c) => c[0])).toEqual([
      "https://abcdefghijklmnopqrst.supabase.co/realtime/v1/api/broadcast",
      "https://abcdefghijklmnopqrst.supabase.co/x",
    ]);

    await expect(need(options.accessToken)()).resolves.toBe("access-token-value");
  });

  it("hands the client null when the session can't give a token", async () => {
    const h = harness({ session: { accessToken: () => Promise.reject(new Error("ended")) } });
    h.live.start();
    await settle();
    await expect(need(madeOptions(h).accessToken)()).resolves.toBeNull();
  });

  it("reconnects after 15 s, doubling, at most 8 minutes", async () => {
    const h = harness();
    h.live.start();
    await settle();
    const ladder = need(madeOptions(h).reconnectAfterMs);
    expect(ladder).toBe(reconnectAfterMs);
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(ladder)).toEqual([
      15_000, 30_000, 60_000, 120_000, 240_000, 480_000, 480_000, 480_000,
    ]);
  });

  it("uses ws:// for the local test seam", () => {
    expect(
      realtimeEndpoint({
        url: "http://127.0.0.1:54321",
        origin: "http://127.0.0.1:54321",
        publishableKey: key,
      }),
    ).toBe("ws://127.0.0.1:54321/realtime/v1");
  });

  it("is off with one log line when the process has no WebSocket", async () => {
    vi.stubGlobal("WebSocket", undefined);
    const h = harness();
    h.live.start();
    await settle();
    expect(h.made).toHaveLength(0);
    expect(h.lines).toEqual(["live.off no_websocket"]);
    h.live.announce(["brands"]);
    h.live.setPresence({ screen: "reach", idle: false });
  });

  it("is off with one log line when the client can't be built", async () => {
    const h = harness({
      createClient: () => {
        throw new Error(`bad ${key}`);
      },
    });
    h.live.start();
    await settle();
    expect(h.lines).toEqual(["live.off client_failed"]);
  });

  it("starts once", async () => {
    const h = harness();
    h.live.start();
    h.live.start();
    await settle();
    expect(h.made).toHaveLength(1);
  });
});

describe("the private topics (D25)", () => {
  it("fetches the token before it joins, so the first joins aren't refused as anon", async () => {
    const h = harness();
    let release = (): void => undefined;
    h.client.setAuth = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    h.live.start();
    await settle();
    expect(() => h.sync()).toThrow();
    expect(() => h.team()).toThrow();
    release();
    await settle();
    expect(h.sync().options.config.private).toBe(true);
    expect(h.team().options.config.private).toBe(true);
  });

  it("joins toolbox:sync and toolbox:team privately", async () => {
    const h = harness();
    h.live.start();
    await settle();
    expect(h.sync().options).toEqual({ config: { private: true, broadcast: { self: false } } });
    expect(h.team().options).toEqual({ config: { private: true, presence: { key: me } } });
    expect(h.sync().bindings.map((b) => `${b.type}:${b.event}`)).toEqual([
      `broadcast:${changedEvent}`,
    ]);
    expect(h.team().bindings.map((b) => `${b.type}:${b.event}`)).toEqual([
      "presence:sync",
      "presence:join",
      "presence:leave",
    ]);
  });

  it("schedules a pass on a teammate's broadcast and ignores bad payloads", async () => {
    const h = harness();
    const remote = vi.fn();
    h.live.onRemoteChange(remote);
    h.live.start();
    await settle();
    h.sync().emitStatus("SUBSCRIBED");

    h.sync().emit("broadcast", changedEvent, { payload: { tables: ["brands", "deals"] } });
    expect(remote).toHaveBeenCalledTimes(1);

    const bad: unknown[] = [
      undefined,
      null,
      "brands",
      { tables: "brands" },
      { tables: [] },
      { tables: ["brands", "outreach_threads"] },
      { tables: Array(11).fill("brands") },
      { tables: [1] },
      {},
    ];
    for (const payload of bad) {
      h.sync().emit("broadcast", changedEvent, { payload });
    }
    expect(remote).toHaveBeenCalledTimes(1);
    expect(h.lines.filter((l) => l === "live.broadcast ignored")).toHaveLength(bad.length);
  });

  it("announces only D25's tables, and only while toolbox:sync is joined", async () => {
    const h = harness();
    h.live.start();
    await settle();
    h.live.announce(["brands"]);
    expect(h.sync().sends).toHaveLength(0);

    h.sync().emitStatus("SUBSCRIBED");
    h.live.announce(["notification_switches", "deals", "brands", "deals"]);
    h.live.announce(["notification_switches", "edit_conflicts"]);
    h.live.announce([]);
    expect(h.sync().sends).toEqual([
      { type: "broadcast", event: changedEvent, payload: { tables: ["brands", "deals"] } },
    ]);

    h.sync().emitStatus("CHANNEL_ERROR");
    h.live.announce(["brands"]);
    expect(h.sync().sends).toHaveLength(1);
    await flush();
  });

  it("logs a refused or timed-out join by kind and leaves it to the client", async () => {
    const h = harness();
    h.live.start();
    await settle();
    h.sync().emitStatus("CHANNEL_ERROR");
    h.team().emitStatus("TIMED_OUT");
    h.team().emitStatus("CLOSED");
    expect(h.lines).toEqual(["live.channel_error sync", "live.timed_out team", "live.closed team"]);
    expect(h.made).toHaveLength(1);
  });
});

describe("presence (D26)", () => {
  it("tracks the app's own payload once toolbox:team is joined", async () => {
    const h = harness();
    h.live.start();
    await settle();
    h.live.setPresence({ screen: "reach", idle: false });
    expect(h.team().tracks).toHaveLength(0);

    h.team().emitStatus("SUBSCRIBED");
    expect(h.team().tracks).toEqual([{ v: 1, screen: "reach", idle: false }]);
    await flush();
  });

  it("publishes at most once a second, latest wins, nothing when unchanged", async () => {
    const h = harness();
    h.live.start();
    await settle();
    h.team().emitStatus("SUBSCRIBED");
    expect(h.team().tracks).toEqual([{ v: 1, screen: "today", idle: false }]);

    h.live.setPresence({ screen: "today", idle: false });
    expect(h.team().tracks).toHaveLength(1);

    h.live.setPresence({ screen: "find", idle: false });
    h.live.setPresence({ screen: "close", idle: false });
    h.live.setPresence({ screen: "deliver", idle: true });
    expect(h.team().tracks).toHaveLength(1);
    h.clock.advance(presenceGapMs - 1);
    expect(h.team().tracks).toHaveLength(1);
    h.clock.advance(1);
    expect(h.team().tracks).toEqual([
      { v: 1, screen: "today", idle: false },
      { v: 1, screen: "deliver", idle: true },
    ]);

    // A change and its undo inside the gap send nothing.
    h.live.setPresence({ screen: "team", idle: false });
    h.live.setPresence({ screen: "deliver", idle: true });
    h.clock.advance(presenceGapMs * 3);
    expect(h.team().tracks).toHaveLength(2);

    // After a quiet second, a change goes at once.
    h.live.setPresence({ screen: "settings", idle: false });
    expect(h.team().tracks).toHaveLength(3);
    await flush();
  });

  it("publishes again after a rejoin, even when unchanged", async () => {
    const h = harness();
    h.live.start();
    await settle();
    h.team().emitStatus("SUBSCRIBED");
    h.team().emitStatus("CHANNEL_ERROR");
    h.team().emitStatus("SUBSCRIBED");
    expect(h.team().tracks).toHaveLength(1);
    h.clock.advance(presenceGapMs);
    expect(h.team().tracks).toHaveLength(2);
    await flush();
  });

  it("publishes again on the next change after a refused track", async () => {
    const h = harness();
    h.live.start();
    await settle();
    h.team().trackAnswer = () => Promise.resolve("timed out");
    h.team().emitStatus("SUBSCRIBED");
    await flush();
    expect(h.lines).toContain("live.track timed_out");
    h.team().trackAnswer = () => Promise.resolve("ok");
    h.clock.advance(presenceGapMs);
    h.live.setPresence({ screen: "today", idle: false });
    expect(h.team().tracks).toHaveLength(2);
    await flush();
  });

  it("builds members from valid payloads only, the newest meta per key", async () => {
    const h = harness();
    const changed = vi.fn();
    h.live.onPresence(changed);
    h.live.start();
    await settle();
    h.team().emitStatus("SUBSCRIBED");
    h.team().state = {
      [me]: [{ presence_ref: "a", v: 1, screen: "reach", idle: false }],
      [mate]: [
        { presence_ref: "b", v: 1, screen: "find", idle: false },
        { presence_ref: "c", v: 1, screen: "insights", idle: true },
      ],
      "not-a-member": [{ presence_ref: "d", v: 1, screen: "team", idle: false }],
      "old-shape": [{ presence_ref: "e", name: "Sara", color: "#fff", online_at: "now" }],
      "newer-version": [{ presence_ref: "f", v: 2, screen: "reach", idle: false }],
      "bad-screen": [{ presence_ref: "g", v: 1, screen: "billing", idle: false }],
      "no-idle": [{ presence_ref: "h", v: 1, screen: "reach" }],
      "newest-bad": [
        { presence_ref: "i", v: 1, screen: "reach", idle: false },
        { presence_ref: "j", v: 1, screen: "reach", idle: "no" },
      ],
      empty: [],
      "": [{ presence_ref: "k", v: 1, screen: "reach", idle: false }],
    };
    h.team().emit("presence", "sync");
    expect(Object.fromEntries(h.live.members())).toEqual({
      [me]: { screen: "reach", idle: false },
      [mate]: { screen: "insights", idle: true },
      "not-a-member": { screen: "team", idle: false },
    });
    expect(changed).toHaveBeenCalledTimes(1);

    // The same state again is no change.
    h.team().emit("presence", "join");
    expect(changed).toHaveBeenCalledTimes(1);

    h.team().state = { [me]: [{ presence_ref: "a", v: 1, screen: "reach", idle: false }] };
    h.team().emit("presence", "leave");
    expect([...h.live.members().keys()]).toEqual([me]);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("empties members when toolbox:team drops", async () => {
    const h = harness();
    const changed = vi.fn();
    h.live.onPresence(changed);
    h.live.start();
    await settle();
    h.team().emitStatus("SUBSCRIBED");
    h.team().state = { [mate]: [{ presence_ref: "b", v: 1, screen: "find", idle: false }] };
    h.team().emit("presence", "sync");
    h.team().emitStatus("CHANNEL_ERROR");
    expect(h.live.members().size).toBe(0);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("keeps going when a listener throws", async () => {
    const h = harness();
    const second = vi.fn();
    h.live.onRemoteChange(() => {
      throw new Error("boom");
    });
    h.live.onRemoteChange(second);
    h.live.start();
    await settle();
    h.sync().emit("broadcast", changedEvent, { payload: { tables: ["brands"] } });
    expect(second).toHaveBeenCalledTimes(1);
    expect(h.lines).toContain("live.listener_failed");
  });
});

describe("stop()", () => {
  it("untracks, removes all channels, then disconnects", async () => {
    const h = harness();
    h.live.start();
    await settle();
    h.team().emitStatus("SUBSCRIBED");
    h.sync().emitStatus("SUBSCRIBED");
    await h.live.stop();
    expect(h.order).toEqual([`untrack ${teamTopic}`, "removeAllChannels", "disconnect"]);
    expect(h.lines).toContain("live.stopped");
  });

  it("does nothing more after stopping", async () => {
    const h = harness();
    const remote = vi.fn();
    const changed = vi.fn();
    h.live.onRemoteChange(remote);
    h.live.onPresence(changed);
    h.live.start();
    await settle();
    h.team().emitStatus("SUBSCRIBED");
    h.sync().emitStatus("SUBSCRIBED");
    h.live.setPresence({ screen: "find", idle: false }); // inside the gap: a timer is pending
    const sync = h.sync();
    const team = h.team();
    await h.live.stop();

    h.clock.advance(presenceGapMs * 5);
    expect(team.tracks).toHaveLength(1);
    sync.emit("broadcast", changedEvent, { payload: { tables: ["brands"] } });
    team.state = { [mate]: [{ presence_ref: "b", v: 1, screen: "find", idle: false }] };
    team.emit("presence", "sync");
    sync.emitStatus("SUBSCRIBED");
    h.live.announce(["brands"]);
    h.live.setPresence({ screen: "reach", idle: true });
    h.live.start();
    await settle();
    await h.live.stop();

    expect(remote).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
    expect(sync.sends).toHaveLength(0);
    expect(team.tracks).toHaveLength(1);
    expect(h.made).toHaveLength(1);
    expect(h.live.members().size).toBe(0);
  });

  it("doesn't wait forever on a dead socket", async () => {
    const h = harness();
    h.live.start();
    await settle();
    h.team().emitStatus("SUBSCRIBED");
    const never = (): Promise<string> => new Promise<string>(() => undefined);
    h.team().untrackAnswer = never;
    h.client.removeAll = never;
    h.client.disconnect = never;
    let done = false;
    const stopping = h.live.stop().then(() => {
      done = true;
    });
    for (let i = 0; i < 3; i += 1) {
      await flush();
      h.clock.advance(2000);
    }
    await stopping;
    expect(done).toBe(true);
    expect(h.order).toEqual([`untrack ${teamTopic}`, "removeAllChannels", "disconnect"]);
  });

  it("stops cleanly when never started", async () => {
    const h = harness();
    await h.live.stop();
    expect(h.order).toEqual([]);
  });
});

describe("logging", () => {
  it("never logs a payload, a URL, the key or a token", async () => {
    const h = harness();
    h.live.start();
    await settle();
    const logger = need(madeOptions(h).logger);
    logger(
      "transport",
      `connected to wss://abcdefghijklmnopqrst.supabase.co/realtime/v1/websocket?apikey=${key}`,
    );
    logger("push", "realtime:toolbox:team presence", { payload: { screen: "reach" } });
    logger("receive", "ok realtime:toolbox:sync", { tables: ["brands"] });
    logger("channel", "error realtime:toolbox:sync", { reason: "access-token-value" });
    logger("https://evil.example/", "x");

    h.sync().emitStatus("SUBSCRIBED");
    h.team().emitStatus("SUBSCRIBED");
    h.sync().emit("broadcast", changedEvent, { payload: { tables: ["brands"], note: "hello" } });
    h.sync().emit("broadcast", changedEvent, { payload: { secret: "row content" } });
    h.team().trackAnswer = () => Promise.reject(new Error(`failed ${key}`));
    h.clock.advance(presenceGapMs);
    h.live.setPresence({ screen: "record", idle: true });
    h.live.announce(["brands"]);
    await flush();
    h.sync().emitStatus("CHANNEL_ERROR");
    await h.live.stop();

    expect(h.lines).toContain("live.log transport");
    expect(h.lines).toContain("live.log channel");
    expect(h.lines).toContain("live.log other");
    expect(h.lines).toContain("live.track failed");
    expect(h.lines.some((l) => l.includes("push") || l.includes("receive"))).toBe(false);
    for (const line of h.lines) {
      expect(line).toMatch(/^live\.[a-z_]+( [a-z_]+)?$/);
      expect(line).not.toMatch(
        /sb_publishable|access-token|https?:|wss?:|apikey|brands|record|row content|secret/,
      );
    }
  });
});
