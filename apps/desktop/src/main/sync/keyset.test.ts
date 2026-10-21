import { describe, expect, it } from "vitest";

import { keysetQuery, quoteValue } from "./keyset";

function params(query: string): Map<string, string> {
  return new Map(
    query.split("&").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i), decodeURIComponent(p.slice(i + 1))];
    }),
  );
}

const base = {
  columns: ["channel_id", "updated_at"],
  cursorColumn: "updated_at",
  keyColumns: ["channel_id"],
  limit: 500,
} as const;

describe("quoteValue", () => {
  it("quotes and escapes", () => {
    expect(quoteValue(String.raw`a"b\c`)).toBe(String.raw`"a\"b\\c"`);
  });
});

describe("keysetQuery", () => {
  it("has no or filter without a cursor", () => {
    const q = keysetQuery({ ...base, cursor: null });
    expect(q).not.toContain("or=");
    const p = params(q);
    expect(p.get("select")).toBe("channel_id,updated_at");
    expect(p.get("order")).toBe("updated_at.asc,channel_id.asc");
    expect(p.get("limit")).toBe("500");
  });

  it("builds the one-key filter and keeps +00:00", () => {
    const q = keysetQuery({
      ...base,
      cursor: { at: "2026-10-20T09:15:00.123456+00:00", key: ["UC1"] },
    });
    expect(q).not.toContain("+");
    expect(params(q).get("or")).toBe(
      '(updated_at.gt."2026-10-20T09:15:00.123456+00:00",and(updated_at.eq."2026-10-20T09:15:00.123456+00:00",channel_id.gt."UC1"))',
    );
  });

  it("builds the two-key filter for tombstones", () => {
    const q = keysetQuery({
      columns: ["table_name", "row_id", "deleted_at"],
      cursorColumn: "deleted_at",
      keyColumns: ["table_name", "row_id"],
      cursor: { at: "2026-10-20T09:15:00+00:00", key: ["deals", "d1"] },
      limit: 25,
      filters: ["table_name=in.(deals,brands)"],
    });
    const p = params(q);
    expect(p.get("order")).toBe("deleted_at.asc,table_name.asc,row_id.asc");
    expect(p.get("table_name")).toBe("in.(deals,brands)");
    expect(p.get("or")).toBe(
      '(deleted_at.gt."2026-10-20T09:15:00+00:00",' +
        'and(deleted_at.eq."2026-10-20T09:15:00+00:00",table_name.gt."deals"),' +
        'and(deleted_at.eq."2026-10-20T09:15:00+00:00",table_name.eq."deals",row_id.gt."d1"))',
    );
  });

  it("survives a quote and a comma in a key", () => {
    const q = keysetQuery({
      ...base,
      cursor: { at: "2026-10-20T09:15:00+00:00", key: ['a",b\\'] },
    });
    expect(q).not.toContain('"');
    expect(q).not.toContain(",and");
    expect(params(q).get("or")).toContain('channel_id.gt."a\\",b\\\\"');
  });

  it("refuses a cursor of the wrong width", () => {
    expect(() => keysetQuery({ ...base, cursor: { at: "x", key: ["a", "b"] } })).toThrow();
  });
});
