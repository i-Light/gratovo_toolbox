import { creatorStages, exampleFrame } from "@gratovo/core/data";
import type { Frame, LogEntry } from "@gratovo/core/data";
import type { AppEventName, AppEventPayload } from "@gratovo/ipc";
import type { Bridge } from "@gratovo/ipc/bridge";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { act, setMyName, setNotify, undo } from "./actions";
import { installLiveUpdates } from "./live";
import { installPersistence, persistenceIdle } from "./persist";
import type { Route } from "./routes";
import { appStore, resetAppStoreForTests } from "./store";

const today: Route = { screen: "today", tab: null };
const now = new Date(2026, 9, 19, 10, 24, 0).getTime();
const data = () => appStore().getState().data;

/** A bridge whose `frame:load` answers what the test says, and whose events the test fires. */
function fakeBridge(slowWrites: Promise<void> | null = null) {
  const listeners = new Map<string, Set<(payload: never) => void>>();
  let server: Frame = exampleFrame(now);
  let hold: Promise<void> | null = null;
  const log: { channel: string; input: unknown }[] = [];
  const invoke = async (channel: string, input: unknown): Promise<unknown> => {
    log.push({ channel, input });
    if (channel === "frame:load") {
      const answer = server;
      if (hold !== null) {
        await hold;
      }
      return { ok: true, value: answer };
    }
    if (channel === "sync:status") {
      return { ok: true, value: { state: "synced", pending: 0, refused: 0, lastSyncedAt: now } };
    }
    if (channel === "data:write" && slowWrites !== null) {
      await slowWrites;
    }
    return { ok: true, value: {} };
  };
  const on = <E extends AppEventName>(
    event: E,
    listener: (payload: AppEventPayload<E>) => void,
  ): (() => void) => {
    const set = listeners.get(event) ?? new Set();
    set.add(listener);
    listeners.set(event, set);
    return () => set.delete(listener);
  };
  return {
    bridge: { invoke, on } as unknown as Pick<Bridge, "invoke" | "on">,
    calls: (channel: string) => log.filter((c) => c.channel === channel),
    setServer: (next: Frame) => {
      server = next;
    },
    holdAnswers: () => {
      let release = (): void => undefined;
      hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => {
        hold = null;
        release();
      };
    },
    emit<E extends AppEventName>(event: E, payload: AppEventPayload<E>) {
      for (const listener of listeners.get(event) ?? []) {
        listener(payload as never);
      }
    },
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
}

let fake = fakeBridge();
let stops: (() => void)[] = [];

function install(slowWrites: Promise<void> | null = null): void {
  for (const stop of stops) {
    stop();
  }
  fake = fakeBridge(slowWrites);
  stops = [installPersistence(fake.bridge.invoke), installLiveUpdates(fake.bridge)];
}

/** The server's frame with a teammate's line, a new creator, a changed stage and a changed team. */
function teammateChanged(): { frame: Frame; line: LogEntry; stage: string } {
  const base = exampleFrame(now);
  const teammate = base.team.find((m) => m.id !== base.me) ?? base.team[0];
  if (teammate === undefined) {
    throw new Error("the example has no team");
  }
  const line: LogEntry = {
    id: "00000000-0000-4000-8000-0000000000aa",
    at: now + 1000,
    who: teammate.id,
    text: "Moved a creator",
    ref: null,
    action: null,
    detail: null,
  };
  const first = base.creators[0];
  const stage = creatorStages.find((s) => s !== first?.stage);
  if (first === undefined || stage === undefined) {
    throw new Error("the example has no creator");
  }
  const added = {
    id: "new-creator-1",
    name: "Prompt Lab",
    handle: "@promptlab",
    stage: "new" as const,
    email: null,
    emailConfirmed: false,
    rejectReason: null,
    rejectedAt: null,
    archiveDueAt: null,
  };
  const frame: Frame = {
    ...base,
    log: [line, ...base.log].slice(0, 50),
    creators: [{ ...first, stage }, ...base.creators.slice(1), added],
    team: base.team.map((m) => (m.id === teammate.id ? { ...m, name: "Renamed Mate" } : m)),
  };
  return { frame, line, stage };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  resetAppStoreForTests(today, now);
  stops = [];
  install();
});

afterEach(async () => {
  await flush();
  for (const stop of stops) {
    stop();
  }
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("installLiveUpdates", () => {
  it("asks for the sync status once and shows it", async () => {
    await flush();
    expect(fake.calls("sync:status")).toHaveLength(1);
    expect(appStore().getState().ui.sync.state).toBe("synced");
    fake.emit("sync:status", { state: "offline", pending: 2, refused: 0, lastSyncedAt: null });
    expect(appStore().getState().ui.sync).toEqual({
      state: "offline",
      pending: 2,
      refused: 0,
      lastSyncedAt: null,
    });
  });

  it("takes a teammate's line, a new creator, a changed stage and team with no write", async () => {
    const { frame, line, stage } = teammateChanged();
    fake.setServer(frame);
    fake.emit("frame:changed", { parts: ["log", "creators", "team"] });
    await flush();
    expect(data().log[0]).toEqual(line);
    expect(data().creators[0]?.stage).toBe(stage);
    expect(data().creators.some((c) => c.id === "new-creator-1")).toBe(true);
    expect(data().team.some((m) => m.name === "Renamed Mate")).toBe(true);
    await flush();
    expect(fake.calls("data:write")).toHaveLength(0);
  });

  it("keeps a teammate's line and stage when an older change is undone, and writes only the inverse", async () => {
    setNotify("reply", false);
    await flush();
    expect(fake.calls("data:write")).toHaveLength(1);
    const { frame, line, stage } = teammateChanged();
    fake.setServer(frame);
    fake.emit("frame:changed", { parts: ["log", "creators"] });
    await flush();
    expect(data().log[0]).toEqual(line);

    undo();
    await flush();
    expect(data().settings.notify.reply).toBeUndefined();
    expect(data().log[0]).toEqual(line);
    expect(data().creators[0]?.stage).toBe(stage);
    const writes = fake.calls("data:write");
    expect(writes).toHaveLength(2);
    const kinds = (writes[1]?.input as { writes: { kind: string }[] }).writes.map((w) => w.kind);
    expect(kinds).toEqual(["notify.set"]);
  });

  it("still undoes your own stage change and its log line after the server echoes them back", async () => {
    const first = data().creators[0];
    const mine = creatorStages.find((s) => s !== first?.stage);
    if (first === undefined || mine === undefined) {
      throw new Error("the example has no creator");
    }
    const before = first.stage;
    act("Moved a creator", (d) => {
      const creator = d.creators.find((c) => c.id === first.id);
      if (creator !== undefined) {
        creator.stage = mine;
      }
    });
    await flush();
    const myLine = data().log[0];
    expect(myLine?.who).toBe(data().me);

    // The server now has your stage and your line, and a teammate's line came too.
    const { line } = teammateChanged();
    const base = exampleFrame(now);
    fake.setServer({
      ...base,
      creators: base.creators.map((c) => (c.id === first.id ? { ...c, stage: mine } : c)),
      log: [line, ...(myLine === undefined ? [] : [myLine]), ...base.log].slice(0, 50),
    });
    fake.emit("frame:changed", { parts: ["log", "creators"] });
    await flush();
    expect(data().log.some((l) => l.id === line.id)).toBe(true);

    undo();
    await flush();
    // Your change is undone, and the undo is written; the teammate's line stays.
    expect(data().creators.find((c) => c.id === first.id)?.stage).toBe(before);
    expect(data().log.some((l) => l.id === myLine?.id)).toBe(false);
    expect(data().log.some((l) => l.id === line.id)).toBe(true);
    const kinds = fake
      .calls("data:write")
      .flatMap((c) => (c.input as { writes: { kind: string }[] }).writes.map((w) => w.kind));
    expect(kinds).toContain("log.remove");
    expect(kinds.filter((k) => k === "creator.stage")).toHaveLength(2);
  });

  it("waits for the writes to finish, then asks for the frame", async () => {
    let finish = (): void => undefined;
    install(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    setMyName("Sam");
    await flush();
    expect(persistenceIdle()).toBe(false);
    fake.emit("frame:changed", { parts: ["log"] });
    await flush();
    expect(fake.calls("frame:load")).toHaveLength(0);
    finish();
    await flush();
    expect(persistenceIdle()).toBe(true);
    expect(fake.calls("frame:load")).toHaveLength(1);
  });

  it("drops an answer when the data changed on the way, and asks again", async () => {
    const release = fake.holdAnswers();
    const { frame } = teammateChanged();
    fake.setServer(frame);
    fake.emit("frame:changed", { parts: ["creators"] });
    await flush();
    expect(fake.calls("frame:load")).toHaveLength(1);
    setNotify("search", false);
    release();
    await flush();
    expect(data().creators.some((c) => c.id === "new-creator-1")).toBe(false);
    await vi.advanceTimersByTimeAsync(1100);
    await flush();
    expect(fake.calls("frame:load")).toHaveLength(2);
    expect(data().creators.some((c) => c.id === "new-creator-1")).toBe(true);
    expect(data().settings.notify.search).toBe(false);
  });

  it("takes myName only when the parts name me", async () => {
    const base = exampleFrame(now);
    const before = data().myName;
    fake.setServer({ ...base, myName: "Renamed By Server" });
    fake.emit("frame:changed", { parts: ["team"] });
    await flush();
    expect(data().myName).toBe(before);
    await vi.advanceTimersByTimeAsync(1100);
    fake.emit("frame:changed", { parts: ["me"] });
    await flush();
    expect(data().myName).toBe("Renamed By Server");
    expect(fake.calls("data:write")).toHaveLength(0);
  });

  it("stops listening when stopped", async () => {
    for (const stop of stops) {
      stop();
    }
    fake.emit("frame:changed", { parts: ["team"] });
    await flush();
    expect(fake.calls("frame:load")).toHaveLength(0);
  });
  it("takes a presence change into the team, writes nothing and keeps Undo", async () => {
    const mate = data().team.find((m) => m.id !== data().me);
    if (mate === undefined) {
      throw new Error("the example has no team");
    }
    const other = data().team.find((m) => m.id !== mate.id);
    const before = other;
    setMyName("Renamed Me");
    await flush();
    const writes = fake.calls("data:write").length;
    fake.emit("presence:changed", {
      members: [
        { id: mate.id, status: mate.status === "online" ? "away" : "online", doing: "Reach" },
      ],
    });
    await flush();
    const after = data().team.find((m) => m.id === mate.id);
    expect(after?.doing).toBe("Reach");
    expect(after?.status).not.toBe(mate.status);
    expect(data().team.find((m) => m.id === other?.id)).toBe(before);
    expect(fake.calls("data:write").length).toBe(writes);
    undo();
    await flush();
    expect(data().team.find((m) => m.id === mate.id)?.doing).toBe("Reach");
  });
});
