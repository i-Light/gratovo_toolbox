import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("./tokens.css", import.meta.url)), "utf8");

describe("tokens.css", () => {
  it("defines the light theme on :root", () => {
    expect(css).toMatch(/:root\{[^}]*--bg:#f2f5f9/);
    expect(css).toMatch(/--accent:#0079ba/);
  });

  it("defines the dark theme for the system setting and for an explicit dark theme", () => {
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain(':root:not([data-theme="light"])');
    expect(css).toMatch(/:root\[data-theme="dark"\]\{[^}]*--bg:#06131d/);
  });

  it("defines the compact density, the large size and reduced motion", () => {
    expect(css).toContain(':root[data-density="compact"]');
    expect(css).toContain(':root[data-size="large"]');
    expect(css).toContain(':root[data-motion="reduce"]');
  });

  it("defines the two easing curves", () => {
    expect(css).toContain("--ease-out:cubic-bezier(.23,1,.32,1)");
    expect(css).toContain("--ease-drawer:cubic-bezier(.32,.72,0,1)");
  });
});
