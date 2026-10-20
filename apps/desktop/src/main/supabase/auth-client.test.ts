import { describe, expect, it, vi } from "vitest";

import type { Network } from "../net/network";
import { NetworkRefusedError } from "../net/network";
import type { AuthErrorKind } from "./auth-client";
import { AuthError, createAuthClient } from "./auth-client";
import type { SupabaseConfig } from "./config";

const config: SupabaseConfig = {
  url: "https://abcdefghijklmnopqrst.supabase.co",
  origin: "https://abcdefghijklmnopqrst.supabase.co",
  publishableKey: "sb_publishable_test000",
};

const email = "lina@example.com";
const password = "correct horse battery staple";

type Request = Parameters<Network["request"]>;

function fakeNetwork(answer: (url: string) => Response | Promise<Response>) {
  const request = vi.fn((...args: Request) => Promise.resolve(answer(args[0])));
  return { request, network: { request } satisfies Network };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const granted = {
  access_token: "access-1",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: 1,
  refresh_token: "refresh-1",
  user: { id: "user-1", email },
};

async function failure(promise: Promise<unknown>): Promise<AuthError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AuthError);
    return error as AuthError;
  }
  throw new Error("expected the call to fail");
}

describe("createAuthClient", () => {
  it("signs in with the password grant, the publishable key and a JSON body", async () => {
    const { request, network } = fakeNetwork(() => json(granted));
    const auth = createAuthClient(network, config, { now: () => 1_000 });

    const tokens = await auth.signIn(`  ${email} `, password);

    expect(tokens).toEqual({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAt: 1_000 + 3_600_000,
      userId: "user-1",
      email,
    });
    const [url, init] = request.mock.calls[0] ?? [];
    expect(url).toBe(`${config.url}/auth/v1/token?grant_type=password`);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      apikey: config.publishableKey,
      "Content-Type": "application/json",
    });
    expect(JSON.parse(init?.body as string)).toEqual({ email, password });
  });

  it("refreshes with the refresh-token grant", async () => {
    const { request, network } = fakeNetwork(() =>
      json({ ...granted, access_token: "access-2", refresh_token: "refresh-2" }),
    );
    const tokens = await createAuthClient(network, config).refresh("refresh-1");

    expect(tokens.accessToken).toBe("access-2");
    expect(tokens.refreshToken).toBe("refresh-2");
    const [url, init] = request.mock.calls[0] ?? [];
    expect(url).toBe(`${config.url}/auth/v1/token?grant_type=refresh_token`);
    expect(JSON.parse(init?.body as string)).toEqual({ refresh_token: "refresh-1" });
  });

  it("refuses a success answer that lacks a token", async () => {
    const { network } = fakeNetwork(() => json({ ...granted, access_token: undefined }));
    const error = await failure(createAuthClient(network, config).signIn(email, password));
    expect(error.kind).toBe("unavailable");
    expect(error.code).toBe("bad_response");
  });

  type Case = [string, "password" | "refresh", Response, AuthErrorKind, string | null];
  const legacy = (code: string, status = 400) =>
    json({ code: status, error_code: code, msg: "Some message" }, status);
  const cases: Case[] = [
    [
      "a wrong password",
      "password",
      legacy("invalid_credentials"),
      "invalid",
      "invalid_credentials",
    ],
    [
      "an unconfirmed email",
      "password",
      legacy("email_not_confirmed"),
      "unconfirmed",
      "email_not_confirmed",
    ],
    [
      "the 2024-01-01 body shape",
      "password",
      json({ code: "email_not_confirmed", message: "Email not confirmed" }, 400),
      "unconfirmed",
      "email_not_confirmed",
    ],
    ["a 429 without a code", "password", json({}, 429), "rate-limited", null],
    [
      "the rate-limit code",
      "password",
      legacy("over_request_rate_limit", 429),
      "rate-limited",
      "over_request_rate_limit",
    ],
    [
      "the email rate limit",
      "password",
      legacy("over_email_send_rate_limit", 429),
      "rate-limited",
      "over_email_send_rate_limit",
    ],
    [
      "the OAuth shape, password",
      "password",
      json({ error: "invalid_grant" }, 400),
      "invalid",
      "invalid_grant",
    ],
    [
      "the OAuth shape, refresh",
      "refresh",
      json({ error: "invalid_grant" }, 400),
      "ended",
      "invalid_grant",
    ],
    [
      "a 400 without a code at sign-in",
      "password",
      new Response("", { status: 400 }),
      "unavailable",
      null,
    ],
    [
      "a 400 without a code on refresh",
      "refresh",
      new Response("", { status: 400 }),
      "ended",
      null,
    ],
    ["a 401 without a code on refresh", "refresh", json({}, 401), "ended", null],
    [
      "the code in the header only",
      "refresh",
      new Response("not json", {
        status: 400,
        headers: { "x-sb-error-code": "refresh_token_already_used" },
      }),
      "ended",
      "refresh_token_already_used",
    ],
    [
      "invalid_credentials on a refresh",
      "refresh",
      legacy("invalid_credentials"),
      "unavailable",
      "invalid_credentials",
    ],
    ["a server error", "refresh", json({ code: 500, msg: "boom" }, 500), "unavailable", null],
    ["a conflict", "refresh", legacy("conflict", 409), "unavailable", "conflict"],
    ["a timeout", "refresh", legacy("request_timeout", 504), "unavailable", "request_timeout"],
    ["an unknown code", "refresh", legacy("validation_failed"), "unavailable", "validation_failed"],
  ];
  for (const ended of [
    "refresh_token_not_found",
    "refresh_token_already_used",
    "session_not_found",
    "session_expired",
    "user_banned",
  ]) {
    cases.push([`${ended} on refresh`, "refresh", legacy(ended), "ended", ended]);
  }

  it.each(cases)("maps %s", async (_name, call, response, kind, code) => {
    const { network } = fakeNetwork(() => response);
    const auth = createAuthClient(network, config);
    const error = await failure(
      call === "password" ? auth.signIn(email, password) : auth.refresh("refresh-1"),
    );
    expect(error.kind).toBe(kind);
    expect(error.code).toBe(code);
    expect(error.status).toBe(response.status);
  });

  it.each([
    ["a refused address", new NetworkRefusedError("the host is not on the allowlist"), "refused"],
    ["a connection failure", new TypeError("fetch failed"), null],
    ["a timeout", new DOMException("The operation timed out.", "TimeoutError"), null],
  ])("treats %s as offline", async (_name, thrown, code) => {
    const network: Network = { request: () => Promise.reject(thrown) };
    const error = await failure(createAuthClient(network, config).refresh("refresh-1"));
    expect(error.kind).toBe("offline");
    expect(error.code).toBe(code);
    expect(error.status).toBeNull();
  });

  it("never puts a password, an email, a token or the server's text in an error", async () => {
    const echoes = json(
      {
        code: 400,
        error_code: `invalid ${password}`,
        msg: `No user ${email} with ${password}`,
        refresh_token: "refresh-1",
      },
      400,
      { "x-sb-error-code": email },
    );
    const { network } = fakeNetwork(() => echoes);
    const error = await failure(createAuthClient(network, config).signIn(email, password));

    const visible = `${error.message} ${JSON.stringify(error)} ${String(error.stack)}`;
    for (const secret of [password, email, "No user", "refresh-1", config.publishableKey]) {
      expect(visible).not.toContain(secret);
    }
    expect(error.code).toBeNull();
  });

  it("signs out this device only, with the access token", async () => {
    const { request, network } = fakeNetwork(() => new Response(null, { status: 204 }));
    await createAuthClient(network, config).signOut("access-1");

    const [url, init] = request.mock.calls[0] ?? [];
    expect(url).toBe(`${config.url}/auth/v1/logout?scope=local`);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      apikey: config.publishableKey,
      Authorization: "Bearer access-1",
    });
    expect(init?.timeoutMs).toBe(5_000);
  });

  it("signs out without throwing when the server refuses or can't be reached", async () => {
    const refused = fakeNetwork(() => json({ code: 401, error_code: "bad_jwt" }, 401));
    await expect(createAuthClient(refused.network, config).signOut("x")).resolves.toBeUndefined();
    const offline: Network = { request: () => Promise.reject(new TypeError("fetch failed")) };
    await expect(createAuthClient(offline, config).signOut("x")).resolves.toBeUndefined();
  });
});
