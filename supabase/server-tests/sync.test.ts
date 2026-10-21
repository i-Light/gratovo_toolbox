// The app's sync modules against a real PostgREST: the keyset pull over same-transaction rows,
// tombstones and the resurrection guard, the first-pull seed, the uploader's log, switches, brand
// and deal writes, the refusal rules and the single token refresh. Everything is made up and
// removed again at the end. The service-role key is read from the environment, only ever sent in
// a header, and never written anywhere.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { getMeta, setMeta } from "../../apps/desktop/src/main/data/repositories/meta";
import { enqueue } from "../../apps/desktop/src/main/data/repositories/outbox";
import type { OutboxKind } from "../../apps/desktop/src/main/data/repositories/outbox";
import { openDatabase } from "../../apps/desktop/src/main/db/open-database";
import { createNetwork } from "../../apps/desktop/src/main/net/network";
import type { SecretStore } from "../../apps/desktop/src/main/secret-store";
import { createAuthClient } from "../../apps/desktop/src/main/supabase/auth-client";
import { readSupabaseConfig } from "../../apps/desktop/src/main/supabase/config";
import { createRest, RestError } from "../../apps/desktop/src/main/supabase/rest";
import type { Rest } from "../../apps/desktop/src/main/supabase/rest";
import { createSessionManager } from "../../apps/desktop/src/main/supabase/session";
import { createPuller } from "../../apps/desktop/src/main/sync/puller";
import { classifyUploadError } from "../../apps/desktop/src/main/sync/refusal";
import { createUploader, markRefetch } from "../../apps/desktop/src/main/sync/uploader";
import { refreshWhole } from "../../apps/desktop/src/main/sync/whole-tables";

const fixture = inject("fixture");
const secretKey = process.env["SUPABASE_SECRET_KEY"] ?? "";

const read = readSupabaseConfig({
  packaged: false,
  built: {},
  env: {
    GRATOVO_SUPABASE_URL: fixture.url,
    GRATOVO_SUPABASE_PUBLISHABLE_KEY: fixture.publishableKey,
  },
});
if (!read.ok) {
  throw new Error(`The local stack's address or key was refused: ${read.problem}`);
}
const config = read.config;

/** Every request the app's network sends, in order (method, path and query only). */
const requests: string[] = [];
const network = createNetwork({
  allowedOrigins: [config.origin],
  fetch: (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    requests.push(`${init?.method ?? "GET"} ${url.pathname}${url.search}`);
    return fetch(input, init);
  },
});
const auth = createAuthClient(network, config);

function memoryStore(): SecretStore {
  const values = new Map<string, string>();
  return {
    get: (name) => Promise.resolve(values.get(name)),
    set: (name, value) => {
      values.set(name, value);
      return Promise.resolve();
    },
    delete: (name) => Promise.resolve(values.delete(name)),
    has: (name) => Promise.resolve(values.has(name)),
    names: () => Promise.resolve([...values.keys()].sort()),
  };
}

/** A call to the local stack as the service role (bypasses the rules; for seeding and cleaning). */
async function asService(
  path: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  body?: object,
): Promise<unknown> {
  const response = await fetch(`${fixture.url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: secretKey,
      "Content-Type": "application/json",
      Prefer: method === "GET" ? "" : "return=minimal",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    throw new Error(`${method} ${path.split("?")[0] ?? ""} answered ${String(response.status)}`);
  }
  const text = await response.text();
  return text === "" ? null : (JSON.parse(text) as unknown);
}

const member = fixture.member;
const owner = fixture.owner;
const run = Date.now().toString(36);
const now = (): number => Date.now();

let folder: string;
let rest: Rest;
let closeSession: () => void;
let counter = 0;

const brandIds: string[] = [];
const channelIds: string[] = [];
const logIds: string[] = [];

beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), "gratovo-server-sync-"));
  const manager = createSessionManager({ auth, store: memoryStore(), now });
  const session = await manager.start(await auth.signIn(member.email, member.password));
  rest = createRest(network, config, session);
  closeSession = () => {
    manager.close();
  };
});

afterAll(async () => {
  closeSession();
  const quote = (ids: readonly string[]) =>
    `in.(${ids.map((id) => `"${id.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")})`;
  const cleanups: [string, readonly string[], string][] = [
    ["brands", brandIds, "id"],
    ["channel_state", channelIds, "channel_id"],
    ["activity_log", logIds, "id"],
  ];
  for (const [table, ids, column] of cleanups) {
    if (ids.length > 0) {
      await asService(`${table}?${column}=${encodeURIComponent(quote(ids))}`, "DELETE").catch(
        () => undefined,
      );
    }
  }
  await asService(`notification_switches?profile_id=eq.${owner.id}`, "DELETE").catch(
    () => undefined,
  );
  await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

/** A fresh local database for each case. */
function freshDb(): DatabaseSync {
  counter += 1;
  return openDatabase(join(folder, `case-${String(counter)}.db`));
}

function puller(target: DatabaseSync, restToUse: Rest = rest) {
  return createPuller({ db: target, rest: restToUse, now, log: () => undefined });
}

function uploader(target: DatabaseSync, lines: string[] = []) {
  return createUploader({
    db: target,
    rest,
    userId: member.id,
    now,
    log: (line) => lines.push(line),
  });
}

function add(
  target: DatabaseSync,
  kind: OutboxKind,
  payload: unknown,
  key: { table: string; key: string } | null = null,
): number {
  return enqueue(target, { userId: member.id, kind, payload, target: key, now: now() });
}

function ids(target: DatabaseSync, sql: string, ...params: string[]): string[] {
  return target
    .prepare(sql)
    .all(...params)
    .map((row) => String(Object.values(row)[0]));
}

function newUuid(): string {
  return crypto.randomUUID();
}

/** Inserts brands in one request, hence one transaction, hence one `updated_at`. */
async function seedBrands(count: number): Promise<string[]> {
  const rows = Array.from({ length: count }, (_, i) => ({
    id: newUuid(),
    name: `AI brand ${run}-${String(i)}`,
  }));
  await asService("brands", "POST", rows);
  brandIds.push(...rows.map((r) => r.id));
  return rows.map((r) => r.id);
}

describe("the pull over real PostgREST", () => {
  it("brings same-transaction rows across a page boundary and keeps the server's cursor text", async () => {
    const target = freshDb();
    setMeta(target, "sync.page.brands", "25");
    const created = await seedBrands(27);

    const before = requests.length;
    const result = await puller(target).pull(60_000);
    expect(result.done).toBe(true);
    expect(result.stalled).toEqual([]);

    const local = new Set(ids(target, "SELECT id FROM brands"));
    for (const id of created) {
      expect(local.has(id)).toBe(true);
    }
    // They really share one timestamp, and the data needed more than one page.
    const times = (await asService(
      `brands?select=updated_at&id=in.(${created.join(",")})`,
      "GET",
    )) as { updated_at: string }[];
    expect(new Set(times.map((t) => t.updated_at)).size).toBe(1);
    const brandPages = requests.slice(before).filter((r) => r.startsWith("GET /rest/v1/brands?"));
    expect(brandPages.length).toBeGreaterThanOrEqual(2);
    expect(brandPages.some((r) => decodeURIComponent(r).includes("or=("))).toBe(true);

    // The cursor is the server's raw text for the last row, never passed through Date.
    const cursor = JSON.parse(getMeta(target, "sync.cursor.brands") ?? "null") as {
      at: string;
      key: string[];
    };
    const [lastKey] = cursor.key;
    const stored = (await asService(
      `brands?select=updated_at&id=eq.${encodeURIComponent(lastKey ?? "")}`,
      "GET",
    )) as { updated_at: string }[];
    expect(cursor.at).toBe(stored[0]?.updated_at);
    target.close();
  });

  it("pages across a boundary when the keys hold reserved characters", async () => {
    const target = freshDb();
    setMeta(target, "sync.page.channel_state", "25");
    const keys = Array.from(
      { length: 27 },
      (_, i) => `UC${run},a(${String(i)})"q\\z.&=#%+ x`, // comma, parens, quote, backslash, ...
    );
    await asService(
      "channel_state",
      "POST",
      keys.map((key) => ({ channel_id: key, handle: "@ai-coding-tips" })),
    );
    channelIds.push(...keys);

    const result = await puller(target).pull(60_000);
    expect(result.done).toBe(true);
    expect(result.stalled).toEqual([]);
    const local = new Set(ids(target, "SELECT channel_id FROM channel_state"));
    for (const key of keys) {
      expect(local.has(key)).toBe(true);
    }
    target.close();
  });

  it("finds a row again by a plain eq filter when its key has reserved characters", async () => {
    const target = freshDb();
    const key = `UC${run}-"re,fetch"(x):y.z&q=1#h%2F+/\\ end`;
    await asService("channel_state", "POST", [{ channel_id: key, handle: "@ai-news-daily" }]);
    channelIds.push(key);

    markRefetch(target, { table: "channel_state", key });
    const changed = await puller(target).refetch();
    expect(changed.has("creators")).toBe(true);
    expect(ids(target, "SELECT channel_id FROM channel_state WHERE channel_id = ?", key)).toEqual([
      key,
    ]);
    // The mark is cleared once it was handled.
    expect(getMeta(target, "sync.refetch")).toBeNull();
    target.close();
  });
});

describe("tombstones", () => {
  it("seeds the tombstone cursor before the first data page", async () => {
    const target = freshDb();
    await seedBrands(1);
    const before = requests.length;
    await puller(target).pull(60_000);
    const seen = requests.slice(before);
    const seed = seen.findIndex((r) => r.includes("/sync_tombstones?") && r.includes("limit=1"));
    const firstData = seen.findIndex((r) => r.startsWith("GET /rest/v1/channel_state?"));
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(firstData).toBeGreaterThan(seed);
    expect(getMeta(target, "sync.seeded")).toBe("1");
    target.close();
  });

  it("deletes the local row for a service-role delete", async () => {
    const target = freshDb();
    const [id] = await seedBrands(1);
    await puller(target).pull(60_000);
    expect(ids(target, "SELECT id FROM brands WHERE id = ?", id ?? "")).toEqual([id]);

    await asService(`brands?id=eq.${id ?? ""}`, "DELETE");
    const result = await puller(target).pull(60_000);
    expect(result.changed.has("brands")).toBe(true);
    expect(ids(target, "SELECT id FROM brands WHERE id = ?", id ?? "")).toEqual([]);
    target.close();
  });

  it("keeps a row that was created again after its deletion", async () => {
    const target = freshDb();
    await puller(target).pull(60_000); // seeds past everything that exists now
    const id = newUuid();
    brandIds.push(id);
    await asService("brands", "POST", [{ id, name: `AI brand ${run} first` }]);
    await asService(`brands?id=eq.${id}`, "DELETE");
    await asService("brands", "POST", [{ id, name: `AI brand ${run} again` }]);

    await puller(target).pull(60_000);
    expect(ids(target, "SELECT name FROM brands WHERE id = ?", id)).toEqual([
      `AI brand ${run} again`,
    ]);
    target.close();
  });
});

describe("the uploader", () => {
  function logRow(id: string, actorId: string, text: string) {
    return {
      id,
      at: new Date().toISOString(),
      actor_id: actorId,
      actor_name: "Test Member",
      actor_role: "basic",
      action: "note",
      entity_type: "app",
      entity_id: null,
      entity_label: text,
      field: null,
      old_value: null,
      new_value: null,
      detail: { text },
    };
  }

  it("uploads a log line once and it comes back with received_at", async () => {
    const target = freshDb();
    const id = newUuid();
    logIds.push(id);
    const row = logRow(id, member.id, "Added an AI tools roundup");
    add(target, "activity.add", { row }, { table: "activity_log", key: id });
    const first = await uploader(target).drain();
    expect(first.sent).toBe(1);
    // The same line sent again (a retry after a lost answer) adds nothing.
    add(target, "activity.add", { row }, { table: "activity_log", key: id });
    const second = await uploader(target).drain();
    expect(second.stoppedOn).toBeNull();
    const onServer = (await asService(`activity_log?select=id&id=eq.${id}`, "GET")) as unknown[];
    expect(onServer).toHaveLength(1);

    await puller(target).pull(60_000);
    const local = target.prepare("SELECT received_at FROM activity_log WHERE id = ?").get(id);
    expect(typeof local?.["received_at"]).toBe("string");
    expect(String(local?.["received_at"]).length).toBeGreaterThan(10);
    target.close();
  });

  it("refuses a line filed under another actor (42501) and drops it", async () => {
    const target = freshDb();
    const id = newUuid();
    logIds.push(id);
    const seq = add(
      target,
      "activity.add",
      { row: logRow(id, owner.id, "Not mine to file") },
      { table: "activity_log", key: id },
    );
    const lines: string[] = [];
    const result = await uploader(target, lines).drain();
    expect(result.dropped).toBe(1);
    expect(result.stoppedOn).toBeNull();
    expect(ids(target, "SELECT seq FROM _outbox_dropped")).toEqual([String(seq)]);
    expect(lines.some((l) => l.includes("code=42501"))).toBe(true);
    const onServer = (await asService(`activity_log?select=id&id=eq.${id}`, "GET")) as unknown[];
    expect(onServer).toEqual([]);
    target.close();
  });

  it("upserts your switches and reads back only your row", async () => {
    const target = freshDb();
    await asService("notification_switches", "POST", [
      { profile_id: owner.id, switches: { money: false } },
    ]);
    add(target, "notify.set", { switches: { reply: false, money: true } });
    const result = await uploader(target).drain();
    expect(result.sent).toBe(1);

    const mine = await rest.select<{ profile_id: string; switches: Record<string, boolean> }>(
      "notification_switches",
      "select=profile_id,switches",
    );
    expect(mine).toHaveLength(1);
    expect(mine[0]?.profile_id).toBe(member.id);
    expect(mine[0]?.switches).toEqual({ reply: false, money: true });
    await refreshWhole(rest, target, member.id);
    target.close();
  });

  it("changes only the brand's name, sells and status for brand.set", async () => {
    const target = freshDb();
    const id = newUuid();
    brandIds.push(id);
    await asService("brands", "POST", [
      { id, name: `AI brand ${run} old`, contact_name: "Dana", notes: "keep me", budget: 1200 },
    ]);
    add(
      target,
      "brand.set",
      { id, name: `AI brand ${run} new`, sells: "AI writing assistant", status: "talking" },
      { table: "brands", key: id },
    );
    const result = await uploader(target).drain();
    expect(result.sent).toBe(1);
    const row = (await asService(
      `brands?select=name,sells,status,contact_name,notes,budget&id=eq.${id}`,
      "GET",
    )) as Record<string, unknown>[];
    expect(row[0]).toEqual({
      name: `AI brand ${run} new`,
      sells: "AI writing assistant",
      status: "talking",
      contact_name: "Dana",
      notes: "keep me",
      budget: 1200,
    });
    target.close();
  });

  it("changes only flow_step for deal.step", async () => {
    const target = freshDb();
    const [brandId] = await seedBrands(1);
    const dealId = newUuid();
    await asService("deals", "POST", [
      {
        id: dealId,
        brand_id: brandId,
        channel_id: `UC${run}-deal`,
        stage: "negotiating",
        notes: "keep me",
      },
    ]);
    add(target, "deal.step", { id: dealId, step: 3 }, { table: "deals", key: dealId });
    const result = await uploader(target).drain();
    expect(result.sent).toBe(1);
    const row = (await asService(
      `deals?select=flow_step,stage,notes,channel_id&id=eq.${dealId}`,
      "GET",
    )) as Record<string, unknown>[];
    expect(row[0]).toEqual({
      flow_step: 3,
      stage: "negotiating",
      notes: "keep me",
      channel_id: `UC${run}-deal`,
    });
    target.close();
  });

  it("classifies a missing function as retry", async () => {
    let caught: unknown;
    try {
      await rest.rpc("function_that_was_never_migrated", { p_x: 1 });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RestError);
    expect((caught as RestError).code).toBe("PGRST202");
    expect(classifyUploadError(caught)).toBe("retry");
  });
});

describe("the session", () => {
  it("makes one token refresh for two passes at once", async () => {
    // A clock an hour ahead makes the held access token count as expired.
    const manager = createSessionManager({
      auth,
      store: memoryStore(),
      now: () => Date.now() + 3_600_000,
      timers: { set: () => 0, clear: () => undefined },
    });
    const session = await manager.start(await auth.signIn(member.email, member.password));
    const stale = createRest(network, config, session);
    const a = freshDb();
    const b = freshDb();
    const before = requests.length;
    await Promise.all([refreshWhole(stale, a, member.id), refreshWhole(stale, b, member.id)]);
    const refreshes = requests
      .slice(before)
      .filter((r) => r.includes("/auth/v1/token") && r.includes("refresh_token"));
    expect(refreshes).toHaveLength(1);
    manager.close();
    a.close();
    b.close();
  });
});
