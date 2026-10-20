// The YouTube key: `team_youtube_key()` hands the Vault secret (seed.sql, a made-up value) to
// authorized members only, through PostgREST.
import { describe, expect, inject, it } from "vitest";

import { createNetwork } from "../../apps/desktop/src/main/net/network";
import type { SecretStore } from "../../apps/desktop/src/main/secret-store";
import { createAuthClient } from "../../apps/desktop/src/main/supabase/auth-client";
import { readSupabaseConfig } from "../../apps/desktop/src/main/supabase/config";
import { createRest, RestError } from "../../apps/desktop/src/main/supabase/rest";
import { createSessionManager } from "../../apps/desktop/src/main/supabase/session";
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
const network = createNetwork({ allowedOrigins: [config.origin] });
const auth = createAuthClient(network, config);

function memoryStore(): SecretStore {
  const values = new Map<string, string>();
  return {
    get: (name) => Promise.resolve(values.get(name)),
    set: (name, value) => {
      values.set(name, value);
      return Promise.resolve();
    },
    delete: (name) => Promise.resolve(values.delete(name)),
    has: (name) => Promise.resolve(values.has(name)),
    names: () => Promise.resolve([...values.keys()].sort()),
  };
}

async function restFor(person: Person) {
  const manager = createSessionManager({ auth, store: memoryStore(), now: Date.now });
  const session = await manager.start(await auth.signIn(person.email, person.password));
  return { rest: createRest(network, config, session), manager };
}

describe("team_youtube_key()", () => {
  it("gives a member the key", async () => {
    const { rest, manager } = await restFor(fixture.member);
    expect(await rest.rpc<string>("team_youtube_key")).toBe("yt-test-000");
    manager.close();
  });

  it("gives the owner the key", async () => {
    const { rest, manager } = await restFor(fixture.owner);
    expect(await rest.rpc<string>("team_youtube_key")).toBe("yt-test-000");
    manager.close();
  });

  it("refuses a waiting account with 42501", async () => {
    const { rest, manager } = await restFor(fixture.waiting);
    const error: unknown = await rest.rpc("team_youtube_key").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RestError);
    expect(error).toMatchObject({ kind: "http", status: 403, code: "42501" });
    manager.close();
  });

  it("refuses a caller with no token, and the answer does not hold the key", async () => {
    const response = await fetch(`${fixture.url}/rest/v1/rpc/team_youtube_key`, {
      method: "POST",
      headers: { apikey: fixture.publishableKey, "Content-Type": "application/json" },
      body: "{}",
    });
    expect([401, 403]).toContain(response.status);
    expect(await response.text()).not.toContain("yt-test-000");
  });

  it("does not expose Vault's tables to a member", async () => {
    const { rest, manager } = await restFor(fixture.member);
    const outcome = await rest
      .select("decrypted_secrets", "select=decrypted_secret")
      .catch((e: unknown) => e);
    expect(JSON.stringify(outcome)).not.toContain("yt-test-000");
    manager.close();
  });
});
