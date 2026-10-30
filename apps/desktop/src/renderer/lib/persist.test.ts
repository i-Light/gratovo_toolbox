import { bareBrand } from "@gratovo/core/data";
import type { DataWrite } from "@gratovo/core/data";
import type { Bridge, InvokeResult } from "@gratovo/ipc/bridge";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";

import { strings } from "../strings";
import {
  act,
  closeTray,
  markAllRead,
  peek,
  readNotification,
  redo,
  setMyName,
  setNotify,
  toggleTray,
  undo,
} from "./actions";
import { exampleData } from "./example-data";
import {
  adoptServerData,
  diffData,
  installPersistence,
  onPersistenceIdle,
  persistenceIdle,
} from "./persist";
import type { Route } from "./routes";
import { appStore, go, initAppStore, resetAppStoreForTests } from "./store";
import type { AppData, Notification } from "./store";

const today: Route = { screen: "today", tab: null };
const now = new Date(2026, 9, 19, 10, 24, 0).getTime();

const data = () => appStore().getState().data;
const ui = () => appStore().getState().ui;

/** One `data:write` call the fake bridge received, and how to answer it. */
interface Call {
  readonly writes: readonly DataWrite[];
  readonly answer: (result: InvokeResult<"data:write">) => void;
  readonly fail: (error: unknown) => void;
}

/**
 * A bridge that records each `data:write` and answers it when told; with `auto`, it answers
 * "saved" at once.
 */
function fakeBridge(auto: boolean): { invoke: Bridge["invoke"]; calls: Call[] } {
  const calls: Call[] = [];
  const invoke = (channel: string, input: unknown): Promise<InvokeResult<"data:write">> => {
    expect(channel).toBe("data:write");
    return new Promise((resolve, reject) => {
      const { writes } = input as { writes: readonly DataWrite[] };
      calls.push({ writes, answer: resolve, fail: reject });
      if (auto) {
        resolve({ ok: true, value: {} });
      }
    });
  };
  return { invoke: invoke as Bridge["invoke"], calls };
}

/** Lets the promise chains run (the fake timers leave promises alone). */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
}

/** Answers every call still waiting, so the next test starts with an idle queue. */
async function drain(calls: Call[]): Promise<void> {
  for (let i = 0; i < 1000 && !persistenceIdle(); i += 1) {
    for (const call of calls) {
      call.answer({ ok: true, value: {} });
    }
    await flush();
  }
}

const sent = (calls: readonly Call[]): DataWrite[][] => calls.map((c) => [...c.writes]);

let errors: MockInstance<typeof console.error>;
let bridge = fakeBridge(true);
let uninstall: () => void = () => undefined;

function install(auto = true): void {
  bridge = fakeBridge(auto);
  uninstall = installPersistence(bridge.invoke);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
  bridge = fakeBridge(true);
  uninstall = () => undefined;
  resetAppStoreForTests(today, now);
});

afterEach(async () => {
  await drain(bridge.calls);
  uninstall();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("diffData", () => {
  const base = exampleData(now);
  const n0 = base.notifications[0] as Notification;

  it("finds nothing when the data is the same object", () => {
    expect(diffData(base, base)).toEqual({ writes: [], unsupported: [] });
    expect(diffData(base, { ...base })).toEqual({ writes: [], unsupported: [] });
  });

  it("writes read changes, the notify map, the name and log lines", () => {
    const after: AppData = {
      ...base,
      notifications: [{ ...n0, read: !n0.read }, ...base.notifications.slice(1)],
      settings: { notify: { reply: false } },
      myName: "Ada",
      log: [
        {
          id: "a",
          at: 5,
          who: base.me,
          text: "Did it",
          ref: "c1",
          action: "creator.reject",
          detail: "ai",
        },
      ],
    };
    expect(diffData(base, after)).toEqual({
      writes: [
        { kind: "notification.read", id: n0.id, read: !n0.read },
        { kind: "notify.set", notify: { reply: false } },
        { kind: "me.name", name: "Ada" },
        {
          kind: "log.add",
          id: "a",
          at: 5,
          text: "Did it",
          ref: "c1",
          action: "creator.reject",
          detail: "ai",
        },
      ],
      unsupported: [],
    });
    expect(diffData(after, { ...after, myName: null, log: [] }).writes).toEqual([
      { kind: "me.name", name: "" },
      { kind: "log.remove", id: "a" },
    ]);
  });

  it("writes new log lines oldest first", () => {
    const log = [
      { id: "b", at: 2, who: base.me, text: "Second", ref: null, action: null, detail: null },
      { id: "a", at: 1, who: base.me, text: "First", ref: null, action: null, detail: null },
    ];
    expect(
      diffData(base, { ...base, log }).writes.map((w) => w.kind === "log.add" && w.id),
    ).toEqual(["a", "b"]);
  });

  it("names every change it cannot write, and writes none of them", () => {
    const after: AppData = {
      ...base,
      me: "u2",
      team: [...base.team],
      counts: { ...base.counts },
      mateRun: null,
      conflicts: [...base.conflicts],
    };
    expect(diffData(base, after)).toEqual({
      writes: [],
      unsupported: ["me", "team", "counts", "mateRun", "conflicts"],
    });
  });

  it("writes a creator's stage change, and the inverse for an undo", () => {
    const c0 = base.creators[0] as AppData["creators"][number];
    const next = c0.stage === "new" ? "contact" : "new";
    const after = {
      ...base,
      creators: [{ ...c0, stage: next } as typeof c0, ...base.creators.slice(1)],
    };
    expect(diffData(base, after)).toEqual({
      writes: [{ kind: "creator.stage", id: c0.id, stage: next, handle: c0.handle, name: c0.name }],
      unsupported: [],
    });
    expect(diffData(after, base).writes).toEqual([
      { kind: "creator.stage", id: c0.id, stage: c0.stage, handle: c0.handle, name: c0.name },
    ]);
  });

  it("writes the reason with a move to rejected, and none with any other move", () => {
    const c0 = base.creators[0] as AppData["creators"][number];
    const rejected = {
      ...base,
      creators: [
        { ...c0, stage: "rejected", rejectReason: "views", rejectedAt: 5 } as typeof c0,
        ...base.creators.slice(1),
      ],
    };
    expect(diffData(base, rejected)).toEqual({
      writes: [
        {
          kind: "creator.stage",
          id: c0.id,
          stage: "rejected",
          handle: c0.handle,
          name: c0.name,
          reason: "views",
        },
      ],
      unsupported: [],
    });
    expect(diffData(rejected, base).writes).toEqual([
      { kind: "creator.stage", id: c0.id, stage: c0.stage, handle: c0.handle, name: c0.name },
    ]);
    const noReason = {
      ...base,
      creators: [{ ...c0, stage: "rejected" } as typeof c0, ...base.creators.slice(1)],
    };
    expect(diffData(base, noReason).writes).toEqual([
      { kind: "creator.stage", id: c0.id, stage: "rejected", handle: c0.handle, name: c0.name },
    ]);
  });

  it("writes nothing for a reject reason or time that changes with the same stage", () => {
    const c0 = base.creators[0] as AppData["creators"][number];
    const after = {
      ...base,
      creators: [
        { ...c0, rejectReason: "ai", rejectedAt: 9 } as typeof c0,
        ...base.creators.slice(1),
      ],
    };
    expect(diffData(base, after)).toEqual({ writes: [], unsupported: [] });
  });

  describe("a creator's contact (plan step 5, D31)", () => {
    type Creator = AppData["creators"][number];
    const c0: Creator = { ...(base.creators[0] as Creator), stage: "shortlisted" };
    const before = { ...base, creators: [c0, ...base.creators.slice(1)] };
    const confirmed: Creator = {
      ...c0,
      email: "biz@promptlab.tv",
      emailConfirmed: true,
      contactName: "Maya",
      contactSource: "about",
      contactConfidence: 0.95,
    };
    const contactWrite = (c: Creator): DataWrite => ({
      kind: "creator.contact",
      id: c.id,
      email: c.email,
      confirmed: c.emailConfirmed,
      contactName: c.contactName,
      source: c.contactSource,
      confidence: c.contactConfidence,
      handle: c.handle,
      name: c.name,
    });
    const stageWrite = (c: Creator): DataWrite => ({
      kind: "creator.stage",
      id: c.id,
      stage: c.stage,
      handle: c.handle,
      name: c.name,
    });
    const withCreator = (c: Creator) => ({ ...base, creators: [c, ...base.creators.slice(1)] });

    it("confirming with the stage writes the contact first, then the stage", () => {
      const after = withCreator({ ...confirmed, stage: "contact" });
      expect(diffData(before, after)).toEqual({
        writes: [
          contactWrite({ ...confirmed, stage: "contact" }),
          stageWrite({ ...confirmed, stage: "contact" }),
        ],
        unsupported: [],
      });
    });

    it("undo writes the old contact back, then the old stage", () => {
      const after = withCreator({ ...confirmed, stage: "contact" });
      expect(diffData(after, before).writes).toEqual([contactWrite(c0), stageWrite(c0)]);
      // The example creator had an unconfirmed address: it goes back as it was, not confirmed.
      expect(diffData(after, before).writes[0]).toMatchObject({
        email: c0.email,
        confirmed: false,
        contactName: null,
        source: null,
        confidence: null,
      });
      const none = withCreator({ ...c0, email: null });
      expect(diffData(withCreator({ ...confirmed, stage: "contact" }), none).writes[0]).toEqual({
        ...contactWrite(c0),
        email: null,
      });
    });

    it("a contact change alone writes the contact and no stage", () => {
      expect(diffData(before, withCreator(confirmed))).toEqual({
        writes: [contactWrite(confirmed)],
        unsupported: [],
      });
    });

    it("each contact field on its own writes the whole contact", () => {
      const changes: Partial<Creator>[] = [
        { email: "team@promptlab.tv" },
        { emailConfirmed: true },
        { contactName: "Maya" },
        { contactSource: "typed" },
        { contactConfidence: 0.6 },
      ];
      for (const change of changes) {
        const now = { ...c0, ...change };
        expect(diffData(before, withCreator(now))).toEqual({
          writes: [contactWrite(now)],
          unsupported: [],
        });
      }
    });

    it("a stage change alone writes no contact", () => {
      expect(diffData(before, withCreator({ ...c0, stage: "contact" })).writes).toEqual([
        stageWrite({ ...c0, stage: "contact" }),
      ]);
    });

    it("a contact change with another field it cannot write writes nothing", () => {
      expect(diffData(before, withCreator({ ...confirmed, name: "Other" }))).toEqual({
        writes: [],
        unsupported: ["creators"],
      });
    });
  });

  it("cannot write any other creator change, or a creator added or removed", () => {
    const c0 = base.creators[0] as AppData["creators"][number];
    const renamed = { ...base, creators: [{ ...c0, name: "Other" }, ...base.creators.slice(1)] };
    expect(diffData(base, renamed)).toEqual({ writes: [], unsupported: ["creators"] });
    const removed = { ...base, creators: base.creators.slice(1) };
    expect(diffData(base, removed).unsupported).toEqual(["creators"]);
    const added = { ...base, creators: [...base.creators, { ...c0, id: "new" }] };
    expect(diffData(base, added).unsupported).toEqual(["creators"]);
  });

  it("writes a new or changed brand, but not a removed one", () => {
    const b0 = base.brands[0] as AppData["brands"][number];
    const changed = { ...b0, status: b0.status === "won" ? ("found" as const) : ("won" as const) };
    const fresh = bareBrand({ id: "b-new", name: "Nova", sells: "AI notes", status: "found" });
    const after = { ...base, brands: [changed, ...base.brands.slice(1), fresh] };
    expect(diffData(base, after)).toEqual({
      writes: [
        { kind: "brand.set", id: b0.id, name: b0.name, sells: b0.sells, status: changed.status },
        { kind: "brand.set", id: "b-new", name: "Nova", sells: "AI notes", status: "found" },
      ],
      unsupported: [],
    });
    expect(diffData(base, { ...base, brands: base.brands.slice(1) }).unsupported).toEqual([
      "brands",
    ]);
    expect(
      diffData(base, { ...base, brands: [{ ...b0 }, ...base.brands.slice(1)] }).writes,
    ).toEqual([]);
  });

  it("writes a deal's step change, but nothing else about a deal", () => {
    const d0 = base.deals[0] as AppData["deals"][number];
    const stepped = { ...base, deals: [{ ...d0, step: d0.step + 1 }, ...base.deals.slice(1)] };
    expect(diffData(base, stepped)).toEqual({
      writes: [{ kind: "deal.step", id: d0.id, step: d0.step + 1 }],
      unsupported: [],
    });
    const repriced = { ...base, deals: [{ ...d0, price: 1 }, ...base.deals.slice(1)] };
    expect(diffData(base, repriced)).toEqual({ writes: [], unsupported: ["deals"] });
    expect(diffData(base, { ...base, deals: base.deals.slice(1) }).unsupported).toEqual(["deals"]);
  });

  it("cannot write a new, removed or edited notification, or an edited log line", () => {
    const added = { ...base, notifications: [...base.notifications, { ...n0, id: "new" }] };
    expect(diffData(base, added).unsupported).toEqual(["notifications"]);
    const removed = { ...base, notifications: base.notifications.slice(1) };
    expect(diffData(base, removed).unsupported).toEqual(["notifications"]);
    const swapped = {
      ...base,
      notifications: [{ ...n0, id: "other" }, ...base.notifications.slice(1)],
    };
    expect(diffData(base, swapped).unsupported).toEqual(["notifications"]);
    const edited = {
      ...base,
      notifications: [{ ...n0, text: "Changed", read: !n0.read }, ...base.notifications.slice(1)],
    };
    expect(diffData(base, edited)).toEqual({ writes: [], unsupported: ["notifications"] });
    const line = {
      id: "a",
      at: 1,
      who: base.me,
      text: "One",
      ref: null,
      action: null,
      detail: null,
    };
    const logged = { ...base, log: [line] };
    expect(diffData(logged, { ...base, log: [{ ...line, text: "Two" }] }).unsupported).toEqual([
      "log",
    ]);
  });
});

describe("installPersistence", () => {
  it("writes mark all read, then its undo, then its redo", async () => {
    install();
    const unread = data()
      .notifications.filter((n) => !n.read)
      .map((n) => n.id);
    expect(unread.length).toBeGreaterThan(0);
    const reads = (read: boolean) => unread.map((id) => ({ kind: "notification.read", id, read }));
    markAllRead();
    undo();
    redo();
    await flush();
    expect(sent(bridge.calls)).toEqual([reads(true), reads(false), reads(true)]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("writes the notify map on setNotify and on its undo", async () => {
    install();
    setNotify("reply", false);
    undo();
    await flush();
    expect(sent(bridge.calls)).toEqual([
      [{ kind: "notify.set", notify: { reply: false } }],
      [{ kind: "notify.set", notify: {} }],
    ]);
  });

  it("writes your name, and an empty name as unset", async () => {
    install();
    setMyName("  Ada ");
    setMyName("");
    await flush();
    expect(sent(bridge.calls)).toEqual([
      [{ kind: "me.name", name: "Ada" }],
      [{ kind: "me.name", name: "" }],
    ]);
  });

  it("adds the log line an act makes and removes it on undo", async () => {
    install();
    act("Paused replies", (d) => {
      d.settings.notify = { reply: false };
    });
    const line = data().log[0];
    undo();
    await flush();
    expect(line).toBeDefined();
    expect(sent(bridge.calls)).toEqual([
      [
        { kind: "notify.set", notify: { reply: false } },
        {
          kind: "log.add",
          id: line?.id,
          at: now,
          text: "Paused replies",
          ref: null,
          action: null,
          detail: null,
        },
      ],
      [
        { kind: "notify.set", notify: {} },
        { kind: "log.remove", id: line?.id },
      ],
    ]);
  });

  it("confirming an address writes the contact then the stage; undo and redo write them again", async () => {
    install();
    const c0 = data().creators[0];
    const id = c0?.id ?? "";
    appStore().bg((d) => {
      const c = d.creators.find((x) => x.id === id);
      if (c !== undefined) {
        c.stage = "shortlisted";
        c.email = null;
      }
    });
    await flush();
    act(
      "Confirmed an address",
      (d) => {
        const c = d.creators.find((x) => x.id === id);
        if (c !== undefined) {
          c.email = "biz@promptlab.tv";
          c.emailConfirmed = true;
          c.contactName = "Maya";
          c.contactSource = "about";
          c.contactConfidence = 0.95;
          c.stage = "contact";
        }
      },
      { log: false },
    );
    undo();
    redo();
    await flush();
    const who = { id, handle: c0?.handle, name: c0?.name };
    const confirm = {
      kind: "creator.contact",
      ...who,
      email: "biz@promptlab.tv",
      confirmed: true,
      contactName: "Maya",
      source: "about",
      confidence: 0.95,
    };
    const back = {
      kind: "creator.contact",
      ...who,
      email: null,
      confirmed: false,
      contactName: null,
      source: null,
      confidence: null,
    };
    expect(sent(bridge.calls).slice(1)).toEqual([
      [confirm, { kind: "creator.stage", ...who, stage: "contact" }],
      [back, { kind: "creator.stage", ...who, stage: "shortlisted" }],
      [confirm, { kind: "creator.stage", ...who, stage: "contact" }],
    ]);
  });

  it("saves a background change, and undoing an older change does not take it back", async () => {
    install();
    setNotify("money", false);
    readNotification("n1");
    undo();
    await flush();
    expect(sent(bridge.calls)).toEqual([
      [{ kind: "notify.set", notify: { money: false } }],
      [{ kind: "notification.read", id: "n1", read: true }],
      [{ kind: "notify.set", notify: {} }],
    ]);
  });

  it("reports a change it cannot write and sends nothing", async () => {
    install();
    appStore().bg((d) => {
      const first = d.creators[0];
      if (first !== undefined) {
        first.name = "Renamed";
      }
    });
    await flush();
    expect(bridge.calls).toEqual([]);
    expect(errors).toHaveBeenCalledOnce();
    expect(String(errors.mock.calls[0]?.[0])).toContain("creators");
  });

  it("writes nothing for UI changes", async () => {
    install();
    toggleTray("notifications");
    closeTray();
    peek({ kind: "creator", id: "c1" });
    go("find");
    await flush();
    expect(bridge.calls).toEqual([]);
  });

  it("keeps the order: one batch in flight, the next goes when it is answered", async () => {
    install(false);
    setNotify("reply", false);
    setNotify("money", false);
    setMyName("Ada");
    await flush();
    expect(sent(bridge.calls)).toEqual([[{ kind: "notify.set", notify: { reply: false } }]]);
    expect(persistenceIdle()).toBe(false);
    bridge.calls[0]?.answer({ ok: true, value: {} });
    await flush();
    expect(bridge.calls).toHaveLength(2);
    expect(bridge.calls[1]?.writes).toEqual([
      { kind: "notify.set", notify: { reply: false, money: false } },
    ]);
    bridge.calls[1]?.answer({ ok: true, value: {} });
    await flush();
    expect(bridge.calls[2]?.writes).toEqual([{ kind: "me.name", name: "Ada" }]);
    bridge.calls[2]?.answer({ ok: true, value: {} });
    await flush();
    expect(persistenceIdle()).toBe(true);
  });

  it("shows a toast when a batch fails, does not retry it, and sends the next", async () => {
    install(false);
    setNotify("reply", false);
    setMyName("Ada");
    bridge.calls[0]?.answer({ ok: false, reason: "database is locked" });
    await flush();
    expect(ui().toasts.at(-1)).toMatchObject({
      msg: strings.saveFailed.title,
      sub: strings.saveFailed.sub,
    });
    expect(bridge.calls.map((c) => c.writes)).toEqual([
      [{ kind: "notify.set", notify: { reply: false } }],
      [{ kind: "me.name", name: "Ada" }],
    ]);
    bridge.calls[1]?.fail(new Error("bridge gone"));
    await flush();
    expect(ui().toasts.filter((t) => t.msg === strings.saveFailed.title)).toHaveLength(2);
    expect(bridge.calls).toHaveLength(2);
    expect(persistenceIdle()).toBe(true);
  });

  it("sends more than 100 writes as batches of at most 100, in order", async () => {
    install();
    const base = exampleData(now);
    const template = base.notifications[0] as Notification;
    const notifications = Array.from({ length: 250 }, (_, i) => ({
      ...template,
      id: `m${String(i)}`,
      read: false,
    }));
    initAppStore({ ...base, notifications }, today);
    markAllRead();
    await flush();
    expect(bridge.calls.map((c) => c.writes.length)).toEqual([100, 100, 50]);
    expect(
      bridge.calls.flatMap((c) => c.writes.map((w) => w.kind === "notification.read" && w.id)),
    ).toEqual(notifications.map((n) => n.id));
  });

  it("takes a store from initAppStore as saved, and diffs later changes against it", async () => {
    install();
    initAppStore({ ...exampleData(now), myName: "Maya" }, today);
    await flush();
    expect(bridge.calls).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
    setMyName("Ada");
    await flush();
    expect(sent(bridge.calls)).toEqual([[{ kind: "me.name", name: "Ada" }]]);
  });

  it("stops listening when uninstalled", async () => {
    install();
    uninstall();
    setNotify("reply", false);
    await flush();
    expect(bridge.calls).toEqual([]);
  });
});

describe("the save state", () => {
  it("stays on Saving… until the writes are done, when they take longer than 700 ms", async () => {
    install(false);
    markAllRead();
    expect(ui().saving).toBe(true);
    vi.advanceTimersByTime(700);
    await flush();
    expect(ui().saving).toBe(true);
    vi.advanceTimersByTime(500);
    bridge.calls[0]?.answer({ ok: true, value: {} });
    await flush();
    expect(ui().saving).toBe(false);
    expect(ui().savedAt).toBe(now + 1200);
  });

  it("stays on Saving… for 700 ms when the writes are quicker", async () => {
    install(false);
    setMyName("Ada");
    bridge.calls[0]?.answer({ ok: true, value: {} });
    await flush();
    expect(persistenceIdle()).toBe(true);
    expect(ui().saving).toBe(true);
    vi.advanceTimersByTime(699);
    expect(ui().saving).toBe(true);
    vi.advanceTimersByTime(1);
    expect(ui().saving).toBe(false);
    expect(ui().savedAt).toBe(now + 700);
  });

  it("shows a failed save as not saved, keeps savedAt, and a later save clears it", async () => {
    install(false);
    setNotify("reply", false);
    bridge.calls[0]?.answer({ ok: false, reason: "database is locked" });
    await flush();
    vi.advanceTimersByTime(700);
    expect(ui().saving).toBe(false);
    expect(ui().saveFailed).toBe(true);
    expect(ui().savedAt).toBe(now - 40000);
    setNotify("money", false);
    bridge.calls[1]?.answer({ ok: true, value: {} });
    await flush();
    vi.advanceTimersByTime(700);
    expect(ui().saveFailed).toBe(false);
    expect(ui().savedAt).toBe(now + 1400);
  });

  it("tells every idle listener about a failure, then forgets it", async () => {
    install(false);
    setNotify("reply", false);
    const told: boolean[] = [];
    onPersistenceIdle((ok) => told.push(ok));
    onPersistenceIdle((ok) => told.push(ok));
    bridge.calls[0]?.fail(new Error("bridge gone"));
    await flush();
    expect(told).toEqual([false, false]);
    onPersistenceIdle((ok) => told.push(ok));
    expect(told).toEqual([false, false, true]);
  });

  it("waits for the newest change: an older wait does not end it", async () => {
    install(false);
    setNotify("reply", false);
    vi.advanceTimersByTime(700);
    setNotify("money", false);
    bridge.calls[0]?.answer({ ok: true, value: {} });
    await flush();
    expect(ui().saving).toBe(true);
    bridge.calls[1]?.answer({ ok: true, value: {} });
    await flush();
    expect(ui().saving).toBe(true);
    vi.advanceTimersByTime(700);
    expect(ui().saving).toBe(false);
  });
});

describe("today's actions", () => {
  it("make no change the persister cannot write", async () => {
    install();
    markAllRead();
    undo();
    readNotification("n2");
    redo();
    setNotify("reply", false);
    setNotify("money", false);
    setNotify("handoff", false);
    setNotify("search", false);
    undo();
    setMyName("Ada");
    setMyName("");
    act("Logged", (d) => {
      d.settings.notify = {};
    });
    undo();
    redo();
    await flush();
    expect(errors).not.toHaveBeenCalled();
    expect(bridge.calls.length).toBeGreaterThan(0);
  });
});

describe("adoptServerData", () => {
  it("writes nothing for a creator it adds", async () => {
    install();
    adoptServerData((draft) => {
      draft.creators.push({
        id: "UC-adopted",
        name: "Adopted",
        handle: "@adopted",
        stage: "new",
        email: null,
        emailConfirmed: false,
        contactName: null,
        contactSource: null,
        contactConfidence: null,
        rejectReason: null,
        rejectedAt: null,
        neverReason: null,
        archiveDueAt: null,
        kit: null,
      });
    });
    await flush();
    expect(data().creators.some((c) => c.id === "UC-adopted")).toBe(true);
    expect(bridge.calls).toHaveLength(0);
    expect(errors).not.toHaveBeenCalled();
  });

  it("changes the data and the undo steps and writes nothing", async () => {
    install();
    adoptServerData((draft) => {
      draft.log.unshift({
        id: "00000000-0000-4000-8000-0000000000bb",
        at: now,
        who: "x",
        text: "t",
        ref: null,
        action: null,
        detail: null,
      });
    });
    await flush();
    expect(data().log[0]?.text).toBe("t");
    expect(bridge.calls).toHaveLength(0);
    setNotify("reply", false);
    await flush();
    expect(sent(bridge.calls)).toEqual([[{ kind: "notify.set", notify: { reply: false } }]]);
  });
});
