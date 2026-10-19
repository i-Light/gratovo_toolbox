import { describe, expect, it } from "vitest";

import { builtPageUrl, isAppOrigin, isAppPage, isTrustedSender, localDevServer } from "./app-page";

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

describe("isAppOrigin", () => {
  it("matches any path on the app's origin", () => {
    expect(isAppOrigin("app://gratovo/today", builtPageUrl)).toBe(true);
    expect(isAppOrigin("http://localhost:5173/deals?x=1", "http://localhost:5173")).toBe(true);
  });

  it("refuses other origins and nonsense", () => {
    expect(isAppOrigin("app://evil/index.html", builtPageUrl)).toBe(false);
    expect(isAppOrigin("https://gratovo/index.html", builtPageUrl)).toBe(false);
    expect(isAppOrigin("http://localhost:5174/", "http://localhost:5173")).toBe(false);
    expect(isAppOrigin("not a url", builtPageUrl)).toBe(false);
  });
});

describe("isTrustedSender", () => {
  it("trusts the top frame on the app's origin", () => {
    expect(isTrustedSender({ url: builtPageUrl, parent: null }, builtPageUrl)).toBe(true);
    // After history.pushState the URL changes but the page is the same.
    expect(isTrustedSender({ url: "app://gratovo/deals/42", parent: null }, builtPageUrl)).toBe(
      true,
    );
  });

  it("refuses a missing frame, a subframe or another page", () => {
    expect(isTrustedSender(null, builtPageUrl)).toBe(false);
    expect(isTrustedSender({ url: builtPageUrl, parent: {} }, builtPageUrl)).toBe(false);
    expect(isTrustedSender({ url: "app://evil/index.html", parent: null }, builtPageUrl)).toBe(
      false,
    );
    expect(isTrustedSender({ url: "https://example.com/", parent: null }, builtPageUrl)).toBe(
      false,
    );
  });
});
