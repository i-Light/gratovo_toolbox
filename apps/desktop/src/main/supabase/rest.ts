/**
 * The few PostgREST calls 3d-2a needs (plan G1): select, rpc and patch on the `public` schema,
 * signed with the publishable key (`apikey` header, as https://supabase.com/docs/guides/api/api-keys
 * says) and the member's access token (`Authorization: Bearer`).
 *
 * A 401 means the token was refused (PostgREST's PGRST30x JWT errors), so the call refreshes the
 * session once and tries again. Other errors become a `RestError` with the HTTP status and
 * PostgREST's `code` (its error body is `{ code, details, hint, message }`:
 * https://docs.postgrest.org/en/v12/references/errors.html); never the body, the URL or a token.
 */

import type { Network } from "../net/network";
import type { SupabaseConfig } from "./config";
import type { Session } from "./session";

/** `offline`: no answer (refused address, connection failure, timeout). `http`: an error status. */
export class RestError extends Error {
  readonly kind: "offline" | "http";
  readonly status: number | null;
  readonly code: string | null;

  constructor(kind: "offline" | "http", status: number | null = null, code: string | null = null) {
    super(
      `Supabase data request failed: ${kind}` +
        (status === null ? "" : ` [HTTP ${String(status)}]`) +
        (code === null ? "" : ` (${code})`),
    );
    this.name = "RestError";
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

export interface Rest {
  /** `GET /rest/v1/<table>?<query>`, e.g. `select=id,role&id=eq.<uuid>`. */
  select<T>(table: string, query: string): Promise<T[]>;
  /** `POST /rest/v1/rpc/<name>`; a function with no result gives null. */
  rpc<T>(name: string, args?: object): Promise<T>;
  /** `PATCH /rest/v1/<table>?<filter>`; the filter is required, so no call updates every row. */
  patch(table: string, filter: string, body: object): Promise<void>;
}

const identifier = /^[a-z_][a-z0-9_]{0,62}$/;

function checkName(name: string): void {
  if (!identifier.test(name)) {
    throw new Error("Not a valid table or function name.");
  }
}

/** PostgREST codes are SQLSTATEs (`42501`) or `PGRST…`; anything else is dropped. */
async function readCode(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null) {
      const code = (body as Record<string, unknown>)["code"];
      if (typeof code === "string" && /^[A-Za-z0-9_]{1,32}$/.test(code)) {
        return code;
      }
    }
  } catch {
    // Not JSON.
  }
  return null;
}

export function createRest(
  network: Network,
  config: SupabaseConfig,
  session: Pick<Session, "accessToken">,
): Rest {
  const base = `${config.url}/rest/v1`;

  /** Sends with the current token; on a 401 refreshes once and sends again. Throws AuthError too. */
  async function call(
    method: "GET" | "POST" | "PATCH",
    path: string,
    headers: Record<string, string>,
    body?: object,
  ): Promise<Response> {
    let rejected: string | undefined;
    for (let attempt = 0; ; attempt += 1) {
      const token = await session.accessToken(rejected === undefined ? {} : { rejected });
      let response: Response;
      try {
        response = await network.request(`${base}/${path}`, {
          method,
          headers: {
            ...headers,
            apikey: config.publishableKey,
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      } catch {
        throw new RestError("offline");
      }
      if (response.status === 401 && attempt === 0) {
        rejected = token;
        continue;
      }
      if (!response.ok) {
        throw new RestError("http", response.status, await readCode(response));
      }
      return response;
    }
  }

  async function json(response: Response): Promise<unknown> {
    const text = await response.text();
    if (text === "") {
      return null;
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new RestError("http", response.status, "bad_response");
    }
  }

  return {
    async select<T>(table: string, query: string): Promise<T[]> {
      checkName(table);
      const response = await call("GET", `${table}?${query}`, { "Accept-Profile": "public" });
      const rows = await json(response);
      if (!Array.isArray(rows)) {
        throw new RestError("http", response.status, "bad_response");
      }
      return rows as T[];
    },

    async rpc<T>(name: string, args: object = {}): Promise<T> {
      checkName(name);
      const response = await call(
        "POST",
        `rpc/${name}`,
        { "Content-Profile": "public", "Content-Type": "application/json" },
        args,
      );
      return (await json(response)) as T;
    },

    async patch(table: string, filter: string, body: object): Promise<void> {
      checkName(table);
      if (filter.trim() === "") {
        throw new Error("A patch needs a filter.");
      }
      await call(
        "PATCH",
        `${table}?${filter}`,
        {
          "Content-Profile": "public",
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body,
      );
    },
  };
}
