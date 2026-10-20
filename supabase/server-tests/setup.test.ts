// Runs once before the server tests (it is Vitest's globalSetup, so it holds no tests itself).
// It reads the local stack's address and keys from the environment, creates made-up users through
// the Auth admin API, and gives the test files their ids through `inject("fixture")`.
//
// The keys belong to the throwaway local stack (`supabase status -o env`) and are never written to
// a file. Every password and key value in here is made up.
import type { TestProject } from "vitest/node";

export interface Person {
  readonly id: string;
  readonly email: string;
  readonly password: string;
}

export interface Fixture {
  readonly url: string;
  readonly publishableKey: string;
  /** The role names the tests refer to. */
  readonly owner: Person;
  readonly member: Person;
  /** Signed up but never promoted: role `unauthorized`. */
  readonly waiting: Person;
  /** An account the admin API created without confirming its email. */
  readonly unconfirmed: Person;
}

declare module "vitest" {
  export interface ProvidedContext {
    fixture: Fixture;
  }
}

const password = "test-password-000";

function need(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set. Start the stack and export its keys (docs/setup.md).`);
  }
  return value;
}

/** A call to the local stack as the service role. The secret key only ever leaves in a header. */
async function asService(
  url: string,
  secretKey: string,
  path: string,
  init: { method: string; body?: object; prefer?: string },
): Promise<unknown> {
  const headers: Record<string, string> = {
    apikey: secretKey,
    "Content-Type": "application/json",
  };
  // A legacy service key is a JWT and is also sent as the bearer token; a sb_secret_ key is not.
  if (secretKey.startsWith("eyJ")) {
    headers["Authorization"] = `Bearer ${secretKey}`;
  }
  if (init.prefer !== undefined) {
    headers["Prefer"] = init.prefer;
  }
  const response = await fetch(`${url}${path}`, {
    method: init.method,
    headers,
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  if (!response.ok) {
    throw new Error(
      `${init.method} ${path.split("?")[0] ?? ""} answered ${String(response.status)}`,
    );
  }
  const text = await response.text();
  return text === "" ? null : (JSON.parse(text) as unknown);
}

async function createUser(
  url: string,
  secretKey: string,
  name: string,
  confirmed: boolean,
): Promise<Person> {
  const email = `${name}@example.test`;
  const created = (await asService(url, secretKey, "/auth/v1/admin/users", {
    method: "POST",
    body: { email, password, email_confirm: confirmed },
  })) as { id: string };
  return { id: created.id, email, password };
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const url = need("SUPABASE_URL");
  const publishableKey = need("SUPABASE_PUBLISHABLE_KEY");
  const secretKey = need("SUPABASE_SECRET_KEY");
  // Several runs against one stack must not trip over each other's users.
  const run = Date.now().toString(36);

  const owner = await createUser(url, secretKey, `owner-${run}`, true);
  const member = await createUser(url, secretKey, `member-${run}`, true);
  const waiting = await createUser(url, secretKey, `waiting-${run}`, true);
  const unconfirmed = await createUser(url, secretKey, `unconfirmed-${run}`, false);

  // A trigger gave each confirmed user a profile with role `unauthorized`. Promote two of them,
  // as the owner does by hand in production (docs/setup.md).
  for (const person of [owner, member]) {
    await asService(url, secretKey, `/rest/v1/profiles?id=eq.${person.id}`, {
      method: "PATCH",
      body: { role: "basic" },
      prefer: "return=minimal",
    });
  }
  await asService(url, secretKey, "/rest/v1/member_access", {
    method: "POST",
    body: [
      { profile_id: owner.id, roles: ["owner"], sees_money: true },
      { profile_id: member.id, roles: ["scout"], sees_money: false },
    ],
    prefer: "return=minimal",
  });

  project.provide("fixture", { url, publishableKey, owner, member, waiting, unconfirmed });

  return async () => {
    for (const person of [owner, member, waiting, unconfirmed]) {
      await asService(url, secretKey, `/auth/v1/admin/users/${person.id}`, { method: "DELETE" });
    }
  };
}
