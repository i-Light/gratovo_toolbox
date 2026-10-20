import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A stand-in for the team's Supabase project, for the Electron tests: Auth's token and logout
 * endpoints, the two tables the account reads, the profile PATCH and the YouTube-key function.
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
    send(response, 404, { message: "Not found" });
  }

  const sockets = new Set<import("node:net").Socket>();

  async function listen(): Promise<void> {
    const created = createServer((request, response) => {
      void readBody(request).then((body) => {
        handle(request, response, body);
      });
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
    stop,
    start: listen,
    close: stop,
  };
  return fake;
}
