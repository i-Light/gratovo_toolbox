import { describe, expect, it } from "vitest";

import { channels, isChannel, parseRequest, secretName } from "./channels";

describe("parseRequest", () => {
  it("accepts a known channel with a valid request", () => {
    expect(parseRequest("app:ping", {})).toEqual({ ok: true, channel: "app:ping", value: {} });
  });

  it("refuses a channel that is not declared", () => {
    const parsed = parseRequest("fs:read", { path: "C:/Users" });
    expect(parsed).toEqual({ ok: false, reason: 'Unknown channel "fs:read"' });
  });

  it("refuses names inherited from Object, not only unknown ones", () => {
    expect(isChannel("toString")).toBe(false);
    expect(isChannel("__proto__")).toBe(false);
    expect(parseRequest("constructor", {}).ok).toBe(false);
  });

  it("refuses a request with keys the schema does not declare", () => {
    expect(parseRequest("app:ping", { extra: true }).ok).toBe(false);
  });

  it("refuses a request that is not an object", () => {
    expect(parseRequest("app:ping", "ping").ok).toBe(false);
    expect(parseRequest("app:ping", undefined).ok).toBe(false);
  });
});

describe("app:ping response", () => {
  const response = channels["app:ping"].response;

  it("accepts the version", () => {
    expect(response.safeParse({ ok: true, version: "0.0.0" }).success).toBe(true);
  });

  it("refuses an empty version or a failure", () => {
    expect(response.safeParse({ ok: true, version: "" }).success).toBe(false);
    expect(response.safeParse({ ok: false, version: "0.0.0" }).success).toBe(false);
  });
});

describe("secretName", () => {
  it("accepts lowercase words joined by dots or hyphens", () => {
    for (const name of ["gemini.api-key", "gmail.token.mailbox-1", "youtube"]) {
      expect(secretName.safeParse(name).success).toBe(true);
    }
  });

  it("refuses anything else", () => {
    const refused = [
      "",
      "Gemini",
      "a..b",
      "a.",
      "-a",
      "a b",
      "../x",
      "a/b",
      "__proto__",
      "x".repeat(101),
    ];
    for (const name of refused) {
      expect(secretName.safeParse(name).success).toBe(false);
    }
  });
});

describe("secrets:status", () => {
  it("takes a secret's name and answers whether it is set, never its value", () => {
    expect(parseRequest("secrets:status", { name: "gemini.api-key" }).ok).toBe(true);
    expect(parseRequest("secrets:status", { name: "../keys" }).ok).toBe(false);
    expect(channels["secrets:status"].response.safeParse({ set: true }).success).toBe(true);
    expect(
      channels["secrets:status"].response.safeParse({ set: true, value: "sk-test-000" }).success,
    ).toBe(false);
  });
});

describe("sync and presence channels", () => {
  it("declares sync:status, sync:now and presence:set", () => {
    expect(isChannel("sync:status")).toBe(true);
    expect(isChannel("sync:now")).toBe(true);
    expect(isChannel("presence:set")).toBe(true);
  });

  it("takes an empty request for the sync channels and refuses extras", () => {
    expect(parseRequest("sync:status", {}).ok).toBe(true);
    expect(parseRequest("sync:now", { force: true }).ok).toBe(false);
  });

  it("checks the screen on presence:set", () => {
    expect(parseRequest("presence:set", { screen: "team", idle: true }).ok).toBe(true);
    expect(parseRequest("presence:set", { screen: "nowhere", idle: true }).ok).toBe(false);
  });
});
