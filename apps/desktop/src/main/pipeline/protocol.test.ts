import { describe, expect, it } from "vitest";

import { maxLineLength, parseLine, startLine, stopLine } from "./protocol";
import type { Start } from "./protocol";

const start: Start = {
  type: "start",
  protocol: 1,
  source: "example",
  dataDir: "C:\\Users\\a\\AppData\\Roaming\\Gratovo Toolbox\\example-pipeline",
  worker: "example",
  job: {
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
  },
  settings: {},
  secrets: { youtubeKey: null, proxyUrls: [], gatewayUrls: [] },
};

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
    const job = { ...start.job, keywords: ["Claude Code", "claude code"] };
    expect(() => startLine({ ...start, job })).toThrow();
  });

  it("refuses a start index past the last keyword", () => {
    expect(() => startLine({ ...start, job: { ...start.job, startAt: 2 } })).toThrow();
  });

  it("refuses a keyword with spaces around it or none at all", () => {
    expect(() => startLine({ ...start, job: { ...start.job, keywords: [" ai "] } })).toThrow();
    expect(() => startLine({ ...start, job: { ...start.job, keywords: [] } })).toThrow();
  });
});

describe("stopLine", () => {
  it("is the stop message", () => {
    expect(JSON.parse(stopLine())).toEqual({ type: "stop" });
  });
});

describe("parseLine", () => {
  it("reads each kind of message the pipeline writes", () => {
    const lines = [
      { type: "ready", protocol: 1, version: "0.1.0" },
      { type: "run", state: "running", total: 2, startAt: 0 },
      { type: "keyword", index: 0, total: 2, keyword: "ai", state: "started" },
      { type: "keyword", index: 0, total: 2, keyword: "ai", state: "done", found: 9, kept: 4 },
      channel,
      { ...channel, handle: null, subscribers: null, medianViews: null, country: null },
      { type: "log", level: "info", text: 'Searching "ai"' },
      { type: "end", state: "done", at: 2, found: 9, kept: 4 },
      {
        type: "end",
        state: "failed",
        at: 1,
        found: 0,
        kept: 0,
        error: { code: "quota", message: "The YouTube quota ran out." },
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
