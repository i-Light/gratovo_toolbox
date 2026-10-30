import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { exampleHistory } from "@gratovo/core/data";
import type { ExampleHistory } from "@gratovo/core/data";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openExampleCopy } from "../data";
import type { JobOutcome } from "../pipeline/jobs";
import type { Start } from "../pipeline/protocol";

import { historyFile, loadHistory, writeHistoryLocal } from "./example-history";

const now = Date.UTC(2026, 9, 20, 10, 30, 0);

function count(db: DatabaseSync, table: string, where = "1 = 1"): number {
  return Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get()?.["n"]);
}

describe("the example history, local part", () => {
  let folder: string;
  let history: ExampleHistory;
  const opened: { source: { close(): void } }[] = [];

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), "gratovo-history-"));
    const built = exampleHistory(now, "normal");
    if (built === null) {
      throw new Error("the normal scenario has a history");
    }
    history = built;
  });

  afterEach(async () => {
    for (const copy of opened.splice(0)) {
      copy.source.close();
    }
    vi.restoreAllMocks();
    await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  function seededCopy(scenario: "normal" | "first" = "normal"): DatabaseSync {
    const copy = openExampleCopy(join(folder, "prototype.db"), () => now, {
      fresh: true,
      scenario,
    });
    opened.push(copy);
    return copy.db;
  }

  it("writes every table, clears the triggers' change events, adds the history's own", () => {
    const db = seededCopy();
    const seedCreators = count(db, "channel_state");
    const seedChannels = count(db, "channels");
    const seedLog = count(db, "activity_log");
    const seedMessages = count(db, "outreach_messages");
    const seedDrafts = count(db, "outreach_drafts");
    const seedSequences = count(db, "outreach_sequences");
    const g = history.gratovo;

    const started = performance.now();
    writeHistoryLocal(db, g);
    const took = performance.now() - started;
    console.info(`writeHistoryLocal: ${took.toFixed(0)} ms`);
    expect(took).toBeLessThan(3000);

    expect(count(db, "channel_state")).toBe(seedCreators + g.creators.length);
    expect(count(db, "channels")).toBe(seedChannels + g.names.length);
    expect(count(db, "activity_log")).toBe(seedLog + g.log.length);
    expect(count(db, "outreach_drafts")).toBe(seedDrafts + g.drafts.length);
    expect(count(db, "outreach_messages")).toBe(seedMessages + g.messages.length);
    expect(count(db, "outreach_sequences")).toBe(seedSequences + g.sequences.length);
    expect(count(db, "catalog_weeks")).toBe(g.weeks.length);

    // The log's detail went in as JSON text.
    const withDetail = g.log[0];
    expect(withDetail).toBeDefined();
    const row = db
      .prepare("SELECT detail FROM activity_log WHERE id = ?")
      .get(withDetail?.id ?? "");
    expect(JSON.parse(String(row?.["detail"]))).toEqual(withDetail?.detail);

    // No `change` event is left for a history creator; the history's events are in.
    const ids = new Set(g.creators.map((c) => c.channel_id));
    const change = db
      .prepare("SELECT channel_id FROM stage_events WHERE source = 'change'")
      .all()
      .filter((r) => ids.has(String(r["channel_id"])));
    expect(change).toEqual([]);
    expect(count(db, "stage_events", "source = 'example'")).toBe(g.events.length);
  });

  it("writes the history's brands and deals with their own events, beside the seed's", () => {
    const db = seededCopy();
    const seedBrands = count(db, "brands");
    const seedDeals = count(db, "deals");
    const seedDealEvents = count(db, "deal_events");
    const g = history.gratovo;

    writeHistoryLocal(db, g);

    expect(count(db, "brands")).toBe(seedBrands + g.brands.length);
    expect(count(db, "brand_details")).toBe(seedBrands + g.brands.length);
    expect(count(db, "deals")).toBe(seedDeals + g.deals.length);
    expect(count(db, "deal_details")).toBe(seedDeals + g.deals.length);
    // No trigger-stamped row is left for a history deal or brand; the history's events are in.
    expect(count(db, "deal_events", "source = 'change' AND deal_id LIKE 'hd-%'")).toBe(0);
    expect(count(db, "brand_events", "source = 'change' AND brand_id LIKE 'hb-%'")).toBe(0);
    expect(count(db, "deal_events", "source = 'example' AND deal_id LIKE 'hd-%'")).toBe(
      g.dealEvents.length,
    );
    expect(count(db, "brand_events", "source = 'example' AND brand_id LIKE 'hb-%'")).toBe(
      g.brandEvents.length,
    );
    // The seed's own events stay.
    expect(count(db, "deal_events")).toBe(seedDealEvents + g.dealEvents.length);
    // A deal reads back with its step, price and the invoice dates.
    const deal = g.deals.find((d) => d.brand_invoice_paid_at !== null);
    const row = db.prepare("SELECT * FROM deals WHERE id = ?").get(deal?.id ?? "");
    expect(row?.["flow_step"]).toBe(deal?.flow_step);
    expect(row?.["brand_price"]).toBe(deal?.brand_price);
    expect(row?.["brand_invoice_paid_at"]).toBe(deal?.brand_invoice_paid_at);
    const detail = db
      .prepare("SELECT report FROM deal_details WHERE deal_id = ?")
      .get(deal?.id ?? "");
    expect(JSON.parse(String(detail?.["report"]))).toHaveProperty("targetViews");
  });

  it("leaves nothing of an earlier history when the copy is seeded again", () => {
    const db = seededCopy();
    writeHistoryLocal(db, history.gratovo);
    expect(count(db, "stage_events")).toBeGreaterThan(0);

    // Switching to "first" seeds the same file again: no creators, so no events and no weeks.
    const first = seededCopy("first");
    expect(count(first, "channel_state")).toBe(0);
    expect(count(first, "stage_events")).toBe(0);
    expect(count(first, "catalog_weeks")).toBe(0);
    expect(count(first, "deal_events", "deal_id LIKE 'hd-%'")).toBe(0);
    expect(count(first, "brand_events", "brand_id LIKE 'hb-%'")).toBe(0);
  });

  it("gives the seed's creators the times their log and messages know, not the seed's now", () => {
    const db = seededCopy();
    const stamped = db
      .prepare(
        `SELECT e.channel_id FROM stage_events e
         WHERE e.source = 'change' AND e.stage IN ('shortlisted', 'emailed', 'replied')
           AND EXISTS (SELECT 1 FROM stage_events o
                       WHERE o.channel_id = e.channel_id AND o.stage = e.stage
                         AND o.source <> 'change')`,
      )
      .all();
    expect(stamped).toEqual([]);
    // Every creator with a stage has an event for it.
    expect(
      count(
        db,
        "channel_state k",
        `k.creator_stage IS NOT NULL AND NOT EXISTS (SELECT 1 FROM stage_events e
          WHERE e.channel_id = k.channel_id AND e.stage = k.creator_stage)`,
      ),
    ).toBe(0);
    expect(count(db, "stage_events", "source IN ('log', 'message')")).toBeGreaterThan(0);
  });
});

describe("loadHistory", () => {
  let folder: string;
  const opened: { source: { close(): void } }[] = [];

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), "gratovo-history-"));
  });

  afterEach(async () => {
    for (const copy of opened.splice(0)) {
      copy.source.close();
    }
    vi.restoreAllMocks();
    await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  function db(): DatabaseSync {
    const copy = openExampleCopy(join(folder, "prototype.db"), () => now, { fresh: true });
    opened.push(copy);
    return copy.db;
  }

  const done: JobOutcome = {
    ok: true,
    exit: {
      kind: "ended",
      end: { type: "end", state: "done", at: 0, found: 0, kept: 0 },
      result: null,
    },
  } as unknown as JobOutcome;

  it("writes the file, runs example.load on the folder and sets the archive days", async () => {
    const pipeline = join(folder, "pipeline");
    const seen: { start: Start; file: string | null }[] = [];
    const setArchiveDays = vi.fn<(days: number) => void>();
    await loadHistory({
      db: db(),
      scenario: "normal",
      now,
      folder: pipeline,
      runJob: (start) => {
        const path = join(pipeline, historyFile);
        seen.push({ start, file: existsSync(path) ? readFileSync(path, "utf8") : null });
        return Promise.resolve(done);
      },
      setArchiveDays,
    });
    expect(seen).toHaveLength(1);
    const { start, file } = seen[0] ?? { start: null, file: null };
    expect(start?.job).toEqual({ kind: "example.load", file: historyFile });
    expect(start?.source).toBe("example");
    expect(start?.dataDir).toBe(pipeline);
    const sent = JSON.parse(file ?? "null") as ExampleHistory["pipeline"];
    const expected = exampleHistory(now, "normal")?.pipeline;
    expect(sent.archive.tuples).toHaveLength(expected?.archive.tuples.length ?? -1);
    expect(sent.channels).toHaveLength(expected?.channels.length ?? -1);
    expect(setArchiveDays).toHaveBeenCalledExactlyOnceWith(90);
    // The job removes the file; if it didn't, main does.
    expect(existsSync(join(pipeline, historyFile))).toBe(false);
  });

  it("does nothing for the first scenario", async () => {
    const runJob = vi.fn<(start: Start) => Promise<JobOutcome>>();
    const setArchiveDays = vi.fn<(days: number) => void>();
    const target = db();
    const before = count(target, "activity_log");
    await loadHistory({
      db: target,
      scenario: "first",
      now,
      folder: join(folder, "pipeline"),
      runJob,
      setArchiveDays,
    });
    expect(runJob).not.toHaveBeenCalled();
    expect(setArchiveDays).not.toHaveBeenCalled();
    expect(count(target, "activity_log")).toBe(before);
    expect(existsSync(join(folder, "pipeline"))).toBe(false);
  });

  it("swallows a failed job and logs only its kind", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const setArchiveDays = vi.fn<(days: number) => void>();
    await loadHistory({
      db: db(),
      scenario: "normal",
      now,
      folder: join(folder, "pipeline"),
      runJob: () => Promise.resolve({ ok: false, problem: "no_python" }),
      setArchiveDays,
    });
    expect(warn).toHaveBeenCalledWith(
      "Prototype: the example history could not be loaded (no_python).",
    );
    expect(setArchiveDays).toHaveBeenCalledWith(90);
  });

  it("swallows a job that throws, with no path in the log", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await loadHistory({
      db: db(),
      scenario: "normal",
      now,
      folder: join(folder, "pipeline"),
      runJob: () => Promise.reject(new Error("C:\\Users\\someone\\x")),
    });
    expect(warn.mock.calls.flat().join(" ")).not.toContain("someone");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("gives up waiting for a job that never ends", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await loadHistory({
      db: db(),
      scenario: "normal",
      now,
      folder: join(folder, "pipeline"),
      runJob: () => new Promise<JobOutcome>(() => undefined),
      waitMs: 30,
    });
    expect(warn).toHaveBeenCalledWith(
      "Prototype: the example history could not be loaded (timeout).",
    );
  });

  it("logs a failed write of the local part and leaves the job unrun", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const runJob = vi.fn<(start: Start) => Promise<JobOutcome>>();
    const target = db();
    target.exec("DROP TABLE catalog_weeks");
    await loadHistory({ db: target, scenario: "normal", now, folder: join(folder, "p"), runJob });
    expect(runJob).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
