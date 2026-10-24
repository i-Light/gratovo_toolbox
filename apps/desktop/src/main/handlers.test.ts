import { exampleFrame, type DataSource, type DataWrite } from "@gratovo/core/data";
import { emptyFacets, emptyFindFilter } from "@gratovo/core/find";
import {
  channels,
  type AuthStatus,
  type FindState,
  type ImportReport,
  type SyncStatus,
} from "@gratovo/ipc";
import { describe, expect, it, vi } from "vitest";

import { createStubCatalog, type FindCatalog } from "./find/catalog-types";
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
) {
  return createHandlers({
    version: "1.2.3",
    secrets: storeWith(names),
    account,
    find,
    catalog,
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
    await mine["find:item"]({ id: "UCbbbbbbbbbbbbbbbbbbbbbb" });
    expect(item).toHaveBeenCalledWith("UCbbbbbbbbbbbbbbbbbbbbbb");
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
