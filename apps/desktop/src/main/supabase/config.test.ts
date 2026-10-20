import { describe, expect, it } from "vitest";

import { describeConfigProblem, readSupabaseConfig, type ConfigProblem } from "./config";

const url = "https://abcdefghijklmnopqrst.supabase.co";
const key = "sb_publishable_test000";
// A made-up JWT-shaped key ({"alg":"HS256"}.{"role":"service_role"}."signature"), joined at run
// time so the secret scanner doesn't read it as a real token.
const jwt = ["eyJhbGciOiJIUzI1NiJ9", "eyJyb2xlIjoic2VydmljZV9yb2xlIn0", "c2lnbmF0dXJl"].join(".");

function read(
  built: { url?: string; key?: string },
  env: Record<string, string | undefined> = {},
  packaged = false,
) {
  return readSupabaseConfig({ packaged, built, env });
}

describe("readSupabaseConfig", () => {
  it("accepts the built values", () => {
    expect(read({ url, key })).toEqual({
      ok: true,
      config: { url, origin: url, publishableKey: key },
    });
  });

  it.each([
    ["no values", {}],
    ["an empty URL", { url: "", key }],
    ["an empty key", { url, key: "" }],
    ["only blanks", { url: "  ", key: "  " }],
  ])("reports missing for %s", (_name, built) => {
    expect(read(built)).toEqual({ ok: false, problem: "missing" });
  });

  it.each([
    "http://abcdefghijklmnopqrst.supabase.co",
    `${url}/`,
    `${url}/rest/v1`,
    "https://abcdefghijklmnopqrs.supabase.co",
    "https://ABCDEFGHIJKLMNOPQRST.supabase.co",
    `${url}.evil.com`,
    "https://evil.com/abcdefghijklmnopqrst.supabase.co",
    "http://127.0.0.1:54321",
  ])("reports bad-url for %s", (bad) => {
    expect(read({ url: bad, key })).toEqual({ ok: false, problem: "bad-url" });
  });

  it("refuses a secret key", () => {
    expect(read({ url, key: "sb_secret_abc123" })).toEqual({ ok: false, problem: "secret-key" });
  });

  it("refuses a JWT-shaped key", () => {
    expect(read({ url, key: jwt })).toEqual({ ok: false, problem: "jwt-key" });
  });

  it.each(["abc", "sb_publishable_", "sb_publishable_a b", "pk_test_000"])(
    "reports bad-key for %s",
    (bad) => {
      expect(read({ url, key: bad })).toEqual({ ok: false, problem: "bad-key" });
    },
  );

  describe("test seam", () => {
    const seam = {
      GRATOVO_SUPABASE_URL: "http://127.0.0.1:54321",
      GRATOVO_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local",
    };

    it("replaces the built values when not packaged, and accepts 127.0.0.1", () => {
      expect(read({ url, key }, seam)).toEqual({
        ok: true,
        config: {
          url: "http://127.0.0.1:54321",
          origin: "http://127.0.0.1:54321",
          publishableKey: "sb_publishable_local",
        },
      });
    });

    it("is ignored when packaged", () => {
      expect(read({ url, key }, seam, true)).toEqual(read({ url, key }));
      expect(read({}, seam, true)).toEqual({ ok: false, problem: "missing" });
    });

    it("treats an empty URL as unconfigured, whatever was built", () => {
      expect(read({ url, key }, { GRATOVO_SUPABASE_URL: "" })).toEqual({
        ok: false,
        problem: "missing",
      });
    });

    it("still checks the key", () => {
      const env = { ...seam, GRATOVO_SUPABASE_PUBLISHABLE_KEY: "sb_secret_x" };
      expect(read({}, env)).toEqual({ ok: false, problem: "secret-key" });
    });

    it("refuses other local forms", () => {
      const env = { ...seam, GRATOVO_SUPABASE_URL: "http://localhost:54321" };
      expect(read({}, env)).toEqual({ ok: false, problem: "bad-url" });
    });
  });

  it("never puts the key or URL in a result or a message", () => {
    const result = read({ url: "http://bad.example", key: "sb_secret_SHOULD_NOT_APPEAR" });
    expect(JSON.stringify(result)).not.toContain("SHOULD_NOT_APPEAR");
    const problems: ConfigProblem[] = ["missing", "bad-url", "secret-key", "jwt-key", "bad-key"];
    for (const problem of problems) {
      expect(describeConfigProblem(problem)).not.toContain("SHOULD_NOT_APPEAR");
      expect(describeConfigProblem(problem)).not.toContain("bad.example");
    }
  });
});
