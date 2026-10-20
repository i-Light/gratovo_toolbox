// What a member may ask the r2-access function for. Pure, so Vitest covers every rule.
// A rejection says which rule failed and never repeats the key back.

export type R2Request =
  | { op: "get" | "head" | "put" | "delete"; key: string }
  | { op: "list"; prefix: string; continuationToken?: string };

export type R2ParseResult = { ok: true; requests: R2Request[] } | { ok: false; reason: string };

export const MAX_REQUESTS = 50;
const MAX_PREFIX = 200;
const MAX_TOKEN = 1024;

const CHANNEL_KEY = /^channels\/[A-Za-z0-9_-]{1,64}\.json\.zst$/;
const CATALOG_KEY = /^catalog\/([a-z0-9-]{1,64})\/([A-Za-z0-9._-]{1,100})\.jsonl\.zst$/;
const LIST_PREFIX = /^(channels|catalog)\/[A-Za-z0-9._/-]*$/;

function fail(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}

/** Returns the reason a key is refused for this op, or null when it is allowed. */
function checkKey(
  op: "get" | "head" | "put" | "delete",
  key: string,
  callerId: string,
): string | null {
  if (CHANNEL_KEY.test(key)) {
    return null;
  }
  const catalog = CATALOG_KEY.exec(key);
  if (catalog) {
    if (op === "delete") {
      return "catalog objects can't be deleted";
    }
    const name = catalog[2] ?? "";
    if (/^\.+$/.test(name)) {
      return "the catalog name is not allowed";
    }
    if (op === "put" && catalog[1] !== callerId) {
      return "you can write only under your own catalog folder";
    }
    return null;
  }
  return "the key must be channels/<id>.json.zst or catalog/<worker>/<name>.jsonl.zst";
}

export function parseR2Request(body: unknown, callerId: string): R2ParseResult {
  if (typeof body !== "object" || body === null || !("requests" in body)) {
    return fail("the body must be { requests: [...] }");
  }
  const list: unknown = body.requests;
  if (!Array.isArray(list)) {
    return fail("requests must be a list");
  }
  if (list.length < 1) {
    return fail("requests must not be empty");
  }
  if (list.length > MAX_REQUESTS) {
    return fail(`at most ${String(MAX_REQUESTS)} requests`);
  }

  const requests: R2Request[] = [];
  for (const item of list as unknown[]) {
    if (typeof item !== "object" || item === null) {
      return fail("each request must be an object");
    }
    const entry = item as Record<string, unknown>;
    const op = entry["op"];

    if (op === "list") {
      const prefix = entry["prefix"];
      if (typeof prefix !== "string") {
        return fail("list needs a prefix");
      }
      if (prefix.length > MAX_PREFIX) {
        return fail(`the prefix is longer than ${String(MAX_PREFIX)}`);
      }
      if (!LIST_PREFIX.test(prefix) || prefix.includes("..") || prefix.includes("//")) {
        return fail("the prefix must start with channels/ or catalog/");
      }
      const token = entry["continuationToken"];
      if (token === undefined) {
        requests.push({ op: "list", prefix });
      } else if (typeof token === "string" && token.length >= 1 && token.length <= MAX_TOKEN) {
        requests.push({ op: "list", prefix, continuationToken: token });
      } else {
        return fail("the continuation token is not valid");
      }
      continue;
    }

    if (op === "get" || op === "head" || op === "put" || op === "delete") {
      const key = entry["key"];
      if (typeof key !== "string") {
        return fail(`${op} needs a key`);
      }
      const problem = checkKey(op, key, callerId);
      if (problem !== null) {
        return fail(problem);
      }
      requests.push({ op, key });
      continue;
    }

    return fail("op must be get, head, put, delete or list");
  }
  return { ok: true, requests };
}
