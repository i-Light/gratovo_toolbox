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

  it("runs only a search on example data", () => {
    expect(startSchema.safeParse({ ...start, job: { kind: "mail.status" } }).success).toBe(false);
    expect(startSchema.safeParse({ ...start, source: "live" }).success).toBe(true);
  });

  it("refuses an unknown kind", () => {
    expect(startSchema.safeParse(liveStart({ kind: "news" })).success).toBe(false);
  });

  it("takes the mail settings and the mail and AWS secrets", () => {
    const withMail = ({ dailyCap = 30, warmupStartedOn = "2026-10-01", accessKeyId = "" }) => ({
      ...start,
      source: "live",
      job: { kind: "mail.status" },
      settings: {
        mail: {
          label: "Gratovo",
          senderName: "Sam",
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

describe("parseLine", () => {
  it("reads each kind of message the pipeline writes", () => {
    const lines = [
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
