import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defaultFindFile, readFindFile, writeFindFile } from "../find/find-store";
import type { ImportReport, Start } from "../pipeline/protocol";

import {
  createImporter,
  readPipelineChannels,
  type ImporterDeps,
  type StoreJobOutcome,
} from "./import-service";

const report = (backup: string | null, dryRun: boolean): ImportReport => ({
  source: "C:\\old\\gratovo.db",
  tables: [{ name: "channels", inOld: 3, toAdd: 2, already: 1 }],
  skipped: [],
  unsent: { outbox: 0, activity: 0 },
  settingsFiles: [{ name: "run_config.json", found: true }],
  dryRun,
  backup,
});

describe("the importer", () => {
  let root: string;
  let userData: string;
  let dataDir: string;
  let oldDir: string;
  let oldDb: string;
  let starts: Start[];
  let seeded: { channelId: string; name: string }[][];
  let settings: Record<string, unknown>;
  let events: unknown[];
  let outcome: StoreJobOutcome;
  let progress: { table: string; done: number; total: number }[];
  let release: (() => void) | null;

  function make(over: Partial<ImporterDeps> = {}) {
    return createImporter({
      userDataDir: userData,
      localAppData: join(root, "local"),
      isLive: () => true,
      pipelineDataDir: () => dataDir,
      worker: () => "worker-1",
      runStoreJob: async (start, onProgress) => {
        starts.push(start);
        for (const line of progress) {
          onProgress(line);
        }
        if (release !== null) {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return outcome;
      },
      pickFile: () => Promise.resolve("C:\\picked.db"),
      seedChannelNames: (rows) => {
        seeded.push(rows);
        return rows.length;
      },
      writeSetting: (key, value) => {
        settings[key] = value;
      },
      readPipelineChannels,
      emitProgress: (event) => events.push(event),
      now: () => new Date("2026-10-24T10:00:00.000Z"),
      ...over,
    });
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "gratovo-import-"));
    userData = join(root, "userdata");
    dataDir = join(userData, "pipeline");
    oldDir = join(root, "old", "data");
    oldDb = join(oldDir, "database", "gratovo.db");
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(join(oldDir, "database"), { recursive: true });
    writeFileSync(oldDb, "x");
    starts = [];
    seeded = [];
    settings = {};
    events = [];
    progress = [];
    release = null;
    outcome = { ok: true, state: "done", code: null, report: report(null, true) };
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("finds the old database in LOCALAPPDATA, or nothing", async () => {
    expect((await make().candidates()).candidates).toEqual([]);
    const file = join(root, "local", "Gratovo IMA ToolBox", "data", "database", "gratovo.db");
    mkdirSync(join(root, "local", "Gratovo IMA ToolBox", "data", "database"), { recursive: true });
    writeFileSync(file, "abc");
    const found = (await make().candidates()).candidates;
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ path: file, size: 3 });
    expect((await make({ localAppData: null }).candidates()).candidates).toEqual([]);
  });

  it("returns the dialog's answer", async () => {
    expect(await make().pick()).toEqual({ path: "C:\\picked.db" });
    expect(await make({ pickFile: () => Promise.resolve(null) }).pick()).toEqual({ path: null });
  });

  it("refuses a path inside its own data folder, without a job", async () => {
    const inside = join(userData, "Gratovo.DB");
    expect(await make().dryRun(inside)).toEqual({ ok: false, reason: "own_data" });
    expect(await make().run(inside.toUpperCase(), false)).toEqual({
      ok: false,
      reason: "own_data",
    });
    expect(starts).toHaveLength(0);
  });

  it("refuses a relative path, example data and a missing folder", async () => {
    expect(await make().dryRun("old.db")).toEqual({ ok: false, reason: "not_found" });
    expect(await make({ isLive: () => false }).dryRun(oldDb)).toEqual({
      ok: false,
      reason: "example_data",
    });
    expect(await make({ pipelineDataDir: () => null }).dryRun(oldDb)).toEqual({
      ok: false,
      reason: "no_data",
    });
    expect(starts).toHaveLength(0);
  });

  it("runs a dry run with the right job", async () => {
    const result = await make().dryRun(oldDb);
    expect(result).toEqual({ ok: true, report: report(null, true) });
    expect(starts[0]).toMatchObject({
      source: "live",
      dataDir,
      worker: "worker-1",
      job: { kind: "import.legacy", source: oldDb, dryRun: true, backupDir: null },
      settings: {},
      secrets: { youtubeKey: null, proxyUrls: [], gatewayUrls: [] },
    });
  });

  it("maps the end codes to reasons", async () => {
    const cases = [
      ["source_unreadable", "not_found"],
      ["not_sqlite", "not_sqlite"],
      ["no_channels_table", "no_channels"],
      ["source_in_data_dir", "own_data"],
      ["store_too_new", "failed"],
      ["crash", "failed"],
    ] as const;
    for (const [code, reason] of cases) {
      outcome = { ok: true, state: "failed", code, report: null };
      expect(await make().dryRun(oldDb)).toEqual({ ok: false, reason });
    }
    outcome = { ok: false, problem: "no_python" };
    expect(await make().dryRun(oldDb)).toEqual({ ok: false, reason: "no_python" });
  });

  it("returns failed when something throws", async () => {
    const result = await make({
      runStoreJob: () => Promise.reject(new Error("boom")),
    }).dryRun(oldDb);
    expect(result).toEqual({ ok: false, reason: "failed" });
  });

  describe("a real run", () => {
    const backup = () => join(userData, "backups", "pipeline-20261024-100000.db");

    beforeEach(() => {
      // The imported store, with two channels.
      const db = new DatabaseSync(join(dataDir, "pipeline.db"));
      db.exec("CREATE TABLE channels (channel_id TEXT, name TEXT)");
      db.exec("INSERT INTO channels VALUES ('UCa', 'AI Daily'), ('UCb', 'Agent Lab')");
      db.close();
      const file = defaultFindFile();
      file.rules.perKeyword = 77;
      writeFindFile(dataDir, file);
      outcome = { ok: true, state: "done", code: null, report: report(backup(), false) };
      mkdirSync(join(userData, "backups"), { recursive: true });
    });

    it("backs up find.json, seeds the names and writes the import state", async () => {
      const result = await make().run(oldDb, false);
      expect(result).toEqual({ ok: true, report: report(backup(), false) });
      expect(starts[0]?.job).toMatchObject({
        dryRun: false,
        backupDir: join(userData, "backups"),
      });
      const copy = JSON.parse(
        readFileSync(join(userData, "backups", "find-20261024-100000.json"), "utf8"),
      ) as { rules: { perKeyword: number } };
      expect(copy.rules.perKeyword).toBe(77);
      expect(seeded[0]).toEqual([
        { channelId: "UCa", name: "AI Daily" },
        { channelId: "UCb", name: "Agent Lab" },
      ]);
      expect(settings["import"]).toEqual({
        at: "2026-10-24T10:00:00.000Z",
        source: oldDb,
        counts: { channels: 2 },
        backup: backup(),
      });
      // The rules stay when the owner didn't ask.
      expect(readFindFile(dataDir).rules.perKeyword).toBe(77);
    });

    it("applies the old rules only when asked", async () => {
      writeFileSync(
        join(oldDir, "run_config.json"),
        JSON.stringify({
          sort_by: "view_count",
          results_type: "video",
          countries: ["US"],
          handle_limit: 150,
          auto_clean: { enabled: true, min_subscribers: 1000, max_subscribers: 5000 },
        }),
      );
      writeFileSync(
        join(oldDir, "settings.json"),
        JSON.stringify({ handles_to_search_limit: { value: 90 } }),
      );
      await make().run(oldDb, true);
      const rules = readFindFile(dataDir).rules;
      expect(rules).toMatchObject({ sortBy: "view_count", perKeyword: 150, countries: ["US"] });
      expect(rules.autoClean).toMatchObject({ minSubscribers: 1000, maxSubscribers: 5000 });
    });

    it("skips the find.json copy on a first import (no backup)", async () => {
      outcome = { ok: true, state: "done", code: null, report: report(null, false) };
      const result = await make().run(oldDb, false);
      expect(result.ok).toBe(true);
      expect(settings["import"]).toMatchObject({ backup: null });
    });

    it("does not seed or write state when the job fails", async () => {
      outcome = { ok: true, state: "failed", code: "crash", report: null };
      expect(await make().run(oldDb, true)).toEqual({ ok: false, reason: "failed" });
      expect(seeded).toHaveLength(0);
      expect(settings).toEqual({});
    });
  });

  it("allows one import at a time", async () => {
    release = () => undefined;
    const importer = make();
    const first = importer.dryRun(oldDb);
    expect(await importer.dryRun(oldDb)).toEqual({ ok: false, reason: "running" });
    release();
    expect((await first).ok).toBe(true);
  });

  it("forwards progress, clamped to the schema", async () => {
    progress = [
      { table: "channels", done: 1, total: 4 },
      { table: "x".repeat(100), done: 999, total: 4000 },
    ];
    await make().dryRun(oldDb);
    expect(events).toEqual([
      { table: "channels", done: 1, total: 4 },
      { table: "x".repeat(64), done: 50, total: 50 },
    ]);
  });
});

describe("readPipelineChannels", () => {
  it("reads id and name, and is empty without a file", () => {
    const folder = mkdtempSync(join(tmpdir(), "gratovo-pc-"));
    try {
      expect(readPipelineChannels(folder)).toEqual([]);
      const db = new DatabaseSync(join(folder, "pipeline.db"));
      db.exec("CREATE TABLE channels (channel_id TEXT, name TEXT)");
      db.exec("INSERT INTO channels VALUES ('UCa', 'AI Daily'), ('UCb', NULL)");
      db.close();
      expect(readPipelineChannels(folder)).toEqual([{ channelId: "UCa", name: "AI Daily" }]);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
