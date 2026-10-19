import { describe, expect, it } from "vitest";
import { isAllowedExternalLink } from "./external-links";

describe("isAllowedExternalLink", () => {
  it.each([
    "https://youtube.com/@aiexplained",
    "https://www.youtube.com/@aiexplained",
    "https://m.youtube.com/@matthew_berman/videos",
    "https://youtu.be/abc123",
    "https://mail.google.com/mail/u/0/#inbox",
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

  it("rejects a non-default port", () => {
    expect(isAllowedExternalLink("https://youtube.com:8443/")).toBe(false);
  });

  it("rejects text that is not a URL", () => {
    expect(isAllowedExternalLink("")).toBe(false);
    expect(isAllowedExternalLink("youtube.com")).toBe(false);
  });
});
