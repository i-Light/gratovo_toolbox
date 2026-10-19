import { describe, expect, it } from "vitest";

import { builtPageUrl, isAppPage, isTrustedSender, localDevServer } from "./app-page";

describe("localDevServer", () => {
  it("accepts an http server on this machine", () => {
    expect(localDevServer("http://localhost:5173")).toBe("http://localhost:5173");
    expect(localDevServer("http://127.0.0.1:5173/")).toBe("http://127.0.0.1:5173/");
    expect(localDevServer("http://[::1]:5173/")).toBe("http://[::1]:5173/");
  });

  it("refuses anything else", () => {
    expect(localDevServer(undefined)).toBeUndefined();
    expect(localDevServer("not a url")).toBeUndefined();
    expect(localDevServer("https://localhost:5173")).toBeUndefined();
    expect(localDevServer("http://example.com")).toBeUndefined();
    expect(localDevServer("http://localhost.example.com")).toBeUndefined();
  });
});

describe("isAppPage", () => {
  it("matches the app's page, whatever its fragment", () => {
    expect(isAppPage("app://gratovo/index.html", builtPageUrl)).toBe(true);
    expect(isAppPage("app://gratovo/index.html#/today", builtPageUrl)).toBe(true);
  });

  it("refuses other pages, other origins and nonsense", () => {
    expect(isAppPage("app://gratovo/other.html", builtPageUrl)).toBe(false);
    expect(isAppPage("app://gratovo/index.html?next=x", builtPageUrl)).toBe(false);
    expect(isAppPage("app://evil/index.html", builtPageUrl)).toBe(false);
    expect(isAppPage("file:///C:/app/out/renderer/index.html", builtPageUrl)).toBe(false);
    expect(isAppPage("https://example.com/", builtPageUrl)).toBe(false);
    expect(isAppPage("not a url", builtPageUrl)).toBe(false);
  });

  it("matches the dev server's page in development", () => {
    expect(isAppPage("http://localhost:5173/", "http://localhost:5173")).toBe(true);
    expect(isAppPage("http://localhost:5174/", "http://localhost:5173")).toBe(false);
  });
});

describe("isTrustedSender", () => {
  it("trusts only the app page's top frame", () => {
    expect(isTrustedSender({ url: builtPageUrl, parent: null }, builtPageUrl)).toBe(true);
  });

  it("refuses a missing frame, a subframe or another page", () => {
    expect(isTrustedSender(null, builtPageUrl)).toBe(false);
    expect(isTrustedSender({ url: builtPageUrl, parent: {} }, builtPageUrl)).toBe(false);
    expect(isTrustedSender({ url: "https://example.com/", parent: null }, builtPageUrl)).toBe(
      false,
    );
  });
});
