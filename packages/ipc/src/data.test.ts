import { DEAL_FLOW } from "@gratovo/core";
import { kitView } from "@gratovo/core/close";
import { creatorStages, exampleFrame, nameMax, type DataWrite } from "@gratovo/core/data";
import { emptyFacets } from "@gratovo/core/find";
import { describe, expect, it, vi } from "vitest";

import { channels } from "./channels";
import { creatorSchema, dataWriteSchema, frameSchema } from "./data";
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

  it("needs a creator's contact name, source and confidence, each bounded", () => {
    const [first, ...rest] = frame.creators;
    const with_ = (creator: unknown) =>
      frameSchema.safeParse({ ...frame, creators: [creator, ...rest] }).success;
    const confirmed = {
      ...first,
      emailConfirmed: true,
      contactName: "Maya",
      contactSource: "about",
      contactConfidence: 0.95,
    };
    expect(with_(confirmed)).toBe(true);
    for (const source of ["about", "video", "typed", null]) {
      expect(with_({ ...confirmed, contactSource: source })).toBe(true);
    }
    expect(with_({ ...confirmed, contactSource: "guess" })).toBe(false);
    expect(with_({ ...confirmed, contactName: "x".repeat(80) })).toBe(true);
    expect(with_({ ...confirmed, contactName: "x".repeat(81) })).toBe(false);
    expect(with_({ ...confirmed, contactConfidence: 0 })).toBe(true);
    expect(with_({ ...confirmed, contactConfidence: 1.01 })).toBe(false);
    expect(with_({ ...confirmed, contactConfidence: -0.5 })).toBe(false);
    expect(with_({ ...first, contactName: undefined })).toBe(false);
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
    {
      kind: "creator.contact",
      id: "UC1",
      email: "biz@promptlab.tv",
      confirmed: true,
      contactName: "Maya",
      source: "about",
      confidence: 0.95,
      handle: "@promptlab",
      name: "Prompt Lab",
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

  it("creator.kit takes the audience numbers within their bounds", () => {
    const base = {
      kind: "creator.kit",
      id: "UC1",
      kit: {
        countries: [{ code: "US", share: 52 }],
        ageBand: "25-34",
        engagement: 4.2,
        rate: 1800,
        link: "https://example.com/kit.pdf",
      },
      handle: "@a",
      name: "A",
    };
    const kit = (over: object) => ({ ...base, kit: { ...base.kit, ...over } });
    expect(ok(base)).toBe(true);
    expect(
      ok(kit({ countries: [], ageBand: null, engagement: null, rate: null, link: null })),
    ).toBe(true);
    expect(ok(kit({ countries: [{ code: "US", share: null }] }))).toBe(true);
    const six = Array.from({ length: 6 }, () => ({ code: "US", share: 1 }));
    expect(ok(kit({ countries: six }))).toBe(false);
    expect(ok(kit({ countries: [{ code: "us", share: 1 }] }))).toBe(false);
    expect(ok(kit({ countries: [{ code: "US", share: 101 }] }))).toBe(false);
    expect(ok(kit({ ageBand: "25–34" }))).toBe(false);
    expect(ok(kit({ ageBand: "34-25" }))).toBe(false);
    expect(ok(kit({ ageBand: "25-25" }))).toBe(false);
    expect(ok(kit({ engagement: 101 }))).toBe(false);
    expect(ok(kit({ rate: 0 }))).toBe(false);
    expect(ok(kit({ rate: 12.5 }))).toBe(false);
    expect(ok(kit({ rate: 1_000_001 }))).toBe(false);
    expect(ok(kit({ link: "http://example.com/kit" }))).toBe(false);
    expect(ok(kit({ link: `https://example.com/${"x".repeat(2000)}` }))).toBe(false);
    expect(ok(kit({ fromReply: true }))).toBe(false);
    expect(ok({ ...base, handle: undefined })).toBe(false);
  });

  it("creator.kit takes each field as optional, and nothing else", () => {
    const write = (kit: object) => ({
      kind: "creator.kit",
      id: "UC1",
      kit,
      handle: "@a",
      name: "A",
    });
    expect(ok(write({}))).toBe(true);
    expect(ok(write({ rate: 900 }))).toBe(true);
    expect(ok(write({ rate: null }))).toBe(true);
    expect(ok(write({ countries: [{ code: "UK", share: 1 }] }))).toBe(true);
    expect(ok(write({ extra: 1 }))).toBe(false);
  });

  it("a hostile stored kit still makes a creator the frame accepts", () => {
    const [first] = exampleFrame(Date.now()).creators;
    if (first === undefined) throw new Error("no example creator");
    const kit = kitView(
      {
        countries: [
          { code: "United States", pct: 50 },
          { code: "us", pct: 120 },
          { code: "uk", pct: -5 },
          { code: "ca", pct: Number.NaN },
          { code: { nested: [1] }, pct: 1 },
        ],
        ageBand: ["x"],
        engagement: 250,
        rates: [{ format: "integration", price: 9e99 }],
        link: `https://${"a".repeat(3000)}`,
      },
      { rate: -1, countries: "all", age: {} },
      -5,
    );
    expect(creatorSchema.safeParse({ ...first, kit }).success).toBe(true);
  });

  it("creator.contact takes an address in its shape or none, a name to 80, a source and a confidence", () => {
    const base = {
      kind: "creator.contact",
      id: "UC1",
      email: "biz@promptlab.tv",
      confirmed: true,
      contactName: "Maya",
      source: "about",
      confidence: 0.95,
      handle: "@promptlab",
      name: "Prompt Lab",
    };
    expect(ok(base)).toBe(true);
    // Undo of a first confirm: no address, nothing confirmed, nothing known about it.
    expect(
      ok({
        ...base,
        email: null,
        confirmed: false,
        contactName: null,
        source: null,
        confidence: null,
      }),
    ).toBe(true);
    expect(ok({ ...base, source: "typed", confidence: null })).toBe(true);
    expect(ok({ ...base, source: "video", confidence: 0.6 })).toBe(true);
    for (const email of ["", "promptlab.tv", "biz@promptlab", "biz @promptlab.tv", "a@b@c.tv"]) {
      expect(ok({ ...base, email })).toBe(false);
    }
    expect(ok({ ...base, email: `${"a".repeat(245)}@ai.tools` })).toBe(true);
    expect(ok({ ...base, email: `${"a".repeat(246)}@ai.tools` })).toBe(false);
    expect(ok({ ...base, contactName: "x".repeat(80) })).toBe(true);
    expect(ok({ ...base, contactName: "x".repeat(81) })).toBe(false);
    expect(ok({ ...base, source: "guess" })).toBe(false);
    expect(ok({ ...base, confidence: 1.5 })).toBe(false);
    expect(ok({ ...base, confidence: -0.1 })).toBe(false);
    expect(ok({ ...base, id: "" })).toBe(false);
    expect(ok({ ...base, stage: "contact" })).toBe(false);
    expect(ok({ ...base, handle: undefined })).toBe(false);
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

describe("log:page", () => {
  const line = {
    id: "l1",
    at: 1,
    who: "u1",
    text: "Rejected Prompt Lab",
    ref: "UC1",
    action: "creator.reject",
    detail: "views",
  };
  const request = { before: null, limit: 30, who: null };

  it("takes where to start, a limit of 1 to 100 and one person, and nothing else", () => {
    const parse = (value: unknown) => channels["log:page"].request.safeParse(value).success;
    expect(parse(request)).toBe(true);
    expect(parse({ before: { at: 5, id: "l9" }, limit: 100, who: "u1" })).toBe(true);
    expect(parse({ ...request, limit: 0 })).toBe(false);
    expect(parse({ ...request, limit: 101 })).toBe(false);
    expect(parse({ ...request, who: "x".repeat(101) })).toBe(false);
    expect(parse({ ...request, before: { at: 5 } })).toBe(false);
    expect(parse({ ...request, before: { at: 5, id: "x".repeat(101) } })).toBe(false);
    expect(parse({ ...request, before: { at: 5, id: "l9", extra: 1 } })).toBe(false);
    expect(parse({ ...request, ref: "UC1" })).toBe(false);
  });

  it("answers at most 100 lines and 50 people", () => {
    const parse = (value: unknown) => channels["log:page"].response.safeParse(value).success;
    const person = { who: "u1", name: "Ada", count: 3 };
    const ok = { lines: [line], more: true, people: [person], total: 3 };
    expect(parse(ok)).toBe(true);
    expect(parse({ ...ok, lines: Array(100).fill(line) })).toBe(true);
    expect(parse({ ...ok, lines: Array(101).fill(line) })).toBe(false);
    expect(parse({ ...ok, people: Array(50).fill(person) })).toBe(true);
    expect(parse({ ...ok, people: Array(51).fill(person) })).toBe(false);
    expect(parse({ ...ok, people: [{ ...person, who: "x".repeat(101) }] })).toBe(false);
    expect(parse({ ...ok, people: [{ ...person, count: -1 }] })).toBe(false);
    expect(parse({ ...ok, total: -1 })).toBe(false);
    expect(parse({ ...ok, total: 1.5 })).toBe(false);
    expect(parse({ lines: [line], more: true, people: [person] })).toBe(false);
    expect(parse({ ...ok, extra: 1 })).toBe(false);
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

  it("takes back an odd old address on undo, but never confirms one", () => {
    // The old app stored any text as the email; undoing a confirm writes it back unconfirmed.
    const contact = {
      kind: "creator.contact",
      id: "UC1",
      email: "biz@promptlab.tv,press@promptlab.tv",
      confirmed: false,
      contactName: null,
      source: null,
      confidence: null,
      handle: "@promptlab",
      name: "Prompt Lab",
    };
    const stage = {
      kind: "creator.stage",
      id: "UC1",
      stage: "shortlisted",
      handle: "@promptlab",
      name: "Prompt Lab",
    };
    expect(request.safeParse({ writes: [contact, stage] }).success).toBe(true);
    expect(request.safeParse({ writes: [{ ...contact, email: "hello@promptlab" }] }).success).toBe(
      true,
    );
    expect(request.safeParse({ writes: [{ ...contact, email: "x".repeat(1000) }] }).success).toBe(
      true,
    );
    expect(request.safeParse({ writes: [{ ...contact, email: "x".repeat(1001) }] }).success).toBe(
      false,
    );
    expect(request.safeParse({ writes: [{ ...contact, email: "" }] }).success).toBe(false);
    expect(request.safeParse({ writes: [{ ...contact, email: null }] }).success).toBe(true);
    expect(request.safeParse({ writes: [{ ...contact, confirmed: true }, stage] }).success).toBe(
      false,
    );
    expect(
      request.safeParse({ writes: [{ ...contact, confirmed: true, email: "hello@promptlab" }] })
        .success,
    ).toBe(false);
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
      "find:ideas": () => ({ ok: false as const, problem: "bridge_off" as const }),
      "log:for": () => ({ lines: [] }),
      "log:page": () => ({ lines: [], more: false, people: [], total: 0 }),
      "toolbox:list": () => ({ version: 0, total: 0, items: [] }),
      "toolbox:archived": () => ({ total: 0, items: [] }),
      "toolbox:restore": () => ({ ok: false as const, problem: "no_python" as const }),
      "toolbox:sweep": () => ({}),
      "toolbox:counts": () => ({ archive: 0, never: 0, archived: 0, logToday: 0 }),
      "rules:set": () => ({}),
      "import:candidates": () => ({ candidates: [] }),
      "import:pick": () => ({ path: null }),
      "import:dry-run": () => ({ ok: false as const, reason: "not_built" as const }),
      "import:run": () => ({ ok: false as const, reason: "not_built" as const }),
      "writing:rules": () => ({ found: false, rules: [] }),
      "connections:status": () => connectionsStatus,
      "connections:set": () => ({ ok: true as const }),
      "connections:pick-folder": () => ({ path: null }),
      "prototype:status": () => ({ available: false, on: false, scenario: "normal" as const }),
      "prototype:set": () => ({ available: false, on: false, scenario: "normal" as const }),
      "prototype:scenario": () => ({ available: false, on: false, scenario: "normal" as const }),
      "comments:list": () => ({ comments: [] }),
      "comments:add": () => Promise.reject(new Error("off")),
      "comments:update": () => Promise.reject(new Error("off")),
      "comments:delete": () => ({ comment: null }),
      "comments:restore": () => Promise.reject(new Error("off")),
      "comments:export": () => ({ ok: false as const, problem: "no_repo" as const }),
      "mail:connect": () => ({ ok: false as const, reason: "not_built" as const }),
      "mail:check": () => ({ ok: false as const, reason: "not_built" as const }),
      "gateways:deploy": () => ({ ok: false as const, reason: "not_built" as const }),
      "gateways:remove": () => ({ ok: false as const, reason: "not_built" as const }),
      "reach:thread": () => ({ ok: true as const, messages: [] }),
      "reach:draft-now": () => ({ ok: true as const }),
      "reach:rewrite": () => ({ ok: true as const }),
      "reach:retry": () => ({ ok: true as const }),
      "reach:mark-sent": () => ({ ok: true as const }),
      "reach:send-new": () => ({ ok: true as const }),
      "reach:mailboxes-refresh": () => ({ ok: true as const }),
      "reach:mailbox-set": () => ({ ok: true as const }),
      "reach:send-test": () => ({ ok: true as const }),
      "reach:sequence-stop": () => ({ ok: true as const, skipped: [] }),
      "reach:sequence-resume": () => ({ ok: true as const }),
      "close:decline": () => ({ ok: false as const, problem: "no_data" as const }),
      "close:decline-undo": () => ({ ok: true as const, kept: null }),
      "close:ask": () => ({ ok: false as const, problem: "no_data" as const }),
      "reach:park": () => ({ ok: true as const, skipped: [] }),
      "reach:wake": () => ({ ok: true as const }),
      "reach:check-replies": () => ({ ok: true as const, stored: 0 }),
      "reach:paste-reply": () => ({ ok: true as const }),
      "reach:reclassify": () => ({ ok: true as const, rewritten: true }),
      "reach:situations": () => ({ ok: true as const, situations: [] }),
      "gemini:start": () => gemini,
      "gemini:stop": () => gemini,
      "gemini:open-window": () => gemini,
      "insights:read": () => Promise.reject(new Error("not used here")),
      "insights:list": () => ({ rows: [], total: 0 }),
      "insights:hide": () => ({ hidden: {} }),
      "insights:goal": () => ({ signsPerMonth: 4, overrides: {} }),
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
