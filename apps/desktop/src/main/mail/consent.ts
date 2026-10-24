import { createHash, randomBytes as cryptoRandomBytes, timingSafeEqual } from "node:crypto";

import type { MailConnectResult } from "@gratovo/ipc";

import {
  listenOnLoopback,
  type LoopbackHandler,
  type LoopbackReply,
  type LoopbackRequest,
  type LoopbackServer,
  type Network,
} from "../net/network";
import type { MailConsentService } from "../services";
import { strings } from "../strings";

/**
 * Connecting a Gmail mailbox (plan step 4, D10): OAuth 2.0 for installed apps. A one-shot
 * listener on 127.0.0.1 with a port the system picks, PKCE (S256), a random `state`, Google's
 * consent page in the system browser, five minutes to finish, one code accepted. Main exchanges
 * the code at Google's token endpoint and stores the refresh token through `saveMailbox`.
 *
 * Nothing secret is logged: no code, verifier, state, token, client secret or address. Log lines
 * name a step and a reason or an HTTP status, nothing else.
 */

export type MailConnectFailure = Extract<MailConnectResult, { ok: false }>["reason"];

/** The Gmail app the owner made in Google Cloud, from the secret `mail.client`. */
export interface MailClient {
  readonly id: string;
  readonly secret: string;
}

export type SaveMailboxResult = { ok: true } | { ok: false; reason: MailConnectFailure };

export interface MailConsentDeps {
  /** The stored `mail.client`, or null when none is stored (or it is unreadable). */
  readClient: () => Promise<MailClient | null>;
  /** Opens Google's consent page in the system browser. W1 guards it with `isGoogleConsentUrl`. */
  openExternal: (url: string) => Promise<void>;
  /** A network whose allowlist holds only `https://oauth2.googleapis.com`. */
  network: Network;
  /** Stores the refresh token (replacing the same address) and the mailbox's settings row. */
  saveMailbox: (address: string, refreshToken: string) => Promise<SaveMailboxResult>;
  /** False when no more mailboxes fit (20 already): checked before the browser opens. */
  canAddMailbox?: () => boolean | Promise<boolean>;
  log: (line: string) => void;
  randomBytes?: (size: number) => Uint8Array;
  now?: () => number;
  /** How long the person has to finish on Google's page. Five minutes by default. */
  timeoutMs?: number;
  /** The loopback listener; `listenOnLoopback` by default. */
  listen?: (handler: LoopbackHandler) => Promise<LoopbackServer>;
}

export const googleAuthUrl = "https://accounts.google.com/o/oauth2/v2/auth";
export const googleTokenUrl = "https://oauth2.googleapis.com/token";
/** As the old app (legacy/pipeline/gratovo/gmail.py), plus `openid email` for the address. */
export const gmailScopes =
  "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send openid email";

const defaultTimeoutMs = 5 * 60_000;
const exchangeTimeoutMs = 30_000;
const randomSize = 32;
const googleIssuers = new Set(["https://accounts.google.com", "accounts.google.com"]);
// As packages/ipc/src/connections.ts.
const emailShape = /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/;

const pageText = strings.mailConsent;

const pageHeaders: Readonly<Record<string, string>> = {
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy": "default-src 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

function page(status: number, text: string): LoopbackReply {
  return {
    status,
    headers: pageHeaders,
    body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${pageText.title}</title></head><body><p>${text}</p></body></html>`,
  };
}

function bare(status: number): LoopbackReply {
  return {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    body: "",
  };
}

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(reason: MailConnectFailure): MailConnectResult {
  return { ok: false, reason };
}

/** What the browser brought back to the loopback listener. */
type Callback = { kind: "code"; code: string } | { kind: "failed"; reason: MailConnectFailure };

/**
 * The address in the token response's `id_token`, or null when it can't be trusted.
 *
 * No signature check: the token came straight from Google's token endpoint over TLS, in answer to
 * our own request with our client secret, so it is as trustworthy as the channel (OpenID Connect
 * Core 3.1.3.7 allows this). The claims are still checked so a token meant for another client,
 * or an unverified address, is refused.
 */
function addressFromIdToken(idToken: string, clientId: string): string | null {
  const parts = idToken.split(".");
  const body = parts[1];
  if (parts.length !== 3 || body === undefined || !/^[A-Za-z0-9_-]+$/.test(body)) {
    return null;
  }
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!isRecord(claims)) {
    return null;
  }
  const { aud, iss, email, email_verified: verified } = claims;
  if (aud !== clientId || typeof iss !== "string" || !googleIssuers.has(iss)) {
    return null;
  }
  if (verified === false || verified === "false" || typeof email !== "string") {
    return null;
  }
  const address = email.toLowerCase();
  return address.length >= 3 && address.length <= 320 && emailShape.test(address) ? address : null;
}

export function createMailConsent(deps: MailConsentDeps): MailConsentService {
  const {
    log,
    network,
    randomBytes = cryptoRandomBytes,
    now = Date.now,
    timeoutMs = defaultTimeoutMs,
    listen = listenOnLoopback,
  } = deps;
  let busy = false;

  /** Waits for Google's redirect on the loopback listener; settles once. */
  async function awaitCallback(state: string, client: MailClient) {
    let settle: (callback: Callback) => void = () => undefined;
    const callback = new Promise<Callback>((resolve) => {
      settle = resolve;
    });
    let settled = false;
    const finish = (result: Callback): void => {
      if (!settled) {
        settled = true;
        settle(result);
      }
    };
    const deadline = now() + timeoutMs;
    let port = 0;

    const handle = (request: LoopbackRequest): LoopbackReply => {
      // Origin-form only: "//host/…" would parse as another host.
      if (settled || !request.url.startsWith("/") || request.url.startsWith("//")) {
        return bare(404);
      }
      const target = new URL(request.url, "http://127.0.0.1");
      // Browsers ask for this on their own; it must not end the connect.
      if (target.pathname === "/favicon.ico") {
        return bare(404);
      }
      if (request.method !== "GET") {
        return bare(405);
      }
      // Any other Host is not the redirect we asked for (a DNS rebinding page, say).
      if (request.host !== `127.0.0.1:${String(port)}`) {
        return bare(400);
      }
      if (target.pathname !== "/") {
        return bare(404);
      }
      const params = target.searchParams;
      const states = params.getAll("state");
      // A wrong state is a stale tab or a forged request: either way this connect is over.
      if (states.length !== 1 || !sameText(states[0] ?? "", state)) {
        finish({ kind: "failed", reason: "bad_state" });
        return page(400, pageText.failed);
      }
      if (now() > deadline) {
        finish({ kind: "failed", reason: "timeout" });
        return page(400, pageText.failed);
      }
      const error = params.get("error");
      if (error !== null) {
        finish({ kind: "failed", reason: error === "access_denied" ? "denied" : "failed" });
        return page(400, pageText.failed);
      }
      const codes = params.getAll("code");
      const code = codes[0];
      if (codes.length !== 1 || code === undefined || code === "") {
        finish({ kind: "failed", reason: "bad_response" });
        return page(400, pageText.failed);
      }
      finish({ kind: "code", code });
      return page(200, pageText.done);
    };

    const server = await listen(handle);
    port = server.port;
    const redirectUri = `http://127.0.0.1:${String(port)}/`;
    const timer = setTimeout(() => {
      finish({ kind: "failed", reason: "timeout" });
    }, timeoutMs);
    try {
      const verifier = base64url(randomBytes(randomSize));
      const challenge = base64url(createHash("sha256").update(verifier, "ascii").digest());
      const consent = new URL(googleAuthUrl);
      consent.search = new URLSearchParams({
        client_id: client.id,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: gmailScopes,
        code_challenge: challenge,
        code_challenge_method: "S256",
        state,
        access_type: "offline",
        // Without it, a mailbox that agreed before gets no refresh token.
        prompt: "consent",
      }).toString();
      await deps.openExternal(consent.href);
      return { result: await callback, redirectUri, verifier };
    } finally {
      clearTimeout(timer);
      finish({ kind: "failed", reason: "failed" });
      await server.close();
    }
  }

  async function exchange(
    client: MailClient,
    code: string,
    redirectUri: string,
    verifier: string,
  ): Promise<MailConnectResult> {
    const response = await network.request(googleTokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        code,
        client_id: client.id,
        client_secret: client.secret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code_verifier: verifier,
      }).toString(),
      timeoutMs: exchangeTimeoutMs,
    });
    if (!response.ok) {
      // The body may echo what was sent; only the status is logged.
      log(`Mail consent: the token exchange answered ${String(response.status)}.`);
      await response.body?.cancel();
      return fail("exchange_failed");
    }
    let tokens: unknown;
    try {
      tokens = await response.json();
    } catch {
      return fail("bad_response");
    }
    if (!isRecord(tokens)) {
      return fail("bad_response");
    }
    const refreshToken = tokens.refresh_token;
    if (typeof refreshToken !== "string" || refreshToken === "") {
      return fail("no_refresh_token");
    }
    const idToken = tokens.id_token;
    const address = typeof idToken === "string" ? addressFromIdToken(idToken, client.id) : null;
    if (address === null) {
      return fail("bad_response");
    }
    const saved = await deps.saveMailbox(address, refreshToken);
    return saved.ok ? { ok: true, address } : fail(saved.reason);
  }

  async function run(): Promise<MailConnectResult> {
    const client = await deps.readClient();
    if (client === null) {
      return fail("no_client");
    }
    if (deps.canAddMailbox !== undefined && !(await deps.canAddMailbox())) {
      return fail("too_many");
    }
    const state = base64url(randomBytes(randomSize));
    const { result, redirectUri, verifier } = await awaitCallback(state, client);
    if (result.kind === "failed") {
      return fail(result.reason);
    }
    return exchange(client, result.code, redirectUri, verifier);
  }

  return {
    async connect() {
      if (busy) {
        return fail("busy");
      }
      busy = true;
      try {
        const result = await run();
        log(
          result.ok
            ? "Mail consent: a mailbox was connected."
            : `Mail consent: ended with ${result.reason}.`,
        );
        return result;
      } catch (error) {
        // Only the error's kind: a message could hold a URL or a value.
        log(
          `Mail consent: failed unexpectedly (${error instanceof Error ? error.name : "unknown"}).`,
        );
        return fail("failed");
      } finally {
        busy = false;
      }
    },
  };
}
