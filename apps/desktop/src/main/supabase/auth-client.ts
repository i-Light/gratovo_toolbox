/**
 * Supabase Auth over plain HTTP (plan G1): password sign-in, refresh and sign-out, nothing else.
 * No Electron import, so the server tests (A10) run it against a real local stack.
 *
 * Nothing here logs. An `AuthError` carries a kind, the server's error code and the HTTP status:
 * never a response body, a token, a password or an email.
 *
 * Shapes, checked 2026-10-20 against the Auth server's source and docs:
 * - Token endpoint: `POST /auth/v1/token?grant_type=password` (body `email`, `password`) and
 *   `?grant_type=refresh_token` (body `refresh_token`); the answer holds `access_token`,
 *   `expires_in`, `expires_at`, `refresh_token` and `user`
 *   (https://github.com/supabase/auth/blob/master/README.md, internal/tokens/service.go).
 * - Errors: without an `X-Supabase-Api-Version` header the body is `{ code: <HTTP status>,
 *   error_code, msg }` and the code is repeated in the `x-sb-error-code` header; from API version
 *   2024-01-01 the body is `{ code: <error code>, message }`; OAuth-style errors are
 *   `{ error, error_description }` (internal/api/errors.go, internal/api/apierrors/apierrors.go).
 *   Branch on the code, never the message (https://supabase.com/docs/guides/auth/debugging/error-codes).
 * - Logout: `POST /auth/v1/logout?scope=global|local|others`, default `global`, 204 on success
 *   (internal/api/logout.go). We use `local`: only this device's session ends.
 */

import { z } from "zod";

import type { Network } from "../net/network";
import { NetworkRefusedError } from "../net/network";
import type { SupabaseConfig } from "./config";

export type AuthErrorKind =
  "invalid" | "unconfirmed" | "rate-limited" | "offline" | "ended" | "unavailable";

/** A failed Auth call. The message names only the kind, the code and the status. */
export class AuthError extends Error {
  readonly kind: AuthErrorKind;
  readonly code: string | null;
  readonly status: number | null;

  constructor(kind: AuthErrorKind, code: string | null = null, status: number | null = null) {
    super(
      `Supabase Auth: ${kind}` +
        (code === null ? "" : ` (${code})`) +
        (status === null ? "" : ` [HTTP ${String(status)}]`),
    );
    this.name = "AuthError";
    this.kind = kind;
    this.code = code;
    this.status = status;
  }
}

export interface Tokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** When the access token expires, in ms on this computer's clock. */
  readonly expiresAt: number;
  readonly userId: string;
  readonly email: string;
}

export interface AuthClient {
  signIn(email: string, password: string): Promise<Tokens>;
  refresh(refreshToken: string): Promise<Tokens>;
  /** Ends this device's session on the server. Best effort: it never throws. */
  signOut(accessToken: string): Promise<void>;
}

/**
 * Codes that mean the session is over and only a new sign-in helps (plan G4; meanings in
 * https://supabase.com/docs/guides/auth/debugging/error-codes). A refresh token is single-use:
 * reused outside the 10 s reuse interval it is refused with `refresh_token_already_used`
 * (https://supabase.com/docs/guides/auth/sessions; server tests confirm the code).
 */
const endedCodes: ReadonlySet<string> = new Set([
  "refresh_token_not_found",
  "refresh_token_already_used",
  "session_not_found",
  "session_expired",
  "user_banned",
]);

const signOutTimeoutMs = 5_000;

/** Server codes are short identifiers; anything else is dropped so no free text reaches a message. */
function cleanCode(value: unknown): string | null {
  return typeof value === "string" && /^[a-z0-9_]{1,64}$/.test(value) ? value : null;
}

/** The error code from any of the server's error shapes (see the header comment). */
async function readErrorCode(response: Response): Promise<string | null> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Not JSON: fall back to the header.
  }
  if (typeof body === "object" && body !== null) {
    const fields = body as Record<string, unknown>;
    const code = cleanCode(fields["error_code"]) ?? cleanCode(fields["code"]);
    if (code !== null) {
      return code;
    }
  }
  const header = cleanCode(response.headers.get("x-sb-error-code"));
  if (header !== null) {
    return header;
  }
  if (typeof body === "object" && body !== null) {
    return cleanCode((body as Record<string, unknown>)["error"]);
  }
  return null;
}

type Grant = "password" | "refresh_token";

/** Maps a refused token request to a kind. Exported for the tests. */
export function classify(grant: Grant, status: number, code: string | null): AuthErrorKind {
  if (code !== null && endedCodes.has(code)) {
    return "ended";
  }
  // On a refresh this code means a malformed request (our bug), not a dead session: keep it.
  if (code === "invalid_credentials") {
    return grant === "password" ? "invalid" : "unavailable";
  }
  if (code === "email_not_confirmed") {
    return "unconfirmed";
  }
  if (status === 429 || (code !== null && /^over_[a-z_]*rate_limit$/.test(code))) {
    return "rate-limited";
  }
  // The OAuth shape's "invalid_grant" (older servers): a wrong password, or a refused refresh
  // token. It is not an Auth error code, so for a refresh it is G4's "400 without a code".
  if (code === "invalid_grant") {
    return grant === "password" ? "invalid" : "ended";
  }
  // G4: a 400 or 401 from the token endpoint with no code ends a refresh; 5xx, `conflict`,
  // `request_timeout` and any other code keep the session.
  if (grant === "refresh_token" && code === null && (status === 400 || status === 401)) {
    return "ended";
  }
  return "unavailable";
}

const tokenResponse = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().positive(),
  user: z.object({ id: z.string().min(1), email: z.string().optional() }),
});

export function createAuthClient(
  network: Network,
  config: SupabaseConfig,
  options: { now?: () => number } = {},
): AuthClient {
  const now = options.now ?? Date.now;
  const base = `${config.url}/auth/v1`;

  async function send(url: string, init: RequestInit & { timeoutMs?: number }): Promise<Response> {
    try {
      return await network.request(url, init);
    } catch (error) {
      // A refused address, a DNS or connection failure and a timeout all mean "no answer".
      const code = error instanceof NetworkRefusedError ? "refused" : null;
      throw new AuthError("offline", code);
    }
  }

  async function token(grant: Grant, body: object, fallbackEmail: string): Promise<Tokens> {
    const response = await send(`${base}/token?grant_type=${grant}`, {
      method: "POST",
      headers: {
        apikey: config.publishableKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const code = await readErrorCode(response);
      throw new AuthError(classify(grant, response.status, code), code, response.status);
    }
    let parsed: z.infer<typeof tokenResponse>;
    try {
      parsed = tokenResponse.parse(await response.json());
    } catch {
      throw new AuthError("unavailable", "bad_response", response.status);
    }
    return {
      accessToken: parsed.access_token,
      refreshToken: parsed.refresh_token,
      // `expires_in` on our own clock, so a wrong system clock can't make every token look stale.
      expiresAt: now() + parsed.expires_in * 1000,
      userId: parsed.user.id,
      email: parsed.user.email ?? fallbackEmail,
    };
  }

  return {
    signIn(email, password) {
      const trimmed = email.trim();
      return token("password", { email: trimmed, password }, trimmed);
    },

    refresh(refreshToken) {
      return token("refresh_token", { refresh_token: refreshToken }, "");
    },

    async signOut(accessToken) {
      try {
        await network.request(`${base}/logout?scope=local`, {
          method: "POST",
          headers: { apikey: config.publishableKey, Authorization: `Bearer ${accessToken}` },
          timeoutMs: signOutTimeoutMs,
        });
      } catch {
        // Best effort: the token is forgotten here whatever the server says.
      }
    },
  };
}
