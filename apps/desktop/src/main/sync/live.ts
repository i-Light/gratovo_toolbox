/**
 * The live connection (plan D24, D25, D26): Supabase Realtime on two **private** topics of the
 * app's own, through `@supabase/realtime-js` behind the allowlist.
 *
 * - `toolbox:sync` carries only "something changed": a broadcast `changed` with the tables a drain
 *   touched. Receiving one makes the engine pull (the data itself always comes through RLS).
 * - `toolbox:team` carries presence: per member (key = user id) the app's own small payload
 *   `{ v: 1, screen, idle }`, nothing else (owner, Q5: not the old app's fields).
 *
 * The client is always built with the guarded WebSocket (`net/network.ts`) and the `Network`'s
 * fetch, so it can reach the project's origin only. The socket URL carries the public key, so the
 * logger writes kinds, never a message, a payload or a URL. Presence is published at most once a
 * second and only on a change (the old app hit `client_rate_limit_exceeded`). Without Realtime
 * (no WebSocket, a refused join, a server that has it off) nothing fails: the engine's 20 s
 * catch-up carries on. One `Live` serves one session: `start()` after `stop()` does nothing.
 */

import { RealtimeClient } from "@supabase/realtime-js";
import type {
  RealtimeChannelOptions,
  RealtimeClientOptions,
  WebSocketLikeConstructor,
} from "@supabase/realtime-js";
import { z } from "zod";

import { presenceScreens } from "@gratovo/ipc";
import type { PresenceScreen } from "@gratovo/ipc";

import { createGuardedWebSocket } from "../net/network";
import type { Network } from "../net/network";
import type { SupabaseConfig } from "../supabase/config";
import type { Session, Timers } from "../supabase/session";

/** The two topics (D25). The client adds its own `realtime:` prefix on the wire. */
export const syncTopic = "toolbox:sync";
export const teamTopic = "toolbox:team";
/** The broadcast event on `toolbox:sync`. */
export const changedEvent = "changed";
/** The tables a broadcast may name (D25); the uploader's other tables stay out. */
export const liveTables = [
  "channel_state",
  "brands",
  "deals",
  "activity_log",
  "profiles",
  "member_access",
] as const;
/** At most one presence update per this many ms (D26). */
export const presenceGapMs = 1000;

const broadcastTablesMax = 10;
/** More keys than a team can have; a flood is cut here, before S28 filters to the team. */
const membersMax = 200;
/** How long `stop()` waits for each teardown step before moving on. */
const stopStepMs = 2000;

/** What a member publishes on `toolbox:team` (D26). Extra keys (the client's `presence_ref`) pass. */
const presencePayloadSchema = z.object({
  v: z.literal(1),
  screen: z.enum(presenceScreens),
  idle: z.boolean(),
});

/** What a `changed` broadcast carries (D25). */
const broadcastPayloadSchema = z.object({
  tables: z.array(z.enum(liveTables)).min(1).max(broadcastTablesMax),
});

export interface PresenceState {
  readonly screen: PresenceScreen;
  readonly idle: boolean;
}

/** The part of a `RealtimeChannel` this module uses, so tests can pass a fake. */
export interface RealtimeChannelLike {
  on(
    type: "broadcast",
    filter: { event: string },
    callback: (message: { payload?: unknown }) => void,
  ): RealtimeChannelLike;
  on(
    type: "presence",
    filter: { event: "sync" | "join" | "leave" },
    callback: () => void,
  ): RealtimeChannelLike;
  subscribe(callback: (status: string, error?: Error) => void): RealtimeChannelLike;
  presenceState(): Record<string, readonly unknown[]>;
  track(payload: Record<string, unknown>): Promise<string>;
  untrack(): Promise<string>;
  send(message: { type: "broadcast"; event: string; payload: unknown }): Promise<string>;
}

/** The part of a `RealtimeClient` this module uses. */
export interface RealtimeClientLike {
  channel(topic: string, options: RealtimeChannelOptions): RealtimeChannelLike;
  removeAllChannels(): Promise<unknown>;
  disconnect(): Promise<unknown>;
}

export interface LiveDeps {
  readonly config: SupabaseConfig;
  readonly network: Network;
  readonly session: Pick<Session, "accessToken">;
  readonly userId: string;
  /** Defaults to `new RealtimeClient(endpoint, options)`. */
  readonly createClient?: (endpoint: string, options: RealtimeClientOptions) => RealtimeClientLike;
  readonly log: (line: string) => void;
  readonly now: () => number;
  readonly timers: Timers;
}

export interface Live {
  /** Connects and joins both topics. Does nothing when already started or stopped. */
  start(): void;
  /** Leaves presence, removes both channels and disconnects. */
  stop(): Promise<void>;
  /** Tells teammates these tables changed (only while `toolbox:sync` is joined; else dropped). */
  announce(tables: readonly string[]): void;
  /** Your screen and idleness; published at most once a second, only when it changed. */
  setPresence(p: PresenceState): void;
  /** Everyone present on `toolbox:team` with a valid payload, by user id (you included). */
  members(): ReadonlyMap<string, PresenceState>;
  /** Called when a teammate's broadcast says something changed. */
  onRemoteChange(fn: () => void): void;
  /** Called when `members()` changed. */
  onPresence(fn: () => void): void;
}

const defaultCreateClient = (
  endpoint: string,
  options: RealtimeClientOptions,
): RealtimeClientLike => new RealtimeClient(endpoint, options);

/** `<project url, http→ws>/realtime/v1`; the client appends `/websocket` and its query. */
export function realtimeEndpoint(config: SupabaseConfig): string {
  const url = new URL("/realtime/v1", config.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}

/** Legacy ladder: 15 s × 2^(n-1), at most 8 minutes (D24). */
export function reconnectAfterMs(tries: number): number {
  return 1000 * Math.min(15 * 2 ** (Math.max(tries, 1) - 1), 480);
}

/** A word from the library or the server, safe for a log line; anything else becomes `other`. */
function word(value: unknown): string {
  const text = typeof value === "string" ? value.replace(/ /g, "_") : "";
  return /^[A-Za-z_]{1,32}$/.test(text) ? text.toLowerCase() : "other";
}

/** The library's `push` and `receive` lines come per message and hold payloads: never logged. */
const quietKinds: ReadonlySet<string> = new Set(["push", "receive"]);

function samePresence(a: PresenceState | null, b: PresenceState): boolean {
  return a !== null && a.screen === b.screen && a.idle === b.idle;
}

function sameMembers(
  a: ReadonlyMap<string, PresenceState>,
  b: ReadonlyMap<string, PresenceState>,
): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const [key, value] of a) {
    const other = b.get(key);
    if (other === undefined || !samePresence(other, value)) {
      return false;
    }
  }
  return true;
}

export function createLive(deps: LiveDeps): Live {
  const { log, now, timers } = deps;
  const remoteListeners: (() => void)[] = [];
  const presenceListeners: (() => void)[] = [];

  let started = false;
  let stopped = false;
  let client: RealtimeClientLike | null = null;
  let syncChannel: RealtimeChannelLike | null = null;
  let teamChannel: RealtimeChannelLike | null = null;
  let syncJoined = false;
  let teamJoined = false;

  // The app opens on Today; the page's first `presence:set` corrects it (S29).
  let desired: PresenceState = { screen: "today", idle: false };
  let tracked: PresenceState | null = null;
  let lastTrackAt = Number.NEGATIVE_INFINITY;
  let trackTimer: unknown = null;
  let present: ReadonlyMap<string, PresenceState> = new Map();

  function call(listeners: readonly (() => void)[]): void {
    for (const fn of listeners) {
      try {
        fn();
      } catch {
        log("live.listener_failed");
      }
    }
  }

  function clearTrackTimer(): void {
    if (trackTimer !== null) {
      timers.clear(trackTimer);
      trackTimer = null;
    }
  }

  function publishPresence(): void {
    trackTimer = null;
    if (stopped || !teamJoined || teamChannel === null || samePresence(tracked, desired)) {
      return;
    }
    const wait = lastTrackAt + presenceGapMs - now();
    if (wait > 0) {
      trackTimer = timers.set(publishPresence, wait);
      return;
    }
    const next = desired;
    tracked = next;
    lastTrackAt = now();
    teamChannel.track({ v: 1, screen: next.screen, idle: next.idle }).then(
      (answer) => {
        if (answer !== "ok") {
          log(`live.track ${word(answer)}`);
          // Not on the server: the next change or rejoin publishes again.
          if (tracked === next) {
            tracked = null;
          }
        }
      },
      () => {
        log("live.track failed");
        if (tracked === next) {
          tracked = null;
        }
      },
    );
  }

  function schedulePresence(): void {
    // A pending timer reads `desired` when it fires, so the latest value wins.
    if (trackTimer === null) {
      publishPresence();
    }
  }

  function setMembers(next: ReadonlyMap<string, PresenceState>): void {
    if (!sameMembers(present, next)) {
      present = next;
      call(presenceListeners);
    }
  }

  function rebuildMembers(): void {
    if (stopped || teamChannel === null) {
      return;
    }
    let state: Record<string, readonly unknown[]>;
    try {
      state = teamChannel.presenceState();
    } catch {
      log("live.presence unreadable");
      return;
    }
    const next = new Map<string, PresenceState>();
    for (const [key, metas] of Object.entries(state)) {
      if (next.size >= membersMax) {
        break;
      }
      if (key === "" || !Array.isArray(metas) || metas.length === 0) {
        continue;
      }
      // The newest meta is the last one; an invalid newest one hides the key.
      const parsed = presencePayloadSchema.safeParse(metas[metas.length - 1]);
      if (parsed.success) {
        next.set(key, { screen: parsed.data.screen, idle: parsed.data.idle });
      }
    }
    setMembers(next);
  }

  function onBroadcast(message: { payload?: unknown }): void {
    if (stopped) {
      return;
    }
    if (!broadcastPayloadSchema.safeParse(message.payload).success) {
      log("live.broadcast ignored");
      return;
    }
    call(remoteListeners);
  }

  /** Logs the state by kind; a refused or timed-out join is left to the client's reconnect. */
  function noteStatus(which: "sync" | "team", status: string): boolean {
    log(`live.${word(status)} ${which}`);
    return status === "SUBSCRIBED";
  }

  function join(current: RealtimeClientLike): void {
    syncChannel = current
      .channel(syncTopic, { config: { private: true, broadcast: { self: false } } })
      .on("broadcast", { event: changedEvent }, onBroadcast)
      .subscribe((status) => {
        if (!stopped) {
          syncJoined = noteStatus("sync", status);
        }
      });

    teamChannel = current
      .channel(teamTopic, { config: { private: true, presence: { key: deps.userId } } })
      .on("presence", { event: "sync" }, rebuildMembers)
      .on("presence", { event: "join" }, rebuildMembers)
      .on("presence", { event: "leave" }, rebuildMembers)
      .subscribe((status) => {
        if (stopped) {
          return;
        }
        teamJoined = noteStatus("team", status);
        if (teamJoined) {
          // A fresh join holds no presence of ours: publish again, even if unchanged.
          tracked = null;
          schedulePresence();
        } else {
          clearTrackTimer();
          tracked = null;
          setMembers(new Map());
        }
      });
  }

  /** Waits for a teardown step, but never longer than `stopStepMs`, and never throws. */
  function bounded(step: () => Promise<unknown>): Promise<void> {
    return new Promise<void>((resolve) => {
      const handle = timers.set(resolve, stopStepMs);
      const done = (): void => {
        timers.clear(handle);
        resolve();
      };
      try {
        step().then(done, done);
      } catch {
        done();
      }
    });
  }

  return {
    start() {
      if (started || stopped) {
        return;
      }
      started = true;
      let transport: WebSocketLikeConstructor;
      try {
        // Node's WebSocket is the WHATWG one the client expects; only its typing differs (Node
        // types `onerror` with an ErrorEvent, the client with an Event), hence the cast.
        transport = createGuardedWebSocket([
          deps.config.origin,
        ]) as unknown as WebSocketLikeConstructor;
      } catch {
        // No global WebSocket in this process: live updates are off, the catch-up carries on.
        log("live.off no_websocket");
        return;
      }
      const options: RealtimeClientOptions = {
        transport,
        fetch: (input, init) =>
          deps.network.request(input instanceof Request ? input.url : String(input), init),
        params: { apikey: deps.config.publishableKey },
        accessToken: () => deps.session.accessToken().catch(() => null),
        worker: false,
        reconnectAfterMs,
        logger: (kind) => {
          if (!quietKinds.has(kind)) {
            log(`live.log ${word(kind)}`);
          }
        },
      };
      try {
        client = (deps.createClient ?? defaultCreateClient)(realtimeEndpoint(deps.config), options);
        join(client);
      } catch {
        log("live.off client_failed");
        client = null;
      }
    },

    async stop() {
      if (stopped) {
        return;
      }
      stopped = true;
      clearTrackTimer();
      const current = client;
      const team = teamChannel;
      const wasTracked = teamJoined && tracked !== null;
      client = null;
      syncChannel = null;
      teamChannel = null;
      syncJoined = false;
      teamJoined = false;
      tracked = null;
      present = new Map();
      if (current === null) {
        return;
      }
      if (team !== null && wasTracked) {
        await bounded(() => team.untrack());
      }
      await bounded(() => current.removeAllChannels());
      await bounded(() => current.disconnect());
      log("live.stopped");
    },

    announce(tables) {
      const names = liveTables.filter((name) => tables.includes(name));
      if (names.length === 0 || stopped || !syncJoined || syncChannel === null) {
        // Not joined: the catch-up tick brings the change to teammates instead.
        return;
      }
      syncChannel.send({ type: "broadcast", event: changedEvent, payload: { tables: names } }).then(
        (answer) => {
          if (answer !== "ok") {
            log(`live.announce ${word(answer)}`);
          }
        },
        () => {
          log("live.announce failed");
        },
      );
    },

    setPresence(p) {
      desired = { screen: p.screen, idle: p.idle };
      if (!stopped) {
        schedulePresence();
      }
    },

    members() {
      return present;
    },

    onRemoteChange(fn) {
      remoteListeners.push(fn);
    },

    onPresence(fn) {
      presenceListeners.push(fn);
    },
  };
}
