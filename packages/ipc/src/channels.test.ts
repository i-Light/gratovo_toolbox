import { describe, expect, it } from "vitest";

import { channels, isChannel, parseRequest } from "./channels";

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
