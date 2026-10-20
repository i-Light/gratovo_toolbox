import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { migrations } from "./migrations";
import { openDatabase } from "./open-database";

let folder: string;

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "gratovo-db-"));
});

afterEach(async () => {
  await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

function pragma(db: ReturnType<typeof openDatabase>, name: string): Record<string, unknown> {
  return db.prepare(`PRAGMA ${name}`).get() ?? {};
}

describe("openDatabase", () => {
  it("creates the folder, turns WAL on and migrates", () => {
    const db = openDatabase(join(folder, "nested", "test.db"));
    try {
      expect(pragma(db, "journal_mode")["journal_mode"]).toBe("wal");
      expect(pragma(db, "user_version")["user_version"]).toBe(migrations.length);
    } finally {
      db.close();
    }
  });

  it("sets the pragmas", () => {
    const db = openDatabase(join(folder, "test.db"));
    try {
      expect(pragma(db, "busy_timeout")["timeout"]).toBe(5000);
      expect(pragma(db, "synchronous")["synchronous"]).toBe(1);
      expect(pragma(db, "foreign_keys")["foreign_keys"]).toBe(1);
    } finally {
      db.close();
    }
  });

  it("keeps data across a reopen without migrating again", () => {
    const file = join(folder, "test.db");
    const first = openDatabase(file);
    first.exec("INSERT INTO _meta (key, value) VALUES ('k', 'v')");
    first.close();
    const second = openDatabase(file);
    try {
      expect(second.prepare("SELECT value FROM _meta WHERE key = 'k'").get()?.["value"]).toBe("v");
    } finally {
      second.close();
    }
  });

  it("opens an in-memory database", () => {
    const db = openDatabase(":memory:");
    try {
      expect(pragma(db, "user_version")["user_version"]).toBe(migrations.length);
    } finally {
      db.close();
    }
  });
});
