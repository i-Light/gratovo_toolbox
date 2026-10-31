import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DatabaseTooNewError, migrate, type Migration } from "./migrate";
import { migrations } from "./migrations";
import { backfillStageEventsSql, restampStageEventsSql } from "./migrations/0007-insights";
import { backfillDealEventsSql } from "./migrations/0009-deal-events";

let db: DatabaseSync;

beforeEach(() => {
  db = new DatabaseSync(":memory:");
});

afterEach(() => {
  db.close();
});

function version(): number {
  return Number(db.prepare("PRAGMA user_version").get()?.["user_version"]);
}

function tables(): string[] {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => String(row["name"]));
}

/** A made-up migration one past the real ones. */
const next: Migration = {
  version: migrations.length + 1,
  name: "next",
  sql: "CREATE TABLE next_one (id TEXT) STRICT;",
};

describe("migrate", () => {
  it("throws the migration's own error when its SQL ended the transaction first", () => {
    const ends: Migration = { version: 1, name: "ends", sql: "COMMIT; NOT VALID SQL;" };
    expect(() => {
      migrate(db, [ends]);
    }).toThrow(/syntax error/);
  });

  it("numbers the real migrations 1..n with no gap", () => {
    expect(migrations.map((m) => m.version)).toEqual(migrations.map((_, i) => i + 1));
  });

  it("creates Reach's three outreach tables (migration 4)", () => {
    migrate(db);
    expect(tables()).toEqual(
      expect.arrayContaining(["outreach_drafts", "outreach_messages", "outreach_sequences"]),
    );
    expect(migrations[3]?.name).toBe("outreach");
    // The gmail id is unique, a state outside the list is refused.
    const message = db.prepare(
      "INSERT INTO outreach_messages (id, channel_id, direction, body, at, gmail_message_id) VALUES (?, 'UCa', 'in', 'hi', 1, 'g1')",
    );
    message.run("m1");
    expect(() => message.run("m2")).toThrow(/UNIQUE/);
    expect(() => {
      db.exec(
        "INSERT INTO outreach_drafts (id, channel_id, kind, state, created_at, updated_at) VALUES ('d', 'UCa', 'first', 'bogus', 1, 1)",
      );
    }).toThrow(/CHECK/);
  });

  it("adds the draft goal column (migration 6)", () => {
    migrate(db);
    expect(migrations[5]?.name).toBe("draft-goal");
    db.exec(
      "INSERT INTO outreach_drafts (id, channel_id, kind, state, goal, created_at, updated_at) VALUES ('d', 'UCa', 'reply', 'drafting', 'decline', 1, 1)",
    );
    expect(() => {
      db.exec("UPDATE outreach_drafts SET goal = 'bogus'");
    }).toThrow(/CHECK/);
    db.exec("UPDATE outreach_drafts SET goal = NULL");
  });

  describe("insights (migration 7)", () => {
    const events = (): Record<string, unknown>[] =>
      db.prepare("SELECT channel_id, stage, at, source FROM stage_events ORDER BY id").all();
    const state = (id: string, stage: string | null): void => {
      db.prepare(
        "INSERT INTO channel_state (channel_id, handle, creator_stage, updated_at) VALUES (?, '@ai', ?, '2026-01-01T00:00:00Z')",
      ).run(id, stage);
    };

    it("creates the two tables and refuses a source outside the list", () => {
      migrate(db);
      expect(migrations[6]?.name).toBe("insights");
      expect(tables()).toEqual(expect.arrayContaining(["stage_events", "catalog_weeks"]));
      expect(() => {
        db.exec(
          "INSERT INTO stage_events (channel_id, stage, at, source) VALUES ('c', 's', 1, 'x')",
        );
      }).toThrow(/CHECK/);
    });

    it("writes an event when a creator is inserted with a stage, within a second of now", () => {
      migrate(db);
      const before = Date.now();
      state("c1", "shortlisted");
      const [row] = events();
      expect(row).toMatchObject({ channel_id: "c1", stage: "shortlisted", source: "change" });
      expect(Number(row?.["at"])).toBeGreaterThanOrEqual(before - 1000);
      expect(Number(row?.["at"])).toBeLessThanOrEqual(Date.now() + 1000);
    });

    it("writes nothing for a NULL stage or an update to the same stage", () => {
      migrate(db);
      state("c1", null);
      expect(events()).toEqual([]);
      db.exec("UPDATE channel_state SET creator_stage = 'new' WHERE channel_id = 'c1'");
      expect(events()).toHaveLength(1);
      db.exec("UPDATE channel_state SET creator_stage = 'new' WHERE channel_id = 'c1'");
      db.exec("UPDATE channel_state SET creator_stage = NULL WHERE channel_id = 'c1'");
      expect(events()).toHaveLength(1);
    });

    it("writes one event when the stage changes, including through an upsert", () => {
      migrate(db);
      state("c1", "new");
      db.exec("UPDATE channel_state SET creator_stage = 'rejected' WHERE channel_id = 'c1'");
      expect(events().map((e) => e["stage"])).toEqual(["new", "rejected"]);
      const upsert = db.prepare(
        `INSERT INTO channel_state (channel_id, handle, creator_stage, updated_at)
         VALUES ('c1', '@ai', ?, 'x')
         ON CONFLICT (channel_id) DO UPDATE SET creator_stage = excluded.creator_stage`,
      );
      upsert.run("emailed");
      upsert.run("emailed");
      expect(events().map((e) => e["stage"])).toEqual(["new", "rejected", "emailed"]);
    });

    it("fills the events backwards from the log and the messages, without duplicates", () => {
      migrate(db);
      const line = db.prepare(
        `INSERT INTO activity_log (id, at, at_ms, actor_name, actor_role, action, entity_type, entity_id)
         VALUES (?, ?, ?, 'Me', 'owner', ?, 'channel', ?)`,
      );
      const day = (d: string): string => `2026-03-0${d}T10:00:00.000Z`;
      line.run("l1", day("1"), Date.parse(day("1")), "creator.reject", "c1");
      line.run("l2", day("2"), Date.parse(day("2")), "creator.reject", "c1");
      line.run("l3", day("3"), null, "creator.shortlist", "c2");
      line.run("l4", day("4"), null, "creator.never", "c3");
      const message = db.prepare(
        `INSERT INTO outreach_messages (id, channel_id, direction, kind, body, at, peer, reading)
         VALUES (?, ?, ?, ?, 'x', ?, ?, ?)`,
      );
      message.run("m1", "c2", "out", "first", 200, null, null);
      message.run("m2", "c2", "out", "first", 100, null, null);
      message.run("m3", "c2", "out", "followUp", 50, null, null);
      message.run("m4", "c2", "in", "reply", 150, "mailer-daemon@x.com", null);
      message.run("m5", "c2", "in", "reply", 160, "a@b.com", '{"replyType":"any.bounce"}');
      message.run("m6", "c2", "in", "reply", 300, "a@b.com", '{"replyType":"inf.gives_rate"}');
      message.run("m7", "c2", "in", "reply", 400, "a@b.com", null);
      db.exec(backfillStageEventsSql);
      db.exec(backfillStageEventsSql);
      const rows = events().map((e) =>
        [e["channel_id"], e["stage"], e["at"], e["source"]].join(" "),
      );
      expect(rows.sort()).toEqual(
        [
          `c1 rejected ${String(Date.parse(day("1")))} log`,
          `c2 shortlisted ${String(Date.parse(day("3")))} log`,
          "c2 emailed 100 message",
          "c2 replied 300 message",
          `c3 never ${String(Date.parse(day("4")))} log`,
        ].sort(),
      );
    });

    it("skips lines an undo hides and lines whose time can't be read, so it can't fail", () => {
      migrate(db, migrations.slice(0, 6));
      const line = db.prepare(
        `INSERT INTO activity_log (id, at, at_ms, actor_name, actor_role, action, entity_type, entity_id)
         VALUES (?, ?, ?, 'Me', 'owner', ?, ?, ?)`,
      );
      line.run("l1", "not a time", null, "creator.reject", "channel", "c1");
      line.run("l2", "2026-03-01T10:00:00.000Z", 1000, "creator.shortlist", "channel", "c2");
      line.run("u1", "2026-03-01T11:00:00.000Z", 2000, "undo", "activity_log", "l2");
      line.run("l3", "2026-03-02T10:00:00.000Z", 3000, "creator.shortlist", "channel", "c3");
      line.run("u2", "2026-03-02T11:00:00.000Z", 4000, "undo", "activity_log", "l3");
      line.run("r2", "2026-03-02T12:00:00.000Z", 5000, "redo", "activity_log", "l3");
      migrate(db);
      expect(version()).toBe(migrations.length);
      expect(events()).toEqual([
        { channel_id: "c3", stage: "shortlisted", at: 3000, source: "log" },
      ]);
    });

    it("restamps events written in bulk with the times the log knows, else updated_at", () => {
      migrate(db);
      state("c1", "shortlisted");
      state("c2", "signed");
      db.prepare(
        `INSERT INTO activity_log (id, at, at_ms, actor_name, actor_role, action, entity_type, entity_id)
         VALUES ('l1', '2026-03-01T10:00:00.000Z', 1000, 'Me', 'owner', 'creator.shortlist', 'channel', 'c1')`,
      ).run();
      db.exec(restampStageEventsSql);
      expect(events()).toEqual([
        { channel_id: "c1", stage: "shortlisted", at: 1000, source: "log" },
        {
          channel_id: "c2",
          stage: "signed",
          at: Date.parse("2026-01-01T00:00:00Z"),
          source: "change",
        },
      ]);
    });
  });

  it("builds a fresh database at the latest version", () => {
    migrate(db);
    expect(version()).toBe(migrations.length);
    expect(tables()).toEqual(
      expect.arrayContaining([
        "_meta",
        "activity_log",
        "brands",
        "channel_state",
        "channels",
        "deals",
        "local_settings",
        "notifications",
        "profiles",
      ]),
    );
  });

  it("changes nothing when run again", () => {
    migrate(db);
    const before = tables();
    migrate(db);
    expect(version()).toBe(migrations.length);
    expect(tables()).toEqual(before);
  });

  it("applies only the new migration to an up-to-date database", () => {
    migrate(db);
    db.exec("INSERT INTO _meta (key, value) VALUES ('kept', 'yes')");
    migrate(db, [...migrations, next]);
    expect(version()).toBe(migrations.length + 1);
    expect(tables()).toContain("next_one");
    expect(db.prepare("SELECT value FROM _meta WHERE key = 'kept'").get()?.["value"]).toBe("yes");
  });

  it("refuses a database newer than the list", () => {
    migrate(db, [...migrations, next]);
    expect(() => {
      migrate(db);
    }).toThrow(DatabaseTooNewError);
    expect(version()).toBe(migrations.length + 1);
  });

  it("leaves the version and no partial table when a migration fails", () => {
    migrate(db);
    const bad: Migration = {
      version: migrations.length + 1,
      name: "bad",
      sql: "CREATE TABLE half (id TEXT) STRICT; CREATE TABLE half (id TEXT) STRICT;",
    };
    expect(() => {
      migrate(db, [...migrations, bad]);
    }).toThrow();
    expect(version()).toBe(migrations.length);
    expect(tables()).not.toContain("half");
  });

  it("makes the app columns nullable and the tables strict", () => {
    migrate(db);
    db.exec(
      "INSERT INTO channel_state (channel_id, handle, updated_at) VALUES ('c1', '@ai', '2026-01-01T00:00:00Z')",
    );
    const row = db.prepare("SELECT creator_stage FROM channel_state WHERE channel_id = 'c1'").get();
    expect(row?.["creator_stage"]).toBeNull();
    expect(() => {
      db.exec(
        "INSERT INTO notifications (id, at, icon, text, sub, go_screen) VALUES ('n', 'x', 'i', 't', 's', 'g')",
      );
    }).toThrow();
  });
});

describe("details (migration 8)", () => {
  it("creates the three local detail tables", () => {
    migrate(db);
    expect(migrations[7]?.name).toBe("details");
    expect(tables()).toEqual(
      expect.arrayContaining(["brand_details", "deal_details", "creator_details"]),
    );
  });

  it("gives a deal's detail row its defaults and refuses a wrong type", () => {
    migrate(db);
    db.exec("INSERT INTO deal_details (deal_id) VALUES ('d1')");
    expect(db.prepare("SELECT * FROM deal_details").get()).toMatchObject({
      checks: "[]",
      video_count: 1,
      videos_delivered: 0,
      script_approved: 0,
      clauses: "[]",
      model: null,
    });
    db.exec("INSERT INTO brand_details (brand_id) VALUES ('b1')");
    expect(db.prepare("SELECT seen, status FROM brand_details").get()).toMatchObject({
      seen: "[]",
      status: null,
    });
    db.exec("INSERT INTO creator_details (channel_id) VALUES ('UCa')");
    expect(db.prepare("SELECT locks, socials FROM creator_details").get()).toMatchObject({
      locks: "[]",
      socials: "{}",
    });
    expect(() => {
      db.exec("INSERT INTO deal_details (deal_id, due_at) VALUES ('d2', 'soon')");
    }).toThrow(/cannot store TEXT/);
  });
});

describe("deal and brand events (migration 9)", () => {
  function deal(id: string, step: number | null, createdAt = "2026-03-01T10:00:00.000Z"): void {
    db.prepare(
      `INSERT INTO deals (id, brand_id, channel_id, flow_step, created_at, updated_at)
       VALUES (?, 'b1', 'c1', ?, ?, ?)`,
    ).run(id, step, createdAt, createdAt);
  }
  function brand(id: string, status: string | null, createdAt = "2026-03-01T10:00:00.000Z"): void {
    db.prepare(
      `INSERT INTO brands (id, name, status, created_at, updated_at) VALUES (?, 'AI Co', ?, ?, ?)`,
    ).run(id, status, createdAt, createdAt);
  }
  const dealEvents = () =>
    db.prepare("SELECT deal_id, step, source FROM deal_events ORDER BY id").all();
  const brandEvents = () =>
    db.prepare("SELECT brand_id, status, source FROM brand_events ORDER BY id").all();

  it("creates both tables, and refuses an unknown source", () => {
    migrate(db);
    expect(migrations[8]?.name).toBe("deal-events");
    expect(tables()).toEqual(expect.arrayContaining(["deal_events", "brand_events"]));
    expect(() => {
      db.exec("INSERT INTO deal_events (deal_id, step, at, source) VALUES ('d', 1, 1, 'x')");
    }).toThrow(/CHECK/);
    expect(() => {
      db.exec("INSERT INTO brand_events (brand_id, status, at, source) VALUES ('b', 's', 1, 'x')");
    }).toThrow(/CHECK/);
  });

  it("writes a deal event on insert and when the step changes, through an upsert too", () => {
    migrate(db);
    const before = Date.now();
    deal("d1", 2);
    deal("d2", null);
    expect(dealEvents()).toEqual([{ deal_id: "d1", step: 2, source: "change" }]);
    const at = Number(db.prepare("SELECT at FROM deal_events").get()?.["at"]);
    expect(at).toBeGreaterThanOrEqual(before - 1000);
    expect(at).toBeLessThanOrEqual(Date.now() + 1000);
    db.exec("UPDATE deals SET flow_step = 2 WHERE id = 'd1'");
    db.exec("UPDATE deals SET flow_step = 3 WHERE id = 'd1'");
    db.exec("UPDATE deals SET flow_step = NULL WHERE id = 'd1'");
    db.prepare(
      `INSERT INTO deals (id, brand_id, channel_id, flow_step, created_at, updated_at)
       VALUES ('d1', 'b1', 'c1', 4, 'x', 'x')
       ON CONFLICT (id) DO UPDATE SET flow_step = excluded.flow_step`,
    ).run();
    expect(dealEvents().map((e) => e["step"])).toEqual([2, 3, 4]);
  });

  it("writes a brand event on insert and when the status changes", () => {
    migrate(db);
    brand("b1", "found");
    brand("b2", null);
    db.exec("UPDATE brands SET status = 'found' WHERE id = 'b1'");
    db.exec("UPDATE brands SET status = 'pitched' WHERE id = 'b1'");
    db.exec("UPDATE brands SET name = 'Renamed' WHERE id = 'b1'");
    expect(brandEvents()).toEqual([
      { brand_id: "b1", status: "found", source: "change" },
      { brand_id: "b1", status: "pitched", source: "change" },
    ]);
  });

  it("backfills the current step and status at the creation time, once", () => {
    migrate(db);
    deal("d1", 3);
    deal("d2", 1, "not a time");
    brand("b1", "won");
    db.exec("DELETE FROM deal_events; DELETE FROM brand_events;");
    db.exec(backfillDealEventsSql);
    db.exec(backfillDealEventsSql);
    const day = Date.parse("2026-03-01T10:00:00.000Z");
    expect(db.prepare("SELECT deal_id, step, at, source FROM deal_events").all()).toEqual([
      { deal_id: "d1", step: 3, at: day, source: "backfill" },
    ]);
    expect(db.prepare("SELECT brand_id, status, at, source FROM brand_events").all()).toEqual([
      { brand_id: "b1", status: "won", at: day, source: "backfill" },
    ]);
  });

  it("does not backfill a deal that already has an event for its step", () => {
    migrate(db);
    deal("d1", 3);
    db.exec(backfillDealEventsSql);
    expect(dealEvents()).toHaveLength(1);
  });
});

describe("record notes (migration 10)", () => {
  it("adds a nullable notes column to the brand and deal detail rows", () => {
    migrate(db);
    expect(migrations[9]?.name).toBe("record-notes");
    db.exec("INSERT INTO brand_details (brand_id) VALUES ('b1')");
    db.exec("INSERT INTO deal_details (deal_id) VALUES ('d1')");
    expect(db.prepare("SELECT notes FROM brand_details").get()).toEqual({ notes: null });
    expect(db.prepare("SELECT notes FROM deal_details").get()).toEqual({ notes: null });
    db.exec("UPDATE brand_details SET notes = 'Asks for a demo first.'");
    expect(db.prepare("SELECT notes FROM brand_details").get()).toEqual({
      notes: "Asks for a demo first.",
    });
  });

  it("keeps the notes of rows that already exist when it upgrades from 9", () => {
    migrate(db, migrations.slice(0, 9));
    db.exec("INSERT INTO brand_details (brand_id, headcount) VALUES ('b1', 12)");
    migrate(db);
    expect(version()).toBe(migrations.length);
    expect(db.prepare("SELECT headcount, notes FROM brand_details").get()).toEqual({
      headcount: 12,
      notes: null,
    });
  });

  it("refuses a notes value of the wrong type", () => {
    migrate(db);
    expect(() => {
      db.prepare("INSERT INTO deal_details (deal_id, notes) VALUES ('d1', ?)").run(
        new Uint8Array([1]),
      );
    }).toThrow();
  });
});
