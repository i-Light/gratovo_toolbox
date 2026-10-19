import type { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase } from "../../db/open-database";
import { getMeta, setMeta } from "./meta";
import { getNotify, getSetting, setNotify, setSetting } from "./settings";

let folder: string;
let db: DatabaseSync;

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "gratovo-repo-"));
  db = openDatabase(join(folder, "test.db"));
});

afterEach(async () => {
  db.close();
  await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe("settings", () => {
  it("round trips JSON values and overwrites", () => {
    expect(getSetting(db, "k")).toBeUndefined();
    setSetting(db, "k", { a: [1, 2], b: "x" });
    expect(getSetting(db, "k")).toEqual({ a: [1, 2], b: "x" });
    setSetting(db, "k", false);
    expect(getSetting(db, "k")).toBe(false);
  });

  it("reads corrupt JSON as missing, and refuses a value JSON cannot hold", () => {
    db.exec("INSERT INTO local_settings (key, value) VALUES ('bad', '{oops')");
    expect(getSetting(db, "bad")).toBeUndefined();
    expect(() => {
      setSetting(db, "k", undefined);
    }).toThrow(/cannot be stored/);
  });

  it("round trips the notification switches and drops junk", () => {
    expect(getNotify(db)).toEqual({});
    setNotify(db, { reply: false, money: true });
    expect(getNotify(db)).toEqual({ reply: false, money: true });
    setNotify(db, { search: false });
    expect(getNotify(db)).toEqual({ search: false });
    setSetting(db, "notify", { reply: "no", handoff: false, other: true });
    expect(getNotify(db)).toEqual({ handoff: false });
    setSetting(db, "notify", [true]);
    expect(getNotify(db)).toEqual({});
    setSetting(db, "notify", null);
    expect(getNotify(db)).toEqual({});
  });

  it("is STRICT about types", () => {
    expect(() => {
      db.exec("INSERT INTO local_settings (key, value) VALUES ('k', x'00')");
    }).toThrow();
  });
});

describe("meta", () => {
  it("round trips and overwrites", () => {
    expect(getMeta(db, "example_seed")).toBeNull();
    setMeta(db, "example_seed", "1");
    expect(getMeta(db, "example_seed")).toBe("1");
    setMeta(db, "example_seed", "2");
    expect(getMeta(db, "example_seed")).toBe("2");
  });

  it("is STRICT about types", () => {
    expect(() => {
      db.exec("INSERT INTO _meta (key, value) VALUES ('k', x'00')");
    }).toThrow();
  });
});
