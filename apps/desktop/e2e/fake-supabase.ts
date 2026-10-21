import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A stand-in for the team's Supabase project, for the Electron tests: Auth's token and logout
 * endpoints, the tables the sync reads and writes (in memory, with the keyset filters the app
 * sends), the profile PATCH and the YouTube-key function. There is no Realtime server: a
 * WebSocket upgrade is refused, so the app's live client can never join (and must cope).
 * It listens on 127.0.0.1 (the only plain-http address the app allows, and only through the test
 * seam). Every value in here is made up. Nothing here is real, and nothing reads the environment.
 */

/** The publishable key the fake accepts. It has the shape the app requires. */
export const fakePublishableKey = "sb_publishable_e2e000";

const memberPassword = "pw-e2e-000-correct";
const at = "2026-10-20T10:00:00.000Z";

export interface RecordedRequest {
  readonly method: string;
  /** Path and query. */
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export type SyncTable =
  | "channel_state"
  | "brands"
  | "deals"
  | "activity_log"
  | "sync_tombstones"
  | "notification_switches"
  | "edit_conflicts";

/** The server's columns for each table (a row in the fake holds all of them). */
const columns: Record<SyncTable, readonly string[]> = {
  channel_state: [
    "channel_id",
    "handle",
    "vetting_status",
    "relevance_criteria",
    "notes",
    "pipeline_stage",
    "channel_tags",
    "contacts",
    "provided_data",
    "archive_due_at",
    "last_deal_at",
    "last_edited_by",
    "last_edited_by_name",
    "updated_at",
    "owner_id",
    "manual_engagement_rate",
    "manual_engagement_note",
    "manual_engagement_updated_at",
    "media_kit",
    "creator_gender",
    "creator_stage",
  ],
  brands: [
    "id",
    "name",
    "contact_name",
    "contact_email",
    "contact_phone",
    "website",
    "budget",
    "campaign_brief",
    "preferred_criteria",
    "notes",
    "created_at",
    "updated_at",
    "category",
    "country",
    "contacts",
    "budget_currency",
    "source",
    "sells",
    "status",
  ],
  deals: [
    "id",
    "brand_id",
    "channel_id",
    "stage",
    "brand_price",
    "influencer_payout",
    "deliverables",
    "deadline",
    "contract_url",
    "notes",
    "working_days_estimate",
    "created_at",
    "updated_at",
    "campaign_id",
    "owner_id",
    "currency",
    "brand_invoice_sent_at",
    "brand_invoice_paid_at",
    "creator_payout_due_at",
    "creator_payout_paid_at",
    "payment_method",
    "payment_reference",
    "payment_terms",
    "tracking_link",
    "creator_contract_url",
    "creator_contract_status",
    "creator_signed_at",
    "brand_contract_url",
    "brand_contract_status",
    "brand_signed_at",
    "flow_step",
  ],
  activity_log: [
    "id",
    "at",
    "actor_id",
    "actor_name",
    "actor_role",
    "action",
    "entity_type",
    "entity_id",
    "entity_label",
    "field",
    "old_value",
    "new_value",
    "detail",
    "received_at",
  ],
  sync_tombstones: ["table_name", "row_id", "deleted_at"],
  notification_switches: ["profile_id", "switches", "updated_at"],
  edit_conflicts: [
    "id",
    "channel_id",
    "channel_label",
    "field",
    "base_value",
    "mine_value",
    "theirs_value",
    "mine_actor_id",
    "mine_actor_name",
    "theirs_actor_name",
    "detected_at",
    "resolved_at",
    "updated_at",
  ],
};

/** What a column holds when a test doesn't say (the NOT NULL ones; everything else is null). */
const defaults: Partial<Record<SyncTable, Record<string, unknown>>> = {
  channel_state: {
    vetting_status: "newlyFound",
    pipeline_stage: "new",
    channel_tags: [],
    contacts: [],
  },
  brands: { contacts: [], budget_currency: "USD" },
  deals: {
    stage: "proposed",
    brand_price: 0,
    influencer_payout: 0,
    currency: "USD",
    creator_contract_status: "none",
    brand_contract_status: "none",
  },
  activity_log: { actor_name: "Teammate", actor_role: "basic", action: "note", entity_type: "app" },
};

const keyColumn: Record<SyncTable, string> = {
  channel_state: "channel_id",
  brands: "id",
  deals: "id",
  activity_log: "id",
  sync_tombstones: "row_id",
  notification_switches: "profile_id",
  edit_conflicts: "id",
};

/** The columns a table's cursor is on (the app's keyset pull). */
const cursorColumn: Partial<Record<SyncTable, string>> = {
  channel_state: "updated_at",
  brands: "updated_at",
  deals: "updated_at",
  activity_log: "received_at",
  sync_tombstones: "deleted_at",
};

/**
 * A server timestamp in one fixed format with microseconds and `+00:00`, so text order is time
 * order. `n` counts seconds from a made-up start; the microseconds are never zero.
 */
export function serverTime(n: number): string {
  const ms = Date.UTC(2026, 9, 20, 10, 0, 0) + n * 1000;
  const iso = new Date(ms).toISOString();
  return `${iso.slice(0, 19)}.${iso.slice(20, 23)}${String(100 + (n % 900))}+00:00`;
}

export interface FakeUser {
  readonly id: string;
  readonly email: string;
  readonly password: string;
}

export interface FakeSupabase {
  /** `http://127.0.0.1:<port>`. */
  readonly url: string;
  readonly key: string;
  readonly port: number;
  readonly password: string;
  /** Every request in order, including the ones refused. */
  readonly requests: readonly RecordedRequest[];
  /** Every access and refresh token the fake has issued. */
  readonly issued: readonly string[];
  addUser(input: {
    email: string;
    role: "unauthorized" | "basic" | "full";
    roles?: string[];
    seesMoney?: boolean;
  }): FakeUser;
  setRole(userId: string, role: "unauthorized" | "basic" | "full"): void;
  displayName(userId: string): string | undefined;
  /** Ends every session of a person, as an admin would: refresh tokens and access tokens stop working. */
  revokeSessions(userId: string): void;
  /** Requests whose method and path start with these. */
  count(method: string, pathPrefix: string): number;
  /** The data tables: `channel_state`, `brands`, `deals`, `activity_log`, `sync_tombstones`, ... */
  rows(table: SyncTable): readonly Record<string, unknown>[];
  /**
   * Adds rows with every column filled (null where the server allows it) and a fresh, strictly
   * later cursor time (`updated_at`, or `received_at` for the log), unless the row names one.
   * Returns the rows as stored.
   */
  addRows(table: SyncTable, rows: readonly Record<string, unknown>[]): Record<string, unknown>[];
  /** Removes a row and writes its tombstone, as the server's trigger does. */
  deleteRow(table: "channel_state" | "brands" | "deals", key: string): void;
  /** Changes columns of a row and moves its `updated_at` on, as a teammate's edit would. */
  updateRow(
    table: "channel_state" | "brands" | "deals",
    key: string,
    changes: Record<string, unknown>,
  ): void;
  /** Sets what an RPC answers: a JSON value, or a function of the sent arguments. */
  scriptRpc(name: string, answer: unknown): void;
  /** Requests that were `DELETE`s. The app never sends one; tests assert this stays empty. */
  deletes(): RecordedRequest[];
  /** Requests whose method and path start with these, with their bodies parsed. */
  sent(method: string, pathPrefix: string): { path: string; body: unknown }[];
  /** Stops listening and cuts open connections; state is kept. */
  stop(): Promise<void>;
  /** Listens again on the same port. */
  start(): Promise<void>;
  /** Stops for good. */
  close(): Promise<void>;
}

function send(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  if (body === undefined) {
    response.writeHead(status, headers);
    response.end();
    return;
  }
  response.writeHead(status, { "Content-Type": "application/json", ...headers });
  response.end(JSON.stringify(body));
}

function authError(response: ServerResponse, code: string): void {
  send(response, 400, { code: 400, error_code: code, msg: code }, { "x-sb-error-code": code });
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function startFakeSupabase(): Promise<FakeSupabase> {
  const users: FakeUser[] = [];
  const profiles = new Map<string, Record<string, unknown>>();
  const access = new Map<string, Record<string, unknown>>();
  const accessTokens = new Map<string, string>();
  const refreshTokens = new Map<string, string>();
  const issued: string[] = [];
  const requests: RecordedRequest[] = [];
  const youtubeKey = "yt-e2e-000";
  const tables: Record<SyncTable, Record<string, unknown>[]> = {
    channel_state: [],
    brands: [],
    deals: [],
    activity_log: [],
    sync_tombstones: [],
    notification_switches: [],
    edit_conflicts: [],
  };
  const rpcScripts = new Map<string, unknown>();
  const purgedBefore = serverTime(-1_000_000);
  let clock = 0;
  let server: Server | null = null;
  let port = 0;

  function issue(response: ServerResponse, userId: string): void {
    const accessToken = `at-e2e-${randomUUID()}`;
    const refreshToken = `rt-e2e-${randomUUID()}`;
    accessTokens.set(accessToken, userId);
    refreshTokens.set(refreshToken, userId);
    issued.push(accessToken, refreshToken);
    send(response, 200, {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: "bearer",
      user: { id: userId, email: users.find((user) => user.id === userId)?.email },
    });
  }

  function revokeSessions(userId: string): void {
    for (const tokens of [accessTokens, refreshTokens]) {
      for (const [token, owner] of tokens) {
        if (owner === userId) {
          tokens.delete(token);
        }
      }
    }
  }

  /** The next cursor time: strictly later than every one before it. */
  function tick(): string {
    clock += 1;
    return serverTime(clock);
  }

  function fullRow(table: SyncTable, given: Record<string, unknown>): Record<string, unknown> {
    const row: Record<string, unknown> = {};
    for (const column of columns[table]) {
      row[column] = given[column] ?? defaults[table]?.[column] ?? null;
    }
    const cursor = cursorColumn[table];
    if (cursor !== undefined && given[cursor] === undefined) {
      row[cursor] = tick();
    }
    if (table === "brands" || table === "deals") {
      row["created_at"] = given["created_at"] ?? row["updated_at"];
    }
    if (table === "activity_log" && given["at"] === undefined) {
      row["at"] = new Date().toISOString();
    }
    if (table === "notification_switches" || table === "edit_conflicts") {
      row["updated_at"] = given["updated_at"] ?? tick();
    }
    return row;
  }

  function addRows(
    table: SyncTable,
    rows: readonly Record<string, unknown>[],
  ): Record<string, unknown>[] {
    const stored = rows.map((given) => fullRow(table, given));
    tables[table].push(...stored);
    return stored;
  }

  function findRow(table: SyncTable, key: string): Record<string, unknown> | undefined {
    return tables[table].find((row) => row[keyColumn[table]] === key);
  }

  /** Values of a PostgREST `in.(a,b)` or `eq.x` filter, unquoted. */
  function matches(row: Record<string, unknown>, column: string, filter: string): boolean {
    const value = row[column];
    if (filter === "is.null") {
      return value === null || value === undefined;
    }
    if (filter.startsWith("eq.")) {
      return String(value) === filter.slice(3);
    }
    if (filter.startsWith("in.(") && filter.endsWith(")")) {
      return filter.slice(4, -1).split(",").includes(String(value));
    }
    throw new Error(`The fake does not know the filter ${column}=${filter}`);
  }

  /**
   * The exact keyset shape the app sends: `(c.gt."v",and(c.eq."v",k.gt."w"),and(c.eq."v",k.eq."w",
   * k2.gt."x"))`. The last `and(...)` holds every column and value of the cursor tuple, in order.
   */
  function keysetFilter(or: string): (row: Record<string, unknown>) => boolean {
    const last = or.lastIndexOf("and(");
    if (!or.startsWith("(") || !or.endsWith("))") || last < 0) {
      throw new Error(`The fake does not know the or filter ${or}`);
    }
    const pairs: { column: string; value: string }[] = [];
    for (const match of or.slice(last).matchAll(/(\w+)\.(?:eq|gt)\."((?:[^"\\]|\\.)*)"/g)) {
      pairs.push({
        column: match[1] ?? "",
        value: (match[2] ?? "").replace(/\\(["\\])/g, "$1"),
      });
    }
    return (row) => {
      for (const { column, value } of pairs) {
        const own = String(row[column]);
        if (own > value) {
          return true;
        }
        if (own < value) {
          return false;
        }
      }
      return false;
    };
  }

  function select(
    table: SyncTable,
    params: URLSearchParams,
    caller: string,
    authorized: boolean,
  ): unknown[] {
    let rows = tables[table].filter((row) => {
      if (!authorized) {
        return false;
      }
      return table !== "notification_switches" || row["profile_id"] === caller;
    });
    for (const [name, value] of params) {
      if (["select", "order", "limit", "offset"].includes(name)) {
        continue;
      }
      if (name === "or") {
        rows = rows.filter(keysetFilter(value));
      } else {
        rows = rows.filter((row) => matches(row, name, value));
      }
    }
    const order = params.get("order");
    if (order !== null) {
      const keys = order.split(",").map((part) => {
        const [column = "", direction = "asc"] = part.split(".");
        return { column, sign: direction === "desc" ? -1 : 1 };
      });
      rows = [...rows].sort((a, b) => {
        for (const { column, sign } of keys) {
          const x = String(a[column]);
          const y = String(b[column]);
          if (x !== y) {
            return x < y ? -sign : sign;
          }
        }
        return 0;
      });
    }
    const limit = Number(params.get("limit") ?? rows.length);
    const wanted = params.get("select");
    const names = wanted === null || wanted === "*" ? null : wanted.split(",");
    return rows.slice(0, limit).map((row) => {
      if (names === null) {
        return row;
      }
      return Object.fromEntries(names.map((name) => [name, row[name] ?? null]));
    });
  }

  function writeRows(table: SyncTable, body: string, prefer: string): void {
    const sent = (body === "" ? [] : JSON.parse(body)) as Record<string, unknown>[];
    const ignore = prefer.includes("ignore-duplicates");
    for (const given of Array.isArray(sent) ? sent : [sent]) {
      const existing = findRow(table, String(given[keyColumn[table]]));
      if (existing === undefined) {
        addRows(table, [given]);
      } else if (!ignore) {
        Object.assign(existing, given);
        const cursor = cursorColumn[table];
        if (cursor !== undefined) {
          existing[cursor] = tick();
        } else {
          existing["updated_at"] = tick();
        }
      }
    }
  }

  function handle(request: IncomingMessage, response: ServerResponse, body: string): void {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const method = request.method ?? "GET";
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(request.headers)) {
      headers[name] = Array.isArray(value) ? value.join(",") : (value ?? "");
    }
    requests.push({ method, path: `${url.pathname}${url.search}`, headers, body });

    if (headers["apikey"] !== fakePublishableKey) {
      send(response, 401, { message: "No API key found in request" });
      return;
    }

    if (method === "POST" && url.pathname === "/auth/v1/token") {
      const sent = (body === "" ? {} : JSON.parse(body)) as Record<string, string>;
      const grant = url.searchParams.get("grant_type");
      if (grant === "password") {
        const user = users.find(
          (candidate) =>
            candidate.email === sent["email"] && candidate.password === sent["password"],
        );
        if (user === undefined) {
          authError(response, "invalid_credentials");
        } else {
          issue(response, user.id);
        }
        return;
      }
      if (grant === "refresh_token") {
        const token = sent["refresh_token"] ?? "";
        const owner = refreshTokens.get(token);
        if (owner === undefined) {
          authError(response, "refresh_token_not_found");
          return;
        }
        // Single use: the old token is gone as soon as it is spent.
        refreshTokens.delete(token);
        issue(response, owner);
        return;
      }
      authError(response, "validation_failed");
      return;
    }

    const bearer = (headers["authorization"] ?? "").replace(/^Bearer /, "");
    const caller = accessTokens.get(bearer);

    if (method === "POST" && url.pathname === "/auth/v1/logout") {
      if (caller !== undefined) {
        revokeSessions(caller);
      }
      send(response, 204, undefined);
      return;
    }
    if (caller === undefined) {
      send(response, 401, { code: "PGRST301", message: "JWT expired" });
      return;
    }

    const role = profiles.get(caller)?.["role"];
    const authorized = role === "basic" || role === "full";
    const idFilter = url.searchParams.get("id")?.replace(/^eq\./, "");

    if (method === "GET" && url.pathname === "/rest/v1/profiles") {
      const rows = [...profiles.values()].filter(
        (row) => (authorized || row["id"] === caller) && (idFilter ?? row["id"]) === row["id"],
      );
      send(response, 200, rows);
      return;
    }
    if (method === "GET" && url.pathname === "/rest/v1/member_access") {
      const rows = [...access.values()].filter((row) => authorized || row["profile_id"] === caller);
      send(response, 200, rows);
      return;
    }
    if (method === "PATCH" && url.pathname === "/rest/v1/profiles") {
      const row = profiles.get(caller);
      if (row !== undefined && idFilter === caller) {
        row["display_name"] = (JSON.parse(body) as { display_name: string }).display_name;
        row["updated_at"] = new Date().toISOString();
      }
      send(response, 204, undefined);
      return;
    }
    if (method === "POST" && url.pathname === "/rest/v1/rpc/team_youtube_key") {
      if (authorized) {
        send(response, 200, youtubeKey);
      } else {
        send(response, 403, { code: "42501", message: "unauthorized" });
      }
      return;
    }
    const table = /^\/rest\/v1\/(\w+)$/.exec(url.pathname)?.[1];
    const prefer = headers["prefer"] ?? "";
    if (table === "sync_control" && method === "GET") {
      send(response, 200, authorized ? [{ tombstones_purged_before: purgedBefore }] : []);
      return;
    }
    if (table !== undefined && table in tables) {
      const name = table as SyncTable;
      if (method === "GET") {
        send(response, 200, select(name, url.searchParams, caller, authorized));
        return;
      }
      if (method === "POST" && authorized) {
        writeRows(name, body, prefer);
        send(response, 201, undefined);
        return;
      }
      if (method === "PATCH" && authorized) {
        const row = findRow(name, idFilter ?? "");
        if (row !== undefined) {
          Object.assign(row, JSON.parse(body) as Record<string, unknown>);
          row["updated_at"] = tick();
        }
        send(response, 204, undefined);
        return;
      }
      if (method === "DELETE") {
        // Recorded in `requests`; nothing is removed. The app must never send one.
        send(response, 204, undefined);
        return;
      }
    }
    const rpc = /^\/rest\/v1\/rpc\/(\w+)$/.exec(url.pathname)?.[1];
    if (method === "POST" && rpc !== undefined && authorized && rpcScripts.has(rpc)) {
      const answer = rpcScripts.get(rpc);
      const sent = (body === "" ? {} : JSON.parse(body)) as Record<string, unknown>;
      send(
        response,
        200,
        typeof answer === "function" ? (answer as (a: object) => unknown)(sent) : answer,
      );
      return;
    }
    if (method === "POST" && rpc !== undefined) {
      send(response, 404, { code: "PGRST202", message: "Could not find the function" });
      return;
    }
    send(response, 404, { message: "Not found" });
  }

  const sockets = new Set<import("node:net").Socket>();

  async function listen(): Promise<void> {
    const created = createServer((request, response) => {
      void readBody(request).then((body) => {
        handle(request, response, body);
      });
    });
    // No Realtime: a WebSocket upgrade is refused (and recorded), so the live client never joins.
    created.on("upgrade", (request, socket) => {
      requests.push({
        method: "UPGRADE",
        path: request.url ?? "",
        headers: {},
        body: "",
      });
      socket.end(
        ["HTTP/1.1 403 Forbidden", "Connection: close", "Content-Length: 0", "", ""].join(
          String.fromCharCode(13, 10),
        ),
      );
    });
    created.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    await new Promise<void>((resolve, reject) => {
      created.once("error", reject);
      created.listen(port, "127.0.0.1", () => {
        created.off("error", reject);
        resolve();
      });
    });
    port = (created.address() as AddressInfo).port;
    server = created;
  }

  async function stop(): Promise<void> {
    const current = server;
    server = null;
    if (current === null) {
      return;
    }
    for (const socket of sockets) {
      socket.destroy();
    }
    await new Promise<void>((resolve) => {
      current.close(() => {
        resolve();
      });
    });
  }

  await listen();

  const fake: FakeSupabase = {
    get url() {
      return `http://127.0.0.1:${String(port)}`;
    },
    key: fakePublishableKey,
    get port() {
      return port;
    },
    password: memberPassword,
    requests,
    issued,
    addUser({ email, role, roles = [], seesMoney = false }) {
      const id = `00000000-0000-4000-8000-${String(users.length + 1).padStart(12, "0")}`;
      const user = { id, email, password: memberPassword };
      users.push(user);
      profiles.set(id, {
        id,
        display_name: email.split("@")[0] ?? "",
        color: "#112233",
        role,
        created_at: `2026-10-20T10:00:0${String(users.length)}.000Z`,
        updated_at: at,
      });
      access.set(id, { profile_id: id, roles, sees_money: seesMoney, updated_at: at });
      return user;
    },
    setRole(userId, role) {
      const row = profiles.get(userId);
      if (row !== undefined) {
        row["role"] = role;
      }
    },
    displayName: (userId) => profiles.get(userId)?.["display_name"] as string | undefined,
    revokeSessions,
    count: (method, pathPrefix) =>
      requests.filter((r) => r.method === method && r.path.startsWith(pathPrefix)).length,
    rows: (table) => tables[table],
    addRows,
    deleteRow(table, key) {
      const index = tables[table].findIndex((row) => row[keyColumn[table]] === key);
      if (index >= 0) {
        tables[table].splice(index, 1);
      }
      addRows("sync_tombstones", [{ table_name: table, row_id: key, deleted_at: tick() }]);
    },
    updateRow(table, key, changes) {
      const row = findRow(table, key);
      if (row !== undefined) {
        Object.assign(row, changes, { updated_at: tick() });
      }
    },
    scriptRpc: (name, answer) => {
      rpcScripts.set(name, answer);
    },
    deletes: () => requests.filter((r) => r.method === "DELETE"),
    sent: (method, pathPrefix) =>
      requests
        .filter((r) => r.method === method && r.path.startsWith(pathPrefix))
        .map((r) => ({
          path: r.path,
          body: r.body === "" ? null : (JSON.parse(r.body) as unknown),
        })),
    stop,
    start: listen,
    close: stop,
  };
  return fake;
}
