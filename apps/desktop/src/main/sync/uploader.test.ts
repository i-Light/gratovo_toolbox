import type { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getMeta, setMeta } from "../data/repositories/meta";
import { enqueue, pendingCount } from "../data/repositories/outbox";
import type { OutboxKind } from "../data/repositories/outbox";
import { openDatabase } from "../db/open-database";
import { AuthError } from "../supabase/auth-client";
import { RestError } from "../supabase/rest";
import type { Rest } from "../supabase/rest";
import { createUploader, logBatchMax, markRefetch, refetchKey } from "./uploader";

let folder: string;
let db: DatabaseSync;

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "gratovo-uploader-"));
  db = openDatabase(join(folder, "test.db"));
});

afterEach(async () => {
  db.close();
  await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const me = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const now = Date.UTC(2026, 9, 20, 10, 0, 0);

interface Call {
  readonly method: "patch" | "upsert" | "rpc";
  readonly name: string;
  readonly arg: unknown;
  readonly body: unknown;
}

/** A fake `Rest` that records each call; `fail` decides which calls throw. */
function fakeRest(fail: (call: Call, index: number) => Error | undefined = () => undefined): {
  rest: Pick<Rest, "patch" | "upsert" | "rpc">;
  calls: Call[];
} {
  const calls: Call[] = [];
  const handle = (call: Call): void => {
    const index = calls.length;
    calls.push(call);
    const error = fail(call, index);
    if (error !== undefined) {
      throw error;
    }
  };
  return {
    calls,
    rest: {
      patch(table, filter, body) {
        handle({ method: "patch", name: table, arg: filter, body });
        return Promise.resolve();
      },
      upsert(table, rows, options) {
        handle({ method: "upsert", name: table, arg: options, body: rows });
        return Promise.resolve();
      },
      rpc<T>(name: string, args?: object) {
        handle({ method: "rpc", name, arg: undefined, body: args });
        return Promise.resolve("applied" as T);
      },
    },
  };
}

function add(
  kind: string,
  payload: unknown,
  target: { table: string; key: string } | null = null,
  userId = me,
): number {
  return enqueue(db, { userId, kind: kind as OutboxKind, payload, target, now });
}

function logRow(id: string, text = `line ${id}`) {
  return {
    id,
    at: "2026-10-20T10:00:00.000Z",
    actor_id: me,
    actor_name: "Sara",
    actor_role: "admin",
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

function addLog(id: string, text?: string): number {
  return add("activity.add", { row: logRow(id, text) }, { table: "activity_log", key: id });
}

function uploader(rest: Pick<Rest, "patch" | "upsert" | "rpc">, lines: string[] = []) {
  return createUploader({ db, rest, userId: me, now: () => now, log: (line) => lines.push(line) });
}

function attempts(seq: number): number {
  const row = db.prepare("SELECT attempts FROM _outbox WHERE seq = ?").get(seq);
  return Number(row?.["attempts"]);
}

function droppedSeqs(): number[] {
  return db
    .prepare("SELECT seq FROM _outbox_dropped ORDER BY seq")
    .all()
    .map((row) => Number(row["seq"]));
}

function refetchList(): unknown {
  return JSON.parse(getMeta(db, refetchKey) ?? "[]") as unknown;
}

describe("createUploader", () => {
  it("sends every kind, in order, with the bodies the server expects", async () => {
    add("profile.name", { name: "Sara K" }, { table: "profiles", key: me });
    addLog("l1");
    addLog("l2");
    add(
      "notify.set",
      { switches: { replies: false } },
      { table: "notification_switches", key: me },
    );
    add(
      "brand.set",
      { id: "b1", name: "Nimbus AI", sells: "AI writing tool", status: "talking" },
      { table: "brands", key: "b1" },
    );
    add("deal.step", { id: "d 1", step: 3 }, { table: "deals", key: "d 1" });
    add(
      "channel.edit",
      { channelId: "UC1", field: "creator_stage", base: null, next: "emailed", label: "@ai_daily" },
      { table: "channel_state", key: "UC1" },
    );
    add(
      "conflict.resolve",
      { id: "c1", resolution: "mine", value: "emailed" },
      { table: "channel_state", key: "UC1" },
    );
    addLog("l3");
    const { rest, calls } = fakeRest();

    const result = await uploader(rest).drain();

    expect(calls).toEqual([
      {
        method: "patch",
        name: "profiles",
        arg: `id=eq.${me}`,
        body: { display_name: "Sara K" },
      },
      {
        method: "upsert",
        name: "activity_log",
        arg: { onConflict: "id", ignoreDuplicates: true },
        body: [logRow("l1"), logRow("l2")],
      },
      {
        method: "upsert",
        name: "notification_switches",
        arg: { onConflict: "profile_id" },
        body: [{ profile_id: me, switches: { replies: false } }],
      },
      {
        method: "upsert",
        name: "brands",
        arg: { onConflict: "id" },
        body: [{ id: "b1", name: "Nimbus AI", sells: "AI writing tool", status: "talking" }],
      },
      { method: "patch", name: "deals", arg: "id=eq.d%201", body: { flow_step: 3 } },
      {
        method: "rpc",
        name: "apply_channel_edit",
        arg: undefined,
        body: {
          p_channel_id: "UC1",
          p_field: "creator_stage",
          p_base: null,
          p_new: "emailed",
          p_force: false,
          p_label: "@ai_daily",
        },
      },
      {
        method: "rpc",
        name: "resolve_edit_conflict",
        arg: undefined,
        body: { p_id: "c1", p_resolution: "mine", p_value: "emailed" },
      },
      {
        method: "upsert",
        name: "activity_log",
        arg: { onConflict: "id", ignoreDuplicates: true },
        body: [logRow("l3")],
      },
    ]);
    expect(result.sent).toBe(9);
    expect(result.dropped).toBe(0);
    expect(result.stoppedOn).toBeNull();
    expect([...result.tables].sort()).toEqual(
      [
        "activity_log",
        "brands",
        "channel_state",
        "deals",
        "edit_conflicts",
        "notification_switches",
        "profiles",
      ].sort(),
    );
    expect(pendingCount(db)).toBe(0);
  });

  it("sends 450 log rows as 200, 200 and 50", async () => {
    for (let i = 0; i < 450; i += 1) {
      addLog(`l${String(i)}`);
    }
    const { rest, calls } = fakeRest();

    const result = await uploader(rest).drain();

    expect(calls.map((call) => (call.body as unknown[]).length)).toEqual([
      logBatchMax,
      logBatchMax,
      50,
    ]);
    expect((calls[0]?.body as { id: string }[])[0]?.id).toBe("l0");
    expect((calls[2]?.body as { id: string }[])[49]?.id).toBe("l449");
    expect(result.sent).toBe(450);
    expect(pendingCount(db)).toBe(0);
  });

  it("drops a refused entry, marks its row for a re-fetch and sends the next one", async () => {
    add(
      "brand.set",
      { id: "b1", name: "A", sells: "", status: "found" },
      { table: "brands", key: "b1" },
    );
    const second = add("deal.step", { id: "d1", step: 2 }, { table: "deals", key: "d1" });
    add(
      "brand.set",
      { id: "b3", name: "C", sells: "", status: "found" },
      { table: "brands", key: "b3" },
    );
    const { rest, calls } = fakeRest((_call, index) =>
      index === 1 ? new RestError("http", 403, "42501") : undefined,
    );

    const result = await uploader(rest).drain();

    expect(calls).toHaveLength(3);
    expect(calls[2]?.body).toEqual([{ id: "b3", name: "C", sells: "", status: "found" }]);
    expect(result).toMatchObject({ sent: 2, dropped: 1, stoppedOn: null });
    expect(droppedSeqs()).toEqual([second]);
    const code = db.prepare("SELECT code FROM _outbox_dropped").get()?.["code"];
    expect(code).toBe("42501");
    expect(refetchList()).toEqual([{ table: "deals", key: "d1" }]);
    expect(result.tables.has("deals")).toBe(false);
    expect(pendingCount(db)).toBe(0);
  });

  it("drops only the refused line of a refused run", async () => {
    addLog("l1");
    const bad = addLog("l2");
    addLog("l3");
    const { rest, calls } = fakeRest((call) => {
      const rows = call.body as { id: string }[];
      return rows.some((row) => row.id === "l2") ? new RestError("http", 403, "42501") : undefined;
    });

    const result = await uploader(rest).drain();

    expect(calls.map((call) => (call.body as { id: string }[]).map((row) => row.id))).toEqual([
      ["l1", "l2", "l3"],
      ["l1"],
      ["l2"],
      ["l3"],
    ]);
    expect(result).toMatchObject({ sent: 2, dropped: 1, stoppedOn: null });
    expect(droppedSeqs()).toEqual([bad]);
    expect(result.tables.has("activity_log")).toBe(true);
  });

  it("stops on a server that is behind and keeps everything", async () => {
    const first = add("channel.edit", {
      channelId: "UC1",
      field: "creator_stage",
      base: "new",
      next: "emailed",
      label: "@a",
    });
    add("profile.name", { name: "B" });
    const { rest, calls } = fakeRest(() => new RestError("http", 404, "PGRST202"));
    const lines: string[] = [];

    const result = await uploader(rest, lines).drain();

    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ sent: 0, dropped: 0, stoppedOn: "retry" });
    expect(pendingCount(db)).toBe(2);
    expect(attempts(first)).toBe(1);
    expect(droppedSeqs()).toEqual([]);
    expect(lines).toContain(`upload.retry kind=channel.edit seq=${String(first)} code=PGRST202`);
  });

  it("stops when offline and counts one attempt", async () => {
    const first = add("profile.name", { name: "B" });
    add("profile.name", { name: "C" });
    const { rest, calls } = fakeRest(() => new RestError("offline"));

    const result = await uploader(rest).drain();

    expect(calls).toHaveLength(1);
    expect(result.stoppedOn).toBe("retry");
    expect(attempts(first)).toBe(1);
    const lastCode = db.prepare("SELECT last_code FROM _outbox WHERE seq = ?").get(first);
    expect(lastCode?.["last_code"]).toBe("offline");
  });

  it.each([
    ["a 401 after the refresh", new RestError("http", 401, "PGRST303")],
    ["an ended session", new AuthError("ended")],
  ])("stops on %s without counting an attempt", async (_name, error) => {
    const first = add("profile.name", { name: "B" });
    const { rest } = fakeRest(() => error);

    const result = await uploader(rest).drain();

    expect(result.stoppedOn).toBe("session");
    expect(attempts(first)).toBe(0);
    expect(pendingCount(db)).toBe(1);
  });

  it("keeps an entry of a kind it doesn't know (a newer build's) and stops", async () => {
    const first = add("future.kind", { anything: 1 });
    add("profile.name", { name: "B" });
    const { rest, calls } = fakeRest();

    const result = await uploader(rest).drain();

    expect(calls).toHaveLength(0);
    expect(result.stoppedOn).toBe("retry");
    expect(attempts(first)).toBe(1);
    expect(droppedSeqs()).toEqual([]);
  });

  it("drops an unreadable payload of a known kind instead of jamming", async () => {
    const bad = add("deal.step", { id: "d1", step: "three" }, { table: "deals", key: "d1" });
    add("profile.name", { name: "B" });
    const { rest, calls } = fakeRest();

    const result = await uploader(rest).drain();

    expect(calls.map((call) => call.name)).toEqual(["profiles"]);
    expect(result).toMatchObject({ sent: 1, dropped: 1, stoppedOn: null });
    expect(droppedSeqs()).toEqual([bad]);
    expect(refetchList()).toEqual([{ table: "deals", key: "d1" }]);
  });

  it("sends only the session user's entries", async () => {
    add("profile.name", { name: "Theirs" }, null, other);
    add("profile.name", { name: "Mine" });
    const { rest, calls } = fakeRest();

    await uploader(rest).drain();

    expect(calls.map((call) => call.body)).toEqual([{ display_name: "Mine" }]);
    expect(pendingCount(db, other)).toBe(1);
  });

  it("never writes a payload into a log line", async () => {
    add("profile.name", { name: "SECRET_NAME" });
    addLog("l1", "SECRET_LOG");
    add("brand.set", { id: "b1", name: "SECRET_BRAND", sells: "", status: "found" });
    add("profile.name", { name: "SECRET_LATER" });
    const lines: string[] = [];
    const { rest } = fakeRest((call) =>
      call.name === "brands" ? new RestError("http", 400, "23514") : undefined,
    );
    await uploader(rest, lines).drain();
    const failing = fakeRest(() => new RestError("offline"));
    add("profile.name", { name: "SECRET_OFFLINE" });
    await uploader(failing.rest, lines).drain();

    expect(lines.length).toBeGreaterThan(3);
    expect(lines.join("\n")).not.toMatch(/SECRET/);
  });

  it("returns an empty result for an empty outbox", async () => {
    const { rest, calls } = fakeRest();
    const result = await uploader(rest).drain();
    expect(calls).toHaveLength(0);
    expect(result).toMatchObject({ sent: 0, dropped: 0, stoppedOn: null });
    expect(result.tables.size).toBe(0);
  });
});

describe("markRefetch", () => {
  it("adds each row once and survives a damaged list", () => {
    setMeta(db, refetchKey, "not json");
    markRefetch(db, { table: "deals", key: "d1" });
    markRefetch(db, { table: "deals", key: "d1" });
    markRefetch(db, { table: "brands", key: "d1" });
    expect(refetchList()).toEqual([
      { table: "deals", key: "d1" },
      { table: "brands", key: "d1" },
    ]);
  });
});
