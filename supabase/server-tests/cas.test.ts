// Compare-and-set and conflicts against a real PostgREST, with the app's own modules: a stage
// change through `recordIntent` and the uploader, a clash with a teammate's edit, the conflict
// and its notification coming back through `refreshWhole`, and resolving it with "mine".
// Everything is made up and removed again at the end. The service-role key is read from the
// environment, only ever sent in a header, and never written anywhere.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { markResolved, setCreatorStage } from "../../apps/desktop/src/main/data/repositories";
import { openDatabase } from "../../apps/desktop/src/main/db/open-database";
import { createNetwork } from "../../apps/desktop/src/main/net/network";
import type { SecretStore } from "../../apps/desktop/src/main/secret-store";
import { createAuthClient } from "../../apps/desktop/src/main/supabase/auth-client";
import { readSupabaseConfig } from "../../apps/desktop/src/main/supabase/config";
import { createRest } from "../../apps/desktop/src/main/supabase/rest";
import type { Rest } from "../../apps/desktop/src/main/supabase/rest";
import { createSessionManager } from "../../apps/desktop/src/main/supabase/session";
import { syncConflictNotices } from "../../apps/desktop/src/main/sync/conflict-notices";
import { recordIntent } from "../../apps/desktop/src/main/sync/intents";
import { createPuller } from "../../apps/desktop/src/main/sync/puller";
import { createUploader } from "../../apps/desktop/src/main/sync/uploader";
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
const network = createNetwork({ allowedOrigins: [config.origin], fetch });
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

/** A call to the local stack as the service role (bypasses the rules; for reading and cleaning). */
async function asService(path: string, method: "GET" | "DELETE"): Promise<unknown> {
  const response = await fetch(`${fixture.url}/rest/v1/${path}`, {
    method,
    headers: { apikey: secretKey, Prefer: method === "GET" ? "" : "return=minimal" },
  });
  if (!response.ok) {
    throw new Error(`${method} ${path.split("?")[0] ?? ""} answered ${String(response.status)}`);
  }
  const text = await response.text();
  return text === "" ? null : (JSON.parse(text) as unknown);
}

const a = fixture.member;
const b = fixture.owner;
const run = Date.now().toString(36);
const now = (): number => Date.now();

let folder: string;
let restA: Rest;
let restB: Rest;
const closers: (() => void)[] = [];
const channelIds: string[] = [];
let counter = 0;

async function signInAs(person: { email: string; password: string }): Promise<Rest> {
  const manager = createSessionManager({ auth, store: memoryStore(), now });
  const session = await manager.start(await auth.signIn(person.email, person.password));
  closers.push(() => {
    manager.close();
  });
  return createRest(network, config, session);
}

beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), "gratovo-server-cas-"));
  restA = await signInAs(a);
  restB = await signInAs(b);
});

afterAll(async () => {
  for (const close of closers) {
    close();
  }
  for (const id of channelIds) {
    const quoted = encodeURIComponent(id);
    await asService(`edit_conflicts?channel_id=eq.${quoted}`, "DELETE").catch(() => undefined);
    await asService(`channel_state?channel_id=eq.${quoted}`, "DELETE").catch(() => undefined);
  }
  await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

function freshDb(): DatabaseSync {
  counter += 1;
  return openDatabase(join(folder, `case-${String(counter)}.db`));
}

function uploader(db: DatabaseSync) {
  return createUploader({ db, rest: restA, userId: a.id, now, log: () => undefined });
}

function puller(db: DatabaseSync) {
  return createPuller({ db, rest: restA, now, log: () => undefined });
}

/** A creator that exists on A's computer only, as a first edit meets it. */
function localCreator(db: DatabaseSync, id: string, handle: string): void {
  channelIds.push(id);
  db.prepare("INSERT INTO channel_state (channel_id, handle, updated_at) VALUES (?, ?, ?)").run(
    id,
    handle,
    new Date().toISOString(),
  );
}

function stageOf(db: DatabaseSync, id: string): unknown {
  return db.prepare("SELECT creator_stage FROM channel_state WHERE channel_id = ?").get(id)?.[
    "creator_stage"
  ];
}

async function serverRow(id: string): Promise<Record<string, unknown> | undefined> {
  const rows = (await asService(
    `channel_state?select=handle,creator_stage,last_edited_by&channel_id=eq.${encodeURIComponent(id)}`,
    "GET",
  )) as Record<string, unknown>[];
  return rows[0];
}

let nextId = 0;
function newId(): string {
  nextId += 1;
  return `00000000-0000-4000-8000-${String(nextId).padStart(12, "0")}`;
}

function stageWrite(db: DatabaseSync, id: string, stage: "shortlisted" | "emailed" | "replied") {
  recordIntent(db, {
    userId: a.id,
    write: { kind: "creator.stage", id, stage },
    applyLocal: () => {
      setCreatorStage(db, id, stage);
    },
    now: now(),
    newId,
  });
}

function conflictNotices(db: DatabaseSync): string[] {
  return db
    .prepare("SELECT id FROM notifications WHERE id LIKE 'conflict:%'")
    .all()
    .map((row) => String(row["id"]));
}

describe("compare-and-set and conflicts over real PostgREST", () => {
  it("a first edit applies and creates the row named by its label", async () => {
    const db = freshDb();
    const id = `UC-cas-first-${run}`;
    localCreator(db, id, `@ai-tools-first-${run}`);
    stageWrite(db, id, "shortlisted");

    const result = await uploader(db).drain();
    expect(result).toMatchObject({ sent: 1, dropped: 0, stoppedOn: null });

    const server = await serverRow(id);
    expect(server?.["creator_stage"]).toBe("shortlisted");
    expect(server?.["handle"]).toBe(`@ai-tools-first-${run}`);
    expect(server?.["last_edited_by"]).toBe(a.id);

    await puller(db).pull(60_000);
    expect(stageOf(db, id)).toBe("shortlisted");
    db.close();
  });

  it("a stale base files a conflict, keeps the server's value, and resolving with mine applies it", async () => {
    const db = freshDb();
    const id = `UC-cas-clash-${run}`;
    const handle = `@ai-news-clash-${run}`;
    localCreator(db, id, handle);

    // A's first edit, then A's computer learns the server's row.
    stageWrite(db, id, "shortlisted");
    expect((await uploader(db).drain()).sent).toBe(1);
    await puller(db).pull(60_000);
    expect(stageOf(db, id)).toBe("shortlisted");

    // B changes it on the server; A has not pulled yet and changes it from the stale base.
    const outcome = await restB.rpc<string>("apply_channel_edit", {
      p_channel_id: id,
      p_field: "creator_stage",
      p_base: "shortlisted",
      p_new: "emailed",
      p_label: handle,
    });
    expect(outcome).toBe("applied");
    stageWrite(db, id, "replied");
    const clash = await uploader(db).drain();
    expect(clash).toMatchObject({ sent: 1, dropped: 0, stoppedOn: null });

    // The server kept B's value; A's re-fetch brings it.
    expect((await serverRow(id))?.["creator_stage"]).toBe("emailed");
    await puller(db).refetch();
    expect(stageOf(db, id)).toBe("emailed");

    // The open conflict and its notification come with the whole-table refresh.
    const changed = await refreshWhole(restA, db, a.id, { afterConflicts: syncConflictNotices });
    expect(changed.has("conflicts")).toBe(true);
    const open = db
      .prepare("SELECT id, mine_value, theirs_value FROM edit_conflicts WHERE channel_id = ?")
      .all(id);
    expect(open).toHaveLength(1);
    const conflictId = String(open[0]?.["id"]);
    expect(JSON.parse(String(open[0]?.["mine_value"]))).toBe("replied");
    expect(JSON.parse(String(open[0]?.["theirs_value"]))).toBe("emailed");
    expect(conflictNotices(db)).toEqual([`conflict:${conflictId}`]);

    // A keeps their own value.
    recordIntent(db, {
      userId: a.id,
      write: { kind: "conflict.resolve", id: conflictId, choice: "mine" },
      applyLocal: () => {
        markResolved(db, conflictId);
      },
      now: now(),
      newId,
    });
    const resolved = await uploader(db).drain();
    expect(resolved).toMatchObject({ sent: 1, dropped: 0, stoppedOn: null });

    expect((await serverRow(id))?.["creator_stage"]).toBe("replied");
    const closed = (await asService(
      `edit_conflicts?select=resolved_at,resolution&id=eq.${conflictId}`,
      "GET",
    )) as { resolved_at: string | null; resolution: string }[];
    expect(closed[0]?.resolution).toBe("mine");
    expect(closed[0]?.resolved_at).not.toBeNull();

    // The next refresh finds no open conflict and removes the notification.
    await puller(db).refetch();
    await refreshWhole(restA, db, a.id, { afterConflicts: syncConflictNotices });
    expect(db.prepare("SELECT id FROM edit_conflicts WHERE channel_id = ?").all(id)).toEqual([]);
    expect(conflictNotices(db)).toEqual([]);
    db.close();
  });
});
