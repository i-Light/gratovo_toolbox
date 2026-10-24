import { describe, expect, it } from "vitest";

import { isAllowedExternalLink, isGoogleConsentUrl } from "./external-links";

describe("isAllowedExternalLink", () => {
  it.each([
    "https://youtube.com/@aiexplained",
    "https://www.youtube.com/@aiexplained",
    "https://m.youtube.com/@matthew_berman/videos",
    "https://youtu.be/abc123",
    "https://mail.google.com/mail/u/0/#inbox",
    "https://mail.google.com/mail/u/0/#all/18c2f4d9e1a7b3c5",
    "https://mail.google.com/mail/?authuser=1#inbox/18c2f4d9e1a7b3c5",
    "https://WWW.YouTube.com/@AIExplained",
  ])("allows %s", (url) => {
    expect(isAllowedExternalLink(url)).toBe(true);
  });

  it.each([
    "http://www.youtube.com/@aiexplained",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "data:text/html,<p>hi</p>",
    "app://gratovo/index.html",
    "mailto:hello@aiexplained.example",
  ])("rejects the scheme in %s", (url) => {
    expect(isAllowedExternalLink(url)).toBe(false);
  });

  it("rejects credentials", () => {
    expect(isAllowedExternalLink("https://user:pass@youtube.com/")).toBe(false);
    expect(isAllowedExternalLink("https://user@youtube.com/")).toBe(false);
  });

  it.each([
    "https://youtube.com.evil.example/",
    "https://evil.example/?next=youtube.com",
    "https://notyoutube.com/",
    "https://evil.example/@aiexplained",
  ])("rejects the lookalike %s", (url) => {
    expect(isAllowedExternalLink(url)).toBe(false);
  });

  // A script could otherwise open the user's Gmail with a message filled in, one click from sent.
  it.each([
    "https://mail.google.com/mail/?view=cm&to=brand@example.com&body=hi",
    "https://mail.google.com/mail/u/0/?fs=1&tf=cm&to=brand@example.com",
    "https://mail.google.com/mail/?extsrc=mailto&url=mailto:brand@example.com",
    "https://mail.google.com/mail/u/0/#inbox?compose=new",
    "https://mail.google.com/a/example.com",
  ])("rejects the Gmail link %s, which isn't a thread", (url) => {
    expect(isAllowedExternalLink(url)).toBe(false);
  });

  it("rejects a non-default port", () => {
    expect(isAllowedExternalLink("https://youtube.com:8443/")).toBe(false);
  });

  it("rejects text that is not a URL", () => {
    expect(isAllowedExternalLink("")).toBe(false);
    expect(isAllowedExternalLink("youtube.com")).toBe(false);
  });
});

describe("isGoogleConsentUrl", () => {
  const consent =
    "https://accounts.google.com/o/oauth2/v2/auth?client_id=abc.apps.googleusercontent.com&response_type=code&state=xyz";

  it("allows Google's consent page", () => {
    expect(isGoogleConsentUrl(consent)).toBe(true);
    expect(isGoogleConsentUrl(consent.replace("accounts.google.com", "ACCOUNTS.google.com"))).toBe(
      true,
    );
  });

  it("is not something the page may open", () => {
    expect(isAllowedExternalLink(consent)).toBe(false);
  });

  it.each([
    ["plain http", consent.replace("https:", "http:")],
    ["another host", consent.replace("accounts.google.com", "accounts.google.com.evil.example")],
    ["a lookalike host", consent.replace("accounts.google.com", "accounts-google.com")],
    ["a Google subdomain", consent.replace("accounts.google.com", "mail.google.com")],
    ["a user name", consent.replace("https://", "https://user@")],
    ["a user and password", consent.replace("https://", "https://user:pass@")],
    ["a port", consent.replace("accounts.google.com", "accounts.google.com:8443")],
    ["the old path", consent.replace("/o/oauth2/v2/auth", "/o/oauth2/auth")],
    ["another path", consent.replace("/o/oauth2/v2/auth", "/signin/v2/identifier")],
    ["a longer path", consent.replace("/o/oauth2/v2/auth", "/o/oauth2/v2/auth/extra")],
    ["no query", "https://accounts.google.com/o/oauth2/v2/auth"],
    ["an empty query", "https://accounts.google.com/o/oauth2/v2/auth?"],
    ["a fragment", `${consent}#x`],
    ["another scheme", consent.replace("https:", "javascript:")],
    ["text that is not a URL", "accounts.google.com/o/oauth2/v2/auth?x=1"],
  ])("rejects %s", (_name, url) => {
    expect(isGoogleConsentUrl(url)).toBe(false);
  });
});
