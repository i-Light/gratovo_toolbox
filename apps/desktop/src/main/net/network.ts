import { createServer } from "node:http";

/**
 * The only door from the main process to the internet. Everything the app sends goes through
 * `createNetwork(...).request`, which refuses any address that is not on the allowlist. ESLint
 * forbids the raw network APIs anywhere else in the main process (eslint.config.mjs).
 */

/** Thrown, before anything is sent, when an address is not allowed. The message never holds the URL. */
export class NetworkRefusedError extends Error {
  constructor(reason: string) {
    super(`Request refused: ${reason}.`);
    this.name = "NetworkRefusedError";
  }
}

export interface Network {
  request(url: string, init?: RequestInit & { timeoutMs?: number }): Promise<Response>;
}

const defaultTimeoutMs = 30_000;

/** Origins are compared as written by the URL parser: scheme, host and port, nothing else. */
function normalise(origins: readonly string[]): ReadonlySet<string> {
  const result = new Set<string>();
  for (const origin of origins) {
    if (URL.canParse(origin)) {
      result.add(new URL(origin).origin);
    }
  }
  return result;
}

/** Plain http is only ever allowed for the test seam: this machine, an origin on the list. */
function schemeAllowed(url: URL): boolean {
  return url.protocol === "https:" || (url.protocol === "http:" && url.hostname === "127.0.0.1");
}

function check(url: string, allowed: ReadonlySet<string>): URL {
  if (!URL.canParse(url)) {
    throw new NetworkRefusedError("not a valid address");
  }
  const parsed = new URL(url);
  if (parsed.username !== "" || parsed.password !== "") {
    throw new NetworkRefusedError("the address carries a user name or password");
  }
  if (!schemeAllowed(parsed)) {
    throw new NetworkRefusedError("the address is not https");
  }
  if (!allowed.has(parsed.origin)) {
    throw new NetworkRefusedError("the host is not on the allowlist");
  }
  return parsed;
}

export function createNetwork(options: {
  allowedOrigins: readonly string[];
  fetch?: typeof fetch;
}): Network {
  const allowed = normalise(options.allowedOrigins);
  const send = options.fetch ?? globalThis.fetch.bind(globalThis);
  return {
    request(url, init = {}) {
      const target = check(url, allowed);
      const { timeoutMs = defaultTimeoutMs, signal, ...rest } = init;
      const timeout = AbortSignal.timeout(timeoutMs);
      return send(target.href, {
        ...rest,
        // A redirect could carry the request (and its token) to another host.
        redirect: "error",
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    },
  };
}

/** For the live connection (3d-2b): wss on an allowed https origin, or ws on the test seam's. */
export function checkWebSocketUrl(url: string, allowedOrigins: readonly string[]): URL {
  if (!URL.canParse(url)) {
    throw new NetworkRefusedError("not a valid address");
  }
  const parsed = new URL(url);
  const http = new URL(parsed.href);
  if (parsed.protocol === "wss:") {
    http.protocol = "https:";
  } else if (parsed.protocol === "ws:") {
    http.protocol = "http:";
  } else {
    throw new NetworkRefusedError("not a websocket address");
  }
  check(http.href, normalise(allowedOrigins));
  return parsed;
}

/**
 * A WebSocket class for the Realtime client's `transport` option. Its constructor runs
 * `checkWebSocketUrl` before anything is opened, so the live connection can only reach the
 * allowlist. This is the one place in main that may name `WebSocket`.
 */
export function createGuardedWebSocket(allowedOrigins: readonly string[]): typeof WebSocket {
  const Base = globalThis.WebSocket;
  return class GuardedWebSocket extends Base {
    constructor(...args: ConstructorParameters<typeof WebSocket>) {
      const [url, ...rest] = args;
      super(checkWebSocketUrl(String(url), allowedOrigins).href, ...rest);
    }
  };
}

/** One request to the loopback listener, as much of it as a handler may look at. */
export interface LoopbackRequest {
  readonly method: string;
  /** The request target as sent, such as `/?code=…&state=…`. */
  readonly url: string;
  readonly host: string | undefined;
}

/** The whole answer: a status, headers and a short text body. */
export interface LoopbackReply {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface LoopbackServer {
  /** The port the system picked. */
  readonly port: number;
  /** Stops listening and drops every connection. Safe to call more than once. */
  close(): Promise<void>;
}

/** Answers each request on the loopback listener, synchronously. */
export type LoopbackHandler = (request: LoopbackRequest) => LoopbackReply;

const loopbackGraceMs = 1_000;

/**
 * A listener on 127.0.0.1 with a port the system picks, for Google's consent redirect (plan D10).
 * It never reaches out: it only answers the browser on this machine. It lives here because
 * ESLint keeps `node:http` in this file alone. Request bodies are never read.
 */
export function listenOnLoopback(handler: LoopbackHandler): Promise<LoopbackServer> {
  const server = createServer((request, response) => {
    let reply: LoopbackReply;
    try {
      reply = handler({
        method: request.method ?? "",
        url: request.url ?? "",
        host: request.headers.host,
      });
    } catch {
      reply = { status: 500, headers: {}, body: "" };
    }
    response.writeHead(reply.status, {
      ...reply.headers,
      "Content-Length": String(Buffer.byteLength(reply.body)),
      Connection: "close",
    });
    response.end(reply.body);
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 10_000;
  server.maxHeadersCount = 50;

  let closing: Promise<void> | null = null;
  const close = (): Promise<void> => {
    closing ??= new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
      server.closeIdleConnections();
      // An answer still being written gets a moment to finish; then everything goes.
      setTimeout(() => {
        server.closeAllConnections();
      }, loopbackGraceMs).unref();
    });
    return closing;
  };

  return new Promise<LoopbackServer>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        void close();
        reject(new Error("The loopback listener has no port."));
        return;
      }
      resolve({ port: address.port, close });
    });
  });
}
