import { describe, expect, it } from "vitest";

import { isAllowedExternalLink } from "./external-links";

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
