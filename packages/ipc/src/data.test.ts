import { DEAL_FLOW } from "@gratovo/core";
import { creatorStages, exampleFrame, nameMax, type DataWrite } from "@gratovo/core/data";
import { emptyFacets } from "@gratovo/core/find";
import { describe, expect, it, vi } from "vitest";

import { channels } from "./channels";
import { dataWriteSchema, frameSchema } from "./data";
import { createDispatcher, type Handlers } from "./dispatch";

const frame = exampleFrame(Date.UTC(2026, 9, 20));

const gemini = {
  state: "stopped" as const,
  addon: { state: "missing" as const, version: null },
  browser: null,
  problem: null,
};

const connectionsStatus = {
  python: { state: "ready" as const },
  youtube: { state: "available" as const },
  gemini,
  mailApp: { set: false },
  mailboxes: [],
  mail: { label: "Gratovo", senderName: null },
  proxies: { count: 0, enabled: false, includeDirect: true },
  pacing: "normal" as const,
  parallel: { enabled: false, maxWorkers: 1 },
  aws: { keys: false, enabled: false, regions: [] },
  course: { courseDir: null, videoDir: null, courseFound: false },
  sync: { state: "off" as const },
  import: { state: "never" as const, at: null, backup: null },
};

describe("frameSchema", () => {
  it("accepts the example frame", () => {
    expect(frameSchema.safeParse(frame).success).toBe(true);
    expect(channels["frame:load"].response.safeParse(frame).success).toBe(true);
  });

  it("refuses a frame with an extra field, at any depth", () => {
    expect(frameSchema.safeParse({ ...frame, extra: 1 }).success).toBe(false);
    const [first, ...rest] = frame.team;
    const team = [{ ...first, token: "x" }, ...rest];
    expect(frameSchema.safeParse({ ...frame, team }).success).toBe(false);
  });

  it("says which data it is: example or live, nothing else", () => {
    expect(frame.source).toBe("example");
    expect(frameSchema.safeParse({ ...frame, source: "live" }).success).toBe(true);
    expect(frameSchema.safeParse({ ...frame, source: "prototype" }).success).toBe(false);
    const unsaid: Record<string, unknown> = { ...frame };
    delete unsaid["source"];
    expect(frameSchema.safeParse(unsaid).success).toBe(false);
  });

  it("refuses a name that is too long", () => {
    expect(frameSchema.safeParse({ ...frame, myName: "x".repeat(nameMax + 1) }).success).toBe(
      false,
    );
    expect(frameSchema.safeParse({ ...frame, myName: "x".repeat(nameMax) }).success).toBe(true);
  });

  it("takes the agency roles, at most five, and refuses an unknown one", () => {
    const [first, ...rest] = frame.team;
    const withRoles = (roles: unknown) => ({ ...frame, team: [{ ...first, roles }, ...rest] });
    expect(frameSchema.safeParse(withRoles([])).success).toBe(true);
    expect(
      frameSchema.safeParse(withRoles(["owner", "scout", "outreach", "deal_lead", "delivery"]))
        .success,
    ).toBe(true);
    expect(frameSchema.safeParse(withRoles(["admin"])).success).toBe(false);
    expect(frameSchema.safeParse(withRoles(["Owner"])).success).toBe(false);
    expect(frameSchema.safeParse(withRoles(Array(6).fill("scout"))).success).toBe(false);
    expect(frameSchema.safeParse(withRoles(undefined)).success).toBe(false);
  });

  it("refuses a member with the old title field", () => {
    const [first, ...rest] = frame.team;
    const team = [{ ...first, title: "Owner" }, ...rest];
    expect(frameSchema.safeParse({ ...frame, team }).success).toBe(false);
  });

  it("takes a hidden (null) price, and refuses a negative one", () => {
    const deals = frame.deals.map((d) => ({ ...d, price: null }));
    expect(frameSchema.safeParse({ ...frame, deals, seesMoney: false }).success).toBe(true);
    const [first, ...rest] = frame.deals;
    expect(
      frameSchema.safeParse({ ...frame, deals: [{ ...first, price: -1 }, ...rest] }).success,
    ).toBe(false);
  });

  it("needs seesMoney as a boolean", () => {
    const without = Object.fromEntries(
      Object.entries(frame).filter(([key]) => key !== "seesMoney"),
    );
    expect(frameSchema.safeParse(without).success).toBe(false);
    expect(frameSchema.safeParse({ ...frame, seesMoney: "yes" }).success).toBe(false);
  });

  it("needs a creator's confirmed flag, reject reason and dates", () => {
    const [first, ...rest] = frame.creators;
    const with_ = (creator: unknown) =>
      frameSchema.safeParse({ ...frame, creators: [creator, ...rest] }).success;
    expect(with_({ ...first, rejectReason: "ai", rejectedAt: 1, archiveDueAt: 2 })).toBe(true);
    expect(with_({ ...first, rejectReason: "spam" })).toBe(false);
    expect(with_({ ...first, emailConfirmed: undefined })).toBe(false);
  });

  it("refuses more than 50 log lines", () => {
    const line = { id: "l", at: 0, who: "a", text: "t" };
    expect(frameSchema.safeParse({ ...frame, log: Array(51).fill(line) }).success).toBe(false);
  });
});

describe("dataWriteSchema", () => {
  const every: DataWrite[] = [
    { kind: "notification.read", id: "n1", read: true },
    { kind: "notify.set", notify: { reply: false, money: true } },
    { kind: "me.name", name: "Sam" },
    { kind: "me.name", name: "" },
    {
      kind: "log.add",
      id: "5f1c0f3e-0000-4000-8000-000000000000",
      at: 1,
      text: "Did a thing",
      ref: null,
      action: null,
      detail: null,
    },
    { kind: "log.remove", id: "l1" },
    { kind: "creator.stage", id: "c1", stage: "emailed", handle: "", name: "" },
    {
      kind: "creator.notes",
      id: "c1",
      base: "",
      notes: "Wants a demo first",
      handle: "",
      name: "",
    },
    {
      kind: "brand.set",
      id: "b1",
      name: "Quill AI",
      sells: "AI writing assistant",
      status: "pitched",
    },
    { kind: "deal.step", id: "d1", step: 0 },
    { kind: "conflict.resolve", id: "x1", choice: "mine" },
  ];

  it("accepts every kind of write", () => {
    for (const write of every) {
      expect(dataWriteSchema.safeParse(write).success).toBe(true);
    }
  });

  it("refuses an unknown kind, an extra field and a name that is too long", () => {
    expect(dataWriteSchema.safeParse({ kind: "creator.delete", id: "c1" }).success).toBe(false);
    expect(dataWriteSchema.safeParse({ kind: "log.remove", id: "l1", x: 1 }).success).toBe(false);
    const name = "x".repeat(nameMax + 1);
    expect(dataWriteSchema.safeParse({ kind: "me.name", name }).success).toBe(false);
  });

  it("refuses an id over 100 characters and text over 500", () => {
    const id = "x".repeat(101);
    expect(dataWriteSchema.safeParse({ kind: "log.remove", id }).success).toBe(false);
    const text = "x".repeat(501);
    expect(dataWriteSchema.safeParse({ kind: "log.add", id: "a", at: 1, text }).success).toBe(
      false,
    );
  });
});

describe("the new write kinds", () => {
  const ok = (w: unknown) => dataWriteSchema.safeParse(w).success;

  it("creator.stage takes every stage and nothing else", () => {
    for (const stage of creatorStages) {
      expect(ok({ kind: "creator.stage", id: "c1", stage, handle: "", name: "" })).toBe(true);
    }
    expect(ok({ kind: "creator.stage", id: "c1", stage: "won", handle: "", name: "" })).toBe(false);
    expect(ok({ kind: "creator.stage", id: "", stage: "new", handle: "", name: "" })).toBe(false);
  });

  it("creator.stage carries the handle and name, and a reject reason from the four", () => {
    const base = { kind: "creator.stage", id: "c1", stage: "rejected", handle: "@a", name: "A" };
    expect(ok({ ...base, reason: "posting" })).toBe(true);
    expect(ok({ ...base, reason: "boring" })).toBe(false);
    expect(ok({ ...base, reason: undefined })).toBe(false);
    expect(ok({ kind: "creator.stage", id: "c1", stage: "rejected" })).toBe(false);
    expect(ok({ ...base, handle: "x".repeat(501) })).toBe(false);
  });

  it("log.add carries what the line did to which creator, bounded", () => {
    const base = { kind: "log.add", id: "l1", at: 1, text: "Rejected Prompt Lab" };
    const line = { ...base, ref: "UC1", action: "creator.reject", detail: "views" };
    expect(ok(line)).toBe(true);
    expect(ok({ ...line, action: "creator.delete" })).toBe(false);
    expect(ok({ ...line, detail: "x".repeat(501) })).toBe(false);
    expect(ok(base)).toBe(false);
  });

  it("creator.notes carries up to 50,000 characters, the text it started from, the handle and the name", () => {
    const base = {
      kind: "creator.notes",
      id: "UC1",
      base: "",
      notes: "",
      handle: "@a",
      name: "A",
    };
    expect(ok(base)).toBe(true);
    expect(ok({ ...base, notes: "x".repeat(50_000) })).toBe(true);
    expect(ok({ ...base, notes: "x".repeat(50_001) })).toBe(false);
    expect(ok({ ...base, base: "x".repeat(50_000) })).toBe(true);
    expect(ok({ ...base, base: "x".repeat(50_001) })).toBe(false);
    expect(ok({ ...base, id: "" })).toBe(false);
    expect(ok({ kind: "creator.notes", id: "UC1", notes: "Hi" })).toBe(false);
    expect(ok({ kind: "creator.notes", id: "UC1", notes: "", handle: "@a", name: "A" })).toBe(
      false,
    );
    expect(ok({ ...base, stage: "new" })).toBe(false);
  });

  it("brand.set bounds the name, what it sells and the status", () => {
    const base = { kind: "brand.set", id: "b1", name: "Quill AI", sells: "", status: "" };
    expect(ok(base)).toBe(true);
    expect(ok({ ...base, name: "" })).toBe(false);
    expect(ok({ ...base, name: "x".repeat(500) })).toBe(true);
    expect(ok({ ...base, name: "x".repeat(501) })).toBe(false);
    expect(ok({ ...base, sells: "x".repeat(500) })).toBe(true);
    expect(ok({ ...base, sells: "x".repeat(501) })).toBe(false);
    expect(ok({ ...base, status: "x".repeat(40) })).toBe(true);
    expect(ok({ ...base, status: "x".repeat(41) })).toBe(false);
    expect(ok({ ...base, extra: 1 })).toBe(false);
  });

  it("deal.step takes a whole step inside DEAL_FLOW", () => {
    const last = DEAL_FLOW.length - 1;
    expect(ok({ kind: "deal.step", id: "d1", step: last })).toBe(true);
    expect(ok({ kind: "deal.step", id: "d1", step: last + 1 })).toBe(false);
    expect(ok({ kind: "deal.step", id: "d1", step: -1 })).toBe(false);
    expect(ok({ kind: "deal.step", id: "d1", step: 1.5 })).toBe(false);
  });

  it("conflict.resolve takes mine or theirs", () => {
    expect(ok({ kind: "conflict.resolve", id: "x1", choice: "theirs" })).toBe(true);
    expect(ok({ kind: "conflict.resolve", id: "x1", choice: "merged" })).toBe(false);
  });
});

describe("frame conflicts", () => {
  const conflict = {
    id: "x1",
    creator: "UC1",
    label: "@aitoolsdaily",
    field: "creator_stage",
    mine: "Emailed",
    theirs: "Replied",
    theirName: "Sara",
  };

  it("accepts up to 100 and refuses 101, an extra field and a missing one", () => {
    const ok = (conflicts: unknown) => frameSchema.safeParse({ ...frame, conflicts }).success;
    expect(ok([])).toBe(true);
    expect(ok(Array(100).fill(conflict))).toBe(true);
    expect(ok(Array(101).fill(conflict))).toBe(false);
    expect(ok([{ ...conflict, extra: 1 }])).toBe(false);
    expect(ok([{ ...conflict, theirName: undefined }])).toBe(false);
  });
});

describe("log:for", () => {
  const line = {
    id: "l1",
    at: 1,
    who: "u1",
    text: "Shortlisted Prompt Lab",
    ref: "UC1",
    action: "creator.shortlist",
    detail: null,
  };

  it("takes a ref and a limit of 1 to 100, and nothing else", () => {
    const request = channels["log:for"].request;
    expect(request.safeParse({ ref: "UC1", limit: 1 }).success).toBe(true);
    expect(request.safeParse({ ref: "UC1", limit: 100 }).success).toBe(true);
    expect(request.safeParse({ ref: "UC1", limit: 0 }).success).toBe(false);
    expect(request.safeParse({ ref: "UC1", limit: 101 }).success).toBe(false);
    expect(request.safeParse({ ref: "UC1", limit: 1.5 }).success).toBe(false);
    expect(request.safeParse({ ref: "", limit: 10 }).success).toBe(false);
    expect(request.safeParse({ ref: "x".repeat(101), limit: 10 }).success).toBe(false);
    expect(request.safeParse({ ref: "UC1" }).success).toBe(false);
    expect(request.safeParse({ ref: "UC1", limit: 10, before: 5 }).success).toBe(false);
  });

  it("answers at most 100 lines in the frame's line shape", () => {
    const response = channels["log:for"].response;
    expect(response.safeParse({ lines: [] }).success).toBe(true);
    expect(response.safeParse({ lines: Array(100).fill(line) }).success).toBe(true);
    expect(response.safeParse({ lines: Array(101).fill(line) }).success).toBe(false);
    expect(response.safeParse({ lines: [{ ...line, ref: undefined }] }).success).toBe(false);
  });
});

describe("data:write request", () => {
  const request = channels["data:write"].request;
  const write = { kind: "log.remove", id: "l1" };

  it("takes 1 to 100 writes", () => {
    expect(request.safeParse({ writes: [] }).success).toBe(false);
    expect(request.safeParse({ writes: [write] }).success).toBe(true);
    expect(request.safeParse({ writes: Array(100).fill(write) }).success).toBe(true);
    expect(request.safeParse({ writes: Array(101).fill(write) }).success).toBe(false);
  });

  it("refuses anything beside writes", () => {
    expect(request.safeParse({ writes: [write], path: "C:/x" }).success).toBe(false);
  });
});

describe("the data channels through the dispatcher", () => {
  function setup(overrides: Partial<Handlers> = {}) {
    const handlers: Handlers = {
      "app:ping": () => ({ ok: true as const, version: "1" }),
      "secrets:status": () => ({ set: false }),
      "frame:load": () => frame,
      "data:write": vi.fn(() => ({})),
      "auth:status": () => ({ state: "unconfigured" as const, email: null }),
      "auth:sign-in": () => ({ ok: true as const, state: "signed-in" as const }),
      "auth:recheck": () => ({ state: "unconfigured" as const, email: null }),
      "auth:sign-out": () => ({}),
      "sync:status": () => ({ state: "off" as const, pending: 0, refused: 0, lastSyncedAt: null }),
      "sync:now": () => ({ state: "off" as const, pending: 0, refused: 0, lastSyncedAt: null }),
      "presence:set": () => ({}),
      "find:state": () => ({
        queue: [],
        at: 0,
        rules: {
          countries: [],
          perKeyword: 200,
          sortBy: "upload_date" as const,
          resultsType: "video" as const,
          autoClean: {
            enabled: true,
            minSubscribers: 50_000,
            maxSubscribers: 2_000_000,
            belowMin: "sweep" as const,
            aboveMax: "delay" as const,
            label: "inactive",
          },
          minMedianViews: null,
          minUploads30: null,
          archiveDays: 7,
        },
        run: { state: "ready" as const, found: 0, kept: 0, swept: 0, error: null },
        log: [],
        kept: [],
      }),
      "find:add": () => ({ added: 0, skipped: 0 }),
      "find:remove": () => ({ ok: true as const }),
      "find:start-at": () => ({ ok: true as const }),
      "find:start": () => ({ ok: true as const }),
      "find:stop": () => ({}),
      "find:query": () => ({ version: 0, total: 0, items: [], facets: emptyFacets }),
      "find:item": () => ({ item: null }),
      "find:runs": () => ({ runs: [] }),
      "find:views": () => ({ views: [] }),
      "find:views-set": () => ({ ok: true as const }),
      "log:for": () => ({ lines: [] }),
      "rules:set": () => ({}),
      "import:candidates": () => ({ candidates: [] }),
      "import:pick": () => ({ path: null }),
      "import:dry-run": () => ({ ok: false as const, reason: "not_built" as const }),
      "import:run": () => ({ ok: false as const, reason: "not_built" as const }),
      "writing:rules": () => ({ found: false, rules: [] }),
      "connections:status": () => connectionsStatus,
      "connections:set": () => ({ ok: true as const }),
      "connections:pick-folder": () => ({ path: null }),
      "mail:connect": () => ({ ok: false as const, reason: "not_built" as const }),
      "mail:check": () => ({ ok: false as const, reason: "not_built" as const }),
      "gateways:deploy": () => ({ ok: false as const, reason: "not_built" as const }),
      "gateways:remove": () => ({ ok: false as const, reason: "not_built" as const }),
      "gemini:start": () => gemini,
      "gemini:stop": () => gemini,
      "gemini:open-window": () => gemini,
      ...overrides,
    };
    const onError = vi.fn();
    return { handlers, onError, dispatch: createDispatcher(handlers, onError) };
  }

  it("returns a valid frame", async () => {
    const { dispatch } = setup();
    expect(await dispatch("frame:load", {})).toEqual({ ok: true, value: frame });
  });

  it("refuses a frame with an extra field before it leaves", async () => {
    const { dispatch, onError } = setup({ "frame:load": () => ({ ...frame, secret: "x" }) });
    expect(await dispatch("frame:load", {})).toEqual({ ok: false, reason: "The call failed" });
    expect(onError).toHaveBeenCalledOnce();
  });

  it("refuses an empty batch and 101 writes without running the handler", async () => {
    const { dispatch, handlers } = setup();
    const write = { kind: "log.remove", id: "l1" };
    expect((await dispatch("data:write", { writes: [] })).ok).toBe(false);
    expect((await dispatch("data:write", { writes: Array(101).fill(write) })).ok).toBe(false);
    expect(handlers["data:write"]).not.toHaveBeenCalled();
    expect(await dispatch("data:write", { writes: [write] })).toEqual({ ok: true, value: {} });
  });
});
