import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  defaultKeywordLists,
  keywordListsFileName,
  readKeywordLists,
  writeKeywordLists,
} from "./keyword-lists-store";

describe("keyword lists store", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kw-lists-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads defaults when there is no file, and round-trips a write", () => {
    expect(readKeywordLists(dir)).toEqual(defaultKeywordLists());
    const value = { tools: ["Cursor"], angles: ["tutorial"], origins: {} };
    writeKeywordLists(dir, value);
    expect(readKeywordLists(dir)).toEqual(value);
  });

  it("keeps an invalid file as keywords.json.bad instead of losing it", () => {
    const file = join(dir, keywordListsFileName);
    writeFileSync(file, '{"tools": 5, "origins": {"a": {"tool": "x", "angle": "y"}}}');
    expect(readKeywordLists(dir)).toEqual(defaultKeywordLists());
    expect(existsSync(file)).toBe(false);
    expect(readFileSync(`${file}.bad`, "utf8")).toContain('"origins"');
  });

  it("keeps unparsable text too, replacing an older .bad file", () => {
    const file = join(dir, keywordListsFileName);
    writeFileSync(`${file}.bad`, "old");
    writeFileSync(file, "{not json");
    expect(readKeywordLists(dir)).toEqual(defaultKeywordLists());
    expect(readFileSync(`${file}.bad`, "utf8")).toBe("{not json");
  });

  it("keeps an origin stored under the key __proto__ as an own key", () => {
    const file = join(dir, keywordListsFileName);
    writeFileSync(
      file,
      '{"tools":[],"angles":[],"origins":{"__proto__":{"tool":"a","angle":"b"},"x":{"tool":"c","angle":"d"}}}',
    );
    const { origins } = readKeywordLists(dir);
    expect(Object.hasOwn(origins, "__proto__")).toBe(true);
    expect(Reflect.get(origins, "__proto__")).toEqual({ tool: "a", angle: "b" });
    expect(Object.getPrototypeOf(origins)).toBe(Object.prototype);
    expect(Reflect.get({}, "tool")).toBeUndefined();
    writeKeywordLists(dir, readKeywordLists(dir));
    expect(readFileSync(file, "utf8")).toContain('"__proto__"');
  });
});
