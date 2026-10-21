import { describe, expect, it } from "vitest";

import { idMax, textMax } from "./data";
import { presenceMembersSchema, presenceScreens, presenceSetSchema } from "./presence";

const member = { id: "11111111-1111-4111-8111-111111111111", status: "online", doing: "Reach" };

describe("presenceScreens", () => {
  it("lists the rail's screens and the record view, once each", () => {
    expect(presenceScreens).toEqual([
      "today",
      "find",
      "reach",
      "close",
      "deliver",
      "insights",
      "toolbox",
      "team",
      "settings",
      "record",
    ]);
    expect(new Set(presenceScreens).size).toBe(presenceScreens.length);
  });
});

describe("presenceSetSchema", () => {
  it("accepts every screen, idle or not", () => {
    for (const screen of presenceScreens) {
      expect(presenceSetSchema.safeParse({ screen, idle: false }).success).toBe(true);
      expect(presenceSetSchema.safeParse({ screen, idle: true }).success).toBe(true);
    }
  });

  it("refuses an unknown screen, a missing or non-boolean idle, and extra fields", () => {
    expect(presenceSetSchema.safeParse({ screen: "Reach", idle: false }).success).toBe(false);
    expect(presenceSetSchema.safeParse({ screen: "", idle: false }).success).toBe(false);
    expect(presenceSetSchema.safeParse({ idle: false }).success).toBe(false);
    expect(presenceSetSchema.safeParse({ screen: "reach" }).success).toBe(false);
    expect(presenceSetSchema.safeParse({ screen: "reach", idle: "yes" }).success).toBe(false);
    expect(presenceSetSchema.safeParse({ screen: "reach", idle: 0 }).success).toBe(false);
    // Only the screen and idleness: no record id, search term or name rides along (D26).
    expect(
      presenceSetSchema.safeParse({ screen: "record", idle: false, recordId: "UC123" }).success,
    ).toBe(false);
    expect(presenceSetSchema.safeParse({ screen: "find", idle: false, query: "ai" }).success).toBe(
      false,
    );
    expect(presenceSetSchema.safeParse(null).success).toBe(false);
  });
});

describe("presenceMembersSchema", () => {
  it("accepts no one, one member and up to 50", () => {
    expect(presenceMembersSchema.safeParse({ members: [] }).success).toBe(true);
    expect(presenceMembersSchema.safeParse({ members: [member] }).success).toBe(true);
    expect(
      presenceMembersSchema.safeParse({ members: [{ ...member, status: "away", doing: "" }] })
        .success,
    ).toBe(true);
    expect(presenceMembersSchema.safeParse({ members: Array(50).fill(member) }).success).toBe(true);
  });

  it("refuses the edges: ids, doing text, status, count and shape", () => {
    const refuses = (value: unknown): void => {
      expect(presenceMembersSchema.safeParse(value).success).toBe(false);
    };
    refuses({ members: [{ ...member, id: "" }] });
    refuses({ members: [{ ...member, id: "x".repeat(idMax + 1) }] });
    refuses({ members: [{ ...member, doing: "x".repeat(textMax + 1) }] });
    refuses({ members: [{ ...member, status: "idle" }] });
    refuses({ members: [{ id: member.id, status: "online" }] });
    refuses({ members: [{ ...member, screen: "reach" }] });
    refuses({ members: Array(51).fill(member) });
    refuses({ members: [member], extra: true });
    refuses({});
    expect(
      presenceMembersSchema.safeParse({ members: [{ ...member, id: "x".repeat(idMax) }] }).success,
    ).toBe(true);
    expect(
      presenceMembersSchema.safeParse({ members: [{ ...member, doing: "x".repeat(textMax) }] })
        .success,
    ).toBe(true);
  });
});
