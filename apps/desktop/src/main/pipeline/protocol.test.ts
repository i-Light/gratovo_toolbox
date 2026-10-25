import { describe, expect, it } from "vitest";

import { maxLineLength, parseLine, startLine, startSchema, stopLine } from "./protocol";
import type { Job, SearchJob, Start } from "./protocol";

const search: SearchJob = {
  kind: "search",
  keywords: ["best ai video editor 2026", "claude code tutorial"],
  startAt: 0,
  rules: {
    countries: ["US", "GB"],
    perKeyword: 200,
    sortBy: "upload_date",
    resultsType: "video",
    autoClean: {
      enabled: true,
      minSubscribers: 50_000,
      maxSubscribers: 2_000_000,
      belowMin: "sweep",
      aboveMax: "delay",
      label: "inactive",
    },
  },
};

const start: Start = {
  type: "start",
  protocol: 1,
  source: "example",
  dataDir: "C:\\Users\\a\\AppData\\Roaming\\Gratovo Toolbox\\example-pipeline",
  worker: "example",
  job: search,
  settings: {},
  secrets: { youtubeKey: null, proxyUrls: [], gatewayUrls: [] },
};

/** A live start for any job: only a search runs on example data. */
function liveStart(job: unknown): unknown {
  return { ...start, source: "live", job };
}

const channel = {
  type: "channel",
  keyword: "claude code tutorial",
  channelId: "UCabc_123-x",
  handle: "@aitoolsweekly",
  name: "AI Tools Weekly",
  subscribers: 184_000,
  medianViews: 21_500,
  country: "US",
  outcome: "kept",
};

describe("startLine", () => {
  it("writes one JSON line ending in a newline", () => {
    const line = startLine(start);
    expect(line.endsWith("\n")).toBe(true);
    expect(line.slice(0, -1)).not.toContain("\n");
    expect(JSON.parse(line)).toEqual(start);
  });

  it("refuses duplicate keywords, whatever their case", () => {
    const job = { ...search, keywords: ["Claude Code", "claude code"] };
    expect(() => startLine({ ...start, job })).toThrow();
  });

  it("refuses a start index past the last keyword", () => {
    expect(() => startLine({ ...start, job: { ...search, startAt: 2 } })).toThrow();
  });

  it("refuses a keyword with spaces around it or none at all", () => {
    expect(() => startLine({ ...start, job: { ...search, keywords: [" ai "] } })).toThrow();
    expect(() => startLine({ ...start, job: { ...search, keywords: [] } })).toThrow();
  });
});

const sendMessage = {
  to: "hello@aitoolsweekly.com",
  subject: "Your Claude Code series",
  body: "Hi Sam,\n\nYour agents video was the clearest I have seen.",
  sendKey: "reach:UCabc_123-x:first",
  approvedBy: "owner@gratovo.com",
};

const autoClean = search.rules.autoClean;

// One good job of each kind other than search, and ways each one breaks its bounds.
const jobCases: { good: Job; bad: Record<string, unknown>[] }[] = [
  {
    good: { kind: "mail.status" },
    bad: [{ kind: "mail.status", mailbox: "a@b.co" }],
  },
  {
    good: {
      kind: "mail.send",
      message: {
        ...sendMessage,
        mailbox: "outreach@gratovo.com",
        conversationKey: "UCabc_123-x",
        newThread: false,
        channelId: "UCabc_123-x",
        labels: ["Gratovo"],
      },
    },
    bad: [
      { kind: "mail.send", message: { ...sendMessage, sendKey: undefined } },
      { kind: "mail.send", message: { ...sendMessage, approvedBy: undefined } },
      { kind: "mail.send", message: { ...sendMessage, sendKey: "short" } },
      { kind: "mail.send", message: { ...sendMessage, sendKey: "has spaces in it" } },
      { kind: "mail.send", message: { ...sendMessage, to: "not an address" } },
      { kind: "mail.send", message: { ...sendMessage, to: "a@b.co,c@d.co" } },
      { kind: "mail.send", message: { ...sendMessage, body: "" } },
      { kind: "mail.send", message: { ...sendMessage, body: "x".repeat(100_001) } },
      { kind: "mail.send", message: { ...sendMessage, subject: "x".repeat(999) } },
      { kind: "mail.send", message: { ...sendMessage, subject: "Hi\nBcc: a@b.co" } },
      { kind: "mail.send", message: { ...sendMessage, subject: "Hi\r there" } },
      { kind: "mail.send", message: { ...sendMessage, subject: "Hi\u2028there" } },
      { kind: "mail.send", message: { ...sendMessage, subject: "Hi\vthere" } },
      { kind: "mail.send", message: { ...sendMessage, labels: Array(11).fill("a") } },
      { kind: "mail.send", message: { ...sendMessage, replyTo: "a@b.co" } },
    ],
  },
  {
    good: { kind: "mail.replies", mailbox: "outreach@gratovo.com", limit: 60 },
    bad: [
      { kind: "mail.replies", limit: 0 },
      { kind: "mail.replies", limit: 501 },
      { kind: "mail.replies", conversationKey: "" },
    ],
  },
  {
    good: { kind: "mail.ack", messageIds: ["18f2c3a9b7d4e001"] },
    bad: [
      { kind: "mail.ack", messageIds: [] },
      { kind: "mail.ack", messageIds: ["../inbox"] },
      { kind: "mail.ack", messageIds: Array(501).fill("a1") },
    ],
  },
  {
    good: { kind: "mail.cancel", conversationKey: "UCabc_123-x" },
    bad: [{ kind: "mail.cancel" }, { kind: "mail.cancel", conversationKey: "x".repeat(201) }],
  },
  {
    good: { kind: "video_stats", videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    bad: [
      { kind: "video_stats", videoUrl: "" },
      { kind: "video_stats", videoUrl: "x".repeat(2001) },
    ],
  },
  {
    good: { kind: "refetch", handles: ["@aitoolsweekly", "@claude.daily"], autoClean },
    bad: [
      { kind: "refetch", handles: [], autoClean: null },
      { kind: "refetch", handles: ["aitoolsweekly"], autoClean: null },
      { kind: "refetch", handles: ["@AIToolsWeekly", "@aitoolsweekly"], autoClean: null },
      { kind: "refetch", handles: ["@aitoolsweekly"] },
      { kind: "refetch", handles: ["@aitoolsweekly"], autoClean: null, keyword: " ai " },
    ],
  },
  {
    good: {
      kind: "backfill",
      only: ["channels", "videos", "backfill", "backlog"],
      handles: ["@aitoolsweekly"],
      months: 2,
      maxApiCalls: 0,
      includeAbsent: true,
      limit: 100_000,
    },
    bad: [
      { kind: "backfill", only: [] },
      { kind: "backfill", only: ["channels", "channels"] },
      { kind: "backfill", only: ["sync"] },
      { kind: "backfill", only: ["videos"], months: 25 },
      { kind: "backfill", only: ["videos"], maxApiCalls: 10_001 },
      { kind: "backfill", only: ["videos"], handles: [] },
    ],
  },
  {
    good: { kind: "gateways.deploy", regions: ["eu-west-1", "us-east-2", "ap-southeast-1"] },
    bad: [
      { kind: "gateways.deploy", regions: [] },
      { kind: "gateways.deploy", regions: ["eu-west-1", "eu-west-1"] },
      { kind: "gateways.deploy", regions: ["EU-WEST-1"] },
      { kind: "gateways.deploy", regions: ["eu-west-1.evil.example"] },
    ],
  },
  {
    good: { kind: "gateways.destroy", gateways: [{ region: "eu-west-1", apiId: "a1b2c3d4e5" }] },
    bad: [
      { kind: "gateways.destroy", gateways: [] },
      { kind: "gateways.destroy", gateways: [{ region: "eu-west-1", apiId: "A1/B2" }] },
    ],
  },
  {
    good: { kind: "gateways.test" },
    bad: [{ kind: "gateways.test", regions: ["eu-west-1"] }],
  },
  {
    good: {
      kind: "import.legacy",
      source: "D:\\old\\gratovo_code\\data\\database\\gratovo.db",
      dryRun: false,
      backupDir: "C:\\Users\\a\\AppData\\Roaming\\Gratovo Toolbox\\backups",
    },
    bad: [
      { kind: "import.legacy", source: "gratovo.db", dryRun: true, backupDir: null },
      { kind: "import.legacy", source: "\u0000", dryRun: true, backupDir: null },
      { kind: "import.legacy", source: `C:\\${"x".repeat(1022)}`, dryRun: true, backupDir: null },
      { kind: "import.legacy", source: "C:\\old\\a\u0000.db", dryRun: true, backupDir: null },
      { kind: "import.legacy", source: "C:\\old\\gratovo.db", dryRun: true },
      { kind: "import.legacy", source: "C:\\old\\gratovo.db", dryRun: "no", backupDir: null },
      // A real import backs up first, so it needs somewhere to put the copy.
      { kind: "import.legacy", source: "C:\\old\\gratovo.db", dryRun: false, backupDir: null },
      { kind: "import.legacy", source: "C:\\old\\gratovo.db", dryRun: false, backupDir: "bk" },
    ],
  },
  {
    good: {
      kind: "archive.sweep",
      channels: [
        { channelId: "UCaaaaaaaaaaaaaaaaaaaaaa", handle: "@aitoolsweekly" },
        { channelId: "UCbbbbbbbbbbbbbbbbbbbbbb", handle: null },
      ],
    },
    bad: [
      { kind: "archive.sweep", channels: [] },
      { kind: "archive.sweep", channels: [{ channelId: "UCabc", handle: null }] },
      {
        kind: "archive.sweep",
        channels: [{ channelId: "UCaaaaaaaaaaaaaaaaaaaaaa", handle: "aitoolsweekly" }],
      },
      { kind: "archive.sweep", channels: [{ channelId: "UCaaaaaaaaaaaaaaaaaaaaaa" }] },
      {
        kind: "archive.sweep",
        channels: [
          { channelId: "UCaaaaaaaaaaaaaaaaaaaaaa", handle: null },
          { channelId: "UCaaaaaaaaaaaaaaaaaaaaaa", handle: "@aitoolsweekly" },
        ],
      },
      {
        kind: "archive.sweep",
        channels: Array.from({ length: 2001 }, (_, i) => ({
          channelId: `UC${String(i).padStart(22, "0")}`,
          handle: null,
        })),
      },
    ],
  },
  {
    good: { kind: "archive.restore", channelIds: ["UCaaaaaaaaaaaaaaaaaaaaaa"] },
    bad: [
      { kind: "archive.restore", channelIds: [] },
      { kind: "archive.restore", channelIds: ["@aitoolsweekly"] },
      {
        kind: "archive.restore",
        channelIds: ["UCaaaaaaaaaaaaaaaaaaaaaa", "UCaaaaaaaaaaaaaaaaaaaaaa"],
      },
      { kind: "archive.restore", channelIds: ["UCaaaaaaaaaaaaaaaaaaaaaa"], label: "rejected" },
    ],
  },
];

describe("the jobs other than search", () => {
  for (const { good, bad } of jobCases) {
    it(`reads a good ${good.kind} job and refuses one that breaks its bounds`, () => {
      expect(startSchema.safeParse(liveStart(good)).success).toBe(true);
      for (const job of bad) {
        expect(startSchema.safeParse(liveStart(job)).success).toBe(false);
      }
    });
  }

  it("runs only a search and the archive jobs on example data", () => {
    expect(startSchema.safeParse({ ...start, job: { kind: "mail.status" } }).success).toBe(false);
    expect(startSchema.safeParse({ ...start, source: "live" }).success).toBe(true);
    // The archive jobs only touch the open source's own pipeline.db (plan step 5d, D37).
    const restore = { kind: "archive.restore", channelIds: ["UCaaaaaaaaaaaaaaaaaaaaaa"] };
    expect(startSchema.safeParse({ ...start, job: restore }).success).toBe(true);
    const sweep = {
      kind: "archive.sweep",
      channels: [{ channelId: "UCaaaaaaaaaaaaaaaaaaaaaa", handle: null }],
    };
    expect(startSchema.safeParse({ ...start, job: sweep }).success).toBe(true);
  });

  it("takes a dry run with no backup folder, and refuses an import on example data", () => {
    const dryRun = {
      kind: "import.legacy",
      source: "/home/runner/old/gratovo.db",
      dryRun: true,
      backupDir: null,
    };
    expect(startSchema.safeParse(liveStart(dryRun)).success).toBe(true);
    expect(startSchema.safeParse({ ...start, job: dryRun }).success).toBe(false);
  });

  it("takes the median-views and uploads bounds, absent, null or a whole number", () => {
    const withRules = (extra: Record<string, unknown>) => ({
      ...start,
      job: { ...search, rules: { ...search.rules, ...extra } },
    });
    for (const good of [
      {},
      { minMedianViews: null, minUploads30: null },
      { minMedianViews: 0, minUploads30: 0 },
      { minMedianViews: 5_000, minUploads30: 4 },
    ]) {
      expect(startSchema.safeParse(withRules(good)).success).toBe(true);
    }
    for (const bad of [
      { minMedianViews: -1 },
      { minMedianViews: 1.5 },
      { minMedianViews: "5000" },
      { minUploads30: -1 },
      { minUploads30: 10_001 },
      { minUploads30: true },
    ]) {
      expect(startSchema.safeParse(withRules(bad)).success).toBe(false);
    }
  });

  it("refuses an unknown kind", () => {
    expect(startSchema.safeParse(liveStart({ kind: "news" })).success).toBe(false);
  });

  it("takes the mail settings and the mail and AWS secrets", () => {
    const withMail = ({
      dailyCap = 30,
      warmupStartedOn = "2026-10-01",
      accessKeyId = "",
      senderName = "Sam",
    }) => ({
      ...start,
      source: "live",
      job: { kind: "mail.status" },
      settings: {
        mail: {
          label: "Gratovo",
          senderName,
          mailboxes: [{ address: "outreach@gratovo.com", dailyCap, warmupStartedOn }],
        },
      },
      secrets: {
        ...start.secrets,
        mail: {
          client: { id: "client-id", secret: "client-secret" },
          mailboxes: [{ address: "outreach@gratovo.com", refreshToken: "token" }],
        },
        aws: {
          accessKeyId: accessKeyId || "AKIAEXAMPLEKEY0000",
          secretAccessKey: "not-a-real-secret",
        },
      },
    });
    expect(startSchema.safeParse(withMail({})).success).toBe(true);
    expect(startSchema.safeParse(withMail({ dailyCap: 51 })).success).toBe(false);
    expect(startSchema.safeParse(withMail({ warmupStartedOn: "1 October" })).success).toBe(false);
    expect(startSchema.safeParse(withMail({ accessKeyId: "akia-lowercase" })).success).toBe(false);
    expect(startSchema.safeParse(withMail({ senderName: "Sam\nBcc: a@b.co" })).success).toBe(false);
  });

  it("refuses a connected mailbox the settings don't list", () => {
    const withBoxes = (listed: string[], connected: string[]) => ({
      ...start,
      source: "live",
      job: { kind: "mail.status" },
      settings: {
        mail: {
          label: "Gratovo",
          senderName: null,
          mailboxes: listed.map((address) => ({ address, dailyCap: 35, warmupStartedOn: null })),
        },
      },
      secrets: {
        ...start.secrets,
        mail: {
          client: { id: "client-id", secret: "client-secret" },
          mailboxes: connected.map((address) => ({ address, refreshToken: "token" })),
        },
      },
    });
    const one = "outreach@gratovo.com";
    expect(startSchema.safeParse(withBoxes([one], [one])).success).toBe(true);
    expect(startSchema.safeParse(withBoxes(["Outreach@Gratovo.com"], [one])).success).toBe(true);
    expect(startSchema.safeParse(withBoxes([one, "hello@gratovo.com"], [one])).success).toBe(true);
    expect(startSchema.safeParse(withBoxes([], [one])).success).toBe(false);
    expect(startSchema.safeParse(withBoxes(["hello@gratovo.com"], [one])).success).toBe(false);
  });
});

describe("stopLine", () => {
  it("is the stop message", () => {
    expect(JSON.parse(stopLine())).toEqual({ type: "stop" });
  });
});

const reply = {
  type: "reply",
  account: "outreach@gratovo.com",
  conversationKey: "UCabc_123-x",
  channelId: "UCabc_123-x",
  messageId: "18f2c3a9b7d4e001",
  from: "sam@aitoolsweekly.com",
  fromName: "Sam from AI Tools Weekly",
  subject: "Re: Your Claude Code series",
  body: "Thanks! Send over the details.",
  bodyCut: false,
  receivedAt: "2026-10-22T09:14:00Z",
  isFirstReply: true,
  cancelledFollowUps: 1,
};

const sendResult = {
  type: "result",
  kind: "mail.send",
  data: {
    duplicate: false,
    account: "outreach@gratovo.com",
    conversationKey: "UCabc_123-x",
    messageId: "18f2c3a9b7d4e001",
    threadId: "18f2c3a9b7d4e001",
    rfcMessageId: "<abc@mail.gmail.com>",
    labelled: true,
    threaded: false,
    to: "sam@aitoolsweekly.com",
    subject: "Your Claude Code series",
    sentAt: "2026-10-22T09:00:00Z",
  },
};

const importReport = {
  source: "D:\\old\\gratovo_code\\data\\database\\gratovo.db",
  tables: [
    { name: "channels", inOld: 1_840, toAdd: 1_812, already: 28 },
    { name: "videos", inOld: 0, toAdd: 0, already: 0 },
  ],
  skipped: [
    { name: "influencers", rows: 1_790, why: "synced" },
    { name: "sync_state", rows: 3, why: "bookkeeping" },
    { name: "news_items", rows: 120, why: "not-ported" },
  ],
  unsent: { outbox: 2, activity: 0 },
  settingsFiles: [
    { name: "run_config.json", found: true },
    { name: "settings.json", found: false },
  ],
  dryRun: false,
  backup: "C:\\Users\\a\\AppData\\Roaming\\Gratovo Toolbox\\backups\\pipeline-20261024T090000Z.db",
};
const importResult = { type: "result", kind: "import.legacy", data: importReport };

describe("parseLine", () => {
  it("reads each kind of message the pipeline writes", () => {
    const lines = [
      { type: "progress", table: "channels", done: 2, total: 7 },
      importResult,
      { ...importResult, data: { ...importReport, dryRun: true, backup: null, tables: [] } },
      {
        type: "end",
        state: "failed",
        at: 0,
        found: 0,
        kept: 0,
        error: { code: "store_too_new", message: "pipeline.db is newer than this app." },
      },
      {
        type: "end",
        state: "failed",
        at: 0,
        found: 0,
        kept: 0,
        error: { code: "old_app_open", message: "The old app seems to be open." },
      },
      { type: "ready", protocol: 1, version: "0.1.0" },
      { type: "run", state: "running", total: 2, startAt: 0 },
      { type: "keyword", index: 0, total: 2, keyword: "ai", state: "started" },
      { type: "keyword", index: 0, total: 2, keyword: "ai", state: "done", found: 9, kept: 4 },
      channel,
      { ...channel, handle: null, subscribers: null, medianViews: null, country: null },
      // The biggest channels pass 300 million subscribers and billions of views.
      { ...channel, subscribers: 350_000_000, medianViews: 2_000_000_000 },
      { type: "log", level: "info", text: 'Searching "ai"' },
      reply,
      { ...reply, channelId: null, fromName: null, receivedAt: null, bodyCut: true },
      sendResult,
      {
        type: "result",
        kind: "gateways.test",
        data: {
          results: [
            { region: "eu-west-1", status: 204, ok: true, message: null },
            { region: null, status: null, ok: false, message: "The gateway didn't answer." },
          ],
        },
      },
      { type: "result", kind: "archive.sweep", data: { archived: 2 } },
      {
        type: "result",
        kind: "archive.restore",
        data: {
          restored: [
            { channelId: "UCaaaaaaaaaaaaaaaaaaaaaa", handle: "@aitoolsweekly" },
            { channelId: "UCbbbbbbbbbbbbbbbbbbbbbb", handle: null },
          ],
        },
      },
      { type: "end", state: "done", at: 2, found: 9, kept: 4 },
      {
        type: "end",
        state: "failed",
        at: 1,
        found: 0,
        kept: 0,
        error: { code: "quota", message: "The YouTube quota ran out." },
      },
      {
        type: "end",
        state: "failed",
        at: 0,
        found: 0,
        kept: 0,
        error: { code: "daily_cap_reached", message: "This mailbox sent its 30 for today." },
      },
    ];
    for (const message of lines) {
      expect(parseLine(JSON.stringify(message))).toEqual({ ok: true, message });
    }
  });

  it("says when a line isn't JSON", () => {
    expect(parseLine("Traceback (most recent call last):")).toEqual({
      ok: false,
      problem: "not_json",
    });
  });

  it("says when a line is JSON but not a message", () => {
    for (const bad of [
      { type: "hello" },
      { ...channel, outcome: "maybe" },
      { ...channel, channelId: "../etc" },
      { ...channel, extra: true },
      { type: "log", level: "info", text: "x".repeat(501) },
      { type: "end", state: "done", at: -1, found: 0, kept: 0 },
      { ...reply, account: "nobody" },
      { ...reply, from: "x".repeat(321) },
      { ...reply, bodyCut: undefined },
      { ...sendResult, kind: "mail.status" },
      { ...sendResult, data: { ...sendResult.data, extra: 1 } },
      { type: "result", kind: "search", data: {} },
      { type: "result", kind: "mail.ack", data: { acknowledged: -1 } },
      { type: "result", kind: "video_stats", data: { videoId: "short", views: 1, fetchedAt: "" } },
      { type: "progress", table: "", done: 0, total: 7 },
      { type: "progress", table: "x".repeat(65), done: 0, total: 7 },
      { type: "progress", table: "channels", done: -1, total: 7 },
      { type: "progress", table: "channels", done: 1 },
      { ...importResult, data: { ...importReport, extra: 1 } },
      { ...importResult, data: { ...importReport, unsent: { outbox: 2 } } },
      {
        ...importResult,
        data: { ...importReport, tables: Array(41).fill(importReport.tables[0]) },
      },
      {
        ...importResult,
        data: { ...importReport, skipped: Array(61).fill(importReport.skipped[0]) },
      },
      {
        ...importResult,
        data: { ...importReport, skipped: [{ name: "news_items", rows: 1, why: "old" }] },
      },
      {
        ...importResult,
        data: {
          ...importReport,
          tables: [{ name: "x".repeat(65), inOld: 0, toAdd: 0, already: 0 }],
        },
      },
      [1, 2],
      null,
    ]) {
      expect(parseLine(JSON.stringify(bad))).toEqual({ ok: false, problem: "bad_message" });
    }
  });

  it("refuses a line that is too long without parsing it", () => {
    const line = JSON.stringify({ type: "log", level: "info", text: "x".repeat(maxLineLength) });
    expect(parseLine(line)).toEqual({ ok: false, problem: "too_long" });
  });
});
