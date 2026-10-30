import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { DataSource } from "@gratovo/core/data";
import { drillIds, insightsReport } from "@gratovo/core/insights";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { migrate } from "../db/migrate";
import { createSqliteSource } from "../data/sqlite-source";
import { createCatalog } from "../find/catalog";
import { channelId, writePipelineDb, type FixtureData } from "../find/catalog-fixture";

import { readInputs } from "./inputs";
import { forgetPipelineFacts } from "./pipeline-facts";

const NOW = new Date(2026, 9, 28, 12).getTime();
const day = 86_400_000;
const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 19) + "Z";

const [a, b, c, d, e, t1, t2, t3] = ["a", "b", "c", "d", "e", "t1", "t2", "t3"].map(channelId) as [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];

let dir: string;
let db: DatabaseSync;
let source: DataSource;
let pipelinePath: string;

function openSource(): DataSource {
  return createSqliteSource(db, {
    source: "live",
    me: "u1",
    extras: {
      presence: () => ({ status: "away", doing: "" }),
      counts: () => ({ today: 0, find: 0, reach: 0, close: 0, deliver: 0, plannedMinutes: 0 }),
      mateRun: () => null,
    },
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "inputs-"));
  db = new DatabaseSync(":memory:");
  migrate(db);
  source = openSource();
  pipelinePath = join(dir, "pipeline.db");
  forgetPipelineFacts();
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const via = (keyword: string, at: string, more: [string, string][] = []): string =>
  JSON.stringify([
    { keyword, limit: null, discovered_at: at },
    ...more.map(([k, t]) => ({ keyword: k, limit: 200, discovered_at: t })),
  ]);

function pipelineData(): FixtureData {
  return {
    channels: [
      {
        id: a,
        name: "Agent Lab",
        country: "US",
        subscribers: "80000",
        uploads30: 6,
        median: 50_000,
        brands: '["Codewell"]',
        emails: '["hi@agentlab.test"]',
        sources: '[{"email":"hi@agentlab.test","source":"about"}]',
      },
      { id: b, name: "Prompt Daily", country: "US", uploads30: 4, median: 900 },
      // Never read, one failed read so far.
      { id: c, name: "Cursor Tips", fetched: null, failures: 1 },
      { id: e, name: "Model Notes", country: "DE", uploads30: 3, median: 20_000 },
    ],
    keywords: [
      { channel: a, keyword: "ai agents", at: iso(NOW - day) },
      { channel: a, keyword: "llm news", at: iso(NOW - 40 * day) },
      { channel: b, keyword: "ai agents", at: iso(NOW - 40 * day) },
      { channel: c, keyword: "cursor ai", at: iso(NOW - 2 * day) },
    ],
    keywordRows: [
      {
        keyword: "ai agents",
        startedAt: iso(NOW - 26 * 3_600_000),
        completedAt: iso(NOW - 22 * 3_600_000),
        found: 9,
      },
      { keyword: "llm news", completedAt: iso(NOW - 30 * day), found: 2 },
      { keyword: "never run", status: "pending" },
    ],
    runs: [
      { start: iso(NOW - 26 * 3_600_000), end: iso(NOW - 22 * 3_600_000) },
      { start: iso(NOW - 30 * day), end: iso(NOW - 30 * day + 3_600_000) },
      { start: iso(NOW - 3 * day), end: null, kind: "refetch" },
    ],
    archive: [
      {
        id: t1,
        at: iso(NOW - 3 * day),
        label: "rejected",
        subscribers: "30000",
        median: 20_000,
        uploads30: 2,
        country: "US",
        brands: "[]",
        emails: null,
        foundVia: via("ai agents", iso(NOW - 60 * day)),
      },
      {
        id: t2,
        at: iso(NOW - 2 * day),
        label: "under 5k subscribers",
        subscribers: "1200",
        country: "DE",
        brands: null,
        emails: '["x@y.test"]',
        foundVia: via("llm news", iso(NOW - 25 * 3_600_000)),
      },
      {
        id: t3,
        at: iso(NOW - 2 * day),
        label: "too few views",
        subscribers: "9000",
        median: 300,
        country: "US",
        brands: '["Codewell"]',
        emails: "[]",
        foundVia: via("ai agents", iso(NOW - 25 * 3_600_000), [
          ["llm news", iso(NOW - 24 * 3_600_000)],
        ]),
      },
    ],
    pending: [
      { channel: t1, keyword: "ai agents", at: iso(NOW - 24 * 3_600_000) },
      { channel: t3, keyword: "llm news", at: iso(NOW - 40 * day) },
    ],
  };
}

function seedLocal(): void {
  const contact = (value: string, confirmed: boolean): string =>
    JSON.stringify([
      { method: "email", value, primary: true, confirmed, source: "about", confidence: 0.9 },
    ]);
  const state = db.prepare(
    `INSERT INTO channel_state (channel_id, handle, vetting_status, pipeline_stage, creator_stage,
       contacts, media_kit, updated_at) VALUES (?, ?, 'newlyFound', 'new', ?, ?, ?, ?)`,
  );
  const kit = JSON.stringify({
    countries: [{ code: "US", pct: 60 }],
    ageBand: "18-34",
    engagement: 4,
    rate: 800,
  });
  state.run(a, "@agentlab", "emailed", contact("hi@agentlab.test", true), kit, iso(NOW - 20 * day));
  state.run(b, "@promptdaily", "rejected", "[]", null, iso(NOW - 10 * day));
  state.run(e, "@modelnotes", "shortlisted", contact("m@model.test", false), null, iso(NOW));
  // A state with no catalog row at all.
  state.run(d, "@gone", "replied", "[]", null, iso(NOW - 5 * day));
  db.prepare("INSERT INTO channels (channel_id, name) VALUES (?, ?)").run(a, "Agent Lab");
  // The triggers wrote one event per creator at the wall clock: replace them with a history.
  db.exec("DELETE FROM stage_events");
  const event = db.prepare(
    "INSERT INTO stage_events (channel_id, stage, at, source) VALUES (?, ?, ?, 'example')",
  );
  event.run(a, "shortlisted", NOW - 30 * day);
  event.run(a, "contact", NOW - 28 * day);
  event.run(a, "emailed", NOW - 25 * day);
  event.run(b, "rejected", NOW - 10 * day);
  event.run(d, "emailed", NOW - 9 * day);
  event.run(d, "replied", NOW - 5 * day);
  const log = db.prepare(
    `INSERT INTO activity_log (id, at, at_ms, actor_id, actor_name, actor_role, action,
       entity_type, entity_id, entity_label, detail)
     VALUES (?, ?, ?, 'u1', 'Moustafa', 'owner', ?, 'channel', ?, 'x', ?)`,
  );
  log.run("l1", iso(NOW - 30 * day), NOW - 30 * day, "creator.shortlist", a, null);
  log.run("l2", iso(NOW - 10 * day), NOW - 10 * day, "creator.reject", b, '{"reason":"views"}');
  log.run("l3", iso(NOW - 3 * day), NOW - 3 * day, "creator.reject", t1, '{"reason":"ai"}');
  log.run("l4", iso(NOW - 3 * day), NOW - 3 * day, "creator.reject", t2, null);
  // A reject that an undo hid.
  log.run("l5", iso(NOW - 3 * day), NOW - 3 * day, "creator.reject", e, '{"reason":"ai"}');
  db.prepare(
    `INSERT INTO activity_log (id, at, at_ms, actor_name, actor_role, action, entity_type, entity_id)
     VALUES ('u1', ?, ?, 'Moustafa', 'owner', 'undo', 'activity_log', 'l5')`,
  ).run(iso(NOW - 2 * day), NOW - 2 * day);

  db.prepare(
    `INSERT INTO outreach_drafts (id, channel_id, kind, state, edited, steer, created_at, updated_at,
       mailbox) VALUES ('d1', ?, 'first', 'sent', 1, '{"how":"Shorter","note":null}', 1, 1, 'a@x.test')`,
  ).run(a);
  const message = db.prepare(
    `INSERT INTO outreach_messages (id, channel_id, direction, kind, follow_up, at, mailbox, peer,
       draft_id, source, reading, body) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'text')`,
  );
  message.run(
    "m1",
    a,
    "out",
    "first",
    null,
    NOW - 25 * day,
    "A@x.test",
    "hi@agentlab.test",
    "d1",
    "app",
    null,
  );
  message.run(
    "m2",
    a,
    "out",
    "followUp",
    1,
    NOW - 21 * day,
    "a@x.test",
    "hi@agentlab.test",
    null,
    "imported",
    null,
  );
  message.run(
    "m3",
    a,
    "in",
    null,
    null,
    NOW - 20 * day,
    "a@x.test",
    "hi@agentlab.test",
    null,
    "sweep",
    '{"replyType":"inf.interested_vague","label":"","summary":"","side":"","corrected":false,"facts":[]}',
  );
  message.run(
    "m4",
    d,
    "in",
    null,
    null,
    NOW - 5 * day,
    "a@x.test",
    "mailer-daemon@googlemail.com",
    null,
    "sweep",
    null,
  );
  db.prepare(
    `INSERT INTO outreach_sequences (channel_id, conversation_key, mailbox, started_at, steps, stopped,
       updated_at) VALUES (?, 'k', 'a@x.test', 1, '[]', NULL, 1), (?, 'k2', 'a@x.test', 1, '[]', 'replied', 1)`,
  ).run(a, d);

  const setting = db.prepare("INSERT INTO local_settings (key, value) VALUES (?, ?)");
  setting.run(
    "mail.settings",
    JSON.stringify({
      label: "x",
      senderName: "M",
      mailboxes: [
        { address: "A@x.test", dailyCap: 30, warmupStartedOn: "2026-10-20" },
        { address: "b@x.test", dailyCap: 25, warmupStartedOn: null },
      ],
    }),
  );
  setting.run("reach.mailboxes", JSON.stringify({ "a@x.test": { paused: true, slowed: true } }));
  setting.run("insights.hidden", JSON.stringify({ k: NOW + day, bad: "x" }));
  db.prepare(
    "INSERT INTO catalog_weeks (week, live, waiting, archive, written_at) VALUES ('2026-10-19', 5, 2, 1, 1)",
  ).run();
}

async function catalogRows() {
  const catalog = createCatalog({
    pipelineDbPath: () => pipelinePath,
    source: () => source,
    now: () => NOW,
  });
  const { rows } = await catalog.snapshot();
  catalog.close();
  return rows;
}

describe("readInputs", () => {
  beforeEach(() => {
    writePipelineDb(pipelinePath, pipelineData());
    seedLocal();
  });

  it("merges the catalog's channels with the local facts", async () => {
    const inputs = readInputs({
      source,
      pipelineDbPath: pipelinePath,
      catalog: await catalogRows(),
      archiveDays: 7,
      now: NOW,
    });
    const byId = new Map(inputs.channels.map((x) => [x.id, x]));
    const lab = byId.get(a);
    expect(lab).toMatchObject({
      name: "Agent Lab",
      stage: "emailed",
      inCatalog: true,
      keywords: ["llm news", "ai agents"],
      medianViews: 50_000,
      sponsored: true,
      hasAddress: true,
      addressSource: "about",
      confirmedAt: NOW - 28 * day,
      read: "ok",
      leavesAt: null,
    });
    expect(lab?.audit).toEqual({ top: true, age: true, engagement: true, rate: null });
    // Rejected: it leaves archiveDays after the reject; the reason is the log's.
    expect(byId.get(b)).toMatchObject({
      stage: "rejected",
      rejectReason: "views",
      inCatalog: true,
      leavesAt: NOW - 10 * day + 7 * day,
    });
    // Never reviewed and never read, one failed read so far.
    expect(byId.get(c)).toMatchObject({
      stage: null,
      read: "retrying",
      medianViews: null,
      sponsored: null,
      confirmedAt: null,
    });
    // An address nobody confirmed: shortlisted, not confirmed.
    expect(byId.get(e)).toMatchObject({
      stage: "shortlisted",
      hasAddress: true,
      confirmedAt: null,
    });
    // A creator with a stage but no catalog row.
    expect(byId.get(d)).toMatchObject({ stage: "replied", inCatalog: false, hasAddress: false });
    expect(inputs.channels).toHaveLength(5);
  });

  it("reads events, the log, messages, sequences, mailboxes, weeks and settings", async () => {
    const inputs = readInputs({
      source,
      pipelineDbPath: pipelinePath,
      catalog: await catalogRows(),
      archiveDays: 7,
      now: NOW,
    });
    expect(inputs.events.filter((x) => x.channelId === a).map((x) => x.stage)).toEqual([
      "shortlisted",
      "contact",
      "emailed",
    ]);
    // The hidden reject (undone) is left out; a reject with no reason has none.
    expect(inputs.log.map((l) => [l.channelId, l.action, l.reason])).toEqual([
      [a, "shortlist", null],
      [b, "reject", "views"],
      [t1, "reject", "ai"],
      [t2, "reject", null],
    ]);
    const m = new Map(inputs.messages.map((x) => [x.id, x]));
    expect(m.get("m1")).toMatchObject({
      direction: "out",
      kind: "first",
      mailbox: "a@x.test",
      edited: true,
      rewrite: "Shorter",
    });
    // An imported follow-up has no draft: edited is not known.
    expect(m.get("m2")).toMatchObject({
      kind: "followUp",
      followUp: 1,
      edited: null,
      rewrite: null,
    });
    expect(m.get("m3")).toMatchObject({ direction: "in", reading: "interested", bounce: false });
    expect(m.get("m4")).toMatchObject({ reading: "bounce", bounce: true });
    expect(inputs.inSequence).toEqual([a]);
    expect(inputs.mailboxes).toEqual([
      {
        address: "a@x.test",
        dailyCap: 30,
        warmupStartedAt: new Date(2026, 9, 20).getTime(),
        warmupDays: 30,
        heldAt: 20,
        paused: true,
      },
      {
        address: "b@x.test",
        dailyCap: 25,
        warmupStartedAt: null,
        warmupDays: null,
        heldAt: null,
        paused: false,
      },
    ]);
    expect(inputs.weeks).toEqual([
      { at: new Date(2026, 9, 19).getTime(), live: 5, waiting: 2, archive: 1 },
    ]);
    // A damaged hidden entry is dropped; the goal is the default.
    expect(inputs.hidden).toEqual({ k: NOW + day });
    expect(inputs.goal).toEqual({ signsPerMonth: 4, revenuePerMonth: null, overrides: {} });
    expect(inputs.archiveDays).toBe(7);
  });

  it("works out the archive as totals", async () => {
    const { archive, keywords, runs } = readInputs({
      source,
      pipelineDbPath: pipelinePath,
      catalog: await catalogRows(),
      archiveDays: 7,
      now: NOW,
    });
    expect(archive).toMatchObject({ total: 3, byRules: 2, byPerson: 1, refoundThisWeek: 1 });
    expect(archive.ruleLabels).toEqual([
      { label: "too few views", count: 1 },
      { label: "under 5k subscribers", count: 1 },
    ]);
    expect(archive.personReasons).toEqual([{ reason: "ai", count: 1 }]);
    // Thirteen weeks, oldest first; the three tombstones came in this week and the one before.
    expect(archive.weekly).toHaveLength(13);
    expect(archive.weekly.reduce((sum, w) => sum + w.all, 0)).toBe(3);
    expect(archive.weekly.reduce((sum, w) => sum + w.byRules, 0)).toBe(2);
    expect(archive.person).toEqual({
      medianViews: 20_000,
      uploads30: 2,
      subscribers: 30_000,
      sponsored: { n: 0, d: 1 },
      inMarkets: { n: 1, d: 1 },
      // Its addresses were never known.
      addressFound: null,
    });
    expect(archive.rules).toEqual({
      medianViews: 300,
      uploads30: null,
      subscribers: 5_100,
      sponsored: { n: 1, d: 1 },
      inMarkets: { n: 1, d: 2 },
      addressFound: { n: 1, d: 2 },
    });
    // Runs: searches only, newest first.
    expect(runs).toEqual([NOW - 26 * 3_600_000, NOW - 30 * day]);
    const agents = keywords.find((k) => k.keyword === "ai agents");
    // Links (a, b) and tombstones (t1, t3).
    expect(agents).toMatchObject({ found: 4, sweptByRules: 1 });
    // Its last run: one new link (a), the tombstone t3 found in it, one re-found (pending t1).
    expect(agents?.lastRun).toEqual({ at: NOW - 22 * 3_600_000, fresh: 2, live: 0, archived: 1 });
    expect(keywords.find((k) => k.keyword === "llm news")).toMatchObject({
      // a's link, t2 and t3's two entries.
      found: 3,
      sweptByRules: 2,
    });
    expect(keywords.find((k) => k.keyword === "never run")).toMatchObject({
      found: 0,
      lastRun: null,
    });
  });

  it("gives reports whose numbers agree with the inputs", async () => {
    const inputs = readInputs({
      source,
      pipelineDbPath: pipelinePath,
      catalog: await catalogRows(),
      archiveDays: 7,
      now: NOW,
    });
    const search = insightsReport("search", inputs, "30d");
    if (search.tab !== "search") throw new Error("wrong tab");
    // a, c, e live; b waiting; three tombstones.
    expect(search.counts).toEqual({ live: 3, waiting: 1, archive: 3, everything: 7 });
    expect(search.archive).toMatchObject({ byRules: 2, byPerson: 1, refoundThisWeek: 1 });
    const funnel = insightsReport("funnel", inputs, "90d");
    if (funnel.tab !== "funnel") throw new Error("wrong tab");
    const emailed = funnel.everyone.find((row) => row.step === "emailed");
    expect(emailed?.count).toBe(drillIds({ kind: "step", step: "emailed" }, inputs, "90d").length);
    const emails = insightsReport("emails", inputs, "90d");
    if (emails.tab !== "emails") throw new Error("wrong tab");
    expect(emails.mailboxes.map((row) => row.address)).toEqual(["a@x.test", "b@x.test"]);
  });
});

describe("readInputs without data", () => {
  it("gives an empty catalog and archive for a missing pipeline.db", () => {
    const inputs = readInputs({
      source,
      pipelineDbPath: join(dir, "none.db"),
      catalog: [],
      archiveDays: 90,
      now: NOW,
    });
    expect(inputs.channels).toEqual([]);
    expect(inputs.archive).toMatchObject({ total: 0, byRules: 0 });
    expect(inputs.archive.weekly).toHaveLength(13);
    expect(inputs.keywords).toEqual([]);
    expect(inputs.runs).toEqual([]);
    const report = insightsReport("overview", inputs, "7d");
    expect(report.tab).toBe("overview");
  });

  it("reads a file with no tables as empty, and reads a changed file again", () => {
    const path = join(dir, "empty.db");
    new DatabaseSync(path).close();
    const none = readInputs({
      source,
      pipelineDbPath: path,
      catalog: [],
      archiveDays: 7,
      now: NOW,
    });
    expect(none.archive.total).toBe(0);
    writePipelineDb(join(dir, "full.db"), pipelineData());
    const first = readInputs({
      source,
      pipelineDbPath: join(dir, "full.db"),
      catalog: [],
      archiveDays: 7,
      now: NOW,
    });
    expect(first.archive.total).toBe(3);
  });
});
