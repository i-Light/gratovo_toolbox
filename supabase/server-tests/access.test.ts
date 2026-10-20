// What a signed-in person can see and do through the app's REST helper: a waiting account reads
// as waiting, members read the team, and nobody can promote themselves.
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

/** Signs a person in and returns the REST helper the app would use for them. */
async function restFor(person: Person) {
  const manager = createSessionManager({ auth, store: memoryStore(), now: Date.now });
  const session = await manager.start(await auth.signIn(person.email, person.password));
  return { rest: createRest(network, config, session), manager };
}

async function failure(promise: Promise<unknown>): Promise<RestError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RestError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected the call to fail.");
}

interface ProfileRow {
  id: string;
  role: string;
}
interface AccessRow {
  profile_id: string;
  roles: string[];
  sees_money: boolean;
}

describe("a waiting account (role unauthorized)", () => {
  it("reads its own profile as unauthorized, and nobody else's", async () => {
    const { rest, manager } = await restFor(fixture.waiting);
    const rows = await rest.select<ProfileRow>("profiles", "select=id,role");
    expect(rows).toEqual([{ id: fixture.waiting.id, role: "unauthorized" }]);
    manager.close();
  });

  it("reads no shared data and no one else's access", async () => {
    const { rest, manager } = await restFor(fixture.waiting);
    expect(await rest.select("brands", "select=id")).toEqual([]);
    expect(await rest.select("member_access", "select=profile_id")).toEqual([]);
    manager.close();
  });

  it("cannot promote itself: the update is refused or changes nothing", async () => {
    const { rest, manager } = await restFor(fixture.waiting);
    const outcome = await rest
      .patch("profiles", `id=eq.${fixture.waiting.id}`, { role: "full" })
      .then(() => "accepted" as const)
      .catch((error: unknown) => error);
    if (outcome !== "accepted") {
      expect(outcome).toMatchObject({ status: 403, code: "42501" });
    }
    const rows = await rest.select<ProfileRow>("profiles", "select=role");
    expect(rows).toEqual([{ role: "unauthorized" }]);
    manager.close();
  });
});

describe("a member (role basic)", () => {
  it("reads its own profile as basic and sees the whole team", async () => {
    const { rest, manager } = await restFor(fixture.member);
    const mine = await rest.select<ProfileRow>(
      "profiles",
      `select=id,role&id=eq.${fixture.member.id}`,
    );
    expect(mine).toEqual([{ id: fixture.member.id, role: "basic" }]);
    const team = await rest.select<ProfileRow>("profiles", "select=id");
    expect(team.map((row) => row.id)).toEqual(
      expect.arrayContaining([fixture.owner.id, fixture.member.id, fixture.waiting.id]),
    );
    manager.close();
  });

  it("reads everyone's agency roles and money switch", async () => {
    const { rest, manager } = await restFor(fixture.member);
    const rows = await rest.select<AccessRow>(
      "member_access",
      "select=profile_id,roles,sees_money",
    );
    expect(rows).toEqual(
      expect.arrayContaining([
        { profile_id: fixture.owner.id, roles: ["owner"], sees_money: true },
        expect.objectContaining({ profile_id: fixture.member.id, sees_money: false }),
      ]),
    );
    manager.close();
  });

  it("cannot write member_access directly or through set_member_access", async () => {
    const { rest, manager } = await restFor(fixture.member);
    const direct = await failure(
      rest.patch("member_access", `profile_id=eq.${fixture.member.id}`, { sees_money: true }),
    );
    expect(direct).toMatchObject({ kind: "http", status: 403, code: "42501" });
    const viaRpc = await failure(
      rest.rpc("set_member_access", {
        p_profile_id: fixture.member.id,
        p_roles: ["owner"],
        p_sees_money: true,
      }),
    );
    expect(viaRpc).toMatchObject({ kind: "http", status: 403, code: "42501" });
    manager.close();
  });
});

describe("the owner", () => {
  it("changes another member's access through set_member_access", async () => {
    const { rest, manager } = await restFor(fixture.owner);
    await rest.rpc("set_member_access", {
      p_profile_id: fixture.member.id,
      p_roles: ["scout", "outreach"],
      p_sees_money: false,
    });
    const rows = await rest.select<AccessRow>(
      "member_access",
      `select=roles,sees_money&profile_id=eq.${fixture.member.id}`,
    );
    expect(rows).toEqual([{ roles: ["outreach", "scout"], sees_money: false }]);
    manager.close();
  });

  it("cannot remove the last owner", async () => {
    const { rest, manager } = await restFor(fixture.owner);
    const error = await failure(
      rest.rpc("set_member_access", {
        p_profile_id: fixture.owner.id,
        p_roles: ["scout"],
        p_sees_money: true,
      }),
    );
    expect(error.kind).toBe("http");
    const rows = await rest.select<{ roles: string[] }>(
      "member_access",
      `select=roles&profile_id=eq.${fixture.owner.id}`,
    );
    expect(rows).toEqual([{ roles: ["owner"] }]);
    manager.close();
  });
});

describe("no token at all", () => {
  it("reads nothing from profiles with only the publishable key", async () => {
    const response = await fetch(`${fixture.url}/rest/v1/profiles?select=id`, {
      headers: { apikey: fixture.publishableKey },
    });
    // Either refused outright (anon holds no privilege) or an empty list.
    if (response.ok) {
      expect(await response.json()).toEqual([]);
    } else {
      expect([401, 403]).toContain(response.status);
    }
  });
});
