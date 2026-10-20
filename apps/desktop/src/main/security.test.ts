import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ shell: { openExternal: vi.fn() } }));
vi.mock("./window", () => ({ appPageUrl: "app://gratovo/index.html" }));

import { blockForeignRequests, isAllowedRequest } from "./security";

describe("isAllowedRequest", () => {
  it.each([
    "app://gratovo/index.html",
    "app://gratovo/assets/index-abc.js",
    "devtools://devtools/bundled/inspector.html",
    "data:image/png;base64,AAAA",
  ])("allows %s", (url) => {
    expect(isAllowedRequest(url)).toBe(true);
  });

  it.each([
    "https://abcdefghijklmnopqrst.supabase.co/rest/v1/x",
    "https://example.com/",
    "http://localhost:5173/",
    "ws://localhost:5173/",
    "app://other/index.html",
    "file:///C:/x",
    "blob:app://gratovo/1",
    "not a url",
  ])("blocks %s when packaged", (url) => {
    expect(isAllowedRequest(url)).toBe(false);
  });

  it("allows only the dev server in development", () => {
    const dev = "http://localhost:5173/";
    expect(isAllowedRequest("http://localhost:5173/src/main.tsx", dev)).toBe(true);
    expect(isAllowedRequest("ws://localhost:5173/", dev)).toBe(true);
    expect(isAllowedRequest("http://localhost:5174/", dev)).toBe(false);
    expect(isAllowedRequest("https://localhost:5173/", dev)).toBe(false);
    expect(isAllowedRequest("http://localhost.evil.com:5173/", dev)).toBe(false);
    expect(isAllowedRequest("https://example.com/", dev)).toBe(false);
  });
});

describe("blockForeignRequests", () => {
  it("cancels foreign requests and lets the app's through", () => {
    type Listener = (d: { url: string }, cb: (r: { cancel: boolean }) => void) => void;
    let listener: Listener | undefined;
    const target = {
      webRequest: {
        onBeforeRequest: (l: Listener) => {
          listener = l;
        },
      },
    };
    blockForeignRequests(target as never);
    const cancelled = (url: string): boolean | undefined => {
      let cancel: boolean | undefined;
      listener?.({ url }, (r) => {
        cancel = r.cancel;
      });
      return cancel;
    };
    expect(cancelled("app://gratovo/index.html")).toBe(false);
    expect(cancelled("https://example.com/")).toBe(true);
  });
});
