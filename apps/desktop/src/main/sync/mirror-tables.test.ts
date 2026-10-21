import { readdirSync, readFileSync } from "node:fs";
import type { SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase } from "../db/open-database";

import { mirrorTables, toLocalRow, upsertRow } from "./mirror-tables";
import type { MirrorTable } from "./mirror-tables";

const migrations = fileURLToPath(new URL("../../../../../supabase/migrations/", import.meta.url));

/** The columns a table has on the server: its create statement plus every added column. */
function serverColumns(table: string): Set<string> {
  const columns = new Set<string>();
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql"))) {
    const sql = readFileSync(`${migrations}${file}`, "utf8");
    const create = new RegExp(
      String.raw`create table if not exists public\.${table} \(\n([\s\S]*?)\n\);`,
      "i",
    ).exec(sql);
    for (const line of create?.[1]?.split("\n") ?? []) {
      const m = /^ {2}([a-z_]+)\s+[a-z]/.exec(line);
      if (m?.[1] !== undefined && !["constraint", "primary", "unique", "check"].includes(m[1])) {
        columns.add(m[1]);
      }
    }
    for (const m of sql.matchAll(
      new RegExp(String.raw`alter table public\.${table} add column if not exists ([a-z_]+)`, "gi"),
    )) {
      if (m[1] !== undefined) {
        columns.add(m[1]);
      }
    }
  }
  return columns;
}

function table(name: MirrorTable["name"]): MirrorTable {
  const found = mirrorTables.find((t) => t.name === name);
  if (found === undefined) {
    throw new Error(name);
  }
  return found;
}

function row(t: MirrorTable, remote: unknown): Record<string, SQLInputValue> {
  const local = toLocalRow(t, remote);
  if (local === null) {
    throw new Error("row has no key");
  }
  return local;
}

describe("mirror tables", () => {
  it("selects only columns the server has", () => {
    for (const t of mirrorTables) {
      const server = serverColumns(t.name);
      expect(server.size).toBeGreaterThan(5);
      expect(t.columns.filter((c) => !server.has(c))).toEqual([]);
      expect(server.has(t.cursor)).toBe(true);
      expect(t.columns).toContain(t.key);
    }
  });

  it("names columns the local tables have", () => {
    const db = openDatabase(":memory:");
    for (const t of mirrorTables) {
      const local = new Set(
        db
          .prepare(`PRAGMA table_info(${t.name})`)
          .all()
          .map((r) => String(r["name"])),
      );
      expect(t.columns.filter((c) => !local.has(c))).toEqual([]);
    }
    db.close();
  });

  it("covers every server column of the four tables except the ones kept off on purpose", () => {
    // channel_state, brands, deals and activity_log are mirrored whole.
    for (const t of mirrorTables) {
      expect([...serverColumns(t.name)].filter((c) => !t.columns.includes(c))).toEqual([]);
    }
  });
});

describe("toLocalRow", () => {
  it("stores jsonb and arrays as JSON text and keeps numbers and server time text", () => {
    const row = toLocalRow(table("channel_state"), {
      channel_id: "UC1",
      handle: "@a",
      channel_tags: ["qualified"],
      contacts: [{ method: "email", value: "a@b.c" }],
      manual_engagement_rate: 2.5,
      updated_at: "2026-10-20T10:00:00.123456+00:00",
      notes: null,
      media_kit: null,
    });
    expect(row?.["channel_tags"]).toBe('["qualified"]');
    expect(row?.["contacts"]).toBe('[{"method":"email","value":"a@b.c"}]');
    expect(row?.["manual_engagement_rate"]).toBe(2.5);
    expect(row?.["updated_at"]).toBe("2026-10-20T10:00:00.123456+00:00");
    expect(row?.["media_kit"]).toBeNull();
    expect(row?.["creator_stage"]).toBeNull();
    expect(Object.keys(row ?? {})).toEqual([...table("channel_state").columns]);
  });

  it("refuses a row without a text key", () => {
    for (const t of mirrorTables) {
      expect(toLocalRow(t, { [t.key]: "" })).toBeNull();
      expect(toLocalRow(t, { [t.key]: 5 })).toBeNull();
      expect(toLocalRow(t, {})).toBeNull();
    }
    expect(toLocalRow(table("deals"), null)).toBeNull();
    expect(toLocalRow(table("deals"), "x")).toBeNull();
  });

  it("gives a log line at_ms from its time", () => {
    const row = toLocalRow(table("activity_log"), {
      id: "l1",
      at: "2026-10-20T10:00:00.5+00:00",
      actor_name: "Ada",
      actor_role: "full",
      action: "note",
      entity_type: "app",
      detail: { text: "hi" },
      received_at: "2026-10-20T10:00:01.000001+00:00",
    });
    expect(row?.["at_ms"]).toBe(Date.parse("2026-10-20T10:00:00.500Z"));
    expect(row?.["detail"]).toBe('{"text":"hi"}');
    expect(toLocalRow(table("activity_log"), { id: "l2", at: "garbage" })?.["at_ms"]).toBeNull();
  });
});

describe("upsertRow", () => {
  let db: ReturnType<typeof openDatabase>;

  beforeEach(() => {
    db = openDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("updates in place, keeping the rowid and local columns", () => {
    const t = table("activity_log");
    const base = {
      at: "2026-10-20T10:00:00+00:00",
      actor_name: "Ada",
      actor_role: "full",
      action: "note",
      entity_type: "app",
      received_at: "2026-10-20T10:00:01+00:00",
    };
    upsertRow(db, t, row(t, { id: "a", ...base }));
    upsertRow(db, t, row(t, { id: "b", ...base }));
    const first = db.prepare("SELECT rowid FROM activity_log WHERE id = 'a'").get();
    upsertRow(db, t, row(t, { id: "a", ...base, action: "changed" }));
    expect(db.prepare("SELECT rowid, action FROM activity_log WHERE id = 'a'").get()).toEqual({
      rowid: first?.["rowid"],
      action: "changed",
    });
    expect(db.prepare("SELECT COUNT(*) AS n FROM activity_log").get()?.["n"]).toBe(2);
  });

  it("writes a creator, a brand and a deal", () => {
    const at = "2026-10-20T10:00:00+00:00";
    upsertRow(
      db,
      table("channel_state"),
      row(table("channel_state"), {
        channel_id: "UC1",
        handle: "@a",
        vetting_status: "newlyFound",
        pipeline_stage: "new",
        channel_tags: [],
        contacts: [],
        updated_at: at,
      }),
    );
    upsertRow(
      db,
      table("brands"),
      row(table("brands"), {
        id: "b1",
        name: "Acme AI",
        contacts: [],
        budget_currency: "USD",
        created_at: at,
        updated_at: at,
      }),
    );
    upsertRow(
      db,
      table("deals"),
      row(table("deals"), {
        id: "d1",
        brand_id: "b1",
        channel_id: "UC1",
        created_at: at,
        updated_at: at,
        stage: "agreed",
        brand_price: 4000,
        currency: "USD",
        creator_contract_status: "none",
        brand_contract_status: "none",
        influencer_payout: 0,
        flow_step: 3,
      }),
    );
    expect(db.prepare("SELECT pipeline_stage, channel_tags FROM channel_state").get()).toEqual({
      pipeline_stage: "new",
      channel_tags: "[]",
    });
    expect(db.prepare("SELECT flow_step FROM deals").get()?.["flow_step"]).toBe(3);
  });
});
