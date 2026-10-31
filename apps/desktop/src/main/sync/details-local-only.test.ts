import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { mirrorTables } from "./mirror-tables";

const detailTables = ["brand_details", "deal_details", "creator_details"];
// Migration 0009 (plan step P8b, B4): the step and status times Insights reads.
const eventTables = ["deal_events", "brand_events"];
const localTables = [...detailTables, ...eventTables];

const source = (file: string): string => readFileSync(new URL(file, import.meta.url), "utf8");

/** The notes columns migration 0010 adds (plan step P2, R7): local only, no Supabase column. */
const noteColumns = ["brand_details", "deal_details"];

describe("the detail and event tables stay on this computer (plan step P1, F2)", () => {
  it("are not mirror tables", () => {
    const names: string[] = mirrorTables.map((t) => t.name);
    for (const table of localTables) {
      expect(names).not.toContain(table);
    }
  });

  it("are named by neither sync list's file", () => {
    for (const file of ["./mirror-tables.ts", "./whole-tables.ts"]) {
      const text = source(file);
      for (const table of localTables) {
        expect(text).not.toContain(table);
      }
    }
  });
});

describe("the local notes columns stay on this computer (plan step P2, R7)", () => {
  it("are on the detail tables, which the sync lists do not name", () => {
    const migration = source("../db/migrations/0010-record-notes.ts");
    for (const table of noteColumns) {
      expect(migration).toContain(`ALTER TABLE ${table} ADD COLUMN notes TEXT`);
      for (const file of ["./mirror-tables.ts", "./whole-tables.ts"]) {
        expect(source(file)).not.toContain(table);
      }
    }
  });

  it("are not read back by the sync's mirror of brands and deals", () => {
    // The mirror carries the synced `notes` column of `brands` and `deals`; the local note is a
    // different column on a different table, so a pull can't overwrite it.
    for (const name of ["brands", "deals"]) {
      const table = mirrorTables.find((t) => t.name === name);
      expect(table?.columns).toContain("notes");
    }
  });

  it("are never queued for upload", () => {
    const intents = source("./intents.ts");
    expect(intents).toMatch(/case "brand\.notes":\s*case "deal\.notes":/);
  });
});
