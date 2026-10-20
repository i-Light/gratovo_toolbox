import { describe, expect, it } from "vitest";
import { presign, uriEncode } from "./sigv4.ts";

// AWS's published example credentials, never real keys.
const ACCESS_KEY = "AKIAIOSFODNN7EXAMPLE";
const SECRET = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";

describe("presign", () => {
  it("matches the AWS S3 presigned GET example", async () => {
    const url = await presign({
      method: "GET",
      host: "examplebucket.s3.amazonaws.com",
      path: "/test.txt",
      query: {},
      accessKeyId: ACCESS_KEY,
      secretAccessKey: SECRET,
      region: "us-east-1",
      service: "s3",
      now: new Date("2013-05-24T00:00:00Z"),
      expiresSeconds: 86400,
    });
    expect(url).toBe(
      "https://examplebucket.s3.amazonaws.com/test.txt" +
        "?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
        "&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request" +
        "&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host" +
        "&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    );
  });

  it("encodes spaces, ~ and slashes in keys and query values", async () => {
    const url = await presign({
      method: "GET",
      host: "b.a.r2.cloudflarestorage.com",
      path: "/dir/a b~c.txt",
      query: { prefix: "x y/z~", "continuation-token": "a+b=" },
      accessKeyId: ACCESS_KEY,
      secretAccessKey: SECRET,
      region: "auto",
      service: "s3",
      now: new Date("2026-10-20T12:34:56.789Z"),
      expiresSeconds: 900,
    });
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/dir/a%20b~c.txt");
    expect(url).toContain("prefix=x%20y%2Fz~");
    expect(url).toContain("continuation-token=a%2Bb%3D");
    expect(url).toContain("X-Amz-Date=20261020T123456Z");
    expect(url).toContain("%2F20261020%2Fauto%2Fs3%2Faws4_request");
    expect(url).toMatch(/&X-Amz-Signature=[0-9a-f]{64}$/);
  });

  it("sorts the query by encoded name (code point order) and signs the method", async () => {
    const base = {
      host: "h.example.com",
      path: "/k",
      query: { b: "2", a: "1" },
      accessKeyId: ACCESS_KEY,
      secretAccessKey: SECRET,
      region: "auto",
      service: "s3",
      now: new Date("2026-01-01T00:00:00Z"),
      expiresSeconds: 60,
    };
    const get = await presign({ ...base, method: "GET" });
    const put = await presign({ ...base, method: "PUT" });
    expect(get.indexOf("X-Amz-SignedHeaders")).toBeLessThan(get.indexOf("a=1"));
    expect(get.indexOf("a=1")).toBeLessThan(get.indexOf("b=2"));
    expect(get).not.toBe(put);
  });
});

describe("uriEncode", () => {
  it("leaves unreserved characters and escapes the rest", () => {
    expect(uriEncode("AZaz09-_.~")).toBe("AZaz09-_.~");
    expect(uriEncode("a b/c")).toBe("a%20b%2Fc");
    expect(uriEncode("!'()*")).toBe("%21%27%28%29%2A");
  });
});
