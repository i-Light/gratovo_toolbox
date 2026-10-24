import { describe, expect, it } from "vitest";

import { importResultSchema, importWarnings, type ImportReport } from "./import";

const report: ImportReport = {
  source: "C:\\old\\data\\database\\gratovo.db",
  tables: [{ name: "channels", inOld: 3, toAdd: 2, already: 1 }],
  skipped: [],
  unsent: { outbox: 0, activity: 0 },
  settingsFiles: [],
  dryRun: false,
  backup: null,
};

const accepts = (value: unknown): boolean => importResultSchema.safeParse(value).success;

describe("the import result", () => {
  it("takes the steps that failed after a good import, as warnings", () => {
    expect(accepts({ ok: true, report })).toBe(true);
    expect(accepts({ ok: true, report, warnings: [] })).toBe(true);
    expect(accepts({ ok: true, report, warnings: ["find_backup", "old_rules"] })).toBe(true);
    expect(accepts({ ok: true, report, warnings: [...importWarnings] })).toBe(true);
  });

  it("refuses an unknown warning, or more than there are", () => {
    expect(accepts({ ok: true, report, warnings: ["boom"] })).toBe(false);
    expect(accepts({ ok: true, report, warnings: [...importWarnings, "old_rules"] })).toBe(false);
    expect(accepts({ ok: false, reason: "failed", warnings: ["old_rules"] })).toBe(false);
  });

  it("has a reason for a network path", () => {
    expect(accepts({ ok: false, reason: "network_path" })).toBe(true);
  });
});
