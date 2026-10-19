import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { contentType, resolveAppFile } from "./app-files";

const root = resolve("renderer-root");

describe("contentType", () => {
  it.each([
    ["index.html", "text/html; charset=utf-8"],
    ["a.js", "text/javascript; charset=utf-8"],
    ["a.mjs", "text/javascript; charset=utf-8"],
    ["a.css", "text/css; charset=utf-8"],
    ["a.json", "application/json; charset=utf-8"],
    ["a.svg", "image/svg+xml"],
    ["a.png", "image/png"],
    ["a.jpg", "image/jpeg"],
    ["a.jpeg", "image/jpeg"],
    ["a.webp", "image/webp"],
    ["a.ico", "image/x-icon"],
    ["a.woff2", "font/woff2"],
    ["a.woff", "font/woff"],
    ["a.ttf", "font/ttf"],
  ])("serves %s as %s", (file, type) => {
    expect(contentType(file)).toBe(type);
  });

  it("matches the extension in any case", () => {
    expect(contentType("INDEX.HTML")).toBe("text/html; charset=utf-8");
    expect(contentType("Logo.PnG")).toBe("image/png");
  });

  it("returns undefined for types the app doesn't serve", () => {
    expect(contentType("notes.txt")).toBeUndefined();
    expect(contentType("setup.exe")).toBeUndefined();
    expect(contentType("README")).toBeUndefined();
    expect(contentType("toString")).toBeUndefined();
  });
});

describe("resolveAppFile", () => {
  it("maps app files to paths inside the root", () => {
    expect(resolveAppFile(root, "app://gratovo/index.html")).toBe(join(root, "index.html"));
    expect(resolveAppFile(root, "app://gratovo/assets/index-abc.js")).toBe(
      join(root, "assets", "index-abc.js"),
    );
  });

  it("ignores the query and the fragment", () => {
    expect(resolveAppFile(root, "app://gratovo/index.html?x=1#top")).toBe(join(root, "index.html"));
  });

  it("decodes percent escapes", () => {
    expect(resolveAppFile(root, "app://gratovo/assets/index%2Dabc.css")).toBe(
      join(root, "assets", "index-abc.css"),
    );
  });

  it.each([
    ["wrong host", "app://evil/index.html"],
    ["wrong scheme", "https://gratovo/index.html"],
    ["file scheme", "file:///etc/passwd"],
    ["unparseable", "not a url"],
    ["malformed percent", "app://gratovo/%E0%A4%A"],
    ["NUL character", "app://gratovo/index.html%00.png"],
    ["bare origin", "app://gratovo/"],
    ["text file", "app://gratovo/notes.txt"],
    ["executable", "app://gratovo/setup.exe"],
    ["no extension", "app://gratovo/LICENSE"],
    ["encoded traversal", "app://gratovo/%2F..%2F..%2Fmain%2Findex.js"],
    ["a space, which the build never emits", "app://gratovo/assets/ai%20tools.css"],
    ["a colon (an alternate data stream on Windows)", "app://gratovo/index.html:hidden.js"],
    ["a dotfile", "app://gratovo/.env.json"],
    ["a Windows device name", "app://gratovo/CON.js"],
    ["a device name in a folder", "app://gratovo/assets/com1.css"],
    ["a device name without an extension", "app://gratovo/nul"],
  ])("refuses %s", (_name, url) => {
    expect(resolveAppFile(root, url)).toBeUndefined();
  });

  it("refuses a backslash, which Windows reads as a path separator", () => {
    expect(resolveAppFile(root, "app://gratovo/..%5C..%5Cmain%5Cindex.js")).toBeUndefined();
    expect(resolveAppFile(root, "app://gratovo/assets%5Cindex.js")).toBeUndefined();
  });

  it("never returns a path outside the root", () => {
    const hostile = [
      "app://gratovo/../../main/index.js",
      "app://gratovo/..%2F..%2Fmain%2Findex.js",
      "app://gratovo/%2e%2e/%2e%2e/x.js",
      "app://gratovo/..%5C..%5Cmain%5Cindex.js",
      "app://gratovo/%2e%2e%5c%2e%2e%5cx.js",
      "app://gratovo/....//x.js",
      "app://gratovo//etc/passwd.js",
      "app://gratovo/%2Fetc%2Fpasswd.js",
      "app://gratovo/C:%5CWindows%5Cx.js",
      "app://gratovo/C:/Windows/x.js",
      "app://gratovo/assets/..%2F..%2Fx.js",
      "app://gratovo/assets/../../x.js",
    ];
    for (const url of hostile) {
      const result = resolveAppFile(root, url);
      if (result !== undefined) {
        const rel = relative(root, result);
        // Compare whole segments: on Linux a backslash is a plain file-name character, not a separator.
        expect(rel.split(sep)[0], url).not.toBe("..");
        expect(isAbsolute(rel), url).toBe(false);
      }
    }
  });
});
