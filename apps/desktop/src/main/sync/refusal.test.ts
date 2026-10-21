import { describe, expect, it } from "vitest";

import { NetworkRefusedError } from "../net/network";
import { AuthError } from "../supabase/auth-client";
import { RestError } from "../supabase/rest";
import { classifyUploadError, schemaBehindCodes } from "./refusal";

const http = (status: number, code: string | null) => new RestError("http", status, code);

describe("classifyUploadError", () => {
  it.each([
    ["RLS refusal 42501", http(403, "42501"), "drop"],
    ["invalid parameter 22023", http(400, "22023"), "drop"],
    ["data exception 22P02", http(400, "22P02"), "drop"],
    ["constraint 23505", http(409, "23505"), "drop"],
    ["constraint 23514", http(400, "23514"), "drop"],
    ["401 after refresh", http(401, null), "session"],
    ["401 with a JWT code", http(401, "PGRST303"), "session"],
    ["AuthError ended", new AuthError("ended"), "session"],
    ["AuthError offline", new AuthError("offline"), "session"],
    ["offline", new RestError("offline"), "retry"],
    ["500", http(500, null), "retry"],
    ["429", http(429, null), "retry"],
    ["503 with code", http(503, "PGRST000"), "retry"],
    ["unknown 400", http(400, "PGRST100"), "retry"],
    ["network refused", new NetworkRefusedError("not allowed"), "retry"],
    ["plain error", new Error("x"), "retry"],
    ["non-error", "boom", "retry"],
  ] as const)("%s -> %s", (_name, error, verdict) => {
    expect(classifyUploadError(error)).toBe(verdict);
  });

  it.each(schemaBehindCodes)("keeps an edit when the server is behind (%s)", (code) => {
    expect(classifyUploadError(http(404, code))).toBe("retry");
  });

  it("lists the six codes", () => {
    expect([...schemaBehindCodes].sort()).toEqual(
      ["42703", "42883", "42P01", "PGRST202", "PGRST204", "PGRST205"].sort(),
    );
  });
});
