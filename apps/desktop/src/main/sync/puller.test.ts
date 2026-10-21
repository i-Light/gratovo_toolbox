import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { enqueue, getMeta, pendingCount, setMeta } from "../data/repositories";
import { openDatabase } from "../db/open-database";
import type { Rest } from "../supabase/rest";
import { RestError } from "../supabase/rest";

import { mirrorTables, toLocalRow, upsertRow } from "./mirror-tables";
import type { MirrorTable } from "./mirror-tables";
import { createPuller, cursorKey, pageKey, resyncKey, seededKey } from "./puller";
import { compareServerTime } from "./server-time";
import { refetchKey } from "./uploader";

type Db = ReturnType<typeof openDatabase>;
type Row = Record<string, unknown>;

/** Fixed-width µs text, so text order is time order (as the server prints it). */
function ts(second: number, micros = 0): string {
  return `2026-10-20T09:15:${String(second).padStart(2, "0")}.${String(micros).padStart(6, "0")}+00:00`;
}

const keysOf: Record<string, { cursor: string; keys: string[] }> = {
  channel_state: { cursor: "updated_at", keys: ["channel_id"] },
  brands: { cursor: "updated_at", keys: ["id"] },
  deals: { cursor: "updated_at", keys: ["id"] },
  activity_log: { cursor: "received_at", keys: ["id"] },
  sync_tombstones: { cursor: "deleted_at", keys: ["table_name", "row_id"] },
};

function unquote(text: string): string {
  return text.replace(/\\(.)/g, "$1");
}

/**
 * An in-memory PostgREST for the shapes the puller sends: keyset `or=(…)`, `order`, `limit`,
 * `in.(…)` and `eq.` filters, and `sync_control`.
 */
function fakeServer() {
  const tables: Record<string, Row[]> = {
    channel_state: [],
    brands: [],
    deals: [],
    activity_log: [],
    sync_tombstones: [],
  };
  const state = { horizon: "-infinity" as string };
  const calls: { table: string; query: string }[] = [];
  const failures: ((table: string, query: string) => Error | null)[] = [];

  function select(table: string, query: string): Row[] {
    if (table === "sync_control") {
      return [{ tombstones_purged_before: state.horizon }];
    }
    const meta = keysOf[table];
    const all = tables[table];
    if (meta === undefined || all === undefined) {
      throw new Error(`unknown table ${table}`);
    }
    const params = new URLSearchParams(query);
    let rows = [...all];
    for (const [name, raw] of params) {
      if (["select", "order", "limit", "or"].includes(name)) {
        continue;
      }
      if (raw.startsWith("in.(")) {
        const allowed = raw.slice(4, -1).split(",");
        rows = rows.filter((r) => allowed.includes(String(r[name])));
      } else if (raw.startsWith("eq.")) {
        rows = rows.filter((r) => String(r[name]) === raw.slice(3));
      } else {
        throw new Error(`unknown filter ${name}=${raw}`);
      }
    }
    const or = params.get("or");
    if (or !== null) {
      const values = [...or.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => unquote(m[1] ?? ""));
      const at = values[0] ?? "";
      // Term i+1 ends with key i's value.
      let index = 0;
      const after: string[] = [];
      for (let i = 0; i < meta.keys.length; i += 1) {
        index += i + 2;
        after.push(values[index] ?? "");
      }
      rows = rows.filter((r) => {
        const c = compareServerTime(String(r[meta.cursor]), at);
        if (c !== 0) {
          return c > 0;
        }
        for (let i = 0; i < meta.keys.length; i += 1) {
          const v = String(r[meta.keys[i] ?? ""]);
          const w = after[i] ?? "";
          if (v !== w) {
            return v > w;
          }
        }
        return false;
      });
    }
    const desc = (params.get("order") ?? "").includes(".desc");
    rows.sort((a, b) => {
      const c = compareServerTime(String(a[meta.cursor]), String(b[meta.cursor]));
      if (c !== 0) {
        return c;
      }
      for (const k of meta.keys) {
        const x = String(a[k]);
        const y = String(b[k]);
        if (x !== y) {
          return x < y ? -1 : 1;
        }
      }
      return 0;
    });
    if (desc) {
      rows.reverse();
    }
    const limit = Number(params.get("limit") ?? "1000");
    return rows.slice(0, limit).map((r) => ({ ...r }));
  }

  const rest: Pick<Rest, "select"> = {
    select: <T>(table: string, query: string, options?: { timeoutMs?: number }) => {
      calls.push({ table, query });
      expect(options?.timeoutMs).toBe(45_000);
      for (const fail of failures) {
        const error = fail(table, query);
        if (error !== null) {
          return Promise.reject(error);
        }
      }
      try {
        return Promise.resolve(select(table, query) as T[]);
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },
  };
  return { tables, state, calls, failures, rest };
}

function channel(id: string, at: string, extra: Row = {}): Row {
  return {
    channel_id: id,
    handle: `@${id.toLowerCase()}`,
    vetting_status: "newlyFound",
    pipeline_stage: "new",
    channel_tags: [],
    contacts: [],
    updated_at: at,
    ...extra,
  };
}

function brand(id: string, at: string, extra: Row = {}): Row {
  return {
    id,
    name: `Brand ${id}`,
    contacts: [],
    budget_currency: "USD",
    created_at: at,
    updated_at: at,
    ...extra,
  };
}

function deal(id: string, at: string): Row {
  return {
    id,
    brand_id: "b1",
    channel_id: "UC1",
    stage: "proposed",
    brand_price: 0,
    influencer_payout: 0,
    currency: "USD",
    creator_contract_status: "none",
    brand_contract_status: "none",
    created_at: at,
    updated_at: at,
  };
}

function table(name: MirrorTable["name"]): MirrorTable {
  const t = mirrorTables.find((m) => m.name === name);
  if (t === undefined) {
    throw new Error(name);
  }
  return t;
}

function putLocal(db: Db, name: MirrorTable["name"], remote: Row): void {
  const t = table(name);
  const row = toLocalRow(t, remote);
  if (row === null) {
    throw new Error("bad row");
  }
  upsertRow(db, t, row);
}

function localIds(db: Db, name: string, key = "id"): string[] {
  return db
    .prepare(`SELECT ${key} AS k FROM ${name} ORDER BY ${key}`)
    .all()
    .map((r) => String(r["k"]));
}

function cursorOf(db: Db, name: string): unknown {
  const raw = getMeta(db, cursorKey(name));
  return raw === null ? null : (JSON.parse(raw) as unknown);
}

describe("createPuller", () => {
  let db: Db;
  let server: ReturnType<typeof fakeServer>;
  let clock: number;
  let lines: string[];

  beforeEach(() => {
    db = openDatabase(":memory:");
    server = fakeServer();
    clock = 1_000_000;
    lines = [];
  });

  afterEach(() => {
    if (db.isOpen) {
      db.close();
    }
  });

  function puller(extra: { onTableDone?: (part: string) => void; tick?: number } = {}) {
    return createPuller({
      db,
      rest: server.rest,
      now: () => {
        clock += extra.tick ?? 0;
        return clock;
      },
      yieldNow: () => Promise.resolve(),
      ...(extra.onTableDone === undefined ? {} : { onTableDone: extra.onTableDone }),
      log: (line) => lines.push(line),
    });
  }

  it("asks for the horizon and the seed before any data page, with the exact queries", async () => {
    server.tables["channel_state"]?.push(channel("UC1", ts(1)));
    const result = await puller().pull(120_000);

    expect(result).toEqual({ changed: new Set(["creators"]), done: true, stalled: [] });
    expect(server.calls.map((c) => c.table)).toEqual([
      "sync_control",
      "sync_tombstones",
      "channel_state",
      "brands",
      "deals",
      "activity_log",
      "sync_tombstones",
    ]);
    expect(server.calls[0]?.query).toBe("select=tombstones_purged_before&limit=1");
    expect(server.calls[1]?.query).toBe(
      "select=table_name%2Crow_id%2Cdeleted_at&table_name=in.(channel_state%2Cbrands%2Cdeals)" +
        "&order=deleted_at.desc%2Ctable_name.desc%2Crow_id.desc&limit=1",
    );
    expect(server.calls[2]?.query).toBe(
      `select=${encodeURIComponent(table("channel_state").columns.join(","))}` +
        "&order=updated_at.asc%2Cchannel_id.asc&limit=500",
    );
    expect(server.calls[5]?.query).toContain("&order=received_at.asc%2Cid.asc&limit=500");
    // The tombstone pull starts from the seed: no tombstone and no horizon, so the beginning.
    const tombstones = new URLSearchParams(server.calls[6]?.query ?? "");
    expect(tombstones.get("order")).toBe("deleted_at.asc,table_name.asc,row_id.asc");
    expect(tombstones.get("table_name")).toBe("in.(channel_state,brands,deals)");
    expect(tombstones.get("or")).toBe(
      '(deleted_at.gt."-infinity",and(deleted_at.eq."-infinity",table_name.gt.""),' +
        'and(deleted_at.eq."-infinity",table_name.eq."",row_id.gt.""))',
    );
    expect(getMeta(db, seededKey)).toBe("1");
    expect(localIds(db, "channel_state", "channel_id")).toEqual(["UC1"]);
  });

  it("pages across same-stamp rows and stores the server's cursor text", async () => {
    const rows = server.tables["channel_state"] ?? [];
    for (let i = 0; i < 60; i += 1) {
      // Three stamps, twenty rows each: page boundaries fall inside a tie.
      rows.push(channel(`UC${String(i).padStart(2, "0")}`, ts(1, 123_456 + Math.floor(i / 20))));
    }
    setMeta(db, pageKey("channel_state"), "25");
    const done: string[] = [];
    await puller({ onTableDone: (part) => done.push(part) }).pull(120_000);

    const pages = server.calls.filter((c) => c.table === "channel_state");
    expect(pages.map((c) => new URLSearchParams(c.query).get("limit"))).toEqual(["25", "25", "25"]);
    expect(new URLSearchParams(pages[1]?.query ?? "").get("or")).toBe(
      `(updated_at.gt."${ts(1, 123_457)}",and(updated_at.eq."${ts(1, 123_457)}",channel_id.gt."UC24"))`,
    );
    expect(localIds(db, "channel_state", "channel_id")).toHaveLength(60);
    expect(cursorOf(db, "channel_state")).toEqual({ at: ts(1, 123_458), key: ["UC59"] });
    expect(done).toEqual(["creators"]);
  });

  it("skips a row the local copy can't hold, so the table still moves on", async () => {
    server.tables["channel_state"]?.push(
      channel("UC1", ts(2)),
      channel("UC2", ts(3), { handle: null }),
      channel("UC3", ts(4)),
    );
    await puller().pull(120_000);

    expect(localIds(db, "channel_state", "channel_id")).toEqual(["UC1", "UC3"]);
    expect(cursorOf(db, "channel_state")).toEqual({ at: ts(4), key: ["UC3"] });
    expect(lines).toContain("pull.row_skipped channel_state");
  });

  it("skips a pulled row that has a pending outbox entry", async () => {
    putLocal(db, "channel_state", channel("UC1", ts(5), { notes: "mine" }));
    enqueue(db, {
      userId: "u1",
      kind: "channel.edit",
      payload: {},
      target: { table: "channel_state", key: "UC1" },
      now: 0,
    });
    server.tables["channel_state"]?.push(
      channel("UC1", ts(2), { notes: "older server copy" }),
      channel("UC2", ts(3)),
    );
    await puller().pull(120_000);

    const notes = db.prepare("SELECT notes FROM channel_state WHERE channel_id = 'UC1'").get();
    expect(notes?.["notes"]).toBe("mine");
    expect(localIds(db, "channel_state", "channel_id")).toEqual(["UC1", "UC2"]);
    expect(cursorOf(db, "channel_state")).toEqual({ at: ts(3), key: ["UC2"] });
  });

  it("stops a table whose cursor does not move", async () => {
    const page = Array.from({ length: 25 }, (_, i) => channel(`UC${String(i)}`, ts(1)));
    setMeta(db, pageKey("channel_state"), "25");
    let served = 0;
    const stuck: Pick<Rest, "select"> = {
      select: <T>(t: string, q: string, o?: { timeoutMs?: number }) => {
        if (t === "channel_state") {
          served += 1;
          return Promise.resolve(page.map((r) => ({ ...r })) as T[]);
        }
        return server.rest.select<T>(t, q, o);
      },
    };
    const result = await createPuller({
      db,
      rest: stuck,
      now: () => clock,
      yieldNow: () => Promise.resolve(),
      log: (line) => lines.push(line),
    }).pull(120_000);

    expect(served).toBe(2);
    expect(result.stalled).toEqual(["channel_state"]);
    expect(result.done).toBe(true);
    expect(lines.some((l) => l.startsWith("pull.stalled table=channel_state"))).toBe(true);
  });

  it("halves the page on a timeout and doubles it again after five good pages", async () => {
    const rows = server.tables["brands"] ?? [];
    for (let i = 0; i < 1600; i += 1) {
      rows.push(brand(`b${String(i).padStart(4, "0")}`, ts(1 + Math.floor(i / 100))));
    }
    let failed = false;
    server.failures.push((t) => {
      if (t === "brands" && !failed) {
        failed = true;
        return new RestError("offline");
      }
      return null;
    });
    await puller().pull(120_000);

    const limits = server.calls
      .filter((c) => c.table === "brands")
      .map((c) => new URLSearchParams(c.query).get("limit"));
    expect(limits.slice(0, 7)).toEqual(["500", "250", "250", "250", "250", "250", "500"]);
    expect(localIds(db, "brands")).toHaveLength(1600);
    expect(getMeta(db, pageKey("brands"))).toBe("500");
    expect(lines).toContain("pull.page.failed table=brands size=500 attempt=1");
  });

  it("gives up on a page after three failures, keeping the smaller size", async () => {
    server.failures.push((t) => (t === "deals" ? new RestError("http", 503) : null));
    await expect(puller().pull(120_000)).rejects.toBeInstanceOf(RestError);
    expect(getMeta(db, pageKey("deals"))).toBe("62");
  });

  it("does not retry a refusal", async () => {
    server.failures.push((t) => (t === "brands" ? new RestError("http", 403, "42501") : null));
    await expect(puller().pull(120_000)).rejects.toBeInstanceOf(RestError);
    expect(server.calls.filter((c) => c.table === "brands")).toHaveLength(1);
    expect(getMeta(db, pageKey("brands"))).toBeNull();
  });

  it("reads nothing more from an empty table and stores no cursor", async () => {
    const result = await puller().pull(120_000);
    expect(result).toEqual({ changed: new Set(), done: true, stalled: [] });
    expect(cursorOf(db, "channel_state")).toBeNull();
    expect(cursorOf(db, "activity_log")).toBeNull();
  });

  it("stops between pages when the budget is spent and carries on next time", async () => {
    const rows = server.tables["channel_state"] ?? [];
    for (let i = 0; i < 100; i += 1) {
      rows.push(channel(`UC${String(i).padStart(3, "0")}`, ts(1, i)));
    }
    setMeta(db, pageKey("channel_state"), "25");
    const first = await puller({ tick: 400 }).pull(1_000);
    expect(first.done).toBe(false);
    const got = localIds(db, "channel_state", "channel_id").length;
    expect(got).toBeGreaterThan(0);
    expect(got).toBeLessThan(100);

    const second = await puller().pull(120_000);
    expect(second.done).toBe(true);
    expect(localIds(db, "channel_state", "channel_id")).toHaveLength(100);
  });

  it("seeds past the old tombstones and applies the new ones", async () => {
    server.tables["deals"]?.push(deal("d1", ts(1)));
    server.tables["sync_tombstones"]?.push(
      { table_name: "deals", row_id: "d0", deleted_at: ts(2) },
      { table_name: "outreach_threads", row_id: "x", deleted_at: ts(9) },
    );
    await puller().pull(120_000);
    expect(cursorOf(db, "sync_tombstones")).toEqual({ at: ts(2), key: ["deals", "d0"] });
    // An old tombstone of a row this pull brings: a re-created row must not go (the seed skips it).
    server.tables["sync_tombstones"]?.push({
      table_name: "deals",
      row_id: "d1",
      deleted_at: ts(0),
    });
    await puller().pull(120_000);
    expect(localIds(db, "deals")).toEqual(["d1"]);

    server.tables["sync_tombstones"]?.push({
      table_name: "deals",
      row_id: "d1",
      deleted_at: ts(3),
    });
    const result = await puller().pull(120_000);
    expect(localIds(db, "deals")).toEqual([]);
    expect(result.changed).toEqual(new Set(["deals"]));
    expect(cursorOf(db, "sync_tombstones")).toEqual({ at: ts(3), key: ["deals", "d1"] });
  });

  it("keeps a row newer than its tombstone, and a row with a pending entry", async () => {
    await puller().pull(120_000); // seeded at the beginning
    putLocal(db, "brands", brand("b1", ts(5)));
    putLocal(db, "brands", brand("b2", ts(5)));
    putLocal(db, "brands", brand("b3", ts(5)));
    enqueue(db, {
      userId: "u1",
      kind: "brand.set",
      payload: {},
      target: { table: "brands", key: "b3" },
      now: 0,
    });
    server.tables["sync_tombstones"]?.push(
      { table_name: "brands", row_id: "b1", deleted_at: ts(4) },
      { table_name: "brands", row_id: "b2", deleted_at: ts(6) },
      { table_name: "brands", row_id: "b3", deleted_at: ts(6) },
    );
    await puller().pull(120_000);
    expect(localIds(db, "brands")).toEqual(["b1", "b3"]);
  });

  it("re-pulls everything behind the horizon and sweeps what the server no longer has", async () => {
    server.tables["sync_tombstones"]?.push({
      table_name: "deals",
      row_id: "d0",
      deleted_at: ts(1),
    });
    server.tables["channel_state"]?.push(channel("UC1", ts(1)));
    await puller().pull(120_000);
    // Away a long time: rows were deleted and their tombstones purged.
    putLocal(db, "channel_state", channel("UC2", ts(1)));
    putLocal(db, "channel_state", channel("UC3", ts(1)));
    enqueue(db, {
      userId: "u1",
      kind: "channel.edit",
      payload: {},
      target: { table: "channel_state", key: "UC3" },
      now: 0,
    });
    server.tables["sync_tombstones"] = [];
    server.tables["channel_state"]?.push(channel("UC4", ts(2)));
    server.state.horizon = ts(30);

    const result = await puller().pull(120_000);
    expect(lines).toContain("pull.resync reason=horizon");
    // Every table read from the start again.
    const first = server.calls.findLast((c) => c.table === "channel_state");
    expect(new URLSearchParams(first?.query ?? "").get("or")).toBeNull();
    expect(localIds(db, "channel_state", "channel_id")).toEqual(["UC1", "UC3", "UC4"]);
    expect(result.changed.has("creators")).toBe(true);
    expect(pendingCount(db)).toBe(1);
    expect(getMeta(db, resyncKey)).toBeNull();
    // No tombstone left: the seed starts at the horizon, so the next pass doesn't re-pull again.
    expect(cursorOf(db, "sync_tombstones")).toEqual({ at: ts(30), key: ["", ""] });
    lines.length = 0;
    await puller().pull(120_000);
    expect(lines.filter((l) => l.startsWith("pull.resync"))).toEqual([]);
  });

  it("finishes a full pull across passes before it sweeps", async () => {
    putLocal(db, "brands", brand("gone", ts(1)));
    setMeta(db, cursorKey("sync_tombstones"), JSON.stringify({ at: ts(1), key: ["", ""] }));
    setMeta(db, seededKey, "1");
    server.state.horizon = ts(10);
    const rows = server.tables["channel_state"] ?? [];
    for (let i = 0; i < 60; i += 1) {
      rows.push(channel(`UC${String(i).padStart(2, "0")}`, ts(1, i)));
    }
    setMeta(db, pageKey("channel_state"), "25");
    const first = await puller({ tick: 400 }).pull(1_000);
    expect(first.done).toBe(false);
    expect(localIds(db, "brands")).toEqual(["gone"]);

    await puller().pull(120_000);
    expect(localIds(db, "brands")).toEqual([]);
    expect(localIds(db, "channel_state", "channel_id")).toHaveLength(60);
  });

  describe("refetch", () => {
    it("reverts a row to the server's copy and removes a row the server no longer has", async () => {
      server.tables["channel_state"]?.push(channel("UC1", ts(3), { notes: "server" }));
      putLocal(db, "channel_state", channel("UC1", ts(4), { notes: "refused" }));
      putLocal(db, "brands", brand("b1", ts(4)));
      setMeta(
        db,
        refetchKey,
        JSON.stringify([
          { table: "channel_state", key: "UC1" },
          { table: "brands", key: "b1" },
        ]),
      );

      const changed = await puller().refetch();

      expect(changed).toEqual(new Set(["creators", "brands"]));
      expect(server.calls.map((c) => c.query)).toEqual([
        `select=${encodeURIComponent(table("channel_state").columns.join(","))}&channel_id=eq.UC1&limit=1`,
        `select=${encodeURIComponent(table("brands").columns.join(","))}&id=eq.b1&limit=1`,
      ]);
      const notes = db.prepare("SELECT notes FROM channel_state WHERE channel_id = 'UC1'").get();
      expect(notes?.["notes"]).toBe("server");
      expect(localIds(db, "brands")).toEqual([]);
      expect(getMeta(db, refetchKey)).toBeNull();
    });

    it("leaves a row with another pending entry for later", async () => {
      putLocal(db, "deals", deal("d1", ts(1)));
      enqueue(db, {
        userId: "u1",
        kind: "deal.step",
        payload: {},
        target: { table: "deals", key: "d1" },
        now: 0,
      });
      setMeta(
        db,
        refetchKey,
        JSON.stringify([
          { table: "deals", key: "d1" },
          { table: "profiles", key: "u1" },
        ]),
      );
      const changed = await puller().refetch();
      expect(changed.size).toBe(0);
      expect(server.calls).toEqual([]);
      expect(localIds(db, "deals")).toEqual(["d1"]);
      expect(JSON.parse(getMeta(db, refetchKey) ?? "null")).toEqual([
        { table: "deals", key: "d1" },
      ]);
    });

    it("encodes a key with reserved characters", async () => {
      setMeta(db, refetchKey, JSON.stringify([{ table: "brands", key: 'a,b"(c)+d' }]));
      await puller().refetch();
      const query = server.calls[0]?.query ?? "";
      expect(new URLSearchParams(query).get("id")).toBe('eq.a,b"(c)+d');
    });
  });
});
