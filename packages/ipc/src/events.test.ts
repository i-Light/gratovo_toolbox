import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { appEventNames } from "./bridge";
import { appEvents, frameParts } from "./events";
import { presenceMembersSchema, presenceSetSchema } from "./presence";

describe("appEventNames", () => {
  it("equals the keys of appEvents", () => {
    expect([...appEventNames]).toEqual(Object.keys(appEvents));
  });

  it("is imported by bridge.ts as types only, so the preload bundles no zod", () => {
    const source = readFileSync(new URL("./bridge.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/import\s+(?!type\b)[^;]*from\s+"(zod|\.\/events)"/);
  });
});

describe("frame:changed", () => {
  const schema = appEvents["frame:changed"];

  it("accepts known parts", () => {
    expect(schema.safeParse({ parts: ["creators", "log"] }).success).toBe(true);
  });

  it("refuses empty parts, an unknown part, too many parts and extra fields", () => {
    expect(schema.safeParse({ parts: [] }).success).toBe(false);
    expect(schema.safeParse({ parts: ["money"] }).success).toBe(false);
    expect(schema.safeParse({ parts: Array(frameParts.length + 1).fill("team") }).success).toBe(
      false,
    );
    expect(schema.safeParse({ parts: ["team"], extra: 1 }).success).toBe(false);
  });
});

describe("presence schemas", () => {
  const member = { id: "u1", status: "online", doing: "Reach" };

  it("accepts up to 50 members", () => {
    expect(presenceMembersSchema.safeParse({ members: [member] }).success).toBe(true);
    expect(presenceMembersSchema.safeParse({ members: Array(50).fill(member) }).success).toBe(true);
  });

  it("refuses 51 members, extra fields and an unknown status", () => {
    expect(presenceMembersSchema.safeParse({ members: Array(51).fill(member) }).success).toBe(
      false,
    );
    expect(presenceMembersSchema.safeParse({ members: [{ ...member, extra: 1 }] }).success).toBe(
      false,
    );
    expect(
      presenceMembersSchema.safeParse({ members: [{ ...member, status: "busy" }] }).success,
    ).toBe(false);
  });

  it("refuses an unknown screen in presence:set", () => {
    expect(presenceSetSchema.safeParse({ screen: "reach", idle: false }).success).toBe(true);
    expect(presenceSetSchema.safeParse({ screen: "billing", idle: false }).success).toBe(false);
    expect(presenceSetSchema.safeParse({ screen: "reach" }).success).toBe(false);
  });
});

describe("event payloads", () => {
  it("sync:status uses the sync schema", () => {
    const ok = { state: "off", pending: 3, refused: 0, lastSyncedAt: null };
    expect(appEvents["sync:status"].safeParse(ok).success).toBe(true);
    expect(appEvents["sync:status"].safeParse({ ...ok, pending: -2 }).success).toBe(false);
  });
});
