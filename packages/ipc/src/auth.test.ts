import { describe, expect, it, vi } from "vitest";

import { channels, parseRequest } from "./channels";
import { createDispatcher, type Handlers } from "./dispatch";

const password = "not-a-real-password";

describe("auth:sign-in request", () => {
  it("accepts an email and a password", () => {
    expect(parseRequest("auth:sign-in", { email: "sam@example.com", password }).ok).toBe(true);
  });

  it("refuses a non-email, an over-long email, an empty or over-long password and extra fields", () => {
    const longEmail = `${"a".repeat(250)}@example.com`;
    const refused = [
      { email: "not-an-email", password },
      { email: longEmail, password },
      { email: "sam@example.com", password: "" },
      { email: "sam@example.com", password: "p".repeat(1025) },
      { email: "sam@example.com" },
      { password },
      { email: "sam@example.com", password, remember: true },
      { email: 42, password },
      "sam@example.com",
    ];
    for (const request of refused) {
      expect(parseRequest("auth:sign-in", request).ok).toBe(false);
    }
  });

  it("never puts the password in the reason it gives", () => {
    const attempts = [
      { email: "not-an-email", password },
      { email: "sam@example.com", password: `${password}${"x".repeat(1024)}` },
      { email: "sam@example.com", password, extra: password },
      { email: password, password: 42 },
    ];
    for (const request of attempts) {
      const parsed = parseRequest("auth:sign-in", request);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.reason).not.toContain(password);
      }
    }
  });
});

describe("auth responses", () => {
  const status = channels["auth:status"].response;
  const signIn = channels["auth:sign-in"].response;

  it("states and the account's own email only", () => {
    expect(status.safeParse({ state: "signed-in", email: "sam@example.com" }).success).toBe(true);
    expect(status.safeParse({ state: "unconfigured", email: null }).success).toBe(true);
    expect(status.safeParse({ state: "lost", email: null }).success).toBe(false);
    expect(status.safeParse({ state: "signed-in", email: "" }).success).toBe(false);
    expect(
      status.safeParse({ state: "signed-in", email: null, accessToken: "eyJ.a.b" }).success,
    ).toBe(false);
    expect(
      channels["auth:recheck"].response.safeParse({ state: "waiting", email: null }).success,
    ).toBe(true);
  });

  it("a sign-in answers a state or a problem, nothing else", () => {
    expect(signIn.safeParse({ ok: true, state: "waiting" }).success).toBe(true);
    expect(signIn.safeParse({ ok: false, problem: "no-safe-storage" }).success).toBe(true);
    expect(signIn.safeParse({ ok: true, state: "signed-out" }).success).toBe(false);
    expect(signIn.safeParse({ ok: false, problem: "ended" }).success).toBe(false);
    expect(signIn.safeParse({ ok: true, state: "signed-in", refreshToken: "r-000" }).success).toBe(
      false,
    );
  });

  it("sign-out takes and answers an empty object", () => {
    expect(parseRequest("auth:sign-out", {}).ok).toBe(true);
    expect(parseRequest("auth:sign-out", { everywhere: true }).ok).toBe(false);
    expect(channels["auth:sign-out"].response.safeParse({}).success).toBe(true);
  });
});

describe("the auth channels through the dispatcher", () => {
  it("drops a handler's answer that carries a token", async () => {
    const handlers = {
      "auth:status": () => ({ state: "signed-in", email: "sam@example.com", token: "eyJ.a.b" }),
    } as unknown as Handlers;
    const onError = vi.fn();
    const dispatch = createDispatcher(handlers, onError);
    expect(await dispatch("auth:status", {})).toEqual({ ok: false, reason: "The call failed" });
    expect(onError).toHaveBeenCalledOnce();
  });
});
