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
