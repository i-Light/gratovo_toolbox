import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { mirrorTables } from "./mirror-tables";

const detailTables = ["brand_details", "deal_details", "creator_details"];
// Migration 0009 (plan step P8b, B4): the step and status times Insights reads.
const eventTables = ["deal_events", "brand_events"];
const localTables = [...detailTables, ...eventTables];

const source = (file: string): string => readFileSync(new URL(file, import.meta.url), "utf8");

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
