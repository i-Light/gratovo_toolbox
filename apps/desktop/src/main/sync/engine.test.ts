import type { AppEventName, FramePart, SyncStatus } from "@gratovo/ipc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { enqueue, noteFailure, pendingCount, removeEntries } from "../data/repositories";
import { openDatabase } from "../db/open-database";
import { AuthError } from "../supabase/auth-client";
import type { Rest } from "../supabase/rest";
import { RestError } from "../supabase/rest";
import type { Timers } from "../supabase/session";

import { createSyncEngine, debounceMs, lastSyncedKey, retryLadderMs, tickMs } from "./engine";
import type { EngineSteps, EventSender, SyncEngine } from "./engine";
import type { PullResult } from "./puller";
import type { DrainResult } from "./uploader";

type Db = ReturnType<typeof openDatabase>;

const me = "u-me";

/** Lets every resolved promise and pending `setImmediate` run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 25; i += 1) {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
}

/** A clock and timers that only move when the test says so. */
function fakeTime() {
  let time = 1_000_000;
  let nextId = 1;
  const pending = new Map<number, { at: number; callback: () => void }>();
  const timers: Timers = {
    set(callback, ms) {
      const id = nextId;
      nextId += 1;
      pending.set(id, { at: time + ms, callback });
      return id;
    },
    clear(handle) {
      pending.delete(handle as number);
    },
  };
  async function advance(ms: number): Promise<void> {
    const end = time + ms;
    for (;;) {
      await settle();
      const due = [...pending.entries()]
        .filter(([, t]) => t.at <= end)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (due === undefined) {
        break;
      }
      pending.delete(due[0]);
      time = Math.max(time, due[1].at);
      due[1].callback();
    }
    time = Math.max(time, end);
    await settle();
  }
  return {
    now: () => time,
    timers,
    advance,
    step(ms: number) {
      time += ms;
    },
    get timerCount() {
      return pending.size;
    },
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const emptyDrain: DrainResult = { sent: 0, dropped: 0, stoppedOn: null, tables: new Set() };
const donePull: PullResult = { changed: new Set(), done: true, stalled: [] };

const ignorePart: (part: FramePart) => void = () => undefined;
const pullDone: (budgetMs: number) => Promise<PullResult> = () => Promise.resolve(donePull);

/** Steps that record their calls; each can be replaced by a test. */
function fakeSteps() {
  const calls: string[] = [];
  const f = {
    calls,
    hooks: { onTableDone: ignorePart },
    drain: (): Promise<DrainResult> => Promise.resolve(emptyDrain),
    refetch: (): Promise<ReadonlySet<FramePart>> => Promise.resolve(new Set()),
    refreshWhole: (): Promise<ReadonlySet<FramePart>> => Promise.resolve(new Set()),
    pull: pullDone,
    make(hooks: { onTableDone: (part: FramePart) => void }): EngineSteps {
      f.hooks = hooks;
      return {
        drain: () => {
          calls.push("drain");
          return f.drain();
        },
        refetch: () => {
          calls.push("refetch");
          return f.refetch();
        },
        refreshWhole: () => {
          calls.push("refreshWhole");
          return f.refreshWhole();
        },
        pull: (budgetMs) => {
          calls.push("pull");
          return f.pull(budgetMs);
        },
      };
    },
    passes(): number {
      return calls.filter((c) => c === "drain").length;
    },
  };
  return f;
}

/** Every event the engine sent, in order. */
function recorder() {
  const events: { name: AppEventName; payload: unknown }[] = [];
  const emit: EventSender = (name, payload) => {
    events.push({ name, payload });
  };
  return {
    emit,
    events,
    statuses: () =>
      events.filter((e) => e.name === "sync:status").map((e) => e.payload as SyncStatus),
    frames: () =>
      events
        .filter((e) => e.name === "frame:changed")
        .map((e) => (e.payload as { parts: FramePart[] }).parts),
  };
}

function addEntry(db: Db, userId = me): number {
  return enqueue(db, {
    userId,
    kind: "profile.name",
    payload: { name: "Sara Okafor" },
    target: { table: "profiles", key: userId },
    now: 1,
  });
}

describe("createSyncEngine", () => {
  let db: Db;
  let time: ReturnType<typeof fakeTime>;
  let steps: ReturnType<typeof fakeSteps>;
  let events: ReturnType<typeof recorder>;
  let lines: string[];
  let announced: (readonly string[])[];
  let engine: SyncEngine;

  function make(o: { announce?: boolean } = {}): SyncEngine {
    engine = createSyncEngine({
      db,
      rest: {} as Rest,
      userId: me,
      now: time.now,
      timers: time.timers,
      emit: events.emit,
      ...(o.announce === false
        ? {}
        : {
            announce: (tables: readonly string[]) => {
              announced.push(tables);
            },
          }),
      log: (line) => {
        lines.push(line);
      },
      steps: (hooks) => steps.make(hooks),
    });
    return engine;
  }

  beforeEach(() => {
    db = openDatabase(":memory:");
    time = fakeTime();
    steps = fakeSteps();
    events = recorder();
    lines = [];
    announced = [];
  });

  afterEach(() => {
    engine.stop();
    if (db.isOpen) {
      db.close();
    }
  });

  it("runs the steps in order, after removing other users' outbox rows", async () => {
    addEntry(db, "u-other");
    addEntry(db);
    let othersAtDrain = -1;
    steps.drain = () => {
      othersAtDrain = pendingCount(db) - pendingCount(db, me);
      return Promise.resolve(emptyDrain);
    };
    make().start();
    await time.advance(0);

    expect(steps.calls).toEqual(["drain", "refetch", "refreshWhole", "pull"]);
    expect(othersAtDrain).toBe(0);
    expect(pendingCount(db, me)).toBe(1);
    expect(lines).toContain("sync.outbox.other_users removed=1");
  });

  it("gives the pull what is left of the 2 minute budget", async () => {
    let budget = -1;
    steps.refreshWhole = () => {
      time.step(30_000);
      return Promise.resolve(new Set());
    };
    steps.pull = (ms) => {
      budget = ms;
      return Promise.resolve(donePull);
    };
    make().start();
    await time.advance(0);

    expect(budget).toBe(90_000);
  });

  it("runs exactly one more pass for writes made during a pass", async () => {
    const gate = deferred();
    steps.pull = async () => {
      await gate.promise;
      return donePull;
    };
    make().start();
    await time.advance(0);
    expect(steps.passes()).toBe(1);

    engine.noteWrite();
    engine.noteWrite();
    await time.advance(debounceMs);
    engine.noteRemote();
    await time.advance(debounceMs);
    expect(steps.passes()).toBe(1);

    gate.resolve();
    await time.advance(0);
    expect(steps.passes()).toBe(2);

    await time.advance(tickMs - 1);
    expect(steps.passes()).toBe(2);
    await time.advance(1);
    expect(steps.passes()).toBe(3);
  });

  it("debounces writes and broadcasts to 1 s after the last one", async () => {
    make().start();
    await time.advance(tickMs - 100);
    expect(steps.passes()).toBe(1);

    engine.noteWrite();
    await time.advance(600);
    engine.noteRemote();
    await time.advance(600);
    // The tick fell inside: it ran a pass, and the debounce is still waiting.
    expect(steps.passes()).toBe(2);
    await time.advance(400);
    expect(steps.passes()).toBe(3);
  });

  it("waits 30 s, 2 min, 10 min, then 30 min after failed passes, and syncNow resets it", async () => {
    steps.pull = () => Promise.reject(new RestError("http", 503));
    make().start();
    await time.advance(0);
    expect(steps.passes()).toBe(1);

    for (const [index, wait] of [...retryLadderMs, 1_800_000].entries()) {
      await time.advance(wait - 1);
      expect(steps.passes()).toBe(index + 1);
      await time.advance(1);
      expect(steps.passes()).toBe(index + 2);
    }
    expect(steps.passes()).toBe(6);

    await engine.syncNow();
    expect(steps.passes()).toBe(7);
    // The ladder starts again from its first step.
    await time.advance(retryLadderMs[0] ?? 0);
    expect(steps.passes()).toBe(8);

    // A good pass goes back to the 20 s tick.
    steps.pull = () => Promise.resolve(donePull);
    await time.advance(retryLadderMs[1] ?? 0);
    expect(steps.passes()).toBe(9);
    await time.advance(tickMs);
    expect(steps.passes()).toBe(10);
  });

  it("syncNow awaits the running pass and then runs one more", async () => {
    const gate = deferred();
    steps.pull = async () => {
      await gate.promise;
      return donePull;
    };
    make().start();
    await time.advance(0);

    let answered: SyncStatus | null = null;
    void engine.syncNow().then((s) => {
      answered = s;
    });
    await time.advance(0);
    expect(answered).toBeNull();

    steps.pull = () => Promise.resolve(donePull);
    gate.resolve();
    await time.advance(0);
    expect(steps.passes()).toBe(2);
    expect(answered).toMatchObject({ state: "synced" });
  });

  it("carries an unfinished pull on in the next pass, 1 s later", async () => {
    steps.pull = () => Promise.resolve({ changed: new Set(), done: false, stalled: [] });
    make().start();
    await time.advance(0);
    expect(engine.status().state).toBe("syncing");
    expect(engine.status().lastSyncedAt).toBeNull();

    await time.advance(debounceMs);
    expect(steps.passes()).toBe(2);
  });

  describe("status", () => {
    it("goes from syncing to synced and records the time", async () => {
      addEntry(db);
      steps.drain = () => {
        removeEntries(db, [1]);
        return Promise.resolve({ ...emptyDrain, sent: 1, tables: new Set(["profiles"]) });
      };
      make();
      expect(engine.status()).toEqual({ state: "off", pending: 1, refused: 0, lastSyncedAt: null });
      engine.start();
      await time.advance(0);

      const states = events.statuses().map((s) => s.state);
      expect(states[0]).toBe("syncing");
      expect(states.at(-1)).toBe("synced");
      expect(engine.status()).toEqual({
        state: "synced",
        pending: 0,
        refused: 0,
        lastSyncedAt: time.now(),
      });
      expect(db.prepare("SELECT value FROM _meta WHERE key = ?").get(lastSyncedKey)).toEqual({
        value: String(time.now()),
      });
    });

    it("says offline when the server can't be reached", async () => {
      steps.refreshWhole = () => Promise.reject(new RestError("offline"));
      make().start();
      await time.advance(0);

      expect(engine.status().state).toBe("offline");
      expect(events.statuses().at(-1)?.state).toBe("offline");
      expect(lines).toContain("sync.pass.failed code=offline");
    });

    it("says stuck when the head failed 4 times, not for being offline", async () => {
      const seq = addEntry(db);
      let code = "PGRST202";
      steps.drain = () => {
        noteFailure(db, seq, code);
        return Promise.resolve({ ...emptyDrain, stoppedOn: "retry" });
      };
      make().start();
      await time.advance(0);
      expect(engine.status().state).toBe("offline");

      for (const wait of retryLadderMs.slice(0, 3)) {
        await time.advance(wait);
      }
      expect(steps.passes()).toBe(4);
      expect(engine.status()).toMatchObject({ state: "stuck", pending: 1 });
      expect(events.statuses().at(-1)?.state).toBe("stuck");

      code = "offline";
      await time.advance(retryLadderMs[3] ?? 0);
      expect(steps.passes()).toBe(5);
      expect(engine.status().state).toBe("offline");
    });

    it("counts the refused changes and the pending ones", () => {
      const seq = addEntry(db);
      addEntry(db);
      db.prepare(
        "INSERT INTO _outbox_dropped (seq, user_id, kind, payload, code, dropped_at) VALUES (?, ?, 'brand.set', '{}', '42501', 'x')",
      ).run(seq + 100, me);
      make();
      expect(engine.status()).toMatchObject({ pending: 2, refused: 1 });
    });

    it("sends a status only when it changed, and one after a write is queued", async () => {
      make().start();
      await time.advance(0);
      const before = events.statuses().length;
      await time.advance(tickMs);
      expect(events.statuses().length).toBe(before + 2); // syncing, then synced again

      addEntry(db);
      engine.noteWrite();
      expect(events.statuses().at(-1)).toMatchObject({ state: "synced", pending: 1 });
    });
  });

  describe("frame:changed", () => {
    it("sends at most one event per 2 s during a pass and the rest at its end", async () => {
      const gate = deferred();
      steps.refreshWhole = () => Promise.resolve(new Set<FramePart>(["team"]));
      steps.pull = async () => {
        steps.hooks.onTableDone("creators");
        time.step(500);
        steps.hooks.onTableDone("brands");
        await gate.promise;
        steps.hooks.onTableDone("deals");
        return {
          changed: new Set<FramePart>(["creators", "brands", "deals", "log"]),
          done: true,
          stalled: [],
        };
      };
      make().start();
      await time.advance(0);
      expect(events.frames()).toEqual([["team"]]);

      await time.advance(1_499);
      expect(events.frames()).toEqual([["team"]]);
      await time.advance(1);
      expect(events.frames()).toEqual([["team"], ["creators", "brands"]]);

      gate.resolve();
      await time.advance(0);
      expect(events.frames()).toEqual([["team"], ["creators", "brands"], ["deals", "log"]]);
    });

    it("sends nothing for a pass that changed nothing", async () => {
      make().start();
      await time.advance(0);
      expect(events.frames()).toEqual([]);
    });

    it("sends what changed before a pass failed", async () => {
      steps.refetch = () => Promise.resolve(new Set<FramePart>(["creators"]));
      steps.pull = () => Promise.reject(new RestError("http", 500));
      make().start();
      await time.advance(0);
      expect(events.frames()).toEqual([["creators"]]);
    });

    it("refreshWhole sends its parts", async () => {
      steps.refreshWhole = () => Promise.resolve(new Set<FramePart>(["team", "me"]));
      make();
      await engine.refreshWhole();
      expect(events.frames()).toEqual([["team", "me"]]);
      expect(steps.calls).toEqual(["refreshWhole"]);
    });
  });

  describe("announce", () => {
    it("names the tables teammates pull after a drain that sent something", async () => {
      steps.drain = () =>
        Promise.resolve({
          sent: 3,
          dropped: 0,
          stoppedOn: null,
          tables: new Set([
            "notification_switches",
            "activity_log",
            "edit_conflicts",
            "channel_state",
          ]),
        });
      make().start();
      await time.advance(0);
      expect(announced).toEqual([["channel_state", "activity_log"]]);
    });

    it("stays quiet when nothing was sent or only your own switches were", async () => {
      steps.drain = () => Promise.resolve({ ...emptyDrain, dropped: 2, tables: new Set() });
      make().start();
      await time.advance(0);
      steps.drain = () =>
        Promise.resolve({ ...emptyDrain, sent: 1, tables: new Set(["notification_switches"]) });
      await engine.syncNow();
      expect(steps.passes()).toBe(2);
      expect(announced).toEqual([]);
    });

    it("announces after a drain that sent some and then stopped", async () => {
      steps.drain = () =>
        Promise.resolve({ sent: 1, dropped: 0, stoppedOn: "retry", tables: new Set(["brands"]) });
      make().start();
      await time.advance(0);
      expect(announced).toEqual([["brands"]]);
    });

    it("works without an announcer", async () => {
      steps.drain = () => Promise.resolve({ ...emptyDrain, sent: 1, tables: new Set(["brands"]) });
      make({ announce: false }).start();
      await time.advance(0);
      expect(engine.status().state).toBe("synced");
    });
  });

  it("stops the pass when the drain stopped on the session and retries 30 s later", async () => {
    steps.drain = () => Promise.resolve({ ...emptyDrain, stoppedOn: "session" });
    make().start();
    await time.advance(0);
    expect(steps.calls).toEqual(["drain"]);
    await time.advance(retryLadderMs[0] ?? 0);
    expect(steps.calls).toEqual(["drain", "drain"]);
  });

  describe("drainBefore", () => {
    it("returns what is still pending at the deadline", async () => {
      addEntry(db);
      addEntry(db);
      const gate = deferred();
      steps.drain = async () => {
        await gate.promise;
        return emptyDrain;
      };
      make();
      let left = -1;
      void engine.drainBefore(time.now() + 5_000).then((n) => {
        left = n;
      });
      await time.advance(4_999);
      expect(left).toBe(-1);
      await time.advance(1);
      expect(left).toBe(2);
      gate.resolve();
    });

    it("answers as soon as the drain is done, and announces what it sent", async () => {
      const seq = addEntry(db);
      steps.drain = () => {
        removeEntries(db, [seq]);
        return Promise.resolve({ ...emptyDrain, sent: 1, tables: new Set(["activity_log"]) });
      };
      make();
      await expect(engine.drainBefore(time.now() + 5_000)).resolves.toBe(0);
      expect(announced).toEqual([["activity_log"]]);
      expect(steps.calls).toEqual(["drain"]);
    });

    it("never drains alongside a running pass", async () => {
      const gate = deferred();
      let inPass = false;
      let overlapped = false;
      steps.drain = () => {
        overlapped ||= inPass;
        return Promise.resolve(emptyDrain);
      };
      steps.pull = async () => {
        inPass = true;
        await gate.promise;
        inPass = false;
        return donePull;
      };
      make().start();
      await time.advance(0);
      const left = engine.drainBefore(time.now() + 5_000);
      await time.advance(100);
      gate.resolve();
      await time.advance(0);
      await expect(left).resolves.toBe(0);
      expect(steps.calls).toEqual(["drain", "refetch", "refreshWhole", "pull", "drain"]);
      expect(overlapped).toBe(false);
    });
  });

  describe("stop", () => {
    it("runs nothing after stop, even the rest of a running pass", async () => {
      const gate = deferred();
      steps.drain = async () => {
        await gate.promise;
        return { ...emptyDrain, sent: 1, tables: new Set(["brands"]) };
      };
      make().start();
      await time.advance(0);
      const sent = events.events.length;

      engine.stop();
      gate.resolve();
      engine.noteWrite();
      engine.noteRemote();
      await time.advance(60 * 60_000);
      await engine.syncNow();

      expect(steps.calls).toEqual(["drain"]);
      expect(events.events.length).toBe(sent);
      expect(announced).toEqual([]);
      expect(time.timerCount).toBe(0);
      expect(engine.status().state).toBe("off");
    });

    it("stops itself when the session has ended", async () => {
      steps.refreshWhole = () => Promise.reject(new AuthError("ended", "session_not_found"));
      make().start();
      await time.advance(0);
      await time.advance(60 * 60_000);

      expect(steps.calls).toEqual(["drain", "refetch", "refreshWhole"]);
      expect(engine.status().state).toBe("off");
      expect(time.timerCount).toBe(0);
    });

    it("does nothing once the database is closed", async () => {
      const gate = deferred();
      steps.refetch = async () => {
        await gate.promise;
        return new Set<FramePart>(["creators"]);
      };
      make().start();
      await time.advance(0);
      db.close();
      gate.resolve();
      await time.advance(0);
      expect(steps.calls).toEqual(["drain", "refetch"]);
      expect(events.frames()).toEqual([]);
    });
  });
});
