import { describe, expect, it } from "vitest";
import { parseR2Request } from "./r2-rules.ts";

const ME = "0b6f3c1e-1111-4222-8333-444455556666";
const OTHER = "9a9a9a9a-1111-4222-8333-444455556666";

function one(request: unknown) {
  return parseR2Request({ requests: [request] }, ME);
}

describe("parseR2Request: shape", () => {
  it("accepts a valid mixed list", () => {
    const result = parseR2Request(
      {
        requests: [
          { op: "get", key: "channels/UC_abc-123.json.zst" },
          { op: "list", prefix: "catalog/", continuationToken: "tok" },
        ],
      },
      ME,
    );
    expect(result).toEqual({
      ok: true,
      requests: [
        { op: "get", key: "channels/UC_abc-123.json.zst" },
        { op: "list", prefix: "catalog/", continuationToken: "tok" },
      ],
    });
  });

  it("rejects non-objects, a missing list, an empty list and 51 requests", () => {
    expect(parseR2Request(null, ME).ok).toBe(false);
    expect(parseR2Request("x", ME).ok).toBe(false);
    expect(parseR2Request({}, ME).ok).toBe(false);
    expect(parseR2Request({ requests: "no" }, ME).ok).toBe(false);
    expect(parseR2Request({ requests: [] }, ME).ok).toBe(false);
    const item = { op: "get", key: "channels/a.json.zst" };
    expect(parseR2Request({ requests: Array<unknown>(50).fill(item) }, ME).ok).toBe(true);
    expect(parseR2Request({ requests: Array<unknown>(51).fill(item) }, ME).ok).toBe(false);
  });

  it("rejects an unknown op and a non-object entry", () => {
    expect(one({ op: "copy", key: "channels/a.json.zst" }).ok).toBe(false);
    expect(one("get").ok).toBe(false);
    expect(one({ key: "channels/a.json.zst" }).ok).toBe(false);
    expect(one({ op: "get" }).ok).toBe(false);
    expect(one({ op: "get", key: 5 }).ok).toBe(false);
  });
});

describe("parseR2Request: channel keys", () => {
  it.each(["get", "head", "put", "delete"])("allows %s on channels/<id>.json.zst", (op) => {
    expect(one({ op, key: "channels/UC_x-1.json.zst" }).ok).toBe(true);
  });

  it.each([
    "channels/../secret.json.zst",
    "channels/a%2Fb.json.zst",
    "/channels/a.json.zst",
    "channels//a.json.zst",
    "channels/a/b.json.zst",
    "channels/.json.zst",
    `channels/${"a".repeat(65)}.json.zst`,
    "channels/a.json",
    "channels/a.json.zst/",
    "channels/a b.json.zst",
    "other/a.json.zst",
    "",
  ])("rejects %j", (key) => {
    expect(one({ op: "get", key }).ok).toBe(false);
  });

  it("never echoes the key in a rejection", () => {
    const result = one({ op: "get", key: "channels/../TOPSECRET" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).not.toContain("TOPSECRET");
    }
  });
});

describe("parseR2Request: catalog keys", () => {
  const key = (worker: string) => `catalog/${worker}/2026-10-20-0001.jsonl.zst`;

  it("allows get and head under any worker prefix", () => {
    expect(one({ op: "get", key: key("old-worker") }).ok).toBe(true);
    expect(one({ op: "head", key: key(OTHER) }).ok).toBe(true);
  });

  it("allows put only under the caller's own id", () => {
    expect(one({ op: "put", key: key(ME) }).ok).toBe(true);
    expect(one({ op: "put", key: key(OTHER) }).ok).toBe(false);
    expect(one({ op: "put", key: key("old-worker") }).ok).toBe(false);
  });

  it("never allows delete under catalog/", () => {
    expect(one({ op: "delete", key: key(ME) }).ok).toBe(false);
  });

  it("rejects bad segments", () => {
    expect(one({ op: "get", key: "catalog/UPPER/a.jsonl.zst" }).ok).toBe(false);
    expect(one({ op: "get", key: "catalog/../a.jsonl.zst" }).ok).toBe(false);
    expect(one({ op: "get", key: "catalog/w/../a.jsonl.zst" }).ok).toBe(false);
    expect(one({ op: "get", key: "catalog/w/...jsonl.zst" }).ok).toBe(false);
    expect(one({ op: "get", key: "catalog/w/a%2Fb.jsonl.zst" }).ok).toBe(false);
    expect(one({ op: "get", key: "catalog/w/a.jsonl" }).ok).toBe(false);
    expect(one({ op: "get", key: `catalog/${"a".repeat(65)}/a.jsonl.zst` }).ok).toBe(false);
    expect(one({ op: "get", key: `catalog/w/${"a".repeat(101)}.jsonl.zst` }).ok).toBe(false);
  });
});

describe("parseR2Request: list", () => {
  it("allows channels/ and catalog/ prefixes", () => {
    expect(one({ op: "list", prefix: "channels/" }).ok).toBe(true);
    expect(one({ op: "list", prefix: "catalog/some-worker/" }).ok).toBe(true);
  });

  it("rejects other, traversing, empty and over-long prefixes", () => {
    expect(one({ op: "list", prefix: "" }).ok).toBe(false);
    expect(one({ op: "list", prefix: "/" }).ok).toBe(false);
    expect(one({ op: "list", prefix: "other/" }).ok).toBe(false);
    expect(one({ op: "list", prefix: "channels" }).ok).toBe(false);
    expect(one({ op: "list", prefix: "channels/../x" }).ok).toBe(false);
    expect(one({ op: "list", prefix: "catalog//x" }).ok).toBe(false);
    expect(one({ op: "list", prefix: "catalog/%2F" }).ok).toBe(false);
    expect(one({ op: "list", prefix: `catalog/${"a".repeat(192)}` }).ok).toBe(true);
    expect(one({ op: "list", prefix: `catalog/${"a".repeat(193)}` }).ok).toBe(false);
    expect(one({ op: "list" }).ok).toBe(false);
  });

  it("checks the continuation token", () => {
    expect(one({ op: "list", prefix: "channels/", continuationToken: "" }).ok).toBe(false);
    expect(one({ op: "list", prefix: "channels/", continuationToken: 5 }).ok).toBe(false);
    expect(one({ op: "list", prefix: "channels/", continuationToken: "x".repeat(1025) }).ok).toBe(
      false,
    );
  });
});
