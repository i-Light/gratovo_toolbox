import { describe, expect, it } from "vitest";

import { syncStatusSchema } from "./sync";

const good = { state: "synced", pending: 0, refused: 0, lastSyncedAt: 1_700_000_000_000 };

describe("syncStatusSchema", () => {
  it("accepts a status, with or without a last sync", () => {
    expect(syncStatusSchema.safeParse(good).success).toBe(true);
    expect(syncStatusSchema.safeParse({ ...good, lastSyncedAt: null }).success).toBe(true);
  });

  it("refuses extra fields, an unknown state, and bad counts", () => {
    expect(syncStatusSchema.safeParse({ ...good, extra: 1 }).success).toBe(false);
    expect(syncStatusSchema.safeParse({ ...good, state: "paused" }).success).toBe(false);
    expect(syncStatusSchema.safeParse({ ...good, pending: -1 }).success).toBe(false);
    expect(syncStatusSchema.safeParse({ ...good, refused: 1_000_001 }).success).toBe(false);
    expect(syncStatusSchema.safeParse({ ...good, pending: 1.5 }).success).toBe(false);
  });
});
