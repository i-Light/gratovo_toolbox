import type { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase } from "../../db/open-database";
import { createSqliteSource } from "../sqlite-source";
import { listCreators, upsertCreator } from "./creators";
import { listConflicts, markResolved, replaceOpenConflicts } from "./conflicts";

let folder: string;
let db: DatabaseSync;

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "gratovo-conflicts-"));
  db = openDatabase(join(folder, "test.db"));
});

afterEach(async () => {
  db.close();
  await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const k1 = "11111111-1111-4111-8111-111111111111";
const k2 = "22222222-2222-4222-8222-222222222222";

function conflict(id: string, extra: Record<string, string | null> = {}) {
  return {
    id,
    channel_id: "UC1",
    channel_label: "@promptlab",
    field: "creator_stage",
    base_value: '"replied"',
    mine_value: '"emailed"',
    theirs_value: '"signed"',
    mine_actor_id: "u1",
    mine_actor_name: "Ada",
    theirs_actor_name: "Sara",
    detected_at: "2026-10-20T10:00:00.000000+00:00",
    resolved_at: null,
    updated_at: "2026-10-20T10:00:00.000000+00:00",
    ...extra,
  };
}

describe("conflicts", () => {
  it("lists values as display text and the other person's name", () => {
    replaceOpenConflicts(db, [
      conflict(k1),
      conflict(k2, {
        field: "channel_tags",
        mine_value: '["ai-tools","news"]',
        theirs_value: null,
        theirs_actor_name: null,
      }),
    ]);
    expect(listConflicts(db)).toEqual([
      {
        id: k1,
        creator: "UC1",
        label: "@promptlab",
        field: "creator_stage",
        mine: "emailed",
        theirs: "signed",
        theirName: "Sara",
      },
      {
        id: k2,
        creator: "UC1",
        label: "@promptlab",
        field: "channel_tags",
        mine: "ai-tools, news",
        theirs: "empty",
        theirName: "someone",
      },
    ]);
  });

  it("replaces the mirror: updates, adds and removes, keeping a local settling", () => {
    expect(replaceOpenConflicts(db, [conflict(k1), conflict(k2)])).toEqual(new Set([k1, k2]));
    expect(markResolved(db, k1)).toEqual({
      channelId: "UC1",
      field: "creator_stage",
      mine: "emailed",
      theirs: "signed",
    });
    const ids = replaceOpenConflicts(db, [conflict(k1, { theirs_value: '"parked"' })]);
    expect(ids).toEqual(new Set([k1]));
    expect(listConflicts(db)).toEqual([]);
    expect(db.prepare("SELECT theirs_value, resolved_locally FROM edit_conflicts").all()).toEqual([
      { theirs_value: '"parked"', resolved_locally: 1 },
    ]);
  });

  it("marks a conflict settled once, and not an unknown one", () => {
    replaceOpenConflicts(db, [conflict(k1)]);
    expect(markResolved(db, "nope")).toBeNull();
    expect(markResolved(db, k1)).not.toBeNull();
    expect(markResolved(db, k1)).toBeNull();
  });

  it("holds at most 100 in the list", () => {
    const rows = Array.from({ length: 120 }, (_, i) =>
      conflict(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`),
    );
    replaceOpenConflicts(db, rows);
    expect(listConflicts(db)).toHaveLength(100);
  });

  it("settles through the source: mine puts the stage back, theirs leaves it, and the frame drops it", async () => {
    upsertCreator(
      db,
      { id: "UC1", name: "Prompt Lab", handle: "@promptlab", stage: "signed", email: null },
      Date.UTC(2026, 9, 20),
    );
    replaceOpenConflicts(db, [conflict(k1), conflict(k2, { channel_id: "UC1" })]);
    const source = createSqliteSource(db, {
      source: "live",
      me: "u1",
      extras: {
        presence: () => ({ status: "away", doing: "" }),
        counts: () => ({
          today: 0,
          find: 0,
          reach: 0,
          close: 0,
          deliver: 0,
          plannedMinutes: 0,
        }),
        mateRun: () => null,
      },
    });
    expect((await source.frame()).conflicts.map((c) => c.id)).toEqual([k1, k2]);
    await source.write([{ kind: "conflict.resolve", id: k2, choice: "theirs" }]);
    expect(listCreators(db)[0]?.stage).toBe("signed");
    await source.write([{ kind: "conflict.resolve", id: k1, choice: "mine" }]);
    expect(listCreators(db)[0]?.stage).toBe("emailed");
    expect((await source.frame()).conflicts).toEqual([]);
  });
});
