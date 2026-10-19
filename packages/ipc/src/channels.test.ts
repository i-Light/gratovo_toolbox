import { describe, expect, it } from "vitest";
import { z } from "zod";

import { channelSchemas, isChannelName, parseChannelInput } from "./channels";

describe("channel schemas", () => {
  it("accepts an empty ping", () => {
    expect(parseChannelInput("app:ping", {})).toEqual({});
  });

  it("rejects extra fields on a ping", () => {
    expect(() => parseChannelInput("app:ping", { token: "x" })).toThrow(z.ZodError);
  });

  it("rejects input that is not an object", () => {
    expect(() => parseChannelInput("app:ping", "hello")).toThrow(z.ZodError);
  });

  it("knows only the declared channels", () => {
    expect(isChannelName("app:ping")).toBe(true);
    expect(isChannelName("fs:read")).toBe(false);
    expect(isChannelName("toString")).toBe(false);
  });

  it("validates the ping output shape", () => {
    const output = channelSchemas["app:ping"].output;
    expect(output.safeParse({ ok: true, version: "0.0.0" }).success).toBe(true);
    expect(output.safeParse({ ok: false, version: "0.0.0" }).success).toBe(false);
  });
});
