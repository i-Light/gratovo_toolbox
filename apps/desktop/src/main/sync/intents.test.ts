import type { DatabaseSync } from "node:sqlite";

import type { DataSource } from "@gratovo/core/data";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSqliteSource } from "../data/sqlite-source";
import { pendingCount, upsertProfile } from "../data/repositories";
import { openDatabase } from "../db/open-database";

import { recordIntent } from "./intents";

const me = "11111111-1111-4111-8111-111111111111";
const line = "22222222-2222-4222-8222-222222222222";
const t0 = Date.parse("2026-10-21T10:00:00Z");

let db: DatabaseSync;
let source: DataSource;
let n: number;
let clock: number;

function entries(): { kind: string; payload: unknown; target: unknown }[] {
  return db
    .prepare("SELECT kind, payload, target_table, target_key FROM _outbox ORDER BY seq")
    .all()
    .map((r) => ({
      kind: String(r["kind"]),
      payload: JSON.parse(String(r["payload"])) as unknown,
      target: { table: r["target_table"], key: r["target_key"] },
    }));
}

function lineCount(): number {
  return Number(db.prepare("SELECT COUNT(*) AS c FROM activity_log").get()?.["c"]);
}

beforeEach(() => {
  db = openDatabase(":memory:");
  upsertProfile(db, { id: me, displayName: "Sam", role: "full", color: "#3B82F6" }, t0);
  n = 0;
  clock = t0;
  source = createSqliteSource(db, {
    source: "live",
    me,
    now: () => clock,
    extras: {
      presence: () => ({ status: "online", doing: "" }),
      counts: () => ({}) as never,
      mateRun: () => null,
    },
    onWrite: (d, write, applyLocal) => {
      recordIntent(d, {
        userId: me,
        write,
        applyLocal,
        now: clock,
        newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
      });
    },
  });
});

afterEach(() => {
  db.close();
});

describe("recordIntent", () => {
  it("me.name writes locally and queues the cleaned name", async () => {
    await source.write([{ kind: "me.name", name: "  Sam K  " }]);
    expect((await source.frame()).myName).toBe("Sam K");
    expect(entries()).toEqual([
      {
        kind: "profile.name",
        payload: { name: "Sam K" },
        target: { table: "profiles", key: me },
      },
    ]);
  });

  it("notify.set queues the switches", async () => {
    await source.write([{ kind: "notify.set", notify: { money: false } }]);
    expect(entries()).toEqual([
      {
        kind: "notify.set",
        payload: { switches: { money: false } },
        target: { table: "notification_switches", key: me },
      },
    ]);
  });

  it("notification.read queues nothing", async () => {
    await source.write([{ kind: "notification.read", id: "x", read: true }]);
    expect(pendingCount(db)).toBe(0);
  });

  it("log.add writes the line and queues the same row", async () => {
    await source.write([
      {
        kind: "log.add",
        id: line,
        at: t0,
        text: "Called Acme",
        ref: null,
        action: null,
        detail: null,
      },
    ]);
    expect(lineCount()).toBe(1);
    const [entry] = entries();
    expect(entry?.kind).toBe("activity.add");
    expect(entry?.target).toEqual({ table: "activity_log", key: line });
    expect(entry?.payload).toMatchObject({
      row: {
        id: line,
        at: "2026-10-21T10:00:00.000Z",
        actor_id: me,
        actor_name: "Sam",
        action: "note",
        entity_type: "app",
        entity_label: "Called Acme",
        detail: { text: "Called Acme" },
      },
    });
  });

  it("a line about a creator queues a row with its action, entity and reason", async () => {
    db.prepare(
      "INSERT INTO channel_state (channel_id, handle, updated_at) VALUES ('UC1', '@aiweekly', 'x')",
    ).run();
    db.prepare("INSERT INTO channels (channel_id, name) VALUES ('UC1', 'AI Weekly')").run();
    await source.write([
      {
        kind: "log.add",
        id: line,
        at: t0,
        text: "Rejected AI Weekly: too few views",
        ref: "UC1",
        action: "creator.reject",
        detail: "views",
      },
    ]);
    expect(entries()[0]?.payload).toEqual({
      row: {
        id: line,
        at: "2026-10-21T10:00:00.000Z",
        actor_id: me,
        actor_name: "Sam",
        actor_role: "full",
        action: "creator.reject",
        entity_type: "channel",
        entity_id: "UC1",
        entity_label: "AI Weekly",
        field: null,
        old_value: null,
        new_value: null,
        detail: { text: "Rejected AI Weekly: too few views", reason: "views" },
      },
    });
    // The local row is the same, and reads back the same.
    expect((await source.frame()).log).toEqual([
      {
        id: line,
        at: t0,
        who: me,
        text: "Rejected AI Weekly: too few views",
        ref: "UC1",
        action: "creator.reject",
        detail: "views",
      },
    ]);
  });

  it("rolls the local effect and the entry back together when a later write throws", async () => {
    await expect(
      source.write([
        { kind: "me.name", name: "Zed" },
        { kind: "log.add", id: line, at: t0, text: "a", ref: null, action: null, detail: null },
        { kind: "log.add", id: line, at: t0, text: "a", ref: null, action: null, detail: null },
      ]),
    ).rejects.toThrow();
    expect(pendingCount(db)).toBe(0);
    expect(lineCount()).toBe(0);
    expect((await source.frame()).myName).toBe("Sam");
  });

  it("undo of an unsent line deletes the line and its entry", async () => {
    await source.write([
      { kind: "log.add", id: line, at: t0, text: "a", ref: null, action: null, detail: null },
    ]);
    await source.write([{ kind: "log.remove", id: line }]);
    expect(lineCount()).toBe(0);
    expect(pendingCount(db)).toBe(0);
  });

  it("undo of a sent line queues one undo marker; redo queues a redo marker", async () => {
    await source.write([
      { kind: "log.add", id: line, at: t0, text: "a", ref: null, action: null, detail: null },
    ]);
    db.exec("DELETE FROM _outbox"); // as if sent
    clock += 1000;
    await source.write([{ kind: "log.remove", id: line }]);
    expect(lineCount()).toBe(2);
    expect((await source.frame()).log).toEqual([]);
    expect(entries()).toHaveLength(1);
    expect(entries()[0]?.payload).toMatchObject({
      row: {
        action: "undo",
        entity_type: "activity_log",
        entity_id: line,
        entity_label: "a",
        actor_id: me,
      },
    });
    // The same instant: the redo still sorts after the undo.
    await source.write([
      { kind: "log.add", id: line, at: t0, text: "a", ref: null, action: null, detail: null },
    ]);
    expect(lineCount()).toBe(3);
    expect(entries()).toHaveLength(2);
    expect(entries()[1]?.payload).toMatchObject({ row: { action: "redo", entity_id: line } });
    expect((await source.frame()).log.map((l) => l.id)).toEqual([line]);
  });

  describe("the structured kinds", () => {
    const ch = "UC1";

    function seedCreator(stage: string | null): void {
      db.prepare(
        "INSERT INTO channel_state (channel_id, handle, creator_stage, updated_at) VALUES (?, ?, ?, ?)",
      ).run(ch, "@aiweekly", stage, "2026-10-21T09:00:00+00:00");
    }

    function seedConflict(): void {
      db.prepare(
        `INSERT INTO edit_conflicts (id, channel_id, channel_label, field, base_value, mine_value,
           theirs_value, mine_actor_name, theirs_actor_name, detected_at, updated_at)
         VALUES ('c1', ?, '@aiweekly', 'creator_stage', '"new"', '"emailed"', '"replied"', 'Sam', 'Sara', 'x', 'x')`,
      ).run(ch);
    }

    function stored(): unknown {
      return db.prepare("SELECT creator_stage FROM channel_state WHERE channel_id = ?").get(ch)?.[
        "creator_stage"
      ];
    }

    it("creator.stage queues channel.edit with the column as base, taken before the write", async () => {
      seedCreator("emailed");
      await source.write([
        { kind: "creator.stage", id: ch, stage: "replied", handle: "", name: "" },
      ]);
      expect(stored()).toBe("replied");
      expect(entries()).toEqual([
        {
          kind: "channel.edit",
          payload: {
            channelId: ch,
            field: "creator_stage",
            base: "emailed",
            next: "replied",
            label: "@aiweekly",
          },
          target: { table: "channel_state", key: ch },
        },
      ]);
    });

    it("a first stage edit has a null base", async () => {
      seedCreator(null);
      await source.write([
        { kind: "creator.stage", id: ch, stage: "emailed", handle: "", name: "" },
      ]);
      expect(entries()[0]?.payload).toMatchObject({ base: null, next: "emailed" });
    });

    it("an edit to the same stage queues nothing", async () => {
      seedCreator("emailed");
      await source.write([
        { kind: "creator.stage", id: ch, stage: "emailed", handle: "", name: "" },
      ]);
      expect(pendingCount(db)).toBe(0);
    });

    function tags(id = ch): unknown {
      const row = db.prepare("SELECT channel_tags FROM channel_state WHERE channel_id = ?").get(id);
      return row === undefined ? undefined : (JSON.parse(String(row["channel_tags"])) as unknown);
    }

    function edits(): { field: unknown; base: unknown; next: unknown; label: unknown }[] {
      return entries().map((e) => {
        const p = e.payload as Record<string, unknown>;
        return { field: p["field"], base: p["base"], next: p["next"], label: p["label"] };
      });
    }

    const freshId = "UCagentLabAiTools000001x";

    it("a stage on a creator with no row creates it and queues the edit with a null base", async () => {
      await source.write([
        {
          kind: "creator.stage",
          id: freshId,
          stage: "shortlisted",
          handle: "@agentlab",
          name: "Agent Lab",
        },
      ]);
      expect(
        db.prepare("SELECT creator_stage FROM channel_state WHERE channel_id = ?").get(freshId)?.[
          "creator_stage"
        ],
      ).toBe("shortlisted");
      expect(entries()).toEqual([
        {
          kind: "channel.edit",
          payload: {
            channelId: freshId,
            field: "creator_stage",
            base: null,
            next: "shortlisted",
            label: "@agentlab",
          },
          target: { table: "channel_state", key: freshId },
        },
      ]);
    });

    it("a stage on an unknown id that is not a channel id creates nothing and queues nothing", async () => {
      for (const id of ["UC_new", "agent-lab", `UC${"a".repeat(23)}`]) {
        await source.write([
          { kind: "creator.stage", id, stage: "rejected", handle: "@x", name: "X", reason: "ai" },
        ]);
        expect(db.prepare("SELECT 1 FROM channel_state WHERE channel_id = ?").get(id)).toBe(
          undefined,
        );
      }
      expect(entries()).toEqual([]);
    });

    it("a reject queues the stage, then the tags with the stored list as base", async () => {
      seedCreator("shortlisted");
      db.prepare("UPDATE channel_state SET channel_tags = ? WHERE channel_id = ?").run(
        JSON.stringify(["qualified"]),
        ch,
      );
      await source.write([
        {
          kind: "creator.stage",
          id: ch,
          stage: "rejected",
          handle: "@aiweekly",
          name: "AI Weekly",
          reason: "posting",
        },
      ]);
      expect(tags()).toEqual(["qualified", "inactive"]);
      expect(edits()).toEqual([
        { field: "creator_stage", base: "shortlisted", next: "rejected", label: "@aiweekly" },
        {
          field: "channel_tags",
          base: ["qualified"],
          next: ["qualified", "inactive"],
          label: "@aiweekly",
        },
      ]);
      expect(entries().every((e) => e.kind === "channel.edit")).toBe(true);
    });

    it("a reject of a channel with no row has a null stage base and an empty tags base", async () => {
      await source.write([
        {
          kind: "creator.stage",
          id: freshId,
          stage: "rejected",
          handle: "@agentlab",
          name: "Agent Lab",
          reason: "views",
        },
      ]);
      expect(edits()).toEqual([
        { field: "creator_stage", base: null, next: "rejected", label: "@agentlab" },
        { field: "channel_tags", base: [], next: ["irrelevant"], label: "@agentlab" },
      ]);
    });

    it("bringing back queues the tags only when they change; undo goes the same way", async () => {
      seedCreator("new");
      const reject = {
        kind: "creator.stage",
        id: ch,
        stage: "rejected",
        handle: "@aiweekly",
        name: "AI Weekly",
        reason: "ai",
      } as const;
      const back = {
        kind: "creator.stage",
        id: ch,
        stage: "new",
        handle: "@aiweekly",
        name: "",
      } as const;
      await source.write([reject]);
      await source.write([back]);
      expect(edits().slice(2)).toEqual([
        { field: "creator_stage", base: "rejected", next: "new", label: "@aiweekly" },
        { field: "channel_tags", base: ["irrelevant"], next: [], label: "@aiweekly" },
      ]);
      // A rejected creator with no rejecting tag (the old app rejected it by vetting only) has
      // nothing to take off: only the stage goes.
      db.exec("DELETE FROM _outbox");
      db.prepare(
        "UPDATE channel_state SET creator_stage = NULL, vetting_status = 'rejected' WHERE channel_id = ?",
      ).run(ch);
      await source.write([back]);
      expect(edits()).toEqual([
        { field: "creator_stage", base: null, next: "new", label: "@aiweekly" },
      ]);
    });

    it("a never contact queues the stage and no tags", async () => {
      seedCreator("new");
      await source.write([
        { kind: "creator.stage", id: ch, stage: "never", handle: "@aiweekly", name: "" },
      ]);
      expect(edits().map((e) => e.field)).toEqual(["creator_stage"]);
      expect(tags()).toEqual([]);
    });

    it("keeping your tags in a conflict puts them back here and sends them", async () => {
      seedCreator("rejected");
      db.prepare(
        `INSERT INTO edit_conflicts (id, channel_id, channel_label, field, base_value, mine_value,
           theirs_value, mine_actor_name, theirs_actor_name, detected_at, updated_at)
         VALUES ('t1', ?, '@aiweekly', 'channel_tags', '[]', '["irrelevant"]', '["qualified"]',
                 'Sam', 'Sara', 'x', 'x')`,
      ).run(ch);
      expect((await source.frame()).conflicts).toMatchObject([
        { id: "t1", field: "channel_tags", mine: "irrelevant", theirs: "qualified" },
      ]);
      await source.write([{ kind: "conflict.resolve", id: "t1", choice: "mine" }]);
      expect(tags()).toEqual(["irrelevant"]);
      expect(
        db.prepare("SELECT archive_due_at FROM channel_state WHERE channel_id = ?").get(ch)?.[
          "archive_due_at"
        ],
      ).toBe(new Date(t0 + 7 * 24 * 60 * 60 * 1000).toISOString());
      expect(entries().map((e) => e.payload)).toEqual([
        { id: "t1", resolution: "mine", value: ["irrelevant"] },
      ]);
    });

    it("brand.set writes locally and queues the four columns", async () => {
      await source.write([
        { kind: "brand.set", id: "b1", name: "Acme AI", sells: "GPUs", status: "active" },
      ]);
      expect(db.prepare("SELECT name FROM brands WHERE id = 'b1'").get()?.["name"]).toBe("Acme AI");
      expect(entries()).toEqual([
        {
          kind: "brand.set",
          payload: { id: "b1", name: "Acme AI", sells: "GPUs", status: "active" },
          target: { table: "brands", key: "b1" },
        },
      ]);
    });

    it("deal.step queues the step", async () => {
      await source.write([{ kind: "deal.step", id: "d1", step: 3 }]);
      expect(entries()).toEqual([
        {
          kind: "deal.step",
          payload: { id: "d1", step: 3 },
          target: { table: "deals", key: "d1" },
        },
      ]);
    });

    it("conflict.resolve queues the chosen side's value and settles locally", async () => {
      seedCreator("replied");
      seedConflict();
      await source.write([{ kind: "conflict.resolve", id: "c1", choice: "mine" }]);
      expect(stored()).toBe("emailed");
      expect((await source.frame()).conflicts).toEqual([]);
      expect(entries()).toEqual([
        {
          kind: "conflict.resolve",
          payload: { id: "c1", resolution: "mine", value: "emailed" },
          target: { table: "channel_state", key: ch },
        },
      ]);
    });

    it("theirs sends their value; a settled or unknown conflict sends nothing", async () => {
      seedCreator("replied");
      seedConflict();
      await source.write([
        { kind: "conflict.resolve", id: "c1", choice: "theirs" },
        { kind: "conflict.resolve", id: "c1", choice: "mine" },
        { kind: "conflict.resolve", id: "zz", choice: "mine" },
      ]);
      expect(entries().map((e) => e.payload)).toEqual([
        { id: "c1", resolution: "theirs", value: "replied" },
      ]);
    });
  });
});
