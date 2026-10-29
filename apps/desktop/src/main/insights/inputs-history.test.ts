import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { exampleHistory, exampleSeed } from "@gratovo/core/data";
import type { ExampleHistory } from "@gratovo/core/data";
import { insightsReport, reportTabs } from "@gratovo/core/insights";
import type { InsightsInputs, InsightsReport } from "@gratovo/core/insights";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrate } from "../db/migrate";
import { createSqliteSource } from "../data/sqlite-source";
import { createCatalog } from "../find/catalog";
import { writePipelineDb } from "../find/catalog-fixture";

import { readInputs } from "./inputs";
import { forgetPipelineFacts } from "./pipeline-facts";

/**
 * The whole six-month example history, written into temp databases as the prototype switch will
 * write it (the local side by plain inserts, the pipeline side through the fixture writer), then
 * read back as inputs and turned into every tab. The headline numbers must land near the plan's
 * targets and a warm read must be quick.
 */

const NOW = new Date(2026, 9, 20, 10, 30).getTime();
const stamp = (ms: number): string => new Date(ms).toISOString().slice(0, 19) + "Z";

let dir: string;
let db: DatabaseSync;
let history: ExampleHistory;
let inputs: InsightsInputs;
let pipelinePath: string;
const reports = new Map<string, InsightsReport>();
const times: string[] = [];

function insertRows(table: string, rows: readonly object[]): void {
  const first = rows[0] as Record<string, unknown> | undefined;
  if (first === undefined) {
    return;
  }
  const columns = Object.keys(first);
  const statement = db.prepare(
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
  );
  db.exec("BEGIN");
  for (const row of rows) {
    statement.run(
      ...columns.map((column) => {
        const value = (row as Record<string, unknown>)[column];
        if (typeof value === "number") {
          // The generator can leave a fraction of a ms in a time; the columns hold whole ms.
          return Math.round(value);
        }
        return typeof value === "object" && value !== null
          ? JSON.stringify(value)
          : (value as string | null);
      }),
    );
  }
  db.exec("COMMIT");
}

/** The pipeline side as the fixture writer takes it: the same rows, in its field names. */
function pipelineData(h: ExampleHistory): Parameters<typeof writePipelineDb>[1] {
  const p = h.pipeline;
  const pending = new Map<string, { keyword: string; limit: number; at: string }[]>();
  for (const item of p.pending) {
    const list = pending.get(item.channel_id) ?? [];
    list.push({ keyword: item.keyword, limit: item.handles_limit, at: item.discovered_at });
    pending.set(item.channel_id, list);
  }
  const { labels, keywords, names, tuples } = p.archive;
  return {
    channels: p.channels.map((c) => ({
      id: c.channel_id,
      handle: c.handle,
      name: c.name,
      country: c.country,
      subscribers: c.subscribers,
      firstSeen: c.first_seen_at,
      fetched: c.videos_fetched_at,
      uploads30: c.videos_last_30,
      median: c.median_views_last_30,
      latestUpload: c.latest_upload_at,
      brands: c.seen_brands,
      emails: c.found_emails,
      sources: c.found_email_sources,
      failures: c.read_failures,
    })),
    keywords: p.links.map((l) => ({
      channel: l.channel_id,
      keyword: l.keyword,
      at: l.discovered_at,
    })),
    keywordRows: p.keywords.map((k) => ({
      keyword: k.keyword,
      status: k.status,
      completedAt: k.completed_at,
      found: k.channels_found,
    })),
    runs: p.runs.map((r) => ({
      start: r.started_at,
      end: r.finished_at,
      status: r.status,
      keywords: r.keywords_total,
      kind: r.kind,
    })),
    pending: p.pending.map((x) => ({
      channel: x.channel_id,
      keyword: x.keyword,
      at: x.discovered_at,
    })),
    archive: tuples.map((t) => {
      const [suffix, nameIndex, archivedAt, labelIndex, keywordIndex] = t;
      const id = `UC${suffix}`;
      const foundAt = stamp(t[11]);
      const entries = [
        { keyword: keywords[keywordIndex], limit: null, discovered_at: foundAt },
        ...(pending.get(id) ?? []).map((x) => ({
          keyword: x.keyword,
          limit: x.limit,
          discovered_at: x.at,
        })),
      ];
      return {
        id,
        handle: "@" + (names[nameIndex] ?? "x").toLowerCase().replace(/[^a-z0-9]/g, ""),
        name: names[nameIndex] ?? null,
        label: labels[labelIndex] ?? null,
        at: stamp(archivedAt),
        subscribers: t[6] === null ? null : String(t[6]),
        median: t[5],
        country: t[7],
        uploads30: t[8],
        brands: t[9] === null ? null : t[9] === 1 ? '["sponsor"]' : "[]",
        emails: t[10] === null ? null : t[10] === 1 ? '["a@example.com"]' : "[]",
        foundAt,
        foundVia: JSON.stringify(entries),
      };
    }),
  };
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "history-"));
  db = new DatabaseSync(":memory:");
  migrate(db);
  const made = exampleHistory(NOW, "normal");
  if (made === null) {
    throw new Error("The normal scenario has a history.");
  }
  history = made;
  const g = history.gratovo;
  insertRows("channel_state", g.creators);
  insertRows("channels", g.names);
  // The triggers wrote one event per creator at the wall clock; the history has its own.
  db.exec("DELETE FROM stage_events");
  insertRows("stage_events", g.events);
  insertRows("activity_log", g.log);
  insertRows("outreach_drafts", g.drafts);
  insertRows("outreach_messages", g.messages);
  insertRows("outreach_sequences", g.sequences);
  insertRows("catalog_weeks", g.weeks);
  const seed = exampleSeed(NOW);
  db.prepare("INSERT INTO local_settings (key, value) VALUES (?, ?)").run(
    "mail.settings",
    JSON.stringify(seed.mailSettings),
  );
  db.prepare("INSERT INTO local_settings (key, value) VALUES (?, ?)").run(
    "reach.mailboxes",
    JSON.stringify(seed.reachMailboxes),
  );

  pipelinePath = join(dir, "pipeline.db");
  writePipelineDb(pipelinePath, pipelineData(history));

  const source = createSqliteSource(db, {
    source: "example",
    me: "u1",
    extras: {
      presence: () => ({ status: "away", doing: "" }),
      counts: () => ({ today: 0, find: 0, reach: 0, close: 0, deliver: 0, plannedMinutes: 0 }),
      mateRun: () => null,
    },
  });
  const catalog = createCatalog({
    pipelineDbPath: () => pipelinePath,
    source: () => source,
    now: () => NOW,
  });
  const { rows } = await catalog.snapshot();
  catalog.close();
  forgetPipelineFacts();
  const options = {
    source,
    pipelineDbPath: pipelinePath,
    catalog: rows,
    archiveDays: history.gratovo.settings.archiveDays,
    now: NOW,
  };
  // The first read fills the cache; the timed ones after it are the warm ones.
  let started = performance.now();
  readInputs(options);
  times.push(`cold inputs ${(performance.now() - started).toFixed(0)} ms`);
  started = performance.now();
  inputs = readInputs(options);
  times.push(`warm inputs ${(performance.now() - started).toFixed(0)} ms`);
  for (const tab of reportTabs) {
    started = performance.now();
    const report = insightsReport(tab, readInputs(options), "30d");
    const ms = performance.now() - started;
    reports.set(tab, report);
    times.push(`warm ${tab} read ${ms.toFixed(0)} ms`);
    // Under 1.5 s alone (the times are logged); the bound is wide because the whole suite runs
    // at once and a busy machine must not fail the check.
    expect(ms).toBeLessThan(6000);
  }
  console.info(times.join("\n"));
}, 240_000);

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const near = (value: number, target: number, share = 0.15): void => {
  expect(value).toBeGreaterThanOrEqual(target * (1 - share));
  expect(value).toBeLessThanOrEqual(target * (1 + share));
};

describe("the six-month example history, read back", () => {
  it("lands near the plan's catalog numbers", () => {
    const search = reports.get("search");
    if (search?.tab !== "search") throw new Error("no search report");
    near(search.counts.live, 2_000);
    near(search.counts.waiting, 10_200);
    near(search.counts.archive, 150_200);
    expect(search.counts.everything).toBe(
      search.counts.live + search.counts.waiting + search.counts.archive,
    );
    // The archive's two kinds add up to the tombstones.
    expect(search.archive.byRules + search.archive.byPerson).toBe(search.counts.archive);
    near(search.archive.byRules, 141_600);
    expect(search.keywords.length).toBe(history.pipeline.keywords.length);
    expect(inputs.archive.total).toBe(history.pipeline.archive.tuples.length);
  });

  it("lands near the plan's funnel numbers", () => {
    const funnel = reports.get("funnel");
    if (funnel?.tab !== "funnel") throw new Error("no funnel report");
    const count = (step: string): number =>
      funnel.everyone.find((row) => row.step === step)?.count ?? -1;
    near(count("emailed"), 1_150, 0.2);
    near(count("shortlisted"), 1_480, 0.2);
    near(count("replied"), 96, 0.25);
    near(count("signed"), 16, 0.25);
  });

  it("builds every tab with its own tag", () => {
    for (const tab of reportTabs) {
      expect(reports.get(tab)?.tab).toBe(tab);
    }
    const emails = reports.get("emails");
    if (emails?.tab !== "emails") throw new Error("no emails report");
    expect(emails.sent).toBeGreaterThan(0);
    expect(emails.mailboxes.length).toBeGreaterThan(0);
  });
});
