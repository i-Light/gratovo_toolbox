// The r2-access Edge Function, running in the local Edge Runtime with made-up R2 values
// (config.toml). Plain fetch, as the function is not part of the app's REST helper.
import { describe, expect, inject, it } from "vitest";

import { createNetwork } from "../../apps/desktop/src/main/net/network";
import { createAuthClient } from "../../apps/desktop/src/main/supabase/auth-client";
import { readSupabaseConfig } from "../../apps/desktop/src/main/supabase/config";
import type { Person } from "./setup.test";

const fixture = inject("fixture");

const read = readSupabaseConfig({
  packaged: false,
  built: {},
  env: {
    GRATOVO_SUPABASE_URL: fixture.url,
    GRATOVO_SUPABASE_PUBLISHABLE_KEY: fixture.publishableKey,
  },
});
if (!read.ok) {
  throw new Error(`The local stack's address or key was refused: ${read.problem}`);
}
const config = read.config;
const auth = createAuthClient(createNetwork({ allowedOrigins: [config.origin] }), config);

const endpoint = `${fixture.url}/functions/v1/r2-access`;

async function call(
  token: string | null,
  body: unknown,
  method = "POST",
): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = {
    apikey: fixture.publishableKey,
    "Content-Type": "application/json",
  };
  if (token !== null) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const response = await fetch(endpoint, {
    method,
    headers,
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text);
  } catch {
    // Keep the text.
  }
  return { status: response.status, json };
}

async function tokenFor(person: Person): Promise<string> {
  return (await auth.signIn(person.email, person.password)).accessToken;
}

const goodKey = "channels/UC_test-000.json.zst";

describe("r2-access", () => {
  it("answers 401 with no token", async () => {
    expect((await call(null, { requests: [{ op: "get", key: goodKey }] })).status).toBe(401);
  });

  it("answers 401 for the publishable key sent as a bearer token", async () => {
    const result = await call(fixture.publishableKey, { requests: [{ op: "get", key: goodKey }] });
    expect(result.status).toBe(401);
  });

  it("answers 403 for an account with no access yet", async () => {
    const token = await tokenFor(fixture.waiting);
    expect((await call(token, { requests: [{ op: "get", key: goodKey }] })).status).toBe(403);
  });

  it("answers 400 to a member for a bad key", async () => {
    const token = await tokenFor(fixture.member);
    for (const key of ["../secrets.json.zst", "/channels/a.json.zst", "other/a.json.zst"]) {
      expect((await call(token, { requests: [{ op: "get", key }] })).status).toBe(400);
    }
    expect((await call(token, { nope: true })).status).toBe(400);
  });

  it("answers 400 to a member who writes into another member's catalog folder", async () => {
    const token = await tokenFor(fixture.member);
    const key = `catalog/${fixture.owner.id}/part-1.jsonl.zst`;
    expect((await call(token, { requests: [{ op: "put", key }] })).status).toBe(400);
  });

  it("answers 405 to a GET", async () => {
    const token = await tokenFor(fixture.member);
    expect((await call(token, null, "GET")).status).toBe(405);
  });

  it("gives a member signed links for good keys", async () => {
    const token = await tokenFor(fixture.member);
    const own = `catalog/${fixture.member.id}/part-1.jsonl.zst`;
    const result = await call(token, {
      requests: [
        { op: "get", key: goodKey },
        { op: "put", key: own },
        { op: "list", prefix: "channels/" },
      ],
    });
    expect(result.status).toBe(200);
    const body = result.json as {
      expiresAt: string;
      urls: { op: string; method: string; url: string }[];
    };
    expect(body.urls.map((item) => item.op)).toEqual(["get", "put", "list"]);
    expect(body.urls.map((item) => item.method)).toEqual(["GET", "PUT", "GET"]);
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now());
    for (const item of body.urls) {
      const link = new URL(item.url);
      expect(link.hostname).toBe("r2-test-000.r2-test-000.r2.cloudflarestorage.com");
      expect(link.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
      expect(link.searchParams.get("X-Amz-Expires")).toBe("900");
      expect(link.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
