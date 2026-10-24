import {
  exampleFrame,
  type CreatorStage,
  type DataSource,
  type DataWrite,
} from "@gratovo/core/data";
import { emptyFacets, emptyFindFilter } from "@gratovo/core/find";
import {
  channels,
  type AuthStatus,
  type FindState,
  type ImportReport,
  type SyncStatus,
} from "@gratovo/ipc";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { channelId, creatorState, writePipelineDb } from "./find/catalog-fixture";
import { createStubCatalog, type FindCatalog } from "./find/catalog-types";
import { createStubIdeas, type FindIdeas } from "./find/ideas";
import { createHandlers, type HandlerContext } from "./handlers";
import type { SecretStore } from "./secret-store";
import type { HandlerServices } from "./services";
import { createStubServices, emptyConnectionsStatus } from "./stub-services";

function storeWith(names: string[]): SecretStore {
  const fail = () => Promise.reject(new Error("Not used by the handlers"));
  return {
    get: fail,
    set: fail,
    delete: fail,
    has: (name) => Promise.resolve(names.includes(name)),
    names: () => Promise.resolve([...names]),
  };
}

function findWith(overrides: Partial<HandlerContext["find"]> = {}): HandlerContext["find"] {
  return {
    state: () => findState,
    folder: () => null,
    add: () => ({ added: 0, skipped: 0 }),
    remove: () => ({ ok: true }),
    startAt: () => ({ ok: true }),
    setRules: () => undefined,
    start: () => Promise.resolve({ ok: true }),
    stop: () => undefined,
    shutdown: () => Promise.resolve(),
    ...overrides,
  };
}

const findState: FindState = {
  queue: [],
  at: 0,
  rules: {
    countries: ["US"],
    perKeyword: 200,
    sortBy: "upload_date",
    resultsType: "video",
    autoClean: {
      enabled: true,
      minSubscribers: 50_000,
      maxSubscribers: 2_000_000,
      belowMin: "sweep",
      aboveMax: "delay",
      label: "inactive",
    },
    minMedianViews: null,
    minUploads30: null,
    archiveDays: 7,
  },
  run: { state: "ready", found: 0, kept: 0, swept: 0, error: null },
  log: [],
  kept: [],
};

const frame = exampleFrame(Date.UTC(2026, 9, 20));

function sourceWith(overrides: Partial<DataSource> = {}): DataSource {
  return {
    frame: () => Promise.resolve(frame),
    creatorStates: () => Promise.resolve([]),
    creatorNotes: () => Promise.resolve(null),
    logFor: () => Promise.resolve([]),
    logPage: () => Promise.resolve({ lines: [], more: false, people: [] }),
    logSince: () => Promise.resolve(0),
    write: () => Promise.resolve(),
    close: () => undefined,
    readSetting: () => undefined,
    writeSetting: () => undefined,
    seedChannelNames: () => 0,
    ...overrides,
  };
}

const signedIn: AuthStatus = { state: "signed-in", email: "sam@example.com" };
const synced: SyncStatus = { state: "synced", pending: 0, refused: 0, lastSyncedAt: 1_000 };

function accountWith(
  overrides: Partial<HandlerContext["account"]> = {},
  source: DataSource | null = sourceWith(),
): HandlerContext["account"] {
  return {
    status: () => signedIn,
    source: () => source,
    signIn: () => Promise.resolve({ ok: true, state: "signed-in" }),
    recheck: () => Promise.resolve(signedIn),
    signOut: () => Promise.resolve(),
    syncStatus: () => synced,
    syncNow: () => Promise.resolve(synced),
    setPresence: () => undefined,
    ...overrides,
  };
}

function handlersWith(
  account: HandlerContext["account"],
  names: string[] = [],
  find: HandlerContext["find"] = findWith(),
  services: Partial<HandlerServices> = {},
  catalog: FindCatalog = createStubCatalog(),
  onCreatorsWritten?: () => void,
) {
  return createHandlers({
    version: "1.2.3",
    secrets: storeWith(names),
    account,
    find,
    catalog,
    ideas: createStubIdeas(),
    ...(onCreatorsWritten === undefined ? {} : { onCreatorsWritten }),
    ...createStubServices(),
    ...services,
  });
}

describe("createHandlers", () => {
  const handlers = handlersWith(accountWith(), ["gemini.api-key"]);

  it("loads the frame from the account's source", async () => {
    expect(await handlers["frame:load"]({})).toEqual(frame);
  });

  it("passes a batch of writes to the account's source in order and answers with {}", async () => {
    const write = vi.fn<DataSource["write"]>(() => Promise.resolve());
    const mine = handlersWith(accountWith({}, sourceWith({ write })));
    const writes: DataWrite[] = [
      { kind: "notification.read", id: "n1", read: true },
      { kind: "me.name", name: "Sam" },
    ];
    expect(await mine["data:write"]({ writes })).toEqual({});
    expect(write).toHaveBeenCalledWith(writes);
  });

  it("lets a failed write reject", async () => {
    const mine = handlersWith(
      accountWith({}, sourceWith({ write: () => Promise.reject(new Error("disk full")) })),
    );
    await expect(
      mine["data:write"]({ writes: [{ kind: "log.remove", id: "l1" }] }),
    ).rejects.toThrow("disk full");
  });

  it("refuses frame:load and data:write while no source is open", async () => {
    const mine = handlersWith(
      accountWith({ status: () => ({ state: "waiting", email: null }) }, null),
    );
    await expect(Promise.resolve().then(() => mine["frame:load"]({}))).rejects.toThrow(
      "No data is open",
    );
    await expect(
      mine["data:write"]({ writes: [{ kind: "log.remove", id: "l1" }] }),
    ).rejects.toThrow("No data is open");
  });

  it("answers a ping with the app's version", async () => {
    expect(await handlers["app:ping"]({})).toEqual({ ok: true, version: "1.2.3" });
  });

  it("says whether a secret is set without reading it", async () => {
    expect(await handlers["secrets:status"]({ name: "gemini.api-key" })).toEqual({ set: true });
    expect(await handlers["secrets:status"]({ name: "gmail.token.mailbox-1" })).toEqual({
      set: false,
    });
  });
});

describe("the auth handlers", () => {
  it("pass status, sign-in, recheck and sign-out to the account", async () => {
    const signIn = vi.fn<HandlerContext["account"]["signIn"]>(() =>
      Promise.resolve({ ok: false, problem: "invalid" }),
    );
    const recheck = vi.fn(() => Promise.resolve<AuthStatus>({ state: "waiting", email: null }));
    const signOut = vi.fn(() => Promise.resolve());
    const mine = handlersWith(accountWith({ signIn, recheck, signOut }));

    expect(await mine["auth:status"]({})).toEqual(signedIn);
    expect(await mine["auth:sign-in"]({ email: "sam@example.com", password: "pw-000" })).toEqual({
      ok: false,
      problem: "invalid",
    });
    expect(signIn).toHaveBeenCalledWith("sam@example.com", "pw-000");
    expect(await mine["auth:recheck"]({})).toEqual({ state: "waiting", email: null });
    expect(recheck).toHaveBeenCalledOnce();
    expect(await mine["auth:sign-out"]({})).toEqual({});
    expect(signOut).toHaveBeenCalledOnce();
  });
});

describe("the sync handlers", () => {
  it("answer the account's sync state, and run a pass on sync:now", async () => {
    const waiting: SyncStatus = { state: "offline", pending: 3, refused: 1, lastSyncedAt: null };
    const syncNow = vi.fn(() => Promise.resolve(synced));
    const mine = handlersWith(accountWith({ syncStatus: () => waiting, syncNow }));

    expect(await mine["sync:status"]({})).toEqual(waiting);
    expect(syncNow).not.toHaveBeenCalled();
    expect(await mine["sync:now"]({})).toEqual(synced);
    expect(syncNow).toHaveBeenCalledOnce();
  });

  it("pass presence:set to the account and answer {}", async () => {
    const setPresence = vi.fn<HandlerContext["account"]["setPresence"]>();
    const mine = handlersWith(accountWith({ setPresence }));
    expect(await mine["presence:set"]({ screen: "reach", idle: false })).toEqual({});
    expect(await mine["presence:set"]({ screen: "record", idle: true })).toEqual({});
    expect(setPresence.mock.calls).toEqual([
      [{ screen: "reach", idle: false }],
      [{ screen: "record", idle: true }],
    ]);
  });
});

describe("the find handlers", () => {
  it("pass each channel to the find service", async () => {
    const add = vi.fn<HandlerContext["find"]["add"]>(() => ({ added: 1, skipped: 0 }));
    const remove = vi.fn<HandlerContext["find"]["remove"]>(() => ({
      ok: false,
      problem: "running",
    }));
    const startAt = vi.fn<HandlerContext["find"]["startAt"]>(() => ({ ok: true }));
    const start = vi.fn<HandlerContext["find"]["start"]>(() =>
      Promise.resolve({ ok: false, problem: "no_keywords" }),
    );
    const stop = vi.fn<HandlerContext["find"]["stop"]>();
    const mine = handlersWith(accountWith(), [], findWith({ add, remove, startAt, start, stop }));

    expect(await mine["find:state"]({})).toEqual(findState);
    expect(await mine["find:add"]({ keywords: ["ai agents"] })).toEqual({ added: 1, skipped: 0 });
    expect(add).toHaveBeenCalledWith(["ai agents"]);
    expect(await mine["find:remove"]({ index: 2 })).toEqual({ ok: false, problem: "running" });
    expect(remove).toHaveBeenCalledWith(2);
    expect(await mine["find:start-at"]({ index: 1 })).toEqual({ ok: true });
    expect(startAt).toHaveBeenCalledWith(1);
    expect(await mine["find:start"]({})).toEqual({ ok: false, problem: "no_keywords" });
    expect(await mine["find:stop"]({})).toEqual({});
    expect(stop).toHaveBeenCalledOnce();
  });

  it("ends a running search before signing out", async () => {
    const order: string[] = [];
    const mine = handlersWith(
      accountWith({
        signOut: () => {
          order.push("sign-out");
          return Promise.resolve();
        },
      }),
      [],
      findWith({
        shutdown: () => {
          order.push("shutdown");
          return Promise.resolve();
        },
      }),
    );
    await mine["auth:sign-out"]({});
    expect(order).toEqual(["shutdown", "sign-out"]);
  });
});

describe("the toolbox handlers", () => {
  const rejected = channelId("rejected");
  const gone = channelId("gone");

  function toolbox() {
    const folder = mkdtempSync(join(tmpdir(), "handlers-toolbox-"));
    writePipelineDb(join(folder, "pipeline.db"), {
      archive: [{ id: gone, at: "2026-10-02 00:00:00", handle: "@gone_ai", label: "rejected" }],
    });
    // Only the fields the Toolbox reads; the real rows come from the catalog.
    const row = (id: string, name: string, archivedAt: number | null) =>
      ({ id, name, stage: "rejected", archivedAt, archiveDueAt: 1, rejectedAt: 1 }) as never;
    const catalog: FindCatalog = {
      ...createStubCatalog(),
      snapshot: () =>
        Promise.resolve({ version: 4, rows: [row(rejected, "R", null), row(gone, "G", 2)] }),
    };
    const source = sourceWith({
      creatorStates: () =>
        Promise.resolve([creatorState(gone, { name: "Gone AI", stage: "rejected" })]),
    });
    const mine = handlersWith(
      accountWith({}, source),
      [],
      findWith({ folder: () => folder }),
      {},
      catalog,
    );
    return { folder, mine };
  }

  it("lists the countdown with the owner's archive days, and counts", async () => {
    const { folder, mine } = toolbox();
    try {
      const page = await mine["toolbox:list"]({ list: "archive", offset: 0, limit: 10 });
      expect(page).toMatchObject({ version: 4, total: 1 });
      expect(page.items[0]).toMatchObject({ id: rejected, dueAt: 1 });
      expect(await mine["toolbox:counts"]({})).toEqual({
        archive: 1,
        never: 0,
        archived: 1,
        logToday: 0,
      });
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it("reads the archived channels with the app's name and stage", async () => {
    const { folder, mine } = toolbox();
    try {
      const page = await mine["toolbox:archived"]({ q: "gone ai", offset: 0, limit: 10 });
      expect(page.total).toBe(1);
      expect(page.items[0]).toMatchObject({ id: gone, name: "Gone AI", stage: "rejected" });
      expect(channels["toolbox:archived"].response.safeParse(page).success).toBe(true);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it("answers empty with no data folder", async () => {
    const mine = handlersWith(accountWith());
    expect(await mine["toolbox:archived"]({ q: "", offset: 0, limit: 10 })).toEqual({
      total: 0,
      items: [],
    });
  });

  function withArchive(archive: HandlerContext["archive"]) {
    return createHandlers({
      version: "1.2.3",
      secrets: storeWith([]),
      account: accountWith(),
      find: findWith(),
      catalog: createStubCatalog(),
      ideas: createStubIdeas(),
      ...(archive === undefined ? {} : { archive }),
      ...createStubServices(),
    });
  }

  it("starts a sweep and answers at once, without waiting for it", async () => {
    const sweep = vi.fn();
    const restore = vi.fn(() => new Promise<never>(() => undefined));
    const mine = withArchive({ sweep, restore });
    expect(await mine["toolbox:sweep"]({})).toEqual({});
    expect(sweep).toHaveBeenCalledTimes(1);
  });

  it("hands Bring back to the archive service and answers with its result", async () => {
    const restore = vi.fn(() => Promise.resolve({ ok: true as const, restored: 1, refetch: true }));
    const mine = withArchive({ sweep: vi.fn(), restore });
    const answer = await mine["toolbox:restore"]({ ids: [gone] });
    expect(answer).toEqual({ ok: true, restored: 1, refetch: true });
    expect(restore).toHaveBeenCalledWith([gone]);
    expect(channels["toolbox:restore"].response.safeParse(answer).success).toBe(true);
  });

  it("answers no_python for Bring back without the archive service", async () => {
    const mine = withArchive(undefined);
    expect(await mine["toolbox:restore"]({ ids: [gone] })).toEqual({
      ok: false,
      problem: "no_python",
    });
    expect(await mine["toolbox:sweep"]({})).toEqual({});
  });
});

describe("the find catalog handlers", () => {
  it("answer empty from the stub catalog, and each answer fits its channel", async () => {
    const mine = handlersWith(accountWith());
    const query = await mine["find:query"]({
      filter: emptyFindFilter,
      sort: "triage",
      offset: 0,
      limit: 120,
    });
    expect(query).toEqual({ version: 0, total: 0, items: [], facets: emptyFacets });
    expect(channels["find:query"].response.safeParse(query).success).toBe(true);
    expect(await mine["find:item"]({ id: "UCaaaaaaaaaaaaaaaaaaaaaa" })).toEqual({ item: null });
    expect(await mine["find:runs"]({})).toEqual({ runs: [] });
  });

  it("pass the request to the catalog", async () => {
    const stub = createStubCatalog();
    const query = vi.fn<FindCatalog["query"]>((r) => stub.query(r));
    const item = vi.fn<FindCatalog["item"]>((id) => stub.item(id));
    const mine = handlersWith(accountWith(), [], findWith(), {}, { ...stub, query, item });
    const request = { filter: emptyFindFilter, sort: "fit" as const, offset: 120, limit: 60 };
    await mine["find:query"](request);
    expect(query).toHaveBeenCalledWith(request);
    // A page that hides the facets asks for none, and the catalog hears it.
    await mine["find:query"]({ ...request, facets: false });
    expect(query).toHaveBeenLastCalledWith({ ...request, facets: false });
    await mine["find:item"]({ id: "UCbbbbbbbbbbbbbbbbbbbbbb" });
    expect(item).toHaveBeenCalledWith("UCbbbbbbbbbbbbbbbbbbbbbb");
  });
});

describe("keyword ideas", () => {
  it("answer bridge_off from the stub, in the channel's shape", async () => {
    const mine = handlersWith(accountWith());
    const answer = await mine["find:ideas"]({ count: 8 });
    expect(answer).toEqual({ ok: false, problem: "bridge_off" });
    expect(channels["find:ideas"].response.safeParse(answer).success).toBe(true);
  });

  it("pass the count to the ideas service", async () => {
    const suggest = vi.fn<FindIdeas["suggest"]>(() =>
      Promise.resolve({ ok: true, keywords: ["claude code tutorial"], dropped: 0 }),
    );
    const mine = createHandlers({
      version: "1.2.3",
      secrets: storeWith([]),
      account: accountWith(),
      find: findWith(),
      catalog: createStubCatalog(),
      ideas: { suggest },
      ...createStubServices(),
    });
    expect(await mine["find:ideas"]({ count: 3 })).toEqual({
      ok: true,
      keywords: ["claude code tutorial"],
      dropped: 0,
    });
    expect(suggest).toHaveBeenCalledWith(3);
  });
});

describe("data:write and the catalog", () => {
  const stage: DataWrite = {
    kind: "creator.stage",
    id: "UCaaaaaaaaaaaaaaaaaaaaaa",
    stage: "shortlisted",
    handle: "@a",
    name: "A",
  };
  const logLine = (ref: string | null): DataWrite => ({
    kind: "log.add",
    id: "l1",
    at: 1,
    text: "x",
    ref,
    action: null,
    detail: null,
  });

  async function written(writes: DataWrite[]): Promise<number> {
    const changed = vi.fn();
    const mine = handlersWith(accountWith(), [], findWith(), {}, createStubCatalog(), changed);
    await mine["data:write"]({ writes });
    return changed.mock.calls.length;
  }

  it("tells the catalog after a stage change or a log line with a ref", async () => {
    expect(await written([stage])).toBe(1);
    expect(await written([logLine("UCaaaaaaaaaaaaaaaaaaaaaa")])).toBe(1);
    expect(await written([{ kind: "log.remove", id: "l1" }])).toBe(1);
  });

  it("tells the catalog after a contact change", async () => {
    expect(
      await written([
        {
          kind: "creator.contact",
          id: "UCaaaaaaaaaaaaaaaaaaaaaa",
          email: "biz@agentlab.ai",
          confirmed: true,
          contactName: null,
          source: "about",
          confidence: 0.95,
          handle: "@a",
          name: "A",
        },
      ]),
    ).toBe(1);
  });

  it("tells the catalog after a conflict is settled, keeping yours or theirs", async () => {
    expect(await written([{ kind: "conflict.resolve", id: "k1", choice: "mine" }])).toBe(1);
    expect(await written([{ kind: "conflict.resolve", id: "k1", choice: "theirs" }])).toBe(1);
  });

  it("leaves the catalog alone after a creator's notes change: the detail reads them fresh", async () => {
    expect(
      await written([
        {
          kind: "creator.notes",
          id: "UCaaaaaaaaaaaaaaaaaaaaaa",
          base: "",
          notes: "Hi",
          handle: "",
          name: "",
        },
      ]),
    ).toBe(0);
  });

  it("stays quiet for writes the catalog does not show", async () => {
    expect(await written([logLine(null)])).toBe(0);
    expect(await written([{ kind: "me.name", name: "Sam" }])).toBe(0);
  });
});

describe("data:write and the email finder (plan D30)", () => {
  const moved = (id: string, to: "shortlisted" | "rejected" | "new"): DataWrite => ({
    kind: "creator.stage",
    id,
    stage: to,
    handle: `@${id}`,
    name: id,
  });

  function withFinder(
    write: DataSource["write"] = () => Promise.resolve(),
    stages: Readonly<Record<string, CreatorStage>> = {},
  ) {
    const onShortlisted = vi.fn<(ids: readonly string[]) => void>();
    const creatorStates = () =>
      Promise.resolve(
        Object.entries(stages).map(([id, stage]) => ({
          id,
          handle: `@${id}`,
          name: id,
          stage,
          email: null,
          emailConfirmed: false,
          contactName: null,
          rejectReason: null,
          rejectedAt: null,
          neverReason: null,
          archiveDueAt: null,
          engagement: null,
          legacyPipelineStage: "",
          hasAppStage: true,
          lastActivity: null,
        })),
      );
    const mine = createHandlers({
      version: "1.2.3",
      secrets: storeWith([]),
      account: accountWith({}, sourceWith({ write, creatorStates })),
      find: findWith(),
      catalog: createStubCatalog(),
      ideas: createStubIdeas(),
      onShortlisted,
      ...createStubServices(),
    });
    return { mine, onShortlisted };
  }

  it("hands over the creators a stored batch moved to shortlisted, and only those", async () => {
    const { mine, onShortlisted } = withFinder();
    await mine["data:write"]({
      writes: [
        moved("UCaaaaaaaaaaaaaaaaaaaaaa", "shortlisted"),
        moved("UCbbbbbbbbbbbbbbbbbbbbbb", "rejected"),
        { kind: "me.name", name: "Sam" },
        moved("UCcccccccccccccccccccccc", "shortlisted"),
      ],
    });
    expect(onShortlisted).toHaveBeenCalledExactlyOnceWith([
      "UCaaaaaaaaaaaaaaaaaaaaaa",
      "UCcccccccccccccccccccccc",
    ]);
  });

  it("looks up only creators coming from new or rejected, not an undone confirm", async () => {
    const { mine, onShortlisted } = withFinder(() => Promise.resolve(), {
      UCaaaaaaaaaaaaaaaaaaaaaa: "new",
      UCbbbbbbbbbbbbbbbbbbbbbb: "contact",
      UCcccccccccccccccccccccc: "rejected",
      UCdddddddddddddddddddddd: "shortlisted",
    });
    await mine["data:write"]({
      writes: [
        moved("UCaaaaaaaaaaaaaaaaaaaaaa", "shortlisted"),
        moved("UCbbbbbbbbbbbbbbbbbbbbbb", "shortlisted"),
        moved("UCcccccccccccccccccccccc", "shortlisted"),
        moved("UCdddddddddddddddddddddd", "shortlisted"),
        // No row yet: a creator the search found and nobody has touched.
        moved("UCeeeeeeeeeeeeeeeeeeeeee", "shortlisted"),
      ],
    });
    expect(onShortlisted).toHaveBeenCalledExactlyOnceWith([
      "UCaaaaaaaaaaaaaaaaaaaaaa",
      "UCcccccccccccccccccccccc",
      "UCeeeeeeeeeeeeeeeeeeeeee",
    ]);
    // Undoing a Confirm all (contact back to shortlisted) spends no quota.
    const undo = withFinder(() => Promise.resolve(), { UCbbbbbbbbbbbbbbbbbbbbbb: "contact" });
    await undo.mine["data:write"]({ writes: [moved("UCbbbbbbbbbbbbbbbbbbbbbb", "shortlisted")] });
    expect(undo.onShortlisted).not.toHaveBeenCalled();
  });

  it("stays quiet for a batch with no shortlist, and after a write that failed", async () => {
    const { mine, onShortlisted } = withFinder();
    await mine["data:write"]({ writes: [moved("UCaaaaaaaaaaaaaaaaaaaaaa", "new")] });
    expect(onShortlisted).not.toHaveBeenCalled();
    const failing = withFinder(() => Promise.reject(new Error("disk full")));
    await expect(
      failing.mine["data:write"]({ writes: [moved("UCaaaaaaaaaaaaaaaaaaaaaa", "shortlisted")] }),
    ).rejects.toThrow("disk full");
    expect(failing.onShortlisted).not.toHaveBeenCalled();
  });
});

describe("saved views and a creator's lines", () => {
  const view = { name: "Gold mines in the US", filter: { ...emptyFindFilter, countries: ["US"] } };

  /** A source whose `local_settings` is a map, so a write can be read back. */
  function settingsSource(stored: Record<string, unknown> = {}) {
    const settings = new Map(Object.entries(stored));
    const writeSetting = vi.fn((key: string, value: unknown) => {
      settings.set(key, value);
    });
    const source = sourceWith({ readSetting: (key) => settings.get(key), writeSetting });
    return { handlers: handlersWith(accountWith({}, source)), writeSetting, settings };
  }

  it("answer no views when none are stored, then the ones saved", async () => {
    const { handlers: mine, settings } = settingsSource();
    expect(await mine["find:views"]({})).toEqual({ views: [] });
    expect(await mine["find:views-set"]({ views: [view] })).toEqual({ ok: true });
    expect(settings.get("find.views")).toEqual([view]);
    const answer = await mine["find:views"]({});
    expect(answer).toEqual({ views: [view] });
    expect(channels["find:views"].response.safeParse(answer).success).toBe(true);
    // An empty list clears them.
    expect(await mine["find:views-set"]({ views: [] })).toEqual({ ok: true });
    expect(await mine["find:views"]({})).toEqual({ views: [] });
  });

  it("refuse more than 20 views and store nothing", async () => {
    const { handlers: mine, writeSetting, settings } = settingsSource({ "find.views": [view] });
    const many = Array.from({ length: 21 }, (_, i) => ({ ...view, name: `View ${String(i)}` }));
    expect(await mine["find:views-set"]({ views: many })).toEqual({
      ok: false,
      problem: "too_many",
    });
    expect(writeSetting).not.toHaveBeenCalled();
    expect(settings.get("find.views")).toEqual([view]);
    expect(await mine["find:views-set"]({ views: many.slice(0, 20) })).toEqual({ ok: true });
  });

  it("read a stored value that isn't a list as none, and leave it until the next save", async () => {
    for (const bad of ["Gold mines", { views: [view] }, null, 12]) {
      const { handlers: mine, writeSetting, settings } = settingsSource({ "find.views": bad });
      expect(await mine["find:views"]({})).toEqual({ views: [] });
      expect(writeSetting).not.toHaveBeenCalled();
      expect(settings.get("find.views")).toEqual(bad);
    }
  });

  it("keep the good views in a stored list and drop only the ones that fail", async () => {
    const news = { name: "AI news weekly", filter: emptyFindFilter };
    const stored = [
      view,
      { name: "", filter: emptyFindFilter },
      { name: "AI news", filter: { stages: ["won"] } },
      "Gold mines",
      news,
    ];
    const { handlers: mine, writeSetting, settings } = settingsSource({ "find.views": stored });
    expect(await mine["find:views"]({})).toEqual({ views: [view, news] });
    expect(writeSetting).not.toHaveBeenCalled();
    expect(settings.get("find.views")).toEqual(stored);
    // More than the answer holds keeps the first 20.
    const many = Array.from({ length: 21 }, (_, i) => ({ ...view, name: `View ${String(i)}` }));
    const { handlers: full } = settingsSource({ "find.views": many });
    const answer = await full["find:views"]({});
    expect(answer).toEqual({ views: many.slice(0, 20) });
    expect(channels["find:views"].response.safeParse(answer).success).toBe(true);
  });

  it("pass log:for to the open source and answer its lines", async () => {
    const line = {
      id: "l1",
      at: 1,
      who: "u1",
      text: "Shortlisted Agent Lab",
      ref: "UCaaaaaaaaaaaaaaaaaaaaaa",
      action: "creator.shortlist" as const,
      detail: null,
    };
    const logFor = vi.fn<DataSource["logFor"]>(() => Promise.resolve([line]));
    const mine = handlersWith(accountWith({}, sourceWith({ logFor })));
    const answer = await mine["log:for"]({ ref: "UCaaaaaaaaaaaaaaaaaaaaaa", limit: 30 });
    expect(answer).toEqual({ lines: [line] });
    expect(logFor).toHaveBeenCalledWith("UCaaaaaaaaaaaaaaaaaaaaaa", 30);
    expect(channels["log:for"].response.safeParse(answer).success).toBe(true);
  });

  it("refuse the views and the lines while no source is open", async () => {
    const mine = handlersWith(accountWith({}, null));
    expect(() => mine["find:views"]({})).toThrow();
    expect(() => mine["find:views-set"]({ views: [] })).toThrow();
    await expect(mine["log:for"]({ ref: "UC1", limit: 10 })).rejects.toThrow();
  });
});

describe("the step 4 handlers", () => {
  const report: ImportReport = {
    source: "C:/old/gratovo.db",
    tables: [{ name: "channels", inOld: 10, toAdd: 4, already: 6 }],
    skipped: [{ name: "creators", rows: 3, why: "synced" }],
    unsent: { outbox: 0, activity: 1 },
    settingsFiles: [{ name: "run_config.json", found: true }],
    dryRun: true,
    backup: null,
  };

  it("pass the import channels to the importer", async () => {
    const dryRun = vi.fn<HandlerServices["importer"]["dryRun"]>(() =>
      Promise.resolve({ ok: true, report }),
    );
    const run = vi.fn<HandlerServices["importer"]["run"]>(() =>
      Promise.resolve({ ok: false, reason: "running" }),
    );
    const importer = { ...createStubServices().importer, dryRun, run };
    const mine = handlersWith(accountWith(), [], findWith(), { importer });

    expect(await mine["import:candidates"]({})).toEqual({ candidates: [] });
    expect(await mine["import:pick"]({})).toEqual({ path: null });
    expect(await mine["import:dry-run"]({ path: "C:/old/gratovo.db" })).toEqual({
      ok: true,
      report,
    });
    expect(dryRun).toHaveBeenCalledWith("C:/old/gratovo.db");
    expect(await mine["import:run"]({ path: "C:/old/gratovo.db", useOldRules: true })).toEqual({
      ok: false,
      reason: "running",
    });
    expect(run).toHaveBeenCalledWith("C:/old/gratovo.db", true);
  });

  it("pass rules:set to the find service", async () => {
    const setRules = vi.fn<HandlerContext["find"]["setRules"]>();
    const mine = handlersWith(accountWith(), [], findWith({ setRules }));
    const rules = { ...findState.rules, minMedianViews: 5000, archiveDays: 30 };
    expect(await mine["rules:set"]({ rules })).toEqual({});
    expect(setRules).toHaveBeenCalledWith(rules);
  });

  it("pass the connections channels to the connections service", async () => {
    const stub = createStubServices().connections;
    const connections = {
      status: vi.fn(() => stub.status()),
      set: vi.fn<HandlerServices["connections"]["set"]>(() => Promise.resolve({ ok: true })),
      pickFolder: vi.fn<HandlerServices["connections"]["pickFolder"]>(() =>
        Promise.resolve({ path: "D:/course" }),
      ),
      checkMailboxes: vi.fn(() => stub.checkMailboxes()),
      deployGateways: vi.fn<HandlerServices["connections"]["deployGateways"]>((regions) =>
        stub.deployGateways(regions),
      ),
      removeGateways: vi.fn<HandlerServices["connections"]["removeGateways"]>((region) =>
        stub.removeGateways(region),
      ),
    };
    const mine = handlersWith(accountWith(), [], findWith(), { connections });

    expect(await mine["connections:status"]({})).toEqual(emptyConnectionsStatus());
    const change = { kind: "course" as const, courseDir: "D:/course", videoDir: null };
    expect(await mine["connections:set"](change)).toEqual({ ok: true });
    expect(connections.set).toHaveBeenCalledWith(change);
    expect(await mine["connections:pick-folder"]({ purpose: "videos" })).toEqual({
      path: "D:/course",
    });
    expect(connections.pickFolder).toHaveBeenCalledWith("videos");
    expect(await mine["mail:check"]({})).toEqual({ ok: false, reason: "not_built" });
    expect(connections.checkMailboxes).toHaveBeenCalledOnce();
    await mine["gateways:deploy"]({ regions: ["us-east-1", "eu-west-2"] });
    expect(connections.deployGateways).toHaveBeenCalledWith(["us-east-1", "eu-west-2"]);
    await mine["gateways:remove"]({ region: "us-east-1" });
    expect(connections.removeGateways).toHaveBeenCalledWith("us-east-1");
  });

  it("pass the Gemini, writing-rules and mail-consent channels to their services", async () => {
    const stubs = createStubServices();
    const gemini = {
      ...stubs.gemini,
      start: vi.fn(() => stubs.gemini.start()),
      stop: vi.fn(() => stubs.gemini.stop()),
      openWindow: vi.fn<HandlerServices["gemini"]["openWindow"]>((browser) =>
        stubs.gemini.openWindow(browser),
      ),
    };
    const writingRules = { list: vi.fn(() => stubs.writingRules.list()) };
    const mailConsent = {
      connect: vi.fn<HandlerServices["mailConsent"]["connect"]>(() =>
        Promise.resolve({ ok: true, address: "sam@example.com" }),
      ),
    };
    const mine = handlersWith(accountWith(), [], findWith(), {
      gemini,
      writingRules,
      mailConsent,
    });

    expect((await mine["gemini:start"]({})).state).toBe("stopped");
    expect(gemini.start).toHaveBeenCalledOnce();
    await mine["gemini:stop"]({});
    expect(gemini.stop).toHaveBeenCalledOnce();
    await mine["gemini:open-window"]({ browser: "firefox" });
    expect(gemini.openWindow).toHaveBeenCalledWith("firefox");
    expect(await mine["writing:rules"]({})).toEqual({ found: false, rules: [] });
    expect(writingRules.list).toHaveBeenCalledOnce();
    expect(await mine["mail:connect"]({})).toEqual({ ok: true, address: "sam@example.com" });
    expect(mailConsent.connect).toHaveBeenCalledOnce();
  });
});

describe("the stub services", () => {
  it("answer every step 4 channel with a value its contract accepts", async () => {
    const mine = handlersWith(accountWith());
    const calls = {
      "import:candidates": {},
      "import:pick": {},
      "import:dry-run": { path: "C:/old/gratovo.db" },
      "import:run": { path: "C:/old/gratovo.db", useOldRules: false },
      "writing:rules": {},
      "connections:status": {},
      "connections:set": { kind: "gateways.enabled", enabled: true },
      "connections:pick-folder": { purpose: "course" },
      "mail:connect": {},
      "mail:check": {},
      "gateways:deploy": { regions: ["us-east-1"] },
      "gateways:remove": { region: "us-east-1" },
      "gemini:start": {},
      "gemini:stop": {},
      "gemini:open-window": { browser: null },
    } as const;
    for (const [name, input] of Object.entries(calls) as [keyof typeof calls, unknown][]) {
      // Each handler takes its own channel's parsed request; the loop can't name that type.
      const handler = mine[name] as (request: unknown) => unknown;
      const answer = await handler(channels[name].request.parse(input));
      expect(channels[name].response.safeParse(answer).success, name).toBe(true);
    }
  });
});
