// r2-access: hands signed, short-lived R2 links to authorised members.
// It never logs a body, a header, a URL or a secret, and it uses no service key.
import { parseR2Request } from "../_shared/r2-rules.ts";
import type { R2Request } from "../_shared/r2-rules.ts";
import { presign } from "../_shared/sigv4.ts";

const EXPIRES_SECONDS = 900;
const METHODS = { get: "GET", head: "HEAD", put: "PUT", delete: "DELETE", list: "GET" } as const;

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** The user id (`sub`) of a token the platform has already verified. */
function callerIdOf(authorization: string): string | null {
  const token = /^Bearer\s+(\S+)$/i.exec(authorization)?.[1];
  const payload = token?.split(".")[1];
  if (payload === undefined) {
    return null;
  }
  try {
    const claims: unknown = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    if (typeof claims === "object" && claims !== null && "sub" in claims) {
      return typeof claims.sub === "string" ? claims.sub : null;
    }
  } catch {
    return null;
  }
  return null;
}

function publishableKey(): string | undefined {
  const keysJson = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (keysJson !== undefined && keysJson !== "") {
    try {
      const keys: unknown = JSON.parse(keysJson);
      if (typeof keys === "object" && keys !== null && "default" in keys) {
        if (typeof keys.default === "string") {
          return keys.default;
        }
      }
    } catch {
      // Fall through to the single-key names.
    }
  }
  return Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
}

/** Asks the database, with the caller's own token, whether they are an authorised member. */
async function isAuthorized(authorization: string): Promise<"yes" | "no" | "bad-token" | "error"> {
  const baseUrl = Deno.env.get("SUPABASE_URL");
  const apikey = publishableKey();
  if (baseUrl === undefined || baseUrl === "" || apikey === undefined) {
    return "error";
  }
  try {
    const response = await fetch(`${baseUrl}/rest/v1/rpc/is_authorized`, {
      method: "POST",
      headers: { apikey, Authorization: authorization, "Content-Type": "application/json" },
      body: "{}",
    });
    if (response.status === 401) {
      return "bad-token";
    }
    if (!response.ok) {
      return "error";
    }
    return (await response.json()) === true ? "yes" : "no";
  } catch {
    return "error";
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return reply(405, { error: "Use POST." });
  }

  const authorization = request.headers.get("Authorization");
  const callerId = authorization === null ? null : callerIdOf(authorization);
  if (authorization === null || callerId === null) {
    return reply(401, { error: "Sign in first." });
  }

  const access = await isAuthorized(authorization);
  if (access === "bad-token") {
    return reply(401, { error: "Sign in first." });
  }
  if (access === "error") {
    return reply(503, { error: "Access can't be checked right now." });
  }
  if (access === "no") {
    return reply(403, { error: "This account has no access yet." });
  }

  const accountId = Deno.env.get("R2_ACCOUNT_ID");
  const accessKeyId = Deno.env.get("R2_ACCESS_KEY_ID");
  const secretAccessKey = Deno.env.get("R2_SECRET_ACCESS_KEY");
  const bucket = Deno.env.get("R2_BUCKET");
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    return reply(503, { error: "R2 isn't set up." });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return reply(400, { error: "The body must be JSON." });
  }
  const parsed = parseR2Request(body, callerId);
  if (!parsed.ok) {
    return reply(400, { error: parsed.reason });
  }

  const host = `${bucket}.${accountId}.r2.cloudflarestorage.com`;
  const now = new Date();
  const sign = async (item: R2Request) => {
    const url = await presign({
      method: METHODS[item.op],
      host,
      path: item.op === "list" ? "/" : `/${item.key}`,
      query:
        item.op === "list"
          ? {
              "list-type": "2",
              prefix: item.prefix,
              ...(item.continuationToken === undefined
                ? {}
                : { "continuation-token": item.continuationToken }),
            }
          : {},
      accessKeyId,
      secretAccessKey,
      region: "auto",
      service: "s3",
      now,
      expiresSeconds: EXPIRES_SECONDS,
    });
    return { op: item.op, method: METHODS[item.op], url };
  };

  const urls = await Promise.all(parsed.requests.map(sign));
  const expiresAt = new Date(now.getTime() + EXPIRES_SECONDS * 1000).toISOString();
  return reply(200, { expiresAt, urls });
});
